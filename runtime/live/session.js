// runtime/live/session.js — one document under live editing, plus the peer transport.
//
// Manifesto Appendix III, line 108:
//   "What lands in Git is not every change, but every fact. All 200 CRDT ops the accountant
//    needed to arrive at a finished invoice are irrelevant to eternity — only the final
//    version matters. Live Layer is process; Git Layer is result."
//
// So this file has two halves:
//
//   1. A `session`: the document as a set of CRDT registers in RAM, one per touched field,
//      with ERP conflict semantics on top. `snapshot()` is the seam to eternity — it throws
//      away all the process and hands back the plain Doc that gets committed.
//
//   2. A `transport`: peers exchanging ops. For v0.1 it is loopback (several sessions in one
//      process) behind the `PeerLink` interface that WebRTC will implement later. Everything
//      above `PeerLink` is production code; only `PeerLink` itself gets replaced.
//
// Appendix XI, "Parallel editing on the same delivery note", is the acceptance criterion:
//   95% case: different fields -> both changes survive, no conflict.
//    5% case: same field, concurrently -> both values shown with their authors, a human
//             decides, the decision propagates. No silent last-writer-wins, no data loss.
//
// No imports except our own modules. No node:*. Loads in a browser as-is.

import { hlc as makeHlc, compareStamps } from './hlc.js';
import { canonicalize, canonicalJson, lwwRegister, pnCounter, orSet, mvRegister } from './crdt.js';
import {
  money,
  toString as moneyToString,
  add as moneyAdd,
  compare as moneyCompare,
  currencyOf,
  isMoney,
  MoneyError,
} from '../money/money.js';

/** @typedef {import('./hlc.js').Stamp} Stamp */
/** @typedef {{ id:string, entity:string } & Record<string, unknown>} Doc */
/** @typedef {{ field:string } & Record<string, unknown>} Envelope  a CRDT op plus its field */

// =======================================================================================
// The conflict policy — ERP semantics as DATA
// =======================================================================================
//
// Manifesto line 130: "Our conflict resolution is tailored to business rules: on a released
// invoice, reject hard; on a draft, notify; on a quantity, OR-Set rule. These rules live in
// one place, in our language."
//
// This is that one place. It is deliberately DATA, not code: it will eventually be produced
// by the operating model (Principle 11 — what the COO writes is what runs), and an operating
// model cannot hand us a closure. Everything below is a plain object that survives
// JSON.stringify, a git commit, and thirty years.
//
//   /** @typedef {{ stateField?: string, rules?: PolicyRule[], default?: PolicyDecision }} ConflictPolicy */
//   /** @typedef {{ when?: Record<string, unknown|unknown[]>,   // equality/membership on the doc
//    *              fields?: '*'|string|string[],               // which fields it governs
//    *              on: 'reject'|'notify'|'merge',
//    *              message?: string } } PolicyRule */
//   /** @typedef {{ on:'reject'|'notify'|'merge', message?: string }} PolicyDecision */
//
// The three verbs, and exactly what each one does:
//
//   'reject'  Hard refusal. A local write throws PolicyError. A remote op is still recorded
//             (we never destroy what a peer sent us) but is excluded from snapshot() and
//             listed by violations(). Use for a released invoice, a closed period, a booked
//             journal entry. This is the "reject hard" of line 130.
//
//   'notify'  The field is backed by a Multi-Value Register. Concurrent writes both survive
//             and are reported by conflicts() with their authors; a human resolves. This is
//             the default, and it is Appendix XI's 5% case. Use for dates, addresses, texts
//             — anything where "the other one silently won" is a defect.
//
//   'merge'   Converge silently by the type's own arithmetic: PN-Counter for inc(), OR-Set
//             observed-remove for add()/remove(), LWW for set(). Use for quantities, stock,
//             revenue, line-item sets — where the CRDT rule *is* the business rule.
//
// Rules are evaluated top to bottom, FIRST MATCH WINS. Ordered first-match is auditable:
// you read down the list and stop, no priority arithmetic to reason about.
//
// `when` is matched against the *committed base document* (the state both peers loaded from
// git HEAD), never against live edits. If it were matched against live state, two peers could
// resolve different rules for the same field mid-edit and diverge. Reading it from the shared
// base keeps policy resolution deterministic across the mesh — Principle 2 again.
//
// Example — a delivery note and an invoice, in the same shape the operating model will emit:
//
//   {
//     stateField: 'status',
//     rules: [
//       { when: { status: ['released', 'sent', 'booked'] }, fields: '*', on: 'reject',
//         message: 'Document is released. Reopen it before editing.' },
//       { fields: ['quantity', 'stock', 'revenue', 'items'], on: 'merge' },
//       { when: { status: 'draft' }, fields: '*', on: 'notify' },
//     ],
//     default: { on: 'notify' },
//   }

const DECISIONS = ['reject', 'notify', 'merge'];
const POLICY_KEYS = ['stateField', 'rules', 'default'];
const RULE_KEYS = ['when', 'fields', 'on', 'message'];

/** Thrown when the policy refuses a write, or when unresolved conflicts block a snapshot. */
export class PolicyError extends Error {
  /** @param {string} message @param {object} detail */
  constructor(message, detail = {}) {
    super(message);
    this.name = 'PolicyError';
    Object.assign(this, detail);
  }
}

/**
 * Validate a policy and return a resolver. Unknown keys and unknown verbs are REFUSED, with
 * the offending name in the message — Principle 6: an unknown construction is never silently
 * ignored, because a silently ignored `on: 'rejct'` on a released invoice is exactly the
 * class of bug this whole architecture exists to make impossible.
 *
 * @param {unknown} policy
 */
