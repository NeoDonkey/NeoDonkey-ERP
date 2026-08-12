// runtime/ui/starter-model.js — a fallback seed, and the only file in runtime/ui/ that
// contains business vocabulary.
//
// WHY THIS EXISTS: a browser needs something to open on even when it cannot reach the
// repository's own `operating-model/` — offline on a first run, or served from a static host
// with no directory index. The rule is strict, because opening on the wrong description would be
// a silently wrong system:
//
//   * if `operating-model/**.md` yields any file, THAT is the operating model, verbatim;
//   * only if it yields nothing do we seed with the text below, and the UI says so on screen.
//
// In this repository the first branch is the live one: `operating-model/` holds 54 files, 20
// entities, 10 roles and 28 rules, and it parses with no errors. (When this file was written it
// was still empty, which is why the fallback exists at all — it turned out to be worth keeping.)
//
// This is operating-model *content*, not view code. Nothing in the rest of runtime/ui/
// knows a single one of these words — that is the Principle 7 property, and
// test/g-ui.test.js asserts it mechanically by scanning the other UI modules.
//
// The content is deliberately small and deliberately exercises every declaration the
// generated UI has to render: all five scalar field types, references, `required`,
// `## Predicates`, `## Identified by`, `## Created on demand`, `## Authorized by`, and the
// goods-receipt reference process from Appendix XII verbatim.

/** @returns {Map<string,string>} path -> markdown */
export function starterModel() {
  return new Map(Object.entries(FILES));
}

/** True when this workspace was opened on the fallback rather than on operating-model/. */
export const STARTER_NOTE =
  'This workspace was seeded with the built-in starter model, because operating-model/ was ' +
  'empty. Everything you see below is generated from those files — edit them and the ' +
  'interface changes with them.';

