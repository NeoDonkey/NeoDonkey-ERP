# Monthly stock review

Once a month, the controller and warehouse management sit down with the stock numbers and decide what to do
about them. It takes an hour and it is the difference between knowing your gross margin and guessing it.

Three questions, every time. **Is the stock real?** Negative balances, uncounted articles, the gap between
the partner warehouse's report and ours. **Is it going to be sold?** Near-expiry batches, slow movers,
articles whose remaining shelf life has fallen below what a retailer will accept. **What did we lose?** The
write-off list, by reason, with the expiry write-offs separated from the damage.

The output is a minute. A review that produces no minute did not happen — and the rule below says so, by
refusing a minute that has no figures, no findings and no decisions.

## Cadence

Monthly, in the first week after the previous month is closed. Chaired by the controller, with warehouse
management and the quality manager present. One hour.

## Measures

- Stock value at moving average cost, by location and by category.
- Count of stock documents with a negative balance — should be zero, is occasionally not.
- Value of batches in `near-expiry`, and of batches that reached `expired` since the last review.
- Write-offs in the period, split by `adjustment-type` and by `disposal-method`.
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

### Why the rules live in this file and not in all three
All three review files in this folder would trigger on `Create review-minute`, and grammar version 1 makes
every rule on the same trigger a hard requirement — so three files of rules would conjoin into one
contract, and any condition specific to one review would block the other two. The rules therefore live
here, once, and they enforce what is true of *every* minute: figures, findings, decisions, a date, a chair,
and participants.

`management-system/weekly-margin-review.md` and `management-system/quarterly-supplier-review.md` carry no
rules for that reason. It is a limitation, not a hierarchy.

### Nothing here fires on a schedule
Grammar version 1 has no scheduled trigger. `## Cadence` above is prose; no rule fires on the first of the
month. The rhythm is held by people with a calendar, and the model's contribution is to refuse an
incomplete record of what they decided. That is a genuine gap
(`runtime/polism/grammar.md` §10 limit 10) and the exit path is a management-system trigger form on an
injected clock.

### Closing fully delivered orders
This is where an order that has received its last pallet is closed. `processes/goods-receipt.md` cannot do
it — closing needs a branch on `fully delivered`, and there are none — so it happens here, deliberately and
visibly, rather than being assumed to happen by itself.

## Authorized by
controller or managing-director