export function compilePolicy(policy) {
  const raw = policy === undefined || policy === null ? {} : policy;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PolicyError('policy must be a plain object');
  }
  for (const key of Object.keys(raw)) {
    if (!POLICY_KEYS.includes(key)) {
      throw new PolicyError(`policy: unknown key '${key}' (expected ${POLICY_KEYS.join(', ')})`);
    }
  }
  const stateField = /** @type {any} */ (raw).stateField ?? 'status';
  if (typeof stateField !== 'string' || !stateField) {
    throw new PolicyError('policy.stateField must be a non-empty string');
  }
  const rules = /** @type {any} */ (raw).rules ?? [];
  if (!Array.isArray(rules)) throw new PolicyError('policy.rules must be an array');

  const compiled = rules.map((rule, i) => {
    if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new PolicyError(`policy.rules[${i}] must be a plain object`);
    }
    for (const key of Object.keys(rule)) {
      if (!RULE_KEYS.includes(key)) {
        throw new PolicyError(`policy.rules[${i}]: unknown key '${key}' (expected ${RULE_KEYS.join(', ')})`);
      }
    }
    if (!DECISIONS.includes(rule.on)) {
      throw new PolicyError(
        `policy.rules[${i}].on must be one of ${DECISIONS.join(', ')}, got '${String(rule.on)}'`,
      );
    }
    const fields = rule.fields ?? '*';
    if (fields !== '*' && typeof fields !== 'string' && !Array.isArray(fields)) {
      throw new PolicyError(`policy.rules[${i}].fields must be '*', a string, or a string[]`);
    }
    const when = rule.when ?? null;
    if (when !== null && (typeof when !== 'object' || Array.isArray(when))) {
      throw new PolicyError(`policy.rules[${i}].when must be a plain object of field: value`);
    }
    return { index: i, when, fields, on: rule.on, message: rule.message ?? null };
  });

  const fallback = /** @type {any} */ (raw).default ?? { on: 'notify' };
  if (!DECISIONS.includes(fallback.on)) {
    throw new PolicyError(`policy.default.on must be one of ${DECISIONS.join(', ')}`);
  }

  /** @param {Record<string, unknown>|null} when @param {Doc} doc */
  function whenMatches(when, doc) {
    if (when === null) return true;
    for (const [field, expected] of Object.entries(when)) {
      const actual = doc[field];
      const ok = Array.isArray(expected)
        ? expected.some((e) => canonicalJson(e) === canonicalJson(actual === undefined ? null : actual))
        : canonicalJson(expected) === canonicalJson(actual === undefined ? null : actual);
      if (!ok) return false;
    }
    return true;
  }

  /** @param {'*'|string|string[]} spec @param {string} field */
  function fieldMatches(spec, field) {
    if (spec === '*') return true;
    if (typeof spec === 'string') return spec === field;
    return spec.includes(field);
  }

  return {
    stateField,
    /**
     * The decision governing `field` for this document.
     * @param {string} field @param {Doc} doc
     * @returns {{ on:'reject'|'notify'|'merge', message:string|null, rule:number|null }}
     */
    decide(field, doc) {
      for (const rule of compiled) {
        if (whenMatches(rule.when, doc) && fieldMatches(rule.fields, field)) {
          return { on: rule.on, message: rule.message, rule: rule.index };
        }
      }
      return { on: fallback.on, message: fallback.message ?? null, rule: null };
    },
    /** The policy as it was given, for the record. */
    source() {
      return canonicalize({ stateField, rules, default: fallback });
    },
  };
}

// =======================================================================================
// The session
// =======================================================================================

/** Fields that identify the document. The live layer may never change them. */
const IMMUTABLE_FIELDS = ['id', 'entity'];

// =======================================================================================
// Money in the Live Layer — FD-1, and the currency-identity decision
// =======================================================================================
//
// A monetary value is the token `"10.00 EUR"` (FD-1). Two questions follow, and the second
// one is the interesting one.
//
// 1. HOW IS IT STORED AND MOVED? Exactly as runtime/money/ says: BigInt minor units for the
//    arithmetic, a canonical token on the wire and in the snapshot. `inc()` on a money field
//    is a money PN-Counter (crdt.js, money mode); `set()` is an LWW or Multi-Value register
//    holding tokens. No `Number` touches a monetary value on any path below.
//
// 2. WHOSE CURRENCY IS IT? **The committed document's.** A money field's currency is read off
//    the value at git HEAD — the state every peer in the mesh loaded before editing — exactly
//    as the conflict policy reads `status` from the base rather than from live edits, and for
//    the identical reason: a decision derived from the shared base is reached identically on
//    every peer without anybody talking to anybody (Principle 2). So:
//
//      * `"revenue": "0.00 EUR"` in the document makes `revenue` a EUR field. `inc('revenue',
//        '1250.00 EUR')` moves it; `inc('revenue', '1250.00 USD')` is refused at the
//        keystroke with `MoneyError('currency-mismatch')` and produces no op at all;
//        `inc('revenue', 1250)` is refused as `not-a-string`.
//      * A remote op in another currency is **quarantined, not converted and not merged**: it
//        lands in `violations()` with the op preserved, and never reaches `snapshot()`. That
//        is the same treatment a `policy-reject` and a `crdt-type-mismatch` already get, so
//        there is one quarantine concept in this file and not three. It is deliberately NOT a
//        `conflicts()` entry: a conflict blocks `snapshot()`, and one misconfigured peer must
//        not be able to freeze a document by asserting a currency the repo never declared.
//      * A field the committed document does **not** denominate has no currency of its own,
//        and a currency is never guessed. `inc()` on it with a token throws
//        `MoneyError('currency-required')` — the same code and the same argument agent M
//        chose for `sum([])`: "guessing a currency for an empty total is how a report shows 0
//        in the wrong money". Declaring the currency of an amount is a *fact*; it belongs in
//        a signed commit, not in a keystroke. `set(field, '10.00 EUR')` is how the amount is
//        created; `inc()` moves what git already holds.
//      * Two peers who concurrently `set()` an undeclared field to different currencies is a
//        genuine two-value conflict with no authority to appeal to. It surfaces in
//        `conflicts()` with both tokens and both authors, `snapshot()` refuses, and a human
//        resolves — Appendix XI's 5% case, in money.
//
//    What never happens anywhere: a silent pick between two currencies, or a conversion. FD-1
//    forbids the second (conversion is a modelled act carrying its rate and date; a converted
//    amount without its rate is unauditable) and the first is worse — it is a fabricated
//    amount in a ledger.
//
// 3. WHAT ABOUT A SCALED QUANTITY? FD-1 mandates those by the same string mechanism
//    (`"120.500 kg"`, 0.001 kg scale), and `runtime/money/quantity.js` implements the exact
//    arithmetic. **This module does not yet have a quantity counter**, so `inc()` on a field
//    git HEAD holds as a quantity token is REFUSED, both for a token (`currency-required`) and
//    for a Number (`PolicyError`, code `not-a-counter`) — see `inc()` below. It fails closed on
//    purpose: a plain counter would start from zero and commit `0.25` over `"120.500 kg"`,
//    losing the opening value and the unit. A scale and a unit are never guessed, for exactly
//    the reason a currency never is. The exit path is this section again with
//    `quantity.js` in place of `money.js`, and it is named in COMPROMISES rather than half-built.

