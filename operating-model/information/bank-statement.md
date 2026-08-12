# Bank statement

The bank's version of events. It is the only document in the ledger that a third party wrote, which makes
it the one piece of external evidence an auditor can lean on without trusting us at all — and that is
exactly why the reconciliation between it and the bank account in the ledger is the first substantive test
in any audit of a set of books.

A statement is a closed interval with an opening balance, a closing balance, and lines that must account
for the difference. That is the only invariant worth having here and it is the one that catches an import
that dropped a line: if opening plus the movements does not equal closing, something is missing, and the
statement is refused rather than half-loaded. Most homegrown imports check nothing and discover the problem
three months later as an unexplained difference nobody can date.

Reconciliation is a matching exercise, not a posting exercise. A statement line does not create a journal
entry by itself — the *payment* does — because a bank line is evidence that something happened and a
payment is the company's statement of what it was. Where the two do not meet, the line stays unmatched and
visible. An ERP that auto-posts unmatched bank lines to a suspense account is an ERP whose bank
reconciliation is always clean and never informative.

## Fields
- statement-reference: text required — The bank's statement number for the account and period.
- bank-account-number: text required — Our own account, as an internal account number.
- ledger-account-number: text required — The account in the chart this bank account posts to.
- currency: text required — The account currency.
- from-date: date required — First value date covered.
- to-date: date required — Last value date covered.
- opening-balance: money required — Balance the bank says we started with.
- closing-balance: money required — Balance the bank says we ended with.
- computed-closing-balance: money required — Opening plus credits less debits, accumulated by the rules. Starts at zero.
- total-credits: money required — Sum of the incoming lines.
- total-debits: money required — Sum of the outgoing lines.
- line-count: number required — How many lines the statement has.
- accounting-period: reference to accounting-period required — Which month it belongs to.
- imported-by: reference to employee required — Who loaded or keyed it.
- imported-on: date required — When.
- document-hash: text required — Hash of the file the bank sent. What Unveränderbarkeit means for an inbound document.
- status: one of imported, reconciling, reconciled required — Where it stands.
- reconciled-by: reference to employee — Who agreed it.
- reconciled-on: date — When.

## Identified by
bank-account-number and statement-reference

## Created on demand
no

## Invariants
- the statement adds up: computed-closing-balance = closing-balance
- the statement is a real interval: from-date <= to-date
- the statement has lines: line-count >= 1
- the line count agrees with the lines: line-count = count of bank-statement-line for this bank-statement
- the credits agree with the lines: total-credits = sum of amount over bank-statement-line for this bank-statement where direction is "credit"
- the debits agree with the lines: total-debits = sum of amount over bank-statement-line for this bank-statement where direction is "debit"

## Predicates
- imported: status is "imported"
- reconciling: status is "reconciling"
- reconciled: status is "reconciled"
- agreement named: reconciled-by exists
- in an open period: accounting-period accepts postings
- hashed: document-hash exists

## Authorized by
- create: treasurer
- read: auditor or controller or tax-accountant or accountant or treasurer
- update: treasurer or controller
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

### `opening + credits − debits = closing`, and how it became structural without arithmetic

This note used to say the check could not be written, because POLISM has no `+` or `−` in a condition — which
is true, and stays true: the moment the grammar gains arithmetic in comparisons it is on the road to being a
programming language, and FD-5 lists exactly what it may gain.

The way round it is not arithmetic in a condition; it is arithmetic in a **counter**, which the grammar has
always had, plus the `from` clause grammar §17 added. `processes/bank-reconciliation.md` accumulates
`computed-closing-balance` from three counters — plus the opening balance, plus the credits, minus the debits
— and the invariant above compares that one field with the balance the bank stated. Two constructs that
already existed, composed.

So all five invariants together now say: every line is accounted for, both movement totals agree with the
lines, and the bank's own opening and closing balances agree with those totals. A statement imported from the
wrong period, or with a line dropped, or with the two date columns swapped, is refused rather than
reconciled. That is the whole job of this document and it is now done by the document rather than by a person
remembering.

### Why the statement is hashed

The bank's file is the external evidence. If it can be edited after import, it is no longer external, and
the strongest thing in the whole audit trail becomes the weakest. `document-hash` plus the signed commit
means we can show in 2034 that the statement we reconciled is the statement the bank sent.

### What is not here

No bank connectivity, no MT940 or CAMT.053 parsing, no automatic matching heuristics. Import is an inbound
dialect (wave 3), and matching is a decision recorded by a person or by a rule with declared conditions —
never a similarity score, because a similarity score is a guess and Principle 6 forbids guessing where
decisions are made.

## Retention

**10 years** under GoBD and § 147 AO. Bank statements are among the documents a *Betriebsprüfer* asks for
first, in original form.

## References

`information/bank-statement-line.md`, `information/payment.md`, `processes/bank-reconciliation.md`
