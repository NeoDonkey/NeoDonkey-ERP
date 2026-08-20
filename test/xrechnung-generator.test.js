import test from 'node:test';
import assert from 'node:assert/strict';
import { generateXRechnungUblXml, escapeXml } from '../runtime/export/xrechnung.js';

test('escapeXml escapes XML special characters correctly', () => {
  assert.equal(escapeXml('ACME & Co <GmbH> "Test" \'Quote\''), 'ACME &amp; Co &lt;GmbH&gt; &quot;Test&quot; &apos;Quote&apos;');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
});

test('generateXRechnungUblXml generates a compliant EN 16931 UBL 2.1 XML document', () => {
  const invoice = {
    invoiceNumber: 'INV-2026-001',
    issueDate: '2026-08-20',
    dueDate: '2026-09-19',
    invoiceTypeCode: '380',
    currency: 'EUR',
    buyerReference: '992-80123-45',
    seller: {
      name: 'Acme Solutions GmbH & Co. KG',
      vatId: 'DE123456789',
      address: {
        street: 'Hauptstraße 10',
        city: 'Berlin',
        postalCode: '10115',
        countryCode: 'DE'
      },
      contact: {
        name: 'Max Mustermann',
        phone: '+49 30 1234567',
        email: 'billing@acme.de'
      }
    },
    buyer: {
      name: 'TechCorp Europe B.V.',
      vatId: 'NL987654321B01',
      address: {
        street: 'Keizersgracht 100',
        city: 'Amsterdam',
        postalCode: '1015 CJ',
        countryCode: 'NL'
      }
    },
    lines: [
      {
        id: '1',
        name: 'IT Consulting & Development',
        quantity: '10.00',
        unitCode: 'HUR',
        unitPrice: '150.00 EUR',
        lineExtensionAmount: '1500.00 EUR',
        vatCategory: 'S',
        vatRate: '19'
      },
      {
        id: '2',
        name: 'Software License',
        quantity: '1.00',
        unitCode: 'C62',
        unitPrice: '3500.00 EUR',
        lineExtensionAmount: '3500.00 EUR',
        vatCategory: 'S',
        vatRate: '19'
      }
    ],
    vatBreakdown: [
      {
        taxableAmount: '5000.00 EUR',
        taxAmount: '950.00 EUR',
        vatCategory: 'S',
        vatRate: '19'
      }
    ],
    totals: {
      lineExtensionAmount: '5000.00 EUR',
      taxExclusiveAmount: '5000.00 EUR',
      taxAmount: '950.00 EUR',
      taxInclusiveAmount: '5950.00 EUR',
      payableAmount: '5950.00 EUR'
    }
  };

  const xml = generateXRechnungUblXml(invoice);

  // Assert XML structure and namespaces
  assert.ok(/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(xml));
  assert.ok(xml.includes('<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'));
  assert.ok(xml.includes('xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"'));
  assert.ok(xml.includes('xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"'));

  // CustomizationID & ProfileID
  assert.ok(xml.includes('<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>'));

  // Mandatory Business Terms
  assert.ok(xml.includes('<cbc:ID>INV-2026-001</cbc:ID>')); // BT-1
  assert.ok(xml.includes('<cbc:IssueDate>2026-08-20</cbc:IssueDate>')); // BT-2
  assert.ok(xml.includes('<cbc:DueDate>2026-09-19</cbc:DueDate>')); // BT-9
  assert.ok(xml.includes('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>')); // BT-3
  assert.ok(xml.includes('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>')); // BT-5
  assert.ok(xml.includes('<cbc:BuyerReference>992-80123-45</cbc:BuyerReference>')); // BT-10

  // Parties
  assert.ok(xml.includes('Acme Solutions GmbH &amp; Co. KG')); // BT-27
  assert.ok(xml.includes('<cbc:CompanyID>DE123456789</cbc:CompanyID>')); // BT-31
  assert.ok(xml.includes('TechCorp Europe B.V.')); // BT-44
  assert.ok(xml.includes('<cbc:CompanyID>NL987654321B01</cbc:CompanyID>')); // BT-48

  // Totals & Zero Float Formatting
  assert.ok(xml.includes('<cbc:TaxAmount currencyID="EUR">950.00</cbc:TaxAmount>'));
  assert.ok(xml.includes('<cbc:LineExtensionAmount currencyID="EUR">5000.00</cbc:LineExtensionAmount>'));
  assert.ok(xml.includes('<cbc:TaxExclusiveAmount currencyID="EUR">5000.00</cbc:TaxExclusiveAmount>'));
  assert.ok(xml.includes('<cbc:TaxInclusiveAmount currencyID="EUR">5950.00</cbc:TaxInclusiveAmount>'));
  assert.ok(xml.includes('<cbc:PayableAmount currencyID="EUR">5950.00</cbc:PayableAmount>'));

  // Invoice Lines
  assert.ok(xml.includes('<cbc:Name>IT Consulting &amp; Development</cbc:Name>'));
  assert.ok(xml.includes('<cbc:InvoicedQuantity unitCode="HUR">10.00</cbc:InvoicedQuantity>'));
  assert.ok(xml.includes('<cbc:PriceAmount currencyID="EUR">150.00</cbc:PriceAmount>'));
});

