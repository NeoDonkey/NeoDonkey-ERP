# Decision Record: Accounts Receivable / Accounts Payable (AR/AP) Subledger and Open Item Management (OPOS)

**Date:** 2026-08-19

## Question
How should NeoDonkey model Accounts Receivable (AR / Personenkonten Debitoren) and Accounts Payable (AP / Personenkonten Kreditoren) subledgers, Open Item management (Offene-Posten-Buchführung / OPOS), payment clearing (Ausgleich), and cash discount (Skonto) adjustments in compliance with GoBD and German commercial accounting principles (HGB / SKR03 / SKR04)?

## Answer

1. **Subledger Account Numbering (Personenkonten Debitoren / Kreditoren):**
   - General ledger control accounts (Sammelkonten / Control Accounts, e.g. SKR03 `1400` Ford. a. L.L. or `1600` Verb. a. L.L., SKR04 `1200` / `3300`) MUST be linked to subledger personal accounts.
   - Subledger accounts use 5-digit numerical identifiers:
     - **Customers (Debitoren):** `10000` – `69999`
     - **Vendors (Kreditoren):** `70000` – `99999`
   - Every transaction posted to a subledger account automatically posts to the corresponding general ledger control account in real-time to preserve subledger-to-general-ledger balance identity.

2. **Open Item Management (Offene-Posten-Buchführung - OPOS):**
   - Each posted AR or AP invoice creates an **Open Item** record identified by an Open Item ID (`OP-ID`), tied to the document reference, subledger account number, original due date, and net/gross monetary amounts (represented as string tokens with BigInt minor units per FD-1, e.g. `"1190.00 EUR"`).
   - An Open Item tracks remaining unsettled gross balance (`open-amount`). An Open Item remains active until its remaining balance reaches exactly `0.00 EUR`.

3. **Payment Matching and Clearing (Ausgleich & Teilzahlung):**
   - Bank statement or cash receipts/payments match against one or more Open Item IDs.
   - **Full Payment:** Decreases `open-amount` to `0.00 EUR`, marks OP-ID as `cleared` with the payment transaction reference and date.
   - **Partial Payment (Teilzahlung):** Decreases `open-amount` by the exact payment amount; OP-ID remains active (`partially-cleared`).

4. **Cash Discount (Skonto) and Tax Adjustment:**
   - When a payment is settled within the early-payment discount period (Skontofrist), the cash discount amount (e.g. 2% or 3%) reduces the required payment.
   - Cash discount postings MUST trigger an automatic proportional adjustment of output VAT (Umsatzsteuer / SKR03 `1776` / `1771`) or input VAT (Vorsteuer / SKR03 `1576` / `1571`) per UStG § 17 Abs. 1.
   - Example (1,190.00 EUR invoice with 19% VAT, 2% Skonto = 23.80 EUR gross discount):
     - Net discount: 20.00 EUR posted to Skonto income/expense (e.g. SKR03 `8736` / `3736`).
     - Tax adjustment: 3.80 EUR posted to VAT account.
     - Cash received: 1,166.20 EUR.
     - Open Item cleared completely (`0.00 EUR`).

## Source
- **Primary Source (German Tax Authority / GoBD):** Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff (GoBD), BMF circular 2019-11-28, margin numbers 67–71 (Personenkontenführung und Offene-Posten-Buchführung).
- **Primary Source (German Commercial Code / HGB):** Handelsgesetzbuch (HGB) § 246 Abs. 1 (Vollständigkeitsgebot) and § 238 Abs. 1 (Buchführungspflicht).
- **Primary Source (German Tax Law / UStG):** Umsatzsteuergesetz (UStG) § 17 Abs. 1 (Änderung der Bemessungsgrundlage bei Skonto und Boni).

## Verification Method
- **Unit Test Verification:** `test/opos-subledger.test.js` creates customer/vendor subledger accounts, posts invoices to create Open Items, matches full and partial payments, and asserts that cash discounts correctly adjust gross balances, subledger control accounts, and VAT accounts using exact `BigInt` minor units without float calculations.

## Unblocked Implementable Issues

### Issue 1: `feat(subledger): implement AR/AP subledger accounts and open item lifecycle (OPOS)`
- **Title:** Implement AR/AP subledger accounts and open item lifecycle tracking (OPOS)
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 1: "Debits equal credits, structurally") and Part 3 (Wave 2: AR/AP)
- **Primary Source Citation:** GoBD BMF Circular 2019-11-28 margin numbers 67–71 & HGB § 246 Abs. 1
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/opos-lifecycle.test.js` creates a customer subledger account (`10001`), posts a receivable invoice (`"1190.00 EUR"`), and asserts:
  1. An Open Item `OP-10001-1` is created with `open-amount: "1190.00 EUR"` and status `open`.
  2. Subledger balance for `10001` equals control account balance for SKR03 `1400`.
  3. A partial payment of `"500.00 EUR"` updates `open-amount` to `"690.00 EUR"` with status `partially-cleared`.
  4. Final payment of `"690.00 EUR"` marks `OP-10001-1` as `cleared` with `open-amount: "0.00 EUR"`.

### Issue 2: `feat(subledger): automatic cash discount (Skonto) clearing and proportional VAT adjustment`
- **Title:** Implement automatic cash discount (Skonto) clearing and proportional VAT adjustment
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 1: "Debits equal credits") and Part 3 (Wave 2: AR/AP, VAT)
- **Primary Source Citation:** UStG § 17 Abs. 1 & GoBD BMF Circular 2019-11-28 margin number 70
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/opos-skonto.test.js` processes a payment with a 2% Skonto cash discount on a `"1190.00 EUR"` invoice (including 19% VAT) and asserts:
  1. Cash received `"1166.20 EUR"` + Net Skonto `"20.00 EUR"` + VAT adjustment `"3.80 EUR"` equals original gross amount `"1190.00 EUR"`.
  2. General ledger postings balance debits and credits exactly (`BigInt` minor units sum to zero diff).
  3. Tax adjustment is credited/debited to the designated VAT account (SKR03 `1776`).
  4. Open item status transitions to `cleared`.
