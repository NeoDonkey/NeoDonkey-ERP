#!/usr/bin/env node
/**
 * Test: XRechnung XML generator
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { buildXRechnung, XRechnungError } from '../runtime/export/xrechnung.js';
import { parseXRechnungUblXml } from '../runtime/export/xrechnung-parser.js';
import { money, toMinor } from '../runtime/money/money.js';
import { scanSources } from './_source-guard.js';

/** Options every test fixture shares; individual tests override what they exercise. */
const OPTS = {
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
};

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
    'customer-reference': 'REF-ESC-1',
    lines: [{ description: 'A & B <C>', 'net-amount': 100, 'vat-amount': 19, 'vat-rate': 19 }],
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
    'customer-reference': 'REF-NO-RCVR-VAT',
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

await test('enforces BT-10 BuyerReference (mandatory in XRechnung B2G)', async () => {
  const base = {
    id: 'INV-001',
    'issue-date': '2027-11-03',
    lines: [{ description: 'X', 'net-amount': '1.00', 'vat-amount': '0.19', 'vat-rate': 19 }],
  };

  assert.throws(
    () => buildXRechnung(base, OPTS),
    (e) => e instanceof XRechnungError && /BT-10/.test(e.message) && /customer-reference/.test(e.message),
    'missing customer-reference must throw a BT-10 error'
  );

  assert.throws(
    () => buildXRechnung({ ...base, 'customer-reference': '   ' }, OPTS),
    /BT-10/,
    'blank customer-reference must throw'
  );

  const xml = buildXRechnung({ ...base, 'customer-reference': '04011000-12345' }, OPTS);
  assert.ok(xml.includes('<cbc:BuyerReference>04011000-12345</cbc:BuyerReference>'), 'Emits BuyerReference verbatim');
});

await test('enforces BT-2 issue date format and BT-152 line VAT rate', async () => {
  assert.throws(
    () => buildXRechnung(
      { id: 'INV-001', 'issue-date': '03.11.2027', 'customer-reference': 'R1', lines: [] },
      OPTS
    ),
    /BT-2/,
    'non-ISO issue date must throw a BT-2 error'
  );

  assert.throws(
    () => buildXRechnung(
      {
        id: 'INV-001', 'issue-date': '2027-11-03', 'customer-reference': 'R1',
        lines: [{ description: 'X', 'net-amount': '1.00', 'vat-amount': '0.19' }],
      },
      OPTS
    ),
    /BT-152/,
    'a line without vat-rate must throw a BT-152 error'
  );
});

await test('computes totals in exact BigInt minor units from string tokens and Money', async () => {
  const invoice = {
    id: 'INV-EXACT',
    'issue-date': '2027-11-03',
    'customer-reference': 'REF-EXACT',
    lines: [
      { description: 'A', quantity: 1, 'net-amount': '4999.99 EUR', 'vat-amount': money('949.99 EUR'), 'vat-rate': 19, 'unit-price': '4999.99' },
      { description: 'B', quantity: 1, 'net-amount': money('0.01 EUR'), 'vat-amount': '0.01 EUR', 'vat-rate': 19, 'unit-price': 0.01 },
    ],
  };

  const xml = buildXRechnung(invoice, OPTS);
  assert.ok(xml.includes('<cbc:LineExtensionAmount currencyID="EUR">5000.00</cbc:LineExtensionAmount>'), 'net total is the exact minor-unit sum');
  assert.ok(xml.includes('<cbc:TaxAmount currencyID="EUR">950.00</cbc:TaxAmount>'), 'tax total is the exact minor-unit sum');
  assert.ok(xml.includes('<cbc:TaxInclusiveAmount currencyID="EUR">5950.00</cbc:TaxInclusiveAmount>'), 'gross is net + tax in BigInt');
});

