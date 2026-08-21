# Decision Record: Chart of Accounts Template Onboarding and Initial Opening Balance (Eröffnungsbilanz) Engine

**Date:** 2026-08-21
**Status:** Approved
**Roadmap Reference:** `docs/ROADMAP-V1.md` Part 3 ("Wave 3 — Sellable ... template onboarding") and Part 2 Gate Condition 1 ("Debits equal credits, structurally ... period close").

---

## Question

How should NeoDonkey ERP initialize a legal entity's general ledger with a standard Chart of Accounts template (SKR03 or SKR04) upon company formation/onboarding and post initial opening balances (Eröffnungsbilanz) in strict compliance with GoBD, HGB § 240 / § 242 / § 252 Abs. 1 Nr. 1 (Bilanzidentität), and DATEV EXTF posting standards?

---

## Source

1. **GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff)**:
   - *BMF-Schreiben vom 28.11.2019 - IV A 4 - S 0316/19/10003 :001*, Rz. 37–45 ("Ordnungsmäßigkeit der Grundaufzeichnungen und Belegfunktion"), Rz. 86–89 ("Unveränderbarkeit von Buchungen und Eröffnungsbilanzwerten").
2. **Handelsgesetzbuch (HGB)**:
   - *HGB § 240 Abs. 1–2*: Duty to set up an inventory (Inventar) at business inception.
   - *HGB § 242 Abs. 1*: Obligation to set up an initial opening balance sheet (Eröffnungsbilanz).
   - *HGB § 252 Abs. 1 Nr. 1*: Principle of Balance Sheet Identity (*"Die Wertansätze in der Eröffnungsbilanz des Geschäftsjahrs müssen mit denen der Schlussbilanz des vorhergehenden Geschäftsjahrs übereinstimmen."*).
3. **DATEV Kontenrahmen SKR03 & SKR04 Specifications**:
   - *Opening Balance Sheet Account (EBK - Eröffnungsbilanzkonto)*: SKR03 `9000` / SKR04 `9000` (*Saldenvorträge Sachkonten*).
   - *AR Subledger Opening Balance Account*: SKR03 `9008` / SKR04 `9008` (*Saldenvorträge Debitoren*).
   - *AP Subledger Opening Balance Account*: SKR03 `9009` / SKR04 `9009` (*Saldenvorträge Kreditoren*).
4. **Relationship to Existing Decision Records**:
   - Annual year-end P&L closing and subsequent financial year balance carryforward (*Saldenvortrag*) routines are governed by `docs/decisions/2026-08-18-gobd-period-close-and-balance-carryforward.md`.
   - This record specifically governs **initial company setup, chart of accounts template adoption, and initial Eröffnungsbilanz creation upon onboarding**, deferring annual recurring period-close carryforwards to the 2026-08-18 record.

---

## Answer

1. **Chart of Accounts Template Structure**:
   - NeoDonkey ERP stores standard chart of accounts templates as structured JSON definitions under `operating-model/information/` (e.g., `_chart-skr03.md` and JSON definitions).
   - Each account in the template declares: `account-number`, `name`, `account-type` (`asset`, `liability`, `equity`, `revenue`, `expense`), `normal-balance` (`debit` or `credit`), `statement-section` (`balance-sheet` or `income-statement`), `vat-role`, `reconciliation-account-for` (`none`, `bank`, `customer`, `supplier`), and `manual` posting lock flags.

2. **Onboarding & Adoption Process**:
   - Company initialization adopts a chart template (`SKR03` or `SKR04`), instantiating `ledger-account` domain objects for each required account.
   - Initial company setup creates the mandatory Opening Balance Sheet Account (`9000` EBK), AR Opening Account (`9008`), and AP Opening Account (`9009`).

