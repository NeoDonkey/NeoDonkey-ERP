# Discount posting

Granting a price reduction. Discounts are where margin quietly disappears in a consumer business: a
voucher campaign that runs a week too long, a retail buyer who negotiates two percent every year, an
agent being kind to everybody. None of those is wrong; all of them need to be visible.

So a discount is a document, not a number typed into an order. It has a type, a limit, a period and an
expected cost. The two rules below enforce the two things that are true of every discount this company
grants, whoever grants it: it ends, and somebody has said what it will cost.

## Triggered by
A complaint being settled, a campaign starting, a retail condition being agreed, or short-dated stock
needing to move.

## Rules

If Create discount under condition
  discount bounded and
  valid-from exists and
  discount-percent >= 0
then
  when discount needs management approval authorized by managing-director then
    Update discount with status "draft"
      with discount-type
      with requires-approval true
      with approved-by
      with approval-date
  otherwise
    Update discount with status "draft"
      with discount-type
      with requires-approval false

If Create discount under condition
  applies-to-channel exists and
  name exists
then
  Update discount with valid-to and
  Update discount with expected-margin-impact

## Notes

### bounded
`valid-to exists`. A discount that never expires is a price, and prices go through a margin check that
discounts do not. This one condition is what stops a "temporary" campaign running for three years, and
it is the cheapest rule in the folder.

### expected-margin-impact as an obligation
Somebody has to say what it will cost before it starts. A campaign approved without an estimate is how a
business discovers in March that Christmas was unprofitable. The number will be wrong; having written it
down is what makes the weekly margin review a conversation rather than an archaeology exercise.

### The ten percent boundary, now enforced
Up to ten percent a customer service agent decides alone; above it the managing director does, and names
themselves on the document. The boundary is the predicate `needs management approval`
(`discount-percent > 10`) in `information/discount.md`; the authority is the first arm's
`authorized by managing-director`.

This paragraph used to say the opposite, and it is worth keeping the reason on the page. In grammar
version 1 `## Authorized by` belonged to the *file*, the trigger selected the rules, and every rule on one
trigger was a hard requirement — so two files on `Create discount`, one for ≤ 10 % and one for > 10 %,
conjoined into a contradiction that refused *every* discount while the model read correct. That was the
single most consequential thing this operating model could not do.

Grammar version 2 §14 and §16 closed it. One rule, two arms, and **the most specific authority wins and
only it**: the arm names the managing director, so a customer service agent granting fifteen percent is
refused even though the file authorises them for discounts in general. Note the direction of that — the
managing director is *not* covered by the `otherwise` arm either, because arm authority replaces rather
than adds. A business that wants the director to be able to grant five percent writes
`customer-service-agent or managing-director` on that arm.

Above the boundary the arm also demands `approved-by` and `approval-date` as obligations, so an approval
that is not on the document is not an approval.

## Authorized by
customer-service-agent or category-manager or managing-director
