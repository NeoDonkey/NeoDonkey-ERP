import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXRechnungUblXml, ValidationError } from '../runtime/export/xrechnung-parser.js';
import { toMinor } from '../runtime/money/money.js';

const SAMPLE_VALID_UBL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ID>INV-2026-001</cbc:ID>
  <cbc:IssueDate>2026-01-15</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>12345678-0001-99</cbc:BuyerReference>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>ACME Consulting GmbH</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE123456789</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>Client Enterprises AG</cbc:Name>
      </cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE987654321</cbc:CompanyID>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">950.00</cbc:TaxAmount>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">5000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">5000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">5950.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">5950.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">5000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Software Architecture Consulting</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">500.00</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

test('parseXRechnungUblXml successfully parses valid EN 16931 UBL 2.1 XML e-invoice', () => {
  const result = parseXRechnungUblXml(SAMPLE_VALID_UBL_XML);

  assert.equal(result.invoiceNumber, 'INV-2026-001');
  assert.equal(result.issueDate, '2026-01-15');
  assert.equal(result.invoiceTypeCode, '380');
  assert.equal(result.currency, 'EUR');
  assert.equal(result.buyerReference, '12345678-0001-99');

  assert.equal(result.seller.name, 'ACME Consulting GmbH');
  assert.equal(result.seller.vatId, 'DE123456789');

  assert.equal(result.buyer.name, 'Client Enterprises AG');
  assert.equal(result.buyer.vatId, 'DE987654321');

  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].lineId, '1');
  assert.equal(result.lines[0].quantity, 10n);
  assert.equal(result.lines[0].itemName, 'Software Architecture Consulting');
  assert.equal(toMinor(result.lines[0].lineNetAmount), 500000n);
  assert.equal(toMinor(result.lines[0].itemPrice), 50000n);

  assert.equal(toMinor(result.totals.lineExtensionAmount), 500000n);
  assert.equal(toMinor(result.totals.taxExclusiveAmount), 500000n);
  assert.equal(toMinor(result.totals.taxAmount), 95000n);
  assert.equal(toMinor(result.totals.taxInclusiveAmount), 595000n);
  assert.equal(toMinor(result.totals.payableAmount), 595000n);
});

test('parseXRechnungUblXml rejects invalid/empty inputs and non-XML', () => {
  assert.throws(
    () => parseXRechnungUblXml(''),
    (err) => err instanceof ValidationError && err.code === 'empty-input'
  );

  assert.throws(
    () => parseXRechnungUblXml('<html><body>Hello</body></html>'),
    (err) => err instanceof ValidationError && err.code === 'not-ubl-invoice'
  );
});

test('parseXRechnungUblXml rejects missing mandatory Business Terms with explicit codes', () => {
  const xmlNoBt1 = SAMPLE_VALID_UBL_XML.replace('<cbc:ID>INV-2026-001</cbc:ID>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt1),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-1'
  );

  const xmlNoBt2 = SAMPLE_VALID_UBL_XML.replace('<cbc:IssueDate>2026-01-15</cbc:IssueDate>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt2),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-2'
  );

  const xmlNoBt3 = SAMPLE_VALID_UBL_XML.replace('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt3),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-3'
  );

  const xmlNoBt5 = SAMPLE_VALID_UBL_XML.replace('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt5),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-5'
  );

  const xmlNoBt27 = SAMPLE_VALID_UBL_XML.replace('<cbc:Name>ACME Consulting GmbH</cbc:Name>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt27),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-27'
  );

  const xmlNoBt31 = SAMPLE_VALID_UBL_XML.replace('<cbc:CompanyID>DE123456789</cbc:CompanyID>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt31),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-31'
  );

  // Missing BT-129 InvoicedQuantity
  const xmlNoBt129 = SAMPLE_VALID_UBL_XML.replace('<cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt129),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-129'
  );

  // Missing BT-146 Item Price
  const xmlNoBt146 = SAMPLE_VALID_UBL_XML.replace('<cbc:PriceAmount currencyID="EUR">500.00</cbc:PriceAmount>', '');
  assert.throws(
    () => parseXRechnungUblXml(xmlNoBt146),
    (err) => err instanceof ValidationError && err.code === 'missing-bt-146'
  );
});

test('parseXRechnungUblXml parses large BigInt quantities without double precision loss', () => {
  const largeQtyStr = '9007199254740993'; // 2^53 + 1 (exceeds MAX_SAFE_INTEGER)
  const xmlLargeQty = SAMPLE_VALID_UBL_XML.replace(
    '<cbc:InvoicedQuantity unitCode="HUR">10</cbc:InvoicedQuantity>',
    `<cbc:InvoicedQuantity unitCode="HUR">${largeQtyStr}</cbc:InvoicedQuantity>`
  );

  const result = parseXRechnungUblXml(xmlLargeQty);
  assert.equal(result.lines[0].quantity, 9007199254740993n);
});

test('parseXRechnungUblXml rejects mismatched total arithmetic with ValidationError', () => {
  const xmlBadTaxTotal = SAMPLE_VALID_UBL_XML.replace(
    '<cbc:TaxAmount currencyID="EUR">950.00</cbc:TaxAmount>',
    '<cbc:TaxAmount currencyID="EUR">1000.00</cbc:TaxAmount>'
  );
  assert.throws(
    () => parseXRechnungUblXml(xmlBadTaxTotal),
    (err) => err instanceof ValidationError && err.code === 'mismatched-totals'
  );

  const xmlBadLineSum = SAMPLE_VALID_UBL_XML.replace(
    '<cbc:LineExtensionAmount currencyID="EUR">5000.00</cbc:LineExtensionAmount>',
    '<cbc:LineExtensionAmount currencyID="EUR">4000.00</cbc:LineExtensionAmount>'
  );
  assert.throws(
    () => parseXRechnungUblXml(xmlBadLineSum),
    (err) => err instanceof ValidationError && err.code === 'mismatched-totals'
  );
});
