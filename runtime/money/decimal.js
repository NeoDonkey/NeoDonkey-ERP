/**
 * runtime/money/decimal.js — the exact-decimal machinery shared by money.js and quantity.js.
 *
 * FD-1 (docs/ROADMAP-V1.md): a monetary value is an exact decimal with its currency, carried
 * on the wire as one string token, and computed on internally as `BigInt` minor units.
 * **No `Number` ever touches a value.** That rule is enforced here structurally: there is not
 * one floating-point operation in this file, and `test/m-money.test.js` greps these sources to
 * prove it stays that way.
 *
 * Why one shared file: money and quantity must agree, byte for byte, on what a decimal token
 * looks like and on how a remainder is rounded. Two implementations of "half-up" is one
 * implementation too many — this is the single place an auditor has to read.
 *
 * Nothing in here throws a typed domain error. Parsers return a result record
 * (`{ ok: true, ... }` / `{ ok: false, code, message }`) so that money.js can raise
 * `MoneyError` and quantity.js can raise `QuantityError` from the same grammar. The only
 * exceptions raised here are `RangeError`s for programmer misuse of an internal helper.
 *
 * Zero dependencies. No `node:*`. Pure functions. Runs unchanged in Node 22+ and in a browser.
 */

// ---------------------------------------------------------------------------------------------
// Powers of ten, as BigInt. The one place a scale becomes a divisor.
// ---------------------------------------------------------------------------------------------

const POW10_CACHE = new Map();

/**
 * 10^n as a BigInt. `n` is a BigInt digit count, never a monetary value.
 * @param {bigint} n
 * @returns {bigint}
 */
export function pow10(n) {
  if (typeof n !== 'bigint') throw new RangeError('pow10 expects a bigint exponent');
  if (n < 0n) throw new RangeError('pow10 expects a non-negative exponent');
  const hit = POW10_CACHE.get(n);
  if (hit !== undefined) return hit;
  const p = 10n ** n;
  if (n <= 64n) POW10_CACHE.set(n, p);
  return p;
}

/**
 * Coerce a digit count (a scale, an exponent, a part count) to BigInt, exactly.
 * `BigInt(2.5)` throws and `BigInt(2)` is exact, so a non-integer can never slip through as a
 * scale. Strings are deliberately **not** accepted: `BigInt('')` is `0n` and `BigInt(' 2 ')` is
 * `2n`, and a scale that silently defaults to zero is a rounding policy nobody declared.
 * @param {number|bigint} x
 * @returns {bigint|null} null when `x` is not an exact integer
 */
