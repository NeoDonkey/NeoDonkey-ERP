# VAT return

Preparing the monthly *Umsatzsteuervoranmeldung*. Thirteen figures, each of them an aggregation over the
postings of one period, each of them checked against those postings by an invariant on
`information/vat-return.md`.

The point of computing it here rather than exporting it from a report is traceability. A *Betriebsprüfer*
asking why line 81 says 4,999 gets an answer that is one query over `documents/posting/` — the postings whose
`vat-kennzahl` is 81 and whose `vat-role` is `taxable-turnover` in that period — and the postings carry those
two fields because the accounts they hit carry them. The tax knowledge lives in
`information/vat-treatment.md` and `information/ledger-account.md`; the return knows only how to add up.

Reverse charge is the case to check first. A purchase from another member state puts the net in line 89, the
self-assessed tax we owe in the same line's tax figure, and — where we may deduct — the identical amount in
line 61. Net effect zero, two visible declarations, no netting.

## Triggered by
The tax accountant preparing the return after the trial balance is agreed and before the period is locked.

## Rules

If Create vat-return under condition
  accounting-period exists and
  chart active and
  prepared-by exists and
  prepared-on exists
  authorized by tax-accountant or controller
then
  Update vat-return with prepared-by
    with prepared-on
    with status "draft"
    with bases-declared-in-full-euros true
    and Update vat-return with +computed-payable from kz-81-taxable-19-tax
    and Update vat-return with +computed-payable from kz-86-taxable-7-tax
    and Update vat-return with +computed-payable from kz-89-acquisitions-19-tax
    and Update vat-return with +computed-payable from kz-84-reverse-charge-tax
    and Update vat-return with -computed-payable from kz-61-input-vat-on-acquisitions
    and Update vat-return with -computed-payable from kz-66-input-vat-on-invoices
    and Update vat-return with -computed-payable from kz-67-input-vat-reverse-charge

If Update vat-return under condition
  vat-return reviewed and
  submission-reference exists and
  submitted-on exists
then
  Update vat-return with status "submitted"
    with submission-reference
    with submitted-on
    with accounting-period

## Notes

### The thirteen figures are captured, not derived, and nothing refuses a wrong one

Read `information/vat-return.md` before relying on any figure here. The invariants that ought to pin each
line to the postings behind it cannot be written: an aggregate reaches its own document only through
`for this <entity>`, whose context entity must *be* that entity (grammar §13.2), so a period-scoped sum can
be written on an accounting period and not on a VAT return that references one — and a `where` takes exactly
one condition (§13.1) while line 81 needs two.

What that costs, concretely: a July return prepared on 8 August and a July posting corrected on 9 August
leaves a filed return that no longer matches the ledger, and **nothing says so**. Noticing it is the tax
accountant's job, `amends` and `amendment-reason` exist for the amendment, and an amendment never overwrites
the original. `test/f2-ledger.test.js` recomputes all thirteen figures from the postings for the worked
month and asserts them to the cent, so the arithmetic is verified in this repository — but that is a test,
not a control that travels with the software.

### The figures line by line, for the worked example

For the month exercised in `test/f2-ledger.test.js` — a 19 % domestic sale of 4,999.99 EUR net, an export of
10,500.00 EUR, a One-Stop-Shop sale of 500.00 EUR net, and a reverse-charge purchase from a Dutch supplier of
12,000.00 EUR net:

| Kennzahl | What it is | Figure |
|---|---|---|
| 81 base | Steuerpflichtige Umsätze 19 % | 4,999.99 EUR |
| 81 tax | Umsatzsteuer 19 % | 950.00 EUR |
| 43 | Weitere steuerfreie Umsätze mit Vorsteuerabzug — the export | 10,500.00 EUR |
| 45 | Nicht steuerbare Umsätze — the OSS distance sale | 500.00 EUR |
| 89 base | Innergemeinschaftliche Erwerbe 19 % | 12,000.00 EUR |
| 89 tax | Umsatzsteuer auf i. g. Erwerbe | 2,280.00 EUR |
| 61 | Vorsteuer aus i. g. Erwerben | 2,280.00 EUR |
| 66 | Vorsteuer aus Rechnungen anderer Unternehmer | 0.00 EUR |
| **83** | **Verbleibende Umsatzsteuer-Vorauszahlung** | **950.00 EUR** |

Line 83 is `81 + 86 + 89 + 84 − 61 − 66 − 67` = `950.00 + 0 + 2,280.00 + 0 − 2,280.00 − 0 − 0` = 950.00 EUR.
Note what is **not** in the return: the OSS *tax* of 100.00 EUR, which is owed to France and declared through
`processes/oss-return.md`. Putting it in line 81 would have the *Finanzamt* collect French tax.

### Line 83 is invariant-checked, by seven counters

Four `+` counters and three `−` counters, each reading a differently named field through grammar §17's `from`,
accumulating into `computed-payable`; then the invariant `line 83 adds up` on `information/vat-return.md`
compares that figure with `kz-83-payable`. Arithmetic composes (§5.4), so seven counters onto one field are
one sum, and a return whose line 83 does not follow from its own lines cannot be created.

This needed no new grammar, and this note previously said it did. What it does **not** check is whether the
thirteen line figures follow from the postings — that is the §13.2 limit described in
`information/vat-return.md`, and it is the larger of the two gaps by a distance. `reviewed-by` is still
required before submission, because a reviewer checks the classification, which no rule can.

### Full euros, and the nineteen cents

ELSTER takes *Bemessungsgrundlagen* as whole euros, truncated. So line 81 is submitted as 4,999 EUR while the
tax actually booked on 1776 is 950.00 EUR — commercially rounded 19 % of 4,999.99. ELSTER's own arithmetic on
the truncated base gives 949.81 EUR, and the 19-cent difference stays on the VAT account as a reconciliation
item, exactly as it does in every German set of books. This document holds the exact figures;
`bases-declared-in-full-euros` records that the submitted ones were truncated; the truncation happens in the
ELSTER export, which is not built.

### What is not here

No ELSTER transmission, no annual *Umsatzsteuererklärung*, no *Zusammenfassende Meldung* — the EC sales list
is a separate filing that `information/vat-treatment.md` flags and nothing here produces — no
*Dauerfristverlängerung* prepayment, no quarterly schedule, and **no refund month**. A month with more input
tax than output tax is not representable: `information/posting.md` requires positive amounts and the return
has no negative line 83. For a company buying stock ahead of a season that is a real gap and it is named in
the report.

## References

`information/vat-return.md`, `information/vat-treatment.md`, `information/posting.md`,
`processes/oss-return.md`, `processes/trial-balance.md`, `processes/period-close.md`
