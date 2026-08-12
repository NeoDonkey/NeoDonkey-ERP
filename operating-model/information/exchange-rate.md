# Exchange rate

A rate, the day it applied, and where it came from. Nothing else, and nothing hidden.

FD-1 is blunt about this: mixed currencies do not add, and conversion is an explicit modelled act
carrying its rate and date, because that is what an auditor must be able to see. So a rate is a document
with an id, not a number pulled from a service at posting time and forgotten. Given the invoice, the
payment and the two rate documents, anybody with a calculator can reproduce the exchange difference that
hit the profit and loss account — which is the difference between a ledger you can audit and one you have
to trust.

`rate` is a string for exactly the reason money is a string: `1.0345` becomes an IEEE 754 double the
moment a JSON parser sees it, and a rate multiplied into a five-figure amount turns that into cents.
Arithmetic goes through the money core's exact rational multiplication, and the rounding mode is declared
on the chart, not chosen by whoever wrote the code.

German tax law has an opinion too, and it is narrower than most people expect: § 16 Abs. 6 UStG requires
the *Umsatzsteuer-Umrechnungskurse* published monthly by the Bundesministerium der Finanzen for
translating foreign-currency turnover for VAT purposes — not the rate your bank gave you. So `source`
matters, and a company that uses a daily ECB reference rate for its books still needs the monthly
published rate for the VAT return. Both are documents here.

## Fields
- from-currency: text required — The document currency, e.g. CHF.
- to-currency: text required — The ledger currency, e.g. EUR.
- rate-date: date required — The day this rate applies to.
- rate: text required — Units of to-currency for one unit of from-currency, as an exact decimal string.
- inverse-rate: text — The other direction, where the source publishes it that way.
- source: one of ecb-reference, bmf-monthly, bank-contract, manual required — Where it came from.
- source-reference: text required — The publication or contract this rate was read from.
- purpose: one of bookkeeping, vat-translation, both required — What it may be used for.
- captured-by: reference to employee required — Who entered it.
- captured-on: date required — When.
- status: one of active, superseded required — A corrected rate supersedes rather than overwrites.

## Identified by
from-currency and to-currency and rate-date and purpose

## Created on demand
no

## Invariants
- a rate translates between two different currencies: from-currency is not to-currency
- a rate names its source: source-reference exists

## Predicates
- active: status is "active"
- superseded: status is "superseded"
- usable for bookkeeping: purpose is not "vat-translation"
- usable for vat: purpose is not "bookkeeping"
- officially published: source is "bmf-monthly"
- from the central bank: source is "ecb-reference"
- entered by hand: source is "manual"

## Authorized by
- create: treasurer or tax-accountant
- read: auditor or controller or tax-accountant or accountant or treasurer
- update: treasurer or tax-accountant
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

### Why the business key has four parts

`from-currency and to-currency and rate-date and purpose`. Without `purpose` there could only be one
CHF-to-EUR rate per day, and a German company legitimately needs two: the ECB reference rate its books
use and the BMF monthly rate its VAT return uses. They differ, both are correct for their purpose, and a
model that forces a choice forces somebody to compute the VAT return by hand.

### `usable for vat: purpose is not "bookkeeping"`

Stated negatively so that `both` qualifies. The same shape as `accepts postings` on the accounting period,
and for the same reason: a new value added to the enumeration later should not silently gain a permission
it was never considered for.

### Superseded, not overwritten

A rate typed wrongly is not corrected in place. The wrong document is set to `superseded`, a new one is
created, and the postings that used the wrong rate are corrected by new entries. This is more work than
editing a field, and it is the only version of events that survives the question "was this rate the same
in August as it is now".

### Not modelled

No rate feed, no automatic retrieval, no interpolation across dates, and no rate for a date the company
has not captured. A posting whose date has no rate document is refused rather than translated at the
nearest available rate — nearest-available is exactly the kind of quiet helpfulness that produces a
figure nobody can reproduce. Retrieval belongs to an inbound dialect (wave 3), not here.

## Retention

**10 years** under GoBD and § 147 AO. The rate is part of the evidence for every posting that used it, and
for the VAT return of the month it belongs to.

## References

`information/posting.md`, `information/journal-entry.md`,
`processes/foreign-currency-settlement.md`, `processes/vat-return.md`
