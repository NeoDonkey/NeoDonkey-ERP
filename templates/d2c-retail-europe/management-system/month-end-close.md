# Month-end close

The rhythm that turns a month of activity into numbers somebody will sign. It is the most procedural thing
in this folder and the one an auditor will ask to see first, because *Zeitgerechtigkeit* — timely recording
— is one of the four GoBD principles and a close that runs six weeks late fails it.

The close is a checklist, held by the controller, and most of it is checking that things which should have
happened did. Every shipped order invoiced. Every received invoice recorded, whether or not it was valid.
Every bank line matched or explained. Stock valued and reconciled to the counts. VAT return figures
assembled and the DATEV export handed over.

## Cadence

Monthly, target close within five working days of month end. Chaired by the controller, with the
accountant. VAT filing follows the deadline on `information/vat-registration.md`, extended by a month
where a *Dauerfristverlängerung* is in place.

## Measures

- Shipped sales orders with no invoice — should be zero.
- Supplier invoices `received` but not `checked`, and their age. The GoBD timeliness number.
- Payments `unmatched` or `partially-matched`, and their age.
- Invoices with `vat-amount-eur` zero and no `vat-exemption-reason` — an invalid zero rating.
- Zero-rated intra-community supplies with no `proof-of-transport` on the delivery note. The most
  expensive line on this list.
- Reverse-charge invoices missing `buyer-vat-identifier`.
- XRechnungen with no `structured-document-reference` or no `buyer-reference`.
- Stock value, against the last count, against the general ledger.
- Credit notes whose VAT treatment differs from the invoice they correct.

## Owner

`controller`, with `accountant` executing and `tax-advisor` receiving.

## Notes

### This checklist exists because the rules cannot
Almost every line above is a *conditional* obligation: if the invoice is zero-rated, then the exemption
reason must be present. Grammar version 1 has no conditional consequents — every rule on a trigger is a
hard requirement — so those obligations are declared as predicates on `information/invoice.md`
(`reverse charge properly stated`, `xrechnung complete`, `transport proven`) and *checked here, by a
person*, once a month.

That is the honest position. It would be easy to write these as rules that fire on every invoice and make
the company unable to issue a domestic one. The predicates are real and readable; the enforcement is
monthly and manual; and when the grammar gains a conditional consequent, this checklist shortens by two
thirds.

### The DATEV export is a dialect, not the record
The accountant's software speaks DATEV, so we speak DATEV — `processes/datev-export.md`. The record of
truth is the signed history in the repository. This is Appendix IX Track 1: the auditor's world stays
intact while a stronger audit trail sits underneath it, and they never have to reach into it.

### No rules here
See `management-system/monthly-stock-review.md`.

## References

`processes/datev-export.md`, `processes/vat-return-preparation.md`,
`processes/incoming-payment-matching.md`, `information/invoice.md`,
`information/vat-registration.md`
