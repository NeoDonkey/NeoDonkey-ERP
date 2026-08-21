# Journal: DATEV EXTF selectPostings uses a kernel-supported query operator

**Date:** 2026-08-21

## Summary
Fixed issue #134: `runtime/export/datev-extf.js` queried each journal entry's postings with
`{ op: 'is', value: [entry.id] }`. The kernel's query language (`runtime/read/query.js`,
`OPERATORS`) implements `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not in`, `between`, `contains`,
`starts with` and `exists` — and refuses anything else with `QueryError`, loudly and by design
(Principle 6: never silently guess). So the EXTF export threw `QueryError: unknown operator "is"`
on the first posted entry in any real workspace. The fix is one word: `in` with a one-element
array, the supported way to match a reference field against a set of ids.

## Why the suite did not catch it
`test/datev-export.test.js` drove `buildDatevExtf` with a *mock* kernel whose hand-rolled `select`
implemented the very operator the real kernel does not have. The serializer's tests passed while
the shipped code could not survive contact with the real read index. Both halves were the defect:
the wrong operator, and a test that could not see it.

## Verification
- New `test/datev-extf-select.test.js` seeds a real workspace through `runtime/kernel.js`
  `open()` (operating model as genesis seed, signed commits, real rule engine), walks the whole
  chain — location, employee, SKR03 chart with three accounts, VAT treatment, customer, shipped
  sales order, issued invoice, open period — and posts the invoice through
  `processes/journal-posting.md`, which creates the receivable/revenue/output-VAT legs whose
  balance `information/journal-entry.md`'s invariants check. It then runs `buildDatevExtf` and
  asserts the header row plus one booking line per posting, ordered by position, with the
  accounts (1400/8400/1776) and amounts (11900/10000/1900 minor units) the rules determined.
  A second test checks the date-range filter against the same real workspace.
- The new tests **fail on the unfixed code** with `QueryError: unknown operator "is"` (verified
  by temporarily reverting the fix) and pass with it.
- The mock kernel in `test/datev-export.test.js` now mirrors the real operator set (`in` instead
  of `is`), so it cannot hide this class of defect again.
- Full suite: `node --test --test-concurrency=2 "test/*.test.js"` — 744 tests, 742 pass, 0 fail,
  2 skipped (env-gated), up from 742/740 at baseline.

## What was not done
- `selectEntries`' `exists` operator was already supported and is unchanged.
- No new operator was added to the query language; `in` covers the need, and extending the
  language would be a far larger decision than this fix.
- `test/gate-score.test.js` cites none of the touched files as gate evidence, so no gate
  consistency check was needed; no gate conditions were touched.
- `docs/NEXT.md` and `docs/COMPROMISES.md` are unchanged: this closes a filed defect, not a
  planned item, and it retires no registered compromise (if anything it is a small down payment
  on the "tests mock what the kernel refuses" pattern, which no entry currently names).
