# Development journal

**New entries go in `docs/journal/` as their own file** — `YYYY-MM-DD-short-slug.md`, one per
change. Not in this file. See below for why.

To read the log newest-first:

```bash
ls -r docs/journal/
```

This file is the archive of everything written before 2026-08-17, under the old convention. It is
not appended to any more and it is not generated from anything; nothing needs to keep it in sync.

## Why entries moved out of this file

Because `AGENTS.md` §9 told every session to "add an entry at the top under today's date", and
"at the top" means every session edited the same lines of the same file. Two sessions running in
parallel therefore conflicted by construction — not occasionally, always — and nothing in this
repository rebases, so a conflict is terminal.

Measured on 2026-08-17 across the previous six Jules pull requests: five of six touched both this
file and `docs/NEXT.md`. #28 and #29 both went `CONFLICTING` and sat unmergeable for two days. Then
it happened to the pull request that fixed it: #47 merged in one minute while #43 was open, and
because both touched these two files, #43 became conflicted — at which point GitHub stopped creating
`pull_request` workflow runs for it entirely, since it cannot compute a merge commit for a
conflicting pull request. A conflict does not merely block the merge; it makes the change
unreviewable.

Google Jules allows three concurrent sessions and fifteen a day. The quota was never the limit on
this project's throughput. This file was.

One file per entry means a session only ever creates a path no other session is writing, so parallel
work cannot collide here. `docs/NEXT.md` is now rewritten only by a session that actually changed the
plan, which most do not.

---

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
