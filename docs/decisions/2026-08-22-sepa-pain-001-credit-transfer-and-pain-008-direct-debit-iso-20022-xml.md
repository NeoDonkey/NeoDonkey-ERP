# Decision Record: ISO 20022 SEPA Credit Transfer (pain.001.001.03) and Direct Debit (pain.008.001.02) Payment Initialization Serialization

**Date:** 2026-08-22
**Author:** Daniel Pammé
**Status:** Approved / Binding
**Roadmap Reference:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6 "It speaks to the outside world"), Wave 2 & Wave 3 (`AR/AP subledgers`, `bank payment export`, `SEPA XML`)

---

## Question

How should NeoDonkey construct and serialize ISO 20022 SEPA Credit Transfer (`pain.001.001.03`) payment order files and SEPA Direct Debit (`pain.008.001.02`) mandate collection files from AR/AP subledger payment batches while ensuring strict zero-float monetary arithmetic, IBAN MOD-97 verification, control sum aggregation invariants, and zero-dependency browser compatibility?

---

## Answer

### 1. ISO 20022 Schema & XML Namespace Requirements
1. **SEPA Credit Transfer (SCT) Schema (`pain.001.001.03`):**
   - Root XML Element: `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">`
   - Hierarchy:
     - Document → `CstmrCdtTrfInitn`
       - Group Header (`GrpHdr`):
         - `MsgId`: Unique execution message identifier (e.g. `PAY-20260822-001`).
         - `CreDtTm`: ISO 8601 UTC timestamp format (`YYYY-MM-DDTHH:MM:SSZ`).
         - `NbOfTxs`: String count of total credit transfer transaction records in message.
         - `CtrlSum`: Decimal control sum string derived strictly from BigInt minor units.
         - `InitgPty` → `Nm`: Initiating party company legal name.
       - Payment Information (`PmtInf`):
         - `PmtInfId`: Payment instruction batch ID.
         - `PmtMtd`: Fixed enum `TRF` (Transfer).
         - `NbOfTxs` & `CtrlSum`: Batch-level transaction count and control sum.
         - `PmtTpInf` → `SvcLvl` → `Cd`: Fixed enum `SEPA`.
         - `ReqdExctnDt`: Desired execution date (`YYYY-MM-DD`).
         - `Dbtr` (Debtor legal name) & `DbtrAcct` (Debtor IBAN in `Id` → `IBAN`).
         - `DbtrAgt` (Debtor BIC in `FinInstnId` → `BIC`).
         - `ChrgBr`: Charge bearer set to `SLEV` (Service Level per SEPA regulation).
         - Credit Transfer Transaction Information (`CdtTrfTxInf`):
           - `PmtId` → `EndToEndId`: Mandatory SEPA transaction tracking reference.
           - `Amt` → `InstdAmt`: Amount with mandatory attribute `Ccy="EUR"`.
           - `CdtrAgt` → `FinInstnId` → `BIC`: Creditor bank BIC/SWIFT code.
           - `Cdtr` → `Nm`: Creditor beneficiary name.
           - `CdtrAcct` → `Id` → `IBAN`: Creditor beneficiary IBAN.
           - `RmtInf` → `Ustrd`: Unstructured remittance information (e.g. invoice reference numbers).

2. **SEPA Direct Debit (SDD) Core Schema (`pain.008.001.02`):**
   - Root XML Element: `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">`
   - Hierarchy:
     - Document → `CstmrDrctDbtInitn`
       - Group Header (`GrpHdr`): `MsgId`, `CreDtTm`, `NbOfTxs`, `CtrlSum`, `InitgPty`.
       - Payment Information (`PmtInf`):
         - `PmtMtd`: Fixed enum `DD` (Direct Debit).
         - `PmtTpInf`: `SvcLvl` → `Cd`: `SEPA`, `LclInstrm` → `Cd`: `CORE` (or `B2B`).
         - `SeqTp`: Sequence type enum (`FRST` First, `RCUR` Recurring, `FNAL` Final, `OOFF` One-Off).
         - `ReqdColltnDt`: Target debit collection date (`YYYY-MM-DD`).
         - `Cdtr` (Creditor name) & `CdtrAcct` (Creditor IBAN).
         - `CdtrSchmeId` → `Id` → `CustmId` → `Othr` → `Id`: Mandatory Creditor Identifier (Gläubiger-Identifikationsnummer / CID, e.g. `DE98ZZZ00000000001`).
         - Direct Debit Transaction Information (`DrctDbtTxInf`):
           - `PmtId` → `EndToEndId`: Transaction reference ID.
           - `InstdAmt Ccy="EUR"`: Debit amount.
           - `DrctDbtTx` → `MndtRltdInf`: Mandate ID (`MndtId`), signing date (`DtOfSgn`), electronic indicator (`AmdmntInd` = `false`).
           - `DbtrAgt` → `BIC` & `Dbtr` → `Nm` & `DbtrAcct` → `IBAN`.
           - `RmtInf` → `Ustrd`: Remittance information.

