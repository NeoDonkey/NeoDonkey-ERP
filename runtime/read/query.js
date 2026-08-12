/**
 * runtime/read/query.js — the tiny declarative query language of the read path.
 *
 * Design rules (from docs/CONTRACT.md, the manifesto, and ROADMAP-V1 Part 1):
 *  - Zero dependencies, no `node:*`. Runs unchanged in Node 22+ and in the browser.
 *  - No `Date.now()`, no `Math.random()`. Nothing here is time- or randomness-dependent.
 *  - Deterministic to the last row: every result order is a *total* order. Ties are broken
 *    by document id, always ascending. A report that reorders itself between two runs is a
 *    bug, not a nuance.
 *  - Principle 6 (never silently guess): an unknown query key or an unknown operator is
 *    refused loudly with `QueryError`. It is never ignored and never approximated.
 *  - **FD-1**: a monetary value is the string `"4999.99 EUR"`, compared and summed as `BigInt`
 *    minor units. No `Number` touches one, and mixed currencies refuse to add.
 *  - This module knows nothing about git, about the index internals, or about how documents
 *    were decrypted. It talks to a `Source`. That is the Principle 3 seam: SQLite-WASM can
 *    implement it behind the same signature later.
 *
 * ## The Source, and the line between "which rows" and "which rows match"
 *
 * A `Source` must provide `all(entity)` and `get(entity, id)`. It *may* additionally provide
 * `candidates()` and `fastAggregate()`, which is how the secondary indexes get used. The division
 * is absolute and it is what makes indexing safe:
 *
 *   * `candidates()` answers **which rows are worth looking at**. It may return a superset. It may
 *     return `null`, meaning "scan everything".
 *   * this file alone answers **which rows match**, by re-applying every predicate to every
 *     candidate, always.
 *
 * So the indexed and unindexed paths cannot disagree — not by construction of the index, but by
 * construction of the pipeline. `test/e-read.test.js` asserts it over randomised queries anyway,
 * because a property you have not tested is a property you hope for.
 *
 * @typedef {{ all(entity: string): readonly object[], get(entity: string, id: string): object|null,
 *             scan?(entity: string): readonly object[],
 *             candidates?(entity: string, specs: object): {docs: object[], plan: string}|null,
 *             fastAggregate?(shape: object): {value: unknown}|null }} Source
 *
 * @typedef {{ op: string, value?: unknown }} OpSpec
 *
 * @typedef {{ as: string, from: string, on: string, required?: boolean }} Join
 *   A *semi-join* through a reference field. `on` names a field on the `from` document that
 *   holds the id of a document of entity `Join.from`. The peer document is brought into scope
 *   under the name `as`, addressable in `where` / `orderBy` / `groupBy` / `sum` as `as.field`.
 *   Result rows are always documents of the outer `from` — a join never changes the row shape.
 *   `required` defaults to true (inner join): a row whose reference does not resolve is dropped.
 *   With `required: false` the alias fields simply read as `undefined` (left join).
 *
 * @typedef {{ from: string, join?: Join|Join[],
 *             where?: Record<string, unknown|OpSpec>,
 *             orderBy?: string, desc?: boolean, limit?: number,
 *             sum?: string, count?: boolean, groupBy?: string }} Query
 */


// ===========================================================================
// PART 1 — FD-1 money, as the read path needs to *recognise* it
//
// FD-1 (ROADMAP-V1 Part 1) is binding: a monetary value is one string token — optional `-`, digits
// with no leading zero, optional `.` followed by exactly the minor-unit digits ISO 4217 assigns
// that currency, a single space, the alphabetic code. `"4999.99 EUR"`. Arithmetic is `BigInt` minor
// units. **No `Number` ever touches a monetary value.**
//
// **`runtime/money/` (agent M) is the authority, and this section is an adapter to it, not a second
// implementation.** Everything normative comes from there: the ISO 4217 scale table is M's
// `CURRENCIES`, the canonical output is M's `toString(fromMinor(...))`, and an unknown currency code
// is refused exactly as M refuses it. `test/e-read.test.js` contains a *conformance* test that runs
// M's `money()` and this recogniser over the same token table and asserts they accept, reject and
// decode identically — including for randomly generated tokens. If they ever diverge, that test
// fails rather than a report being quietly wrong.
//
// So why an adapter at all, rather than calling `money(v)` directly? Because the read path has to
// answer "is this arbitrary field value a monetary token?" for **every string value of every
// document it indexes**, and M's parser answers by throwing a `MoneyError`. Throwing is the right
// design for arithmetic — you cannot add something that is not money — and the wrong cost for
// classification: constructing an exception per non-money string would dominate materialisation.
// `parseMoney()` is therefore a non-throwing recogniser over M's own table, and the conformance
// test is what makes that safe rather than merely fast.
//
// One thing this section deliberately does *not* do: infer a scale for a currency code it does not
// know. That was a defect in an earlier draft and FD-1 forbids it. Inferring from the literal is
// worse than guessing 2, because `"5.0 XYZ"` and `"5.00 XYZ"` then become different values of the
// same currency and neither is wrong enough to notice. An unknown code is simply not money: the
// value stays text, sorts as text, and `sum` ignores it — visible, and never silently wrong.
//
// @typedef {{ code: string, scale: number, minor: bigint }} Money
// ===========================================================================

import {
  CURRENCIES,
  fromMinor as mFromMinor,
  toString as mToString,
  looksLikeMoney as mLooksLikeMoney,
} from '../money/money.js';

