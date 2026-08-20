# Journal Entry: EN 16931 / XRechnung UBL 2.1 E-Invoice Parser

**Date:** 2026-08-20

## Summary of Changes

Implemented inbound electronic invoice parsing and validation for EN 16931-1:2017 and KoSIT XRechnung v3.0 UBL 2.1 XML invoices (#84), advancing Gate Condition 6 ("It speaks to the outside world").

### Key Implementations:

1. **Inbound UBL 2.1 XML Invoice Parser (`runtime/export/xrechnung-parser.js`):**
   - Pure JavaScript XML parsing with zero external dependencies and zero build step.
   - Extracts mandatory Business Terms per EN 16931-1:
     - `BT-1` Invoice Number (`cbc:ID`)
     - `BT-2` Issue Date (`cbc:IssueDate`)
     - `BT-3` Invoice Type Code (`cbc:InvoiceTypeCode`)
     - `BT-5` Document Currency Code (`cbc:DocumentCurrencyCode`)
     - `BT-10` Buyer Reference (`cbc:BuyerReference`)
     - `BT-27` / `BT-31` Seller Name & VAT Identifier (`cac:AccountingSupplierParty`)
     - `BT-44` Buyer Name (`cac:AccountingCustomerParty`)
     - `cac:InvoiceLine` items (`BT-126`, `BT-131`, `BT-153`, `BT-146`)
     - Legal Monetary Totals (`BT-106`, `BT-109`, `BT-110`, `BT-112`, `BT-115`)
   - Strict `ValidationError` error handling when mandatory Business Terms are absent.
   - Exact `Money` representation (BigInt minor units) without floats via `runtime/money/money.js`.
   - Enforces total arithmetic integrity checks:
     - Line items net sum equals `BT-106` (`LineExtensionAmount`).
     - `BT-112` (`TaxInclusiveAmount`) equals `BT-109` (`TaxExclusiveAmount`) + `BT-110` (`TaxAmount`).

2. **Automated Unit Verification (`test/xrechnung-parser.test.js`):**
   - Asserts extraction of domain invoice structure from valid EN 16931 UBL 2.1 e-invoices.
   - Asserts strict rejection with `ValidationError` error codes for missing Business Terms (BT-1, BT-2, BT-3, BT-5, BT-27, BT-31).
   - Asserts arithmetic total mismatch detection and rejection.
