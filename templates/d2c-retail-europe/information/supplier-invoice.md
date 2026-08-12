# Supplier invoice

An invoice we received. Before it is paid it has to survive three checks, and this entity
exists to make all three visible rather than implied.

**Does it match the goods?** Quantity and price against the order and the goods receipt.
Food suppliers deliver approximately what was ordered, so a tolerance is needed — but the
tolerance is a stated number, not a shrug.

**Is it a valid invoice?** Under §14 UStG an incoming invoice missing a mandatory element
does not entitle us to deduct input tax. Paying it anyway means paying nineteen percent we
cannot reclaim.

**Is it authorised?** Above a threshold, by two people. This is where four-eyes lives in a
European business, and where the auditor will look first.

## Fields
- id: text required — SINV-2026-00812.
- supplier: reference to supplier required
- supplier-invoice-number: text required — Theirs, not ours.
- invoice-date: date required
- receipt-date: date required — When it reached us. Drives the *Zeitgerechtigkeit* clock.
- order: reference to order — Required for goods invoices.
- goods-receipt: reference to goods-receipt
- net-amount-eur: number required
- vat-amount-eur: number required
- gross-amount-eur: number required
- vat-treatment: reference to vat-treatment required
- supplier-vat-identifier: text — Required for EU acquisitions.
- payment-due-date: date required
- early-payment-discount-percent: number
- early-payment-discount-until: date
- mandatory-elements-complete: text required — yes or no. The §14 UStG check.
- missing-elements-note: text — Required when the answer is no.
- three-way-match-status: text required — matched, price-variance, quantity-variance, no-receipt, not-applicable.
- variance-amount-eur: number
- approval-count: number required — Starts at 0. Raised by each distinct approver.
- first-approved-by: reference to employee
- second-approved-by: reference to employee
- approval-status: text required — pending, approved, rejected, on-hold.
- rejection-reason: text
- status: text required — received, checked, approved, scheduled, paid, disputed.
- document-reference: text required — Where the received file is stored.
- datev-account: text — Booking account for the export.

## Identified by
supplier and supplier-invoice-number

## Created on demand
no

## Predicates
- legally valid: mandatory-elements-complete is "yes" and supplier-invoice-number exists and invoice-date exists
- three way matched: three-way-match-status is "matched"
- has variance: three-way-match-status is not "matched" and three-way-match-status is not "not-applicable"
- needs second approval: gross-amount-eur >= 5000
- independently approved: approval-count >= 2
- approved: approval-status is "approved"
- payable: approval-status is "approved" and status is "approved"
- disputed: status is "disputed"
- input tax deductible: mandatory-elements-complete is "yes" and vat-amount-eur > 0
- eu acquisition: vat-treatment.name is "eu-acquisition" and supplier-vat-identifier exists

## References
- `supplier` → `supplier`, `order` → `order`, `goods-receipt` → `goods-receipt`
- `vat-treatment` → `vat-treatment`
- `first-approved-by`, `second-approved-by` → `employee`

## Retention
**10 years** under GoBD and §14b UStG. The received document is retained in the form it
arrived — a PDF stays a PDF, an XRechnung stays XML. Converting an incoming invoice to
another format and discarding the original breaks *Unveränderbarkeit*, which is why
`document-reference` points at the original bytes.

## Notes
### three way matched
Order, goods receipt, invoice. All three agree, or somebody looks at it. In food this is
where over-deliveries and weight differences surface, and where a supplier's quiet price
increase gets caught before it has run for six months.

### needs second approval
Five thousand euros is where this template puts the four-eyes boundary. Change the number
here and the whole approval behaviour of the company changes, with the change itself
recorded as a signed commit — which is a better audit trail for the *policy* than most
companies have for the transactions.

### independently approved
Two approvals means two commits signed by two different keys. The distinctness of the
approvers is guaranteed by the signature layer, not by a field somebody could type — which
is stronger than the four-eyes control in most ERP systems, where "two users" means two rows
in a table.

### Used by

`processes/supplier-invoice-verification.md`, `processes/supplier-invoice-approval.md`,
`processes/payment-run.md`, `processes/datev-export.md`
