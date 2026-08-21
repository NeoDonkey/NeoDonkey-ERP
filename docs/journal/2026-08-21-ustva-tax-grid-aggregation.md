# German USt-VA Tax Grid Aggregation (Issue #124)

**Date:** 2026-08-21
**Author:** Daniel Pammé

## What Changed

Implemented German USt-VA (Umsatzsteuervoranmeldung) tax grid Kennziffern aggregation logic in `runtime/export/ustva.js` and registered its unit test suite in `test/ustva-aggregation.test.js`.

The implementation:
- Aggregates general ledger postings into official German USt-VA Kennziffern:
  - **Kz 81:** 19% taxable sales net base (`net_minor`) and output VAT (`tax_minor`).
  - **Kz 86:** 7% taxable sales net base (`net_minor`) and output VAT (`tax_minor`).
  - **Kz 41:** 0% tax-free intra-Community supplies net base (`net_minor`).
  - **Kz 66:** Deductible input tax (`tax_minor`).
  - **Kz 83:** Remaining net VAT payment/refund (`(Kz 81 tax + Kz 86 tax) - Kz 66 tax`).
- Truncates net base amounts to integer Euros via BigInt integer division (`cents / 100n`) per UStG § 18 Abs. 1 / ELSTER requirements.
- Uses strict BigInt minor-unit representation with zero floating-point operations (`parseFloat`/`Number` forbidden).

## Primary Sources Cited

- UStG § 18 Abs. 1 (Voranmeldungsverfahren), § 12 (Steuersätze), § 15 (Vorsteuerabzug)
- BMF / ELSTER Schnittstellenbeschreibung "Anmeldung der Umsatzsteuer-Voranmeldung 2026"

## Verification

Unit test suite `test/ustva-aggregation.test.js` verifies:
- Exact integer cent aggregation across standard (19%), reduced (7%), intra-EU (0%), and input tax postings.
- Exact Kz 83 payable/refundable balance computation.
- Net base integer Euro truncation per UStG § 18 Abs. 1.
- Source guard asserting no `parseFloat`, `Number(`, or `toFixed` usage on monetary paths.
- `test/wired.test.js` passes without silent orphan warnings.
