# OSS return (One-Stop-Shop)

The quarterly return for VAT owed to *other* member states on distance sales to consumers. It exists
because since July 2021 a German webshop selling to a French consumer owes French VAT at the French rate
once its cross-border B2C turnover passes 10,000 EUR EU-wide in a calendar year — and the One-Stop-Shop
lets it declare all of that through the Bundeszentralamt für Steuern instead of registering in every
country.

It is a separate document from `information/vat-return.md` for a reason that catches people out: OSS
turnover is **not** German taxable turnover. It appears in the German UStVA only in line 45, as turnover
whose place of supply is elsewhere, and the tax itself never touches account 1776. If it did, the
*Umsatzsteuervoranmeldung* would overstate German VAT and the *Finanzamt* would collect tax that belongs to
France. That is why the chart carries a separate OSS output-tax account, and why that account is one of the
company-defined ones.

One return covers one quarter and many countries at many rates, so there is one document per country per
quarter and the quarter is the business key together with the country. That is a modelling choice made
under a real constraint — this model has no way to hold a repeating group of country lines inside one
document — and it is described honestly in the notes rather than presented as elegance.

## Fields
- quarter-key: text required — Which quarter, e.g. 2026-Q3.
- fiscal-year: number required — 2026.
- destination-country: text required — The member state the tax is owed to, as a two-letter code.
- accounting-period: reference to accounting-period required — The month the figures were struck in.
- chart: reference to chart-of-accounts required — Which chart the account numbers belong to.
- currency: text required — EUR. OSS is declared in euros regardless of the sale currency.
- vat-rate-percent: number required — The destination country's rate that applied.
- taxable-base: money required — Net distance-sale turnover to that country in the quarter.
- tax-amount: money required — VAT owed to that country.
- threshold-exceeded: boolean required — Whether the EU-wide 10,000 EUR threshold was passed.
- threshold-exceeded-on: date — The day it was passed, in the year it was passed.
- prepared-by: reference to employee required — Who prepared it.
- prepared-on: date required — When.
- reviewed-by: reference to employee — Who reviewed it.
- submitted-on: date — When it went to the Bundeszentralamt.
- submission-reference: text — The transmission reference.
- paid-on: date — When the money was sent.
- status: one of draft, reviewed, submitted, paid, amended required — Where it stands.
- amends: reference to oss-return — Set on a corrected return. Never set on the original.
- amendment-reason: text — Why.

## Identified by
quarter-key and destination-country

## Created on demand
no

## Invariants
- a return names one country: destination-country exists
- the base is positive: taxable-base > "0.00 EUR"
- a rate applies: vat-rate-percent > 0

## Predicates
- draft: status is "draft"
- reviewed: status is "reviewed"
- submitted: status is "submitted"
- paid: status is "paid"
- an amendment: amends exists
- amendment explained: amendment-reason exists
- threshold passed: threshold-exceeded is true
- below threshold: threshold-exceeded is false
- review named: reviewed-by exists
- tax owed: tax-amount > "0.00 EUR"
- filed with a reference: submission-reference exists

## Authorized by
- create: tax-accountant
- read: auditor or controller or tax-accountant or managing-director
- update: tax-accountant or controller
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

### The one-country-per-document choice, and its cost

The real OSS return is one filing with a line per member state per rate. Here it is one document per
country per quarter, and the filing is the set of them. POLISM has no repeating group inside a document —
a document is a flat set of declared fields — so the alternatives were a fixed set of fields per country,
which breaks the day the company sells to a twenty-eighth destination, or this.

The cost is visible and should be stated: **there is no single document that represents the filing as
submitted.** An auditor asking "show me the OSS return you filed for Q3" is shown several documents and a
transmission reference, and the reconciliation between them is a person's work. That is a genuine
shortcoming of the ledger model and the exit path is an aggregate return document that references the
per-country ones — which needs nothing new from the grammar and simply has not been built.

### The base is captured, not derived, and two grammar limits are why

The invariant this document wants is `taxable-base = sum of the non-taxable turnover of this quarter for
this country`. It needs three things the grammar does not have. An aggregate links to the document it is
written on only through `for this <entity>`, whose context entity must *be* that entity (§13.2), so a
period-scoped sum cannot be written on an OSS return. A `where` takes exactly one condition (§13.1), and
this needs two — the Kennzahl and the country. And the postings do not carry a destination country at all,
so even with two `where` conditions the country could not be filtered.

That last one is the fixable part and it is one field: `destination-country` on the posting, copied from the
sales invoice. It is not done here because `information/invoice.md` does not declare it and changing the
sales invoice is not this work's to do alone. The base is therefore captured, checked by
`test/f2-ledger.test.js` against the postings for the worked quarter, and not refused by the model. It is
the first thing to fix in this file.

### `threshold-exceeded`

The EU-wide 10,000 EUR threshold is a running total across all cross-border B2C turnover in the calendar
year, and `information/vat-treatment.md` already carries it as a maintained flag with the honest note that
it is recalculated monthly because the grammar had no aggregation. With aggregation available, that flag can
become derived — and it should, because the day it flips, the tax behaviour of the entire webshop changes,
and a maintained flag that somebody forgot to recalculate is a month of French VAT charged at German rates.

### What is not here

No IOSS for imported consignments under 150 EUR, no per-country rate table (the rate is captured per
return), no OSS correction mechanism within the three-year window, and no transmission. A country's rate
changing mid-quarter needs two documents and this model would let you write one.

## Retention

**10 years** under GoBD and § 147 AO; the OSS regime itself requires ten years of records. An amended return
never overwrites the original.

## References

`information/vat-treatment.md`, `information/vat-return.md`, `information/posting.md`,
`processes/oss-return.md`, `locations/webshop.md`
