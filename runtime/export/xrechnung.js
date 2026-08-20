/**
 * EN 16931 / XRechnung v3.0 UBL 2.1 XML E-Invoice Serializer.
 *
 * Implements EN 16931-1:2017 semantic data model and KoSIT XRechnung v3.0.1
 * UBL 2.1 syntax binding (§3).
 *
 * Enforces zero floating-point arithmetic across all monetary paths using
 * NeoDonkey runtime/money primitives.
 */

import { toMoney, CURRENCIES } from '../money/money.js';
import { formatScaled } from '../money/decimal.js';

/**
 * Escapes XML special characters in string values.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Formats monetary amounts into { amountStr, currency } with exact decimal representation.
 *
 * @param {unknown} val
 * @param {string} [defaultCurrency='EUR']
 * @returns {{ amountStr: string, currency: string }}
 */
function parseMonetaryField(val, defaultCurrency = 'EUR') {
  if (val === null || val === undefined) {
    throw new TypeError('Monetary field cannot be null or undefined');
  }

  let m;
  if (typeof val === 'string' && !val.includes(' ')) {
    // String without space, e.g. "1000.00"
    m = toMoney(`${val} ${defaultCurrency}`);
  } else {
    m = toMoney(val);
  }

  const scale = CURRENCIES[m.currency] ?? 2;
  const amountStr = formatScaled(m.minor, scale);
  return { amountStr, currency: m.currency };
}

/**
 * Generates an EN 16931 / XRechnung v3.0 UBL 2.1 XML e-invoice from a domain invoice object.
 *
 * @param {Object} invoice
 * @returns {string} XML string representation of UBL 2.1 Invoice
 */
