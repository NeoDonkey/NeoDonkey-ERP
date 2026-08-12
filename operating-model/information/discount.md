# Discount

A price reduction, and the record of who was allowed to grant it. Discounts are where margin quietly
disappears in a consumer business: a voucher campaign that runs a week too long, a retail buyer who
negotiates two percent every year, an agent being kind to everybody. None of those is wrong; all of
them need to be visible.

So a discount is a document, not a number typed into an order. It has a type, a limit, an authoriser
and a period. The processes split at ten percent: below it a customer service agent decides, above it
the managing director does. That is one number in one place, and moving it is a one-word change with a
signed history.

## Fields
- name: text required — What it is called internally.
- discount-type: text required — voucher-code, campaign, retail-condition, goodwill, volume-rebate or clearance.
- discount-percent: number required — Zero when the discount is a fixed amount.
- discount-amount: money — For fixed-amount vouchers.
- currency: text — EUR.
- applies-to-channel: text required — webshop, retail or all.
- applies-to-article: reference to article — Empty means all articles.
- applies-to-customer: reference to customer — Retail conditions are per customer.
- valid-from: date required — When it starts.
- valid-to: date required — When it stops. A discount without an end date is a price change.
- usage-limit: number — How many redemptions are allowed.
- usage-count: number required — Starts at zero, raised on each use.
- minimum-order-value: money — Where one applies.
- requires-approval: boolean required — Whether it is above the agent boundary.
- approved-by: reference to employee — Who approved it.
- approval-date: date — When.
- expected-margin-impact: money — Estimated at approval, reviewed weekly.
- status: one of draft, active, exhausted, expired, withdrawn required — A discount ends. `expired` and `withdrawn` are different endings and the reporting cares.

## Identified by
name

## Created on demand
no

## Predicates
- within agent authority: discount-percent <= 10
- needs management approval: discount-percent > 10
- approved: approved-by exists and approval-date exists
- active: status is "active"
- exhausted: usage-count >= usage-limit
- clearance: discount-type is "clearance"
- retail condition: discount-type is "retail-condition"
- goodwill: discount-type is "goodwill"
- bounded: valid-to exists
- impact estimated: expected-margin-impact exists

## Authorized by
- create: customer-service-agent or category-manager or managing-director
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or customer-service-agent
- update: category-manager or managing-director
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): the
`- <operation>: <roles>` bullets govern every operation on this entity that no process rule covers. Without
them, an uncovered operation is open to an actor with no role at all — grammar version 1's permissive default,
and the defect Part 4's standing rule 4 was written about. Where a rule *does* cover the operation, the rule's
authority wins and these bullets are not consulted.

`delete` is the managing director everywhere, and it should almost never be used: a document that ten years of
other documents point at is retired by a status change, not removed. `read` is wide, because reading changes
nothing and an audit needs the lot.
### within agent authority
The boundary. Up to ten percent a customer service agent may settle a complaint without asking
anybody. This one predicate is the difference between a company where the front line can fix things
and a company where every gesture needs a manager — and where agents therefore either escalate
constantly or start doing it unofficially.

### exhausted
`usage-count >= usage-limit`, a field-to-field comparison, which grammar version 1 supports. It is
worth noticing that this is the kind of business rule that classical systems bury in application code
and that here is one readable line on the document it belongs to.

### bounded
A discount that never expires is a price. Prices go through a margin check; discounts do not. The
`valid-to` obligation is what stops a "temporary" campaign running for three years.

### clearance
Clearance discounts exist because of best-before dates. A batch approaching its MHD is worth more
sold cheaply than written off, and the weekly margin review looks at the two numbers side by side.

## Retention

A discount granted on an invoice is part of the invoice trail: **10 years** under GoBD. Expired
campaigns are kept, not deleted, because the invoices that used them still reference them.

## References

`processes/discount-posting.md`, `processes/discount-approval.md`,
`processes/b2c-sales-order.md`, `management-system/weekly-margin-review.md`
