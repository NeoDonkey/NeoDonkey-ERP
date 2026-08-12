# Chart of accounts

A German company keeps its books in a *Kontenrahmen*, and in practice that means one of two: **SKR03**,
ordered by business process, or **SKR04**, ordered the way the balance sheet is ordered. Which one is
not a preference. It is what the tax adviser's DATEV installation expects, it is what the annual
accounts are drawn from, and changing it after two years of postings is a project nobody enjoys. So the
choice is a document, made once, visible, and dated.

A third chart is here as well — a small international one, thirteen accounts, for a subsidiary whose
books are not read by a German *Finanzamt*. It exists so that nobody has to pretend a Dutch or Italian
entity is keeping SKR04, and so that the ledger machinery is demonstrably not German-only.

Exactly one chart is `active` per company. The other two stay in the folder, retired, because an
eight-year-old posting must still be able to say which chart its account number came from — that is
what `## Identified by chart and number` on `ledger-account` is for. Account 1200 means *Bank* in SKR03
and *Trade receivables* in SKR04, and a ledger that cannot tell those apart is not a ledger.

## Fields
- name: text required — Slug-style name of the chart, e.g. skr03.
- standard: one of skr03, skr04, international required — Which published framework it follows.
- display-name: text required — What an accountant calls it.
- ledger-currency: text required — The currency every posting is expressed in. EUR here.
- rounding-rule: one of per-line, per-document required — Where commercial rounding is applied.
- rounding-mode: one of half-up, half-even required — Declared, never implicit. See FD-1.
- fiscal-year-start-month: number required — 1 for a calendar year.
- receivables-account-number: text required — Trade receivables. SKR03 1400, SKR04 1200.
- payables-account-number: text required — Trade payables. SKR03 1600, SKR04 3300.
- bank-account-number: text required — The main bank account. SKR03 1200, SKR04 1800.
- inventory-account-number: text required — Merchandise on the balance sheet. SKR03 3980, SKR04 1140.
- inventory-change-account-number: text required — Bestandsveränderungen. SKR03 3960, SKR04 5880.
- write-off-account-number: text required — Shrinkage and inventory differences. SKR03 4855.
- fx-loss-account-number: text required — Losses from currency translation. SKR03 4840.
- fx-gain-account-number: text required — Gains from currency translation. SKR03 2660.
- vat-prepayment-account-number: text required — Where the monthly USt-Vorauszahlung lands. SKR03 1780.
- retained-earnings-account-number: text required — Where the annual result is carried. SKR03 0868.
- opening-balance-account-number: text required — Saldenvortrag. SKR03 9000.
- receivables-account: reference to ledger-account — The account document, filled in at adoption.
- payables-account: reference to ledger-account — The account document, filled in at adoption.
- bank-account: reference to ledger-account — The account document, filled in at adoption.
- inventory-account: reference to ledger-account — The account document, filled in at adoption.
- inventory-change-account: reference to ledger-account — The account document, filled in at adoption.
- write-off-account: reference to ledger-account — The account document, filled in at adoption.
- fx-loss-account: reference to ledger-account — The account document, filled in at adoption.
- fx-gain-account: reference to ledger-account — The account document, filled in at adoption.
- vat-prepayment-account: reference to ledger-account — The account document, filled in at adoption.
- retained-earnings-account: reference to ledger-account — The account document, filled in at adoption.
- opening-balance-account: reference to ledger-account — The account document, filled in at adoption.
- adopted-on: date required — When the company started keeping books in it.
- status: one of active, retired required — Exactly one chart is active.

## Identified by
name

## Created on demand
no

## Predicates
- active: status is "active"
- german: standard is "skr03"
- balance sheet ordered: standard is "skr04"
- process ordered: standard is "skr03"
- international: standard is "international"

## Authorized by
- create: controller or managing-director
- read: auditor or controller or tax-accountant or accountant
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

### Eleven well-known accounts, each declared twice

Every posting rule in `processes/` needs to know which account trade receivables lives on, which one the
bank is, which one shrinkage goes to. None of that belongs in a rule — 1400 in a rule text is a number a
reader has to look up and a company on SKR04 has to change. So the chart names them, and the rules say
`with account-number from chart.receivables-account-number`. One line changes the whole ledger's account
determination, which is the same argument `information/vat-treatment.md` makes about tax situations.

Each one is declared twice: a `-number` text field and a `reference to ledger-account`. That is not
duplication for its own sake. **The numbers come first**, because the chart is adopted before a single
account document exists — it is the thing the accounts are created from — so a reference would be circular
on day one. `processes/chart-of-accounts-adoption.md` creates the account documents from the seed tables
and then fills in the references. The posting rules use both: the number goes on the posting so a *Summen-
und Saldenliste* prints without a join, and the reference is what the posting's invariants
`ledger-account exists` and `ledger-account active` check. A number whose reference has not been filled in
produces a refused posting, not a posting into a void.

The eleven are the accounts a rule reaches for. Every other account is reached through
`information/vat-treatment.md`, which is where tax-driven account determination belongs.

### rounding-rule and rounding-mode
FD-1: rounding is declared, never implicit. `per-document` with `half-up` is what a German invoice does
— VAT is computed on the invoice's net total and rounded commercially, once. A company invoicing
thousands of lines per order may prefer `per-line`; then the line VAT amounts sum to the invoice VAT
amount by construction, and the largest-remainder allocation in the money core keeps the parts summing
to the whole. Both are correct; only one can be true of a given company, and it says which here.

### What is not in this file
No account list. Accounts are documents, one per account, so that a company can add account 8402 on a
Tuesday without editing a file that everything else depends on. The three published charts are seeded
from `information/_chart-skr03.md`, `information/_chart-skr04.md` and
`information/_chart-international.md`, which are tables a bookkeeper can read and check against DATEV.

### Switching charts
There is no rule that switches a chart, and there will not be one. A chart change is a migration: every
account is remapped, every historical posting keeps its original account, and the opening balances are
re-derived. It is done once, by people, with the tax adviser in the room, and the evidence is the two
chart documents plus a mapping table. A one-click chart switch would be the single most destructive
button in an ERP.

## Retention

**10 years** under GoBD and § 147 AO. The chart is part of the *Verfahrensdokumentation*: an auditor
reading a 2026 posting must be able to establish which chart was active in 2026 and what account 8400
meant then. A retired chart is never deleted.

## References

`information/ledger-account.md`, `information/_chart-skr03.md`, `information/_chart-skr04.md`,
`information/_chart-international.md`, `processes/chart-of-accounts-adoption.md`
