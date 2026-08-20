# Specified German Domestic VAT Advance Return (USt-VA) and ELSTER XML Schema

**Date:** 2026-08-20

## What changed

This session executed a SPECIFY task as mandated by `AGENTS.md` §6 for queue maintenance.

1. **New Decision Record (`docs/decisions/2026-08-20-german-vat-ustva-return-and-elster-xml-schema.md`):**
   - Researched and documented German VAT advance return (Umsatzsteuervoranmeldung - USt-VA) rules and ELSTER XML schema structure.
   - Primary source citations: UStG § 18 Abs. 1, § 12, § 15; BMF ELSTER Schnittstellenbeschreibung UStVA 2026.
   - Defined rules for tax position codes (Kennziffern Kz 81, Kz 86, Kz 41, Kz 66, Kz 83) and exact double-entry BigInt minor unit tax grid aggregation.
   - Formatted output payload for `<Elster>` / `<Anmeldesteuern>` / `<UStVA>` XML schema.

2. **Decomposed Implementable Issues:**
   - Defined two ready, implementable issue specifications for USt-VA tax grid aggregation and ELSTER XML serialization.
   - Listed constraints (zero runtime dependencies, no build step, `node:*` restricted to `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()`, no business vocabulary in `runtime/`, no float in monetary paths) and explicit verification methods for both.

3. **Updated Roadmap Tracking (`docs/NEXT.md`):**
   - Added the new USt-VA specification and issue definitions under Wave 2 / Gate Condition 6 and updated last-updated header to 2026-08-20.

## Verification

- `node --test test/journal-hygiene.test.js`: All 5 journal and decision record hygiene tests pass.
- `npm test`: All test suites pass cleanly with no failures.
