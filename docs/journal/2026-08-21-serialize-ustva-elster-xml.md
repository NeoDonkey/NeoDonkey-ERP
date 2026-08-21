# Journal: Serialize German USt-VA ELSTER XML Payload

**Date:** 2026-08-21

## Summary

Implemented German USt-VA ELSTER XML document structure serialization (`runtime/vat/ustva-elster.js`) to prepare German VAT advance returns for official submission via ERiC (ELSTER Rich Client).

## Changes

- Created `runtime/vat/ustva-elster.js`:
  - `serializeUstVaElsterXml({ header, gridTotals })`: Serializes aggregated USt-VA tax grid Kennziffern (Kz 81, Kz 86, Kz 41, Kz 66, Kz 83) into the official BMF ELSTER XML document format (`http://www.elster.de/elsterxml/schema/v1`).
  - Strict header validation: validates 4-digit `FinanzamtNummer`, 11..13-digit `Steuernummer`, 4-digit `Jahr` (YYYY), and 2-digit `Zeitraum` (MM or 41..44).
  - Exact BigInt minor-unit formatting for decimal VAT amounts (`Kz66`, `Kz83`) and truncated integer Euro formatting for taxable sales bases (`Kz81`, `Kz86`, `Kz41`) per UStG § 18 Abs. 1.
- Created `test/ustva-elster-xml.test.js`:
  - Unit tests verifying XML structure, namespaces, element generation, mandatory header validation, and source guard asserting no `parseFloat`, `Number(`, or `.toFixed` on money paths.

## Verification

- `node --test test/ustva-elster-xml.test.js` passes all tests.
- Full `npm test` suite executed and clean.
