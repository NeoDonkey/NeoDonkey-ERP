# Specifying Wave 2 and Wave 3 Core Accounting and E-Invoicing Standards

**Date:** 2026-08-17
**Author:** Daniel Pammé

## What Changed

In this session, following AGENTS.md §5 and §6 and `docs/SPECIFYING.md`, the queue state was evaluated and identified as having fewer than three unclaimed `ready` issues (the release-blocker set is closed and no open `ready` issues remain in the queue). Per `AGENTS.md` §6 and `docs/NEXT.md`, the session took on the SPECIFY role to decompose the roadmap Wave 2 and Wave 3 items into precise, well-sourced, normative decision specifications.

Four detailed decision records were researched and documented as new files in `docs/decisions/`:

1. **`docs/decisions/2026-08-17-en16931-e-invoicing-core-fields-and-vat-rules.md`**:
   Specifies the mandatory EN 16931-1:2017 semantic core Business Terms (BT-1 through BT-115) and UNTDID 5305 VAT breakdown rules (`S`, `Z`, `E`, `AE`, `K`) for XRechnung / Peppol BIS Billing 3.0 e-invoicing export in Wave 3.

2. **`docs/decisions/2026-08-17-datev-extf-export-structure-and-field-mapping.md`**:
   Specifies the normative DATEV EXTF 700 ASCII file header format, column structure, character encoding, field lengths, and column mappings for general ledger posting export (Buchungsstapel) in Wave 3.

3. **`docs/decisions/2026-08-17-ust-va-german-vat-return-field-mapping.md`**:
   Specifies the aggregation of general ledger transactions into official German VAT advance return (Umsatzsteuervoranmeldung - USt-VA) box codes (Kennziffern Kz 81, 86, 41, 66, 83) under UStG §18 in Wave 2.

4. **`docs/decisions/2026-08-17-general-ledger-period-close-and-year-end-close.md`**:
   Specifies the accounting invariants and procedures for monthly period close locking (FD-5 item 7) and year-end close (Jahresabschluss) P&L clearing and opening balance carry-forwards under HGB §242/§252 and GoBD in Wave 2.

## Verification

The entire test suite (`npm test`) was run to confirm that all 666 tests pass with 0 failures, ensuring full stability and zero regressions across the codebase.
