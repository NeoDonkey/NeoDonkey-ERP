# Venlo fulfilment (NL)

A third-party warehouse in the Netherlands, operated by a partner, holding stock for Dutch and Belgian
webshop orders. Venlo because that is where European fulfilment sits — twenty kilometres from the German
border, an hour from Rotterdam.

This site is in the model to make one thing unavoidable: **holding stock in another member state is a tax
decision, not a logistics decision.** A Dutch consumer order shipped from Venlo is a Dutch *domestic*
supply. The One-Stop-Shop does not cover it. A Dutch VAT registration is required, with Dutch rates and a
Dutch return. Companies find this out from a letter.

The second consequence is quality. Stock at a partner site is still our stock and still our HACCP scope.
Batches held here need the same release discipline, and reconciling the partner's stock report against
ours is a standing item in the monthly stock review — partner stock and own stock diverge, always.

## Context

- name: `venlo-fulfilment-nl`
- location-type: `fulfilment-partner`
- country: `NL`, city: Venlo
- in-eu-customs-union: `true`
- stock-holding: `true`
- operated-by: `partner`, partner: `Logistiek Van Dijk B.V.` (an invented placeholder)
- haccp-scope: `true`
- vat-registration: the Dutch local registration
- status: `active`

## Notes

### What happens here, and what does not
Goods receipt, picking and counting happen here. **Quality inspection does not.** Batches are released in
Berlin before being transferred, because we do not delegate the release decision to a partner — the
release is the one decision in this company that cannot be outsourced.

### Tax position
Sales from this site to Dutch consumers are domestic Dutch supplies at Dutch rates. Sales from here to
Belgian consumers are cross-border distance sales through OSS. The same article can therefore carry two
different VAT treatments in the same week depending on where it shipped from — which is exactly why
`ship-from-location` is a field on the sales order and not an afterthought.

### What to change first
Delete this file if you do not hold stock abroad, and delete the Dutch registration with it. Keeping a
foreign registration you do not need generates filing obligations you will forget.

## References

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`,
`management-system/monthly-stock-review.md`
