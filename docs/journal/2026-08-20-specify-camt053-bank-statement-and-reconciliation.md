# 2026-08-20 — Specify CAMT.053 Bank Statement Ingestion and Payment Reconciliation

## Job Selection

- **Job:** `SPECIFY`
- **Reason:** The count of unclaimed `ready` open issues in the queue was 2 (#84, #44), which is fewer than 3. Following the job selection table in `AGENTS.md` §6, this session routed to `SPECIFY` to replenish the specification queue for Wave 2 and Wave 3 roadmap items.

## Summary of Work

1. **Created Decision Record (`docs/decisions/2026-08-20-camt053-bank-statement-ingestion-and-payment-reconciliation.md`):**
   - Researched and established the specification for electronic bank statement ingestion (`camt.053.001.02` / `camt.053.001.08` ISO 20022 XML and SWIFT MT940) and automated AR/AP open-item (OPOS) payment reconciliation.
   - Cites primary specifications: ISO 20022 `camt.053` Message Definition Report, Deutsche Kreditwirtschaft (DK) EBICS XML format specs, SWIFT MT940 format specs, HGB § 238 / § 257, and GoBD § 3.2.1.
   - Established multi-tiered matching rules (reference matching, amount/debtor name matching, Skonto cash discount clearing), transaction fingerprinting for duplicate prevention, and zero-float BigInt minor unit parsing (`toMoney`).

2. **Decomposed into Implementable Issue Specifications:**
   - `feat(bank): parse CAMT.053 ISO 20022 XML bank statements into domain statement objects` (`area:runtime`, `p1`, `ready`)
   - `feat(bank): match bank statement transactions to AR/AP open items (OPOS) and generate ledger payment clearing entries` (`area:runtime`, `p1`, `ready`)

3. **Updated Project Status (`docs/NEXT.md`):**
   - Documented the newly specified standard and issue specifications under "Newly Specified Standards & Unblocked Implementable Issues".

## Verification

- `node --test test/journal-hygiene.test.js`: Verified that decision record and journal entry naming, structure, and `## Source` / `## Why` headers pass all hygiene assertions.
- `npm test`: Full test suite executed green.
