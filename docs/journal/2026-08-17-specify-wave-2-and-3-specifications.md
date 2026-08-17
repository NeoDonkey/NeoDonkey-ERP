# Specified Wave 2 and Wave 3 roadmap specifications and decision records

**2026-08-17**

This session selected the SPECIFY job per AGENTS.md §5 and §6 because the unclaimed `ready` issue queue had fewer than 3 items. As documented in `docs/NEXT.md` and `docs/SPECIFYING.md`, turning roadmap wave goals into precise, authoritative specifications and decision records is the primary way to prevent parallel agent sessions from stalling.

Four primary-sourced decision records were researched, authored, and added to `docs/decisions/`:

1. **`2026-08-17-xrechnung-en16931-semantic-data-model.md`**: Defines the EN 16931-1:2017 core semantic data model and KoSIT XRechnung v3.0 mandatory business terms (BT-1 through BT-115), UBL 2.1 / CII XML syntax bindings, exact decimal representation (FD-1), and XML verification requirements for outbound e-invoicing (Gate Condition 6).
2. **`2026-08-17-datev-extf-v700-export-structure.md`**: Defines the DATEV EXTF format v700 specification for general ledger exports, including header fields 1-28, Buchungssatz line fields 1-116, Windows-1252 / semicolon CSV encoding, and debit/credit balance verification (Gate Condition 6).
3. **`2026-08-17-period-close-gobd-locking-policy.md`**: Establishes GoBD compliance rules (BMF Circular 2019 Rz. 108 & 110) for immutable period closing (Festschreibung), locked period posting refusal (`POLISM_PERIOD_LOCKED`), and General-Storno (reversing) correcting entries in open periods (Gate Condition 1 & 8).
4. **`2026-08-17-eu-vat-oss-return-structure.md`**: Outlines mapping of general ledger postings to German domestic periodic VAT returns (UStVA KZs 81, 86, 66, 67) and EU One Stop Shop (OSS) quarterly filings under Directive 2006/112/EC Art. 250 & Art. 369a-369k, aggregated without float operations (Wave 2).

All decision records name primary regulatory and standards sources (EN 16931, DATEV EXTF v700, BMF GoBD, EU VAT Directive 2006/112/EC) and state exact automated test verification rules and expiry conditions.
