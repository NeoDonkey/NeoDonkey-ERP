# Stock write-off

Removing value from the balance sheet because the goods are gone, ruined, or past their date. In a food
business this is a regular event, not an incident: shelf life is finite and some percentage of every buy
will expire.

An auditor reads the write-off list before almost anything else, for a simple reason — an adjustment is
the easiest way to make an inventory difference disappear. So every write-off states a reason in words
as well as a code, and where the food went is recorded too: a pallet of dates to a food bank is a
donation with its own tax treatment, the same pallet to waste is not, and the sustainability reporting
asks for the split.

A stock adjustment usually *reduces* stock, and until the grammar gained branches an increase was refused
outright rather than half-modelled. It is now allowed: the rule below subtracts on a decrease and adds on an
increase, because the general ledger needs the other direction — correcting an over-stated write-off is an
adjustment the other way, posted as a new journal entry that never touches the original.

## Triggered by
The shelf-life sweep flagging an expired batch, a blocked batch after a quality decision, breakage on
the dock, or a sample taken for the laboratory.

## Rules

If Create stock-adjustment under condition
  stock-adjustment justified and
  quantity > 0 and
  location stock holding
then
  when stock-adjustment decrease then
    Update stock with -quantity
  otherwise
    Update stock with +quantity

If Create stock-adjustment under condition
  value > "0.00 EUR" and
  created-by exists
then
  Update stock-adjustment with reason-note and
  Update stock-adjustment with status "draft"

## Notes

### justified
`reason-code exists and reason-note exists`. Both. An auditor's question about a write-off is never
"which code" and always "what happened".

### The direction, and the branch that used to be a refusal
This note used to say: "a hard refusal rather than a silent branch — grammar version 1 cannot say *if
decrease then subtract else add*, so rather than modelling half the behaviour an increase is refused by name.
When the grammar gains a branch, the second half becomes two more lines here and nothing else changes."

The grammar gained the branch, and those are the two lines. An increase now raises stock instead of being
refused, which the ledger needs: correcting an over-stated write-off is an adjustment in the other direction,
and `processes/journal-posting.md` posts it as `3980 Bestand Waren` Soll against `4855 Warenverluste` Haben —
a new entry that corrects the original without touching it. The quoted paragraph is kept because a promise
made in a file and then kept in the same file is the clearest evidence that the model is the software: no code
changed, no release happened, and the behaviour is different from the next adjustment onward.

### It starts as a draft
The write-off does not post itself. `processes/stock-write-off-approval.md` — a different file, a
different signature — moves it to `posted`. Splitting detection from posting is what stops a nightly
sweep writing value off the balance sheet on its own authority.

### The 500 EUR second signature
At or above 500 EUR the controller signs as well as the warehouse manager. The threshold is the
predicate `needs approval` in `information/stock-adjustment.md`. It is low on purpose: in a business
where a pallet of nuts is worth four figures, a threshold high enough to feel comfortable would be high
enough to be useless.

The two-signature requirement itself is a documented manual control, not a rule. That entity file
carries an `approval-count` field and it would be easy to present `approval-count >= 2` as four-eyes —
it is not. Two increments of a counter are not two signers, and genuine four-eyes is a signature
constraint on the commit (manifesto line 114). It belongs to the Truth Layer and it is listed as an
open item.

## Authorized by
warehouse-management or quality-manager
