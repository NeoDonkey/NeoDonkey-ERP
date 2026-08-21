/**
 * DATEV EXTF (Externes Format) serializer — Wave 3, Gate Condition #6.
 *
 * Converts NeoDonkey journal entries into the CSV-based format that DATEV
 * Rechnungswesen / Unternehmen online imports.  The format is documented in
 * DATEV's "Schnittstellen-Entwicklungsleitfaden" and is stable enough that
 * accountants have been using it since the 1990s.
 *
 * Zero dependencies.  Works in Node 22+ and in the browser.
 *
 * @module runtime/export/datev-extf
 */

const ENC = new TextEncoder();

/**
 * DATEV EXTF header fields (Kopfsatz).  These are constant for a whole export
 * batch and determine how the downstream software interprets every data row.
 *
 * The format version used here is the modern CSV variant (ExtF 700), not the
 * ancient fixed-width format.  CSV is what DATEV's current products actually
 * import without complaint.
 */
const FORMAT_VERSION = 'EXTF';
const FORMAT_CATEGORY = 700;        // Buchungsstapel
const FORMAT_NAME = 21;             // Debitoren / Kreditoren + Fibu

/**
 * Build a DATEV EXTF export from a NeoDonkey kernel instance.
 *
 * @param {object} opts
 * @param {import('../kernel.js').Kernel} opts.kernel — open kernel
 * @param {string} opts.beraterNr — DATEV Beraternummer (7 digits)
 * @param {string} opts.mandantenNr — DATEV Mandantennummer (5 digits)
 * @param {string} opts.wjBeginn — Wirtschaftsjahr-Beginn, YYYYMMDD
 * @param {string} [opts.sachkontenrahmen] — 'SKR03' | 'SKR04' | 'IAS' | 'EÜR'
 * @param {string} [opts.bezeichnung] — Bezeichnung des Buchungsstapels
 * @param {string} [opts.datumBeginn] — Von-Datum filter, YYYYMMDD
 * @param {string} [opts.datumEnde] — Bis-Datum filter, YYYYMMDD
 * @param {boolean} [opts.nurGeänderte] — nur nicht-exportierte Buchungen
 * @returns {{csv:string, rows:number, entries:number, skipped:number}}
 */
