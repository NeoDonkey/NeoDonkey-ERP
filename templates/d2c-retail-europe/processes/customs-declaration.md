# Customs declaration

Paperwork for goods crossing the EU customs border. In this template that is two cases: pallets going
to the Swiss office, and containers of nuts arriving from outside the EU.

The Swiss case is in the template on purpose. Switzerland is in the middle of DACH, uses a language
we speak, and is *not* in the EU customs union — so a pallet to Zurich needs an export declaration, a
commercial invoice with a tariff number, and a proof of export to keep the sale zero-rated. Teams
discover this the first time a truck is standing at Basel.

The import case has a second layer that catches food businesses. Customs clearance and food clearance
are different things. A container can be legally in the country and still not sellable, because the
health certificate and the CHED entry in TRACES are missing. So the release from quarantine in
`processes/quality-inspection.md` reads the customs declaration, not just the pallet.

## Triggered by
A shipment to a country outside the EU customs union, or goods arriving from outside it.

## Rules
If Create customs-declaration under condition
  direction is "export" and
  customs-tariff-number exists and
  statistical-value-eur > 0
then
  Update customs-declaration with status "draft" and
  Update customs-declaration with declaration-reference

If Create customs-declaration under condition
  direction is "import" and
  customs-tariff-number exists
then
  Update customs-declaration with import-vat-amount-eur and
  Update customs-declaration with duty-amount-eur

If Update customs-declaration under condition
  customs-declaration preferential origin proven
then
  Update customs-declaration with duty-amount-eur 0 and
  Update customs-declaration with status "submitted"

If Update customs-declaration under condition
  customs-declaration cleared and
  customs-declaration food import documented
then
  Update batch with quality-status "quarantined" and
  Update customs-declaration with status "cleared"

## Notes

Claiming preferential origin without the proof is a customs offence, not a rounding error. Both parts
of the predicate, or neither.

Cleared customs puts the batch into quarantine, not into stock. The release is the quality manager's,
and it is a different file with a different signature.

## Authorized by
logistics-coordinator
