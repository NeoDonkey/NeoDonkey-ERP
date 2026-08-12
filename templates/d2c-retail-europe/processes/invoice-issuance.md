# Invoice issuance

Turning a shipment into a claim for money. Three audiences read the result and each of them can
reject it: the customer's accounts payable department, the tax office, and eventually an auditor.

The German requirements are a list, not a judgement call. §14 UStG says what must appear on an
invoice, and a missing element means the customer cannot deduct input tax — which means they will
not pay until it is fixed. The predicate `complete for german vat law` on the invoice entity *is*
that list, written as a sentence.

The zero-rated cases are where money is actually lost. A reverse-charge invoice needs three things
together — the buyer's VAT identification number on the face of it, the exemption wording, and zero
VAT — and getting two of the three right is worth exactly as much as getting none of them right.
An intra-community supply also needs the proof of transport, which is collected during shipping and
referenced here.

And an issued invoice is never changed. Not by the accountant, not by the managing director, not by
anybody. There is no rule in this folder that updates an amount on an issued invoice. If you add
one, you have removed the reason an auditor would believe any of the numbers.

## Triggered by
A sales order shipped, or a monthly consolidated invoice for a retail customer with a collective
billing agreement.

## Rules
If Create invoice under condition
  sales-order shipped and
  invoice-number exists and
  net-amount-eur > 0
then
  Update invoice with status "issued" and
  Update invoice with seller-vat-identifier and
  Update invoice with payment-due-date and
  Update invoice with vat-breakdown

If Update invoice under condition
  invoice complete for german vat law
then
  Update invoice with status "issued"

If Create invoice under condition
  customer eu business with valid vat id and
  sales-order reverse charge sale
then
  Update invoice with buyer-vat-identifier and
  Update invoice with vat-exemption-reason and
  Update invoice with vat-amount-eur 0

If Update invoice under condition
  invoice reverse charge and
  delivery-note transport proven
then
  Update invoice with delivery-note and
  Update invoice with status "issued"

If Create invoice under condition
  sales-order oss distance sale and
  vat-treatment destination rated
then
  Update invoice with vat-breakdown and
  Update invoice with vat-amount-eur

If Create invoice under condition
  sales-order export sale and
  customs-declaration cleared
then
  Update invoice with vat-amount-eur 0 and
  Update invoice with vat-exemption-reason

If Update invoice under condition
  invoice ready to send
then
  Update invoice with archived-format-hash and
  Update invoice with sent-at and
  Update invoice with status "sent"

If Create invoice under condition
  net-amount-eur > 0 and
  sales-order shipped
then
  Update invoice with net-amount-eur and
  Update invoice with vat-breakdown

## Notes

The archived hash is the whole GoBD *Unveränderbarkeit* argument in one field. It is the
fingerprint of the exact bytes the customer received, so in eight years we can prove that the
invoice in the repository is the invoice that was sent, rather than merely asserting it.

A customer who ordered a kilo of dates and received 1.03 kg is billed for 1.03 kg. That is normal
in food and it is why an invoice cannot be a copy of the order.

## Authorized by
accountant
