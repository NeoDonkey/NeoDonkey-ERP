# GoBD period closing and immutable accounting posting policy

**2026-08-17**

## Question

How does NeoDonkey enforce GoBD compliance for period closing (Festschreibung), immutability of accounting entries, and storno (reversing) corrections?

## Answer

Under German GoBD rules (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff) and equivalent EU tax legislation:

1. **Immutable Accounting Entries:**
   Once a journal posting is committed to a closed/locked period, it is structurally immutable. Deletion, inline modification, or backdating into locked periods is prohibited and refused by the POLISM kernel.
2. **Period Close (Festschreibung):**
   - Accounting periods (e.g. monthly periods `YYYY-MM`) transition from state `open` to `locked`.
   - Period close is triggered by an explicit signed closing event.
   - GoBD requires period close to occur no later than the end of the following month (BMF GoBD Rz. 110).
3. **Storno & Correcting Entries (General Ledger Invariant):**
   - To correct an entry in a locked period, a new correcting or reversing (General Storno / General-Storno) transaction must be posted in an *open* period.
   - The correcting transaction references the original transaction ID (`reverses: <original-commit-id>`).
   - The original transaction remains in the signed git substrate intact and verifiable by auditors.

## Primary Source

- **German Federal Ministry of Finance (BMF) GoBD Circular:** BMF Schreiben vom 28. November 2019, IV A 4 - S 0316/19/10003 :001:
  - **Rz. 108:** *Unveränderbarkeit* — "Eine Buchung oder Aufzeichnung darf nicht in einer Weise verändert werden, dass der ursprüngliche Inhalt nicht mehr feststellbar ist."
  - **Rz. 110:** *Zeitgerechtes Buchen und Festschreibung* — "Die Festschreibung muss spätestens bis zum Ablauf des Folgemonats erfolgen."
- **EU Accounting Directive 2013/34/EU:** Article 7 (General principles of financial reporting - non-alteration of accounting records).

## Why

Roadmap v1.0 Gate Condition 1 & 8 require debits to equal credits structurally with period close support and written GoBD auditability answers for German auditors.

## Verification

A period close engine test (`test/period-close.test.js`) verifies that:
1. Posting a journal entry into a closed period throws a kernel refusal `POLISM_PERIOD_LOCKED`.
2. A storno entry posted in the active open period referencing the locked posting succeeds and balances the general ledger.

## What would have to change for this to be wrong

If statutory GoBD guidelines or EU financial directives are amended to permit mutable accounting entries in locked periods, this decision must be updated accordingly.
