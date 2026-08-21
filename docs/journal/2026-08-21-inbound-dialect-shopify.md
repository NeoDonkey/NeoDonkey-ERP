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
   for the `(source-system, source-id)` tuple before committing: a replayed webhook returns the
   existing document and commits nothing — the test counts commits before and after. With the
   clock injected and the identity imported, the same event ingested into two fresh workspaces
   produces byte-identical commits (same oids), which is what "a replay is a non-event" means for
   a synced system.
2. **Zero-float parsing** is a strict string → BigInt boundary. A JSON number in a monetary field,
   an unparseable string, or a third decimal place in a two-decimal currency are all loud
   `InboundError`s; `-0.00` maps to zero explicitly at the boundary, as `runtime/money/README.md`
   requires of inbound dialects. The source guard from `test/_source-guard.js` scans the file.
3. **Tax mapping** follows the shipped SKR03 chart: domestic 19 % → 8400/1776, 7 % → 8300/1771,
   and an EU destination country makes it an OSS distance sale — 8336 revenue, the destination rate
   carried verbatim, and the VAT on 1791 (the OSS liability), never on 1776. A rate with no
   mapping and a non-EU destination are refusals, not fallback accounts.
4. **Discounts** are allocated by `runtime/money`'s largest-remainder `allocate`, weighted by line
   gross, so line nets sum to the order net exactly. The test includes the case that motivated the
   rule: 10.00 across three equal lines is 3.34/3.33/3.33, where naive equal shares leave a cent
   orphaned.
5. **Payment vs. OPOS**: `financial_status: "paid"` records a payment document (debit 1370
   Verrechnungskonto Zahlungsdienstleister, credit the customer subledger account); anything else
   leaves an OPOS open item on the invoice, posted as the receivable leg of the journal entry, on a
   customer account derived deterministically inside the 10000–69999 subledger band.

## What it commits through

Ingestion is `kernel.perform`, not a parallel structure: authorization, rule evaluation, one
signed commit per document, the read index. The test workspace runs a focused operating model (the
three entities the dialect writes, governed by an accountant role) because the shipped model's
invoice requires a sales order, a customer and a VAT treatment to exist first — coupling a
mechanism test to that whole web would make it fail for reasons unrelated to ingestion.

## Boundaries, stated loudly

Orders with charged shipping, line-level discounts already folded into `subtotal_price`, and
non-EU destinations are refused with named errors rather than guessed at. Each is a decision-record
extension when it becomes real, and the module header says so. `docs/NEXT.md` and
`docs/COMPROMISES.md` are untouched: the plan anticipated this work and no register entry changed
state.