/**
 * **`looksLikeMoney` is `runtime/money/`'s, re-exported, and that closes a Wave 1 divergence.**
 *
 * Wave 1 exported a function of this name from here that was really a *shape* test — `"… CCC"`,
 * uppercase code, space in the right place — used as the cheap rejection at the top of
 * `parseMoney()`. It answered `true` for `"5.00 XXX"`, which `parseMoney()` then correctly refuses,
 * because `XXX` has no ISO 4217 scale and FD-1 forbids guessing one. Two functions with one name and
 * two meanings, in one repository, is how a caller ends up treating a prefilter as a predicate.
 *
 * Agent M now exports the exact predicate (and `currencyOfOrNull` behind it), so this module has no
 * business having an opinion: the name resolves to one implementation for the whole repository. The
 * shape test survives as `hasMoneyShape()`, unexported and honestly named.
 */
export const looksLikeMoney = mLooksLikeMoney;

/**
 * ISO 4217 minor units, read from `runtime/money/`'s table. A `Map` rather than the frozen object
 * because `CURRENCIES['constructor']` on a plain object is not `undefined`, and a currency code
 * that accidentally names an `Object.prototype` member must not become a currency.
 */
const SCALE = new Map(Object.entries(CURRENCIES));

/**
 * Cheap rejection for the hot loop: `"… CCC"` shape, uppercase code, space in the right place.
 *
 * **Not the predicate** — `"5.00 XXX"` has the shape and is not money. It exists because `parseMoney`
 * is called on *every string value of every document* and a full parse per non-monetary string would
 * dominate materialisation. Use `looksLikeMoney` (agent M's, re-exported above) for the question
 * "is this money"; use this one only to decide whether a parse is worth attempting.
 */
function hasMoneyShape(v) {
  if (typeof v !== 'string') return false;
  const n = v.length;
  if (n < 5 || v.charCodeAt(n - 4) !== 32 /* space */) return false;
  for (let i = n - 3; i < n; i++) {
    const c = v.charCodeAt(i);
    if (c < 65 || c > 90) return false;
  }
  const c0 = v.charCodeAt(0);
  return (c0 >= 48 && c0 <= 57) || c0 === 45 /* - */;
}

/** One compiled pattern per scale. `0` has no decimal point at all — `1000.0 JPY` is not money. */
const AMOUNT_BY_SCALE = new Map();

function amountPattern(scale) {
  let re = AMOUNT_BY_SCALE.get(scale);
  if (re === undefined) {
    re = scale === 0
      ? /^-?(?:0|[1-9][0-9]*)$/
      : new RegExp(`^-?(?:0|[1-9][0-9]*)\\.[0-9]{${scale}}$`);
    AMOUNT_BY_SCALE.set(scale, re);
  }
  return re;
}

/**
 * Recognise a canonical FD-1 token. Returns `null` for anything that is not one — never throws,
 * never approximates. `null` is how the index knows a string field is text and not money.
 *
 * Byte-for-byte agreement with `runtime/money/`'s `money()` is asserted by the conformance test.
 * @returns {Money|null}
 */
export function parseMoney(v) {
  if (!hasMoneyShape(v)) return null;
  const n = v.length;
  const code = v.slice(n - 3);
  const scale = SCALE.get(code);
  if (scale === undefined) return null; // unknown currency is not money. FD-1: never a guess.
  const amount = v.slice(0, n - 4);
  if (!amountPattern(scale).test(amount)) return null;
  if (amount.charCodeAt(0) === 45 /* - */) {
    // `-0.00 EUR` is refused: negative zero is not a value, and two spellings of zero would
    // otherwise land in two index buckets.
    let allZero = true;
    for (let i = 1; i < amount.length; i++) {
      const c = amount.charCodeAt(i);
      if (c !== 48 && c !== 46) {
        allZero = false;
        break;
      }
    }
    if (allZero) return null;
  }
  const dot = amount.indexOf('.');
  const digits = dot < 0 ? amount : amount.slice(0, dot) + amount.slice(dot + 1);
  return { code, scale, minor: BigInt(digits) };
}

/**
 * The canonical token. Formatting goes through `runtime/money/` so that exactly one function in
 * the repository turns minor units back into text.
 */
export function formatMoney(m) {
  return mToString(mFromMinor(m.minor, m.code));
}

/**
 * Order two monetary values. `null` when they are **not comparable** — different currencies. The
 * caller decides what that means: the read path treats it as "does not match", the same as
 * comparing a number with a string, and refuses it in `sum` where FD-1 demands a refusal.
 *
 * Comparing minor units directly is exact and equivalent to `runtime/money/`'s `compare()` because
 * the scale is fixed per currency; the conformance test asserts the equivalence rather than
 * trusting the argument.
 */
