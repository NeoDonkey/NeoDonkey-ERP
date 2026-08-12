# VAT treatment

This is the most valuable file in the folder, and it is short.

Every sale and every purchase in a European business falls into one of a small number of tax
situations. Which one it is depends on facts — who the parties are, where the goods move, whether
a VAT identification number was validated — and once the situation is known the consequences are
mechanical. The mistake almost every ERP makes is scattering those consequences across dozens of
conditions in dozens of places. Here there is one kind of document, and every rule that cares
reads a treatment from it.

If your tax adviser says something here is wrong for your business, this is the file you change,
and the change reaches every invoice from the next one onward.

## Fields
- name: text required — Plain-language name of the situation.
- applies-to: text required — sale, purchase or both.
- vat-rate-percent: number required — Zero for reverse charge, export and acquisition.
- rate-determined-by: text required — origin-country, destination-country or zero.
- requires-buyer-vat-id: boolean required — Whether the buyer's number must be on the invoice.
- requires-exemption-reason: boolean required — Whether exemption wording is mandatory.
- exemption-wording: text — The exact sentence that must appear on the invoice.
- requires-ec-sales-list: boolean required — Zusammenfassende Meldung.
- requires-oss-return: boolean required — One-Stop-Shop declaration.
- requires-customs-declaration: boolean required — Non-EU movements.
- requires-proof-of-transport: boolean required — Gelangensbestätigung.
- oss-threshold: money — The EU-wide 10000 threshold, on the OSS treatment.
- oss-threshold-exceeded: boolean — Recalculated monthly from cross-border B2C turnover.
- datev-tax-key: text — The Steuerschlüssel used in the DATEV export.
- revenue-account-number: text — Which revenue account a sale under this treatment credits.
- output-vat-account-number: text — Which VAT account the tax we owe credits. Empty where zero rated.
- expense-account-number: text — Which expense account a purchase under this treatment debits.
- input-vat-account-number: text — Which account deductible input tax debits.
- acquisition-account-number: text — Wareneingang account for an intra-community acquisition.
- self-assessed-vat-account-number: text — Where output tax we self-assess credits.
- revenue-account: reference to ledger-account — The account document. Filled in at adoption.
- output-vat-account: reference to ledger-account — The account document. Filled in at adoption.
- expense-account: reference to ledger-account — The account document. Filled in at adoption.
- input-vat-account: reference to ledger-account — The account document. Filled in at adoption.
- acquisition-account: reference to ledger-account — The account document. Filled in at adoption.
- self-assessed-vat-account: reference to ledger-account — The account document. Filled in at adoption.
- vat-kennzahl-base: text — UStVA line the taxable or exempt base of this treatment feeds.
- vat-kennzahl-tax: text — UStVA line the tax of this treatment feeds.
- vat-role-base: one of none, taxable-turnover, exempt-turnover, non-taxable-turnover, acquisition-turnover — What the return does with the base.
- vat-role-tax: one of none, output-tax, input-tax — What the return does with the tax.
- status: one of active, retired required — A retired treatment is kept so an eight-year-old invoice can explain itself.

## Identified by
name

## Created on demand
no

## Predicates
- zero rated: vat-rate-percent = 0
- needs buyer vat id: requires-buyer-vat-id is true
- needs exemption reason: requires-exemption-reason is true
- needs proof of transport: requires-proof-of-transport is true
- needs customs declaration: requires-customs-declaration is true
- needs ec sales list: requires-ec-sales-list is true
- needs oss return: requires-oss-return is true
- destination rated: rate-determined-by is "destination-country"
- oss threshold exceeded: oss-threshold-exceeded is true
- active: status is "active"
- standard rated: vat-rate-percent = 19
- reduced rated: vat-rate-percent = 7
- taxed: vat-rate-percent > 0
- an eu acquisition: name is "eu-acquisition"
- an intra community supply: name is "eu-reverse-charge"
- an oss distance sale: name is "oss-distance-sale"
- an export supply: name is "export"
- a domestic supply: name is "domestic-standard"
- an import purchase: name is "import"
- sale side: applies-to is not "purchase"
- purchase side: applies-to is not "sale"
- revenue account determined: revenue-account exists
- output vat account determined: output-vat-account exists
- expense account determined: expense-account exists
- input vat account determined: input-vat-account exists
- acquisition account determined: acquisition-account exists
- self assessed vat account determined: self-assessed-vat-account exists
- account determination complete: vat-kennzahl-base exists and vat-role-base exists

