# Webshop

The shop itself is a location. That looks like a category error and is not.

A location in POLISM is a place where something happens. Sixty percent of this company's revenue happens
here: orders are placed, prices are shown, VAT is charged, consumer withdrawal rights attach. It has a
channel, an operator, and legal obligations — the *Impressum*, the withdrawal notice, the unit price
display, the allergen information before purchase. Modelling it as "not a location" removes none of that;
it just means the obligations live nowhere.

It is also where the distinction between a *sales* location and a *stock-holding* location earns its keep.
The webshop sells; Berlin and Venlo ship. Which of the two ships a given order decides its VAT treatment,
which is why the webshop is never the `ship-from-location`.

## Context

- name: `webshop`
- location-type: `virtual-channel`
- country: `DE` (the operator's establishment), city: Berlin
- in-eu-customs-union: `true`
- stock-holding: `false`
- operated-by: `own`, channel: `webshop`
- haccp-scope: `false`
- status: `active`

## Notes

### Consumer obligations attached to this location
- Fourteen-day right of withdrawal on distance contracts, with the model withdrawal notice available.
- Prices shown inclusive of VAT, with the unit price per kilogram — which is why weight-priced articles
  carry `net-price-per-kg` and why it is not optional.
- Full allergen and nutrition information available *before* purchase, not only on the pack. That is the
  commercial reason `article sellable` refuses an incomplete article, on top of the legal one.
- Delivery cost and delivery time stated before checkout.

### Marketplaces
A marketplace is a second virtual-channel location with its own document, because the tax position can
differ: on some marketplaces the platform is the deemed supplier and accounts for the VAT itself. If you
sell on one, copy this file and get that answer from your tax adviser before the first order.

### No personal data
This channel is where consumer personal data would enter a live system. None of it is in this folder, and
none should be: a demo instance is copied, shared and published, and a lawful basis does not travel with a
copy.

## References

`processes/b2c-sales-order.md`, `processes/discount-posting.md`,
`processes/returns-and-credit-notes.md`
