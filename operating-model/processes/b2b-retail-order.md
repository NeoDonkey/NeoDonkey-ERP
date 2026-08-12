# B2B retail order

Forty percent of revenue, a few hundred orders a year, and every one of them matters. A grocery chain
orders pallets against a purchase order number, expects delivery inside a window, pays sixty days
later, and deducts things.

This process is the mirror image of the webshop: we ship before we are paid. So the credit position
replaces the payment check, and it is a real gate rather than a formality — a chain that stops paying
is a chain that owes us six figures.

Two retail-specific facts are conditions below, because forgetting either costs money. Their purchase
order reference must be on our invoice, or accounts payable rejects it and the sixty days start again.
And the ship-from location decides the tax treatment: a pallet from Berlin to a Dutch retailer is an
intra-community supply, while the same pallet from Venlo is a Dutch domestic supply needing a Dutch
registration.

## Triggered by
A purchase order from a retail customer, by EDI, email or the buyer portal.

## Rules

If Create sales-order under condition
  customer exists and
  ship-from-location active and
  vat-treatment active and
  currency is "EUR" and
  net-amount > 0
then
  Update sales-order with fulfilment-status "new" and
  Update sales-order with payment-status

If Create sales-order under condition
  customer not blocked and
  gross-amount > 0
then
  Update sales-order with ship-to-country and
  Update sales-order with vat-treatment

## Notes

### One trigger, both channels
Both rules fire on `Create sales-order`, so they apply to webshop orders as well as retail ones. That
is not laziness: everything they require is true of any sale — a customer, a live ship-from location, a
live tax treatment, a currency, an amount, a destination country. The channel-specific behaviour lives
in `processes/b2c-sales-order.md`, which acts on the *lines*.

### payment-status as an obligation
Every order must state whether it is unpaid, authorised, paid or on terms. Nothing else in the model
can be decided without it: `releasable for picking` and `releasable on terms` in
`information/sales-order.md` are the two credit policies of the company, and both read this field.

### customer not blocked
A blocked customer cannot place an order. `on-hold` still can — the difference is deliberate. On hold
means an unpaid invoice and a conversation to have; blocked means a decision has been taken.

### The credit limit
`over credit limit` on the customer is `open-balance > credit-limit`, a comparison between two fields,
which grammar version 1 supports. What it is *not* used for here is blocking the order at creation:
the balance moves between the check and the pick, so the release decision reads `credit-status`, the
figure somebody stood behind at the weekly credit sweep. Which figure to trust is a business choice,
and it is written down rather than assumed.

## Authorized by
category-manager or customer-service-agent
