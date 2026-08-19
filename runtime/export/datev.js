/**
 * DATEV EXTF (External Format v700) Header and Column Metadata Serializer.
 *
 * Implements DATEV EXTF format version 700 header construction per DATEV eG
 * Schnittstellenentwicklungs-Leitfaden DATEV-Format V7.00 (§2.1 & §2.2).
 */

/**
 * Standard DATEV EXTF v700 Buchungsstapel column headers (116 columns).
 */
export const DATEV_EXTF_V700_COLUMNS = [
  'Umsatz (ohne Soll/Haben-Kz)',
  'Soll/Haben-Kennzeichen',
  'WKZ Umsatz',
  'Kurs',
  'Basis-Umsatz',
  'WKZ Basis-Umsatz',
  'Konto',
  'Gegenkonto (ohne BU-Schlüssel)',
  'BU-Schlüssel',
  'Belegdatum',
  'Belegfeld 1',
  'Belegfeld 2',
  'Skonto',
  'Buchungstext',
  'Postensperre',
  'Diverse Adresse',
  'Geschäftspartnerbank',
  'Sachverhalt',
  'Zinssatz',
  'Beleglink',
  'Beleginfo - Art 1',
  'Beleginfo - Inhalt 1',
  'Beleginfo - Art 2',
  'Beleginfo - Inhalt 2',
  'Beleginfo - Art 3',
  'Beleginfo - Inhalt 3',
  'Beleginfo - Art 4',
  'Beleginfo - Inhalt 4',
  'Beleginfo - Art 5',
  'Beleginfo - Inhalt 5',
  'Beleginfo - Art 6',
  'Beleginfo - Inhalt 6',
  'Beleginfo - Art 7',
  'Beleginfo - Inhalt 7',
  'Beleginfo - Art 8',
  'Beleginfo - Inhalt 8',
  'KOST1 - Kostenstelle',
  'KOST2 - Kostenstelle',
  'KOST-Menge',
  'EU-Land u. USt-ID',
  'EU-Steuersatz',
  'Abweichender Versteuerungsart',
  'Sachverhalt L+L',
  'Funktionsergänzung L+L',
  'BU 49 Hauptfunktionstyp',
  'BU 49 Hauptfunktionsnummer',
  'BU 49 Funktionsergänzung',
  'Zusatzinformation - Art 1',
  'Zusatzinformation - Inhalt 1',
  'Zusatzinformation - Art 2',
  'Zusatzinformation - Inhalt 2',
  'Zusatzinformation - Art 3',
  'Zusatzinformation - Inhalt 3',
  'Zusatzinformation - Art 4',
  'Zusatzinformation - Inhalt 4',
  'Zusatzinformation - Art 5',
  'Zusatzinformation - Inhalt 5',
  'Zusatzinformation - Art 6',
  'Zusatzinformation - Inhalt 6',
  'Zusatzinformation - Art 7',
  'Zusatzinformation - Inhalt 7',
  'Zusatzinformation - Art 8',
  'Zusatzinformation - Inhalt 8',
  'Zusatzinformation - Art 9',
  'Zusatzinformation - Inhalt 9',
  'Zusatzinformation - Art 10',
  'Zusatzinformation - Inhalt 10',
  'Stück',
  'Gewicht',
  'Zahlungsweise',
  'Forderungsart',
  'Veranlagungsjahr',
  'Zugeordnete Fälligkeit',
  'Skontotyp',
  'Auftragsnummer',
  'Buchungstyp',
  'USt-Schlüssel (Anz. Tage)',
  'OPOS-Schlüssel',
  'Datum Zuordnungsnachweis',
  'Konto Anlagengut',
  'Nutzungsdauer Anlagengut',
  'Sonderabschreibung Art',
  'Sonderabschreibung %',
  'Sonderabschreibung Betrag',
  'Abschreibung Art',
  'Abschreibung %',
  'Abschreibung Betrag',
  'Anlagengut Bezeichnung',
  'Anlagengut Inventarnummer',
  'Anlagengut Zugangsdatum',
  'Anlagengut AfA-Beginn',
  'Anlagengut Restbuchwert',
  'Anlagengut Ursprünglicher Anschaffungswert',
  'Anlagengut Nutzungsdauer in Monaten',
  'Anlagengut Kumulierte AfA',
  'Anlagengut Wiederbeschaffungswert',
  'Anlagengut Indexreihe',
  'Anlagengut Baujahr',
  'Anlagengut Wiederbeschaffungswert-Basisjahr',
  'Anlagengut Ursprüngliche Nutzungsdauer',
  'Anlagengut Restnutzungsdauer',
  'Anlagengut Letzter Restbuchwert',
  'Anlagengut Letztes AfA-Datum',
  'Anlagengut Letzter Sonder-AfA-Betrag',
  'Anlagengut Abgangsdatum',
  'Anlagengut Abgangsart',
  'Anlagengut Verkaufserlös',
  'Anlagengut Buchwert bei Abgang',
  'Anlagengut Gewinn/Verlust bei Abgang',
  'Anlagengut Teilwertabschreibung',
  'Anlagengut Zuschreibung',
  'Anlagengut Investitionsabzugsbetrag',
  'Anlagengut Sonderbetriebsvermögen',
  'Anlagengut Zuordnung',
  'Anlagengut Zusatzfeld 1',
  'Anlagengut Zusatzfeld 2'
];

