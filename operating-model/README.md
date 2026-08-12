# operating-model — the company as text

This folder *is* the running system. Not a description of it, not a specification for it — the thing the
runtime executes. When somebody changes a word here, the system behaves differently from the next
transaction onward. There is no build, no deployment, no ticket.

It describes a European better-for-you food company: German warehouse, Dutch fulfilment partner,
consumers in DACH plus France, Italy and the Netherlands, grocery retailers on pallets. Roughly sixty
percent of revenue from the webshop, forty from retail. It is seeded from `templates/d2c-retail-europe/`
and trimmed to what this instance genuinely runs.

## What is here

Six folders, one per POLISM category — the Operating Model Canvas vocabulary that operations people have
used for years, and which will still make sense in 2045 because it hangs on the nature of companies
rather than on a technology era.

| Folder | Files | What it holds |
|---|---|---|
| `information/` | 36 entities + 4 seed tables | The nouns. Fields, types, **invariants**, and the named predicates the rules refer to. |
| `processes/` | 27 | What the company does. 43 rules. |
| `organisation/` | 13 | Who may do what. |
| `locations/` | 4 | Where it happens, including the webshop. |
| `suppliers/` | 2 | Outside partners. Invented names only. |
| `management-system/` | 3 | The steering rhythms. |

**Start with `processes/goods-receipt.md`.** It is the reference process, implemented end to end, and it
is Appendix XII's own example with the batch-number extension applied. Read it, then read
`information/order.md` to see where the phrase "fully delivered" gets its meaning, and you have
understood the whole architecture.

**Then read `information/journal-entry.md`.** It is the file that decides whether this is an ERP. Seven
`## Invariants` — the sum of the debit postings equals the sum of the credit postings, the header totals
agree with the postings that exist, there are at least two of them, the period is not locked — and a commit
that leaves any of them false is refused, quoting the invariant by name. That is double-entry bookkeeping as
four sentences of text rather than as a finance module. `processes/invoice-posting.md` is the same story in
the language a *Bilanzbuchhalter* speaks.

## The one thing to understand

Business semantics live in `information/`, never in the runtime.

When a rule says `order not already fully delivered`, the parser has no idea what delivery is and must
never guess. It looks the phrase up under `## Predicates` in `information/order.md`, where it finds:

```
- fully delivered: delivered-quantity >= ordered-quantity
```

One line. Change it and every rule that mentions the phrase follows. That is why a supply chain manager
can change how this company works on a Tuesday afternoon, and it is the difference between this and an
ERP where the same change is a six-month project.

If business meaning ever migrates from these files into the parser, the architecture has collapsed back
into the thing we left.

## How a file is shaped

Prose at the top, for people. Structured sections below, for the runtime. `runtime/polism/grammar.md` is
the normative specification; the short version:

- **Entities** (`information/*.md`) — `## Fields`, `## Predicates`, `## Identified by`,
  `## Created on demand`. Types are `text`, `number`, `money`, `date`, `boolean`, or
  `reference to <entity>`.
- **Processes** (`processes/*.md`) — `## Triggered by` (prose, for humans), `## Rules`,
  `## Authorized by`.
- **Roles** — declared by filename under `organisation/`. Nothing else is required.
- Anything else goes in `## Notes`, `## References`, `## Retention`, `## Cadence`, `## Measures`,
  `## Owner`, `## Purpose`, `## Context` — or under a `###` subheading. An unrecognised `##` heading is
  a **hard error**, deliberately: the parser cannot tell a section of obligations somebody expects to be
  enforced from a section of remarks, and guessing is the one thing Principle 6 forbids.

## The general ledger

Double-entry lives here as text, like everything else (FD-4). The four files to read, in order:

| File | What it settles |
|---|---|
| `information/chart-of-accounts.md` | SKR03, SKR04 or a minimal international chart, one active. Ledger currency, declared rounding, and the eleven well-known accounts the posting scheme reaches for. |
| `information/journal-entry.md` | The seven invariants. Debits equal credits, structurally. |
| `information/posting.md` | One line: account, side, positive amount, date, period, and the foreign-currency triple that keeps FD-1's promise. |
| `processes/journal-posting.md` | Every case that becomes a *Buchungssatz*, with a T-account for each — and an honest section on the one construction the grammar refuses. |

The accounts themselves are seed tables a bookkeeper can check against DATEV:
`information/_chart-skr03.md` (34 accounts), `_chart-skr04.md` (the same 34, renumbered),
`_chart-international.md` (13), and `_statement-positions.md` (17 § 266 / § 275 HGB positions).
Underscore-prefixed files are documentation to the runtime — POLISM has six categories for a company and
none of them is "reference tables", which is a compromise and is named as one.

