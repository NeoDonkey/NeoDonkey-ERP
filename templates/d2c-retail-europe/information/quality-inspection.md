# Quality inspection

The document that releases or blocks a batch. Every batch of a HACCP-relevant article
arrives quarantined and stays there until a quality manager has looked at it, checked the
paperwork, and taken a decision that is recorded with their name on it.

This is the least glamorous and most load-bearing process in a food business. A released
batch can be picked, shipped, and eaten. Getting the release decision recorded, signed and
unchangeable is the difference between a recall you can execute and a recall you cannot.

## Fields
- id: text required — QI-2026-0311.
- batch: reference to batch required
- article: reference to article required
- goods-receipt: reference to goods-receipt required
- inspection-date: date required
- inspected-by: reference to employee required
- quantity: number required — How much of the batch this decision covers. Usually the whole batch; a partial release exists for a pallet where one layer is damaged. This is also the quantity by which the release or block moves available stock, which is why it is required rather than implied.
- sensory-check: text required — pass, fail, not-applicable.
- packaging-check: text required — pass, fail.
- label-check: text required — pass, fail — Allergens and MHD legible and correct.
- document-check: text required — pass, fail — Certificate of analysis present where required.
- temperature-check: text — pass, fail, not-applicable.
- foreign-body-check: text required — pass, fail.
- decision: text required — release, block, release-with-restriction.
- restriction-note: text — Required when the decision is release-with-restriction.
- block-reason: text — Required when the decision is block.
- sample-retained: text required — yes or no. HACCP expects a retained sample.
- ccp-deviation: text required — yes or no. A deviation at a critical control point.

- warehouse-location: reference to warehouse-location — Where the inspected stock lies.
- available-quantity: number — The quantity this decision makes available or unavailable.
- blocked-reason: text — Copied onto the batch when the decision is to block.

## Identified by
batch and inspection-date

## Created on demand
no

## Predicates
- all checks passed: sensory-check is not "fail" and packaging-check is "pass" and label-check is "pass" and document-check is "pass" and foreign-body-check is "pass"
- releasable: decision is "release" and sample-retained is "yes"
- blocking: decision is "block"
- justified block: decision is "block" and block-reason exists
- critical deviation: ccp-deviation is "yes"

## References
- `batch` → `batch`, `article` → `article`
- `goods-receipt` → `goods-receipt`
- `inspected-by` → `employee`

## Retention
HACCP records are kept for the shelf life of the product plus one year at minimum, and in
practice **10 years** here because they sit in the same trail as the goods receipt.
Immutable: a changed decision is a new inspection referencing the old one.

## Notes
### releasable
We do not release a batch without a retained sample, because without one we cannot
investigate a complaint six months later, and an uninvestigable complaint becomes a
precautionary recall.

### critical deviation
A CCP deviation is the one condition in this whole template that escalates immediately to
the managing director. See `management-system/weekly-quality-round.md`.

### Used by

`processes/quality-inspection.md`, `processes/stock-write-off.md`,
`management-system/weekly-quality-round.md`
