# EU VAT and One Stop Shop (OSS) return reporting data structure

**2026-08-17**

## Question

How does NeoDonkey map general ledger VAT postings to EU Periodic VAT Returns and One Stop Shop (OSS) quarterly filings without floating-point calculations?

## Answer

NeoDonkey's tax aggregation subsystem compiles periodic VAT returns (e.g., German Umsatzsteuervoranmeldung UStVA) and Union OSS returns (for cross-border B2C e-commerce supplies) directly from double-entry GL postings tagged with ISO tax accounts and Member State codes.

1. **Periodic Domestic VAT Return Mapping (UStVA):**
   - **Output VAT Net Taxable Bases (Lieferungen und sonstige Leistungen):**
     - Standard Rate (e.g., 19% DE): UStVA Field 81 (Steuerfreie/Steuerpflichtige Umsätze zum Steuersatz von 19 %).
     - Reduced Rate (e.g., 7% DE): UStVA Field 86.
   - **Input Tax Deductible (Abziehbare Vorsteuer):**
     - Invoiced Input VAT: UStVA Field 66 (Abziehbare Vorsteuerbeträge aus Rechnungen von anderen Unternehmern).
     - Reverse Charge Input VAT: UStVA Field 67 (Abziehbare Vorsteuer aus der Übertragung von Steuerschuldnerschaft).
2. **One Stop Shop (OSS) Union Scheme Reporting:**
   For cross-border intra-EU B2C supplies of goods/services under EU Directive 2006/112/EC Art. 369a-369k:
   - Aggregated per **Member State of Consumption** (MSCON ISO 3166-1 alpha-2 code, e.g., `FR`, `IT`, `ES`).
   - Grouped by VAT Rate Type (Standard vs. Reduced) and Applicable Rate Percentage (e.g. 20% FR, 22% IT, 21% ES).
   - Taxable Base Amount (net) and Calculated Tax Amount represented as exact decimal strings in `EUR` (ISO 4217).
3. **Exact Decimal Aggregation (FD-1):**
   All totals are calculated using BigInt minor unit summation over tagged ledger postings. Rounding occurs per line or total as configured in the operating model using commercial half-up rounding. Floating point arithmetic is forbidden.

## Primary Source

- **EU Council Directive 2006/112/EC (VAT Directive):**
  - **Article 250(1):** Requirements for taxable persons to submit VAT returns detailing transactions and input/output tax.
  - **Articles 369a to 369k:** Special scheme for distance sales of goods and B2C services (One Stop Shop / OSS scheme).
- **Council Implementing Regulation (EU) 2020/194:** Article 4 and Annex I detailing the electronic reporting layout and mandatory fields for Union OSS returns.
- **German Federal Tax Office (BZSt) / ELSTER:** *Umsatzsteuervoranmeldung (UStVA)* tax line codes (Kennzahlen / KZs).

## Why

Roadmap v1.0 Wave 2 mandates general ledger, AR/AP, and VAT/OSS return computation. Cross-border EU businesses require certified, mathematically exact VAT and OSS reporting to avoid penalties and simplify filings across all 27 EU member states.

## Verification

A VAT return aggregation test (`test/vat-oss-return.test.js`) verifies that:
1. Sales postings across 3 EU destination states aggregate correctly into OSS return line items grouped by destination state ISO code and tax rate.
2. Sum of net taxable amounts + tax amounts matches total gross GL entries to the exact cent without rounding drift or floating-point errors.

## What would have to change for this to be wrong

If the European Commission or national tax authorities alter the OSS schema, tax line field codes, or threshold rules (e.g., EU-wide EUR 10,000 threshold under Art. 59c), this decision record must be updated.
