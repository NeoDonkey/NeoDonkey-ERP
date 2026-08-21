/**
 * Invoice HTML generator — Wave 3, P2 task.
 *
 * Generates a DIN 5008 compliant invoice HTML from NeoDonkey data.
 * Zero dependencies. Works in Node 22+ and in the browser.
 *
 * The template uses Mustache-style {{placeholders}} which this module
 * replaces with actual data. No template engine dependency — simple
 * string replacement is sufficient for a single-page invoice.
 *
 * @module runtime/export/invoice-html
 */

import { buildXRechnung } from './xrechnung.js';

/**
 * @typedef {Object} InvoiceData
 * @property {string} invoiceNumber
 * @property {string} invoiceDate — YYYY-MM-DD
 * @property {string} serviceDate — YYYY-MM-DD
 * @property {string} subject
 * @property {string} paymentDays — default "14"
 * @property {Customer} customer
 * @property {Seller} seller
 * @property {LineItem[]} lineItems
 * @property {string} vatRate — e.g. "19"
 * @property {string} netTotal — formatted amount, e.g. "1.000,00 EUR"
 * @property {string} vatAmount — formatted amount
 * @property {string} grossTotal — formatted amount
 */

/**
 * @typedef {Object} Customer
 * @property {string} name
 * @property {string} street
 * @property {string} zip
 * @property {string} city
 * @property {string} country
 * @property {string} vatId
 * @property {string} number — customer number
 */

/**
 * @typedef {Object} Seller
 * @property {string} name
 * @property {string} street
 * @property {string} zip
 * @property {string} city
 * @property {string} country
 * @property {string} vatId
 * @property {string} iban
 * @property {string} bic
 * @property {string} bankName
 * @property {string} phone
 * @property {string} email
 * @property {string} website
 * @property {string} registration — e.g. "Amtsgericht München HRB 123456"
 * @property {string} managingDirector
 */

/**
 * @typedef {Object} LineItem
 * @property {number} position
 * @property {string} description
 * @property {string} [detail]
 * @property {number} quantity
 * @property {string} unit
 * @property {string} unitPrice — formatted, e.g. "100,00 EUR"
 * @property {string} lineTotal — formatted
 */

/**
 * Simple template engine — replaces {{key}} placeholders with values.
 * Handles arrays with {{#array}}...{{/array}} blocks.
 *
 * @param {string} template
 * @param {object} data
 * @returns {string}
 */
function renderTemplate(template, data) {
  let result = template;

  // Handle array blocks: {{#array}}...{{/array}}
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, block) => {
    const arr = data[key];
    if (!Array.isArray(arr)) return '';
    return arr.map(item => renderTemplate(block, item)).join('');
  });

  // Handle simple placeholders: {{key}} or {{nested.key}}
  result = result.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
    const value = data[key];
    return value !== undefined && value !== null ? String(value) : '';
  });

  return result;
}

/**
 * Flatten a nested object into dot-notation keys.
 * { customer: { name: 'X' } } → { 'customer.name': 'X' }
 */
function flattenObject(obj, prefix = '', result = {}) {
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const value = obj[key];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, fullKey, result);
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

/**
 * Build an invoice HTML document from NeoDonkey data.
 *
 * Flattens nested objects (e.g. customer.name → customer.name) so the
 * simple template engine can resolve them.
 *
 * @param {InvoiceData} data
 * @param {object} [opts]
 * @param {string} [opts.template] — optional custom HTML template
 * @returns {string} complete HTML document
 */
export function buildInvoiceHtml(data, opts = {}) {
  const template = opts.template || DEFAULT_TEMPLATE;
  const flat = flattenObject(data);
  return renderTemplate(template, flat);
}

/**
 * Build both HTML invoice and XRechnung XML from the same data.
 * This ensures both representations are consistent.
 *
 * @param {InvoiceData} data
 * @returns {{html: string, xml: string}}
 */
