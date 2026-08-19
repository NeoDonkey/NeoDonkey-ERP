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

## Unblocked Implementable Issues

### Issue 1: `feat(datev): serialize EXTF v700 header and column metadata lines`
- **Title:** Serialize DATEV EXTF Formatversion 700 header and column metadata header
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "DATEV EXTF export") and Part 3 (Wave 3: DATEV EXTF export)
- **Primary Source Citation:** DATEV eG *Schnittstellenentwicklungs-Leitfaden DATEV-Format V7.00* (Art.-Nr. 42301) §2.1 & §2.2
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/datev-extf-header.test.js` passes an export configuration object (consultant number, client number, fiscal year start, period start/end) to `serializeDatevHeader(config)` and asserts:
  1. Line 1 contains 26 semicolon-delimited fields enclosed in double quotes, starting with `"EXTF";700;21;1;...` and encoded in Windows-1252 byte representation with CRLF (`\r\n`) line endings.
  2. Line 2 contains exact DATEV column header strings matching format version 700.
  3. Rejects invalid consultant numbers or non-4-digit account lengths with descriptive `TypeError`.

### Issue 2: `feat(datev): serialize EXTF v700 posting lines from SKR03/SKR04 ledger entries`
- **Title:** Serialize general ledger journal postings into DATEV EXTF v700 CSV booking lines
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "DATEV EXTF export") and Part 3 (Wave 3: DATEV EXTF export)
- **Primary Source Citation:** DATEV eG *Schnittstellenentwicklungs-Leitfaden DATEV-Format V7.00* §3.1 (Felder des Buchungsstapels)
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/datev-extf-posting.test.js` converts a list of POLISM general ledger posting objects into EXTF booking lines and asserts:
  1. `Umsatz` is formatted with decimal comma (e.g., `119,00` for 11900 BigInt cents) without using floating-point operations.
  2. `Soll/Haben-Kennzeichen` is correctly `"S"` or `"H"`.
  3. `Konto` and `Gegenkonto` match SKR03/SKR04 4-digit or 5-digit account numbers.
  4. `Belegdatum` is formatted as `DDMM`.
  5. `Belegfeld 1` and `Buchungstext` are truncated to 36 and 60 characters respectively, escaping semicolons and double quotes.
