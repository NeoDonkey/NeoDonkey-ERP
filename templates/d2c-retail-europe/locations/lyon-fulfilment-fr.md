# Lyon fulfilment (FR)

A partner warehouse serving French webshop orders. France is the second-largest consumer market in
this template and the one where next-day delivery from Berlin is not competitive, so stock sits
locally.

Tax-wise this is the same story as Venlo — local stock means a local registration, OSS does not
cover a domestic French supply — with one French addition worth knowing: France applies reduced VAT
rates to food that do not map one-to-one onto the German ones. A product at 7 % in Germany may not be
at 5.5 % in France. The mapping belongs in `information/vat-treatment.md` per country, and getting it
wrong is a systematic error rather than a one-off.

France also has stricter labelling expectations in practice than the EU minimum, particularly around
nutrition labelling and origin claims. That is an article-level obligation and a reason
`country-of-origin` is required on every article rather than optional.

## Notes
### Site facts

- `id` — `lyon-fulfilment-fr`
- `location-type` — `fulfilment-partner`
- `country` — `FR`
- `city` — Lyon
- `in-eu-customs-union` — `yes`
- `stock-holding` — `yes`
- `operated-by` — `partner`
- `partner` — `SUP-0072` (Logistique Bertrand SAS, an invented placeholder)
- `haccp-scope` — `yes`
- `vat-registration` — `vat-fr`
- `status` — `active`

### Processes here

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`, `processes/inventory-count.md`

### Tax position

French VAT registration `vat-fr`, `registration-type` `foreign-local`. Some member states require a
local tax representative for a non-established business; where that applies, the representative is a
`supplier` record referenced from the registration, so the obligation has an owner rather than being
a memory.

### What to change first

The French reduced-rate mapping for your own assortment, in `information/vat-treatment.md`. Do it with
your tax adviser and do it once, per article category — not per article and not per order.
