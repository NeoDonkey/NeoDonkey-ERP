# Article onboarding

Bringing a new product to market. Most of it is commercial judgement no system can help with. One part is
a legal checklist no system should let you skip, and that part is here.

An article cannot be sold without a complete allergen declaration and a nutrition table. That is EU
Regulation 1169/2011, it is not negotiable, and a mislabelled allergen is the worst thing that can happen
in this business. The obligation is enforced where it bites: `article sellable` is a condition in
`processes/b2c-sales-order.md`, so an incomplete article cannot reach a customer even if somebody
activated it by mistake.

What this file enforces is the food data that everything downstream depends on: where it comes from, how
long it lasts, and what a retailer will accept on arrival. Those three numbers decide whether a batch goes
to a grocery chain, to the webshop, or to clearance.

## Triggered by
A category manager listing a new product, or a recipe or supplier change that requires a new article.

## Rules

If Create article under condition
  country-of-origin exists and
  shelf-life-days > 0 and
  minimum-remaining-shelf-life-days > 0 and
  net-weight-grams > 0
then
  Update article with status "draft" and
  Update article with vat-category

## Notes

### Why it starts as a draft
A new article is not sellable and should not be. Filling in the allergen declaration and the nutrition
table is real work that happens after the article exists, and the gate that matters is the one at the
point of sale rather than the one at creation. `article sellable` is that gate.

### shelf-life-days and minimum-remaining-shelf-life-days
Both required, both positive. The first drives the best-before date on every batch; the second is what a
retailer's goods-in will accept. Getting the second wrong means pallets refused at somebody else's gate and
paid for twice — once in freight out, once in freight back.

### vat-category as an obligation
Food is generally 7 % in Germany; a beverage or a confectionery item may be 19 %. Which one an article is
must be decided when it is created, by somebody who knows, rather than defaulted by software. The actual
rate per country is resolved through `information/vat-treatment.md`.

### No Delete
There is no `Delete article` rule in this folder and there should never be one. Delisting is a status
change to `discontinued`. Ten years of invoice lines point at every article, and an invoice that cannot
explain what it sold is not an invoice.

## Authorized by
category-manager
