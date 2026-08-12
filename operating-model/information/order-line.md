# Order line

One line of a purchase order: this article, this quantity, this price. Stock arrives against a
line, not against an order, because a delivery of three of the five ordered articles has to be
recordable without pretending the other two arrived.

The line carries a `position` number rather than relying on the order of an array. That is how
accounting systems have always worked and what an auditor expects to see — "line 3 of purchase
order PO-2026-0417" has to mean the same thing in eight years, and a list that can be reordered by
a merge cannot promise that.

## Fields
- order: reference to order required — Which order it belongs to.
- position: number required — Line number within the order. Explicit, never implied by order.
- article: reference to article required — What was ordered.
- ordered-quantity: number required — How much.
- delivered-quantity: number required — How much has arrived so far.
- agreed-net-price-per-unit: money required — What the supplier invoice is checked against.
- agreed-net-price-per-kg: money — For weight-priced articles.
- currency: text required — EUR.
- status: one of open, partially-delivered, delivered, cancelled required — Per line, because a partly delivered order has lines in three of these at once.
- requested-best-before-minimum-days: number — Shelf life we insisted on at order time.

## Identified by
order and position

## Created on demand
no

## Predicates
- fully delivered: delivered-quantity >= ordered-quantity
- over delivered: delivered-quantity > ordered-quantity
- open: status is "open"
- delivered: status is "delivered"
- priced: agreed-net-price-per-unit > 0

## Authorized by
- create: purchasing-manager or category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or warehouse-clerk or warehouse-management or logistics-coordinator or tax-accountant
- update: purchasing-manager or warehouse-management
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
### position
Explicit, and required. Agent D's live layer stores set-valued fields as an OR-Set, which has no
order — so anything that relies on array position loses it the moment two people edit
concurrently. A line number is a business fact, not a rendering detail.

### over delivered
A supplier delivering more than ordered is routine in food, where a pallet is a pallet. We record
it as over-delivery rather than refusing the goods, and the tolerance is a commercial conversation
rather than a hidden constant.

### Identified by order and position
This is what lets `Update order-line with status "delivered"` find the right line when a goods
receipt does not reference the line directly. In this model the goods receipt *does* carry an
`order-line` reference, so targeting goes through the reference — but declaring the business key
anyway means a future rule that lacks the reference still resolves, rather than failing at parse
time with nobody knowing why.

## Retention

**10 years** under GoBD, with the order it belongs to.

## References

`processes/purchase-ordering.md`, `processes/goods-receipt.md`
