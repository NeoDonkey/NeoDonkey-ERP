# Journal: Serialize DATEV EXTF v700 Booking Lines

**Date:** 2026-08-20

## Summary
Implemented DATEV EXTF format version 700 booking line serialization (`serializeDatevBookingLine`) and full export document assembly (`serializeDatevExport`) in `runtime/export/datev.js`, fulfilling Issue #82 defined in `docs/decisions/2026-08-18-datev-extf-export-structure-and-booking-header-format.md`.

## Details
- Added `serializeDatevBookingLine` to format general ledger postings into exact 116-column semicolon-delimited CSV lines per DATEV EXTF v700 specifications (*Schnittstellenentwicklungs-Leitfaden DATEV-Format V7.00* §3.1).
- Implemented `formatDatevAmount` for converting monetary amounts (BigInt minor units, string tokens, and Money objects) into DATEV comma-separated decimal representations (e.g. `119,00` for 11900 BigInt minor units) with zero floating-point operations.
- Added `formatDatevBelegdatum` to convert standard date strings (`YYYY-MM-DD`, `YYYYMMDD`, `DDMMYYYY`) into DATEV `DDMM` format (e.g. `1508`).
- Added CSV field escaping (double-quoting and escaping inner double quotes as `""`) and field length truncation (`belegfeld1` to 36 chars, `buchungstext` to 60 chars).
- Implemented `serializeDatevExport` to assemble complete CRLF-terminated EXTF export documents combining metadata header lines and booking lines.

## Verification
- Unit tests added in `test/datev-extf-posting.test.js` verifying exact 116-column structure, debit/credit side flagging, SKR03/SKR04 account formatting, field truncation, quote escaping, and full export document generation.
- Validated exact monetary formatting across BigInt, string, and Money object inputs without floating-point math, confirming float inputs throw a `TypeError`.
- Verified entire test suite with `npm test` (681 total tests, 679 passing, 0 failing, 2 skipped).
