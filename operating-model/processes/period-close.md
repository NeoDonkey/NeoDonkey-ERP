# Period close

Locking a month, which is the act that turns a set of documents into *the books*. Before the lock, last July
is editable and therefore negotiable. After it, no posting dated in July will ever be accepted again, and a
correction is a new entry in a later period that references what it corrects.

The checklist is not a formality and it is not optional. The trial balance has been struck and agreed, every
bank statement line is matched, and the VAT return is filed — three conditions, all of them, held in the
predicate `ready to lock` on `information/accounting-period.md`. A month locked before its return is filed is
a month whose return will be wrong and whose correction has nowhere to go, which is why the order matters
rather than merely being tidy.

Reopening exists because reality sometimes requires it, and it costs a name, a date and a reason in words.
An auditor's first question about a reopened period is "why", and the answer belongs on the document.

## Triggered by
The controller closing a month after the trial balance, the bank reconciliation and the VAT return are done.
Or, rarely, reopening one because something belonging to it was found later.

## Rules

If Update accounting-period under condition
  chart active
  authorized by controller
then
  when accounting-period ready to lock and locked-by exists and locked-on exists authorized by controller then
    Update accounting-period with status "locked"
      with locked-by
      with locked-on
      with carried-forward true
  otherwise when accounting-period locked and reopen-reason exists and reopened-by exists authorized by managing-director then
    Update accounting-period with status "open"
      with reopened-by
      with reopened-on
      with reopen-reason

## Notes

### Where the lock is actually enforced

Not here. This rule *sets* the status; the refusal of a posting into a locked month is an invariant on the
documents that would carry it — `the period is not locked` on `information/journal-entry.md`, and the same
sentence again on `information/posting.md`. That is the important architectural point: the lock is a property
of every entry and every line, checked on every change, not a check that a posting process remembers to
perform. A rule can be forgotten; an invariant on the document cannot be routed around.

### `ready to lock`, and the three obligations

```
- ready to lock: trial-balance-agreed is true and bank-reconciled is true and vat-return-filed is true
```

All three, joined by `and`, in `information/accounting-period.md`. Each of them is set by its own process, by
a named person, in its own commit: `processes/trial-balance.md`, `processes/bank-reconciliation.md`,
`processes/vat-return.md`. So the close is the fourth signature on three pieces of work rather than a button
that asserts they happened.

### The obligations on the lock itself

`with locked-by` and `with locked-on` are obligation clauses, not value clauses: they require the fields to be
present on the update and copy them onto the record. A lock that does not name who set it and when is
refused, quoting the rule. That is how the model gets "a locked period always names the person who locked it"
without a conditional invariant, which the grammar does not have.

### Locking is the controller's act; reopening is the managing director's

The two arms carry different `authorized by` clauses, which is grammar §16's arm scope. **The controller
locks a month. Only the managing director reopens one.** A controller cannot quietly reopen a period they
closed, and the refusal quotes the arm that decided.

That split was impossible in grammar version 1 and it is the reason limit 14 was called the most
consequential one: two files would have conjoined into a contradiction that refused every update to a period
while the model read correct. It is worth stating what is still missing, though — the reopening is
authorised by a *role*, not by two signatures, so a managing director acting alone can reopen a closed
month. Whether that is acceptable is a business question with a written answer either way; making it need
two keys is the Truth Layer's job (manifesto line 114).

### What is not here

No year-end close. Carrying the annual result to *Gewinnvortrag*, the accruals, the provisions and the
depreciation that make up a *Jahresabschluss* are not modelled — `processes/financial-statements.md` computes
a result by aggregation and stops there. Also absent: an automatic carry-forward of account balances into the
next period's trial balance; `carried-forward` records that it was done, and the doing is described in
`information/trial-balance.md` with its own honest limits.

## References

`information/accounting-period.md`, `information/journal-entry.md`, `processes/trial-balance.md`,
`processes/vat-return.md`, `processes/bank-reconciliation.md`, `processes/journal-correction.md`
