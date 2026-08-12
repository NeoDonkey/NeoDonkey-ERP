# Bank reconciliation

Comparing the bank's record with ours. It is the only place in the ledger where an outside party's document is
matched against our own, which makes it the strongest evidence in the whole set of books and the first
substantive test in any audit.

Matching is a decision, not a score. Either the payer quoted our invoice number — `reference-quoted`, and the
match is a fact — or the amount and date agree and somebody accepted that as sufficient, or a person looked and
decided. All three are recorded with the grounds and the name. There is no confidence figure anywhere, because
a guess in the matching path becomes a receivable balance nobody can trace back to the guess.

An unmatched line is a legitimate resting state and it stays visible. `processes/period-close.md` will not let
the month be locked until `bank-reconciled` is true, so an unexplained line stops a close rather than being
tidied into a suspense account.

## Triggered by
A bank statement imported, and then each of its lines matched to a payment.

## Rules

If Create bank-statement under condition
  from-date exists and
  to-date exists and
  line-count >= 1 and
  imported-by exists and
  document-hash exists
  authorized by treasurer
then
  Update bank-statement with +computed-closing-balance from opening-balance
    and Update bank-statement with +computed-closing-balance from total-credits
    and Update bank-statement with -computed-closing-balance from total-debits
    and Update bank-statement with status "imported"
      with imported-by
      with imported-on
      with document-hash

If Update bank-statement-line under condition
  payment exists and
  matched-by exists and
  bank-statement-line match explained
  authorized by treasurer or controller
then
  Update bank-statement-line with status "matched"
    with matched-by
    with matched-on
    with match-basis

If Update bank-statement under condition
  bank-statement reconciled and
  reconciled-by exists and
  reconciled-on exists
then
  Update bank-statement with status "reconciled"
    with reconciled-by
    with reconciled-on

## Notes

### `match explained`

`match-basis is not "unmatched"`. Stated negatively so that a value added to the enumeration later does not
silently count as an explanation. The obligation clause `with match-basis` then copies it onto the record, so
the grounds are part of the matched line and not a transient UI choice.

### The check this process makes on import, arithmetically

The first rule is the one worth reading twice. `opening-balance + total-credits − total-debits =
closing-balance` is what a bank reconciliation is *for*, and POLISM has no arithmetic in conditions — so the
addition happens in **counters** instead:

```
Update bank-statement with +computed-closing-balance from opening-balance
Update bank-statement with +computed-closing-balance from total-credits
Update bank-statement with -computed-closing-balance from total-debits
```

Three counters onto one field, which compose because arithmetic composes (grammar §5.4), each reading a
differently named field through §17's `from`. The invariant `the statement adds up` on
`information/bank-statement.md` then compares the accumulated figure with the balance the bank stated, and a
statement that does not add up is **refused at import** rather than discovered as an unexplained difference
three months later.

That closes what this note previously called the clearest case in the model for a new arithmetic form. It
needed no new grammar: a counter with `from`, and an invariant comparing one field with another. Worth saying
plainly, because "the grammar cannot do this" was wrong and stood here for a while.

`computed-closing-balance` starts at zero on the imported document, so the counters produce the figure rather
than adding to a guess.

### Why a statement line does not post

Only a payment posts. A bank line is evidence that something happened; a payment is the company's statement of
what it was. Auto-posting unmatched bank lines to a suspense account gives you a reconciliation that is always
clean and never informative, and a suspense account nobody clears.

### What is not here

No CAMT.053 or MT940 parsing, no bank connectivity, no automatic matching, no tolerance for small differences.
A five-cent difference is closed by a decision, not by a number the software chose.

## References

`information/bank-statement.md`, `information/bank-statement-line.md`, `information/payment.md`,
`processes/period-close.md`