export function compareMoney(a, b) {
  if (a.code !== b.code) return null;
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

/**
 * The canonical index key: `m:<CODE>:<minor>`. Because the scale is fixed per currency, the minor
 * units *are* the canonical form — which is what makes an equality index over money exact rather
 * than textual, and what makes a range index over money a plain sorted list of integers.
 */
export function moneyKey(m) {
  return `m:${m.code}:${m.minor}`;
}

/** Decode `m:<CODE>:<minor>`. Used by the range index's comparator and its bucket walk. */
export function keyToMoney(key) {
  const c = key.indexOf(':', 2);
  const code = key.slice(2, c);
  return { code, scale: SCALE.get(code) ?? 0, minor: BigInt(key.slice(c + 1)) };
}

/** Order two money *keys* of the same currency: one BigInt parse each. */
export function compareMoneyKeys(a, b) {
  const x = BigInt(a.slice(a.indexOf(':', 2) + 1));
  const y = BigInt(b.slice(b.indexOf(':', 2) + 1));
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * An exact, order-independent accumulator. Order-independence is not a nicety: it is what makes a
 * maintained aggregate (add on post, subtract on correction) provably equal to a full scan, which
 * is the property `test/e-read.test.js` asserts against a naive oracle. Doubles do not have it.
 */
export class MoneySum {
  constructor() {
    this.code = null;
    this.minor = 0n;
    this.count = 0;
  }

  /** @throws {Error} on a second currency — FD-1: mixed currencies do not add. */
  add(m, sign = 1n) {
    if (this.code === null) {
      this.code = m.code;
    } else if (this.code !== m.code) {
      const e = new Error(
        `cannot add ${m.code} to ${this.code} — mixed currencies do not add (FD-1). ` +
          'Group by currency, or model an explicit conversion carrying its rate and date.',
      );
      e.code = 'MIXED_CURRENCY';
      e.currencies = [this.code, m.code];
      throw e;
    }
    this.minor += sign * m.minor;
    this.count += sign > 0n ? 1 : -1;
    return this;
  }

  sub(m) {
    return this.add(m, -1n);
  }

  isEmpty() {
    return this.code === null;
  }

  /** @returns {string|null} the canonical token, or null if nothing was ever added. */
  value() {
    return this.code === null ? null : formatMoney({ code: this.code, minor: this.minor });
  }
}

// ===========================================================================
// PART 2 — the query language
// ===========================================================================

/** Refusal, not approximation. Principle 6. */
export class QueryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QueryError';
  }
}

const QUERY_KEYS = new Set([
  'from', 'join', 'where', 'orderBy', 'desc', 'limit', 'sum', 'count', 'groupBy',
]);

const JOIN_KEYS = new Set(['as', 'from', 'on', 'required']);

/**
 * The complete operator set for non-monetary arguments. Anything else is refused.
 * Each operator is `(fieldValue, argument) => boolean`. A missing field value is `undefined`
 * and compares false everywhere except `!=` and `exists: false`.
 * Argument shapes (`in`/`not in`/`between` need arrays) are validated by `compileWhere` before
 * any operator runs, so the functions here may assume a well-formed argument.
 */
export const OPERATORS = {
  '=': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>': (a, b) => isComparable(a, b) && a > b,
  '>=': (a, b) => isComparable(a, b) && a >= b,
  '<': (a, b) => isComparable(a, b) && a < b,
  '<=': (a, b) => isComparable(a, b) && a <= b,
  in: (a, b) => b.includes(a),
  'not in': (a, b) => !b.includes(a),
  between: (a, b) =>
    isComparable(a, b[0]) && isComparable(a, b[1]) && a >= b[0] && a <= b[1],
  contains: (a, b) => {
    if (Array.isArray(a)) return a.includes(b);
    if (typeof a === 'string' && typeof b === 'string') return a.includes(b);
    return false;
  },
  'starts with': (a, b) =>
    typeof a === 'string' && typeof b === 'string' && a.startsWith(b),
  exists: (a, b) => (b === false ? a === undefined || a === null : a !== undefined && a !== null),
};

/**
 * A compiled money comparator: `(value) => -1 | 0 | 1 | NaN`, allocating nothing and constructing no
 * `BigInt`. `NaN` means "not comparable" — the value is not a canonical token of this comparator's
 * currency.
 *
 * Why hand-rolled rather than `compareMoney(parseMoney(v), probe)`: that costs ~125 ns per row,
 * almost all of it in the `BigInt` allocation, against ~8 ns for a string equality and ~19 ns for a
 * date range. On a query whose plan hands back 80 000 candidates the difference is ten milliseconds,
 * and an amount filter is the single most common predicate an ERP evaluates. This costs ~25 ns.
 *
 * It is exact, and the exactness is structural rather than careful: within one currency the scale is
 * fixed, so two canonical tokens are ordered by (sign, count of significant digits, then the digits
 * themselves) — no arithmetic happens at all. Anything not canonical for this currency is rejected
 * by the same rules `parseMoney()` applies, and `test/e-read.test.js` asserts the two agree on every
 * value its author could think of plus several thousand generated ones. If they ever disagree, that
 * test fails; nothing silently rounds.
 */
