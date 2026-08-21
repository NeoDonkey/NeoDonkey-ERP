# Session Journal: Salvage Parked USt-VA and CAMT.053 Decision Records

**Date:** 2026-08-21

## Summary
Salvaged two decision records from specification pull requests #91 and #98, which were auto-parked after three review rounds and whose decision records never landed on main. The records are valuable and current: they specify German USt-VA VAT advance return aggregation with ELSTER XML serialization, and ISO 20022 CAMT.053 bank statement ingestion with AR/AP OPOS payment reconciliation.

## Why These Records Matter Now
- **USt-VA record** (`docs/decisions/2026-08-20-german-vat-ustva-return-and-elster-xml-schema.md`) feeds the Wave 5 accounting push: the Kz 81/86/41/66/83 tax-grid aggregation and the ELSTER `<UStVA>` payload are the basis for derived VAT advance returns. It cites UStG § 18 Abs. 1, § 12, § 15 and the BMF ELSTER UStVA 2026 Schnittstellenbeschreibung.
- **CAMT.053 record** (`docs/decisions/2026-08-20-camt053-bank-statement-ingestion-and-payment-reconciliation.md`) feeds payment reconciliation: camt.053.001.02/001.08 parsing with BigInt minor-unit amounts and tiered OPOS matching against the existing AR/AP subledger record. It cites ISO 20022, the Deutsche Kreditwirtschaft XML specification, HGB § 238 / § 257, and GoBD § 3.2.1.

## What Was Done
1. Fetched the head tarballs of parked PRs #91 (sha `e8ca9e7`) and #98 (sha `43b7334`) and reviewed both decision records against `docs/SPECIFYING.md` (primary sources with article/field, decomposed implementable issues with verification). Both records were sound and were landed verbatim.
2. Filed the four implementable issue specifications the records define as open GitHub issues with the labels the records specify (`ready`, `area:runtime`, `p1`).
3. Did not touch `docs/NEXT.md` (shared file under parallel sessions).

## Verification
- Full suite on a fresh main mirror with the salvaged files added: `node --test "test/*.test.js"`.
- Decision-record hygiene tests pass: both files are dated, lowercase-slug named, and carry a `## Source` section.
