# Location

A location is a site: an address, a country, a tax situation, and a set of things that happen
there. The files in `locations/` are the sites this company actually operates; this file defines
what a site *is*, so that a rule can refer to one.

Locations carry more weight in a European business than people expect. The country of a location
decides which VAT registration applies, whether a delivery is domestic, intra-community or an
export, and whether a customs declaration is needed. Holding stock in another member state turns
a logistics choice into a tax obligation.

A location can also be virtual. The webshop is a location — it is where sales happen, it has a
channel, and it has legal obligations. Pretending otherwise just means those obligations live
nowhere.

## Fields
- name: text required — What people call it.
- location-type: text required — warehouse, office, fulfilment-partner or virtual-channel.
- country: text required — ISO code: DE, AT, CH, FR, IT or NL.
- city: text required — Where it is.
- in-eu-customs-union: boolean required — False for Switzerland.
- stock-holding: boolean required — Only stock-holding sites can take a goods receipt.
- operated-by: text required — own or partner.
- partner: reference to supplier — Set when operated-by is partner.
- channel: text — webshop, retail or marketplace, for virtual locations.
- haccp-scope: boolean required — Whether food is handled here.
- vat-registration: text — The local registration number, where we hold one.
- status: one of active, closed required — Closed means it holds no stock and receives nothing.

## Identified by
name

## Created on demand
no

## Predicates
- stock holding: stock-holding is true and status is "active"
- outside eu customs union: in-eu-customs-union is false
- locally vat registered: vat-registration exists
- partner operated: operated-by is "partner"
- food handling: haccp-scope is true
- virtual: location-type is "virtual-channel"
- active: status is "active"

## Authorized by
- create: managing-director
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management or logistics-coordinator or treasurer or tax-accountant
- update: managing-director or logistics-coordinator
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): the
`- <operation>: <roles>` bullets govern every operation on this entity that no process rule covers. Without
them, an uncovered operation is open to an actor with no role at all — grammar version 1's permissive default,
and the defect Part 4's standing rule 4 was written about. Where a rule *does* cover the operation, the rule's
authority wins and these bullets are not consulted.

`delete` is the managing director everywhere, and it should almost never be used: a document that ten years of
other documents point at is retired by a status change, not removed. `read` is wide, because reading changes
nothing and an audit needs the lot.
### stock holding
A goods receipt may only be posted at a stock-holding location. This is the condition that stops
somebody receiving a pallet into an office, and it is why `locations/munich-office.md` says
`stock-holding: false` rather than leaving it out.

### outside eu customs union
True only for Switzerland here, and it is the single most useful field in this file. Zurich is in
the middle of DACH, speaks German, and needs an export declaration for every pallet. Teams learn
that from a truck standing at Basel.

### locally vat registered
Holding stock at a foreign site makes a sale from that site a *domestic* supply there. The
One-Stop-Shop does not cover it and a local registration is required. That is why this field is on
the location and not buried in a finance setting.

## Retention

Location master data is referenced by ten years of movements and invoices, so it is kept
**10 years** past closure and never deleted. A closed site gets `status` `closed`.

## References

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`,
`processes/invoice-issuance.md`, `locations/berlin-main-warehouse.md`
