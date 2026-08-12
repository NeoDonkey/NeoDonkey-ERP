# Treasurer

Owns the bank accounts and the money leaving them. Prepares the payment run, reconciles the statements,
watches the cash. In a company of this size it is one person wearing a hat rather than a department, and
that is exactly why the hat has to be described precisely.

The treasurer **prepares** payment runs and does not release them alone. Above the thresholds in
`information/payment-run.md` a second role signs, and the reason is not suspicion — it is that a single
person who can both create a payment instruction and send it has a capability no company should give
anybody, including the person who most deserves to be trusted with it. The control protects the treasurer
first: "I could have moved the money" stops being true.

The treasurer also owns bank reconciliation, which is the one place in the ledger where an outside party's
record is compared with ours. An unmatched statement line is not a nuisance to be tidied away; it is
information, and this role's job is to leave it visible until somebody explains it.

## Purpose

- Prepare payment runs from approved supplier invoices, and never release one alone.
- Import and reconcile bank statements; keep unmatched lines visible rather than tidy.
- Maintain the exchange rate documents the ledger translates with, and their sources.
- Own the cash position and the payment calendar.
- Propose changes to the payment authority thresholds; the managing director decides them.

## Notes

### Authorised for
`processes/payment-run.md` (preparation), `processes/bank-reconciliation.md`,
`processes/customer-payment-posting.md`, `processes/foreign-currency-settlement.md`

### Not authorised for
Releasing a payment run alone — that needs a second role on the same commit. Approving a supplier
invoice they will then pay. Changing a supplier's bank details. Posting to a control account by hand;
`blocked-for-manual-posting` on the bank and payables accounts holds for this role too.

### Reports to
`managing-director`

### Sees
All bank accounts, all supplier invoices, all payments, the ledger. Not payroll, which lives in its own
encrypted visibility group.
