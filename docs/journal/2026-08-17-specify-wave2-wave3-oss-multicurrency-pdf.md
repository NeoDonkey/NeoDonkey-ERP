# Journal: Specifying EU OSS VAT, Multi-Currency Accounting, and Versioned PDF Templates

**Date:** 2026-08-17

## What changed and why

In this session, we performed a `SPECIFY` job as required by `AGENTS.md` §5 & §6 when fewer than 3 unclaimed `ready` issues exist in the queue.

We researched primary sources and wrote three decision records in `docs/decisions/` corresponding to Wave 2 and Wave 3 items from `docs/ROADMAP-V1.md`:

1. **`docs/decisions/2026-08-17-oss-one-stop-shop-eu-vat-schema-and-thresholds.md`**
   - Establishes rules for EU One-Stop Shop (OSS) VAT accounting: €10,000 cross-border micro-business threshold, quarterly returns, EUR currency precision, and primary citations from EU Council Directive 2006/112/EC and Implementing Regulation (EU) 2020/194.

2. **`docs/decisions/2026-08-17-multi-currency-accounting-and-realized-exchange-gains-losses.md`**
   - Establishes rules for multi-currency transactions and double-entry postings: functional base currency reporting, spot rate conversion without floating-point math, and immediate recognition of realized exchange rate gains/losses upon payment settlement per IAS 21 and HGB § 256a.

3. **`docs/decisions/2026-08-17-pdf-invoice-rendering-from-versioned-templates.md`**
   - Establishes rules for deterministic PDF rendering from versioned HTML/SVG/CSS templates: binding template version SHA-256 digests to documents, reproducible HTML structure, and GoBD / DIN 5008 compliance.

## Verification

- `npm test`: Ran full test suite; all 670 tests passed cleanly.
- `test/journal-hygiene.test.js`: Verified that decision records and journal entries conform to project naming and header conventions (`## Source` / `## Why`).
