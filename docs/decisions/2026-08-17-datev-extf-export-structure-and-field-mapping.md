# DATEV EXTF ASCII File Format Structure and Field Mapping Specification

**Date:** 2026-08-17
**Status:** Settled / Normative for Wave 3 DATEV Export
**Area:** `operating-model/` / DATEV export

## The Question

What is the normative EXTF (ASCII) file structure, header format, character encoding, and field mapping required to export financial posting batches (Buchungsstapel) from NeoDonkey general ledger into DATEV systems?

## The Answer

1. **File Format & Header Specification (DATEV EXTF Format 700):**
   - **Line 1 (EXTF Header Declaration):**
     - Semicolon `;` delimited, double-quote `"` quoted string fields.
     - Field 1: `"EXTF"` (Format identifier)
     - Field 2: `700` (Version identifier)
     - Field 3: `21` (Data category code: 21 = Buchungsstapel)
     - Field 4: `"Buchungsstapel"` (Format name)
     - Field 5: `10` (Format version)
     - Field 6: Created timestamp (`YYYYMMDDHHMMSSFFF`)
     - Field 9: `"Finanzbuchführung"` (Data category description)
     - Field 13: Mandant number (e.g. `10001`)
     - Field 14: Sachkontenlänge (Account number length: integer 4 to 8, default 4)
     - Field 15: Start date of posting batch (`YYYYMMDD`)
     - Field 16: End date of posting batch (`YYYYMMDD`)
     - Field 20: Dictated character encoding declaration: `"Windows-1252"` (or `"UTF-8"` when explicit in header)
   - **Line 2 (Column Names Header):**
     - Official DATEV column header strings in exact order (`"Umsatz (ohne Soll/Haben-Kz)"`, `"Soll/Haben-Kennzeichnung"`, `"Währungscode"`, `"Konto"`, `"Gegenkonto (ohne BU-Schlüssel)"`, `"BU-Schlüssel"`, `"Belegdatum"`, `"Belegfeld 1"`, `"Buchungstext"`, etc.).
   - **Lines 3+ (Posting Rows):**
     - One line per journal entry / posting transaction leg.

2. **Mandatory Posting Data Fields (per Row):**
   - **Umsatz:** Monetary amount in major units with 2 decimal places using comma `,` as decimal separator (e.g., `"119,00"`).
   - **Soll/Haben-Kennzeichnung:** `'S'` for Debit (Soll), `'H'` for Credit (Haben).
   - **Währungscode:** ISO 4217 3-letter currency symbol (`"EUR"`).
   - **Konto:** Debit/Credit Account number (4 to 8 digits, e.g. SKR03 `"8400"` for revenue, `"1200"` for bank).
   - **Gegenkonto:** Offset account number (4 to 8 digits, e.g. SKR03 `"1400"` for receivable customer).
   - **BU-Schlüssel:** Automatic posting / tax key (e.g. `3` for 19% output tax, `9` for 19% input tax).
   - **Belegdatum:** Document date formatted as `DDMM` (e.g. `1508` for August 15th).
   - **Belegfeld 1:** Invoice/Document reference number (max 36 characters).
   - **Buchungstext:** Entry description text (max 60 characters).

3. **Invariants & Integrity Rules:**
   - Sum of all Debit (`S`) amounts in a batch MUST equal sum of all Credit (`H`) amounts.
   - Account numbers MUST match configured `Sachkontenlänge` declared in Header Field 14.
   - Text fields containing semicolons or double quotes MUST be properly escaped per CSV / DATEV rules.

## Source

- **DATEV eG**, "Schnittstellenentwicklungs-Dokumentation: DATEV-Format 7.0 / EXTF Buchungsstapel", DATEV-Dokument 1036228, Section 3 "Datei-Aufbau EXTF-Format" (Header fields 1–26) and Section 4 "Felddefinitionen Buchungsstapel" (Fields 1–116).
- **GoBD** (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff), BMF-Schreiben vom 28.11.2019, IV A 4 - S 0316/19/10003 :001, Section 3.2 "Ordnungsmäßigkeitsanforderungen".

## Verification Strategy

An automated test in `test/datev-export.test.js` will export a batch of GL postings (including sales revenue, input tax, and bank payments) and assert:
1. Header Line 1 matches exact DATEV EXTF 700 format specification, including mandatory field positions and quotes.
2. Field separator is `;`, decimal separator in amounts is `,`, date format is `DDMM`.
3. Total debit amounts equal total credit amounts.
4. Export content tested against a byte-exact fixture to guarantee stability against unintentional format drifts.

## What Would Have To Change For This To Be Wrong

If DATEV eG deprecates EXTF Format version 700 or issues an updated major interface specification (e.g., EXTF 800) changing mandatory header line declarations or column order.
