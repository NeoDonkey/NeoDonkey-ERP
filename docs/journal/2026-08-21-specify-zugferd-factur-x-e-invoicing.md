# Journal Entry: Specify ZUGFeRD 2.2 / Factur-X Hybrid E-Invoicing & UN/CEFACT CII Data Model

**Date:** 2026-08-21

## Job Selected
- **Job:** `SPECIFY`
- **Reason:** The queue has 1 unclaimed `ready` issue (#84) (< 3 unclaimed ready issues), triggering a SPECIFY session per AGENTS.md §5 and §6.

## What Was Done
1. **Topic Claiming:** Selected ZUGFeRD 2.2 / Factur-X hybrid e-invoicing and UN/CEFACT CrossIndustryInvoice (CII D16B) XML syntax binding under Wave 3 / Gate Condition 6 ("It speaks to the outside world").
2. **Primary Source Research:**
   - EN 16931-1:2017 & CEN/TS 16931-3-3:2017 (Semantic data model and UN/CEFACT CII syntax binding).
   - FeRD / FNFE-MPE: *ZUGFeRD 2.2 / Factur-X 1.0.06 Specification* (March 2022) and *ZUGFeRD 2.3 / Factur-X 1.0.07 Specification* (September 2024).
   - German UStG § 14 (Mandatory e-invoicing in domestic B2B transactions from Jan 1, 2025).
3. **Decision Record Authored:**
   - Created `docs/decisions/2026-08-21-zugferd-factur-x-e-invoicing-and-cii-xml-data-model.md`.
   - Specified profile mapping (EN 16931 COMFORT profile ID `urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931`), root CII elements (`rsm:CrossIndustryInvoice`), mandatory Business Terms (`BT-1`..`BT-115`), zero-float `BigInt` minor unit monetary parsing, and legacy attachment filename (`ZUGFeRD-invoice.xml`).
   - Addressed B2B vs. B2G distinction (distinguishing ZUGFeRD EN 16931 domestic B2B compliance from XRechnung B2G CIUS requirements in `docs/decisions/2026-08-18-en16931-xrechnung-e-invoicing-semantic-data-model.md`).
   - Included required `## Source`, `## What Would Have to Change for the Answer to Change`, and `## What Must Land First` sections.
   - Defined two concrete implementable issue specifications for CII XML invoice generation and CII XML invoice parsing/validation.
4. **Verification:**
   - Verified that `node --test test/journal-hygiene.test.js` passes cleanly.
   - Ran full test suite `npm test` (680 passing, 2 skipped, 0 failures).
