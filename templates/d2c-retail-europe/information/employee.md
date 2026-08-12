# Employee

A person who acts on behalf of the company. This entity exists so that documents can say who
did something — who received the pallet, who approved the payment run, who released the batch.

It is deliberately thin. In NeoDonkey the *authoritative* record of who did what is the
signature on the commit, not a field in a document. The employee record exists to connect a
signing identity to a set of roles, and to hold the few employment facts that processes
genuinely need: which location they work at, which roles they hold, whether they are still
here.

Everything else that HR keeps about a person — address, salary, contract, absence, evaluation —
is **not in this template and should not be added to it**. That data has its own legal basis,
its own access restrictions and its own retention rules, and putting it in the same folder as
the goods receipts is how companies end up with a data protection incident. If you need HR,
give it its own encrypted visibility group (Appendix VII) and keep this entity as the join.

**This template contains no real people.** The `locations/` and `suppliers/` files use invented
company names; there are no personal names, addresses or contact details anywhere, and the demo
instance must stay that way.

## Fields
- id: text required — A short internal identifier, e.g. emp-warehouse-01.
- display-name: text required — In the live instance this is a real name; in the template it is a role-shaped placeholder such as Warehouse clerk 1.
- signing-key-fingerprint: text required — The Ed25519 public key fingerprint that identifies this person's commits. This is the field that makes the audit trail real.
- roles: text required — One or more role slugs from organisation/, comma separated.
- primary-location: reference to location required
- employment-status: text required — active, on-leave, left.
- authorisation-limit-eur: number — Personal approval ceiling, where one applies.
- quality-trained: text — yes or no. HACCP training on file.
- quality-training-valid-until: date
- left-date: date

## Identified by
signing-key-fingerprint

## Created on demand
no

## Predicates
- active: employment-status is "active"
- has signing key: signing-key-fingerprint exists
- quality trained: quality-trained is "yes"
- left: employment-status is "left"
- has personal limit: authorisation-limit-eur > 0

## References
- `primary-location` → `location`
- `roles` resolve against the files in `organisation/`

## Retention
Employment-related records are generally retained **10 years** in Germany where they are
bookkeeping-relevant (anything touching payroll), and otherwise deleted when the purpose ends.
The fields in *this* entity are all bookkeeping-relevant, because they explain who authorised
a posting, so they are retained **10 years** past departure. That is the narrow, justifiable
scope — which is exactly why nothing else about a person belongs here.

## Notes
### has signing key
An employee without a signing key cannot act, because they cannot produce a signed commit.
There is no "system user" and no shared login in this model.

### quality trained
Only a quality-trained person may release a batch. The training record is a HACCP
requirement and an audit question, so it is a condition on the release rule rather than a
line in a handbook.

### left
A leaver's record is never deleted — ten years of commits reference it. Their key is removed
from the allowed signers, which stops them acting without erasing what they did.

### Used by

`processes/goods-receipt.md`, `processes/quality-inspection.md`,
`processes/supplier-invoice-approval.md`, `processes/payment-run-release.md`,
`processes/stock-write-off-approval.md`
