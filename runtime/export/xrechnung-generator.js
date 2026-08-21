/**
 * runtime/export/xrechnung-generator.js — Outbound EN 16931 / XRechnung UBL 2.1 XML Invoice Generator.
 *
 * Serializes domain invoice objects into standardized electronic invoices conforming to
 * European Standard EN 16931-1:2017 and KoSIT XRechnung Specification v3.0.1 (UBL 2.1).
 *
 * Zero dependencies. Exact string & BigInt Money formatting via runtime/money/money.js.
 */

import { toMoney, sum } from '../money/money.js';

export class ValidationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/**
 * Escapes special XML characters to prevent injection / syntax breakage.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extracts raw formatted decimal string (without currency code suffix) from Money/token.
 *
 * @param {unknown} value
 * @param {string} expectedCurrency
 * @param {string} fieldName
 * @returns {string} e.g. "4999.99"
 */
function formatMoneyXml(value, expectedCurrency, fieldName) {
  if (value === null || value === undefined) {
    throw new ValidationError('missing-monetary-amount', `Missing monetary value for ${fieldName}`);
  }
  let m;
  try {
    m = toMoney(value);
  } catch (err) {
    throw new ValidationError('invalid-monetary-value', `Invalid monetary value for ${fieldName}: ${err.message}`);
  }
  if (m.currency !== expectedCurrency) {
    throw new ValidationError(
      'currency-mismatch',
      `Currency '${m.currency}' for ${fieldName} does not match document currency '${expectedCurrency}'`
    );
  }
  const token = m.toString();
  return token.substring(0, token.lastIndexOf(' '));
}

/**
 * Converts BigInt or integer string quantity to clean decimal string.
 *
 * @param {unknown} qty
 * @param {string} lineContext
 * @returns {string}
 */
function formatQuantityXml(qty, lineContext) {
  if (qty === null || qty === undefined || qty === '') {
    throw new ValidationError('missing-bt-129', `Missing mandatory Business Term BT-129 (InvoicedQuantity) for ${lineContext}`);
  }
  if (typeof qty === 'bigint') {
    return qty.toString();
  }
  if (typeof qty === 'number') {
    if (!Number.isInteger(qty)) {
      throw new ValidationError('invalid-quantity', `Quantity must be integer or BigInt for ${lineContext}, got floating number ${qty}`);
    }
    return qty.toString();
  }
  if (typeof qty === 'string') {
    const trimmed = qty.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new ValidationError('invalid-quantity', `Invalid quantity format '${qty}' for ${lineContext}`);
    }
    return trimmed;
  }
  throw new ValidationError('invalid-quantity', `Unsupported quantity value type for ${lineContext}`);
}

/**
 * Formats EN 16931 Postal Address XML block for Seller (BG-5) or Buyer (BG-8).
 *
 * @param {Object} address
 * @param {string} roleName
 * @returns {string}
 */
function formatPostalAddressXml(address, roleName) {
  if (!address || typeof address !== 'object') {
    throw new ValidationError(`missing-${roleName.toLowerCase()}-address`, `Missing mandatory ${roleName} Postal Address details (${roleName.toLowerCase()}.address)`);
  }
  if (!address.streetName || typeof address.streetName !== 'string' || address.streetName.trim() === '') {
    throw new ValidationError(`missing-${roleName.toLowerCase()}-street`, `Missing mandatory ${roleName} Street Name (${roleName.toLowerCase()}.address.streetName)`);
  }
  if (!address.cityName || typeof address.cityName !== 'string' || address.cityName.trim() === '') {
    throw new ValidationError(`missing-${roleName.toLowerCase()}-city`, `Missing mandatory ${roleName} City Name (${roleName.toLowerCase()}.address.cityName)`);
  }
  if (!address.postalZone || typeof address.postalZone !== 'string' || address.postalZone.trim() === '') {
    throw new ValidationError(`missing-${roleName.toLowerCase()}-postal-code`, `Missing mandatory ${roleName} Postal Code (${roleName.toLowerCase()}.address.postalZone)`);
  }
  if (!address.countryCode || typeof address.countryCode !== 'string' || !/^[A-Z]{2}$/.test(address.countryCode.trim())) {
    throw new ValidationError(`missing-${roleName.toLowerCase()}-country-code`, `Missing or invalid mandatory ${roleName} Country Code ISO alpha-2 (${roleName.toLowerCase()}.address.countryCode)`);
  }

  return `      <cac:PostalAddress>
        <cbc:StreetName>${escapeXml(address.streetName.trim())}</cbc:StreetName>
        <cbc:CityName>${escapeXml(address.cityName.trim())}</cbc:CityName>
        <cbc:PostalZone>${escapeXml(address.postalZone.trim())}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${escapeXml(address.countryCode.trim().toUpperCase())}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>`;
}

