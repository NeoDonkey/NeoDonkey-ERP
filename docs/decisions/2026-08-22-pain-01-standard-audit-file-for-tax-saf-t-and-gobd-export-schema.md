# Decision Record: OECD Standard Audit File for Tax (SAF-T v2.0) and GoBD Audit Export Schema

**Date:** 2026-08-22
**Author:** Daniel Pammé
**Status:** Approved / Binding
**Roadmap Reference:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6 "It speaks to the outside world", Gate Condition 8 "A German auditor's questions have written answers"), Wave 2 & Wave 3 (`DATEV`, `GoBD export`, `general ledger`, `tax audit export`)

---

## Question

How should NeoDonkey export accounting, master data, general ledger postings, and source documents into standard electronic tax audit formats — specifically the OECD Standard Audit File for Tax (SAF-T v2.0 XML) and GoBD data export standards — while guaranteeing strict zero-float monetary arithmetic, audit immutability, and browser compatibility?

---

## Answer

### 1. XML Schema & Structure Overview
1. **Primary Standard — OECD SAF-T v2.0 XML:**
   - NeoDonkey adopts the OECD Standard Audit File for Tax version 2.0 (Guidance on the Standard Audit File for Tax - Version 2.0, OECD Committee on Fiscal Affairs) as its primary electronic audit export schema.
   - Core XML hierarchy and root element structure:
     - Root Element: `<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:2.00">`
     - Header (`<Header>`): AuditFileVersion (`2.00`), CompanyID, TaxRegistrationNumber, CorporateName, FiscalYear, StartDate, EndDate, CurrencyCode (`EUR`), DateCreated, SoftwareHeader (ApplicationHeader, Version).
     - Master Files (`<MasterFiles>`):
       - General Ledger Accounts (`<GeneralLedgerAccounts>/<Account>`): AccountID, AccountDescription, StandardAccountID, AccountType, OpeningDebitBalance, OpeningCreditBalance.
       - Customers (`<Customer>`): CustomerID, CompanyName, BillingAddress, TaxRegistrationNumber.
       - Suppliers (`<Supplier>`): SupplierID, CompanyName, BillingAddress, TaxRegistrationNumber.
       - Tax Table (`<TaxTable>/<TaxTableEntry>`): TaxType, TaxCode, Description, Percentage, Country.
     - General Ledger Entries (`<GeneralLedgerEntries>`):
       - TotalDebit, TotalCredit, NumberOfEntries.
       - Journal (`<Journal>`): JournalID, Description, Transaction (`<Transaction>`): TransactionID, Period, PeriodYear, TransactionDate, SourceID, Description, Line (`<Line>`): RecordID, AccountID, SystemEntryDate, Description, DebitAmount / CreditAmount.
     - Source Documents (`<SourceDocuments>`):
       - Sales Invoices (`<SalesInvoices>`): Invoice (`<Invoice>`): InvoiceNo, Period, InvoiceDate, InvoiceType, CustomerID, Line (`<Line>`), DocumentTotals (`<DocumentTotals>`): TaxPayable, NetTotal, GrossTotal.
       - Payments (`<Payments>`): Payment (`<Payment>`): PaymentRefNo, Period, TransactionDate, CustomerID / SupplierID, PaymentMethod, Line (`<Line>`), DocumentTotals (`<DocumentTotals>`).

### 2. Zero-Float Monetary Precision & Rounding Rules
1. **String Token Serialization:**
   - Monetary values exported in XML tags (e.g. `<DebitAmount>1250.50</DebitAmount>`, `<TaxPayable>237.60</TaxPayable>`) MUST be formatted directly from `BigInt` minor units using `toMoney()` and string formatting (`125050n` EUR → `"1250.50"`).
   - `parseFloat`, `Number`, and `toFixed` floating-point conversions are strictly forbidden across all monetary export paths.
2. **Balance Validation Invariant:**
   - `<TotalDebit>` and `<TotalCredit>` elements in `<GeneralLedgerEntries>` are derived by summing BigInt minor units across all journal line entries and converting to decimal strings, preserving the structural debits = credits invariant exactly.

### 3. GoBD Compliance & Audit File Integrity
1. **Immutability & Git Provenance:**
   - Each generated SAF-T XML document is accompanied by a signed Git commit hash trailer (`X-NeoDonkey-Commit-OID`), linking the exported audit data to its immutable source in the workspace commit graph per GoBD § 3.2.1.
