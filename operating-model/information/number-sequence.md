# Number sequence

A counter with a legal duty. Invoice numbers, journal entry numbers and credit note numbers must be
sequential and **gapless** — GoBD says so for Germany and the equivalent rule exists everywhere in the
EU — and completeness of the sequence is one of the first things an auditor tests, because a missing
number is either a suppressed sale or a broken system and both matter.

A sequence is a document, and the number it hands out is allocated **inside the same atomic commit as
the document that consumes it**. That is the whole design. The alternative that almost every homegrown
system reaches for — "the next number is one more than the highest invoice we can find" — breaks in two
ways that are hard to see and impossible to repair: it repeats a number after a deletion, and it hands
the same number to two people working at the same time. FD-6 forbids it. Nothing in this model derives a
number from a count of existing documents.

The `authoritative-peer` field is the multi-peer answer. When two laptops are offline and both issue an
invoice, one of them owns the sequence and the other queues; Appendix VIII's authoritative-peer rule
decides which. A sequence with no authoritative peer named is refused rather than guessed, because two
peers each handing out `R-2026-0042` is precisely the failure the gapless duty exists to prevent.

## Fields
- name: text required — Which sequence: sales-invoice, credit-note, journal-entry, payment-run.
- prefix: text required — What the number starts with, e.g. R-2026-.
- next-value: number required — The next number to hand out. Raised in the consuming commit.
- padding-width: number required — How many digits, zero-padded, e.g. 4 for 0042.
- resets-annually: boolean required — Whether the sequence restarts each fiscal year.
- fiscal-year: number required — The year this sequence is counting in.
- authoritative-peer: text required — Which peer may allocate. Appendix VIII.
- lowest-issued: number required — First number ever handed out under this prefix and year.
- highest-issued: number required — Last number handed out. The completeness test runs between the two.
- status: one of active, retired required — A retired sequence keeps its history.

## Identified by
name and fiscal-year

## Created on demand
no

## Invariants
- the sequence only moves forward: next-value > highest-issued
- the range is a real range: lowest-issued <= highest-issued
- a sequence names the peer that owns it: authoritative-peer exists

## Predicates
- active: status is "active"
- annual: resets-annually is true
- has issued something: highest-issued > 0
- owned by this peer: authoritative-peer exists

## Authorized by
- create: controller
- read: auditor or controller or tax-accountant or accountant
- update: controller
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): it governs every
operation on this entity that no process rule covers. It uses the `- <operation>: <roles>` bullet form,
which no grammar-version-1 model can contain, so nothing that existed before changes meaning.

Without it, an operation no rule covers is open to an actor with no role at all — version 1's permissive
default, and the defect Part 4's standing rule 4 was written about. `delete` is the managing director
everywhere in the ledger, and it should almost never be used: a ledger document is corrected by a new
document, never removed. `read` is wide, including the auditor, because an audit needs the whole ledger and
reading changes nothing.

### `- the sequence only moves forward: next-value > highest-issued`

The one invariant that makes reuse impossible. Any change that would set `next-value` back to or below a
number already handed out is refused, quoting this line — including a change made by an administrator,
including one made to fix an apparent mistake. If the sequence is genuinely wrong the answer is a new
sequence with a new prefix and a written explanation, which is also what a tax adviser would tell you.

### What gaplessness does and does not mean

It means no number is skipped and no number is reused. It does **not** mean every number ends up on a
valid document: an invoice that is created and then cancelled keeps its number, and the number is not
handed out again. The cancelled document stays in the repository with a status, because "number 0043 was
cancelled, here it is" is an answer and "number 0043 is missing" is not.

### The limit that remains

`next-value` is raised by the same commit that consumes it, which is atomic on one peer. Across peers the
guarantee rests on the authoritative-peer rule and on sync actually having happened — an offline peer
that is not the authority cannot issue at all, which is a real operational cost and the honest price of
the duty. The alternative, per-peer prefixes, produces per-peer sequences that are individually gapless
and jointly meaningless to an auditor asking for *the* invoice journal.

### Who owns the mechanism

The allocation itself lives in the kernel, not in this file: a sequence document is data, and the atomic
read-increment-consume is a Truth Layer property. This document declares which sequences exist, what they
look like, and which peer owns them.

## Retention

**10 years** under GoBD and § 147 AO. A retired sequence is kept forever in practice — it is the evidence
of which numbers existed at all, and the completeness test needs `lowest-issued` and `highest-issued`
years after the last invoice under that prefix.

## References

`information/invoice.md`, `information/journal-entry.md`, `information/credit-note.md`,
`processes/invoice-posting.md`
