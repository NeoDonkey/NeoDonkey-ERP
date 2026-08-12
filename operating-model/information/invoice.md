# Invoice

The invoice is the document the tax authority, the auditor and the customer's accounts payable
department all read, and each of them wants something different from it. It is therefore the most
heavily constrained document in this folder, and the one where "we will fix it later" costs most.

Three things must be right at once. **German VAT law:** §14 and §14a UStG list what must appear on a
*Rechnung*, and a missing element means the customer cannot deduct input tax — which means they will
not pay until it is fixed. **The electronic format:** German B2B invoices must be issuable as
structured data to EN 16931, in practice XRechnung or ZUGFeRD, and a public-sector invoice without a
Leitweg-ID is rejected outright by the receiving portal. **The retention duty:** ten years under GoBD,
unchangeable, and the transmitted *format* is retained too, not only the numbers.

An issued invoice is never edited. A wrong invoice is corrected by a credit note and a new invoice.
That is not a NeoDonkey quirk — it is how invoicing worked long before computers, for the same reason:
the customer already has a copy.

## Fields
- invoice-number: text required — Gapless sequential number, BT-1. Assigned once, never reused.
- invoice-date: date required — BT-2.
- invoice-type-code: text required — 380 commercial invoice, 381 credit note. BT-3.
- currency: text required — EUR. BT-5.
- status: one of draft, issued, sent, paid, corrected, dunned required — An issued invoice is never edited; `corrected` means a credit note exists.
- sales-order: reference to sales-order required — What was sold.
- customer: reference to customer required — Who bought it.
- seller-name: text required — BT-27.
- seller-vat-identifier: text required — Our USt-IdNr. BT-31.
- seller-tax-registration: text — Steuernummer where no VAT ID applies. BT-32.
- seller-legal-registration: text required — Handelsregister number. BT-30.
- seller-address-country: text required — BT-40.
- buyer-name: text required — BT-44.
- buyer-vat-identifier: text — Required for reverse charge. BT-48.
- buyer-reference: text — The Leitweg-ID for German public-sector buyers. BT-10.
- buyer-address-country: text required — BT-55.
- net-amount: money required — Sum of line nets. BT-106.
- vat-amount: money required — BT-110.
- gross-amount: money required — BT-112.
- payable-amount: money required — After prepayments. BT-115.
- vat-treatment: reference to vat-treatment required — Which situation applies.
- vat-breakdown: text required — One entry per rate: rate, taxable base, tax amount. BG-23.
- vat-exemption-reason: text — Required whenever the VAT amount is zero. BT-120.
- payment-due-date: date required — BT-9.
- payment-terms: text required — BT-20.
- payment-means-code: text required — 58 SEPA credit transfer, 48 card. BT-81.
- delivery-date: date — BT-72. Required when it differs from the invoice date.
- customer-purchase-order-reference: text — BT-13. Retail buyers reject invoices without it.
- delivery-format: text required — pdf-email, xrechnung, zugferd or edi.
- xrechnung-profile: text — The CIUS identifier, for XRechnung.
- structured-document-reference: text — Pointer to the stored XML. Required for XRechnung.
- archived-format-hash: text — Hash of the exact bytes sent to the customer.
- proof-of-transport-reference: text — Gelangensbestätigung, for zero-rated EU supplies.
- sent-at: date — When it left.
- corrected-by: reference to credit-note — Set when a credit note corrects it.

## Identified by
invoice-number

## Created on demand
no

## Predicates
- complete for german vat law: invoice-number exists and invoice-date exists and seller-name exists and seller-vat-identifier exists and buyer-name exists and net-amount > 0 and vat-breakdown exists
- reverse charge properly stated: buyer-vat-identifier exists and vat-exemption-reason exists and vat-amount = 0
- zero rated: vat-amount = 0
- exemption reason stated: vat-exemption-reason exists
- electronic invoice required: delivery-format is "xrechnung"
- xrechnung complete: buyer-reference exists and structured-document-reference exists and xrechnung-profile exists
- issued: status is "issued"
- ready to send: status is "issued" and payment-due-date exists and payment-terms exists
- archived: archived-format-hash exists
- transport proven: proof-of-transport-reference exists
- corrected: corrected-by exists
- overdue: status is "dunned"
- has buyer reference: customer-purchase-order-reference exists
- posted to the ledger: count of journal-entry for this invoice > 0
- not yet posted to the ledger: count of journal-entry for this invoice = 0

## Authorized by
- create: accountant
- read: auditor or controller or tax-accountant or accountant or customer-service-agent
- update: accountant
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): it governs every
operation on this entity that no process rule covers, using the `- <operation>: <roles>` bullet form that no
grammar-version-1 model can contain. Without it, an uncovered operation is open to an actor with no role at
all — version 1's permissive default, and the defect Part 4's standing rule 4 was written about.
### complete for german vat law
The §14 UStG checklist, as one sentence. If you have ever had a customer refuse to pay because their
tax adviser found a missing element, this predicate is the fix — and the reason it belongs here
rather than in code is that the list changes by legislation, not by release.

### reverse charge properly stated
Three obligations that always travel together and are always forgotten separately: the buyer's VAT
identification number on the face of the invoice, the exemption wording
(*Steuerschuldnerschaft des Leistungsempfängers*), and zero VAT. Getting two of the three right is
worth exactly as much as getting none of them right.

### xrechnung complete
The Leitweg-ID is the one that catches people. It is not a nice-to-have reference field; it is the
routing address of the receiving authority, and an XRechnung without it does not arrive. It belongs
to the customer and is copied here as the buyer reference, BT-10.

### transport proven
A zero-rated intra-community supply stays zero-rated only if we can show the goods left Germany. Years
later, in an audit, the *Gelangensbestätigung* is the evidence; without it the supply is re-assessed
at 19 %. It is collected during shipping and referenced here because this is the document that is
challenged.

### posted to the ledger
`count of journal-entry for this invoice > 0`. Whether an invoice has been posted is answered by
looking for a journal entry that names it, not by a flag on the invoice. That matters because the first
paragraph of this file promises that an issued invoice is never edited, and a `posted` flag would be an
edit. `processes/invoice-posting.md` is where the entry is made; nothing there touches this document.

### archived-format-hash
The fingerprint of the exact bytes the customer received. It turns *Unveränderbarkeit* from an
assertion into something provable: in eight years we can show that the invoice in the repository is
the invoice that was sent.

### overdue
Carried in `status`, set by the daily dunning sweep, because the grammar has no `today` and a rule
that read the clock would not be reproducible. `payment-due-date < today` is the sentence we would
rather write.

## Retention

**10 years** under GoBD and §147 AO, from the end of the calendar year of issue. Both the numbers *and*
the transmitted format are retained — for an XRechnung that means the XML, byte-identical, which is
what `archived-format-hash` proves. Under Principle 4 the document plus the signed commit that issued
it *are* the archive; there is no separate archiving system to keep in step.

## References

`processes/invoice-issuance.md`, `processes/returns-and-credit-notes.md`,
`processes/invoice-posting.md`, `information/journal-entry.md`,
`management-system/weekly-margin-review.md`
