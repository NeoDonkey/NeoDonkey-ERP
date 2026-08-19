# Filed DATEV and EN-16931 implementable issues from decision records

**Date:** 2026-08-19

## What changed

Issue #77 asked for decision records in `docs/decisions/` to be decomposed into implementable
GitHub issues. This session took the two most concrete records — DATEV EXTF and EN-16931/XRechnung
— and filed their pre-written "Unblocked Implementable Issues" sections as real GitHub issues.

### Issues created

| # | Title | Record | Gate condition |
|---|---|---|---|
| #81 | feat(datev): serialize EXTF v700 header and column metadata lines | `docs/decisions/2026-08-18-datev-extf-export-structure-and-booking-header-format.md` | 6 — outside world |
| #82 | feat(datev): serialize EXTF v700 posting lines from SKR03/SKR04 ledger entries | same | 6 |
| #83 | feat(xrechnung): generate EN-16931 UBL 2.1 XML invoices from domain invoice objects | `docs/decisions/2026-08-18-en16931-xrechnung-e-invoicing-semantic-data-model.md` | 6 |
| #84 | feat(xrechnung): parse and validate EN-16931 UBL 2.1 XML invoices against mandatory BT terms | same | 6 |

### What was updated

The two decision records now link to the issues they spawned, so a reader can trace from research
to the work that uses it.

## What was not done

Five records remain without filed issues: GoBD period close, OSS VAT, multi-currency, PDF
rendering, and the AR/AP subledger. The GoBD and AR/AP records have pre-written issue
specifications ready to file; the other three need decomposition first. The next session should
take those.

## Verification

`npm test`: 672 tests, 669 pass, 2 skipped, 1 known-flaky failure (README Claim 4, issue #46).
The failure is pre-existing and unrelated to documentation changes.
