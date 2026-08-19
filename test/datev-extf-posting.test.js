import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeDatevHeader,
  serializeDatevPostingLine,
  serializeDatevPostings,
  serializeDatevExport,
  serializeDatevExportBytes,
  formatDatevAmount,
  formatDatevDate,
  DATEV_EXTF_V700_COLUMNS
} from '../runtime/export/datev.js';

test('formatDatevAmount converts BigInt, integer cents, negative values, and money strings with zero float', () => {
  assert.deepEqual(formatDatevAmount(11900n), { formatted: '119,00', isNegative: false });
  assert.deepEqual(formatDatevAmount(50n), { formatted: '0,50', isNegative: false });
  assert.deepEqual(formatDatevAmount(-11900n), { formatted: '119,00', isNegative: true });
  assert.deepEqual(formatDatevAmount(0n), { formatted: '0,00', isNegative: false });
  assert.deepEqual(formatDatevAmount(123456n), { formatted: '1234,56', isNegative: false });

  assert.deepEqual(formatDatevAmount(11900), { formatted: '119,00', isNegative: false });
  assert.deepEqual(formatDatevAmount(-50), { formatted: '0,50', isNegative: true });

  assert.deepEqual(formatDatevAmount('4999.99 EUR'), { formatted: '4999,99', isNegative: false });
  assert.deepEqual(formatDatevAmount('-12000.00 EUR'), { formatted: '12000,00', isNegative: true });
  assert.deepEqual(formatDatevAmount('500,50'), { formatted: '500,50', isNegative: false });

  assert.throws(() => formatDatevAmount(119.50), { name: 'TypeError', message: /integer/ });
  assert.throws(() => formatDatevAmount('invalid-amount'), { name: 'TypeError', message: /Invalid monetary/ });
  assert.throws(() => formatDatevAmount(null), { name: 'TypeError' });
});

test('formatDatevDate strictly validates DDMM, ISO, YYYYMMDD, and Date objects', () => {
  assert.equal(formatDatevDate('2026-08-15'), '1508');
  assert.equal(formatDatevDate('20260815'), '1508');
  assert.equal(formatDatevDate('1508'), '1508');

  const d = new Date(Date.UTC(2026, 7, 15)); // Month index 7 = August
  assert.equal(formatDatevDate(d), '1508');

  // Strict DDMM validation checks month 01-12 and day 01-31
  assert.throws(() => formatDatevDate('2026'), { name: 'TypeError', message: /Invalid DDMM date/ });
  assert.throws(() => formatDatevDate('3212'), { name: 'TypeError', message: /Invalid DDMM date/ });
  assert.throws(() => formatDatevDate('1513'), { name: 'TypeError', message: /Invalid DDMM date/ });
  assert.throws(() => formatDatevDate('2026/08/15'), { name: 'TypeError', message: /Invalid DATEV date/ });
  assert.throws(() => formatDatevDate(null), { name: 'TypeError' });
});

test('serializeDatevPostingLine converts posting into exact 116-column CRLF EXTF line', () => {
  const posting = {
    amount: 11900n,
    side: 'debit',
    konto: '1400',
    gegenkonto: '8400',
    buSchlussel: '9',
    date: '2026-08-15',
    documentRef: 'INV-2026-001',
    description: 'Erlöse 19% USt Feinkost Weber',
    currency: 'EUR'
  };

  const line = serializeDatevPostingLine(posting);
  assert.ok(line.endsWith('\r\n'), 'Booking line must end with CRLF');

  const fields = line.trim().split(';');
  assert.equal(fields.length, DATEV_EXTF_V700_COLUMNS.length, `Posting line must have exactly ${DATEV_EXTF_V700_COLUMNS.length} columns`);

  assert.equal(fields[0], '"119,00"', 'Col 0: Umsatz');
  assert.equal(fields[1], '"S"', 'Col 1: Soll/Haben-Kz');
  assert.equal(fields[2], '"EUR"', 'Col 2: WKZ Umsatz');
  assert.equal(fields[6], '"1400"', 'Col 6: Konto');
  assert.equal(fields[7], '"8400"', 'Col 7: Gegenkonto');
  assert.equal(fields[8], '"9"', 'Col 8: BU-Schlüssel');
  assert.equal(fields[9], '"1508"', 'Col 9: Belegdatum');
  assert.equal(fields[10], '"INV-2026-001"', 'Col 10: Belegfeld 1');
  assert.equal(fields[13], '"Erlöse 19% USt Feinkost Weber"', 'Col 13: Buchungstext');
});

