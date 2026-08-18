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
