# Quarterly supplier review

Four times a year the managing director and the purchasing manager go through the suppliers that matter,
one by one, with the quality manager present. Each supplier gets a minute with that quarter's numbers and
a decision: keep, develop, or replace.

It is worth an afternoon because supplier problems are slow. A certification quietly lapses. On-time
delivery drifts from 96 % to 88 % over three quarters, and each individual late delivery had a reason.
Complaint counts creep. None of it triggers an alarm, and all of it eventually shows up as either a
stock-out or a recall.

What makes the meeting real is that the numbers are maintained continuously — on the supplier record, from
actual goods receipts and actual complaints — rather than assembled the night before. A review whose
figures were prepared for the review measures the preparation.

## Cadence

Quarterly, in the month after quarter end. Chaired by the managing director, with the purchasing manager
and the quality manager. Half a day for suppliers above a spend threshold, by exception for the rest.

## Measures

Per supplier, for the quarter and rolling twelve months:

- `on-time-delivery-percent`, from goods receipt dates against requested delivery dates.
- `complaint-count-12m`, and how many were food-safety rather than logistics.
- Certification status and expiry — `certification-valid`, and the date it runs out.
- Price development against the agreed prices on the order lines.
- Quality inspection outcomes: releases, restricted releases, blocks.
- Over- and short-deliveries, from `over delivered` on the order lines.
- Three-way-match variances on their invoices.

## Owner

`managing-director`, with `purchasing-manager` preparing and `quality-manager` contributing the quality
view.

## Notes

### The rating is a decision, and it is recorded
`supplier-rating` on the minute takes one of three values — keep, develop, replace — and stating it is
required. "We discussed it" is not a rating. A supplier rated `develop` for three quarters running is being
tolerated rather than developed, and `has open actions` on the minute is the number that shows it.

### Certification is the one that bites
Our own IFS and organic status depend on our suppliers'. A lapsed certificate makes a supplier `on-hold`,
which stops new orders and lets existing ones run. `blocked` is for a decision; `on-hold` is for an expiry
date and a phone call. The distinction is in `information/supplier.md` and it is deliberate.

### Carriers count too
`suppliers/carrier-parcel.md` and `suppliers/carrier-pallet-freight.md` are reviewed here as well, on
delivery performance and on whether the proof of transport actually arrives. The second one is a tax
exposure, not a service level.

### No rules here
See `management-system/monthly-stock-review.md` — grammar version 1 conjoins all rules on the same trigger,
so a rule requiring `supplier rated` here would demand a supplier rating on the stock review's minutes too.

## References

`information/supplier.md`, `information/review-minute.md`, `suppliers/supplier-cashew-nuts.md`,
`suppliers/supplier-dried-fruit.md`, `processes/supplier-onboarding.md`