/**
 * Encodes a JavaScript string to Windows-1252 Uint8Array representation.
 *
 * @param {string} str
 * @returns {Uint8Array}
 */
export function encodeWindows1252(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) {
      bytes[i] = code;
    } else if (code >= 0x00a0 && code <= 0x00ff) {
      bytes[i] = code;
    } else {
      // Map specific common Windows-1252 code points if needed or default to '?'
      switch (code) {
        case 0x20ac: bytes[i] = 0x80; break; // €
        case 0x201a: bytes[i] = 0x82; break; // ‚
        case 0x0192: bytes[i] = 0x83; break; // ƒ
        case 0x201e: bytes[i] = 0x84; break; // „
        case 0x2026: bytes[i] = 0x85; break; // …
        case 0x2020: bytes[i] = 0x86; break; // †
        case 0x2021: bytes[i] = 0x87; break; // ‡
        case 0x02c6: bytes[i] = 0x88; break; // ˆ
        case 0x2030: bytes[i] = 0x89; break; // ‰
        case 0x0160: bytes[i] = 0x8a; break; // Š
        case 0x2039: bytes[i] = 0x8b; break; // ‹
        case 0x0152: bytes[i] = 0x8c; break; // Œ
        case 0x017d: bytes[i] = 0x8e; break; // Ž
        case 0x2018: bytes[i] = 0x91; break; // ‘
        case 0x2019: bytes[i] = 0x92; break; // ’
        case 0x201c: bytes[i] = 0x93; break; // “
        case 0x201d: bytes[i] = 0x94; break; // ”
        case 0x2022: bytes[i] = 0x95; break; // •
        case 0x2013: bytes[i] = 0x96; break; // –
        case 0x2014: bytes[i] = 0x97; break; // —
        case 0x02dc: bytes[i] = 0x98; break; // ˜
        case 0x2122: bytes[i] = 0x99; break; // ™
        case 0x0161: bytes[i] = 0x9a; break; // š
        case 0x203a: bytes[i] = 0x9b; break; // ›
        case 0x0153: bytes[i] = 0x9c; break; // œ
        case 0x017e: bytes[i] = 0x9e; break; // ž
        case 0x0178: bytes[i] = 0x9f; break; // Ÿ
        default: bytes[i] = 0x3f; break; // '?'
      }
    }
  }
  return bytes;
}

/**
 * Validates date string in YYYYMMDD format.
 *
 * @param {string} dateStr
 * @param {string} fieldName
 */
function validateDate(dateStr, fieldName) {
  if (typeof dateStr !== 'string' || !/^\d{8}$/.test(dateStr)) {
    throw new TypeError(`Invalid ${fieldName}: expected string in YYYYMMDD format, got '${dateStr}'`);
  }
}

/**
 * Serializes DATEV EXTF v700 Header and Column Header metadata lines.
 *
 * @param {Object} config
 * @param {number|string} config.beraterNummer Consultant number (1 to 7 digits, e.g. 1001)
 * @param {number|string} config.mandantenNummer Client number (1 to 5 digits, e.g. 10001)
 * @param {string} config.wirtschaftsjahrBeginn Fiscal year start YYYYMMDD (e.g. '20260101')
 * @param {string} config.datumVom Export period start YYYYMMDD (e.g. '20260101')
 * @param {string} config.datumBis Export period end YYYYMMDD (e.g. '20260131')
 * @param {number|string} [config.sachkontenlange=4] Length of G/L accounts (4 to 8, default 4)
 * @param {string} [config.bezeichnung="General Ledger Export"] Stapelbezeichnung description string
 * @param {string} [config.creationDate] Optional YYYYMMDDHHMMSSmms timestamp string or Date object/clock timestamp
 * @param {string} [config.dikennzeichen="ND"] Diktatzeichen (2 chars)
 * @returns {string} CRLF-terminated 2-line header string in DATEV EXTF format version 700
 */
