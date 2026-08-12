# DATEV export

Handing the accountant's world the file it expects. In Germany the tax adviser's software is almost
always DATEV, and an ERP that cannot produce a clean DATEV export is an ERP no *Steuerberater* will
work with — regardless of how good its own audit trail is.

This is Principle 5 in its most useful form and Appendix IX's Track 1 in one file. DATEV is a
*dialect we speak*, not a module we bought and not the record of truth. The record of truth is the
signed history in the repository; the export is a rendering of it for one audience. A retailer's EDI
format is another rendering for another audience, and adding a third is a translation rule rather
than a project.

The practical value is that it buys years of adoption. The auditor's world stays intact — they see
the files they have always seen — while underneath sits a signed, immutable log that is stronger than
anything a classical ERP could offer. They never have to reach into it, and the argument that they
*could* is Track 2's job, not this file's.

## Triggered by
The month-end close being agreed.

## Rules
If Read invoice under condition
  invoice issued and
  invoice archived and
  invoice complete for german vat law
then
  Update invoice with status "sent"

If Read supplier-invoice under condition
  supplier-invoice legally valid and
  datev-account exists and
  vat-treatment exists
then
  Update supplier-invoice with datev-account

If Read payment under condition
  payment booked and
  bank-statement-reference exists
then
  Update payment with match-status "matched"

## Notes

Note how thin these rules are. That is correct: an export must not change the business state, so the
consequents only ever confirm what is already true. If a future version of this file starts updating
amounts during an export, the export has stopped being a dialect and become a second system of record
— which is exactly the Frankenstein that Principle 11 exists to prevent.

## Authorized by
accountant
