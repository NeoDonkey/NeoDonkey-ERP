# XRechnung and EN 16931 semantic data model and mandatory business terms

**2026-08-17**

## Question

Which semantic business terms (BTs) and syntax bindings must NeoDonkey's e-invoicing engine support for EN 16931-1:2017 and KoSIT XRechnung compliance, and how are monetary amounts and tax details mapped?

## Answer

NeoDonkey's e-invoicing export engine implements the European Standard EN 16931-1:2017 core semantic data model as profiled in Germany's KoSIT XRechnung standard (version 3.0+).

1. **Syntax Binding:** Supporting UBL 2.1 (`urn:oasis:names:specification:ubl:schema:xsd:Invoice-2`) XML export and UN/CEFACT CII (`urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100`).
2. **Mandatory Business Terms (BTs):**
   - **BT-1** Invoice number (mandatory string, max 200 chars).
   - **BT-2** Invoice issue date (mandatory YYYY-MM-DD).
   - **BT-3** Invoice type code (mandatory, e.g. `380` for Commercial invoice, `381` for Credit note per UNTDID 1001).
   - **BT-5** Invoice currency code (mandatory ISO 4217 code, e.g. `EUR`).
   - **BT-10** Buyer reference / Leitweg-ID (mandatory for German public sector / XRechnung B2G).
   - **BT-27** Seller name & **BT-31** Seller VAT identifier (mandatory when seller is VAT registered).
   - **BT-44** Buyer name & **BT-48** Buyer VAT identifier.
   - **BT-106** Sum of line net amounts (`ram:LineTotalAmount` / `cbc:LineExtensionAmount`).
   - **BT-109** Invoice total amount without VAT (`ram:TaxBasisTotalAmount` / `cbc:TaxExclusiveAmount`).
   - **BT-110** Invoice total VAT amount (`ram:TaxTotalAmount` / `cbc:TaxAmount`).
   - **BT-112** Invoice total amount with VAT (`ram:GrandTotalAmount` / `cbc:TaxInclusiveAmount`).
   - **BT-115** Amount due for payment (`ram:DuePayableAmount` / `cbc:PayableAmount`).
3. **Monetary Representation:**
   All monetary fields are exact decimal strings matching ISO 4217 minor units per FD-1. Floating-point conversions are forbidden.

## Primary Source

- **European Standard EN 16931-1:2017:** *Electronic invoicing - Part 1: Semantic data model of the core elements of an electronic invoice*, §6.1 "Core Invoice Model Business Terms" (BT-1 to BT-115).
- **KoSIT XRechnung Specification:** Coordinating Office for IT Standards (KoSIT) XRechnung Standard v3.0.1, §3 "Semantic Model & Business Rules" (BR-1 to BR-CO-26) and §4 "Syntax Bindings for UBL 2.1 and UN/CEFACT CII".

## Why

Roadmap v1.0 Gate Condition 6 specifies: *"It speaks to the outside world. DATEV export, XRechnung/EN-16931 invoices, one inbound dialect, and the same-foreign-event-same-commit property demonstrated across two peers."*
Defining the exact semantic business terms and primary sources enables deterministic XML invoice generation and schema verification without ambiguity.

## Verification

An outbound invoice export test (`test/xrechnung-export.test.js`) generates UBL 2.1 and CII XML files from a POLISM sales invoice record and validates that:
1. Every mandatory BT (BT-1, BT-2, BT-3, BT-5, BT-10, BT-27, BT-31, BT-44, BT-106, BT-109, BT-110, BT-112, BT-115) is present in the XML.
2. The calculated totals satisfy `BT-109 + BT-110 = BT-112` exactly using string-based BigInt decimal arithmetic.

## What would have to change for this to be wrong

If CEN (European Committee for Standardization) issues a revised standard superseding EN 16931-1:2017 or KoSIT releases a major breaking revision altering the required business terms or mandatory syntax bindings, this decision must be updated to align with the new specification version.
