// runtime/live/crdt.js — the four CRDT types the manifesto names. No fifth one.
//
// Manifesto Appendix III, lines 120-125:
//   * G-Counter / PN-Counter   for monotonic counters (stock additions, revenue)
//   * LWW-Register (with HLC)  for simple fields
//   * OR-Set (Observed-Remove) for sets
//   * Multi-Value-Register     for fields where conflicts must be made explicit
//
// And line 129: "The CRDT logic in the NeoDonkey repo is small enough that any auditor, IT
// security lead, or customer can read and understand it." That line is a design constraint,
// not marketing. Every type below is written to be read once, top to bottom, and believed.
// Where there was a choice between clever and obvious, this file takes obvious.
//
// THE PROPERTY THAT MATTERS (proven in test/d-live.test.js):
//
//   merge is COMMUTATIVE   merge(a, b) == merge(b, a)
//   merge is ASSOCIATIVE   merge(merge(a, b), c) == merge(a, merge(b, c))
//   merge is IDEMPOTENT    merge(a, a) == a
//
// Those three lines are the whole reason there is no server. If they hold, peers may receive
// ops in any order, twice, late, or in bursts after a week offline, and still end up with
// byte-identical state. If any one of them fails, we need a coordinator — and Principle 2
// forbids one. So they are tested as a property over randomized histories, not by example.
//
// How each type gets there, in one line each:
//   pnCounter    every op carries the author's RUNNING TOTAL, so replay is a no-op
//   lwwRegister  keep the op with the greatest HLC stamp; a total order has no ties
//   orSet        two grow-only sets (add-tags, removed-tags); union never un-decides
//   mvRegister   grow-only set of writes; a write only hides writes it actually observed
//
// Ops are plain JSON data — that is the wire format, the IndexedDB buffer format, and what
// a human sees when debugging. Every op is normalized on the way in (fixed key order,
// validated shape), so two converged peers serialize to the same bytes.
//
// MONEY (FD-1). A PN-Counter over money is the same type with a different value domain:
// exact BigInt minor units instead of a JS number, and the currency as part of the counter's
// IDENTITY rather than of its value. All monetary arithmetic below is delegated to
// runtime/money/ — this file owns convergence, that module owns money, and neither
// reimplements the other. See the "money mode" section inside pnCounter().
//
// No imports except our own clock and the money module. No node:*. Loads in a browser as-is.

import { compareStamps, stampId, assertStamp } from './hlc.js';
import {
  money,
  toString as moneyToString,
  add as moneyAdd,
  subtract as moneySubtract,
  compare as moneyCompare,
  isNegative as moneyIsNegative,
  zero as moneyZero,
  scaleOf,
  MoneyError,
} from '../money/money.js';

/** @typedef {import('./hlc.js').Stamp} Stamp */
/** @typedef {{ type:'pn'|'lww'|'orset'|'mv' } & Record<string, unknown>} Op */

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------

/**
 * Deep-copy a value into canonical form: object keys sorted, arrays kept in order.
 *
 * Two jobs at once:
 *   1. determinism — two peers holding the same value serialize to the same bytes, which is
 *      what "byte-identical state" in the tests actually checks, and what keeps git diffs
 *      honest (Principle 6: plain readable JSON that still opens in thirty years);
 *   2. a gate — anything that is not plain JSON is refused here, loudly, at the boundary.
 *      A Date, a Map, a NaN or an `undefined` sliding into a CRDT op would come back out of
 *      git in thirty years as something else. Refusing beats guessing.
 *
 * @param {unknown} value
 * @param {string} [path] for error messages
 * @returns {unknown} a fresh canonical copy
 */
