# `runtime/money/` — exact monetary arithmetic

**Owner:** agent M. **Binding specification:** FD-1 in `docs/ROADMAP-V1.md`.
**Status:** complete and tested (`node --test test/m-money.test.js` — 27 tests, 0 failures).

Every rule, report, invoice and ledger entry in NeoDonkey sits on this module. It has one job:
**no `Number` ever touches a monetary value.** Not in this directory, and not in yours.

```
runtime/money/money.js       amounts with a currency          → import this
runtime/money/quantity.js    quantities with a unit           → import this
runtime/money/decimal.js     the shared exact-decimal core    → parse/format/round internals
```

Zero dependencies, no `node:*`, no build step, no `Date.now()`, no `Math.random()`. Loads in a
browser and in Node 22+ unchanged. `runtime/money/decimal.js` is imported only by the other two;
`parseScaledToken`, `divRound`, `parseFactor` and `allocateUnits` are exported from it so a
second scaled type (a rate table, a share count) never needs a second rounding implementation.

---

## 1. The wire form

```json
{ "net-amount": "4999.99 EUR", "vat-amount": "950.00 EUR", "net-weight": "120.500 kg" }
```

Optional `-`, digits with **no leading zero**, optional `.` followed by **exactly** the
minor-unit digits ISO 4217 assigns that currency, a single U+0020, the alphabetic code.

| valid | invalid, and the error code |
| --- | --- |
| `"4999.99 EUR"` | `"4999.9 EUR"` → `wrong-scale` |
| `"-12.00 EUR"` | `"+5.00 EUR"` → `leading-plus` |
| `"1000 JPY"` | `"1000.0 JPY"` → `wrong-scale` |
| `"1.500 TND"` | `"1.5 TND"` → `wrong-scale` |
| `"0.00 EUR"` | `"-0.00 EUR"` → `negative-zero` |
| `"5.00 EUR"` | `"5.00 eur"` → `currency-case`, `"5.00EUR"` → `missing-space`, `"5,00 EUR"` → `decimal-comma`, `"1e3 EUR"` → `exponent`, `"05.00 EUR"` → `leading-zero`, `" 5.00 EUR"` → `leading-space`, `"5.00 XXX"` → `unknown-currency` |

`toString(money(x)) === x` for every accepted `x`, including amounts far past
`Number.MAX_SAFE_INTEGER` in minor units. That is the whole point of the string: the document
opens byte-identically in thirty years (Principle 6).

---

## 2. API — `money.js`

```js
import {
  money, fromMinor, toMoney, toString, toMinor, currencyOf, zero,
  add, subtract, negate, abs, multiply, percentage, round, splitGross, convert,
  compare, equals, isZero, sign, isNegative, isPositive, min, max,
  sum, allocate,
  CURRENCIES, ROUNDING_MODES, MoneyError, isMoney, scaleOf, currencyCodes,
} from '../money/money.js';
```

| function | contract |
| --- | --- |
| `money(text)` | parse + validate a canonical token. Throws `MoneyError` on anything off-spec. The **only** way a string becomes money. |
| `fromMinor(minor, currency)` | `fromMinor(499999n, 'EUR')` → `4999.99 EUR`. `minor` must be a `bigint`. |
| `toMoney(value)` | accepts a `Money`, the `{ minor, currency }` shape `structuredClone` leaves behind, or a token. Every operation below runs it on its arguments, so you may pass strings anywhere. |
| `toString(m)` / `String(m)` / `m.toJSON()` | the canonical token. `JSON.stringify(doc)` writes it with no help from you. |
| `toMinor(m)` → `bigint` | exact minor units. The only escape hatch, and it is a `BigInt`. |
| `add` / `subtract` | same currency required, else `MoneyError('currency-mismatch')`. |
| `negate` / `abs` | — |
| `multiply(m, factor, rounding?)` | `factor` is `3n`, `"1.19"`, `{numerator, denominator}` or `[num, den]`. **A `Number` is refused** (`number-factor`). Rounding is required only when the product is not a whole minor unit, then it is mandatory (`rounding-required`). |
| `percentage(m, rate, rounding)` | `rate` is `"19"`, `"19.5"`, `"0"` or `19n`, max 6 decimal digits. **Rounding always required.** |
| `splitGross(m, rate, rounding)` | `{ net, vat, gross }` from a gross amount, with `net + vat === gross` exactly, by construction. |
| `round(m, scale, rounding)` | to a coarser scale only; result keeps the currency's scale (`round("4999.99 EUR", 0, 'half-up')` → `5000.00 EUR`). |
| `compare(a, b)` → `-1|0|1` | same currency required. `equals` is total (different currencies → `false`, no throw). |
| `isZero` / `sign` / `isNegative` / `isPositive` / `min` / `max` | — |
| `sum(list, currency?)` | never `NaN`. **An empty list needs the currency** (`sum([], 'EUR')` → `0.00 EUR`); `sum([])` throws `currency-required`. |
| `allocate(m, weights, rounding)` | largest remainder; the parts **always** sum to the whole, exactly, and the invariant is asserted before returning. `weights` is `3n` (that many equal parts) or an array of `bigint` / non-negative decimal strings. |
| `convert(m, to, rate, rounding)` | the one correct conversion primitive — see §5. |
| `CURRENCIES` | frozen `code → minor digits`, ISO 4217. 87 codes (62 with 2 minor digits, 16 with none, 7 with three, 2 with four). Unknown code → `unknown-currency`, **never** a guessed 2. |
| `ROUNDING_MODES` | `half-up`, `half-down`, `half-even`, `down`, `up`, `floor`, `ceiling`. **No default exists.** |
| `MoneyError` | `.code` is stable and machine-readable — branch on `code`, never on the message. |

