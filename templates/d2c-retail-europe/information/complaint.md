# Complaint

A customer telling us something is wrong. Most complaints are logistics — a dented box, a
late parcel — and are settled in one message. A small number are about the food itself, and
those have to leave the customer service queue immediately and reach the quality manager,
because a foreign body or an allergen mislabelling is a legal event with a clock on it.

The line between the two is drawn by `complaint-category`, and the escalation is a rule, not
a habit. A habit fails on a Friday afternoon.

**No personal data in this template.** A complaint in the live system will reference a
customer record; the template contains none, and the fields below deliberately have no place
to paste an email thread.

## Fields
- id: text required — CMP-2026-001183.
- customer: reference to customer required
- sales-order: reference to sales-order
- article: reference to article
- batch: reference to batch — Asked for whenever the complaint is about the food.
- received-date: date required
- channel-received: text required — email, phone, webform, marketplace, retailer.
- complaint-category: text required — transport-damage, late-delivery, wrong-article, quality-sensory, foreign-body, labelling, allergen, billing, other.
- severity: text required — low, medium, high, critical.
- description: text required — What the customer reported, in factual terms.
- assigned-to-role: text required — Which role owns it now.
- quality-inspection: reference to quality-inspection — Where a batch was re-examined.
- authority-notification-required: text required — yes or no.
- authority-notified-date: date
- resolution: text — explained, credited, replaced, escalated, rejected.
- credit-note: reference to credit-note
- return: reference to return
- closed-date: date
- status: text required — open, in-progress, escalated, closed.

## Identified by
id

## Displayed by
description

## Created on demand
no

## Predicates
- food safety relevant: complaint-category is "foreign-body"
- labelling relevant: complaint-category is "labelling"
- allergen relevant: complaint-category is "allergen"
- critical: severity is "critical"
- needs authority notification: authority-notification-required is "yes" and authority-notified-date not exists
- batch identified: batch exists
- open: status is "open"
- escalated: status is "escalated"
- closed: status is "closed" and resolution exists

## References
- `customer` → `customer`, `sales-order` → `sales-order`
- `article` → `article`, `batch` → `batch`
- `quality-inspection` → `quality-inspection`
- `credit-note` → `credit-note`, `return` → `return`

## Retention
Food-safety complaints are part of the HACCP record and are retained with the batch, in
practice **10 years** here. Non-food complaints have no statutory retention beyond any credit
note they caused; in the live instance they are deleted or pseudonymised once the commercial
matter is settled, because keeping consumer correspondence forever is neither necessary nor
lawful.

## Notes
### allergen relevant
An allergen complaint is the most serious thing on this list. It goes to the quality manager
and the managing director the moment it is created, and it is the one case where the
template escalates on creation rather than on triage.

### needs authority notification
Under EU 178/2002 a food business that knows its product is unsafe must inform the
authorities without delay. "Without delay" is not a service-level target, and this predicate
is the thing that keeps it from being treated as one.

### batch identified
Without a batch we cannot investigate and cannot bound a recall. So the first question
customer service asks about any food complaint is the code on the pack.

### Used by

`processes/customer-complaint.md`, `processes/quality-escalation.md`,
`processes/returns-and-credit-notes.md`, `management-system/weekly-quality-round.md`
