# Payment run

A batch of outgoing payments, prepared by one person and released by another. This is the most dangerous
document in the company: at the moment it is released, money leaves, and no rule downstream can call it
back. Everything about its shape follows from that.

The control is **two signatures on one payload**. Not two clicks by one person, not a counter incremented
twice, not a role check that a single actor happens to satisfy — two different keys signing the same
commit, over the same list of payments, for the same total. That is what manifesto line 114 means by
four-eyes and it is a Truth Layer property, which is why this document carries the *evidence* fields
(`prepared-by`, `released-by`, `payload-hash`, `signature-count`) while the enforcement lives in the commit
and in `processes/payment-run.md`.

`payload-hash` is the detail that makes the control real rather than decorative. Two people can sign a
payment run and still be defrauded if a payment can be added between the first signature and the second.
So the hash covers the payment list and the total, both signatures are over that hash, and a run whose
contents changed after the first signature has a different hash and needs both signatures again. Without
that, four-eyes is theatre.

## Fields
- run-reference: text required — Gapless sequential reference from the payment-run sequence.
- run-date: date required — The day the run was prepared.
- execution-date: date required — The day the bank is asked to move the money.
- bank-account-number: text required — Our own account it goes out of, as an internal account number.
- currency: text required — All payments in one run share a currency.
- payment-count: number required — How many payments are in the run.
- total-amount: money required — Sum of the payments. Checked against them by invariant.
- payload-hash: text required — Hash over the payment list and the total. What the signatures cover.
- prepared-by: reference to employee required — Who assembled it.
- prepared-at: date required — When.
- released-by: reference to employee — Who released it. Must not be the preparer.
- released-at: date — When.
- signature-count: number required — How many distinct keys have signed this payload. Starts at zero.
- highest-single-payment: money required — The largest payment in the run. Drives the authority threshold.
- status: one of draft, awaiting-release, released, executed, cancelled required — Where it stands.
- cancellation-reason: text — Why, where cancelled.
- accounting-period: reference to accounting-period required — Which month the payments are booked into.

## Identified by
run-reference

## Created on demand
no

## Invariants
- a run pays something: payment-count >= 1
- the total agrees with the payments: total-amount = sum of ledger-amount over payment for this payment-run
- the payment count agrees with the payments: payment-count = count of payment for this payment-run
- the total is positive: total-amount > "0.00 EUR"
- the period is not locked: accounting-period not locked
- the payload is hashed: payload-hash exists

## Predicates
- draft: status is "draft"
- awaiting release: status is "awaiting-release"
- released: status is "released"
- executed: status is "executed"
- cancelled: status is "cancelled"
- prepared: prepared-by exists
- release named: released-by exists
- two signatures present: signature-count >= 2
- one signature only: signature-count is 1
- unsigned: signature-count is 0
- large: highest-single-payment > "10000.00 EUR"
- very large: highest-single-payment > "50000.00 EUR"
- payload hashed: payload-hash exists
- cancellation explained: cancellation-reason exists

## Authorized by
- create: treasurer
- read: auditor or controller or managing-director or treasurer
- update: treasurer or controller or managing-director
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): it governs every
operation on this entity that no process rule covers, using the `- <operation>: <roles>` bullet form that no
grammar-version-1 model can contain. Without it, an uncovered operation is open to an actor with no role at
all — version 1's permissive default, and the defect Part 4's standing rule 4 was written about.
### The invariant that is missing: four-eyes

There is no invariant above about signatures, and that absence is the most important thing on this page.
Read the next three paragraphs before believing anything about four-eyes in this model.

The invariant that belongs here is conditional — **if** `status is "released"` **then**
`signature-count >= 2` **and** `released-by is not prepared-by`. Neither half can be written today. The
implication needs `when … then …` inside `## Invariants`, and the second half needs to compare two
reference fields for *difference*, which the condition grammar can express (`released-by is not
prepared-by`) but which is only meaningful in combination with the first half — unconditionally requiring
two signatures would refuse the draft run that has none yet, and unconditionally requiring the two people
to differ would refuse a draft where neither is set.

So the enforcement lives in `processes/payment-run.md` as a rule on the release act, with two roles named
in a per-rule `## Authorized by`, and its final guarantee depends on the two-signature commit that agent S
is building. Written down plainly: **as of this model, four-eyes on a payment run is enforced by a rule at
the moment of release and by role separation, and the distinctness of the two signing keys is a Truth Layer
property that is not yet in place.** That is a gate-item-3 dependency, not a compromise this file can talk
its way out of.

### `highest-single-payment`, and why the threshold is on the largest payment

Not on the total. A run of two hundred payments totalling 40,000 EUR is routine; one payment of 40,000 EUR
is not, and the person releasing it should be a different person. Splitting an unusual payment across a
routine-looking run is the oldest trick there is, and putting the threshold on the total is what makes it
work. `large` and `very large` are the two thresholds this company uses, and both are money literals in the
FD-1 canonical form, so the comparison is exact and refuses a run denominated in a different currency
rather than converting it.

### One currency per run

`currency` is on the run, not only on the payments, and the invariant sums `ledger-amount`. A run mixing
currencies would need a rate to total itself, which FD-1 forbids doing silently. Two currencies, two runs.

### What is not here

No SEPA pain.001 file, no bank connectivity, no positive-pay confirmation, no payment recall. The run
records the decision; transmitting it is an outbound dialect (wave 3). Also absent: a supplier bank-detail
change workflow, which is the control that actually stops invoice-redirection fraud and which belongs on
the supplier master record rather than here.

## Retention

**10 years** under GoBD and § 147 AO. The run, its payload hash and the signed commit that released it are
the evidence that two people authorised the money leaving. Never deleted.

## References

`information/payment.md`, `information/supplier-invoice.md`, `processes/payment-run.md`,
`organisation/treasurer.md`, `organisation/managing-director.md`
