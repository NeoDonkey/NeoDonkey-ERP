# Supplier invoice

The invoice we receive, as opposed to the one we send. It is a different document with different risks:
we do not control its number, its VAT treatment is somebody else's assertion, and the money leaves the
company when it is paid. Accounts payable is where fraud actually happens in mid-sized companies, and
almost always through one of three doors — an invoice for goods that never arrived, the same invoice paid
twice, or a changed bank account on a genuine invoice.

So the fields here are shaped around those three. `goods-receipt` and `purchase-order` tie the invoice to
something physical, and `three way matched` is the predicate that says all three agree. `posting-total`
is the *Buchungssumme* — the amount the entry will carry — and it exists because a reverse-charge
purchase posts more than any single amount printed on the invoice. Whether the invoice has already been
posted is answered by looking for a journal entry that names it, not by a flag somebody could set twice.

The input-VAT deduction has its own conditions and they are strict. § 15 UStG allows the deduction only
against an invoice that meets § 14 — a supplier VAT identification number, a proper description, the tax
shown separately. `deductible` is that checklist. Getting it wrong is not a rounding error: the deduction
is refused years later with interest, and by then the supplier is gone.

## Fields
- supplier-invoice-number: text required — The supplier's own number. Not ours, and not sequential.
- our-reference: text required — The internal reference we file it under.
- supplier: reference to supplier required — Who sent it.
- invoice-date: date required — The date on the invoice.
- received-on: date required — When it reached us. Both matter for the deduction period.
- purchase-order: reference to order — What we ordered.
- goods-receipt: reference to goods-receipt — What arrived.
- currency: text required — The invoice currency, which need not be the ledger currency.
- net-amount: money required — Before tax, in the invoice currency.
- vat-amount: money required — As shown on the invoice. Zero under reverse charge.
- gross-amount: money required — Net plus tax, in the invoice currency.
- posting-total: money required — The total the journal entry will carry, in the ledger currency.
- ledger-net-amount: money required — Net, translated into the ledger currency.
- ledger-vat-amount: money required — Tax we account for ourselves, in the ledger currency.
- exchange-rate: reference to exchange-rate — Required when the currency is not the ledger currency.
- vat-treatment: reference to vat-treatment required — Domestic, EU acquisition, § 13b, or import.
- supplier-vat-identifier: text — Required for an EU acquisition under reverse charge.
- vat-rate-percent: number required — The rate that applies. Zero on the supplier's face under reverse charge.
- expense-account-number: text required — Which account the cost goes to.
- reverse-charge: boolean required — Whether we self-account for the tax.
- input-vat-deductible: boolean required — Whether we may deduct it at all.
- non-deductible-reason: text — Why not, where not. Entertainment, private use, missing elements.
- payment-due-date: date required — When it must be paid.
- payment-terms: text required — As agreed, e.g. 30 days net, 2 % within 10 days.
- discount-amount: money — Skonto, where taken.
- accounting-period: reference to accounting-period required — Which month it is booked into.
- approved-by: reference to employee — Who approved it for payment.
- approval-count: number required — Starts at zero. Raised once per approving commit.
- blocked-for-payment: boolean required — Set when something does not match.
- block-reason: text — Why it is blocked.
- status: one of received, matched, approved, posted, paid, disputed, cancelled required — Where it stands.
- entered-by: reference to employee required — Who captured it.
- document-hash: text required — Hash of the received file. Unveränderbarkeit for an inbound document.

## Identified by
supplier and supplier-invoice-number

## Created on demand
no

## Invariants
- the posting total is positive: posting-total > "0.00 EUR"
- a supplier invoice is filed against a supplier: supplier exists
- the invoice cannot be received before it was written: invoice-date <= received-on

## Predicates
- received: status is "received"
- matched: status is "matched"
- approved: status is "approved"
- posted: status is "posted"
- paid: status is "paid"
- disputed: status is "disputed"
- blocked: blocked-for-payment is true
- releasable: blocked-for-payment is false
- three way matched: purchase-order exists and goods-receipt exists
- deductible: input-vat-deductible is true and supplier-vat-identifier exists and vat-rate-percent > 0
- an eu acquisition: reverse-charge is true
- domestic purchase: reverse-charge is false
- foreign currency: exchange-rate exists
- independently approved: approval-count >= 2
- approval named: approved-by exists
- non deduction explained: non-deductible-reason exists
- discount taken: discount-amount exists
- has a due date: payment-due-date exists

## Authorized by
- create: accountant or purchasing-manager
- read: auditor or controller or tax-accountant or accountant or treasurer or purchasing-manager
- update: accountant or controller or purchasing-manager
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

### `## Identified by supplier and supplier-invoice-number`

Not by the invoice number alone. Two suppliers will eventually both send an invoice numbered 1001, and a
system that treats them as one document has just paid one of them and lost the other. The pair is also
the duplicate-payment control: entering the same supplier's same number twice collides on the business
key, and the second one is refused rather than filed as a separate liability.

### posting-total, and why it is not derived

A domestic purchase posts net plus deductible input tax against the payable — the gross amount. A
reverse-charge acquisition from the Netherlands posts the net to *Innergemeinschaftlicher Erwerb*, the
same net to the payable, and then self-assessed output tax against deductible input tax for the same
figure: the entry total is net plus that tax, which appears nowhere on the supplier's invoice. POLISM does
not do arithmetic, so `posting-total` is a captured number, and the journal entry's balance invariants
are what stop a wrong one being posted. An accounts-payable clerk sees the Buchungssumme on every screen
in every ERP for the same reason.

### `deductible` and what it deliberately refuses

`input-vat-deductible is true and supplier-vat-identifier exists and vat-rate-percent > 0`. Three
conditions, and the third is the one people trip over: an invoice with no tax shown gives no deduction, so
a zero-rate invoice claiming a deduction is refused. Where the deduction is genuinely unavailable —
entertainment at 30 %, private use, an invoice missing a § 14 element — `non-deductible-reason` says so in
words, and the full gross amount goes to the expense account.

### `independently approved: approval-count >= 2`

The same honest limit `information/stock-adjustment.md` already records. Two increments of a counter are
not two signatures, and this predicate is an approximation. The real control on a payment is in
`processes/payment-run.md`, which requires two roles on one commit, and its enforcement depends on the
two-signature commit that agent S is building. Until that exists, this field is a documented manual
control and is labelled as one.

### `blocked-for-payment`

Set by hand, cleared by hand, and both are recorded. A block is the accounts-payable equivalent of a
quarantine: it stops the invoice reaching a payment run without deleting anything or hiding the liability
from the balance sheet, which is what someone tempted to "just take it out of the list" would do.

### What is not here

No invoice recognition, no OCR, no automatic three-way matching tolerance. The fields are captured or they
arrive through a dialect (wave 3). No credit notes from suppliers as their own entity — a supplier credit
note is entered as a supplier invoice with negative intent, and that is a real gap, because a negative
`posting-total` is refused by the invariant above. A supplier credit note therefore has to be posted as a
manual journal entry today, which a *Bilanzbuchhalter* will notice within a week.

## Retention

**10 years** under GoBD and § 147 AO, from the end of the calendar year of receipt. The received file is
retained byte-identically, which `document-hash` proves; § 14b UStG requires the original form of an
electronic invoice, not a print of it.

## References

`information/journal-entry.md`, `information/payment.md`, `information/vat-treatment.md`,
`processes/supplier-invoice-posting.md`, `processes/payment-run.md`
