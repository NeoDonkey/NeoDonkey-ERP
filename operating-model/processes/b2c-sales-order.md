# B2C sales order

The webshop. Sixty percent of revenue, thousands of orders a week, and almost nothing goes wrong —
because the money arrives before the parcel leaves. That single ordering of events is what makes the
consumer process short.

What is genuinely hard here is not fulfilment, it is tax. A German webshop selling to a consumer in
France charges German VAT until cross-border B2C sales pass 10,000 EUR across the whole EU in a
calendar year, and French VAT afterwards, through the One-Stop-Shop. The threshold is EU-wide, not per
country, and once passed it is never un-passed — so the tax behaviour of the entire shop changes on a
single day. `information/vat-treatment.md` carries that as `oss threshold exceeded`, one predicate,
one place.

There is a second case that surprises people: once we hold stock in Venlo and ship a Dutch order from
it, that sale is a *domestic Dutch* supply. OSS does not cover it and a local Dutch registration is
required. That is why `ship-from-location` is on the order and why a logistics choice has a tax
consequence.

**No personal data.** Consumer orders in a live system reference a customer record; nothing in this
folder contains a real person's name, address or contact details, and nothing should.

## Triggered by
A consumer completing checkout in the webshop or on a marketplace.

## Rules

If Create sales-order-line under condition
  sales-order exists and
  article sellable and
  ordered-quantity > 0 and
  location stock holding
then
  Update stock with +reserved-quantity and
  Update sales-order-line with status "reserved"

If Create sales-order-line under condition
  net-amount > 0 and
  vat-rate-percent >= 0
then
  Update sales-order with +net-amount and
  Update sales-order with +vat-amount

## Notes

### article sellable
`status is "active" and allergen-declaration exists and nutrition-table exists`. A shop line for an
article whose allergen declaration is missing is refused, and the refusal names the missing field. That
is a labelling obligation under EU 1169/2011, and it is enforced at the moment somebody tries to sell
the thing rather than discovered by an inspector.

### Reserving, not shipping
The line reserves stock; it does not move it. Physical stock leaves in
`processes/picking-and-shipping.md`, against a batch. Keeping reservation and movement apart is what
makes "available" mean something — and selling quarantined stock is the most common way a food business
gets into trouble.

The runtime finds the right stock document because `stock` is `## Identified by article and location`
and the line declares both. That is also why the line carries a `location` at all.

### The order totals
`+net-amount` and `+vat-amount` roll the line up into the order. Both documents declare fields of those
names, which is what makes the counter possible — grammar version 1 takes the delta from the trigger's
field of the same name and has no way to say otherwise.

### What is not enforced here
The OSS threshold does not switch the treatment automatically. Deciding between
`domestic-standard` and `oss-distance-sale` is a branch, and grammar version 1 has none: every rule on
a trigger is a hard requirement, so a rule cannot choose. The treatment is therefore set on the order
when it is created — by the shop, reading `oss threshold exceeded` — and the rules require it to be a
live treatment. The check that it was set *correctly* happens in the month-end close. That is a real
gap, and the exit path is a branch form in the grammar rather than anything in this file.

## Authorized by
customer-service-agent or category-manager
