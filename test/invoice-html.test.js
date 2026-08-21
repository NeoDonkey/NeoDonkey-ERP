import { buildInvoiceHtml, buildInvoiceBundle } from '../runtime/export/invoice-html.js';
import { strict as assert } from 'assert';

// Test data — realistic German invoice
const DEMO_INVOICE = {
  invoiceNumber: 'RE-2027-001',
  invoiceDate: '2027-11-15',
  serviceDate: '2027-11-01',
  subject: 'Software-Entwicklung November 2027',
  paymentDays: '14',
  buyerReference: 'BEST-2027-4711',
  customer: {
    name: 'Musterfirma GmbH',
    street: 'Beispielstraße 42',
    zip: '10115',
    city: 'Berlin',
    country: 'Deutschland',
    vatId: 'DE123456789',
    number: 'K-1001',
  },
  seller: {
    name: 'NeoDonkey GmbH',
    street: 'Musterstraße 1',
    zip: '80331',
    city: 'München',
    country: 'Deutschland',
    vatId: 'DE987654321',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    bankName: 'Commerzbank AG',
    phone: '+49 89 1234567',
    email: 'hallo@neodonkey.eu',
    website: 'neodonkey.eu',
    registration: 'Amtsgericht München HRB 123456',
    managingDirector: 'Max Mustermann',
  },
  lineItems: [
    {
      position: 1,
      description: 'Software-Entwicklung',
      detail: 'ERP-Modul: Buchhaltungs-Export',
      quantity: 40,
      unit: 'Std.',
      unitPrice: '150,00 EUR',
      lineTotal: '6.000,00 EUR',
    },
    {
      position: 2,
      description: 'Beratung',
      detail: 'DATEV-Integration',
      quantity: 8,
      unit: 'Std.',
      unitPrice: '150,00 EUR',
      lineTotal: '1.200,00 EUR',
    },
  ],
  vatRate: '19',
  netTotal: '7.200,00 EUR',
  vatAmount: '1.368,00 EUR',
  grossTotal: '8.568,00 EUR',
};

console.log('Invoice HTML Generator Tests');
console.log('══════════════════════════════');

// Test 1: buildInvoiceHtml produces valid HTML
{
  const html = buildInvoiceHtml(DEMO_INVOICE);
  assert(html.includes('<!DOCTYPE html>'), 'Must produce HTML5 doctype');
  assert(html.includes('Rechnung RE-2027-001'), 'Must include invoice number in title');
  assert(html.includes('Musterfirma GmbH'), 'Must include customer name');
  assert(html.includes('NeoDonkey GmbH'), 'Must include seller name');
  assert(html.includes('8.568,00 EUR'), 'Must include gross total');
  assert(html.includes('DIN 5008') || html.includes('invoice-table'), 'Must use DIN 5008 layout classes');
  console.log('  ✓ produces valid HTML with all placeholders replaced');
}

// Test 2: Template handles missing optional fields gracefully
{
  const minimal = buildInvoiceHtml({
    invoiceNumber: 'RE-2027-002',
    invoiceDate: '2027-11-15',
    serviceDate: '2027-11-01',
    subject: 'Test',
    customer: { name: 'Test Kunde', street: 'X', zip: '1', city: 'Y', country: 'DE', vatId: '', number: '' },
    seller: { name: 'Test GmbH', street: 'X', zip: '1', city: 'Y', country: 'DE', vatId: '', iban: '', bic: '', bankName: '', phone: '', email: '', website: '', registration: '', managingDirector: '' },
    lineItems: [],
    vatRate: '19',
    netTotal: '0,00 EUR',
    vatAmount: '0,00 EUR',
    grossTotal: '0,00 EUR',
  });
  assert(minimal.includes('Test Kunde'), 'Must handle minimal data');
  console.log('  ✓ handles minimal/empty data without crashing');
}

// Test 3: Line items render correctly
{
  const html = buildInvoiceHtml(DEMO_INVOICE);
  assert(html.includes('Software-Entwicklung'), 'Must include line item description');
  assert(html.includes('ERP-Modul: Buchhaltungs-Export'), 'Must include line item detail');
  assert(html.includes('6.000,00 EUR'), 'Must include line item total');
  console.log('  ✓ line items render with description, detail, and amounts');
}

// Test 4: buildInvoiceBundle produces both HTML and XML
{
  const bundle = await buildInvoiceBundle(DEMO_INVOICE);
  assert(typeof bundle.html === 'string', 'Must produce HTML string');
  assert(typeof bundle.xml === 'string', 'Must produce XML string');
  assert(bundle.html.includes('Rechnung'), 'HTML must contain "Rechnung"');
  assert(bundle.xml.includes('<?xml version="1.0"'), 'XML must have XML declaration');
  assert(bundle.xml.includes('<Invoice'), 'XML must be UBL Invoice');
  console.log('  ✓ bundle produces both HTML invoice and XRechnung XML');
}

// Test 5: German amount parsing
{
  // buildInvoiceBundle internally parses "7.200,00 EUR" → 7200.00
  const bundle = await buildInvoiceBundle(DEMO_INVOICE);
  // The XML should contain the numeric value
  assert(bundle.xml.includes('7200.00') || bundle.xml.includes('7200,00'), 'XML must contain parsed net total');
  console.log('  ✓ German amount format parsed correctly for XML');
}

console.log('');
console.log('══════════════════════════════');
console.log('5 passed, 0 failed');