## Authorized by
- create: tax-accountant or controller
- read: auditor or controller or tax-accountant or accountant or category-manager
- update: tax-accountant or controller
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): it governs every
operation on this entity that no process rule covers, using the `- <operation>: <roles>` bullet form that no
grammar-version-1 model can contain. Without it, an uncovered operation is open to an actor with no role at
all — version 1's permissive default, and the defect Part 4's standing rule 4 was written about.
### The treatments this company uses
One document per situation, named by the `name` field:

- **domestic-standard** — German sale to a German customer. 7 % for most food, 19 % for beverages
  and confectionery.
- **eu-reverse-charge** — B2B sale to a business in another member state with a validated VAT ID.
  Zero VAT on our invoice; the customer accounts for it. Needs the buyer's number and the exemption
  wording on the invoice face, plus the EC sales list.
- **oss-distance-sale** — B2C sale to a consumer in another member state. Once cross-border B2C
  turnover exceeds the EU-wide **10,000 EUR** in a calendar year, the destination country's rate
  applies and it is declared through the One-Stop-Shop. Below the threshold, German VAT applies.
- **local-registration** — Where we hold stock in another member state and sell from it, the supply
  is domestic *there*. OSS does not cover it and a local registration is required. This is what
  makes a fulfilment partner in Venlo a tax decision rather than a logistics one.
- **export** — Sale outside the EU, including Switzerland. Zero VAT, proof of export required.
- **eu-acquisition** — Purchase from an EU supplier under reverse charge. We self-account.
- **import** — Purchase from outside the EU. Import VAT and duty at the border, deductible.

### The account determination fields, added when the ledger arrived

This file opened by saying that once the tax situation is known the consequences are mechanical, and that
the mistake almost every ERP makes is scattering those consequences across dozens of conditions in dozens
of places. The eighteen fields ending in `-account`, `-account-number`, `-kennzahl-` and `-role-` are that
sentence taken seriously: they are the *Automatikkonten*, the account determination, held once per tax
situation instead of once per rule.

So `processes/journal-posting.md` never names 8400 or 1776. It says
`with account-number from vat-treatment.revenue-account-number`, and which account that is depends on which
treatment the invoice carries. Adding a fourth VAT rate, or moving 7 % food revenue to a different account
because the tax adviser asked, is a change to one treatment document. A new treatment — say a Swiss local
registration — is a new document with its accounts filled in, and no rule changes at all.

Each account is named twice, by number and by reference, for the reason
`information/chart-of-accounts.md` explains: the numbers are declared when the treatments are set up, the
references are filled in once the account documents exist, the posting carries the number so a
*Summen- und Saldenliste* prints without a join, and the reference is what the posting invariants check.

`vat-kennzahl-base` and `vat-kennzahl-tax` are what let the *Umsatzsteuervoranmeldung* be computed by
aggregation. Line 81 for domestic 19 %, line 86 for 7 %, line 41 for intra-community supplies, line 43 for
exports, line 45 for OSS distance sales, line 89 for acquisitions. The number is copied onto every posting,
so the return sums postings and never has to know German tax law — which is precisely where that knowledge
must not be.

### needs proof of transport
The one that quietly costs money. A zero-rated intra-community supply without a
*Gelangensbestätigung* on file is re-assessed at 19 % years later, when the customer is long gone
and the margin is long spent. So the shipping process collects it and the invoice rules read it.

### oss threshold exceeded
A derived flag, recalculated monthly, because the grammar has no aggregation — there is no
`sum of net-amount over sales-order where …`. The running total is maintained instead, which is
also what an accountant expects to see. When this flips, the tax behaviour of the entire webshop
changes on one day, and `processes/b2c-sales-order.md` reads exactly this one predicate.

## Retention

Tax determination records are part of the invoice trail: **10 years** under GoBD. A retired
treatment is kept so that an eight-year-old invoice can still explain itself.

## References

`processes/invoice-issuance.md`, `processes/b2c-sales-order.md`,
`processes/b2b-retail-order.md`, `processes/purchase-ordering.md`
