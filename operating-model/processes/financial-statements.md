# Financial statements

Turning the trial balance into a *Bilanz* and a *Gewinn- und Verlustrechnung*. German law does most of the work
here: § 266 HGB gives the balance sheet's positions and their order and § 275 gives the P&L, and a
*Kapitalgesellschaft* has no discretion about either. So the structure is data with legal references on it, and
the statement is an aggregation over postings grouped by position.

There is deliberately no `balance-sheet` document. The statement is computed when somebody asks, from postings
that cannot be unbalanced, because storing it would create a second version of the truth that has to be kept in
step. The *Jahresabschluss* that genuinely is a signed document — with its notes, its management report and its
adoption resolution — is a further act on top and is not modelled.

The check worth doing on the result is the one every accountant does: assets minus liabilities minus opening
equity equals the profit computed from the P&L accounts. Two independent routes to one number.

## Triggered by
The controller or the tax adviser drawing up the statements, monthly for management and annually for filing.

## Rules

If Create financial-statement-line under condition
  chart exists and
  position-code exists and
  legal-reference exists and
  caption exists and
  statement exists and
  normal-balance exists
  authorized by controller or tax-accountant
then
  Update financial-statement-line with status "active"
    with legal-reference
    with position-code
    with position

## Notes

### The worked figures

For the month exercised in `test/f2-ledger.test.js`, after an opening capital of 50,000.00 EUR:

| | |
|---|---|
| Revenue (8400, 8336, 8120) | 15,999.99 EUR |
| Change in inventories (3960) | 12,000.00 EUR |
| Cost of materials (3425) | −12,000.00 EUR |
| Inventory write-offs (4855) | −300.00 EUR |
| Currency translation loss (4840) | −200.00 EUR |
| **Result** | **15,499.99 EUR** |

And from the other side:

| | |
|---|---|
| Assets: bank 66,249.99, receivables 600.00, input VAT 2,280.00, inventory 11,700.00 | 80,829.99 EUR |
| Equity and liabilities: capital 50,000.00, payables 12,000.00, VAT 3,330.00 | 65,330.00 EUR |
| **Difference** | **15,499.99 EUR** |

The two agree to the cent, which is what a balance sheet is for. Both are recomputed from the postings in the
test rather than asserted from a stored figure.

### What the mapping cannot check about itself

Accounts reach positions through an inclusive number range plus explicit inclusion and exclusion lists held as
text. `information/financial-statement-line.md` says why — a document has no repeating group — and states the
consequence: **nothing refuses a mapping that assigns one account to two positions, or to none.** A balance
sheet built on such a mapping is almost right, which is the worst kind.

`test/f2-ledger.test.js` checks the seeded mapping for exactly those two faults, so the defect is detected in
this repository. It is not detected by an invariant, and a company editing the mapping in the field would not
be stopped. That is the weakest point in the ledger model and the exit path is a mapping entity with one
document per account-to-position pairing, which needs nothing new from the grammar.

### Ranges are compared as text

Account numbers are text, because 0800 is not 800, so `account-range-from <= account-range-to` is a
lexicographic comparison. For fixed-width numbers of equal length that is numeric order, which holds for SKR03,
SKR04 and the international chart because all three are four digits throughout. It does not hold for a chart
mixing three- and four-digit numbers, where "999" sorts after "1000". A company introducing a five-digit
account has to know this.

### What is not here

Most of § 266: intangible and tangible fixed assets, financial assets, prepayments, provisions, and the equity
detail below subscribed capital. No accruals, no deferrals, no depreciation, no deferred tax. No cash flow
statement, no notes, no *Anhang*, no *Lagebericht*. No consolidation across legal entities, which reads several
repositories and is FD-3. A company with a warehouse it owns and staff it employs needs all of it, and none of
it is here.

## References

`information/financial-statement-line.md`, `information/trial-balance.md`, `information/ledger-account.md`,
`processes/trial-balance.md`, `processes/period-close.md`
