// runtime/bank/camt053.js — ISO 20022 CAMT.053 XML bank statement parser
//
// Zero runtime dependencies, no build step, ES module.
// Parses camt.053.001.02 and camt.053.001.08 Bank-to-Customer Statement XML formats into
// canonical domain statement objects without floating-point conversions.

import { toMoney } from '../money/money.js';

/**
 * Unescape XML entities for leaf text values.
 * @param {string} str
 * @returns {string}
 */
function unescapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extract raw content snippet of first matching XML tag, supporting optional namespace prefixes.
 * @param {string} xml
 * @param {string} tag
 * @returns {string|null}
 */
function getTagRaw(xml, tag) {
  const regex = new RegExp(`<\\s*(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)</\\s*(?:[a-zA-Z0-9_-]+:)?${tag}\\s*>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Extract unescaped text content of first matching XML tag.
 * @param {string} xml
 * @param {string} tag
 * @returns {string|null}
 */
function getTagContent(xml, tag) {
  const raw = getTagRaw(xml, tag);
  return raw !== null ? unescapeXml(raw) : null;
}

/**
 * Extract tag attribute value.
 * @param {string} xml
 * @param {string} tag
 * @param {string} attr
 * @returns {string|null}
 */
function getTagAttr(xml, tag, attr) {
  const regex = new RegExp(`<\\s*(?:[a-zA-Z0-9_-]+:)?${tag}\\s+[^>]*?${attr}=["']([^"']+)["'][^>]*>`, 'i');
  const match = xml.match(regex);
  return match ? unescapeXml(match[1].trim()) : null;
}

/**
 * Extract raw XML blocks of a repeated tag.
 * @param {string} xml
 * @param {string} tag
 * @returns {string[]}
 */
function getTagBlocks(xml, tag) {
  const regex = new RegExp(`<\\s*(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)</\\s*(?:[a-zA-Z0-9_-]+:)?${tag}\\s*>`, 'gi');
  const blocks = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * Extract date or datetime string from a date block (e.g. BookgDt, ValDt).
 * @param {string|null} dtBlock
 * @returns {string|null}
 */
function parseDateFromBlock(dtBlock) {
  if (!dtBlock) return null;
  return getTagContent(dtBlock, 'Dt') || getTagContent(dtBlock, 'DtTm');
}

/**
 * Parse CAMT.053 XML string into canonical bank statement object.
 *
 * @param {string} xmlText
 * @returns {Object}
 */
export function parseCamt053Xml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string' || !xmlText.includes('BkToCstmrStmt')) {
    throw new Error('Invalid XML: missing BkToCstmrStmt');
  }

  const stmtBlock = getTagRaw(xmlText, 'Stmt');
  if (!stmtBlock) {
    throw new Error('Invalid XML: missing Stmt block');
  }

  const id = getTagContent(stmtBlock, 'Id');
  const sequenceNumber = getTagContent(stmtBlock, 'LglSeqNb');
  const creationDateTime = getTagContent(stmtBlock, 'CreDtTm');

  const acctBlock = getTagRaw(stmtBlock, 'Acct');
  if (!acctBlock) {
    throw new Error('Invalid XML: missing Acct block');
  }

  const iban = getTagContent(acctBlock, 'IBAN');
  if (!iban) {
    throw new Error('Invalid XML: missing IBAN');
  }

  const statementCcy = getTagContent(acctBlock, 'Ccy');

  const ntryBlocks = getTagBlocks(stmtBlock, 'Ntry');
  const entries = ntryBlocks.map((ntryXml) => {
    const rawAmt = getTagContent(ntryXml, 'Amt');
    if (!rawAmt) {
      throw new Error('Invalid XML: missing Ntry/Amt');
    }

    const amtCcy = getTagAttr(ntryXml, 'Amt', 'Ccy') || statementCcy;
    if (!amtCcy) {
      throw new Error('Invalid XML: missing currency code for Ntry/Amt');
    }

    const cdtDbtInd = getTagContent(ntryXml, 'CdtDbtInd');
    if (!cdtDbtInd || (cdtDbtInd !== 'CRDT' && cdtDbtInd !== 'DBIT')) {
      throw new Error('Invalid XML: missing or invalid CdtDbtInd (must be CRDT or DBIT)');
    }

    // Money token parsing (e.g. "1250.50 EUR") — zero floating point arithmetic
    const moneyToken = `${rawAmt} ${amtCcy}`;
    const moneyObj = toMoney(moneyToken);

    const bookgDtBlock = getTagRaw(ntryXml, 'BookgDt');
    const bookingDate = parseDateFromBlock(bookgDtBlock);

    const valDtBlock = getTagRaw(ntryXml, 'ValDt');
    const valueDate = parseDateFromBlock(valDtBlock);

    const accountServicerRef = getTagContent(ntryXml, 'AcctSvcrRef');

    const txDtlsBlocks = getTagBlocks(ntryXml, 'TxDtls');

    let endToEndId = null;
    let uetr = null;
    let debtorName = null;
    let creditorName = null;
    let unstructuredRemittance = null;
    let structuredRemittanceRef = null;

    if (txDtlsBlocks.length > 0) {
      const firstTx = txDtlsBlocks[0];

      const refsBlock = getTagRaw(firstTx, 'Refs');
      if (refsBlock) {
        endToEndId = getTagContent(refsBlock, 'EndToEndId');
        uetr = getTagContent(refsBlock, 'UETR');
      }

      const rltdPtiesBlock = getTagRaw(firstTx, 'RltdPties');
      if (rltdPtiesBlock) {
        const dbtrBlock = getTagRaw(rltdPtiesBlock, 'Dbtr');
        if (dbtrBlock) {
          debtorName = getTagContent(dbtrBlock, 'Nm');
        }

        const cdtrBlock = getTagRaw(rltdPtiesBlock, 'Cdtr');
        if (cdtrBlock) {
          creditorName = getTagContent(cdtrBlock, 'Nm');
        }
      }

      const rmtInfBlock = getTagRaw(firstTx, 'RmtInf');
      if (rmtInfBlock) {
        unstructuredRemittance = getTagContent(rmtInfBlock, 'Ustrd');

        const strdBlock = getTagRaw(rmtInfBlock, 'Strd');
        if (strdBlock) {
          const cdtrRefInfBlock = getTagRaw(strdBlock, 'CdtrRefInf');
          if (cdtrRefInfBlock) {
            structuredRemittanceRef = getTagContent(cdtrRefInfBlock, 'Ref');
          }
        }
      }
    }

    return {
      type: cdtDbtInd,
      amount: {
        currency: moneyObj.currency,
        minorUnits: moneyObj.minor,
        formatted: moneyObj.toString(),
      },
      bookingDate,
      valueDate,
      accountServicerRef,
      endToEndId,
      uetr,
      debtorName,
      creditorName,
      unstructuredRemittance,
      structuredRemittanceRef,
    };
  });

  return {
    id,
    sequenceNumber,
    creationDateTime,
    account: {
      iban,
      currency: statementCcy,
    },
    entries,
  };
}
