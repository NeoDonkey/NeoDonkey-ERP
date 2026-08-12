# Journal entry

This is the file that decides whether NeoDonkey is an ERP. A journal entry — a *Buchungssatz* — is the
unit of bookkeeping: a date, a document behind it, a reason in words, and two or more postings whose
debits equal their credits. Everything else in the ledger is a view of these.

The seven statements under `## Invariants` are the whole argument. They are not validations that a
process happens to perform; they are conditions on the *document*, checked after every change, and a
commit that leaves any of them false is refused with the invariant quoted by name. That is what makes
"debits equal credits" structural rather than aspirational. In particular:

- the sum of the debit postings equals the sum of the credit postings;
- the totals written on the entry agree with the postings actually there, so the header cannot lie;
- there are at least two postings, because a one-sided entry is not double-entry;
- the period is not locked, so a closed month cannot be reopened by the back door;
- the entry is in the ledger currency, so a foreign amount has been translated at a declared rate
  rather than silently mixed (FD-1);
- one source document produces at most one entry, so nothing is posted twice.

An entry is never edited after posting. There is no `corrected-by` field on this document, and that
absence is deliberate: writing a back-reference onto the original would be a change to the original.
The link runs one way, from the correction to the thing corrected, which is why `corrects` lives here
and its inverse is found by looking, not by mutation. `processes/journal-correction.md` is where that
happens, and a *Storno* is a full entry with its own number, its own signature and its own date.

## Fields
- entry-number: text required — Gapless sequential number from the journal sequence. FD-6, never a count.
- entry-date: date required — Buchungsdatum: the day the entry is made.
- document-date: date required — Belegdatum: the date on the document behind it.
- accounting-period: reference to accounting-period required — Which month it lands in.
- chart: reference to chart-of-accounts required — Which chart its account numbers belong to.
- currency: text required — The ledger currency. Postings are expressed in it, always.
- debit-amount: money required — Total of the debit postings. Header total, checked against the postings.
- credit-amount: money required — Total of the credit postings.
- posting-count: number required — How many postings the entry has.
- description: text required — Buchungstext. A human sentence, not a code.
- source-document-type: one of sales-invoice, credit-note, supplier-invoice, incoming-payment, outgoing-payment, goods-receipt, stock-adjustment, vat-return, opening-balance, correction, manual required — What kind of document is behind it.
- source-document-reference: text required — The document number, as printed on the document.
- vat-treatment: reference to vat-treatment — The tax situation. Carries the account determination.
- invoice: reference to invoice — The sales invoice, where there is one.
- supplier-invoice: reference to supplier-invoice — The purchase invoice, where there is one.
- payment: reference to payment — The payment, where there is one.
- goods-receipt: reference to goods-receipt — The receipt, where there is one.
- stock-adjustment: reference to stock-adjustment — The adjustment, where there is one.
- vat-return: reference to vat-return — The return, where there is one.
- corrects: reference to journal-entry — Set on a correcting entry. Never set on the original.
- correction-reason: text — Why the correction was made. Required on a correction.
- reversal: boolean required — True for a full Storno of the entry it corrects.
- status: one of draft, posted, cancelled required — A cancelled entry was never posted.
- entered-by: reference to employee required — Who captured it.
- posted-by: reference to employee required — Who committed it. The signature is on the commit.
- posted-at: date required — When.
- exchange-rate: reference to exchange-rate — The rate used, where the source document is foreign.
- datev-export-reference: text — Set once the entry has left in a DATEV export.

## Identified by
entry-number

## Created on demand
no

## Invariants
- debits equal credits: sum of amount over posting for this journal-entry where side is "debit" = sum of amount over posting for this journal-entry where side is "credit"
- the debit total agrees with the postings: debit-amount = sum of amount over posting for this journal-entry where side is "debit"
- the credit total agrees with the postings: credit-amount = sum of amount over posting for this journal-entry where side is "credit"
- an entry has at least two postings: posting-count >= 2
- the posting count agrees with the postings: posting-count = count of posting for this journal-entry
- the period is not locked: accounting-period not locked
- the entry is in the ledger currency: currency is chart.ledger-currency

## Dated in
- entry-date in accounting-period

## Predicates
- posted: status is "posted"
- draft: status is "draft"
- cancelled: status is "cancelled"
- balanced: debit-amount = credit-amount
- a correction: corrects exists
- a correction explained: correction-reason exists
- a reversal: reversal is true
- from a sales invoice: source-document-type is "sales-invoice"
- from a supplier invoice: source-document-type is "supplier-invoice"
- from an incoming payment: source-document-type is "incoming-payment"
- from an outgoing payment: source-document-type is "outgoing-payment"
- from a goods receipt: source-document-type is "goods-receipt"
- from a stock adjustment: source-document-type is "stock-adjustment"
- an opening balance: source-document-type is "opening-balance"
- foreign currency involved: exchange-rate exists
- exported to datev: datev-export-reference exists
- in an open period: accounting-period accepts postings
- numbered: entry-number exists

