# Warehouse clerk

The person on the dock and in the aisles. They receive deliveries, put goods away, pick orders and
pack parcels. In a food business they are also the first line of quality control: they are the ones
who see the dented carton, the wet pallet, the missing best-before date.

The clerk's authority is deliberately wide on *recording what happened* and narrow on *deciding what
it means*. They may post a goods receipt for any quantity — including a short or damaged delivery —
because the record of what physically arrived must never wait for somebody to be available to approve
it. They may not release a quarantined batch, write off stock, or touch a price.

That split is why `processes/goods-receipt.md` accepts a damaged delivery and routes it to quality
rather than refusing it. A system that refuses to record reality teaches people to work around it.

## Purpose

- Receive deliveries against an order and count what actually arrived.
- Capture the batch number and best-before date for every batch-managed article.
- Put goods away, into quarantine where the article is quality-critical.
- Pick and pack sales orders, recording the batch picked.
- Report damage, short delivery and anything that looks wrong.
- Take part in counts.

## Notes

### Authorised for
`processes/goods-receipt.md`, `processes/picking-and-shipping.md`

### Not authorised for
Releasing or blocking a batch — that is the quality manager. Writing off stock — that is warehouse
management, with the controller above 500 EUR. Anything touching prices, invoices or payments.

### Reports to
`warehouse-management`

### Sees
Stock, batches, orders, order lines, goods receipts, sales orders for the sites they work at. Not
prices, not margins, not customer balances, not supplier invoices. The visibility group is per
location — a clerk in Berlin does not see Venlo stock, not because it is secret but because it is
noise.
