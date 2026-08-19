# Specifying Wave 2 German VAT Advance Return (USt-VA) Standards

**Date:** 2026-08-17
**Author:** Daniel Pammé

## What Changed

In this session, following AGENTS.md §5 and §6 and `docs/SPECIFYING.md`, the queue state was evaluated and identified as having fewer than three unclaimed `ready` issues. Per `AGENTS.md` §6 and `docs/NEXT.md`, the session took on the SPECIFY role to research and specify Wave 2 German VAT Advance Return (USt-VA) standards.

A detailed decision record was researched and documented as a new file in `docs/decisions/`:

- **`docs/decisions/2026-08-17-ust-va-german-vat-return-field-mapping.md`**:
  Specifies the aggregation of general ledger transactions into official German VAT advance return (Umsatzsteuervoranmeldung - USt-VA) box codes (Kennziffern Kz 81, 86, 41, 66, 83) under UStG §18 and BMF guidance, including integer string arithmetic rules and automated test verification strategies.

To prevent duplicate records against `main` (where parallel specifications for DATEV EXTF, EN-16931, and period close landed in #71), this PR focuses solely on the novel USt-VA specification.

## Verification

The entire test suite (`npm test`) was run to confirm that all 666 tests pass with 0 failures, ensuring full stability and zero regressions across the codebase.
