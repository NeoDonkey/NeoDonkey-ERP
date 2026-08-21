# Journal Entry: Specify Fixed Asset Management and Depreciation Accounting

**Date:** 2026-08-21
**Session Job:** SPECIFY (per AGENTS.md §5 and §6)

## Rationale
During job selection routing per AGENTS.md §6, 2 unclaimed `ready` issues were present in the queue (#84 and #44, with all other open issues claimed by existing draft/open PRs). Having fewer than 3 unclaimed `ready` issues triggered a mandatory **SPECIFY** session to prevent queue exhaustion.

## What Was Done
1. Researched German statutory accounting requirements for fixed asset management (Anlagenbuchhaltung) and depreciation (Absetzung für Abnutzung - AfA) under HGB § 253, EStG § 6 & § 7, and GoBD BMF circular 2019-11-28.
2. Created decision record `docs/decisions/2026-08-21-fixed-asset-management-and-depreciation-accounting.md` defining:
   - Capitalization and Low-Value Asset (Geringwertige Wirtschaftsgüter - GWG) net threshold rules (< €250 direct expense, €250–€800 GWG immediate write-off option, €250–€1,000 GWG 5-year compound pool option, > €800 regular asset capitalization).
   - Straight-line depreciation rules with exact monthly pro-rata temporis allocation in acquisition and disposal years (`(13 - Month) / 12`).
   - Nominal value retention (€1.00 Erinnerungswert) during active use.
   - Asset disposal (Anlagenabgang) accounting and net book value derecognition.
3. Specified two `ready` unblocked implementable issue specifications within the decision record:
   - `feat(assets): implement straight-line depreciation engine with pro-rata temporis monthly allocation`
   - `feat(assets): implement fixed asset disposal (Anlagenabgang) and net book value derecognition`
4. Maintained isolated changes in a standalone journal entry file to prevent merge conflicts with parallel sessions.
