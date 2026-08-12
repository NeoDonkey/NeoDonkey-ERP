# Incoming payment matching

Working out who paid what. Boring, daily, and the source of more customer frustration than any other
back-office process — because an unmatched payment is usually somebody sitting at home waiting for a
parcel they have already paid for.

The webshop and the retail channel create completely different problems. Card and wallet payments
arrive as a batch settlement from the payment service provider with a fee already deducted, so the
amount in the bank never equals the amount the customers paid, and reconciling the gap is real work.
Retail payments arrive as a bank transfer weeks later, often for a slightly different amount than
invoiced, because the customer has deducted something they have decided they are entitled to.

The rule that matters is the last one: an unexplained difference is recorded as a difference, not
absorbed. A system that quietly writes off small differences is a system in which a supplier can
underpay every invoice by 0.5 % forever.

## Triggered by
A bank statement being imported, or a payment service provider settlement arriving.

## Rules
If Create payment under condition
  direction is "incoming" and
  bank-statement-reference exists and
  amount-eur > 0
then
  Update payment with status "booked" and
  Update payment with match-status "unmatched"

If Update payment under condition
  payment booked and
  invoice exists and
  match-status is "matched"
then
  Update invoice with status "paid" and
  Update customer with status "active"

If Update payment under condition
  payment psp settlement and
  payment fee deducted
then
  Update payment with match-status "matched" and
  Update payment with psp-fee-eur

If Update payment under condition
  payment has unexplained difference
then
  Update payment with match-status "partially-matched" and
  Update payment with unexplained-difference-eur

If Update payment under condition
  payment matched and
  payment incoming and
  customer exists
then
  Update sales-order with payment-status "paid" and
  Update customer with status "active"

## Notes

<!-- NEEDS-GRAMMAR: what these two rules want is `Update customer with -open-balance-eur by
     amount-eur` — reduce the customer's balance by the amount of this payment. The counter form
     takes its delta from the trigger's field of the same name, and a payment has `amount-eur`, not
     `open-balance-eur`. So the rules use the obligation form instead, which says the balance must
     be present and recomputed, and loses the arithmetic. v0.2 proposal: an explicit delta,
     `Update <entity> with -<field> by <field>`. This is the same gap noted in
     `processes/picking-and-shipping.md` and it is the second most frequently needed missing
     construct after field-to-field comparison. -->

This is the rule the customer actually experiences. Everything above it is bookkeeping; this one is
the parcel leaving the building.

## Authorized by
accountant