export function canonicalize(value, path = 'value') {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`crdt: ${path} must be a finite number, got ${String(value)}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => canonicalize(v, `${path}[${i}]`));
  }
  if (t === 'object') {
    // Plain objects only. Class instances (Date, Map, Set, ...) are refused: they have no
    // stable JSON meaning, and this format has to survive decades.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(
        `crdt: ${path} must be plain JSON (no class instances). Use an ISO-8601 string for dates.`,
      );
    }
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(/** @type {object} */ (value)).sort()) {
      const v = /** @type {Record<string, unknown>} */ (value)[key];
      if (v === undefined) {
        throw new TypeError(`crdt: ${path}.${key} is undefined — omit the key instead`);
      }
      out[key] = canonicalize(v, `${path}.${key}`);
    }
    return out;
  }
  throw new TypeError(`crdt: ${path} must be plain JSON, got ${t}`);
}

/**
 * The canonical JSON text of a value. Used as an element identity in the OR-Set and to sort
 * collections deterministically.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Accept the one thing all four types need: something that can mint stamps.
 *
 * Either an `hlc()` instance (preferred — it also learns from remote stamps, which is how
 * causality survives) or a bare `() => Stamp` function (enough for tests and for a peer that
 * only ever reads).
 *
 * @param {{ now(): Stamp, observe?(s: Stamp): void } | (() => Stamp)} source
 */
function stampSource(source) {
  if (typeof source === 'function') {
    return { now: () => source(), observe: () => {} };
  }
  if (source && typeof source.now === 'function') {
    return {
      now: () => source.now(),
      observe: (/** @type {Stamp} */ s) => {
        if (typeof source.observe === 'function') source.observe(s);
      },
    };
  }
  throw new TypeError(
    'crdt: a stamp source is required — an hlc(nodeId, clock) instance or a () => Stamp function',
  );
}

/** @param {unknown} op @param {string} type */
function assertOpType(op, type) {
  if (op === null || typeof op !== 'object') {
    throw new TypeError(`crdt: op must be an object, got ${String(op)}`);
  }
  if (/** @type {any} */ (op).type !== type) {
    throw new TypeError(`crdt: expected a '${type}' op, got '${/** @type {any} */ (op).type}'`);
  }
}

// ---------------------------------------------------------------------------------------
// 1. PN-Counter — stock, revenue, quantities
// ---------------------------------------------------------------------------------------

/**
 * A PN-Counter: one monotonic increment register and one monotonic decrement register per
 * node. The value is sum(plus) - sum(minus) across all nodes.
 *
 * THE IDEMPOTENCE DECISION, stated plainly because it is a business decision, not a technical
 * one: an op does NOT carry a delta ("+5"). It carries the author's running totals so far
 * ("A has now added 12 and removed 2 in total"). Consequences:
 *
 *   * delivering the same op twice changes nothing — a duplicated goods receipt cannot
 *     double stock. With deltas, one retransmitted packet is real inventory loss;
 *   * ops may arrive out of order or be lost entirely — a later op from the same node
 *     supersedes every earlier one, so the total is still exact;
 *   * merging is "take the newest op per node", which is trivially commutative,
 *     associative and idempotent.
 *
 * The price: we cannot reconstruct the individual movements from the live ops. That is
 * correct by Appendix III — the 200 intermediate ops are irrelevant to eternity; the
 * individual movements are facts and belong in the Truth Layer as commits, not here.
 *
 * ------------------------------------------------------------------------------------------
 * MONEY MODE — `pnCounter(clock, { currency: 'EUR' })`
 * ------------------------------------------------------------------------------------------
 *
 * The manifesto assigns "stock additions, revenue" to this type (Appendix III line 123), and
 * revenue is money. Under FD-1 a monetary value is the token `"10.00 EUR"`, so a counter that
 * demands `Number.isFinite` cannot hold one at all. In money mode:
 *
 *   * `plus` and `minus` are canonical FD-1 tokens on the wire — plain JSON strings, so the
 *     op stream still survives `JSON.stringify`, an IndexedDB buffer and thirty years. A
 *     `BigInt` cannot be serialized to JSON; a token can, byte-exactly (Principle 6);
 *   * every arithmetic step goes through runtime/money/, i.e. BigInt minor units. **No
 *     `Number` touches a monetary value anywhere on this path** (FD-1, and test/d-live's
 *     grep guard keeps it true);
 *   * `value()` returns a canonical token, never a number.
 *
 * WHY EXACT ARITHMETIC IS NOT A ROUNDING PREFERENCE HERE. Floating-point addition is not
 * associative: (0.1 + 0.2) + 0.3 = 0.6000000000000001 while 0.3 + (0.2 + 0.1) = 0.6. Agent
 * COLUMN found the read-path twin of this: a *query plan change* altered a reported total. A
 * CRDT is worse, because it merges in arbitrary order **by construction** — so a float
 * counter does not merely round badly, it converges to DIFFERENT TOTALS ON DIFFERENT PEERS
 * depending on the order the network happened to deliver in. With BigInt minor units,
 * addition is associative and commutative, so the three merge properties above hold for the
 * value as well as for the op set. That is this file's justification for FD-1, and it is
 * tested by name in test/d-live.test.js.
 *
 * WHY CURRENCY IS IDENTITY, NOT VALUE. A counter is created *in* a currency and refuses
 * everything else. It cannot convert (FD-1: conversion is a modelled act carrying its rate
 * and date, and a converted amount without its rate is unauditable), and it must not pick
 * (a silent pick between `10.00 EUR` and `10.00 USD` is a fabricated amount in a ledger). So
 * a foreign-currency op is refused with `MoneyError('currency-mismatch')` — never merged,
 * never converted. The refusal is deterministic and identical on every peer, because the
 * currency comes from the committed document both peers loaded from git HEAD (see
 * session.js, `moneyScalarCurrency`), not from whoever happened to write first.
 *
 * @param {{ now(): Stamp, observe?(s: Stamp): void } | (() => Stamp)} source
 * @param {{ currency?: string }} [options] money mode when `currency` is given
 */
export function pnCounter(source, options = {}) {
  const clock = stampSource(source);
  const currency = counterCurrency(options);
  /** node -> its newest op @type {Map<string, any>} */
  const byNode = new Map();
  /** The zero of this counter: `0` for a plain counter, `"0.00 EUR"` for a money one. */
  const ZERO = currency === null ? 0 : moneyToString(moneyZero(currency));

  /** Fixed key order + validation, so identical state serializes to identical bytes. */
  function normalize(op) {
    assertOpType(op, 'pn');
    const { node, seq, plus, minus } = /** @type {any} */ (op);
    if (typeof node !== 'string' || node.length === 0) {
      throw new TypeError('pnCounter: op.node must be a non-empty string');
    }
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
      // A sequence number is a count of ops, not a monetary value — an integer is right here.
      throw new TypeError(`pnCounter: op.seq must be a non-negative integer, got ${String(seq)}`);
    }
    if (currency !== null) {
      return {
        type: 'pn',
        node,
        seq,
        plus: normalizeTotal('plus', plus),
        minus: normalizeTotal('minus', minus),
      };
    }
    for (const [name, n] of [['plus', plus], ['minus', minus]]) {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new TypeError(`pnCounter: op.${name} must be a finite number, got ${String(n)}`);
      }
      if (n < 0) throw new TypeError(`pnCounter: op.${name} must not be negative, got ${n}`);
    }
    return { type: 'pn', node, seq, plus, minus };
  }

  /**
   * A monetary quantity on this counter: a canonical FD-1 token in THIS counter's currency.
   * `money()` is the only parser — an off-spec spelling like `"10.0 EUR"`, a `Number` or a
   * foreign currency is refused there or here, each with its own stable error code.
   * @param {string} name @param {unknown} raw
   */
  function normalizeMoney(name, raw) {
    if (typeof raw !== 'string') {
      throw new MoneyError(
        'not-a-string',
        `pnCounter: ${name} on a ${currency} counter must be a canonical money token like ` +
          `"10.00 ${currency}", got ${raw === null ? 'null' : typeof raw}. A monetary value is never a Number (FD-1).`,
      );
    }
    const amount = money(raw);
    if (amount.currency !== currency) {
      throw new MoneyError(
        'currency-mismatch',
        `pnCounter: this counter is denominated in ${currency}; ${name} is ${raw}. ` +
          'Mixed currencies never combine silently (FD-1) — convert explicitly, on the document, with the rate and its date.',
      );
    }
    return moneyToString(amount);
  }

  /**
   * A running TOTAL: the same, plus the invariant that the plus and minus registers are
   * magnitudes and therefore never negative. A negative running total means a corrupt op or
   * two peers sharing a node id, and it must not be averaged out into a plausible number.
   * @param {string} name @param {unknown} raw
   */
  function normalizeTotal(name, raw) {
    const token = normalizeMoney(`op.${name}`, raw);
    if (moneyIsNegative(token)) {
      throw new MoneyError(
        'negative-total',
        `pnCounter: op.${name} is a running total and can never be negative, got ${token}`,
      );
    }
    return token;
  }

  /**
   * Strictly-less-than on a running total, exact in both modes.
   *
   * On money this is `compare()` over BigInt minor units — **never** a comparison of the
   * token strings, because lexically `"9.00 EUR" > "10.00 EUR"` and a monotonicity check that
   * believed that would reject honest ops and accept corrupt ones.
   */
  function decreased(next, prev) {
    return currency === null ? next < prev : moneyCompare(next, prev) < 0;
  }

  function integrate(op) {
    const prev = byNode.get(op.node);
    if (prev === undefined) {
      byNode.set(op.node, op);
      return;
    }
    if (op.seq > prev.seq) {
      // Per-node registers are monotonic by construction. If they are not, the peer is
      // broken or two peers share a node id — say so instead of computing a wrong total.
      if (decreased(op.plus, prev.plus) || decreased(op.minus, prev.minus)) {
        throw new Error(
          `pnCounter: non-monotonic op from node '${op.node}' (seq ${prev.seq} -> ${op.seq}). ` +
            'Two peers sharing one node id, or a corrupted op.',
        );
      }
      byNode.set(op.node, op);
      return;
    }
    if (op.seq === prev.seq) {
      // The duplicate-delivery case. Must be a genuine no-op, and must be the SAME op.
      // Canonical tokens compare exactly with ===: one amount has exactly one spelling.
      if (op.plus !== prev.plus || op.minus !== prev.minus) {
        throw new Error(
          `pnCounter: two different ops from node '${op.node}' with seq ${op.seq}. Duplicate node id?`,
        );
      }
      return;
    }
    // op.seq < prev.seq: stale, already superseded. Dropping it is what makes late
    // delivery harmless.
  }

  return {
    /**
     * This counter's currency, or `null` for a plain-number counter. A session needs it to
     * know which kind of movement a field accepts.
     * @returns {string|null}
     */
    currency() {
      return currency;
    },

    /**
     * Record a local movement. `delta` may be negative (a withdrawal).
     *
     * Plain mode: a finite number. Money mode: a canonical token (`"-8.00 EUR"` for a
     * write-off) or a `Money`. A number on a money counter is refused, loudly — that is the
     * single most important line of FD-1 as it applies to the Live Layer.
     *
     * @param {number|string|{minor: bigint, currency: string}} delta
     * @returns {Op[]} the op(s) to broadcast
     */
    inc(delta) {
      const node = clock.now().node;
      const prev = byNode.get(node) ?? { seq: 0, plus: ZERO, minus: ZERO };
      if (currency !== null) {
        // `normalizeMoney` re-parses through money(), so an off-spec delta never gets this
        // far; `moneyToString` refuses a Number first, with FD-1's own error code.
        const amount = normalizeMoney('delta', typeof delta === 'string' ? delta : moneyToString(delta));
        const negative = moneyIsNegative(amount);
        const op = normalize({
          type: 'pn',
          node,
          seq: prev.seq + 1,
          plus: negative ? prev.plus : moneyToString(moneyAdd(prev.plus, amount)),
          // minus − (a negative delta) is minus + |delta|, exactly, with no negate() step.
          minus: negative ? moneyToString(moneySubtract(prev.minus, amount)) : prev.minus,
        });
        integrate(op);
        return [op];
      }
      if (typeof delta !== 'number' || !Number.isFinite(delta)) {
        throw new TypeError(`pnCounter: delta must be a finite number, got ${String(delta)}`);
      }
      const op = normalize({
        type: 'pn',
        node,
        seq: prev.seq + 1,
        plus: prev.plus + (delta > 0 ? delta : 0),
        minus: prev.minus + (delta < 0 ? -delta : 0),
      });
      integrate(op);
      return [op];
    },

    /** @param {Op} op */
    apply(op) {
      integrate(normalize(op));
    },

    /** @param {Op[]} otherOps */
    merge(otherOps) {
      for (const op of otherOps) integrate(normalize(op));
    },

    /**
     * The counter's value: a number in plain mode, a canonical FD-1 token in money mode.
     *
     * Nodes are summed in sorted order rather than in arrival order. For BigInt minor units
     * the order cannot matter (integer addition is associative), and that is the point —
     * this line was a latent defect in the plain-number counter, where `byNode.values()`
     * iterates in ARRIVAL order and float addition is not associative, so two peers holding
     * the identical op set could report different totals. Sorting removes the dependence;
     * only money mode removes the inexactness.
     *
     * @returns {number|string}
     */
    value() {
      const nodes = [...byNode.keys()].sort();
      if (currency !== null) {
        let total = moneyZero(currency);
        for (const node of nodes) {
          const op = byNode.get(node);
          total = moneyAdd(total, moneySubtract(op.plus, op.minus));
        }
        return moneyToString(total);
      }
      let total = 0;
      for (const node of nodes) {
        const op = byNode.get(node);
        total += op.plus - op.minus;
      }
      return total;
    },

    /** Canonical order (by node) so two converged peers serialize identically. */
    ops() {
      return [...byNode.keys()].sort().map((node) => ({ ...byNode.get(node) }));
    },
  };
}

/**
 * Validate the options bag of `pnCounter` and return its currency, or `null` for a plain
 * counter. An unknown option key is refused rather than ignored: a silently dropped
 * `{ currncy: 'EUR' }` would produce a float counter on a money field, which is the exact
 * defect FD-1 exists to prevent.
 * @param {{ currency?: string }} options
 * @returns {string|null}
 */
function counterCurrency(options) {
  if (options === undefined || options === null) return null;
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('pnCounter: options must be a plain object, e.g. { currency: "EUR" }');
  }
  for (const key of Object.keys(options)) {
    if (key !== 'currency') {
      throw new TypeError(`pnCounter: unknown option '${key}' (the only option is 'currency')`);
    }
  }
  const currency = options.currency;
  if (currency === undefined || currency === null) return null;
  scaleOf(currency); // throws MoneyError on an unknown or malformed ISO 4217 code
  return currency;
}

// ---------------------------------------------------------------------------------------
// 2. LWW-Register — simple fields, converge silently
// ---------------------------------------------------------------------------------------

/**
 * A Last-Writer-Wins register ordered by HLC stamp.
 *
 * Use it where silent convergence is the right business answer: a cosmetic field, a cached
 * label, a quantity someone is scrubbing up and down. Where losing the loser's value would
 * be data loss a human must see, use mvRegister instead — that choice is made by policy in
 * session.js, not here.
 *
 * "Last" means greatest in the HLC total order, and that order has no ties (the node id is
 * the final tiebreaker), so every peer picks the same winner without asking anyone.
 *
 * @param {{ now(): Stamp, observe?(s: Stamp): void } | (() => Stamp)} source
 */
export function lwwRegister(source) {
  const clock = stampSource(source);
  /** @type {{type:'lww', value:unknown, stamp:Stamp}|null} */
  let current = null;

  function normalize(op) {
    assertOpType(op, 'lww');
    const { value, stamp } = /** @type {any} */ (op);
    assertStamp(stamp);
    return {
      type: 'lww',
      value: canonicalize(value, 'op.value'),
      stamp: { wall: stamp.wall, counter: stamp.counter, node: stamp.node },
    };
  }

  function integrate(op) {
    clock.observe(op.stamp);
    if (current === null) {
      current = op;
      return;
    }
    const order = compareStamps(op.stamp, current.stamp);
    if (order > 0) {
      current = op;
    } else if (order === 0 && canonicalJson(op.value) !== canonicalJson(current.value)) {
      throw new Error(
        `lwwRegister: two different values with the same stamp ${stampId(op.stamp)}. Duplicate node id?`,
      );
    }
    // order < 0, or an exact duplicate: nothing changes. That is idempotence.
  }

  return {
    /** @param {unknown} value @returns {Op[]} */
    set(value) {
      const op = normalize({ type: 'lww', value, stamp: clock.now() });
      integrate(op);
      return [op];
    },
    /** @param {Op} op */
    apply(op) {
      integrate(normalize(op));
    },
    /** @param {Op[]} otherOps */
    merge(otherOps) {
      for (const op of otherOps) integrate(normalize(op));
    },
    /** @returns {unknown} undefined if never written */
    value() {
      return current === null ? undefined : canonicalize(current.value);
    },
    /** Who wrote the current value, or null. */
    author() {
      return current === null ? null : current.stamp.node;
    },
    ops() {
      return current === null ? [] : [{ ...current, stamp: { ...current.stamp } }];
    },
  };
}

// ---------------------------------------------------------------------------------------
// 3. OR-Set — Observed-Remove Set
// ---------------------------------------------------------------------------------------

/**
 * An Observed-Remove Set: line items, tags, batch numbers, assigned pickers.
 *
 * Every `add` mints a unique TAG. A `remove` does not say "this element is gone", it says
 * "these specific tags I have seen are gone". An element is in the set while it has at least
 * one tag nobody has removed.
 *
 * That rule is the whole point, and it is deliberately NOT timestamp-based:
 *
 *   A removes "batch-77" (killing tag t1, the only one it has seen)
 *   B, concurrently, re-adds "batch-77" (minting tag t2 — A has never seen t2)
 *   => after merge, "batch-77" is IN the set, because t2 was never removed.
 *
 * A wall-clock or LWW rule would let A's removal, if it happened to sort later, silently
 * erase a batch B had just booked in. The observed-tags rule cannot do that: you can only
 * undo what you actually saw. Both delivery orders give the same answer — tested.
 *
 * Both internal sets only ever grow, so merge is union: commutative, associative, idempotent
 * by construction.
 *
 * @param {{ now(): Stamp, observe?(s: Stamp): void } | (() => Stamp)} source
 */
export function orSet(source) {
  const clock = stampSource(source);
  /** elementKey -> (tag -> element) @type {Map<string, Map<string, unknown>>} */
  const added = new Map();
  /** every tag anybody has removed @type {Set<string>} */
  const removed = new Set();

  function normalize(op) {
    assertOpType(op, 'orset');
    const raw = /** @type {any} */ (op);
    const element = canonicalize(raw.element, 'op.element');
    if (raw.action === 'add') {
      if (typeof raw.tag !== 'string' || raw.tag.length === 0) {
        throw new TypeError('orSet: add op needs a non-empty string tag');
      }
      return { type: 'orset', action: 'add', element, tag: raw.tag };
    }
    if (raw.action === 'remove') {
      if (!Array.isArray(raw.tags) || raw.tags.some((t) => typeof t !== 'string' || !t)) {
        throw new TypeError('orSet: remove op needs a tags array of non-empty strings');
      }
      // Sorted + deduplicated: the same removal always serializes to the same bytes.
      return { type: 'orset', action: 'remove', element, tags: [...new Set(raw.tags)].sort() };
    }
    throw new TypeError(`orSet: unknown action '${raw.action}' (expected 'add' or 'remove')`);
  }

  function integrate(op) {
    const key = canonicalJson(op.element);
    if (op.action === 'add') {
      if (!added.has(key)) added.set(key, new Map());
      added.get(key).set(op.tag, op.element);
    } else {
      for (const tag of op.tags) removed.add(tag);
    }
  }

  /** The tags for this element that this peer has actually observed. */
  function observedTags(key) {
    return [...(added.get(key)?.keys() ?? [])];
  }

  return {
    /** @param {unknown} element @returns {Op[]} */
    add(element) {
      const op = normalize({
        type: 'orset',
        action: 'add',
        element,
        tag: stampId(clock.now()),
      });
      integrate(op);
      return [op];
    },

    /**
     * Remove exactly the tags this peer has observed. If it has observed none, there is
     * nothing to remove and no op is produced — you cannot un-add what you never saw.
     * @param {unknown} element @returns {Op[]}
     */
    remove(element) {
      const key = canonicalJson(element);
      const tags = observedTags(key);
      if (tags.length === 0) return [];
      const op = normalize({ type: 'orset', action: 'remove', element, tags });
      integrate(op);
      return [op];
    },

    /** @param {Op} op */
    apply(op) {
      integrate(normalize(op));
    },
    /** @param {Op[]} otherOps */
    merge(otherOps) {
      for (const op of otherOps) integrate(normalize(op));
    },

    /** @param {unknown} element */
    has(element) {
      const key = canonicalJson(element);
      return observedTags(key).some((tag) => !removed.has(tag));
    },

    /**
     * The set's members, sorted by their canonical JSON so that every peer produces the
     * same array in the same order (and so git diffs stay readable).
     * @returns {unknown[]}
     */
    value() {
      const out = [];
      for (const key of [...added.keys()].sort()) {
        const tags = added.get(key);
        for (const [tag, element] of tags) {
          if (!removed.has(tag)) {
            out.push(canonicalize(element));
            break;
          }
        }
      }
      return out;
    },

    /** Canonical order: adds first (by element, then tag), then removes (by element). */
    ops() {
      const out = [];
      for (const key of [...added.keys()].sort()) {
        for (const tag of [...added.get(key).keys()].sort()) {
          out.push({ type: 'orset', action: 'add', element: canonicalize(added.get(key).get(tag)), tag });
        }
      }
      // Removed tags are collapsed into one op per element: the union of removed tags for
      // elements we know, plus one op for tags whose element we have never seen (so the
      // removal is not lost if we later learn the add).
      /** @type {Map<string, string[]>} */
      const byElement = new Map();
      const orphans = [];
      for (const tag of [...removed].sort()) {
        let owner = null;
        for (const [key, tags] of added) {
          if (tags.has(tag)) {
            owner = key;
            break;
          }
        }
        if (owner === null) orphans.push(tag);
        else {
          if (!byElement.has(owner)) byElement.set(owner, []);
          byElement.get(owner).push(tag);
        }
      }
      for (const key of [...byElement.keys()].sort()) {
        const anyTag = byElement.get(key)[0];
        const element = canonicalize(added.get(key).get(anyTag));
        out.push({ type: 'orset', action: 'remove', element, tags: byElement.get(key).sort() });
      }
      if (orphans.length > 0) {
        // We know the tags but not what they pointed at. `null` is a placeholder element:
        // the tags are what matters for convergence, the element only for readability.
        out.push({ type: 'orset', action: 'remove', element: null, tags: orphans.sort() });
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------------------
// 4. Multi-Value Register — conflicts made explicit
// ---------------------------------------------------------------------------------------

/**
 * A Multi-Value Register: the type for fields where a conflict must be shown to a human
 * rather than resolved behind their back. Appendix XI's 5% case:
 *
 *   "A: 15.11., B: 16.11. — which do you keep?" ... No silent data loss, no last-writer-wins.
 *
 * Mechanism, deliberately the same idea as the OR-Set so there is one concept to audit and
 * not two: every write is an op, kept forever in a grow-only set. A write records which
 * writes it OBSERVED at the time (`overwrites`). A write is *live* if no other write
 * observed it.
 *
 *   sequential writes  -> the second observed the first, so one live value (behaves as LWW)
 *   concurrent writes  -> neither observed the other, so BOTH stay live -> a conflict
 *   a resolution       -> observes both, so it supersedes both, on every peer
 *
 * The live set is never empty once anything has been written: a write can only observe stamps
 * smaller than its own (the HLC guarantees that), so the greatest stamp is never overwritten.
 *
 * @param {{ now(): Stamp, observe?(s: Stamp): void } | (() => Stamp)} source
 */
export function mvRegister(source) {
  const clock = stampSource(source);
  /** op id -> op @type {Map<string, any>} */
  const writes = new Map();
  /** op ids that some write has observed and superseded @type {Set<string>} */
  const overwritten = new Set();

  function normalize(op) {
    assertOpType(op, 'mv');
    const raw = /** @type {any} */ (op);
    assertStamp(raw.stamp);
    if (!Array.isArray(raw.overwrites) || raw.overwrites.some((id) => typeof id !== 'string' || !id)) {
      throw new TypeError('mvRegister: op.overwrites must be an array of non-empty op id strings');
    }
    return {
      type: 'mv',
      value: canonicalize(raw.value, 'op.value'),
      stamp: { wall: raw.stamp.wall, counter: raw.stamp.counter, node: raw.stamp.node },
      overwrites: [...new Set(raw.overwrites)].sort(),
    };
  }

  function integrate(op) {
    clock.observe(op.stamp);
    const id = stampId(op.stamp);
    const existing = writes.get(id);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(op)) {
        throw new Error(`mvRegister: two different writes with the same stamp ${id}. Duplicate node id?`);
      }
      // Exact duplicate: idempotent, nothing to do.
    } else {
      writes.set(id, op);
    }
    for (const superseded of op.overwrites) overwritten.add(superseded);
  }

  function liveIds() {
    return [...writes.keys()].filter((id) => !overwritten.has(id));
  }

  /** Live writes, in HLC order. Deterministic on every peer. */
  function liveWrites() {
    return liveIds()
      .map((id) => writes.get(id))
      .sort((a, b) => compareStamps(a.stamp, b.stamp));
  }

  return {
    /**
     * Write a value, superseding every value this peer can currently see. If another peer
     * writes concurrently, both survive and `entries()` reports both.
     * @param {unknown} value @returns {Op[]}
     */
    set(value) {
      const op = normalize({
        type: 'mv',
        value,
        stamp: clock.now(),
        overwrites: liveIds(),
      });
      integrate(op);
      return [op];
    },

    /** @param {Op} op */
    apply(op) {
      integrate(normalize(op));
    },
    /** @param {Op[]} otherOps */
    merge(otherOps) {
      for (const op of otherOps) integrate(normalize(op));
    },

    /** All live values, in HLC order. One entry = agreement, more than one = conflict. */
    value() {
      return liveWrites().map((op) => canonicalize(op.value));
    },

    /** Live values with their author and stamp — this is what a conflict UI renders. */
    entries() {
      return liveWrites().map((op) => ({
        value: canonicalize(op.value),
        by: op.stamp.node,
        stamp: { ...op.stamp },
      }));
    },

    /** True when two or more writes are concurrent and unresolved. */
    conflicted() {
      return liveIds().length > 1;
    },

    /** Canonical order: by stamp. */
    ops() {
      return [...writes.values()]
        .sort((a, b) => compareStamps(a.stamp, b.stamp))
        .map((op) => ({ ...op, stamp: { ...op.stamp }, overwrites: [...op.overwrites] }));
    },
  };
}
