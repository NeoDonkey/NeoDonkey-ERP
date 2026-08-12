# Credit note

The only legitimate way to change an issued invoice. A credit note reverses all or part of one and
carries a reason. Together, the invoice and the credit note tell the whole story, and neither is ever
edited.

That matters more than it sounds. The temptation in every system is to "just fix" a wrong invoice, and
every auditor's first test is whether that is possible. Here it is not: no rule in this folder issues
an `Update invoice` that touches an amount, and the absence is the control.

A credit note is technically an invoice type in EN 16931 — code `381` — and carries the same mandatory
fields, including the reference to the invoice it corrects.

## Fields
- credit-note-number: text required — From a gapless sequence.
- credit-note-date: date required — When it was issued.
- invoice-type-code: text required — 381.
- corrects-invoice: reference to invoice required — BT-25, the preceding invoice reference.
- customer: reference to customer required — Who gets it.
- sales-order: reference to sales-order — Where it came from.
- reason-code: text required — goods-returned, quality-complaint, short-delivery, pricing-error or goodwill.
- reason-note: text required — Free text, because a code never says enough.
- net-amount: money required — Positive number; the direction is in the type code.
- vat-amount: money required — Matching the original treatment.
- gross-amount: money required — What we owe back.
- currency: text required — EUR.
- vat-treatment: reference to vat-treatment required — Must match the original invoice.
- vat-exemption-reason: text — Carried over where the original was exempt.
- delivery-format: text required — Same as the original invoice.
- structured-document-reference: text — Stored XML, where the format is structured.
- archived-format-hash: text — Hash of the exact bytes sent.
- status: one of draft, issued, sent, settled required — `settled` means the money went back, not that the note was written.
- approved-by: reference to employee — Required above the goodwill threshold.
- approval-date: date — When it was approved.

## Identified by
credit-note-number

## Created on demand
no

## Predicates
- justified: reason-code exists and reason-note exists
- references original: corrects-invoice exists
- goodwill: reason-code is "goodwill"
- needs approval: net-amount > "100.00 EUR"
- approved: approved-by exists and approval-date exists
- issued: status is "issued"
- vat treatment stated: vat-treatment exists

## Authorized by
- create: customer-service-agent or accountant
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or customer-service-agent or tax-accountant
- update: accountant
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
### references original
A credit note that does not say which invoice it corrects is not a credit note, it is a hole in the
bookkeeping. The rule refuses it.

### needs approval
One hundred euros. Below it a customer service agent settles a complaint on their own authority,
which is the entire point of having them; above it the managing director signs. The boundary is a
number in this file that anybody can read, rather than a permission buried in a configuration screen
nobody has reviewed since 2019.

### vat treatment must match the original
A credit note with a different VAT treatment from the invoice it corrects is one of the few errors
that reliably survives undetected until an audit. Version 1 of the grammar cannot compare a field of
this document against a field of the referenced invoice in one hop through two entities, so the rule
requires the treatment to be *stated* and the match is checked in the monthly close. That is a real
gap and it is named rather than glossed.

## Retention

**10 years** under GoBD, immutable, alongside the invoice it corrects. Where the original was an
XRechnung, the credit note goes out in the same format and the XML is archived byte-identically.

## References

`processes/returns-and-credit-notes.md`, `processes/goodwill-approval.md`,
`management-system/weekly-margin-review.md`
