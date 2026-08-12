# Supplier — dried fruit

**Fruchthandel Berger GmbH & Co. KG**, an invented placeholder for the dried fruit supplier: dates,
mango, apricots, cranberries. Austrian company, so their invoices are the template's worked example of
an intra-community acquisition.

Dried fruit is the category with the most quality complaints, for a boring reason: it is sticky, it
clumps in heat, and a pallet that spent August in a trailer arrives looking wrong without being unsafe.
So the sensory check matters here more than anywhere else, and `release-with-restriction` is a
frequently used decision rather than an exotic one.

## Context

- name: `Fruchthandel Berger GmbH & Co. KG`, supplier-type: `goods`, country: `AT`
- vat-identification-number: Austrian, on file and validated
- vat-treatment: `eu-acquisition` — reverse charge, we self-account
- payment-terms-days: `45`
- iban-on-file: `yes`
- food-safety-certification: `IFS`, certification-valid: `yes`
- organic-certification-number: on file, for the organic date range
- status: `approved`

## Notes

### Why this supplier is in the template
To make the reverse-charge case concrete. Their invoice carries no VAT; we account for the acquisition
tax and deduct it in the same return. The predicate `reverse charge supplier` on
`information/supplier.md` requires the VAT identification number to be *on file* — an EU supplier
treated as reverse charge without one means we owe the VAT ourselves and cannot reclaim it. It is the
cheapest check in this folder and the most frequently skipped.

### Organic certification
Anything sold as organic requires our supplier's certification to be current, because our own status
depends on theirs. A lapsed certificate makes the supplier `on-hold`: existing orders run, new ones
stop, somebody has a conversation. `blocked` is for a decision, `on-hold` is for an expiry date.

### Temperature on arrival
Recorded on the batch for this supplier's summer deliveries. It is the field that turns "the customer
says the dates are clumped" from an argument into a record.

## References

`processes/purchase-ordering.md`, `processes/quality-inspection.md`,
`processes/supplier-invoice-verification.md`, `management-system/quarterly-supplier-review.md`
