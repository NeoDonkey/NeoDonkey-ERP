/**
 * runtime/polism/money.js — polism's money seam (FD-1, grammar.md §19).
 *
 * In grammar version 1 `money` was "a plain number", so 19 % VAT on 4 999.99 evaluated to
 * 949.9981. That was the second of the three findings that reorganised the roadmap. This file is
 * why it cannot happen again inside the rule engine.
 *
 * **All arithmetic here is agent M's `runtime/money/`.** Not a copy of it, not a reimplementation
 * of it, not a fallback — an import. There is exactly one exact-decimal implementation in this
 * runtime and this file is not it. What this file adds is the two things the *grammar* needs and
 * a general money module correctly refuses to decide:
 *
 *  1. **Diagnostics instead of exceptions.** polism never throws: an unreadable value becomes a
 *     `{ ok: false, reason }` that turns into a refusal quoting the field declaration
 *     (Principle 6). `runtime/money/` throws `MoneyError`, which is right for its callers and
 *     wrong for a parser.
 *  2. **The currency-free zero** (§19.3). `sum of <money field>` over an empty set has no
 *     currency to report, and `runtime/money/`'s `sum([])` refuses to guess one — correctly.
 *     But `count of` and `sum of` must be *total* functions, or a trial balance over an account
 *     with no postings would be a refusal rather than zero. So the grammar defines a zero that
 *     belongs to every currency at once, and it lives here, in the grammar's layer, where it is
 *     the grammar's decision and not the money module's.
 *
 * THE ONE RULE: **no `Number` ever touches a monetary value.** No `parseFloat`, no `Number()`,
 * no `Math.*`, no `+` or `/` on an amount. `Number` appears below only as a *scale* — a count of
 * decimal digits. A `parseFloat` anywhere near a monetary value is a release blocker (FD-1).
 *
 * Zero dependencies. No `node:*`. No `Date.now()`, no `Math.random()`. Pure functions.
 */

import {
  money as parseCanonical,
  fromMinor,
  toMinor,
  currencyOf,
  toString as canonical,
  scaleOf,
  add as exactAdd,
  negate as exactNegate,
  compare as exactCompare,
  MoneyError,
} from '../money/money.js';
import { parseScaledToken } from '../money/decimal.js';

/**
 * @typedef {{ minor: bigint, currency: string|null }} Amount
 *   `currency: null` is the **currency-free zero** (§19.3) — the only amount without a currency,
 *   produced by an empty `sum of`. Its `minor` is always `0n`. Everything else is agent M's
 *   `Money`, or the `{ minor, currency }` shape a `structuredClone` leaves behind, which
 *   `runtime/money/` accepts interchangeably.
 */

/** The currency-free zero. Belongs to every currency at once; stored in no document. */
export const ZERO = Object.freeze({ minor: 0n, currency: null });

export const isCurrencyFree = (m) => m.currency === null;
export const isZeroAmount = (m) => m.minor === 0n;

/** How many decimal digits this currency is written with. Refusal, not a guess, for unknown codes. */
export function scaleFor(code) {
  try {
    return { ok: true, scale: scaleOf(code) };
  } catch (e) {
    return { ok: false, reason: reasonOf(e) };
  }
}

/**
 * Read a monetary value out of a document or a model literal.
 * @param {unknown} text e.g. `"4999.99 EUR"`
 * @returns {{ ok: true, amount: Amount } | { ok: false, reason: string, expected: string }}
 */
export function readMoney(text) {
  try {
    const m = parseCanonical(text);
    return { ok: true, amount: { minor: toMinor(m), currency: currencyOf(m) } };
  } catch (e) {
    return {
      ok: false,
      reason: reasonOf(e),
      expected: 'an amount and its currency in one string, for example "4999.99 EUR" — '
        + 'FD-1: exact decimals, no float, currency always present',
    };
  }
}

/** True iff `text` is exactly FD-1's canonical form. */
export function isCanonicalMoney(text) {
  return readMoney(text).ok === true;
}

/**
 * The canonical string of an amount. The currency-free zero has none — it is a computed
 * intermediate, never a stored value (§19.3) — so this returns `null` for it.
 * @param {Amount} m @returns {string|null}
 */
export function writeMoney(m) {
  if (m.currency === null) return null;
  return canonical(fromMinor(m.minor, m.currency));
}

/** Human text for an amount inside a diagnostic. */
export const describeAmount = (m) => (m.currency === null ? '0 (no currency)' : `"${writeMoney(m)}"`);

