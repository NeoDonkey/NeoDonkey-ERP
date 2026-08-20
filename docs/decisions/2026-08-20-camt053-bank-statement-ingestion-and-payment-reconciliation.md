# Decision Record: Bank Statement Ingestion (CAMT.053 ISO 20022 XML / MT940 SWIFT) and Automated Payment Reconciliation (OPOS)

**Date:** 2026-08-20
**Author:** Daniel Pammé
**Status:** Approved / Binding
**Roadmap Reference:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6 "It speaks to the outside world"), Wave 2 & Wave 3 (`AR/AP subledgers`, `inbound dialects`, `payment clearing`)

---

## Question

How should NeoDonkey ingest, parse, and convert electronic bank statement files (ISO 20022 `camt.053` XML and SWIFT MT940) into canonical bank transaction domain objects, and how are incoming bank payments automatically reconciled against open Accounts Receivable / Accounts Payable (AR/AP OPOS) items in the general ledger while adhering to strict zero-float monetary rules and GoBD auditability constraints?

---

## Answer

### 1. File Format Standards & Parsing Hierarchy
1. **Primary Standard — ISO 20022 `camt.053` XML:**
   - NeoDonkey treats `camt.053.001.02` and `camt.053.001.08` (Bank-to-Customer Statement) XML as the primary format for electronic bank statements (standard across SEPA, Deutsche Kreditwirtschaft DK, and European banking APIs).
   - Document structure and XML element mapping:
     - Statement Container: `Document/BkToCstmrStmt/Stmt`
     - Account Identification: `Stmt/Acct/Id/IBAN`
     - Statement Sequence / Id: `Stmt/Id`, `Stmt/LglSeqNb`
     - Statement Date / Period: `Stmt/CreDtTm` or `Stmt/FrToDt`
     - Entry (Transaction): `Stmt/Ntry`
     - Amount & Direction: `Ntry/Amt` (monetary string) with `Ntry/CdtDbtInd` (`CRDT` = credit/receipt, `DBIT` = debit/disbursement)
     - Booking / Value Date: `Ntry/BookgDt/Dt` or `Ntry/ValDt/Dt`
     - Reference IDs: `Ntry/AcctSvcrRef` (Account Servicer Reference), `Ntry/NtryDtls/TxDtls/Refs/EndToEndId`, `Ntry/NtryDtls/TxDtls/Refs/UETR`
     - Party Names: `Ntry/NtryDtls/TxDtls/RltdPties/Dbtr/Nm` (Payer) or `Cdtr/Nm` (Payee)
     - Remittance Information: `Ntry/NtryDtls/TxDtls/RmtInf/Ustrd` (unstructured) or `RmtInf/Strd/CdtrRefInf/Ref` (structured creditor reference).
2. **Legacy Standard — SWIFT MT940:**
   - SWIFT MT940 text statements are supported as a secondary fallback.
   - Field `:60F:` / `:60M:` (Opening Balance), `:61:` (Statement Line: Date, Debit/Credit Mark `D`/`C`, Amount, Transaction Type, Account Owner Reference), `:86:` (Information to Account Owner / Remittance Text).

### 2. Zero-Float Monetary Precision
1. **String Parsing to BigInt Minor Units:**
   - Bank statement amounts extracted from XML (`<Amt Ccy="EUR">1250.50</Amt>`) or MT940 (`:61:260820C1250,50NTRF...`) MUST NEVER be converted to IEEE 754 floating-point numbers (`parseFloat` / `Number` are strictly forbidden).
   - Amounts are parsed directly as strings into minor unit `BigInt` values (`1250.50 EUR` → `125050n EUR`) using `toMoney(rawString, currency)`.
   - Debit entries (`DBIT` / `D`) carry negative sign or are classified as outgoing cash disbursements; Credit entries (`CRDT` / `C`) are classified as incoming customer receipts.

### 3. Automated Open Item (OPOS) Reconciliation Rules
Incoming bank payments (`CRDT`) are matched against open Accounts Receivable items (`customer-invoice` documents in `unpaid` state) using a multi-tiered matching engine:
1. **Tier 1 — Exact Reference Match (100% Confidence):**
   - Matching `RmtInf/Strd/CdtrRefInf/Ref`, `EndToEndId`, or exact invoice number string found in `RmtInf/Ustrd` matching an open invoice's `document-number` (e.g. `INV-2026-0042`), AND bank transaction amount equals invoice gross amount (`gross-amount`).
   - Outcome: Automatically matched and queued for single-click or automatic posting.
2. **Tier 2 — Exact Amount & Counterparty Name Match:**
   - Unstructured remittance text contains customer name (`Dbtr/Nm`) AND exact open invoice gross amount.
   - Outcome: Matched with high confidence.
