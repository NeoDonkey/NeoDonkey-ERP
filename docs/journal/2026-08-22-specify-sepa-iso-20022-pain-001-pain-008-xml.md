# Journal Entry: Specify ISO 20022 SEPA Credit Transfer and Direct Debit XML Payment Initialization

**Date:** 2026-08-22
**Author:** Daniel Pammé

---

## What Changed

1. **Evaluated Work Queue & Routing:**
   - Evaluated the queue per `AGENTS.md` §6: 9 pure open issues, 5 open PRs, 1 unclaimed `ready` issue (#127).
   - Because 1 unclaimed `ready` issue is fewer than 3, the session selected the **SPECIFY** job.
2. **Selected Roadmap Line:**
   - Selected `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6 "It speaks to the outside world"), Wave 2 & Wave 3 (`AR/AP subledgers`, `bank payment export`, `SEPA XML`).
3. **Recorded Decision Record:**
   - Created `docs/decisions/2026-08-22-sepa-pain-001-credit-transfer-and-pain-008-direct-debit-iso-20022-xml.md` establishing specifications for ISO 20022 `pain.001.001.03` Customer Credit Transfer and `pain.008.001.02` Customer Direct Debit payment order initialization XML serialization.
   - Cited primary standards: ISO 20022, EPC SEPA Rulebooks (EPC004-16 & EPC125-10), Regulation (EU) No 260/2012, and ISO 13616-1 (IBAN MOD-97 check).
4. **Defined Unblocked Implementable Issues:**
   - Defined 2 concrete `ready` implementable issue specifications with test-driven verification criteria:
     - `feat(sepa): serialize ISO 20022 pain.001.001.03 SEPA Credit Transfer XML from AP payout batches` (`area:runtime`, `p1`, `ready`)
     - `feat(sepa): serialize ISO 20022 pain.008.001.02 SEPA Direct Debit XML from AR collection batches` (`area:runtime`, `p1`, `ready`)

---

## Verification

- Verified decision record and journal entry compliance by running `node --test test/journal-hygiene.test.js` and `npm test`.
