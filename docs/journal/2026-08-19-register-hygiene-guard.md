# Register hygiene: close the consistency gaps

Issue #34 described register inconsistencies that were never pushed. The existing
`test/compromises-structure.test.js` checked structural placement (pointers vs full sections)
but not count consistency or entry coverage. This change closes the gaps.

## What changed

**`docs/COMPROMISES.md`:**
- Removed the `#4a` stub from Part 1 (lines that said "CLOSED, see Part 2"). The entry was
  already fully in Part 2; the stub was vestigial.
- Moved `#24` (the known-flaky quarantine) from Part 2 back to Part 1. It is an active
  compromise with an exit path (#46), not a closed entry. Its category is "our shortfall" and
  it now appears in the release blocker set.
- Updated the summary headline from "23 open, 12 closed" to "24 open, 12 closed".
- Added #24 to the "our shortfall" category and the blocker set table.

**`test/compromises-structure.test.js`:**
- Added four register-hygiene tests: headline count matches table sum, headline closed count
  matches the list length, every Part 2 entry appears in the summary closed list, and no
  entry appears in both parts as a real section.
- The "every Part 2 entry in summary" test is what would have caught #24's misplacement
  before it landed.

## Verification

`npm test` — 679 tests, 677 pass, 2 skipped, 0 failures. The four new tests pass against the
corrected register and would fail against the old one (confirmed before the fix).
