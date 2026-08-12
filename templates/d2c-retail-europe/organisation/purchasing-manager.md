# Purchasing manager

Buys the goods. Negotiates with importers and growers, places purchase orders, chases late
deliveries, and owns the relationship that decides whether we have cashews in October.

The authority boundary here is a value threshold and a supplier-onboarding gate. Purchase
orders up to 10,000 EUR net go out on this role's signature alone; above that the managing
director approves as well. New suppliers cannot be ordered from until they are approved,
which means the food-safety certification and the bank details have both been checked — and
checked by different people, because a purchaser who can both create a supplier and pay it is
the standard invoice-fraud setup.

## Notes
### Responsibilities

- Place and maintain purchase orders, with agreed prices per unit or per kilogram.
- Agree minimum remaining shelf life with suppliers and record it on the order line.
- Onboard new suppliers: collect VAT identification, certifications, terms.
- Chase confirmations, late deliveries and short deliveries.
- Resolve price variances found by the three-way match.
- Bring supplier performance numbers to the quarterly supplier review.

### Authorized for

- `processes/purchase-ordering.md`
- `processes/supplier-onboarding.md`

### Not authorized for

- Approving a purchase order of 10,000 EUR or more — that needs `managing-director`.
- Setting a supplier to `approved` — the certification check is `quality-manager`, the bank
  details are `accountant`. This role assembles the file; two others complete it.
- Verifying, approving or paying a supplier invoice.
- Posting goods receipts.

### Reports to

`managing-director`

### Sees

Suppliers, purchase orders, order lines, goods receipts, stock levels and forecasts. Supplier
invoices in read-only form, because resolving a price variance requires seeing the invoice.
Not customer data, not sales prices beyond what the margin review shows them.
