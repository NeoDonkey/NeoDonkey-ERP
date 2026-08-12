# Goods receipt

What the warehouse clerk actually fills in when a truck backs up to the dock: which order, which
article, how many, which batch, what best-before date, what condition. It is an intent, not yet a
fact — it is the document whose creation the rules in `processes/goods-receipt.md` check.

Keeping the receipt (the intent) and the goods-receipt-fact (the posted, immutable consequence)
apart is what makes the audit trail honest. The receipt can be refused. The fact, once written, is
never changed; a mistake is corrected by a second fact, the way a bookkeeper corrects an entry.

The quantity is counted, not copied from the supplier's delivery note. Those two numbers differ
often enough in food that treating them as the same number is how phantom stock appears.

## Fields
- quantity: number required — Counted, not copied from the delivery note.
- delivered-quantity: number required — The same number, under the name the order uses.
- order: reference to order required — No receipt without an order.
- order-line: reference to order-line required — Which line arrived.
- article: reference to article required — What arrived.
- location: reference to location required — Which site received it.
- batch-number: text — Required for batch-managed articles. See the rules.
- best-before-date: date — Required for batch-managed articles.
- quality-status: text — Set to quarantined when a batch is created from this receipt.
- shelf-life-status: text — Set to fresh when a batch is created from this receipt.
- weight-kg: number — Weighed, for weight-priced articles.
- delivery-note-reference: text required — The supplier's delivery note number.
- carrier: reference to supplier — Who brought it.
- packaging-intact: boolean required — Whether it arrived undamaged.
- temperature-on-arrival-celsius: number — For temperature-controlled goods.
- pallet-count: number — How many pallets.
- receipt-date: date required — When it arrived.
- received-by: reference to employee required — Who counted it.
- condition-note: text — Damage, short shipment, wrong article.

## Identified by
order-line and receipt-date

## Created on demand
no

## Predicates
- complete: quantity > 0 and delivery-note-reference exists and location exists
- batch documented: batch-number exists and best-before-date exists
- damaged: packaging-intact is false
- weighed: weight-kg > 0
- short delivery: condition-note exists
- positive: quantity > 0

## Authorized by
- create: warehouse-clerk or warehouse-management
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management or tax-accountant
- update: warehouse-management
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
### Why quantity and delivered-quantity are the same number
This is the one place in the model where a field exists for the grammar's sake rather than the
business's, and it is better to say so than to hide it.

The counter consequent `Update stock with +quantity` takes its delta from the trigger's field of
the *same name*, and stock calls its balance `quantity`. The order calls its running total
`delivered-quantity`. Grammar version 1 has no way to write "add the receipt's quantity to the
order's delivered-quantity" (`runtime/polism/grammar.md` §10, limit 13), and its own recommendation
is to name the fields alike. So the receipt carries both names for one number.

The exit path is in the grammar file: `Update order with +delivered-quantity from quantity`. When
that arrives, `delivered-quantity` disappears from this document and nothing else changes.

### batch documented
This is the predicate the manifesto's one-word change turns on. Adding `with batch-number` to the
consequent in `processes/goods-receipt.md` makes the runtime demand a batch number from the next
receipt onward, and generates a capture field for it. Removing the two words removes the
obligation. Nobody writes code either way.

### quality-status and shelf-life-status
Both are declared here only so that they are copied onto a batch created from this receipt — a
batch requires them, and `Create` copies fields declared on both documents. A clerk never types
them; the rules set them to `quarantined` and `fresh`.

## Retention

A goods receipt is a *Warenbewegungsbeleg* and part of the trail behind the supplier invoice and
the stock valuation. **10 years** under GoBD, never deleted.

## References

`processes/goods-receipt.md`, `processes/quality-inspection.md`
