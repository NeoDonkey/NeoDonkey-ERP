# Decision Record: Multi-Currency Accounting, Foreign Currency Valuation, and Realized Exchange Gains/Losses

**Date:** 2026-08-17

## Question
How should foreign currency transactions, spot rate conversion, and realized exchange rate gains/losses be recorded and posted in NeoDonkey's general ledger?

## Answer

1. **Functional Currency as System of Record:**
   - Every legal entity repository operates in a single base functional currency (e.g. `EUR`).
   - Every posting, invoice, and payment denominated in a foreign currency (e.g. `USD`) MUST record both the foreign currency amount (e.g. `"100.00 USD"`) and the converted functional currency amount (e.g. `"92.50 EUR"`) determined at the spot transaction date exchange rate.

2. **No Float Conversions:**
   - Currency conversion MUST NOT use floating-point arithmetic.
   - Exchange rates are expressed as exact rational ratios or exact high-precision decimal strings (e.g., `"1.0811 USD/EUR"` expressed as `10811 / 10000`).
   - Intermediate calculations use integer `BigInt` minor units with commercial half-up rounding.

3. **Realized Foreign Exchange Gain/Loss on Settlement:**
   - When an invoice denominated in foreign currency (e.g., $100 billed when $1 = €0.90, giving €90.00 receivable) is settled by a bank payment when $1 = €0.92 (giving €92.00 received), the resulting difference (€2.00) is recognized immediately upon settlement as a **Realized Exchange Gain** (or Loss).
   - In double-entry posting terms (SKR03 accounts):
     - Debit: Bank (`1200`) = `92.00 EUR`
     - Credit: Trade Receivables (`1400`) = `90.00 EUR`
     - Credit: Realized Exchange Rate Gains (`2660` / `2661`) = `2.00 EUR`
   - Total debits (`92.00 EUR`) equal total credits (`90.00 EUR + 2.00 EUR = 92.00 EUR`), maintaining double-entry balance in the base currency as a structural invariant.

## Source
- **Primary Source (IFRS):** IAS 21 *The Effects of Changes in Foreign Exchange Rates*, paragraphs 21–23 (initial recognition at spot rate) and paragraphs 28–30 (recognition of exchange differences on settlement).
- **Primary Source (German Commercial Code / HGB):** HGB § 256a (Währungsumrechnung) and GoBD principles regarding valuation and record-keeping of foreign currency amounts.

## Verification Method
- **Double-Entry Balance Verification:** A test posts an invoice in USD and settles it in USD with a different spot rate, asserting that the general ledger posting enforces `debits equal credits` in functional currency `EUR` with explicit exchange difference entries.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(currency): FX rate table and spot conversion with BigInt rational math`
- **Title:** Implement FX exchange rate table and spot currency conversion with exact BigInt rational arithmetic
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 1 (FD-1: "Mixed currencies do not add... Conversion is an explicit modelled act") and Part 3 (Wave 2: Multi-currency)
- **Primary Source Citation:** IAS 21 paragraphs 21–23 & HGB § 256a
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/fx-conversion.test.js` registers exact decimal exchange rates (e.g. `"1.0811 USD/EUR"` as `10811/10000`), converts foreign amounts into functional currency using commercial half-up rounding on `BigInt` minor units, and asserts zero `parseFloat` or `Number` calls in the conversion path.

### Issue 2: `feat(ledger): post realized foreign exchange gains/losses on payment settlement`
- **Title:** Post realized foreign exchange rate gains/losses on payment settlement to general ledger
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 1: "Debits equal credits, structurally") and Part 3 (Wave 2: Multi-currency)
- **Primary Source Citation:** IAS 21 paragraphs 28–30 & HGB § 256a
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/fx-settlement.test.js` settles a $100 USD receivable invoice (billed at spot rate €0.90 = €90.00) with a bank receipt at spot rate €0.92 = €92.00, asserting that the generated general ledger entry posts Debit Bank €92.00, Credit Receivables €90.00, Credit Realized FX Gain €2.00 (SKR03 `2660`), satisfying `debits equal credits` exactly.
