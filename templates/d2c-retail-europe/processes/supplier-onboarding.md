# Supplier onboarding

Adding a supplier looks like data entry and is actually a control. The classic fraud in a
mid-sized company is not a forged invoice — it is a real invoice to a fake supplier whose bank
details somebody helpful set up. So the file is assembled by one role and completed by two
others, and the supplier cannot be ordered from until both have done their part.

The purchasing manager collects the commercial facts: name, country, terms, VAT identification
number. The quality manager verifies the food-safety certification, because our own IFS status
depends on our suppliers'. The accountant verifies the bank details against something other
than the email that asked for them.

The VAT identification number deserves its own sentence. An EU supplier without a valid one
cannot be treated as reverse charge, which means we owe the VAT ourselves and cannot reclaim it.
It is the cheapest check in this whole folder and the most frequently skipped.

## Triggered by
A new supplier being needed, or an existing supplier's certification or bank details changing.

## Rules
If Create supplier under condition
  country exists and
  payment-terms-days > 0
then
  Update supplier with status "prospect" and
  Update supplier with supplier-type and
  Update supplier with vat-treatment

If Update supplier under condition
  supplier food supplier and
  vat-identification-number exists and
  certification-valid is "yes"
then
  Update supplier with status "approved"

If Update supplier under condition
  supplier reverse charge supplier
then
  Update supplier with vat-treatment "eu-reverse-charge"

If Update supplier under condition
  supplier food supplier and
  certification-valid is "no"
then
  Update supplier with status "on-hold"

## Notes

On hold rather than blocked: existing orders continue, new ones stop, and somebody has a
conversation. Blocking is for a decision, not for an expiry date.

## Authorized by
purchasing-manager
