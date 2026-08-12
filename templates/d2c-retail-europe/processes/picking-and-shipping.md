# Picking and shipping

Taking goods off the shelf and handing them to a carrier. The physically simplest process in the
company and the one that carries the most legal weight per minute, because three separate
obligations are discharged here.

**Traceability.** The batch picked is recorded on the line and on the delivery note. Article plus
batch plus delivery note answers "who received this", which is the only question that matters
during a recall. A picker who grabs the nearest carton without scanning it has broken the chain,
and no amount of paperwork afterwards repairs it.

**Shelf life.** Only released, unexpired batches may be picked. The quarantine cage is a
warehouse location that is not pickable, which means the physical world enforces the same rule
the system does.

**Proof of transport.** A zero-rated supply to a business in another EU member state needs a
*Gelangensbestätigung*. If it is not collected now it is not collected at all, and three years
later the supply is re-assessed at nineteen percent.

## Triggered by
A sales order released for picking.

## Rules
If Update sales-order-line under condition
  batch released for sale and
  status is "reserved" and
  quantity > 0
then
  Update sales-order-line with batch and
  Update sales-order-line with status "shipped" and
  Update stock with -quantity and
  Update stock with -reserved-quantity

If Create delivery-note under condition
  sales-order shipped and
  batches-shipped exists and
  gross-weight-kg > 0
then
  Update delivery-note with status "dispatched" and
  Update delivery-note with carrier and
  Update sales-order with fulfilment-status "shipped"

If Update delivery-note under condition
  delivery-note parcel shipment and
  delivery-note trackable
then
  Update delivery-note with status "dispatched"

If Update delivery-note under condition
  delivery-note transport proven and
  status is "delivered"
then
  Update delivery-note with receiver-confirmation-date and
  Update sales-order with fulfilment-status "shipped"

If Create delivery-note under condition
  ship-from-location exists and
  customs-declaration exists
then
  Update delivery-note with status "prepared" and
  Update customs-declaration with direction "export"

If Update delivery-note under condition
  delivery-note lost
then
  Create return with return-type "transport-damage" and
  Update sales-order with fulfilment-status "shipped"

## Notes

<!-- NEEDS-GRAMMAR: the counter form takes its delta from the trigger document's field of the
     same name, so decrementing `stock.quantity` requires the sales order line to carry a field
     called `quantity`. It does, and `information/sales-order-line.md` says why, but the
     honest description is that the model has been bent to fit the grammar rather than the
     reverse. v0.2 proposal: an explicit delta, `Update stock with -quantity by shipped-quantity`,
     which would let the line keep only the three quantities it genuinely has. -->

A lost parcel is money owed to the customer and a claim against the carrier. Treating it as a
stock write-off loses both facts, which is why it becomes a return with a reason instead.

## Authorized by
warehouse-clerk or logistics-coordinator
