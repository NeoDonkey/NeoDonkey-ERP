# Quality inspection

The document that releases or blocks a batch. Every batch of a quality-critical article arrives
quarantined and stays there until a quality manager has looked at it, checked the paperwork, and
recorded a decision with their signing key on it.

This is the least glamorous and most load-bearing process in a food business. A released batch can
be picked, shipped and eaten. Getting the release decision recorded, signed and unchangeable is the
difference between a recall you can execute and a recall you cannot.

Two conditions on release are easy to skip and both are in the rules. A retained sample — without
one, a complaint six months later cannot be investigated, and an uninvestigable complaint becomes a
precautionary recall. And the label check, because a mislabelled allergen is the worst thing that
can happen here.

## Fields
- batch: reference to batch required — What is being inspected.
- article: reference to article required — What it is.
- quantity: number required — How much of the batch this decision covers.
- inspection-date: date required — When.
- inspected-by: reference to employee required — Who. Must be quality trained.
- sensory-check: text required — pass, fail or not-applicable.
- packaging-check: text required — pass or fail.
- label-check: text required — pass or fail. Allergens and MHD legible and correct.
- document-check: text required — pass or fail. Certificate of analysis where required.
- foreign-body-check: text required — pass or fail.
- temperature-check: text — pass, fail or not-applicable.
- decision: text required — release, block or release-with-restriction.
- restriction-note: text — Required when the decision is release-with-restriction.
- block-reason: text — Required when the decision is block.
- sample-retained: boolean required — HACCP expects a retained sample.
- ccp-deviation: boolean required — A deviation at a critical control point.
- quality-status: text required — The status this decision puts the batch into: released or blocked.
- shelf-life-status: text required — The status this decision assigns: fresh or near-expiry.
- haccp-check-passed: boolean required — Whether the HACCP checks were satisfied.

## Identified by
batch and inspection-date

## Created on demand
no

## Predicates
- all checks passed: sensory-check is not "fail" and packaging-check is "pass" and label-check is "pass" and document-check is "pass" and foreign-body-check is "pass"
- releasing: decision is "release"
- blocking: decision is "block"
- restricted release: decision is "release-with-restriction"
- sample kept: sample-retained is true
- justified block: decision is "block" and block-reason exists
- justified restriction: decision is "release-with-restriction" and restriction-note exists
- critical deviation: ccp-deviation is true

## Authorized by
- create: quality-manager or warehouse-clerk
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management
- update: quality-manager
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): the
`- <operation>: <roles>` bullets govern every operation on this entity that no process rule covers. Without
them, an uncovered operation is open to an actor with no role at all — grammar version 1's permissive default,
and the defect Part 4's standing rule 4 was written about. Where a rule *does* cover the operation, the rule's
authority wins and these bullets are not consulted.

`delete` is the managing director everywhere, and it should almost never be used: a document that ten years of
other documents point at is retired by a status change, not removed. `read` is wide, because reading changes
nothing and an audit needs the lot.
### all checks passed
Five checks, and the label check is the one that matters most. Sensory may be `not-applicable` for
a sealed pack; the other four may not.

### sample kept
We do not release a batch without a retained sample, because without one we cannot investigate a
complaint six months later — and an uninvestigable complaint becomes a precautionary recall of
everything rather than a targeted withdrawal of one batch.

### restricted release
The usual answer for a batch that is fine but short-dated: sellable in the webshop, not acceptable
to a retailer. It is a release with a reason, not a grudging pass, and the reason is required.

### critical deviation
The one condition in this whole model that escalates immediately to the managing director. It is
recorded here and read by `management-system/monthly-stock-review.md`; the notification itself is
not a CRUD operation and therefore not something the rule language can or should express.

## Retention

HACCP records are kept for the shelf life of the product plus one year at minimum, and in practice
**10 years** here because they sit in the same trail as the goods receipt. A changed decision is a
new inspection, never an edit.

## References

`processes/quality-inspection.md`, `processes/stock-write-off.md`,
`management-system/monthly-stock-review.md`
