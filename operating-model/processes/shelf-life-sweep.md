# Shelf-life sweep

Every morning, something has to look at every batch in the building and ask how long it has left. That is
the sweep. It sets two derived facts on the batch — the remaining shelf life in days and a status of
`fresh`, `near-expiry` or `expired` — and everything else in the company reads those rather than doing
date arithmetic of its own.

It exists for a practical reason and an architectural one. Practically: a batch that quietly passes its
best-before date while sitting in a picking bin will eventually be shipped to a customer, and that is a
food safety incident and a very bad review. Architecturally: the rule language has no notion of "today",
deliberately. A rule that compared a stored date against the current clock would give a different answer
every time it ran, and a deterministic runtime cannot allow that — the whole audit trail rests on the same
inputs producing the same commit.

So the current date enters this operating model in exactly one place, as an explicit act by a named role,
and leaves a signed record behind. That is a real cost and this file is where it is paid.

## Triggered by
The daily sweep, run once per warehouse each morning before picking starts. Also run immediately after a
goods receipt, so a short-dated delivery is flagged the moment it lands.

## Rules

If Update batch under condition
  batch traceable and
  quantity >= 0
then
  Update batch with shelf-life-status and
  Update batch with remaining-shelf-life-days

If Update batch under condition
  article batch managed and
  best-before-date exists
then
  Update batch with quality-status

## Notes

### The rules only record what a person computed
Both consequents are obligations: whatever updates a batch must state its shelf-life status, its
remaining days, and its quality status. The rules do not calculate the status — they refuse an update
that fails to state it. That is the correct division: arithmetic against the clock happens in the sweep,
which is an act with a date and a signature; the model insists the result is recorded.

### What we would rather write
```
If Update batch under condition
  best-before-date < today
then
  Update batch with shelf-life-status "expired"
```

Three things stand in the way in grammar version 1: there is no `today` symbol, there is no date
arithmetic, and there is no branch — so a rule cannot choose between `expired`, `near-expiry` and `fresh`.
The exit path for the first two is in `runtime/polism/grammar.md` §10 limit 8, and it must take an
*injected* clock so determinism survives. The third is the branch that this whole folder keeps asking for.

### The article's minimum shelf life
`fresh` versus `near-expiry` is measured against the article's `minimum-remaining-shelf-life-days` — what
a retailer will accept on arrival. Comparing the batch's remaining days against a field of the *article*
is a two-hop path (`article.minimum-remaining-shelf-life-days` reached from the batch), and version 1
allows one hop only. So the comparison lives in the sweep and the classification lands here. Named, not
hidden.

## Authorized by
warehouse-management or logistics-coordinator