| Concern | Where |
|---|---|
| Sales invoice → revenue, VAT payable, receivable | `processes/invoice-posting.md` |
| Supplier invoice, domestic and EU reverse charge | `processes/supplier-invoice-posting.md` |
| Payment runs with a threshold per authority level | `processes/payment-run.md` |
| Bank statements and reconciliation | `processes/bank-reconciliation.md` |
| *Umsatzsteuervoranmeldung* by Kennzahl | `information/vat-return.md`, `processes/vat-return.md` |
| One-Stop-Shop, and why it is not German VAT | `information/oss-return.md`, `processes/oss-return.md` |
| Period close, and why a correction is a new entry | `processes/period-close.md`, `processes/journal-correction.md` |
| Trial balance, balance sheet, profit and loss | `processes/trial-balance.md`, `processes/financial-statements.md` |
| Foreign currency, with the rate as a document | `processes/foreign-currency-settlement.md`, `information/exchange-rate.md` |
| Gapless document numbers (FD-6) | `information/number-sequence.md` |

## European reality, where it lives

| Concern | Where |
|---|---|
| VAT situations: domestic, EU reverse charge, OSS distance sales, local registration, export, import | `information/vat-treatment.md` |
| The EU-wide 10,000 EUR OSS threshold | `information/vat-treatment.md`, predicate `oss threshold exceeded` |
| §14 UStG mandatory invoice elements | `information/invoice.md`, predicate `complete for german vat law` |
| EN 16931 / XRechnung, including the Leitweg-ID (BT-10) | `information/invoice.md`, BT-* references on the fields |
| *Gelangensbestätigung* for zero-rated intra-community supplies | `information/invoice.md`, predicate `transport proven` |
| GoBD 10-year retention | `## Retention` on every entity it binds |
| Best-before date (MHD), batch number, HACCP, allergens | `information/article.md`, `information/batch.md`, `information/quality-inspection.md` |
| Weight-based pricing | `information/sales-order-line.md` |
| Consumer withdrawal rights | `locations/webshop.md`, `processes/returns-and-credit-notes.md` |
| Stock abroad turning a logistics choice into a tax obligation | `locations/venlo-fulfilment-nl.md` |

## What this operating model does not do

Written down here rather than left to be discovered. Grammar version 2 closed three of the five limits
this section used to list — branching, threshold authorisation and aggregation — and what remains is
narrower and more specific.

1. **Two kinds of journal entry cannot be posted: an opening balance and a free-form manual
   reclassification.** Every other case is an arm of the rule in `processes/journal-posting.md`, which
   creates each leg and fills it from the chart and the tax treatment. Those two need accounts the
   accountant chooses at the keyboard, which is not an arm of anything, so they wait on a bundled intent from
   the Live Layer. An entry that matches no arm gets no postings and is refused by its own invariants, which
   is the right failure — but it does mean the first entry of a new company cannot be made yet.
2. **The VAT return, the OSS return and the trial balance are captured, not derived.** An aggregate links
   to the document it is written on only through `for this <entity>`, whose context entity must *be* that
   entity (§13.2), and a `where` takes exactly one condition (§13.1). A period-scoped, account-scoped,
   side-scoped sum needs more than that. The figures are recomputed and asserted in
   `test/f2-ledger.test.js`; nothing in the model refuses a wrong one.
3. **No arithmetic in conditions.** So line 83 of the VAT return (`81 + 86 + 89 + 84 − 61 − 66 − 67`) and
   the bank reconciliation's `opening + credits − debits = closing` are checks a person performs and
   records. Each place this happens says so.
4. **No four-eyes.** `## Authorized by a and b` is still refused, and it should be: genuine four-eyes is
   two signers on one commit, a Truth Layer property (manifesto line 114). `approval-count >= 2` is a
   counter, not two signatures, and every file that uses it says so. Threshold *authority* is now real —
   `processes/payment-run.md` and `processes/stock-write-off-approval.md` carry a different role per arm
   (§16) — but the distinctness of two signers is not.
5. **Fourteen closed vocabularies are declared, and the rest are not yet.** `status` on every entity that
   has one — plus `customer.credit-status` — is now `one of …`, so `Update order-line with status "delivrd"`
   is refused at parse time rather than stored. Still `text`, and still able to take a typo:
   `adjustment-type` and `disposal-method` on a stock adjustment, `quality-status` and `shelf-life-status`
   on a batch and a goods receipt, `supplier-type`, `incoterms`, `payment-means-code`, and the country
   codes. Each is a closed set in practice; converting the pairs that are shared between two entities needs
   both declarations changed in the same commit, which is the only reason they are not done.
6. **No `today`, no scheduled rules, no conditional invariants.** A rule reading the clock would not be
   reproducible. `management-system/` rhythms are held by people with a calendar. And an invariant is a
   conjunction with no implication in it, so "if a posting carries a foreign amount then it must name its
   rate" is enforced by a rule at the point of creation rather than as a property of the document —
   `information/posting.md` says exactly that, in the place where it costs something.
7. **No payroll, no fixed assets, no accruals, no provisions, no year-end close.** The charts and the
   statement positions cover a merchandise trader's flows and nothing else, and
   `information/_chart-skr03.md` lists what is absent rather than leaving it to be found.

## No personal data

There is none in this folder and there must never be any. Company names are invented placeholders
(`Nussimport Müller GmbH`); `display-name` on an employee is a role-shaped placeholder
(`Warehouse clerk 1`); there are no real names, addresses, contact details or customer records anywhere.
A demo instance gets copied, shared and published, and a lawful basis does not travel with a copy.

`information/employee.md` says why HR data belongs in its own encrypted visibility group and not here.
