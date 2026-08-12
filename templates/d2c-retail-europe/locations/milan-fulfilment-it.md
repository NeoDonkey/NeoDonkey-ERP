# Milan fulfilment (IT)

A partner warehouse for Italian webshop orders. Italy is in the template for a reason beyond volume:
it has the most developed electronic invoicing regime in Europe, and it changes what "issue an invoice"
means.

Italian domestic B2B and B2C invoices go through *Sistema di Interscambio* — the tax authority's own
clearing house. An invoice is not issued when we send it to the customer; it is issued when SdI
accepts it. That is a structurally different model from Germany's, where the invoice is between the
parties and the tax authority sees it only in an audit.

For this template that means one thing: `delivery-format` on the invoice is not a formatting
preference, it is a jurisdictional fact, and adding a new one is a dialect (Principle 5) rather than a
feature. The SdI dialect is not implemented in this template — it is named here so that nobody
discovers it after committing to Italian domestic sales.

## Notes
### Site facts

- `id` — `milan-fulfilment-it`
- `location-type` — `fulfilment-partner`
- `country` — `IT`
- `city` — Milan
- `in-eu-customs-union` — `yes`
- `stock-holding` — `yes`
- `operated-by` — `partner`
- `partner` — `SUP-0073` (Logistica Fontana S.r.l., an invented placeholder)
- `haccp-scope` — `yes`
- `vat-registration` — `vat-it`
- `status` — `active`

### Processes here

`processes/goods-receipt.md`, `processes/picking-and-shipping.md`, `processes/inventory-count.md`

### Tax position

Italian VAT registration `vat-it`, `registration-type` `foreign-local`. Domestic Italian supplies at
Italian rates, cleared through SdI. Cross-border sales from here to other member states go through
OSS.

### Not implemented

The SdI dialect. Invoices for Italian domestic sales are currently prepared here and transmitted
outside the operating model. This is an honest gap, written down rather than discovered: see the
`NEEDS-GRAMMAR` and dialect notes in the template README.
