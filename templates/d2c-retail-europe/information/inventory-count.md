# Inventory count

Somebody walks to the shelf and counts. Everything else in this template is a record of
intent; this is the one place where the record meets the physical world, and where the two
disagree the physical world is right.

German commercial law requires a full physical inventory at least once a year
(*Inventur*, §240 HGB), and the count is the basis for the stock figure in the annual
accounts. Between annual counts we do rolling cycle counts on fast movers, because finding a
difference in March is worth more than finding it in December.

A count produces differences; differences produce `stock-adjustment` records. Keeping those
two things separate means the count stays a record of what was seen, and the correction stays
a bookkeeping act with an approver.

## Fields
- id: text required — INV-2026-Q3-BER-A.
- count-type: text required — annual-full, cycle-count, spot-check, recount.
- location: reference to location required
- warehouse-location: reference to warehouse-location — Empty for a full site count.
- article: reference to article — Empty for a full count.
- batch: reference to batch
- count-date: date required
- counted-by: reference to employee required
- verified-by: reference to employee — Required for the annual count.
- book-quantity: number required — What the system said before counting.
- counted-quantity: number required — What was actually there.
- difference-quantity: number required — Counted minus book.
- difference-value-eur: number required
- difference-status: text required — none, within-tolerance, above-tolerance. Derived; the tolerance itself is a number in the process file.
- recount-required: text required — yes or no.
- stock-adjustment: reference to stock-adjustment — Created when the difference is posted.
- explanation: text — Required when the difference is above tolerance.
- status: text required — planned, counted, recounted, explained, posted, cancelled.

- last-counted-date: date — Written onto the stock record when the count posts.

## Identified by
location and count-date

## Created on demand
no

## Predicates
- counted: status is "counted" and counted-quantity >= 0
- no difference: difference-status is "none"
- within tolerance: difference-status is "within-tolerance"
- above tolerance: difference-status is "above-tolerance"
- needs recount: recount-required is "yes"
- explained: explanation exists
- annual count: count-type is "annual-full"
- independently verified: verified-by exists
- posted: status is "posted" and stock-adjustment exists

## References
- `location` → `location`, `warehouse-location` → `warehouse-location`
- `article` → `article`, `batch` → `batch`
- `counted-by`, `verified-by` → `employee`
- `stock-adjustment` → `stock-adjustment`

## Retention
**10 years** under GoBD and §257 HGB. The annual count documentation is retained with the
annual accounts and is one of the first things an auditor asks for.

## Notes
### needs recount
A large difference is counted again before anybody books it. Most large differences are
counting mistakes, and booking a counting mistake turns a five-minute walk into a permanent
error in the accounts.

### independently verified
The annual count is verified by a second person because it feeds the balance sheet. Cycle
counts are not — insisting on it would mean they stop happening, and a cycle count that
happens is worth more than a verified one that does not.

### Used by

`processes/inventory-count.md`, `processes/stock-write-off.md`,
`management-system/monthly-stock-review.md`, `management-system/month-end-close.md`
