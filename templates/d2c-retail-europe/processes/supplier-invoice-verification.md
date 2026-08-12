# Supplier invoice verification

Checking an incoming invoice before anybody pays it. Three checks, and each of them catches a
different kind of money loss.

**The three-way match.** Order, goods receipt, invoice. In food these differ routinely — a pallet is
a pallet, and weight-priced goods never arrive at exactly the ordered weight — so a tolerance is
needed. The tolerance is a stated number rather than a shrug, and a variance outside it goes back to
purchasing rather than through to payment.

**The legal check.** Under §14 UStG an incoming invoice missing a mandatory element does not entitle
us to deduct input tax. Paying it anyway means paying nineteen percent we can never reclaim, and
noticing in the following year means asking the supplier for a corrected invoice they have no
incentive to send.

**The reverse-charge check.** An EU supplier's invoice under reverse charge carries no VAT and we
self-account for it. An EU supplier without a validated VAT identification number cannot be treated
that way, and getting this wrong is the most expensive small mistake in cross-border purchasing.

## Triggered by
An invoice arriving from a supplier, by email, post or as an XRechnung.

## Rules
If Create supplier-invoice under condition
  supplier exists and
  supplier-invoice-number exists and
  document-reference exists
then
  Update supplier-invoice with status "received" and
  Update supplier-invoice with receipt-date and
  Update supplier-invoice with approval-status "pending"

If Update supplier-invoice under condition
  supplier-invoice three way matched and
  supplier-invoice legally valid and
  order exists
then
  Update supplier-invoice with status "checked" and
  Update supplier-invoice with datev-account

If Update supplier-invoice under condition
  supplier-invoice has variance
then
  Update supplier-invoice with status "disputed" and
  Update supplier-invoice with variance-amount-eur

If Update supplier-invoice under condition
  mandatory-elements-complete is "no"
then
  Update supplier-invoice with status "disputed" and
  Update supplier-invoice with missing-elements-note

If Update supplier-invoice under condition
  supplier-invoice eu acquisition and
  supplier reverse charge supplier
then
  Update supplier-invoice with vat-treatment "eu-acquisition" and
  Update supplier-invoice with status "checked"

## Notes

Recorded on arrival, before it is checked. GoBD asks for *Zeitgerechtigkeit* — timely recording —
and an invoice sitting in somebody's inbox is not recorded. Whether it is valid is the next rule's
problem.

The missing-elements note is an obligation because it is what goes in the email asking for a
corrected invoice. "Your invoice is not compliant" achieves nothing; "your invoice is missing our
VAT identification number and the delivery date" gets a corrected invoice the same week.

## Authorized by
accountant
