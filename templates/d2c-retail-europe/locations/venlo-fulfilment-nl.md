# Venlo fulfilment (NL)

A third-party warehouse in the Netherlands, operated by a partner, holding stock for Dutch and Belgian
webshop orders. Venlo because it is where European fulfilment sits, twenty kilometres from the German
border and an hour from Rotterdam.

This site exists in the template to make one thing unavoidable: **holding stock in another member
state is a tax decision, not a logistics decision.** A Dutch consumer order shipped from Venlo is a
Dutch *domestic* supply. The One-Stop-Shop does not cover it. A Dutch VAT registration is required,
with Dutch rates and a Dutch return. Companies find this out from a letter.

The second consequence is quality. Stock at a partner site is still our stock and still our HACCP
scope. Batches held here need the same release discipline, and reconciling their stock report against
ours is a standing item in the monthly stock review — partner stock and own stock diverge, always.

## Notes
### Site facts

- `id` — `venlo-fulfilment-nl`
- `location-type` — `fulfilment-partner`
- `country` — `NL`
- `city` — Venlo
- `in-eu-customs-union` — `yes`
- `stock-holding` — `yes`
- `operated-by` — `partner`
- `partner` — `SUP-0071` (Logistiek Van Dijk B.V., an invented placeholder)
- `haccp-scope` — `yes`
- `vat-registration` — `vat-nl`
- `status` — `active`

### Processes here

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`, `processes/inventory-count.md`

Quality inspection is *not* here. Batches are released in Berlin before being transferred, because we
do not delegate the release decision to a partner.

### Tax position

Dutch VAT registration `vat-nl`, `registration-type` `foreign-local`. Sales from this site to Dutch
consumers are domestic Dutch supplies at Dutch rates. Sales from here to Belgian consumers are
cross-border distance sales and go through OSS. The same article can therefore carry two different
VAT treatments in the same week depending on where it shipped from — which is why
`ship-from-location` is a field on the sales order and not an afterthought.

### What to change first

Delete this file if you do not hold stock abroad, and delete `vat-nl` with it. Keeping a foreign
registration you do not need generates filing obligations you will forget.
