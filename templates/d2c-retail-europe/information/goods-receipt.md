# Goods receipt

The goods receipt is what the warehouse clerk actually fills in when a truck backs up to
the dock: which order, which article, how many, which batch, what best-before date, what
condition. It is an intent, not yet a fact — it is the document whose creation the rules
in `processes/goods-receipt.md` check.

Keeping the receipt (the intent) and the goods-receipt-fact (the posted, immutable
consequence) apart is what makes the audit trail honest. The receipt can be refused. The
fact, once written, is never changed; a mistake is corrected by a second fact, the way a
bookkeeper corrects a bookkeeping entry.

## Fields
- id: text required — GR-0001.
- order: reference to order required — No receipt without an order.
- order-line: reference to order-line required
- article: reference to article required
- quantity: number required — Counted, not copied from the delivery note.
- weight-kg: number — Weighed, for weight-priced articles.
- batch-number: text — Required for batch-managed articles. See the rules.
- best-before-date: date — Required for batch-managed articles.
- warehouse-location: reference to warehouse-location required — Where it was put away.
- received-at-location: reference to location required — Which site received it.
- delivery-note-reference: text required — The supplier's delivery note number.
- carrier: reference to supplier — Who brought it.
- packaging-intact: text required — yes or no.
- temperature-on-arrival-celsius: number
- pallet-count: number
- received-by: reference to employee required
- receipt-date: date required
- condition-note: text — Free text for damage, short shipment, wrong article.

## Identified by
order-line and receipt-date

## Created on demand
no

## Predicates
- complete: quantity > 0 and delivery-note-reference exists and warehouse-location exists
- batch documented: batch-number exists and best-before-date exists
- damaged: packaging-intact is "no"
- weighed: weight-kg > 0
- short delivery: condition-note exists

## References
- `order` → `order`
- `order-line` → `order-line`
- `article` → `article`
- `warehouse-location` → `warehouse-location`
- `received-at-location` → `location`
- `carrier` → `supplier`
- `received-by` → `employee`

## Retention
A goods receipt is a *Warenbewegungsbeleg* and part of the trail behind the supplier
invoice and the stock valuation. **10 years** under GoBD. Never deleted.

## Notes
### batch documented
This is the predicate the manifesto's one-word change turns on. Adding `with batch-number`
to the consequent of the goods-receipt rule makes the runtime demand this from the next
receipt onward. Nothing else changes.

### Used by

`processes/goods-receipt.md`, `processes/quality-inspection.md`,
`processes/supplier-invoice-verification.md`
