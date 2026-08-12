# Customer

Two completely different things share this word, and the tax and process split of the whole company
hangs off telling them apart.

A **consumer** buys a bag of cashews in the webshop, pays by card before the parcel is packed, and
never sees an invoice with a VAT identification number on it. Sixty percent of revenue. The tax
question is which country's rate applies, answered by the One-Stop-Shop rules once cross-border
distance sales pass the EU-wide 10,000 EUR threshold.

A **business** — a grocery chain, a wholesaler — buys pallets against a purchase order, pays sixty
days later, and needs an electronic invoice their accounts payable system can read. Forty percent of
revenue. The tax question is whether reverse charge applies, answered by whether they hold a
validated VAT identification number in another member state.

Modelling both as "customer" with a `customer-type` field is deliberate: they share a name, a
country and a payment history, and almost nothing else. Every rule that cares tests the type
explicitly.

**This operating model contains no personal data and must never contain any.** All customer names
here are invented company placeholders. Consumer records in a live system hold personal data with
its own legal basis and its own retention rules; a demo folder that is copied, shared and published
is not the place for it.

## Fields
- name: text required — Company name. Invented placeholders only in this model.
- customer-type: text required — consumer or business.
- country: text required — ISO code. Half of the VAT decision.
- vat-identification-number: text — Business customers in other EU member states.
- vat-id-validated: boolean — Result of the VIES check. An unchecked number is worth nothing.
- vat-treatment: reference to vat-treatment required — Which tax situation applies.
- channel: text required — webshop, retail or marketplace.
- payment-terms-days: number required — Zero for consumers, thirty or sixty for retail.
- credit-limit: money — Business customers only.
- open-balance: money — What they currently owe us.
- currency: text required — EUR.
- credit-status: one of ok, over-limit, blocked — Derived by the weekly sweep, not typed by hand.
- leitweg-id: text — Routing address for German public-sector buyers. See invoice.
- invoice-delivery-format: text required — pdf-email, xrechnung or edi.
- edi-partner-identifier: text — GLN or equivalent for retail EDI.
- status: one of active, on-hold, blocked required — Commercial standing. Credit standing is credit-status, and they are not the same thing.

## Identified by
name

## Created on demand
no

## Predicates
- consumer: customer-type is "consumer"
- business: customer-type is "business"
- eu business with valid vat id: customer-type is "business" and vat-identification-number exists and vat-id-validated is true
- domestic: country is "DE"
- creditworthy: status is "active" and credit-status is "ok"
- over credit limit: open-balance > credit-limit
- needs electronic invoice: invoice-delivery-format is "xrechnung"
- blocked: status is "blocked"

## Authorized by
- create: customer-service-agent or category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or customer-service-agent or tax-accountant
- update: customer-service-agent or controller
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): the
`- <operation>: <roles>` bullets govern every operation on this entity that no process rule covers. Without
them, an uncovered operation is open to an actor with no role at all — grammar version 1's permissive default,
and the defect Part 4's standing rule 4 was written about. Where a rule *does* cover the operation, the rule's
authority wins and these bullets are not consulted.

`delete` is the managing director everywhere, and it should almost never be used: a document that ten years of
other documents point at is retired by a status change, not removed. `read` is wide, because reading changes
nothing and an audit needs the lot.
### eu business with valid vat id
The condition for reverse charge on an intra-community supply. All three parts matter: a business,
with a number, that we actually checked. An unchecked VAT identification number is worth nothing in
a tax audit, and the authority will collect the VAT from us rather than from the customer.

### over credit limit
`open-balance > credit-limit` — a comparison between two fields of the same document, which grammar
version 1 supports. `credit-status` exists alongside it because the *weekly* recomputation of the
balance is a separate act with a date on it, and a retail order should be released against the
number somebody stood behind rather than against a figure that moves between the check and the pick.

### Retention versus erasure
The ten-year retention duty and the GDPR right to erasure genuinely conflict for consumers. The
retention duty wins for the invoice-relevant fields, because it is a legal obligation; everything
else — marketing preferences, support history, browsing — is deleted on request. In a live instance
consumer records are pseudonymised once the retention period expires rather than kept forever. None
of that data exists in this folder.

## Retention

Customer master data behind an issued invoice: **10 years** under GoBD.

## References

`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`processes/invoice-issuance.md`, `processes/returns-and-credit-notes.md`
