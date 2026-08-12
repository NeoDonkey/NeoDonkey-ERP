# Inventory count

Somebody walks to the shelf and counts. Everywhere else in this folder the record is a statement of
intent; here it meets the physical world, and where the two disagree the physical world wins.

German commercial law requires a full physical inventory at least once a year, and the result is the
stock figure in the annual accounts. Between annual counts we count fast movers on a cycle, because
a difference found in March is worth far more than the same difference found in December — in March
you can still work out what caused it.

The discipline that makes counting worth doing is the recount. Most large differences are counting
mistakes, and booking a counting mistake turns a five-minute walk into a permanent error in the
accounts. So above tolerance the answer is "count it again", not "post it".

## Triggered by
The annual inventory, the cycle-count plan, a negative stock balance, or a picker reporting that the
bin is empty when the system says it is not.

## Rules
If Create inventory-count under condition
  location exists and
  counted-quantity >= 0 and
  counted-by exists
then
  Update inventory-count with status "counted" and
  Update inventory-count with book-quantity and
  Update inventory-count with difference-quantity

If Update inventory-count under condition
  inventory-count within tolerance and
  inventory-count counted
then
  Create stock-adjustment with adjustment-type "count-correction" and
  Update inventory-count with status "posted"

If Update inventory-count under condition
  inventory-count above tolerance
then
  Update inventory-count with recount-required "yes" and
  Update inventory-count with status "counted"

If Update inventory-count under condition
  inventory-count above tolerance and
  inventory-count explained
then
  Update inventory-count with explanation and
  Update inventory-count with status "explained"

If Update inventory-count under condition
  inventory-count annual count and
  inventory-count independently verified
then
  Update inventory-count with status "posted" and
  Update stock with last-counted-date

## Notes

There is no rule in this file that posts an above-tolerance difference without an explanation. That
is the control, and it is also simply good practice: an unexplained inventory difference is
information, and posting it away destroys the information.

The annual count feeds the balance sheet, so it gets a second signature. Cycle counts do not —
insisting on it would mean they quietly stop happening, and a cycle count that happens is worth
more than a verified one that does not.

## Authorized by
warehouse-management or controller
