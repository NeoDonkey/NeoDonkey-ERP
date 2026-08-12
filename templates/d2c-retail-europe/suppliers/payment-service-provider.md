# Supplier — payment service provider

**Zahlungsdienst Lindner AG**, an invented placeholder for the provider handling card and wallet payments
in the webshop.

They are a supplier with an unusual property: the money the customer pays goes to *them* first, and what
reaches our bank is a batch settlement with a fee already deducted. So the amount in the bank never equals
the amount the customers paid, and reconciling that gap is real daily work rather than an edge case.

## Context

- name: `Zahlungsdienst Lindner AG`, supplier-type: `service`, country: `DE`
- vat-identification-number: on file; vat-treatment: `domestic-standard`
- payment-terms-days: `0` — they net the fee, we do not pay an invoice
- iban-on-file: `yes`
- status: `approved`

## Notes

### Why the reconciliation is not optional
`psp-settlement-reference` and `psp-fee-eur` on `information/payment.md` exist so that one bank line can
be traced back to many customer payments and one fee. Without them, the webshop's revenue and the bank
account never agree, and nobody can say whether the difference is fees, chargebacks or a missing
settlement.

The rule that matters is in `processes/incoming-payment-matching.md`: an unexplained difference is
*recorded* as a difference, never absorbed. A system that quietly writes off small differences is a
system in which a percentage can leak forever.

### Chargebacks
`status: chargeback` on a payment. A chargeback reverses a payment after the parcel has shipped, which is
the one case in the B2C flow where we have delivered and not been paid. It is rare and it is worth
counting, because a rising chargeback rate is usually a fraud pattern rather than unhappy customers.

### The fee is a cost of sale
It belongs in the margin, not below the line. That is why the weekly margin review reads it: a two
percent payment fee on a fifteen percent contribution margin is an eighth of the profit on every order.

## References

`processes/incoming-payment-matching.md`, `processes/b2c-sales-order.md`,
`management-system/weekly-margin-review.md`, `management-system/quarterly-supplier-review.md`
