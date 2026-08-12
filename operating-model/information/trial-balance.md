# Trial balance

The *Summen- und Saldenliste*: every account, its debit total, its credit total, and its balance, for one
period. It is the first thing a tax adviser asks for and the first thing an auditor recomputes, and its
whole job is to demonstrate one number — that the sum of all debits equals the sum of all credits.

A trial balance document here is one account's line for one period, plus a `total` line per period that
carries the two grand totals. It is struck by a person, dated, and checked against the postings by
invariant, so a trial balance in the repository is not a report somebody could have exported before making
one more posting: if a posting changes, the trial balance for that period stops agreeing and is refused
until it is struck again. That is why `processes/period-close.md` requires `trial-balance-agreed` before a
month can be locked.

The two grand totals are the ledger's own proof of itself, and they are checked twice over: once here, by
aggregating every debit and every credit in the period, and once on every journal entry, which cannot be
unbalanced in the first place. The second check is what makes the first one boring, and boring is the goal.
A trial balance that has to be *fixed* every month is a system with a hole in it.

## Fields
- period-key: text required — Which month, e.g. 2026-07.
- accounting-period: reference to accounting-period required — The period the figures come from.
- chart: reference to chart-of-accounts required — Which chart the account numbers belong to.
- line-kind: one of account, total required — An account's line, or the period's grand total line.
- account-number: text — The account, on an account line. Empty on the total line.
- ledger-account: reference to ledger-account — The account document, on an account line.
- account-name: text — The caption, copied so the list reads without a join.
- account-type: one of asset, liability, equity, revenue, expense, all required — Copied from the account. `all` on the total line.
- currency: text required — The ledger currency.
- opening-balance: money required — Balance carried in from the previous period.
- period-debits: money required — Debits posted in this period.
- period-credits: money required — Credits posted in this period.
- closing-debit-balance: money required — Closing balance where the account is in debit. Zero otherwise.
- closing-credit-balance: money required — Closing balance where the account is in credit. Zero otherwise.
- posting-count: number required — How many postings made up this line.
- struck-by: reference to employee required — Who struck it.
- struck-on: date required — When.
- agreed-by: reference to employee — Who agreed it. On the total line, this is the close signature.
- status: one of draft, agreed required — Whether it has been agreed.

## Identified by
period-key and line-kind and account-number

## Created on demand
no

## Invariants
- a line names its period: accounting-period exists
- a line names its chart: chart exists
- the debits are not negative: period-debits >= 0
- the credits are not negative: period-credits >= 0

## Predicates
- an account line: line-kind is "account"
- the total line: line-kind is "total"
- agreed: status is "agreed"
- draft: status is "draft"
- agreement named: agreed-by exists
- in debit: closing-debit-balance > "0.00 EUR"
- in credit: closing-credit-balance > "0.00 EUR"
- nothing moved: posting-count is 0
- a balance sheet line: ledger-account balance sheet account
- an income statement line: ledger-account income statement account

## Authorized by
- create: tax-accountant or controller
- read: auditor or controller or tax-accountant or accountant or managing-director
- update: controller
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

### How the total line balances, and where the check really lives

On the `total` line, `account-number` is empty and `period-debits` / `period-credits` hold the whole
period's movement on each side. Those two must be equal for the trial balance to balance, and *that*
comparison cannot be an invariant on this document for two independent reasons. It would also be asserted on
every account line, where it is false by design (account 8400 has credits and no debits) — an invariant has
no implication in it, so there is no way to scope it to the total line. And the figures themselves cannot be
pinned to the postings either, for the reason the section below gives.

So the equality of the grand totals is asserted by `processes/trial-balance.md` as a rule condition on
striking the total line, and by `test/f2-ledger.test.js`, which recomputes it from the postings. What makes
it *structurally* safe rather than merely checked is upstream: every journal entry is individually balanced
by invariant, and a sum of balanced entries is balanced. The trial balance is the visible confirmation, not
the guarantee. Saying it the other way round would be flattering and wrong.

The construct that would close it is conditional invariants — `when line-kind is "total" then period-debits
= period-credits` — the same one line of grammar `information/posting.md` and
`information/payment-run.md` both need. Three independent places in one ledger model want it, which is the
strongest argument for it.

### Why the account line duplicates the account's name and type

`account-name` and `account-type` are copied so that a *Summen- und Saldenliste* prints from these
documents alone. That matters more than it sounds: the list is what gets emailed to the tax adviser, and a
list that needs a second folder to render is a list that will be rendered wrong by somebody in a hurry.

### `opening-balance` and the carry-forward

The opening balance is the previous period's closing balance, carried by `processes/period-close.md` when
the month is locked. It is **not** checked by invariant: checking it would need to reach into another
period's trial balance and compare, which is a two-hop path the condition grammar refuses (§10.3). So the
carry is a rule, and a mis-carry would show up as a trial balance whose closing balances do not equal
opening plus movements — arithmetic again, and again not expressible.

### What is not here

No comparative columns, no monthly progression, no cost-centre dimension, no account grouping totals
(a *Kontenklasse* sum). Those are presentation, and presentation belongs to a view over these documents.
Also absent: a trial balance across legal entities, which is consolidation (FD-3) and reads many repositories.

## Retention

**10 years** under GoBD and § 147 AO. The struck and agreed trial balance is the evidence that the books
balanced on the day the month was locked.

## References

`information/posting.md`, `information/accounting-period.md`, `information/financial-statement-line.md`,
`processes/trial-balance.md`, `processes/period-close.md`