export function generateXRechnungUblXml(invoice) {
  if (!invoice || typeof invoice !== 'object') {
    throw new TypeError('generateXRechnungUblXml requires a valid invoice object');
  }

  // --- Validate mandatory header fields ---
  if (!invoice.invoiceNumber) {
    throw new TypeError('Missing mandatory field: invoiceNumber (BT-1)');
  }
  if (!invoice.issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.issueDate)) {
    throw new TypeError(`Invalid or missing issueDate (BT-2): expected YYYY-MM-DD, got '${invoice.issueDate}'`);
  }
  const invoiceTypeCode = invoice.invoiceTypeCode || '380';
  const currency = invoice.currency || 'EUR';

  if (!invoice.seller || typeof invoice.seller !== 'object') {
    throw new TypeError('Missing mandatory seller details (BT-27 / BT-31)');
  }
  if (!invoice.seller.name) {
    throw new TypeError('Missing mandatory seller name (BT-27)');
  }
  const sellerAddr = invoice.seller.address || {};
  if (!sellerAddr.countryCode) {
    throw new TypeError('Missing mandatory seller countryCode (BT-40)');
  }

  if (!invoice.buyer || typeof invoice.buyer !== 'object') {
    throw new TypeError('Missing mandatory buyer details (BT-44)');
  }
  if (!invoice.buyer.name) {
    throw new TypeError('Missing mandatory buyer name (BT-44)');
  }
  const buyerAddr = invoice.buyer.address || {};
  if (!buyerAddr.countryCode) {
    throw new TypeError('Missing mandatory buyer countryCode (BT-55)');
  }

  if (!Array.isArray(invoice.lines) || invoice.lines.length === 0) {
    throw new TypeError('Invoice must contain at least one invoice line (BT-126)');
  }

  const buyerRef = invoice.buyerReference || 'N/A';

  // --- Format seller address and tax scheme ---
  const sellerVatId = invoice.seller.vatId || '';
  const sellerContact = invoice.seller.contact || {};

  // --- Format buyer address and tax scheme ---
  const buyerVatId = invoice.buyer.vatId || '';

  // --- Process Invoice Lines ---
  const xmlLines = invoice.lines.map((line, idx) => {
    const lineId = line.id || String(idx + 1);
    if (!line.name) {
      throw new TypeError(`Invoice line ${lineId} missing mandatory name (BT-153)`);
    }

    if (line.vatRate === undefined || line.vatRate === null) {
      throw new TypeError(`Invoice line ${lineId} missing mandatory vatRate (BT-152)`);
    }

    const quantity = line.quantity !== undefined && line.quantity !== null ? String(line.quantity) : '1.00';
    const unitCode = line.unitCode || 'C62';
    const vatCategory = line.vatCategory || 'S';
    const vatRate = String(line.vatRate);

    const lineExt = parseMonetaryField(line.lineExtensionAmount ?? line.amount, currency);
    const unitPrice = parseMonetaryField(line.unitPrice ?? line.price, currency);

    return `  <cac:InvoiceLine>
    <cbc:ID>${escapeXml(lineId)}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${escapeXml(unitCode)}">${escapeXml(quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${escapeXml(lineExt.currency)}">${lineExt.amountStr}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${escapeXml(line.name)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${escapeXml(vatCategory)}</cbc:ID>
        <cbc:Percent>${escapeXml(vatRate)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${escapeXml(unitPrice.currency)}">${unitPrice.amountStr}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
  });

  // --- Process Tax Breakdowns ---
  if (!Array.isArray(invoice.vatBreakdown) || invoice.vatBreakdown.length === 0) {
    throw new TypeError('Invoice missing mandatory vatBreakdown array (BT-116/BT-118)');
  }

  const vatBreakdown = invoice.vatBreakdown;

  let totalTaxAmountParsed;
  if (invoice.totals?.taxAmount !== undefined) {
    totalTaxAmountParsed = parseMonetaryField(invoice.totals.taxAmount, currency);
  } else {
    // Sum from first breakdown element or throw
    totalTaxAmountParsed = parseMonetaryField(vatBreakdown[0].taxAmount, currency);
  }

  const xmlTaxSubtotals = vatBreakdown.map((vat, idx) => {
    if (vat.vatRate === undefined || vat.vatRate === null) {
      throw new TypeError(`VAT breakdown item ${idx + 1} missing mandatory vatRate (BT-119)`);
    }

    const taxable = parseMonetaryField(vat.taxableAmount, currency);
    const taxAmt = parseMonetaryField(vat.taxAmount, currency);
    const vatCat = vat.vatCategory || 'S';
    const vatPct = String(vat.vatRate);

    return `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${escapeXml(taxable.currency)}">${taxable.amountStr}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${escapeXml(taxAmt.currency)}">${taxAmt.amountStr}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${escapeXml(vatCat)}</cbc:ID>
        <cbc:Percent>${escapeXml(vatPct)}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
  });

  // --- Process Legal Monetary Totals ---
  const totals = invoice.totals || {};
  const lineExtTotal = parseMonetaryField(totals.lineExtensionAmount ?? '0.00 EUR', currency);
  const taxExclusiveTotal = parseMonetaryField(totals.taxExclusiveAmount ?? lineExtTotal.amountStr, currency);
  const taxInclusiveTotal = parseMonetaryField(totals.taxInclusiveAmount ?? taxExclusiveTotal.amountStr, currency);
  const payableTotal = parseMonetaryField(totals.payableAmount ?? taxInclusiveTotal.amountStr, currency);

  // Build Seller Optional Postal & Contact Elements
  const sellerStreetXml = sellerAddr.street ? `\n        <cbc:StreetName>${escapeXml(sellerAddr.street)}</cbc:StreetName>` : '';
  const sellerCityXml = sellerAddr.city ? `\n        <cbc:CityName>${escapeXml(sellerAddr.city)}</cbc:CityName>` : '';
  const sellerZipXml = sellerAddr.postalCode ? `\n        <cbc:PostalZone>${escapeXml(sellerAddr.postalCode)}</cbc:PostalZone>` : '';
  const sellerCountryXml = `\n        <cac:Country>\n          <cbc:IdentificationCode>${escapeXml(sellerAddr.countryCode)}</cbc:IdentificationCode>\n        </cac:Country>`;

  const sellerTaxSchemeXml = sellerVatId
    ? `\n      <cac:PartyTaxScheme>\n        <cbc:CompanyID>${escapeXml(sellerVatId)}</cbc:CompanyID>\n        <cac:TaxScheme>\n          <cbc:ID>VAT</cbc:ID>\n        </cac:TaxScheme>\n      </cac:PartyTaxScheme>`
    : '';

  const sellerContactNameXml = sellerContact.name ? `\n        <cbc:Name>${escapeXml(sellerContact.name)}</cbc:Name>` : '';
  const sellerContactPhoneXml = sellerContact.phone ? `\n        <cbc:Telephone>${escapeXml(sellerContact.phone)}</cbc:Telephone>` : '';
  const sellerContactEmailXml = sellerContact.email ? `\n        <cbc:ElectronicMail>${escapeXml(sellerContact.email)}</cbc:ElectronicMail>` : '';
  const sellerContactXml = (sellerContact.name || sellerContact.phone || sellerContact.email)
    ? `\n      <cac:Contact>${sellerContactNameXml}${sellerContactPhoneXml}${sellerContactEmailXml}\n      </cac:Contact>`
    : '';

  // Build Buyer Optional Postal Elements
  const buyerStreetXml = buyerAddr.street ? `\n        <cbc:StreetName>${escapeXml(buyerAddr.street)}</cbc:StreetName>` : '';
  const buyerCityXml = buyerAddr.city ? `\n        <cbc:CityName>${escapeXml(buyerAddr.city)}</cbc:CityName>` : '';
  const buyerZipXml = buyerAddr.postalCode ? `\n        <cbc:PostalZone>${escapeXml(buyerAddr.postalCode)}</cbc:PostalZone>` : '';
  const buyerCountryXml = `\n        <cac:Country>\n          <cbc:IdentificationCode>${escapeXml(buyerAddr.countryCode)}</cbc:IdentificationCode>\n        </cac:Country>`;

  const buyerTaxSchemeXml = buyerVatId
    ? `\n      <cac:PartyTaxScheme>\n        <cbc:CompanyID>${escapeXml(buyerVatId)}</cbc:CompanyID>\n        <cac:TaxScheme>\n          <cbc:ID>VAT</cbc:ID>\n        </cac:TaxScheme>\n      </cac:PartyTaxScheme>`
    : '';

  const dueDateXml = invoice.dueDate ? `\n  <cbc:DueDate>${escapeXml(invoice.dueDate)}</cbc:DueDate>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xoev-de:kosit:standard:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdx:codelist:gdv:profile:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXml(invoice.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${escapeXml(invoice.issueDate)}</cbc:IssueDate>${dueDateXml}
  <cbc:InvoiceTypeCode>${escapeXml(invoiceTypeCode)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${escapeXml(currency)}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${escapeXml(buyerRef)}</cbc:BuyerReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(invoice.seller.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>${sellerStreetXml}${sellerCityXml}${sellerZipXml}${sellerCountryXml}
      </cac:PostalAddress>${sellerTaxSchemeXml}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoice.seller.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>${sellerContactXml}
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName>
        <cbc:Name>${escapeXml(invoice.buyer.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>${buyerStreetXml}${buyerCityXml}${buyerZipXml}${buyerCountryXml}
      </cac:PostalAddress>${buyerTaxSchemeXml}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${escapeXml(invoice.buyer.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${escapeXml(totalTaxAmountParsed.currency)}">${totalTaxAmountParsed.amountStr}</cbc:TaxAmount>
${xmlTaxSubtotals.join('\n')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${escapeXml(lineExtTotal.currency)}">${lineExtTotal.amountStr}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${escapeXml(taxExclusiveTotal.currency)}">${taxExclusiveTotal.amountStr}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${escapeXml(taxInclusiveTotal.currency)}">${taxInclusiveTotal.amountStr}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${escapeXml(payableTotal.currency)}">${payableTotal.amountStr}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${xmlLines.join('\n')}
</Invoice>`;
}
