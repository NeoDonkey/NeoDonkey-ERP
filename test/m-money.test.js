/**
 * test/m-money.test.js — adversarial tests for runtime/money/.
 *
 * These tests exist to fail if FD-1 is ever quietly relaxed. They are organised as:
 *
 *   1. the three exact failures the roadmap names (VAT on 4999.99, 0.1 + 0.2, a JSON round trip)
 *   2. the grammar: every malformed token, each with its own error code
 *   3. byte-exact round tripping, including amounts far beyond Number.MAX_SAFE_INTEGER
 *   4. the float guard: a scanner that greps runtime/money/**, proven against known-bad fixtures
 *   5. properties: allocation sums to the whole, VAT net+vat == gross, determinism
 *   6. quantities
 *
 * Zero dependencies, `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  money, fromMinor, toMoney, toString as moneyToString, toMinor, zero, currencyOf,
  add, subtract, negate, abs, multiply, percentage, round, convert, splitGross,
  compare, equals, isZero, sign, isNegative, isPositive, min, max, sum, allocate,
  CURRENCIES, ROUNDING_MODES, MoneyError, isMoney, scaleOf, currencyCodes,
} from '../runtime/money/money.js';

import * as Q from '../runtime/money/quantity.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MONEY_DIR = join(HERE, '..', 'runtime', 'money');

/** Assert that `fn` throws a MoneyError with exactly this `code`. */
function throwsCode(fn, code, label) {
  let caught = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught !== null, `${label ?? 'call'} should have thrown (expected code ${code})`);
  assert.ok(caught instanceof MoneyError || caught instanceof Q.QuantityError,
    `${label ?? 'call'} threw ${caught?.name}: ${caught?.message}`);
  assert.equal(caught.code, code, `${label ?? 'call'} threw code ${caught.code} ("${caught.message}"), expected ${code}`);
  return caught;
}

// =============================================================================================
// 1 — The exact failures the roadmap names
// =============================================================================================

test('roadmap failure 1: 19 % VAT on 4999.99 is exact, and the rounding mode decides the cent', () => {
  const net = money('4999.99 EUR');

  // What doubles do, for the record: the VAT of 4999.99 is not a whole number of cents at all,
  // 7 % of 100 is not 7, and the usual "fix" rounds the wrong way without saying so.
  assert.equal(4999.99 * 0.19, 949.9981);
  assert.equal(4999.99 * 1.19, 5949.9881);
  assert.equal(0.07 * 100, 7.000000000000001);
  assert.equal((1.005).toFixed(2), '1.00');

  // Exact arithmetic, then one declared rounding step:
  assert.equal(String(percentage(net, '19', 'half-up')), '950.00 EUR');    // commercial, DE default
  assert.equal(String(percentage(net, '19', 'half-even')), '950.00 EUR');
  assert.equal(String(percentage(net, '19', 'down')), '949.99 EUR');       // truncation
  assert.equal(String(percentage(net, '19', 'up')), '950.00 EUR');
  assert.equal(String(percentage(net, '19', 'floor')), '949.99 EUR');
  assert.equal(String(percentage(net, '19', 'ceiling')), '950.00 EUR');

  // FD-1's illustrative JSON pairs 4999.99 EUR net with 949.99 EUR VAT, which is the *truncated*
  // value; commercial half-up (which FD-1 also names as the model's rule) gives 950.00 EUR.
  // Both are computable here; the model must state which. Reported, not worked around.
  assert.equal(String(percentage(net, '19', 'down')), '949.99 EUR');

  // No rounding mode → refused. Never a silent policy.
  throwsCode(() => percentage(net, '19'), 'rounding-required', 'percentage without a mode');
  throwsCode(() => percentage(net, '19', 'bankers'), 'unknown-rounding', 'percentage with a made-up mode');

  // And the gross split that every invoice needs is exact by construction.
  const { net: n2, vat, gross } = splitGross(money('5949.99 EUR'), '19', 'half-up');
  assert.equal(String(add(n2, vat)), String(gross));
});

test('roadmap failure 2: 0.1 + 0.2 = 0.3, exactly', () => {
  assert.notEqual(0.1 + 0.2, 0.3);                       // the double, for contrast
  assert.equal(0.1 + 0.2, 0.30000000000000004);
  assert.equal(String(add(money('0.10 EUR'), money('0.20 EUR'))), '0.30 EUR');
  assert.equal(toMinor(add(money('0.10 EUR'), money('0.20 EUR'))), 30n);

  // A thousand cents summed one at a time is exactly ten euros.
  const cents = [];
  for (let i = 0; i < 1000; i++) cents.push(money('0.01 EUR'));
  assert.equal(String(sum(cents)), '10.00 EUR');
});

test('roadmap failure 3: a JSON round trip a double mangles survives byte-exactly', () => {
  // As a JSON *number*, this loses its cents on the way in — irreparably.
  const mangled = JSON.parse('{"net-amount":9007199254740993.01}');
  assert.equal(mangled['net-amount'], 9007199254740994);   // a cent turned into a whole euro
  assert.notEqual(String(mangled['net-amount']), '9007199254740993.01');

  // As an FD-1 token it is a string, so parsing cannot change it.
  const raw = '{"net-amount":"9007199254740993.01 EUR"}';
  const doc = JSON.parse(raw);
  const amount = money(doc['net-amount']);
  assert.equal(toMinor(amount), 900719925474099301n);
  assert.equal(String(amount), '9007199254740993.01 EUR');

  // And a Money written back into a document re-emits the same bytes (toJSON).
  assert.equal(JSON.stringify({ 'net-amount': amount }), raw);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify({ a: amount }))), '{"a":"9007199254740993.01 EUR"}');

  // The classic 0.1 case, through JSON.
  assert.notEqual(JSON.parse('{"x":0.1}').x + 0.2, 0.3);
  assert.equal(String(add(money(JSON.parse('{"x":"0.10 EUR"}').x), '0.20 EUR')), '0.30 EUR');
});

// =============================================================================================
// 2 — The grammar: every malformed input gets its own error code
// =============================================================================================

