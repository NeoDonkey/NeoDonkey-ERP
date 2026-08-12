# Order line

One line of a purchase order: this article, this quantity, this price. Stock arrives
against a line, not against an order, because a delivery of three of the five ordered
articles has to be recordable without pretending the other two arrived.

The line carries its own `open-quantity` for the same reason the order does: so that
"fully delivered" is a fact you can read on the line, and the order's status is simply
the roll-up of its lines.

## Fields
- id: text required — <order>-<position>, e.g. PO-2026-0417-03.
- order: reference to order required
- position: number required
- article: reference to article required
- ordered-quantity: number required
- received-quantity: number required — Starts at 0, raised by each goods receipt.
- open-quantity: number required — Ordered minus received.
- agreed-net-price-per-unit-eur: number required — What the supplier invoice is checked against.
- agreed-net-price-per-kg-eur: number — For weight-priced articles.
- status: text required — open, partially-delivered, delivered, cancelled.
- requested-best-before-minimum-days: number — Shelf life we insisted on.

## Identified by
order and position

## Created on demand
no

## Predicates
- fully delivered: open-quantity = 0
- over delivered: open-quantity < 0
- open: status is not "delivered" and status is not "cancelled"
- priced: agreed-net-price-per-unit-eur > 0

## References
- `order` → `order`
- `article` → `article`

## Retention
**10 years** under GoBD, with the order it belongs to.

## Notes
### over delivered
A supplier delivering more than ordered is common in food, where a pallet is a pallet.
We record it as over-delivery rather than refusing it, and the tolerance is a commercial
decision in `processes/goods-receipt.md`, not a hidden constant.

### open
<!-- NEEDS-GRAMMAR: `or` between two conditions. The grammar joins conditions with `and`
     only. This is grammar.md §10 limit 2. v0.2 proposal: allow `or` at the same level as `and`,
     left-associative, with `and` binding tighter, and parentheses required for anything ambiguous. The in-grammar
     substitute used everywhere in `processes/` is to test `status is not "delivered" and
     status is not "cancelled"` — logically the same thing here, but only because the
     status list is closed. -->
     status list is closed. -->

### Used by

`processes/purchase-ordering.md`, `processes/goods-receipt.md`,
`processes/supplier-invoice-verification.md`
