# Journal: Implement EN 16931 / XRechnung v3.0 UBL 2.1 XML Generator

**Date:** 2026-08-20
**Issue:** #83 (`feat(xrechnung): generate EN-16931 UBL 2.1 XML invoices from domain invoice objects`)
**Gate Condition:** Condition 6 ("It speaks to the outside world - XRechnung/EN-16931 e-invoicing")

## What Changed
1. **`runtime/export/xrechnung.js`**: Created generator function `generateXRechnungUblXml(invoice)` and XML escaping utility `escapeXml(value)`.
   - Adheres to EN 16931-1:2017 semantic data model and KoSIT XRechnung v3.0.1 UBL 2.1 syntax specification.
   - Converts monetary fields using `runtime/money/money.js` and `runtime/money/decimal.js` (`toMoney`, `formatScaled`), ensuring zero floating-point arithmetic across all amounts and line totals.
   - Enforces Non-Negotiable #5 by removing hardcoded default VAT rates ('19') and country codes ('DE'). Requires explicit `vatRate` and `countryCode` declarations on invoice objects and throws descriptive `TypeError` exceptions if missing.
   - Validates mandatory business terms (BT-1, BT-2, BT-27, BT-40, BT-44, BT-55, BT-116, BT-119, BT-126, BT-152, BT-153).
2. **`test/xrechnung-generator.test.js`**: Added unit test suite covering XML special character escaping, full document UBL 2.1 XML generation with exact decimal assertions, and validation failure modes for incomplete domain objects or missing `vatRate`/`countryCode`.

## Verification
- `npm test`: 678 tests pass cleanly (3 new tests added).