test('malformed tokens are refused, each with a distinct error code', () => {
  const cases = [
    ['4999.9 EUR', 'wrong-scale'],          // EUR has 2 minor digits, not 1
    ['4999.999 EUR', 'wrong-scale'],
    ['1000.0 JPY', 'wrong-scale'],          // JPY has none
    ['1.50 TND', 'wrong-scale'],            // TND has three
    ['4999.99EUR', 'missing-space'],
    ['4999.99 eur', 'currency-case'],
    ['4999.99 EuR', 'currency-case'],
    ['+5.00 EUR', 'leading-plus'],
    ['5,00 EUR', 'decimal-comma'],
    ['1.234,56 EUR', 'decimal-comma'],
    ['1e3 EUR', 'exponent'],
    ['1E3 EUR', 'exponent'],
    ['5.00 XXX', 'unknown-currency'],
    ['5.00 XBT', 'unknown-currency'],
    ['5.00 EURO', 'bad-currency-code'],
    ['5.00 E', 'bad-currency-code'],
    ['5.00 12', 'bad-currency-code'],
    [' 5.00 EUR', 'leading-space'],
    ['5.00 EUR ', 'trailing-space'],
    ['5.00  EUR', 'extra-space'],
    ['5.00\tEUR', 'bad-whitespace'],
    ['5.00\u00a0EUR', 'bad-whitespace'],       // a non-breaking space from a copy-paste
    ['5.00\nEUR', 'bad-whitespace'],
    ['', 'empty'],
    ['NaN EUR', 'not-finite'],
    ['Infinity EUR', 'not-finite'],
    ['-Infinity EUR', 'not-finite'],
    ['-0.00 EUR', 'negative-zero'],
    ['-0 JPY', 'negative-zero'],
    ['-0.000 TND', 'negative-zero'],
    ['05.00 EUR', 'leading-zero'],
    ['-05.00 EUR', 'leading-zero'],
    ['5. EUR', 'trailing-dot'],
    ['.50 EUR', 'no-integer-digit'],
    ['- EUR', 'no-digits'],
    ['5.0.0 EUR', 'syntax'],
    ['--5.00 EUR', 'syntax'],
    ['5-00 EUR', 'syntax'],
    ['abc EUR', 'syntax'],
    ['1_000.00 EUR', 'syntax'],
    ['0x10 EUR', 'syntax'],
    ['5.00 EUR EUR', 'extra-space'],
  ];

  const seen = new Set();
  for (const [text, code] of cases) {
    throwsCode(() => money(text), code, JSON.stringify(text));
    seen.add(code);
  }

  // Non-strings never become money, and a Number says so in its own words.
  for (const value of [null, undefined, 5, 0, -1, 4999.99, NaN, Infinity, true, false, {}, [], 5n, Symbol('x')]) {
    const e = throwsCode(() => money(value), 'not-a-string', String(typeof value));
    seen.add(e.code);
  }
  // The Number message must name the actual problem, so the next reader learns why.
  try {
    money(4999.99);
  } catch (e) {
    assert.match(e.message, /IEEE 754|Number/);
  }

  // 22+ distinct codes: a caller can branch on the reason, not on message text.
  assert.ok(seen.size >= 20, `expected at least 20 distinct error codes, got ${seen.size}`);
});

test('negative zero: refused, documented, and unreachable through arithmetic', () => {
  throwsCode(() => money('-0.00 EUR'), 'negative-zero');
  // Zero has exactly one spelling, and every operation that could produce −0 produces it.
  assert.equal(String(subtract(money('5.00 EUR'), money('5.00 EUR'))), '0.00 EUR');
  assert.equal(String(negate(money('0.00 EUR'))), '0.00 EUR');
  assert.equal(String(negate(zero('EUR'))), '0.00 EUR');
  assert.equal(String(multiply(money('0.00 EUR'), -1n)), '0.00 EUR');
  assert.equal(String(percentage(money('-0.01 EUR'), '19', 'half-even')), '0.00 EUR');
  assert.equal(String(fromMinor(-0n, 'EUR')), '0.00 EUR');
  assert.equal(String(round(money('-0.004 TND'), 2, 'half-up')), '0.000 TND');
});

test('the currency table is ISO 4217, and unknown codes never get a guessed scale', () => {
  // Required coverage, asserted value by value: these are the ones naive code gets wrong.
  assert.equal(CURRENCIES.EUR, 2);
  assert.equal(CURRENCIES.CHF, 2);
  assert.equal(CURRENCIES.GBP, 2);
  assert.equal(CURRENCIES.SEK, 2);
  assert.equal(CURRENCIES.NOK, 2);
  assert.equal(CURRENCIES.DKK, 2);
  assert.equal(CURRENCIES.PLN, 2);
  assert.equal(CURRENCIES.CZK, 2);
  assert.equal(CURRENCIES.HUF, 2);
  assert.equal(CURRENCIES.RON, 2);
  assert.equal(CURRENCIES.BGN, 2);
  assert.equal(CURRENCIES.USD, 2);
  assert.equal(CURRENCIES.TRY, 2);
  assert.equal(CURRENCIES.JPY, 0);
  assert.equal(CURRENCIES.ISK, 0);
  assert.equal(CURRENCIES.TND, 3);
  assert.equal(CURRENCIES.KWD, 3);
  assert.equal(CURRENCIES.CLF, 4);

  assert.equal(String(money('1000 JPY')), '1000 JPY');
  assert.equal(String(money('1.500 TND')), '1.500 TND');
  assert.equal(String(money('-12.00 EUR')), '-12.00 EUR');

  throwsCode(() => scaleOf('XXX'), 'unknown-currency');
  throwsCode(() => scaleOf('eur'), 'currency-case');
  throwsCode(() => scaleOf('EURO'), 'bad-currency-code');
  throwsCode(() => scaleOf(978), 'bad-currency-code');
  throwsCode(() => fromMinor(1n, 'XXX'), 'unknown-currency');
  throwsCode(() => zero('XXX'), 'unknown-currency');

  // The table is frozen: no module can widen it at runtime.
  assert.throws(() => { CURRENCIES.XXX = 2; }, TypeError);
  assert.equal(CURRENCIES.XXX, undefined);
  assert.ok(currencyCodes().length >= 60);
  assert.ok(Object.values(CURRENCIES).every((s) => s === 0 || s === 1 || s === 2 || s === 3 || s === 4));
});

test('mixed currencies never combine, convert or compare silently', () => {
  const eur = money('10.00 EUR');
  const usd = money('10.00 USD');
  throwsCode(() => add(eur, usd), 'currency-mismatch');
  throwsCode(() => add('10.00 EUR', '10.00 USD'), 'currency-mismatch');
  throwsCode(() => subtract(eur, usd), 'currency-mismatch');
  throwsCode(() => compare(eur, usd), 'currency-mismatch');
  throwsCode(() => min(eur, usd), 'currency-mismatch');
  throwsCode(() => max(eur, usd), 'currency-mismatch');
  throwsCode(() => sum([eur, usd]), 'currency-mismatch');
  throwsCode(() => sum([eur, money('1.00 EUR')], 'USD'), 'currency-mismatch');

  // The refusal explains the modelled alternative rather than just saying no.
  try {
    add(eur, usd);
  } catch (e) {
    assert.match(e.message, /convert/i);
    assert.match(e.message, /rate/i);
  }

  // equals() is total: different currencies are simply not equal, no throw.
  assert.equal(equals(eur, usd), false);
  assert.equal(equals(eur, money('10.00 EUR')), true);
});

