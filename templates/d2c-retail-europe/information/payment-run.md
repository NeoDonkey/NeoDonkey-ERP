# Payment run

A batch of outgoing payments prepared together and released as one act. The accountant
assembles it; somebody else releases it. That separation is the whole reason this entity
exists — a payment run that one person could both prepare and release is the classic
fraud pattern in a mid-sized company, and it is the first thing an auditor tests.

Because release is a signed commit, the two signatures are cryptographic rather than
procedural. Two different keys signed two different commits. Nobody can hold both unless
somebody handed over a private key, and that is a different kind of problem.

## Fields
- id: text required — PR-2026-W32.
- run-date: date required
- execution-date: date required — Value date requested at the bank.
- bank-account-reference: text required — Which of our accounts. Not the IBAN; that lives in the vault.
- invoice-count: number required
- total-amount-eur: number required
- currency: text required — EUR.
- prepared-by: reference to employee required
- approval-count: number required — Starts at 0.
- released-by: reference to employee
- release-date: date
- sepa-file-reference: text — The pain.001 file handed to the bank.
- sepa-file-hash: text — Hash of the exact bytes submitted.
- status: text required — draft, ready, released, submitted, settled, cancelled.
- cancellation-reason: text

## Identified by
id

## Created on demand
no

## Predicates
- ready for release: status is "ready" and total-amount-eur > 0 and invoice-count > 0
- independently released: approval-count >= 2
- released: status is "released" and released-by exists
- submitted to bank: sepa-file-reference exists and sepa-file-hash exists
- large run: total-amount-eur >= 50000
- cancelled: status is "cancelled"
- justified cancellation: status is "cancelled" and cancellation-reason exists

## References
- `prepared-by`, `released-by` → `employee`
- contains many → `payment`

## Retention
**10 years** under GoBD. The submitted SEPA file and its hash are retained with the run, as
is the record of who released it.

## Notes
### independently released
The four-eyes condition. `approval-count` is raised by the counter consequent
`Update payment-run with +approval-count`, once per approving commit. Two commits, two
signatures, two people.

### submitted to bank
The hash matters: it lets us prove years later that the file the bank executed is the file
we approved. Without it, "the payment run was approved" and "this payment was approved" are
two different claims.

### Used by

`processes/payment-run.md`, `processes/payment-run-release.md`,
`management-system/month-end-close.md`
