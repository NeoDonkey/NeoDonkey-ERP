# Return

Goods coming back. In a European webshop this is not an exception, it is a legal right: a
consumer may withdraw from a distance contract within fourteen days without giving a reason.
Roughly nothing about that is optional, so the return process is a first-class process and
not an afterthought.

Food makes it harder. Returned food generally cannot go back into sellable stock, because we
cannot vouch for how it was stored on the way. So most returns end in a write-off, and the
commercially interesting question is not "can we resell it" but "why did it come back" — which
is why `reason-code` is required and feeds the weekly quality round.

Retail returns are different again: a pallet refused at goods-in, or a listing delisted and
sent back. Larger, rarer, and negotiated rather than processed.

## Fields
- id: text required — RET-2026-004417.
- sales-order: reference to sales-order required
- sales-order-line: reference to sales-order-line
- customer: reference to customer required
- delivery-note: reference to delivery-note
- article: reference to article required
- batch: reference to batch — From the delivery note, needed for quality analysis.
- quantity: number required
- return-type: text required — consumer-withdrawal, quality-complaint, wrong-article, transport-damage, retail-refusal, delisting.
- reason-code: text required — Short code for the reporting.
- reason-note: text
- announced-date: date required
- received-date: date
- received-at-location: reference to location
- inspection-result: text — resellable, write-off, return-to-supplier.
- resellable-quantity: number
- write-off-quantity: number
- stock-adjustment: reference to stock-adjustment — Created for the write-off.
- credit-note: reference to credit-note
- refund-amount-eur: number
- return-shipping-paid-by: text required — us or customer.
- status: text required — announced, received, inspected, credited, rejected.

## Identified by
id

## Created on demand
no

## Predicates
- consumer withdrawal: return-type is "consumer-withdrawal"
- quality related: return-type is "quality-complaint"
- received: status is "received" and received-date exists
- inspected: status is "inspected" and inspection-result exists
- resellable: inspection-result is "resellable"
- write off required: inspection-result is "write-off"
- creditable: status is "inspected" and credit-note not exists
- credited: credit-note exists
- traceable to batch: batch exists

## References
- `sales-order` → `sales-order`, `sales-order-line` → `sales-order-line`
- `customer` → `customer`, `delivery-note` → `delivery-note`
- `article` → `article`, `batch` → `batch`
- `stock-adjustment` → `stock-adjustment`, `credit-note` → `credit-note`
- `received-at-location` → `location`

## Retention
**10 years** under GoBD as part of the invoice and credit note trail. Quality-related returns
are additionally part of the HACCP record for the batch involved.

## Notes
### consumer withdrawal
The fourteen-day right. No reason is required from the customer and none may be demanded, so
`reason-note` stays optional here even though we would like to know.

### creditable
A return that has been inspected and not yet credited is money we owe the customer. It is
also the most common thing to go silently missing in a webshop, so it is a named predicate
and it appears in the weekly review.

### Used by

`processes/returns-and-credit-notes.md`, `processes/customer-complaint.md`,
`processes/stock-write-off.md`, `management-system/weekly-quality-round.md`
