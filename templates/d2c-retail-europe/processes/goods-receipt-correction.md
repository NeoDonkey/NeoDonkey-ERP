# Goods receipt correction

Somebody counted 240 and it was 204. It happens on every dock in Europe, and how a system
handles it says more about the system than almost anything else.

A posted goods-receipt-fact is never edited. The correction is a *second* fact, referencing
the first, with a reason. Both stay visible forever, and the stock balance is the sum of
both. That is what *Unveränderbarkeit* means in the GoBD sense, and it is also just how
bookkeeping has always worked: you do not erase an entry, you post the opposite one.

The correction is warehouse management's, not the clerk's — not because clerks are not
trusted, but because the second pair of eyes on a counting difference is what makes the
difference an investigation rather than an adjustment.

## Triggered by
Discovery that a posted goods receipt does not match what physically arrived.

## Rules
If Create goods-receipt-fact under condition
  corrects exists and
  correction-reason exists
then
  Update stock with +quantity and
  Update order-line with +received-quantity

If Update order under condition
  order open and
  open-quantity > 0
then
  Update order with status "partially-delivered"

## Notes

An order that had closed and is reopened by a negative correction goes back to
partially delivered. It does not go back to `confirmed` — the supplier did deliver
something, and pretending otherwise loses information.

## Authorized by
warehouse-management
