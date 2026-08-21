/**
 * runtime/export/xrechnung.js — XRechnung XML generator (EN 16931 / UBL 2.1)
 *
 * XRechnung is the German standard for electronic invoicing, mandatory for:
 *   • B2G (business-to-government) since 2020
 *   • B2B (business-to-business) from 2025 onwards
 *
 * This module generates valid XRechnung 3.0 XML from NeoDonkey invoice data.
 * It does NOT validate against the full XSD — that is the caller's responsibility.
 *
 * Reference: https://xeinkauf.de/xrechnung/
 */

import { DatevError } from './datev-extf.js';

export class XRechnungError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XRechnungError';
  }
}

/**
 * Generate XRechnung XML from a NeoDonkey sales invoice.
 *
 * @param {object} invoice — NeoDonkey invoice document
 * @param {object} opts
 * @param {string} opts.senderName — Sender company name
 * @param {string} opts.senderVatId — Sender VAT ID (DE123456789)
 * @param {string} opts.senderAddress — Sender street address
 * @param {string} opts.senderCity — Sender city
 * @param {string} opts.senderPostcode — Sender postcode
 * @param {string} opts.senderCountry — Sender country code (default 'DE')
 * @param {string} opts.receiverName — Receiver company name
 * @param {string} opts.receiverVatId — Receiver VAT ID
 * @param {string} opts.receiverAddress — Receiver street address
 * @param {string} opts.receiverCity — Receiver city
 * @param {string} opts.receiverPostcode — Receiver postcode
 * @param {string} opts.receiverCountry — Receiver country code (default 'DE')
 * @param {string} opts.currency — Invoice currency (default 'EUR')
 * @returns {string} XML document
 */
export function buildXRechnung(invoice, opts = {}) {
  validateInvoice(invoice);
  validateOpts(opts);

  const {
    senderName, senderVatId, senderAddress, senderCity, senderPostcode, senderCountry = 'DE',
    receiverName, receiverVatId, receiverAddress, receiverCity, receiverPostcode, receiverCountry = 'DE',
    currency = 'EUR',
  } = opts;

  const issueDate = invoice['issue-date'] || invoice['document-date'];
  const invoiceId = invoice.id || invoice['invoice-number'];
  const dueDate = invoice['due-date'] || '';

  const lines = invoice.lines || [];
  const lineItems = lines.map((line, idx) => buildLineItem(line, idx + 1, currency));

  const netTotal = lines.reduce((sum, l) => sum + (l['net-amount'] || 0), 0);
  const taxTotal = lines.reduce((sum, l) => sum + (l['vat-amount'] || 0), 0);
  const grossTotal = netTotal + taxTotal;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(invoiceId)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  ${dueDate ? `<cbc:DueDate>${dueDate}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escapeXml(invoice['customer-reference'] || '0000')}</cbc:BuyerReference>

  <!-- Sender (Supplier) -->
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(senderName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(senderAddress)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(senderCity)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(senderPostcode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${senderCountry}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(senderVatId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <!-- Receiver (Customer) -->
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(receiverName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(receiverAddress)}</cbc:StreetName>
        <cbc:CityName>${escapeXml(receiverCity)}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(receiverPostcode)}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${receiverCountry}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      ${receiverVatId ? `
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(receiverVatId)}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>

  <!-- Payment Means -->
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentDueDate>${dueDate || issueDate}</cbc:PaymentDueDate>
  </cac:PaymentMeans>

  <!-- Line Items -->
${lineItems.join('\n')}

  <!-- Tax Total -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${formatDecimal(taxTotal)}</cbc:TaxAmount>
  </cac:TaxTotal>

  <!-- Legal Totals -->
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatDecimal(netTotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${formatDecimal(netTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${formatDecimal(grossTotal)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${formatDecimal(grossTotal)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

  return xml;
}

function buildLineItem(line, position, currency) {
  const name = line.description || line['article-name'] || 'Item';
  const qty = line.quantity || 1;
  const net = line['net-amount'] || 0;
  const vat = line['vat-amount'] || 0;
  const unitPrice = line['unit-price'] || (net / qty);
  const vatRate = line['vat-rate'] || 19;

  return `  <cac:InvoiceLine>
    <cbc:ID>${position}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatDecimal(net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${vatRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${formatDecimal(unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

function validateInvoice(invoice) {
  if (!invoice) throw new XRechnungError('Invoice is required');
  if (!invoice.id && !invoice['invoice-number']) {
    throw new XRechnungError('Invoice must have an id or invoice-number');
  }
  if (!invoice['issue-date'] && !invoice['document-date']) {
    throw new XRechnungError('Invoice must have an issue-date or document-date');
  }
}

function validateOpts(opts) {
  const required = ['senderName', 'senderVatId', 'senderAddress', 'senderCity', 'senderPostcode'];
  for (const key of required) {
    if (!opts[key]) throw new XRechnungError(`Missing required option: ${key}`);
  }
  if (!opts.receiverName) throw new XRechnungError('Missing required option: receiverName');
}

function escapeXml(str) {
  if (typeof str !== 'string') str = String(str || '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDecimal(n) {
  if (typeof n === 'string') n = parseFloat(n);
  if (isNaN(n)) return '0.00';
  return n.toFixed(2);
}