/**
 * Generates an EN 16931 UBL 2.1 XML invoice string from a domain invoice object.
 *
 * @param {Object} invoice Domain invoice object
 * @returns {string} EN 16931 UBL 2.1 XML string
 */
export function generateXRechnungUblXml(invoice) {
  if (!invoice || typeof invoice !== 'object') {
    throw new ValidationError('empty-input', 'Invoice domain object must be a non-null object');
  }

  // BT-1: Invoice Number
  if (!invoice.invoiceNumber || typeof invoice.invoiceNumber !== 'string' || invoice.invoiceNumber.trim() === '') {
    throw new ValidationError('missing-bt-1', 'Missing mandatory Business Term BT-1 (Invoice Number / invoiceNumber)');
  }

  // BT-2: Issue Date (YYYY-MM-DD)
  if (!invoice.issueDate || typeof invoice.issueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate.trim())) {
    throw new ValidationError('missing-bt-2', 'Missing or invalid mandatory Business Term BT-2 (Issue Date YYYY-MM-DD / issueDate)');
  }

  // BT-3: Invoice Type Code
  if (!invoice.invoiceTypeCode || (typeof invoice.invoiceTypeCode !== 'string' && typeof invoice.invoiceTypeCode !== 'number')) {
    throw new ValidationError('missing-bt-3', 'Missing mandatory Business Term BT-3 (Invoice Type Code / invoiceTypeCode)');
  }

  // BT-5: Document Currency Code
  if (!invoice.currency || typeof invoice.currency !== 'string' || !/^[A-Z]{3}$/.test(invoice.currency.trim())) {
    throw new ValidationError('missing-bt-5', 'Missing or invalid mandatory Business Term BT-5 (Currency ISO code / currency)');
  }

  const currency = invoice.currency.trim();

  // BT-27, BT-31, BG-5: Seller
  if (!invoice.seller || typeof invoice.seller !== 'object') {
    throw new ValidationError('missing-supplier', 'Missing mandatory seller (AccountingSupplierParty) details');
  }
  if (!invoice.seller.name || typeof invoice.seller.name !== 'string' || invoice.seller.name.trim() === '') {
    throw new ValidationError('missing-bt-27', 'Missing mandatory Business Term BT-27 (Seller Name / seller.name)');
  }
  if (!invoice.seller.vatId || typeof invoice.seller.vatId !== 'string' || invoice.seller.vatId.trim() === '') {
    throw new ValidationError('missing-bt-31', 'Missing mandatory Business Term BT-31 (Seller VAT Identifier / seller.vatId)');
  }
  const sellerAddressXml = formatPostalAddressXml(invoice.seller.address, 'Seller');

  // BT-44, BG-8: Buyer
  if (!invoice.buyer || typeof invoice.buyer !== 'object') {
    throw new ValidationError('missing-customer', 'Missing mandatory buyer (AccountingCustomerParty) details');
  }
  if (!invoice.buyer.name || typeof invoice.buyer.name !== 'string' || invoice.buyer.name.trim() === '') {
    throw new ValidationError('missing-bt-44', 'Missing mandatory Business Term BT-44 (Buyer Name / buyer.name)');
  }
  const buyerAddressXml = formatPostalAddressXml(invoice.buyer.address, 'Buyer');

  // Invoice Lines
  if (!Array.isArray(invoice.lines) || invoice.lines.length === 0) {
    throw new ValidationError('missing-invoice-lines', 'At least one invoice line in lines array is required');
  }

  const lineGroups = new Map();
  const linesXmlParts = [];

  for (let i = 0; i < invoice.lines.length; i++) {
    const line = invoice.lines[i];
    const lineContext = `line ${i + 1}`;
    const lineId = (line.lineId !== undefined && line.lineId !== null) ? String(line.lineId).trim() : String(i + 1);
    const unitCode = (line.unitCode && typeof line.unitCode === 'string') ? line.unitCode.trim() : 'C62';

    const qtyXml = formatQuantityXml(line.quantity, lineContext);

    if (!line.lineNetAmount) {
      throw new ValidationError('missing-bt-131', `Missing mandatory Business Term BT-131 (Line Net Amount) for ${lineContext}`);
    }
    const lineNetAmountXml = formatMoneyXml(line.lineNetAmount, currency, `line ${lineId} lineNetAmount`);

    if (!line.itemName || typeof line.itemName !== 'string' || line.itemName.trim() === '') {
      throw new ValidationError('missing-bt-153', `Missing mandatory Business Term BT-153 (Item Name) for ${lineContext}`);
    }

    if (!line.itemPrice) {
      throw new ValidationError('missing-bt-146', `Missing mandatory Business Term BT-146 (Item Price Amount) for ${lineContext}`);
    }
    const itemPriceXml = formatMoneyXml(line.itemPrice, currency, `line ${lineId} itemPrice`);

    // BT-151 & BT-152: VAT Category and Rate on Line Item
    if (!line.vatCategory || typeof line.vatCategory !== 'string' || line.vatCategory.trim() === '') {
      throw new ValidationError('missing-bt-151', `Missing mandatory Business Term BT-151 (VAT Category Code) for ${lineContext}`);
    }
    if (line.vatPercent === undefined || line.vatPercent === null || String(line.vatPercent).trim() === '') {
      throw new ValidationError('missing-bt-152', `Missing mandatory Business Term BT-152 (VAT Category Rate) for ${lineContext}`);
    }
    const vatCategory = line.vatCategory.trim();
    const vatPercent = String(line.vatPercent).trim();

    // Aggregate line amounts by VAT category & rate for TaxSubtotal calculation
    const groupKey = `${vatCategory}:${vatPercent}`;
    if (!lineGroups.has(groupKey)) {
      lineGroups.set(groupKey, { vatCategory, vatPercent, netAmounts: [] });
    }
    lineGroups.get(groupKey).netAmounts.push(line.lineNetAmount);

    linesXmlParts.push(`  <cac:InvoiceLine>
    <cbc:ID>${escapeXml(lineId)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${escapeXml(unitCode)}">${qtyXml}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${lineNetAmountXml}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(line.itemName.trim())}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${escapeXml(vatCategory)}</cbc:ID>
        <cbc:Percent>${escapeXml(vatPercent)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(currency)}">${itemPriceXml}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`);
  }

  // Totals
  if (!invoice.totals || typeof invoice.totals !== 'object') {
    throw new ValidationError('missing-totals', 'Missing mandatory totals object');
  }

  const lineExtensionAmountXml = formatMoneyXml(invoice.totals.lineExtensionAmount, currency, 'totals.lineExtensionAmount');
  const taxExclusiveAmountXml = formatMoneyXml(invoice.totals.taxExclusiveAmount, currency, 'totals.taxExclusiveAmount');
  const taxAmountXml = formatMoneyXml(invoice.totals.taxAmount, currency, 'totals.taxAmount');
  const taxInclusiveAmountXml = formatMoneyXml(invoice.totals.taxInclusiveAmount, currency, 'totals.taxInclusiveAmount');
  const payableAmountXml = formatMoneyXml(invoice.totals.payableAmount, currency, 'totals.payableAmount');

  // EN 16931 BG-23: VAT Breakdown / cac:TaxSubtotal
  let taxSubtotalsXml = '';
  if (Array.isArray(invoice.taxSubtotals) && invoice.taxSubtotals.length > 0) {
    taxSubtotalsXml = invoice.taxSubtotals.map((sub, idx) => {
      if (!sub.vatCategory || typeof sub.vatCategory !== 'string' || sub.vatCategory.trim() === '') {
        throw new ValidationError('missing-bt-118', `Missing mandatory Business Term BT-118 (VAT Category) for taxSubtotals[${idx}]`);
      }
      if (sub.vatPercent === undefined || sub.vatPercent === null || String(sub.vatPercent).trim() === '') {
        throw new ValidationError('missing-bt-119', `Missing mandatory Business Term BT-119 (VAT Rate) for taxSubtotals[${idx}]`);
      }
      const taxableXml = formatMoneyXml(sub.taxableAmount, currency, `taxSubtotals[${idx}].taxableAmount`);
      const taxXml = formatMoneyXml(sub.taxAmount, currency, `taxSubtotals[${idx}].taxAmount`);
      const category = sub.vatCategory.trim();
      const percent = String(sub.vatPercent).trim();
      return `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(currency)}">${taxableXml}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(currency)}">${taxXml}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${escapeXml(category)}</cbc:ID>
        <cbc:Percent>${escapeXml(percent)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
    }).join('\n');
  } else {
    // Generate TaxSubtotal items dynamically from line item VAT groupings
    const subtotalsParts = [];
    for (const group of lineGroups.values()) {
      const groupTaxableSum = sum(group.netAmounts, currency);
      const groupTaxableXml = formatMoneyXml(groupTaxableSum, currency, `taxSubtotal[${group.vatCategory}] taxableAmount`);
      // For single group, taxAmountXml matches overall taxAmountXml
      const groupTaxXml = lineGroups.size === 1 ? taxAmountXml : formatMoneyXml(group.taxAmount || '0.00 ' + currency, currency, `taxSubtotal[${group.vatCategory}] taxAmount`);
      subtotalsParts.push(`    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(currency)}">${groupTaxableXml}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(currency)}">${groupTaxXml}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${escapeXml(group.vatCategory)}</cbc:ID>
        <cbc:Percent>${escapeXml(group.vatPercent)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
    }
    taxSubtotalsXml = subtotalsParts.join('\n');
  }

  const buyerRefXml = invoice.buyerReference
    ? `\n  <cbc:BuyerReference>${escapeXml(invoice.buyerReference.trim())}</cbc:BuyerReference>`
    : '';

  const buyerVatXml = invoice.buyer.vatId
    ? `\n      <cac:PartyTaxScheme>\n        <cbc:CompanyID>${escapeXml(invoice.buyer.vatId.trim())}</cbc:CompanyID>\n        <cac:TaxScheme>\n          <cbc:ID>VAT</cbc:ID>\n        </cac:TaxScheme>\n      </cac:PartyTaxScheme>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(invoice.invoiceNumber.trim())}</cbc:ID>
  <cbc:IssueDate>${escapeXml(invoice.issueDate.trim())}</cbc:IssueDate>
  <cbc:InvoiceTypeCode>${escapeXml(String(invoice.invoiceTypeCode).trim())}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(currency)}</cbc:DocumentCurrencyCode>${buyerRefXml}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(invoice.seller.name.trim())}</cbc:Name>
      </cac:PartyName>
${sellerAddressXml}
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${escapeXml(invoice.seller.vatId.trim())}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(invoice.buyer.name.trim())}</cbc:Name>
      </cac:PartyName>
${buyerAddressXml}${buyerVatXml}
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(currency)}">${taxAmountXml}</cbc:TaxAmount>
${taxSubtotalsXml}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(currency)}">${lineExtensionAmountXml}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(currency)}">${taxExclusiveAmountXml}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(currency)}">${taxInclusiveAmountXml}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(currency)}">${payableAmountXml}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${linesXmlParts.join('\n')}
</Invoice>`;
}
