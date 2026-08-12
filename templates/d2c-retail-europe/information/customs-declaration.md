# Customs declaration

Needed whenever goods cross the EU customs border. In this template that means two things:
pallets going to the Swiss office, and containers of nuts arriving from outside the EU.
Everything inside the EU moves without one, which is exactly why the Swiss case is worth
having in the template — it is the case people forget until a truck is standing at the
border.

For food there is a second layer. Import of certain products requires a health
certificate and, in the EU, a CHED entry in TRACES. A customs declaration that clears while
the health documentation is missing means the goods are legally in the country and still
not sellable.

## Fields
- id: text required — CUS-DEC-2026-0033.
- direction: text required — import or export.
- delivery-note: reference to delivery-note — Set for exports.
- goods-receipt: reference to goods-receipt — Set for imports.
- batch: reference to batch — The batch this declaration cleared, where the import is batch managed.
- border-country: text required — ISO code of the crossing.
- customs-tariff-number: text required — Per article; the combined nomenclature code.
- statistical-value-eur: number required
- duty-amount-eur: number required — 0 where a preferential origin applies.
- import-vat-amount-eur: number required — 0 for exports.
- preferential-origin-claimed: text required — yes or no.
- origin-proof-reference: text — Required when preferential origin is claimed.
- health-certificate-reference: text — Required for food imports.
- ched-reference: text — TRACES common health entry document.
- declaration-reference: text required — The MRN from the customs system.
- status: text required — draft, submitted, cleared, rejected, under-inspection.
- broker: reference to supplier — Who filed it for us.

## Identified by
declaration-reference

## Created on demand
no

## Predicates
- cleared: status is "cleared"
- import declaration: direction is "import"
- export declaration: direction is "export"
- food import documented: health-certificate-reference exists and ched-reference exists
- preferential origin proven: preferential-origin-claimed is "yes" and origin-proof-reference exists
- under inspection: status is "under-inspection"

## References
- `delivery-note` → `delivery-note`, `goods-receipt` → `goods-receipt`
- `broker` → `supplier`

## Retention
Customs records are retained **10 years** in Germany, aligned with GoBD. Preferential origin
proofs have their own retention rules under the relevant trade agreements, generally three
to five years, so the ten-year rule covers them.

## Notes
### food import documented
An import that is customs-cleared but not health-documented must not be released into
sellable stock. This predicate is why the quality inspection reads the customs declaration
and not just the pallet.

### preferential origin proven
Claiming preferential origin without the proof on file is a customs offence, not a rounding
error. Both parts, or neither.

### Used by

`processes/customs-declaration.md`, `processes/goods-receipt.md`,
`processes/picking-and-shipping.md`
