# Journal Entry: SPECIFY Session for Inbound Dialect and Wave 2/3 Core Standards

**Date:** 2026-08-19
**Author:** Daniel Pammé

## Job Choice & Context

The session checked the queue of open `ready` issues per `AGENTS.md` §6:
- 2 unclaimed `ready` issues (#77, #34).
- Fewer than 3 unclaimed `ready` issues routes the session to **SPECIFY**.

## What Was Specified

1. **Inbound Dialect (Shopify Order Ingestion & Idempotency)**:
   - Authored new primary-sourced decision record `docs/decisions/2026-08-19-inbound-dialect-shopify-order-mapping-and-idempotency.md`.
   - Primary sources cited: Shopify Admin REST/GraphQL Order Schema, GoBD § 3.2 (Einzelaufzeichnungspflicht), EU VAT Directive 2006/112/EC Art. 242a.
   - Unblocked implementable issues specified:
     - `feat(inbound): parse and convert Shopify REST/GraphQL JSON orders into domain sales-invoice documents with strict monetary parsing` (`area:runtime`, `p1`, `ready`)
     - `feat(inbound): enforce idempotency and source-reference tracking for inbound dialect orders` (`area:runtime`, `p1`, `ready`)

2. **Decomposition of 2026-08-17 Decision Records**:
   - Added concrete `Unblocked Implementable Issue Specifications` to:
     - `docs/decisions/2026-08-17-multi-currency-accounting-and-realized-exchange-gains-losses.md` (FX spot conversion with rational math, realized FX gain/loss postings).
     - `docs/decisions/2026-08-17-pdf-invoice-rendering-from-versioned-templates.md` (Deterministic DIN 5008 HTML/SVG invoice template rendering).
     - `docs/decisions/2026-08-17-oss-one-stop-shop-eu-vat-schema-and-thresholds.md` (EU B2C cross-border €10,000 threshold aggregation, quarterly OSS return aggregation).

3. **Planning Update**:
   - Updated `docs/NEXT.md` to list newly unblocked implementable issue specifications.

## Verification

- `npm test`: All tests pass cleanly (672 tests).
- `node --test test/journal-hygiene.test.js`: Confirmed decision records and journal entries conform to repository hygiene standards.