function moneyComparator(token) {
  const probe = parseMoney(token);
  if (probe === null) return () => NaN;
  const scale = probe.scale;
  const tn = token.length;
  const ta = token.charCodeAt(0) === 45 ? 1 : 0;
  const tdp = scale > 0 ? tn - 4 - scale - 1 : tn - 4;
  const combined =
    scale > 0 ? token.slice(ta, tdp) + token.slice(tdp + 1, tn - 4) : token.slice(ta, tn - 4);
  let f = 0;
  while (f < combined.length && combined.charCodeAt(f) === 48) f++;
  const pd = combined.slice(f);
  const pl = pd.length;
  const pneg = ta === 1;
  const k0 = probe.code.charCodeAt(0);
  const k1 = probe.code.charCodeAt(1);
  const k2 = probe.code.charCodeAt(2);
  const minLen = scale === 0 ? 5 : scale + 6;

  return (v) => {
    if (typeof v !== 'string') return NaN;
    const n = v.length;
    if (n < minLen) return NaN;
    if (
      v.charCodeAt(n - 4) !== 32 || v.charCodeAt(n - 3) !== k0 ||
      v.charCodeAt(n - 2) !== k1 || v.charCodeAt(n - 1) !== k2
    ) {
      return NaN;
    }
    const neg = v.charCodeAt(0) === 45;
    const a0 = neg ? 1 : 0;
    const dp = scale > 0 ? n - 4 - scale - 1 : n - 4;
    const intLen = dp - a0;
    if (intLen < 1) return NaN;
    if (intLen > 1 && v.charCodeAt(a0) === 48) return NaN; // a leading zero is not canonical
    for (let i = a0; i < dp; i++) {
      const c = v.charCodeAt(i);
      if (c < 48 || c > 57) return NaN;
    }
    if (scale > 0) {
      if (v.charCodeAt(dp) !== 46) return NaN;
      for (let i = dp + 1; i < n - 4; i++) {
        const c = v.charCodeAt(i);
        if (c < 48 || c > 57) return NaN;
      }
    }
    // The combined digit run, addressed without building a string.
    const L = intLen + scale;
    let g = 0;
    while (g < L) {
      const c = g < intLen ? v.charCodeAt(a0 + g) : v.charCodeAt(dp + 1 + (g - intLen));
      if (c !== 48) break;
      g++;
    }
    const sl = L - g;
    if (neg && sl === 0) return NaN; // `-0.00 EUR` is not a value
    if (sl === 0 && pl === 0) return 0;
    if (neg !== pneg) return neg ? -1 : 1;
    let m;
    if (sl !== pl) {
      m = sl < pl ? -1 : 1;
    } else {
      m = 0;
      for (let i = 0; i < sl; i++) {
        const g2 = g + i;
        const c = g2 < intLen ? v.charCodeAt(a0 + g2) : v.charCodeAt(dp + 1 + (g2 - intLen));
        const d = pd.charCodeAt(i);
        if (c !== d) {
          m = c < d ? -1 : 1;
          break;
        }
      }
    }
    // `m === 0` returns a plain `0`, not `-0`: an equality result must be one value, and `-0` is
    // the kind of thing that compares equal with `===` and differently with `Object.is`.
    return m === 0 ? 0 : neg ? -m : m;
  };
}

/**
 * The monetary operators, compiled against the query's own argument. Which table a clause compiles
 * to is decided by the shape of that argument, so a query mentioning no money runs exactly the code
 * v0.1 ran.
 *
 * Two decisions worth stating, because an auditor will ask:
 *
 *  1. *A cross-currency comparison does not match; it does not throw.* `10.00 USD > 5.00 EUR` is
 *     `false`, the same way `"abc" > 5` is false — the query language already refuses to order
 *     values of different kinds, and two currencies are different kinds. Summation is where FD-1's
 *     "mixed currencies do not add" bites, and there it *does* refuse loudly. Comparison must also
 *     stay total-and-silent for a second reason: if it threw, whether a query threw would depend on
 *     which rows an index happened to visit, and the indexed and unindexed paths would stop
 *     agreeing. Correctness of the plan comes first.
 *  2. *Equality is by value, not by text.* `"1.50 EUR"` never equals `"1.50 USD"`. The index agrees,
 *     because its key is the canonical minor-unit form.
 */
function compileMoneyOp(op, value) {
  if (op === 'between') {
    const lo = moneyComparator(value[0]);
    const hi = moneyComparator(value[1]);
    return (a) => {
      const l = lo(a);
      if (!(l === 0 || l === 1)) return false;
      const h = hi(a);
      return h === 0 || h === -1;
    };
  }
  if (op === 'in' || op === 'not in') {
    const cs = value.map(moneyComparator);
    const want = op === 'in';
    return (a) => {
      for (let i = 0; i < cs.length; i++) if (cs[i](a) === 0) return want;
      return !want;
    };
  }
  if (op === 'contains' || op === 'starts with' || op === 'exists') return OPERATORS[op];
  const c = moneyComparator(value);
  switch (op) {
    case '=':
      return (a) => c(a) === 0;
    case '!=':
      return (a) => c(a) !== 0;
    case '>':
      return (a) => c(a) === 1;
    case '>=':
      return (a) => {
        const r = c(a);
        return r === 0 || r === 1;
      };
    case '<':
      return (a) => c(a) === -1;
    case '<=':
      return (a) => {
        const r = c(a);
        return r === 0 || r === -1;
      };
    default:
      return OPERATORS[op];
  }
}

export { moneyComparator as _moneyComparatorForTest };

/** Is this argument monetary? Decides which operator table a clause compiles to. */
function moneyArg(op, value) {
  if (op === 'in' || op === 'not in' || op === 'between') {
    if (!Array.isArray(value) || value.length === 0) return false;
    return value.every((v) => typeof v === 'string' && parseMoney(v) !== null);
  }
  return typeof value === 'string' && parseMoney(value) !== null;
}

function isComparable(a, b) {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  const ta = typeof a;
  if (ta !== typeof b) return false;
  if (ta === 'number') return a === a && b === b; // NaN never compares
  return ta === 'string' || ta === 'bigint' || ta === 'boolean';
}

