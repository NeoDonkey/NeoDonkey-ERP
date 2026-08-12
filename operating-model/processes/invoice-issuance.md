# Invoice issuance

Turning a shipment into a claim for money. Three audiences read the result and each of them can reject
it: the customer's accounts payable department, the tax office, and eventually an auditor.

The German requirements are a list, not a judgement call. §14 UStG says what must appear on a
*Rechnung*, and a missing element means the customer cannot deduct input tax — which means they will not
pay until it is fixed. The predicate `complete for german vat law` on the invoice *is* that list,
written as one sentence, and it lives in `information/invoice.md` because it changes by legislation
rather than by release.

An issued invoice is never edited. Not by the accountant, not by the managing director, not by anybody.
No rule in this folder updates an amount on an issued invoice. If somebody adds one, they have removed
the reason an auditor would believe any of the numbers.

## Triggered by
A sales order shipped, or a monthly consolidated invoice for a retail customer on collective billing.

## Rules

If Create invoice under condition
  invoice complete for german vat law and
  sales-order shipped and
  vat-treatment active
then
  Update invoice with status "issued" and
  Update invoice with payment-due-date

If Create invoice under condition
  customer exists and
  payable-amount > 0 and
  buyer-address-country exists
then
  Update invoice with vat-breakdown and
  Update invoice with payment-terms

## Notes

### complete for german vat law
Invoice number, invoice date, seller name, seller VAT identifier, buyer name, a positive net amount, and
a VAT breakdown. Seven things, one line, on the entity where they belong. If you have ever had a
customer refuse to pay because their tax adviser found a missing element, this predicate is the fix.

### The gapless number
`invoice-number` is `## Identified by` on the invoice and assigned once, never reused. Completeness of
the sequence is one of the first things an auditor tests, and it is testable directly against the
repository rather than through a report the system generated about itself.

### What is documented but not enforced by a rule
Three conditional obligations, all of them real and none of them expressible in grammar version 1,
because every rule on a trigger is a hard requirement and there is no branching:

- **Reverse charge.** A zero-rated supply to an EU business needs the buyer's VAT identifier, the
  exemption wording, and zero VAT — all three, together. The predicate
  `reverse charge properly stated` exists on the invoice and is checked at the month-end close.
- **Proof of transport.** A zero-rated intra-community supply needs a *Gelangensbestätigung*, or it is
  re-assessed at 19 % years later. `transport proven` is the predicate; collecting it is the logistics
  coordinator's.
- **XRechnung.** A public-sector invoice needs a Leitweg-ID and a stored XML, or the receiving portal
  rejects it. `xrechnung complete` is the predicate.

Each of those would be a single rule with an `if this then also that` shape, and that shape is the
grammar's largest missing piece. They are named here so that nobody reads this file and believes the
system is checking them.

### The archived format
`archived-format-hash` is the fingerprint of the exact bytes the customer received. It turns
*Unveränderbarkeit* from an assertion into something provable — in eight years we can show the invoice
in the repository is the invoice that was sent. Under Principle 4 the document plus its signed commit
*are* the archive; there is no second system to keep in step.

## Authorized by
accountant
