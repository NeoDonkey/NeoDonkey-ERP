# 2026-08-17 — Fix register #4a placement

Closed register entry #4a ("The Live Layer has no IndexedDB buffer") sat in Part 1 — Open
between lines 339 and 373, with its full body text, despite being listed as closed in the
summary table. Part 2 — Closed had no #4a section. A reader of Part 2 looking for what
closed #4a would not find it; a reader of Part 1 would skip past a closed entry among open
ones.

The fix follows the #15 rr4 pattern: the full section moved to Part 2 as a `##` heading
(matching every other closed entry), and a one-line "See Part 2 — Closed." pointer replaced
it in Part 1. No content changed.

A static register-structure guard test (`test/compromises-structure.test.js`) now asserts
both invariants: every entry the summary lists as closed has a `##` section in Part 2, and
no closed section with body text (not a pointer) exists in Part 1. Both tests fail on the
old file and pass after the fix.

Suite: 664 tests, 662 passing, 2 skipped, 0 failures.
