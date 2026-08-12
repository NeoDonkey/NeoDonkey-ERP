# Invoice

The invoice is the document the tax authority, the auditor and the customer's accounts
payable department all read, and each of them wants something different from it. It is
therefore the most heavily constrained entity in this template, and the one where "we will
fix it later" costs the most.

Three things have to be right at once. First, German VAT law: §14 and §14a UStG list what
must appear on a *Rechnung*, and a missing element means the customer cannot deduct input
tax. Second, the electronic format: since 2025 German B2B invoices must be issuable as
structured data, and the format is EN 16931 — in practice XRechnung or ZUGFeRD, both
profiles of EN 16931. Third, the retention duty: ten years under GoBD, unchangeable, and
the *format* is retained too, not just the numbers.

An issued invoice is never edited. A wrong invoice is corrected by a credit note and a new
invoice. This is not a NeoDonkey quirk — it is how invoicing has worked since long before
computers, and the reason is the same: the customer already has a copy.

## Fields
- id: text required — Our internal id.
- invoice-number: text required — Gapless sequential number (BT-1). Assigned once, never reused.
- invoice-date: date required — (BT-2).
- invoice-type-code: text required — 380 commercial invoice, 381 credit note (BT-3).
- currency: text required — EUR (BT-5).
- status: text required — draft, issued, sent, paid, corrected, dunned.
- sales-order: reference to sales-order required
- customer: reference to customer required
- seller-name: text required — (BT-27).
- seller-vat-identifier: text required — Our USt-IdNr. (BT-31).
- seller-tax-registration: text — Steuernummer where no VAT ID applies (BT-32).
- seller-legal-registration: text required — Handelsregister number (BT-30).
- seller-address-country: text required — (BT-40).
- buyer-name: text required — (BT-44).
- buyer-vat-identifier: text — Required for reverse charge (BT-48).
- buyer-reference: text — **Leitweg-ID** for German public-sector buyers (BT-10). Mandatory in XRechnung; an XRechnung without it is rejected by the receiving portal.
- buyer-address-country: text required — (BT-55).
- net-amount-eur: number required — Sum of line net amounts (BT-106).
- vat-amount-eur: number required — (BT-110).
- gross-amount-eur: number required — (BT-112).
- payable-amount-eur: number required — After prepayments (BT-115).
- vat-treatment: reference to vat-treatment required
- vat-breakdown: text required — One entry per rate: rate, taxable base, tax amount (BG-23).
- vat-exemption-reason: text — Required whenever the VAT amount is zero (BT-120). For reverse charge the wording is *Steuerschuldnerschaft des Leistungsempfängers*.
- payment-due-date: date required — (BT-9).
- payment-terms: text required — (BT-20).
- payment-means-code: text required — 58 SEPA credit transfer, 48 card (BT-81).
- delivery-date: date — (BT-72). Required when it differs from the invoice date.
- delivery-note: reference to delivery-note
- customer-purchase-order-reference: text — (BT-13). Retail buyers reject invoices without it.
- delivery-format: text required — pdf-email, xrechnung, zugferd, edi.
- xrechnung-profile: text — e.g. urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0.
- structured-document-reference: text — Pointer to the stored XML. Required for xrechnung and zugferd.
- archived-format-hash: text — Hash of the exact bytes sent to the customer. This is what makes *Unveränderbarkeit* provable rather than asserted.
- sent-at: date
- corrected-by: reference to credit-note

- customs-declaration: reference to customs-declaration — For exports, the declaration that proves the goods left.

## Identified by
invoice-number

## Created on demand
no

## Predicates
- complete for german vat law: invoice-number exists and invoice-date exists and seller-name exists and seller-vat-identifier exists and buyer-name exists and net-amount-eur > 0 and vat-breakdown exists
- reverse charge: vat-treatment.name is "eu-reverse-charge"
- reverse charge properly stated: vat-treatment.name is "eu-reverse-charge" and buyer-vat-identifier exists and vat-exemption-reason exists and vat-amount-eur = 0
- zero rated: vat-amount-eur = 0
- exemption reason stated: vat-exemption-reason exists
- electronic invoice required: delivery-format is "xrechnung"
- xrechnung complete: buyer-reference exists and structured-document-reference exists and xrechnung-profile exists
- ready to send: status is "issued" and payment-due-date exists and payment-terms exists
- issued: status is "issued"
- archived: archived-format-hash exists
- corrected: corrected-by exists
- overdue: status is "dunned"

## References
- `sales-order` → `sales-order`, `customer` → `customer`
- `vat-treatment` → `vat-treatment`
- `delivery-note` → `delivery-note`
- `corrected-by` → `credit-note`

## Retention
**10 years** under GoBD and §147 AO, counted from the end of the calendar year in which the
invoice was issued. Both the numbers *and* the transmitted format are retained — for an
XRechnung that means the XML, byte-identical, which is what `archived-format-hash` proves.
Under Principle 4 the invoice document and the signed commit that issued it are the archive;
no separate archiving system is needed, and the DATEV export in
`processes/datev-export.md` is a convenience for the accountant, not the record of truth.

## Notes
### complete for german vat law
The §14 UStG checklist, as a sentence. If you have ever had a customer refuse to pay
because their tax adviser found a missing element, this predicate is the fix.

### reverse charge properly stated
Three obligations that always travel together and are always forgotten separately: the
buyer's VAT ID on the face of the invoice, the exemption wording, and zero VAT. Getting
two of three right is the same as getting none right.

### xrechnung complete
The Leitweg-ID is the one that catches people. It is not a nice-to-have field: the German
public-sector receiving portals reject the invoice outright without it.

### overdue
<!-- NEEDS-GRAMMAR: `overdue` should mean `payment-due-date < today and status is not "paid"`.
     The grammar has no current-date symbol, so overdueness is carried in `status`, set by
     the dunning sweep in `processes/dunning.md`. Same v0.2 date proposal as on `batch`. -->
     the dunning sweep in `processes/dunning.md`. Same v0.2 date proposal as on `batch`. -->

### Used by

`processes/invoice-issuance.md`, `processes/electronic-invoice-dispatch.md`,
`processes/returns-and-credit-notes.md`, `processes/dunning.md`,
`processes/datev-export.md`, `management-system/month-end-close.md`