/**
 * The currency of a canonical FD-1 token, or `null` for anything that is not one.
 *
 * `currencyOf` from runtime/money/ is the only parser involved: NeoDonkey has exactly one
 * money recogniser and this is not a second one. The `try` exists because that module answers
 * with an exception (correctly — an off-spec amount must not be silently tolerated) while
 * here the question is genuinely "is this field money at all?".
 *
 * @param {unknown} value
 * @returns {string|null}
 */
function tokenCurrency(value) {
  if (typeof value !== 'string') return null;
  try {
    return currencyOf(value);
  } catch (e) {
    if (e instanceof MoneyError) return null;
    throw e;
  }
}

/**
 * A document under live editing.
 *
 * The base document (the state at git HEAD, identical on every peer) stays untouched. Only
 * fields somebody actually edits get a CRDT register, and only those registers produce ops.
 * That keeps the op stream proportional to the editing, not to the document — and it means
 * two peers that opened the same HEAD agree on every untouched field for free.
 *
 * Which register a field gets is decided by the METHOD the caller uses, not by the policy:
 *   set()          -> LWW-Register if the policy says 'merge', else Multi-Value Register
 *   add()/remove() -> OR-Set
 *   inc()          -> PN-Counter
 * The policy decides what happens when values collide, not how the field is stored. Keeping
 * those two concerns apart is what makes the policy safe to hand to a non-programmer.
 *
 * @param {Doc} doc                base document, as committed
 * @param {string} nodeId          this peer
 * @param {(() => number) | { now(): Stamp, observe(s: Stamp): void }} clock
 *        injected wall clock, or an existing hlc() instance to share
 * @param {{ policy?: unknown }} [options]
 */