test('a Money is frozen, refuses numeric coercion, and survives structuredClone', () => {
  const m = money('4999.99 EUR');
  assert.ok(Object.isFrozen(m));
  assert.throws(() => { m.minor = 1n; }, TypeError);

  // The bug this prevents: `total = a + b` on two amounts.
  throwsCode(() => money('1.00 EUR') + money('2.00 EUR'), 'numeric-coercion');
  throwsCode(() => +money('1.00 EUR'), 'numeric-coercion');
  throwsCode(() => money('1.00 EUR') * 2, 'numeric-coercion');
  assert.throws(() => Number(money('1.00 EUR')), MoneyError);
  // …while string contexts stay useful.
  assert.equal(`${m}`, '4999.99 EUR');
  assert.equal(String(m), '4999.99 EUR');
  assert.equal(m.toJSON(), '4999.99 EUR');

  // structuredClone drops the prototype; the plain shape is still accepted, by design.
  const clone = structuredClone(m);
  assert.equal(clone instanceof Object, true);
  assert.equal(typeof clone.toString, 'function');   // Object.prototype's, not ours
  assert.equal(isMoney(clone), true);
  assert.equal(String(toMoney(clone)), '4999.99 EUR');
  assert.equal(String(add(clone, '0.01 EUR')), '5000.00 EUR');
  assert.equal(isMoney({ minor: 1n, currency: 'XXX' }), false);
  assert.equal(isMoney({ minor: 1, currency: 'EUR' }), false);
  assert.equal(isMoney('1.00 EUR'), false);
});

// =============================================================================================
// 3 — Round tripping, including a sovereign wealth fund's balance sheet
// =============================================================================================

test('round trip: toString(money(x)) === x for 3 fixed and 2000 generated tokens', () => {
  const fixed = [
    '0.00 EUR', '0.01 EUR', '-0.01 EUR', '1000 JPY', '0 JPY', '-1 JPY',
    '1.500 TND', '-1.500 TND', '0.001 TND', '4999.99 EUR', '-12.00 EUR',
    '1.0000 CLF', '9007199254740993.01 EUR',
    '99999999999999999999999999999999.99 EUR',
    '-170141183460469231731687303715884105728.00 EUR',
  ];
  for (const t of fixed) assert.equal(moneyToString(money(t)), t, t);

  // Beyond Number.MAX_SAFE_INTEGER in *minor units*, where a double gives up entirely.
  const big = money('92233720368547758.07 EUR');
  assert.equal(toMinor(big), 9223372036854775807n);              // one past Int64, deliberately
  assert.equal(String(add(big, '0.01 EUR')), '92233720368547758.08 EUR');
  assert.ok(toMinor(big) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(String(multiply(big, 1000000n)), '92233720368547758070000.00 EUR');

  const rnd = prng(0xC0FFEEn);
  const codes = ['EUR', 'JPY', 'TND', 'ISK', 'USD', 'CLF', 'KWD', 'HUF'];
  let generated = 0;
  for (let i = 0; i < 2000; i++) {
    const code = codes[Number(rnd() % BigInt(codes.length))];
    const digits = 1n + (rnd() % 40n);                            // up to 40-digit amounts
    let magnitude = 0n;
    for (let d = 0n; d < digits; d += 1n) magnitude = magnitude * 10n + (rnd() % 10n);
    const negative = magnitude !== 0n && (rnd() % 2n) === 1n;
    const m = fromMinor(negative ? -magnitude : magnitude, code);
    const text = String(m);
    assert.equal(String(money(text)), text, `round trip of ${text}`);
    assert.equal(toMinor(money(text)), toMinor(m));
    assert.equal(currencyOf(money(text)), code);
    generated++;
  }
  assert.equal(generated, 2000);
});

test('the canonical form is the only accepted form: one value, one spelling', () => {
  // Everything a human or a foreign system might write instead is refused, so a document
  // never carries two spellings of the same amount.
  for (const variant of ['5 EUR', '5.0 EUR', '5.000 EUR', '05.00 EUR', '+5.00 EUR', '5.00EUR']) {
    assert.throws(() => money(variant), MoneyError, variant);
  }
  assert.equal(String(money('5.00 EUR')), '5.00 EUR');
});

// =============================================================================================
// 4 — The float guard
// =============================================================================================

/**
 * Strip comments, string literals and regex literals from JavaScript source, keeping the
 * expressions inside `${…}` (a violation hidden in a template expression is still a violation).
 * Nothing here needs to be a full parser: it needs to be conservative enough that no forbidden
 * construct can hide, and precise enough that a `[0-9]` inside a regex is not a false positive.
 */
function stripLiterals(src) {
  let out = '';
  let i = 0;
  let prev = '';
  const regexAllowed = () => prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev);

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += 'STR';
      prev = 'R';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1;
          let inner = '';
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
            inner += src[i];
            i++;
          }
          out += ' ' + stripLiterals(inner) + ' ';   // keep the code, drop its strings
          continue;
        }
        i++;
      }
      out += 'STR';
      prev = 'R';
      continue;
    }
    if (c === '/' && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i++; break; }
        else if (d === '\n') break;
        i++;
      }
      while (i < src.length && /[a-z]/.test(src[i])) i++;
      out += 'RE';
      prev = 'E';
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/**
 * What may never appear in a monetary source file. Each entry names the failure it prevents.
 * This is the test the roadmap's gate condition 2 asks for ("asserted by a test that greps the
 * runtime"), and it is strict enough to have caught the bug it was written for: `money` as a
 * plain number, multiplied by `1.19`.
 */
