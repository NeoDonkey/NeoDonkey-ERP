import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aggregateUstVa, truncateToEuros } from '../runtime/export/ustva.js';

test('aggregateUstVa computes exact BigInt minor units using operating model fields', () => {
  const postings = [
    // Standard 19% sales
    { 'accounting-period': '2026-07', 'vat-kennzahl': '81', 'vat-role': 'taxable-turnover', amount: '1000.00 EUR' },
    { 'accounting-period': '2026-07', 'vat-kennzahl': '81', 'vat-role': 'output-tax', amount: '190.00 EUR' },
    // Reduced 7% sales
    { 'accounting-period': '2026-07', 'vat-kennzahl': '86', 'vat-role': 'taxable-turnover', amount: '200.00 EUR' },
    { 'accounting-period': '2026-07', 'vat-kennzahl': '86', 'vat-role': 'output-tax', amount: '14.00 EUR' },
    // Intra-community acquisition (19% output tax + 19% deductible input tax)
    { 'accounting-period': '2026-07', 'vat-kennzahl': '89', 'vat-role': 'acquisition-turnover', amount: '12000.00 EUR' },
    { 'accounting-period': '2026-07', 'vat-kennzahl': '89', 'vat-role': 'output-tax', amount: '2280.00 EUR' },
    { 'accounting-period': '2026-07', 'vat-kennzahl': '61', 'vat-role': 'input-tax', amount: '2280.00 EUR' },
    // Deductible supplier input tax
    { 'accounting-period': '2026-07', 'vat-kennzahl': '66', 'vat-role': 'input-tax', amount: '76.00 EUR' }
  ];

  const result = aggregateUstVa(postings, '2026-07');

  // Kz 81
  assert.equal(result.kz81.base_minor, 100000n);
  assert.equal(result.kz81.tax_minor, 19000n);

  // Kz 86
  assert.equal(result.kz86.base_minor, 20000n);
  assert.equal(result.kz86.tax_minor, 1400n);

  // Kz 89 & Kz 61 (Intra-Community Acquisitions)
  assert.equal(result.kz89.base_minor, 1200000n);
  assert.equal(result.kz89.tax_minor, 228000n);
  assert.equal(result.kz61.tax_minor, 228000n);

  // Kz 66
  assert.equal(result.kz66.tax_minor, 7600n);

  // Total Output Tax = 190.00 + 14.00 + 2280.00 = 2484.00 EUR (248400n minor)
  assert.equal(result.total_output_tax_minor, 248400n);

  // Total Input Tax = 2280.00 + 76.00 = 2356.00 EUR (235600n minor)
  assert.equal(result.total_input_tax_minor, 235600n);

  // Kz 83 Payable Balance = 2484.00 - 2356.00 = 128.00 EUR (12800n minor)
  assert.equal(result.kz83_payable_minor, 12800n);
});

test('aggregateUstVa handles reverse charge §13b (Kz 84 & Kz 67)', () => {
  const postings = [
    { 'accounting-period': '2026-07', 'vat-kennzahl': '84', 'vat-role': 'output-tax', amount: '38000n' }, // 380.00 EUR
    { 'accounting-period': '2026-07', 'vat-kennzahl': '67', 'vat-role': 'input-tax', amount: '38000n' }   // 380.00 EUR
  ];

  const result = aggregateUstVa(postings, '2026-07');
  assert.equal(result.kz84.tax_minor, 38000n);
  assert.equal(result.kz67.tax_minor, 38000n);
  assert.equal(result.total_output_tax_minor, 38000n);
  assert.equal(result.total_input_tax_minor, 38000n);
  assert.equal(result.kz83_payable_minor, 0n);
});

test('aggregateUstVa filters postings by period', () => {
  const postings = [
    { 'accounting-period': '2026-07', 'vat-kennzahl': '81', 'vat-role': 'taxable-turnover', amount: 10000n },
    { 'accounting-period': '2026-08', 'vat-kennzahl': '81', 'vat-role': 'taxable-turnover', amount: 20000n }
  ];

  const resJuly = aggregateUstVa(postings, '2026-07');
  assert.equal(resJuly.kz81.base_minor, 10000n);

  const resAug = aggregateUstVa(postings, { 'accounting-period': '2026-08' });
  assert.equal(resAug.kz81.base_minor, 20000n);
});

test('truncateToEuros helper converts cents to integer Euros', () => {
  assert.equal(truncateToEuros(1999n), 19n);
  assert.equal(truncateToEuros(100n), 1n);
});

test('source guard: no parseFloat, Number(, or toFixed on monetary paths in ustva.js', () => {
  const filePath = path.resolve('runtime/export/ustva.js');
  const code = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(code, /\bparseFloat\b/);
  assert.doesNotMatch(code, /\bNumber\(/);
  assert.doesNotMatch(code, /\.toFixed\(/);
});
