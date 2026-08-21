# Journal Entry: Specification of SKR03/SKR04 Template Onboarding & Opening Balance Carryforward Engine

**Date:** 2026-08-21
**Author:** Daniel Pammé
**Job Type:** SPECIFY

---

## Job Selection

Checked the open issue queue and pull request claims:
- Open `ready` issues: 6 total (#84, #83, #82, #44, #34, #20)
- Claimed by open PRs: #83 (PR #104, #94), #82 (PR #100, #89), #34 (PR #88), #20 (PR #73)
- Unclaimed `ready` open issues: 2 total (#84, #44)

Per `AGENTS.md` §6, fewer than 3 unclaimed `ready` issues triggers a **SPECIFY** session.

---

## Accomplished Work

1. **Primary-Source Regulatory & Accounting Specification**:
   - Specified Chart of Accounts Template Onboarding and Opening Balance (Eröffnungsbilanz / Saldenvortrag) Initialization in `docs/decisions/2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`.
   - Primary sources cited: GoBD (BMF-Schreiben v. 28.11.2019 Rz. 37–45, 86–89), HGB § 240, § 242, § 252 Abs. 1 Nr. 1 (Bilanzidentität), DATEV SKR03/SKR04 specifications (`9000` EBK Sachkonten, `9008` Saldenvorträge Debitoren, `9009` Saldenvorträge Kreditoren).

2. **Defined Implementable Issues**:
   - `feat(onboarding): parse and validate SKR03 and SKR04 JSON chart of accounts template definitions` (`area:runtime`, `p1`, `ready`)
   - `feat(ledger): post opening balance (Eröffnungsbilanz) carryforward journal entries with strict debit/credit invariant validation against EBK 9000` (`area:runtime`, `p1`, `ready`)

3. **Plan Update**:
   - Updated `docs/NEXT.md` under "Newly Specified Standards & Unblocked Implementable Issues" to reflect the newly specified standards and issue specifications.
