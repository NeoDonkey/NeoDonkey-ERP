# Article

An article is one thing we sell: 1 kg of cashews, a 500 g bag of dried mango, a six-pack of
dark chocolate. It is the anchor of almost everything else — stock is counted per article,
margin is reviewed per article, an allergen declaration is attached to an article, and a
retailer's listing is a promise about an article.

Because we sell food, an article carries obligations that a t-shirt does not. Every article
that reaches a consumer needs a complete allergen declaration and a nutrition table. Most
articles are batch managed, because a best-before date and a recall path only exist if we know
which batch went where. Some are priced by weight rather than by piece, so the amount on the
invoice follows the weight actually shipped.

The article deliberately carries no price. The same bag costs one thing in the German webshop,
another in France, and another on a pallet to a grocery chain, and all three are correct.

## Fields
- name: text required — What a customer sees, in the language of the shop.
- category: text required — Nuts, dried fruit, chocolate, baking, drinks.
- status: one of draft, active, discontinued required — Sellability is a gate, not a spectrum: see processes/article-activation.md.
- batch-managed: boolean required — True for every food article.
- pricing-basis: text required — piece or weight.
- net-weight-grams: number required — Declared net weight per selling unit.
- vat-category: text required — food-reduced, standard or beverage-standard.
- allergen-declaration: text — The full declaration as printed on the pack.
- nutrition-table: text — Per 100 g, as required by EU 1169/2011.
- country-of-origin: text required — Needed for customs and for the label.
- customs-tariff-number: text — Required for anything crossing into Switzerland.
- shelf-life-days: number required — Total shelf life from production.
- minimum-remaining-shelf-life-days: number required — What a retailer accepts on arrival.
- haccp-relevant: boolean required — True for anything open-handled.
- gtin: text — The barcode. A retailer will not list an article without one.
- default-supplier: reference to supplier — Where we normally buy it.

## Identified by
gtin

## Created on demand
no

## Predicates
- sellable: status is "active" and allergen-declaration exists and nutrition-table exists
- batch managed: batch-managed is true
- quality critical: haccp-relevant is true
- listable at retail: status is "active" and gtin exists and allergen-declaration exists
- weight priced: pricing-basis is "weight"
- active: status is "active"

## Authorized by
- create: category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management or customer-service-agent or tax-accountant
- update: category-manager
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
### sellable
An article missing its allergen declaration is not sellable, regardless of how much stock we
have. That is a legal position, not a preference, and it is the reason
`processes/article-onboarding.md` refuses to activate an incomplete article. When somebody asks
why the system will not let them publish, the answer is this line — a sentence, not an error code.

### batch managed
The switch that turns on everything in `information/batch.md`. Turn it off for an article and
the goods receipt stops demanding a batch number and a best-before date for it.

### quality critical
Quality-critical articles arrive in quarantine and need a release decision from the quality
manager before they can be picked.

## Retention

Article master data sits behind every invoice line that references it. Under GoBD it is retained
for **10 years** after the last transaction that used it, and it is never deleted — a
discontinued article gets `status` `discontinued` and stays. There is no `Delete article` rule
anywhere in this operating model, and there should never be one.

## References

`processes/article-onboarding.md`, `processes/goods-receipt.md`,
`processes/quality-inspection.md`, `processes/invoice-issuance.md`,
`management-system/weekly-margin-review.md`
