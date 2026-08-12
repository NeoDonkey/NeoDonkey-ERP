# VAT return (Umsatzsteuervoranmeldung)

The monthly German VAT return, as a document whose every figure is an aggregation over postings. That is
the point of it being here rather than in a report: the return is not a rendering of the ledger, it *is*
the ledger, summed by the fields the postings already carry. A figure that cannot be traced to the
postings behind it is a figure a *Betriebsprüfer* will ask about, and the answer should be one query, not
a spreadsheet somebody kept.

The field names are the ELSTER *Kennzahlen*, because that is what the form asks for and what the tax
adviser reads out loud. Line 81 is turnover at 19 %, line 86 at 7 %, line 41 intra-community supplies,
line 43 other exempt turnover with a deduction — exports live there — line 45 turnover that is not
taxable in Germany, which is where One-Stop-Shop sales appear, line 89 intra-community acquisitions,
line 61 the input tax on those acquisitions, line 66 input tax from suppliers' invoices, line 67 input tax
under § 13b, and line 83 what is actually owed. Each of them is an invariant away from being wrong.

Reverse charge is the interesting case and it is worth following. A purchase from a Dutch supplier under
§ 1a UStG puts the net amount in line 89 as an acquisition, generates output tax we owe on it, and — where
we are entitled to deduct — the identical figure in line 61 as input tax. Net effect on line 83: zero. The
two halves are separate postings to separate accounts, which is what makes it visible; a system that
"nets it out" produces a return that is arithmetically right and unexplainable.

## Fields
- period-key: text required — Which month, e.g. 2026-07.
- accounting-period: reference to accounting-period required — The period the figures come from.
- fiscal-year: number required — 2026.
- chart: reference to chart-of-accounts required — Which chart the account numbers belong to.
- currency: text required — EUR. A German return is filed in euros only.
- kz-41-intra-community-supplies: money required — Exempt supplies to EU businesses. Base.
- kz-43-other-exempt-with-deduction: money required — Exports and other exempt turnover with a deduction. Base.
- kz-45-non-taxable-turnover: money required — Turnover with a place of supply outside Germany. OSS sales.
- kz-81-taxable-19-base: money required — Turnover at 19 %. Base.
- kz-81-taxable-19-tax: money required — Output tax on that base, as booked.
- kz-86-taxable-7-base: money required — Turnover at 7 %. Base.
- kz-86-taxable-7-tax: money required — Output tax on that base, as booked.
- kz-89-acquisitions-19-base: money required — Intra-community acquisitions at 19 %. Base.
- kz-89-acquisitions-19-tax: money required — Output tax we self-assess on them.
- kz-84-reverse-charge-tax: money required — Output tax we self-assess under § 13b.
- kz-61-input-vat-on-acquisitions: money required — Deductible input tax on acquisitions. Line 61.
- kz-66-input-vat-on-invoices: money required — Deductible input tax from suppliers' invoices. Line 66.
- kz-67-input-vat-reverse-charge: money required — Deductible input tax under § 13b. Line 67.
- total-output-tax: money required — Everything we owe before deduction.
- total-input-tax: money required — Everything we deduct.
- kz-83-payable: money required — The balance. Positive means we pay, and this model files no refunds.
- computed-payable: money required — Line 83 accumulated from the thirteen lines by the rules. Starts at zero.
- bases-declared-in-full-euros: boolean required — Whether the submitted bases were truncated for ELSTER.
- prepared-by: reference to employee required — Who prepared it.
- prepared-on: date required — When.
- reviewed-by: reference to employee — Who reviewed it before submission.
- submitted-on: date — When it went to ELSTER.
- submission-reference: text — The ELSTER transfer ticket.
- permanent-extension: boolean required — Whether a Dauerfristverlängerung applies.
- status: one of draft, reviewed, submitted, amended required — Where it stands.
- amends: reference to vat-return — Set on a corrected return. Never set on the original.
- amendment-reason: text — Why it was corrected.

## Identified by
period-key and fiscal-year

## Created on demand
no

## Invariants
- line 83 adds up: computed-payable = kz-83-payable
- a return covers one month of one chart: accounting-period exists
- the payable amount is not negative: kz-83-payable >= 0

