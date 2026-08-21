# Journal: Opening Balances — chart templates and the Eröffnungsbilanz engine

**Date:** 2026-08-21

## Summary

Implemented issues #121 and #122, the Wave 5 blocker behind README open item 3 ("a first entry
cannot be posted"): chart-of-accounts template onboarding and the initial Eröffnungsbilanz
(opening balance) engine, per the binding decision record
`docs/decisions/2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`
(GoBD Rz. 86–89; HGB § 240, § 242, § 252 Abs. 1 Nr. 1).

## What landed

- **`operating-model/information/_chart-skr03.json` / `_chart-skr04.json`** — the two chart
  templates as data, next to the existing `_chart-*.md` seed tables (the underscore convention
  already means "reference data the model loaders skip"). Each is a deliberately minimal-but-real
  subset — 16 accounts covering the classes an opening balance and the first postings touch
  (equity, financial assets/liabilities, inventory, purchases, operating expenses, revenue, and
  class 9) — and each declares its three mandatory opening-balance accounts by role: EBK 9000
  (Saldenvorträge Sachkonten), 9008 (Debitoren), 9009 (Kreditoren), identical numbers in both
  standards per the record. Completeness can grow row by row; correctness cannot, so every row is
  validated.
- **`runtime/onboarding/chart-of-accounts.js`** — `parseChartTemplate` validates a template:
  mandatory fields per the record (`account-number`, `name`, `account-type`, `normal-balance`,
  `statement-section`, `vat-role`, `reconciliation-account-for`, `manual`), four-digit account
  numbers as text (800 is not 0800, and a JSON number is refused), duplicate rejection, exactly
  one opening-balance account per role, and control totals that must agree with the rows so a
  truncated file cannot pass silently. `instantiateLedgerAccounts` turns rows into
  `ledger-account` documents shaped exactly as `information/ledger-account.md` declares them.
- **`runtime/onboarding/opening-balance.js`** — `postOpeningBalance` builds the opening
  `journal-entry` (`source-document-type: opening-balance`, `entry-type:
  initial-opening-balance`) plus its postings, shaped exactly as the model declares them, in
  exact BigInt money. Assets debit / liabilities and equity credit, each mirrored into the EBK.
  The invariants are enforced where the entry is built, not checked afterwards: debits equal
  credits per entry, and each opening-balance account — 9000, 9008, 9009 — must net to exactly
  `0n`, with the refusal the record names: `InvariantError("Opening balance sheet account 9000
  does not balance to zero")`.

## Decisions worth recording

**The EBK-zero invariant is the balance-sheet equation.** Because every opening leg is mirrored
into 9000, the per-entry debits=equality holds structurally; what the macro invariant actually
proves is that the opening balance sheet itself balances — assets equal equity plus liabilities.
A company that is one cent short is refused, not booked. That is the reading of the record's
§Answer 3 that makes both invariants mean something.

**Control accounts open as open items, not as figures.** A receivables or payables control
account (reconciliation-account-for `customer`/`supplier`) is the sum of the open items behind
it, so its opening takes `items`, each naming its customer or supplier: each item posts the
control account against the subledger opening account (9008/9009), and the item total is then
transferred from the subledger opening account into 9000. All three opening-balance accounts net
to zero, and 9000 carries exactly the balance sheet. A control-account opening given as a bare
figure — a number with no customers behind it — is refused.

**Double onboarding is refused, not made idempotent.** The record leaves the choice open; GoBD
Rz. 86–89 (Unveränderbarkeit) decides it. An initial opening balance, once posted, is
unchangeable like any other booking, so re-running onboarding on an onboarded chart throws
`InvariantError`; a wrong opening value is corrected by a new entry under
`processes/journal-correction.md`, never by re-posting.

**Bilanzidentität is opt-in by fact, not by flag.** Where a prior closing balance is supplied,
every opening must equal it per account (HGB § 252 Abs. 1 Nr. 1), in both directions — a closing
account without an opening and an opening without a closing are both refused. Where none is
supplied (founding, HGB § 242), the Eröffnungsbilanz is the first.

**Vocabulary mapping is made once, in the open.** The record's template vocabulary says
`income-statement`, `customer`, `supplier`; the operating model's enumerations say
`profit-and-loss`, `receivables`, `payables`. `instantiateLedgerAccounts` maps them explicitly.
The account numbers themselves are data and appear nowhere in `runtime/`.

**No clock, no RNG.** Every date, actor and entry number is a parameter; the engine is a pure
function, which is what makes the determinism test byte-for-byte.

## Verification

- `test/onboarding-coa.test.js` (15 tests): both shipped templates parse; mandatory fields,
  duplicates, three-digit numbers, unbalanced control totals, missing opening-balance roles and
  invalid JSON are all rejected with named `ValidationError`s; instantiation produces
  model-conformant ledger accounts, deterministically.
- `test/onboarding-opening-balance.test.js` (13 tests): the worked mini-company (Kasse, Bank,
  Warenbestand, Darlehen, Gezeichnetes Kapital) nets EBK 9000 to BigInt `0n`; the AR/AP open-item
  mechanics net 9008/9009 to zero; the one-cent-short balance sheet is refused with the record's
  exact message; Bilanzidentität, double-onboarding refusal, income-statement and EBK posting
  refusals, float/foreign-currency/negative-amount refusals.
- The opening documents are also committed through the **real ledger path**: parsed
  `operating-model/` + `runtime/polism/execute.js`, postings then entry, accepted with the
  declared invariants of `information/journal-entry.md` and `information/posting.md` checking
  the staged world — debits equal credits is enforced by the model, not asserted from this
  report.
- Both new test files fail without `runtime/onboarding/` (module resolution), and the full suite
  is green.

## What this does not do

The charts are subsets, deliberately — payroll, fixed assets, accruals, provisions and the long
tail of DATEV accounts grow in as rows. Nothing here writes to a repository yet: the engine
returns documents; committing them as the signed first commit of a workspace is kernel/UI work
that builds on this. And the README's open item 3 is updated at merge time, not here.