2. **Cross-Jurisdiction Adaptability:**
   - National variations (e.g. SAF-T PT in Portugal, SAF-T NO in Norway, SAF-T PL / JPK_VAT in Poland) derive from this base OECD SAF-T v2.0 XML generator by applying regional XML schema extensions and standard chart of accounts mappings (SKR03 / SKR04).

---

## Source

1. **OECD Committee on Fiscal Affairs:** *Guidance for the Standard Audit File - Tax (SAF-T)*, Version 2.0 (2010), OECD Publishing.
2. **German Federal Ministry of Finance (BMF):** *Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form (GoBD)*, BMF-Schreiben 2019-11-28, IV A 4 - S 0316/19/10003 :001.
3. **German Commercial Code (HGB):**
   - HGB § 238 Abs. 1 (Buchführungspflicht und Grundsätze ordnungsmäßiger Buchführung): Requirement for clear, traceable, and complete financial accounting records.
   - HGB § 257 Abs. 1 (Aufbewahrung von Unterlagen): Mandatory 10-year retention and readability of ledger transactions and source documents.
4. **EU VAT Directive 2006/112/EC:** Article 244 & Article 272 (Record keeping and audit access requirements for cross-border transactions).

---

## What Would Have to Change for the Answer to Change

1. **OECD SAF-T Schema Update:** If OECD releases a major revision (SAF-T v3.0) updating element names or namespaces, the XML element builders in §1 would need updating.
2. **National Mandatory Localizations:** If a target market mandates a specific national variant (e.g., Norwegian SAF-T Financial v1.30 or Polish JPK_V7M) with strict regional XSD validation, specific localized XML serialization rules would be layered on top of the v2.0 core generator.

---

## What Must Land First

This decision record defines 2 implementable issue specifications below. An engineering session requires an open GitHub issue number `#N` to claim implementation via `Closes #N` in a draft pull request per AGENTS.md §5. Filing these specifications as open GitHub issues (by a maintainer or automated issue-creation workflow) MUST land first before implementation work can be claimed via `Closes #N` in an engineering session.

---

## Unblocked Implementable Issue Specifications

### Issue Specification 1
- **Title:** `feat(saft): serialize OECD SAF-T v2.0 XML master files and general ledger header structures`
- **Source:** Decision record `docs/decisions/2026-08-22-pain-01-standard-audit-file-for-tax-saf-t-and-gobd-export-schema.md` §1 & §2, `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6 & 8), Wave 2 / Wave 3
- **Verification:** `node --test test/saft-header-serializer.test.js` passes. A test serializes OECD SAF-T v2.0 XML Header and MasterFiles (GeneralLedgerAccounts, Customers, Suppliers, TaxTable) from workspace domain data. The test asserts:
  1. The resulting XML string conforms to OECD SAF-T v2.0 namespace definitions (`urn:OECD:StandardAuditFile-Tax:2.00`).
  2. Account opening debit/credit balances match expected BigInt minor units accurately converted to decimal strings without float operations.
  3. XML special characters in company names and addresses are escaped cleanly.
- **Labels:** `area:runtime`, `p1`, `ready`
- **Non-Negotiable Constraints:** Zero dependencies, no build step, pure ES module running in Node 22+ and browser, no `node:*` imports outside `runtime/git/fs-node.js`, no `parseFloat`/`Number` on monetary paths, no `Date.now()` or `Math.random()`.

### Issue Specification 2
- **Title:** `feat(saft): export general ledger entries and source document transactions into SAF-T XML format`
- **Source:** Decision record `docs/decisions/2026-08-22-pain-01-standard-audit-file-for-tax-saf-t-and-gobd-export-schema.md` §1 & §3, `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6 & 8), Wave 2 / Wave 3
- **Verification:** `node --test test/saft-entries-serializer.test.js` passes. A test exports general ledger transactions and source sales invoices/payments into `<GeneralLedgerEntries>` and `<SourceDocuments>` SAF-T XML nodes. The test asserts:
  1. `<TotalDebit>` and `<TotalCredit>` match the exact sum of line debits and credits in BigInt minor units.
  2. Each journal line includes valid AccountID, RecordID, and transaction dates matching domain commits.
  3. Mismatched debit/credit inputs trigger a descriptive refusal error before XML generation.
- **Labels:** `area:runtime`, `p1`, `ready`
- **Non-Negotiable Constraints:** Zero dependencies, no build step, browser-compatible ES module, no `parseFloat`/`Number` on monetary paths, debits equal credits invariant preserved in generated SAF-T ledger entries.
