# Location

A location is a site: an address, a country, a tax situation, a set of things that happen
there. The files in `locations/` are the actual sites this company operates; this file
defines what a site *is*, so that rules can refer to one.

Locations carry more weight in a European business than people expect. The country of the
location decides which VAT registration applies, whether a delivery is domestic,
intra-community or an export, and whether a customs declaration is needed. The Swiss
office in this template exists mainly to make that visible: Switzerland is not in the EU
customs union, so every pallet that crosses gets paperwork.

A location can also be virtual. The webshop is a location — it is where sales happen, it
has a channel, and it has a tax obligation. Pretending it is not a location just means the
obligation lives nowhere.

## Fields
- id: text required — berlin-main-warehouse.
- name: text required
- location-type: text required — warehouse, office, fulfilment-partner, virtual-channel.
- country: text required — ISO code: DE, AT, CH, FR, IT, NL.
- city: text required
- in-eu-customs-union: text required — yes or no.
- vat-registration: reference to vat-registration — Required where we are registered locally.
- stock-holding: text required — yes or no. Only stock-holding sites can take a goods receipt.
- operated-by: text required — own or partner.
- partner: reference to supplier — Set when operated-by is partner.
- channel: text — webshop, retail, marketplace, for virtual locations.
- status: text required — active, closed.
- haccp-scope: text required — yes or no. Whether food is handled here.

## Identified by
id

## Created on demand
no

## Predicates
- stock holding: stock-holding is "yes" and status is "active"
- outside eu customs union: in-eu-customs-union is "no"
- locally vat registered: vat-registration exists
- partner operated: operated-by is "partner"
- food handling: haccp-scope is "yes"
- virtual: location-type is "virtual-channel"

## References
- `vat-registration` → `vat-registration`
- `partner` → `supplier`
- a location contains many → `warehouse-location`

## Retention
Location master data is referenced by ten years of movements and invoices, so it is kept
**10 years** past closure, never deleted.

## Notes
### stock holding
A goods receipt may only be posted at a stock-holding location. This is the condition that
stops somebody receiving a pallet into an office.

### Used by

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`,
`processes/invoice-issuance.md`, `processes/customs-declaration.md`
