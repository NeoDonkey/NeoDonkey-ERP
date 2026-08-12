# Stock

How much of one article lies at one location. That is finer than most people expect and it is
the reason a recall takes minutes rather than a weekend.

Stock is never edited directly. It moves only as a consequence of a rule: a goods receipt raises
it, a shipment lowers it, an inventory count corrects it, a write-off removes it. There is
deliberately **no stock-movement entity** here. In a classical ERP you need one because the
database stores only the current balance; in NeoDonkey the movement *is* the signed commit that
changed the balance, and the documents that caused it are already in the history. A movement
table would mean keeping the same fact in two places.

The distinction between physical and available stock is commercial, not technical. Physical
stock includes quarantined and blocked batches; available stock is what the webshop may promise.
Selling quarantined stock is the most common way a food business gets into trouble.

## Fields
- article: reference to article required — What it is.
- location: reference to location required — Where it lies.
- quantity: number — Physical quantity in the article's selling unit.
- reserved-quantity: number — Promised to open sales orders.
- available-quantity: number — What the shop may sell.
- valuation-per-unit: money — Moving average cost, for the balance sheet.
- currency: text — EUR throughout this operating model.
- last-counted-date: date — From the most recent inventory count.

## Identified by
article and location

## Created on demand
yes

## Predicates
- available: available-quantity > 0
- physically present: quantity > 0
- negative: quantity < 0
- over reserved: reserved-quantity > quantity
- counted: last-counted-date exists

## Authorized by
- create: warehouse-clerk or warehouse-management
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management or logistics-coordinator or tax-accountant
- update: warehouse-clerk or warehouse-management or logistics-coordinator
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
### Created on demand: yes
This is a business decision, not a technical convenience, and it belongs here rather than in the
runtime. The first pallet of a new article at a new warehouse must not be refused because no
stock row exists yet — a warehouse clerk at 06:00 cannot be asked to create a database record
first. So a counter consequent against a missing stock document creates it, keyed on article and
location.

### negative
A negative balance is always a counting or modelling error. It is allowed to *happen* — refusing
it would hide the truth — and it is reported in the monthly stock review and cleared by an
inventory count, never by a quiet adjustment.

### over reserved
More promised than physically present. Usually an oversell in the webshop, occasionally a picking
error. Either way somebody is going to be disappointed, and it is better to know now.

## Retention

Balances are a derived view and can always be rebuilt from the documents that caused them. Those
documents — goods-receipt-fact, delivery note, stock-adjustment, inventory count — are
bookkeeping-relevant and retained **10 years** under GoBD. Year-end balances are frozen by the
annual inventory and retained with the accounts.

## References

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`,
`processes/inventory-count.md`, `processes/stock-write-off.md`,
`management-system/monthly-stock-review.md`
