# Supplier — packaging

**Verpackung Schulz GmbH**, an invented placeholder for the printer who makes the pouches, labels and
shipping cartons.

Packaging is not food and yet it is a food safety supplier, which surprises people. The pouch is in
direct contact with the product, so it needs food-contact compliance documentation. And the label is
where the allergen declaration physically lives — a printing error on an allergen line is a recall,
regardless of how good the nuts inside were.

## Context

- name: `Verpackung Schulz GmbH`, supplier-type: `packaging`, country: `DE`
- vat-identification-number: on file; vat-treatment: `domestic-standard`
- payment-terms-days: `30`
- iban-on-file: `yes`
- food-safety-certification: `BRCGS` (packaging standard), certification-valid: `yes`
- status: `approved`

## Notes

### The label is the allergen declaration
`allergen-declaration` on `information/article.md` is the text; this supplier prints it. Which means a
change to that field is a change to a print file, and a print run that went out before the field was
updated is stock that cannot be sold. The label check in `processes/quality-inspection.md` is what
catches it, and it catches it on incoming *packaging* as well as on incoming food.

### The packaging levy
Germany's *Verpackungsgesetz* requires registration and reporting of packaging placed on the market, by
material and weight. That is why `tare-weight-grams` sits on the article next to the net weight. It is
not modelled as a process in this template; it is named so that it is a decision rather than a fine.

### No real supplier data
Invented name, invented numbers, no personal data.

## References

`processes/purchase-ordering.md`, `processes/article-onboarding.md`,
`management-system/quarterly-supplier-review.md`
