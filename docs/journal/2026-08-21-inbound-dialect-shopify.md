# 2026-08-21 — The inbound dialect: Shopify orders become domain documents

## What changed

Gate condition 6 — "it speaks to the outside world" — is now green. The export side was already
there (DATEV EXTF landed earlier today, XRechnung generator and parser before it). What was
missing was the other direction: a foreign system's data coming *in* and becoming canonical,
signed, rule-checked domain documents. `runtime/inbound/shopify.js` is that direction, against the
binding decision record
`docs/decisions/2026-08-19-inbound-dialect-shopify-order-mapping-and-idempotency.md`, closing
issues #118 and #119.

The module is the mirror image of `runtime/export/`: those translate our documents into a foreign
format; this translates a foreign format into ours. Both shapes of the Shopify Admin API are read —
REST order resources (money as strings, `rate: 0.19`) and GraphQL `Order` objects (MoneyV2
`{ amount, currencyCode }` everywhere, gid identifiers, `ratePercentage: 19.0`) — and both land on
the same normalized order and the same canonical documents, which the test proves field by field.

## The five answers, where they landed

1. **Idempotency** is a lookup, not a registry. Every ingested order is stamped
   `source-system` / `source-id` / `reference` on the document itself, so the git history is the
   register and nothing parallel can disagree with it. `ingestShopifyOrder` checks the read index
   for the `(source-system, source-id)` tuple on *each* document before committing: a replayed
   webhook returns the existing documents and commits nothing — the test counts commits before and
   after. A partially recorded order (invoice committed, then the run died) is *completed*: the
   missing siblings land with the same deterministic ids and bytes, so no order can stay
   half-ingested forever. And a stored document that contradicts the payload is a named
   `source-conflict` refusal, never an overwrite. With the clock injected and the identity
   imported, the same event ingested into two fresh workspaces produces byte-identical commits
   (same oids), which is what "a replay is a non-event" means for a synced system.
2. **Zero-float parsing** is a strict string → BigInt boundary. A JSON number in a monetary field,
   an unparseable string, or a third decimal place in a two-decimal currency are all loud
   `InboundError`s; `-0.00` maps to zero explicitly at the boundary, as `runtime/money/README.md`
   requires of inbound dialects. The source guard from `test/_source-guard.js` scans the file.
3. **Tax mapping is read from the model, not hardcoded.** The dialect selects the governing
   `vat-treatment` document by fact — domestic rate → the active sale-side treatment with
   `rate-determined-by: origin-country` at that rate; an EU destination → the OSS treatment — and
   takes `revenue-account-number` / `output-vat-account-number` from that document, exactly the way
   `invoice-posting.md` and the DATEV export read them. The runtime names no account: the test
   proves it by re-pointing the treatment to different numbers and watching the postings follow. A
   rate with no treatment, two treatments covering one situation, a treatment adopted without
   accounts, and a non-EU destination are all named refusals. (In the shipped SKR03 adoption those
   documents say 8400/1776, 8300/1771 and 8336/1791 — but that is the model speaking.)
4. **Discounts** are allocated by `runtime/money`'s largest-remainder `allocate`, weighted by line
   gross, so line nets sum to the order net exactly. The test includes the case that motivated the
   rule: 10.00 across three equal lines is 3.34/3.33/3.33, where naive equal shares leave a cent
   orphaned.
5. **Payment vs. OPOS**: `financial_status: "paid"` records a payment document debiting the
   payment-provider clearing account and crediting the customer subledger account; anything else
   leaves an OPOS open item on the invoice, posted as the receivable leg of the journal entry.

## Policy is parameter, never default

Review caught what the first draft got wrong: account constants and a silent `homeCountry: 'DE'`
default in runtime code are business vocabulary in the mechanism layer. The final shape: the
company's home country, the clearing account, and the customer subledger band are **required
ingest parameters** — there is no default country and no default account anywhere in the module.
The subledger account itself is derived deterministically from the Shopify customer id inside the
caller-supplied band, and a collision between two customers probes the read index for the next
free number — deterministic given the same history, and never two customers sharing one account
silently. An order whose destination country cannot be determined is refused
(`destination-unknown`): a sale without a destination has no determinable VAT treatment, and the
dialect does not guess tax jurisdictions.

## What it commits through

Ingestion is `kernel.perform`, not a parallel structure: authorization, rule evaluation, one
signed commit per document, the read index. The test workspace runs a focused operating model (the
entities the dialect writes, plus the vat-treatment documents it reads its account determination
from, governed by an accountant role) because the shipped model's
invoice requires a sales order, a customer and a VAT treatment to exist first — coupling a
mechanism test to that whole web would make it fail for reasons unrelated to ingestion.

## Boundaries, stated loudly

Orders with charged shipping, line-level discounts already folded into `subtotal_price`, a
destination country that cannot be determined, and non-EU destinations are refused with named
errors rather than guessed at. Each is a decision-record
extension when it becomes real, and the module header says so. `docs/NEXT.md` and
`docs/COMPROMISES.md` are untouched: the plan anticipated this work and no register entry changed
state.
