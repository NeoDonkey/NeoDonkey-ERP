# EN-16931-1 E-Invoicing Core Business Terms and VAT Category Breakdown Rules

**Date:** 2026-08-17
**Status:** Settled / Normative for Wave 3 E-Invoicing (XRechnung / Peppol BIS Billing 3.0)
**Area:** `operating-model/` / e-invoicing export

## The Question

What core document-level and line-level Business Terms (BTs) must NeoDonkey generate and validate when exporting or receiving electronic invoices compliant with EN 16931-1:2017 (XRechnung / Peppol BIS Billing 3.0), and how must VAT breakdown categories and invoice totals be calculated?

## The Answer

1. **Mandatory Document Level Business Terms (EN 16931-1 §6.1):**
   - **BT-1** Invoice Number (unique alphanumeric document identifier)
   - **BT-2** Invoice Issue Date (YYYY-MM-DD format)
   - **BT-3** Invoice Type Code (UNTDID 1001: `380` commercial invoice, `381` credit note)
   - **BT-5** Invoice Currency Code (ISO 4217 3-letter code, e.g., `EUR`)
   - **BT-27** Seller Name
   - **BT-31** Seller VAT Identifier (prefixed by country code, e.g. `DE123456789`)
   - **BT-44** Buyer Name
   - **BT-48** Buyer VAT Identifier (mandatory for cross-border B2B / reverse charge)
   - **BT-106** Invoice Total Amount Without VAT (Sum of line net amounts - allowances + charges)
   - **BT-109** Invoice Total VAT Amount (Sum of VAT category tax amounts BT-117/120)
   - **BT-112** Invoice Total Amount With VAT (BT-106 + BT-109)
   - **BT-115** Amount Due For Payment (BT-112 - prepaid amounts)

2. **VAT Category Breakdown Rules (UNTDID 5305 / EN 16931-1 BG-23):**
   - Each invoice must group taxable amounts into distinct VAT breakdown groups (BG-23) by Category Code (**BT-116**) and Rate (**BT-119**):
     - `S` — Standard rate (e.g. 19% in Germany, requires BT-119 = `19.00`)
     - `Z` — Zero rated goods (requires BT-119 = `0.00`)
     - `E` — Exempt from tax (requires BT-119 = `0.00` and BT-120 exemption reason code/text)
     - `AE` — Reverse charge (requires BT-119 = `0.00` and BT-120 exemption reason e.g. "Reverse charge")
     - `K` — Intra-Community supply (requires BT-119 = `0.00` and seller/buyer VAT IDs)
   - **BT-116** VAT Category Code
   - **BT-117** VAT Category Taxable Amount (Sum of net line amounts belonging to this category)
   - **BT-118** VAT Category Tax Amount ($\lfloor BT-117 \times BT-119 / 100 \rceil$ using commercial half-up rounding per category total or line total as configured)

3. **Arithmetic Invariants:**
   - Float numbers are strictly forbidden. Monetary amounts MUST be represented as exact string values (`"100.00 EUR"`) backed by `BigInt` minor units.
   - $\sum \text{Line Net Amounts (BT-131)} = \text{Sum of VAT Taxable Amounts (BT-117)} = \text{BT-106}$.
   - $\text{BT-106} + \text{BT-109} = \text{BT-112}$.

## Source

- **EN 16931-1:2017** "Electronic invoicing - Part 1: Semantic data model of the core elements of an electronic invoice", European Committee for Standardization (CEN), Section 6.1 "Core invoice elements" (BT-1 through BT-165, BG-22, BG-23).
- **Directive 2006/112/EC** (EU VAT Directive), Articles 226 (mandatory invoice content requirements) and 226a.
- **UNTDID 5305** (Duty/tax/fee category code) and UNTDID 1001 (Invoice type code).
- **CIUS-XRechnung 3.0.1** (Coordination Office for IT Standards - FITKO), Section 3 "Business Rules" (BR-CO-10 through BR-CO-16).

## Verification Strategy

An automated test in `test/e-invoicing-en16931.test.js` will construct an invoice model with multiple line items across standard rate (19%) and reduced rate (7%), generate the EN-16931 semantic structure, and verify:
1. All mandatory Business Terms (BT-1 through BT-115) are populated.
2. The VAT category breakdown (BG-23) correctly groups line items by code (`S`) and rate (`19.00` / `7.00`).
3. Total Net (BT-106), Total VAT (BT-109), and Total Gross (BT-112) balance exactly with zero floating-point arithmetic errors.
4. Validation fails cleanly if a mandatory field (e.g. BT-31 Seller VAT ID for standard rate) is missing.

## What Would Have To Change For This To Be Wrong

If the European Committee for Standardization (CEN) publishes a revised EN 16931 standard altering the mandatory core Business Terms or UNTDID category codes, or if EU Council updates Directive 2006/112/EC regarding e-invoicing content mandates under ViDA (VAT in the Digital Age).
