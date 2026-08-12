# Berlin main warehouse

The building where the company physically is. Goods arrive here, batches are inspected and released
here, webshop parcels are packed here, and pallets for German and Austrian retailers leave from here.
If this site stops, the company stops.

It is also the tax anchor. Everything shipped from Berlin is either a German domestic supply, an
intra-community supply, or an export, and all three are decided by this site's country plus the
customer's. The German VAT registration belongs here.

The zoning matters more than it looks. Receiving, quarantine, bulk, picking, clearance and dispatch
are separate warehouse locations, and quarantine is deliberately not pickable — a physical cage that
enforces the same rule the software does. A quarantine that is a flag rather than a place gets
ignored on a busy Tuesday.

## Notes
### Site facts

- `id` — `berlin-main-warehouse`
- `location-type` — `warehouse`
- `country` — `DE`
- `city` — Berlin
- `in-eu-customs-union` — `yes`
- `stock-holding` — `yes`
- `operated-by` — `own`
- `haccp-scope` — `yes`
- `vat-registration` — `vat-de`
- `status` — `active`

### Warehouse locations here

Six zones, as `warehouse-location` records: `receiving` (not pickable), `quarantine` (not pickable,
physically separated), `bulk`, `picking`, `clearance` for short-dated stock, and `dispatch` (not
pickable). Two of the bulk aisles are temperature-controlled for chocolate over the summer.

### Processes here

`processes/goods-receipt.md`, `processes/quality-inspection.md`, `processes/shelf-life-sweep.md`,
`processes/picking-and-shipping.md`, `processes/inventory-count.md`, `processes/stock-write-off.md`

### Tax position

German VAT registration `vat-de`. Domestic sales at 7 % for most food and 19 % for beverages and
confectionery. Intra-community supplies zero-rated with a validated customer VAT ID and a proof of
transport. Exports to Switzerland zero-rated with an export declaration.

### What to change first

The zone list. Most companies have fewer than six and one of them is a corner of the room. Model
what exists, including the corner — an unmodelled quarantine area is worse than an honest one.
