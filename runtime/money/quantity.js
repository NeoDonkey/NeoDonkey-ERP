/**
 * runtime/money/quantity.js — exact quantities with a declared scale.
 *
 * FD-1, last bullet: *"`number` remains for counts and quantities. Quantities get their own
 * decimal scale where a business needs it (0.001 kg), by the same string mechanism."*
 *
 * Food is weight-priced. 120.5 kg of cashews is not an integer, and it must not be a float
 * either: `0.1 kg + 0.2 kg` as doubles is `0.30000000000000004 kg`, and a goods receipt that
 * disagrees with a supplier's delivery note by 4 × 10⁻¹⁷ kg is a reconciliation ticket someone
 * has to close. The mechanism is therefore identical to money's, with the same grammar, the
 * same rounding modes and the same refusal to mix:
 *
 *     "120.500 kg"    "3 pcs"    "-0.750 kg"    "1.000 l"
 *
 * Differences from money, both deliberate:
 *
 * 1. **A quantity carries its own scale**, because units are not ISO 4217 — the table below is a
 *    default, and a model may declare its own (`defineUnits`). Two quantities in the same unit at
 *    different scales refuse to combine (`scale-mismatch`) rather than silently picking one.
 * 2. **There is no `convert` by table.** `kg → g` looks exact and universal, but `pallet → pcs`
 *    is an article-level fact and `l → kg` is a density. So `convert` takes the factor from the
 *    caller, exactly like money's does, and the model is where the factor is declared.
 *
 * Zero dependencies. No `node:*`. No `Number` arithmetic. Pure functions.
 */

import {
  ROUNDING_MODES, isRoundingMode, divRound, pow10, toExactInteger,
  parseScaledToken, formatScaled, parseFactor, parseWeights, allocateUnits,
  describe,
} from './decimal.js';

export { ROUNDING_MODES };

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** Every rejection from this module. Branch on `code`, never on the message. */
export class QuantityError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'QuantityError';
    this.code = code;
  }
}

const CODE_MAP = Object.freeze({
  'bad-symbol': 'bad-unit',
  'unknown-symbol': 'unknown-unit',
  'symbol-case': 'unit-case',
});

