# Financial statement line

The structure of the balance sheet and the profit and loss account: one document per position, in the order
§ 266 and § 275 HGB prescribe, each one knowing which accounts roll into it. This is what turns a trial
balance into a *Bilanz* and a *Gewinn- und Verlustrechnung* that a bank, a shareholder or a
*Wirtschaftsprüfer* will read.

German law is unusually specific here, and that is a gift rather than a burden: § 266 HGB gives the balance
sheet's positions and their order, § 275 gives the P&L in either the *Gesamtkostenverfahren* or the
*Umsatzkostenverfahren*, and a *Kapitalgesellschaft* has no discretion about either. So the positions are
data with legal references on them, and the statement is an aggregation over postings grouped by position —
not a spreadsheet with formulas somebody maintains.

The mapping runs from account to position, held here as an inclusive number range plus an explicit list for
the accounts a range would catch wrongly. Ranges are how every German accounting package does it and they
are how a tax adviser thinks; the explicit list exists because SKR03's *Prozessgliederung* scatters a few
accounts across ranges that belong elsewhere, and pretending otherwise would produce a balance sheet that is
almost right.

## Fields
- position-code: text required — The § 266 or § 275 reference, e.g. B-II-1 or GuV-1.
- caption: text required — The German caption, as the law words it.
- caption-english: text — For a bilingual statement.
- statement: one of balance-sheet, profit-and-loss required — Which statement it belongs to.
- section: one of assets, equity-and-liabilities, revenue, expenses, result required — Which side or block.
- position: number required — Where it appears in the statement. An OR-Set has no order.
- level: number required — Nesting depth. 1 for A, 2 for A-I, 3 for A-I-1.
- parent-position-code: text — The position this rolls into.
- legal-reference: text required — The paragraph, e.g. § 266 Abs. 2 B II 1 HGB.
- chart: reference to chart-of-accounts required — Which chart the ranges refer to.
- account-range-from: text — First account number in the range, inclusive.
- account-range-to: text — Last account number in the range, inclusive.
- included-accounts: text — Explicit account numbers that belong here despite the range.
- excluded-accounts: text — Explicit account numbers that do not, despite the range.
- normal-balance: one of debit, credit required — Which side a positive figure sits on.
- is-subtotal: boolean required — True where the position is a sum of its children rather than of accounts.
- small-company-exempt: boolean required — Whether § 266 Abs. 1 lets a small company omit it.
- status: one of active, retired required — A retired position keeps its history.

## Identified by
chart and position-code

## Created on demand
no

## Invariants
- a position names its law: legal-reference exists
- a position belongs to one chart: chart exists

## Predicates
- a balance sheet position: statement is "balance-sheet"
- an income statement position: statement is "profit-and-loss"
- an asset position: section is "assets"
- an equity or liability position: section is "equity-and-liabilities"
- a subtotal: is-subtotal is true
- a leaf position: is-subtotal is false
- has a range: account-range-from exists
- has explicit inclusions: included-accounts exists
- has exclusions: excluded-accounts exists
- top level: level is 1
- exempt for a small company: small-company-exempt is true
- active: status is "active"

## Authorized by
- create: controller or tax-accountant
- read: auditor or controller or tax-accountant or accountant
- update: controller or tax-accountant
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

### Why the range endpoints are text, and why nothing checks the range

Account numbers are text — 0800 is not 800, and a numeric type loses the leading zero on the first
round-trip. So the range endpoints are text too.

The consequence is that **the model cannot check that a range runs forward.** `account-range-from <=
account-range-to` is refused at parse time: `<=` has no meaning for a text field (grammar §2.1), because
ordering text is a decision about collation and the grammar declines to make one. That refusal is correct
and it costs this file its most obvious invariant.

Whoever compares the numbers therefore has to know that it is a *lexicographic* comparison. For fixed-width
numbers of equal length that is the same as numeric order, which holds for SKR03, SKR04 and the
international chart because all three are four digits throughout. It does **not** hold for a chart mixing
three- and four-digit numbers, where "999" sorts after "1000". `test/f2-ledger.test.js` checks the seeded
ranges; a company introducing a five-digit account gets no warning from anything.

### `included-accounts` and `excluded-accounts`

Comma-separated numbers in a text field, which is not elegant. The reason is the same one
`information/oss-return.md` gives: a document has a flat set of declared fields and no repeating group, so a
list of account numbers is either a text field or a separate entity with one document per pairing. A separate
entity would be cleaner and would let the mapping be aggregated over. It is not built, and the honest
consequence is that **the account-to-position mapping is not machine-verifiable from these documents alone**
— nothing refuses a mapping that assigns one account to two positions, or none.

`test/f2-ledger.test.js` checks the mapping for exactly those two faults over the seeded charts, so the
defect is detected in this repository. It is not detected by an invariant, and a company editing the mapping
in the field would not be stopped. That is the clearest single reason this file is the weakest in the ledger
model.

### The positions this model seeds

Enough to close a balance sheet and a P&L for the flows that exist: inventories, trade receivables, cash at
bank, other assets, subscribed capital, retained earnings, the result for the year, trade payables and other
liabilities on the balance sheet; revenue, change in inventories, cost of materials, other operating
expenses and the financial result in the P&L. Seventeen positions — thirteen leaves and four subtotals —
in the *Gesamtkostenverfahren* (§ 275 Abs. 2 HGB), which is what a German merchandise trader files. They are
seeded from `information/_statement-positions.md`.

What is absent is most of § 266: intangible and tangible fixed assets, financial assets, prepayments,
provisions, and the equity detail below subscribed capital. A company with a warehouse it owns needs them.

### Why the statement is aggregated and not stored

There is no `balance-sheet` document. The statement is `sum of amount over posting where …` grouped by
position, computed when someone asks, from postings that cannot be unbalanced. Storing it would create a
second version of the truth that has to be kept in step, and the *Jahresabschluss* that genuinely is a
signed document — with its notes, its management report and its adoption resolution — is a further act on
top, and is not modelled here.

## Retention

**10 years** under GoBD and § 147 AO. The mapping in force in a given year is part of how that year's
statements can be reproduced, so a retired position is kept.

## References

`information/ledger-account.md`, `information/trial-balance.md`, `information/_statement-positions.md`,
`processes/financial-statements.md`