export async function buildInvoiceBundle(data) {
  const html = buildInvoiceHtml(data);

  // Convert InvoiceData to XRechnung format
  const invoice = {
    id: data.invoiceNumber,
    'invoice-number': data.invoiceNumber,
    'issue-date': data.invoiceDate,
    'due-date': addDays(data.invoiceDate, parseInt(data.paymentDays || '14', 10)),
    currency: 'EUR',
    lines: data.lineItems.map(item => {
      const unitPrice = parseGermanAmount(item.unitPrice);
      const quantity = item.quantity;
      const netAmount = unitPrice * quantity;
      const vatRate = parseInt(data.vatRate, 10);
      const vatAmount = netAmount * (vatRate / 100);
      return {
        description: item.description,
        quantity: quantity,
        'unit-code': mapUnitToUnitCode(item.unit),
        'unit-price': unitPrice,
        'net-amount': netAmount,
        'vat-amount': vatAmount,
        'vat-rate': vatRate,
      };
    }),
  };

  const opts = {
    senderName: data.seller.name,
    senderVatId: data.seller.vatId,
    senderAddress: data.seller.street,
    senderCity: data.seller.city,
    senderPostcode: data.seller.zip,
    senderCountry: 'DE',
    receiverName: data.customer.name,
    receiverVatId: data.customer.vatId,
    receiverAddress: data.customer.street,
    receiverCity: data.customer.city,
    receiverPostcode: data.customer.zip,
    receiverCountry: 'DE',
    currency: 'EUR',
  };

  const xml = buildXRechnung(invoice, opts);
  return { html, xml };
}

// Helper: map German unit names to UN/ECE unit codes
function mapUnitToUnitCode(unit) {
  const map = {
    'Stück': 'C62',
    'Stk.': 'C62',
    'Stk': 'C62',
    'Stunde': 'HUR',
    'Std.': 'HUR',
    'Std': 'HUR',
    'Tag': 'DAY',
    'Tage': 'DAY',
    'Monat': 'MON',
    'Jahr': 'ANN',
    'Meter': 'MTR',
    'm': 'MTR',
    'Kilogramm': 'KGM',
    'kg': 'KGM',
    'Liter': 'LTR',
    'l': 'LTR',
    'Quadratmeter': 'MTK',
    'm²': 'MTK',
  };
  return map[unit] || 'C62';
}

// Helper: parse German formatted amount ("1.000,00 EUR") to number
function parseGermanAmount(str) {
  if (!str) return 0;
  const num = str.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
  return parseFloat(num) || 0;
}

// Helper: add days to a YYYY-MM-DD date
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Default DIN 5008 template (inline for zero dependencies)
const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Rechnung {{invoiceNumber}}</title>
  <style>
    @page { size: A4; margin: 20mm 20mm 20mm 25mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.4;
      color: #000;
      background: #fff;
      width: 210mm;
      min-height: 297mm;
      padding: 20mm 20mm 20mm 25mm;
      margin: 0 auto;
    }
    .address-block {
      position: absolute;
      left: 25mm;
      top: 45mm;
      width: 85mm;
    }
    .sender-line {
      font-size: 9pt;
      color: #666;
      margin-bottom: 2mm;
    }
    .recipient {
      font-size: 11pt;
      line-height: 1.5;
    }
    .header-info {
      position: absolute;
      left: 120mm;
      top: 45mm;
      width: 65mm;
    }
    .header-info table {
      width: 100%;
      font-size: 10pt;
    }
    .header-info td:first-child {
      color: #666;
      padding-right: 8mm;
      white-space: nowrap;
    }
    .header-info td {
      padding-bottom: 2mm;
      vertical-align: top;
    }
    .main-content {
      margin-top: 85mm;
    }
    h1 {
      font-size: 14pt;
      font-weight: bold;
      margin-bottom: 8mm;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
    }
    .subject-line {
      font-size: 11pt;
      margin-bottom: 8mm;
      font-weight: bold;
    }
    .intro-text {
      margin-bottom: 8mm;
    }
    .invoice-table {
      width: 100%;
      border-collapse: collapse;
      margin: 8mm 0;
      font-size: 10pt;
    }
    .invoice-table th {
      border-bottom: 1pt solid #000;
      padding: 3mm 2mm;
      text-align: left;
      font-weight: bold;
    }
    .invoice-table td {
      padding: 3mm 2mm;
      border-bottom: 0.5pt solid #ccc;
      vertical-align: top;
    }
    .invoice-table .num {
      text-align: right;
      white-space: nowrap;
    }
    .invoice-table .total-row td {
      border-top: 1pt solid #000;
      border-bottom: none;
      font-weight: bold;
    }
    .summary {
      width: 60%;
      margin-left: auto;
      margin-top: 8mm;
    }
    .summary table {
      width: 100%;
      font-size: 10pt;
    }
    .summary td:first-child {
      text-align: left;
      padding-right: 8mm;
    }
    .summary td {
      text-align: right;
      padding: 2mm 0;
    }
    .summary .grand-total {
      font-weight: bold;
      font-size: 11pt;
      border-top: 1pt solid #000;
      padding-top: 3mm;
    }
    .footer {
      margin-top: 20mm;
      padding-top: 5mm;
      border-top: 0.5pt solid #ccc;
      font-size: 9pt;
      color: #666;
      display: flex;
      justify-content: space-between;
    }
    .footer-col {
      flex: 1;
    }
    .footer-col strong {
      color: #000;
      display: block;
      margin-bottom: 2mm;
    }
    @media print {
      body { padding: 0; width: 100%; }
      .address-block, .header-info { position: static; margin-bottom: 10mm; }
      .main-content { margin-top: 0; }
    }
  </style>