export function session(doc, nodeId, clock, options = {}) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new TypeError('session: doc must be a plain object');
  }
  if (typeof doc.id !== 'string' || !doc.id) throw new TypeError('session: doc.id is required');
  if (typeof doc.entity !== 'string' || !doc.entity) {
    throw new TypeError('session: doc.entity is required');
  }
  if (typeof nodeId !== 'string' || !nodeId) {
    throw new TypeError('session: nodeId must be a non-empty string');
  }

  /** The committed starting point. Canonical, frozen, never mutated. */
  const base = /** @type {Doc} */ (canonicalize(doc, 'doc'));
  const clockInstance =
    typeof clock === 'function' ? makeHlc(nodeId, clock) : clock;
  if (!clockInstance || typeof clockInstance.now !== 'function') {
    throw new TypeError('session: clock must be a () => number function or an hlc() instance');
  }
  const policy = compilePolicy(options.policy);

  /** field -> { type, reg } @type {Map<string, {type:string, reg:any}>} */
  const fields = new Map();
  /** things that happened but must not affect the truth @type {any[]} */
  const violationLog = [];
  /** handlers wired up by transport() (or by a UI) @type {((ops: Envelope[]) => void)[]} */
  const localHandlers = [];

  const CONSTRUCTORS = {
    lww: lwwRegister,
    mv: mvRegister,
    pn: pnCounter,
    orset: orSet,
  };

  // -------------------------------------------------------------------------------------
  // Money fields, as declared by the committed document (see the section above)
  // -------------------------------------------------------------------------------------

  /** field -> { scalar, set } currency or null, computed once @type {Map<string, {scalar:string|null, set:string|null}>} */
  const moneyShapes = new Map();

  /**
   * What kind of money field is this, according to git HEAD?
   *   `scalar` — the committed value is a money token: an amount (`inc`, `set`).
   *   `set`    — the committed value is a non-empty array of tokens, all in one currency: a
   *              set of amounts (`add`, `remove`). A mixed or empty array declares nothing.
   * `base` never changes, so this is computed once per field.
   * @param {string} field
   */
  function moneyShape(field) {
    const cached = moneyShapes.get(field);
    if (cached !== undefined) return cached;
    const value = base[field];
    const shape = { scalar: tokenCurrency(value), set: /** @type {string|null} */ (null) };
    if (shape.scalar === null && Array.isArray(value) && value.length > 0) {
      const codes = value.map(tokenCurrency);
      if (codes.every((code) => code !== null && code === codes[0])) shape.set = codes[0];
    }
    moneyShapes.set(field, shape);
    return shape;
  }

  /** @param {string} field @returns {string|null} */
  function moneyScalarCurrency(field) {
    return moneyShape(field).scalar;
  }

  /** @param {string} field @returns {string|null} */
  function moneySetCurrency(field) {
    return moneyShape(field).set;
  }

  /**
   * Validate a value written to a money field and return its canonical token.
   *
   * Refused, each with runtime/money/'s own stable error code, so a rule or a UI branches on
   * `code` and never on a message: a `Number` (`not-a-string`), an off-spec spelling like
   * `"10.0 EUR"` or `"10,00 EUR"` (`wrong-scale`, `decimal-comma`, …), and a different
   * currency (`currency-mismatch`). The last one is not a rounding quibble: re-denominating a
   * field is a conversion, and FD-1 says a conversion is a modelled act that carries its rate
   * and its date — which a keystroke cannot.
   *
   * @param {string} field @param {unknown} value @param {string} currency
   * @returns {string} the canonical token
   */
  function assertMoneyValue(field, value, currency) {
    const amount = money(typeof value === 'string' ? value : moneyToString(value));
    if (amount.currency !== currency) {
      throw new MoneyError(
        'currency-mismatch',
        `session: '${field}' is denominated in ${currency} by the committed ${base.entity} ${base.id}; ` +
          `refusing to write ${moneyToString(amount)}. Mixed currencies never combine silently (FD-1): ` +
          'a re-denomination is a conversion, and a conversion is a modelled act that records its rate and date.',
      );
    }
    return moneyToString(amount);
  }

  /**
   * The same check for a REMOTE op: answer instead of throwing, so the op can be quarantined
   * (kept, visible, out of the truth) rather than crashing the session a peer is talking to.
   * `null` means "no monetary objection".
   * @param {string} field @param {unknown} value @param {string} currency
   * @returns {{code:string, detail:string}|null}
   */
  function moneyObjection(field, value, currency) {
    try {
      assertMoneyValue(field, value, currency);
      return null;
    } catch (e) {
      if (e instanceof MoneyError) return { code: e.code, detail: e.message };
      throw e;
    }
  }

  /**
   * Does a remote op contradict what the committed document says about this field's money?
   *
   * Two answers, both quarantines rather than merges:
   *   `money-mode-mismatch` — a monetary movement on a field git HEAD does not denominate, or
   *      a plain-number movement on one it does. The second is FD-1's release blocker arriving
   *      over the wire; accepting it would put a float into an amount.
   *   `money-refused`       — a token in the wrong currency, or off-spec (`"10.0 EUR"`).
   *
   * `null` means the op has no monetary problem and is applied normally.
   *
   * @param {string} field @param {any} op
   * @returns {{kind:string, code?:string, detail:string}|null}
   */
  function remoteMoneyObjection(field, op) {
    if (op.type === 'pn') {
      const declared = moneyScalarCurrency(field);
      const monetary = typeof op.plus === 'string' || typeof op.minus === 'string';
      if (monetary !== (declared !== null)) {
        return {
          kind: 'money-mode-mismatch',
          detail: declared === null
            ? `a peer sent a monetary movement, but the committed ${base.entity} ${base.id} does not ` +
              `denominate '${field}' in any currency, and a currency is never guessed (FD-1)`
            : `'${field}' is denominated in ${declared} by the committed ${base.entity} ${base.id}; a peer sent ` +
              'a plain-number movement, and no Number ever touches a monetary value (FD-1)',
        };
      }
      // The same rule `inc()` applies locally: a plain counter over a committed value that is
      // neither a number nor an amount has no checkpoint to count from, so counting from zero
      // would drop the opening value and its unit (`"120.500 kg"` committing back as `0.25`).
      // It must be refused over the wire too — a guard the local API enforces and the receive
      // path does not is decorative, because a peer can then do what the API refuses.
      const committed = base[field];
      if (declared === null && committed !== undefined && typeof committed !== 'number') {
        return {
          kind: 'not-a-counter',
          detail: `a peer sent a plain-number movement for '${field}', but the committed ${base.entity} ` +
            `${base.id} holds ${JSON.stringify(committed)} there, which is not a number. A PN-Counter would ` +
            'start from zero and silently drop the opening value and its unit. A scale and a unit are never ' +
            'guessed, for the same reason a currency never is (FD-1).',
        };
      }
      return null;
    }
    /** @type {string|null} */
    let declared = null;
    /** @type {unknown} */
    let value = null;
    if (op.type === 'lww' || op.type === 'mv') {
      declared = moneyScalarCurrency(field);
      value = op.value;
    } else if (op.type === 'orset' && op.action === 'add') {
      declared = moneySetCurrency(field);
      value = op.element;
    } else {
      // An OR-Set *removal* carries tags, not an amount — its `element` is for readability
      // only (crdt.js), so there is nothing monetary to check and nothing to refuse.
      return null;
    }
    if (declared === null) return null;
    const fault = moneyObjection(field, value, declared);
    return fault === null ? null : { kind: 'money-refused', code: fault.code, detail: fault.detail };
  }

  /**
   * Order a set of amounts by their exact value, smallest first.
   *
   * The OR-Set orders its members by canonical JSON, which is a **string** comparison — and
   * lexically `"9.00 EUR"` sorts after `"10.00 EUR"`. Deterministic, so convergence was never
   * at risk, but a committed array of amounts in that order misleads every human who reads
   * it. Money is ordered by `compare()` over BigInt minor units instead. Never lexically.
   * @param {string} field @param {unknown[]} values
   */
  function orderMoneySet(field, values) {
    const currency = moneySetCurrency(field);
    if (currency === null) return values;
    if (!values.every((value) => tokenCurrency(value) === currency)) return values;
    return [...values].sort((a, b) => moneyCompare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
  }

  /**
   * Get (or create) the register for a field. The register type for a field is fixed by the
   * first op seen for it. If a peer sends a different type for the same field, the two peers
   * are running different policies — we refuse the foreign op and say so, loudly, rather than
   * inventing a merge between a counter and a set.
   *
   * @param {string} field @param {string} type @param {'local'|'remote'} origin
   */
  function registerFor(field, type, origin) {
    const existing = fields.get(field);
    if (existing !== undefined) {
      if (existing.type !== type) {
        violationLog.push({
          field,
          kind: 'crdt-type-mismatch',
          detail: `field is a '${existing.type}' here but arrived as '${type}'`,
          origin,
        });
        return null;
      }
      return existing;
    }
    // A counter on a field the committed document denominates is a MONEY counter: exact
    // BigInt minor units, its currency fixed by that document (FD-1).
    const currency = type === 'pn' ? moneyScalarCurrency(field) : null;
    const reg = currency === null
      ? CONSTRUCTORS[type](clockInstance)
      : pnCounter(clockInstance, { currency });
    const entry = { type, reg };
    fields.set(field, entry);
    seedFromBase(field, entry);
    return entry;
  }

  /**
   * Seed a fresh register from the committed base value where the type needs it.
   *
   * OR-Sets do: an element that came from git needs a tag, or nobody could ever remove it.
   * The tag is derived from the base value (`base:<index>`), so every peer mints the SAME tag
   * for the same committed element and a removal on one peer is a removal on all.
   *
   * Counters do not: the committed number is the checkpoint and live ops are movements since,
   * so value = base + counter. Registers do not either: an unwritten register falls back to
   * the base value, which is cheaper and keeps authorship honest (nobody "wrote" it).
   *
   * @param {string} field @param {{type:string, reg:any}} entry
   */
  function seedFromBase(field, entry) {
    if (entry.type !== 'orset') return;
    const baseValue = base[field];
    if (!Array.isArray(baseValue)) return;
    baseValue.forEach((element, index) => {
      entry.reg.apply({ type: 'orset', action: 'add', element, tag: `base:${index}` });
    });
  }

  /**
   * The ops of a register that belong on the wire.
   *
   * Base-seeded OR-Set adds (tag `base:<index>`) are excluded: every peer derives them from
   * the same committed document, so sending them would be noise — and, more importantly,
   * *not* excluding them would break byte-identity, because a peer that never touched the
   * field has no register to derive them into. Real tags are HLC stamp ids
   * (`wall.counter.node`) and can never begin with `base:`.
   *
   * This is also the test for "did anything actually happen to this field": a register with
   * no wire ops is indistinguishable from no register at all, on every peer.
   *
   * @param {{type:string, reg:any}} entry
   */
  function wireOps(entry) {
    const ops = entry.reg.ops();
    if (entry.type !== 'orset') return ops;
    return ops.filter(
      (op) => !(op.action === 'add' && typeof op.tag === 'string' && op.tag.startsWith('base:')),
    );
  }

  /** @param {string} field */
  function assertMutable(field) {
    if (typeof field !== 'string' || !field) {
      throw new TypeError('session: field must be a non-empty string');
    }
    if (IMMUTABLE_FIELDS.includes(field)) {
      throw new PolicyError(`session: '${field}' identifies the document and cannot be edited live`, {
        field,
      });
    }
  }

  /**
   * Admission control for a LOCAL write. 'reject' means reject — hard, at the point of the
   * keystroke, so the user learns immediately and no op is ever created.
   * @param {string} field
   */
  function admit(field) {
    assertMutable(field);
    const decision = policy.decide(field, base);
    if (decision.on === 'reject') {
      throw new PolicyError(
        decision.message ??
          `session: field '${field}' is not editable in state '${String(base[policy.stateField])}'`,
        { field, decision, entity: base.entity, id: base.id },
      );
    }
    return decision;
  }

  /** Stamp ops with their field and hand them to any local listener (i.e. the transport). */
  function emit(field, ops) {
    const envelopes = ops.map((op) => ({ field, ...op }));
    if (envelopes.length > 0) {
      for (const handler of localHandlers) handler(envelopes.map((e) => ({ ...e })));
    }
    return envelopes;
  }

  /**
   * The value a field currently has, all rules applied.
   * @param {string} field
   * @returns {{ value: unknown, conflict: boolean, entries: {value:unknown, by:string}[] }}
   */
  function effective(field) {
    const entry = fields.get(field);
    const baseValue = base[field];
    const decision = policy.decide(field, base);

    // A rejected field is frozen at its committed value, whatever peers may have sent.
    // A field with no wire ops is untouched — the committed value stands. Both peers reach
    // this branch together, which is what keeps their snapshots byte-identical.
    if (decision.on === 'reject' || entry === undefined || wireOps(entry).length === 0) {
      return { value: baseValue, conflict: false, entries: [] };
    }

    if (entry.type === 'pn') {
      const currency = moneyScalarCurrency(field);
      if (currency !== null) {
        // Committed amount + live movements, exact: BigInt minor units end to end, out as one
        // canonical FD-1 token. No float, no Number, nothing to round.
        return {
          value: moneyToString(moneyAdd(baseValue, entry.reg.value())),
          conflict: false,
          entries: [],
        };
      }
      const start = typeof baseValue === 'number' ? baseValue : 0;
      return { value: start + entry.reg.value(), conflict: false, entries: [] };
    }
    if (entry.type === 'orset') {
      // An OR-Set field is unordered by definition. The snapshot writes it in canonical
      // order — deterministic on every peer, and it keeps git diffs readable. A set of
      // amounts is ordered by its exact value instead, never lexically.
      return { value: orderMoneySet(field, entry.reg.value()), conflict: false, entries: [] };
    }
    if (entry.type === 'lww') {
      return { value: entry.reg.value(), conflict: false, entries: [] };
    }
    // 'mv'
    const entries = entry.reg.entries();
    if (entries.length === 0) return { value: baseValue, conflict: false, entries: [] };
    if (entries.length === 1) return { value: entries[0].value, conflict: false, entries };
    return { value: undefined, conflict: true, entries };
  }

  /** Every field that has a value: base fields plus fields somebody created live. */
  function allFields() {
    const names = new Set(Object.keys(base));
    for (const field of fields.keys()) names.add(field);
    for (const f of IMMUTABLE_FIELDS) names.delete(f);
    return [...names].sort();
  }

  const api = {
    /** This peer's id. The transport needs it; a UI shows it next to the cursor. */
    nodeId,
    /** The document being edited, for routing. */
    entity: base.entity,
    id: base.id,

    /**
     * Write a simple field. LWW where the policy says 'merge', Multi-Value otherwise — so by
     * default a concurrent write does not overwrite, it conflicts (Appendix XI).
     * @param {string} field @param {unknown} value @returns {Envelope[]}
     */
    set(field, value) {
      const decision = admit(field);
      const currency = moneyScalarCurrency(field);
      const written = currency === null ? value : assertMoneyValue(field, value, currency);
      const type = decision.on === 'merge' ? 'lww' : 'mv';
      const entry = registerFor(field, type, 'local');
      if (entry === null) return [];
      return emit(field, entry.reg.set(written));
    },

    /** Add an element to a set field (OR-Set). @param {string} field @param {unknown} value */
    add(field, value) {
      admit(field);
      const currency = moneySetCurrency(field);
      const written = currency === null ? value : assertMoneyValue(field, value, currency);
      const entry = registerFor(field, 'orset', 'local');
      if (entry === null) return [];
      return emit(field, entry.reg.add(written));
    },

    /**
     * Remove an element from a set field (OR-Set). Removes only the tags this peer has
     * observed — a concurrent re-add elsewhere survives, by design.
     * @param {string} field @param {unknown} value
     */
    remove(field, value) {
      admit(field);
      const currency = moneySetCurrency(field);
      const target = currency === null ? value : assertMoneyValue(field, value, currency);
      const entry = registerFor(field, 'orset', 'local');
      if (entry === null) return [];
      return emit(field, entry.reg.remove(target));
    },

    /**
     * Move a counter field (PN-Counter): stock, revenue, quantities — and money.
     *
     * `delta` is a finite number on a plain counter and a canonical FD-1 token (or a `Money`)
     * on a field the committed document denominates: `inc('revenue', '1250.00 EUR')`, or
     * `inc('revenue', '-40.00 EUR')` for a credit note. Which of the two a field is, is not a
     * guess and not an option — it is read off git HEAD, identically on every peer.
     *
     * @param {string} field
     * @param {number|string|{minor: bigint, currency: string}} delta
     */
    inc(field, delta) {
      admit(field);
      if (moneyScalarCurrency(field) === null && (typeof delta === 'string' || isMoney(delta))) {
        throw new MoneyError(
          'currency-required',
          `session: refusing a monetary movement on '${field}': the committed ${base.entity} ${base.id} ` +
            'does not denominate that field in any currency, and a currency is never guessed (FD-1). ' +
            `Commit the amount first — "${field}": "0.00 EUR" — because declaring the currency of money is a ` +
            'fact and belongs in a signed commit; then inc() moves what git holds. To create the amount live, use set().',
        );
      }
      // A plain counter's value is `committed number + movements`. If git HEAD holds something
      // that is neither a number nor an amount this module can do exact arithmetic on — a
      // scaled QUANTITY token like `"120.500 kg"` (FD-1 mandates those by the same string
      // mechanism as money) — then there is no checkpoint to count from, and counting from zero
      // would silently discard both the opening value and its unit: `"120.500 kg"` would commit
      // back as `0.25`. A scale and a unit are never guessed, for exactly the reason a currency
      // never is. So this fails closed, and says which module the missing arithmetic belongs in.
      const committed = base[field];
      if (moneyScalarCurrency(field) === null && committed !== undefined && typeof committed !== 'number') {
        throw new PolicyError(
          `session: refusing to count on '${field}': the committed ${base.entity} ${base.id} holds ` +
            `${JSON.stringify(committed)} there, which is not a number and not an amount. A PN-Counter ` +
            'would start from zero and silently drop both the opening value and its unit. A scaled ' +
            'quantity needs an exact quantity counter (runtime/money/quantity.js), not a Number.',
          { field, code: 'not-a-counter', committed, entity: base.entity, id: base.id },
        );
      }
      const entry = registerFor(field, 'pn', 'local');
      if (entry === null) return [];
      // On a money counter the register itself refuses a Number, a foreign currency and an
      // off-spec token — one implementation of that rule, in crdt.js, over runtime/money/.
      return emit(field, entry.reg.inc(delta));
    },

    /**
     * Integrate ops from another peer. Order, duplication and delay do not matter — that is
     * the whole point of the four types in crdt.js.
     * @param {Envelope[]} envelopes
     */
    receive(envelopes) {
      if (!Array.isArray(envelopes)) throw new TypeError('session.receive: expected an array of ops');
      for (const envelope of envelopes) {
        if (envelope === null || typeof envelope !== 'object') {
          throw new TypeError('session.receive: each op must be an object');
        }
        const { field, ...op } = /** @type {any} */ (envelope);
        if (typeof field !== 'string' || !field) {
          throw new TypeError('session.receive: op is missing its field');
        }
        if (IMMUTABLE_FIELDS.includes(field)) {
          violationLog.push({ field, kind: 'immutable-field', detail: 'a peer tried to edit an identifier', origin: 'remote' });
          continue;
        }
        const decision = policy.decide(field, base);
        if (decision.on === 'reject') {
          // Recorded, not applied to the truth: we do not destroy what a peer sent, and we
          // do not let it into snapshot() either. The human sees it via violations().
          violationLog.push({
            field,
            kind: 'policy-reject',
            detail: decision.message ?? `field '${field}' is frozen in state '${String(base[policy.stateField])}'`,
            origin: 'remote',
            op: canonicalize(op, 'op'),
          });
          continue;
        }
        const objection = remoteMoneyObjection(field, op);
        if (objection !== null) {
          // Quarantine, exactly like a policy-reject: the op is kept and visible, and it does
          // not reach the truth. Every peer holding this committed document reaches the same
          // verdict from the same base, so quarantining cannot make two peers diverge.
          violationLog.push({ field, ...objection, origin: 'remote', op: canonicalize(op, 'op') });
          continue;
        }
        const entry = registerFor(field, String(op.type), 'remote');
        if (entry === null) continue;
        try {
          entry.reg.apply(op);
        } catch (e) {
          if (e instanceof MoneyError) {
            violationLog.push({
              field,
              kind: 'money-refused',
              code: e.code,
              detail: e.message,
              origin: 'remote',
              op: canonicalize(op, 'op'),
            });
            continue;
          }
          throw e;
        }
      }
    },

    /**
     * The 5% case of Appendix XI. Every field where two or more concurrent values are alive:
     * both values, both authors, nothing silently dropped. This is what the conflict UI
     * renders as "A: 15.11., B: 16.11. — which do you keep?".
     */
    conflicts() {
      const out = [];
      for (const field of [...fields.keys()].sort()) {
        const state = effective(field);
        if (state.conflict) {
          out.push({
            field,
            values: state.entries.map((e) => ({ value: e.value, by: e.by, stamp: e.stamp })),
          });
        }
      }
      return out;
    },

    /**
     * Settle a conflict: write `value` as a decision that supersedes every value this peer
     * can see. Because the op records exactly which values it supersedes, the other peer
     * applies the same decision when the op arrives — one click, both clients agree.
     * @param {string} field @param {unknown} value @returns {Envelope[]}
     */
    resolve(field, value) {
      const decision = admit(field);
      const entry = fields.get(field);
      if (entry === undefined) return api.set(field, value);
      if (entry.type === 'mv' || entry.type === 'lww') {
        const currency = moneyScalarCurrency(field);
        // A human settling a conflict is still not allowed to invent a currency: resolving to
        // an amount in a currency the document does not hold would be a conversion without a
        // rate, which is the one thing FD-1 refuses outright.
        return emit(field, entry.reg.set(currency === null ? value : assertMoneyValue(field, value, currency)));
      }
      throw new PolicyError(
        `session: '${field}' is a '${entry.type}' field — it converges by its own rule; ` +
          'use add()/remove() or inc() instead of resolve()',
        { field, type: entry.type, decision },
      );
    },

    /** Policy decisions that were recorded but deliberately kept out of the truth. */
    violations() {
      return violationLog.map((v) => ({ ...v }));
    },

    /** The resolved decision for a field — a UI greys out inputs with this. */
    policyFor(field) {
      return policy.decide(field, base);
    },

    /**
     * Every op this session holds, canonically ordered, with its field. This is the wire
     * payload for a peer joining late and the shape the IndexedDB buffer of Appendix III
     * persists. Two converged peers produce byte-identical JSON here — that is the
     * convergence assertion in the tests.
     */
    ops() {
      const out = [];
      for (const [field, entry] of fields) {
        for (const op of wireOps(entry)) out.push({ field, ...op });
      }
      // Sorted by canonical JSON: no arrival order, no insertion order, one answer.
      return out
        .map((op) => ({ json: canonicalJson(op), op }))
        .sort((a, b) => (a.json < b.json ? -1 : a.json > b.json ? 1 : 0))
        .map((x) => x.op);
    },

    /**
     * Leave the Live Layer. Produces the plain Doc that gets committed to git.
     *
     * Nothing CRDT survives this call: no stamps, no tags, no node ids, no ops — just the
     * fields and their values, keys in a stable order, ready to be JSON.stringify'd into
     * `documents/<entity>/<id>.json`. That file has to open in thirty years (Principle 6),
     * and it will, because it is nothing but data.
     *
     * It refuses to produce a Doc while a conflict is unresolved. A snapshot is a FACT
     * (Appendix III); a fact cannot have two values. Silently picking one here would
     * reintroduce exactly the last-writer-wins data loss Appendix XI rules out — at the one
     * moment it becomes permanent. Call conflicts() and resolve() first.
     *
     * @returns {Doc}
     */
    snapshot() {
      const unresolved = api.conflicts();
      if (unresolved.length > 0) {
        throw new PolicyError(
          `session: cannot snapshot ${base.entity}/${base.id} — unresolved conflict on ` +
            unresolved.map((c) => `'${c.field}'`).join(', ') +
            '. Resolve it first; a fact cannot have two values.',
          { conflicts: unresolved, entity: base.entity, id: base.id },
        );
      }
      /** @type {Doc} */
      const out = /** @type {any} */ ({ id: base.id, entity: base.entity });
      for (const field of allFields()) {
        const { value } = effective(field);
        if (value !== undefined) out[field] = canonicalize(value, field);
      }
      return out;
    },

    /**
     * Be told about locally produced ops. The transport uses this; a UI uses it to show
     * "changed by A" markers. Returns an unsubscribe function.
     * @param {(ops: Envelope[]) => void} handler
     */
    onLocalOps(handler) {
      if (typeof handler !== 'function') throw new TypeError('onLocalOps: handler must be a function');
      localHandlers.push(handler);
      return () => {
        const i = localHandlers.indexOf(handler);
        if (i >= 0) localHandlers.splice(i, 1);
      };
    },

    /** The clock, so several sessions on one peer can share one logical time. */
    clock() {
      return clockInstance;
    },
  };

  return api;
}