3. **Tier 3 — Partial Payment / Skonto Cash Discount Handling:**
   - Payment amount is less than gross invoice amount, but matches net/gross amount minus allowable Skonto discount (e.g., 2% discount within 14 days per invoice terms).
   - Outcome: Matched as paid with Skonto. Ledger entry automatically splits payment into cash receipt and Skonto cash discount expense (`8736` SKR03 / `4736` SKR04) with proportional output VAT adjustment.
4. **Unmatched / Ambiguous Refusal:**
   - If multiple open invoices match or amount does not match any open item within Skonto tolerance, the entry is marked `unreconciled`. It MUST NOT be guess-posted automatically.

### 4. Idempotency & Duplicate Prevention
1. Each bank entry is assigned a canonical fingerprint: `sha256(IBAN + booking_date + transaction_reference + amount_minor_units)`.
2. The transaction fingerprint is stored in the general ledger transaction metadata. Re-importing the same CAMT.053 XML or MT940 file skips already-ingested transaction fingerprints without throwing errors or duplicating ledger postings.

---

## Source

1. **ISO 20022 Financial Services — Bank-to-Customer Statement (`camt.053.001.02` & `camt.053.001.08`):** ISO 20022 Message Definition Report, Payment Standards, EPC (European Payments Council) SEPA XML scheme specifications.
2. **Deutsche Kreditwirtschaft (DK):** *Spezifikation Datenformate XML — EBICS / Kontoauszug camt.053*, Version 3.x.
3. **SWIFT Standards MT Maintenance:** *Category 9 — Cash Management and Customer Status Standards (MT 940 Customer Statement Message Format)*.
4. **German Commercial Code (HGB):**
   - HGB § 238 Abs. 1 (Buchführungspflicht und Grundsätze ordnungsmäßiger Buchführung): Requirement for complete and traceable recording of cash and bank movements.
   - HGB § 257 Abs. 1 Nr. 4 (Aufbewahrung von Unterlagen): Mandatory retention of bank statements and payment records.
5. **GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form):**
   - GoBD § 3.2.1 (Unveränderbarkeit): Bank statement records and matching logs must be stored immutably as signed Git commits.

---

## What Must Land First

This decision record defines 2 implementable issue specifications below. Filing these specifications as open GitHub issues MUST land first before implementation work can be claimed via `Closes #N` in an engineering session.

---

## Unblocked Implementable Issue Specifications

### Issue Specification 1
- **Title:** `feat(bank): parse CAMT.053 ISO 20022 XML bank statements into domain statement objects`
- **Source:** Decision record `docs/decisions/2026-08-20-camt053-bank-statement-ingestion-and-payment-reconciliation.md` §1 & §2, `docs/ROADMAP-V1.md` Wave 2 / Wave 3
- **Verification:** `node --test test/camt053-parser.test.js` passes. A test parses a valid SEPA ISO 20022 `camt.053.001.02` XML string containing credit and debit entries, asserting that account IBAN, booking dates, transaction IDs, debtor/creditor names, remittance information strings, and BigInt minor-unit amounts (`125050n` for `1250.50 EUR`) match expected domain objects byte-for-byte without floating-point conversions. A test with invalid XML or missing mandatory fields (`IBAN`, `Amt`, `CdtDbtInd`) throws descriptive errors.
- **Labels:** `area:runtime`, `p1`, `ready`
- **Non-Negotiable Constraints:** Zero dependencies, no build step, pure ES module running in Node 22+ and browser, no `node:*` imports outside `runtime/git/fs-node.js`, no `parseFloat`/`Number` on monetary paths, no `Date.now()` or `Math.random()`, no business vocabulary in `runtime/` core.

### Issue Specification 2
- **Title:** `feat(bank): match bank statement transactions to AR/AP open items (OPOS) and generate ledger payment clearing entries`
- **Source:** Decision record `docs/decisions/2026-08-20-camt053-bank-statement-ingestion-and-payment-reconciliation.md` §3 & §4, `docs/ROADMAP-V1.md` Wave 2 / Wave 3
- **Verification:** `node --test test/bank-reconciliation.test.js` passes. A test feeds parsed bank statement credit entries into the reconciliation engine against a set of open sales invoices (`unpaid`). The test asserts:
  1. An exact remittance reference match generates a balanced general ledger posting (Debit Bank `1200`, Credit Receivable `1400`) and updates open item status to `cleared`.
  2. A payment with a valid 2% Skonto discount generates a compound clearing entry splitting bank receipt, Skonto expense (`8736`), and output VAT adjustment, balancing debits and credits exactly.
  3. Re-ingesting a statement entry with an identical transaction fingerprint is rejected as a duplicate (`idempotent-duplicate-refused`).
- **Labels:** `area:runtime`, `p1`, `ready`
- **Non-Negotiable Constraints:** Zero dependencies, no build step, browser-compatible ES module, no `parseFloat`/`Number` on monetary paths, debits equal credits invariant preserved in generated ledger entries.
