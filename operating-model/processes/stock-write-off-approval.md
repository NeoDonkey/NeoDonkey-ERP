# Stock write-off approval

The controller posts the write-off that somebody else prepared.

The reasoning is the one an auditor would give: the person accountable for the physical stock should not
be the only person who can make a difference to it disappear. That is not an accusation, it is a
structural control, and it protects the warehouse manager as much as the company — "I could have made it
vanish" becomes untrue rather than merely unlikely.

In this instance the only reason to update a stock adjustment is to approve it. That is why the rule
below can require an approver on *every* update: there is no other kind. If your business edits draft
adjustments before approving them, this rule needs splitting and this sentence needs deleting.

## Triggered by
A stock adjustment in draft, waiting to be posted.

## Rules

If Update stock-adjustment under condition
  stock-adjustment justified and
  value > "0.00 EUR" and
  approved-by exists
  authorized by warehouse-management or controller
then
  when value > "5000.00 EUR" and stock-adjustment independently approved authorized by managing-director then
    Update stock-adjustment with status "posted"
      with approved-by
      with reason-note
  otherwise when value > "500.00 EUR" and stock-adjustment independently approved authorized by controller then
    Update stock-adjustment with status "posted"
      with approved-by
      with reason-note
  otherwise when value > "500.00 EUR" authorized by controller then
    Update stock-adjustment with status "pending-approval"
      with approved-by
  otherwise
    Update stock-adjustment with status "posted"
      with approved-by

## Notes

### approved-by exists
The condition and the obligation say the same thing twice, deliberately. The condition refuses the
update; the obligation makes the field part of the posted record. An approval that is not on the
document is not an approval.

### The thresholds, now that branches exist
Grammar version 1 could not express a value threshold at all — `## Authorized by` belonged to the file, every
rule on a trigger conjoined, and two files for "below 500" and "above 500" produced one operation nobody could
perform. `runtime/polism/grammar.md` limit 14 says so, and the note that used to be here said the 500 EUR
signature was a documented control rather than an enforced one.

With branches it is enforced, in both directions. **Above 500 EUR the adjustment cannot reach `posted`
without `approval-count >= 2`** — the third arm catches that case and leaves it at `pending-approval`, so the
value stays on the balance sheet until a second commit raises the count. And **each threshold carries its own
authority**: the managing director above 5,000 EUR, the controller between 500 and 5,000, warehouse management
below. Below 500 EUR one approver posts it.

Money literals are compared in the FD-1 canonical form (`value > "500.00 EUR"`), so the comparison is exact
BigInt minor units and an adjustment valued in another currency is refused rather than converted. The old
condition read `value > 0`, comparing a `money` field with a bare number, which FD-1 no longer permits.

### What is still not four-eyes
`approval-count >= 2` is a counter, not two keys. Two increments are not two signatures, and this rule cannot
tell the difference. The `authorized by` line restricts the act to `controller or managing-director` and the
preparer is the warehouse manager or the quality manager, so in practice two different people are involved —
enforced by role, not by identity. A controller approving a write-off a controller prepared is still possible.
Closing it needs two signers on one commit, which is where the manifesto puts four-eyes (line 114).

### The authority split, which is now real
Three thresholds, three authorities, one rule:

- **above 5,000 EUR** — `authorized by managing-director`, and two approvals on the document;
- **above 500 EUR** — `authorized by controller`, and two approvals;
- **above 500 EUR without the second approval** — the controller may only move it to
  `pending-approval`, so the value stays on the balance sheet until somebody else signs;
- **below 500 EUR** — the rule's own authority, `warehouse-management or controller`.

This is grammar §16's arm scope, and it is the construct that closes limit 14. In version 1 the same
intention needed two files, whose `## Authorized by` sections conjoined into a contradiction that refused
every write-off while the model read correct — the silent dead control that was version 1's worst defect.
Now the most specific scope wins and only it: an arm naming the managing director means the managing
director, even though the rule says warehouse management. A refusal quotes the declaration that actually
decided.

The one thing to watch: an arm's authority **replaces** the rule's rather than adding to it, so the
managing director is *not* covered by the 500 EUR arm and the controller is *not* covered by the 5,000 EUR
arm. That is deliberate (§16), it is what stops authority widening by accident, and it means a managing
director approving a 600 EUR write-off is refused. If that is wrong for a business, the arm says
`controller or managing-director` — one edit, in the sentence that decides.

### Posting it to the ledger
Approving the adjustment does not post it to the general ledger. That is a separate act with its own entry:
`processes/journal-posting.md` debits `4855 Warenverluste und Inventurdifferenzen` and credits `3980 Bestand
Waren` at the adjustment's value, and an adjustment in the other direction posts the same accounts with the
sides swapped, which is how an over-stated write-off is corrected.
