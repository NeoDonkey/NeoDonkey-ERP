# Discount posting

Granting a price reduction. Up to ten percent, the person talking to the customer decides. That is
the whole content of this file and it is more important than it looks.

A customer service agent who has to ask a manager before offering five euros off a damaged bag will
either escalate constantly or start doing it unofficially. Both are worse than the discount. So the
authority is real and the boundary is a number anybody can read — `within agent authority`, defined
on the discount entity as ten percent or less.

Above ten percent is a different file with a different `## Authorized by`:
`processes/discount-approval.md`. Splitting them is not bureaucracy, it is how the authorisation
boundary becomes visible. You can list this folder and see every place in the company where
somebody needs a second signature.

## Triggered by
A complaint being settled, a campaign starting, a retail condition being agreed, or near-expiry
stock needing to move.

## Rules
If Create discount under condition
  discount within agent authority and
  valid-to exists and
  applies-to-channel exists
then
  Update discount with status "active" and
  Update discount with discount-type

If Create discount under condition
  discount within agent authority and
  valid-from exists
then
  Update discount with valid-to

If Update discount under condition
  discount exhausted
then
  Update discount with status "exhausted"

If Create discount under condition
  discount clearance and
  applies-to-article exists
then
  Update discount with status "active" and
  Update discount with valid-to and
  Update discount with expected-margin-impact-eur

## Notes

The obligation clause is the whole rule. A discount that never expires is a price, and prices go
through `processes/price-change.md` with the margin check attached. This one line is what stops a
"temporary" campaign running for three years.

<!-- NEEDS-GRAMMAR: conditional consequents, and with them threshold-based authorisation.
     Grammar version 1 makes every rule on the same operation a hard requirement (grammar.md §8): all
     of their conditions must hold together. So a rule cannot say "if the count reached the limit then
     close it", and — more seriously — two files both triggered by `Create discount`, one requiring
     `within agent authority` and the other `needs management approval`, would conjoin into a
     contradiction and refuse every discount. Threshold-based authorisation is therefore not
     expressible: the ten percent boundary in this template is a documented control, not an enforced
     rule. v0.2 proposals, in order of value:
       1. per-rule `## Authorized by`, so an authorisation boundary can differ within one trigger;
       2. an opt-in conditional consequent, e.g. `then when <condition> ... and otherwise ...`, with
          the same refuse-on-unknown discipline as everything else;
       3. `or` between conditions (grammar.md §10 limit 2), which would cover the simpler half.
     This is the largest single thing the rule language cannot yet do. -->

## Authorized by
customer-service-agent or category-manager
