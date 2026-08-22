# 2026-08-22 — README's manifesto counts pinned to the document

Lane: A (docs/tests/chores). No open issue — the `ready` queue held only `runtime/` work
(#127, #138 unclaimed but out of scope; #118/#119, #123, #124 claimed by PRs #130, #142,
#135), so the session fell through to verification, which serves gate condition 10.

## What was checked

Gate condition 10 is the partial one: "README headline claims verified by test" is done,
the line-by-line audit of remaining claims is not. Scanning the README for claims that are
countable against files in the same tree and not yet asserted anywhere:

- "no `dependencies` field in package.json" — already pinned (`test/g-ui.test.js`).
- launcher scripts named by index.html exist — already pinned (`test/site-citations.test.js`).
- DATEV prose gated on real exporter capability — already pinned
  (`test/readme-datev-claim.test.js`, consistent with #100 having landed booking lines).
- licence claim — pinned (`test/license-claim.test.js`).

One claim had nothing behind it: the Documentation table describes the constitution as
"**Eleven principles, twelve appendices.**" Verified true today (11 numbered bold paragraphs
under "The Eleven Principles"; Appendices I–XII), but a twelfth principle or thirteenth
appendix could land with nobody re-reading that sentence — the exact silent-drift failure
mode gate condition 10 exists for, and the same class as the suite-total drift that #55/#64
removed from prose.

## What was done

New `test/readme-manifesto-claim.test.js`: derives both counts from
`neodonkey-manifesto.md` (section-scoped regexes, word-number parsing so "Eleven"/"twelve"
or digits both work) and asserts they equal what the README states. If the README sentence
is reworded away entirely, the first test fails with an update-this-test message, following
the `site-citations` convention.

Efficacy proven by mutation, since a guard added to a true tree passes before and after its
own addition:

- README changed to "Twelve principles…" → fails, names both sides.
- `**12. …**` paragraph inserted in the principles section → fails, names both sides.
- The same paragraph appended after the closing section → correctly *not* counted (it is
  not a principle), test stays green.
- Untouched tree → green; mutations reverted byte-identical.

## Not done / notes

- Baseline suite showed one transient failure on the first run of the day and passed clean
  on rerun (758 tests, 2 skipped) — the known-flake class CI already retries once; not filed.
- The manifesto's own self-description ("The Eleven Principles" heading) is deliberately not
  cross-checked here; if it drifts from the body count while the README matches the body,
  that inconsistency is real but this guard stays quiet. One claim per change.
- Gate movement: condition 10, one more README claim continuously asserted.