</head>
<body>
  <div class="address-block">
    <div class="sender-line">
      {{seller.name}} · {{seller.street}} · {{seller.zip}} {{seller.city}}
    </div>
    <div class="recipient">
      <strong>{{customer.name}}</strong><br>
      {{customer.street}}<br>
      {{customer.zip}} {{customer.city}}<br>
      {{customer.country}}
    </div>
  </div>

  <div class="header-info">
    <table>
      <tr><td>Rechnungs-Nr.:</td><td>{{invoiceNumber}}</td></tr>
      <tr><td>Rechnungsdatum:</td><td>{{invoiceDate}}</td></tr>
      <tr><td>Leistungsdatum:</td><td>{{serviceDate}}</td></tr>
      <tr><td>Kunden-Nr.:</td><td>{{customerNumber}}</td></tr>
      <tr><td>USt-IdNr.:</td><td>{{seller.vatId}}</td></tr>
    </table>
  </div>

  <div class="main-content">
    <h1>Rechnung</h1>
    <p class="subject-line">Rechnung {{invoiceNumber}} — {{subject}}</p>
    <p class="intro-text">
      Sehr geehrte Damen und Herren,<br><br>
      wir erlauben uns, Ihnen für die erbrachten Leistungen wie folgt zu berechnen:
    </p>

    <table class="invoice-table">
      <thead>
        <tr>
          <th>Pos.</th>
          <th>Bezeichnung</th>
          <th class="num">Menge</th>
          <th class="num">Einheit</th>
          <th class="num">Preis</th>
          <th class="num">Betrag</th>
        </tr>
      </thead>
      <tbody>
        {{#lineItems}}
        <tr>
          <td>{{position}}</td>
          <td>{{description}}<br><small>{{detail}}</small></td>
          <td class="num">{{quantity}}</td>
          <td class="num">{{unit}}</td>
          <td class="num">{{unitPrice}}</td>
          <td class="num">{{lineTotal}}</td>
        </tr>
        {{/lineItems}}
      </tbody>
    </table>

    <div class="summary">
      <table>
        <tr><td>Zwischensumme (netto):</td><td>{{netTotal}}</td></tr>
        <tr><td>zzgl. {{vatRate}}% MwSt.:</td><td>{{vatAmount}}</td></tr>
        <tr class="grand-total"><td>Gesamtbetrag (brutto):</td><td>{{grossTotal}}</td></tr>
      </table>
    </div>

    <p style="margin-top: 15mm;">
      <strong>Zahlungsbedingungen:</strong> Zahlbar innerhalb von {{paymentDays}} Tagen ab Rechnungsdatum ohne Abzug.<br><br>
      <strong>Bankverbindung:</strong><br>
      {{seller.name}}<br>
      IBAN: {{seller.iban}}<br>
      BIC: {{seller.bic}}<br>
      Bank: {{seller.bankName}}
    </p>
  </div>

  <div class="footer">
    <div class="footer-col">
      <strong>{{seller.name}}</strong>
      {{seller.street}}<br>
      {{seller.zip}} {{seller.city}}<br>
      {{seller.country}}
    </div>
    <div class="footer-col">
      <strong>Kontakt</strong>
      Tel: {{seller.phone}}<br>
      E-Mail: {{seller.email}}<br>
      Web: {{seller.website}}
    </div>
    <div class="footer-col">
      <strong>Rechtliches</strong>
      {{seller.registration}}<br>
      USt-IdNr.: {{seller.vatId}}<br>
      Geschäftsführer: {{seller.managingDirector}}
    </div>
  </div>
</body>
</html>`;
