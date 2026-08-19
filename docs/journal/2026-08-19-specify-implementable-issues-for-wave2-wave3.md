# Journal: Specifying Implementable Issues for Wave 2 and Wave 3

**Date:** 2026-08-19

## Why
Issue #77 identified a bottleneck in autonomous execution: while seven primary-sourced decision records had been compiled for Wave 2 and Wave 3 standards (DATEV EXTF, EN 16931 / XRechnung, GoBD period close, etc.), none of them specified ready, implementable issues for software engineers to pick up. Per `AGENTS.md` §6 and `docs/SPECIFYING.md`, this session performed a `SPECIFY` job to turn the decision records into 6 fully-decomposed, unit-tested, implementable issue definitions.

## What Changed
Added `## Unblocked Implementable Issues` sections to three core decision records in `docs/decisions/`:

1. `2026-08-18-datev-extf-export-structure-and-booking-header-format.md`:
   - Issue 1: `feat(datev): serialize EXTF v700 header and column metadata lines` (`area:runtime`, `p1`, `ready`)
   - Issue 2: `feat(datev): serialize EXTF v700 posting lines from SKR03/SKR04 ledger entries` (`area:runtime`, `p1`, `ready`)

2. `2026-08-18-en16931-xrechnung-e-invoicing-semantic-data-model.md`:
   - Issue 1: `feat(xrechnung): generate EN-16931 UBL 2.1 XML invoices from domain invoice objects` (`area:runtime`, `p1`, `ready`)
   - Issue 2: `feat(xrechnung): parse and validate EN-16931 UBL 2.1 XML invoices against mandatory BT terms` (`area:runtime`, `p1`, `ready`)

3. `2026-08-18-gobd-period-close-and-balance-carryforward.md`:
   - Issue 1: `feat(ledger): enforce GoBD period locking (Festschreibung) and posting immutability in kernel` (`area:runtime`, `p1`, `ready`)
   - Issue 2: `feat(ledger): generate year-end P&L closing and balance carryforward (Saldenvortrag) entries` (`area:runtime`, `p1`, `ready`)

Updated `docs/NEXT.md` to reference the newly unblocked implementable issue definitions.

In round 1 of review, corrected gate condition references in GoBD issues to Gate Condition 6 ("It speaks to the outside world") and added explicit constraint lists (`Constraints: zero dependencies, no build step...`) to all 6 issue specifications per `SPECIFYING.md` §6.

## Verification
- Verified file updates using `read_file`.
- Executed `npm test` to ensure all 672 test assertions and hygiene checks (`test/journal-hygiene.test.js`, `test/audit-location-citations.test.js`, `test/documented-counts.test.js`) pass cleanly without errors.
