/**
 * runtime/money/money.js — exact monetary arithmetic. The foundation FD-1 makes binding.
 *
 * The problem this module removes from the codebase:
 *
 *     19 % VAT on 4999.99 as doubles → 949.9981000000001
 *     0.1 + 0.2 as doubles          → 0.30000000000000004
 *     JSON.parse('{"a":4999.99}')   → a double, forever after unrepairable
 *
 * A cent that appears out of a rounding error is a defect. A cent that *disappears* is a
 * finding. So a monetary value here is a string token on the wire — `"4999.99 EUR"` — and a
 * `BigInt` count of minor units in memory. There is no third representation, and no code path
 * on which a `Number` touches an amount. `test/m-money.test.js` greps this file to keep it true.
 *
 * ## The wire form (FD-1, verbatim)
 *
 *     optional "-", digits, ".", exactly the minor-unit digits ISO 4217 gives that currency,
 *     one space, the alphabetic code
 *
 *     "4999.99 EUR"   "-12.00 EUR"   "1000 JPY"   "1.500 TND"
 *
 * `toString(money(x)) === x` for every accepted `x`. That is the whole reason for the string:
 * a document written today opens, byte-identically, in thirty years (Principle 6).
 *
 * ## Decisions FD-1 left open, made here and documented (see also ./README.md)
 *
 * 1. **Negative zero is refused**, not silently normalised: `"-0.00 EUR"` throws
 *    `MoneyError('negative-zero')`. Accepting it and emitting `"0.00 EUR"` would break the
 *    byte-exact round trip that is FD-1's entire justification for a string. No operation in
 *    this module can produce one — `BigInt` has no negative zero. An inbound dialect that
 *    receives `-0.00` from a foreign system must map it to `0.00` explicitly, at the boundary,
 *    where the decision is visible in the model.
 * 2. **Leading zeros are refused** (`"05.00 EUR"`), for the same round-trip reason: one value,
 *    exactly one canonical spelling.
 * 3. **An unknown currency code is an error**, never a guessed scale of 2. Adding a currency is
 *    editing the ISO 4217 table below, in a commit someone signs.
 * 4. **`multiply` requires a rounding mode only when the product is inexact.** Multiplying by a
 *    count (`3n` pieces) needs no policy and must not force the caller to invent one; multiplying
 *    by `"1.19"` does need one, and omitting it throws `MoneyError('rounding-required')`.
 * 5. **`percentage` always requires a rounding mode**, even at 0 %. A tax computation without a
 *    declared rounding rule is not a tax computation.
 * 6. **`multiply` accepts an exact rational** — `bigint`, exact decimal string,
 *    `{ numerator, denominator }` or `[num, den]` — so "one third of this invoice" is expressible
 *    without inventing a decimal expansion. A `Number` factor is refused with its own error code.
 * 7. **Rates carry at most 6 decimal digits** (`percentage`); beyond that, pass a ratio, so the
 *    intent is legible rather than encoded in a long decimal.
 *
 * Zero dependencies. No `node:*`. No `Date.now()`, no `Math.random()`. Pure functions.
 */

import {
  ROUNDING_MODES, isRoundingMode, divRound, pow10, toExactInteger,
  parseScaledToken, formatScaled, parseFactor, parseRate, parseWeights, allocateUnits,
  describe,
} from './decimal.js';

export { ROUNDING_MODES };

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/**
 * Every rejection from this module. `code` is stable and machine-readable — rules, dialects and
 * the UI branch on `code`, never on the message text.
 */
export class MoneyError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Error codes raised by `parseScaledToken`, renamed for the monetary domain. */
const CODE_MAP = Object.freeze({
  'symbol-case': 'currency-case',
  'bad-symbol': 'bad-currency-code',
  'unknown-symbol': 'unknown-currency',
});

/** @param {{code: string, message: string}} failure */
function fail(failure) {
  const code = CODE_MAP[failure.code] ?? failure.code;
  throw new MoneyError(code, failure.message);
}

// ---------------------------------------------------------------------------------------------
// ISO 4217 — the currency table
// ---------------------------------------------------------------------------------------------

