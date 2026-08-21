# Decision Record: Fixed Asset Management (Anlagenbuchhaltung) and Depreciation (AfA) Accounting

**Date:** 2026-08-21

## Question
How should NeoDonkey model fixed asset accounting (Anlagenbuchhaltung), Low-Value Asset (Geringwertige Wirtschaftsgüter - GWG) capitalization thresholds, straight-line depreciation (Lineare Absetzung für Abnutzung - AfA) with monthly pro-rata temporis allocation, and asset disposal (Anlagenabgang) under German commercial law (HGB § 253), income tax law (EStG § 6 & § 7), and GoBD principles?

## Answer

1. **Capitalization and Low-Value Asset (GWG) Thresholds (EStG § 6 Abs. 2 & Abs. 2a):**
   - **Direct Expense (< €250.00 net):** Assets with acquisition cost up to €250.00 net (excluding VAT) MUST be expensed directly in the acquisition period to operating expense (e.g. SKR03 `4800` / SKR04 `6800`). No fixed asset master record required.
   - **Low-Value Asset / Immediate Write-off (€250.01 – €800.00 net):** Independently usable movable fixed assets with acquisition cost between €250.01 and €800.00 net MAY be capitalized as Low-Value Assets (GWG, e.g. SKR03 `0480` / SKR04 `0670`) and fully depreciated in the acquisition month (`100% AfA`).
   - **Compound GWG Pool Option (Sammelposten § 6 Abs. 2a, €250.01 – €1,000.00 net):** Alternatively, assets between €250.01 and €1,000.00 net MAY be allocated to a compound asset pool (Sammelposten, e.g. SKR03 `0490` / SKR04 `0675`) and depreciated straight-line over exactly 5 fiscal years (`20%` per year), regardless of actual useful life or disposal date during those 5 years.
   - **Regular Depreciable Fixed Assets (> €800.00 net, or > €1,000.00 net if GWG pool is elected):** MUST be capitalized to the specific fixed asset account (Anlagenkonto, e.g., SKR03 `0400` Technical Equipment / SKR04 `0520` Office Equipment) and depreciated over estimated useful life per BMF AfA tables.

2. **Straight-Line Depreciation (Lineare AfA - EStG § 7 Abs. 1):**
   - Annual straight-line depreciation amount: `Annual AfA = Acquisition Cost / Useful Life (Years)`.
   - **Pro-Rata Temporis Monthly Allocation (EStG § 7 Abs. 1 Satz 4):** Depreciation in the year of acquisition MUST be calculated pro-rata temporis starting from the month of acquisition (including the full month of acquisition).
     - `Acquisition Month Factor = (13 - Acquisition Month Number) / 12`
     - `First Year AfA = Annual AfA * Acquisition Month Factor`
   - **Zero Float & Exact BigInt Minor Unit Allocation:**
     - All calculations use integer minor units (`BigInt` cents).
     - Monthly depreciation `Monthly AfA = Annual AfA / 12`.
     - In the final depreciation month (or month of disposal), the remaining net book value (Buchwert) minus `0.01 EUR` (or `0.00 EUR` if scrapped/disposed) is posted as final depreciation, ensuring the net book value exactly equals `1.00 EUR` (Erinnerungswert / nominal value) as long as the asset remains in active use.

3. **Asset Disposal Accounting (Anlagenabgang - HGB § 253 Abs. 3 & GoBD):**
   - Upon disposal (sale or scrapping), pro-rata depreciation MUST be posted for the months of active use in the disposal fiscal year up to and including the disposal month.
   - The historical acquisition cost and cumulative depreciation MUST be derecognized from the fixed asset ledger and general ledger control accounts.
   - **Sale of Asset:** Net sale proceeds (excluding VAT) are credited to sale of fixed assets (e.g. SKR03 `8800` / SKR04 `4830`). Remaining net book value is debited to book value of disposed assets (e.g. SKR03 `2315` / SKR04 `6885`). Net profit/loss on disposal is reflected in general ledger accounts.

