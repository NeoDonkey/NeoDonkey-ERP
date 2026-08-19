# Decision Record: EU One-Stop Shop (OSS) VAT Scheme Rules, Thresholds, and Reporting

**Date:** 2026-08-17

## Question
How should NeoDonkey handle cross-border B2C sales of physical goods and telecommunications, broadcasting, and electronic services (TBE) within the European Union under the One-Stop Shop (OSS) simplified VAT scheme?

## Answer

1. **Micro-Business Threshold (€10,000 net):**
   - Under the micro-business exemption, an EU business established in only one Member State whose cross-border B2C sales (TBE services + intra-Community distance sales of goods) across all EU Member States do not exceed **10,000 EUR** (net) in the current calendar year and did not exceed this amount in the preceding calendar year may continue to apply domestic VAT rates (e.g. German VAT 19%/7% for a German entity) and pay VAT to its home tax authority.
   - Once total cross-border B2C sales exceed **10,000 EUR** in a calendar year, the exemption ceases immediately for all subsequent transactions. Destination-country VAT rates of the consumer's Member State must apply to every subsequent transaction.

2. **Union Scheme vs. Non-Union Scheme vs. Import Scheme (IOSS):**
   - **Union OSS:** Applies to taxable persons established in the EU carrying out intra-Community distance sales of goods or B2C services supplied to EU consumers.
   - **Non-Union OSS:** Applies to non-EU businesses supplying B2C services to EU consumers.
   - **Import OSS (IOSS):** Covers distance sales of goods imported from third territories/countries in consignments not exceeding 150 EUR intrinsic value.

3. **OSS Return Period and Calculation Rules:**
   - **Reporting Period:** Quarterly (Q1: Jan–Mar, Q2: Apr–Jun, Q3: Jul–Sep, Q4: Oct–Dec). Returns and payments are due by the end of the month following the quarter (e.g., April 30 for Q1).
   - **Monetary Precision:** Standard ISO 4217 EUR precision (2 decimal places) using commercial half-up rounding on line items/totals per country aggregation, converted using European Central Bank (ECB) spot reference rates on the last day of the reporting period if denominated in foreign currency.
   - **Zero Float Rule:** Monetary amounts for OSS taxable amounts and VAT amounts are calculated using internal integer minor units (`BigInt` cents) or exact string representations with 2 decimal places.

## Source
- **Primary Source:** Council Directive 2006/112/EC on the common system of value added tax (as amended by Council Directives (EU) 2017/2455 and (EU) 2019/1995), Articles 59c, 358–369x.
- **Implementing Regulations:** Council Implementing Regulation (EU) 2020/194 laying down detailed rules for the functioning of the One-Stop Shop (OSS).
- **German Implementation:** § 18h UStG (Umsatzsteuer-Durchführungsverordnung / Besondere Besteuerungssatzerhöhung) and BMF Circular on EU VAT E-Commerce Package (2021-04-01, IV C 3 - S 7340/19/10003 :001).

## Verification Method
- **POLISM Rule Validation:** Model rules verifying threshold aggregation `sum of gross-amount over invoice where destination-country != home-country and buyer-type == 'consumer'`.
- **Unit Test Verification:** Unit test asserts that transaction #N crossing €10,000 total switches subsequent line VAT treatment from domestic to destination VAT rate, throwing a validation failure if domestic VAT is assigned when threshold is exceeded.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(vat): enforce EU cross-border B2C €10,000 OSS threshold aggregation and destination rate switching`
- **Title:** Enforce EU cross-border B2C €10,000 OSS threshold aggregation and destination VAT rate switching
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 3 (Wave 2: VAT/OSS returns)
- **Primary Source Citation:** Council Directive 2006/112/EC Article 59c & § 18h UStG
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/oss-vat-threshold.test.js` creates a series of cross-border B2C sales invoices, asserting that once cumulative annual net sales exceed `"10000.00 EUR"`, subsequent invoices automatically require destination-country VAT rates and reject domestic VAT assignment.

### Issue 2: `feat(vat): aggregate quarterly Union OSS VAT return data grouped by EU member state`
- **Title:** Aggregate quarterly Union OSS VAT return data grouped by destination EU member state
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 3 (Wave 2: VAT/OSS returns)
- **Primary Source Citation:** Council Implementing Regulation (EU) 2020/194 & Council Directive 2006/112/EC Articles 358–369x
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/oss-quarterly-return.test.js` aggregates posted cross-border B2C transactions for Q1, verifying exact net taxable amounts and VAT amounts per destination EU Member State using BigInt minor units without float arithmetic.
