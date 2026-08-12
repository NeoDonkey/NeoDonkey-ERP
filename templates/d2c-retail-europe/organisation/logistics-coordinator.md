# Logistics coordinator

Moves things between places. Books carriers, plans retail delivery windows, manages the
fulfilment partners in Venlo, Lyon and Milan, and files the customs paperwork for anything
crossing into Switzerland.

The interesting part of this role is that it sits on the boundary between a logistics decision
and a tax consequence. Choosing to ship a French consumer order from Lyon rather than Berlin
looks like a freight decision; it is also the decision that makes the sale a French domestic
supply rather than a cross-border distance sale, and therefore requires a French VAT
registration. This role does not make the tax decision — but it is the role whose choices
create it, so the process file says so out loud.

The other genuinely load-bearing thing here is the proof of transport. An intra-community
supply that is zero-rated needs a *Gelangensbestätigung*. Collecting it is unglamorous, easy
to skip, and the reason a VAT audit turns expensive three years later.

## Notes
### Responsibilities

- Book carriers and negotiate freight rates.
- Plan retail delivery windows and avoid the penalties for missing them.
- Coordinate the fulfilment partners and reconcile their stock against ours.
- Collect and file the proof of transport for every intra-community supply.
- Prepare customs declarations for Swiss shipments and imports.
- Chase lost and refused shipments.
- Bring carrier performance to the quarterly supplier review.

### Authorized for

- `processes/picking-and-shipping.md`
- `processes/customs-declaration.md`

### Not authorized for

- Choosing the VAT treatment of a sale. That follows from the ship-from location and the
  customer, and is set by the sales order rules.
- Posting goods receipts or releasing batches.
- Anything financial beyond checking a freight invoice for the accountant.

### Reports to

`warehouse-management`

### Sees

Sales orders, delivery notes, customs declarations, carriers, stock availability across all
locations, VAT treatments in read-only form. Freight costs. Not customer prices, not margins,
not supplier invoices other than freight.
