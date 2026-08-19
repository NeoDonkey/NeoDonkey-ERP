# Serialize DATEV EXTF v700 Header and Column Metadata

**Date:** 2026-08-19
**Issue:** #81
**Area:** runtime

## What Changed

Implemented the DATEV EXTF (External Format v700) header and column metadata serializer in `runtime/export/datev.js` and corresponding unit tests in `test/datev-extf-header.test.js`.

Key capabilities added:
1. `serializeDatevHeader(config)`: Constructs Line 1 (26 metadata fields per DATEV EXTF v700 specification, CRLF terminated) and Line 2 (116 standard DATEV v700 column header fields).
2. Input validation: Enforces numeric range constraints on `beraterNummer` (consultant number), `mandantenNummer` (client number), `sachkontenlange` (account length, default 4), and `YYYYMMDD` date strings.
3. `encodeWindows1252(str)`: Provides zero-dependency conversion of JavaScript UTF-16 strings to Windows-1252 byte stream representations (`Uint8Array`), accurately handling German umlauts and the Euro currency symbol (`€` -> `0x80`).

## Why

This addresses open issue #81 (`feat(datev): serialize EXTF v700 header and column metadata lines`), moving Gate Condition 6 ("It speaks to the outside world") forward by building the header foundation required for DATEV EXTF export files.

## Verification

- `node --test test/datev-extf-header.test.js` executed 3 new unit tests covering format accuracy, parameter validation, and Windows-1252 character encoding.
- All tests passed cleanly.
