# Development journal

Newest first. One entry per change, dated `YYYY-MM-DD`. A few lines each — what changed and why,
not a restatement of the diff. `docs/NEXT.md` holds what happens next; this file holds what
happened.

---

## 2026-08-13

- Added `test/readme-claims.test.js` to continuously verify the four headline status claims in `README.md` (strict default-deny, role grounding `claimed ∩ recorded`, double-entry balance invariant, and relay sync company recovery). Updated `docs/AUDIT.md` to confirm the audit findings.
- Closed compromise #13 (business vocabulary field names in runtime). Added `## Displayed by` grammar section to POLISM grammar (`runtime/polism/grammar.md`) and `runtime/polism/parse.js`, parsing `displayedBy` field lists into `EntityDef`. Updated `displayLabel` and `columnsFor` in `runtime/ui/fields.js` to prioritize `displayedBy` over fallback candidate names (`name`, `title`, `label`, `description`). Verified with unit tests in `test/g-ui.test.js`.
- Closed compromise #21 (actorRoles self-declaration). Updated `docs/COMPROMISES.md` and `docs/NEXT.md` to reflect that FD-9 role-grounding (effective roles = claimed ∩ recorded) is fully implemented and enforced in `runtime/kernel.js` and verified by `test/roles-fd9.test.js`.
- Rewrote the content-fact section of compromise #4f in `docs/COMPROMISES.md` to reflect that all 13 status fields in `operating-model/information/` have been converted to enums (`status: one of ...`) and verified.

## 2026-08-12

- Closed compromise #15 rr4 (unsigned build visibility under "This runtime" screen). Passed `release` into `renderRuntime` and updated `releaseBlock` in `views.js` to correctly distinguish and display the unverified/unsigned state as "This runtime is not signed" (and `'verified'` correctly as verified). Added a robust test in `test/g-ui.test.js` to assert the rendering of both states.
- Closed compromise #4g (threshold authorisation content adoption). Checked operating-model process files and verified that they have all successfully adopted branched `when ... then ... otherwise` rules to enforce the 10,000 € purchase order, 10 % discount, and 100 € credit-note limits, and removed stale prose comments.
- Closed compromises #4h (master data promotion paths) and #22 (permissive acceptance demo).
  Added explicit processes for article activation, supplier approval, and purchase order confirmation
  under `operating-model/processes/` so that master data can be promoted via governed, executable rules.
  Updated the acceptance demo `demo/sarah.mjs` to run with `strictAuthorization: true` and only
  the 8 roles actually held by Sarah, ensuring strict validation against the repository's rules.
- Imported the v0.1 codebase into the repository: `runtime/`, `operating-model/`, `templates/`,
  `test/`, `docs/`, the demo and the MCP server. Until now the repository held only scaffolding.
- Added `.github/workflows/ci.yml`: the suite as a required check, plus guards for the three
  things that must never land — a declared dependency, tracked key material, and a workspace
  written into the source tree.
- Reworked `.github/workflows/auto-merge.yml` to queue rather than merge. It previously merged
  every pull request immediately, without running a single test; a red build now stays open.
- Replaced the seeded backlog with `docs/NEXT.md`. The old one listed the git storage layer, the
  browser runtime, the CRDT primitives and the POLISM parser as work to be started — all four are
  built and under test. Anyone following it would have written a second implementation alongside
  the first.
- Extended `.gitignore` to cover key material and workspace artefacts.

## 2026-08-04

- Consolidated `docs/COMPROMISES.md` against the code: 27 entries open, 6 closed, every status
  re-checked rather than carried over from a report.
- Wrote `docs/READINESS.md` to separate publishable from pilot-ready from production, after the
  roadmap's "v1.0 gate" was left ambiguous about which bar it described.

## 2026-08-03

- Initial repository.
