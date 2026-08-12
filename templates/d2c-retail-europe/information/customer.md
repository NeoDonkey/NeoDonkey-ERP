# Customer

Two completely different things share this word, and the whole tax and process split of
the company hangs off telling them apart.

A **consumer** buys a bag of cashews in the webshop, pays by card, gets a parcel, and
never sees an invoice with a VAT ID on it. Sixty percent of revenue. The tax question is
which country's VAT rate applies, which is answered by the One-Stop-Shop rules once
cross-border distance sales pass the EU-wide 10,000 EUR threshold.

A **business** — a grocery chain, a wholesaler — buys pallets against a purchase order,
pays on terms, and needs an electronic invoice that their accounts payable system can
read. Forty percent of revenue. The tax question is whether reverse charge applies, which
is answered by whether they have a valid VAT identification number in another EU member
state.

Modelling both as "customer" with a `customer-type` field is a deliberate choice: they
share an address, a name and a payment history, and nothing else. Every rule that cares
tests `customer-type` explicitly.

**This template contains no real customer data and must never contain any.** The demo runs
on invented company placeholders only. Personal data of natural persons — names,
addresses, contact details — does not belong in a template that is published and shared.

## Fields
- id: text required — CUS-100231.
- customer-type: text required — consumer or business.
- name: text required — Company name for business; for consumers this is populated at runtime in the live instance and is never present in the template.
- country: text required — ISO code. Decides the VAT question.
- vat-identification-number: text — Business customers in other EU states.
- vat-id-validated: text — yes or no. Result of the VIES check.
- vat-treatment: reference to vat-treatment required
- channel: text required — webshop, retail, marketplace.
- payment-terms-days: number required — 0 for consumers, typically 30 or 60 for retail.
- credit-limit-eur: number — Business customers only.
- open-balance-eur: number required — What they currently owe us.
- leitweg-id: text — Required for German public-sector buyers, see invoice.
- invoice-delivery-format: text required — pdf-email, xrechnung, edi.
- edi-partner-identifier: text — GLN or equivalent for retail EDI.
- status: text required — active, on-hold, blocked.
- first-order-date: date

## Identified by
name

## Created on demand
no

## Predicates
- consumer: customer-type is "consumer"
- business: customer-type is "business"
- eu business with valid vat id: customer-type is "business" and vat-identification-number exists and vat-id-validated is "yes"
- domestic: country is "DE"
- cross border eu: vat-treatment.name is "oss-distance-sale"
- creditworthy: status is "active"
- over credit limit: open-balance-eur > credit-limit-eur
- needs electronic invoice: invoice-delivery-format is "xrechnung"

## References
- `vat-treatment` → `vat-treatment`
- a customer places many → `sales-order`

## Retention
Customer master data behind an issued invoice is retained **10 years** under GoBD. That
obligation sits in tension with the GDPR right to erasure for consumers: the legal
retention duty wins for the invoice-relevant fields, and everything else — marketing
preferences, browsing history, support transcripts — is deleted on request. In the live
instance, consumer records are pseudonymised after the retention period expires rather
than kept indefinitely.

## Notes
### eu business with valid vat id
This is the condition for reverse charge on an intra-community supply. All three parts
matter: a business, with a VAT ID, that we actually checked. An unchecked VAT ID is worth
nothing in a tax audit, and the tax authority will collect the VAT from us.

### over credit limit
Grammar version 1 allows a field on the right-hand side of a comparison, so this reads as written.
`credit-status` exists alongside it because the *weekly* recomputation of the balance is a separate act
with a date on it: a retail order should be released against the figure somebody stood behind, not
against a number that moves between the check and the pick. Which of the two to trust is a business
decision, and it is written down rather than assumed.
     `credit-status is "over-limit"`. -->

### Used by

`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`processes/invoice-issuance.md`, `processes/customer-complaint.md`