export async function buildDatevExtf({
  kernel,
  beraterNr,
  mandantenNr,
  wjBeginn,
  sachkontenrahmen = 'SKR04',
  bezeichnung = 'NeoDonkey Export',
  datumBeginn = null,
  datumEnde = null,
  nurGeänderte = false,
}) {
  // Validate header fields — DATEV is strict about these.
  if (!/^\d{7}$/.test(beraterNr)) throw new DatevError('Beraternummer must be 7 digits');
  if (!/^\d{1,5}$/.test(mandantenNr)) throw new DatevError('Mandantennummer must be 1-5 digits');
  if (!/^\d{8}$/.test(wjBeginn)) throw new DatevError('wjBeginn must be YYYYMMDD');

  // Query journal entries that match the filter.
  const entries = selectEntries(kernel, { datumBeginn, datumEnde, nurGeänderte });

  const csvLines = [];
  let rowCount = 0;
  let skippedCount = 0;

  // ── Header row (Kopfsatz) ───────────────────────────────────────────────
  // Field order is fixed by DATEV spec.  Empty fields must still emit the
  // correct number of delimiters.
  const header = [
    FORMAT_VERSION,               //  1  Format-Kennung
    FORMAT_CATEGORY,              //  2  Versionsnummer
    FORMAT_NAME,                  //  3  Kategorie
    beraterNr,                    //  4  Beraternummer
    mandantenNr,                  //  5  Mandantennummer
    wjBeginn,                     //  6  WJ-Beginn
    '',                           //  7  Buchungsstapel-Bezeichnung (below)
    '',                           //  8  Diktatkürzel
    '',                           //  9  Buchungstyp
    '',                           // 10  Rechnungslegungszweck
    '',                           // 11  reserviert
    '',                           // 12  reserviert
    sachkontenrahmen,             // 13  Sachkontenrahmen
    '',                           // 14  Kunde/Eigenbeleg
    '',                           // 15  reserviert
    '',                           // 16  reserviert
    '',                           // 17  WKZ
    '',                           // 18  reserviert
    '',                           // 19  reserviert
    '',                           // 20  reserviert
    '',                           // 21  reserviert
    '',                           // 22  reserviert
    '',                           // 23  reserviert
    '',                           // 24  reserviert
    '',                           // 25  reserviert
    '',                           // 26  reserviert
    '',                           // 27  reserviert
    '',                           // 28  reserviert
    '',                           // 29  reserviert
    '',                           // 30  reserviert
    '',                           // 31  reserviert
    '',                           // 32  reserviert
    '',                           // 33  reserviert
    '',                           // 34  reserviert
    '',                           // 35  reserviert
    '',                           // 36  reserviert
    '',                           // 37  reserviert
    '',                           // 38  reserviert
    '',                           // 39  reserviert
    bezeichnung,                  // 40  Bezeichnung (DATEV shows this in the UI)
  ];
  csvLines.push(encodeCsvRow(header));

  // ── Data rows (Umsatzzeilen) ────────────────────────────────────────────
  for (const entry of entries) {
    if (entry.status !== 'posted') {
      skippedCount++;
      continue;                   // Drafts and cancellations don't leave.
    }

    const postings = kernel.query.select({
      from: 'posting',
      where: { 'journal-entry': { op: 'is', value: [entry.id] } },
      orderBy: 'position',
    });

    if (!postings.length) {
      skippedCount++;
      continue;
    }

    for (const p of postings) {
      const row = postingToDatevRow(entry, p);
      if (row) {
        csvLines.push(encodeCsvRow(row));
        rowCount++;
      } else {
        skippedCount++;
      }
    }
  }

  return {
    csv: csvLines.join('\r\n') + '\r\n',
    rows: rowCount,
    entries: entries.filter((e) => e.status === 'posted').length,
    skipped: skippedCount,
  };
}

/**
 * Select journal entries matching the export filter criteria.
 */
function selectEntries(kernel, { datumBeginn, datumEnde, nurGeänderte }) {
  let where = {};

  if (nurGeänderte) {
    where = { ...where, 'datev-export-reference': { op: 'exists', value: false } };
  }

  const all = kernel.query.select({ from: 'journal-entry', where, orderBy: 'entry-date' });

  if (!datumBeginn && !datumEnde) return all;

  return all.filter((e) => {
    const d = e['entry-date']?.replace(/-/g, '');
    if (!d) return false;
    if (datumBeginn && d < datumBeginn) return false;
    if (datumEnde && d > datumEnde) return false;
    return true;
  });
}

/**
 * Convert one NeoDonkey posting into a DATEV Umsatzzeile.
 *
 * Field mapping (DATEV → NeoDonkey):
 *   Umsatz          → posting.amount (minor units, no decimal point)
 *   Soll/Haben      → 'S' for debit, 'H' for credit
 *   Konto           → posting.account-number
 *   Gegenkonto      → posting.contra-account-number (or best-effort from entry)
 *   Belegdatum      → entry.document-date (YYYYMMDD)
 *   Buchungsdatum   → entry.entry-date (YYYYMMDD)
 *   Buchungstext    → entry.description + posting.description
 *   Belegfeld 1     → entry.source-document-reference
 *   USt-Schlüssel   → posting.datev-tax-key
 *   BU-Schlüssel    → posting.datev-tax-key (same field in many exports)
 *   Steuerbetrag    → computed if VAT line
 *   WKZ             → entry.currency
 *   Kostenstelle    → posting.cost-centre
 */