### 2. Zero-Float Monetary Arithmetic & Control Sum Invariants
1. **Decimal String Formatting:**
   - Amount elements (`<InstdAmt Ccy="EUR">1250.50</InstdAmt>`) and control sums (`<CtrlSum>1250.50</CtrlSum>`) MUST be derived directly from BigInt minor units using `toMoney()` string tokenization without `parseFloat` or `Number`.
2. **Control Sum Invariant Assertion:**
   - `<CtrlSum>` MUST match the exact BigInt sum of all constituent transaction amounts (`InstdAmt`), preventing total/line mismatches prior to XML output generation.

### 3. Banking Data Validation Rules
1. **IBAN Verification (ISO 13616 / MOD-97 Check):**
   - Prior to serialization, IBAN strings are validated for length, country code structure, and MOD-97 residual equality (`IBAN % 97 == 1`).
2. **BIC Verification (ISO 9362):**
   - BIC codes are verified against 8 or 11 alphanumeric character patterns (`^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$`).

---

## Source

1. **ISO 20022 Financial Services Standards:** *Universal Financial Industry Message Scheme*, ISO 20022:2013 (Messages `pain.001.001.03` & `pain.008.001.02`).
2. **European Payments Council (EPC):**
   - *SEPA Credit Transfer Scheme Rulebook*, Document Reference EPC004-16.
   - *SEPA Direct Debit Core Scheme Rulebook*, Document Reference EPC125-10.
3. **European Union Regulation:** *Regulation (EU) No 260/2012 of the European Parliament and of the Council* establishing technical and business requirements for credit transfers and direct debits in euro.
4. **International Organization for Standardization:** *ISO 13616-1:2020 Financial services — International bank account number (IBAN)*.

---

## What Would Have to Change for the Answer to Change

1. **ISO 20022 Major Schema Version Migration:** If European clearing networks mandate a shift from `pain.001.001.03` / `pain.008.001.02` to 2019/2024 revisions (e.g. `pain.001.001.09`), the XML namespaces and schema element builders would be updated accordingly.
2. **SEPA Rulebook Revisions:** Changes to SEPA mandatory remittance structures or Creditor Identifier requirements by the EPC would update validation clauses in §3.

---

## What Must Land First

This decision record defines 2 implementable issue specifications below. An engineering session requires an open GitHub issue number `#N` to claim implementation via `Closes #N` in a draft pull request per AGENTS.md §5. Filing these specifications as open GitHub issues (by a maintainer or automated issue-creation workflow) MUST land first before implementation work can be claimed via `Closes #N` in an engineering session.

---

## Unblocked Implementable Issue Specifications

### Issue Specification 1
- **Title:** `feat(sepa): serialize ISO 20022 pain.001.001.03 SEPA Credit Transfer XML from AP payout batches`
- **Source:** Decision record `docs/decisions/2026-08-22-sepa-pain-001-credit-transfer-and-pain-008-direct-debit-iso-20022-xml.md` §1, §2 & §3, `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6), Wave 2 / Wave 3
- **Verification:** `node --test test/sepa-credit-transfer.test.js` passes. A test constructs a SEPA Credit Transfer payment batch with 2 supplier invoices, serializes to XML, and asserts:
  1. The resulting XML namespace matches `urn:iso:std:iso:20022:tech:xsd:pain.001.001.03`.
  2. `<CtrlSum>` matches the exact sum of `<InstdAmt>` values calculated via BigInt minor units.
  3. Debtor and Creditor IBAN values pass MOD-97 verification.
  4. Invalid IBAN or BIC input triggers a descriptive validation error before XML serialization.
- **Labels:** `area:runtime`, `p1`, `ready`
- **Non-Negotiable Constraints:** Zero dependencies, no build step, pure ES module running in Node 22+ and browser, no `node:*` imports outside `runtime/git/fs-node.js`, no `parseFloat`/`Number` on monetary paths, no `Date.now()` or `Math.random()`.

### Issue Specification 2
- **Title:** `feat(sepa): serialize ISO 20022 pain.008.001.02 SEPA Direct Debit XML from AR collection batches`
- **Source:** Decision record `docs/decisions/2026-08-22-sepa-pain-001-credit-transfer-and-pain-008-direct-debit-iso-20022-xml.md` §1, §2 & §3, `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6), Wave 2 / Wave 3
- **Verification:** `node --test test/sepa-direct-debit.test.js` passes. A test constructs a SEPA Direct Debit collection batch with 3 customer invoices and mandates, serializes to XML, and asserts:
  1. The XML namespace matches `urn:iso:std:iso:20022:tech:xsd:pain.008.001.02`.
  2. Mandate references (`MndtId`) and Creditor Identifiers (`CdtrSchmeId`) are properly emitted in `<DrctDbtTxInf>`.
  3. Batch control sum `<CtrlSum>` is computed from BigInt minor units without float loss.
- **Labels:** `area:runtime`, `p1`, `ready`
- **Non-Negotiable Constraints:** Zero dependencies, no build step, pure ES module running in Node 22+ and browser, no `node:*` imports outside `runtime/git/fs-node.js`, no `parseFloat`/`Number` on monetary paths, no `Date.now()` or `Math.random()`.
