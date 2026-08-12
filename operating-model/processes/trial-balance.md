# Trial balance

Striking the *Summen- und Saldenliste*: for one period, every account with its debits, its credits and its
balance, and one total line whose two figures must be equal. It is the first thing a tax adviser asks for and
the first thing an auditor recomputes.

Each line is checked against the postings it claims to summarise. That is what makes this a document rather
than a report: a report is a picture taken at a moment and is silently wrong the next time somebody posts, and
a trial balance whose figures no longer agree with the ledger is **refused** — which is how somebody finds out
that it has to be struck again before the month can be locked.

The equality of the two grand totals is the ledger's proof of itself, and it is boring by construction. Every
journal entry is individually balanced by invariant, and a sum of balanced entries balances. If this list ever
fails to balance, the fault is not in the list.

## Triggered by
The tax accountant or the controller striking the balance for a month, before the VAT return and before the
close.

## Rules

If Create trial-balance under condition
  accounting-period exists and
  chart active and
  struck-by exists and
  struck-on exists
  authorized by controller
then
  Update trial-balance with struck-by
    with struck-on
    with status "draft"

If Update trial-balance under condition
  trial-balance the total line and
  agreed-by exists and
  period-debits = period-credits
then
  Update trial-balance with status "agreed"
    with agreed-by

## Notes

### The second rule is where the balance is asserted

`period-debits = period-credits` on the total line. On that line `account-number` is empty, so the two
aggregation invariants in `information/trial-balance.md` sum **every** posting in the period into those two
fields — every debit into one, every credit into the other. Agreeing the trial balance therefore means
asserting, in a signed commit, that the whole period's debits equal its credits, with both figures pinned to
the postings by invariant.

It has to be a rule rather than an invariant because the same equality is false on every account line by
design: account 8400 has credits and no debits. What is needed to make it an invariant is one conditional
form — `when line-kind is "total" then period-debits = period-credits` — and it is requested. Until then, the
structural guarantee is the one on `information/journal-entry.md`, which is the stronger place for it anyway:
an unbalanced entry cannot be committed, so an unbalanced period cannot exist to be discovered here.

### Why striking it is a separate act from agreeing it

Two rules, two commits, and in a company with a controller, two people. Striking is mechanical. Agreeing is a
judgement — that the balances are plausible, that the receivables tie to the open-items list, that the VAT
accounts reconcile to the turnover accounts. `processes/period-close.md` requires `trial-balance-agreed`
before a month can be locked, so the judgement is a precondition of the close rather than part of it.

### `authorized by` per rule, and why it differs between the two

Striking is `tax-accountant or controller`; agreeing is `controller` alone. That split was not expressible in
grammar version 1 — `## Authorized by` belonged to the file, so both acts would have carried both roles and
the separation would have been documentation. It is the smallest useful demonstration of per-rule authority in
this model.

### What is not here

No comparative period, no *Kontenklasse* subtotals, no cost-centre breakdown, no open-items reconciliation
(the receivables control account is agreed against the invoice documents by a person, and nothing checks it).
No trial balance across legal entities: that is consolidation, it reads several repositories, and FD-3 says
how it will be done rather than doing it.

## References

`information/trial-balance.md`, `information/posting.md`, `information/journal-entry.md`,
`processes/period-close.md`, `processes/financial-statements.md`
