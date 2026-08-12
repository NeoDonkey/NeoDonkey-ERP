# Picking and shipping

Taking goods off the shelf and handing them to a carrier. The physically simplest process in the
company and the one that carries the most legal weight per minute.

**Traceability.** The batch picked is recorded on the line. Article plus batch plus order answers "who
received this", which is the only question that matters during a recall. A picker who takes the nearest
carton without recording it has broken the chain, and no amount of paperwork afterwards repairs it.

**Shelf life.** Only released, unexpired batches may be picked. The quarantine area is a location that
is not pickable, so the physical world enforces the same rule the system does.

**Stock.** Picking is where physical stock actually falls. Until this moment it was reserved, which is a
promise; now it is gone, which is a fact.

## Triggered by
A sales order released for picking, and a picker confirming what they took from which batch.

## Rules

If Update sales-order-line under condition
  batch released for sale and
  quantity > 0 and
  location stock holding
then
  Update stock with -quantity and
  Update stock with -reserved-quantity

If Update sales-order-line under condition
  article batch managed and
  batch traceable
then
  Update sales-order-line with batch

## Notes

### batch released for sale
`quality-status is "released" and shelf-life-status is not "expired"`. Two conditions on the batch, read
through the line's declared `batch` reference. A quarantined batch cannot be picked; neither can an
expired one; and the refusal names which of the two it was.

### The obligation that makes a recall possible
`Update sales-order-line with batch` says: this line must state the batch it was picked from. Two words.
Everything in `processes/quality-inspection.md` and every batch field in `information/batch.md` exists to
make this one obligation meaningful, and without it none of the rest matters — you cannot withdraw what
you cannot locate.

### Why `quantity` and not `shipped-quantity`
The counter takes the trigger's field of the same name, and `stock` calls its physical balance
`quantity`. So the line carries a `quantity` field meaning "the amount this line is moving right now",
alongside the three quantities the business actually has. `information/sales-order-line.md` says so
plainly. It is the model bending to the language, the exit path is `with -quantity by shipped-quantity`
in a later grammar version, and it is written down rather than smoothed over.

### What is not here
The delivery note, the carrier booking and the *Gelangensbestätigung*. A zero-rated intra-community
supply needs proof that the goods left Germany, or it is re-assessed at 19 % years later. That proof is
referenced on the invoice (`proof-of-transport-reference`) and collected by the logistics coordinator; it
is not modelled as its own document in this instance, and the template is where the fuller shipping
process lives.

## Authorized by
warehouse-clerk or logistics-coordinator
