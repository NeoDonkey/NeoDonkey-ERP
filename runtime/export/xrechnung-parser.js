/**
 * runtime/export/xrechnung-parser.js — Inbound EN 16931 / XRechnung UBL 2.1 XML Invoice Parser.
 *
 * Implements semantic data model extraction and validation for electronic invoices per
 * European Standard EN 16931-1:2017 and KoSIT XRechnung Specification v3.0.1.
 *
 * Zero dependencies. Exact integer Money arithmetic via runtime/money/money.js.
 */

import { money, equals, add, sum } from '../money/money.js';

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
 * Extracts text content of the first matching child XML tag inside xmlFragment.
 *
 * @param {string} xmlFragment
 * @param {string} tagName e.g. "cbc:ID" or "ID"
 * @returns {string|null}
 */
function extractTagValue(xmlFragment, tagName) {
  if (typeof xmlFragment !== 'string') return null;
  const localName = tagName.includes(':') ? tagName.split(':')[1] : tagName;
  const regex = new RegExp(`<\\s*(?:[a-zA-Z0-9_]+:)?${localName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\s*\\/\\s*(?:[a-zA-Z0-9_]+:)?${localName}\\s*>`, 'i');
  const match = xmlFragment.match(regex);
  if (!match) return null;
  let text = match[1].trim();
  if (text.startsWith('<![CDATA[') && text.endsWith(']]>')) {
    text = text.substring(9, text.length - 3).trim();
  }
  return text;
}

/**
 * Extracts inner XML content of the first matching XML section inside xmlFragment.
 *
 * @param {string} xmlFragment
 * @param {string} sectionName e.g. "cac:AccountingSupplierParty"
 * @returns {string|null}
 */
function extractSection(xmlFragment, sectionName) {
  if (typeof xmlFragment !== 'string') return null;
  const localName = sectionName.includes(':') ? sectionName.split(':')[1] : sectionName;
  const regex = new RegExp(`<\\s*(?:[a-zA-Z0-9_]+:)?${localName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\s*\\/\\s*(?:[a-zA-Z0-9_]+:)?${localName}\\s*>`, 'i');
  const match = xmlFragment.match(regex);
  return match ? match[1] : null;
}

/**
 * Extracts inner XML contents of all matching XML sections inside xmlFragment.
 *
 * @param {string} xmlFragment
 * @param {string} sectionName e.g. "cac:InvoiceLine"
 * @returns {string[]}
 */
function extractAllSections(xmlFragment, sectionName) {
  if (typeof xmlFragment !== 'string') return [];
  const localName = sectionName.includes(':') ? sectionName.split(':')[1] : sectionName;
  const regex = new RegExp(`<\\s*(?:[a-zA-Z0-9_]+:)?${localName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\s*\\/\\s*(?:[a-zA-Z0-9_]+:)?${localName}\\s*>`, 'gi');
  const sections = [];
  let match;
  while ((match = regex.exec(xmlFragment)) !== null) {
    sections.push(match[1]);
  }
  return sections;
}

/**
 * Helper to parse a monetary amount string in XML (e.g. "5949.99") with currency (e.g. "EUR").
 *
 * @param {string} amountStr
 * @param {string} currency
 * @param {string} fieldName
 * @returns {import('../money/money.js').Money}
 */
function parseMoney(amountStr, currency, fieldName) {
  if (!amountStr || typeof amountStr !== 'string') {
    throw new ValidationError('missing-monetary-amount', `Missing or empty monetary amount string for ${fieldName}`);
  }
  const trimmed = amountStr.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new ValidationError('invalid-monetary-format', `Invalid decimal number format for ${fieldName}: '${amountStr}'`);
  }
  try {
    return money(`${trimmed} ${currency}`);
  } catch (err) {
    throw new ValidationError('invalid-monetary-value', `Failed to parse monetary value '${amountStr} ${currency}' for ${fieldName}: ${err.message}`);
  }
}

/**
 * Parses decimal or integer string to exact BigInt integer units without JS double precision loss.
 *
 * @param {string} qtyStr
 * @param {string} fieldName
 * @returns {bigint}
 */
function parseBigIntQuantity(qtyStr, fieldName) {
  if (!qtyStr || typeof qtyStr !== 'string') {
    throw new ValidationError('missing-bt-129', `Missing mandatory Business Term BT-129 (InvoicedQuantity) for ${fieldName}`);
  }
  const trimmed = qtyStr.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new ValidationError('invalid-quantity', `Invalid quantity decimal format for ${fieldName}: '${qtyStr}'`);
  }
  const wholePart = trimmed.split('.')[0];
  try {
    return BigInt(wholePart);
  } catch {
    throw new ValidationError('invalid-quantity', `Could not parse BigInt quantity for ${fieldName}: '${qtyStr}'`);
  }
}

