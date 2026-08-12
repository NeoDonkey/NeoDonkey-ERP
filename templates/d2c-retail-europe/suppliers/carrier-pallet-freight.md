# Supplier — pallet freight forwarder

**Spedition Wagner GmbH**, an invented placeholder for the forwarder moving pallets to grocery
retailers and to the fulfilment partners, and handling the Swiss customs leg.

This is the supplier that turns the retail delivery window into a promise or a penalty. Grocery chains
book goods-in slots; a truck that misses one is turned away, comes back the next day, and the shortfall
appears in a listing fee negotiation four months later.

## Context

- name: `Spedition Wagner GmbH`, supplier-type: `carrier`, country: `DE`
- vat-identification-number: on file; vat-treatment: `domestic-standard`
- payment-terms-days: `30`
- iban-on-file: `yes`
- food-safety-certification: `none` — sealed pallets
- status: `approved`

## Notes

### They collect the proof of transport
The single most valuable thing this supplier does that nobody thinks about. A zero-rated
intra-community supply needs a *Gelangensbestätigung* — evidence the goods left Germany. The forwarder's
signed delivery confirmation is that evidence, and `proof-of-transport` plus
`proof-of-transport-reference` on `information/delivery-note.md` are where it lands.

Without it, the supply is re-assessed at 19 % three years later, when the customer is long gone. The
predicate is `transport proven`, and it needs both parts: a `yes` with no stored reference is worthless.

### The Swiss leg
Switzerland is not in the EU customs union, so every pallet to Zurich needs an export declaration with a
tariff number per article. This forwarder acts as customs broker — `broker` on
`information/customs-declaration.md`. Freight for an export can itself be zero-rated, and the customs
handling fee is a different thing again; neither is modelled here, both are named.

### Delivery windows
Retail penalties are real money and are usually deducted unilaterally from the next payment, which is
why `unexplained-difference-eur` exists on `information/payment.md`.

## References

`processes/picking-and-shipping.md`, `processes/customs-declaration.md`,
`processes/incoming-payment-matching.md`, `management-system/quarterly-supplier-review.md`
