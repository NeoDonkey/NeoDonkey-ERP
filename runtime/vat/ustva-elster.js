// runtime/vat/ustva-elster.js — German USt-VA ELSTER XML Serializer
//
// Serializes aggregated USt-VA tax grid Kennziffern (Kz 81, Kz 86, Kz 41, Kz 66, Kz 83)
// into the official BMF ELSTER XML document structure (http://www.elster.de/elsterxml/schema/v1).
//
// Non-negotiable constraints:
// - Zero dependencies
// - Browser-compatible ES module
// - Strict BigInt minor-unit formatting without floating-point conversions
// - No Date.now() or Math.random() in core logic

/**
 * Format BigInt minor units (e.g. 185000n cents) into exact 2-decimal string representation ("1850.00").
 * Handles negative minor units correctly.
 *
 * @param {bigint|number} minorUnits
 * @returns {string}
 */
export function formatMinorUnitsToDecimalString(minorUnits) {
  const bg = BigInt(minorUnits);
  const isNegative = bg < 0n;
  const absBg = isNegative ? -bg : bg;
  const euros = absBg / 100n;
  const cents = absBg % 100n;
  const centsStr = cents < 10n ? `0${cents}` : `${cents}`;
  const sign = isNegative ? '-' : '';
  return `${sign}${euros}.${centsStr}`;
}

/**
 * Format BigInt minor units into truncated integer Euros string for USt-VA taxable sales bases per UStG § 18 Abs. 1.
 *
 * @param {bigint|number} minorUnits
 * @returns {string}
 */
export function formatMinorUnitsToIntegerEuroString(minorUnits) {
  const bg = BigInt(minorUnits);
  const isNegative = bg < 0n;
  const absBg = isNegative ? -bg : bg;
  const euros = absBg / 100n;
  const sign = isNegative ? '-' : '';
  return `${sign}${euros}`;
}

/**
 * Escapes XML special characters in string values.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Serializes an aggregated USt-VA tax grid result into BMF ELSTER XML.
 *
 * @param {Object} options
 * @param {Object} options.header
 * @param {string} options.header.finanzamtNummer 4-digit tax office ID (e.g. "9198")
 * @param {string} options.header.steuernummer 13-digit standard German tax ID (e.g. "1981150000501")
 * @param {string} options.header.jahr 4-digit year (e.g. "2026")
 * @param {string} options.header.zeitraum 2-digit month ("01".."12") or quarter ("41".."44")
 * @param {Object} [options.gridTotals]
 * @param {bigint} [options.gridTotals.kz81NetMinor] Standard rate (19%) net base
 * @param {bigint} [options.gridTotals.kz81TaxMinor] Standard rate (19%) output VAT
 * @param {bigint} [options.gridTotals.kz86NetMinor] Reduced rate (7%) net base
 * @param {bigint} [options.gridTotals.kz86TaxMinor] Reduced rate (7%) output VAT
 * @param {bigint} [options.gridTotals.kz41NetMinor] Intra-EU zero-rated supplies base
 * @param {bigint} [options.gridTotals.kz66TaxMinor] Deductible input VAT
 * @param {bigint} [options.gridTotals.kz83TaxMinor] Verbleibende USt-Vorauszahlung / Erstattungsbetrag
 * @returns {string} UTF-8 encoded ELSTER XML document string
 */
export function serializeUstVaElsterXml({ header, gridTotals = {} }) {
  if (!header) {
    throw new Error('Missing required header parameter');
  }

  const { finanzamtNummer, steuernummer, jahr, zeitraum } = header;

  if (!finanzamtNummer || !/^\d{4}$/.test(finanzamtNummer)) {
    throw new Error('FinanzamtNummer must be 4 digits');
  }
  if (!steuernummer || !/^\d{11,13}$/.test(steuernummer)) {
    throw new Error('Steuernummer must be 11 to 13 digits');
  }
  if (!jahr || !/^\d{4}$/.test(jahr)) {
    throw new Error('Jahr must be 4 digits (YYYY)');
  }
  if (!zeitraum || !/^(0[1-9]|1[0-2]|41|42|43|44)$/.test(zeitraum)) {
    throw new Error('Zeitraum must be 2-digit month (01..12) or quarter (41..44)');
  }

  const kz81NetStr = formatMinorUnitsToIntegerEuroString(gridTotals.kz81NetMinor || 0n);
  const kz81TaxStr = formatMinorUnitsToDecimalString(gridTotals.kz81TaxMinor || 0n);
  const kz86NetStr = formatMinorUnitsToIntegerEuroString(gridTotals.kz86NetMinor || 0n);
  const kz86TaxStr = formatMinorUnitsToDecimalString(gridTotals.kz86TaxMinor || 0n);
  const kz41NetStr = formatMinorUnitsToIntegerEuroString(gridTotals.kz41NetMinor || 0n);
  const kz66TaxStr = formatMinorUnitsToDecimalString(gridTotals.kz66TaxMinor || 0n);
  const kz83TaxStr = formatMinorUnitsToDecimalString(gridTotals.kz83TaxMinor || 0n);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Elster xmlns="http://www.elster.de/elsterxml/schema/v1">',
    '  <DatenTeil>',
    '    <Nutzdatenblock>',
    '      <NutzdatenHeader version="11">',
    '        <NutzdatenTicket>1</NutzdatenTicket>',
    '        <Empfaenger id="F">',
    '          <Ziel>ElsterAnmeldung</Ziel>',
    '        </Empfaenger>',
    '        <HerstellerID>74931</HerstellerID>',
    '        <DatenLieferant>NeoDonkey ERP</DatenLieferant>',
    '      </NutzdatenHeader>',
    '      <Nutzdaten>',
    '        <Anmeldesteuern>',
    '          <UStVA erstellungskosten="0">',
    `            <Jahr>${escapeXml(jahr)}</Jahr>`,
    `            <Zeitraum>${escapeXml(zeitraum)}</Zeitraum>`,
    `            <Steuernummer>${escapeXml(steuernummer)}</Steuernummer>`,
    `            <FinanzamtNummer>${escapeXml(finanzamtNummer)}</FinanzamtNummer>`,
    `            <Kz81>${kz81NetStr}</Kz81>`,
    `            <Kz86>${kz86NetStr}</Kz86>`,
    `            <Kz41>${kz41NetStr}</Kz41>`,
    `            <Kz66>${kz66TaxStr}</Kz66>`,
    `            <Kz83>${kz83TaxStr}</Kz83>`,
    '          </UStVA>',
    '        </Anmeldesteuern>',
    '      </Nutzdaten>',
    '    </Nutzdatenblock>',
    '  </DatenTeil>',
    '</Elster>',
  ].join('\n');
}
