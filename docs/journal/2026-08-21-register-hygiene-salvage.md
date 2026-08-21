# 2026-08-21 — Register hygiene salvage (#34, salvaging #88)

## What

Ported the register-hygiene tests from the stalled, conflicted #88 onto current main, fixed the
register inconsistency they correctly caught (#24 sat in Part 2 with no CLOSED marker and no
place in the summary closed list), and removed the vestigial #4a pointer stub in Part 1 that
duplicated the real Part 2 entry.

Files: `test/compromises-structure.test.js` (four hygiene tests from #34/#88, plus one new),
`docs/COMPROMISES.md` (#24 moved back to Part 1, counts and blocker set corrected, #4a stub
removed). `test/known-flaky.txt` is deliberately untouched.

## Why

Main had absorbed #24's text into Part 2 (the closed part) without a CLOSED marker and without
listing it in the summary's closed row, so the summary pointed at nothing and Part 2 held an
entry nobody counted. #88 added tests for exactly this class of drift but conflicted with main
and stalled; it also shipped a defect of its own — the summary closed cell said 11 while the
row listed 12 IDs. The ported tests therefore add a fifth assertion #88 lacked: the closed
row's count cell must equal the number of IDs it lists. Verified: the new tests fail against
the un-fixed register (test 6, "#24 in Part 2 but not in the closed list"), fail against #88's
own register version (test 5, cell 11 vs 12 listed), and pass against the fixed register.

## The #24 decision: STAYS OPEN, moved to Part 1 as "our shortfall" and into the blocker set

The register's job is not kidding itself, and the evidence did not support the strong close:

1. **The quarantine is still active.** `test/known-flaky.txt` still names both patterns
   ("README Claim 4", "two processes converge through the relay"). #24's exit path requires
   those lines to come OUT of the file; they have not.
2. **#46 is closed, but not by the fix #24 specifies.** What closed #46 was atomic writes in
   `runtime/git/fs-node.js` (write to temp name, then rename) — confirmed present in the code —
   which eliminated the 0-byte pack-index face and cut the flake rate from ~1 in 8 to ~1 in 20.
   That is Cause A of two. Cause B — the relay holds nothing and the sync layer above has no
   catch-up on reconnect, so a rejoining peer waits out its watchdog for ops dropped during its
   absence — is unfixed: no reconnect or catch-up path exists anywhere in `runtime/sync/`
   (read: `gitsync.js`, `signalling.js`, `sealed.js`, `webrtc.js`, `opbuffer.js`,
   `introduce.js`).
3. **#46's own closing discussion agrees.** Its final measured comment: the remaining face is a
   peer timeout, the fix is catch-up on reconnect in `runtime/sync/`, and "compromise #24 closes
   only when the timeout face is gone too". The issue was closed by automation anyway. A closed
   issue whose exit condition is unmet is exactly what this register exists to catch.

So the entry says it plainly: the atomic-writes fix reduced the flake's frequency without
implementing the specified exit path; the quarantine remains; the hole is smaller, not closed.
The blocker-set row now carries #24 with a cost of days (catch-up on reconnect, then 20
consecutive green full-suite runs per #46's verification bar), alongside #15 rr7's hours.

One loose end recorded in the entry: `test/known-flaky.txt` cites #46, which is now closed —
a fresh issue for Cause B is owed the next time the timeout face fires.

## Verification

- `node --test test/compromises-structure.test.js`: 7/7 pass on the fixed register; fails on
  pristine main (1 failure, the #24 placement) and on #88's register (1 failure, the count
  cell) — both directions demonstrated before publishing.
- Full suite `node --test "test/*.test.js"`: green apart from the two known env-gated skips.

Credit: the four hygiene tests are #88's work (issue #34), ported; the fifth and the #24
resolution are this session's.
