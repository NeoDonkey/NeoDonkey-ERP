# Weekly margin review

Half an hour, every Monday, on one question: are we still making money on the things we sell.

It is weekly rather than monthly because in a consumer business the answer moves that fast. A supplier price
increase, a freight surcharge, a campaign that converted better than expected at a discount nobody modelled
— any of those can turn a healthy article into a loss-making one inside a fortnight, and none of them
announce themselves.

The uncomfortable part of this meeting is always the same: the discounts. Every one of them was granted for
a good reason by somebody trying to help a customer or win a listing. Added up, they are the difference
between a good year and a flat one. That is why `expected-margin-impact` is an obligation on every discount
in `processes/discount-posting.md` — so this meeting compares an estimate against an outcome rather than
discovering both at once.

## Cadence

Weekly, Monday morning. Chaired by the controller, with the category managers. Thirty minutes.

## Measures

- Contribution margin by article and by category, against the previous four weeks.
- Articles selling below their cost — a short list that should usually be empty.
- Discounts active in the period: expected margin impact against actual.
- Clearance volume: what near-expiry stock was sold at a discount, against what was written off. The
  second number is always worse than the first, and the gap is the cost of noticing late.
- Returns and credit notes in the period, by reason code.
- Retail conditions coming up for renewal.

## Owner

`controller`, with `category-manager` accountable for the numbers in their own categories.

## Notes

### Why this file has no rules
Every review in this folder would trigger on `Create review-minute`, and grammar version 1 conjoins all
rules on the same trigger — so rules specific to this review would block the other two. The rules that
apply to every minute live once, in `management-system/monthly-stock-review.md`. This file is prose and
measures, which is the honest shape for it.

### The number that matters most
Clearance sold versus expiry written off. A food business does not lose margin dramatically; it loses it in
pallets that sat two weeks too long. The `near-expiry` status in `information/batch.md` and the clearance
discount type exist entirely to move that ratio, and this meeting is where anybody finds out whether they
did.

### What this meeting may not do
Overrule a quality decision, or release a blocked batch to save the margin on it. That authority sits with
the quality manager and nowhere else — see `organisation/quality-manager.md`. It is worth writing down in
the margin review file specifically, because this is the meeting where the pressure to do it appears.

## References

`information/discount.md`, `information/invoice.md`, `information/credit-note.md`,
`processes/discount-posting.md`
