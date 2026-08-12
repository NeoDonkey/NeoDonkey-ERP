# B2B retail order

Forty percent of revenue, a few hundred orders a year, and every one of them matters. A grocery
chain orders pallets against a purchase order number, expects delivery inside a window, pays
sixty days later, and deducts things.

This process is the mirror image of the webshop: we ship before we are paid. So the credit check
replaces the payment check, and it is a real gate rather than a formality — a chain that stops
paying is a chain that owes us six figures.

Three retail-specific things are in the rules because forgetting any of them costs money. Their
purchase order reference must be on our invoice, or accounts payable rejects it and the sixty
days start again. The batch we ship must have enough remaining shelf life, or goods-in refuses
the pallet and we pay for the return. And a supply to a business in another EU member state is
zero-rated only if their VAT ID was validated and we can prove the goods left Germany.

## Triggered by
A purchase order from a retail customer, by EDI, email or the buyer portal.

## Rules
If Create sales-order under condition
  customer business and
  channel is "retail" and
  customer-purchase-order-reference exists
then
  Update sales-order with fulfilment-status "new" and
  Update sales-order with payment-status "on-terms" and
  Update sales-order with requested-delivery-date

If Create sales-order under condition
  customer eu business with valid vat id
then
  Update sales-order with vat-treatment "eu-reverse-charge" and
  Update sales-order with requires-electronic-invoice "yes"

If Update sales-order-line under condition
  sales-order retail order and
  batch retail acceptable and
  status is "new"
then
  Update sales-order-line with status "reserved" and
  Update stock with +reserved-quantity

If Update sales-order under condition
  sales-order releasable on terms
then
  Update sales-order with fulfilment-status "picking"

If Update sales-order under condition
  credit-status is "over-limit"
then
  Update sales-order with fulfilment-status "new" and
  Update customer with status "on-hold"

If Create discount under condition
  discount-type is "retail-condition" and
  discount within agent authority and
  applies-to-customer exists
then
  Update discount with status "active" and
  Update discount with valid-to

## Notes

`retail acceptable` is defined on the batch as released *and* fresh, where fresh is measured
against the article's minimum remaining shelf life. A short-dated pallet is refused here, in our
warehouse, rather than at the retailer's gate — which is the difference between a clearance
discount and a return charge.

The comparison itself — `open-balance-eur > credit-limit-eur` — is expressible in grammar version 1 and
is declared as `over credit limit` on the customer. `credit-status` is used here on purpose rather than
as a workaround: the balance moves between the credit check and the pick, and a pallet should be released
against the figure somebody stood behind at the weekly sweep.

## Authorized by
category-manager or customer-service-agent
