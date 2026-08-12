# Returns and credit notes

Goods coming back and money going out. In a European webshop a consumer may withdraw from a
distance contract within fourteen days without giving a reason, so returns are a designed process
rather than an exception queue.

Food returns almost never go back into sellable stock. We cannot vouch for how a bag of cashews
was stored on somebody's kitchen counter, so the inspection result is usually `write-off` and the
commercially useful output of the process is the *reason*, which feeds the weekly quality round.

The credit note is where this connects to the books. An issued invoice is never edited; a return
produces a credit note that references the invoice, states a reason, and carries the same VAT
treatment as the original. A credit note with a different VAT treatment from its invoice is one of
the few errors that will reliably survive undetected until an audit.

## Triggered by
A customer announcing a return, a retailer refusing a pallet at goods-in, or a complaint being
settled with a credit.

## Rules
If Create return under condition
  sales-order exists and
  article exists and
  reason-code exists
then
  Update return with status "announced" and
  Update return with return-shipping-paid-by

If Update return under condition
  return write off required and
  return received
then
  Create stock-adjustment with adjustment-type "write-off-quality" and
  Update return with status "inspected"

If Update return under condition
  return resellable and
  return received
then
  Update batch with quality-status "quarantined" and
  Update return with status "inspected"

If Create credit-note under condition
  credit-note references original and
  credit-note justified and
  return exists
then
  Update credit-note with status "issued" and
  Update credit-note with vat-treatment and
  Update return with status "credited"

## Notes

Back into quarantine, so the quality manager decides. Returning goods directly to pickable stock
is how a customer's returned parcel ends up in somebody else's order.

The condition `references original` is the one that matters. A credit note that does not say which
invoice it corrects is not a credit note, it is a hole in the bookkeeping, and the rule refuses it.

## Authorized by
customer-service-agent or accountant
