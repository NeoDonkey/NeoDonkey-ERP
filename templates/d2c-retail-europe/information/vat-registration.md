# VAT registration

Where we are registered for VAT, under which number, and with which filing obligation. One
record per country plus one for the One-Stop-Shop.

A German webshop selling into five countries can operate on one German registration plus
OSS — until it puts stock in a warehouse abroad. From that moment the sale from that
warehouse to a consumer in that country is a domestic supply there, OSS does not cover it,
and a local registration is required. Companies discover this late and expensively. Having
it as an entity means the fulfilment decision and the tax consequence sit in the same
sentence.

## Fields
- id: text required — vat-de, vat-nl, vat-oss.
- country: text required — ISO code, or EU for the OSS registration.
- registration-number: text required — USt-IdNr. or the local equivalent.
- registration-type: text required — domestic, foreign-local, oss.
- valid-from: date required
- valid-to: date
- filing-frequency: text required — monthly, quarterly, annual.
- filing-deadline-day: number required — Day of the following period.
- permanent-extension: text — yes or no. German *Dauerfristverlängerung*.
- oss-threshold-eur: number — 10000 on the OSS record.
- oss-threshold-exceeded: text — yes or no. Derived, recalculated monthly.
- local-tax-representative: reference to supplier — Required in some member states.
- status: text required — active, pending, deregistered.

## Identified by
country

## Created on demand
no

## Predicates
- active: status is "active"
- oss registration: registration-type is "oss"
- threshold exceeded: oss-threshold-exceeded is "yes"
- local registration: registration-type is "foreign-local"
- needs local representative: local-tax-representative exists
- filing overdue: status is "active" and filing-frequency is "monthly"

## References
- `local-tax-representative` → `supplier`
- referenced by → `location`

## Retention
Tax registration records are retained **10 years** past deregistration. OSS returns and the
underlying transaction lists are retained **10 years** as required by the OSS scheme itself.

## Notes
### threshold exceeded
Once this holds, cross-border B2C sales must be taxed at the destination rate. The rule in
`processes/b2c-sales-order.md` reads exactly this predicate, so the tax behaviour of the
whole webshop changes by one field flipping — which is what actually happens in reality.

### filing overdue
<!-- NEEDS-GRAMMAR: this predicate cannot express what it means, which is "the period is
     closed and no return has been filed by the deadline". It needs date arithmetic and a
     count over related filings. It is left in deliberately as an honest marker rather than
     quietly dropped. v0.2 proposals: a `today` symbol with date comparison, and a
     `count of <entity> where <condition>` aggregate. Until then, filing deadlines are
     tracked by `management-system/month-end-close.md` as a human checklist item, which is
     a real compromise and is stated as one. -->
     a real compromise and is stated as one. -->

### Used by

`processes/b2c-sales-order.md`, `processes/vat-return-preparation.md`,
`management-system/month-end-close.md`
