# 2026-08-22 — CAMT.053 ISO 20022 XML Bank Statement Ingestion

**Author:** Daniel Pammé
**Lane:** Lane A (build)
**Gate Condition:** Condition 6 ("It speaks to the outside world")

---

## What Changed

Implemented ISO 20022 `camt.053.001.02` and `camt.053.001.08` XML bank statement parsing in `runtime/bank/camt053.js`.

The parser extracts bank transaction domain objects directly from statement XML:
- Statement level: account IBAN (`Stmt/Acct/Id/IBAN`), currency (`Stmt/Acct/Ccy`), statement sequence/id (`Stmt/LglSeqNb`, `Stmt/Id`), and creation date (`Stmt/CreDtTm`).
- Transaction level: `CRDT` (credit) / `DBIT` (debit) indicator (`CdtDbtInd`), booking and value dates (`BookgDt`, `ValDt`), references (`AcctSvcrRef`, `EndToEndId`, `UETR`), party names (`Dbtr/Nm`, `Cdtr/Nm`), and remittance info (`RmtInf/Ustrd`, `RmtInf/Strd/CdtrRefInf/Ref`).

## Non-Negotiable Compliance

- **Zero dependencies & No build step:** Pure ES module running natively in Node 22+ and browser.
- **Zero float representation:** Amounts parsed directly from raw string tokens into `BigInt` minor units via `toMoney` (e.g. `1250.50 EUR` -> `125050n EUR`). `parseFloat` and `Number` are strictly forbidden on monetary paths and asserted by source guard.
- **Verification:** Covered by comprehensive test suite in `test/camt053-parser.test.js` asserting valid XML parsing, invalid/missing element rejections, and source guard compliance.

---

## Verification

Ran `npm test`. All 757 subtests passed cleanly.
