# General Ledger Period Close and Year-End Close Accounting Invariants

**Date:** 2026-08-17
**Status:** Settled / Normative for Wave 2 Period Close & General Ledger
**Area:** `operating-model/` / general ledger

## The Question

What accounting invariants, period lock enforcement rules, P&L clearing actions, and opening balance carry-forwards must NeoDonkey general ledger execute for monthly period closes and financial year-end closes under HGB and GoBD?

## The Answer

1. **Monthly Period Close (Monatsabschluss) Invariants:**
   - **Assertion:** Closing period $P$ asserts that $P$ contains zero unposted draft transactions or unallocated operational documents.
   - **Period Lock:** Executing a period close sets a period lock timestamp/marker in `operating-model/`. The kernel strictly refuses any new posting whose document date or value date falls inside a locked period $P \le P_{\text{locked}}$ (FD-5 item 7).
   - **Immutability & Correction:** Postings in closed periods cannot be mutated or deleted. Corrections must be posted as explicit reversing entries (Storno) or adjustment entries dated in an open future period $P > P_{\text{locked}}$.

2. **Year-End Close (Jahresabschluss / Bilanz & GuV) Procedure:**
   - **P&L Clearing (GuV-Konto-Abschluss):**
     - All temporary revenue accounts (e.g. SKR03 `8000` series) and expense accounts (e.g. SKR03 `4000` series) are closed to the Profit & Loss Summary Account (Gewinn- und Verlustkonto - GuV, SKR03 `8020` / SKR04 `9804`).
     - Net Income / Net Loss (Jahresüberschuss / Jahresfehlbetrag) from GuV is posted to Equity (Eigenkapital, SKR03 `0860` / SKR04 `2970`), reducing GuV balance to exactly `0.00 EUR`.
   - **Balance Sheet Carry-Forward (Saldenvortrag):**
     - Permanent asset, liability, and equity accounts retain their balances at year-end date $Y$-12-31.
     - On opening date $(Y+1)$-01-01, opening balance postings (Vortragsbuchungen) are generated against the Opening Balance Account (Saldenvortragskonto, SKR03 `9000` / SKR04 `9000`), establishing initial account balances for financial year $Y+1$.
   - **Structural Balance Equality:**
     $$\sum_{\text{All Accounts}} \text{Debits} - \sum_{\text{All Accounts}} \text{Credits} = 0$$
     - The sum of debits MUST equal the sum of credits for the P&L closing batch, the equity transfer batch, and the opening balance carry-forward batch.

## Source

- **Handelsgesetzbuch (HGB)**:
  - §242 Abs. 1 (Pflicht zur Aufstellung von Bilanz und Gewinn- und Verlustrechnung)
  - §252 Abs. 1 Nr. 1 (Grundsatz der Bilanzidentität: opening balance sheet of new year must equal closing balance sheet of prior year)
  - §252 Abs. 1 Nr. 2 (Grundsatz der Unternehmensfortführung)
- **GoBD** (BMF-Schreiben vom 28.11.2019):
  - Section 3.2.1 "Unveränderbarkeit von Buchungen und Aufzeichnungen"
  - Section 3.2.2 "Zeitgerechte Buchungen und Erfassungen"

## Verification Strategy

An automated test in `test/gl-period-close.test.js` will simulate a full fiscal year with revenue, expense, bank, asset, and liability postings, and verify:
1. Closing Period 1 locks Period 1. A subsequent attempt to post an entry dated inside Period 1 is refused with a period-locked error.
2. Year-End Close clears all revenue and expense accounts to zero balance via GuV summary account.
3. Net profit is correctly posted to Equity account.
4. Opening balances for year $Y+1$ are generated against account `9000`, matching closing balances of year $Y$ byte-exactly.
5. Trial balance remains $0.00$ net difference across all operations.

## What Would Have To Change For This To Be Wrong

If German commercial law (HGB) or tax regulations alter fundamental double-entry year-end closing accounting rules or remove the Bilanzidentität requirement (§252 Abs. 1 Nr. 1 HGB).
