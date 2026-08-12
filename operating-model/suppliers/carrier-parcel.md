# Supplier — parcel carrier

**Paketdienst Nord GmbH**, an invented placeholder for the carrier that delivers webshop parcels across
DACH, France, Italy and the Netherlands.

A carrier is a supplier because it ends in the same place: an invoice we have to check. But it is the
supplier whose performance the customer actually experiences. A late pallet is a conversation with a buyer;
a late parcel is a review, a support ticket, and sometimes a refund we pay for twice.

## Context

- name: `Paketdienst Nord GmbH`
- supplier-type: `carrier`
- country: `DE`
- vat-identification-number: on file, German
- vat-treatment: `domestic-standard`
- payment-terms-days: `14`
- iban-on-file: `true`
- food-safety-certification: `none` — sealed parcels, no open handling
- status: `approved`

## Notes

### Where a carrier shows up in the model
As `carrier` on the goods receipt, when they bring goods *in*; and as the mover of outbound orders in
`processes/picking-and-shipping.md`. In this instance the outbound side is deliberately thin: there is no
delivery-note document, so the carrier appears on the inbound record and on their own invoice, and the
tracking reference lives outside the operating model.

That is a real trim rather than a design. The template's fuller shipping process carries a delivery note
with the tracking reference, the batches shipped, and the proof of transport — and the proof of transport is
the one that costs money if it is missing.

### Why the tax position is boring, and where it stops being boring
A German carrier invoicing a German company is `domestic-standard`, 19 %, deductible, uninteresting. It
stops being uninteresting for the Swiss leg: freight for an export can be zero-rated, and the customs
handling fee is a different thing again. Neither is modelled here; both are named so that nobody assumes
they were handled.

### No real supplier data
Invented name, invented numbers, no personal data.

## References

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`,
`management-system/quarterly-supplier-review.md`
