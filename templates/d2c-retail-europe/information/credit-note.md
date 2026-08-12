# Credit note

The only legitimate way to change an issued invoice. A credit note reverses all or part of
an invoice and carries a reason. Together, the original invoice and the credit note tell
the whole story, and neither of them is ever edited.

This matters more than it sounds. The temptation in every system is to "just fix" a wrong
invoice, and every auditor's first test is whether that is possible. In this template it is
not: no rule anywhere issues an `Update invoice` that touches an amount, and the entity
notes say so explicitly.

A credit note is technically an invoice type in EN 16931 — code `381` — and carries the same
mandatory fields, including the reference to the invoice it corrects.

## Fields
- id: text required
- credit-note-number: text required — From the same gapless sequence as invoices, or a separate gapless sequence. One or the other, consistently.
- credit-note-date: date required
- invoice-type-code: text required — 381.
- corrects-invoice: reference to invoice required — (BT-25 preceding invoice reference).
- customer: reference to customer required
- sales-order: reference to sales-order
- return: reference to return — Set when goods came back.
- reason-code: text required — goods-returned, quality-complaint, short-delivery, pricing-error, goodwill.
- reason-note: text required — Free text, because the code never says enough.
- net-amount-eur: number required — Positive number; the direction is in the type code.
- vat-amount-eur: number required
- gross-amount-eur: number required
- vat-treatment: reference to vat-treatment required — Must match the original invoice.
- vat-exemption-reason: text — Carried over where the original was exempt.
- delivery-format: text required — Same as the original invoice.
- structured-document-reference: text
- archived-format-hash: text
- status: text required — draft, issued, sent, settled.
- refund-payment: reference to payment — For webshop refunds.
- approved-by: reference to employee — Required above the goodwill threshold.

## Identified by
credit-note-number

## Created on demand
no

## Predicates
- justified: reason-code exists and reason-note exists
- references original: corrects-invoice exists
- vat consistent with original: vat-treatment exists
- goodwill: reason-code is "goodwill"
- needs approval: reason-code is "goodwill" and net-amount-eur > 100
- approved: approved-by exists
- issued: status is "issued"
- refunded: refund-payment exists

## References
- `corrects-invoice` → `invoice`, `customer` → `customer`
- `sales-order` → `sales-order`, `return` → `return`
- `vat-treatment` → `vat-treatment`, `refund-payment` → `payment`
- `approved-by` → `employee`

## Retention
**10 years** under GoBD, immutable, alongside the invoice it corrects. Where the original was
an XRechnung, the credit note is transmitted in the same format and the XML is archived
byte-identically.

## Notes
### references original
A credit note without a reference to the invoice it corrects is not a credit note, it is a
hole in the bookkeeping. The rule refuses it.

### needs approval
Small goodwill gestures are what a customer service agent is for. Large ones are a
management decision. The boundary is a number in this file, visible to everybody, rather
than a permission buried in a configuration screen.

### Used by

`processes/returns-and-credit-notes.md`, `processes/goodwill-approval.md`,
`processes/customer-complaint.md`, `management-system/month-end-close.md`
