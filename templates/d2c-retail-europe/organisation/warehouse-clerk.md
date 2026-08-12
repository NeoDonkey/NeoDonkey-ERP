# Warehouse clerk

The person on the dock and in the aisles. They receive deliveries, put goods away, pick
orders and pack parcels. In a food business they are also the first line of quality control:
they are the ones who see the dented carton, the wet pallet, the missing best-before date.

The clerk's authority is deliberately wide on *recording what happened* and narrow on
*deciding what it means*. They may post a goods receipt for any quantity — including a short
or damaged delivery — because the record of what physically arrived must never depend on
whether somebody is available to approve it. They may not release a quarantined batch, write
off stock, or change a price.

That split is the reason the goods receipt process in this template accepts a damaged
delivery and routes it to quality, rather than refusing it. A system that refuses to record
reality teaches people to work around it.

## Notes
### Responsibilities

- Receive deliveries against an order and count what actually arrived.
- Capture batch number and best-before date for every batch-managed article.
- Put goods away, into quarantine where the article is quality-critical.
- Pick and pack sales orders, recording the batch picked.
- Report damage, short delivery and anything that looks wrong.
- Take part in cycle counts.

### Authorized for

- `processes/goods-receipt.md`
- `processes/picking-and-shipping.md`
- `processes/inventory-count.md`

### Not authorized for

- Releasing or blocking a batch — that is `quality-manager`.
- Writing off stock — that is `warehouse-management`, with `controller` above 500 EUR.
- Correcting a posted goods receipt — that is `warehouse-management`.
- Anything touching prices, invoices or payments.

### Reports to

`warehouse-management`

### Sees

Stock, batches, orders, order lines, goods receipts, sales orders and delivery notes for the
locations they work at. Not prices, not margins, not customer balances, not supplier
invoices. The visibility group is per location, so a clerk in Berlin does not see the Venlo
stock — not because it is secret, but because it is noise.
