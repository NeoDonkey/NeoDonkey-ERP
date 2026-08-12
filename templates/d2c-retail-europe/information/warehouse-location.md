# Warehouse location

A warehouse location is a place inside a site where goods physically sit: a pallet
position, a picking bin, the quarantine cage, the clearance shelf. It is deliberately
different from a `location`, which is a whole site with an address and a tax registration.

The distinction earns its keep at exactly one moment: quarantine. A batch that has arrived
but not been released must be somewhere that pickers cannot reach. Modelling that as a
location rather than as a flag means the physical world and the record agree, and a clerk
who walks past the cage sees the same truth the system does.

## Fields
- id: text required — BER-A-04-12.
- location: reference to location required — Which site it is in.
- zone: text required — receiving, quarantine, bulk, picking, clearance, dispatch.
- pickable: text required — yes or no. no for receiving, quarantine and dispatch.
- temperature-controlled: text required — yes or no.
- target-temperature-celsius: number
- capacity-pallets: number
- status: text required — active, blocked, retired.

## Identified by
id

## Created on demand
no

## Predicates
- pickable: pickable is "yes" and status is "active"
- quarantine: zone is "quarantine"
- blocked: status is "blocked"
- cold chain: temperature-controlled is "yes"

## References
- `location` → `location`

## Retention
Not bookkeeping-relevant in itself, but referenced by stock movements that are. Retired
locations are kept, not deleted, so that a ten-year-old movement still resolves.

## Notes
### Used by

`processes/goods-receipt.md`, `processes/quality-inspection.md`,
`processes/picking-and-shipping.md`, `processes/inventory-count.md`