export function serializeDatevHeader(config) {
  if (!config || typeof config !== 'object') {
    throw new TypeError('serializeDatevHeader requires a configuration object');
  }

  const {
    beraterNummer,
    mandantenNummer,
    wirtschaftsjahrBeginn,
    datumVom,
    datumBis,
    sachkontenlange = 4,
    bezeichnung = 'General Ledger Export',
    creationDate,
    dikennzeichen = 'ND',
    buchungstyp = 1,
    rechnungslegungskreis = 0,
    festschreibung = 0,
    currency = 'EUR',
    wkz = 'EUR'
  } = config;

  if (beraterNummer === undefined || beraterNummer === null || beraterNummer === '') {
    throw new TypeError('beraterNummer (consultant number) is required');
  }
  const beraterNum = Number(beraterNummer);
  if (!Number.isInteger(beraterNum) || beraterNum < 1 || beraterNum > 9999997) {
    throw new TypeError(`Invalid beraterNummer: must be an integer between 1 and 9999997, got ${beraterNummer}`);
  }

  if (mandantenNummer === undefined || mandantenNummer === null || mandantenNummer === '') {
    throw new TypeError('mandantenNummer (client number) is required');
  }
  const mandantNum = Number(mandantenNummer);
  if (!Number.isInteger(mandantNum) || mandantNum < 1 || mandantNum > 99999) {
    throw new TypeError(`Invalid mandantenNummer: must be an integer between 1 and 99999, got ${mandantenNummer}`);
  }

  validateDate(wirtschaftsjahrBeginn, 'wirtschaftsjahrBeginn');
  validateDate(datumVom, 'datumVom');
  validateDate(datumBis, 'datumBis');

  const accountLength = Number(sachkontenlange);
  if (!Number.isInteger(accountLength) || accountLength < 4 || accountLength > 8) {
    throw new TypeError(`Invalid sachkontenlange: must be between 4 and 8, got ${sachkontenlange}`);
  }

  let timestampStr = '';
  if (typeof creationDate === 'string' && /^\d{17}$/.test(creationDate)) {
    timestampStr = creationDate;
  } else if (creationDate instanceof Date) {
    const y = creationDate.getUTCFullYear().toString().padStart(4, '0');
    const m = (creationDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = creationDate.getUTCDate().toString().padStart(2, '0');
    const hh = creationDate.getUTCHours().toString().padStart(2, '0');
    const mm = creationDate.getUTCMinutes().toString().padStart(2, '0');
    const ss = creationDate.getUTCSeconds().toString().padStart(2, '0');
    const ms = creationDate.getUTCMilliseconds().toString().padStart(3, '0');
    timestampStr = `${y}${m}${d}${hh}${mm}${ss}${ms}`;
  } else {
    // Default fallback fixed or deterministic timestamp if none provided
    timestampStr = '20260101000000000';
  }

  const headerWkz = currency || wkz;

  // 26 fixed attributes for EXTF Header Line 1 per DATEV EXTF v700 spec
  const headerFields = [
    '"EXTF"',                         // 1. EXTF Marker
    '700',                           // 2. Version ID (700 = v700)
    '21',                            // 3. Data Category (21 = Buchungsstapel)
    '1',                             // 4. Format Name (1 = Buchungsstapel)
    `"${timestampStr}"`,             // 5. Erzeugungsdatum YYYYMMDDHHMMSSmms
    '""',                            // 6. Importiert
    `"${dikennzeichen}"`,            // 7. Herkunft / Diktatzeichen
    '""',                            // 8. Exportiert von
    '""',                            // 9. Importiert von
    '""',                            // 10. Beraternummer Abrechnungszeitraum
    `${beraterNum}`,                 // 11. Beraternummer
    `${mandantNum}`,                 // 12. Mandantennummer
    `"${wirtschaftsjahrBeginn}"`,    // 13. Wirtschaftsjahr Beginn YYYYMMDD
    `${accountLength}`,              // 14. Sachkontenlänge
    `"${datumVom}"`,                 // 15. Datum vom YYYYMMDD
    `"${datumBis}"`,                 // 16. Datum bis YYYYMMDD
    `"${bezeichnung}"`,              // 17. Bezeichnung / Stapelbezeichnung
    '""',                            // 18. Diktatzeichen
    `${buchungstyp}`,                // 19. Buchungstyp (1 = Finanzbuchführung)
    `${rechnungslegungskreis}`,      // 20. Rechnungslegungskreis (0 = Allgemein)
    `${festschreibung}`,             // 21. Festschreibung (0 = keine Festschreibung / frei)
    `"${headerWkz}"`,                // 22. WKZ
    '""',                            // 23. Reserviert
    '""',                            // 24. Derivat
    '""',                            // 25. Reserviert
    '""'                             // 26. Reserviert
  ];

  const line1 = headerFields.join(';');
  const line2 = DATEV_EXTF_V700_COLUMNS.map(col => `"${col}"`).join(';');

  return `${line1}\r\n${line2}\r\n`;
}

/**
 * Formats monetary amount into DATEV decimal format (comma separator, 2 decimal places)
 * without using floating point arithmetic.
 *
 * @param {number|bigint|string} amount Amount in minor units (cents) or formatted money string (e.g. '119.00 EUR')
 * @returns {string} Formatted decimal string with comma (e.g. '119,00')
 */
export function formatDatevAmount(amount) {
  if (amount === undefined || amount === null || amount === '') {
    throw new TypeError('formatDatevAmount requires a monetary amount');
  }

  let cents;
  let isNegative = false;
  if (typeof amount === 'bigint') {
    isNegative = amount < 0n;
    cents = isNegative ? -amount : amount;
  } else if (typeof amount === 'number') {
    if (!Number.isInteger(amount)) {
      throw new TypeError(`formatDatevAmount expects integer minor units (cents), got float ${amount}`);
    }
    isNegative = amount < 0;
    cents = BigInt(Math.abs(amount));
  } else if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (trimmed.startsWith('-')) {
      isNegative = true;
    }
    // Check if money string like "119.00 EUR" or "119.00" or "-119.00 EUR"
    const m = /^(-?\d+)(?:[.,](\d{1,2}))?(?:\s+[A-Z]{3})?$/.exec(trimmed);
    if (m) {
      const wholeStr = m[1].replace('-', '');
      const fracStr = (m[2] || '00').padEnd(2, '0').slice(0, 2);
      cents = BigInt(wholeStr) * 100n + BigInt(fracStr);
    } else if (/^-?\d+$/.test(trimmed)) {
      cents = BigInt(trimmed.replace('-', ''));
    } else {
      throw new TypeError(`Invalid monetary amount format: '${amount}'`);
    }
  } else {
    throw new TypeError(`Unsupported monetary amount type: ${typeof amount}`);
  }

  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  const formatted = `${whole},${frac}`;

  return { formatted, isNegative };
}

