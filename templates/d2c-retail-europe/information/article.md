# Article

An article is one thing we sell: 1 kg of cashews, a 500 g bag of dried mango, a
six-pack of dark chocolate. It is the anchor of almost everything else — stock is
counted per article, margin is reviewed per article, an allergen declaration is
attached to an article, and a retailer's listing is a promise about an article.

Because we sell food, an article carries obligations that a t-shirt does not. Every
article that reaches a consumer needs a complete allergen declaration and a nutrition
table. Most of our articles are managed in batches, because a best-before date and a
recall path only exist if we know which batch went where. Some articles are priced by
weight rather than by piece, which means the price on the invoice depends on the
weight actually shipped, not on the weight printed on the bag.

The article does not carry a price. Prices live on `price` records, because the same
article has a different price in the webshop than on a retailer's pallet, and a
different price in France than in Germany.

## Fields
- id: text required — Our own article number, e.g. ART-10442.
- name: text required — What a customer sees, in the language of the shop.
- category: text required — Nuts, dried fruit, chocolate, baking, drinks.
- status: text required — draft, active, discontinued.
- batch-managed: text required — yes or no. yes for every food article.
- pricing-basis: text required — piece or weight.
- net-weight-grams: number required — Declared net weight per selling unit.
- tare-weight-grams: number — Packaging weight, needed for the packaging levy.
- vat-category: text required — food-reduced, standard, beverage-standard. Resolves to an actual rate per country on vat-treatment.
- allergen-declaration: text — The full declaration as printed on the pack. Required before an article may become active.
- may-contain-traces: text — Cross-contamination statement from the supplier.
- nutrition-table: text — Per 100 g, as required by EU 1169/2011.
- country-of-origin: text required — Needed for customs and for the label.
- customs-tariff-number: text — Required for anything crossing into Switzerland.
- shelf-life-days: number required — Total shelf life from production, used to derive the best-before date on a batch.
- minimum-remaining-shelf-life-days: number required — What a retailer will accept on arrival. Below this we cannot ship to retail, only to the webshop or to clearance.
- default-supplier: reference to supplier — Where we normally buy it.
- haccp-relevant: text required — yes or no. yes for anything open-handled.
- gtin: text — The barcode. Required before a retailer will list it.

## Identified by
gtin

## Created on demand
no

## Predicates
- sellable: status is "active" and allergen-declaration exists and nutrition-table exists
- batch managed: batch-managed is "yes"
- weight priced: pricing-basis is "weight"
- listable at retail: status is "active" and gtin exists and allergen-declaration exists
- quality critical: haccp-relevant is "yes"

## References
- `default-supplier` → `supplier`
- `vat-category` is interpreted through → `vat-treatment`

## Retention
Article master data is part of the audit trail for every invoice line that references it.
Under GoBD it is retained for **10 years** after the last transaction that used it, and it
is never deleted — a discontinued article gets `status` `discontinued` and stays.

## Notes
### sellable
An article that is missing its allergen declaration is not sellable, regardless of stock.
This is a legal position, not a preference.

### Used by

`processes/article-onboarding.md`, `processes/goods-receipt.md`,
`processes/quality-inspection.md`, `processes/invoice-issuance.md`,
`management-system/weekly-margin-review.md`
