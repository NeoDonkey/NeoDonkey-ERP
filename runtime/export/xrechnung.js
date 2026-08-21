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
 * Money discipline (FD-1, decision record 2026-08-18-en16931 §4): every amount that
 * enters this module is converted exactly once, at the boundary, into a BigInt count
 * of minor units via runtime/money; every amount that leaves is rendered with
 * formatScaled. There is no parseFloat, no Number arithmetic and no toFixed on a
 * monetary path — the test suite greps this file to keep it true.
 *
 * Reference: https://xeinkauf.de/xrechnung/
 */

import { isMoney, toMoney, fromMinor, add, sum, scaleOf } from '../money/money.js';
import { formatScaled } from '../money/decimal.js';

export class XRechnungError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XRechnungError';
  }
}

/** A bare decimal at the boundary: optional "-", digits, optional fraction. Nothing else. */
const DECIMAL_TEXT_RE = /^-?\d+(\.\d+)?$/;

/** ISO 8601 calendar date, the only form BT-2 / BT-8 accept. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Generate XRechnung XML from a NeoDonkey sales invoice.
 *
 * Monetary line fields ('net-amount', 'vat-amount', 'unit-price') accept a Money, a
 * canonical token ("4999.99 EUR"), a bare exact decimal string ("4999.99") or a finite
 * number that converts exactly (1500, 94.81). A number that does not survive exact
 * decimal conversion — the residue of float arithmetic — is refused with a descriptive
 * error rather than rounded into a wrong amount.
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
  validateBuyerReference(invoice);

  const {
    senderName, senderVatId, senderAddress, senderCity, senderPostcode, senderCountry = 'DE',
    receiverName, receiverVatId, receiverAddress, receiverCity, receiverPostcode, receiverCountry = 'DE',
    currency = 'EUR',
  } = opts;

  currencyScale(currency); // throws on an unknown or malformed ISO 4217 code

  const issueDate = invoice['issue-date'] || invoice['document-date'];
  const invoiceId = invoice.id || invoice['invoice-number'];
  const dueDate = invoice['due-date'] || '';

  const lines = invoice.lines || [];
  const lineItems = lines.map((line, idx) => buildLineItem(line, idx + 1, currency));

  // Totals are BigInt minor-unit sums — never a float reduce (FD-1).
  const netTotal = sum(lines.map((line, idx) => amountOf(line['net-amount'], currency, `line ${String(idx + 1)} net-amount (BT-131)`)), currency);
  const taxTotal = sum(lines.map((line, idx) => vatAmountOf(line, idx + 1, currency)), currency);
  const grossTotal = add(netTotal, taxTotal);

  const taxSubtotals = buildTaxSubtotals(lines, currency);

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
  <cbc:BuyerReference>${escapeXml(invoice['customer-reference'])}</cbc:BuyerReference>

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

  <!-- Tax Total with VAT breakdown (BG-23) -->
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${formatAmount(taxTotal)}</cbc:TaxAmount>
${taxSubtotals}
  </cac:TaxTotal>

  <!-- Legal Totals -->
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatAmount(netTotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${formatAmount(netTotal)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${formatAmount(grossTotal)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${formatAmount(grossTotal)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

  return xml;
}

function buildLineItem(line, position, currency) {
  const name = line.description || line['article-name'] || 'Item';
  const qty = line.quantity ?? 1;
  const net = amountOf(line['net-amount'], currency, `line ${String(position)} net-amount (BT-131)`);
  const vatRate = vatRateOf(line, position);
  const unitPrice = line['unit-price'] !== undefined && line['unit-price'] !== null
    ? amountOf(line['unit-price'], currency, `line ${String(position)} unit-price (BT-146)`)
    : deriveUnitPrice(net, qty, position);

  return `  <cac:InvoiceLine>
    <cbc:ID>${position}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${escapeXml(String(qty))}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${formatAmount(net)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${escapeXml(vatCategoryOf(line))}</cbc:ID>
        <cbc:Percent>${escapeXml(vatRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${formatAmount(unitPrice)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
}

/**
 * The EN 16931 VAT breakdown (BG-23): one TaxSubtotal per (category, rate) pair, in
 * first-appearance order so the output is deterministic. Taxable and tax amounts are
 * BigInt sums of the lines in the group — the same minor units, never recomputed in floats.
 */