/**
 * Parses and validates an EN 16931 UBL 2.1 XML invoice string into a structured domain object.
 *
 * @param {string} xmlText
 * @returns {Object} Structured domain invoice object with Money fields
 */
export function parseXRechnungUblXml(xmlText) {
  if (typeof xmlText !== 'string' || xmlText.trim().length === 0) {
    throw new ValidationError('empty-input', 'XML input string must be non-empty');
  }

  if (!/<(?:[a-zA-Z0-9_]+:)?Invoice[\s>]/.test(xmlText)) {
    throw new ValidationError('not-ubl-invoice', 'XML root element is not a UBL Invoice');
  }

  // Isolate top-level header portion before first <cac:...> element for root BT attributes
  const firstCacIdx = xmlText.search(/<\s*(?:[a-zA-Z0-9_]+:)?cac:/i);
  const headerXml = firstCacIdx !== -1 ? xmlText.substring(0, firstCacIdx) : xmlText;

  // BT-1: Invoice Number (mandatory)
  const invoiceNumber = extractTagValue(headerXml, 'cbc:ID');
  if (!invoiceNumber) {
    throw new ValidationError('missing-bt-1', 'Missing mandatory Business Term BT-1 (Invoice Number / cbc:ID)');
  }

  // BT-2: Issue Date (mandatory, YYYY-MM-DD)
  const issueDate = extractTagValue(headerXml, 'cbc:IssueDate');
  if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    throw new ValidationError('missing-bt-2', 'Missing or invalid mandatory Business Term BT-2 (Issue Date / cbc:IssueDate YYYY-MM-DD)');
  }

  // BT-3: Invoice Type Code (mandatory)
  const invoiceTypeCode = extractTagValue(headerXml, 'cbc:InvoiceTypeCode');
  if (!invoiceTypeCode) {
    throw new ValidationError('missing-bt-3', 'Missing mandatory Business Term BT-3 (Invoice Type Code / cbc:InvoiceTypeCode)');
  }

  // BT-5: Document Currency Code (mandatory)
  const currency = extractTagValue(headerXml, 'cbc:DocumentCurrencyCode');
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError('missing-bt-5', 'Missing or invalid mandatory Business Term BT-5 (Document Currency Code / cbc:DocumentCurrencyCode)');
  }

  // BT-10: Buyer Reference (Leitweg-ID / Buyer Reference)
  const buyerReference = extractTagValue(headerXml, 'cbc:BuyerReference');

  // BT-27 & BT-31: Seller (AccountingSupplierParty)
  const supplierSection = extractSection(xmlText, 'cac:AccountingSupplierParty');
  if (!supplierSection) {
    throw new ValidationError('missing-supplier', 'Missing mandatory AccountingSupplierParty section');
  }
  const sellerName = extractTagValue(supplierSection, 'cbc:Name') || extractTagValue(supplierSection, 'cbc:RegistrationName');
  if (!sellerName) {
    throw new ValidationError('missing-bt-27', 'Missing mandatory Business Term BT-27 (Seller Name)');
  }

  const sellerVatId = extractTagValue(supplierSection, 'cbc:CompanyID') || extractTagValue(supplierSection, 'cbc:TaxID');
  if (!sellerVatId) {
    throw new ValidationError('missing-bt-31', 'Missing mandatory Business Term BT-31 (Seller VAT Identifier / cbc:CompanyID)');
  }

  // BT-44 & BT-48: Buyer (AccountingCustomerParty)
  const customerSection = extractSection(xmlText, 'cac:AccountingCustomerParty');
  if (!customerSection) {
    throw new ValidationError('missing-customer', 'Missing mandatory AccountingCustomerParty section');
  }
  const buyerName = extractTagValue(customerSection, 'cbc:Name') || extractTagValue(customerSection, 'cbc:RegistrationName');
  if (!buyerName) {
    throw new ValidationError('missing-bt-44', 'Missing mandatory Business Term BT-44 (Buyer Name)');
  }
  const buyerVatId = extractTagValue(customerSection, 'cbc:CompanyID') || extractTagValue(customerSection, 'cbc:TaxID');

  // Parse Invoice Lines (cac:InvoiceLine)
  const lineSections = extractAllSections(xmlText, 'cac:InvoiceLine');
  if (lineSections.length === 0) {
    throw new ValidationError('missing-invoice-lines', 'At least one cac:InvoiceLine section is required');
  }

  const lines = [];
  for (let i = 0; i < lineSections.length; i++) {
    const lineSec = lineSections[i];
    const lineId = extractTagValue(lineSec, 'cbc:ID') || String(i + 1);

    // BT-129: Invoiced Quantity (mandatory)
    const quantityStr = extractTagValue(lineSec, 'cbc:InvoicedQuantity');
    const quantity = parseBigIntQuantity(quantityStr, `line ${lineId}`);

    // BT-131: Line Net Amount (mandatory)
    const lineAmountStr = extractTagValue(lineSec, 'cbc:LineExtensionAmount');
    if (!lineAmountStr) {
      throw new ValidationError('missing-bt-131', `Missing mandatory Business Term BT-131 (Line Net Amount) for line ${lineId}`);
    }
    const lineNetAmount = parseMoney(lineAmountStr, currency, `Line ${lineId} Net Amount (BT-131)`);

    // BT-153: Item Name (mandatory)
    const itemSection = extractSection(lineSec, 'cac:Item');
    const itemName = itemSection ? extractTagValue(itemSection, 'cbc:Name') : null;
    if (!itemName) {
      throw new ValidationError('missing-bt-153', `Missing mandatory Business Term BT-153 (Item Name) for line ${lineId}`);
    }

    // BT-146: Item Net Price (mandatory)
    const priceSection = extractSection(lineSec, 'cac:Price');
    const priceAmountStr = priceSection ? extractTagValue(priceSection, 'cbc:PriceAmount') : null;
    if (!priceAmountStr) {
      throw new ValidationError('missing-bt-146', `Missing mandatory Business Term BT-146 (Item Price Amount) for line ${lineId}`);
    }
    const itemPrice = parseMoney(priceAmountStr, currency, `Line ${lineId} Item Price (BT-146)`);

    lines.push({
      lineId,
      quantity,
      lineNetAmount,
      itemName,
      itemPrice
    });
  }

  // Parse LegalMonetaryTotal & TaxTotal
  const monetaryTotalSection = extractSection(xmlText, 'cac:LegalMonetaryTotal');
  if (!monetaryTotalSection) {
    throw new ValidationError('missing-monetary-total', 'Missing mandatory LegalMonetaryTotal section');
  }

  const lineExtensionStr = extractTagValue(monetaryTotalSection, 'cbc:LineExtensionAmount');
  const taxExclusiveStr = extractTagValue(monetaryTotalSection, 'cbc:TaxExclusiveAmount');
  const taxInclusiveStr = extractTagValue(monetaryTotalSection, 'cbc:TaxInclusiveAmount');
  const payableAmountStr = extractTagValue(monetaryTotalSection, 'cbc:PayableAmount');

  const taxTotalSection = extractSection(xmlText, 'cac:TaxTotal');
  const taxAmountStr = taxTotalSection ? extractTagValue(taxTotalSection, 'cbc:TaxAmount') : '0.00';

  if (!lineExtensionStr || !taxExclusiveStr || !taxInclusiveStr || !payableAmountStr) {
    throw new ValidationError('missing-totals', 'Missing mandatory monetary total fields in cac:LegalMonetaryTotal');
  }

  const lineExtensionAmount = parseMoney(lineExtensionStr, currency, 'LineExtensionAmount (BT-106)');
  const taxExclusiveAmount = parseMoney(taxExclusiveStr, currency, 'TaxExclusiveAmount (BT-109)');
  const taxAmount = parseMoney(taxAmountStr, currency, 'TaxAmount (BT-110)');
  const taxInclusiveAmount = parseMoney(taxInclusiveStr, currency, 'TaxInclusiveAmount (BT-112)');
  const payableAmount = parseMoney(payableAmountStr, currency, 'PayableAmount (BT-115)');

  // Enforce Arithmetic Total Integrity
  const calculatedLineSum = sum(lines.map(l => l.lineNetAmount), currency);
  if (!equals(calculatedLineSum, lineExtensionAmount)) {
    throw new ValidationError(
      'mismatched-totals',
      `Sum of line net amounts (${calculatedLineSum.toString()}) does not equal LineExtensionAmount BT-106 (${lineExtensionAmount.toString()})`
    );
  }

  const expectedTaxInclusive = add(taxExclusiveAmount, taxAmount);
  if (!equals(expectedTaxInclusive, taxInclusiveAmount)) {
    throw new ValidationError(
      'mismatched-totals',
      `TaxInclusiveAmount BT-112 (${taxInclusiveAmount.toString()}) does not equal TaxExclusiveAmount BT-109 + TaxAmount BT-110 (${expectedTaxInclusive.toString()})`
    );
  }

  return {
    invoiceNumber,
    issueDate,
    invoiceTypeCode,
    currency,
    buyerReference,
    seller: {
      name: sellerName,
      vatId: sellerVatId
    },
    buyer: {
      name: buyerName,
      vatId: buyerVatId
    },
    lines,
    totals: {
      lineExtensionAmount,
      taxExclusiveAmount,
      taxAmount,
      taxInclusiveAmount,
      payableAmount
    }
  };
}
