# Review minute

The written outcome of a steering meeting. One record per held review: what the numbers were,
what was decided, who is doing what by when.

This is the entity that makes the management system real rather than decorative. A monthly
stock review that produces no minute did not happen, and the rules in `management-system/`
say so — the review is closed by creating a minute, and a period cannot be closed while a
required review is missing its minute.

It also serves as the supplier evaluation record. A quarterly supplier review produces one
minute per supplier, with the performance numbers of that quarter and a decision: keep,
develop, or replace. Making that a minute rather than a separate scorecard keeps the decision
and the evidence in one document, which is the only form in which either is useful a year
later.

## Fields
- id: text required — REV-2026-08-stock.
- review-type: text required — monthly-stock, weekly-margin, quarterly-supplier, month-end-close, weekly-quality, annual-operating-model.
- period: text required — 2026-08, 2026-W32, 2026-Q3, 2026.
- held-date: date required
- chaired-by-role: text required — Which role owned the meeting.
- participants-roles: text required — Role slugs, comma separated. Roles, not people — the review is a function of the organisation, not of who happened to be in the room.
- subject-supplier: reference to supplier — Set on a quarterly supplier review.
- subject-location: reference to location — Set where a review is site-specific.
- key-figures: text required — The numbers the meeting looked at, stated as read.
- findings: text required — What the numbers meant.
- decisions: text required — What was decided. Empty is not allowed; "no change" is a decision.
- actions: text — Action, owning role, due date.
- open-actions-carried-forward: number required — From the previous minute of the same type.
- supplier-rating: text — keep, develop, replace. Supplier reviews only.
- on-time-delivery-percent: number — Supplier reviews only.
- complaint-count-period: number — Supplier reviews only.
- escalated-to-role: text — Where the meeting could not decide.
- status: text required — draft, agreed, superseded.

## Identified by
review-type and period

## Created on demand
no

## Predicates
- complete: key-figures exists and findings exists and decisions exists
- agreed: status is "agreed"
- supplier review: review-type is "quarterly-supplier"
- supplier rated: supplier-rating exists
- has open actions: open-actions-carried-forward > 0
- escalated: escalated-to-role exists
- stock review: review-type is "monthly-stock"
- margin review: review-type is "weekly-margin"
- close review: review-type is "month-end-close"

## References
- `subject-supplier` → `supplier`
- `subject-location` → `location`

## Retention
Minutes that document bookkeeping decisions — the month-end close, the inventory tolerance
decisions in the monthly stock review — are part of the *Verfahrensdokumentation* and retained
**10 years** under GoBD. Supplier evaluations are retained for the certification audit cycle,
which in practice means the same ten years here.

## Notes
### complete
A minute missing any of the three is not agreed. This is the smallest possible discipline that
stops a management system decaying into a recurring calendar invitation.

### has open actions
Actions carried forward for three periods in a row is the clearest early signal that a review
has stopped working. The annual operating-model review reads exactly this number.

### Used by

`management-system/monthly-stock-review.md`, `management-system/weekly-margin-review.md`,
`management-system/quarterly-supplier-review.md`, `management-system/month-end-close.md`,
`management-system/weekly-quality-round.md`,
`management-system/annual-operating-model-review.md`
