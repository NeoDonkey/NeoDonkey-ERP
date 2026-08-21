# Decision Record: ZUGFeRD 2.2 / Factur-X Hybrid E-Invoicing and UN/CEFACT CrossIndustryInvoice (CII) Data Model

**Date:** 2026-08-21

## Question
How should NeoDonkey model ZUGFeRD 2.2 / Factur-X v1.0.06 hybrid PDF/XML e-invoicing, UN/CEFACT CrossIndustryInvoice (CII D16B) XML syntax generation and parsing, profile compliance (BASIC, COMFORT/EN 16931, EXTENDED), and embedded PDF/A-3 attachment metadata under EU Directive 2014/55/EU, EN 16931-1:2017, and German UStG § 14?

## Answer

1. **ZUGFeRD 2.2 / Factur-X Profile Alignment & Standard Compliance:**
   - ZUGFeRD 2.2 (developed by FeRD in Germany) and Factur-X 1.0.06 (developed by FNFE-MPE in France) are technically identical specifications for hybrid e-invoicing.
   - The XML payload MUST conform to the UN/CEFACT XML CrossIndustryInvoice (CII) D16B schema (namespace `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100`).
   - The default target profile for NeoDonkey e-invoice generation and validation MUST be the **EN 16931 (COMFORT)** profile (`urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931`), which satisfies mandatory e-invoicing requirements across Germany (XRechnung equivalence), France, and the EU.
   - Lower profiles (MINIMUM, BASIC WL, BASIC) and higher profiles (EXTENDED) MUST be recognized during inbound XML parsing and validated according to their declared profile identifier (`Guidance/ID`).

2. **CII D16B XML Structure & Mandatory Business Term Mapping:**
   - **Root Element:** `rsm:CrossIndustryInvoice`
   - **ExchangedDocumentContext (`rsm:ExchangedDocumentContext`):**
     - Profile Identifier: `ram:Guidance/ram:ID` (e.g. `urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931`).
   - **ExchangedDocument (`rsm:ExchangedDocument`):**
     - Invoice Number (`BT-1`): `ram:ID`
     - Invoice Type Code (`BT-3`): `ram:TypeCode` (e.g., `380` for Commercial Invoice, `381` for Credit Note).
     - Issue Date (`BT-2`): `ram:IssueDateTime/udt:DateTimeString` with format attribute `102` (`YYYYMMDD`).
   - **SupplyChainTradeTransaction (`rsm:SupplyChainTradeTransaction`):**
     - **Header Trade Agreement:**
       - Seller Name (`BT-27`), Address (`BT-35`..`BT-40`), VAT ID (`BT-31` / `ram:SpecifiedTaxRegistration/ram:ID` with schemeID `VA`).
       - Buyer Name (`BT-44`), Address (`BT-50`..`BT-55`), VAT ID (`BT-48` / `ram:SpecifiedTaxRegistration/ram:ID`).
     - **Header Trade Delivery:**
       - Delivery Date (`BT-72`): `ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString`.
     - **Header Trade Settlement:**
       - Payment Means Code (`BT-81`): `ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode` (e.g., `58` for SEPA credit transfer).
       - Payment Terms (`BT-20`): `ram:SpecifiedTradePaymentTerms/ram:Description`.
       - Tax Summary Breakdown (`BG-23`): `ram:ApplicableTradeTax` containing Tax Category (`BT-151`), Tax Rate (`BT-152`), Taxable Amount (`BT-116`), and Tax Amount (`BT-117`).
       - Monetary Summation (`BG-22`):
         - Line Total Amount (`BT-106`): `ram:LineTotalAmount`
         - Tax Basis Total Amount (`BT-109`): `ram:TaxBasisTotalAmount`
         - Tax Total Amount (`BT-110`): `ram:TaxTotalAmount`
         - Grand Total Amount (`BT-112`): `ram:GrandTotalAmount`
         - Due Payable Amount (`BT-115`): `ram:DuePayableAmount`

3. **Monetary Values & Decimal Precision (FD-1):**
   - No `Number` or floating-point conversion is permitted anywhere in CII XML parsing or generation.
   - All amounts in XML (`ram:GrandTotalAmount`, `ram:ChargeAmount`, etc.) MUST be parsed into integer minor units (`BigInt` cents) using exact string manipulation.
   - Arithmetic validations (`BT-112 == BT-109 + BT-110`, `BT-109 == sum(LineTotalAmount)`) MUST be enforced on `BigInt` minor units before accepting inbound CII invoices.

