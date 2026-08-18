# Decision Record: DATEV EXTF Export Structure and Booking Header Format

**Date:** 2026-08-18

## Question
How should NeoDonkey structure and export general ledger journal entries into DATEV EXTF (External Format v700 / Formatversion 700) CSV files for seamless export to tax advisors and DATEV accounting software (e.g. DATEV Rechnungswesen / Kanzlei-Rechnungswesen)?

## Answer

1. **File Encoding and Header Structure:**
   - DATEV EXTF files MUST be encoded in **Windows-1252** (or ISO-8859-1 compatible ASCII subset) with CRLF (`\r\n`) line endings, using semicolon (`;`) as field delimiter and double quotes (`"`) as text qualifier.
   - Line 1 MUST contain the DATEV EXTF Header with 26 fixed metadata attributes:
     - `"EXTF"`; `700`; `21` (Buchungsstapel); `1`; `<CreationDate YYYYMMDDHHMMSSmms>`; `""`; `"ND"`; `""`; `""`; `""`; `<ConsultantNumber>`; `<ClientNumber>`; `<FinancialYearStart YYYYMMDD>`; `4` (Account length); `<PeriodStart YYYYMMDD>`; `<PeriodEnd YYYYMMDD>`; `"General Ledger Export"`; `""`; `1`; `0`; `0`; `"EUR"`; `""`; `""`; `""`; `""`
   - Line 2 MUST contain the exact column header names defined by DATEV for format version 700.

2. **Booking Line Specification:**
   - **Umsatz (Amount):** Expressed as decimal with comma as decimal separator (e.g. `119,00`), representing gross monetary amount in minor unit rounding (2 decimal places).
   - **Soll/Haben-Kennzeichen (Debit/Credit Flag):** `"S"` (Soll/Debit) or `"H"` (Haben/Credit).
   - **Konto / Gegenkonto:** Account numbers formatted per German chart of accounts (SKR03 / SKR04), typically 4 digits for general ledger accounts (e.g., SKR03 `8400` Erlöse 19% USt, `1400` Forderungen) or 5 digits for sub-ledger customer/supplier accounts.
   - **BU-Schlüssel (Posting Key / Tax Code):** Standard DATEV tax key (e.g., `3` for 19% input tax, `9` for 19% output tax) or explicit tax account posting.
   - **Belegdatum (Document Date):** Format `DDMM` (e.g. `1508` for August 15th) or `DDMMYYYY`.
   - **Belegfeld 1 (Document Reference 1):** Document/Invoice identifier string (max 36 alphanumeric characters).
   - **Buchungstext (Posting Text):** Descriptive string (max 60 characters).

3. **Zero Float and Deterministic Formatting:**
   - Internal monetary math uses exact integer `BigInt` minor units.
   - String generation converts integer cents to comma-separated decimal representations without floating-point conversion.

## Source
- **Primary Source (DATEV eG):** *Schnittstellenentwicklungs-Leitfaden DATEV-Format V7.00* (DATEV eG, Art.-Nr. 42301 / Schnittstellen-Beschreibung EXTF Buchungsstapel v700).
- **Primary Source (German Tax Law):** GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff), BMF circular 2019-11-28, IV A 4 - S 0316/19/10003 :001.

## Verification Method
- **Unit Test Verification:** `test/datev-extf-export.test.js` generates an EXTF CSV export from a set of general ledger posting objects and asserts byte-exact matching against a validated EXTF v700 fixture, verifying header field positions, delimiter escaping, and Windows-1252 byte encoding.
