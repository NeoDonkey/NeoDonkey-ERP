# Munich office

Head office. Category management, purchasing, finance and customer service sit here. No goods, no
stock, no goods receipt — and the operating model says so explicitly, because a location that is not
stock-holding cannot take a goods receipt, and that rule is what stops a pallet being received into
a room with no shelves.

The reason a pure office is in the operating model at all is that decisions have locations too.
Approvals happen here, the reviews in `management-system/` are chaired from here, and an auditor
asking "where were the books kept" needs an answer.

## Notes
### Site facts

- `id` — `munich-office`
- `location-type` — `office`
- `country` — `DE`
- `city` — Munich
- `in-eu-customs-union` — `yes`
- `stock-holding` — `no`
- `operated-by` — `own`
- `haccp-scope` — `no`
- `vat-registration` — `vat-de`
- `status` — `active`

### Processes here

`processes/purchase-ordering.md`, `processes/purchase-order-approval.md`,
`processes/article-onboarding.md`, `processes/price-change.md`, `processes/invoice-issuance.md`,
`processes/supplier-invoice-verification.md`, `processes/supplier-invoice-approval.md`,
`processes/payment-run.md`, `processes/payment-run-release.md`,
`processes/incoming-payment-matching.md`, `processes/customer-complaint.md`

### Tax position

Same German registration as Berlin. No supplies are made from here, so it appears on no invoice as a
ship-from location.

### Note on samples

The one honest exception to "no goods here": product samples for retail buyer meetings. They are
issued as a `stock-adjustment` of type `sample-withdrawal` from Berlin, not received here, and they
are a real category of loss worth watching in the monthly stock review.
