# Goods receipt fact

The posted consequence of an accepted goods receipt. This is the record an auditor reads
and the record a recall follows. It is written once and never updated. If something was
wrong, a correcting fact is written and both stay visible — that is what
*Unveränderbarkeit* means in the GoBD sense, and it is the reason this entity exists
separately from `goods-receipt` at all.

It carries the batch number and the best-before date as *values*, not as references,
because in ten years the batch record may have been archived and the fact must still
stand on its own.

## Fields
- id: text required — GRF-0001.
- goods-receipt: reference to goods-receipt required
- order: reference to order required
- order-line: reference to order-line required
- article: reference to article required
- batch: reference to batch
- batch-number: text — Copied value, kept for the ten years.
- best-before-date: date — Copied value.
- quantity: number required
- weight-kg: number
- warehouse-location: reference to warehouse-location required
- valuation-per-unit-eur: number required — The cost at which this quantity entered stock.
- posted-at: date required
- posted-by: reference to employee required
- corrects: reference to goods-receipt-fact — Set on a correcting fact.
- correction-reason: text — Required when corrects is set.

- open-quantity: number — The quantity this posting closes on the order. Named to match the order so the counter can find it.
- received-quantity: number — The same quantity under the name the order line uses.

## Identified by
order-line and posted-at

## Created on demand
no

## Predicates
- traceable: batch-number exists and best-before-date exists
- correction: corrects exists
- justified correction: corrects exists and correction-reason exists

## References
- `goods-receipt` → `goods-receipt`
- `order` → `order`, `order-line` → `order-line`
- `article` → `article`, `batch` → `batch`
- `warehouse-location` → `warehouse-location`
- `posted-by` → `employee`
- `corrects` → `goods-receipt-fact`

## Retention
**10 years** under GoBD, immutable. This entity is append-only: no rule in this template
issues an `Update goods-receipt-fact` or a `Delete goods-receipt-fact`, and none ever
should.

## Notes
### justified correction
A correction without a stated reason is refused. An auditor's first question about any
reversal is "why", and the answer belongs in the record, not in somebody's memory.

### Used by

`processes/goods-receipt.md`, `processes/goods-receipt-correction.md`,
`management-system/monthly-stock-review.md`, `management-system/month-end-close.md`
