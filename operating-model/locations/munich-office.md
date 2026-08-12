# Munich office

Head office. Category management, purchasing, finance and customer service sit here. No goods, no stock,
no goods receipt — and the operating model says so explicitly, because `location stock holding` is a
condition in `processes/goods-receipt.md` and this site does not satisfy it.

The reason a pure office is in the operating model at all is that decisions have locations too.
Approvals happen here, the reviews in `management-system/` are chaired from here, and an auditor asking
"where were the books kept" needs an answer.

## Context

- name: `munich-office`
- location-type: `office`
- country: `DE`, city: Munich
- in-eu-customs-union: `true`
- stock-holding: `false` — deliberately stated, not left out
- operated-by: `own`
- haccp-scope: `false`
- status: `active`

## Notes

### stock-holding: false is a control, not a blank
Somebody receiving a pallet here is refused by name: the goods receipt rule requires
`location stock holding`, which is `stock-holding is true and status is "active"`. A field left empty
would have produced the same refusal for the wrong reason; a field set to `false` says the company
thought about it.

### The one honest exception
Product samples for retail buyer meetings. They are issued as a `stock-adjustment` of type
`sample-withdrawal` from Berlin, not received here, and they are a real category of loss worth watching
in the monthly stock review.

## References

`processes/purchase-ordering.md`, `processes/article-onboarding.md`,
`processes/invoice-issuance.md`, `management-system/monthly-stock-review.md`
