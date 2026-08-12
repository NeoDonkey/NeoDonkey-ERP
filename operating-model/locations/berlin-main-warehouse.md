# Berlin main warehouse

The building where the company physically is. Goods arrive here, batches are inspected and released
here, webshop parcels are packed here, and pallets for German and Austrian retailers leave from here.
If this site stops, the company stops.

It is also the tax anchor. Everything shipped from Berlin is either a German domestic supply, an
intra-community supply, or an export, and all three follow from this site's country plus the
customer's. The German VAT registration belongs here.

## Context

The `location` document for this site, as the fields in `information/location.md` describe them:

- name: `berlin-main-warehouse`
- location-type: `warehouse`
- country: `DE`, city: Berlin
- in-eu-customs-union: `true`
- stock-holding: `true` — this is what lets a goods receipt be posted here
- operated-by: `own`
- haccp-scope: `true`
- vat-registration: the German USt-IdNr.
- status: `active`

## Notes

### Zoning, and why it is physical
Receiving, quarantine, bulk, picking, clearance and dispatch are separate areas, and quarantine is
deliberately not pickable — a physically separated cage rather than a flag on a record. A quarantine
that exists only in software gets ignored on a busy Tuesday; a locked cage does not.

Two of the bulk aisles are temperature-controlled, which matters for chocolate between May and
September and shows up as `temperature-on-arrival-celsius` on the batch.

### Tax position
Domestic sales at 7 % for most food and 19 % for beverages and confectionery. Intra-community supplies
zero-rated with a validated customer VAT identification number *and* a proof of transport — both, or the
zero rating fails in an audit. Exports to Switzerland zero-rated with an export declaration.

### What to change first
The zone list. Most companies have fewer than six areas and one of them is a corner of the room. Model
what exists, including the corner: an unmodelled quarantine area is worse than an honest one.

## References

`processes/goods-receipt.md`, `processes/quality-inspection.md`, `processes/shelf-life-sweep.md`,
`processes/picking-and-shipping.md`, `processes/stock-write-off.md`
