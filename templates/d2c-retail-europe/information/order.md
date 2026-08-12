# Order

An order is what we send to a supplier: please deliver these articles, this quantity, to
this location, by this date, at this price. In this template "order" always means a
purchase order. What a customer places is a `sales-order`, and keeping the two words apart
saves an enormous amount of confusion later.

An order is the document a goods receipt is checked against. That check is the whole
point: a delivery without an order is either a gift or a mistake, and neither should
silently increase stock. The order also carries the commercial agreement — the agreed
price per unit, which is what an incoming supplier invoice is verified against.

The important derived number on an order is `open-quantity`: how much has been ordered
but not yet received. It starts at the ordered total and is reduced by every goods
receipt. When it reaches zero the order is fully delivered. That is a single number
rather than a walk over all the lines, deliberately, because it makes "fully delivered"
a thing you can read rather than a thing you have to compute.

## Fields
- id: text required — Our purchase order number, e.g. PO-2026-0417.
- supplier: reference to supplier required
- delivery-location: reference to location required — Where the goods must arrive.
- order-date: date required
- requested-delivery-date: date required
- currency: text required — EUR for everything in this template.
- net-amount-eur: number required — Agreed total net value in EUR.
- ordered-quantity: number required — Sum over the lines, in selling units.
- open-quantity: number required — Ordered minus received. Maintained by goods receipt.
- status: text required — draft, confirmed, partially-delivered, delivered, cancelled.
- incoterms: text — DAP, FCA, EXW. Decides who carries freight and risk.
- vat-treatment: reference to vat-treatment required — Domestic, EU reverse charge, or import.
- supplier-confirmation-reference: text — Their order confirmation number.
- requires-certificate-of-analysis: text required — yes or no.
- created-by: reference to employee required
- approved-by: reference to employee — Required above the approval threshold.

## Identified by
supplier and order-date

## Created on demand
no

## Predicates
- fully delivered: open-quantity = 0
- already fully delivered: fully delivered
- partially delivered: status is "partially-delivered"
- confirmed: status is "confirmed"
- open: status is not "delivered" and status is not "cancelled"
- receivable: status is "confirmed" and open-quantity > 0
- needs approval: net-amount-eur >= 10000
- approved: approved-by exists
- import order: vat-treatment.name is "import"

## References
- `supplier` → `supplier`
- `delivery-location` → `location`
- `vat-treatment` → `vat-treatment`
- `created-by`, `approved-by` → `employee`
- an order has many → `order-line`

## Retention
Purchase orders are commercial correspondence and part of the trail behind every supplier
invoice. **10 years** under GoBD, counted from the end of the year in which the order was
last changed.

## Notes
### fully delivered
Also written as `already fully delivered`, which reads better after a `not`. This is the
predicate the goods receipt in Appendix XII refers to. If you want partial deliveries to
count as complete once they are close enough, this one line is where you change it — and
nothing else in the system needs to know.

### receivable
An order that is not `receivable` cannot take a goods receipt. A draft order has not been
sent to anybody, so goods arriving against it mean something went wrong upstream.

### needs approval
Ten thousand euros net. Below it the purchasing manager sends the order alone; at or above it
the managing director signs too, as a separate commit. The number lives here, in the open,
and moving it is a visible change to the company rather than a setting somebody adjusted.

### Used by

`processes/purchase-ordering.md`, `processes/purchase-order-approval.md`,
`processes/goods-receipt.md`, `processes/supplier-invoice-verification.md`