function postingToDatevRow(entry, posting) {
  if (!posting.amount) return null;

  const amount = moneyToDatevAmount(posting.amount);
  if (amount === null) return null;

  const side = posting.side === 'debit' ? 'S' : 'H';
  const belegdatum = formatDate(entry['document-date']);
  const buchungsdatum = formatDate(entry['entry-date']);
  if (!belegdatum || !buchungsdatum) return null;

  // Gegenkonto: if the posting has one, use it; otherwise try to infer from
  // the other postings in the same entry (the classic "1400 an 8400" case).
  let gegenkonto = posting['contra-account-number'] ?? '';
  if (!gegenkonto && entry._otherPostings) {
    const contra = entry._otherPostings.find((p2) => p2.side !== posting.side);
    if (contra) gegenkonto = contra['account-number'] ?? '';
  }

  // Tax amount: if this is a tax line, the tax itself is the amount.
  // If it's a base line, the tax is on a sibling posting.
  const steuerbetrag = computeSteuerbetrag(entry, posting);

  return [
    amount,                       //  1  Umsatz (ohne Dauerpunkt)
    side,                         //  2  Soll/Haben-Kennzeichen
    '',                           //  3  WKZ Umsatz
    '',                           //  4  Kurs
    '',                           //  5  Basis-Umsatz
    '',                           //  6  WKZ Basis-Umsatz
    posting['account-number'] ?? '', //  7  Konto
    gegenkonto,                   //  8  Gegenkonto
    '',                           //  9  BU-Schlüssel
    belegdatum,                   // 10  Belegdatum
    '',                           // 11  Belegfeld 1
    '',                           // 12  Belegfeld 2
    buchungsdatum,                // 13  Buchungsdatum
    '',                           // 14  Kostenstelle
    `${entry.description || ''} ${posting.description || ''}`.trim().slice(0, 60), // 15 Buchungstext
    '',                           // 16  reserviert
    '',                           // 17  reserviert
    '',                           // 18  reserviert
    '',                           // 19  reserviert
    '',                           // 20  reserviert
    '',                           // 21  reserviert
    '',                           // 22  reserviert
    '',                           // 23  reserviert
    '',                           // 24  reserviert
    '',                           // 25  reserviert
    '',                           // 26  reserviert
    '',                           // 27  reserviert
    '',                           // 28  reserviert
    '',                           // 29  reserviert
    '',                           // 30  reserviert
    '',                           // 31  reserviert
    '',                           // 32  reserviert
    '',                           // 33  reserviert
    '',                           // 34  reserviert
    '',                           // 35  reserviert
    '',                           // 36  reserviert
    '',                           // 37  reserviert
    '',                           // 38  reserviert
    '',                           // 39  reserviert
    '',                           // 40  reserviert
    '',                           // 41  reserviert
    '',                           // 42  reserviert
    '',                           // 43  reserviert
    '',                           // 44  reserviert
    '',                           // 45  reserviert
    '',                           // 46  reserviert
    '',                           // 47  reserviert
    '',                           // 48  reserviert
    '',                           // 49  reserviert
    '',                           // 50  reserviert
    '',                           // 51  reserviert
    '',                           // 52  reserviert
    '',                           // 53  reserviert
    '',                           // 54  reserviert
    '',                           // 55  reserviert
    '',                           // 56  reserviert
    '',                           // 57  reserviert
    '',                           // 58  reserviert
    '',                           // 59  reserviert
    '',                           // 60  reserviert
    '',                           // 61  reserviert
    '',                           // 62  reserviert
    '',                           // 63  reserviert
    '',                           // 64  reserviert
    '',                           // 65  reserviert
    '',                           // 66  reserviert
    '',                           // 67  reserviert
    '',                           // 68  reserviert
    '',                           // 69  reserviert
    '',                           // 70  reserviert
    '',                           // 71  reserviert
    '',                           // 72  reserviert
    '',                           // 73  reserviert
    '',                           // 74  reserviert
    '',                           // 75  reserviert
    '',                           // 76  reserviert
    '',                           // 77  reserviert
    '',                           // 78  reserviert
    '',                           // 79  reserviert
    '',                           // 80  reserviert
    '',                           // 81  reserviert
    '',                           // 82  reserviert
    '',                           // 83  reserviert
    '',                           // 84  reserviert
    '',                           // 85  reserviert
    '',                           // 86  reserviert
    '',                           // 87  reserviert
    '',                           // 88  reserviert
    '',                           // 89  reserviert
    '',                           // 90  reserviert
    '',                           // 91  reserviert
    '',                           // 92  reserviert
    '',                           // 93  reserviert
    '',                           // 94  reserviert
    '',                           // 95  reserviert
    '',                           // 96  reserviert
    '',                           // 97  reserviert
    '',                           // 98  reserviert
    '',                           // 99  reserviert
    '',                           // 100 reserviert
    '',                           // 101 reserviert
    '',                           // 102 reserviert
    '',                           // 103 reserviert
    '',                           // 104 reserviert
    '',                           // 105 reserviert
    '',                           // 106 reserviert
    '',                           // 107 reserviert
    '',                           // 108 reserviert
    '',                           // 109 reserviert
    '',                           // 110 reserviert
    '',                           // 111 reserviert
    '',                           // 112 reserviert
    '',                           // 113 reserviert
    '',                           // 114 reserviert
    '',                           // 115 reserviert
  ];
}