4. **PDF/A-3 Hybrid Attachment Specification:**
   - In hybrid ZUGFeRD / Factur-X documents, the CII XML file MUST be attached into a PDF/A-3 (ISO 19005-3) file with exact filename `factur-x.xml` (or `zugferd-invoice.xml` for legacy ZUGFeRD 1.x compatibility).
   - Relationship attribute MUST be set to `/AFRelationship /Alternative`.

## Source
- **Primary Source (European E-Invoicing Standard):** EN 16931-1:2017 (Electronic invoicing - Part 1: Semantic data model of the core elements of an electronic invoice) and CEN/TS 16931-3-3:2017 (Syntax binding for UN/CEFACT XML Industry Invoice D16B).
- **Primary Source (ZUGFeRD / Factur-X Specification):** Forum elektronische Rechnung Deutschland (FeRD) / FNFE-MPE: *ZUGFeRD 2.2 / Factur-X 1.0.06 Specification* (March 2024), Profile Specification & XML Schema Bindings.
- **Primary Source (German Tax Law):** Umsatzsteuergesetz (UStG) § 14 Abs. 1 & 2 (E-Invoicing obligation from Jan 1, 2025).

## Verification Method
- **Unit Test Verification:** Unit test suite in `test/zugferd-cii-parser.test.js` generates and parses valid UN/CEFACT CII XML strings for ZUGFeRD 2.2 / Factur-X invoices, verifies mandatory Business Terms, validates arithmetic sum invariants on `BigInt` minor units, and asserts explicit `ValidationError` thrown on missing mandatory terms or corrupt XML structure.

## What Must Land First

Filing the issue specifications below as open GitHub issues (e.g., by a maintainer or a session with GitHub issue creation privileges) MUST land first before implementation can be claimed. An engineering session requires an open GitHub issue number `#N` to claim implementation via `Closes #N` in a draft pull request per AGENTS.md §5. The specifications below define the exact scope, primary sources, constraints, labels, and verification methods for those issues.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(zugferd): generate EN-16931 UN/CEFACT CII D16B XML invoices for ZUGFeRD 2.2 / Factur-X`
- **Title:** Generate EN-16931 compliant UN/CEFACT CII D16B XML invoices for ZUGFeRD 2.2 / Factur-X
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "It speaks to the outside world") and Part 3 (Wave 3: E-invoicing & ZUGFeRD/Factur-X)
- **Primary Source Citation:** EN 16931-1:2017 & CEN/TS 16931-3-3:2017 (UN/CEFACT CII D16B binding)
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/zugferd-cii-generator.test.js` invokes `generateZugferdCiiXml(invoice)` with a domain invoice object and asserts:
  1. Root element is `rsm:CrossIndustryInvoice` with namespace `urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100`.
  2. Profile ID matches `urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931`.
  3. Monetary amounts (`ram:GrandTotalAmount`, `ram:TaxBasisTotalAmount`, `ram:TaxTotalAmount`) are formatted cleanly with exact decimals matching currency scale without float operations.
  4. Mandatory terms (`BT-1` invoice number, `BT-2` issue date YYYYMMDD, `BT-31` seller VAT ID, `BT-48` buyer VAT ID) are present.

### Issue 2: `feat(zugferd): parse and validate UN/CEFACT CII XML e-invoices against mandatory BT terms and totals`
- **Title:** Parse and validate UN/CEFACT CII XML e-invoices against mandatory BT terms and totals
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "one inbound dialect") and Part 3 (Wave 3: E-invoicing)
- **Primary Source Citation:** EN 16931-1:2017 §6.3 & ZUGFeRD 2.2 / Factur-X 1.0.06 §3
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/zugferd-cii-parser.test.js` invokes `parseZugferdCiiXml(xml)` and asserts:
  1. Valid CII XML string parses into domain invoice structure with `BigInt` minor units for all monetary fields.
  2. Missing mandatory BT terms (e.g. `BT-1` invoice number or `BT-31` seller VAT ID) throw an explicit `ValidationError` identifying the missing term.
  3. Mismatched total arithmetic (`BT-112 != BT-109 + BT-110`) throws an arithmetic `ValidationError`.
