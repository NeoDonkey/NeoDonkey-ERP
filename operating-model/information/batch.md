# Batch

A batch is one delivery of one article from one supplier, kept together so that we can answer
three questions: how long is it good for, was it released by quality, and where did it go.
Everything that makes food different from other goods is attached here.

A batch is created by a goods receipt, never by hand. It carries the supplier's batch number as
printed on the outer carton and the best-before date — the *Mindesthaltbarkeitsdatum*, MHD — as
printed on the pack. A food business that cannot state an MHD cannot ship.

Batches move through quality. They arrive `quarantined`; an inspection releases or blocks them;
only released batches may be picked. In a recall we need to get from a batch to every delivery
in minutes, which is why a goods-receipt-fact records the batch number as a value and is never
overwritten.

## Fields
- batch-number: text required — The supplier's batch number from the carton.
- article: reference to article required — What is in it.
- supplier: reference to supplier — Who made it.
- best-before-date: date required — The MHD as printed on the pack.
- production-date: date — Where the supplier states it.
- quantity: number required — Received quantity in the article's selling unit.
- quality-status: text required — quarantined, released, blocked or destroyed.
- shelf-life-status: text required — fresh, near-expiry or expired.
- remaining-shelf-life-days: number — Maintained by the daily shelf-life sweep.
- haccp-check-passed: boolean — Set by the quality inspection.
- temperature-on-arrival-celsius: number — Required for temperature-controlled goods.
- certificate-of-analysis: text — Supplier document reference.
- organic-certificate-number: text — Required for anything sold as organic.
- blocked-reason: text — Filled whenever quality-status is blocked.

## Identified by
article and batch-number

## Created on demand
no

## Predicates
- released for sale: quality-status is "released" and shelf-life-status is not "expired"
- expired: shelf-life-status is "expired"
- near expiry: shelf-life-status is "near-expiry"
- blocked: quality-status is "blocked"
- retail acceptable: quality-status is "released" and shelf-life-status is "fresh"
- traceable: batch-number exists and best-before-date exists
- quarantined: quality-status is "quarantined"

## Authorized by
- create: warehouse-clerk or warehouse-management
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-clerk or warehouse-management
- update: quality-manager or warehouse-management
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
### retail acceptable
A retailer's goods-in refuses a pallet with too little remaining shelf life. `fresh` is measured
against the article's `minimum-remaining-shelf-life-days`, which is why that number lives on the
article and the derived status lives here.

### shelf-life-status and remaining-shelf-life-days are derived
Both are maintained by `processes/shelf-life-sweep.md` and by nothing else. The rule we would
rather write is `best-before-date < today`, and the grammar has no `today` — deliberately, because
a rule that read the clock would give a different answer every time it ran and the audit trail
would stop being reproducible. So the current date enters this operating model in exactly one
place, as a named act by a named role, and leaves a signed record behind. That is a real cost and
it is paid in one file.

### traceable
A batch number and a best-before date on file. This is the condition that makes a bounded recall
possible at all, and it is exactly what the two words `with batch-number` in
`processes/goods-receipt.md` enforce.

## Retention

Batch records are the backbone of food traceability under EU 178/2002 and are kept **10 years**
under GoBD as part of the goods-receipt trail. A destroyed batch is marked `destroyed`, never
deleted — the write-off is itself a bookkeeping fact.

## References

`processes/goods-receipt.md`, `processes/quality-inspection.md`,
`processes/shelf-life-sweep.md`, `processes/stock-write-off.md`,
`processes/picking-and-shipping.md`, `management-system/monthly-stock-review.md`
