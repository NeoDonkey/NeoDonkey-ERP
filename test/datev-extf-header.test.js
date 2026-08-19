import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeDatevHeader, DATEV_EXTF_V700_COLUMNS, encodeWindows1252 } from '../runtime/export/datev.js';

test('serializeDatevHeader generates DATEV EXTF v700 header lines with exact format', () => {
  const config = {
    beraterNummer: 1001,
    mandantenNummer: 10001,
    wirtschaftsjahrBeginn: '20260101',
    datumVom: '20260101',
    datumBis: '20260131',
    sachkontenlange: 4,
    bezeichnung: 'Januar 2026 Buchungen',
    creationDate: '20260131123000000',
    dikennzeichen: 'ND'
  };

  const output = serializeDatevHeader(config);
  assert.ok(output.endsWith('\r\n'), 'Output must end with CRLF');

  const lines = output.split('\r\n').filter(Boolean);
  assert.equal(lines.length, 2, 'Header output must contain exactly 2 non-empty lines');

  // Line 1 assertions
  const line1Fields = lines[0].split(';');
  assert.equal(line1Fields.length, 26, 'Header Line 1 must contain 26 attributes');
  assert.equal(line1Fields[0], '"EXTF"');
  assert.equal(line1Fields[1], '700');
  assert.equal(line1Fields[2], '21');
  assert.equal(line1Fields[3], '1');
  assert.equal(line1Fields[4], '"20260131123000000"');
  assert.equal(line1Fields[6], '"ND"');
  assert.equal(line1Fields[10], '1001');
  assert.equal(line1Fields[11], '10001');
  assert.equal(line1Fields[12], '"20260101"');
  assert.equal(line1Fields[13], '4');
  assert.equal(line1Fields[14], '"20260101"');
  assert.equal(line1Fields[15], '"20260131"');
  assert.equal(line1Fields[16], '"Januar 2026 Buchungen"');
  assert.equal(line1Fields[21], '"EUR"');

  // Line 2 assertions (116 columns)
  const line2Fields = lines[1].split(';');
  assert.equal(line2Fields.length, DATEV_EXTF_V700_COLUMNS.length, `Line 2 must contain ${DATEV_EXTF_V700_COLUMNS.length} columns`);
  assert.equal(line2Fields[0], '"Umsatz (ohne Soll/Haben-Kz)"');
  assert.equal(line2Fields[1], '"Soll/Haben-Kennzeichen"');
  assert.equal(line2Fields[6], '"Konto"');
  assert.equal(line2Fields[7], '"Gegenkonto (ohne BU-Schlüssel)"');
});

test('serializeDatevHeader validates mandatory parameters and ranges strictly', () => {
  const validConfig = {
    beraterNummer: 1001,
    mandantenNummer: 10001,
    wirtschaftsjahrBeginn: '20260101',
    datumVom: '20260101',
    datumBis: '20260131'
  };

  assert.throws(
    () => serializeDatevHeader(null),
    { name: 'TypeError', message: /requires a configuration object/ }
  );

  assert.throws(
    () => serializeDatevHeader({ ...validConfig, beraterNummer: undefined }),
    { name: 'TypeError', message: /beraterNummer/ }
  );

  assert.throws(
    () => serializeDatevHeader({ ...validConfig, beraterNummer: -5 }),
    { name: 'TypeError', message: /Invalid beraterNummer/ }
  );

  assert.throws(
    () => serializeDatevHeader({ ...validConfig, mandantenNummer: 100000 }),
    { name: 'TypeError', message: /Invalid mandantenNummer/ }
  );

  assert.throws(
    () => serializeDatevHeader({ ...validConfig, wirtschaftsjahrBeginn: '2026-01-01' }),
    { name: 'TypeError', message: /wirtschaftsjahrBeginn/ }
  );

  assert.throws(
    () => serializeDatevHeader({ ...validConfig, sachkontenlange: 3 }),
    { name: 'TypeError', message: /Invalid sachkontenlange/ }
  );
});

test('encodeWindows1252 converts special German characters and Euro symbol correctly', () => {
  const sampleText = 'Umsatz u. USt-ID € äöüÄÖÜß';
  const encoded = encodeWindows1252(sampleText);

  assert.ok(encoded instanceof Uint8Array);
  assert.equal(encoded.length, sampleText.length);

  // Assert '€' is 0x80 in Windows-1252
  const euroIndex = sampleText.indexOf('€');
  assert.equal(encoded[euroIndex], 0x80);

  // Assert 'ä' (0x00e4), 'ö' (0x00f6), 'ü' (0x00fc), 'ß' (0x00df)
  const aUmlautIndex = sampleText.indexOf('ä');
  assert.equal(encoded[aUmlautIndex], 0xe4);
});
