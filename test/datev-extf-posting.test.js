import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serializeDatevBookingLine,
  serializeDatevExport,
  formatDatevAmount,
  formatDatevBelegdatum,
  DATEV_EXTF_V700_COLUMNS
} from '../runtime/export/datev.js';

test('formatDatevAmount converts monetary values to comma-separated decimal string without floats', () => {
  // String money token
  assert.equal(formatDatevAmount('119.00 EUR'), '119,00');
  assert.equal(formatDatevAmount('4999.99 EUR'), '4999,99');
  assert.equal(formatDatevAmount('0.50 EUR'), '0,50');

  // BigInt minor units (11900 cents = 119,00)
  assert.equal(formatDatevAmount(11900n), '119,00');
  assert.equal(formatDatevAmount(50n), '0,50');
  assert.equal(formatDatevAmount(0n), '0,00');

  // Money object shape
  assert.equal(formatDatevAmount({ minor: 125050n, currency: 'EUR' }), '1250,50');

  // Negative amounts formatted as absolute amount
  assert.equal(formatDatevAmount('-119.00 EUR'), '119,00');
  assert.equal(formatDatevAmount(-11900n), '119,00');

  // Float numbers must be explicitly refused
  assert.throws(
    () => formatDatevAmount(119.00),
    { name: 'TypeError', message: /Floating point numbers not permitted/ }
  );

  // Invalid formats refused
  assert.throws(
    () => formatDatevAmount('abc'),
    { name: 'TypeError' }
  );
  assert.throws(
    () => formatDatevAmount(null),
    { name: 'TypeError' }
  );
});

test('formatDatevBelegdatum converts date strings to DDMM format', () => {
  assert.equal(formatDatevBelegdatum('2026-08-15'), '1508');
  assert.equal(formatDatevBelegdatum('20260815'), '1508');
  assert.equal(formatDatevBelegdatum('15082026'), '1508');
  assert.equal(formatDatevBelegdatum('1508'), '1508');

  assert.throws(
    () => formatDatevBelegdatum('invalid-date'),
    { name: 'TypeError' }
  );
  assert.throws(
    () => formatDatevBelegdatum(123),
    { name: 'TypeError' }
  );
});

test('serializeDatevBookingLine constructs exact 116-column DATEV CSV booking line', () => {
  const posting = {
    amount: '119.00 EUR',
    side: 'debit',
    konto: '1400',
    gegenkonto: '8400',
    buSchlussel: '9',
    belegdatum: '2026-08-15',
    belegfeld1: 'RE-2026-001',
    belegfeld2: 'Z-01',
    buchungstext: 'Erlöse 19% USt Invoice RE-2026-001'
  };

  const line = serializeDatevBookingLine(posting);
  const fields = line.split(';');

  assert.equal(fields.length, DATEV_EXTF_V700_COLUMNS.length, 'Booking line must have exactly 116 columns');
  assert.equal(fields[0], '"119,00"', 'Column 1: Umsatz');
  assert.equal(fields[1], '"S"', 'Column 2: Soll/Haben-Kennzeichen');
  assert.equal(fields[2], '"EUR"', 'Column 3: WKZ Umsatz');
  assert.equal(fields[6], '"1400"', 'Column 7: Konto');
  assert.equal(fields[7], '"8400"', 'Column 8: Gegenkonto');
  assert.equal(fields[8], '"9"', 'Column 9: BU-Schlüssel');
  assert.equal(fields[9], '"1508"', 'Column 10: Belegdatum');
  assert.equal(fields[10], '"RE-2026-001"', 'Column 11: Belegfeld 1');
  assert.equal(fields[11], '"Z-01"', 'Column 12: Belegfeld 2');
  assert.equal(fields[13], '"Erlöse 19% USt Invoice RE-2026-001"', 'Column 14: Buchungstext');
});

test('serializeDatevBookingLine handles field truncation, credit side, and quote escaping', () => {
  const longText = 'A'.repeat(80);
  const longRef = 'R'.repeat(50);
  const posting = {
    amount: 5000n,
    sollHaben: 'H',
    konto: 8400,
    gegenkonto: 1200,
    belegdatum: '20260820',
    belegfeld1: longRef,
    buchungstext: 'Consulting "Project Alpha" & Beta'
  };

  const line = serializeDatevBookingLine(posting);
  const fields = line.split(';');

  assert.equal(fields[0], '"50,00"');
  assert.equal(fields[1], '"H"');
  assert.equal(fields[6], '"8400"');
  assert.equal(fields[7], '"1200"');
  assert.equal(fields[9], '"2008"');
  assert.equal(fields[10], `"${'R'.repeat(36)}"`, 'Belegfeld 1 must be truncated to 36 chars');
  assert.equal(fields[13], '"Consulting ""Project Alpha"" & Beta"', 'Internal quotes must be escaped as double quotes');
});

test('serializeDatevBookingLine validates mandatory parameters strictly', () => {
  assert.throws(
    () => serializeDatevBookingLine(null),
    { name: 'TypeError', message: /requires a posting object/ }
  );

  assert.throws(
    () => serializeDatevBookingLine({ konto: '1400', belegdatum: '2026-08-15' }),
    { name: 'TypeError', message: /posting amount is required/ }
  );

  assert.throws(
    () => serializeDatevBookingLine({ amount: '100.00 EUR', belegdatum: '2026-08-15' }),
    { name: 'TypeError', message: /posting konto is required/ }
  );

  assert.throws(
    () => serializeDatevBookingLine({ amount: '100.00 EUR', konto: '1400' }),
    { name: 'TypeError', message: /posting belegdatum is required/ }
  );
});

test('serializeDatevExport generates complete CRLF export document with header and postings', () => {
  const header = {
    beraterNummer: 1001,
    mandantenNummer: 10001,
    wirtschaftsjahrBeginn: '20260101',
    datumVom: '20260101',
    datumBis: '20260131'
  };

  const postings = [
    {
      amount: '119.00 EUR',
      side: 'debit',
      konto: '1400',
      gegenkonto: '8400',
      belegdatum: '2026-01-15',
      belegfeld1: 'RE-101',
      buchungstext: 'Kundenrechnung'
    },
    {
      amount: '119.00 EUR',
      side: 'credit',
      konto: '8400',
      gegenkonto: '1400',
      belegdatum: '2026-01-15',
      belegfeld1: 'RE-101',
      buchungstext: 'Erlöse 19%'
    }
  ];

  const exportCsv = serializeDatevExport({ header, postings });
  assert.ok(exportCsv.endsWith('\r\n'));

  const lines = exportCsv.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 4, 'Export CSV must have 2 header lines and 2 posting lines');

  // Verify line 1 is EXTF header
  assert.ok(lines[0].startsWith('"EXTF";700;21;1;'));
  // Verify line 2 is column header
  assert.ok(lines[2].startsWith('"119,00";"S";"EUR"'));
  assert.ok(lines[3].startsWith('"119,00";"H";"EUR"'));
});
