# Decision Record: Multi-Entity Financial Consolidation and Intercompany Balancing

**Date:** 2026-08-20

## Question
How should NeoDonkey aggregate financial data across independent legal entities (separate git repositories per FD-3) into a consolidated balance sheet and income statement, and how are intercompany balances and transactions eliminated in compliance with commercial accounting principles (HGB § 290 / § 301 / § 303 / § 305 and IFRS 10)?

## Answer

1. **Repository Topology & Discovery (FD-3 `repos.json` Manifest):**
   - Each legal entity runs its own isolated git repository with a unique `<repo-id>`.
   - Cross-repository references follow the canonical form `<repo-id>:<entity>/<id>`, resolved via a top-level `repos.json` manifest.
   - The `repos.json` manifest MUST specify a `"self"` field naming the current entity's `<repo-id>` and an explicit list of authorized public signing keys (`"keys": ["<pubkey-1>", ...]`) for sibling entities. Sibling records with empty or missing key arrays MUST be refused.

2. **Consolidation Pipeline (Consolidation Ledger Repository):**
   - Consolidation is performed by a dedicated consolidation repository or process that reads signed ledger commits from sibling repositories.
   - **Step 1: Foreign Currency Translation (if required):** Converts trial balances into reporting currency using historical rates for equity and spot/period-average rates for assets, liabilities, P&L (per HGB § 308a).
   - **Step 2: Line-by-Line Aggregation (Summenbilanz):** Aggregates general ledger trial balances from all participating entities account-by-account.
   - **Step 3: Intercompany Debt & Receivables Elimination (Schuldenkonsolidierung - HGB § 303):** Matches cross-referenced AR/AP postings (`<repo-id-A>:invoice/...` vs `<repo-id-B>:purchase-invoice/...`). Offsets intercompany receivables against intercompany payables. Any residual currency or timing discrepancy MUST be posted to a designated consolidation variance account.
   - **Step 4: Intercompany Revenue & Expense Elimination (Aufwands- und Ertragskonsolidierung - HGB § 305):** Offsets intercompany sales revenue against intercompany cost of sales / expenses.
   - **Step 5: Investment / Capital Elimination (Kapitalkonsolidierung - HGB § 301):** Offsets the parent entity's investment carrying amount against the subsidiary's equity.

3. **Immutability & Traceability:**
   - Consolidation generates signed consolidation journal entries in the consolidation repository. No postings are mutated or written back into individual subsidiary repositories.
   - Each consolidation entry cites the source commits and document IDs of the aggregated subsidiary records.

## Source
- **Primary Source (German Commercial Code / HGB):** Handelsgesetzbuch (HGB) § 290 (Pflicht zur Aufstellung), § 301 (Kapitalkonsolidierung), § 303 (Schuldenkonsolidierung), § 305 (Aufwands- und Ertragskonsolidierung), § 308a (Währungsumrechnung).
- **Primary Source (International Financial Reporting Standards / IFRS):** IFRS 10 Consolidated Financial Statements (Appendix B, B86 Consolidation procedures).
- **Primary Source (NeoDonkey Roadmap):** `docs/ROADMAP-V1.md` Part 1 (FD-3: One repo per legal entity, joined by signed cross-references) and Part 3 (Wave 3: Consolidation across entities).

## Verification Method
- **Unit Test Verification:** `test/multi-entity-consolidation.test.js` sets up two mock subsidiary repositories with valid `repos.json` manifests, generates intercompany sales/purchase entries, executes the consolidation pipeline, and asserts:
  1. `repos.json` manifests without `self` or with missing `keys` arrays are rejected.
  2. Line-by-line Summenbilanz sums account balances accurately across subsidiaries.
  3. Intercompany debt (receivables/payables) and revenue/expenses cancel out exactly, leaving 0.00 EUR net impact on consolidated equity.
  4. Non-matching intercompany items raise explicit consolidation variance entries rather than silently unbalancing the consolidated ledger.

## What Must Land First

Filing the issue specifications below as open GitHub issues (e.g., by a maintainer or a session with GitHub issue creation privileges) MUST land first before implementation can be claimed. An engineering session requires an open GitHub issue number `#N` to claim implementation via `Closes #N` in a draft pull request per AGENTS.md §5. The specifications below define the exact scope, primary sources, constraints, labels, and verification methods for those issues.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(consolidation): implement multi-repository manifest validation and line-by-line summenbilanz aggregation`
- **Title:** Implement multi-repository manifest validation and line-by-line Summenbilanz aggregation
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 1 (FD-3) and Part 3 (Wave 3: Consolidation across entities)
- **Primary Source Citation:** HGB § 290, § 300 Abs. 2 & NeoDonkey FD-3
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/consolidation-summenbilanz.test.js` loads trial balances from two distinct repository manifests (`repo-a` and `repo-b`) and asserts:
  1. Manifests missing `self` or valid `keys` arrays are refused with `invalid-repo-manifest`.
  2. Account balances across both entities are aggregated line-by-line into a unified consolidated trial balance.
  3. Monetary values remain exact string tokens with `BigInt` minor units without floating-point conversion.

### Issue 2: `feat(consolidation): implement intercompany receivables/payables and revenue/expense elimination`
- **Title:** Implement intercompany receivables/payables and revenue/expense consolidation elimination
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 1 (FD-3) and Part 3 (Wave 3: Consolidation across entities)
- **Primary Source Citation:** HGB § 303 (Schuldenkonsolidierung) & HGB § 305 (Aufwands- und Ertragskonsolidierung)
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/consolidation-elimination.test.js` processes intercompany transactions between `repo-a` and `repo-b` and asserts:
  1. Intercompany AR (`1400`) in `repo-a` matching AP (`1600`) in `repo-b` are eliminated in the consolidated balance sheet.
  2. Intercompany Revenue (`8400`) in `repo-a` matching Expense (`3400`) in `repo-b` are eliminated in the consolidated income statement.
  3. Unmatched timing/currency differences are posted to a consolidation variance account and flagged in the audit output.