await test('refuses the residue of float arithmetic instead of rounding it', async () => {
  const invoice = {
    id: 'INV-FLOAT',
    'issue-date': '2027-11-03',
    'customer-reference': 'REF-FLOAT',
    lines: [{ description: 'X', quantity: 1, 'net-amount': 0.1 + 0.2, 'vat-amount': 0, 'vat-rate': 19 }],
  };
  assert.throws(
    () => buildXRechnung(invoice, OPTS),
    (e) => e instanceof XRechnungError && /net-amount/.test(e.message),
    '0.1 + 0.2 has more decimal digits than EUR has cents and must be refused'
  );
});

await test('derives unit price exactly, or refuses an inexact derivation (BT-146)', async () => {
  const exact = buildXRechnung({
    id: 'INV-DERIVE',
    'issue-date': '2027-11-03',
    'customer-reference': 'REF-DERIVE',
    lines: [{ description: 'X', quantity: 4, 'net-amount': '100.00', 'vat-amount': '19.00', 'vat-rate': 19 }],
  }, OPTS);
  assert.ok(exact.includes('<cbc:PriceAmount currencyID="EUR">25.00</cbc:PriceAmount>'), '100.00 / 4 derives exactly');

  assert.throws(
    () => buildXRechnung({
      id: 'INV-DERIVE-2',
      'issue-date': '2027-11-03',
      'customer-reference': 'REF-DERIVE',
      lines: [{ description: 'X', quantity: 3, 'net-amount': '100.00', 'vat-amount': '19.00', 'vat-rate': 19 }],
    }, OPTS),
    /BT-146/,
    '100.00 / 3 has no exact 2-decimal price and must not be rounded silently'
  );
});

await test('rejects mixed currencies in line amounts', async () => {
  assert.throws(
    () => buildXRechnung({
      id: 'INV-MIX',
      'issue-date': '2027-11-03',
      'customer-reference': 'REF-MIX',
      lines: [{ description: 'X', quantity: 1, 'net-amount': '10.00 USD', 'vat-amount': '1.90', 'vat-rate': 19 }],
    }, OPTS),
    /mixed currencies/,
    'a USD line on an EUR invoice is an error, never a silent conversion'
  );
});

await test('emits a correct multi-rate VAT breakdown (BG-23 TaxSubtotal)', async () => {
  const invoice = {
    id: 'INV-MULTI',
    'issue-date': '2027-11-03',
    'customer-reference': 'REF-MULTI',
    lines: [
      { description: 'Standard-rated goods', quantity: 1, 'unit-price': '100.00', 'net-amount': '100.00', 'vat-amount': '19.00', 'vat-rate': 19 },
      { description: 'Reduced-rate books', quantity: 2, 'unit-price': '100.00', 'net-amount': '200.00', 'vat-amount': '14.00', 'vat-rate': 7, 'vat-category': 'AA' },
      { description: 'More standard-rated goods', quantity: 1, 'unit-price': '50.00', 'net-amount': '50.00', 'vat-amount': '9.50', 'vat-rate': 19 },
    ],
  };

  const xml = buildXRechnung(invoice, OPTS);

  // One subtotal per (category, rate), taxable and tax as exact sums of their lines
  assert.ok(xml.includes('<cbc:TaxableAmount currencyID="EUR">150.00</cbc:TaxableAmount>'), 'S/19 taxable is 100.00 + 50.00');
  assert.ok(xml.includes('<cbc:TaxAmount currencyID="EUR">28.50</cbc:TaxAmount>'), 'S/19 tax is 19.00 + 9.50');
  assert.ok(xml.includes('<cbc:TaxableAmount currencyID="EUR">200.00</cbc:TaxableAmount>'), 'AA/7 taxable');
  assert.ok(xml.includes('<cbc:TaxAmount currencyID="EUR">14.00</cbc:TaxAmount>'), 'AA/7 tax');
  assert.ok(xml.includes('<cbc:Percent>19</cbc:Percent>') && xml.includes('<cbc:Percent>7</cbc:Percent>'), 'both rates present');
  assert.ok(xml.includes('<cbc:ID>AA</cbc:ID>'), 'non-standard category preserved');

  // Document totals across rates
  assert.ok(xml.includes('<cbc:TaxAmount currencyID="EUR">42.50</cbc:TaxAmount>'), 'total tax is 28.50 + 14.00');
  assert.ok(xml.includes('<cbc:TaxInclusiveAmount currencyID="EUR">392.50</cbc:TaxInclusiveAmount>'), 'gross is 350.00 + 42.50');
});

