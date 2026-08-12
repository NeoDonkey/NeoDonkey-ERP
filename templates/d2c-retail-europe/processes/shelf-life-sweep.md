# Shelf-life sweep

Every morning, something has to look at every batch in the building and ask how long it has
left. That is the sweep. It sets two derived fields on the batch — the remaining shelf life in
days and a status of `fresh`, `near-expiry` or `expired` — and everything else in the company
reads those instead of doing date arithmetic of its own.

It exists for a practical reason and an architectural one. Practically: a batch that quietly
passes its best-before date while sitting in a picking bin will eventually be shipped to a
customer, and that is a food safety incident and a very bad review. Architecturally: the rule
language has no notion of "today", deliberately — a rule that compared a stored date against
the current clock would give a different answer every time it ran, and a deterministic runtime
cannot allow that. So the current date enters the system in exactly one place, as an explicit
act by a named role, and leaves a signed record behind.

That is a real constraint and this file is where it is paid for. The alternative — letting
every rule reach for the clock — would be more convenient and would quietly destroy the
property that makes the whole audit trail worth having.

## Triggered by
The daily sweep, run once per warehouse each morning before picking starts. Also run
immediately after any goods receipt, so a short-dated delivery is flagged the moment it lands.

## Rules
If Update batch under condition
  shelf-life-status is "expired"
then
  Update batch with quality-status "blocked" and
  Create stock-adjustment with adjustment-type "write-off-expiry"

If Update batch under condition
  shelf-life-status is "near-expiry" and
  quality-status is "released"
then
  Create discount with discount-type "clearance" with discount-percent 20

If Update batch under condition
  batch expired
then
  Update batch with quality-status "blocked" and
  Update batch with blocked-reason "best-before date passed"

## Notes

The sweep does not move the stock itself. It blocks the batch and creates the adjustment, and
`processes/stock-write-off.md` — a different file with a different authorisation — is what
actually reduces the balance. Splitting detection from posting is what keeps a nightly job from
being able to write value off the balance sheet on its own.

Short-dated stock is worth more sold cheaply than written off. Creating the clearance
discount automatically is deliberate: left to a weekly meeting, near-expiry stock becomes
expired stock, and the write-off is always larger than the discount would have been.

<!-- NEEDS-GRAMMAR: the condition this process actually needs is
     `best-before-date < today` and `remaining-shelf-life-days < article
     minimum-remaining-shelf-life-days`. Neither is expressible: the grammar has no
     current-date symbol, no date subtraction, and no comparison against a field of a
     referenced entity. v0.2 proposals, in priority order:
       1. a `today` symbol usable on the right-hand side of a comparison against a date
          field, supplied by the injected clock so determinism is preserved per evaluation;
       2. `<date-field> in less than <n> days` as a readable derived comparison;
       3. `<reference> <field>` on the right-hand side of a comparison, e.g.
          `remaining-shelf-life-days < article minimum-remaining-shelf-life-days`.
     Until then this sweep computes the two derived fields outside the rule grammar and the
     rules read the results. This is the largest honest gap in the model and it is confined
     to exactly one process file on purpose. -->

## Authorized by
warehouse-management or logistics-coordinator
