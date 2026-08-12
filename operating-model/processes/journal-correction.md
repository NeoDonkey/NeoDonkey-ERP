# Journal correction

A wrong entry is never edited. It is corrected by a **new** entry, with its own number, its own date, its own
signature, and a reference to the entry it corrects. This is the oldest rule in bookkeeping and it predates
computers by several centuries, for a reason that has not changed: somebody has already seen the original.

GoBD says the same thing in German administrative language — *Unveränderbarkeit*, and the requirement that
the original content stay ascertainable — and NeoDonkey is in an unusually strong position to satisfy it,
because a Git commit cannot be altered without breaking every hash after it. So this file is short on
mechanism and specific about discipline.

There are two shapes. A **Storno** reverses an entry completely: the same accounts, the same amounts, the
sides swapped, and then the correct entry is posted afresh. A **correcting entry** posts only the difference,
which is what an accountant does when the error is a wrong amount on otherwise correct accounts. Both carry
`corrects` and `correction-reason`, and neither touches the original.

## Triggered by
An error found in a posted entry — by the person who made it, by the controller at the close, by the tax
adviser, or by an auditor.

## Notes

### There is no rule in this file, and that is a limitation rather than a design

Every posting in this ledger is produced by `processes/journal-posting.md`, which branches on the source
document type and derives the accounts from the chart and the tax situation. A correction whose accounts are
an arbitrary pair — reclassify 1,200.00 EUR from *Bezugsnebenkosten* to *Wareneingang*, say — is not a branch
of anything: the accounts come from the accountant's judgement, not from a document's tax treatment.

Posting one therefore needs a journal entry **and** its postings created together, from one intent, in one
commit. No POLISM rule can do that, because a rule creates documents from a trigger and cannot be handed a
variable number of lines. It needs a bundled intent in the Live Layer, and that does not exist. Stated
plainly: **a free-form correcting entry cannot be posted in this model today.** So can a
correction with a fixed shape:

- **a write-off booked too high** — a stock adjustment in the other direction, which
  `processes/journal-posting.md` posts as `3980 Bestand Waren` Soll against `4855 Warenverluste` Haben. This
  is the correction exercised end to end in `test/f2-ledger.test.js`.
- **an over- or under-payment** — a further payment document.
- **a wrongly issued invoice** — a credit note, which is what `processes/returns-and-credit-notes.md` is for
  and which is the legally correct answer anyway.

Everything else waits on bundled intents. That is the single largest gap in the ledger and it is named as
such in the report accompanying this work rather than smoothed over here.

### The correction lands in the next open period, not in the original one

If July is locked, a correction to a July entry is dated in August. That is not a workaround for the lock; it
is what the lock is for. The July return has been filed and the July trial balance agreed, and a system that
lets you quietly change July has made both of those documents untrue. Where the amount matters to the July
return, the answer is an **amended** VAT return — `information/vat-return.md` carries `amends` and
`amendment-reason` for exactly that — not a reopened month.

Reopening is available for the case where the annual accounts are not yet filed and the tax adviser insists.
`processes/period-close.md` has it, with a reason field and a named person.

### The link runs one way, on purpose

`corrects` is on the correcting entry. There is no `corrected-by` on the original, because writing one would
be a change to the original — which is the exact thing this file exists to prevent. Finding the correction
means looking for entries that reference this one, which is a query and not a mutation. It costs a little
convenience and buys the ability to say, truthfully, that no posted entry in this repository has ever been
written to twice.

### What an auditor will ask for that is not here

A *Stornoliste*: the list of every reversal and correction in a period, with reasons, which is one of the
first analytical procedures in a German audit because a spike in corrections is a signal. It is a query over
`corrects exists`, it needs nothing new, and it is not built.

## References

`information/journal-entry.md`, `processes/journal-posting.md`, `processes/period-close.md`,
`processes/returns-and-credit-notes.md`, `information/vat-return.md`
