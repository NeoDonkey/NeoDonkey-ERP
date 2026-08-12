# Stock adjustment

Any change to stock that no goods receipt and no shipment caused: a write-off because a batch passed
its best-before date, a correction after a count, a sample taken for the quality lab, breakage on the
dock.

Every adjustment needs a reason in words and, above a value threshold, a second pair of eyes. That is
not bureaucracy. Adjustments are the easiest way to make an inventory difference disappear, so an
auditor reads the adjustment list before almost anything else, and a company that cannot explain its
adjustments cannot explain its gross margin either.

Where the food went also matters. A pallet of dates to a food bank is a donation with its own tax
treatment; the same pallet to waste is not, and the sustainability reporting asks for the split.

## Fields
- adjustment-type: text required — write-off-expiry, write-off-damage, write-off-quality, count-correction, sample-withdrawal or donation.
- article: reference to article required — What.
- location: reference to location required — Where. Needed to find the stock document.
- batch: reference to batch — Which batch, where the article is batch managed.
- quantity: number required — Positive number; the direction is in the direction field.
- direction: text required — decrease or increase.
- value: money required — Quantity times valuation. What hits the P&L.
- currency: text required — EUR.
- reason-code: text required — Short code for the reporting.
- reason-note: text required — A code is never enough for an auditor.
- quality-inspection: reference to quality-inspection — Set for quality write-offs.
- created-by: reference to employee required — Who initiated it.
- approval-count: number required — Starts at zero. Raised once per approving commit.
- approved-by: reference to employee — Who signed it off.
- disposal-method: text — waste, animal-feed, biogas or food-bank. Required for expiry write-offs.
- status: one of draft, pending-approval, posted, rejected required — `pending-approval` is where value waits for a second pair of eyes.

## Identified by
article and location

## Created on demand
no

## Predicates
- justified: reason-code exists and reason-note exists
- decrease: direction is "decrease"
- expiry write off: adjustment-type is "write-off-expiry"
- quality write off: adjustment-type is "write-off-quality"
- count correction: adjustment-type is "count-correction"
- needs approval: value >= "500.00 EUR"
- small: value < "500.00 EUR"
- large: value > "5000.00 EUR"
- independently approved: approval-count >= 2
- approved: approved-by exists
- posted: status is "posted"
- disposal documented: disposal-method exists

## Authorized by
- create: warehouse-management or quality-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management or tax-accountant
- update: controller or managing-director
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): the
`- <operation>: <roles>` bullets govern every operation on this entity that no process rule covers. Without
them, an uncovered operation is open to an actor with no role at all — grammar version 1's permissive default,
and the defect Part 4's standing rule 4 was written about. Where a rule *does* cover the operation, the rule's
authority wins and these bullets are not consulted.

`delete` is the managing director everywhere, and it should almost never be used: a document that ten years of
other documents point at is retired by a status change, not removed. `read` is wide, because reading changes
nothing and an audit needs the lot.
### needs approval
Five hundred euros, and it is low on purpose. The literal is written in FD-1's canonical form
(`"500.00 EUR"`), so the comparison is exact BigInt minor units and an adjustment valued in another
currency is refused rather than converted. It used to read `value >= 500`, which compares the same against
500 EUR and 500 JPY — still valid grammar (§19.2) and still exact, but it names no currency, and grammar
version 2 warns about it for that reason. In a business where a pallet of nuts is worth four
figures, a threshold high enough to feel comfortable would be high enough to be useless. Above it the
controller signs as well as the warehouse manager — see
`processes/stock-write-off-approval.md`.

### independently approved
`approval-count >= 2`. Each approval is a separate commit with a separate signature, so two approvals
means two keys. That is a stronger claim than two rows in a permissions table, and it is checkable
years later by anybody holding the repository with no working system required.

It is worth being honest about what this is *not*. Grammar version 1 cannot express true four-eyes as
an authorisation constraint — `## Authorized by a and b` is refused, because a version-1 intent
carries a single actor. Counting approvals in a field is the closest expressible approximation, and
the distinctness of the two signers rests on the Truth Layer rather than on this document. The real
fix belongs in modules A and B: two signers on one commit.

### disposal documented
An obligation on expiry write-offs. Where the food went is a tax question and a reporting question,
and the answer is worth capturing at the moment somebody is standing next to the pallet.

## Retention

**10 years** under GoBD. Adjustments are bookkeeping entries and are never deleted; a wrong adjustment
is reversed by an opposite one with a reason.

## References

`processes/stock-write-off.md`, `processes/stock-write-off-approval.md`,
`processes/shelf-life-sweep.md`, `management-system/monthly-stock-review.md`
