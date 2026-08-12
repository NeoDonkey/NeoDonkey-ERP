# Tax accountant

The person who prepares the VAT returns and answers for them. In a company this size the role is usually
split between an internal bookkeeper and an external *Steuerberater*, and both need the same access to the
same postings — which is one of the better arguments for a system where the books are files rather than a
database behind somebody's login.

The work is monthly and it is a checklist, not a judgement call: strike the trial balance, reconcile the VAT
accounts against the turnover accounts, check that every zero-rated intra-community supply has its
*Gelangensbestätigung*, compute the *Umsatzsteuervoranmeldung*, and file it. `processes/vat-return.md`
carries the parts a rule can enforce; this role carries the parts that need a person to look.

The role prepares and does not lock. Locking a period is the controller's act, and it requires the return to
be filed first — so the tax accountant's work is a precondition for the close rather than part of it. That
ordering is deliberate: a month locked before its return is filed is a month whose return will be wrong and
whose correction has nowhere to go.

## Purpose

- Prepare the monthly *Umsatzsteuervoranmeldung* and the quarterly One-Stop-Shop returns.
- Reconcile the VAT accounts against the turnover accounts before every filing.
- Maintain the VAT treatment documents and the account tax properties when legislation changes.
- Check the reverse-charge and export evidence that the invoice rules can only document.
- Prepare the DATEV export and answer the tax adviser's questions from the postings.

## Notes

### Authorised for
`processes/vat-return.md`, `processes/oss-return.md`, `processes/trial-balance.md`,
`processes/journal-correction.md`

### Not authorised for
Locking or reopening a period — that is the controller. Releasing payments. Issuing invoices. Changing an
account's `blocked-for-manual-posting` property, which is a chart change.

### Reports to
`controller`

### Sees
Every posting, every invoice, every supplier invoice, the charts, the periods. Customer and supplier master
data as needed for the returns. Not payroll, and not the encrypted personal data behind a customer record.
