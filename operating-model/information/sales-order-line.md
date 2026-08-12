# Sales order line

One article on one sales order. Stock is reserved per line, picked per line, invoiced per line and
credited per line, so the line is the unit at which almost all of the work happens.

For weight-priced articles the line carries both a quantity and a shipped weight, and the invoiced
amount follows the weight actually shipped. A customer who orders 1 kg of dates and receives 1.03 kg
is billed for 1.03 kg. That is normal in food and it is the reason an invoice cannot simply be a
copy of the order.

The line carries an explicit `position`. So does the purchase order line, and for the same reason:
"line 3" has to mean the same thing in eight years, and a list whose order can change during a merge
cannot promise that.

## Fields
- sales-order: reference to sales-order required — Which order.
- position: number required — Line number. Explicit, never implied by array order.
- article: reference to article required — What was ordered.
- location: reference to location required — Which site it is reserved and picked from.
- batch: reference to batch — Assigned at picking. The traceability link.
- ordered-quantity: number required — What the customer asked for.
- quantity: number required — The quantity this line is moving in the current step.
- reserved-quantity: number required — Currently promised out of stock.
- shipped-quantity: number required — Actually sent.
- shipped-weight-kg: number — For weight-priced articles.
- net-price-per-unit: money required — Agreed unit price.
- net-price-per-kg: money — For weight-priced articles.
- currency: text required — EUR.
- discount-percent: number required — Zero when none.
- net-amount: money required — Line net.
- vat-rate-percent: number required — From the article category and the VAT treatment.
- vat-amount: money required — Line VAT.
- status: one of new, reserved, short, shipped, cancelled, returned required — `short` is not `cancelled`: the customer is still owed something.

## Identified by
sales-order and position

## Created on demand
no

## Predicates
- reserved: status is "reserved"
- fully shipped: status is "shipped"
- short: status is "short"
- weight billed: shipped-weight-kg > 0
- batch assigned: batch exists
- discounted: discount-percent > 0
- invoiceable: status is "shipped" and net-amount > 0
- shortfall: shipped-quantity < ordered-quantity

## Authorized by
- create: customer-service-agent or category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or customer-service-agent or warehouse-clerk or warehouse-management or logistics-coordinator
- update: customer-service-agent or logistics-coordinator or warehouse-management
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
### quantity, and why there are four of them
`ordered-quantity`, `reserved-quantity`, `shipped-quantity` are business facts. `quantity` is the
amount this line is moving *right now*, and it exists because the counter consequent takes its delta
from the trigger's field of the same name and `stock` calls its balance `quantity`. Grammar version 1
has no explicit delta (`runtime/polism/grammar.md` §10, limit 13), so the model carries the name the
grammar needs. It is honest to say that this is the model bending to the language rather than the
other way round, and the exit path is in the grammar file.

### location
Present so that a stock consequent can find the right stock document: stock is identified by article
*and* location, and both must be fields of the triggering document. It is also a genuine business
fact — the same line may be reserved in Berlin and picked in Venlo.

### batch assigned
No line ships without a batch when the article is batch managed. This is the link that makes a recall
possible: article plus batch plus delivery gives you every destination.

### shortfall
`shipped-quantity < ordered-quantity`, a field-to-field comparison. For the webshop a shortfall means
a refund; for retail it means a penalty conversation. Same fact, two different processes.

## Retention

**10 years** under GoBD with its sales order and invoice.

## References

`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`processes/picking-and-shipping.md`, `processes/invoice-issuance.md`
