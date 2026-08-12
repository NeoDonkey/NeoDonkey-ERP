# Purchasing manager

Buys the goods. Negotiates with importers and growers, places purchase orders, chases late deliveries,
and owns the relationship that decides whether we have cashews in October.

Two gates bound this role. Purchase orders below 10,000 EUR net go out on their signature alone; at or
above that the managing director approves as well, in a separate signed act. And a supplier cannot be
ordered from until they are approved — which means somebody checked the food-safety certification and
somebody *else* checked the bank details. A purchaser who could both create a supplier and pay it is
the standard invoice-fraud setup.

For food there is a third thing experienced buyers always specify and inexperienced ones always
forget: the minimum remaining shelf life on arrival. Agreeing it at order time is a negotiation;
discovering it at goods receipt is an argument.

## Purpose

- Place and maintain purchase orders, with agreed prices per unit or per kilogram.
- Agree minimum remaining shelf life and record it on the order line.
- Assemble new supplier records: VAT identification, certifications, terms.
- Chase confirmations, late deliveries and short deliveries.
- Bring supplier performance numbers to the quarterly supplier review.

## Notes

### Authorised for
`processes/purchase-ordering.md`

### Not authorised for
Confirming a purchase order at or above 10,000 EUR net — that is `processes/purchase-order-approval.md`
and the managing director. Setting a supplier to `approved` on their own. Posting goods receipts.

### Reports to
`managing-director`

### Sees
Suppliers, purchase orders, order lines, goods receipts, stock levels. Not customer data.
