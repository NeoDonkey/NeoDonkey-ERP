# Zurich office (CH)

A small office for the Swiss market, and the most instructive location in this template.

Switzerland is in the middle of DACH, speaks German, and is **not in the EU customs union**. Every
pallet that goes there needs an export declaration, a commercial invoice with a customs tariff number
per article, and a proof of export to keep the sale zero-rated. Every parcel does too — a webshop
order to Zurich is an export, with a duty and Swiss VAT bill for the recipient unless we clear it for
them.

Teams learn this from a truck standing at Basel. It is in the template so that nobody has to.

There is a second, quieter consequence for a food business: Swiss labelling requirements are not EU
requirements. An article that is legally labelled for the EU may not be legally sellable in
Switzerland, which is an assortment decision rather than a logistics one.

## Notes
### Site facts

- `id` — `zurich-office-ch`
- `location-type` — `office`
- `country` — `CH`
- `city` — Zurich
- `in-eu-customs-union` — `no`
- `stock-holding` — `no`
- `operated-by` — `own`
- `haccp-scope` — `no`
- `vat-registration` — none
- `status` — `active`

### Processes here

`processes/b2b-retail-order.md`, `processes/customs-declaration.md`, `processes/customer-complaint.md`

### Tax position

Sales to Switzerland are exports: zero-rated German VAT, proof of export required, `vat-treatment`
`export`. Swiss import VAT and duty are the importer's, unless we have agreed to clear them, in which
case the customs declaration carries them and they are a cost of sale rather than a tax.

A Swiss VAT registration becomes necessary if we sell to Swiss consumers above the Swiss distance
selling threshold. That is not modelled here — it is named so that it is a decision rather than a
surprise.

### What this file is for

If you take one thing from this template's `locations/` folder, take this: a location's country is not
an address field. It is the input to every tax question the company will ever be asked.
