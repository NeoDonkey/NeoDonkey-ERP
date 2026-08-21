# Supplier

A supplier is anyone who invoices us: the importer who sells us cashews, the printer who
makes our pouches, the carrier who moves pallets, the payment provider who takes a
percentage. They are all suppliers because they all end in the same place — an incoming
invoice that has to be verified, approved and paid.

For food suppliers a great deal more is true. We need their VAT identification number to
decide whether reverse charge applies. We need their certifications on file, because our
own organic and IFS status depends on theirs. And we need an honest performance record,
because the quarterly supplier review is only worth holding if the numbers in it were not
invented at the meeting.

## Fields
- id: text required — SUP-0042.
- name: text required — Legal name. In this template all names are invented.
- supplier-type: text required — goods, packaging, carrier, service, co-packer.
- country: text required — ISO country code.
- vat-identification-number: text — Required for any EU supplier outside Germany.
- tax-number: text — For German suppliers without a VAT ID.
- commercial-register-number: text
- vat-treatment: reference to vat-treatment required — How their invoices are booked.
- payment-terms-days: number required — Net days.
- early-payment-discount-percent: number — *Skonto*, if agreed.
- currency: text required — EUR for everything in this template.
- iban-on-file: text required — yes or no. A value, not the IBAN itself; bank details live in the vault, not in the operating model.
- status: text required — prospect, approved, on-hold, blocked.
- food-safety-certification: text — IFS, BRCGS, none.
- certification-valid: text — yes or no, from the quarterly review.
- organic-certification-number: text
- on-time-delivery-percent: number — Rolling twelve months, from goods receipts.
- complaint-count-12m: number — Rolling twelve months.
- last-evaluated-date: date

## Identified by
name

## Displayed by
name

## Created on demand
no

## Predicates
- approved for ordering: status is "approved" and iban-on-file is "yes"
- food supplier: supplier-type is "goods"
- certified: certification-valid is "yes"
- reverse charge supplier: vat-treatment.name is "eu-reverse-charge" and vat-identification-number exists
- blocked: status is "blocked"
- evaluation overdue: last-evaluated-date not exists

## References
- `vat-treatment` → `vat-treatment`
- a supplier is evaluated by → `supplier-evaluation`

## Retention
Supplier master data is retained **10 years** under GoBD after the last transaction.
Certification documents are retained for the period the certification scheme requires,
which for IFS is at least the certificate's validity plus the current audit cycle.

## Notes
### reverse charge supplier
An EU supplier without a valid VAT ID cannot be treated as reverse charge, which means we
would owe the VAT ourselves. This is the most expensive small mistake in cross-border
purchasing, so it is a named predicate rather than an assumption.

### Used by

`processes/purchase-ordering.md`, `processes/supplier-onboarding.md`,
`processes/supplier-invoice-verification.md`,
`management-system/quarterly-supplier-review.md`
