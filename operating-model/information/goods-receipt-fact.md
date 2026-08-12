# Goods receipt fact

The posted consequence of an accepted goods receipt. This is the record an auditor reads and the
record a recall follows. It is written once and never updated.

If something was wrong, a correcting fact is written and both stay visible. That is what
*Unveränderbarkeit* means in the GoBD sense, and it is also simply how bookkeeping has always
worked: you do not erase an entry, you post the opposite one.

It carries the batch number and the best-before date as *values*, not as references, because in ten
years the batch document may have been archived and the fact must still stand on its own.

## Fields
- quantity: number required — What was posted into stock.
- delivered-quantity: number required — The same number, under the order's name for it.
- order: reference to order required — Which order it satisfied.
- order-line: reference to order-line required — Which line.
- article: reference to article required — What it was.
- location: reference to location required — Where it went.
- batch-number: text — Copied value, kept for the ten years.
- best-before-date: date — Copied value.
- delivery-note-reference: text required — The supplier's document number.
- receipt-date: date required — When it arrived.
- received-by: reference to employee required — Who counted it.
- valuation-per-unit: money — The cost at which this quantity entered stock.
- currency: text — EUR.
- corrects: reference to goods-receipt-fact — Set on a correcting fact.
- correction-reason: text — Required whenever corrects is set.

## Identified by
order-line and receipt-date

## Created on demand
no

## Predicates
- traceable: batch-number exists and best-before-date exists
- correction: corrects exists
- justified correction: corrects exists and correction-reason exists
- positive: quantity > 0

## Authorized by
- create: warehouse-clerk or warehouse-management
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management or tax-accountant
- update: managing-director
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
### Append-only, by absence
No rule in this operating model issues an `Update goods-receipt-fact` or a
`Delete goods-receipt-fact`, and none ever should. The immutability is not a flag the runtime
enforces — it is the absence of a permitted path, which is stronger, because you can verify it by
searching the folder for the words.

### justified correction
A correction without a stated reason is refused. An auditor's first question about any reversal is
"why", and the answer belongs in the record rather than in somebody's memory.

### Why the batch number is a value and not a reference
A reference resolves only while the referenced document is present. A recall in year eight has to
work against an archived repository, so the identifying facts are copied onto the record that needs
them. This is deliberate denormalisation with a stated reason.

## Retention

**10 years** under GoBD, immutable. This document, the signed commit that created it, and the
delivery note reference it carries are the archive — there is no separate archiving system to keep
in step.

## References

`processes/goods-receipt.md`, `management-system/monthly-stock-review.md`
