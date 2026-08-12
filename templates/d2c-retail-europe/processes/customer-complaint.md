# Customer complaint

Somebody tells us something is wrong. Most of it is logistics and is settled in one reply. A small
fraction is about the food itself, and that fraction has to leave the service queue immediately.

The dividing line is `complaint-category`, and the escalation is a rule rather than a habit,
because habits fail on Friday afternoons. A foreign body, a labelling error or an allergen
complaint reaches the quality manager on creation. An allergen complaint is the most serious item
on the list and goes to the managing director in the same act.

The first practical question on any food complaint is the batch code on the pack. Without a batch
we cannot investigate and cannot bound a recall — the choice becomes "do nothing" or "recall
everything", and both are bad. So `batch identified` is a named predicate and the agent's job is to
get it.

## Triggered by
A customer contacting us by any channel, or a retailer raising a quality claim.

## Rules
If Create complaint under condition
  customer exists and
  description exists and
  complaint-category exists
then
  Update complaint with status "open" and
  Update complaint with severity and
  Update complaint with assigned-to-role

If Create complaint under condition
  complaint food safety relevant
then
  Update complaint with status "escalated" and
  Update complaint with assigned-to-role "quality-manager" and
  Create quality-inspection

If Create complaint under condition
  complaint allergen relevant
then
  Update complaint with severity "critical" and
  Update complaint with status "escalated" and
  Update complaint with authority-notification-required "yes"

If Update complaint under condition
  complaint food safety relevant and
  complaint batch identified
then
  Update complaint with status "in-progress" and
  Update complaint with quality-inspection

If Update complaint under condition
  complaint closed
then
  Update complaint with closed-date

## Notes

Marking notification as required does not notify anybody — that is a decision for the quality
manager and the managing director in `processes/quality-escalation.md`. What it does is make the
obligation a field in a record with a clock on it, rather than an intention in somebody's inbox.

## Authorized by
customer-service-agent or quality-manager