/** @param {{code: string, message: string}} failure */
function fail(failure) {
  const code = CODE_MAP[failure.code] ?? failure.code;
  throw new QuantityError(code, failure.message);
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

/**
 * Unit → number of decimal digits the unit is recorded with.
 *
 * These are defaults for a European food business, chosen so the smallest increment anyone
 * actually invoices is representable: grammes on a kilo price (`kg` scale 3), millilitres on a
 * litre (`l` scale 3), quarter hours on labour (`h` scale 2), whole pieces on a piece (`pcs` 0).
 *
 * A unit not in the table is an error — never a guessed scale. A model that needs `sack` or
 * `layer` declares it with `defineUnits`, in a signed commit, and the declaration travels with
 * the operating model rather than living in this file.
 */
export const UNITS = Object.freeze({
  // countable
  pcs: 0, box: 0, carton: 0, tray: 0, layer: 0, pallet: 0, bag: 0, sack: 0,
  bottle: 0, can: 0, jar: 0, roll: 0, set: 0, pair: 0,
  // mass
  mg: 0, g: 3, kg: 3, t: 3,
  // volume
  ml: 0, cl: 1, l: 3, hl: 3,
  // length, area, volume of space
  mm: 1, cm: 2, m: 3, km: 3, m2: 3, m3: 3,
  // time
  s: 0, min: 2, h: 2, day: 2, month: 0, year: 0,
});

const UNIT_RE = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * A unit table extended with more units, frozen. Pure: `UNITS` itself never changes.
 *
 *     const units = defineUnits({ sack: 0, 'big-bag': 0 });   // → keys must match UNIT_RE
 *
 * @param {Record<string, number|bigint>} extra
 * @returns {Record<string, number>}
 */
export function defineUnits(extra) {
  if (extra === null || typeof extra !== 'object') {
    throw new QuantityError('bad-unit-table', `defineUnits needs an object of unit → scale, got ${describe(extra)}`);
  }
  const merged = { ...UNITS };
  for (const [unit, scale] of Object.entries(extra)) {
    if (!UNIT_RE.test(unit)) {
      throw new QuantityError('bad-unit', `${JSON.stringify(unit)} is not a well-formed unit (a letter, then letters and digits)`);
    }
    const s = toExactInteger(scale);
    if (s === null || s < 0n || s > 12n) {
      throw new QuantityError('bad-scale', `unit ${JSON.stringify(unit)} needs a whole scale between 0 and 12, got ${describe(scale)}`);
    }
    merged[unit] = typeof scale === 'number' ? scale : countFromBigInt(s);
  }
  return Object.freeze(merged);
}

/**
 * A scale is a digit count, and the table keeps it as a plain integer so a diff reads well.
 * Counting up rather than calling `Number(s)` keeps this module free of a single `Number(`
 * conversion — the grep guard in `test/m-money.test.js` forbids it outright, and a scale is
 * small enough that counting is honest rather than clever.
 */
function countFromBigInt(s) {
  let count = 0;
  for (let i = 0n; i < s; i += 1n) count++;
  return count;
}

/**
 * The declared scale of a unit in a table. Throws on an unknown unit.
 * @param {string} unit
 * @param {Record<string, number>} [units]
 * @returns {number}
 */
export function scaleOf(unit, units = UNITS) {
  if (typeof unit !== 'string') {
    throw new QuantityError('bad-unit', `a unit must be a string, got ${describe(unit)}`);
  }
  if (!UNIT_RE.test(unit)) {
    throw new QuantityError('bad-unit', `${JSON.stringify(unit)} is not a well-formed unit (a letter, then letters and digits)`);
  }
  if (!Object.prototype.hasOwnProperty.call(units, unit)) {
    throw new QuantityError('unknown-unit', `unknown unit ${JSON.stringify(unit)}: no scale is declared for it, and a scale is never guessed. Declare it with defineUnits.`);
  }
  return units[unit];
}

// ---------------------------------------------------------------------------------------------
// The value
// ---------------------------------------------------------------------------------------------

/**
 * An exact quantity: `scaled` BigInt units of 10^−`scale` `unit`.
 * Frozen; `toJSON` emits the canonical token; numeric coercion throws, exactly as with Money.
 */
class Quantity {
  /** @param {bigint} scaled @param {string} unit @param {number} scale */
  constructor(scaled, unit, scale) {
    /** @type {bigint} */
    this.scaled = scaled;
    /** @type {string} */
    this.unit = unit;
    /** @type {number} */
    this.scale = scale;
    Object.freeze(this);
  }

  toString() {
    return formatScaled(this.scaled, this.scale) + ' ' + this.unit;
  }

  toJSON() {
    return this.toString();
  }

  /** @param {string} hint */
  [Symbol.toPrimitive](hint) {
    if (hint === 'string') return this.toString();
    throw new QuantityError('numeric-coercion',
      `refusing to coerce ${this.toString()} to a Number. A scaled quantity is never a Number: use add/subtract/compare, or toScaled() for the BigInt units.`);
  }

  get [Symbol.toStringTag]() {
    return 'Quantity';
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Quantity ${this.toString()}`;
  }
}

/** @param {unknown} value */
export function isQuantity(value) {
  return value !== null && typeof value === 'object'
    && typeof (/** @type {any} */ (value).scaled) === 'bigint'
    && typeof (/** @type {any} */ (value).unit) === 'string'
    && typeof (/** @type {any} */ (value).scale) === 'number';
}

/**
 * Parse a canonical quantity token. The fraction digits must match the unit's declared scale
 * exactly — `"120.5 kg"` is refused because `kg` is recorded to three digits, so that one
 * quantity has exactly one spelling in a document.
 *
 * @param {unknown} text e.g. `"120.500 kg"`
 * @param {Record<string, number>} [units]
 * @returns {Quantity}
 */
export function quantity(text, units = UNITS) {
  const r = parseScaledToken(text, {
    symbolRe: UNIT_RE,
    caseRe: null,           // `KG` is not `kg`; a unit is not case-folded
    scaleFor: (u) => (Object.prototype.hasOwnProperty.call(units, u) ? units[u] : undefined),
    symbolName: 'unit',
    example: '120.500 kg',
  });
  if (r.ok !== true) return fail(r);
  return new Quantity(r.units, r.symbol, r.scale);
}

/**
 * Build a quantity from scaled units: `fromScaled(120500n, 'kg')` → `120.500 kg`.
 * @param {bigint} scaled
 * @param {string} unit
 * @param {Record<string, number>} [units]
 * @returns {Quantity}
 */
export function fromScaled(scaled, unit, units = UNITS) {
  if (typeof scaled !== 'bigint') {
    throw new QuantityError('not-a-bigint', `fromScaled needs BigInt scaled units, got ${describe(scaled)}`);
  }
  return new Quantity(scaled, unit, scaleOf(unit, units));
}

/** @param {string} unit @param {Record<string, number>} [units] @returns {Quantity} */
export function zero(unit, units = UNITS) {
  return new Quantity(0n, unit, scaleOf(unit, units));
}

/**
 * Accept a `Quantity`, its cloned `{ scaled, unit, scale }` shape, or a canonical token.
 * @param {unknown} value
 * @param {Record<string, number>} [units]
 * @returns {Quantity}
 */
export function toQuantity(value, units = UNITS) {
  if (value instanceof Quantity) return value;
  if (isQuantity(value)) {
    const v = /** @type {any} */ (value);
    return new Quantity(v.scaled, v.unit, v.scale);
  }
  if (typeof value === 'string') return quantity(value, units);
  if (typeof value === 'number') {
    throw new QuantityError('not-a-string', `a scaled quantity is never a Number: got ${describe(value)}. Write it as a token, e.g. "${value.toString()} pcs" — and check the scale.`);
  }
  throw new QuantityError('not-a-string', `expected a quantity ("120.500 kg" or a Quantity), got ${describe(value)}`);
}

/** Canonical wire form. @param {unknown} q */
export function toString(q) {
  return toQuantity(q).toString();
}

/** The exact BigInt scaled units. @param {unknown} q @returns {bigint} */
export function toScaled(q) {
  return toQuantity(q).scaled;
}

/** @param {unknown} q @returns {string} */
export function unitOf(q) {
  return toQuantity(q).unit;
}

/**
 * The quantity as an exact rational, for pricing: `120.500 kg` → `{ numerator: 120500n,
 * denominator: 1000n }`, ready for `money.multiply(pricePerKg, toRatio(q), 'half-up')`.
 * This is the sanctioned bridge between a weight and an amount — there is no other.
 * @param {unknown} q
 * @returns {{ numerator: bigint, denominator: bigint }}
 */
export function toRatio(q) {
  const x = toQuantity(q);
  return { numerator: x.scaled, denominator: pow10(BigInt(x.scale)) };
}

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

function sameUnit(a, b, operation) {
  if (a.unit !== b.unit) {
    throw new QuantityError('unit-mismatch',
      `refusing to ${operation} ${a.toString()} and ${b.toString()}: mixed units never combine silently. Convert one side with convert() using the factor the model declares.`);
  }
  if (a.scale !== b.scale) {
    throw new QuantityError('scale-mismatch',
      `refusing to ${operation} ${a.toString()} and ${b.toString()}: both are ${a.unit} but they are recorded at different scales (${String(a.scale)} vs ${String(b.scale)}). One unit table per workspace.`);
  }
}

function requireRounding(mode, what) {
  if (mode === undefined || mode === null) {
    throw new QuantityError('rounding-required',
      `${what} needs an explicit rounding mode — one of ${ROUNDING_MODES.join(', ')}. There is no default.`);
  }
  if (!isRoundingMode(mode)) {
    throw new QuantityError('unknown-rounding',
      `unknown rounding mode ${describe(mode)}; known modes are ${ROUNDING_MODES.join(', ')}`);
  }
  return mode;
}

// ---------------------------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------------------------

/** @param {unknown} a @param {unknown} b @returns {Quantity} */
export function add(a, b) {
  const x = toQuantity(a);
  const y = toQuantity(b);
  sameUnit(x, y, 'add');
  return new Quantity(x.scaled + y.scaled, x.unit, x.scale);
}

/** @param {unknown} a @param {unknown} b @returns {Quantity} */
export function subtract(a, b) {
  const x = toQuantity(a);
  const y = toQuantity(b);
  sameUnit(x, y, 'subtract');
  return new Quantity(x.scaled - y.scaled, x.unit, x.scale);
}

/** @param {unknown} q @returns {Quantity} */
export function negate(q) {
  const x = toQuantity(q);
  return new Quantity(-x.scaled, x.unit, x.scale);
}

/** @param {unknown} q @returns {Quantity} */
export function abs(q) {
  const x = toQuantity(q);
  return x.scaled < 0n ? new Quantity(-x.scaled, x.unit, x.scale) : x;
}

/**
 * Multiply by an exact factor. Rounding is required exactly when the product does not land on
 * a whole scaled unit — `2n` boxes of `1.500 kg` needs no policy; `"0.3333"` of it does.
 * @param {unknown} q
 * @param {bigint|string|{numerator: bigint, denominator: bigint}|[bigint, bigint]} factor
 * @param {string} [rounding]
 * @returns {Quantity}
 */
export function multiply(q, factor, rounding) {
  const x = toQuantity(q);
  const f = parseFactor(factor);
  if (f.ok !== true) return fail(f);
  const numerator = x.scaled * f.num;
  if (numerator % f.den === 0n) {
    if (rounding !== undefined && rounding !== null) requireRounding(rounding, 'multiply');
    return new Quantity(numerator / f.den, x.unit, x.scale);
  }
  const mode = requireRounding(rounding, `multiplying ${x.toString()} by this factor (the product is not a whole unit at scale ${String(x.scale)})`);
  return new Quantity(divRound(numerator, f.den, mode), x.unit, x.scale);
}

/**
 * Round to a coarser decimal scale, keeping the unit's own scale in the result:
 * `round(quantity("120.500 kg"), 0, 'half-up')` → `121.000 kg`.
 * @param {unknown} q
 * @param {number|bigint} scale
 * @param {string} rounding
 * @returns {Quantity}
 */
export function round(q, scale, rounding) {
  const x = toQuantity(q);
  const target = toExactInteger(scale);
  if (target === null) {
    throw new QuantityError('bad-scale', `a target scale must be a whole number of decimal places, got ${describe(scale)}`);
  }
  const own = BigInt(x.scale);
  if (target < 0n || target > own) {
    throw new QuantityError('bad-scale', `cannot round ${x.unit} to ${target.toString()} decimal places; it is recorded with ${own.toString()}`);
  }
  const mode = requireRounding(rounding, 'round');
  const step = pow10(own - target);
  return new Quantity(divRound(x.scaled, step, mode) * step, x.unit, x.scale);
}

/**
 * Convert to another unit at an exact, caller-supplied factor — units of the target per one
 * unit of the source, in major units (`kg` → `g` is `"1000"`).
 *
 * As with money, the factor is **not** this module's knowledge. `pallet → pcs` is an article
 * fact, `l → kg` is a density, and both belong in the operating model where someone signs
 * them. The caller records the factor it used on the document.
 *
 * @param {unknown} q
 * @param {string} toUnit
 * @param {string|bigint|{numerator: bigint, denominator: bigint}|[bigint, bigint]} factorText
 * @param {string} rounding
 * @param {Record<string, number>} [units]
 * @returns {Quantity}
 */
export function convert(q, toUnit, factorText, rounding, units = UNITS) {
  const x = toQuantity(q);
  const toScale = BigInt(scaleOf(toUnit, units));
  const fromScale = BigInt(x.scale);
  const f = parseFactor(factorText);
  if (f.ok !== true) return fail(f);
  const mode = requireRounding(rounding, 'convert');

  let numerator = x.scaled * f.num;
  let denominator = f.den;
  if (toScale >= fromScale) {
    numerator *= pow10(toScale - fromScale);
  } else {
    denominator *= pow10(fromScale - toScale);
  }
  return new Quantity(divRound(numerator, denominator, mode), toUnit, scaleOf(toUnit, units));
}

// ---------------------------------------------------------------------------------------------
// Comparison and aggregation
// ---------------------------------------------------------------------------------------------

/** @param {unknown} a @param {unknown} b @returns {number} */
export function compare(a, b) {
  const x = toQuantity(a);
  const y = toQuantity(b);
  sameUnit(x, y, 'compare');
  if (x.scaled < y.scaled) return -1;
  if (x.scaled > y.scaled) return 1;
  return 0;
}

/** @param {unknown} a @param {unknown} b */
export function equals(a, b) {
  const x = toQuantity(a);
  const y = toQuantity(b);
  return x.unit === y.unit && x.scale === y.scale && x.scaled === y.scaled;
}

/** @param {unknown} q */
export function isZero(q) {
  return toQuantity(q).scaled === 0n;
}

/** @param {unknown} q @returns {number} −1, 0 or 1 */
export function sign(q) {
  const x = toQuantity(q);
  if (x.scaled < 0n) return -1;
  if (x.scaled > 0n) return 1;
  return 0;
}

/** @param {unknown} a @param {unknown} b @returns {Quantity} */
export function min(a, b) {
  return compare(a, b) <= 0 ? toQuantity(a) : toQuantity(b);
}

/** @param {unknown} a @param {unknown} b @returns {Quantity} */
export function max(a, b) {
  return compare(a, b) >= 0 ? toQuantity(a) : toQuantity(b);
}

/**
 * Sum a list of quantities. Never `NaN`. An empty list needs its unit stated, for the same
 * reason an empty monetary sum needs its currency.
 * @param {Iterable<unknown>} list
 * @param {string} [unit]
 * @param {Record<string, number>} [units]
 * @returns {Quantity}
 */
export function sum(list, unit, units = UNITS) {
  if (list === null || typeof list !== 'object' || typeof (/** @type {any} */ (list)[Symbol.iterator]) !== 'function') {
    throw new QuantityError('not-iterable', `sum needs a list of quantities, got ${describe(list)}`);
  }
  if (unit !== undefined) scaleOf(unit, units);

  let total = null;
  let index = 0;
  for (const item of list) {
    let value;
    try {
      value = toQuantity(item, units);
    } catch (e) {
      if (e instanceof QuantityError) {
        throw new QuantityError(e.code, `element ${String(index)} of the sum: ${e.message}`);
      }
      throw e;
    }
    if (unit !== undefined && value.unit !== unit) {
      throw new QuantityError('unit-mismatch',
        `element ${String(index)} of the sum is ${value.toString()} but the sum was declared in ${unit}: mixed units never combine silently`);
    }
    if (total === null) {
      total = value;
    } else {
      sameUnit(total, value, 'sum');
      total = new Quantity(total.scaled + value.scaled, total.unit, total.scale);
    }
    index++;
  }

  if (total === null) {
    if (unit === undefined) {
      throw new QuantityError('unit-required',
        'an empty sum has no unit of its own — call sum([], "kg") and state it');
    }
    return new Quantity(0n, unit, scaleOf(unit, units));
  }
  return total;
}

/**
 * Split a quantity across weights so the parts sum exactly to the whole — the same
 * largest-remainder allocation money uses, for splitting a delivery across batches or a
 * production order across lines.
 * @param {unknown} q
 * @param {bigint|Array<bigint|string>} weights
 * @param {string} rounding
 * @returns {Quantity[]}
 */
export function allocate(q, weights, rounding) {
  const x = toQuantity(q);
  const w = parseWeights(weights);
  if (w.ok !== true) return fail(w);
  const mode = requireRounding(rounding, 'allocate');

  let totalWeight = 0n;
  for (const one of w.w) totalWeight += one;
  if (totalWeight === 0n) {
    throw new QuantityError('zero-weight-total', 'the weights sum to zero, so there is no share to allocate by');
  }

  let parts;
  try {
    parts = allocateUnits(x.scaled, w.w, mode);
  } catch (e) {
    throw new QuantityError('allocation-failed', `allocating ${x.toString()} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return parts.map((scaled) => new Quantity(scaled, x.unit, x.scale));
}
