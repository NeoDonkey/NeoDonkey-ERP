# Accountant

Turns what happened into what the books say. Issues customer invoices, verifies supplier
invoices, matches incoming payments, prepares payment runs, prepares the VAT returns, and hands
the accountant's-eye view to the tax adviser through the DATEV export.

This role has more day-to-day authority than any other and one hard limit: it may prepare a
payment run but not release it. That single line is the four-eyes control an auditor tests
first, and it is not a matter of trust — it is the control that protects the accountant as much
as the company, because it makes "I could have taken the money" untrue rather than merely
unlikely.

The other boundary is the invoice itself. An issued invoice is never edited, by anybody,
including this role. A wrong invoice gets a credit note and a new invoice. There is no rule in
this template that updates an amount on an issued invoice, and adding one would be the single
most damaging change somebody could make to this folder.

## Notes
### Responsibilities

- Issue customer invoices with the correct VAT treatment, in the correct format.
- Dispatch electronic invoices and confirm they were accepted.
- Verify supplier invoices: three-way match, and the §14 UStG mandatory-element check.
- Match incoming payments to invoices, chase unexplained differences.
- Prepare payment runs, including early-payment discounts.
- Run dunning on overdue customer invoices.
- Prepare the VAT return, the EC sales list and the OSS return.
- Produce the DATEV export for the tax adviser.
- Check supplier bank details before a supplier is approved.

### Authorized for

- `processes/invoice-issuance.md`
- `processes/electronic-invoice-dispatch.md`
- `processes/supplier-invoice-verification.md`
- `processes/incoming-payment-matching.md`
- `processes/payment-run.md`
- `processes/dunning.md`
- `processes/vat-return-preparation.md`
- `processes/datev-export.md`
- `processes/returns-and-credit-notes.md`

### Not authorized for

- **Releasing a payment run.** `processes/payment-run-release.md` names `controller` or
  `managing-director`. This is the four-eyes boundary.
- Being the second approver on a supplier invoice they verified themselves.
- Changing an issued invoice. Nobody may.
- Granting a goodwill credit above 100 EUR — `managing-director`.
- Anything touching stock, batches or quality.

### Reports to

`controller`

### Sees

All invoices, credit notes, supplier invoices, payments, customers, suppliers, VAT
registrations. Sales orders and delivery notes, because an invoice needs them. Stock valuation
totals for the close. Not the quality inspection detail, not personal HR data.
