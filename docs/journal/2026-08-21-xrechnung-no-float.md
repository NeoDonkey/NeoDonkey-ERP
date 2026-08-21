# 2026-08-21 — XRechnung generator: no float on any money path

`runtime/export/xrechnung.js` was the last export path still doing monetary arithmetic in
floats: a `reduce` over line amounts in doubles, and `toFixed(2)` at render time. FD-1 and
the decision record `docs/decisions/2026-08-18-en16931-xrechnung-e-invoicing-semantic-data-model.md`
(§4, "Zero Float and Precision") make BigInt minor units binding for everything this module
emits, so the float paths were not a style issue but a defect: a sum that drifts and is then
rounded for display produces an invoice whose totals do not add up to its lines.

The rewrite converts each inbound amount exactly once, at the boundary, into the
`runtime/money` representation: `Money` values and canonical tokens (`"4999.99 EUR"`) pass
through `toMoney`; bare decimals — including the legacy `Number` callers the existing tests
use — are converted by exact string scaling (`String(94.81)` → 9481n cents). A number that
does not survive that conversion, like `0.1 + 0.2`, is refused with a descriptive error
rather than rounded, because rounding it here would hide the defect that produced it.
Totals, the VAT breakdown and the gross total are `sum`/`add` over minor units; rendering is
`formatScaled`. There is no `parseFloat`, no `Number()` and no `toFixed` left in the file,
and a source-guard test (built on the shared `test/_source-guard.js` scanner) keeps it so.

Two pieces of validation were strengthened at the same time, per the decision record:

- **BT-10 (BuyerReference / Leitweg-ID) is now mandatory.** The generator previously emitted
  the placeholder `0000` when the invoice had no `customer-reference`; a B2G invoice with a
  placeholder reference is rejected by the receiving authority, so producing one silently was
  worse than failing. The error names the business term and the field to set.
- **BT-152 (line VAT rate)** is required per line, and **BT-146 (unit price)** is derived as
  net ÷ quantity only when that division is exact at the currency's minor unit — `100.00`
  over 3 pieces now throws and asks for an explicit price instead of emitting `33.33`.

The generator now also emits the EN 16931 VAT breakdown (BG-23 `cac:TaxSubtotal`, one per
category/rate pair, exact per-group sums), which EN 16931 requires and the old file omitted.

This supersedes stalled PRs **#94** and **#104**, whose engineering this change ports onto
current main: the BigInt money conversion and the BT-10 enforcement come from #94, the
round-trip-through-`parseXRechnungUblXml` and multi-rate subtotal tests from #104. Both had
stalled because they introduced a parallel module/API instead of fixing `buildXRechnung` in
place; this change keeps the public API stable and makes the round-trip test prove that what
we generate is exactly what our own parser validates — including its arithmetic-integrity
checks (BT-106 = Σ BT-131, BT-112 = BT-109 + BT-110).

Verification: `node --test "test/*.test.js"` — 689 baseline passes plus the new xrechnung
tests, no new failures (the two `h-release.test.js` failures are pre-existing on main: an
unclassified `tmp-debug.mjs` at the repo root breaks `release/sign-release.mjs` classification;
unrelated to this change).
