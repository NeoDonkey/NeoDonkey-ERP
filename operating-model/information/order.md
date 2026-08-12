# Order

An order is what we send to a supplier: please deliver these articles, this quantity, to this
location, by this date, at this price. In this operating model "order" always means a purchase
order. What a customer places is a `sales-order`, and keeping the two words apart saves an
enormous amount of confusion.

The order is the document a goods receipt is checked against, and that check is the whole point: a
delivery without an order is either a gift or a mistake, and neither should silently increase
stock. The order also carries the commercial agreement, which is what an incoming supplier invoice
is verified against.

The important pair of numbers is `ordered-quantity` and `delivered-quantity`. The second is raised
by every goods receipt, and when it reaches the first the order is fully delivered. That is a
comparison you can read on the document rather than a walk over all the lines — which matters,
because the rule language has no aggregation and an accountant would maintain a running total
anyway.

## Fields
- supplier: reference to supplier required — Who we buy from.
- delivery-location: reference to location required — Where the goods must arrive.
- order-date: date required — When we placed it.
- requested-delivery-date: date required — When we need it.
- currency: text required — EUR throughout.
- net-amount: money required — Agreed total net value.
- ordered-quantity: number required — Total ordered, in selling units.
- delivered-quantity: number required — Total received. Raised by each goods receipt.
- status: one of draft, confirmed, partially-delivered, delivered, cancelled required — The purchase-to-receipt chain reads this; goods-receipt requires `confirmed`.
- incoterms: text — DAP, FCA or EXW. Who carries freight and risk.
- vat-treatment: reference to vat-treatment required — Domestic, EU acquisition or import.
- supplier-confirmation-reference: text — Their order confirmation number.
- requires-certificate-of-analysis: boolean required — Whether we insisted on one.
- is-import: boolean required — True when the goods come from outside the EU.
- approved-by: reference to employee — Required above the approval threshold.

## Identified by
supplier and order-date

## Created on demand
no

## Predicates
- fully delivered: delivered-quantity >= ordered-quantity
- already fully delivered: fully delivered
- partially delivered: status is "partially-delivered"
- confirmed: status is "confirmed"
- open: status is not "delivered" and status is not "cancelled"
- receivable: status is "confirmed" and delivered-quantity < ordered-quantity
- needs approval: net-amount >= "10000.00 EUR"
- approved: approved-by exists
- import order: is-import is true
- cancelled: status is "cancelled"

## Authorized by
- create: purchasing-manager or category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or warehouse-clerk or warehouse-management or logistics-coordinator or tax-accountant
- update: purchasing-manager or warehouse-management or category-manager
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
### fully delivered
`delivered-quantity >= ordered-quantity`. One line. This is the predicate the goods receipt in
Appendix XII refers to, and the meaning of the phrase lives here rather than in the runtime — the
parser has no idea what delivery is and must never guess.

If your business wants a 98 % delivery to count as complete, you change this one line and every
rule that mentions the phrase follows. That is the whole architectural claim of Principle 11,
reduced to something a supply chain manager can do on a Tuesday.

### already fully delivered
Declared as an alias of `fully delivered`, so that the manifesto's sentence — `order not already
fully delivered` — reads as English while resolving to the same meaning. The word "already" is not
known to the parser; it is known to this file.

### receivable
An order that is not receivable cannot take a goods receipt. A draft order has not been sent to
anybody, so goods arriving against it mean something went wrong upstream and should be looked at by
a human rather than posted.

### needs approval
Ten thousand euros net. Below it the purchasing manager sends the order alone; at or above it the
managing director signs too, in a separate signed act — see `processes/purchase-order-approval.md`.
The number lives here, in the open, and moving it is a visible change to the company rather than a
setting somebody adjusted.

## Retention

Purchase orders are commercial correspondence and part of the trail behind every supplier invoice.
**10 years** under GoBD, counted from the end of the year in which the order was last changed.

## References

`processes/purchase-ordering.md`, `processes/purchase-order-approval.md`,
`processes/goods-receipt.md`
