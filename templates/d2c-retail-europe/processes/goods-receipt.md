# Goods Receipt

The goods receipt is executed when a delivery arrives at the warehouse.
It checks whether the delivery matches the order and updates stock
plus order status.

That paragraph is the whole process, and it is worth noticing that it is also the entire
specification. Everything below is the same sentence written precisely enough for a runtime
to execute. There is no requirements document between the two, which is the point.

Three things make a food goods receipt different from a general one, and each is a rule
below rather than a footnote. Batch-managed articles must arrive with a batch number and a
best-before date, or we cannot trace them and cannot state a shelf life. Quality-critical
articles go into quarantine, not onto the picking shelf, until somebody has released them.
And a damaged delivery is *recorded*, not refused — because a system that refuses to record
what actually arrived teaches the warehouse to stop telling it the truth.

## Triggered by
Arrival of a delivery at the location with reference to an order.

## Rules
If Create goods-receipt under condition
  quantity > 0 and
  order exists and
  order not already fully delivered
then
  Create goods-receipt-fact with batch-number and
  Update stock with +quantity and
  Update order-line with status "delivered"

If Create goods-receipt under condition
  article batch managed and
  order exists
then
  Create batch with quality-status "quarantined"

If Create goods-receipt-fact under condition
  order exists and
  order receivable
then
  Update order with -open-quantity and
  Update order-line with -open-quantity and
  Update order with status "partially-delivered"

If Update order under condition
  order fully delivered
then
  Update order with status "delivered"

If Create goods-receipt under condition
  packaging-intact is "no" and
  order exists
then
  Create quality-inspection and
  Update batch with quality-status "quarantined"

If Create goods-receipt under condition
  order import order and
  received-at-location stock holding
then
  Create customs-declaration with direction "import" and
  Update batch with quality-status "quarantined"

## Notes

This is the rule Appendix XII uses to show what changing one word does. The words
`with batch-number` in the consequent are an obligation: from the moment they are there, a
goods receipt for a batch-managed article without a batch number is refused, and the
generated capture screen asks for one. Remove the two words and the obligation disappears.
Nobody wrote code either way.

The `Create batch with quality-status "quarantined"` half is what stops a newly arrived
pallet being picked. It arrives quarantined by default; getting out is
`processes/quality-inspection.md`.

Note that the open quantity is reduced by the *counted* quantity, not by the quantity on the
supplier's delivery note. Those differ often enough in food that treating them as the same
number is how phantom stock appears.

The meaning of *fully delivered* is not in this file and not in the runtime. It is one line
on the order entity: `open-quantity = 0`. If your business wants a 98 % delivery to count as
complete, you change that line and every rule that mentions the phrase follows.

An import that is customs-cleared is not yet sellable: the health certificate and the CHED
entry have to be there too. Those are conditions on the release in
`processes/quality-inspection.md`, which is where the batch actually gets out of quarantine.

## Authorized by
warehouse-clerk or warehouse-management
