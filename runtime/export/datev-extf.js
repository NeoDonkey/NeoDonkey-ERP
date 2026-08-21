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
      // The kernel's query language (runtime/read/query.js) has no "is" operator;
      // "in" with a one-element array is the supported way to match a reference.
      where: { 'journal-entry': { op: 'in', value: [entry.id] } },
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