/**
 * Formats a document date into DATEV DDMM format.
 *
 * @param {string|Date} date Date string (YYYYMMDD, YYYY-MM-DD, DDMM) or Date object
 * @returns {string} 4-digit date string DDMM
 */
export function formatDatevDate(date) {
  if (!date) {
    throw new TypeError('formatDatevDate requires a valid date');
  }

  if (date instanceof Date) {
    const d = date.getUTCDate().toString().padStart(2, '0');
    const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    return `${d}${m}`;
  }

  if (typeof date === 'string') {
    const s = date.trim();
    if (/^\d{4}$/.test(s)) {
      const dd = Number(s.slice(0, 2));
      const mm = Number(s.slice(2, 4));
      if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
        return s; // Valid DDMM
      }
      throw new TypeError(`Invalid DDMM date string: '${s}' (day 01-31, month 01-12)`);
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) {
      return `${iso[3]}${iso[2]}`; // YYYY-MM-DD -> DDMM
    }
    const d8 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (d8) {
      return `${d8[3]}${d8[2]}`; // YYYYMMDD -> DDMM
    }
  }

  throw new TypeError(`Invalid DATEV date format: '${date}'`);
}

/**
 * Escapes and quotes a field string for DATEV EXTF CSV format.
 *
 * @param {string|number|null|undefined} val Field value
 * @param {number} [maxLen] Optional character limit for truncation
 * @returns {string} Enclosed and escaped string for EXTF CSV
 */
