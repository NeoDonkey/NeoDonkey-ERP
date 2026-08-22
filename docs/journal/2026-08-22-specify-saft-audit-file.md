# Journal: Specification of OECD SAF-T v2.0 XML Audit Export Schema

**Date:** 2026-08-22
**Author:** Daniel Pammé

## What changed

1. **Job Selection & Routing**:
   - Counted open `ready` issues (5 open) and open PRs (#147, #142, #135, #130, #120 claiming #123, #124, #118, #119, #127).
   - Unclaimed `ready` issue count = 0. Per `AGENTS.md` §6, fewer than 3 unclaimed `ready` issues triggers **SPECIFY**.
   - Claimed topic first: verified no open PRs or existing decision records in `docs/decisions/` touch OECD SAF-T v2.0 XML audit file exports.

2. **Decision Record**:
   - Created `docs/decisions/2026-08-22-pain-01-standard-audit-file-for-tax-saf-t-and-gobd-export-schema.md` establishing the OECD SAF-T v2.0 XML schema and GoBD data export standards.
   - Cited primary authoritative sources: OECD SAF-T Guidance v2.0, GoBD § 3.2.1, HGB § 238 Abs. 1 & § 257 Abs. 1, EU VAT Directive 2006/112/EC.
   - Defined strict non-negotiable constraints: zero dependencies, zero float operations (`BigInt` minor units formatting), browser compatibility, and Git OID provenance trailers.

3. **Implementable Issue Specifications**:
   - Added 2 concrete implementable `ready` issue specifications linked to the decision record:
     1. `feat(saft): serialize OECD SAF-T v2.0 XML master files and general ledger header structures` (`area:runtime`, `p1`, `ready`)
     2. `feat(saft): export general ledger entries and source document transactions into SAF-T XML format` (`area:runtime`, `p1`, `ready`)

## Verification

- Tested documentation hygiene via native test runner:
  - `node --test test/journal-hygiene.test.js` verified clean.
  - `node --test test/audit-location-citations.test.js` verified clean.
- `npm test` executed across entire test suite: 760 tests total, 758 passed, 2 skipped, 0 failures.