/**
 * Currency code → number of minor-unit digits, per ISO 4217.
 *
 * Coverage: every EU and EEA currency, every European currency a neighbour uses, and the
 * currencies a European exporter actually invoices in. Notable non-twos, because they are the
 * ones that break naive code: JPY and ISK have **no** minor unit; the Gulf dinars and TND have
 * **three**; CLF and UYW have four.
 *
 * Adding a currency is a signed edit to this table. There is no fallback, no heuristic and no
 * "probably 2" — a guessed scale is a wrong amount, and a wrong amount in a ledger is fraud
 * in the eyes of anyone auditing it.
 */
export const CURRENCIES = Object.freeze({
  // --- euro area and the rest of the EU / EEA ------------------------------------------------
  EUR: 2, BGN: 2, CZK: 2, DKK: 2, HUF: 2, PLN: 2, RON: 2, SEK: 2,
  ISK: 0, NOK: 2, CHF: 2, GBP: 2,
  // Retired, but inside every European retention period: Croatia adopted the euro on
  // 2023-01-01 and a 2022 HRK invoice must still open (GoBD, 10 years; Principle 6).
  // Policy for historical codes: only added deliberately, with the scale taken from the ISO 4217
  // amendment that retired the code — never from memory, and never guessed at 2.
  HRK: 2,
  // --- other European -----------------------------------------------------------------------
  ALL: 2, AMD: 2, AZN: 2, BAM: 2, BYN: 2, GEL: 2, GIP: 2, MDL: 2, MKD: 2,
  RSD: 2, RUB: 2, TRY: 2, UAH: 2,
  // --- the Americas -------------------------------------------------------------------------
  USD: 2, CAD: 2, MXN: 2, BRL: 2, ARS: 2, CLP: 0, COP: 2, PEN: 2, UYU: 2,
  CLF: 4, UYW: 4,
  // --- Asia-Pacific -------------------------------------------------------------------------
  JPY: 0, CNY: 2, HKD: 2, TWD: 2, KRW: 0, SGD: 2, MYR: 2, THB: 2, IDR: 2,
  PHP: 2, VND: 0, INR: 2, PKR: 2, BDT: 2, LKR: 2, NPR: 2, AUD: 2, NZD: 2,
  // --- Middle East and Africa ---------------------------------------------------------------
  AED: 2, SAR: 2, QAR: 2, ILS: 2, EGP: 2, MAD: 2, DZD: 2, TND: 3, LYD: 3,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, OMR: 3,
  ZAR: 2, NGN: 2, KES: 2, GHS: 2, TZS: 2, UGX: 0, ETB: 2, MUR: 2, XOF: 0,
  XAF: 0, XPF: 0, BIF: 0, DJF: 0, GNF: 0, KMF: 0, RWF: 0,
  // --- other ---------------------------------------------------------------------------------
  PYG: 0, VUV: 0,
});

const CURRENCY_RE = /^[A-Z]{3}$/;
const CURRENCY_CASE_RE = /^[A-Za-z]{3}$/;

/** @param {string} code */
function scaleFor(code) {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code) ? CURRENCIES[code] : undefined;
}

/**
 * Minor-unit digits for a currency code. Throws on an unknown code.
 * @param {string} currency
 * @returns {number}
 */
export function scaleOf(currency) {
  if (typeof currency !== 'string') {
    throw new MoneyError('bad-currency-code', `a currency code must be a string, got ${describe(currency)}`);
  }
  if (!CURRENCY_RE.test(currency)) {
    if (CURRENCY_CASE_RE.test(currency)) {
      throw new MoneyError('currency-case', `currency ${JSON.stringify(currency)} must be upper case (write ${JSON.stringify(currency.toUpperCase())})`);
    }
    throw new MoneyError('bad-currency-code', `${JSON.stringify(currency)} is not a well-formed ISO 4217 code (three upper-case letters)`);
  }
  const scale = scaleFor(currency);
  if (scale === undefined) {
    throw new MoneyError('unknown-currency', `unknown currency ${JSON.stringify(currency)}: its minor-unit scale is not declared in CURRENCIES, and a scale is never guessed`);
  }
  return scale;
}

