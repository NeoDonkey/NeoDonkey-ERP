# Article onboarding

Bringing a new product to market. Most of it is commercial judgement that no system can help
with. One part of it is a legal checklist that no system should let you skip, and that part is
here.

An article cannot become `active` without a complete allergen declaration and a nutrition table.
That is EU Regulation 1169/2011 and it is not negotiable — a product on sale without them is a
labelling offence, and a mislabelled allergen is the worst thing that can happen in this
business. So the rule refuses it, and the refusal names the missing field.

A retail listing needs one more thing: a GTIN. No barcode, no pallet through a grocery chain's
goods-in. And anything batch-managed needs a shelf life and a minimum remaining shelf life,
because those two numbers decide what we can promise a retailer and when a batch goes to
clearance.

## Triggered by
A category manager deciding to list a new product, or a recipe or supplier change that requires
a new article.

## Rules
If Create article under condition
  category exists and
  net-weight-grams > 0
then
  Update article with status "draft" and
  Update article with country-of-origin and
  Update article with shelf-life-days

If Update article under condition
  article sellable
then
  Update article with status "active"

If Update article under condition
  article listable at retail
then
  Update article with gtin

If Update article under condition
  article batch managed and
  shelf-life-days > 0 and
  minimum-remaining-shelf-life-days > 0
then
  Update article with haccp-relevant "yes"

## Notes

The predicate `sellable` is three conditions on the article entity: active status, an allergen
declaration, and a nutrition table. Look it up in `information/article.md` — that is where a
category manager goes to find out why the system will not let them publish, and the answer is a
sentence rather than an error code.

Note what is *not* here: a rule for delisting. Delisting is a status change to `discontinued`
and needs no rule of its own, because there is no `Delete article` anywhere in this folder.
Ten years of invoice lines point at every article, and an invoice that cannot explain what it
sold is not an invoice.

## Authorized by
category-manager
