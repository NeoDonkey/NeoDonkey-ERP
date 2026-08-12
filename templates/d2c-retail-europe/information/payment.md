# Payment

Money arriving or leaving. One entity for both directions, because the questions are the
same: how much, when, against which document, and does it match.

The webshop and the retail channel behave completely differently here. A webshop payment
arrives through a payment service provider before the parcel is packed, in a batch
settlement with a fee deducted — so the amount that lands in the bank is not the amount the
customer paid, and reconciling that gap is real work. A retail payment arrives as a bank
transfer weeks later, sometimes with a deduction the customer has decided on unilaterally,
and matching it to invoices is the accountant's daily job.

## Fields
- id: text required — PAY-2026-0044912.
- direction: text required — incoming or outgoing.
- payment-date: date required — Value date on the bank statement.
- amount-eur: number required
- currency: text required — EUR.
- method: text required — sepa-transfer, sepa-direct-debit, card, paypal, invoice-terms.
- invoice: reference to invoice — For incoming customer payments.
- supplier-invoice: reference to supplier-invoice — For outgoing payments.
- credit-note: reference to credit-note — For refunds.
- customer: reference to customer
- supplier: reference to supplier
- payment-service-provider: reference to supplier — For card and wallet payments.
- psp-settlement-reference: text — The provider's batch id.
- psp-fee-eur: number — Deducted before the money reaches the bank.
- bank-statement-reference: text — Statement and line number.
- remittance-information: text — What the payer wrote in the reference field.
- early-payment-discount-taken-eur: number — Skonto.
- unexplained-difference-eur: number — Where the amount does not match.
- match-status: text required — unmatched, matched, partially-matched, disputed.
- payment-run: reference to payment-run — For outgoing payments.
- status: text required — expected, booked, returned, chargeback.

- invoice-count: number — How many invoices this payment settles.
- sales-order: reference to sales-order — The order this payment releases.

## Identified by
id

## Created on demand
no

## Predicates
- incoming: direction is "incoming"
- outgoing: direction is "outgoing"
- matched: match-status is "matched"
- unmatched: match-status is "unmatched"
- has unexplained difference: unexplained-difference-eur > 0
- psp settlement: psp-settlement-reference exists
- fee deducted: psp-fee-eur > 0
- chargeback: status is "chargeback"
- booked: status is "booked" and bank-statement-reference exists

## References
- `invoice` → `invoice`, `supplier-invoice` → `supplier-invoice`
- `credit-note` → `credit-note`
- `customer` → `customer`, `supplier` → `supplier`
- `payment-service-provider` → `supplier`
- `payment-run` → `payment-run`

## Retention
**10 years** under GoBD. Bank statement references are retained with the payments so that
every booking can be traced back to a statement line without a separate reconciliation file.

## Notes
### unmatched
An unmatched payment is not an accounting problem, it is a customer-service problem in
disguise: somebody paid and their order is still sitting unshipped. The monthly close
reports the count and the age.

### booked
Nothing counts as booked without the bank statement line behind it. That is the
*Nachvollziehbarkeit* requirement of GoBD reduced to one sentence.

### Used by

`processes/incoming-payment-matching.md`, `processes/payment-run.md`,
`processes/b2c-sales-order.md`, `processes/returns-and-credit-notes.md`,
`management-system/month-end-close.md`
