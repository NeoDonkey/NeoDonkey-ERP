# Development journal

Newest first. One entry per change, dated `YYYY-MM-DD`. A few lines each — what changed and why,
not a restatement of the diff. `docs/NEXT.md` holds what happens next; this file holds what
happened.

---

## 2026-08-17

- Closed the review loop. Until today every review this repository produced was written to a pull
  request that had already merged: `auto-merge` queued on `opened`, `test` was the only required
  check and takes about a minute, and the review takes three. On #42 the pull request merged at
  04:51:45 and the review — correctly reporting that a document claimed 658 tests where the suite
  ran 661 — arrived at 04:53:49. Every review ever written by that workflow landed too late to
  matter.
- Commenting harder would not have fixed it. Jules states on every pull request it opens that it
  will "only act on instructions from the user who triggered this task", and the reviewer comments
  as `github-actions`, so a GitHub comment is a channel Jules is required to ignore. The findings
  now go through the Jules API instead — `sessions/{id}:sendMessage`, addressed by the session id
  in the pull request body — so the reviewer talks to the session that wrote the code. It pushes to
  the same branch, which re-runs the review. Three rounds, then the pull request is parked.
- A clean verdict is now what enables auto-merge, which means the reviewer holds the queue. The
  previous design deliberately refused to allow that, on the grounds that a reviewer able to block
  the queue unattended is worse than no reviewer. That reasoning still holds and is why
  `merge-sweeper.yml` exists: no verdict within 45 minutes and the pull request is released on
  `test` alone. The gate can slow the queue and cannot deadlock it. `auto-merge.yml` is deleted;
  its job is split between the two files.
- Added `lane-doctor.yml`, a daily check that the lanes can still do what they claim. It exists
  because of what the last five days cost: the audit lane's token could open issues but not push a
  branch, so it could verify a fix and never land one. It reported this the only way it could, by
  opening #14 and #17, and nothing was listening. It then re-discovered and re-filed the same
  test-count drift eleven times — #13, #15, #16, #18, #19, #21, #24, #25, #37, #39, #41 — every
  report correct, none of them landable. Meanwhile its provider probe began returning `000000`
  instead of a status code and silently disabled itself, with no fallback key set to notice.
- Landed that drift fix, which is what the eleven issues were asking for. `test/_probe.test.js`
  was a copy of `checkout-hygiene.test.js` with `console.log` lines injected and was being counted
  as real coverage; `test/cp-run.mjs` was the same thing done to `c-polism.test.js`, saved under an
  extension the glob never ran. Both deleted. The count is now 658 everywhere, and guarded in two
  halves: `test/documented-counts.test.js` proves the documents agree with each other, and a step
  in `ci.yml` proves they agree with the suite as actually run. Only CI can do the second — a test
  cannot count the run it is part of.

## 2026-08-13

- Updated the residual risk text under entry #8 in `docs/COMPROMISES.md` to reflect that `runtime/ui/views.js` rendering (`releaseBlock`) and JSDoc were already updated to display signed/unsigned release status when #15 rr4 was closed. Added a documentation file path citation verification test in `test/audit-location-citations.test.js` continuously asserting that non-exit-path codebase file paths cited across `docs/COMPROMISES.md`, `docs/NEXT.md`, and `docs/AUDIT.md` exist on disk.
- Updated `docs/ARCHITECTURE.md` to align residual risk phrasing with v0.1 release key verification machinery and added automated test coverage for signed runtime release manifest verification and key pinning in `test/readme-claims.test.js`.
- Added unit tests in `test/c-polism.test.js` covering previously un-exercised refusal paths and authority checks in `runtime/polism/execute.js` and `runtime/polism/parse.js`, including invalid operation strings, entity-scope authority refusals, staged change validation failures, predicate depth limits (> 32), same-event create/delete and delete/change conflicts, self-targeting update refusals, create-on-demand key missing refusals, whole-document comparison diagnostics, missing reference `from` path copy/add refusals, and non-number/non-money counter refusals. Updated `docs/AUDIT.md` and `docs/NEXT.md`.
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