/**
 * Scale a plain decimal *string* to a currency's minor units, exactly or not at all.
 * This is what keeps a version-1 condition such as `payable-amount > 0` working (§19.2): the
 * literal's **source text** is scaled, never its `Number`.
 *
 * @param {string} text a decimal like "0", "-3", "1000.50"
 * @param {string} currency
 * @returns {{ ok: true, minor: bigint } | { ok: false, reason: string }}
 */
export function scaleDecimalFor(text, currency) {
  const sc = scaleFor(currency);
  if (!sc.ok) return { ok: false, reason: sc.reason };
  const scale = sc.scale;
  const raw = String(text).trim();
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!m) return { ok: false, reason: `"${raw}" is not a plain decimal number` };
  const [, sign, whole, frac] = m;
  const digits = frac === undefined ? '' : frac;
  let padded;
  if (digits.length <= scale) {
    padded = digits.padEnd(scale, '0');
  } else {
    // More decimals than the currency has. Exact only if every extra digit is a zero; otherwise
    // this is refused rather than rounded, because nobody declared a rounding rule (FD-1).
    if (!/^0*$/.test(digits.slice(scale))) {
      return {
        ok: false,
        reason: `${raw} cannot be written exactly in ${currency}, which has ${scale} decimal`
          + `${scale === 1 ? '' : 's'}. Rounding is declared, never implicit (FD-1).`,
      };
    }
    padded = digits.slice(0, scale);
  }
  const minor = BigInt(whole + padded);
  return { ok: true, minor: sign === '-' ? -minor : minor };
}

/**
 * Parse the two-token money literal of the model text (`1000.00 EUR`) or its quoted form.
 * Used only by the parser; the check is the same canonical one.
 */
export function readMoneyLiteral(amountText, codeText) {
  const r = parseScaledToken(`${amountText} ${codeText}`, {
    symbolRe: /^[A-Z]{3}$/,
    caseRe: /^[A-Za-z]{3}$/,
    scaleFor: (s) => { const g = scaleFor(s); return g.ok ? g.scale : undefined; },
    symbolName: 'currency',
    example: '4999.99 EUR',
  });
  if (r.ok !== true) return { ok: false, reason: r.message };
  return { ok: true, amount: { minor: r.units, currency: r.symbol }, text: `${amountText} ${codeText}` };
}

/**
 * Compare two amounts.
 * @returns {{ ok: true, cmp: -1|0|1 } | { ok: false, reason: string }}
 *   Mixed currencies do not compare (FD-1) — unless one side is the currency-free zero.
 */
export function compareAmounts(a, b) {
  if (a.currency === null || b.currency === null) {
    // Zero belongs to every currency, so the comparison is by magnitude and is exact.
    const cmp = a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
    return { ok: true, cmp };
  }
  try {
    const cmp = exactCompare(fromMinor(a.minor, a.currency), fromMinor(b.minor, b.currency));
    return { ok: true, cmp: cmp < 0 ? -1 : cmp > 0 ? 1 : 0 };
  } catch (e) {
    return { ok: false, reason: mixedReason(a, b, e, 'compared') };
  }
}

/**
 * Add two amounts, exactly.
 * @returns {{ ok: true, amount: Amount } | { ok: false, reason: string }}
 */
export function addAmounts(a, b) {
  if (a.currency === null) return { ok: true, amount: b.currency === null ? ZERO : { minor: b.minor, currency: b.currency } };
  if (b.currency === null) return { ok: true, amount: { minor: a.minor, currency: a.currency } };
  try {
    const sum = exactAdd(fromMinor(a.minor, a.currency), fromMinor(b.minor, b.currency));
    return { ok: true, amount: { minor: toMinor(sum), currency: currencyOf(sum) } };
  } catch (e) {
    return { ok: false, reason: mixedReason(a, b, e, 'added') };
  }
}

/** Negate, exactly. The currency-free zero negates to itself. */
export function negateAmount(m) {
  if (m.currency === null) return ZERO;
  const n = exactNegate(fromMinor(m.minor, m.currency));
  return { minor: toMinor(n), currency: currencyOf(n) };
}

/** Subtract, exactly. Mixed currencies are refused, exactly as adding them is. */
export const subtractAmounts = (a, b) => addAmounts(a, negateAmount(b));

function mixedReason(a, b, e, verb) {
  if (a.currency !== b.currency) {
    return `${describeAmount(a)} is in ${a.currency} and ${describeAmount(b)} is in ${b.currency}. `
      + `Amounts in different currencies are not ${verb} and never converted on the runtime's own `
      + 'initiative — a conversion is a modelled act carrying its rate and its date, because that '
      + 'is what an auditor has to be able to see (FD-1).';
  }
  return reasonOf(e);
}

function reasonOf(e) {
  if (e instanceof MoneyError) return e.message;
  return e && e.message ? String(e.message) : String(e);
}
