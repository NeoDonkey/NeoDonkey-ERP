# 2026-08-22 — Pin the signed rule-provenance claim in the suite

Verification run, gate condition 10 ("Every claim audited" — partial; manifesto and README
claims against implementation behaviour). No issue was unclaimed in this lane: every `ready`
issue is runtime feature work (#118–#127), #138 is an area:runtime bug, #90 is blocked
machinery diagnostics, #59 is a generated report that forbids being taken.

## What was checked

- **README comparison table, "XRechnung XML — native generator"** — true.
  `runtime/export/xrechnung.js` (`buildXRechnung`) and `runtime/export/xrechnung-parser.js`
  are on main with round-trip coverage in `test/xrechnung.test.js`. PR #104 (the parked
  generator PR) turned out to be a red herring: it was closed unmerged, but the capability
  landed via other commits (`4c3f34d`, `a845fdf`).
- **Manifesto/Appendix XII, "unknown rule constructions are explicitly refused"** — covered,
  `test/c-polism.test.js` §444 onward.
- **docs/GATE.md condition 6** — its "Evidence: None / invoice generator/parser missing" text
  is stale on main: DATEV EXTF and both XRechnung directions exist and are tested, and the
  cross-peer same-commit property is pinned at `test/a-git.test.js:681`. Not fixed here:
  open PRs #130 and #120 both already rewrite `test/gate-score.test.js` + `docs/GATE.md`,
  and #130's version carries the correct evidence for condition 6. Editing the file now would
  manufacture a three-way conflict in a repository where nothing rebases. Recorded here so the
  next editor of the scorecard does not rederive it.

## What was done

The one claim nothing in `npm test` covered: README's "When a posting is made, the commit
records the rule that authorized it — inside the signed payload." The demo asserts it via real
git, but the demo is a separate CI job; g-ui.test.js only parses a hand-built message string,
and c-polism.test.js only greps kernel source for a trailer template. Deleting the two lines
that push `NeoDonkey-Rule:` in `buildMessage()` left the whole suite green.

New test `test/readme-rule-trailer.test.js`: kernel.open on a minimal written model, one real
perform, then the commit read back from the object store — trailer cites an existing model file
and the exact If-sentence, Actor-Roles records the held roles, SSHSIG verification passes over
exactly those payload bytes, and a flipped byte fails verification (control). Mutation check:
with the trailer push commented out the test goes red, restored it goes green; kernel.js itself
is untouched by this change.

## Left undone

- Gate condition 6's scorecard staleness fixes itself when #130 or #120 lands; if both are
  abandoned, re-derive from the findings above rather than from GATE.md.
- Suite floor unchanged: the suite grew by one test (754 total), well above the 660 floor.