## Authorized by
- create: accountant or tax-accountant
- read: auditor or controller or tax-accountant or accountant or treasurer
- update: tax-accountant
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): it governs every
operation on this entity that no process rule covers, using the `- <operation>: <roles>` bullet form that no
grammar-version-1 model can contain. Without it, an uncovered operation is open to an actor with no role at
all — version 1's permissive default, and the defect Part 4's standing rule 4 was written about.
### Read the invariants first, then the rest of the ledger

```
- debits equal credits: sum of amount over posting for this journal-entry where side is "debit"
                      = sum of amount over posting for this journal-entry where side is "credit"
```

**One sentence, and it is the whole of double-entry bookkeeping.** Two aggregations over the entry's own
postings, compared for equality. `for this journal-entry` is the link: it restricts each sum to postings whose
`journal-entry` reference points at the entry being checked, resolved at parse time from the declaration
rather than searched for (grammar §13.2). And that reference is not something a rule has to remember to set —
grammar §21.3 makes a labelled `Create posting` fill it from the declarations, precisely so that a forgotten
link cannot make the aggregate sum over nothing and let an unbalanced entry through.

When it does not hold the commit does not happen, and the refusal quotes that line, this file, the entry and
both totals of the finished set — once, not once per leg, because §21.5 stages every leg before any invariant
runs.

The two invariants after it are **not** redundant, and they earn their place for a different reason. They pin
the *header* totals to the postings:

```
- the debit total agrees with the postings:  debit-amount  = sum of amount over posting for this journal-entry where side is "debit"
- the credit total agrees with the postings: credit-amount = sum of amount over posting for this journal-entry where side is "credit"
```

A posting set can balance perfectly while the header says something else, and the header is what a journal
printout shows, what the DATEV export carries, and what a person reads in `git show` eight years from now.
Without these two, that number could quietly be wrong while the ledger itself was right — which is the worst
of the three possible states, because it is the one nobody checks. With them, the redundancy is a *checked*
cache rather than a second version of the truth.

### When an invariant is checked, and why that matters to the period lock

Grammar §12.1: **per commit, over what the commit touches or implicates.** A document nobody touched is
not re-validated. That is not a performance concession, it is what makes the lock work at all: the
invariant `the period is not locked` means *this entry may not be written while its period is locked*, and
if invariants were swept over the whole repository on every commit, locking July would invalidate every
entry inside it and the close would be impossible.

The consequence in the other direction is §20.3 and it is worth knowing: an invariant added **after** data
exists does not refuse the data that already violates it. Finding those needs an offline sweep over the
read path, which is a query and a legitimate one, and it is not built.

### One source document, one entry

```
- an invoice is posted once: count of journal-entry for this invoice <= 1
```

That invariant is **not** in the list above, and it should be. `for this invoice` requires the context
entity of the condition to *be* `invoice` (§13.2), so the sentence can only be written on the invoice, not
here — and `information/invoice.md` is not this ledger's file to fill with entries it knows nothing about.
What it does carry is the predicate `posted to the ledger`, which reads the same aggregate, so a posting
rule can require that an invoice not already be posted. That is enforcement at the point of posting rather
than a property of the entry.

The gap that remains is a supplier invoice posted twice by two different commits that both passed that
condition against a stale read. It is listed in the report accompanying this work, because double posting
of a supplier invoice is one of the two or three errors an auditor actively hunts for.

### draft, posted, cancelled

`draft` exists for an entry a person is still assembling in a UI. It is not a way around the invariants:
they hold for a draft too, so a half-built entry is not storable — which is correct, because a
half-built entry in a repository is a half-built entry in the books. Assembly happens in the Live Layer
(manifesto layer 1), and the commit is the moment the entry becomes real. `cancelled` marks an entry
that was created and then abandoned before posting; its postings are still there, still balanced, and
the trial balance excludes it by status.

### posted-by is not the signature

The field records who the entry says posted it. The *evidence* is the Ed25519 signature on the Git
commit, which is not forgeable by editing a field. Where the two disagree, the commit wins, and an
auditor should be shown the commit. This distinction is the reason `## Authorized by` is a rule
constraint and not a workflow step.

## Retention

**10 years** under GoBD and § 147 AO, from the end of the calendar year of the entry date. Under
Principle 4 the entry, its postings and the signed commit that created them *are* the archive. There is
no separate journal file to print and store, and no export step that could go missing: `git log` over
`documents/journal-entry/` is the *Journalfunktion* the GoBD asks for.

## References

`information/posting.md`, `information/accounting-period.md`, `information/ledger-account.md`,
`information/number-sequence.md`, `processes/invoice-posting.md`,
`processes/supplier-invoice-posting.md`, `processes/journal-correction.md`,
`processes/period-close.md`, `processes/trial-balance.md`
