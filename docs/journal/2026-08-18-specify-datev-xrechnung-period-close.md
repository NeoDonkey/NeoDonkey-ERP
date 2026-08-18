# Journal: Specifying Wave 2 and Wave 3 Accounting Standards

**Date:** 2026-08-18

## Why
With the release-blocker issue set closed and zero unclaimed `ready` issues in the queue, the project required specification work to decompose Wave 2 and Wave 3 roadmap goals into precise, research-backed decision records per `AGENTS.md` §6 and `docs/SPECIFYING.md`.

## What Changed
Created three authoritative, primary-sourced decision records in `docs/decisions/`:

1. `2026-08-18-datev-extf-export-structure-and-booking-header-format.md`: Defines the DATEV EXTF Formatversion 700 specification, Windows-1252 encoding, header attribute structure, SKR03/SKR04 booking lines, and decimal comma conversion rules.
2. `2026-08-18-en16931-xrechnung-e-invoicing-semantic-data-model.md`: Establishes the EN 16931-1 core semantic business terms (BT-1 to BT-115), German XRechnung KoSIT 3.0 UBL 2.1 syntax binding, and German B2B e-invoicing timelines under UStG § 14.
3. `2026-08-18-gobd-period-close-and-balance-carryforward.md`: Formulates GoBD-compliant period locking (Festschreibung) rules, immutability of posted journal entries, reversing entry mechanisms (Storno), P&L closing into GuV/Equity, and balance sheet opening carryforward (Saldenvortrag).

## Verification
Ran `npm test` and `node --test test/journal-hygiene.test.js` to ensure directory naming conventions, file isolation, primary source citations, and header formatting rules pass cleanly across all decision records and journal entries.
