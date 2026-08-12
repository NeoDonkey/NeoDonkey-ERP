# VAT treatment

This is the single most valuable file in the template, and it is short.

Every sale and every purchase in a European business falls into one of a small number of
tax situations. Which one it is depends on facts — who the parties are, where the goods
move, whether a VAT ID was validated — and the consequences are mechanical once the
situation is known. The mistake almost every ERP makes is scattering those consequences
across dozens of conditions in dozens of places. Here there is one entity, and every rule
that cares reads a treatment code from it.

If your tax adviser tells you something in this template is wrong for your business, this
is the file you change, and the change reaches every invoice from the next one onward.

## Fields
- id: text required — One of the treatment codes above.
- name: text required — Plain-language name.
- applies-to: text required — sale, purchase, both.
- vat-rate-percent: number required — 0 for reverse charge, export and acquisition.
- rate-determined-by: text required — origin-country, destination-country, zero.
- requires-buyer-vat-id: text required — yes or no.
- requires-exemption-reason: text required — yes or no.
- exemption-wording: text — The exact sentence that must appear on the invoice.
- requires-ec-sales-list: text required — yes or no. Zusammenfassende Meldung.
- requires-oss-return: text required — yes or no.
- requires-customs-declaration: text required — yes or no.
- requires-proof-of-transport: text required — yes or no. *Gelangensbestätigung* for intra-community supplies; without it the zero rating fails in an audit.
- datev-tax-key: text — The *Steuerschlüssel* used in the DATEV export.
- status: text required — active, retired.

## Identified by
id

## Created on demand
no

## Predicates
- zero rated: vat-rate-percent = 0
- needs buyer vat id: requires-buyer-vat-id is "yes"
- needs exemption reason: requires-exemption-reason is "yes"
- needs proof of transport: requires-proof-of-transport is "yes"
- needs customs declaration: requires-customs-declaration is "yes"
- needs ec sales list: requires-ec-sales-list is "yes"
- needs oss return: requires-oss-return is "yes"
- destination rated: rate-determined-by is "destination-country"

## References
- referenced by → `customer`, `supplier`, `sales-order`, `order`, `invoice`, `supplier-invoice`

## Retention
Tax determination records are part of the invoice trail: **10 years** under GoBD. A retired
treatment is kept so that an old invoice still explains itself.

## Notes
### The treatments

- `domestic-standard` — German sale to a German customer. 19% or 7% depending on the
  article category. Food is generally 7%; a beverage or a confectionery item may be 19%.
- `eu-reverse-charge` — B2B sale to a business in another EU member state with a validated
  VAT ID. Zero VAT on our invoice, the customer accounts for it. Requires the buyer's VAT
  ID and the exemption wording on the invoice face, and reporting in the *Zusammenfassende
  Meldung*.
- `oss-distance-sale` — B2C sale to a consumer in another EU member state. Once total
  cross-border B2C sales exceed the EU-wide **10,000 EUR** threshold in a calendar year, the
  destination country's rate applies and it is declared through the One-Stop-Shop return
  rather than by registering in each country. Below the threshold, German VAT applies.
- `local-registration` — Where we hold stock in another member state and sell from it, OSS
  does not apply to that domestic supply and a local VAT registration is required. This is
  what makes fulfilment partners in NL, FR and IT a tax decision rather than a logistics one.
- `export` — Sale to a customer outside the EU, including Switzerland. Zero VAT, proof of
  export required.
- `import` — Purchase from outside the EU. Import VAT and duty at the border, deductible.
- `eu-acquisition` — Purchase from an EU supplier under reverse charge. We self-account.
- `no-vat` — Non-taxable items: deposits, some pass-through charges.

### needs proof of transport
The one that quietly costs money. A zero-rated intra-community supply without a
*Gelangensbestätigung* on file is re-assessed at 19% years later, and the customer is long
gone. So the shipping process refuses to close the delivery note without it.

### Used by

`processes/invoice-issuance.md`, `processes/b2c-sales-order.md`,
`processes/b2b-retail-order.md`, `processes/supplier-invoice-verification.md`,
`processes/vat-return-preparation.md`, `processes/customs-declaration.md`