/**
 * Argument shapes are checked once, when the query is compiled — never per row. A malformed
 * query is therefore refused even if zero documents would have reached the operator. Principle 6
 * must not depend on the data.
 */
function checkArg(op, value, ref) {
  if (op === 'in' || op === 'not in') {
    if (!Array.isArray(value)) throw new QueryError(`operator "${op}" on "${ref}" needs an array value`);
  } else if (op === 'between') {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new QueryError(`operator "between" on "${ref}" needs exactly [low, high]`);
    }
  }
}

/** Byte-wise (code-unit) string order. Never `localeCompare` — that is locale-dependent. */
export function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Total order over arbitrary field values, so sorting can never be ambiguous.
 *
 * Rank: numbers < **money** < strings < booleans < everything-else < missing (always last).
 *
 * Money sits between numbers and text for one reason: a money field sorted as text puts
 * `"9.00 EUR"` after `"10.00 EUR"`, and an invoice list ordered that way is a wrong report.
 * Inside the money rank, order is by currency code and then by exact minor units — cross-currency
 * ordering has to be *some* total order for determinism, and grouping by currency is the only one
 * that does not pretend a rate exists.
 */
const R_NUM = 1;
const R_MONEY = 2;
const R_STR = 3;
const R_BOOL = 4;
const R_OTHER = 5;
const R_MISSING = 6;

/** One decoration per row per sort — the money parse happens once, not once per comparison. */
function decorate(v) {
  if (v === undefined || v === null) return { r: R_MISSING };
  const t = typeof v;
  if (t === 'number') return v === v ? { r: R_NUM, n: v } : { r: R_MISSING };
  if (t === 'bigint') return { r: R_NUM, n: Number(v) };
  if (t === 'string') {
    const m = parseMoney(v);
    return m === null ? { r: R_STR, s: v } : { r: R_MONEY, m };
  }
  if (t === 'boolean') return { r: R_BOOL, b: v };
  return { r: R_OTHER, s: String(v) };
}

function compareDecorated(A, B) {
  if (A.r !== B.r) return A.r < B.r ? -1 : 1;
  switch (A.r) {
    case R_MISSING:
      return 0;
    case R_NUM:
      return A.n < B.n ? -1 : A.n > B.n ? 1 : 0;
    case R_MONEY: {
      if (A.m.code !== B.m.code) return compareStrings(A.m.code, B.m.code);
      return compareMoney(A.m, B.m);
    }
    case R_BOOL:
      return A.b === B.b ? 0 : A.b ? 1 : -1;
    default:
      return compareStrings(A.s, B.s);
  }
}

export function compareValues(a, b) {
  return compareDecorated(decorate(a), decorate(b));
}

function isMissing(d) {
  return d.r === R_MISSING;
}

/** Compile `"customer.region"` (or `"total"`, or `"address.city"`) into a fast reader. */
function compileRef(ref, aliases) {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new QueryError(`field reference must be a non-empty string, got ${JSON.stringify(ref)}`);
  }
  const dot = ref.indexOf('.');
  if (dot > 0) {
    const head = ref.slice(0, dot);
    if (aliases.has(head)) {
      const rest = ref.slice(dot + 1).split('.');
      return (row) => walk(row.joined[head], rest);
    }
  }
  const parts = ref.split('.');
  if (parts.length === 1) {
    const key = parts[0];
    return (row) => row.doc[key];
  }
  return (row) => walk(row.doc, parts);
}

function walk(obj, parts) {
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function normalizeJoins(join) {
  if (join === undefined || join === null) return [];
  const list = Array.isArray(join) ? join : [join];
  const seen = new Set();
  return list.map((j) => {
    if (j === null || typeof j !== 'object' || Array.isArray(j)) {
      throw new QueryError('join must be an object { as, from, on, required? }');
    }
    for (const k of Object.keys(j)) {
      if (!JOIN_KEYS.has(k)) {
        throw new QueryError(
          `unknown join key "${k}" — v0.1 joins accept only ${[...JOIN_KEYS].join(', ')}`,
        );
      }
    }
    for (const k of ['as', 'from', 'on']) {
      if (typeof j[k] !== 'string' || j[k].length === 0) {
        throw new QueryError(`join.${k} must be a non-empty string`);
      }
    }
    if (j.as.includes('.')) throw new QueryError(`join.as must not contain "." (got "${j.as}")`);
    if (seen.has(j.as)) throw new QueryError(`duplicate join alias "${j.as}"`);
    seen.add(j.as);
    return { as: j.as, from: j.from, on: j.on, required: j.required !== false };
  });
}

function compileWhere(where, aliases) {
  if (where === undefined || where === null) return [];
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new QueryError('where must be an object of { field: value | {op, value} }');
  }
  return Object.keys(where).map((ref) => {
    const spec = where[ref];
    let op = '=';
    let value = spec;
    if (spec !== null && typeof spec === 'object' && !Array.isArray(spec) && typeof spec.op === 'string') {
      op = spec.op;
      value = spec.value;
    }
    if (!Object.prototype.hasOwnProperty.call(OPERATORS, op)) {
      throw new QueryError(
        `unknown operator "${op}" on field "${ref}" — v0.1 supports: ` +
          Object.keys(OPERATORS).map((o) => `"${o}"`).join(', '),
      );
    }
    checkArg(op, value, ref);
    const money = moneyArg(op, value);
    const fn = money ? compileMoneyOp(op, value) : OPERATORS[op];
    const alias = aliasOf(ref, aliases);
    return {
      read: compileRef(ref, aliases),
      fn,
      value,
      ref,
      op,
      money,
      alias,
      joined: alias !== null,
      /**
       * For a plain single-segment field, the property name — so the filter loop can read
       * `doc[key]` directly instead of going through a closure. Three predicates per row on a
       * hundred thousand candidates is three hundred thousand closure calls; skipping them is free.
       */
      key: alias === null && !ref.includes('.') ? ref : null,
      /** Roughly what one evaluation costs, for `orderClauses()`. Not a measurement, a ranking. */
      cost: (money ? 3 : 1) * (OP_COST[op] ?? 2),
      /** The part after `alias.` — what the *peer* entity would be indexed on. */
      peerRef: alias === null ? null : ref.slice(alias.length + 1),
    };
  });
}