## Predicates
- draft: status is "draft"
- reviewed: status is "reviewed"
- submitted: status is "submitted"
- an amendment: amends exists
- amendment explained: amendment-reason exists
- review named: reviewed-by exists
- nothing to pay: kz-83-payable is "0.00 EUR"
- payment due: kz-83-payable > "0.00 EUR"
- has intra community supplies: kz-41-intra-community-supplies > "0.00 EUR"
- has acquisitions: kz-89-acquisitions-19-base > "0.00 EUR"
- has oss turnover: kz-45-non-taxable-turnover > "0.00 EUR"
- reverse charge involved: kz-84-reverse-charge-tax > "0.00 EUR"
- extension applies: permanent-extension is true
- filed with a ticket: submission-reference exists

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

### Thirteen aggregation invariants, and what they buy

Every line of the return is compared with the postings it claims to summarise, so a return whose figures
were touched after preparation is refused. That is the difference between a return and a report: a report
is a picture of the books at a moment, a return is a document with legal consequences whose agreement with
the books is checked every time anything changes. If a July posting is corrected in August, the July return
does not silently become wrong — it becomes *refused*, which is how somebody finds out that an amendment is
needed.

### Line 83 adds up, and it took no new grammar

Line 83 is `81 + 86 + 89 + 84 − 61 − 66 − 67`. No *condition* can express that — POLISM has no `+` or `−` in a
comparison and should not gain any. But a **counter** has added and subtracted since version 1, and grammar
§17's `from` lets a counter read a differently named field. So `processes/vat-return.md` accumulates
`computed-payable` from seven counters, four adding and three subtracting, and the invariant `line 83 adds up`
compares the result with the figure being submitted.

The consequence is worth stating precisely, because it is the one part of this document that *is* checked: a
return whose line 83 does not follow from its own thirteen lines cannot be created. What is still unchecked is
whether those thirteen lines follow from the postings — see the section above, which is a different and larger
gap. So the arithmetic is structural and the aggregation is not.

`total-output-tax` and `total-input-tax` remain captured; they are presentation of the same seven figures and
nothing depends on them. `reviewed-by` still exists, because a reviewer checks the *classification*, which no
rule can.
### The bases go to ELSTER in full euros

The *Umsatzsteuervoranmeldung* takes *Bemessungsgrundlagen* as whole euros, truncated, and tax amounts to
the cent. So a July turnover of 4,999.99 EUR at 19 % is declared with a base of 4,999 EUR, while the tax
actually booked on account 1776 is 950.00 EUR — the commercially rounded 19 % of 4,999.99. ELSTER's own
computation on the truncated base gives 949.81 EUR, and the 19-cent difference is a reconciliation item that
stays on the VAT account, exactly as it does in every German set of books.

That is why this document holds the **exact** figures and `bases-declared-in-full-euros` records that the
submitted ones were truncated. The truncation happens in the ELSTER export, which is wave 3. Nobody should
discover this difference for the first time when the *Finanzamt* assessment arrives.

### `nothing to pay: kz-83-payable is "0.00 EUR"`

A money literal in the FD-1 canonical form, compared exactly. Note what it does *not* say: there is no
predicate for a refund. This model files returns where tax is owed, and a month with more input tax than
output tax — which happens whenever a large purchase lands — produces a negative line 83 that the invariant
`amount > "0.00 EUR"` on postings cannot express and this document cannot represent. **A refund month is
not modelled.** That is a real gap for a growing company buying stock ahead of a season, and it is named in
the report.

### What is not here

No annual VAT return (*Umsatzsteuererklärung*), no *Zusammenfassende Meldung* (the EC sales list — a
separate filing that `information/vat-treatment.md` flags and nothing here produces), no
*Dauerfristverlängerung* prepayment of one eleventh, no § 23 UStG flat rates, no quarterly filing schedule,
and no ELSTER transmission. The return is computed and recorded; filing it is an outbound dialect.

## Retention

**10 years** under GoBD, § 147 AO and § 14b UStG. The return, the postings behind it and the signed commit
that prepared it are the evidence. An amended return never overwrites the original.

## References

`information/posting.md`, `information/ledger-account.md`, `information/vat-treatment.md`,
`information/oss-return.md`, `processes/vat-return.md`, `processes/period-close.md`