await test('generated XML round-trips through parseXRechnungUblXml', async () => {
  const invoice = {
    id: 'INV-RT-0001',
    'issue-date': '2027-11-03',
    'due-date': '2027-12-03',
    'customer-reference': 'LEITWEG-04011000-99',
    lines: [
      { description: 'Consulting services', quantity: 10, 'unit-price': '150.00', 'net-amount': '1500.00', 'vat-amount': '285.00', 'vat-rate': 19 },
      { description: 'Reduced-rate books', quantity: 2, 'unit-price': '100.00', 'net-amount': '200.00', 'vat-amount': '14.00', 'vat-rate': 7 },
    ],
  };

  const xml = buildXRechnung(invoice, OPTS);
  const parsed = parseXRechnungUblXml(xml);

  assert.equal(parsed.invoiceNumber, 'INV-RT-0001');
  assert.equal(parsed.issueDate, '2027-11-03');
  assert.equal(parsed.invoiceTypeCode, '380');
  assert.equal(parsed.currency, 'EUR');
  assert.equal(parsed.buyerReference, 'LEITWEG-04011000-99');
  assert.equal(parsed.seller.name, 'NeoDonkey GmbH');
  assert.equal(parsed.seller.vatId, 'DE123456789');
  assert.equal(parsed.buyer.name, 'Kunde AG');
  assert.equal(parsed.buyer.vatId, 'DE987654321');

  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].quantity, 10n);
  assert.equal(toMinor(parsed.lines[0].lineNetAmount), 150000n);
  assert.equal(toMinor(parsed.lines[0].itemPrice), 15000n);
  assert.equal(parsed.lines[0].itemName, 'Consulting services');
  assert.equal(toMinor(parsed.lines[1].lineNetAmount), 20000n);

  assert.equal(toMinor(parsed.totals.lineExtensionAmount), 170000n);
  assert.equal(toMinor(parsed.totals.taxExclusiveAmount), 170000n);
  assert.equal(toMinor(parsed.totals.taxAmount), 29900n);
  assert.equal(toMinor(parsed.totals.taxInclusiveAmount), 199900n);
  assert.equal(toMinor(parsed.totals.payableAmount), 199900n);
});

await test('source guard: no parseFloat, Number( or toFixed on any money path in xrechnung.js', async () => {
  const source = readFileSync(new URL('../runtime/export/xrechnung.js', import.meta.url), 'utf8');
  const forbidden = [
    ['parseFloat', /\bparseFloat\s*\(/, 'float parsing is how 4999.99 stops being 499999 cents — use runtime/money tokens'],
    ['Number(', /\bNumber\s*\(/, 'a monetary value is never a Number (FD-1) — conversion happens exactly once, as decimal text'],
    ['toFixed', /\.toFixed\s*\(/, 'toFixed rounds a float that is already wrong — rendering is formatScaled on BigInt minor units'],
  ];

  const violations = scanSources([['runtime/export/xrechnung.js', source]], forbidden);
  assert.deepEqual(
    violations.map((v) => `${v.file}:${v.line} [${v.rule}]`),
    [],
    violations.map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.text}\n      -> ${v.why}`).join('\n')
  );

  // The guard itself must be able to see the constructs it forbids — a guard that cannot
  // fail is not a guard.
  const fixture = 'const bad = parseFloat(x) + Number(y); const out = z.toFixed(2);';
  assert.equal(scanSources([['fixture.js', fixture]], forbidden).length, 3, 'guard fixture must flag all three constructs');
});

console.log(`\n${'═'.repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
