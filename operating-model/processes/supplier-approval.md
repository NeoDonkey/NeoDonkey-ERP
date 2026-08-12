# Supplier approval

Promoting a supplier from `prospect` to `approved`, which is the moment we may order from them. Two facts have
to be true and they are deliberately established by two different people: the food-safety certification is
valid, and the bank details have been checked.

That separation is the whole point of the file. A purchaser who can both create a supplier and set its bank
details as checked is the standard invoice-fraud setup in a mid-sized company — invent a supplier, or change
a real one's account, then approve your own work. So `iban-on-file` is not the purchasing manager's to set,
and this rule is not the purchasing manager's to run.

`processes/purchase-ordering.md` reads the result as `supplier approved for ordering`
(`status is "approved" and iban-on-file is true`), so a supplier who has not been through here cannot be
ordered from at all, and the refusal names the condition rather than failing silently at goods-in three weeks
later.

## Triggered by
A prospect passing the food-safety check and the bank-detail check. Or a certification lapsing, which sends
them the other way.

## Rules

If Update supplier under condition
  vat-treatment active and
  payment-terms-days >= 0
then
  when supplier certified and iban-on-file is true authorized by quality-manager or controller then
    Update supplier with status "approved"
      with certification-valid
      with iban-on-file
      with last-evaluated-date
  otherwise when certification-valid is false authorized by quality-manager then
    Update supplier with status "on-hold"
      with certification-valid
      with last-evaluated-date

## Notes

### Why the first arm names two roles and not one

`quality-manager or controller` — either may perform the promotion, and both facts must already be on the
document. The separation this file protects is not *who presses approve*; it is that the two facts came from
two different places. The quality manager owns `certification-valid`, from
`management-system/quarterly-supplier-review.md`. The bank-detail check that sets `iban-on-file` belongs to
the treasurer or the controller. **Neither is the purchasing manager**, and the purchasing manager is not on
this rule at any level.

What is still missing, and it is the same gap as everywhere else in this model: nothing checks that the two
facts were set by two different *people*. That needs two signatures on one commit (manifesto line 114), which
is a Truth Layer property. The role separation is real and it is the best a single-actor evaluation can do.

### There is no default arm, on purpose

`parse.js` warns about a branch set with no `otherwise`, and the warning is right to exist — but here the
answer to "what happens when neither arm matches" is *nothing should*. An ordinary update to a supplier —
new payment terms, a corrected name — is not an approval and must not be forced into a status. Grammar §14.1
says an unmatched branch set contributes no consequents and the operation proceeds, which is exactly what is
wanted.

The consequence is worth stating: **this rule governs the promotion, it does not govern every update.** A
supplier's status can still be changed by an update that satisfies neither arm, because the trigger's own
change stands. Closing that needs the arm conditions moved into the rule's `under condition` list, which
would then refuse the corrected name as well. The choice between those two is a business decision and this
file has made the permissive one, knowingly.

### The second arm sends them the other way

A lapsed certification puts the supplier `on-hold` rather than `blocked`, and the quality manager does it
alone — a control that is slow to apply is a control that is not applied. `on-hold` is enough to stop new
orders, because `approved for ordering` requires `status is "approved"`. `blocked` is a commercial decision
and is not in this file.

### What `iban-on-file` is and is not

A boolean. **The bank details themselves are not in this document and must never be** —
`information/supplier.md` says so, and this model holds no account numbers anywhere. What is missing, and an
auditor will ask for it, is a control on *changing* the details of an approved supplier: today setting
`iban-on-file` back and forth is an ordinary update. That is the door invoice-redirection fraud walks
through and it is on the list for Wave 3.

## Authorized by
quality-manager or controller
