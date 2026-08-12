# Sales order

What a customer has asked us to deliver. One kind of document serves the webshop and the retail
channel, but the two travel through genuinely different processes: a webshop order is paid before it
is picked, a retail order is picked before it is paid. That single difference drives almost
everything else, so `channel` is tested early and often.

The sales order is also where the tax decision is made and frozen. By the time an invoice is issued
the question "which VAT applies" must already be answered, because the answer depends on facts at
the moment of sale — the customer's country, their VAT identification number, our OSS position — and
those facts change afterwards.

`ship-from-location` is on this document rather than on the shipment for the same reason. Shipping a
French consumer order from Lyon rather than Berlin looks like a freight decision and is also the
decision that makes the sale a French domestic supply.

## Fields
- customer: reference to customer required — Who ordered.
- channel: text required — webshop, retail or marketplace.
- order-date: date required — When they ordered.
- requested-delivery-date: date — Retail orders have delivery windows.
- ship-from-location: reference to location required — Which site ships it. A tax decision.
- ship-to-country: text required — ISO code. The other half of the VAT decision.
- currency: text required — EUR.
- net-amount: money required — Total net.
- vat-amount: money required — Total VAT.
- gross-amount: money required — What they pay.
- vat-treatment: reference to vat-treatment required — Frozen at order time.
- discount: reference to discount — Where one applies.
- payment-status: text required — unpaid, authorised, paid, failed or on-terms.
- fulfilment-status: text required — new, reserved, picking, shipped or cancelled.
- customer-purchase-order-reference: text — Retail buyers require theirs on the invoice.
- requires-electronic-invoice: boolean required — Whether an XRechnung is needed.
- credit-status: text — ok, over-limit or blocked. Copied from the customer at order time.

## Identified by
customer and order-date

## Created on demand
no

## Predicates
- webshop order: channel is "webshop"
- retail order: channel is "retail"
- paid: payment-status is "paid"
- on terms: payment-status is "on-terms"
- reserved: fulfilment-status is "reserved"
- releasable for picking: fulfilment-status is "reserved" and payment-status is "paid"
- releasable on terms: fulfilment-status is "reserved" and payment-status is "on-terms" and credit-status is "ok"
- shipped: fulfilment-status is "shipped"
- cancelled: fulfilment-status is "cancelled"
- credit blocked: credit-status is "over-limit"
- has buyer reference: customer-purchase-order-reference exists

## Authorized by
- create: customer-service-agent or category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or customer-service-agent or warehouse-clerk or warehouse-management or logistics-coordinator or tax-accountant
- update: customer-service-agent or logistics-coordinator
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
### releasable for picking
The B2C condition, and the entire consumer credit policy in one line: reserved *and* paid. There is
no rule anywhere in this folder that releases an unpaid consumer order, and that absence is the
control — stronger than a check somebody could switch off.

### releasable on terms
The B2B condition. Here we do ship before payment, so the credit check replaces it. Same shape, one
different word, completely different commercial risk.

### Why the tax treatment is frozen here
A customer can update their VAT identification number next month; our OSS threshold can be crossed
next week. The invoice must reflect the situation at the moment of sale, so the treatment is decided
on this document and the invoice reads it rather than recomputing it.

## Retention

**10 years** under GoBD as the commercial document behind the invoice.

## References

`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`processes/picking-and-shipping.md`, `processes/invoice-issuance.md`,
`processes/discount-posting.md`