function aliasOf(ref, aliases) {
  const dot = ref.indexOf('.');
  if (dot <= 0) return null;
  const head = ref.slice(0, dot);
  return aliases.has(head) ? head : null;
}

/** A ranking, not a measurement: `===` is cheap, a substring search is not, money is worse. */
const OP_COST = {
  '=': 1, '!=': 1, exists: 1, '>': 1, '>=': 1, '<': 1, '<=': 1,
  between: 2, in: 3, 'not in': 3, 'starts with': 2, contains: 4,
};

/**
 * Order an AND-chain of predicates cheapest-first, and put the clause that produced the candidate
 * set last.
 *
 * Safe without argument: the predicates are pure functions of the document and are combined with
 * AND, so no order can change the result set. Worth doing because the costs differ by more than an
 * order of magnitude, and because the predicate the plan was built from rejects nothing at all —
 * every candidate satisfies it by construction — so evaluating it first is pure waste. It is still
 * evaluated, last: `candidates()` is allowed to return a superset, and the moment this file starts
 * trusting a plan instead of checking it, every future index becomes a correctness risk.
 */
function orderClauses(clauses, servedRef) {
  return clauses
    .map((c, i) => ({ c, i }))
    .sort((A, B) => {
      const aServed = A.c.ref === servedRef ? 1 : 0;
      const bServed = B.c.ref === servedRef ? 1 : 0;
      if (aServed !== bServed) return aServed - bServed;
      if (A.c.cost !== B.c.cost) return A.c.cost - B.c.cost;
      return A.i - B.i; // stable, so the plan is deterministic
    })
    .map((x) => x.c);
}

/** Operators a secondary index can produce candidates for. Everything else is filter-only. */
const INDEXABLE = new Set(['=', 'in', '>', '>=', '<', '<=', 'between', 'starts with']);

/**
 * Run a Query against a Source.
 *
 * Pipeline, in this fixed order:
 *   candidates (index or full scan) → where on the document → join → where on the joined
 *   document → orderBy → limit → aggregate
 *
 * `limit` always means *rows*, never groups: it is applied to the ordered rows before any
 * aggregation, so `{ sum, orderBy, desc, limit }` is a top-N sum. One meaning, no surprises.
 *
 * @param {Source} source
 * @param {Query} q
 * @returns {object[] | number | string | Map<unknown, number|string|object[]>}
 */
export function select(source, q) {
  const compiled = compile(source, q);
  return run(source, compiled);
}

/**
 * Validate and compile, without touching a single document. Exported so a caller can pay the
 * compile cost once and run the same query on every commit — which is exactly what a rule engine
 * does. `explain()` on the result names the plan the index chose.
 */
export function compile(source, q) {
  if (q === null || typeof q !== 'object' || Array.isArray(q)) {
    throw new QueryError('select() needs a query object');
  }
  for (const k of Object.keys(q)) {
    if (!QUERY_KEYS.has(k)) {
      throw new QueryError(
        `unknown query key "${k}" — v0.1 understands only ${[...QUERY_KEYS].join(', ')}`,
      );
    }
  }
  if (typeof q.from !== 'string' || q.from.length === 0) {
    throw new QueryError('query.from must be a non-empty entity name');
  }
  if (q.sum !== undefined && q.count) {
    throw new QueryError('query cannot ask for both sum and count — pick one');
  }
  if (q.limit !== undefined && (!Number.isInteger(q.limit) || q.limit < 0)) {
    throw new QueryError('query.limit must be a non-negative integer');
  }

  const joins = normalizeJoins(q.join);
  const aliases = new Set(joins.map((j) => j.as));
  const clauses = compileWhere(q.where, aliases);
  return {
    q,
    joins,
    clauses,
    plain: clauses.filter((c) => !c.joined),
    overJoin: clauses.filter((c) => c.joined),
    readOrder: q.orderBy === undefined ? null : compileRef(q.orderBy, aliases),
    readSum: q.sum === undefined ? null : compileRef(q.sum, aliases),
    readGroup: q.groupBy === undefined ? null : compileRef(q.groupBy, aliases),
  };
}

