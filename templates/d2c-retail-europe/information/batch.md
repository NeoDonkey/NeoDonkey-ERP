# Batch

A batch is one delivery of one article from one supplier, kept together so that we can
answer three questions: how long is it good for, was it released by quality, and where
did it go. Everything that makes food different from other goods is attached here.

A batch is created by a goods receipt, never by hand. It carries the supplier's batch
number as printed on the outer carton, and the best-before date — the *Mindest­haltbar­keits­datum*,
MHD — as printed on the pack. If the pack says nothing, the batch is not accepted; a
food business that cannot state an MHD cannot ship.

Batches move through quality: they arrive `quarantined`, an inspection releases or
blocks them, and only released batches may be picked. In a recall we need to go from
batch to every delivery note in minutes, which is why a goods-receipt-fact and a
delivery note both reference the batch and neither is ever overwritten.

## Fields
- id: text required — Our internal batch id, e.g. BAT-2026-08-0113.
- batch-number: text required — The supplier's batch number from the carton.
- article: reference to article required
- supplier: reference to supplier required
- goods-receipt: reference to goods-receipt required — Where it came in.
- best-before-date: date required — The MHD as printed.
- production-date: date — Where the supplier states it.
- received-quantity: number required — In the article's selling unit.
- received-weight-kg: number — Actual weighed net weight, for weight-priced articles.
- quality-status: text required — quarantined, released, blocked, destroyed.
- shelf-life-status: text required — fresh, near-expiry, expired. Maintained by the daily shelf-life sweep, not typed by a person.
- remaining-shelf-life-days: number required — Recomputed by the same sweep.
- haccp-check-passed: text — yes or no, set by the quality inspection.
- temperature-on-arrival-celsius: number — Required for anything temperature-controlled.
- certificate-of-analysis: text — Supplier document reference.
- organic-certificate-number: text — Required for anything sold as organic.
- blocked-reason: text — Filled when quality-status is blocked.

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

## References
- `article` → `article`
- `supplier` → `supplier`
- `goods-receipt` → `goods-receipt`

## Retention
Batch records are the backbone of food traceability under EU 178/2002 and are kept for
**10 years** under GoBD as part of the goods-receipt trail. A destroyed batch is marked
`destroyed`, never deleted — the write-off is itself a bookkeeping fact.

## Notes
### retail acceptable
A retailer's goods-in will refuse a pallet with too little remaining shelf life. `fresh`
is defined against the article's `minimum-remaining-shelf-life-days`, which is why that
field lives on the article and the derived status lives here.

### traceable
<!-- NEEDS-GRAMMAR: `shelf-life-status` and `remaining-shelf-life-days` are derived
     fields maintained by processes/shelf-life-sweep.md, because the grammar has no way
     to compare a stored date against the current date. The rule we would rather write is
     `best-before-date < today`. See the v0.2 proposal for a `today` symbol and date
     comparison. Until then the derived-field workaround is deliberate and the sweep is
     the only writer of those two fields. -->
     the only writer of those two fields. -->

### Used by

`processes/goods-receipt.md`, `processes/quality-inspection.md`,
`processes/shelf-life-sweep.md`, `processes/stock-write-off.md`,
`processes/picking-and-shipping.md`, `management-system/weekly-quality-round.md`
