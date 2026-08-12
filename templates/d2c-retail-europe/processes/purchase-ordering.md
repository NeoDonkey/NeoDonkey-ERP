# Purchase ordering

Buying goods. The purchase order is a promise in both directions: we will take this quantity,
they will deliver it at this price by this date. Everything downstream — the goods receipt
check, the three-way match on the invoice — is a comparison against this document, which is why
it has to be right before it is sent rather than corrected afterwards.

Two gates sit at the front. The supplier has to be approved, which means somebody checked
their certification and somebody else checked their bank details. And an order at or above
10,000 EUR net needs the managing director as well as the purchasing manager, in a separate
signed act — `processes/purchase-order-approval.md`.

For food there is a third thing that experienced buyers always specify and inexperienced ones
always forget: the minimum remaining shelf life on arrival. Agreeing it at order time is a
negotiation; discovering it at goods receipt is an argument.

## Triggered by
A replenishment need: stock below the reorder point, a campaign, a new listing, or a seasonal
buy.

## Rules
If Create order under condition
  supplier approved for ordering and
  delivery-location stock holding and
  currency is "EUR"
then
  Update order with status "draft" and
  Update order with requested-delivery-date and
  Update order with vat-treatment

If Create order-line under condition
  article exists and
  ordered-quantity > 0 and
  agreed-net-price-per-unit-eur > 0
then
  Update order-line with status "open" and
  Update order-line with +open-quantity and
  Update order with +ordered-quantity

If Update order under condition
  net-amount-eur < 10000 and
  supplier approved for ordering
then
  Update order with status "confirmed"

If Create order-line under condition
  article batch managed and
  requested-best-before-minimum-days > 0
then
  Update order-line with status "open" and
  Update order with requires-certificate-of-analysis "yes"

## Notes

The two obligation clauses — `with requested-delivery-date`, `with vat-treatment` — are the
same construction Appendix XII uses for the batch number. They say "this field must be
present", nothing more, and the generated capture screen asks for them.

At or above 10,000 EUR this rule does not fire and the order stays in draft until
`processes/purchase-order-approval.md` runs. There is no path that skips it: the rule that
confirms an order at that value simply does not exist in this file.

## Authorized by
purchasing-manager
