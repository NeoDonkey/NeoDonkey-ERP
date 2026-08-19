# Decision Record: Inbound Dialect - Shopify Order Mapping, Idempotency, and E-Commerce Ingestion

**Date:** 2026-08-19

## Question
How should NeoDonkey ingest, parse, and map inbound e-commerce order data from external systems (specifically the Shopify REST/GraphQL Order API) into canonical domain sales invoice and journal entry objects while preserving strict monetary precision, GoBD auditability, and cross-system idempotency?

## Answer

1. **Idempotent Ingestion & Foreign System Reference Mapping:**
   - Every external e-commerce order MUST record its external origin and identifier:
     - `source-system`: `"shopify"`
     - `source-id`: External unique ID string (e.g. `"5628190318720"`)
     - `reference`: Human-readable reference string (e.g. `"Shopify #1001"`)
   - Order ingestion MUST be strictly idempotent. Attempting to ingest an order with a previously recorded `(source-system, source-id)` tuple MUST NOT create duplicate document commits or duplicate general ledger entries; it MUST return the existing canonical domain document.

2. **Zero-Float Monetary Parsing from JSON Payloads:**
   - External JSON order payloads express monetary amounts as string numbers (e.g. `"29.99"`).
   - Ingestion parsers MUST parse monetary string values directly into exact ISO 4217 minor unit integers (`BigInt`) or string tokens (e.g. `"29.99 EUR"` = `2999` minor units).
   - `parseFloat` or `Number` calls on monetary values are strictly prohibited in the ingestion pipeline per FD-1.

3. **Tax & VAT Mapping:**
   - External tax lines (`tax_lines` array) MUST be mapped directly to corresponding domestic or destination VAT treatments:
     - Standard domestic VAT (e.g. German 19% VAT) mapped to SKR03 `8400` Erlöse 19% USt.
     - Reduced domestic VAT (e.g. German 7% VAT) mapped to SKR03 `8300` Erlöse 7% USt.
     - EU cross-border B2C sales under OSS mapped to destination tax rates and OSS revenue accounts.

4. **Discount Allocation:**
   - Order-level or line-level discount applications (`discount_applications`) MUST be allocated across line items using the largest-remainder method so that the sum of line item net totals equals the overall order net total exactly.

5. **Payment Gateway Integration & Open Item Creation:**
   - When external order status is `financial_status: "paid"`, ingestion records both the sales document and the corresponding payment transaction line (e.g. Debit Shopify Payments / PayPal Clearing Account, Credit Customer Receivable / Revenue).
   - Unpaid orders create an Open Item (OPOS) record under the customer subledger account (`10000`–`69999`).

## Source
- **Primary Source (Shopify Developer Platform):** Shopify Admin REST API Order Resource Schema (`https://shopify.dev/docs/api/admin-rest/current/resources/order`) and GraphQL Admin API `Order` object definition.
- **Primary Source (German Tax Authority / GoBD):** Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff (GoBD), BMF Circular 2019-11-28, § 3.2 (Einzelaufzeichnungspflicht für e-commerce Transaktionen).
- **Primary Source (EU VAT Directive):** Council Directive 2006/112/EC Article 242a (Record-keeping obligations for electronic interfaces and marketplaces).

## Verification Method
- **Unit Test Verification:** Unit tests in `test/inbound-shopify.test.js` parse sample Shopify order JSON payloads, assert zero float usage via source guard, verify exact BigInt minor unit calculations, confirm line discount allocation using largest-remainder, and test that duplicate ingestion calls return existing records without duplicate commits.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(inbound): parse and convert Shopify REST/GraphQL JSON orders into domain sales-invoice documents with strict monetary parsing`
- **Title:** Parse and convert Shopify REST/GraphQL JSON orders into domain sales-invoice documents with strict monetary parsing
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "It speaks to the outside world - inbound dialect") and Part 3 (Wave 3: Shopify dialect)
- **Primary Source Citation:** Shopify Admin REST API Order Resource Schema & GoBD BMF Circular 2019-11-28 § 3.2
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/inbound-shopify.test.js` loads a multi-line Shopify order JSON fixture, converts it to a domain sales invoice object, asserts that no `Number`/`parseFloat` is called on money amounts, and verifies that `BigInt` minor units sum to the total gross amount.

### Issue 2: `feat(inbound): enforce idempotency and source-reference tracking for inbound dialect orders`
- **Title:** Enforce idempotency and source-reference tracking for inbound dialect orders
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6) and Part 3 (Wave 3)
- **Primary Source Citation:** GoBD BMF Circular 2019-11-28 § 3.1.2 (Vollständigkeit & Nachvollziehbarkeit) & EU VAT Directive 2006/112/EC Article 242a
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/inbound-idempotency.test.js` ingests a Shopify order payload twice, asserting that the second call detects the existing `(source-system, source-id)` reference and returns the canonical document without creating duplicate commits or ledger entries.
