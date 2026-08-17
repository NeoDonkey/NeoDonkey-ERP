# German VAT Advance Return (USt-VA) Field Mapping and Calculation Rules

**Date:** 2026-08-17
**Status:** Settled / Normative for Wave 2 German VAT Reporting
**Area:** `operating-model/` / VAT reporting

## The Question

How are general ledger postings aggregated into official German Value Added Tax Advance Return (Umsatzsteuervoranmeldung - USt-VA) box codes (Kennziffern / Kz), and how is the net tax liability calculated?

## The Answer

1. **Mapping GL Postings to USt-VA Kennziffern (Kz):**
   - **Kz 81:** Taxable domestic turnover at standard rate 19% (UStG §12 Abs. 1) — *Net amount*.
   - **Kz 86:** Taxable domestic turnover at reduced rate 7% (UStG §12 Abs. 2) — *Net amount*.
   - **Kz 41:** Tax-exempt intra-Community supplies with right to input tax deduction (UStG §4 Nr. 1b i.V.m. §6a) — *Net amount*.
   - **Kz 43:** Tax-exempt exports to non-EU third countries (UStG §4 Nr. 1a i.V.m. §6) — *Net amount*.
   - **Kz 66:** Deductible input tax from supplier invoices (Vorsteuer aus Rechnungen von anderen Unternehmern, UStG §15 Abs. 1 S. 1 Nr. 1) — *Tax amount*.
   - **Kz 61:** Deductible import VAT paid (Entstandene Einfuhrumsatzsteuer, UStG §15 Abs. 1 S. 1 Nr. 2) — *Tax amount*.
   - **Kz 83:** Remaining VAT advance payment liability or credit refund (Verbleibende Umsatzsteuer-Vorauszahlung / Verbleibender Überschuss).

2. **Calculation Invariants & Formulas:**
   - **Calculated Output VAT:**
     $$\text{Output VAT (19\%)} = \lfloor \text{Kz 81} \times 0.19 \rceil$$
     $$\text{Output VAT (7\%)} = \lfloor \text{Kz 86} \times 0.07 \rceil$$
     $$\text{Total Output VAT} = \text{Output VAT (19\%)} + \text{Output VAT (7\%)}$$
   - **Total Deductible Input VAT:**
     $$\text{Total Input VAT} = \text{Kz 66} + \text{Kz 61}$$
   - **Net Payment Due (Kz 83):**
     $$\text{Kz 83} = \text{Total Output VAT} - \text{Total Input VAT}$$
     - If $\text{Kz 83} > 0$: Payment due to tax authority (Finanzamt).
     - If $\text{Kz 83} < 0$: Refund due from tax authority (Verbleibender Überschuss).

3. **Arithmetic Invariants:**
   - All monetary calculations MUST use exact string representation (e.g. `"190.00 EUR"`) and `BigInt` minor units. IEEE floating-point arithmetic (`Number`) is strictly prohibited.
   - Commercial half-up rounding ($\lfloor \cdot \rceil$) applies per tax box aggregate.

## Source

- **Umsatzsteuergesetz (UStG)**:
  - §18 Abs. 1 (Voranmeldungsverfahren und Vorauszahlung)
  - §12 Abs. 1 & Abs. 2 (Steuersätze: 19% Regelsteuersatz, 7% ermäßigter Steuersatz)
  - §15 Abs. 1 (Möglichkeit des Vorsteuerabzugs)
- **Bundesministerium der Finanzen (BMF)**:
  - Official form and guidance instructions: "Anleitung zur Umsatzsteuervoranmeldung" (BMF-Formulardruck).
- **Finanzamt ERSTER (ELSTER / ERiC)**:
  - Technical tax taxonomy specifications for USt-VA electronic XML filing.

## Verification Strategy

An automated test in `test/ust-va-report.test.js` will populate a general ledger with various sales transactions (19% standard, 7% reduced, intra-community supply) and purchase transactions (19% input tax), and assert:
1. Aggregate net amounts are placed accurately into Kz 81, Kz 86, and Kz 41.
2. Deductible input tax amount is placed accurately into Kz 66.
3. Kz 83 (Verbleibende Umsatzsteuer-Vorauszahlung) calculates byte-exactly according to the normative formula without float rounding errors.
4. An attempt to pass floating-point numbers into the report generator throws an error.

## What Would Have To Change For This To Be Wrong

If the German Bundestag amends UStG §12 tax rates (e.g. changing 19% or 7% rates) or if BMF renumbers or restructures USt-VA Kennziffer box assignments in future annual tax reform notices.