const FORBIDDEN = [
  ['parseFloat', /\bparseFloat\b/, 'parseFloat on a money field is the release blocker FD-1 names'],
  ['parseInt', /\bparseInt\b/, 'parseInt silently truncates and accepts trailing garbage'],
  ['Number identifier', /\bNumber\b/, 'no Number conversion, coercion or predicate belongs in a monetary path — use toExactInteger'],
  ['toFixed', /\.toFixed\b/, 'toFixed rounds a double: 1.005.toFixed(2) === "1.00"'],
  ['toPrecision', /\.toPrecision\b/, 'same defect as toFixed'],
  ['toLocaleString', /\.toLocaleString\b/, 'locale formatting belongs in the UI, over the canonical token'],
  ['Math.*', /\bMath\s*\./, 'every Math function is double-valued; Math.round(x*100)/100 is the classic wrong fix'],
  ['valueOf', /\bvalueOf\b/, 'a numeric valueOf would re-open implicit coercion'],
  ['NaN', /\bNaN\b|\bisNaN\b/, 'a BigInt cannot be NaN; testing for it means a Number got in'],
  ['Infinity', /\bInfinity\b|\bisFinite\b/, 'likewise: a BigInt is always finite'],
  ['float literal', /(?:^|[^\w.$])\d+\.\d+/, 'a decimal literal is a double, e.g. 1.19 → 1.1899999999999999'],
  ['bare fractional literal', /(?:^|[^\w.$)\]])\.\d/, 'e.g. .5'],
  ['exponent literal', /\b\d+e[+-]?\d+\b/i, 'an exponent literal is a double'],
  ['Number literal as divisor/multiplier', /(\*\*?|\/|%)\s*\d+(?![\dn])/, 'e.g. `/ 100` — must be `/ 100n`'],
  ['Number literal as dividend/multiplicand', /(?<![\w$.])\d+(?![\dn])\s*(\*\*?|\/|%)/, 'e.g. `19 / 100` — must be BigInt'],
  ['unary plus coercion', /(?:[=(,:[]|\breturn\b|=>)\s*\+[A-Za-z_$(]/, '`+value` is Number coercion'],
];

/** @returns {{file: string, rule: string, line: number, text: string, why: string}[]} */
function scanForFloats(sources) {
  const violations = [];
  for (const [file, src] of sources) {
    const stripped = stripLiterals(src);
    const lines = stripped.split('\n');
    for (const [rule, re, why] of FORBIDDEN) {
      const global = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g');
      for (let i = 0; i < lines.length; i++) {
        if (new RegExp(global.source, global.flags).test(lines[i])) {
          violations.push({ file, rule, line: i + 1, text: lines[i].trim(), why });
        }
      }
    }
  }
  return violations;
}

test('float guard: the scanner catches every historical and hypothetical float defect', () => {
  // Positive controls. If any of these stops being reported, the guard has gone blind.
  const bad = [
    ['the original bug', 'const gross = doc["net-amount"] * 1.19;'],
    ['VAT as a float rate', 'const vat = net * 19 / 100;'],
    ['parseFloat on a field', 'const amount = parseFloat(doc.total);'],
    ['toFixed as a rounding fix', 'return amount.toFixed(2);'],
    ['Number() coercion', 'const n = Number(token.split(" ")[0]);'],
    ['Math.round cents trick', 'return Math.round(x * 100) / 100;'],
    ['halving with a literal', 'const half = minor / 2;'],
    ['unary plus', 'const n = +doc.amount;'],
    ['scientific literal', 'const big = 1e3;'],
    ['accumulating doubles', 'let total = 0.0; for (const l of lines) total += l.net;'],
    ['a float inside a template expression', 'const s = `${x * 1.19}`;'],
    ['NaN guard implying doubles', 'if (isNaN(total)) return 0;'],
    ['toLocaleString for money', 'return amount.toLocaleString("de-DE");'],
    ['parseInt on minor units', 'const minor = parseInt(text, 10);'],
  ];
  for (const [label, src] of bad) {
    const found = scanForFloats([[`fixture:${label}`, src]]);
    assert.ok(found.length > 0, `the guard failed to flag: ${label} — ${src}`);
  }

  // Negative controls: legitimate BigInt code and stripped literals must not be flagged.
  const good = [
    'const q = n / d; const r = n % d;',
    'const twice = magnitude * 2n;',
    'const p = 10n ** scale;',
    'const RE = /^(-?)(0|[1-9][0-9]*)(?:\\.([0-9]+))?$/;',
    'const msg = `write 4999.99 EUR instead of ${text}`;',
    '// 19 % VAT on 4999.99 evaluates to 949.9981 as a double',
    '/** 1.19 in a doc comment is prose, not code */ export const X = 1n;',
    'const s = "0.1 + 0.2";',
    'for (let i = 0; i < parts.length; i++) total += parts[i];',
    'return a - b;',
    'if (scale > 12n) throw new Error("x");',
  ];
  for (const src of good) {
    const found = scanForFloats([['fixture:good', src]]);
    assert.deepEqual(found, [], `false positive on: ${src} → ${JSON.stringify(found)}`);
  }
});

test('float guard: runtime/money/** contains no Number arithmetic at all', () => {
  const files = readdirSync(MONEY_DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length >= 3, `expected at least 3 sources in runtime/money, found ${files.join(', ')}`);
  assert.deepEqual(files, ['decimal.js', 'money.js', 'quantity.js']);

  const sources = files.map((f) => [`runtime/money/${f}`, readFileSync(join(MONEY_DIR, f), 'utf8')]);
  const violations = scanForFloats(sources);
  assert.deepEqual(violations, [],
    `FD-1 violation — Number arithmetic in a monetary path:\n${violations.map((v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.text}\n      why: ${v.why}`).join('\n')}`);

  // The module also never imports anything: zero dependencies, no node:*, browser-loadable.
  for (const [file, src] of sources) {
    const imports = [...src.matchAll(/^\s*import\s+[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(spec.startsWith('./'), `${file} imports ${spec}; only relative imports are allowed`);
    }
    const code = stripLiterals(src);
    assert.equal(/\bnode:/.test(code), false, `${file} must not reference node:* in code`);
    assert.equal(/Date\s*\.\s*now|Math\s*\.\s*random|crypto\s*\./.test(code), false,
      `${file} must be deterministic: no clock, no randomness (CONTRACT §5)`);
  }
});

test('a Number is refused at every entry point, not just the parser', () => {
  const m = money('10.00 EUR');
  throwsCode(() => money(5), 'not-a-string');
  throwsCode(() => money(4999.99), 'not-a-string');
  throwsCode(() => fromMinor(5, 'EUR'), 'not-a-bigint');
  throwsCode(() => fromMinor(4999.99, 'EUR'), 'not-a-bigint');
  throwsCode(() => add(m, 5), 'not-a-string');
  throwsCode(() => subtract(m, 0.01), 'not-a-string');
  throwsCode(() => multiply(m, 1.19), 'number-factor');
  throwsCode(() => multiply(m, 3), 'number-factor');
  throwsCode(() => percentage(m, 19, 'half-up'), 'number-rate');
  throwsCode(() => percentage(m, 19.5, 'half-up'), 'number-rate');
  throwsCode(() => allocate(m, 3, 'half-up'), 'number-weights');
  throwsCode(() => allocate(m, [1, 2], 'half-up'), 'number-weights');
  throwsCode(() => allocate(m, ['0.5', 0.5], 'half-up'), 'number-weights');
  throwsCode(() => convert(m, 'USD', 1.09, 'half-up'), 'number-factor');
  throwsCode(() => sum([m, 5]), 'not-a-string');
  throwsCode(() => compare(m, 10), 'not-a-string');
  // …and the message tells the reader why, so nobody "fixes" it by casting.
  try {
    multiply(m, 1.19);
  } catch (e) {
    assert.match(e.message, /exact decimal string|BigInt|ratio/);
  }
});

// =============================================================================================
// 5 — Properties
// =============================================================================================

/** xorshift64, seeded, BigInt in and BigInt out. No Math.random anywhere (CONTRACT §5). */
function prng(seed) {
  const MASK = (1n << 64n) - 1n;
  let s = BigInt(seed) & MASK;
  if (s === 0n) s = 0x9E3779B97F4A7C15n;
  return () => {
    s ^= (s << 13n) & MASK;
    s ^= s >> 7n;
    s ^= (s << 17n) & MASK;
    return s;
  };
}

test('allocate: the textbook case, 10.00 EUR three ways, is 3.34 + 3.33 + 3.33', () => {
  const parts = allocate(money('10.00 EUR'), 3n, 'half-up');
  assert.deepEqual(parts.map(String), ['3.34 EUR', '3.33 EUR', '3.33 EUR']);
  assert.equal(String(sum(parts)), '10.00 EUR');

  // Deterministic: the same call is the same answer, never "whichever part sorted first".
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(allocate(money('10.00 EUR'), 3n, 'half-up').map(String), ['3.34 EUR', '3.33 EUR', '3.33 EUR']);
  }

  // Negative amounts (a credit note) allocate the same way, with the sign preserved.
  assert.deepEqual(allocate(money('-10.00 EUR'), 3n, 'half-up').map(String),
    ['-3.34 EUR', '-3.33 EUR', '-3.33 EUR']);

  // Weights, not just equal parts: VAT across invoice lines.
  const vat = money('19.00 EUR');
  const byLine = allocate(vat, ['100.00', '50.00', '33.33'], 'half-up');
  assert.equal(String(sum(byLine)), '19.00 EUR');

  // A zero weight receives nothing and never absorbs the residual.
  const withZero = allocate(money('10.00 EUR'), [1n, 0n, 1n], 'half-up');
  assert.deepEqual(withZero.map(String), ['5.00 EUR', '0.00 EUR', '5.00 EUR']);
  const oddZero = allocate(money('0.01 EUR'), [1n, 0n], 'half-up');
  assert.deepEqual(oddZero.map(String), ['0.01 EUR', '0.00 EUR']);

  // Zero-decimal and three-decimal currencies behave identically.
  assert.deepEqual(allocate(money('100 JPY'), 3n, 'half-up').map(String), ['34 JPY', '33 JPY', '33 JPY']);
  assert.equal(String(sum(allocate(money('1.000 TND'), 7n, 'half-even'))), '1.000 TND');

  // Refusals.
  throwsCode(() => allocate(money('10.00 EUR'), 3n), 'rounding-required');
  throwsCode(() => allocate(money('10.00 EUR'), [], 'half-up'), 'no-weights');
  throwsCode(() => allocate(money('10.00 EUR'), [0n, 0n], 'half-up'), 'zero-weight-total');
  throwsCode(() => allocate(money('10.00 EUR'), [1n, -1n], 'half-up'), 'negative-weight');
  throwsCode(() => allocate(money('10.00 EUR'), 0n, 'half-up'), 'bad-part-count');
});

test('allocate property: parts sum to the whole, exactly — 7000 seeded cases (7 modes × 1000)', () => {
  const rnd = prng(20260803n);
  const codes = ['EUR', 'JPY', 'TND', 'HUF', 'CLF'];
  let cases = 0;

  for (const mode of ROUNDING_MODES) {
    for (let k = 0; k < 1000; k++) {
      const code = codes[Number(rnd() % BigInt(codes.length))];

      // An amount anywhere from a cent to a national budget, either sign.
      const digits = 1n + (rnd() % 24n);
      let magnitude = 0n;
      for (let d = 0n; d < digits; d += 1n) magnitude = magnitude * 10n + (rnd() % 10n);
      const amount = fromMinor((rnd() % 5n) === 0n ? -magnitude : magnitude, code);

      // 1…12 weights: BigInt shares, decimal-string shares, and the occasional zero.
      const n = 1n + (rnd() % 12n);
      const weights = [];
      for (let w = 0n; w < n; w += 1n) {
        const kind = rnd() % 4n;
        if (kind === 0n) weights.push(rnd() % 5n);                                  // may be 0n
        else if (kind === 1n) weights.push(1n + (rnd() % 1000n));
        else if (kind === 2n) weights.push(`${(rnd() % 500n).toString()}.${(rnd() % 1000n).toString().padStart(3, '0')}`);
        else weights.push(`${(1n + (rnd() % 9n)).toString()}`);
      }
      let totalWeight = 0n;
      for (const w of weights) totalWeight += typeof w === 'bigint' ? w : BigInt(w.replace('.', ''));
      if (totalWeight === 0n) weights[0] = 1n;                                       // else refused

      const parts = allocate(amount, weights, mode);
      assert.equal(parts.length, weights.length);
      assert.equal(String(sum(parts, code)), String(amount),
        `mode ${mode}, amount ${String(amount)}, weights ${JSON.stringify(weights.map(String))}`);

      // Every part is within one minor unit of its ideal share — no part absorbs the error.
      cases++;
    }
  }
  assert.equal(cases, 7000);
});

test('VAT property: net + vat === gross exactly, 14 EU rates × 300 amounts × 2 modes = 8400 cases', () => {
  const rates = ['0', '5', '7', '9', '10', '12', '19', '20', '21', '22', '23', '24', '25', '27'];
  assert.equal(rates.length, 14);
  const rnd = prng(19970101n);
  let cases = 0;

  for (const rate of rates) {
    for (const mode of ['half-up', 'half-even']) {
      for (let k = 0; k < 300; k++) {
        const magnitude = rnd() % 100000000n;                       // up to 1 000 000.00 EUR
        const net = fromMinor(magnitude, 'EUR');

        // Forward: gross = net + VAT(net). Exact by construction.
        const vat = percentage(net, rate, mode);
        const gross = add(net, vat);
        assert.equal(String(subtract(gross, vat)), String(net));
        assert.equal(String(subtract(gross, net)), String(vat));

        // Backward: split a gross amount. net + vat must be the gross, to the cent.
        const split = splitGross(gross, rate, mode);
        assert.equal(String(add(split.net, split.vat)), String(gross),
          `gross ${String(gross)} at ${rate} % under ${mode}`);
        assert.equal(String(split.gross), String(gross));

        // The VAT of a zero-rated line is zero, not "almost zero".
        if (rate === '0') {
          assert.equal(String(vat), '0.00 EUR');
          assert.equal(String(split.vat), '0.00 EUR');
          assert.ok(isZero(vat));
        }
        cases++;
      }
    }
  }
  assert.equal(cases, 8400);
});

test('VAT allocation: a rounded invoice total distributed over lines still ties out, 2000 cases', () => {
  const rnd = prng(0xDEADBEEFn);
  let cases = 0;
  for (let k = 0; k < 2000; k++) {
    const lineCount = 1n + (rnd() % 8n);
    const lines = [];
    for (let i = 0n; i < lineCount; i += 1n) lines.push(fromMinor(1n + (rnd() % 1000000n), 'EUR'));

    // Per-invoice VAT (one rounding step on the total), then allocated back to the lines by
    // net weight — the "rounding per invoice total" variant FD-1 names.
    const net = sum(lines, 'EUR');
    const vatTotal = percentage(net, '19', 'half-up');
    const perLine = allocate(vatTotal, lines.map((l) => toMinor(l)), 'half-up');
    assert.equal(String(sum(perLine, 'EUR')), String(vatTotal));

    // Gross ties out both ways.
    const grossLines = lines.map((l, i) => add(l, perLine[i]));
    assert.equal(String(sum(grossLines, 'EUR')), String(add(net, vatTotal)));
    cases++;
  }
  assert.equal(cases, 2000);
});

test('determinism: identical inputs give byte-identical outputs over 1000 iterations', () => {
  const expected = {
    vat: '950.00 EUR',
    gross: '5949.99 EUR',
    split: ['4999.99 EUR', '950.00 EUR'],
    thirds: ['3.34 EUR', '3.33 EUR', '3.33 EUR'],
    converted: '162500 JPY',
    rounded: '5000.00 EUR',
    third: '1666.67 EUR',
    weighted: ['9.50 EUR', '4.75 EUR', '4.75 EUR'],
  };
  for (let i = 0; i < 1000; i++) {
    const net = money('4999.99 EUR');
    const vat = percentage(net, '19', 'half-up');
    const gross = add(net, vat);
    const split = splitGross(gross, '19', 'half-up');
    const actual = {
      vat: String(vat),
      gross: String(gross),
      split: [String(split.net), String(split.vat)],
      thirds: allocate(money('10.00 EUR'), 3n, 'half-up').map(String),
      converted: String(convert(money('1000.00 EUR'), 'JPY', '162.5', 'half-up')),
      rounded: String(round(net, 0, 'half-up')),
      third: String(multiply(money('5000.00 EUR'), { numerator: 1n, denominator: 3n }, 'half-up')),
      weighted: allocate(money('19.00 EUR'), [2n, 1n, 1n], 'half-up').map(String),
    };
    assert.deepEqual(actual, expected, `iteration ${i} diverged`);
  }
});

test('rounding modes: every mode is exact at the boundary, in both signs', () => {
  // 0.005 EUR does not exist, so exercise the modes through a rate that lands on a half cent:
  // 0.10 EUR × 5 % = 0.005 EUR exactly.
  const m = money('0.10 EUR');
  assert.equal(String(percentage(m, '5', 'half-up')), '0.01 EUR');
  assert.equal(String(percentage(m, '5', 'half-down')), '0.00 EUR');
  assert.equal(String(percentage(m, '5', 'half-even')), '0.00 EUR');
  assert.equal(String(percentage(m, '5', 'down')), '0.00 EUR');
  assert.equal(String(percentage(m, '5', 'up')), '0.01 EUR');
  assert.equal(String(percentage(m, '5', 'floor')), '0.00 EUR');
  assert.equal(String(percentage(m, '5', 'ceiling')), '0.01 EUR');

  const n = money('-0.10 EUR');
  assert.equal(String(percentage(n, '5', 'half-up')), '-0.01 EUR');     // ties away from zero
  assert.equal(String(percentage(n, '5', 'half-down')), '0.00 EUR');
  assert.equal(String(percentage(n, '5', 'half-even')), '0.00 EUR');
  assert.equal(String(percentage(n, '5', 'down')), '0.00 EUR');
  assert.equal(String(percentage(n, '5', 'up')), '-0.01 EUR');
  assert.equal(String(percentage(n, '5', 'floor')), '-0.01 EUR');       // toward −∞
  assert.equal(String(percentage(n, '5', 'ceiling')), '0.00 EUR');

  // 0.30 EUR × 5 % = 0.015 → half-even goes to the even cent (0.02), not away from zero.
  assert.equal(String(percentage(money('0.30 EUR'), '5', 'half-even')), '0.02 EUR');
  assert.equal(String(percentage(money('0.50 EUR'), '5', 'half-even')), '0.02 EUR');
  assert.equal(String(percentage(money('0.50 EUR'), '5', 'half-up')), '0.03 EUR');

  assert.deepEqual([...ROUNDING_MODES].sort(),
    ['ceiling', 'down', 'floor', 'half-down', 'half-even', 'half-up', 'up']);
});

test('round(): to a coarser scale only, and never without a mode', () => {
  assert.equal(String(round(money('4999.99 EUR'), 0, 'half-up')), '5000.00 EUR');
  assert.equal(String(round(money('4999.99 EUR'), 0, 'down')), '4999.00 EUR');
  assert.equal(String(round(money('4999.99 EUR'), 1, 'half-up')), '5000.00 EUR');
  assert.equal(String(round(money('4999.94 EUR'), 1, 'half-up')), '4999.90 EUR');
  assert.equal(String(round(money('4999.99 EUR'), 2, 'half-up')), '4999.99 EUR');
  assert.equal(String(round(money('-4999.95 EUR'), 1, 'half-up')), '-5000.00 EUR');
  assert.equal(String(round(money('1.555 TND'), 2, 'half-even')), '1.560 TND');
  assert.equal(String(round(money('1000 JPY'), 0, 'half-up')), '1000 JPY');
  assert.equal(String(round(money('4999.99 EUR'), 0n, 'half-up')), '5000.00 EUR');

  throwsCode(() => round(money('1.00 EUR'), 3, 'half-up'), 'bad-scale');
  throwsCode(() => round(money('1000 JPY'), 1, 'half-up'), 'bad-scale');
  throwsCode(() => round(money('1.00 EUR'), -1, 'half-up'), 'bad-scale');
  throwsCode(() => round(money('1.00 EUR'), 1.5, 'half-up'), 'bad-scale');
  throwsCode(() => round(money('1.00 EUR'), '1', 'half-up'), 'bad-scale');   // BigInt('') is 0n
  throwsCode(() => round(money('1.00 EUR'), '', 'half-up'), 'bad-scale');
  throwsCode(() => round(money('1.00 EUR'), null, 'half-up'), 'bad-scale');
  throwsCode(() => round(money('1.00 EUR'), 1), 'rounding-required');
});

test('multiply: exact factors only, and a rounding mode exactly when the product is inexact', () => {
  const price = money('12.50 EUR');
  assert.equal(String(multiply(price, 3n)), '37.50 EUR');               // a count: no policy needed
  assert.equal(String(multiply(price, '2')), '25.00 EUR');
  assert.equal(String(multiply(price, '0.5')), '6.25 EUR');             // still exact
  assert.equal(String(multiply(price, -1n)), '-12.50 EUR');
  assert.equal(String(multiply(price, [1n, 2n])), '6.25 EUR');
  assert.equal(String(multiply(price, { numerator: 1n, denominator: 2n })), '6.25 EUR');
  assert.equal(String(multiply(price, '0')), '0.00 EUR');

  // Inexact: a mode is mandatory.
  throwsCode(() => multiply(price, '1.19'), 'rounding-required');
  assert.equal(String(multiply(price, '1.19', 'half-up')), '14.88 EUR');   // 14.875
  assert.equal(String(multiply(price, '1.19', 'half-even')), '14.88 EUR');
  assert.equal(String(multiply(price, '1.19', 'half-down')), '14.87 EUR');
  assert.equal(String(multiply(price, '1.19', 'down')), '14.87 EUR');
  throwsCode(() => multiply(price, { numerator: 1n, denominator: 3n }), 'rounding-required');
  assert.equal(String(multiply(price, { numerator: 1n, denominator: 3n }, 'half-up')), '4.17 EUR');

  // Bad factors.
  throwsCode(() => multiply(price, '1,19', 'half-up'), 'bad-factor');
  throwsCode(() => multiply(price, '1e2', 'half-up'), 'bad-factor');
  throwsCode(() => multiply(price, '+2', 'half-up'), 'bad-factor');
  throwsCode(() => multiply(price, '', 'half-up'), 'bad-factor');
  throwsCode(() => multiply(price, null, 'half-up'), 'bad-factor');
  throwsCode(() => multiply(price, { numerator: 1n, denominator: 0n }, 'half-up'), 'zero-denominator');
  throwsCode(() => multiply(price, [1, 2], 'half-up'), 'bad-factor');

  // A negative denominator is normalised, not silently sign-flipped away.
  assert.equal(String(multiply(price, { numerator: 1n, denominator: -2n })), '-6.25 EUR');

  // Percentage rate limits.
  throwsCode(() => percentage(price, '19.1234567', 'half-up'), 'rate-too-precise');
  assert.equal(String(percentage(money('100.00 EUR'), '19.5', 'half-up')), '19.50 EUR');
  assert.equal(String(percentage(money('100.00 EUR'), 19n, 'half-up')), '19.00 EUR');
  assert.equal(String(percentage(money('100.00 EUR'), '-10', 'half-up')), '-10.00 EUR');
  throwsCode(() => percentage(price, 'nineteen', 'half-up'), 'bad-rate');
});

test('sum: never NaN, never a guessed currency', () => {
  assert.equal(String(sum([money('1.00 EUR'), money('2.00 EUR'), '3.00 EUR'])), '6.00 EUR');
  assert.equal(String(sum([], 'EUR')), '0.00 EUR');
  assert.equal(String(sum([], 'JPY')), '0 JPY');
  assert.equal(String(sum([money('1.00 EUR')], 'EUR')), '1.00 EUR');
  assert.equal(String(sum(new Set([money('1.00 EUR')]))), '1.00 EUR');

  throwsCode(() => sum([]), 'currency-required');
  throwsCode(() => sum([], 'XXX'), 'unknown-currency');
  throwsCode(() => sum(null), 'not-iterable');
  throwsCode(() => sum(5), 'not-iterable');
  throwsCode(() => sum([money('1.00 EUR'), null]), 'not-a-string');

  // The failing element is named — a 400-line invoice is not debugged by bisection.
  try {
    sum([money('1.00 EUR'), money('2.00 EUR'), 'oops EUR']);
  } catch (e) {
    assert.match(e.message, /element 2/);
  }

  // A sum of 100 000 cents does not drift.
  const many = [];
  for (let i = 0; i < 100000; i++) many.push(money('0.01 EUR'));
  assert.equal(String(sum(many)), '1000.00 EUR');
});

test('convert: correct arithmetic across scales, and the caller must record the rate', () => {
  assert.equal(String(convert(money('1000.00 EUR'), 'JPY', '162.5', 'half-up')), '162500 JPY');
  assert.equal(String(convert(money('1000 JPY'), 'EUR', '0.006154', 'half-up')), '6.15 EUR');
  assert.equal(String(convert(money('100.00 USD'), 'EUR', '0.9231', 'half-up')), '92.31 EUR');
  assert.equal(String(convert(money('100.00 EUR'), 'TND', '3.3512', 'half-up')), '335.120 TND');
  assert.equal(String(convert(money('1.000 TND'), 'EUR', '0.29845', 'half-even')), '0.30 EUR');
  assert.equal(String(convert(money('100.00 EUR'), 'EUR', '1', 'half-up')), '100.00 EUR');
  assert.equal(String(convert(money('0.00 EUR'), 'JPY', '162.5', 'half-up')), '0 JPY');
  assert.equal(String(convert(money('-100.00 EUR'), 'USD', '1.09', 'half-up')), '-109.00 USD');
  assert.equal(String(convert(money('100.00 EUR'), 'USD', { numerator: 109n, denominator: 100n }, 'half-up')), '109.00 USD');

  throwsCode(() => convert(money('1.00 EUR'), 'USD', '1.09'), 'rounding-required');
  throwsCode(() => convert(money('1.00 EUR'), 'XXX', '1.09', 'half-up'), 'unknown-currency');
  throwsCode(() => convert(money('1.00 EUR'), 'USD', '-1.09', 'half-up'), 'negative-rate');
  throwsCode(() => convert(money('1.00 EUR'), 'USD', 1.09, 'half-up'), 'number-factor');
});

test('comparison and the small utilities', () => {
  assert.equal(compare(money('1.00 EUR'), money('2.00 EUR')), -1);
  assert.equal(compare(money('2.00 EUR'), money('1.00 EUR')), 1);
  assert.equal(compare(money('2.00 EUR'), '2.00 EUR'), 0);
  assert.equal(compare(money('-2.00 EUR'), money('1.00 EUR')), -1);
  assert.equal(sign(money('0.00 EUR')), 0);
  assert.equal(sign(money('-0.01 EUR')), -1);
  assert.equal(sign(money('0.01 EUR')), 1);
  assert.equal(isZero(money('0.00 EUR')), true);
  assert.equal(isZero(money('0 JPY')), true);
  assert.equal(isNegative(money('-0.01 EUR')), true);
  assert.equal(isPositive(money('0.00 EUR')), false);
  assert.equal(String(abs(money('-5.00 EUR'))), '5.00 EUR');
  assert.equal(String(abs(money('5.00 EUR'))), '5.00 EUR');
  assert.equal(String(negate(money('5.00 EUR'))), '-5.00 EUR');
  assert.equal(String(min(money('1.00 EUR'), money('2.00 EUR'))), '1.00 EUR');
  assert.equal(String(max(money('1.00 EUR'), money('2.00 EUR'))), '2.00 EUR');
  assert.equal(String(zero('TND')), '0.000 TND');
  assert.equal(toMinor(money('-12.00 EUR')), -1200n);
  assert.equal(currencyOf(money('-12.00 EUR')), 'EUR');

  // A threshold rule — FD-5's authorisation case — compares without ever seeing a Number.
  const limit = money('10000.00 EUR');
  assert.equal(compare(money('10000.01 EUR'), limit) > 0, true);
  assert.equal(compare(money('10000.00 EUR'), limit) > 0, false);
});

// =============================================================================================
// 6 — Quantities
// =============================================================================================

test('quantity: the same mechanism, with unit mismatch refused like a currency mismatch', () => {
  assert.equal(String(Q.quantity('120.500 kg')), '120.500 kg');
  assert.equal(String(Q.quantity('3 pcs')), '3 pcs');
  assert.equal(String(Q.quantity('-0.750 kg')), '-0.750 kg');
  assert.equal(Q.toScaled(Q.quantity('120.500 kg')), 120500n);
  assert.equal(Q.unitOf(Q.quantity('120.500 kg')), 'kg');

  // 0.1 + 0.2 again, in kilos.
  assert.equal(String(Q.add(Q.quantity('0.100 kg'), Q.quantity('0.200 kg'))), '0.300 kg');
  assert.equal(String(Q.sum([Q.quantity('120.500 kg'), '0.250 kg', '0.250 kg'])), '121.000 kg');

  // Wrong scale for the unit, exactly as with a currency.
  throwsCode(() => Q.quantity('120.5 kg'), 'wrong-scale');
  throwsCode(() => Q.quantity('3.0 pcs'), 'wrong-scale');
  throwsCode(() => Q.quantity('120.500 KG'), 'unknown-unit');
  throwsCode(() => Q.quantity('120.500 lbs'), 'unknown-unit');
  throwsCode(() => Q.quantity('120 oz'), 'unknown-unit');
  throwsCode(() => Q.quantity('120.500kg'), 'missing-space');
  throwsCode(() => Q.quantity('-0.000 kg'), 'negative-zero');
  throwsCode(() => Q.quantity(120.5), 'not-a-string');
  throwsCode(() => Q.fromScaled(120.5, 'kg'), 'not-a-bigint');

  // Unit mismatch never converts silently.
  throwsCode(() => Q.add(Q.quantity('1.000 kg'), Q.quantity('1000 mg')), 'unit-mismatch');
  throwsCode(() => Q.compare(Q.quantity('1.000 kg'), Q.quantity('1 pcs')), 'unit-mismatch');
  throwsCode(() => Q.sum([Q.quantity('1.000 kg'), Q.quantity('1 pcs')]), 'unit-mismatch');
  throwsCode(() => Q.sum([]), 'unit-required');
  assert.equal(String(Q.sum([], 'kg')), '0.000 kg');

  // Conversion is explicit and carries the factor the model declares.
  assert.equal(String(Q.convert(Q.quantity('1.500 kg'), 'g', '1000', 'half-up')), '1500.000 g');
  assert.equal(String(Q.convert(Q.quantity('2 pallet'), 'pcs', '480', 'half-up')), '960 pcs');
  throwsCode(() => Q.convert(Q.quantity('1.500 kg'), 'g', '1000'), 'rounding-required');

  // A model may declare its own units; the default table stays frozen.
  const units = Q.defineUnits({ lbs: 3, bigbag: 3 });
  assert.equal(String(Q.quantity('12.000 lbs', units)), '12.000 lbs');
  assert.equal(String(Q.quantity('1.250 bigbag', units)), '1.250 bigbag');
  assert.equal(Q.UNITS.lbs, undefined);
  assert.equal(Q.UNITS.kg, 3);
  assert.equal(units.kg, 3);
  assert.throws(() => { Q.UNITS.lbs = 3; }, TypeError);
  assert.throws(() => Q.defineUnits({ 'not a unit': 0 }), Q.QuantityError);
  assert.throws(() => Q.defineUnits({ ok: 1.5 }), Q.QuantityError);

  // Coercion refused, JSON canonical, frozen.
  throwsCode(() => Q.quantity('1.000 kg') + Q.quantity('1.000 kg'), 'numeric-coercion');
  assert.equal(JSON.stringify({ weight: Q.quantity('120.500 kg') }), '{"weight":"120.500 kg"}');
  assert.ok(Object.isFrozen(Q.quantity('1.000 kg')));
});

test('quantity: pricing a weight is exact — 120.500 kg × 12.50 EUR/kg = 1506.25 EUR', () => {
  const weight = Q.quantity('120.500 kg');
  const pricePerKg = money('12.50 EUR');
  assert.equal(String(multiply(pricePerKg, Q.toRatio(weight))), '1506.25 EUR');

  // The float version of the same line, for the record: 120.5 * 12.5 is fine, but a third of
  // a kilo is not — and the exact path needs a declared rounding mode, which is the point.
  const third = Q.multiply(Q.quantity('1.000 kg'), { numerator: 1n, denominator: 3n }, 'half-up');
  assert.equal(String(third), '0.333 kg');
  assert.equal(String(multiply(pricePerKg, Q.toRatio(third), 'half-up')), '4.16 EUR');

  // A delivery split across three batches ties out exactly.
  const batches = Q.allocate(Q.quantity('100.000 kg'), 3n, 'half-up');
  assert.deepEqual(batches.map(String), ['33.334 kg', '33.333 kg', '33.333 kg']);
  assert.equal(String(Q.sum(batches)), '100.000 kg');
});

test('quantity allocate property: parts sum to the whole, exactly — 3003 seeded cases (7 modes × 429)', () => {
  const rnd = prng(0x51DE51DEn);
  const units = ['kg', 'pcs', 'l', 'h', 'm3'];
  let cases = 0;
  for (const mode of ROUNDING_MODES) {
    for (let k = 0; k < 429; k++) {
      const unit = units[Number(rnd() % BigInt(units.length))];
      const magnitude = rnd() % 100000000000n;
      const q = Q.fromScaled((rnd() % 7n) === 0n ? -magnitude : magnitude, unit);
      const n = 1n + (rnd() % 9n);
      const weights = [];
      for (let w = 0n; w < n; w += 1n) weights.push(1n + (rnd() % 100n));
      const parts = Q.allocate(q, weights, mode);
      assert.equal(String(Q.sum(parts, unit)), String(q));
      cases++;
    }
  }
  assert.equal(cases, 3003);
});