A `Money` is frozen, and refuses numeric coercion: `a + b` on two amounts throws
`MoneyError('numeric-coercion')` instead of producing `"[object Object][object Object]"` or a
double. `${m}` and `String(m)` still give the canonical token.

### `quantity.js`

The same surface for scaled quantities — `quantity`, `fromScaled`, `toQuantity`, `toScaled`,
`unitOf`, `zero`, `add`, `subtract`, `negate`, `abs`, `multiply`, `round`, `convert`, `compare`,
`equals`, `isZero`, `sign`, `min`, `max`, `sum`, `allocate`, `UNITS`, `defineUnits`,
`QuantityError`, `isQuantity`, `scaleOf`, `toRatio`.

Two deliberate differences: a `Quantity` **carries its own scale** (units are not ISO 4217, so a
model may declare its own with `defineUnits`, and two quantities in the same unit at different
scales refuse to combine — `scale-mismatch`), and there is no unit-conversion table
(`pallet → pcs` is an article fact, `l → kg` is a density; both belong in the operating model).

**Pricing a weight** — the bridge between the two modules, and the only sanctioned one:

```js
import { multiply, money } from '../money/money.js';
import { quantity, toRatio } from '../money/quantity.js';

const line = multiply(money('12.50 EUR'), toRatio(quantity('120.500 kg')));  // 1506.25 EUR, exact
```

---

## 3. Migration note for the other agents

**How a `money` field is declared.** Grammar §2.1 keeps the type name `money`. What changes is
the value space: a `money` field holds a **canonical token string**, not a number. Same for a
`quantity`-typed field (`"120.500 kg"`). Nothing about the field syntax has to change; the
validator behind it does.

```
## Information
- net-amount: money required        → "4999.99 EUR" in the JSON, never 4999.99
- net-weight: quantity              → "120.500 kg"
```

**Parsing** (parser, dialects, kernel, read path):

```js
import { money, MoneyError } from '../money/money.js';
try { doc['net-amount'] = String(money(raw)); }
catch (e) { if (e instanceof MoneyError) diagnostics.push({ severity: 'error', message: e.message, code: e.code }); }
```

Store the **token**, not the `Money` object, in a document. `JSON.stringify` of a `Money` already
produces the token (`toJSON`), so either works — but a token in the index and in the blob keeps
git diffs readable and keeps `structuredClone` (live layer) trivially correct.

**Comparing** — for `>`, `>=`, `<`, `<=`, `=`, `!=` on a `money` field:

```js
import { compare, equals } from '../money/money.js';
compare(a, b) > 0            // a > b; throws currency-mismatch on mixed currencies
equals(a, b)                 // total: different currencies are simply not equal
```

Do **not** compare tokens as strings (`"9.00 EUR" > "10.00 EUR"` is `true` lexically) and do not
compare minor units across currencies.

**Summing** — for FD-5's `sum of <field> over <entity> where <condition>`:

```js
import { sum } from '../money/money.js';
sum(rows.map((r) => r['net-amount']), 'EUR')     // state the currency: a filter matching nothing
                                                 // must yield "0.00 EUR", not 0 and not undefined
```

`sum` refuses a mixed-currency list. An aggregation over an entity whose rows may be in several
currencies must group by currency first — that is a modelling decision, not something the runtime
may paper over.

