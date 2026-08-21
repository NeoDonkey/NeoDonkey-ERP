# German USt-VA Tax Grid Aggregation (Issue #124)

**Date:** 2026-08-21
**Author:** Daniel Pammé

## What Changed

Implemented German USt-VA (Umsatzsteuervoranmeldung) tax grid Kennzahlen aggregation logic in `runtime/export/ustva.js` and registered its unit test suite in `test/ustva-aggregation.test.js`.

The implementation addresses reviewer feedback:
1. **Operating Model Alignment:** Aggregates over `vat-kennzahl` (`81`, `86`, `41`, `43`, `45`, `89`, `84`, `61`, `66`, `67`) and `vat-role` (`output-tax`, `input-tax`, `taxable-turnover`, `exempt-turnover`, `non-taxable-turnover`, `acquisition-turnover`) copied from ledger accounts onto postings. No business vocabulary or rate assumptions in `runtime/`.
2. **Complete Line 83 Payable Formula:** Strictly follows `operating-model/information/vat-return.md`:
   - `total_output_tax` = Kz 81 + Kz 86 + Kz 89 (acquisitions) + Kz 84 (§13b reverse charge)
   - `total_input_tax` = Kz 61 (acquisitions) + Kz 66 (supplier invoices) + Kz 67 (§13b)
   - `kz83_payable` = `total_output_tax - total_input_tax`
3. **Exact Minor Unit Calculation:** Retains exact BigInt minor units (cents) throughout aggregation. Truncation (`truncateToEuros`) is provided as an export helper for ELSTER XML generation in wave 3 without prematurely truncating figures stored in the return model.

## Primary Sources Cited

- UStG § 18 Abs. 1 (Voranmeldungsverfahren), § 12 (Steuersätze), § 15 (Vorsteuerabzug)
- BMF / ELSTER Schnittstellenbeschreibung "Anmeldung der Umsatzsteuer-Voranmeldung 2026"
- `operating-model/information/vat-return.md`
- `operating-model/information/posting.md`

## Verification

Unit test suite `test/ustva-aggregation.test.js` verifies:
- Exact integer cent aggregation across output tax, input tax, intra-community acquisitions (Kz 89/61), and §13b reverse charge (Kz 84/67).
- Kz 83 payable balance matching `vat-return.md` specification.
- Exact minor unit preservation without premature truncation.
- Source guard asserting no `parseFloat`, `Number(`, or `toFixed` usage on monetary paths.
- `test/wired.test.js` passes without silent orphan warnings.
