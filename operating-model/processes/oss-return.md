# OSS return

The quarterly One-Stop-Shop return: VAT owed to other member states on distance sales to consumers, declared
through the Bundeszentralamt für Steuern instead of registering in every country.

The reason it is a separate process from `processes/vat-return.md` is the reason it catches people out. OSS
turnover is **not** German taxable turnover. It appears in the German *Umsatzsteuervoranmeldung* only in line
45, as turnover whose place of supply is elsewhere, and the tax never touches account 1776. A webshop that
posts French VAT to the German VAT account has the *Finanzamt* collecting tax that belongs to France, and
finds out about it in a *Betriebsprüfung*.

The threshold is EU-wide and it is 10,000 EUR of cross-border B2C turnover in a calendar year. Below it,
German VAT applies to a sale to a French consumer; above it, French VAT at the French rate does. The day it
flips, the tax behaviour of the entire webshop changes.

## Triggered by
The tax accountant preparing the quarterly OSS declaration, one document per destination country.

## Rules

If Create oss-return under condition
  accounting-period exists and
  chart active and
  prepared-by exists and
  destination-country exists and
  vat-rate-percent > 0
  authorized by tax-accountant
then
  Update oss-return with prepared-by
    with prepared-on
    with destination-country
    with status "draft"

## Notes

### One document per country, and what that costs

The real filing is one return with a line per member state per rate. Here it is one document per country per
quarter, because a POLISM document is a flat set of declared fields with no repeating group. The consequence
is stated in `information/oss-return.md` and repeated here because it matters to an auditor: **there is no
single document representing the filing as submitted.** Somebody asking to see the Q3 return is shown several
documents and a transmission reference, and the reconciliation between them is a person's work.

### The base invariant is coarser than it looks

`taxable-base = sum of amount over posting where … vat-kennzahl is "45" …` sums **all** non-taxable turnover
in the period, not just this country's. Postings carry no destination country, so the aggregation cannot
filter by one. For a company selling into one foreign market that is exact; for one selling into four it is
wrong, and each of the four documents will be refused.

That is a defect. Fixing it is one field — `destination-country` on the posting, copied from the sales
invoice — and then the `where` clause gains `and destination-country is this.destination-country`. It is not
done here because the sales invoice does not currently declare that field and changing it is not this work's
to make alone. It is the first thing to fix.

### The threshold should be derived and is not

`information/vat-treatment.md` carries `oss-threshold-exceeded` as a flag recalculated monthly, with an honest
note that it is maintained because grammar version 1 had no aggregation. Aggregation now exists, so the flag
can become a computed figure — and it should, because a maintained flag that somebody forgot to recalculate is
a month of French VAT charged at German rates and eleven thousand euros of turnover in the wrong return.

### What is not here

No IOSS for imported consignments under 150 EUR, no per-country rate table, no correction within the
three-year window, no transmission, and no handling of a country changing its rate mid-quarter.

## References

`information/oss-return.md`, `information/vat-treatment.md`, `processes/vat-return.md`,
`locations/webshop.md`