// =======================================================================================
// The transport — loopback today, WebRTC tomorrow, same code above it
// =======================================================================================
//
// THE SEAM. This is the entire contract between the Live Layer and any network:
//
//   /** @typedef {{ id: string,
//    *              send(frame: string): void,
//    *              onFrame(handler: (frame: string) => void): void,
//    *              close(): void }} PeerLink */
//
// Three methods, and a frame is a string (`JSON.stringify(Envelope[])`). Nothing above this
// line knows about signalling, ICE, sockets, or ordering. An `RTCDataChannel` already IS this
// interface: `send` is `send`, `onFrame` is `onmessage`, `close` is `close`. Dropping WebRTC
// in means writing one `webrtcLink(channel)` adapter plus signalling — no change to session.js
// or crdt.js. A LAN gossip link, a USB stick, or a QR code would implement the same three
// methods, which is why Appendix III can promise "WebRTC or LAN gossip" without a rewrite.
//
// What the Live Layer requires of a PeerLink is deliberately almost nothing: deliver each
// frame AT LEAST ONCE, EVENTUALLY, in ANY ORDER. No exactly-once, no ordering, no
// acknowledgements, no session resumption. That is precisely what an unreliable unordered
// RTCDataChannel gives you for free — and the reason the four types in crdt.js were built
// to be commutative, associative and idempotent in the first place. The weak network
// guarantee is not a compromise; it is the design.

