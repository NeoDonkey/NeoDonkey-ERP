# Annual operating model review

Once a year, half a day, the managing director and the operating model steward read this folder from
beginning to end and ask one question of every file: is this still true.

It is the most easily skipped meeting here and the one whose absence does the most damage. In a
conventional company a stale process document is an annoyance. Here the folder *is* the system, so a file
describing something the company stopped doing eight months ago is not out-of-date documentation — it is
a rule still being enforced, refusing transactions for a reason nobody remembers.

The review is also where the thresholds get revisited. Ten thousand euros for a purchase order, five
hundred for a write-off, ten percent for a discount, one hundred for a goodwill credit. Each was right
when it was set and each becomes wrong as the company grows.

## Cadence

Annually, after the accounts are signed. Chaired by the managing director with the operating model
steward. Half a day, plus reading time beforehand.

## Measures

- Files not changed in twelve months — candidates for being stale rather than stable.
- Rules that never fired, from the transaction history. A rule that never fires is either dead or wrong.
- Rules that fired and refused most often, with the reasons. High refusal counts usually mean the rule
  describes something other than what people actually do.
- Every threshold, against the size the company is now.
- Every role in `organisation/`, against the job titles that actually exist.
- The `NEEDS-GRAMMAR` list: how many are still open, how many the grammar has since gained, how many
  turned out not to be needed.
- Actions carried forward three periods or more in any review, from `has open actions`.

## Owner

`managing-director` decides; `operating-model-steward` prepares and holds the pen.

## Notes

### The NEEDS-GRAMMAR list is a company asset
Every one of those comments is a place where the company's reality is larger than the rule language, with
the workaround currently in use written next to it. Reviewing them annually does two things: it tells the
NeoDonkey community what to build next, and it stops a workaround quietly becoming the way things are
done.

Removing a marker is only legitimate when the grammar has gained the construct or the requirement has
genuinely gone away — see `organisation/operating-model-steward.md`.

### Rules that never fired
This is the measure that keeps the folder honest, and it is only available because every transaction is a
signed commit with the rules that applied to it. No classical ERP can answer "which of our
configured controls has never once triggered", and the answer is usually uncomfortable.

### What this meeting must not become
A redesign. The operating model changes continuously, in small signed commits, as the business changes.
This meeting is a read-through and a tidy-up. If it turns into an annual re-planning exercise, the
translation chain has grown back and Principle 11 has been lost.

### No rules here
See `management-system/monthly-stock-review.md`.

## References

`README.md`, `organisation/operating-model-steward.md`, `organisation/managing-director.md`
