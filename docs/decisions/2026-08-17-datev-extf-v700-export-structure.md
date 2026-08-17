# DATEV EXTF v700 format specification for general ledger export

**2026-08-17**

## Question

Which structure, header metadata, field definitions, and character encoding must NeoDonkey's general ledger export produce for DATEV EXTF v700 compliance?

## Answer

General ledger journal entries exported for tax advisors or DATEV accounting software must adhere to DATEV EXTF format version 700 (Formatbeschreibung Buchstapel / EXTF-Schnittstelle).

1. **Encoding and File Layout:**
   - Text encoding: Windows-1252 (or UTF-8 with BOM if accepted by DATEV accounting version 14.0+).
   - Field delimiter: Semicolon `;`. Text fields enclosed in double quotes `"`.
   - Decimal separator: Comma `,` inside monetary fields (e.g., `1234,56`).
2. **Header Record Structure (Line 1, Fields 1 to 28):**
   - Field 1: `"EXTF"` (Format identifier).
   - Field 2: `700` (Format version).
   - Field 3: `21` (Data category: 21 = Buchungszeilen / booking lines).
   - Field 4: `"Buchungsstapel"` (Format name).
   - Field 5: `1` (Format version level).
   - Field 6: Creation timestamp (`YYYYMMDDHHMMSSmmm`).
   - Field 7: Import timestamp (empty/reserved).
   - Field 8: `"RE"` (Source application indicator).
   - Field 9: Exported by user string.
   - Field 10: Client number (Mandantennummer, 1-5 digits).
   - Field 11: Consultant number (Beraternummer, 1-7 digits).
   - Field 12: Fiscal year start (`YYYYMMDD`).
   - Field 13: Account number length (Sachkontenlänge, e.g., 4 to 8 digits).
   - Field 14: Booking period start (`YYYYMMDD`).
   - Field 15: Booking period end (`YYYYMMDD`).
   - Field 16: Description (`"NeoDonkey GL Export"`).
   - Field 17: DVK-System-ID.
   - Field 18: Accounting type (`1` = Finanzbuchhaltung).
   - Field 19: Net position flag (`0` = Gross, `1` = Net).
   - Field 20: Currency code (`"EUR"`).
3. **Data Column Header (Line 2):**
   Mandatory field labels string starting with `"Umsatz (ohne Soll/Haben-Kz)";"Soll/Haben-Kennzeichen";"Konto";"Gegenkonto (ohne SSK)";"BU-Schlüssel";"Belegdatum";"Belegfeld 1"...`
4. **Booking Line Fields (Lines 3+):**
   - Field 1: Amount (`Umsatz`), e.g. `1000,00`.
   - Field 2: Debit/Credit indicator (`Soll/Haben-Kennzeichen`): `'S'` for Debit (Soll), `'H'` for Credit (Haben).
   - Field 3: Account (`Konto`, e.g. SKR03/SKR04 account number).
   - Field 4: Offset Account (`Gegenkonto`).
   - Field 5: Tax key (`BU-Schlüssel`, e.g., `3` for 19% output VAT in SKR03/04).
   - Field 6: Document Date (`Belegdatum`, format `TTMM` or `DDMM`).
   - Field 7: Document Number (`Belegfeld 1`, max 36 chars).
   - Field 9: Booking Text (`Buchungstext`, max 60 chars).

## Primary Source

- **DATEV eG Formatbeschreibung EXTF:** *Schnittstellenbeschreibung EXTF-Format - Buchungsstapel*, Version 700 (Art.-Nr. 42015), §2 "Header-Datensatz" (Fields 1-28) and §3 "Buchungszeilen" (Fields 1-116).
- **DATEV eG Standard-Kontenrahmen (SKR):** SKR 03 / SKR 04 chart of accounts tax keys and posting rules.

## Why

Roadmap v1.0 Gate Condition 6 specifies DATEV export capability. Tax consultants in German-speaking jurisdictions require EXTF v700 format files for seamless import into DATEV Rechnungswesen without manual rekeying.

## Verification

A DATEV export test (`test/datev-export.test.js`) generates an EXTF CSV file from a simulated GL posting set and asserts that:
1. Line 1 starts with `"EXTF";700;21;"Buchungsstapel";1;`.
2. Every line uses `;` delimiting, `,` decimal separators, and proper double-quoted strings.
3. Total debits ('S') equal total credits ('H') across all exported booking lines.

## What would have to change for this to be wrong

If DATEV eG deprecates version 700 in favor of a breaking major version (e.g., v800 or JSON/REST native Schnittstelle) requiring new mandatory header fields or encoding changes, this decision must be revised.
