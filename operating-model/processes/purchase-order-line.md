# Purchase order line

One line of a purchase order: this article, this quantity, this price. Stock arrives against a line,
not against an order, because a delivery of three of five ordered articles has to be recordable
without pretending the other two arrived.

Adding a line raises the order's total ordered quantity. That total is maintained as it happens rather
than computed on demand, because the grammar has no aggregation — and because a running total is what
an accountant maintains anyway, and it is auditable in a way a recomputation never is.

The line carries an explicit `position`. Line 3 of a purchase order has to mean the same thing in
eight years, and a list whose order can change during a merge cannot promise that.

## Triggered by
A buyer adding an article to a purchase order.

## Rules

If Create order-line under condition
  order exists and
  article exists and
  ordered-quantity > 0 and
  agreed-net-price-per-unit > 0
then
  Update order with +ordered-quantity

If Create order-line under condition
  article active and
  position > 0
then
  Update order-line with status "open" and
  Update order-line with currency

## Notes

### The first rule
A line needs an order, an article, a quantity and a price. The price condition matters more than it
looks: a line without an agreed price cannot be checked against the supplier's invoice, and an invoice
that cannot be checked gets paid.

`Update order with +ordered-quantity` works because both the line and the order declare a field of
that name. The counter takes the trigger's field of the same name — that is the only form grammar
version 1 has — so the two files agreeing on the name is what makes the arithmetic possible.

### The second rule
`article active` refuses a line for a draft or discontinued article. An order for something we have
not finished setting up is a delivery nobody can receive properly.

`Update order-line with currency` is an obligation: the line must state its currency. This company
works in EUR throughout, and stating it per line rather than assuming it is what makes a future
second currency an addition rather than a migration.

## Authorized by
purchasing-manager
