# Supplier

A supplier is anyone who invoices us: the importer who sells us cashews, the printer who makes
our pouches, the carrier who moves pallets. They are all suppliers because they all end in the
same place — an incoming invoice that has to be verified, approved and paid.

For food suppliers a great deal more is true. We need their VAT identification number to decide
whether reverse charge applies, and an EU supplier without a valid one cannot be treated that way
— which means we would owe the VAT ourselves. We need their certifications on file, because our
own organic and IFS status depends on theirs. And we need an honest performance record, because a
quarterly supplier review is only worth holding if the numbers were not invented at the meeting.

All supplier names in this operating model are invented placeholders. There is no real supplier
data and no personal data of any individual anywhere in this folder.

## Fields
- name: text required — Legal name. Invented throughout this model.
- supplier-type: text required — goods, packaging, carrier, service or co-packer.
- country: text required — ISO country code.
- vat-identification-number: text — Required for any EU supplier outside Germany.
- vat-treatment: reference to vat-treatment required — How their invoices are booked.
- payment-terms-days: number required — Net days.
- early-payment-discount-percent: number — Skonto, where agreed.
- currency: text required — EUR throughout.
- iban-on-file: boolean required — Whether bank details were checked. Not the details themselves.
- status: one of prospect, approved, on-hold, blocked required — Only `approved` may be ordered from: processes/supplier-approval.md sets it.
- food-safety-certification: text — IFS, BRCGS or none.
- certification-valid: boolean — From the quarterly review.
- organic-certification-number: text — Where they supply organic goods.
- on-time-delivery-percent: number — Rolling twelve months, from goods receipts.
- complaint-count-12m: number — Rolling twelve months.
- last-evaluated-date: date — When the quarterly review last looked at them.

## Identified by
name

## Created on demand
no

## Predicates
- approved for ordering: status is "approved" and iban-on-file is true
- food supplier: supplier-type is "goods"
- certified: certification-valid is true
- reverse charge supplier: vat-identification-number exists
- blocked: status is "blocked"
- on hold: status is "on-hold"
- evaluation overdue: last-evaluated-date not exists

## Authorized by
- create: purchasing-manager or category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or treasurer or tax-accountant
- update: quality-manager or controller or purchasing-manager
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): the
`- <operation>: <roles>` bullets govern every operation on this entity that no process rule covers. Without
them, an uncovered operation is open to an actor with no role at all — grammar version 1's permissive default,
and the defect Part 4's standing rule 4 was written about. Where a rule *does* cover the operation, the rule's
authority wins and these bullets are not consulted.

`delete` is the managing director everywhere, and it should almost never be used: a document that ten years of
other documents point at is retired by a status change, not removed. `read` is wide, because reading changes
nothing and an audit needs the lot.
### approved for ordering
Two conditions, deliberately checked by two different people. The certification is the quality
manager's; the bank details are the accountant's. A purchaser who could both create a supplier and
pay it is the standard invoice-fraud setup in a mid-sized company, so the approval is assembled by
one role and completed by others.

### iban-on-file is a boolean, not an IBAN
Bank details do not live in the operating model. This field records that somebody checked them
against something other than the email that asked for the change.

### reverse charge supplier
Having the number, not intending to have it. An EU acquisition treated as reverse charge without a
VAT identification number on file is the most expensive small mistake in cross-border purchasing.

## Retention

Supplier master data is retained **10 years** under GoBD after the last transaction. Certification
documents are retained for the period the certification scheme requires, which the ten-year rule
covers comfortably.

## References

`processes/purchase-ordering.md`, `processes/goods-receipt.md`,
`suppliers/supplier-cashew-nuts.md`, `management-system/quarterly-supplier-review.md`