**Rendering** (UI): format from the token, never from a `Number`. `runtime/ui/fields.js` currently
renders `money` with `formatNumber(value, { decimals: 2 })` over a JS number (`Math.abs(n).toFixed(...)`)
— under FD-1 that path must be replaced by: split the token on its single space, group the
integer digits for the locale, keep the fraction digits **verbatim** (they are already exactly
the currency's scale), and render the code. No parse, no reformat, no rounding in the view. A
German UI showing `1.234,56 €` is a pure string transformation of `"1234.56 EUR"`.

**Rounding is a model decision, never a library default.** Every call site that can be inexact
must pass a mode. The European commercial default is `'half-up'`; pass it explicitly, from the
model, so the invoice states its own rule.

**Adopting `runtime/read/money.js`.** That file documents itself as a temporary FD-1 surface whose
exit path is "one file, not a refactor". Two behavioural differences to reconcile when it becomes
a re-export:
1. it derives a scale from the literal for a currency code it does not know, where FD-1 and this
   module **refuse** the token (`unknown-currency`). Refusal is what FD-1 mandates; a code we do
   not know is a code whose scale we cannot check.
2. its `Money` shape is `{ code, scale, minor }`; this module's is `{ minor, currency }` with the
   scale derived from `CURRENCIES`. `toMinor` / `currencyOf` / `scaleOf` cover the read path's
   needs, and `fromMinor` rebuilds a value for a range-index key.

---

## 4. Decisions FD-1 did not settle, made here

| question | decision | why |
| --- | --- | --- |
| negative zero | **refused** (`-0.00 EUR` → `negative-zero`); no operation can produce one | accepting it and emitting `0.00 EUR` would break the byte-exact round trip that is FD-1's entire reason for using a string. An inbound dialect maps `-0.00` → `0.00` explicitly, at the boundary, where the decision is visible |
| leading zeros | refused (`05.00 EUR`) | one value, exactly one spelling — otherwise two documents differ byte-wise while meaning the same thing |
| unknown currency | error, always | a guessed scale of 2 turns `1.5 TND` into 1.50 dinars instead of 1.500 |
| historical codes | only `HRK` so far, added deliberately | 2022 Croatian invoices are inside the retention period. Any further retired code is added with the scale read off the ISO 4217 amendment that retired it |
| scale of a percentage rate | up to **6** decimal digits (`"19"`, `"19.5"`, `"0.058"`) | covers every EU statutory VAT rate plus insurance-premium and withholding rates; beyond that pass an exact ratio so the intent stays legible |
| does `multiply` take a ratio | yes — `bigint`, exact decimal string, `{numerator, denominator}`, `[num, den]`; a `Number` is refused | "one third of this invoice" must be expressible without inventing `0.3333…`. Rounding is then required, once, at the end |
| rounding on `multiply` | required **iff** the product is inexact | multiplying by a count of pieces involves no policy and must not force the caller to invent one |
| rounding on `percentage`, `convert`, `allocate`, `round` | always required | these are exactly the places where cents are made and lost |
| `sign`, `compare`, `scaleOf` return `Number` | yes: `-1|0|1` and a digit count are not monetary values | a scale is a count of digits; the guard below permits integers outside arithmetic on amounts |

---

## 5. Conversion is a modelled act — and the caller records the rate

`convert(m, toCurrency, rateText, rounding)` exists so that there is exactly **one** correct
conversion primitive in the codebase. It does the arithmetic (including the differing minor-unit
scales of the two currencies) and nothing else: it does not know today's rate, does not fetch
one, and does not remember the one you passed.

The rate is *units of the target per one unit of the source, in major units* — the way every
published rate table writes it. `convert(money('1000.00 EUR'), 'JPY', '162.5', 'half-up')` →
`162500 JPY`.

**The caller must record, on the document, in the same commit:** the original amount and currency
(the untouched token), the rate as the exact decimal string passed here, the rate's date and
source (ECB reference rate of 2027-03-14, contract rate, …), and the rounding mode. A converted
amount without those four facts is an unexplained number in a ledger, and FD-1 is explicit that
an auditor must be able to see all of them.

---

## 6. The float guard

`test/m-money.test.js` strips comments, string and regex literals from every `.js` file in this
directory (keeping the code inside `${…}`) and fails on any of:

`parseFloat` · `parseInt` · the identifier `Number` in any form · `.toFixed` · `.toPrecision` ·
`.toLocaleString` · `Math.*` · `valueOf` · `NaN` / `isNaN` · `Infinity` / `isFinite` ·
any decimal literal (`1.19`, `.5`) · any exponent literal (`1e3`) · a non-`BigInt` integer literal
on either side of `*`, `**`, `/`, `%` (so `/ 100` is a violation and `/ 100n` is not) ·
unary-plus coercion (`+value`).

The scanner is itself tested against 14 known-bad fixtures — including the original defect,
`doc["net-amount"] * 1.19` — and against 11 legitimate BigInt snippets that must not be flagged.
Injecting `const x = 0.1 + 0.2;` into `money.js` fails the guard with file, line, rule and reason.

The guard is scoped to `runtime/money/**`, which is the code this agent owns. **Gate condition 2
of the roadmap asks for the same grep over the whole runtime**, and that check should be added to
CI once the adopting modules have landed; today it would fail on pre-FD-1 code outside this
directory (`runtime/ui/fields.js` formats a money field with `toFixed` over a JS number).