/** Every currency code the runtime knows, sorted. @returns {string[]} */
export function currencyCodes() {
  return Object.keys(CURRENCIES).sort();
}

// ---------------------------------------------------------------------------------------------
// The value
// ---------------------------------------------------------------------------------------------

/**
 * An exact monetary amount: `minor` BigInt units of `currency`.
 *
 * Frozen, so it cannot drift after a rule has checked it. `toJSON` emits the canonical token,
 * so `JSON.stringify(doc)` writes `"4999.99 EUR"` into the git blob with no help from the
 * caller. `Symbol.toPrimitive` *throws* for numeric coercion: `a + b` on two amounts is a bug,
 * and it now fails at the point of the bug rather than three reports downstream.
 *
 * `structuredClone` of a Money yields a plain `{ minor, currency }` object (prototypes do not
 * survive), which is why every function here accepts that shape too — see `isMoney`.
 */
class Money {
  /** @param {bigint} minor @param {string} currency */
  constructor(minor, currency) {
    /** @type {bigint} */
    this.minor = minor;
    /** @type {string} */
    this.currency = currency;
    Object.freeze(this);
  }

  /** Canonical wire form. */
  toString() {
    return formatScaled(this.minor, CURRENCIES[this.currency]) + ' ' + this.currency;
  }

  /** So `JSON.stringify` writes the canonical token without the caller thinking about it. */
  toJSON() {
    return this.toString();
  }

  /** @param {string} hint */
  [Symbol.toPrimitive](hint) {
    if (hint === 'string') return this.toString();
    throw new MoneyError('numeric-coercion',
      `refusing to coerce ${this.toString()} to a Number. Money is never a Number (FD-1): use add/subtract/multiply/compare, or toMinor() for the BigInt minor units.`);
  }

  get [Symbol.toStringTag]() {
    return 'Money';
  }

