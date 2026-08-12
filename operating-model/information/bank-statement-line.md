# Bank statement line

One movement on one statement: a value date, a direction, an amount, and whatever text the paying party
put in the reference field. The last of those is the part that decides how much manual work a month-end
costs, and it is entirely outside our control.

`position` is a declared field rather than an array index. The Live Layer holds documents in an OR-Set,
which has no order, so a line's place on the statement has to be a business fact written down — otherwise
the eleventh line becomes the third after a sync and the reconciliation cannot be re-performed. The same
reasoning applies to every line-item entity in this model.

A line carries `matched-to-payment` and nothing that looks like a score. Either a person or a rule with
declared conditions decided that this line is that payment, and the decision is on the document with the
name of whoever made it. Unmatched is a legitimate resting state, visible in the reconciliation, and it is
a far better outcome than a plausible-looking match nobody can explain.

## Fields
- bank-statement: reference to bank-statement required — Which statement it is on.
- position: number required — Line number on the statement. Starts at 1. An OR-Set has no order.
- value-date: date required — The date the money moved. This decides the period.
- booking-date: date required — The date the bank booked it.
- direction: one of debit, credit required — Out of the account or into it.
- amount: money required — Always positive. The direction carries the sign.
- currency: text required — The account currency.
- counterparty-name: text — As the bank reports it. A company name, never a private individual in this model.
- counterparty-account-reference: text — Masked or tokenised. Never a full account number.
- remittance-information: text — The reference text the payer supplied.
- bank-transaction-code: text — The bank's own code for the kind of movement.
- payment: reference to payment — The payment this line was matched to.
- matched-by: reference to employee — Who matched it.
- matched-on: date — When.
- match-basis: one of unmatched, reference-quoted, amount-and-date, manual-decision required — On what grounds.
- status: one of unmatched, matched, disputed, written-off required — Where it stands.
- accounting-period: reference to accounting-period required — Which month it belongs to.

## Identified by
bank-statement and position

## Created on demand
no

## Invariants
- a movement is a positive amount: amount > "0.00 EUR"
- a line belongs to a statement: bank-statement exists
- the bank cannot book before value: value-date <= booking-date

## Predicates
- debit: direction is "debit"
- credit: direction is "credit"
- unmatched: status is "unmatched"
- matched: status is "matched"
- disputed: status is "disputed"
- matched to a payment: payment exists
- match explained: match-basis is not "unmatched"
- matched by reference: match-basis is "reference-quoted"
- matched by hand: match-basis is "manual-decision"
- has remittance text: remittance-information exists
- in an open period: accounting-period accepts postings

## Authorized by
- create: treasurer
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

### `match-basis`

Four values, and `unmatched` is one of them so that "not matched" and "matched on grounds nobody recorded"
cannot look the same. `reference-quoted` is the strong case: the payer quoted our invoice number, so the
match is a fact. `amount-and-date` is weaker and it is where mistakes live — two customers owing the same
amount on the same day is not rare in a business with a price list. `manual-decision` means somebody looked
and decided, and their name is on it.

There is deliberately no `probable` and no confidence figure. A guess in the matching path becomes a wrong
receivable balance that nobody can trace back to the guess.

### `value-date <= booking-date`

Cheap and it catches a real import error: a statement loaded with the two date columns swapped. Both dates
are kept because the period is decided by the value date while the bank's own sequence follows the booking
date, and reconciling to a bank that uses the other one is an afternoon lost.

### No personal data on this line

`counterparty-name` in this model holds company names only. A consumer refund line names an order, not a
person. Real statements do contain personal data — that is unavoidable in the world — and it belongs in an
encrypted visibility group with the customer master data (Appendix VII), so that a GDPR erasure destroys the
key while this line, its amount and the chain above it stay verifiable for GoBD.

### What is not here

No CAMT or MT940 field mapping, no fee splitting, no FX conversion on the line, no automatic write-off of
small differences. A five-cent difference is still a difference and is closed by a decision, not by a
tolerance the software chose.

## Retention

**10 years** under GoBD and § 147 AO, as part of the statement.

## References

`information/bank-statement.md`, `information/payment.md`, `processes/bank-reconciliation.md`
