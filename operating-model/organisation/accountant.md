# Accountant

Turns what happened into what the books say. Issues customer invoices, issues credit notes, verifies
supplier invoices, matches incoming payments, prepares the VAT returns.

This role has more day-to-day authority than any other and one hard limit: an issued invoice is never
edited, by anybody, including this role. A wrong invoice gets a credit note and a new invoice. No rule
in this folder updates an amount on an issued invoice, and adding one would be the single most damaging
change somebody could make here.

The other boundary is the one an auditor tests first. In this operating model the accountant prepares
payments and does not release them. Grammar version 1 cannot express that as an authorisation
constraint — `## Authorized by a and b` is refused — so the payment release process is not modelled
here; it stays a documented manual control until the Truth Layer can carry two signers on one commit.
That is stated plainly rather than faked with a second field.

## Purpose

- Issue customer invoices with the correct VAT treatment, in the correct format.
- Issue credit notes against returns and complaints, always referencing the original invoice.
- Verify supplier invoices against the order and the goods receipt.
- Check supplier bank details before a supplier is approved.
- Prepare the German VAT return, the EC sales list and the OSS return.

## Notes

### Authorised for
`processes/invoice-issuance.md`, `processes/returns-and-credit-notes.md`

### Not authorised for
Changing an issued invoice — nobody may. Granting a goodwill credit above 100 EUR — that is the
managing director. Anything touching stock, batches or quality.

### Reports to
`controller`

### Sees
All invoices, credit notes, customers, suppliers, VAT treatments. Sales orders, because an invoice
needs them. Stock valuation totals for the close. Not the quality inspection detail.