const FILES = {
  'operating-model/information/customer.md': `# Customer

Whoever we sell to. One document per legal entity, because VAT treatment follows the
legal entity and not the person who happens to send the order.

## Fields
- name: text required — the legal name, as it must appear on an invoice
- country: text required — ISO country code, e.g. DE, AT, FR, IT, NL
- vat-id: text — USt-IdNr. / VAT identification number, where the customer has one
- credit-limit: money — how much open receivable we accept from this customer
- blocked: boolean — set when sales must stop, for any reason

## Predicates
- blocked for business: blocked is true
## Authorized by
- create: accountant or managing-director
- update: accountant or managing-director
- read: warehouse-clerk or accountant or category-manager or managing-director
- delete: managing-director

`,

  'operating-model/information/article.md': `# Article

One thing we sell. Food articles are batch-managed because a recall has to be able to
name the batch.

## Fields
- name: text required — what a customer sees
- category: text required — nuts, dried fruit, chocolate, baking, drinks
- net-price: money — list price excluding VAT
- currency: text — the currency \`net-price\` is denominated in
- net-weight-grams: number
- batch-managed: boolean — true for every food article
- status: text — draft, active, discontinued
## Authorized by
- create: category-manager or managing-director
- update: category-manager or managing-director
- read: warehouse-clerk or accountant or category-manager or managing-director
- delete: managing-director

`,

  'operating-model/information/location.md': `# Location

A place where stock physically lies, or from which we ship.

## Fields
- name: text required
- country: text required
- kind: text — warehouse, fulfilment, office, webshop
## Authorized by
- create: managing-director
- update: managing-director
- read: warehouse-clerk or warehouse-management or accountant or category-manager or managing-director
- delete: managing-director

`,

  'operating-model/information/order.md': `# Order

A purchase order we have placed with a supplier. It is the document a goods receipt is
checked against.

## Fields
- article: reference to article required
- location: reference to location required — where the goods are expected
- ordered-on: date required
- ordered-quantity: number required
- delivered-quantity: number — kept current by the goods receipt rule
- status: text
- total-net: money
- currency: text

## Predicates
- fully delivered: delivered-quantity >= ordered-quantity
- already fully delivered: fully delivered
## Authorized by
- create: category-manager or managing-director
- update: category-manager or managing-director
- read: warehouse-clerk or warehouse-management or accountant or category-manager or managing-director
- delete: managing-director

`,

  'operating-model/information/goods-receipt.md': `# Goods Receipt (document)

What the warehouse captures when a pallet arrives at the gate.

## Fields
- quantity: number required
- batch-number: text — required in practice by the rule, not by this declaration
- received-on: date required
- article: reference to article required
- location: reference to location required
- order: reference to order required
## Authorized by
- update: warehouse-management
- read: warehouse-clerk or warehouse-management or accountant or managing-director
- delete: nobody

## Notes

A receipt may be corrected while it is still an intent, but never deleted — the arrival of a
lorry is not an event that can be un-happened. \`delete: nobody\` says so in the model rather than
leaving the operation merely unmentioned, which would look like an oversight.

`,

  'operating-model/information/goods-receipt-fact.md': `# Goods Receipt (fact)

The permanent record of the receipt. Created by the rule, never by hand — which is why
it has no \`## Authorized by\` of its own.

## Fields
- quantity: number required
- batch-number: text required
- received-on: date
- article: reference to article
- location: reference to location
- order: reference to order
## Authorized by
- create: nobody
- read: warehouse-clerk or warehouse-management or accountant or managing-director
- update: nobody
- delete: nobody

## Notes

This is the posted, immutable consequence of a receipt. Nobody may change or remove it — a mistake
is corrected by a second fact, the way a bookkeeper corrects an entry.

\`create: nobody\` is the important line. A fact may only come into existence as the *consequence*
of a goods receipt passing its rule — a consequent is not subject to entity authority, so the rule
still writes it. What this forbids is somebody creating a posted fact **directly**, with no receipt
and no delivery behind it. That is the difference between a warehouse and a ledger that can be
typed into. \`nobody\` is a real role in
\`organisation/\` that is deliberately never assigned to anyone, which is how the model states
"deliberately no one" as an explicit decision instead of by omission.

`,

  'operating-model/information/stock.md': `# Stock

How much of one article lies at one location. There is exactly one stock document per
(article, location) pair, which is what \`## Identified by\` below says.

## Fields
- article: reference to article
- location: reference to location
- quantity: number

## Identified by
article and location

## Created on demand
yes
## Authorized by
- create: warehouse-clerk or warehouse-management
- update: warehouse-clerk or warehouse-management
- read: warehouse-clerk or warehouse-management or accountant or category-manager or managing-director
- delete: managing-director

`,

  'operating-model/information/invoice.md': `# Invoice

An outgoing invoice. Money, VAT and dates in one document, because that is the unit a
Wirtschaftsprüfer asks to see.

## Fields
- customer: reference to customer required
- issued-on: date required
- net-amount: money required
- vat-amount: money
- gross-amount: money
- currency: text required
- vat-rate: number
- reverse-charge: boolean — true for intra-EU B2B supplies with a valid VAT id
- status: text
## Authorized by
- create: accountant or managing-director
- update: accountant or managing-director
- read: accountant or managing-director
- delete: nobody

## Notes

An issued invoice is never deleted (GoBD: ten years, unveränderbar). Cancel it with a credit note.

`,

  'operating-model/organisation/nobody.md': `# Nobody

A role that is deliberately never assigned to any person.

It exists so that the model can say *"no one may do this"* out loud. Without it, forbidding an
operation means leaving it unmentioned — and an operation nobody mentioned is indistinguishable
from one everybody forgot. An auditor reading \`- delete: nobody\` sees a decision; reading nothing
at all, they see a gap.

Never add a person to this role. If an operation genuinely needs doing, name the role that does it.

## Purpose
To make "forbidden" an explicit statement rather than an absence.
`,

  'operating-model/organisation/warehouse-clerk.md': `# Warehouse Clerk

Receives goods, picks and packs. Books what physically happened, and nothing else.

## Purpose
Capture physical reality accurately and quickly.
`,

  'operating-model/organisation/warehouse-management.md': `# Warehouse Management

Runs the warehouse. May do everything a clerk may do, plus correct what a clerk booked.
`,

  'operating-model/organisation/accountant.md': `# Accountant

Issues invoices, matches payments, prepares the VAT return.
`,

  'operating-model/organisation/managing-director.md': `# Managing Director

Answers for the whole thing. Deliberately authorised for very little day-to-day work —
authority is not the same as doing.
`,

  'operating-model/organisation/category-manager.md': `# Category Manager

Owns the assortment: which articles exist, what they cost, when they are discontinued.
`,

  'operating-model/processes/goods-receipt.md': `# Goods Receipt

The goods receipt is executed when a delivery arrives at the warehouse. It checks whether
the delivery matches the order and updates stock plus order status.

This file is the whole implementation. There is no code behind it.

## Triggered by
Arrival of a delivery at the location, with reference to an order.

## Rules
If Create goods-receipt under condition
  quantity > 0 and
  order exists and
  order not already fully delivered
then
  Create goods-receipt-fact with batch-number and
  Update stock with +quantity

## Authorized by
warehouse-clerk or warehouse-management

## Notes
The last line of the rule is the manifesto's own demonstration: \`with batch-number\` is an
obligation, so a pallet booked without a batch number is refused from that word onward —
and removing the word is the only change needed to allow it again.
`,

  'operating-model/processes/article-onboarding.md': `# Article Onboarding

A new article may only enter the assortment with a category and a real weight, because
both are needed downstream for customs and for shipping cost.

## Rules
If Create article under condition
  category exists and
  net-weight-grams > 0
then
  Update article with status "draft"

## Authorized by
category-manager
`,

  'operating-model/processes/invoice-issuance.md': `# Invoice Issuance

An invoice is a legal document. Once it carries a number it may not quietly change, so
everything that must be true has to be true at the moment it is created.

## Rules
If Create invoice under condition
  net-amount > 0 and
  currency is "EUR" and
  customer exists and
  customer not blocked for business
then
  Update invoice with status "draft"

## Authorized by
accountant

## Notes
Try this as a warehouse clerk and it is refused even when every condition holds — the
\`## Authorized by\` line above is a rule, not workflow code.
`,

  'operating-model/locations/berlin-main-warehouse.md': `# Berlin Main Warehouse

Our own warehouse in Berlin. Receives from suppliers, ships to DACH.

## Purpose
Central goods receipt and DACH fulfilment.
`,

  'operating-model/management-system/operating-model-stewardship.md': `# Operating Model Stewardship

Who may change the description of this company, and how.

## Purpose
The operating model is the software. A change to it is a change to the system, so it is
signed, versioned and reviewable like any other fact — and it is written by the business,
not translated by anyone.

## Cadence
Reviewed quarterly, and whenever a rule refuses something it should have allowed.
`,
};
