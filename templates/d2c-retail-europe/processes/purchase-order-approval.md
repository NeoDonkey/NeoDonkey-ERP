# Purchase order approval

The second signature on a large purchase. This is a separate file, not a branch inside
`processes/purchase-ordering.md`, for one reason: `## Authorized by` applies to a whole file, so
a different authorisation means a different file. That constraint turns out to be a feature —
you can see every place in the company where two signatures are required by listing the files
and reading one line of each.

Ten thousand euros net is the boundary in this template. It is not a magic number; it is the
point at which a mistake stops being absorbable by a month's margin. Move it if your business
is a different size, and the move is itself a signed commit somebody can find later.

The approver must not be the person who created the order. That is guaranteed here in the
strongest available way: approval is a second commit, and the two commits carry two different
signatures. Nobody holds both keys unless somebody handed one over, which is a different problem
with a different fix.

## Triggered by
A purchase order in draft at or above 10,000 EUR net.

## Rules
If Update order under condition
  order needs approval and
  approved-by exists and
  supplier approved for ordering
then
  Update order with status "confirmed" and
  Update order with +ordered-quantity

If Update order under condition
  supplier blocked
then
  Update order with status "cancelled"

## Notes

A supplier gets blocked for a reason — a failed certification, an unresolved quality incident,
an unpaid dispute. Cancelling open orders to them automatically is blunt, and it is also what
you want: the alternative is a pallet arriving from a supplier the company has decided not to
buy from.

## Authorized by
managing-director
