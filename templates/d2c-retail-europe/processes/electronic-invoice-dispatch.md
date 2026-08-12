# Electronic invoice dispatch

Getting the invoice into the customer's system in a form their software accepts. For consumers
this is a PDF by email and there is nothing to say. For German business customers it is structured
data — EN 16931, in practice XRechnung or ZUGFeRD — and for public-sector buyers it is XRechnung
with a Leitweg-ID, without which the receiving portal rejects it outright.

The Leitweg-ID is the detail that catches everybody. It is not an optional reference field; it is
the routing address of the receiving authority, and an XRechnung without one does not arrive. It
belongs to the customer, not to the invoice, which is why it lives on the customer record and is
copied onto the invoice as the buyer reference (BT-10).

This is also the clearest example of Principle 5 in practice. XRechnung is a dialect we speak, not
a module we bought. The invoice document in the repository is the truth; the XML is a rendering of
it for one audience, and a retailer's EDI format is another rendering for another audience. Adding
a third is a translation rule, not a project.

## Triggered by
An issued invoice whose customer requires an electronic format.

## Rules
If Update invoice under condition
  invoice electronic invoice required and
  invoice xrechnung complete
then
  Update invoice with status "sent" and
  Update invoice with sent-at and
  Update invoice with archived-format-hash

If Update invoice under condition
  invoice electronic invoice required and
  buyer-reference exists and
  structured-document-reference exists
then
  Update invoice with status "sent"

If Update invoice under condition
  delivery-format is "edi" and
  customer-purchase-order-reference exists
then
  Update invoice with status "sent" and
  Update invoice with structured-document-reference

## Notes

The two conditions are the Leitweg-ID and the stored XML. There is no rule in this file that
dispatches an XRechnung without both, which means the failure happens here, with a message naming
the missing field, rather than three days later as a silent rejection in somebody else's portal.

Their purchase order reference is a condition, not a courtesy. Without it the invoice is rejected
by accounts payable and the payment term restarts.

## Authorized by
accountant
