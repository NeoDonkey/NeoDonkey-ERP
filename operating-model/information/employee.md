# Employee

A person who acts on behalf of the company. This kind of document exists so that a record can say
who did something — who received the pallet, who approved the order, who released the batch.

It is deliberately thin. The *authoritative* record of who did what is the signature on the commit,
not a field in a document. The employee record connects a signing identity to a set of roles and
holds the few employment facts processes genuinely need.

Everything else an HR function keeps about a person — address, salary, contract, absence, appraisal
— is **not here and must not be added**. That data has its own legal basis, its own access
restrictions and its own retention rules, and putting it in the same folder as the goods receipts
is how a company acquires a data protection incident. If you need HR, give it its own encrypted
visibility group and keep this document as the join.

**This operating model contains no real people.** Every `display-name` below is a role-shaped
placeholder. There are no personal names, addresses, contact details or any other personal data
anywhere in this folder, and the demo must stay that way.

## Fields
- display-name: text required — A role-shaped placeholder, e.g. "Warehouse clerk 1".
- signing-key-fingerprint: text required — The Ed25519 public key that identifies their commits.
- roles: text required — Role slugs from organisation/, comma separated.
- primary-location: reference to location required — Where they work.
- employment-status: text required — active, on-leave or left.
- authorisation-limit: money — Personal approval ceiling, where one applies.
- currency: text — EUR.
- quality-trained: boolean — HACCP training on file.
- quality-training-valid-until: date — When it expires.
- left-date: date — Set when they leave. The record itself stays.

## Identified by
signing-key-fingerprint

## Created on demand
no

## Predicates
- active: employment-status is "active"
- has signing key: signing-key-fingerprint exists
- quality trained: quality-trained is true
- left: employment-status is "left"
- has personal limit: authorisation-limit > 0

## Authorized by
- create: managing-director
- read: managing-director or controller
- update: managing-director
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
### has signing key
An employee without a signing key cannot act, because they cannot produce a signed commit. There
is no system user and no shared login in this model. That single fact is what makes the audit
trail real rather than asserted.

### quality trained
Only a quality-trained person may release a batch. The training record is a HACCP requirement and
an audit question, so it is a condition on a rule rather than a line in a handbook.

### left
A leaver's record is never deleted — ten years of commits reference it. Their key is removed from
the allowed signers, which stops them acting without erasing what they did.

## Retention

The fields here are all bookkeeping-relevant, because they explain who authorised a posting, so
they are retained **10 years** past departure under GoBD. That narrow, justifiable scope is exactly
why nothing else about a person belongs in this document.

## References

`processes/goods-receipt.md`, `processes/quality-inspection.md`,
`processes/purchase-order-approval.md`, `organisation/warehouse-clerk.md`
