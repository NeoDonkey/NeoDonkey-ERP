# Sales order

What a customer has asked us to deliver. The same entity serves the webshop and the retail
channel, but the two travel through very different processes: a webshop order is paid
before it is picked, a retail order is picked before it is paid. That single difference
drives almost everything else, so `channel` is tested early and often.

The sales order is also where the tax decision is made and frozen. By the time an invoice
is issued the question "which VAT applies" must already be answered, because the answer
depends on facts at the moment of sale — the customer's country, their VAT ID, our OSS
registration — and those facts can change afterwards.

## Fields
- id: text required — SO-2026-114872.
- customer: reference to customer required
- channel: text required — webshop, retail, marketplace.
- order-date: date required
- requested-delivery-date: date — Retail orders have delivery windows.
- ship-from-location: reference to location required
- ship-to-country: text required — ISO code. The other half of the VAT decision.
- currency: text required — EUR.
- net-amount-eur: number required
- vat-amount-eur: number required
- gross-amount-eur: number required
- vat-treatment: reference to vat-treatment required — Frozen at order time.
- discount: reference to discount
- payment-status: text required — unpaid, authorised, paid, failed, on-terms.
- fulfilment-status: text required — new, reserved, picking, shipped, cancelled.
- customer-purchase-order-reference: text — Retail buyers require theirs on the invoice.
- delivery-window-start: date
- delivery-window-end: date
- requires-electronic-invoice: text required — yes or no.
- credit-status: text — ok, over-limit, blocked. Derived, weekly sweep.

- vat-registration: reference to vat-registration — The registration this sale is declared under. Named on the order so the OSS threshold can be read from it.

## Identified by
customer and order-date

## Created on demand
no

## Predicates
- webshop order: channel is "webshop"
- retail order: channel is "retail"
- paid: payment-status is "paid"
- releasable for picking: fulfilment-status is "reserved" and payment-status is "paid"
- releasable on terms: fulfilment-status is "reserved" and payment-status is "on-terms" and credit-status is "ok"
- shipped: fulfilment-status is "shipped"
- cancelled: fulfilment-status is "cancelled"
- reverse charge sale: vat-treatment.name is "eu-reverse-charge"
- oss distance sale: vat-treatment.name is "oss-distance-sale"
- export sale: vat-treatment.name is "export"

## References
- `customer` → `customer`
- `ship-from-location` → `location`
- `vat-treatment` → `vat-treatment`
- `discount` → `discount`
- a sales order has many → `sales-order-line`

## Retention
**10 years** under GoBD as the commercial document behind the invoice.

## Notes
### releasable for picking
The webshop condition. No parcel leaves before the money has arrived, which is why the
B2C process is short and boring and almost never goes wrong.

### releasable on terms
The retail condition. Here we do ship before payment, so the credit check replaces it.

### Used by

`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`processes/picking-and-shipping.md`, `processes/invoice-issuance.md`,
`processes/discount-posting.md`, `processes/returns-and-credit-notes.md`