function formatCsvField(val, maxLen) {
  if (val === undefined || val === null) {
    return '""';
  }
  let strVal = String(val);
  if (maxLen && strVal.length > maxLen) {
    strVal = strVal.slice(0, maxLen);
  }
  const escaped = strVal.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Serializes a single general ledger posting object into a DATEV EXTF v700 booking line.
 *
 * @param {Object} posting General ledger posting record
 * @param {number|bigint|string} posting.amount Monetary amount (cents or formatted money string)
 * @param {string} [posting.side] Posting side ('debit'/'S' or 'credit'/'H')
 * @param {string|number} posting.konto Account number (Konto, e.g. '1400' or 1400)
 * @param {string|number} posting.gegenkonto Contra account number (Gegenkonto, e.g. '8400')
 * @param {string|number} [posting.buSchlussel] Tax key / BU-Schlüssel (e.g. '3', '9', or '')
 * @param {string|Date} posting.date Document date (YYYY-MM-DD, YYYYMMDD, or DDMM)
 * @param {string} [posting.documentRef] Document reference / Belegfeld 1 (max 36 chars)
 * @param {string} [posting.description] Posting description / Buchungstext (max 60 chars)
 * @param {string} [posting.currency="EUR"] Currency symbol / WKZ
 * @returns {string} CRLF-terminated 116-column DATEV EXTF booking line
 */
export function serializeDatevPostingLine(posting) {
  if (!posting || typeof posting !== 'object') {
    throw new TypeError('serializeDatevPostingLine requires a posting object');
  }

  const {
    amount,
    side,
    sollHaben,
    konto,
    gegenkonto,
    buSchlussel = '',
    buCode = '',
    date,
    belegdatum,
    documentRef = '',
    belegfeld1 = '',
    description = '',
    buchungstext = '',
    currency = 'EUR',
    wkz = 'EUR'
  } = posting;

  const { formatted: formattedAmount, isNegative } = formatDatevAmount(amount);

  let shFlag = 'S';
  const sideValue = (side || sollHaben || '').toString().toLowerCase();
  if (sideValue === 'credit' || sideValue === 'h' || sideValue === 'haben') {
    shFlag = 'H';
  } else if (sideValue === 'debit' || sideValue === 's' || sideValue === 'soll') {
    shFlag = 'S';
  } else if (isNegative) {
    // If side was not explicitly given and amount is negative, default to 'H'
    shFlag = 'H';
  }

  const accountStr = konto !== undefined && konto !== null ? String(konto) : '';
  if (!accountStr) {
    throw new TypeError('posting requires a valid konto (account number)');
  }

  const contraAccountStr = gegenkonto !== undefined && gegenkonto !== null ? String(gegenkonto) : '';
  if (!contraAccountStr) {
    throw new TypeError('posting requires a valid gegenkonto (contra account number)');
  }

  const formattedDate = formatDatevDate(date || belegdatum);
  const refText = documentRef || belegfeld1;
  const descText = description || buchungstext;
  const buKeyStr = buSchlussel || buCode ? String(buSchlussel || buCode) : '';
  const currencyStr = currency || wkz;

  const columns = new Array(DATEV_EXTF_V700_COLUMNS.length).fill('""');

  columns[0] = `"${formattedAmount}"`;           // 1. Umsatz (ohne Soll/Haben-Kz)
  columns[1] = `"${shFlag}"`;                   // 2. Soll/Haben-Kennzeichen
  columns[2] = formatCsvField(currencyStr);     // 3. WKZ Umsatz
  columns[6] = formatCsvField(accountStr);      // 7. Konto
  columns[7] = formatCsvField(contraAccountStr);// 8. Gegenkonto
  columns[8] = formatCsvField(buKeyStr);        // 9. BU-Schlüssel
  columns[9] = formatCsvField(formattedDate);   // 10. Belegdatum
  columns[10] = formatCsvField(refText, 36);    // 11. Belegfeld 1 (max 36)
  columns[13] = formatCsvField(descText, 60);   // 14. Buchungstext (max 60)

  return columns.join(';') + '\r\n';
}

/**
 * Serializes an array of posting objects into DATEV EXTF v700 CSV booking lines.
 *
 * @param {Array<Object>} postings List of posting objects
 * @returns {string} CRLF-terminated multi-line string of EXTF booking lines
 */
export function serializeDatevPostings(postings) {
  if (!Array.isArray(postings)) {
    throw new TypeError('serializeDatevPostings requires an array of postings');
  }
  return postings.map(p => serializeDatevPostingLine(p)).join('');
}

/**
 * Serializes a full DATEV EXTF v700 export file (Header + Column headers + Posting lines).
 *
 * @param {Object} config Export configuration object for header
 * @param {Array<Object>} postings List of posting objects
 * @returns {string} CRLF-terminated full DATEV EXTF v700 file content
 */
export function serializeDatevExport(config, postings) {
  const header = serializeDatevHeader(config);
  const body = serializeDatevPostings(postings);
  return header + body;
}

/**
 * Serializes a full DATEV EXTF v700 export file encoded into Windows-1252 byte representation.
 *
 * @param {Object} config Export configuration object for header
 * @param {Array<Object>} postings List of posting objects
 * @returns {Uint8Array} Windows-1252 encoded Uint8Array bytes of full EXTF file content
 */
export function serializeDatevExportBytes(config, postings) {
  const csvText = serializeDatevExport(config, postings);
  return encodeWindows1252(csvText);
}
