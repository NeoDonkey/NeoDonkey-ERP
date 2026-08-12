# B2C sales order

The webshop. Sixty percent of revenue, thousands of orders a week, and almost nothing goes
wrong — because the money arrives before the parcel leaves. That single ordering of events is
what makes the consumer process short.

What is genuinely hard here is not fulfilment, it is tax. A German webshop selling to a consumer
in France charges German VAT until cross-border B2C sales pass 10,000 EUR across the whole EU in
a calendar year, and French VAT afterwards, declared through the One-Stop-Shop. The threshold is
EU-wide, not per country, and it is passed once and then never un-passed. So the tax behaviour of
the entire webshop changes on a single day, and the rules below read one predicate —
`vat-registration threshold exceeded` — rather than scattering the logic.

There is a second case that surprises people: once we hold stock in a Dutch warehouse and ship a
Dutch consumer order from it, that sale is a *domestic Dutch* supply. OSS does not cover it and a
local Dutch registration is required. That is why `ship-from-location` is on the sales order and
why the logistics decision has a tax consequence.

**No personal data.** Consumer orders in the live system reference a customer record; nothing in
this template contains a real person's name, address or contact details, and nothing should.

## Triggered by
A consumer completing checkout in the webshop or on a marketplace.

## Rules
If Create sales-order under condition
  customer consumer and
  channel is "webshop" and
  net-amount-eur > 0
then
  Update sales-order with fulfilment-status "new" and
  Update sales-order with payment-status "unpaid" and
  Update sales-order with vat-treatment

If Create sales-order under condition
  customer consumer and
  customer not domestic and
  vat-registration threshold exceeded
then
  Update sales-order with vat-treatment "oss-distance-sale"

If Create sales-order under condition
  customer consumer and
  customer not domestic and
  vat-registration not threshold exceeded
then
  Update sales-order with vat-treatment "domestic-standard"

If Create sales-order under condition
  customer consumer and
  ship-from-location locally vat registered and
  ship-from-location not virtual
then
  Update sales-order with vat-treatment "local-registration"

If Update sales-order-line under condition
  sales-order paid and
  status is "new"
then
  Update sales-order-line with status "reserved" and
  Update stock with +reserved-quantity

If Update sales-order under condition
  sales-order releasable for picking
then
  Update sales-order with fulfilment-status "picking"

## Notes

Two rules, one threshold, and the whole cross-border VAT position of the company in six
readable lines. This is the part that a tax adviser can check in thirty seconds and that in a
classical system takes a consultant a week to locate.

The whole B2C credit policy, in one predicate. `releasable for picking` is defined on the sales
order as reserved *and* paid. There is no rule in this file that releases an unpaid consumer
order, and that absence is the control.

## Authorized by
customer-service-agent
