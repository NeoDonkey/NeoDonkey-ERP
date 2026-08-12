# Logistics coordinator

Moves things between places. Books carriers, plans retail delivery windows, manages the fulfilment
partner in Venlo, and collects the paperwork that keeps a zero-rated sale zero-rated.

The interesting thing about this role is that it sits on the boundary between a logistics decision and
a tax consequence. Choosing to ship a Dutch consumer order from Venlo rather than Berlin looks like a
freight decision; it is also the decision that makes the sale a Dutch domestic supply requiring a
Dutch VAT registration. This role does not make the tax decision, but its choices create it — which is
why `ship-from-location` is a field on the sales order and not an afterthought.

The other genuinely load-bearing thing is the proof of transport. An intra-community supply that is
zero-rated needs a *Gelangensbestätigung*. Collecting it is unglamorous, easy to skip, and the reason
a VAT audit turns expensive three years later.

## Purpose

- Book carriers and plan retail delivery windows.
- Coordinate the fulfilment partner and reconcile their stock against ours.
- Collect and file the proof of transport for every intra-community supply.
- Chase lost and refused shipments.

## Notes

### Authorised for
`processes/picking-and-shipping.md`

### Not authorised for
Choosing the VAT treatment of a sale — that follows from the ship-from location and the customer, and
is set by the sales order rules. Posting goods receipts or releasing batches.

### Reports to
`warehouse-management`

### Sees
Sales orders, stock availability across all locations, VAT treatments in read-only form, freight costs.
Not customer prices, not margins.
