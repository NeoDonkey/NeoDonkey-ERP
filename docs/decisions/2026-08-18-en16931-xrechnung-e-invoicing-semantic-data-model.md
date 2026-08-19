# Decision Record: EN 16931 and XRechnung Semantic E-Invoicing Data Model

**Date:** 2026-08-18

## Question
How should NeoDonkey model semantic electronic invoices per the European Standard EN 16931-1 and the German CIUS profile XRechnung (v3.0) for compliance with mandatory B2B e-invoicing requirements under German tax law (UStG § 14)?

## Answer

1. **Mandatory B2B E-Invoicing Schedule (Germany, UStG § 14):**
   - Effective **January 1, 2025**, all German businesses MUST be capable of receiving compliant electronic invoices (EN 16931 / XRechnung / ZUGFeRD 2.x).
   - Mandatory issuance phases in between 2025 and 2028 (2025: B2B electronic invoice issuance optional/default consent; 2027: mandatory for businesses with turnover > €800k; 2028: mandatory for all B2B transactions).

2. **Semantic Data Model Core Elements (EN 16931-1):**
   - **BT-1 (Invoice Number):** Sequential, gapless identifier string.
   - **BT-2 (Invoice Issue Date):** ISO 8601 date (`YYYY-MM-DD`).
   - **BT-3 (Invoice Type Code):** UNCL1001 code (e.g., `380` for Commercial Invoice, `381` for Credit Note, `384` for Corrected Invoice).
   - **BT-5 (Invoice Currency Code):** ISO 4217 currency identifier (e.g., `EUR`).
   - **BT-10 (Buyer Reference / Leitweg-ID):** Mandatory for public sector (B2G) in Germany, passed in `cbc:BuyerReference`.
   - **BT-27 / BT-31 (Seller / Buyer VAT Identifier):** ISO country code + tax number (e.g., `DE123456789`).
   - **BT-112 (Invoice Total Amount with VAT):** Monetary amount represented in ISO 4217 scale string (`"5949.99 EUR"`).

3. **Syntax Binding:**
   - Primary XML syntax binding MUST be **UBL 2.1** (`urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`) using UN/CEFACT CII (`CrossIndustryInvoice`) as an allowed secondary dialect.
   - Custom extensions are strictly prohibited unless defined within official Extension specifications.

4. **Zero Float and Precision:**
   - All line net amounts (BT-131), VAT category taxable amounts (BT-116), and document totals MUST be computed using internal integer minor units (`BigInt`) and serialized to exactly 2 decimal places (or item price unit precision up to 4 decimal places where applicable).

## Source
- **Primary Source (European Standard):** EN 16931-1:2017 *Electronic invoicing - Part 1: Semantic data model of the core elements of an electronic invoice*.
- **Primary Source (German Specification):** KoSIT XRechnung Specification Version 3.0.1 (Kooridinierungsstelle für IT-Standards).
- **Primary Source (German Tax Law):** German Value Added Tax Act (Umsatzsteuergesetz - UStG) § 14 Absatz 1 und 2 as amended by the Growth Opportunities Act (Wachstumschancengesetz, BGBl. 2024 I Nr. 108).

## Verification Method
- **Unit Test Verification:** `test/xrechnung-xml-schema.test.js` generates an XRechnung UBL 2.1 XML document from an invoice object and asserts structural validation, mandatory Business Term presence (BT-1 through BT-115), and exact decimal arithmetic representation against the KoSIT semantic rule set.

## Unblocked Implementable Issues

### Issue 1: `feat(xrechnung): generate EN-16931 UBL 2.1 XML invoices from domain invoice objects` → [#83](https://github.com/NeoDonkey/NeoDonkey-ERP/issues/83)
- **Title:** Generate EN 16931 / XRechnung v3.0 UBL 2.1 XML e-invoices from invoice entity objects
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "XRechnung/EN-16931 invoices") and Part 3 (Wave 3: XRechnung e-invoicing)
- **Primary Source Citation:** EN 16931-1:2017 §6.1 & KoSIT XRechnung Specification v3.0.1 §3
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/xrechnung-generator.test.js` passes a domain invoice object (seller/buyer VAT IDs, lines, amounts, currency) to `generateXRechnungUblXml(invoice)` and asserts:
  1. Root element is `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">`.
  2. CustomizationID contains `urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0`.
  3. Mandatory business terms BT-1 through BT-115 are present in specified XML tags.
  4. All currency amounts match exact integer `BigInt` minor units rendered as `0.00` formatted strings without floating point arithmetic.

### Issue 2: `feat(xrechnung): parse and validate EN-16931 UBL 2.1 XML invoices against mandatory BT terms` → [#84](https://github.com/NeoDonkey/NeoDonkey-ERP/issues/84)
- **Title:** Parse and validate inbound EN 16931 UBL 2.1 e-invoices into domain invoice structures
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "one inbound dialect") and Part 3 (Wave 3: one inbound dialect)
- **Primary Source Citation:** EN 16931-1:2017 §6.2 & KoSIT XRechnung Specification v3.0.1 §4
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/xrechnung-parser.test.js` parses valid and invalid UBL 2.1 XML strings using `parseXRechnungUblXml(xml)` and asserts:
  1. Valid XML returns a structured domain invoice object with correct string values and `BigInt` minor unit monetary fields.
  2. Missing mandatory BT terms (e.g. BT-1 Invoice Number or BT-31 Seller VAT Identifier) throw explicit `ValidationError` identifying the missing term ID.
  3. Mismatched document totals (`BT-112 != BT-109 + BT-110`) are rejected with an explicit arithmetic error.
