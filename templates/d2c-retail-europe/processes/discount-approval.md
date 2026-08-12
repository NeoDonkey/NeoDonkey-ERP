# Discount approval

Above ten percent, the managing director decides.

This file exists for one structural reason worth understanding, because the same pattern repeats
five times in this template. A `## Authorized by` section applies to every rule in its file. So a
different authorisation level cannot be a condition inside a rule — it has to be a different file.

That looks like a limitation and works as a discipline. The complete list of decisions in this
company that need somebody more senior is the list of files with a senior role in their
`## Authorized by` line. No permissions matrix, no role editor, no screen with checkboxes that
nobody has reviewed since 2019.

Ten percent is not a law of nature. It is one number, in `information/discount.md`, in a predicate
called `needs management approval`, and changing it is a one-word edit with a signed history.

## Triggered by
A discount above ten percent being proposed — a campaign, a negotiated retail condition, or a
large goodwill gesture.

## Rules
If Update discount under condition
  discount needs management approval and
  discount approved
then
  Update discount with status "active"

If Update discount under condition
  discount needs management approval and
  approved-by exists
then
  Update discount with approval-date and
  Update discount with expected-margin-impact-eur

If Create discount under condition
  discount needs management approval
then
  Update discount with status "draft"

## Notes

The expected margin impact is an obligation rather than a nicety. A discount approved without
anybody stating what it will cost is how a business discovers in March that its Christmas campaign
was unprofitable.

There is no rule anywhere in this folder that sets a discount above ten percent to `active`
without `approved-by`. The control is the absence of a path, which is stronger than a check
somebody could disable.

## Authorized by
managing-director
