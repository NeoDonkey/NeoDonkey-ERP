# Purchase order confirmation

Turning a draft purchase order into a live one. Nothing has been promised to anybody while the order is a
`draft`; `confirmed` is the state in which we have committed to take the goods and they have committed to
deliver them, and it is the state a goods receipt can be booked against.

The gate is the supplier's own order confirmation. Until they have acknowledged the order with their own
reference, what exists is our intention rather than an agreement, and a pallet arriving against an
unacknowledged order means something went wrong upstream. `processes/goods-receipt.md` reads
`order receivable` — `status is "confirmed" and delivered-quantity < ordered-quantity` — so an unconfirmed
order refuses the receipt by name instead of quietly accepting stock nobody agreed to buy.

Cancellation is the other transition, and it is the purchasing manager's, because an order the supplier has
not yet acted on costs nothing to withdraw.

## Triggered by
The supplier's order confirmation arriving, or a decision to withdraw an order they have not yet acted on.

## Rules

If Update order under condition
  order open and
  requested-delivery-date exists
then
  when supplier-confirmation-reference exists authorized by purchasing-manager or category-manager then
    Update order with status "confirmed"
      with supplier-confirmation-reference
      with requested-delivery-date
  otherwise when order confirmed authorized by purchasing-manager then
    Update order with status "cancelled"
  otherwise
    Update order with status "draft"

## Notes

### Why this file exists at all

Before it, nothing in `processes/` set an order `confirmed`. So the purchase-to-receipt chain could not
complete through rules: `order receivable` was a condition on the goods receipt that no rule could ever make
true, and the only way through was a person editing the document outside any authority declaration. The same
hole existed for `article active` and `supplier approved`, and the three are closed by this file,
`processes/article-activation.md` and `processes/supplier-approval.md`.

### `supplier-confirmation-reference` as an obligation

The condition refuses the confirmation and the obligation puts the reference on the record. Both, deliberately:
a confirmation nobody can quote back to the supplier is not a confirmation, and three weeks later, when the
delivery is late, that reference is what the conversation is about.

### The order of the arms matters

Grammar §14.1: written order, first match wins, exactly one arm runs. So an order that already has a
confirmation reference is confirmed rather than cancelled, even if somebody is trying to cancel it — which is
correct, because cancelling a confirmed order is a negotiation with the supplier and not a status change.
Withdrawing an order the supplier *has* acknowledged therefore has no rule here, and that is the honest state:
it is a phone call, then a credit note or a returned delivery, and neither is a single field.

### What is not here

No partial cancellation, no quantity or price amendment, no reopening a delivered order. An order that needs a
different quantity is a new order, which is also what a supplier's ERP will insist on.

## Authorized by
purchasing-manager or category-manager
