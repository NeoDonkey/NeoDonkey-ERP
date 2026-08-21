# Decision Record: German VAT Advance Return (USt-VA) and ELSTER XML Schema

**Date:** 2026-08-20

## Question
How should NeoDonkey aggregate general ledger transactions for domestic German VAT advance returns (Umsatzsteuervoranmeldung - USt-VA) and structure the resulting XML document for submission via the German tax authority's ELSTER interface (ERiC)?

## Answer

1. **USt-VA Tax Grid Aggregation (Kennziffern Kz):**
   - German VAT advance returns aggregate ledger postings for a specified monthly or quarterly period into official tax grid position codes (Kennziffern / Kz).
   - **Kz 81:** Taxable sales at standard rate (19% per UStG § 12 Abs. 1). Aggregates net base amounts (`Bemessungsgrundlage`) and calculated output VAT (`Steuer`).
   - **Kz 86:** Taxable sales at reduced rate (7% per UStG § 12 Abs. 2). Aggregates net base amounts and calculated output VAT.
   - **Kz 41:** Tax-free intra-Community supplies with right to input tax deduction (Innergemeinschaftliche Lieferungen per UStG § 4 Nr. 1b / § 6a). Base amount only.
   - **Kz 66:** Deductible input tax (Abziehbare Vorsteuer) from invoices from other businesses (UStG § 15 Abs. 1 Satz 1 Nr. 1). VAT amount only.
   - **Kz 83:** Remaining VAT payment or refund amount (Verbleibende Umsatzsteuer-Vorauszahlung / Erstattungsbetrag). Calculated as total output VAT (Kz 81 USt + Kz 86 USt) minus deductible input tax (Kz 66 Vorsteuer).
   - All amounts in Kz fields MUST be computed using BigInt minor units (e.g. cents) with commercial half-up rounding, with net base amounts formatted as truncated integer Euros for taxable sales per UStG § 18 Abs. 1 where required by ELSTER regulations.

2. **ELSTER XML Structure (`<Anmeldungssteuern>` / `<UStVA>`):**
   - The USt-VA XML document MUST conform to the official BMF ELSTER XML schema specification (`http://www.elster.de/elsterxml/schema/v1`).
   - Root node `<Elster>` contains `<DatenTeil>` and `<Nutzdatenblock>`.
   - The `<Nutzdaten>` section contains `<Anmeldungssteuern>` with header attributes for financial office number (`FinanzamtNummer`, 4 digits), steuernummer (`Steuernummer`, 13 digits), tax year (`Jahr`, YYYY), and period (`Zeitraum`, MM or 41..44 for quarters).
   - Position elements MUST be serialized as `<Kz81>`, `<Kz86>`, `<Kz41>`, `<Kz66>`, `<Kz83>` with exact string-formatted decimal amounts.

## Errata (2026-08-21)
- Corrected section 2 element spelling from `<Anmeldesteuern>` to `<Anmeldungssteuern>` per BMF ERiC ELSTER XML schema XSD specification (`/Elster/DatenTeil/Nutzdatenblock/Nutzdaten/Anmeldungssteuern`).

## Source
- **Primary Source (German Tax Law):** UStG (Umsatzsteuergesetz) § 18 Abs. 1 (Voranmeldungsverfahren), § 12 (Steuersätze), and § 15 (Vorsteuerabzug).
- **Primary Source (German Tax Authority ELSTER Specification):** BMF / Bayerisches Landesamt für Steuern, ELSTER Schnittstellenbeschreibung "Anmeldung der Umsatzsteuer-Voranmeldung 2026 / ERiC Datenbankschema".

## Verification Method
- **Tax Grid Aggregation Test:** Unit tests in `test/ustva-aggregation.test.js` post a series of general ledger journal entries (standard 19% sales, reduced 7% sales, intra-EU zero-rated supply, supplier invoices with 19% input tax) and assert that `aggregateUstVa(period)` correctly assigns amounts to Kz 81, Kz 86, Kz 41, Kz 66, and computes Kz 83 net balance without floating point arithmetic.
- **ELSTER XML Serialization Test:** Unit tests in `test/ustva-elster-xml.test.js` pass an aggregated USt-VA result to `serializeUstVaElsterXml(config)` and validate XML tags, namespace declarations, required tax office attributes, and exact UTF-8 byte serialization.

## What Must Land First

Filing the issue specifications defined below as open GitHub issues MUST land first before implementation can be claimed via `Closes #N`.

## Unblocked Implementable Issues

### Issue 1: `feat(vat): aggregate German USt-VA tax grid Kennziffern (Kz 81, 86, 41, 66, 83) from ledger postings`
- **Title:** Aggregate German USt-VA tax grid Kennziffern from general ledger postings
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "It speaks to the outside world") and Part 3 (Wave 2: VAT/OSS returns)
- **Primary Source Citation:** UStG § 18 Abs. 1, § 12, § 15 & BMF ELSTER UStVA 2026 Schnittstellenbeschreibung
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/ustva-aggregation.test.js` feeds trial balance postings for an accounting period and asserts:
  1. Kz 81 net base and USt (19%), Kz 86 net base and USt (7%), Kz 41 intra-EU sales, and Kz 66 deductible input VAT match exact integer cent sums.
  2. Kz 83 correctly computes net payable/refundable balance.
  3. No IEEE 754 float operations or `parseFloat` are used.

### Issue 2: `feat(vat): serialize German USt-VA ELSTER XML document structure`
- **Title:** Serialize German USt-VA ELSTER XML payload for tax authority submission
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 6: "It speaks to the outside world") and Part 3 (Wave 2: VAT/OSS returns)
- **Primary Source Citation:** BMF ELSTER Schnittstellenbeschreibung "Anmeldung der Umsatzsteuer-Voranmeldung 2026"
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/ustva-elster-xml.test.js` provides aggregated tax grid totals and tax office metadata and asserts:
  1. Serialized XML output contains valid `<Elster>`, `<Anmeldesteuern>`, `<UStVA>` elements with mandatory namespaces.
  2. Kz elements `<Kz81>`, `<Kz86>`, `<Kz41>`, `<Kz66>`, `<Kz83>` are formatted with two-decimal string representations.