## Source
- **Primary Source (German Income Tax Act):** Einkommensteuergesetz (EStG) § 7 Abs. 1 (Absetzung für Abnutzung), § 6 Abs. 2 (Geringwertige Wirtschaftsgüter - GWG), and § 6 Abs. 2a (Sammelposten).
- **Primary Source (German Commercial Code):** Handelsgesetzbuch (HGB) § 253 Abs. 3 (Planmäßige und außerplanmäßige Abschreibung).
- **Primary Source (German Tax Administration / GoBD):** Federal Ministry of Finance (BMF) official AfA-Tabellen (AfA tables for general economic assets) and GoBD circular BMF 2019-11-28 margin numbers 67–71 (Anlagenbuchführung / Fixed Asset Accounting).

## Verification Method
- **Unit Test Verification:** `test/fixed-assets-depreciation.test.js` creates fixed asset master records, calculates monthly/annual pro-rata straight-line depreciation schedules, exercises GWG full write-off and compound pool rules, and verifies disposal postings using exact `BigInt` minor units without float calculations.

## What Must Land First

Filing the issue specifications below as open GitHub issues (e.g., by a maintainer or a session with GitHub issue creation privileges) MUST land first before implementation can be claimed. An engineering session requires an open GitHub issue number `#N` to claim implementation via `Closes #N` in a draft pull request per AGENTS.md §5. The specifications below define the exact scope, primary sources, constraints, labels, and verification methods for those issues.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(assets): implement straight-line depreciation engine with pro-rata temporis monthly allocation`
- **Title:** Implement straight-line fixed asset depreciation engine with monthly pro-rata temporis allocation
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 1: "Debits equal credits, structurally") and Part 3 (Wave 2: General ledger & Period close)
- **Primary Source Citation:** EStG § 7 Abs. 1 Satz 4 & HGB § 253 Abs. 3
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/asset-depreciation-engine.test.js` initializes a fixed asset with acquisition cost `"12000.00 EUR"`, acquisition date `"2025-04-15"`, and useful life 3 years (36 months) and asserts:
  1. Annual full-year depreciation is `"4000.00 EUR"` (`333.33 EUR` / month base).
  2. First year (2025, 9 months active: April-December) pro-rata depreciation is exactly `"3000.00 EUR"` (`9/12 * 4000.00 EUR`).
  3. All monetary calculations use `BigInt` minor units (cents) and round cleanly without floating point precision loss.
  4. Depreciation journal postings debit Depreciation Expense (SKR03 `4830` / SKR04 `6220`) and credit Accumulated Depreciation / Asset Account (SKR03 `0400`).

### Issue 2: `feat(assets): implement fixed asset disposal (Anlagenabgang) and net book value derecognition`
- **Title:** Implement fixed asset disposal (Anlagenabgang) and net book value derecognition postings
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 1: "Debits equal credits") and Part 3 (Wave 2: General ledger)
- **Primary Source Citation:** HGB § 253 Abs. 3 & GoBD BMF Circular 2019-11-28 margin number 68
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/asset-disposal.test.js` disposes an asset (acquisition cost `"10000.00 EUR"`, accumulated depreciation `"6000.00 EUR"`, net book value `"4000.00 EUR"`) sold for `"5000.00 EUR"` net and asserts:
  1. Historical acquisition cost `"10000.00 EUR"` and accumulated depreciation `"6000.00 EUR"` are fully cleared.
  2. Net book value `"4000.00 EUR"` is debited to Disposed Asset Book Value (SKR03 `2315` / SKR04 `6885`).
  3. Net gain on disposal `"10000 EUR"` (cents) / `"100.00 EUR"` is correctly recognized.
  4. General ledger postings balance debits and credits exactly (`BigInt` minor units sum to zero diff).
