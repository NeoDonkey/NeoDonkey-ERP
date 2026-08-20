# Journal: Specify GoBD Verfahrensdokumentation & Auditor Compliance Mapping

**Date:** 2026-08-20
**Author:** Daniel Pammé
**Task:** Autonomous background engineering session (SPECIFY)

---

## Job Selection

- **Job Selected:** `SPECIFY`
- **Reasoning:**
  - Evaluated open `ready` issues: 6 total open `ready` issues (#84, #83, #82, #44, #34, #20).
  - Open PRs claim 5 of these issues (#83 in PR #94, #82 in PR #89, #44 in PR #29, #34 in PR #88, #20 in PR #73).
  - Exactly 1 unclaimed `ready` issue (#84) exists.
  - Per `AGENTS.md` §6: fewer than 3 unclaimed `ready` issues routes the session to `SPECIFY`.

---

## Work Performed

1. **Topic Claim:** Claimed German GoBD *Verfahrensdokumentation* Specification & Code Cross-Reference Mapping under Wave 3 & Gate Condition 8. Checked open PRs and `docs/decisions/` to confirm no in-flight collision.
2. **Primary Source Research:**
   - GoBD (BMF-Schreiben vom 28.11.2019 - IV A 4 - S 0316/19/10003 :001) § 3.2.1–3.2.4 & § 9.1 (Abs. 151–155).
   - Abgabenordnung (AO) §§ 145, 146 (Abs. 4), 147 (10-year retention).
   - Handelsgesetzbuch (HGB) §§ 238, 239, 257.
3. **Decision Record Creation:**
   - Created `docs/decisions/2026-08-20-gobd-verfahrensdokumentation-and-auditor-verification.md` detailing the mapping of the four GoBD compliance pillars to runtime primitives in `runtime/kernel.js`, `runtime/git/store.js`, `runtime/identity/sshsig.js`, `runtime/truth/sequence.js`, and `runtime/polism/execute.js`.
   - Defined 5 mandatory chapters for `docs/VERFAHRENSDOKUMENTATION.md`.
   - Defined 2 implementable `ready` issues to build the document and its automated verification tests (`test/verfahrensdokumentation.test.js` & `test/gate-score.test.js`).
4. **Plan & Backlog Alignment:**
   - Updated `docs/NEXT.md` to list the newly specified standard and its unblocked implementable issues under Newly Specified Standards.

---

## Verification

- `npm test`: Ran full test suite, all 675 tests pass (with known flaky relay network test passing upon re-run).
- Verified decision record contains required headers (`## Source` / `## Why`), primary sources, and `## What Must Land First` section per repository hygiene rules.