/**
 * Two PeerLinks wired to each other in one process, with frames queued until `flushTo()`.
 * Queuing (rather than delivering synchronously) is what lets a test reproduce a real
 * network: A and B both edit before either has heard from the other. Deterministic, no
 * timers, no `Math.random()`.
 *
 * @param {string} idA @param {string} idB
 */
export function loopbackPipe(idA, idB) {
  /** frames waiting for their recipient @type {Map<string, string[]>} */
  const inbox = new Map([
    [idA, []],
    [idB, []],
  ]);
  /** @type {Map<string, (frame: string) => void>} */
  const handlers = new Map();

  /** @param {string} self @param {string} peer */
  function endpoint(self, peer) {
    return {
      id: peer,
      send(frame) {
        if (typeof frame !== 'string') throw new TypeError('PeerLink.send: frame must be a string');
        inbox.get(peer).push(frame);
      },
      onFrame(handler) {
        handlers.set(self, handler);
      },
      close() {
        handlers.delete(self);
      },
    };
  }

  return {
    ends: { [idA]: endpoint(idA, idB), [idB]: endpoint(idB, idA) },
    pendingFor: (/** @type {string} */ id) => inbox.get(id).length,
    /** Deliver everything currently queued for `id`. @returns {number} frames delivered */
    flushTo(id) {
      const queue = inbox.get(id);
      const handler = handlers.get(id);
      if (queue === undefined || handler === undefined) return 0;
      let delivered = 0;
      while (queue.length > 0) {
        handler(queue.shift());
        delivered += 1;
      }
      return delivered;
    },
  };
}

