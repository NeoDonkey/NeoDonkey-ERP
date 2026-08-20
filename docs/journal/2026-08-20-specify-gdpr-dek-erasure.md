# Session Journal: Specify GDPR Cryptographic DEK Erasure and Document Shredding

**Date:** 2026-08-20

## Summary
Performed a `SPECIFY` session for Wave 2 / Gate Condition 5 ("Sensitive data is encrypted with group keys, per-peer indexes, and GDPR erasure by destroying a DEK while the GoBD chain stays verifiable.") per `AGENTS.md` §5 and §6 and `docs/SPECIFYING.md`.

## Job Selection
- **Job:** `SPECIFY`
- **Reason:** Evaluated open issues via GitHub REST API. Out of 5 total `ready` issues, 3 are claimed by active open pull requests (`#83` in PR #94, `#82` in PR #89, `#20` in PR #73) and 2 are blocked by pending PRs (`#34` in PR #88, `#13` in PR #29). Thus, 0 unclaimed `ready` issues were available in the queue. Per `AGENTS.md` §6, fewer than 3 unclaimed `ready` issues mandates a SPECIFY session.

## What Was Done
1. **Claimed Topic:** GDPR Cryptographic DEK Erasure and Document Shredding Protocol under GoBD Immutability Constraints.
2. **Researched Primary Sources:**
   - Regulation (EU) 2016/679 (GDPR) Articles 17 ("Right to erasure"), 17(3)(b), 25, 32(1)(a).
   - EDPB Guidelines 05/2020 & Opinion 05/2014 on key destruction as irreversible anonymisation.
   - BMF GoBD Circular (2019-11-28) § 3.2.1 (Unveränderbarkeit) & § 9 (Aufbewahrung).
3. **Recorded Decision Record:** Created `docs/decisions/2026-08-20-gdpr-cryptographic-dek-erasure-and-document-shredding.md`.
4. **Decomposed into Implementable Issue Specifications:**
   - Issue 1: `feat(crypto): implement DEK key destruction, zeroing, and tombstoning in runtime/crypto/shred.js`
   - Issue 2: `feat(kernel): process signed shred-dek transactions and update vault tombstone records`
5. **Preserved Plan Integrity:** Unchanged `docs/NEXT.md` because the high-level roadmap sequence remains intact.

## Verification
- Ran `npm test`: All 679 tests passed (with 2 quarantined skipped tests).
- Ran structural hygiene test (`test/journal-hygiene.test.js`) and verified that the new decision record adheres to required headers (including `## Source` / `## What Must Land First`).
