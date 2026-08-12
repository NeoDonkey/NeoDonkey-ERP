# Webshop

The shop itself is a location. That looks like a category error and is not.

A location in POLISM is a place where something happens. Sixty percent of this company's revenue
happens here: orders are placed, prices are shown, VAT is charged, consumer withdrawal rights attach.
It has a channel, it has an operator, it has legal obligations — the *Impressum*, the withdrawal
notice, the price display rules, the cookie consent. Modelling it as "not a location" does not remove
any of that; it just means the obligations live nowhere.

It is also where the distinction between a *sales* location and a *stock-holding* location becomes
useful. The webshop sells; Berlin, Venlo, Lyon and Milan ship. Which of those four ships a given order
decides its VAT treatment, which is why `ship-from-location` is on the sales order and the webshop is
never it.

## Notes
### Site facts

- `id` — `webshop`
- `location-type` — `virtual-channel`
- `country` — `DE` (the operator's establishment)
- `city` — Berlin
- `in-eu-customs-union` — `yes`
- `stock-holding` — `no`
- `operated-by` — `own`
- `channel` — `webshop`
- `haccp-scope` — `no`
- `vat-registration` — `vat-de`
- `status` — `active`

### Processes here

`processes/b2c-sales-order.md`, `processes/discount-posting.md`,
`processes/returns-and-credit-notes.md`, `processes/customer-complaint.md`

### Consumer obligations attached to this location

- Fourteen-day right of withdrawal on distance contracts, with the model withdrawal notice available.
- Prices displayed inclusive of VAT, with the unit price per kilogram — which is why weight-priced
  articles carry `net-price-per-kg-eur`, and why it is not optional.
- Full allergen and nutrition information available before purchase, not only on the pack. This is the
  commercial reason `article sellable` refuses an article without them, on top of the legal one.
- Delivery cost and delivery time stated before checkout.

### Marketplaces

A marketplace is a second virtual-channel location with its own record, because the tax position can
differ: on some marketplaces the platform is the deemed supplier and accounts for the VAT itself. If
you sell on one, copy this file and get that answer from your tax adviser before the first order.