function buildTaxSubtotals(lines, currency) {
  const groups = new Map();
  lines.forEach((line, idx) => {
    const category = vatCategoryOf(line);
    const rate = vatRateOf(line, idx + 1);
    const key = `${category}|${rate}`;
    const net = amountOf(line['net-amount'], currency, `line ${String(idx + 1)} net-amount (BT-131)`);
    const vat = vatAmountOf(line, idx + 1, currency);
    const group = groups.get(key) || { category, rate, taxable: null, tax: null };
    group.taxable = group.taxable === null ? net : add(group.taxable, net);
    group.tax = group.tax === null ? vat : add(group.tax, vat);
    groups.set(key, group);
  });

  return [...groups.values()].map((group) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${formatAmount(group.taxable)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${formatAmount(group.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${escapeXml(group.category)}</cbc:ID>
        <cbc:Percent>${escapeXml(group.rate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join('\n');
}

/**
 * Convert one inbound amount to Money exactly once. A Number is accepted only when its
 * decimal rendering is exact at the currency's scale — `94.81` becomes 9481n cents, while
 * the residue of float arithmetic (0.1 + 0.2) is refused, because rounding it here would
 * hide the defect that produced it.
 */
function amountOf(value, currency, fieldName) {
  if (value === undefined || value === null) {
    throw new XRechnungError(`${fieldName} is required: pass a Money, "4999.99 ${currency}", or an exact decimal`);
  }
  if (isMoney(value) || (typeof value === 'string' && value.includes(' '))) {
    let m;
    try {
      m = toMoney(value);
    } catch (e) {
      throw new XRechnungError(`${fieldName}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (m.currency !== currency) {
      throw new XRechnungError(`${fieldName} is ${m.toString()} but the invoice currency is ${currency}: mixed currencies never combine silently (FD-1)`);
    }
    return m;
  }
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !DECIMAL_TEXT_RE.test(text.trim())) {
    throw new XRechnungError(`${fieldName} must be an exact decimal amount — a Money, "4999.99 ${currency}", or "4999.99" — got ${JSON.stringify(value)}. A number with more digits than the currency's scale is the residue of float arithmetic and is refused, not rounded.`);
  }
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-');
  const [intPart, fracPart = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  const scale = currencyScale(currency);
  if (fracPart.length > scale) {
    throw new XRechnungError(`${fieldName} "${trimmed}" has more than ${String(scale)} decimal digits for ${currency} — an amount is exact or it is an error, it is never silently rounded`);
  }
  const minor = BigInt(intPart + fracPart.padEnd(scale, '0'));
  // "-0.00" from a foreign system maps to zero explicitly here, at the boundary (FD-1).
  return fromMinor(negative && minor !== 0n ? -minor : minor, currency);
}

/** A line's VAT amount; absent means zero (an exempt line carries no tax). */
function vatAmountOf(line, position, currency) {
  if (line['vat-amount'] === undefined || line['vat-amount'] === null) {
    return fromMinor(0n, currency);
  }
  return amountOf(line['vat-amount'], currency, `line ${String(position)} vat-amount`);
}

/** BT-151 (invoiced item VAT category code); 'S' (standard rate) when the line does not say. */
function vatCategoryOf(line) {
  const category = line['vat-category'] ?? 'S';
  return String(category);
}

/** BT-152 (invoiced item VAT rate) is mandatory — an invoice line without one is invalid. */
function vatRateOf(line, position) {
  const rate = line['vat-rate'];
  if (rate === undefined || rate === null || String(rate).trim() === '') {
    throw new XRechnungError(`line ${String(position)} is missing vat-rate (mandatory Business Term BT-152, Invoiced Item VAT Rate)`);
  }
  return String(rate);
}

/**
 * BT-146 defaults to net ÷ quantity, but only when that division is exact at the
 * currency's minor unit. A line of 100.00 EUR over 3 pieces has no exact 2-decimal unit
 * price; silently emitting 33.33 would make the document add up to something it is not,
 * so the caller must state the price.
 */
function deriveUnitPrice(net, qty, position) {
  let units;
  try {
    units = typeof qty === 'bigint' ? qty : BigInt(String(qty));
  } catch {
    throw new XRechnungError(`line ${String(position)}: cannot derive unit-price from a non-integer quantity (${JSON.stringify(qty)}); provide 'unit-price' explicitly (BT-146)`);
  }
  if (units <= 0n) {
    throw new XRechnungError(`line ${String(position)}: quantity must be positive to derive unit-price; provide 'unit-price' explicitly (BT-146)`);
  }
  if (net.minor % units !== 0n) {
    throw new XRechnungError(`line ${String(position)}: net-amount ${net.toString()} is not divisible by quantity ${units.toString()} at the minor unit — provide 'unit-price' explicitly (BT-146) rather than accepting a rounded price`);
  }
  return fromMinor(net.minor / units, net.currency);
}

/** The ISO 4217 minor-unit scale, with a generator-level error for a bad currency. */
function currencyScale(currency) {
  try {
    return scaleOf(currency);
  } catch (e) {
    throw new XRechnungError(`invalid invoice currency: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Money → exact decimal text for the XML wire. BigInt and string work only. */
function formatAmount(m) {
  return formatScaled(m.minor, scaleOf(m.currency));
}

function validateInvoice(invoice) {
  if (!invoice) throw new XRechnungError('Invoice is required');
  if (!invoice.id && !invoice['invoice-number']) {
    throw new XRechnungError('Invoice must have an id or invoice-number (mandatory Business Term BT-1)');
  }
  if (!invoice['issue-date'] && !invoice['document-date']) {
    throw new XRechnungError('Invoice must have an issue-date or document-date (mandatory Business Term BT-2)');
  }
  const issueDate = invoice['issue-date'] || invoice['document-date'];
  if (!ISO_DATE_RE.test(issueDate)) {
    throw new XRechnungError(`Invoice issue-date must be an ISO 8601 date (YYYY-MM-DD), got ${JSON.stringify(issueDate)} (mandatory Business Term BT-2)`);
  }
}

function validateOpts(opts) {
  const required = ['senderName', 'senderVatId', 'senderAddress', 'senderCity', 'senderPostcode'];
  for (const key of required) {
    if (!opts[key]) throw new XRechnungError(`Missing required option: ${key}`);
  }
  if (!opts.receiverName) throw new XRechnungError('Missing required option: receiverName');
}

/**
 * BT-10 (Buyer Reference / Leitweg-ID) is mandatory in XRechnung: a B2G invoice without
 * it is rejected by the receiving authority, so generating one with a placeholder would
 * produce an invoice that fails where it matters. The caller must state it.
 */
function validateBuyerReference(invoice) {
  const ref = invoice['customer-reference'];
  if (typeof ref !== 'string' || ref.trim() === '') {
    throw new XRechnungError("Invoice is missing customer-reference (mandatory Business Term BT-10, BuyerReference / Leitweg-ID): XRechnung B2G invoices are rejected without it — set invoice['customer-reference'] to the buyer's reference or Leitweg-ID");
  }
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
