# Category manager

Owns a slice of the assortment — nuts, or dried fruit, or chocolate — commercially. Decides
what we list, what we delist, what it costs the customer, and what the retail conditions are.
This is the role whose decisions show up in the weekly margin review, and the role that has to
answer for them.

Two authorities matter. First, articles: this role brings an article to `active`, which is a
gate rather than a formality — an article without a complete allergen declaration and a
nutrition table cannot become active, and the rule refuses it. Second, prices: this role sets
them, but not below the article's minimum margin. Below that the managing director signs,
because a structurally loss-making price is a strategy decision, not a pricing decision.

Retail conditions — the annual percentage a grocery chain negotiates — are also this role's,
up to the same ten percent boundary that applies to any discount.

## Notes
### Responsibilities

- Own the assortment for their categories: listing, delisting, clearance.
- Complete the article master: allergens, nutrition, origin, GTIN, shelf life, batch obligation.
- Set channel and country prices, and keep the cost side of the margin honest.
- Negotiate and record retail conditions per customer.
- Plan campaigns and clearance actions for near-expiry stock.
- Bring the category numbers to the weekly margin review.

### Authorized for

- `processes/article-onboarding.md`
- `processes/price-change.md`
- `processes/b2b-retail-order.md`
- `processes/discount-posting.md`

### Not authorized for

- A price below the article's minimum margin — that needs `managing-director`.
- A discount above ten percent — `processes/discount-approval.md`, `managing-director`.
- Anything about batches, quality or stock movement.
- Issuing invoices or credit notes.

### Reports to

`managing-director`

### Sees

Articles, prices, costs, margins, stock levels, sales orders, discounts, customers in their
categories. Supplier terms for the articles they own. Not payments, not payroll, not the
quality decision on a specific batch — they see that it was blocked, not the inspection detail.
