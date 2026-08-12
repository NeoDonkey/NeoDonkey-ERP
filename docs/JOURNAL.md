# Development journal

Newest first. One entry per change, dated `YYYY-MM-DD`. A few lines each — what changed and why,
not a restatement of the diff. `docs/NEXT.md` holds what happens next; this file holds what
happened.

---

## 2026-08-12

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
