# Stock

Stock is the answer to "how much of this do we have, where, and may we sell it". One
stock record is one article in one batch at one warehouse location. That is finer than
most people expect, and it is the reason a recall takes minutes rather than a weekend.

Stock is never edited directly. It moves only as a consequence of a rule: a goods
receipt raises it, a delivery note lowers it, an inventory count corrects it, a write-off
removes it. There is deliberately **no separate stock-movement entity** here. In a
classical ERP you need one because the database only stores the current balance; in
NeoDonkey the movement *is* the commit that changed the balance, signed and timestamped,
and the documents that caused it — goods-receipt-fact, delivery-note, stock-adjustment —
are already in the history. Adding a movement table would mean keeping the same fact in
two places. If the balance and the history ever disagree, the history wins.

The distinction between physical and available stock matters commercially. Physical
stock includes quarantined and blocked batches; available stock is what the webshop is
allowed to promise. Selling quarantined stock is the single most common way a food
business gets into trouble.

## Fields
- id: text required — STK-<article>-<batch>-<location>.
- article: reference to article required
- batch: reference to batch — Empty only for articles that are not batch managed.
- warehouse-location: reference to warehouse-location required
- quantity: number required — Physical quantity in the article's selling unit.
- reserved-quantity: number required — Promised to open sales orders.
- available-quantity: number required — Physical minus reserved, minus anything not released.
- weight-kg: number — For weight-priced articles.
- last-counted-date: date — From the most recent inventory count.
- valuation-per-unit-eur: number required — Moving average cost in EUR, for the balance sheet.

## Identified by
article and warehouse-location

## Created on demand
yes

## Predicates
- available: available-quantity > 0
- physically present: quantity > 0
- negative: quantity < 0
- counted recently: last-counted-date exists
- sellable stock: available-quantity > 0 and batch released for sale

## References
- `article` → `article`
- `batch` → `batch`
- `warehouse-location` → `warehouse-location`

## Retention
Stock balances are a derived view and can always be rebuilt from the documents that caused
them. Those documents are bookkeeping-relevant and retained **10 years** under GoBD.
Year-end balances are frozen by the inventory count and retained with the annual accounts.

## Notes
### negative
A negative stock balance is always a modelling or counting error. It is allowed to
happen — refusing it would hide the truth — but it is reported in the monthly stock
review and must be cleared by an inventory count, not by an adjustment nobody sees.

### sellable stock
This reaches through the declared `batch` reference to a predicate declared on the batch, which grammar
version 1 supports for one hop. Two hops — the batch's article's minimum shelf life — it does not
(`runtime/polism/grammar.md` §10 limit 3), which is why the shelf-life classification is derived onto
the batch instead of computed here.
     condition line with `batch` as its subject. -->

### Used by

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`,
`processes/inventory-count.md`, `processes/stock-write-off.md`,
`management-system/monthly-stock-review.md`
