# Payment run

Assembling the week's outgoing payments. The accountant builds it; somebody else releases it.

That split is the oldest control in finance and the reason this is two files. Preparation is here.
Release is `processes/payment-run-release.md`, authorised by the controller or the managing director,
and it is a separate signed act. A payment run that one person could both prepare and release is the
standard way money leaves a mid-sized company without anybody noticing for a year.

The commercially interesting part of preparation is the early-payment discount. A two percent
*Skonto* for paying within ten days instead of thirty is an annualised return most businesses would
be delighted with elsewhere, and it is routinely missed because nobody was watching the date.

## Triggered by
The weekly payment cycle, or a *Skonto* deadline approaching.

## Rules
If Create payment-run under condition
  invoice-count > 0 and
  total-amount-eur > 0 and
  prepared-by exists
then
  Update payment-run with status "draft" and
  Update payment-run with execution-date and
  Update payment-run with bank-account-reference

If Create payment under condition
  direction is "outgoing" and
  supplier-invoice payable and
  payment-run exists
then
  Update payment with status "expected" and
  Update payment-run with +invoice-count

If Update payment-run under condition
  payment-run ready for release
then
  Update payment-run with status "ready"

If Update payment under condition
  direction is "outgoing" and
  early-payment-discount-taken-eur > 0
then
  Update payment with amount-eur and
  Update supplier-invoice with status "scheduled"

## Notes

There is no rule anywhere in this folder that creates an outgoing payment against an invoice that is
not `payable`, and `payable` means approved — including the second signature where the value
requires it. The approval control cannot be bypassed by going straight to the payment, because the
payment reads the same predicate.

`ready` is where the accountant's authority ends. The next status is `released` and it is in a
different file with a different `## Authorized by` line.

## Authorized by
accountant