  /** Readable in `node --test` output and in a browser console, without a node import. */
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Money ${this.toString()}`;
  }
}

/**
 * Is this a monetary value — a `Money`, or the plain `{ minor, currency }` shape a
 * `structuredClone` or a CRDT snapshot leaves behind?
 * @param {unknown} value
 */
export function isMoney(value) {
  return value !== null && typeof value === 'object'
    && typeof (/** @type {any} */ (value).minor) === 'bigint'
    && typeof (/** @type {any} */ (value).currency) === 'string'
    && scaleFor(/** @type {any} */ (value).currency) !== undefined;
}

/**
 * Parse and validate a canonical token. The only way a string becomes money.
 * @param {unknown} text e.g. `"4999.99 EUR"`
 * @returns {Money}
 */
export function money(text) {
  const r = parseScaledToken(text, {
    symbolRe: CURRENCY_RE,
    caseRe: CURRENCY_CASE_RE,
    scaleFor,
    symbolName: 'currency',
    example: '4999.99 EUR',
  });
  if (r.ok !== true) return fail(r);
  return new Money(r.units, r.symbol);
}

/**
 * Build an amount from minor units — 499999n minor units of EUR is 4999.99 EUR.
 * This is the constructor a ledger uses internally; `money()` is the one a document uses.
 * @param {bigint} minor
 * @param {string} currency
 * @returns {Money}
 */
export function fromMinor(minor, currency) {
  if (typeof minor !== 'bigint') {
    throw new MoneyError('not-a-bigint', `fromMinor needs BigInt minor units, got ${describe(minor)}`);
  }
  scaleOf(currency);   // throws on unknown / malformed code
  return new Money(minor, currency);
}

/**
 * Accept either a `Money` (or its cloned shape) or a canonical token, and return a `Money`.
 * Every operation below goes through this, which is why `add("10.00 EUR", "10.00 USD")` throws
 * the currency error rather than a type error.
 * @param {unknown} value
 * @returns {Money}
 */
export function toMoney(value) {
  if (value instanceof Money) return value;
  if (isMoney(value)) return new Money(/** @type {any} */ (value).minor, /** @type {any} */ (value).currency);
  if (typeof value === 'string') return money(value);
  if (typeof value === 'number') {
    throw new MoneyError('not-a-string', `a monetary value is never a Number: got ${describe(value)}. Write it as a token, e.g. "${value.toString()} EUR" — and check the scale.`);
  }
  throw new MoneyError('not-a-string', `expected a monetary value ("4999.99 EUR" or a Money), got ${describe(value)}`);
}

/** Zero in a currency. @param {string} currency @returns {Money} */
export function zero(currency) {
  scaleOf(currency);
  return new Money(0n, currency);
}

/** The canonical wire form. Always round-trips through `money()`. @param {unknown} m */
export function toString(m) {
  return toMoney(m).toString();
}

/** The exact BigInt minor units. @param {unknown} m @returns {bigint} */
export function toMinor(m) {
  return toMoney(m).minor;
}

/** The currency code. @param {unknown} m @returns {string} */
export function currencyOf(m) {
  return toMoney(m).currency;
}

/**
 * The currency of a value, or `null` if it is not money at all. Never throws.
 *
 * `currencyOf` answers by throwing, which is right for a caller that *expects* money and wrong for
 * one that must classify arbitrary values. Two modules independently needed the second behaviour
 * and each wrote its own idiom: the read path (`runtime/read/`) had to decide, for every string
 * field of every document, whether it is an amount — and kept a parallel recogniser bound by a
 * conformance test to stop it drifting from this file; the live layer (`runtime/live/session.js`)
 * wrapped `currencyOf` in a six-line try/catch.
 *
 * Both were reasonable, and both were the same missing function. It is added here rather than
 * copied a third time, because a second implementation of monetary parsing is exactly the drift
 * this module exists to prevent — and because "do not re-derive what you can ask" has already cost
 * this project three defects.
 *
 * @param {unknown} value
 * @returns {string|null} the ISO 4217 code, or null
 */
export function currencyOfOrNull(value) {
  try {
    return toMoney(value).currency;
  } catch {
    return null;
  }
}

/**
 * True when `value` is a canonical money token or a `Money`. Never throws.
 * The predicate form of `currencyOfOrNull`, for callers that only need to classify.
 * @param {unknown} value
 */
export function looksLikeMoney(value) {
  return currencyOfOrNull(value) !== null;
}

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/**
 * Two amounts must be in the same currency before they may be compared or combined.
 * FD-1: mixed currencies do not add. Conversion is a modelled act that carries its rate and
 * date — see `convert`.
 */
function sameCurrency(a, b, operation) {
  if (a.currency !== b.currency) {
    throw new MoneyError('currency-mismatch',
      `refusing to ${operation} ${a.toString()} and ${b.toString()}: mixed currencies never combine silently. Convert one side first with convert(), and record the rate and the date on the document (FD-1).`);
  }
}

/** No default rounding mode exists. A caller who omits it gets this. */
function requireRounding(mode, what) {
  if (mode === undefined || mode === null) {
    throw new MoneyError('rounding-required',
      `${what} needs an explicit rounding mode — one of ${ROUNDING_MODES.join(', ')}. There is no default: silent rounding policy is how cents disappear.`);
  }
  if (!isRoundingMode(mode)) {
    throw new MoneyError('unknown-rounding',
      `unknown rounding mode ${describe(mode)}; known modes are ${ROUNDING_MODES.join(', ')}`);
  }
  return mode;
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

/** @param {unknown} a @param {unknown} b @returns {Money} */
export function add(a, b) {
  const x = toMoney(a);
  const y = toMoney(b);
  sameCurrency(x, y, 'add');
  return new Money(x.minor + y.minor, x.currency);
}

/** @param {unknown} a @param {unknown} b @returns {Money} */
export function subtract(a, b) {
  const x = toMoney(a);
  const y = toMoney(b);
  sameCurrency(x, y, 'subtract');
  return new Money(x.minor - y.minor, x.currency);
}

/** @param {unknown} m @returns {Money} */
export function negate(m) {
  const x = toMoney(m);
  return new Money(-x.minor, x.currency);
}

/** @param {unknown} m @returns {Money} */
export function abs(m) {
  const x = toMoney(m);
  return x.minor < 0n ? new Money(-x.minor, x.currency) : x;
}

/**
 * Multiply by an **exact** factor.
 *
 * The factor is a count, a rational or an exact decimal — never a float:
 *   `multiply(price, 3n)`                          three pieces
 *   `multiply(net, "1.19", 'half-up')`             gross at 19 %
 *   `multiply(total, { numerator: 1n, denominator: 3n }, 'half-even')`   one third
 *
 * A rounding mode is required exactly when the product does not land on a whole minor unit.
 * When it does, no policy is involved and none is demanded.
 *
 * @param {unknown} m
 * @param {bigint|string|{numerator: bigint, denominator: bigint}|[bigint, bigint]} factor
 * @param {string} [rounding]
 * @returns {Money}
 */
export function multiply(m, factor, rounding) {
  const x = toMoney(m);
  const f = parseFactor(factor);
  if (f.ok !== true) return fail(f);

  const numerator = x.minor * f.num;
  if (numerator % f.den === 0n) {
    // Exact. If the caller named a mode anyway, honour the naming but validate it.
    if (rounding !== undefined && rounding !== null) requireRounding(rounding, 'multiply');
    return new Money(numerator / f.den, x.currency);
  }
  const mode = requireRounding(rounding, `multiplying ${x.toString()} by this factor (the product is not a whole ${x.currency} minor unit)`);
  return new Money(divRound(numerator, f.den, mode), x.currency);
}

/**
 * A percentage of an amount — VAT, a discount, a provision.
 * The rate is an exact decimal string (`"19"`, `"19.5"`, `"7"`, `"0"`) or a BigInt (`19n`).
 * A rounding mode is **always** required: this is where cents are made and lost.
 *
 * @param {unknown} m
 * @param {string|bigint} rateText
 * @param {string} rounding
 * @returns {Money}
 */
export function percentage(m, rateText, rounding) {
  const x = toMoney(m);
  const r = parseRate(rateText);
  if (r.ok !== true) return fail(r);
  const mode = requireRounding(rounding, 'percentage');
  return new Money(divRound(x.minor * r.num, r.den, mode), x.currency);
}

/**
 * Round to a coarser decimal scale, keeping the currency's own scale in the result:
 * `round(money("4999.99 EUR"), 0, 'half-up')` → `5000.00 EUR`.
 *
 * @param {unknown} m
 * @param {number|bigint} scale target decimal places, 0 … the currency's scale
 * @param {string} rounding
 * @returns {Money}
 */
export function round(m, scale, rounding) {
  const x = toMoney(m);
  const target = toExactInteger(scale);
  if (target === null) {
    throw new MoneyError('bad-scale', `a target scale must be a whole number of decimal places, got ${describe(scale)}`);
  }
  const own = BigInt(CURRENCIES[x.currency]);
  if (target < 0n || target > own) {
    throw new MoneyError('bad-scale', `cannot round ${x.currency} to ${target.toString()} decimal places; ${x.currency} has ${own.toString()} (rounding to a finer scale than the currency has is meaningless)`);
  }
  const mode = requireRounding(rounding, 'round');
  const step = pow10(own - target);
  return new Money(divRound(x.minor, step, mode) * step, x.currency);
}

// ---------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------

/**
 * −1, 0 or 1. Refuses mixed currencies: `10.00 EUR` is not comparable with `10.00 USD` without
 * a rate, and inventing one inside a comparison is how a threshold rule silently passes.
 * @param {unknown} a @param {unknown} b @returns {number}
 */
export function compare(a, b) {
  const x = toMoney(a);
  const y = toMoney(b);
  sameCurrency(x, y, 'compare');
  if (x.minor < y.minor) return -1;
  if (x.minor > y.minor) return 1;
  return 0;
}

/** Same currency and same amount. @param {unknown} a @param {unknown} b */
export function equals(a, b) {
  const x = toMoney(a);
  const y = toMoney(b);
  return x.currency === y.currency && x.minor === y.minor;
}

/** @param {unknown} m */
export function isZero(m) {
  return toMoney(m).minor === 0n;
}

/** @param {unknown} m @returns {number} −1, 0 or 1 */
export function sign(m) {
  const x = toMoney(m);
  if (x.minor < 0n) return -1;
  if (x.minor > 0n) return 1;
  return 0;
}

/** @param {unknown} m */
export function isNegative(m) {
  return toMoney(m).minor < 0n;
}

/** @param {unknown} m */
export function isPositive(m) {
  return toMoney(m).minor > 0n;
}

/** @param {unknown} a @param {unknown} b @returns {Money} */
export function min(a, b) {
  return compare(a, b) <= 0 ? toMoney(a) : toMoney(b);
}

/** @param {unknown} a @param {unknown} b @returns {Money} */
export function max(a, b) {
  return compare(a, b) >= 0 ? toMoney(a) : toMoney(b);
}

// ---------------------------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------------------------

/**
 * Sum a list. Never `NaN` — that is not a thing a BigInt can be.
 *
 * An empty list has no currency of its own, so an empty sum needs one stated: `sum([], 'EUR')`.
 * `sum([])` throws rather than returning a zero whose currency the caller guessed. This is
 * FD-5's `sum of <field> over <entity> where <condition>` primitive: a filter that matches
 * nothing is the normal case, and it must produce `0.00 EUR`, not `0`, and not `undefined`.
 *
 * @param {Iterable<unknown>} list
 * @param {string} [currency] required when the list is empty; checked against every element
 * @returns {Money}
 */
export function sum(list, currency) {
  if (list === null || typeof list !== 'object' || typeof (/** @type {any} */ (list)[Symbol.iterator]) !== 'function') {
    throw new MoneyError('not-iterable', `sum needs a list of monetary values, got ${describe(list)}`);
  }
  if (currency !== undefined) scaleOf(currency);

  let total = null;
  let index = 0;
  for (const item of list) {
    let value;
    try {
      value = toMoney(item);
    } catch (e) {
      if (e instanceof MoneyError) {
        throw new MoneyError(e.code, `element ${String(index)} of the sum: ${e.message}`);
      }
      throw e;
    }
    if (currency !== undefined && value.currency !== currency) {
      throw new MoneyError('currency-mismatch',
        `element ${String(index)} of the sum is ${value.toString()} but the sum was declared in ${currency}: mixed currencies never combine silently (FD-1)`);
    }
    if (total === null) {
      total = value;
    } else {
      sameCurrency(total, value, 'sum');
      total = new Money(total.minor + value.minor, total.currency);
    }
    index++;
  }

  if (total === null) {
    if (currency === undefined) {
      throw new MoneyError('currency-required',
        'an empty sum has no currency of its own — call sum([], "EUR") and state it. Guessing a currency for an empty total is how a report shows 0 in the wrong money.');
    }
    return new Money(0n, currency);
  }
  return total;
}

/**
 * Split an amount across weights so the parts sum **exactly** to the whole. Largest remainder.
 *
 *     allocate(money("10.00 EUR"), 3n, 'half-up')
 *       → ["3.34 EUR", "3.33 EUR", "3.33 EUR"]         3.34 + 3.33 + 3.33 = 10.00, always
 *
 *     allocate(vat, ["120.500", "8.000"], 'half-up')   VAT across invoice lines by weight
 *
 * Weights are BigInt or non-negative exact decimal strings; a BigInt in place of the array
 * means that many equal parts. A zero weight receives zero and never absorbs a residual.
 * The invariant is checked before returning, not merely tested: if the parts did not sum to
 * the whole this throws instead of handing back a set of numbers that does not add up.
 *
 * @param {unknown} m
 * @param {bigint|Array<bigint|string>} weights
 * @param {string} rounding
 * @returns {Money[]}
 */
export function allocate(m, weights, rounding) {
  const x = toMoney(m);
  const w = parseWeights(weights);
  if (w.ok !== true) return fail(w);
  const mode = requireRounding(rounding, 'allocate');

  let totalWeight = 0n;
  for (const one of w.w) totalWeight += one;
  if (totalWeight === 0n) {
    throw new MoneyError('zero-weight-total', 'the weights sum to zero, so there is no share to allocate by');
  }

  let parts;
  try {
    parts = allocateUnits(x.minor, w.w, mode);
  } catch (e) {
    throw new MoneyError('allocation-failed', `allocating ${x.toString()} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parts.map((minor) => new Money(minor, x.currency));
}

