import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeDatevHeader,
  serializeDatevPostingLine,
  serializeDatevPostings,
  serializeDatevExport,
  formatDatevAmount,
  formatDatevDate,
  DATEV_EXTF_V700_COLUMNS
} from '../runtime/export/datev.js';

test('formatDatevAmount converts BigInt, integer cents, and money strings with zero float', () => {
  assert.equal(formatDatevAmount(11900n), '119,00');
  assert.equal(formatDatevAmount(50n), '0,50');
  assert.equal(formatDatevAmount(5n), '0,05');
  assert.equal(formatDatevAmount(0n), '0,00');
  assert.equal(formatDatevAmount(123456n), '1234,56');

  assert.equal(formatDatevAmount(11900), '119,00');
  assert.equal(formatDatevAmount(50), '0,50');

  assert.equal(formatDatevAmount('4999.99 EUR'), '4999,99');
  assert.equal(formatDatevAmount('12000.00 EUR'), '12000,00');
  assert.equal(formatDatevAmount('500,50'), '500,50');
  assert.equal(formatDatevAmount('100'), '100,00');

  assert.throws(() => formatDatevAmount(119.50), { name: 'TypeError', message: /integer/ });
  assert.throws(() => formatDatevAmount('invalid-amount'), { name: 'TypeError', message: /Invalid monetary/ });
  assert.throws(() => formatDatevAmount(null), { name: 'TypeError' });
});

test('formatDatevDate formats ISO, YYYYMMDD, DDMM, and Date into DDMM', () => {
  assert.equal(formatDatevDate('2026-08-15'), '1508');
  assert.equal(formatDatevDate('20260815'), '1508');
  assert.equal(formatDatevDate('1508'), '1508');

  const d = new Date(Date.UTC(2026, 7, 15)); // Month index 7 = August
  assert.equal(formatDatevDate(d), '1508');

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

test('serializeDatevPostings and serializeDatevExport construct multi-line EXTF files', () => {
  const headerConfig = {
    beraterNummer: 1001,
    mandantenNummer: 10001,
    wirtschaftsjahrBeginn: '20260101',
    datumVom: '20260101',
    datumBis: '20260131',
    bezeichnung: 'Januar 2026 EXTF Export'
  };

  const postings = [
    {
      amount: '5949.99 EUR',
      side: 'debit',
      konto: '1400',
      gegenkonto: '8400',
      date: '2026-01-05',
      documentRef: 'JE-2026-0002',
      description: 'Sales invoice R-2026-0001'
    },
    {
      amount: '12000.00 EUR',
      side: 'debit',
      konto: '3425',
      gegenkonto: '1600',
      date: '2026-01-08',
      documentRef: 'EK-2026-0001',
      description: 'Supplier invoice EK-2026-0001'
    }
  ];

  const body = serializeDatevPostings(postings);
  const lines = body.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2, 'serializeDatevPostings generates 2 booking lines');

  const fullExport = serializeDatevExport(headerConfig, postings);
  assert.ok(fullExport.startsWith('"EXTF";700;21;1;'));
  assert.ok(fullExport.includes('"Umsatz (ohne Soll/Haben-Kz)";"Soll/Haben-Kennzeichen";'));
  assert.ok(fullExport.includes('"5949,99";"S";"EUR";"";"";"";"1400";"8400";'));
  assert.ok(fullExport.includes('"12000,00";"S";"EUR";"";"";"";"3425";"1600";'));
});
