# Payment run release

Actually sending the money. This is the sharpest four-eyes boundary in the company and the shortest
file in the folder.

Everything about it is deliberate. The accountant prepared the run and cannot release it. The
releaser did not assemble it and does not need to re-check every invoice — their job is to be a
different person. And the release is a signed commit, so "two people approved this payment run" is a
cryptographic statement rather than an administrative one.

The SEPA file hash matters more than it looks. It records the exact bytes handed to the bank, which
means that years later "the run was approved" and "this payment was in the approved run" are the same
claim rather than two claims one of which is unverifiable.

## Triggered by
A payment run in `ready` status.

## Rules
If Update payment-run under condition
  payment-run ready for release and
  payment-run independently released
then
  Update payment-run with status "released" and
  Update payment-run with release-date and
  Update payment-run with released-by

If Update payment-run under condition
  status is "ready" and
  released-by exists
then
  Update payment-run with +approval-count

If Update payment-run under condition
  payment-run released and
  payment-run submitted to bank
then
  Update payment-run with status "submitted" and
  Update payment with status "booked"

If Update payment-run under condition
  payment-run justified cancellation
then
  Update payment-run with status "cancelled" and
  Update payment with status "returned"

## Authorized by
controller or managing-director