// ---------------------------------------------------------------------------------------------
// Conversion — the one correct primitive, and it is the caller's job to record the rate
// ---------------------------------------------------------------------------------------------

/**
 * Convert an amount to another currency at an exact, caller-supplied rate.
 *
 * **Conversion is a modelled business act, not an arithmetic convenience.** FD-1 is explicit:
 * a conversion carries its rate and its date, because that is what an auditor must be able to
 * see. This function does the arithmetic correctly and nothing else — it does not know today's
 * rate, it does not fetch one, and it does not remember the one you passed.
 *
 * The **caller must record**, on the document, in the same commit:
 *   - the source amount and currency (the original token, unmodified),
 *   - the rate used, as the exact decimal string passed here,
 *   - the rate's date and its source (ECB reference rate of 2027-03-14, contract rate, …),
 *   - the rounding mode applied.
 * A converted amount without those four facts is an unexplained number in a ledger.
 *
 *     convert(money("1000.00 EUR"), 'JPY', "162.5", 'half-up')  → 162500 JPY
 *     convert(money("100.00 USD"), 'EUR', "0.9231", 'half-up')  →   92.31 EUR
 *
 * The rate is expressed as *units of the target currency per one unit of the source currency*,
 * in major units — the way every published rate table writes it. The differing minor-unit
 * scales of the two currencies are handled here; do not pre-scale the rate.
 *
 * @param {unknown} m
 * @param {string} toCurrency
 * @param {string|bigint|{numerator: bigint, denominator: bigint}|[bigint, bigint]} rateText
 * @param {string} rounding
 * @returns {Money}
 */
