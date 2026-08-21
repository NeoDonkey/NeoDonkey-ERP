import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serializeUstVaElsterXml } from '../runtime/vat/ustva-elster.js';

test('serializeUstVaElsterXml generates valid ELSTER XML structure with header and tax grid positions', () => {
  const header = {
    finanzamtNummer: '9198',
    steuernummer: '1981150000501',
    jahr: '2026',
    zeitraum: '01',
    creationDate: '20260201120000',
  };

  const gridTotals = {
    kz81NetMinor: 1000000n, // 10000.00 EUR -> Kz 81 Bemessungsgrundlage = 10000
    kz81TaxMinor: 190000n,  // 1900.00 EUR -> Kz 81 Steuer = 1900.00
    kz86NetMinor: 500000n,  // 5000.00 EUR -> Kz 86 Bemessungsgrundlage = 5000
    kz86TaxMinor: 35000n,   // 350.00 EUR -> Kz 86 Steuer = 350.00
    kz41NetMinor: 200000n,  // 2000.00 EUR -> Kz 41 Bemessungsgrundlage = 2000
    kz66TaxMinor: 40000n,   // 400.00 EUR -> Kz 66 Vorsteuer = 400.00
    kz83TaxMinor: 185000n,  // 1850.00 EUR -> Kz 83 Verbleibende Steuer = 1850.00
  };

  const xml = serializeUstVaElsterXml({ header, gridTotals });

  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML declaration present');
  assert.ok(xml.includes('<Elster xmlns="http://www.elster.de/elsterxml/schema/v1">'), 'Root Elster element with schema namespace');
  assert.ok(xml.includes('<DatenTeil>'), '<DatenTeil> section present');
  assert.ok(xml.includes('<Nutzdatenblock>'), '<Nutzdatenblock> section present');
  assert.ok(xml.includes('<Anmeldesteuern>'), '<Anmeldesteuern> element present');

  // Verify header attributes/elements
  assert.ok(xml.includes('<FinanzamtNummer>9198</FinanzamtNummer>'), 'FinanzamtNummer present');
  assert.ok(xml.includes('<Steuernummer>1981150000501</Steuernummer>'), 'Steuernummer present');
  assert.ok(xml.includes('<Jahr>2026</Jahr>'), 'Jahr present');
  assert.ok(xml.includes('<Zeitraum>01</Zeitraum>'), 'Zeitraum present');

  // Verify Kz grid fields
  assert.ok(xml.includes('<Kz81>10000</Kz81>'), 'Kz81 present');
  assert.ok(xml.includes('<Kz86>5000</Kz86>'), 'Kz86 present');
  assert.ok(xml.includes('<Kz41>2000</Kz41>'), 'Kz41 present');
  assert.ok(xml.includes('<Kz66>400.00</Kz66>'), 'Kz66 Vorsteuer present as string decimal');
  assert.ok(xml.includes('<Kz83>1850.00</Kz83>'), 'Kz83 Tax payable present as string decimal');
});

test('serializeUstVaElsterXml validates mandatory headers and rejects invalid inputs', () => {
  assert.throws(() => {
    serializeUstVaElsterXml({ header: null, gridTotals: {} });
  }, /Missing required header/i);

  assert.throws(() => {
    serializeUstVaElsterXml({
      header: { finanzamtNummer: '123', steuernummer: '1234567890123', jahr: '2026', zeitraum: '01' },
      gridTotals: {},
    });
  }, /FinanzamtNummer must be 4 digits/i);

  assert.throws(() => {
    serializeUstVaElsterXml({
      header: { finanzamtNummer: '9198', steuernummer: '12345', jahr: '2026', zeitraum: '01' },
      gridTotals: {},
    });
  }, /Steuernummer must be 11 to 13 digits/i);
});

test('serializeUstVaElsterXml source guard - no parseFloat, Number(, or toFixed on money paths in ustva-elster.js', () => {
  const content = readFileSync(new URL('../runtime/vat/ustva-elster.js', import.meta.url), 'utf8');
  assert.doesNotMatch(content, /parseFloat/);
  assert.doesNotMatch(content, /Number\(/);
  assert.doesNotMatch(content, /\.toFixed/);
});
