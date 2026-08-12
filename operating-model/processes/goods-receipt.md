# Goods Receipt

The goods receipt is executed when a delivery arrives at the warehouse.
It checks whether the delivery matches the order and updates stock
plus order status.

That paragraph is the whole process, and it is worth noticing that it is also the entire
specification. Everything below is the same sentence, written precisely enough for a runtime to
execute. There is no requirements document between the two, and that is the point.

Three things make a food goods receipt different from a general one. Batch-managed articles must
arrive with a batch number and a best-before date, or we can neither trace them nor state a shelf
life. Quality-critical articles land in quarantine rather than on the picking shelf, until somebody
has released them. And goods may only be received at a site that actually holds stock — which stops
a pallet being booked into an office.

### How to read the rules below

All three rules fire on the same event: somebody creating a goods receipt. In grammar version 1
every rule on the same operation is a **hard requirement** — all of their conditions must hold
together, or the receipt is refused with each broken condition quoted. So read the three rule
blocks as one contract rather than as three branches.

## Triggered by
Arrival of a delivery at the location with reference to an order.

## Rules

If Create goods-receipt under condition
  quantity > 0 and
  order exists and
  order not already fully delivered
then
  Create goods-receipt-fact with batch-number and
  Update stock with +quantity and
  Update order-line with status "delivered"

If Create goods-receipt under condition
  article batch managed and
  location stock holding
then
  Create batch with quality-status "quarantined" with shelf-life-status "fresh"

If Create goods-receipt under condition
  order receivable
then
  Update order with +delivered-quantity and
  Update order-line with +delivered-quantity and
  Update order with status "partially-delivered"

## Notes

The three rules, in the order they appear above.

### The first rule — the core, and the one word that was added
Appendix XII prints this rule like this:

```
then
  Create goods-receipt-fact and
  Update stock with +quantity and
  Update order-line with status "delivered"
```

and then says: to introduce a batch number, the supply chain manager adds one word —
`Create goods-receipt-fact with batch-number`. Above, that word has been added. That is the only
difference between the manifesto's text and this file, and it is the whole demonstration: three
things happen on every accepted receipt — the immutable fact is written, stock rises by the counted
quantity, the order line is marked delivered — and from the moment those two words appear, a receipt
without a batch number is refused. The runtime says so by name:

```
"batch-number" was not captured on this goods-receipt, but the rule requires it:
  "Create goods-receipt-fact with batch-number".
```

Delete the two words and the obligation is gone. No code changed, no release, no consultant.

The runtime decides *which* stock document to change by itself, and not by guessing: `stock` declares
`## Identified by article and location`, the goods receipt declares both of those fields, so the
target is the stock document for that article at that location. If no such document exists yet —
the first pallet of a new article at a new warehouse — `stock` declares
`## Created on demand: yes`, and one is created. That is a business decision, written in
`information/stock.md`, not a convenience the runtime granted itself.

The order line is found through the declared `order-line` reference. Nothing here is inferred.

### The second rule — the quarantine record
`Create batch` writes it. It works because a batch and a goods receipt share the
declared fields `batch-number`, `article`, `best-before-date` and `quantity` — both files say so — so
those values are copied, and the two `with` clauses supply the two the receipt has no opinion about.
`best-before-date` is `required` on a batch, so a receipt lacking one is refused there too. The MHD
obligation costs one word in `information/batch.md`.

### The third rule — a running total, not a calculation
The order carries `delivered-quantity` and the predicate `fully delivered` compares it against
`ordered-quantity`. The grammar has no aggregation — there is no way to sum an order's lines — so the
total is maintained as it happens, which is what an accountant would do anyway and what makes the
number auditable.

The counter reads the trigger's field of the *same name*, which is why the goods receipt declares
`delivered-quantity` alongside `quantity`. `information/goods-receipt.md` explains that duplication
and names its exit path; it is the one place in this model where a field exists for the language
rather than for the business.

### What the first rule does not do, honestly
It marks the order line `delivered` on *any* accepted receipt, including a partial one. That is what
the manifesto's sentence says, and we have kept it rather than quietly improving it. Fixing it means
changing its last line — which is exactly the change the manifesto invites a supply chain
manager to make. What we cannot do is add a *second* rule setting the same field to a different
value: grammar version 1 refuses that as a conflict, and rightly, because last-writer-wins in the
truth layer would be worse than a refusal.

Closing the order when the last line arrives is the same story: it needs a branch, and grammar
version 1 has none. Until it does, the order is closed by the monthly stock review, and this
sentence is here so that nobody thinks it happens by itself.

## Authorized by
warehouse-clerk or warehouse-management

## References

The receipt updates stock; it does not touch the general ledger. Valuing what arrived and putting it on the
balance sheet is a separate, later act by the accountant: `processes/journal-posting.md` debits
`3980 Bestand Waren` and credits `3960 Bestandsveränderungen Waren`, because the purchase itself was already
charged to *Wareneingang* by the supplier invoice. The two are separate commits on purpose — a warehouse clerk
counting pallets is not making an accounting entry, and the valuation is not the clerk's to decide.

`information/goods-receipt.md`, `information/stock.md`, `information/batch.md`,
`processes/quality-inspection.md`, `processes/journal-posting.md`,
`processes/supplier-invoice-posting.md`