export function convert(m, toCurrency, rateText, rounding) {
  const x = toMoney(m);
  const toScale = BigInt(scaleOf(toCurrency));
  const fromScale = BigInt(CURRENCIES[x.currency]);
  const f = parseFactor(rateText);
  if (f.ok !== true) return fail(f);
  if (f.num < 0n) {
    throw new MoneyError('negative-rate', 'an exchange rate cannot be negative');
  }
  const mode = requireRounding(rounding, 'convert');

  // minor_to = minor_from × rate × 10^(scale_to − scale_from), all exact, then rounded once.
  let numerator = x.minor * f.num;
  let denominator = f.den;
  if (toScale >= fromScale) {
    numerator *= pow10(toScale - fromScale);
  } else {
    denominator *= pow10(fromScale - toScale);
  }
  return new Money(divRound(numerator, denominator, mode), toCurrency);
}

/**
 * Split a gross amount into net and VAT for a given rate — the calculation every European
 * invoice, receipt and OSS return needs, and the one most often written wrong.
 *
 * `net = gross × 100 / (100 + rate)`, rounded once with the declared mode; `vat = gross − net`,
 * so **net + vat === gross, exactly, by construction** rather than by hope.
 *
 * @param {unknown} m gross amount
 * @param {string|bigint} rateText e.g. "19"
 * @param {string} rounding
 * @returns {{ net: Money, vat: Money, gross: Money }}
 */
export function splitGross(m, rateText, rounding) {
  const gross = toMoney(m);
  const r = parseRate(rateText);
  if (r.ok !== true) return fail(r);
  const mode = requireRounding(rounding, 'splitGross');
  // rate = r.num / r.den  (already divided by 100), so net = gross / (1 + rate)
  //      = gross × r.den / (r.den + r.num)
  const denominator = r.den + r.num;
  if (denominator <= 0n) {
    throw new MoneyError('bad-rate', `a VAT rate of ${String(rateText)} % would make the net amount undefined`);
  }
  const net = new Money(divRound(gross.minor * r.den, denominator, mode), gross.currency);
  const vat = new Money(gross.minor - net.minor, gross.currency);
  return { net, vat, gross };
}