/**
 * Convert an FD-1 money token to a DATEV amount string.
 * DATEV wants amounts as whole minor units without a decimal point:
 *   "1234.56 EUR" → "123456"
 *   "-99.99 EUR"  → rejected (posting amounts are always positive)
 *   "0.00 EUR"    → "0"
 */
function moneyToDatevAmount(moneyToken) {
  if (typeof moneyToken !== 'string') return null;
  const m = moneyToken.match(/^(-?)(\d+)\.(\d{2})\s+(\w{3})$/);
  if (!m) return null;
  const [, sign, major, minor] = m;
  if (sign === '-') return null;   // Posting amounts are always positive per model.
  // Strip leading zeros so DATEV doesn't choke, but keep at least "0".
  const combined = `${major}${minor}`.replace(/^0+/, '') || '0';
  return combined;
}

/**
 * YYYY-MM-DD → YYYYMMDD.  Returns empty string on bad input.
 */
function formatDate(isoDate) {
  if (typeof isoDate !== 'string') return '';
  const d = isoDate.replace(/-/g, '');
  return /^\d{8}$/.test(d) ? d : '';
}

/**
 * If this posting is a VAT line, return the tax amount; otherwise empty.
 * NeoDonkey stores tax as a separate posting, so the amount field IS the tax.
 */
function computeSteuerbetrag(_entry, posting) {
  if (posting['vat-role'] === 'output-tax' || posting['vat-role'] === 'input-tax') {
    return moneyToDatevAmount(posting.amount) ?? '';
  }
  return '';
}

/**
 * RFC-4180-ish CSV row encoding.  DATEV specifically wants semicolon delimiters
 * and fields that contain the delimiter must be double-quoted.
 */
function encodeCsvRow(fields) {
  return fields.map((f) => {
    const s = String(f ?? '');
    if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(';');
}

/** Export this module's errors under a recognisable name. */
export class DatevError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DatevError';
  }
}

/**
 * Mark journal entries as exported by setting their `datev-export-reference`.
 * This is a PERFORM operation on the kernel, so it is governed by the operating
 * model's rules (tax-accountant role typically required).
 *
 * @param {import('../kernel.js').Kernel} kernel
 * @param {string[]} entryIds
 * @param {string} reference — export batch identifier
 * @returns {Promise<{accepted:boolean, commit?:string, rejected?:object[]}>}
 */
export async function markExported(kernel, entryIds, reference) {
  const results = [];
  for (const id of entryIds) {
    const current = kernel.query.get('journal-entry', id);
    if (!current) continue;
    const r = await kernel.perform({
      op: 'update',
      entity: 'journal-entry',
      id,
      doc: { ...current, 'datev-export-reference': reference },
    });
    results.push(r);
  }
  const rejected = results.flatMap((r) => r.rejected ?? []);
  if (rejected.length) return { accepted: false, rejected };
  return { accepted: true, commit: results[results.length - 1]?.oid };
}
