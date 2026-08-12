# Stock write-off

Removing value from the balance sheet because the goods are gone, ruined, or past their date. In a
food business this is a regular event, not an incident: shelf life is finite and some percentage of
every buy will expire.

An auditor reads the write-off list before almost anything else, for a simple reason: an adjustment
is the easiest way to make an inventory difference disappear. So every write-off states a reason in
words, not only a code, and above 500 EUR it needs the controller as a second signature in
`processes/stock-write-off-approval.md`.

Where the food went also matters. A pallet of dates to a food bank is a donation with its own tax
treatment; the same pallet to waste is not. The disposal method is an obligation on expiry
write-offs, which is also the number the sustainability reporting asks for.

## Triggered by
The shelf-life sweep flagging an expired batch, a blocked batch after a quality decision, breakage
on the dock, or a returned batch that cannot be resold.

## Rules
If Create stock-adjustment under condition
  direction is "decrease" and
  stock-adjustment justified and
  quantity > 0
then
  Update stock-adjustment with status "draft" and
  Update stock-adjustment with value-eur

If Update stock-adjustment under condition
  value-eur < 500 and
  stock-adjustment justified
then
  Update stock-adjustment with status "posted" and
  Update stock with -quantity and
  Update stock with -available-quantity

If Create stock-adjustment under condition
  stock-adjustment expiry write off
then
  Update stock-adjustment with disposal-method and
  Update stock-adjustment with reason-note

If Update stock-adjustment under condition
  stock-adjustment posted and
  batch exists
then
  Update batch with quality-status "destroyed" and
  Update batch with blocked-reason

## Authorized by
warehouse-management or quality-manager
