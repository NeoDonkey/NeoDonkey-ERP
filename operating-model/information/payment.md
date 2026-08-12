# Payment

Money moving. Incoming from a customer, outgoing to a supplier, and in both directions the same two
questions: which bank movement was it, and which invoice does it settle. A payment that cannot answer the
second question is what fills an *offene Posten* list with noise until nobody reads it.

Direction is an enumeration rather than a sign on the amount, for the same reason a posting has a side
rather than a sign: one economic event, one way to write it. `settled-amount` is what actually arrived, and
where it differs from what was invoiced the difference has a name — a discount taken, a short payment
under dispute, or an exchange difference — and a name is what decides which account it lands on. A payment
with an unexplained difference is not cleared; it sits, visibly, which is the correct outcome.

Bank account details are deliberately not here in full. `counterparty-account-reference` holds a masked or
tokenised reference, never a complete account number, because a demo instance gets copied and published
and a lawful basis does not travel with a copy. Real payment instructions belong in an encrypted
visibility group (Appendix VII) with the customer and supplier master data, and the change of a supplier's
bank details is an event that needs its own approval — which is one of the two or three doors real
accounts-payable fraud walks through.

## Fields
- payment-reference: text required — Our reference for this movement.
- direction: one of incoming, outgoing required — Whose money is moving where.
- payment-date: date required — Value date, which is the date that decides the period.
- currency: text required — The currency the money moved in.
- amount: money required — What moved, in the currency it moved in. Always positive.
- ledger-amount: money required — The same movement in the ledger currency.
- exchange-rate: reference to exchange-rate — Required where the currency is not the ledger currency.
- settled-amount: money required — How much of the invoice this payment clears, in the ledger currency.
- difference-amount: money — Invoiced less settled, where they differ.
- difference-reason: one of none, discount-taken, exchange-difference, short-payment, bank-charge, overpayment required — What the difference is.
- bank-account-number: text required — Our own account, as an internal account number, not a full identifier.
- counterparty-account-reference: text — Masked or tokenised reference to the other side. Never a full account number.
- payment-means-code: text required — 58 SEPA credit transfer, 48 card, 42 direct debit.
- invoice: reference to invoice — The sales invoice this clears, on an incoming payment.
- supplier-invoice: reference to supplier-invoice — The purchase invoice this clears, on an outgoing payment.
- customer: reference to customer — Who paid.
- supplier: reference to supplier — Who was paid.
- payment-run: reference to payment-run — Which run released it, on an outgoing payment.
- bank-statement-line: reference to bank-statement-line — The statement line it was matched to.
- accounting-period: reference to accounting-period required — Which month it is booked into.
- status: one of announced, released, executed, matched, returned required — Where it stands.
- returned-reason: text — Why the bank sent it back, where it did.
- entered-by: reference to employee required — Who captured or imported it.
- released-by: reference to employee — Who released it, on an outgoing payment.

## Identified by
payment-reference

## Created on demand
no

## Invariants
- a payment moves a positive amount: amount > "0.00 EUR"
- the settled amount is positive: settled-amount > "0.00 EUR"
- a payment lands in a period: accounting-period exists
- a payment cannot be released before it is entered: entered-by exists

## Predicates
- incoming: direction is "incoming"
- outgoing: direction is "outgoing"
- announced: status is "announced"
- released: status is "released"
- executed: status is "executed"
- matched to a statement: status is "matched"
- returned: status is "returned"
- clears a sales invoice: invoice exists
- clears a supplier invoice: supplier-invoice exists
- fully settles: difference-reason is "none"
- has a difference: difference-amount exists
- difference explained: difference-reason is not "none"
- discount taken: difference-reason is "discount-taken"
- exchange difference: difference-reason is "exchange-difference"
- foreign currency: exchange-rate exists
- release named: released-by exists
- part of a run: payment-run exists
- reconciled: bank-statement-line exists

## Authorized by
- create: treasurer or accountant
- read: auditor or controller or tax-accountant or accountant or treasurer
- update: treasurer or accountant
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): it governs every
operation on this entity that no process rule covers. It uses the `- <operation>: <roles>` bullet form,
which no grammar-version-1 model can contain, so nothing that existed before changes meaning.

Without it, an operation no rule covers is open to an actor with no role at all — version 1's permissive
default, and the defect Part 4's standing rule 4 was written about. `delete` is the managing director
everywhere in the ledger, and it should almost never be used: a ledger document is corrected by a new
document, never removed. `read` is wide, including the auditor, because an audit needs the whole ledger and
reading changes nothing.

### `difference-reason`, and why `none` is a value rather than an empty field

Because "no difference" and "a difference nobody has classified yet" must not look the same. An
enumeration with `none` in it forces the second case to be visible: a payment that is short by four euros
and forty cents is either `discount-taken` — post it to the discount account — or `short-payment`, in
which case somebody has to talk to the customer. A blank field would let it be posted to a suspense
account by whichever rule ran first, and suspense accounts are where reconciliation problems go to be
forgotten.

### `ledger-amount` next to `amount`

The same pair as on a posting, and the same reason. A CHF payment moves CHF; the ledger records EUR; the
rate is a document. FD-1's prohibition on silent conversion means both figures are written down and the
translation is reproducible from the two documents plus the rate. The exchange difference between what the
invoice was translated at and what the payment was translated at goes to its own account — see
`processes/foreign-currency-settlement.md`, where the numbers are worked through.

### Why `payment-run` is only on outgoing payments

An incoming payment is an event we observe; nobody authorises it. An outgoing payment is an act we perform,
and it is the single most dangerous act in the system, so it needs a container that can carry two
signatures. That container is `information/payment-run.md`. The asymmetry is real and the model shows it
rather than smoothing it over.

### What is not here

No SEPA file generation, no direct-debit mandates, no card settlement fee splitting, no dunning ladder, and
no partial allocation of one payment across several invoices. That last one is a genuine gap: a retail
customer paying one transfer against eleven invoices is normal in this business, and this model needs one
payment document per invoice to express it. The exit path is an allocation entity between payment and
invoice, and it is not built.

## Retention

**10 years** under GoBD and § 147 AO. Payments are bookkeeping records. Bank account details held in the
encrypted group follow GDPR erasure by DEK destruction (Appendix VII) while this document and the chain
above it stay verifiable.

## References

`information/payment-run.md`, `information/bank-statement-line.md`, `information/journal-entry.md`,
`processes/customer-payment-posting.md`, `processes/payment-run.md`,
`processes/bank-reconciliation.md`
