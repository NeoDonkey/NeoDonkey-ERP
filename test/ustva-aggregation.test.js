import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aggregateUstVa, truncateToEuros } from '../runtime/export/ustva.js';

test('aggregateUstVa computes exact BigInt minor units and Kennziffer totals', () => {
  const postings = [
    { period: '2026-01', vat_code: 'STANDARD_19', net_minor: 100000n, tax_minor: 19000n }, // 1000.00 EUR net, 190.00 EUR tax
    { period: '2026-01', vat_code: 'STANDARD_19', net_minor: 50050n, tax_minor: 9510n },   // 500.50 EUR net, 95.10 EUR tax
    { period: '2026-01', vat_code: 'REDUCED_7', net_minor: 20000n, tax_minor: 1400n },     // 200.00 EUR net, 14.00 EUR tax
    { period: '2026-01', vat_code: 'INTRA_EU_0', net_minor: 30000n, tax_minor: 0n },       // 300.00 EUR net, 0.00 EUR tax
    { period: '2026-01', vat_code: 'INPUT_TAX', net_minor: 40000n, tax_minor: 7600n }      // 400.00 EUR net, 76.00 EUR tax
  ];

  const result = aggregateUstVa(postings, '2026-01');

  // Kz 81 (19% Standard)
  assert.equal(result.kz81.net_minor, 150050n);
  assert.equal(result.kz81.tax_minor, 28510n);
  assert.equal(result.kz81.net_euros, 1500n); // 1500.50 EUR truncated to 1500 EUR

  // Kz 86 (7% Reduced)
  assert.equal(result.kz86.net_minor, 20000n);
  assert.equal(result.kz86.tax_minor, 1400n);
  assert.equal(result.kz86.net_euros, 200n);

  // Kz 41 (0% Intra-EU Supply)
  assert.equal(result.kz41.net_minor, 30000n);
  assert.equal(result.kz41.net_euros, 300n);

  // Kz 66 (Deductible Input Tax)
  assert.equal(result.kz66.tax_minor, 7600n);

  // Kz 83 (Net VAT Prepayment = (285.10 + 14.00) - 76.00 = 223.10 EUR / 22310n)
  assert.equal(result.kz83.tax_minor, 22310n);
});

test('aggregateUstVa filters postings by string period and object period', () => {
  const postings = [
    { period: '2026-01', vat_code: 'STANDARD_19', net_minor: 10000n, tax_minor: 1900n },
    { period: '2026-02', vat_code: 'STANDARD_19', net_minor: 20000n, tax_minor: 3800n }
  ];

  const resJan = aggregateUstVa(postings, '2026-01');
  assert.equal(resJan.kz81.net_minor, 10000n);

  const resFebObj = aggregateUstVa(postings, { year: 2026, month: 2 });
  assert.equal(resFebObj.kz81.net_minor, 20000n);
});

test('truncateToEuros truncates net base cents to integer Euros per UStG § 18 Abs. 1', () => {
  assert.equal(truncateToEuros(1999n), 19n);
  assert.equal(truncateToEuros(100n), 1n);
  assert.equal(truncateToEuros(99n), 0n);
});

test('source guard: no parseFloat, Number(, or toFixed on monetary paths in ustva.js', () => {
  const filePath = path.resolve('runtime/export/ustva.js');
  const code = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(code, /\bparseFloat\b/);
  assert.doesNotMatch(code, /\bNumber\(/);
  assert.doesNotMatch(code, /\.toFixed\(/);
});
