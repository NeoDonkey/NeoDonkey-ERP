// test/xrechnung-generator.test.js — Tests for outbound EN 16931 / XRechnung UBL 2.1 XML Generator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateXRechnungUblXml, ValidationError } from '../runtime/export/xrechnung-generator.js';
import { parseXRechnungUblXml } from '../runtime/export/xrechnung-parser.js';
import { money } from '../runtime/money/money.js';

test('generateXRechnungUblXml produces valid UBL 2.1 XML and round-trips with parseXRechnungUblXml', () => {
  const invoice = {
    invoiceNumber: 'INV-2026-001',
    issueDate: '2026-08-21',
    invoiceTypeCode: '380',
    currency: 'EUR',
    buyerReference: 'DE-123456789-01',
    seller: {
      name: 'Acme Accounting GmbH & Co. KG',
      vatId: 'DE999999999'
    },
    buyer: {
      name: 'Musterfrau Systems Ltd.',
      vatId: 'DE888888888'
    },
    lines: [
      {
        lineId: '1',
        unitCode: 'C62',
        quantity: 10n,
        lineNetAmount: money('100.00 EUR'),
        itemName: 'ERP Consulting Services & Licenses',
        itemPrice: money('10.00 EUR'),
        vatCategory: 'S',
        vatPercent: '19'
      },
      {
        lineId: '2',
        unitCode: 'C62',
        quantity: '5',
        lineNetAmount: money('50.00 EUR'),
        itemName: 'Support Ticket Pack <10x>',
        itemPrice: money('10.00 EUR'),
        vatCategory: 'S',
        vatPercent: '19'
      }
    ],
    totals: {
      lineExtensionAmount: money('150.00 EUR'),
      taxExclusiveAmount: money('150.00 EUR'),
      taxAmount: money('28.50 EUR'),
      taxInclusiveAmount: money('178.50 EUR'),
      payableAmount: money('178.50 EUR')
    }
  };

  const xml = generateXRechnungUblXml(invoice);

  assert.ok(typeof xml === 'string', 'XML output must be string');
  assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'Must contain XML declaration');
  assert.ok(xml.includes('urn:xoev-de:kosit:standard:xrechnung_3.0'), 'Must contain XRechnung 3.0 CustomizationID');
  assert.ok(xml.includes('<cbc:ID>INV-2026-001</cbc:ID>'), 'Must include invoice number');
  assert.ok(xml.includes('&amp; Co. KG'), 'Must escape special XML characters');
  assert.ok(xml.includes('&lt;10x&gt;'), 'Must escape item name tags');

  // Verify EN 16931 BG-23 TaxSubtotal presence
  assert.ok(xml.includes('<cac:TaxSubtotal>'), 'Must include cac:TaxSubtotal element');
  assert.ok(xml.includes('<cbc:TaxableAmount currencyID="EUR">150.00</cbc:TaxableAmount>'), 'Must include TaxableAmount in TaxSubtotal');
  assert.ok(xml.includes('<cac:ClassifiedTaxCategory>'), 'Must include ClassifiedTaxCategory in item');

  // Round-trip verification: Pass generated XML into parseXRechnungUblXml
  const parsed = parseXRechnungUblXml(xml);

  assert.equal(parsed.invoiceNumber, invoice.invoiceNumber);
  assert.equal(parsed.issueDate, invoice.issueDate);
  assert.equal(parsed.invoiceTypeCode, invoice.invoiceTypeCode);
  assert.equal(parsed.currency, invoice.currency);
  assert.equal(parsed.buyerReference, invoice.buyerReference);
  assert.equal(parsed.seller.name, 'Acme Accounting GmbH & Co. KG');
  assert.equal(parsed.seller.vatId, invoice.seller.vatId);
  assert.equal(parsed.buyer.name, invoice.buyer.name);
  assert.equal(parsed.buyer.vatId, invoice.buyer.vatId);

  assert.equal(parsed.lines.length, 2);
  assert.equal(parsed.lines[0].quantity, 10n);
  assert.equal(parsed.lines[0].lineNetAmount.toString(), '100.00 EUR');
  assert.equal(parsed.lines[0].itemName, 'ERP Consulting Services & Licenses');
  assert.equal(parsed.lines[1].quantity, 5n);
  assert.equal(parsed.lines[1].lineNetAmount.toString(), '50.00 EUR');

  assert.equal(parsed.totals.lineExtensionAmount.toString(), '150.00 EUR');
  assert.equal(parsed.totals.taxAmount.toString(), '28.50 EUR');
  assert.equal(parsed.totals.payableAmount.toString(), '178.50 EUR');
});

test('generateXRechnungUblXml rejects missing or invalid mandatory fields with ValidationError', () => {
  assert.throws(() => generateXRechnungUblXml(null), (err) => err instanceof ValidationError && err.code === 'empty-input');

  const validInvoice = () => ({
    invoiceNumber: 'INV-100',
    issueDate: '2026-08-21',
    invoiceTypeCode: '380',
    currency: 'EUR',
    seller: { name: 'Seller GmbH', vatId: 'DE123456789' },
    buyer: { name: 'Buyer AG' },
    lines: [
      { quantity: 1n, lineNetAmount: '10.00 EUR', itemName: 'Item A', itemPrice: '10.00 EUR' }
    ],
    totals: {
      lineExtensionAmount: '10.00 EUR',
      taxExclusiveAmount: '10.00 EUR',
      taxAmount: '1.90 EUR',
      taxInclusiveAmount: '11.90 EUR',
      payableAmount: '11.90 EUR'
    }
  });

  // Missing invoiceNumber
  const inv1 = validInvoice();
  delete inv1.invoiceNumber;
  assert.throws(() => generateXRechnungUblXml(inv1), (err) => err instanceof ValidationError && err.code === 'missing-bt-1');

  // Invalid issueDate format
  const inv2 = validInvoice();
  inv2.issueDate = '2026/08/21';
  assert.throws(() => generateXRechnungUblXml(inv2), (err) => err instanceof ValidationError && err.code === 'missing-bt-2');

  // Currency mismatch in totals
  const inv3 = validInvoice();
  inv3.totals.payableAmount = '11.90 USD';
  assert.throws(() => generateXRechnungUblXml(inv3), (err) => err instanceof ValidationError && err.code === 'currency-mismatch');

  // Missing seller
  const inv4 = validInvoice();
  delete inv4.seller;
  assert.throws(() => generateXRechnungUblXml(inv4), (err) => err instanceof ValidationError && err.code === 'missing-supplier');

  // Empty lines array
  const inv5 = validInvoice();
  inv5.lines = [];
  assert.throws(() => generateXRechnungUblXml(inv5), (err) => err instanceof ValidationError && err.code === 'missing-invoice-lines');
});
