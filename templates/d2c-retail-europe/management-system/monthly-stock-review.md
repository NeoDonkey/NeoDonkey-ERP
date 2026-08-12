# Monthly stock review

Once a month the controller and warehouse management sit down with the stock numbers and decide what to do
about them. It takes an hour and it is the difference between knowing your gross margin and guessing it.

Three questions, every time. **Is the stock real?** Negative balances, uncounted articles, the gap between
the fulfilment partners' reports and ours. **Is it going to be sold?** Near-expiry batches, slow movers,
articles whose remaining shelf life has fallen below what a retailer will accept. **What did we lose?**
The write-off list, by reason, with expiry separated from damage.

The output is a minute. A review that produces no minute did not happen — and the rules below say so, by
refusing a minute with no figures, no findings and no decisions.

## Cadence

Monthly, in the first week after the previous month is closed. Chaired by the controller, with warehouse
management and the quality manager. One hour.

## Measures

- Stock value at moving average cost, by location and by category.
- Count of stock records with a negative balance — should be zero, occasionally is not.
- Value of batches in `near-expiry`, and of batches that reached `expired` since the last review.
- Write-offs in the period, split by `adjustment-type` and by `disposal-method`.
- Inventory count differences above tolerance, and how many are still unexplained.
- Orders still `partially-delivered` past their requested delivery date.
- Partner stock reconciliation difference, in units and in value.

## Rules

If Create review-minute under condition
  review-minute complete and
  held-date exists and
  chaired-by-role exists
then
  Update review-minute with status "agreed"

If Create review-minute under condition
  open-actions-carried-forward >= 0 and
  participants-roles exists
then
  Update review-minute with key-figures and
  Update review-minute with decisions

## Notes

### Why the rules live here and not in all six review files
All six files in this folder would trigger on `Create review-minute`, and grammar version 1 makes every
rule on the same operation a hard requirement — so six files of rules would conjoin into one contract, and
any condition specific to one review would block the other five. The rules therefore live here, once, and
they enforce what is true of *every* minute.

The other five review files carry no `## Rules` for that reason. It is a limitation of the language, not a
hierarchy of importance.

### Nothing here fires on a schedule
`## Cadence` above is prose. No rule fires on the first of the month; grammar version 1 has no scheduled
trigger (`runtime/polism/grammar.md` §10 limit 10). The rhythm is held by people with a calendar, and the
model's contribution is to refuse an incomplete record of what they decided.

### Closing fully delivered orders
This is where an order that received its last pallet gets closed. The goods receipt process cannot do it —
closing needs a conditional consequent and there are none — so it happens here, deliberately and visibly.

## Authorized by
controller or managing-director
