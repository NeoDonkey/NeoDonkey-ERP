# Sales order line

One article on one sales order. Stock is reserved per line, picked per line, invoiced per
line and credited per line, so the line is the unit at which almost all of the work
happens.

For weight-priced articles the line carries both an ordered quantity and a shipped weight,
and the invoiced amount follows the weight actually shipped. A customer who orders 1 kg of
dates and receives 1.03 kg is billed for 1.03 kg — that is normal in food, and it is the
reason the invoice cannot simply be a copy of the order.

## Fields
- id: text required — <sales-order>-<position>.
- sales-order: reference to sales-order required
- position: number required
- article: reference to article required
- ordered-quantity: number required
- reserved-quantity: number required
- shipped-quantity: number required
- quantity: number required — The quantity this line is moving *in the current step*: the reserved quantity while reserving, the picked quantity while picking. It exists because the counter form in the rule grammar takes its delta from the trigger document's field of the same name, and stock calls its physical balance quantity. See the note in processes/picking-and-shipping.md.
- shipped-weight-kg: number — Weight-priced articles.
- net-price-per-unit-eur: number required
- net-price-per-kg-eur: number
- discount-percent: number required — 0 when none.
- net-amount-eur: number required
- vat-rate-percent: number required — Resolved from the article's category and the VAT treatment.
- vat-amount-eur: number required
- batch: reference to batch — Set at picking, needed for traceability.
- status: text required — new, reserved, short, shipped, cancelled, returned.

- warehouse-location: reference to warehouse-location required — Which bin it is reserved and picked from. Stock is identified by article and warehouse-location, so a line that moves stock must name both.

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
- invoiceable: status is "shipped" and net-amount-eur > 0

## References
- `sales-order` → `sales-order`
- `article` → `article`
- `batch` → `batch`

## Retention
**10 years** under GoBD with its sales order and invoice.

## Notes
### short
A short line is one we could not fully supply. For the webshop that means a refund; for
retail it means a penalty conversation, which is why the two processes handle it
differently.

### batch assigned
No line is shipped without a batch when the article is batch managed. This is the link
that makes a recall possible: article plus batch plus delivery note gives you every
address a batch reached.

### Used by

`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`processes/picking-and-shipping.md`, `processes/invoice-issuance.md`,
`processes/returns-and-credit-notes.md`
