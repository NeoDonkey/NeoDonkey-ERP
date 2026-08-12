# Supplier — parcel carrier

**Paketdienst Nord GmbH**, an invented placeholder for the carrier delivering webshop parcels across
DACH, France, Italy and the Netherlands.

A carrier is a supplier because it ends in the same place: an invoice to check. But it is the supplier
whose performance the customer actually experiences. A late pallet is a conversation with a buyer; a
late parcel is a review, a support ticket, and sometimes a refund paid for twice.

## Context

- name: `Paketdienst Nord GmbH`, supplier-type: `carrier`, country: `DE`
- vat-identification-number: on file; vat-treatment: `domestic-standard`
- payment-terms-days: `14`
- iban-on-file: `yes`
- food-safety-certification: `none` — sealed parcels, no open handling
- status: `approved`

## Notes

### Where a carrier shows up
As `carrier` on the goods receipt when they bring goods in, and on the delivery note when they take
goods out. The delivery note's `tracking-reference` is required for parcel shipments —
`processes/picking-and-shipping.md` will not dispatch without one, because an untracked parcel is an
argument nobody can win.

### Freight invoices are the ones that drift
Surcharges, fuel adjustments, remote-area fees, dimensional weight recalculations. A freight invoice
almost never matches the rate card, which is why `three-way-match-status` on
`information/supplier-invoice.md` has a `price-variance` value and why the logistics coordinator sees
these invoices read-only.

### Lost parcels
A lost shipment is a return, not a write-off — see `processes/picking-and-shipping.md`. Treating it as a
write-off loses both facts that matter: money owed to the customer, and a claim against the carrier.

## References

`processes/picking-and-shipping.md`, `processes/goods-receipt.md`,
`processes/returns-and-credit-notes.md`, `management-system/quarterly-supplier-review.md`
