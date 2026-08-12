# Quality escalation

The process nobody wants to run. A batch may be unsafe: what now.

Under EU Regulation 178/2002 a food business that has reason to believe its product is unsafe must
withdraw it and inform the competent authority *without delay*. That is not a service-level
target and it is not a decision to take at the next weekly round. The quality manager and the
managing director decide together, and both signatures are on the record.

The technical part is traceability, and it is where all the batch discipline in this folder pays
off. From a batch we reach every goods-receipt-fact, every delivery note and therefore every
destination, in seconds. A company without that chain has to choose between doing nothing and
recalling everything.

## Triggered by
A critical control point deviation, an allergen or foreign-body complaint, or a supplier
notification about a batch we received.

## Rules
If Create stock-adjustment under condition
  adjustment-type is "write-off-quality" and
  batch blocked and
  quantity > 0
then
  Update stock with -quantity and
  Update stock with -available-quantity

If Update complaint under condition
  complaint needs authority notification and
  complaint critical
then
  Update complaint with authority-notified-date and
  Update complaint with status "escalated"

If Update batch under condition
  batch blocked and
  batch traceable
then
  Update delivery-note with status "refused" and
  Create complaint with severity "critical"

## Notes

The condition `batch traceable` — a batch number and a best-before date on file — is what makes
this rule possible at all. It is also exactly the obligation that `processes/goods-receipt.md`
enforces with two words in a consequent. That is the connection between the most routine process
in the company and the least routine one.

## Authorized by
quality-manager or managing-director
