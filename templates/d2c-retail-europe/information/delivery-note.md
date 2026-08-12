# Delivery note

The document that travels with the goods. For a webshop parcel it is a slip in the box and
a tracking number; for a retail pallet it is a signed piece of paper that the receiving
warehouse stamps, and that stamp is what proves the goods arrived.

That proof is worth real money in a European business. A zero-rated intra-community supply
to a business in another member state only stays zero-rated if we can show the goods left
Germany — the *Gelangensbestätigung*. Years later, in an audit, the delivery note with the
receiver's confirmation is the evidence. Without it the supply is re-assessed at the German
rate.

The delivery note is also the recall document. It links a batch to a destination. Article
plus batch plus delivery note answers "who got it", which is the only question that matters
when something is wrong.

## Fields
- id: text required — DN-2026-0091823.
- sales-order: reference to sales-order required
- customer: reference to customer required
- ship-from-location: reference to location required
- ship-to-country: text required
- dispatch-date: date required
- carrier: reference to supplier required — Parcel service or freight forwarder.
- carrier-service: text required — parcel, pallet-groupage, full-truck.
- tracking-reference: text — Required for parcel shipments.
- package-count: number required
- pallet-count: number
- gross-weight-kg: number required
- batches-shipped: text required — The batch numbers on this delivery, as values. Retained as text so a recall still resolves after archiving.
- proof-of-transport: text — yes or no. Gelangensbestätigung on file.
- proof-of-transport-reference: text — Where the confirmation is stored.
- receiver-confirmation-date: date — When the customer confirmed arrival.
- customs-declaration: reference to customs-declaration — Swiss and non-EU shipments.
- status: text required — prepared, dispatched, delivered, lost, refused.
- cold-chain-maintained: text — yes or no, where relevant.

## Identified by
id

## Created on demand
no

## Predicates
- dispatched: status is "dispatched"
- delivered: status is "delivered"
- traceable: batches-shipped exists
- transport proven: proof-of-transport is "yes" and proof-of-transport-reference exists
- parcel shipment: carrier-service is "parcel"
- trackable: tracking-reference exists
- needs customs declaration: customs-declaration not exists
- lost: status is "lost"

## References
- `sales-order` → `sales-order`, `customer` → `customer`
- `ship-from-location` → `location`
- `carrier` → `supplier`
- `customs-declaration` → `customs-declaration`

## Retention
**10 years** under GoBD as part of the invoice trail. The proof of transport is retained for
the same period and is the single document most often missing when a VAT audit arrives.

## Notes
### transport proven
The condition that keeps an intra-community supply zero-rated. A `yes` without a stored
reference is worthless, so both parts are in the predicate.

### Used by

`processes/picking-and-shipping.md`, `processes/invoice-issuance.md`,
`processes/customs-declaration.md`, `processes/returns-and-credit-notes.md`
