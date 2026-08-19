# Serialize DATEV EXTF v700 Posting Lines and Full Export

**Date:** 2026-08-19
**Author:** Daniel Pammé
**Issue:** #82

## Summary

Implemented serialization of general ledger journal posting records into DATEV EXTF Formatversion 700 CSV booking lines (`serializeDatevPostingLine`, `serializeDatevPostings`, `serializeDatevExport`) in `runtime/export/datev.js`.

## Details

1. **Zero Float Decimal Amount Formatting (`formatDatevAmount`):**
   - Formats monetary amounts into standard German DATEV decimal format (e.g. `119,00` for 11900 BigInt cents) using integer string manipulation and zero float arithmetic.
   - Accepts BigInt cents, integer cents, and money strings (`119.00 EUR`). Refuses non-integer floats.

2. **Date Formatting (`formatDatevDate`):**
   - Converts ISO strings (`YYYY-MM-DD`), compact date strings (`YYYYMMDD`), and JavaScript `Date` objects into standard 4-digit DATEV `DDMM` strings.

3. **116-Column Booking Line Serialization (`serializeDatevPostingLine`):**
   - Populates DATEV EXTF v700 fields per DATEV eG specification (§3.1): `Umsatz` (col 0), `Soll/Haben-Kennzeichen` (`S`/`H`, col 1), `WKZ` (col 2), `Konto` (col 6), `Gegenkonto` (col 7), `BU-Schlüssel` (col 8), `Belegdatum` (col 9), `Belegfeld 1` (col 10, max 36 chars), and `Buchungstext` (col 13, max 60 chars).
   - Properly escapes inner double quotes (`""`) and formats output with CRLF (`\r\n`) line endings.

4. **Multi-line and Full EXTF File Export (`serializeDatevPostings`, `serializeDatevExport`):**
   - Concatenates posting lines and combines header metadata, column headers, and posting body into complete DATEV EXTF v700 export files.

5. **Unit Tests (`test/datev-extf-posting.test.js`):**
   - Comprehensive unit test suite added covering amount/date conversion, 116-column layout, truncation, parameter validation, and multi-line export generation. All tests pass cleanly.
