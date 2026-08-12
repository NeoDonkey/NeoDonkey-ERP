# Review minute

The written outcome of a steering meeting. One document per review held: what the numbers were, what
they meant, what was decided, and who is doing what.

This is what makes the management system real rather than decorative. A monthly stock review that
produces no minute did not happen, and the rules in `management-system/` say so — the review is closed
by creating a minute, and a minute without figures, findings and decisions is not agreed.

It also serves as the supplier evaluation record. A quarterly supplier review produces one minute per
supplier, with that quarter's performance numbers and a decision: keep, develop or replace. Making it
a minute rather than a separate scorecard keeps the decision and the evidence in one document, which
is the only form in which either is useful a year later.

## Fields
- review-type: text required — monthly-stock, weekly-margin or quarterly-supplier.
- period: text required — 2026-08, 2026-W32 or 2026-Q3.
- held-date: date required — When it actually happened.
- chaired-by-role: text required — Which role owned the meeting.
- participants-roles: text required — Role slugs, comma separated. Roles, not people.
- subject-supplier: reference to supplier — Set on a quarterly supplier review.
- subject-location: reference to location — Set where a review is site-specific.
- key-figures: text required — The numbers the meeting looked at, stated as read.
- findings: text required — What the numbers meant.
- decisions: text required — What was decided. "No change" is a decision; empty is not allowed.
- actions: text — Action, owning role, due date.
- open-actions-carried-forward: number required — From the previous minute of the same type.
- supplier-rating: text — keep, develop or replace. Supplier reviews only.
- on-time-delivery-percent: number — Supplier reviews only.
- complaint-count-period: number — Supplier reviews only.
- escalated-to-role: text — Where the meeting could not decide.
- status: one of draft, agreed, superseded required — `superseded` keeps the old minute readable, which is the point of minutes.

## Identified by
review-type and period

## Created on demand
no

## Predicates
- complete: key-figures exists and findings exists and decisions exists
- agreed: status is "agreed"
- supplier review: review-type is "quarterly-supplier"
- stock review: review-type is "monthly-stock"
- margin review: review-type is "weekly-margin"
- supplier rated: supplier-rating exists
- has open actions: open-actions-carried-forward > 0
- escalated: escalated-to-role exists

## Authorized by
- create: controller or managing-director or quality-manager or category-manager
- read: auditor or controller or managing-director or category-manager or purchasing-manager or accountant or quality-manager or warehouse-management or treasurer or tax-accountant
- update: controller or managing-director
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): the
`- <operation>: <roles>` bullets govern every operation on this entity that no process rule covers. Without
them, an uncovered operation is open to an actor with no role at all — grammar version 1's permissive default,
and the defect Part 4's standing rule 4 was written about. Where a rule *does* cover the operation, the rule's
authority wins and these bullets are not consulted.

`delete` is the managing director everywhere, and it should almost never be used: a document that ten years of
other documents point at is retired by a status change, not removed. `read` is wide, because reading changes
nothing and an audit needs the lot.
### complete
Figures, findings, decisions. A minute missing any of the three is not agreed. This is the smallest
possible discipline that stops a management system decaying into a recurring calendar invitation, and
it costs the chair about four sentences.

### participants are roles, not people
A review is a function of the organisation, not of who happened to be in the room. Recording roles
means the minute still makes sense after somebody leaves, and it also means the folder contains no
personal data.

### has open actions
Actions carried forward for three periods running is the clearest early signal that a review has
stopped working. It is one number, and it is worth reading out loud at the start of every meeting.

### Nothing here fires on a schedule
Grammar version 1 has no scheduled trigger — `## Cadence` is prose and nothing fires monthly. The
rhythm is held by people, and the rules only check that what they produce is complete. That is an
honest limit, named in `runtime/polism/grammar.md` §10 limit 10, and the exit path is a
management-system trigger form driven by an injected clock.

## Retention

Minutes that document bookkeeping decisions — the stock review's tolerance decisions, the margin
review's pricing decisions — are part of the *Verfahrensdokumentation* and retained **10 years** under
GoBD. Supplier evaluations are retained for the certification audit cycle, which the same ten years
covers.

## References

`management-system/monthly-stock-review.md`, `management-system/weekly-margin-review.md`,
`management-system/quarterly-supplier-review.md`