3. **Initial Opening Balance (Eröffnungsbilanz) Posting & Invariants**:
   - Initial opening balances upon company formation are posted via a specialized `journal-entry` document with `entry-type: "initial-opening-balance"`.
   - Active asset accounts are debited against Credit `9000` (EBK).
   - Passive equity and liability accounts are credited against Debit `9000` (EBK).
   - **Per-Entry Invariant**: Every individual opening journal entry MUST enforce `sum(Debits) == sum(Credits)` across its line items.
   - **Macro Account Invariant**: Once the initial opening balance setup process is marked complete for a new company workspace, kernel invariant checks assert that the net balance of Opening Balance Sheet Account `9000` (EBK) equals exactly `0.00 EUR`.

4. **Non-Negotiable Technical Constraints**:
   - Zero runtime dependencies (`package.json` contains no dependencies).
   - No build step (ES modules running natively in Node 22+ and modern browsers).
   - No `node:*` imports outside `runtime/git/fs-node.js` and tests.
   - Determinism: Clock and RNG injected via `clock` and `rng` abstractions (no `Date.now()` or `Math.random()`).
   - Exact monetary math: All monetary amounts represented as exact string tokens (e.g. `"10000.00 EUR"`) with internal `BigInt` minor units — strictly zero float representations.
   - No business vocabulary inside `runtime/`.

---

## What Must Land First

Filing the issue specifications defined below as open GitHub issues via `gh issue create` MUST land first (as the automated session environment lacks `GH_TOKEN` credentials to execute GitHub API issue creation directly) before implementation can be claimed via `Closes #N`.

---

## Defined Implementable Issues

### Issue 1: Parse and validate SKR03 and SKR04 JSON chart of accounts template definitions

- **Title**: `feat(onboarding): parse and validate SKR03 and SKR04 JSON chart of accounts template definitions`
- **Roadmap Line**: `docs/ROADMAP-V1.md` Part 3 ("Wave 3 — Sellable ... template onboarding")
- **Decision Record Reference**: `docs/decisions/2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`
- **Area**: `area:runtime`
- **Priority**: `p1`
- **Status**: `ready`
- **Verification**: A unit test in `test/chart-template.test.js` loads SKR03 and SKR04 template definitions, asserts that all required account fields (`account-number`, `name`, `account-type`, `normal-balance`, `statement-section`) are correctly parsed into `ledger-account` domain objects, and asserts that invalid account structures (e.g. missing `account-type` or invalid 3-digit account numbers) throw an explicit `ValidationError`.
- **Non-negotiable constraints**: Zero runtime dependencies, no build step, no disallowed `node:*` imports, no floats in monetary paths, determinism.

### Issue 2: Post initial Eröffnungsbilanz company setup journal entries with EBK 9000 zero-balance invariant check

- **Title**: `feat(onboarding): post initial Eröffnungsbilanz company setup journal entries with EBK 9000 zero-balance invariant check`
- **Roadmap Line**: `docs/ROADMAP-V1.md` Part 2 Gate Condition 1 ("Debits equal credits, structurally") & Part 3 ("Wave 3 ... template onboarding")
- **Decision Record Reference**: `docs/decisions/2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`
- **Area**: `area:runtime`
- **Priority**: `p1`
- **Status**: `ready`
- **Verification**: A unit test in `test/initial-opening-balance.test.js` creates an initial opening balance journal entry for SKR03 accounts (`1000 Kasse`, `1200 Bank`, `0800 Gezeichnetes Kapital`), asserting that balanced opening postings debiting `1000`/`1200` and crediting `0800` against EBK `9000` result in EBK `9000` balance equal to `0.00 EUR`. An unbalanced initial opening balance entry (e.g., total debits exceeding credits by 0.01 EUR) is refused with an explicit `InvariantError("Opening balance sheet account 9000 does not balance to zero")`.
- **Non-negotiable constraints**: Zero runtime dependencies, no build step, no disallowed `node:*` imports, no `Date.now()` or `Math.random()`, no business vocabulary in `runtime/`, no floats in monetary paths.
