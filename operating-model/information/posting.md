# Posting

One line of one journal entry: an account, a side, an amount, a date, and enough reference for somebody
to find the paper behind it eight years later. A German accountant would call this the *Buchungszeile*;
the entry it belongs to is the *Buchungssatz*.

Three properties are worth arguing about, because most systems get one of them wrong. The **amount is
always positive** and the **side is declared** — there is no negative debit, so the same event cannot be
written two ways. The **account is named by number, and the chart is named too**, because 1200 is the
bank in SKR03 and trade receivables in SKR04, and a posting that stores only the number cannot say which
it meant. And the **period is on the posting**, not only on the entry, so that the lock is enforceable at
the line an auditor is looking at.

The foreign-currency fields are the visible half of FD-1. `amount` is always in the ledger currency;
`original-amount`, `original-currency` and `exchange-rate` say where it came from. A reader can
recompute the translation from the documents alone, without trusting that the software did it right, and
that is the whole point of making the rate a modelled fact instead of a configuration setting.

## Fields
- journal-entry: reference to journal-entry required — The entry this line belongs to.
- position: number required — Line number within the entry. Starts at 1. An OR-Set has no order.
- account-number: text required — The account, as the accountant dials it.
- chart: reference to chart-of-accounts required — Which chart that number belongs to.
- ledger-account: reference to ledger-account required — The account document itself.
- side: one of debit, credit required — Soll or Haben. There is no third option and no sign.
- amount: money required — Always positive, always in the ledger currency.
- currency: text required — The ledger currency, repeated here so a posting reads alone.
- posting-date: date required — The date that decides the period.
- accounting-period: reference to accounting-period required — Which month it lands in.
- description: text required — Buchungstext for this line.
- contra-account-number: text — Gegenkonto, on a two-line entry. A convenience for reading, not a second posting.
- source-document-reference: text required — Belegnummer. What to look for in the filing.
- vat-treatment: reference to vat-treatment — Which tax situation produced this line.
- vat-kennzahl: text — The UStVA line, copied from the account so the return can aggregate on the posting.
- vat-role: one of none, output-tax, input-tax, taxable-turnover, exempt-turnover, non-taxable-turnover, acquisition-turnover required — Copied from the account. Says whether this line is a base or a tax.
- vat-rate-percent: number — The rate applied. Zero on exempt and reverse-charge lines.
- tax-base-amount: money — On a tax line, the net the tax was computed from. Required for the VAT return.
- datev-tax-key: text — The DATEV BU-Schlüssel for the export.
- original-currency: text — The document currency, where it is not the ledger currency.
- original-amount: money — The amount in the document currency.
- exchange-rate: reference to exchange-rate — The rate document used to translate it.
- cost-centre: text — Kostenstelle, where the company runs one.
- article: reference to article — For an inventory or write-off line.
- customer: reference to customer — On a receivables line.
- supplier: reference to supplier — On a payables line.
- reverses: reference to posting — Set on the line of a Storno entry that reverses this one.

## Identified by
journal-entry and position

## Created on demand
no

## Invariants
- the amount is positive: amount > "0.00 EUR"
- the amount is in the ledger currency: currency is chart.ledger-currency
- the posting is inside an open period: accounting-period not locked
- the account exists: ledger-account exists
- the account is not retired: ledger-account active

## Dated in
- posting-date in accounting-period

## Predicates
- debit: side is "debit"
- credit: side is "credit"
- a tax line: vat-kennzahl exists
- a foreign currency line: original-currency exists
- rate documented: exchange-rate exists
- translated: original-amount exists
- reverses another line: reverses exists
- has a document reference: source-document-reference exists
- carries a tax base: tax-base-amount exists
- to a control account: ledger-account rule maintained

## Authorized by
- create: accountant or tax-accountant
- read: auditor or controller or tax-accountant or accountant or treasurer
- update: tax-accountant
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

### `- the amount is positive: amount > "0.00 EUR"`

A money literal, in the FD-1 canonical form, inside a condition. It is a string because every JSON parser
on earth turns `0.00` into an IEEE 754 double, and because an amount without a currency is not an amount.
The comparison is exact BigInt minor units in the money core, and comparing `0.00 EUR` with a CHF amount
is refused rather than converted — which is the behaviour that catches a mis-typed multi-currency posting
instead of quietly halving it.

