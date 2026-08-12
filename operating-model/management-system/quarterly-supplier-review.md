# Quarterly supplier review

Four times a year, the managing director and the purchasing manager go through the suppliers that matter, one
by one, with the quality manager present. Each supplier gets a minute with that quarter's numbers and a
decision: keep, develop, or replace.

The reason it is worth an afternoon is that supplier problems are slow. A certification quietly lapses. On-time
delivery drifts from 96 % to 88 % over three quarters, and each individual late delivery had a reason. Complaint
counts creep. None of it triggers an alarm, and all of it shows up eventually as either a stock-out or a
recall.

The discipline that makes this meeting real is that the numbers are maintained continuously — on the supplier
document, from actual goods receipts and actual complaints — rather than assembled the night before. A review
whose figures were prepared for the review measures the preparation.

## Cadence

Quarterly, in the month after quarter end. Chaired by the managing director, with the purchasing manager and
the quality manager. Half a day for the suppliers above a spend threshold, by exception for the rest.

## Measures

Per supplier, for the quarter and rolling twelve months:

- `on-time-delivery-percent`, from goods receipt dates against requested delivery dates.
- `complaint-count-12m`, and how many of those were food-safety rather than logistics.
- Certification status and expiry — `certification-valid`, and the date it runs out.
- Price development against the agreed prices on the order lines.
- Quality inspection outcomes: releases, restricted releases, blocks.
- Over- and short-deliveries, from `over delivered` on the order lines.

## Owner

`managing-director`, with `purchasing-manager` preparing and `quality-manager` contributing the quality view.

## Notes

### The rating is a decision, and it is recorded
`supplier-rating` on the minute takes one of three values — keep, develop, replace — and it is required to be
stated. "We discussed it" is not a rating. A supplier rated `develop` for three quarters running is being
tolerated rather than developed, and `has open actions` on the minute is the number that shows it.

### Certification is the one that bites
Our own IFS and organic status depend on our suppliers'. A lapsed certificate makes a supplier `on-hold`, which
stops new orders and lets existing ones run — the distinction is in `information/supplier.md` and it is
deliberate. `blocked` is for a decision; `on-hold` is for an expiry date and a phone call.

### Why this file has no rules
The rules that apply to every review minute live once, in `management-system/monthly-stock-review.md`. Grammar
version 1 conjoins all rules on the same trigger, so a rule requiring `supplier rated` here would demand a
supplier rating on the stock review's minutes too. The obligation is therefore documented rather than enforced,
and that is stated rather than glossed.

## References

`information/supplier.md`, `information/review-minute.md`, `suppliers/supplier-cashew-nuts.md`,
`suppliers/carrier-parcel.md`, `processes/purchase-ordering.md`
