# Discount

A price reduction, and the record of who was allowed to grant it. Discounts are where margin
quietly disappears in a consumer business: a voucher campaign that runs a week too long, a
retail buyer who negotiates two percent every year, a customer service agent being kind to
everybody. None of those is wrong; all of them need to be visible.

So a discount is a document, not a number typed into an order. It has a type, a limit, an
authoriser and a period. The rules in `processes/discount-posting.md` and
`processes/discount-approval.md` split at ten percent: below it a customer service agent
decides, above it the managing director does. That is one number in one place, and moving it
is a one-word change with a signed history.

## Fields
- id: text required — DSC-2026-0217.
- discount-type: text required — voucher-code, campaign, retail-condition, goodwill, volume-rebate, clearance.
- name: text required — What it is called internally.
- discount-percent: number required — 0 when the discount is a fixed amount.
- discount-amount-eur: number — For fixed-amount vouchers.
- applies-to-channel: text required — webshop, retail, all.
- applies-to-article: reference to article — Empty means all articles.
- applies-to-customer: reference to customer — Retail conditions are per customer.
- valid-from: date required
- valid-to: date required — Required. A discount without an end date is a price change.
- usage-limit: number — How many times a voucher may be redeemed.
- usage-count: number required — Starts at 0, raised on each use.
- minimum-order-value-eur: number
- requires-approval: text required — yes or no.
- approved-by: reference to employee
- approval-date: date
- expected-margin-impact-eur: number — Estimated at approval, reviewed weekly.
- status: text required — draft, active, exhausted, expired, withdrawn.

## Identified by
name

## Displayed by
name

## Created on demand
no

## Predicates
- within agent authority: discount-percent <= 10
- needs management approval: discount-percent > 10
- approved: approved-by exists and approval-date exists
- active: status is "active"
- exhausted: status is "exhausted"
- usable: status is "active" and usage-count < usage-limit
- retail condition: discount-type is "retail-condition"
- clearance: discount-type is "clearance"

## References
- `applies-to-article` → `article`
- `applies-to-customer` → `customer`
- `approved-by` → `employee`

## Retention
A discount granted on an invoice is part of the invoice trail: **10 years** under GoBD. Expired
campaigns are kept, not deleted, because the invoices that used them still reference them.

## Notes
### within agent authority
The boundary. A customer service agent may grant up to ten percent to settle a complaint
without asking anybody. This one predicate is what makes the difference between a company
where the front line can fix things and a company where every gesture needs a manager.

### usable
Grammar version 1 allows a field on the right-hand side of a comparison, so this predicate says
exactly what it means. What it cannot do is *act* on it: closing the voucher when the count reaches
the limit needs a conditional consequent, and there are none. So `status` is set to `exhausted` by the
redemption process and the rules read the status.
     `status is "active"`. That substitute is what `processes/discount-posting.md` uses. -->

### clearance
Clearance discounts exist because of best-before dates. A batch approaching its MHD is worth
more sold cheaply than written off, and the weekly margin review looks at the two numbers
side by side.

### Used by

`processes/discount-posting.md`, `processes/discount-approval.md`,
`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`management-system/weekly-margin-review.md`
