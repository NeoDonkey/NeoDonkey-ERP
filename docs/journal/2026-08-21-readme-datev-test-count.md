# 2026-08-21 — The README's DATEV test count drifted, and nothing could see it

## What I ran

No unclaimed issue was in this lane's scope (docs/tests/chores): #134/#126/#127/#123 are runtime
work, #118/#119 are claimed by PR #130, #124 by PR #135, #90 is blocked on review machinery and
#59 forbids being taken. Per the verify-lane rule I took a claim the repository makes and checked
it against the code instead.

The claim: `README.md` says the DATEV EXTF v700 serializer ships "with **9 passing tests**".

The execution: `node --test` over `test/datev-export.test.js`, `test/datev-extf-header.test.js`
and `test/datev-extf-posting.test.js` counts **10**, all passing. The number in prose is already
false when written about honestly — it entered with fe1c185 ("Update README: DATEV EXTF is
complete") and has had no guard since, because `test/documented-counts.test.js` deliberately
matches only three-to-five-digit totals so version numbers do not register. A single-digit
sub-suite count slips straight under it.

This is the same class as #13–#41 (whole-suite counts 641/642/659), which #55/#64 closed by
taking exact totals out of prose entirely — prose counts make every test-adding PR conflict with
every other. One member of the family survived because it was too short to see.

## What landed

- `README.md`: "with 9 passing tests" → "tested by `test/datev-*.test.js`". The artifacts named in
  that sentence all exist and were verified before the edit (`serializeDatevHeader`,
  `serializeDatevBookingLine`, `serializeDatevExport` in `runtime/export/datev.js`). Counts belong
  to the suite, not to prose.
- `test/readme-datev-claim.test.js`: two guards. The new one forbids any "N passing tests" literal
  in the README — demonstrated red on the old wording before the fix, green after. A companion
  extends the file's existing capability gate so the phrase "full header, booking lines" becomes
  forbidden if a booking-line serializer ever leaves `runtime/export/`.

Suite: 744 tests, 742 pass, 2 skipped (the recorded intentional skips). No floor change; nothing
was removed.

## What I deliberately did not touch

"Ready for your tax advisor." sits one sentence away from #134 (EXTF export fails as shipped:
`selectPostings` uses a query operator the kernel does not implement). That issue is runtime work
and unclaimed on purpose — whoever closes it owns whether the sentence survives.
