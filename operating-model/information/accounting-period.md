# Accounting period

One month of bookkeeping, with a status that decides whether anything may still be posted into it. This
is the smallest document in the ledger and the one that makes the rest of it defensible: without a lock,
"the books" are a suggestion, because anyone can go back and change last quarter.

A period runs `open`, then `closing`, then `locked`. Open means postings are accepted. Closing means the
month is being reconciled and the VAT return prepared — still postable, deliberately, because that is
when the reconciling entries are made. Locked means no posting dated inside it will ever be accepted
again, by anybody, including the managing director and including a correction of an obvious error. A
correction after the lock is a **new entry in the next open period, referencing the original**. That is
not a NeoDonkey restriction; it is what a bookkeeper does and what GoBD's *Unveränderbarkeit* requires.

Reopening exists, because reality sometimes requires it — the tax adviser finds something in September
that belongs to July, and the annual accounts are not yet filed. It costs three fields: who reopened it,
when, and why, all of them required at the moment of reopening. An auditor's first question about a
reopened period is "why", and the answer is on the document rather than in somebody's memory.

## Fields
- period-key: text required — The period as everybody writes it, e.g. 2026-07.
- fiscal-year: number required — 2026.
- month: number required — 1 to 12.
- from-date: date required — First day the period accepts.
- to-date: date required — Last day the period accepts.
- chart: reference to chart-of-accounts required — Which chart's books this period belongs to.
- status: one of open, closing, locked required — Whether postings are accepted.
- vat-return-filed: boolean required — Whether the UStVA for this period has been submitted.
- trial-balance-agreed: boolean required — Whether the trial balance was struck and agreed.
- bank-reconciled: boolean required — Whether every bank statement line is matched.
- locked-on: date — When the lock was set.
- locked-by: reference to employee — Who set it.
- reopened-on: date — When it was reopened, if ever.
- reopened-by: reference to employee — Who reopened it.
- reopen-reason: text — Why. Required at the moment of reopening.
- carried-forward: boolean required — Whether balances were carried into the next period.

## Identified by
period-key

## Created on demand
no

## Invariants
- the period is a real interval: from-date <= to-date

## Period
- from: from-date
- to: to-date
- locked when: status is "locked"

## Predicates
- open: status is "open"
- closing: status is "closing"
- locked: status is "locked"
- accepts postings: status is not "locked"
- ready to lock: trial-balance-agreed is true and bank-reconciled is true and vat-return-filed is true
- was reopened: reopened-on exists
- reopening explained: reopen-reason exists
- vat filed: vat-return-filed is true
- balances carried forward: carried-forward is true

## Authorized by
- create: controller
- read: auditor or controller or tax-accountant or accountant or treasurer
- update: controller or managing-director
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

### accepts postings
`status is not "locked"`. The double negative is deliberate and it is the safe direction: a new status
value invented next year — `audited`, say — accepts postings unless somebody says otherwise, which is
wrong. Making it `status is "open"` would refuse the reconciling entries that a closing month exists to
receive, and every accountant would immediately ask for the lock to be lifted, which is worse. The status
field is an enumeration, so a fourth value cannot appear by accident: a typo is refused, and a genuine
fourth status is a considered change to this file.

### ready to lock
Three conditions, all of them, and none of them is a signature: the trial balance was struck and agreed,
every bank line is matched, and the VAT return is filed. This is the checklist a *Bilanzbuchhalter* works
through, written where the machine can insist on it. The corresponding rule is in
`processes/period-close.md` and it also demands `locked-by` and `locked-on`, so a locked period always
names the person who locked it.

### Why there is no year-level period
Because German VAT is monthly (or quarterly) and the lock has to follow the return. A fiscal-year close
is a further act on top of twelve locked months — carrying the result to `Gewinnvortrag`, which
`processes/financial-statements.md` describes — and it is not modelled as its own period. That is a
stated limit: this model locks months and computes an annual result by aggregation, but it does not run
a *Jahresabschluss* with its accruals, provisions and depreciation.

### What happens when nothing applies
A journal entry whose `accounting-period` reference is empty, or names a period document that does not
exist, is refused — not posted into a default period, and not posted with no period at all. Grammar
§4.5: a condition over a missing document has no truth value, so the invariant
`accounting-period not locked` on `journal-entry` fails rather than passes. A posting that cannot say
which month it belongs to is exactly the posting an auditor will find.

## Retention

**10 years** under GoBD and § 147 AO. The period document is the evidence that the lock existed on the
date it claims, and a reopening is part of that evidence. Never deleted, never edited after locking
except by the reopening rule, which records itself.

## References

`information/journal-entry.md`, `processes/period-close.md`, `processes/vat-return.md`,
`processes/trial-balance.md`
