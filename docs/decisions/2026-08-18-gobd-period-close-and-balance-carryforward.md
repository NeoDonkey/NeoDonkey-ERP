# Decision Record: GoBD Period Close, Immutability, and Balance Carryforward Rules

**Date:** 2026-08-18

## Question
How should NeoDonkey implement financial period closing (Festschreibung), posting immutability, correcting entries (Stornobuchungen), P&L closing, and balance sheet year-end carryforward entries (Saldenvortrag) in compliance with German GoBD and HGB accounting principles?

## Answer

1. **GoBD Period Locking and Immutability (Festschreibung):**
   - General ledger postings MUST be finalized and locked (festgeschrieben) no later than the end of the month following the transaction month (GoBD margin number 88).
   - Once a accounting period is closed and locked, no posting with a transaction date in that period MAY be added, edited, or deleted. Any attempt to post into a locked period MUST be refused by kernel validation.
   - Any correction to a locked posting MUST be executed as an explicit reversing entry (Generalstorno or Stornobuchung) dated in an open period, leaving the original locked posting and its git commit immutable.

2. **P&L Account Closing (Erfolgsrechnung-Abschluss):**
   - At financial year-end, all revenue and expense accounts (P&L accounts) are closed into the Profit and Loss Summary Account (Gewinn- und Verlustkonto / GuV).
   - The net balance of the GuV account is credited/debited to Equity (Eigenkapital / Jahresüberschuss/Jahresfehlbetrag, e.g. SKR03 account `0860` / `2860`).
   - P&L accounts start the new financial year with a zero balance (`0.00 EUR`).

3. **Balance Sheet Carryforward (Saldenvortrag / Opening Balances):**
   - Active and passive balance sheet accounts carry their closing balance forward into the new financial year as opening balance postings (Saldenvortragsbuchungen) against the Opening Balance Sheet Account (Eröffnungsbilanzkonto / EBK, e.g. SKR03 account `9000`).
   - Opening balance entries MUST equal total debits and credits (`sum of debits == sum of credits`) across all balance sheet accounts in the functional currency, maintaining double-entry balance in opening postings.

## Source
- **Primary Source (German Tax Authority):** GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff), BMF circular 2019-11-28, IV A 4 - S 0316/19/10003 :001, margin numbers 88–95 (Zeitgerechte Erfassung und Festschreibung).
- **Primary Source (German Commercial Code):** HGB (Handelsgesetzbuch) § 239 (Führung der Handelsbücher), § 242 (Pflicht zur Aufstellung), and § 252 Abs. 1 Nr. 1 (Bilanzidentität / Grundsatz der Kontinuität).

## Verification Method
- **Period Close Integrity Test:** A unit test attempts to insert a journal entry into a locked period and asserts refusal; then executes a reversing entry in the open period and verifies that both entries balance and original commits remain unmodified.
