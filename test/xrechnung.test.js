#!/usr/bin/env node
/**
 * Test: XRechnung XML generator
 */

import assert from 'node:assert';
import { buildXRechnung, XRechnungError } from '../runtime/export/xrechnung.js';

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
};

console.log('\nXRechnung XML Tests\n' + '═'.repeat(50));

await test('validates missing invoice', async () => {
  assert.throws(() => buildXRechnung(null, {}), XRechnungError);
});

await test('validates missing invoice ID', async () => {
  assert.throws(
    () => buildXRechnung({ 'issue-date': '2027-11-03' }, { senderName: 'Test' }),
    /invoice-number/
  );
});

await test('validates missing sender options', async () => {
  assert.throws(
    () => buildXRechnung({ id: 'INV-001', 'issue-date': '2027-11-03' }, {}),
    /senderName/
  );
});

await test('generates valid XRechnung XML structure', async () => {
  const invoice = {
    id: 'INV-2027-0001',
    'invoice-number': '2027-0001',
    'issue-date': '2027-11-03',
    'document-date': '2027-11-03',
    'due-date': '2027-12-03',
    'customer-reference': 'PO-12345',
    lines: [
      {
        description: 'Consulting services',
        quantity: 10,
        'unit-price': 150.00,
        'net-amount': 1500.00,
        'vat-amount': 285.00,
        'vat-rate': 19,
      },
      {
        description: 'Software license',
        quantity: 1,
        'unit-price': 499.00,
        'net-amount': 499.00,
        'vat-amount': 94.81,
        'vat-rate': 19,
      },
    ],
  };

  const xml = buildXRechnung(invoice, {
    senderName: 'NeoDonkey GmbH',
    senderVatId: 'DE123456789',
    senderAddress: 'Musterstraße 1',
    senderCity: 'Berlin',
    senderPostcode: '10115',
    senderCountry: 'DE',
    receiverName: 'Kunde AG',
    receiverVatId: 'DE987654321',
    receiverAddress: 'Hauptstraße 42',
    receiverCity: 'München',
    receiverPostcode: '80331',
    receiverCountry: 'DE',
    currency: 'EUR',
  });

  // Check XML structure
  assert.ok(xml.includes('<?xml version="1.0"'), 'Has XML declaration');
  assert.ok(xml.includes('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2'), 'Has UBL namespace');
  assert.ok(xml.includes('urn:cen.eu:en16931:2017'), 'Has EN 16931 customization');
  assert.ok(xml.includes('xeinkauf.de:kosit:xrechnung_3.0'), 'Has XRechnung 3.0 profile');

  // Check header fields
  assert.ok(xml.includes('<cbc:ID>INV-2027-0001</cbc:ID>'), 'Has invoice ID');
  assert.ok(xml.includes('<cbc:IssueDate>2027-11-03</cbc:IssueDate>'), 'Has issue date');
  assert.ok(xml.includes('<cbc:DueDate>2027-12-03</cbc:DueDate>'), 'Has due date');
  assert.ok(xml.includes('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>'), 'Has type code 380 (invoice)');
  assert.ok(xml.includes('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>'), 'Has currency');

  // Check parties
  assert.ok(xml.includes('NeoDonkey GmbH'), 'Has sender name');
  assert.ok(xml.includes('DE123456789'), 'Has sender VAT');
  assert.ok(xml.includes('Kunde AG'), 'Has receiver name');
  assert.ok(xml.includes('DE987654321'), 'Has receiver VAT');

  // Check line items
  assert.ok(xml.includes('Consulting services'), 'Has line 1 description');
  assert.ok(xml.includes('Software license'), 'Has line 2 description');
  assert.ok(xml.includes('<cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>'), 'Has quantity');

  // Check totals
  assert.ok(xml.includes('1999.00'), 'Has net total');
  assert.ok(xml.includes('379.81'), 'Has tax total');
  assert.ok(xml.includes('2378.81'), 'Has gross total');
});

await test('escapes XML special characters', async () => {
  const invoice = {
    id: 'INV-001',
    'issue-date': '2027-11-03',
    lines: [{ description: 'A & B <C>', 'net-amount': 100, 'vat-amount': 19 }],
  };

  const xml = buildXRechnung(invoice, {
    senderName: 'Test & Co',
    senderVatId: 'DE123',
    senderAddress: 'Str <1>',
    senderCity: 'City',
    senderPostcode: '12345',
    receiverName: 'Receiver',
  });

  assert.ok(xml.includes('Test &amp; Co'), 'Escapes ampersand');
  assert.ok(xml.includes('A &amp; B &lt;C&gt;'), 'Escapes in line item');
});

await test('handles invoice without VAT ID', async () => {
  const invoice = {
    id: 'INV-001',
    'issue-date': '2027-11-03',
    lines: [],
  };

  const xml = buildXRechnung(invoice, {
    senderName: 'Test GmbH',
    senderVatId: 'DE123',
    senderAddress: 'Street 1',
    senderCity: 'City',
    senderPostcode: '12345',
    receiverName: 'Receiver',
  });

  // Should not include PartyTaxScheme for receiver if no VAT ID
  const receiverSection = xml.split('AccountingCustomerParty')[1];
  assert.ok(!receiverSection.includes('PartyTaxScheme'), 'No tax scheme without VAT ID');
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