export function toExactInteger(x) {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') {
    try {
      return BigInt(x);
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rounding. Declared, never implicit (FD-1).
// ---------------------------------------------------------------------------------------------

/**
 * The rounding modes the runtime knows. A model states which one applies; the runtime applies
 * exactly that one. There is deliberately **no default** — see `requireRoundingMode`.
 *
 * - `half-up`    ties away from zero. Commercial rounding, the European default
 *                (kaufmännisches Runden): 2.5 → 3, −2.5 → −3.
 * - `half-down`  ties toward zero: 2.5 → 2, −2.5 → −2.
 * - `half-even`  ties to the even neighbour. Banker's rounding, IEEE 754's default and what
 *                several statistical and interest conventions require: 2.5 → 2, 3.5 → 4.
 * - `down`       truncate toward zero: 2.9 → 2, −2.9 → −2.
 * - `up`         away from zero: 2.1 → 3, −2.1 → −3.
 * - `floor`      toward −∞: 2.9 → 2, −2.1 → −3.
 * - `ceiling`    toward +∞: 2.1 → 3, −2.9 → −2.
 */
export const ROUNDING_MODES = Object.freeze([
  'half-up', 'half-down', 'half-even', 'down', 'up', 'floor', 'ceiling',
]);

const ROUNDING_SET = new Set(ROUNDING_MODES);

/** @param {unknown} mode */
export function isRoundingMode(mode) {
  return typeof mode === 'string' && ROUNDING_SET.has(mode);
}

/**
 * Divide `n` by `d` exactly, then resolve the remainder with the named mode.
 * `d` must be positive. Both arguments are BigInt; there is no float path.
 *
 * @param {bigint} n numerator (may be negative)
 * @param {bigint} d denominator, strictly positive
 * @param {string} mode one of ROUNDING_MODES — validated by the caller
 * @returns {bigint}
 */
export function divRound(n, d, mode) {
  if (typeof n !== 'bigint' || typeof d !== 'bigint') {
    throw new RangeError('divRound operates on BigInt only');
  }
  if (d <= 0n) throw new RangeError('divRound requires a positive denominator');

  const q = n / d;          // BigInt division truncates toward zero
  const r = n % d;          // remainder carries the sign of n
  if (r === 0n) return q;   // exact: no policy needed, no policy applied

  const negative = r < 0n;
  const magnitude = negative ? -r : r;
  const step = negative ? -1n : 1n;   // one unit away from zero
  const twice = magnitude * 2n;       // compare 2·|r| with d instead of dividing

  switch (mode) {
    case 'down': return q;
    case 'up': return q + step;
    case 'floor': return negative ? q - 1n : q;
    case 'ceiling': return negative ? q : q + 1n;
    case 'half-up': return twice >= d ? q + step : q;
    case 'half-down': return twice > d ? q + step : q;
    case 'half-even': {
      if (twice > d) return q + step;
      if (twice < d) return q;
      return q % 2n === 0n ? q : q + step;
    }
    default:
      throw new RangeError(`divRound got an unvalidated rounding mode: ${String(mode)}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Result records
// ---------------------------------------------------------------------------------------------

/** @param {string} code @param {string} message */
function bad(code, message) {
  return { ok: false, code, message };
}

/** Describe a rejected input for an error message, without ever trusting its `toString`. */
export function describe(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const t = typeof value;
  if (t === 'string') return `the string ${JSON.stringify(value)}`;
  if (t === 'number') return `the Number ${JSON.stringify(value)} — JSON numbers are IEEE 754 doubles, which is exactly what FD-1 forbids`;
  if (t === 'bigint') return `the BigInt ${value.toString()}n (use fromMinor to build a value from minor units)`;
  if (t === 'boolean') return `the boolean ${value ? 'true' : 'false'}`;
  if (t === 'object') return `an object of type ${Object.prototype.toString.call(value)}`;
  return `a value of type ${t}`;
}

// ---------------------------------------------------------------------------------------------
// The token grammar: "<optional -><digits>[.<exactly `scale` digits>] <symbol>"
// ---------------------------------------------------------------------------------------------

const AMOUNT_RE = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
/** Any whitespace that is not a plain U+0020 — tab, newline, NBSP, thin space, ideographic space. */
const NON_SPACE_WHITESPACE_RE = /[^\S\x20]/;

/**
 * Parse one canonical token into exact scaled integer units.
 *
 * The grammar is FD-1's, applied verbatim: optional `-`, digits with no leading zero, an
 * optional `.` followed by *exactly* the scale the symbol declares, a single U+0020, the
 * symbol. No `+`, no exponent, no thousands separator, no comma, no surrounding whitespace,
 * no negative zero — every deviation gets its own error code so a caller can tell an
 * unknown currency from a mis-scaled amount without string-matching a message.
 *
 * @param {unknown} text
 * @param {{ symbolRe: RegExp, caseRe: RegExp|null, scaleFor: (s: string) => number|undefined,
 *           symbolName: string, example: string }} opts
 * @returns {{ ok: true, units: bigint, symbol: string, scale: number }
 *          | { ok: false, code: string, message: string }}
 */
export function parseScaledToken(text, opts) {
  const { symbolRe, caseRe, scaleFor, symbolName, example } = opts;

  if (typeof text !== 'string') {
    return bad('not-a-string', `expected a string token like "${example}", got ${describe(text)}`);
  }
  if (text === '') return bad('empty', `expected a token like "${example}", got an empty string`);
  if (/^\s/.test(text)) return bad('leading-space', `leading whitespace in ${JSON.stringify(text)}: the canonical form has none`);
  if (/\s$/.test(text)) return bad('trailing-space', `trailing whitespace in ${JSON.stringify(text)}: the canonical form has none`);
  if (NON_SPACE_WHITESPACE_RE.test(text)) {
    return bad('bad-whitespace', `${JSON.stringify(text)} separates amount and ${symbolName} with something other than a single space`);
  }

  const parts = text.split(' ');
  if (parts.length === 1) {
    return bad('missing-space', `${JSON.stringify(text)} is missing the single space between amount and ${symbolName} (expected e.g. "${example}")`);
  }
  if (parts.length > 2) {
    return bad('extra-space', `${JSON.stringify(text)} has more than one space; the canonical form has exactly one`);
  }

  const [amount, symbol] = parts;

  // --- the symbol ------------------------------------------------------------------------
  if (!symbolRe.test(symbol)) {
    if (caseRe !== null && caseRe.test(symbol)) {
      return bad('symbol-case', `${symbolName} ${JSON.stringify(symbol)} must be upper case (write ${JSON.stringify(symbol.toUpperCase())})`);
    }
    return bad('bad-symbol', `${JSON.stringify(symbol)} is not a well-formed ${symbolName} code`);
  }
  const scale = scaleFor(symbol);
  if (scale === undefined) {
    return bad('unknown-symbol', `unknown ${symbolName} ${JSON.stringify(symbol)}: no scale is declared for it, and a scale is never guessed`);
  }

  // --- the amount ------------------------------------------------------------------------
  if (amount === '') return bad('no-digits', `${JSON.stringify(text)} has no amount before the ${symbolName}`);
  if (amount === 'NaN' || amount === 'Infinity' || amount === '-Infinity' || amount === '+Infinity') {
    return bad('not-finite', `${JSON.stringify(amount)} is not a finite decimal; a value is always finite`);
  }
  if (amount.startsWith('+')) {
    return bad('leading-plus', `${JSON.stringify(text)} has a leading "+"; the canonical form omits it`);
  }
  if (amount.includes(',')) {
    return bad('decimal-comma', `${JSON.stringify(text)} uses a comma; the canonical form uses "." and no thousands separators (a German UI still renders 1.234,56 — only the stored token is canonical)`);
  }
  if (/[eE]/.test(amount)) {
    return bad('exponent', `${JSON.stringify(text)} uses exponent notation; the canonical form is plain digits`);
  }

  const m = AMOUNT_RE.exec(amount);
  if (m === null) {
    if (amount.endsWith('.')) {
      return bad('trailing-dot', `${JSON.stringify(text)} ends the amount with "."; the canonical form has ${scale === 0 ? 'no decimal point at all' : `exactly ${String(scale)} decimal digits`}`);
    }
    if (/^-?0[0-9]/.test(amount)) {
      return bad('leading-zero', `${JSON.stringify(text)} has a leading zero; the canonical form has exactly one representation per value`);
    }
    if (amount.startsWith('.')) {
      return bad('no-integer-digit', `${JSON.stringify(text)} has no digit before the decimal point (write "0.…")`);
    }
    if (amount === '-') return bad('no-digits', `${JSON.stringify(text)} has a sign but no digits`);
    return bad('syntax', `${JSON.stringify(text)} is not a canonical amount (optional "-", digits, optional "." and digits)`);
  }

  const [, sign, intDigits, fracDigits = ''] = m;

  if (fracDigits.length !== scale) {
    return bad('wrong-scale', `${JSON.stringify(text)} has ${String(fracDigits.length)} decimal digit(s) but ${symbol} has a scale of ${String(scale)} — write ${JSON.stringify(rescaleForMessage(sign, intDigits, fracDigits, scale) + ' ' + symbol)}`);
  }

  const digits = intDigits + fracDigits;
  const magnitude = BigInt(digits);

  if (sign === '-' && magnitude === 0n) {
    return bad('negative-zero', `${JSON.stringify(text)} is a negative zero; zero has exactly one canonical form (${JSON.stringify(formatScaled(0n, scale) + ' ' + symbol)})`);
  }

  return { ok: true, units: sign === '-' ? -magnitude : magnitude, symbol, scale };
}

/** Best-effort "what you should have written" for a wrong-scale message. Never used for maths. */
function rescaleForMessage(sign, intDigits, fracDigits, scale) {
  if (scale === 0) return sign + intDigits;
  const padded = (fracDigits + '000000000000000000000000').slice(0, scale);
  return sign + intDigits + '.' + padded;
}

/**
 * Render scaled integer units back to the canonical decimal string (no symbol).
 * Pure string and BigInt work: no `toFixed`, no float, no locale.
 *
 * @param {bigint} units
 * @param {number|bigint} scale
 * @returns {string}
 */
export function formatScaled(units, scale) {
  const s = toExactInteger(scale);
  if (s === null || s < 0n) throw new RangeError('formatScaled requires a non-negative integer scale');
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const sign = negative ? '-' : '';
  if (s === 0n) return sign + magnitude.toString();
  const p = pow10(s);
  const whole = magnitude / p;
  const frac = magnitude % p;
  const fracDigits = frac.toString();
  // padStart wants a Number length; we build the padding with BigInt counting instead, so that
  // no Number conversion appears anywhere on a monetary path.
  let padding = '';
  for (let i = BigInt(fracDigits.length); i < s; i += 1n) padding += '0';
  return sign + whole.toString() + '.' + padding + fracDigits;
}

// ---------------------------------------------------------------------------------------------
// Factors, rates and weights — all exact, never a float
// ---------------------------------------------------------------------------------------------

const DECIMAL_RE = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const UNSIGNED_DECIMAL_RE = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

/**
 * Parse a multiplication factor into an exact rational `num / den`.
 *
 * Accepted, all exact:
 *   - `bigint`                       — `3n`, a count of units
 *   - exact decimal `string`         — `"1.19"`, `"-0.5"`, `"19"`
 *   - `{ numerator, denominator }`   — BigInt ratio, e.g. one third as `{1n, 3n}`
 *   - `[numerator, denominator]`     — the same, positionally
 *
 * Refused, loudly: `Number`. `1.19` as a double is 1.1899999999999999023003738329909928143024444580078125,
 * and a factor is the one place where that error compounds across every line of an invoice.
 *
 * @param {unknown} factor
 * @returns {{ ok: true, num: bigint, den: bigint } | { ok: false, code: string, message: string }}
 */
export function parseFactor(factor) {
  if (typeof factor === 'number') {
    return bad('number-factor', `a factor must not be a Number (got ${describe(factor)}). Pass an exact decimal string like "1.19", a BigInt like 3n, or a ratio { numerator: 1n, denominator: 3n }.`);
  }
  if (typeof factor === 'bigint') return { ok: true, num: factor, den: 1n };

  if (typeof factor === 'string') {
    const m = DECIMAL_RE.exec(factor);
    if (m === null) {
      return bad('bad-factor', `${JSON.stringify(factor)} is not an exact decimal factor (optional "-", digits, optional "." and digits — no exponent, no comma, no leading "+")`);
    }
    const [, sign, intDigits, fracDigits = ''] = m;
    const magnitude = BigInt(intDigits + fracDigits);
    return {
      ok: true,
      num: sign === '-' ? -magnitude : magnitude,
      den: pow10(BigInt(fracDigits.length)),
    };
  }

  if (Array.isArray(factor) && factor.length === 2) {
    return ratio(factor[0], factor[1]);
  }
  if (factor !== null && typeof factor === 'object'
      && 'numerator' in factor && 'denominator' in factor) {
    return ratio(factor.numerator, factor.denominator);
  }

  return bad('bad-factor', `cannot read a factor from ${describe(factor)}`);
}

function ratio(num, den) {
  if (typeof num !== 'bigint' || typeof den !== 'bigint') {
    return bad('bad-factor', 'a ratio factor needs BigInt numerator and denominator');
  }
  if (den === 0n) return bad('zero-denominator', 'a ratio factor cannot have denominator 0n');
  return den < 0n ? { ok: true, num: -num, den: -den } : { ok: true, num, den };
}

/**
 * Parse a percentage rate ("19", "19.5", "7", "0") into the exact rational rate/100.
 * A BigInt rate (`19n`) is accepted. A Number is refused. Negative rates are allowed —
 * a discount line and a credit note both need one — and are the caller's business to justify.
 *
 * The rate may carry up to 6 decimal digits, which covers every statutory VAT rate in the EU
 * and every insurance-premium and withholding rate we have met. Beyond that, use `multiply`
 * with an explicit ratio so the intent is visible.
 *
 * @param {unknown} rate
 * @returns {{ ok: true, num: bigint, den: bigint } | { ok: false, code: string, message: string }}
 */
export function parseRate(rate) {
  if (typeof rate === 'number') {
    return bad('number-rate', `a percentage rate must not be a Number (got ${describe(rate)}). Pass a string like "19" or "19.5".`);
  }
  if (typeof rate === 'bigint') {
    return { ok: true, num: rate, den: 100n };
  }
  if (typeof rate !== 'string') {
    return bad('bad-rate', `cannot read a percentage rate from ${describe(rate)}`);
  }
  const m = DECIMAL_RE.exec(rate);
  if (m === null) {
    return bad('bad-rate', `${JSON.stringify(rate)} is not an exact percentage rate (e.g. "19", "19.5", "7", "0")`);
  }
  const [, sign, intDigits, fracDigits = ''] = m;
  if (fracDigits.length > 6) {
    return bad('rate-too-precise', `${JSON.stringify(rate)} carries more than 6 decimal digits; express it as an explicit ratio instead`);
  }
  const magnitude = BigInt(intDigits + fracDigits);
  return {
    ok: true,
    num: sign === '-' ? -magnitude : magnitude,
    den: 100n * pow10(BigInt(fracDigits.length)),
  };
}

/**
 * Parse allocation weights to a common integer denominator.
 *
 * Accepted per weight: a non-negative `bigint`, or a non-negative exact decimal string
 * (`"0.5"`, `"120.500"`). A `bigint` count in place of the array means "that many equal parts".
 * Numbers are refused, as everywhere.
 *
 * @param {unknown} weights
 * @returns {{ ok: true, w: bigint[] } | { ok: false, code: string, message: string }}
 */
export function parseWeights(weights) {
  if (typeof weights === 'number') {
    return bad('number-weights', `a part count must not be a Number (got ${describe(weights)}); pass a BigInt like 3n, or an array of weights`);
  }
  if (typeof weights === 'bigint') {
    if (weights < 1n) return bad('bad-part-count', `a part count must be at least 1n, got ${weights.toString()}n`);
    if (weights > 1000000n) return bad('bad-part-count', 'a part count above 1000000n is refused as a mistake');
    const w = [];
    for (let i = 0n; i < weights; i += 1n) w.push(1n);
    return { ok: true, w };
  }
  if (!Array.isArray(weights)) {
    return bad('bad-weights', `weights must be an array (or a BigInt part count), got ${describe(weights)}`);
  }
  if (weights.length === 0) {
    return bad('no-weights', 'cannot allocate across zero parts');
  }

  // First pass: validate and record how many decimal digits each weight carries.
  const digits = [];
  let maxFrac = 0;
  for (let i = 0; i < weights.length; i++) {
    const raw = weights[i];
    if (typeof raw === 'number') {
      return bad('number-weights', `weight at index ${String(i)} is ${describe(raw)}; weights are BigInt or exact decimal strings`);
    }
    if (typeof raw === 'bigint') {
      if (raw < 0n) return bad('negative-weight', `weight at index ${String(i)} is negative; weights describe shares, never directions`);
      digits.push({ magnitude: raw, frac: 0 });
      continue;
    }
    if (typeof raw !== 'string') {
      return bad('bad-weights', `weight at index ${String(i)} is ${describe(raw)}; weights are BigInt or exact decimal strings`);
    }
    const m = UNSIGNED_DECIMAL_RE.exec(raw);
    if (m === null) {
      return bad('bad-weights', `weight at index ${String(i)} (${JSON.stringify(raw)}) is not a non-negative exact decimal`);
    }
    const [, intDigits, fracDigits = ''] = m;
    digits.push({ magnitude: BigInt(intDigits + fracDigits), frac: fracDigits.length });
    if (fracDigits.length > maxFrac) maxFrac = fracDigits.length;
  }

  // Second pass: lift every weight onto the common denominator 10^maxFrac.
  const w = digits.map(({ magnitude, frac }) =>
    magnitude * pow10(BigInt(maxFrac) - BigInt(frac)));

  return { ok: true, w };
}

// ---------------------------------------------------------------------------------------------
// Largest-remainder allocation
// ---------------------------------------------------------------------------------------------

/**
 * Split `total` scaled units across integer `weights` so that the parts sum **exactly** to
 * `total`, deterministically.
 *
 * The method, which is the one every tax authority and every ERP that survived an audit uses:
 *   1. round each ideal share `total·wᵢ/W` with the declared mode,
 *   2. compute the residual `total − Σpartᵢ` — at most one unit per part, by construction,
 *   3. hand the residual out one unit at a time to the parts that were most short-changed
 *      (largest remainder), ties broken by ascending index so the result never depends on
 *      sort stability or on insertion order.
 * Then assert the invariant. If the parts do not sum to the whole, this throws rather than
 * returns: a cent that disappears silently is the failure mode this module exists to prevent.
 *
 * @param {bigint} total
 * @param {bigint[]} weights non-negative, not all zero
 * @param {string} mode a validated rounding mode
 * @returns {bigint[]}
 */
export function allocateUnits(total, weights, mode) {
  let W = 0n;
  for (const w of weights) W += w;
  if (W === 0n) throw new RangeError('allocateUnits requires weights that sum to more than zero');

  const parts = [];
  const shortfall = [];   // total·wᵢ − partᵢ·W, i.e. the unrounded remainder times W
  let assigned = 0n;

  for (let i = 0; i < weights.length; i++) {
    const ideal = total * weights[i];
    const part = divRound(ideal, W, mode);
    parts.push(part);
    shortfall.push(ideal - part * W);
    assigned += part;
  }

  let residual = total - assigned;

  if (residual !== 0n) {
    const wantMore = residual > 0n;
    const candidates = [];
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] === 0n) continue;                       // a zero share stays zero
      if (wantMore ? shortfall[i] > 0n : shortfall[i] < 0n) candidates.push(i);
    }
    candidates.sort((a, b) => {
      if (shortfall[a] !== shortfall[b]) {
        if (wantMore) return shortfall[a] > shortfall[b] ? -1 : 1;   // most short-changed first
        return shortfall[a] < shortfall[b] ? -1 : 1;                 // most over-paid first
      }
      return a - b;                                                  // deterministic tie-break
    });

    const step = wantMore ? 1n : -1n;
    for (const i of candidates) {
      if (residual === 0n) break;
      parts[i] += step;
      residual -= step;
    }
  }

  let check = 0n;
  for (const p of parts) check += p;
  if (check !== total || residual !== 0n) {
    throw new RangeError(`allocation invariant broken: parts sum to ${check.toString()}, expected ${total.toString()}`);
  }
  return parts;
}