test('serializeDatevPostingLine handles negative amounts and side derivation', () => {
  const line1 = serializeDatevPostingLine({
    amount: '-5949.99 EUR', // Negative amount with no explicit side -> defaults to 'H'
    konto: 8400,
    gegenkonto: 1400,
    date: '20260705'
  });
  const fields1 = line1.trim().split(';');
  assert.equal(fields1[0], '"5949,99"');
  assert.equal(fields1[1], '"H"');

  const line2 = serializeDatevPostingLine({
    amount: '-5949.99 EUR',
    side: 'debit', // Explicit side 'debit' -> respects 'S' while formatting positive Umsatz
    konto: 1400,
    gegenkonto: 8400,
    date: '20260705'
  });
  const fields2 = line2.trim().split(';');
  assert.equal(fields2[0], '"5949,99"');
  assert.equal(fields2[1], '"S"');
});

test('serializeDatevPostingLine handles credit side and field truncation/escaping', () => {
  const longText = 'A'.repeat(70);
  const longRef = 'R'.repeat(40);

  const posting = {
    amount: '5949.99 EUR',
    side: 'credit',
    konto: 8400,
    gegenkonto: 1400,
    date: '20260705',
    documentRef: longRef,
    description: longText
  };

  const line = serializeDatevPostingLine(posting);
  const fields = line.trim().split(';');

  assert.equal(fields[0], '"5949,99"');
  assert.equal(fields[1], '"H"');
  assert.equal(fields[6], '"8400"');
  assert.equal(fields[7], '"1400"');
  assert.equal(fields[9], '"0507"');
  assert.equal(fields[10], `"${'R'.repeat(36)}"`, 'Belegfeld 1 truncated to 36 chars');
  assert.equal(fields[13], `"${'A'.repeat(60)}"`, 'Buchungstext truncated to 60 chars');
});

test('serializeDatevPostingLine validates mandatory konto and gegenkonto', () => {
  assert.throws(
    () => serializeDatevPostingLine({ amount: 100n, gegenkonto: '8400' }),
    { name: 'TypeError', message: /konto/ }
  );

  assert.throws(
    () => serializeDatevPostingLine({ amount: 100n, konto: '1400' }),
    { name: 'TypeError', message: /gegenkonto/ }
  );
});

test('serializeDatevExportBytes produces Windows-1252 Uint8Array binary output', () => {
  const headerConfig = {
    beraterNummer: 1001,
    mandantenNummer: 10001,
    wirtschaftsjahrBeginn: '20260101',
    datumVom: '20260101',
    datumBis: '20260131',
    bezeichnung: 'Umsatz u. USt-ID € äöüÄÖÜß Export',
    buchungstyp: 1,
    rechnungslegungskreis: 0,
    festschreibung: 1,
    currency: 'EUR'
  };

  const postings = [
    {
      amount: '5949.99 EUR',
      side: 'debit',
      konto: '1400',
      gegenkonto: '8400',
      date: '2026-01-05',
      documentRef: 'JE-2026-0002',
      description: 'Sales invoice R-2026-0001 €'
    }
  ];

  const exportText = serializeDatevExport(headerConfig, postings);
  assert.ok(exportText.includes(';1;0;1;"EUR";'));

  const exportBytes = serializeDatevExportBytes(headerConfig, postings);
  assert.ok(exportBytes instanceof Uint8Array);
  assert.equal(exportBytes.length, exportText.length);

  // Assert '€' is encoded as 0x80 in Windows-1252 byte representation
  const euroIdx = exportText.indexOf('€');
  assert.ok(euroIdx > 0);
  assert.equal(exportBytes[euroIdx], 0x80);
});