function run(source, c) {
  const { q, joins, plain, overJoin, readOrder, readSum, readGroup } = c;

  // Does the answer depend on the order rows arrive in? Only a bare `sum` or `count` with no
  // `limit` is order-blind. Everything that returns documents, and anything limited, is ordered —
  // and ordering is always *total*, ties broken by id, so two runs cannot disagree.
  const aggregating = readSum !== null || q.count === true;
  const needOrder = q.limit !== undefined || !aggregating;

  // ---- the aggregate short circuit ---------------------------------------
  // `sum of <field> over <entity> where <by> = <v>` and its group-by form are what a general
  // ledger asks on every posting. When a maintained aggregate covers exactly that shape the
  // answer is O(1) (or O(groups)) with no rows touched at all. The source returns null unless the
  // shape matches exactly — a near-miss falls through to the ordinary pipeline rather than being
  // approximated.
  if (typeof source.fastAggregate === 'function' && joins.length === 0 && q.limit === undefined) {
    const shape = {
      entity: q.from,
      sum: q.sum,
      count: q.count === true,
      groupBy: q.groupBy,
      where: plain,
    };
    const hit = source.fastAggregate(shape);
    if (hit !== null && hit !== undefined) return hit.value;
  }

  // ---- candidates: which rows are worth looking at ------------------------
  const pk = plain.find((cl) => cl.ref === 'id' && cl.op === '=');
  let base;
  let baseIdSorted = false;
  let plan;
  /** Which predicate the candidate set was derived from — it rejects nothing, so it goes last. */
  let servedRef = null;
  if (pk !== undefined) {
    // id is the primary key, so an equality predicate on it is a single lookup. Every other
    // clause is still applied to the candidate, so this can never change a result.
    const one = source.get(q.from, String(pk.value));
    base = one === null ? [] : [one];
    baseIdSorted = true;
    plan = 'primary key';
    servedRef = 'id';
  } else {
    let got = null;
    if (typeof source.candidates === 'function') {
      got = source.candidates(q.from, {
        plain: plain.filter((cl) => INDEXABLE.has(cl.op)),
        viaJoin: overJoin
          .filter((cl) => INDEXABLE.has(cl.op))
          .map((cl) => ({ clause: cl, join: joins.find((j) => j.as === cl.alias) }))
          .filter((s) => s.join !== undefined),
      });
    }
    if (got === null || got === undefined) {
      // A full scan needs id order only if the answer does. `all()` sorts a million id strings the
      // first time it is asked; `scan()` does not sort at all.
      if (needOrder || typeof source.scan !== 'function') {
        base = source.all(q.from);
        baseIdSorted = true;
      } else {
        base = source.scan(q.from);
        baseIdSorted = false;
      }
      plan = 'full scan';
    } else {
      base = got.docs;
      plan = got.plan;
      servedRef = got.servedRef ?? null;
    }
  }

  // ---- filter on the document → join → filter on the joined document -----
  // Predicates are pure and AND-combined, so the order they run in cannot change the result set.
  // Running the document-only predicates first means the join is resolved for the few rows that
  // survive them, not for every candidate. That is the whole optimisation.
  let rows = [];
  const scratch = { doc: null, joined: null };
  const ordered = orderClauses(plain, servedRef);
  const nPlain = ordered.length;
  const nJoins = joins.length;
  const nOver = overJoin.length;

  for (let i = 0; i < base.length; i++) {
    const doc = base[i];
    scratch.doc = doc;
    scratch.joined = null;

    let keep = true;
    for (let k = 0; k < nPlain; k++) {
      const cl = ordered[k];
      const key = cl.key;
      const val = key === null ? cl.read(scratch) : doc[key];
      if (!cl.fn(val, cl.value)) {
        keep = false;
        break;
      }
    }
    if (!keep) continue;

    let joined = null;
    if (nJoins > 0) {
      joined = {};
      for (let k = 0; k < nJoins; k++) {
        const j = joins[k];
        const ref = doc[j.on];
        const peer = ref === undefined || ref === null ? null : source.get(j.from, String(ref));
        if (peer === null && j.required) {
          keep = false;
          break;
        }
        joined[j.as] = peer;
      }
      if (!keep) continue;
      scratch.joined = joined;
      for (let k = 0; k < nOver; k++) {
        const cl = overJoin[k];
        if (!cl.fn(cl.read(scratch), cl.value)) {
          keep = false;
          break;
        }
      }
      if (!keep) continue;
    }
    rows.push({ doc, joined });
  }

  // ---- order (always total: ties broken by id) ----------------------------
  if (readOrder !== null && needOrder) {
    const desc = q.desc === true;
    const keyed = rows.map((row) => ({ row, key: decorate(readOrder(row)) }));
    keyed.sort((A, B) => {
      const cv = compareDecorated(A.key, B.key);
      if (cv !== 0) {
        // Missing values sort last in *both* directions — otherwise `desc` would surface
        // rows that have no value for the sort field, which no report ever wants.
        if (isMissing(A.key) || isMissing(B.key)) return cv;
        return desc ? -cv : cv;
      }
      return compareStrings(String(A.row.doc.id), String(B.row.doc.id));
    });
    rows = keyed.map((k) => k.row);
  } else if (needOrder && !baseIdSorted) {
    // An index produced the candidates, so they arrive in row order. Determinism is not negotiable,
    // so put them back in id order — the same total order a full scan yields. Keys are extracted
    // once rather than on every comparison: a 12 500-row sort is ~170 000 comparisons, and
    // `String(A.doc.id)` inside the comparator costs more than the comparison does.
    const keyed = rows.map((row) => ({ row, key: String(row.doc.id) }));
    keyed.sort((A, B) => compareStrings(A.key, B.key));
    rows = keyed.map((k) => k.row);
  }

  // ---- limit (rows) -------------------------------------------------------
  if (q.limit !== undefined && rows.length > q.limit) rows = rows.slice(0, q.limit);

  // ---- aggregate ----------------------------------------------------------
  if (readGroup !== null) {
    const groups = new Map();
    for (const row of rows) {
      const key = readGroup(row);
      let bucket = groups.get(key);
      if (bucket === undefined) {
        bucket = [];
        groups.set(key, bucket);
      }
      bucket.push(row);
    }
    const keys = [...groups.keys()].sort(compareValues);
    const out = new Map();
    for (const key of keys) {
      const bucket = groups.get(key);
      if (readSum !== null) out.set(key, sumOf(bucket, readSum, q.sum));
      else if (q.count) out.set(key, bucket.length);
      else out.set(key, bucket.map((r) => r.doc));
    }
    return out;
  }
  if (readSum !== null) return sumOf(rows, readSum, q.sum);
  if (q.count) return rows.length;
  return rows.map((r) => r.doc);
}