test('generateXRechnungUblXml sums multiple VAT breakdown taxAmounts when totals.taxAmount is omitted', () => {
  const invoice = {
    invoiceNumber: 'INV-2026-002',
    issueDate: '2026-08-20',
    buyerReference: 'REF-001',
    seller: { name: 'Seller', address: { countryCode: 'DE' } },
    buyer: { name: 'Buyer', address: { countryCode: 'DE' } },
    lines: [
      { name: 'Standard Line', vatRate: '19', amount: '5000.00 EUR', unitPrice: '5000.00 EUR' },
      { name: 'Reduced Line', vatRate: '7', amount: '2000.00 EUR', unitPrice: '2000.00 EUR' }
    ],
    vatBreakdown: [
      { taxableAmount: '5000.00 EUR', taxAmount: '950.00 EUR', vatCategory: 'S', vatRate: '19' },
      { taxableAmount: '2000.00 EUR', taxAmount: '140.00 EUR', vatCategory: 'AA', vatRate: '7' }
    ]
  };

  const xml = generateXRechnungUblXml(invoice);

  // Assert total tax amount is exactly 950.00 + 140.00 = 1090.00 EUR
  assert.ok(xml.includes('<cac:TaxTotal>\n    <cbc:TaxAmount currencyID="EUR">1090.00</cbc:TaxAmount>'));
});

test('generateXRechnungUblXml throws TypeError on missing mandatory fields or missing vatRate/countryCode/buyerReference', () => {
  assert.throws(() => generateXRechnungUblXml(null), TypeError);
  assert.throws(() => generateXRechnungUblXml({}), /invoiceNumber/);
  assert.throws(() => generateXRechnungUblXml({ invoiceNumber: 'INV-1' }), /issueDate/);
  assert.throws(() => generateXRechnungUblXml({ invoiceNumber: 'INV-1', issueDate: '2026-08-20' }), /buyerReference/);
  assert.throws(() => generateXRechnungUblXml({ invoiceNumber: 'INV-1', issueDate: '2026-08-20', buyerReference: 'REF' }), /seller/);
  assert.throws(() => generateXRechnungUblXml({
    invoiceNumber: 'INV-1',
    issueDate: '2026-08-20',
    buyerReference: 'REF',
    seller: { name: 'Seller' }
  }), /countryCode/);
  assert.throws(() => generateXRechnungUblXml({
    invoiceNumber: 'INV-1',
    issueDate: '2026-08-20',
    buyerReference: 'REF',
    seller: { name: 'Seller', address: { countryCode: 'DE' } },
    buyer: { name: 'Buyer' }
  }), /countryCode/);
  assert.throws(() => generateXRechnungUblXml({
    invoiceNumber: 'INV-1',
    issueDate: '2026-08-20',
    buyerReference: 'REF',
    seller: { name: 'Seller', address: { countryCode: 'DE' } },
    buyer: { name: 'Buyer', address: { countryCode: 'FR' } }
  }), /invoice line/);
  assert.throws(() => generateXRechnungUblXml({
    invoiceNumber: 'INV-1',
    issueDate: '2026-08-20',
    buyerReference: 'REF',
    seller: { name: 'Seller', address: { countryCode: 'DE' } },
    buyer: { name: 'Buyer', address: { countryCode: 'FR' } },
    lines: [{ name: 'Item 1' }]
  }), /vatRate/);
  assert.throws(() => generateXRechnungUblXml({
    invoiceNumber: 'INV-1',
    issueDate: '2026-08-20',
    buyerReference: 'REF',
    seller: { name: 'Seller', address: { countryCode: 'DE' } },
    buyer: { name: 'Buyer', address: { countryCode: 'FR' } },
    lines: [{ name: 'Item 1', vatRate: '19', amount: '100.00 EUR', unitPrice: '100.00 EUR' }]
  }), /vatBreakdown/);
});