/**
 * A loopback mesh of sessions: every joined session is linked to every other over a
 * `loopbackPipe`. This is the v0.1 answer to "propagated over WebRTC or LAN gossip"
 * (Appendix III) — the same code path, with the network replaced by an array.
 *
 * Delivery is explicit (`deliver()`), never automatic, so a test states exactly when each
 * peer learns what — including "never yet", which is how concurrency is produced.
 */
export function transport() {
  /** nodeId -> session @type {Map<string, any>} */
  const members = new Map();
  /** "A|B" -> pipe @type {Map<string, ReturnType<typeof loopbackPipe>>} */
  const pipes = new Map();
  /** peers that are currently unreachable @type {Set<string>} */
  const offline = new Set();

  /** @param {string} a @param {string} b */
  function pipeKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** Every link belonging to `nodeId`. */
  function linksOf(nodeId) {
    const out = [];
    for (const other of members.keys()) {
      if (other === nodeId) continue;
      const pipe = pipes.get(pipeKey(nodeId, other));
      if (pipe) out.push(pipe.ends[nodeId]);
    }
    return out;
  }

  return {
    /**
     * Attach a session to the mesh. Its local ops broadcast to every other member; every
     * member's ops arrive at it. A joiner also exchanges its existing ops both ways, so a
     * peer that was offline for a week catches up on reconnect with no special protocol —
     * ops are idempotent, so resending everything is always safe.
     * @param {ReturnType<typeof session>} peer
     */
    join(peer) {
      const nodeId = peer.nodeId;
      if (members.has(nodeId)) throw new Error(`transport: '${nodeId}' has already joined`);

      for (const other of members.keys()) {
        const pipe = loopbackPipe(nodeId, other);
        pipes.set(pipeKey(nodeId, other), pipe);
        // Each side turns frames back into ops. This is the real receive path.
        pipe.ends[nodeId].onFrame((frame) => peer.receive(JSON.parse(frame)));
        pipe.ends[other].onFrame((frame) => members.get(other).receive(JSON.parse(frame)));
      }
      members.set(nodeId, peer);

      peer.onLocalOps((ops) => {
        const frame = JSON.stringify(ops);
        for (const link of linksOf(nodeId)) link.send(frame);
      });

      // Catch-up in both directions.
      const mine = peer.ops();
      for (const other of members.keys()) {
        if (other === nodeId) continue;
        const pipe = pipes.get(pipeKey(nodeId, other));
        if (mine.length > 0) pipe.ends[nodeId].send(JSON.stringify(mine));
        const theirs = members.get(other).ops();
        if (theirs.length > 0) pipe.ends[other].send(JSON.stringify(theirs));
      }
      return { nodeId, links: () => linksOf(nodeId) };
    },

    /**
     * Deliver everything that can be delivered. Peers marked offline keep their frames
     * queued until they rejoin — nothing is dropped.
     * @returns {number} frames delivered
     */
    deliver() {
      let total = 0;
      for (;;) {
        let round = 0;
        for (const nodeId of members.keys()) {
          if (offline.has(nodeId)) continue;
          for (const other of members.keys()) {
            if (other === nodeId) continue;
            const pipe = pipes.get(pipeKey(nodeId, other));
            if (pipe) round += pipe.flushTo(nodeId);
          }
        }
        if (round === 0) return total;
        total += round;
      }
    },

    /** Frames still in flight (to offline peers, or not yet delivered). */
    pending() {
      let total = 0;
      for (const nodeId of members.keys()) {
        for (const other of members.keys()) {
          if (other === nodeId) continue;
          const pipe = pipes.get(pipeKey(nodeId, other));
          if (pipe) total += pipe.pendingFor(nodeId);
        }
      }
      return total;
    },

    /** Simulate a partition: this peer stops receiving until rejoin(). */
    isolate(nodeId) {
      if (!members.has(nodeId)) throw new Error(`transport: unknown peer '${nodeId}'`);
      offline.add(nodeId);
    },
    /** End the partition. The queued frames are still there. */
    rejoin(nodeId) {
      offline.delete(nodeId);
    },
    peers() {
      return [...members.keys()].sort();
    },
  };
}

/**
 * Do two or more sessions hold the same state? Byte-identical op sets *and* byte-identical
 * snapshots. Exported because it is the assertion the whole Live Layer stands on, and a
 * kernel or a UI may want to check it too.
 * @param {ReturnType<typeof session>[]} peers
 */
export function converged(peers) {
  if (peers.length < 2) return true;
  const first = JSON.stringify(peers[0].ops());
  return peers.every((p) => JSON.stringify(p.ops()) === first);
}

/** Re-exported so callers need one import for the whole Live Layer. */
export { compareStamps };