/** For a caller that wants to see which plan the index chose. Runs the query. */
export function explain(source, q) {
  const c = compile(source, q);
  const pk = c.plain.find((cl) => cl.ref === 'id' && cl.op === '=');
  if (pk !== undefined) return { plan: 'primary key', candidates: 1 };
  if (typeof source.candidates !== 'function') return { plan: 'full scan (source has no index)' };
  const got = source.candidates(q.from, {
    plain: c.plain.filter((cl) => INDEXABLE.has(cl.op)),
    viaJoin: c.overJoin
      .filter((cl) => INDEXABLE.has(cl.op))
      .map((cl) => ({ clause: cl, join: c.joins.find((j) => j.as === cl.alias) }))
      .filter((s) => s.join !== undefined),
  });
  if (got === null || got === undefined) return { plan: 'full scan', candidates: source.all(q.from).length };
  return { plan: got.plan, candidates: got.docs.length };
}

/**
 * `sum`, exactly.
 *
 * Money is accumulated in `BigInt` minor units and returned as a canonical FD-1 token. Plain
 * numbers are accumulated as numbers, as before. The two never mix: a field carrying both is a
 * modelling error and is refused rather than coerced, because the coercion an ERP would need
 * (which currency?) does not exist. Missing and non-numeric values contribute nothing, so a sum
 * is never `NaN` — that behaviour is v0.1's and it is preserved deliberately.
 *
 * @returns {number|string} a number for `number` fields, a canonical money token for `money`
 */
function sumOf(rows, read, label) {
  /**
   * Plain numbers are collected rather than accumulated on the way past, because floating-point
   * addition is **not associative**: `a + b + c` depends on the order, so a query planner that
   * visited rows in a different order would report a different total for the same documents. That
   * is not a rounding preference; it is a report that changes when nothing changed, and this is
   * exactly the defect that FD-1 exists to remove.
   *
   * Two exits, both order-independent:
   *   • every value a safe integer with a safe running total ⇒ the sum is exact, use it directly
   *     (counts and quantities in whole units, which is what a `number` field should be under FD-1);
   *   • otherwise sort ascending and sum. The result is then a pure function of the *multiset* of
   *     values — equal doubles added in any order give the same double — so any plan agrees, and
   *     ascending order is also the numerically better one.
   *
   * Money never pays for either: `BigInt` addition is associative, so the accumulator below is
   * exact and order-independent by construction. `test/e-read.test.js` compares the indexed and
   * unindexed plans over 4 000 randomised queries, which is how this was found.
   */
  let nums = null;
  let intTotal = 0;
  let allInt = true;
  let sawNum = false;
  const acc = new MoneySum();
  const push = (v) => {
    sawNum = true;
    if (nums === null) nums = [];
    nums.push(v);
    if (allInt && Number.isSafeInteger(v) && Number.isSafeInteger(intTotal + v)) intTotal += v;
    else allInt = false;
  };
  for (const row of rows) {
    const v = read(row);
    const t = typeof v;
    if (t === 'string') {
      const m = parseMoney(v);
      if (m === null) continue; // ordinary text contributes nothing, exactly as before
      try {
        acc.add(m);
      } catch (e) {
        // `.code` is what a caller branches on; the message may name a different pair of
        // currencies than a maintained aggregate would, because a scan stops at the first
        // conflict it meets. The refusal itself is the contract, not its prose.
        throw refusal(
          e.code,
          `sum of "${label}": ${e.message}` +
            (e.code === 'MIXED_CURRENCY' ? ' Add `groupBy: "currency"` (or the currency field).' : ''),
        );
      }
    } else if (t === 'number') {
      if (v === v && v !== Infinity && v !== -Infinity) push(v);
    } else if (t === 'bigint') {
      push(Number(v));
    }
  }
  if (!acc.isEmpty()) {
    if (sawNum) throw refusal('MIXED_KINDS', mixedKindsMessage(label));
    return acc.value();
  }
  if (nums === null) return 0; // nothing to add — a sum is never NaN, exactly as in v0.1
  if (allInt) return intTotal;
  nums.sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i < nums.length; i++) total += nums[i];
  return total;
}

/** A `QueryError` carrying a stable machine-readable `.code`, per agent M's convention. */
export function refusal(code, message) {
  const e = new QueryError(message);
  e.code = code;
  return e;
}

export function mixedKindsMessage(label) {
  return (
    `sum of "${label}": the field holds both monetary values and plain numbers. ` +
    'A money field is a string like "4999.99 EUR" (FD-1); fix the documents, ' +
    'because there is no correct way to add a currency to a bare number.'
  );
}