### The invariant that is missing: a foreign amount must name its rate

What the ledger requires here is *conditional*: **if** `original-amount` is set **then** `exchange-rate`
must exist. That sentence is not in the `## Invariants` list above, and not by oversight — an invariant is
a conjunction of conditions, and there is no implication and no branch inside one. Writing
`original-amount exists and exchange-rate exists` would refuse every ordinary domestic posting, and
writing nothing and saying nothing would be worse than either.

So the obligation is carried by rules instead: `processes/foreign-currency-settlement.md` refuses a
foreign-currency posting whose rate document is missing, and every rule that creates such a posting names
the rate. That is enforcement at the point of creation rather than a property of the document, which is a
genuinely weaker guarantee — a posting written by some future rule that forgets would not be caught. The
construct needed is one line of grammar — a conditional invariant, `when <condition> then <condition>` inside
`## Invariants` — and it is the first item in the request list that accompanies this work. Grammar version 2
added invariants but not implication inside one.

### Why `chart` is on every line, and the invariant that is not here

Because the alternative is a join to find out what an account number meant, on every line of every report.

What is **not** in the invariant list is `chart is journal-entry.chart` — a line may not reference an
account from a chart the entry is not keeping. The condition grammar refuses it, and the refusal is right:
comparing two *reference* fields compares two whole documents, and `=` is defined on values
(grammar §4.2). What would work is `chart.name is journal-entry.chart` — except that is a comparison of a
value with a document, refused for the same reason — or a one-hop pair, which needs two hops from here.

So a mismatched chart on a posting line is not refused, and the error it produces is a trial balance that
balances and is nonetheless nonsense. It is caught in `test/f2-ledger.test.js` and it is in the request list:
the grammar addition needed is equality between two reference fields, defined as equality of the ids, which is
a small and safe form.

### `vat-kennzahl` and `vat-role` are copied from the account

Both are derived data, copied onto the posting when the posting is made, so that
`processes/vat-return.md` can aggregate over postings alone without reaching through to the account
document for every line. The cost is that changing an account's Kennzahl does not retroactively change
old postings — which is not a bug: a July posting must keep the classification that was law in July.
That is `Zeitgerechtigkeit` and it is why the copy is the right answer rather than the convenient one.

`vat-role` is what makes the return computable at all. Line 81 of the *Umsatzsteuervoranmeldung* wants
the taxable *base*; line 66 wants the *tax*. Both are amounts on postings. Without a field saying which
of the two a line is, the return would have to know that 81 means base and 66 means tax — and that is
German tax knowledge, which must not live in the runtime. With it, the return sums bases from
`taxable-turnover` lines and tax from `output-tax` lines and knows nothing about German law.

### Why no posting is ever excluded by status

Aggregations over postings — the trial balance, the VAT return, the balance sheet — filter on account,
period, side and tax role, and never on the status of the entry. They do not need to, because a mistaken
entry is not cancelled in place: it is reversed by a *Storno*, a full entry with the sides swapped and its
own number. So every posting in the repository counts, always, and there is no state in which a figure
depends on remembering to exclude something. That is the same reason a paper journal was written in ink.

### `contra-account-number`

Pure reading convenience for the common two-line entry, where "1400 an 8400" is how an accountant says
it out loud. It is not a second posting and nothing aggregates over it. On an entry with four lines it is
empty, because there is no single contra account, and pretending otherwise is how *Buchungssatz*
displays end up wrong.

### What a posting deliberately does not have

No quantity, no unit price, no line-level margin. Those belong to the order and invoice lines, which
reference the same article. A ledger that carries operational detail becomes the place people query for
operational questions, and then it grows dimensions, and then it is a data warehouse with a trial balance
attached. `cost-centre` is the one exception, because German cost accounting expects it on the line.

## Retention

**10 years** under GoBD and § 147 AO, as part of the journal entry. A posting is never edited and never
deleted; a wrong line is corrected by a new entry.

## References

`information/journal-entry.md`, `information/ledger-account.md`, `information/exchange-rate.md`,
`processes/trial-balance.md`, `processes/vat-return.md`
