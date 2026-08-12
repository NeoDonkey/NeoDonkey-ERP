# Stock write-off approval

Above 500 EUR, the controller signs too.

The reasoning is the one an auditor would give: the person accountable for the physical stock should
not be the only person who can make a difference to it disappear. That is not an accusation, it is
a structural control, and it protects the warehouse manager as much as the company.

Five hundred euros is low on purpose. In a business where a pallet of nuts is worth four figures, a
threshold high enough to be comfortable would be high enough to be useless.

## Triggered by
A stock adjustment in draft at or above 500 EUR.

## Rules
If Update stock-adjustment under condition
  stock-adjustment needs approval and
  stock-adjustment independently approved and
  stock-adjustment justified
then
  Update stock-adjustment with status "posted" and
  Update stock with -quantity and
  Update stock with -available-quantity

If Update stock-adjustment under condition
  stock-adjustment needs approval and
  approved-by exists
then
  Update stock-adjustment with +approval-count and
  Update stock-adjustment with status "pending-approval"

## Notes

`independently approved` is `approval-count >= 2`. Each approval is a separate commit with a
separate signature, so two approvals means two keys — which is a stronger statement than two rows
in a permissions table, and it is checkable years later by anybody with the repository.

## Authorized by
controller
