# Vienna office (AT)

A small commercial office for the Austrian retail market. Two or three people, no stock, no goods.

Austria is the easiest of the DACH three: in the EU, in the customs union, same language, and a
retail landscape structured much like Germany's. Pallets ship from Berlin, so an Austrian retail sale
is an intra-community supply — zero-rated with a validated VAT ID and a proof of transport — and no
Austrian VAT registration is needed as long as no stock is held here.

That last clause is the whole point of this file. The moment a pallet is stored in Austria, the same
thing happens as in Venlo: local supply, local registration, local return. An office is tax-free; a
warehouse is not.

## Notes
### Site facts

- `id` — `vienna-office-at`
- `location-type` — `office`
- `country` — `AT`
- `city` — Vienna
- `in-eu-customs-union` — `yes`
- `stock-holding` — `no`
- `operated-by` — `own`
- `haccp-scope` — `no`
- `vat-registration` — none
- `status` — `active`

### Processes here

`processes/b2b-retail-order.md`, `processes/customer-complaint.md`

### Tax position

No Austrian registration. Supplies to Austrian business customers are intra-community supplies from
Berlin, zero-rated on the conditions in `information/vat-treatment.md`. Supplies to Austrian consumers
are cross-border distance sales through OSS.

Note the asymmetry that catches people: an Austrian *business* sale needs a validated VAT ID and a
*Gelangensbestätigung*; an Austrian *consumer* sale needs neither but is taxed at the Austrian rate
once the OSS threshold is passed. Same country, same truck, two different regimes.
