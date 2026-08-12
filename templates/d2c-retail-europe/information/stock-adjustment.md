# Stock adjustment

Any change to stock that no goods receipt and no delivery note caused: a write-off because a
batch passed its best-before date, a correction after an inventory count, a sample taken for
the quality lab, breakage on the dock.

Every adjustment needs a reason and, above a value threshold, a second pair of eyes. This is
not bureaucracy. Stock adjustments are the easiest way to make an inventory difference
disappear, so an auditor reads the adjustment list before anything else, and a company that
cannot explain its adjustments cannot explain its gross margin either.

## Fields
- id: text required — ADJ-2026-000442.
- adjustment-type: text required — write-off-expiry, write-off-damage, write-off-quality, count-correction, sample-withdrawal, donation.
- article: reference to article required
- batch: reference to batch
- warehouse-location: reference to warehouse-location required
- quantity: number required — Positive number; the direction is in the type.
- direction: text required — decrease or increase.
- value-eur: number required — Quantity times valuation. What hits the P&L.
- reason-code: text required
- reason-note: text required — A code is never enough for an auditor.
- inventory-count: reference to inventory-count — Set for count corrections.
- quality-inspection: reference to quality-inspection — Set for quality write-offs.
- return: reference to return — Set for returned goods written off.
- created-by: reference to employee required
- approval-count: number required — Starts at 0.
- approved-by: reference to employee
- disposal-method: text — waste, animal-feed, biogas, food-bank. Required for expiry write-offs; food waste has its own reporting.
- status: text required — draft, pending-approval, posted, rejected.

- available-quantity: number — The quantity this adjustment removes from availability.
- blocked-reason: text — Copied onto the batch when the adjustment blocks the rest of it.

## Identified by
article and warehouse-location

## Created on demand
no

## Predicates
- justified: reason-code exists and reason-note exists
- expiry write off: adjustment-type is "write-off-expiry"
- needs approval: value-eur >= 500
- independently approved: approval-count >= 2
- approved: approved-by exists
- posted: status is "posted"
- disposal documented: disposal-method exists
- count correction: adjustment-type is "count-correction"

## References
- `article` → `article`, `batch` → `batch`
- `warehouse-location` → `warehouse-location`
- `inventory-count` → `inventory-count`
- `quality-inspection` → `quality-inspection`
- `return` → `return`
- `created-by`, `approved-by` → `employee`

## Retention
**10 years** under GoBD. Adjustments are bookkeeping entries and are never deleted; a wrong
adjustment is reversed by an opposite one with a reason.

## Notes
### needs approval
Five hundred euros. Below that a warehouse manager posts it; above that the controller signs
too. The number is here, in the open, and changing it is a visible change to the company.

### disposal documented
Where the food went matters. A pallet of dates that goes to a food bank is a donation with a
different tax treatment from a pallet that goes to waste, and the sustainability reporting
asks for the split.

### Used by

`processes/stock-write-off.md`, `processes/stock-write-off-approval.md`,
`processes/inventory-count.md`, `processes/returns-and-credit-notes.md`,
`management-system/monthly-stock-review.md`
