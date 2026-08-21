# Outbound EN 16931 / XRechnung UBL 2.1 XML Generator

**Date:** 2026-08-21
**Author:** Daniel Pammé

---

## What Changed

- Implemented `runtime/export/xrechnung-generator.js`:
  - Provides `generateXRechnungUblXml(invoice)` to serialize domain invoice objects into standardized UBL 2.1 XML electronic invoices (`urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_2.2`).
  - Strict validation of all mandatory Business Terms (BT-1 Invoice Number, BT-2 Issue Date, BT-3 Type Code, BT-5 Currency, BT-27/31 Seller Name & VAT, BT-44 Buyer Name, BT-129 Invoiced Quantity, BT-131 Line Net Amount, BT-146 Item Price, BT-153 Item Name, and totals).
  - Exact string and BigInt monetary formatting via `runtime/money/money.js` with zero floats in any monetary path.
  - Proper XML entity escaping to avoid XML injection and syntax breakage.
- Updated `runtime/export/xrechnung-parser.js`:
  - Added XML entity unescaping during tag value extraction to guarantee round-trip data integrity.
- Added comprehensive unit test suite in `test/xrechnung-generator.test.js`:
  - Verifies XML structure, element presence, and escaping.
  - Verifies round-trip fidelity between generator and parser (`parseXRechnungUblXml`).
  - Verifies `ValidationError` thrown with explicit codes for missing or malformed mandatory terms.

---

## Verification

- `node --test test/xrechnung-generator.test.js test/xrechnung-parser.test.js`
- `npm test` (682 tests passing, 0 failing)
