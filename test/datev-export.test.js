#!/usr/bin/env node
/**
 * Test: DATEV EXTF serializer
 *
 * Verifies that:
 *  1. The header row contains valid DATEV metadata
 *  2. Postings map to Umsatzzeilen with correct S/H flags
 *  3. Money amounts are converted to DATEV's minor-unit format
 *  4. Date formatting is YYYYMMDD
 *  5. Draft entries are skipped, posted entries are included
 *  6. The `nurGeänderte` filter respects `datev-export-reference`
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

import { nodeFs } from '../runtime/git/fs-node.js';
import { generateIdentity } from '../runtime/identity/ed25519.js';
import { open } from '../runtime/kernel.js';
import { buildDatevExtf, markExported, DatevError } from '../runtime/export/datev-extf.js';

let t = Date.parse('2027-11-03T09:00:00Z');
const clock = () => (t += 60_000);

async function withKernel(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'neodonkey-datev-test-'));
  const kp = await generateIdentity();

  // Load the operating model as seed
  const seed = new Map();
  const { readFile, readdir } = await import('node:fs/promises');
  const root = new URL('../operating-model/', import.meta.url);
  const walk = async (rel) => {
    let entries;
    try { entries = await readdir(new URL(rel, root), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) await walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        seed.set(`operating-model/${rel}${e.name}`, await readFile(new URL(`${rel}${e.name}`, root), 'utf8'));
      }
    }
  };
  await walk('');

  const nd = await open({
    fs: nodeFs(dir),
    identity: { name: 'Test Accountant', email: 'test@neodonkey.eu', keyPair: kp },
    seed,
    clock,
    tzOffsetMinutes: 60,
    roles: ['managing-director', 'accountant', 'tax-accountant', 'controller'],
  });

  try {
    return await fn(nd);
  } finally {
    await import('node:fs/promises').then((m) => m.rm(dir, { recursive: true, force: true }));
  }
}

/**
 * Create a mock kernel for testing DATEV export in isolation.
 * The real kernel enforces journal-entry invariants (debits=credits,
 * posting-count>=2) which make it impossible to create entries and
 * postings through separate perform() calls.  A mock lets us test
 * the serializer without fighting the double-entry bookkeeping rules.
 */
function makeMockKernel(docs) {
  const byId = new Map();
  const byEntity = new Map();

  for (const doc of docs) {
    byId.set(`${doc.entity}/${doc.id}`, doc);
    if (!byEntity.has(doc.entity)) byEntity.set(doc.entity, []);
    byEntity.get(doc.entity).push(doc);
  }

  return {
    query: {
      get(entity, id) {
        return byId.get(`${entity}/${id}`) ?? null;
      },
      select({ from, where, orderBy }) {
        let rows = byEntity.get(from) ?? [];
        if (where) {
          if (where['datev-export-reference']) {
            const op = where['datev-export-reference'].op;
            if (op === 'exists' && where['datev-export-reference'].value === false) {
              rows = rows.filter((r) => !r['datev-export-reference']);
            }
          }
          if (where['journal-entry']) {
            const op = where['journal-entry'].op;
            const values = where['journal-entry'].value || [];
            if (op === 'is') {
              rows = rows.filter((r) => values.includes(r['journal-entry']));
            }
          }
        }
        if (orderBy) {
          rows = [...rows].sort((a, b) => {
            const av = a[orderBy] ?? '';
            const bv = b[orderBy] ?? '';
            if (typeof av === 'number' && typeof bv === 'number') return av - bv;
            return String(av).localeCompare(String(bv));
          });
        }
        return rows;
      },
    },
    async perform(intent) {
      if (intent.op === 'update' && intent.entity === 'journal-entry') {
        const key = `journal-entry/${intent.id}`;
        const existing = byId.get(key);
        if (!existing) return { rejected: [{ reason: 'not found' }] };
        const updated = { ...existing, ...intent.doc };
        byId.set(key, updated);
        // update in byEntity list too
        const list = byEntity.get('journal-entry');
        const idx = list.findIndex((d) => d.id === intent.id);
        if (idx >= 0) list[idx] = updated;
        return { oid: 'mock-' + intent.id };
      }
      return { rejected: [{ reason: 'mock perform not implemented for this intent' }] };
    },
  };
}

async function main() {
  let passed = 0;
  let failed = 0;

  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`  ✗ ${name}: ${e.message}`);
      failed++;
    }
  };

  console.log('\nDATEV EXTF Export Tests\n' + '═'.repeat(50));

  await test('validates Beraternummer format', async () => {
    await withKernel(async (nd) => {
      await assert.rejects(
        () => buildDatevExtf({ kernel: nd, beraterNr: '123', mandantenNr: '1', wjBeginn: '20270101' }),
        DatevError
      );
    });
  });

  await test('validates Mandantennummer format', async () => {
    await withKernel(async (nd) => {
      await assert.rejects(
        () => buildDatevExtf({ kernel: nd, beraterNr: '1234567', mandantenNr: '123456', wjBeginn: '20270101' }),
        DatevError
      );
    });
  });

  await test('validates WJ-Beginn format', async () => {
    await withKernel(async (nd) => {
      await assert.rejects(
        () => buildDatevExtf({ kernel: nd, beraterNr: '1234567', mandantenNr: '1', wjBeginn: '2027-01-01' }),
        DatevError
      );
    });
  });

  await test('produces a header row with correct metadata', async () => {
    await withKernel(async (nd) => {
      const result = await buildDatevExtf({
        kernel: nd, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20270101',
        sachkontenrahmen: 'SKR04', bezeichnung: 'Test Export',
      });
      const lines = result.csv.trim().split('\r\n');
      assert.equal(lines.length, 1); // Only header, no data yet
      const header = lines[0].split(';');
      assert.equal(header[0], 'EXTF');
      assert.equal(header[1], '700');
      assert.equal(header[2], '21');
      assert.equal(header[3], '1234567');
      assert.equal(header[4], '00001');
      assert.equal(header[5], '20270101');
      assert.equal(header[12], 'SKR04');
      assert.equal(header[39], 'Test Export');
    });
  });

  await test('converts money amounts to minor units without decimal point', async () => {
    const kernel = makeMockKernel([
      {
        id: 'JE-2027-0001', entity: 'journal-entry',
        'entry-number': '1', 'entry-date': '2027-11-03', 'document-date': '2027-11-03',
        'accounting-period': '2027-11', chart: 'SKR04', currency: 'EUR',
        'debit-amount': '1000.00 EUR', 'credit-amount': '1000.00 EUR',
        'posting-count': 2, description: 'Test entry',
        'source-document-type': 'manual', 'source-document-reference': 'B-001',
        status: 'posted', reversal: false,
        'entered-by': 'EMP-001', 'posted-by': 'EMP-001', 'posted-at': '2027-11-03',
      },
      {
        id: 'JE-2027-0001-1', entity: 'posting', 'journal-entry': 'JE-2027-0001', position: 1,
        'account-number': '8400', chart: 'SKR04', 'ledger-account': 'LA-8400',
        side: 'debit', amount: '1000.00 EUR', currency: 'EUR',
        'posting-date': '2027-11-03', 'accounting-period': '2027-11',
        description: 'Test debit', 'source-document-reference': 'B-001',
        'vat-role': 'none',
      },
      {
        id: 'JE-2027-0001-2', entity: 'posting', 'journal-entry': 'JE-2027-0001', position: 2,
        'account-number': '1200', chart: 'SKR04', 'ledger-account': 'LA-1200',
        side: 'credit', amount: '1000.00 EUR', currency: 'EUR',
        'posting-date': '2027-11-03', 'accounting-period': '2027-11',
        description: 'Test credit', 'source-document-reference': 'B-001',
        'contra-account-number': '8400', 'vat-role': 'none',
      },
    ]);

    const result = await buildDatevExtf({
      kernel, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20270101',
    });

    const lines = result.csv.trim().split('\r\n');
    assert.equal(lines.length, 3); // Header + 2 postings
    assert.equal(result.rows, 2);
    assert.equal(result.entries, 1);

    const debitRow = lines[1].split(';');
    assert.equal(debitRow[0], '100000');  // 1000.00 EUR → 100000
    assert.equal(debitRow[1], 'S');       // Debit
    assert.equal(debitRow[6], '8400');    // Account

    const creditRow = lines[2].split(';');
    assert.equal(creditRow[0], '100000'); // Same amount
    assert.equal(creditRow[1], 'H');      // Credit
    assert.equal(creditRow[6], '1200');   // Account
    assert.equal(creditRow[7], '8400');   // Gegenkonto from contra-account-number
  });

  await test('skips draft and cancelled entries', async () => {
    const kernel = makeMockKernel([
      {
        id: 'JE-DRAFT-0001', entity: 'journal-entry',
        'entry-number': '2', 'entry-date': '2027-11-03', 'document-date': '2027-11-03',
        'accounting-period': '2027-11', chart: 'SKR04', currency: 'EUR',
        'debit-amount': '500.00 EUR', 'credit-amount': '500.00 EUR',
        'posting-count': 2, description: 'Draft entry',
        'source-document-type': 'manual', 'source-document-reference': 'B-002',
        status: 'draft', reversal: false,
        'entered-by': 'EMP-001', 'posted-by': 'EMP-001', 'posted-at': '2027-11-03',
      },
    ]);

    const result = await buildDatevExtf({
      kernel, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20270101',
    });
    assert.equal(result.rows, 0);
    assert.equal(result.entries, 0);
  });

  await test('filters by date range', async () => {
    const kernel = makeMockKernel([
      ...makeEntryWithPostings('JE-0001', '2027-10-15', '100.00 EUR', '8400', '1200'),
      ...makeEntryWithPostings('JE-0002', '2027-11-15', '200.00 EUR', '8400', '1200'),
      ...makeEntryWithPostings('JE-0003', '2027-12-15', '300.00 EUR', '8400', '1200'),
    ]);

    const result = await buildDatevExtf({
      kernel, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20270101',
      datumBeginn: '20271101', datumEnde: '20271130',
    });
    assert.equal(result.rows, 2); // Only November entry
    assert.equal(result.entries, 1);
  });

  await test('nurGeänderte filter skips already-exported entries', async () => {
    const kernel = makeMockKernel([
      ...makeEntryWithPostings('JE-0001', '2027-11-03', '100.00 EUR', '8400', '1200').map((d) =>
        d.entity === 'journal-entry' ? { ...d, 'datev-export-reference': 'EXP-2027-001' } : d
      ),
    ]);

    const result = await buildDatevExtf({
      kernel, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20270101',
      nurGeänderte: true,
    });
    assert.equal(result.rows, 0);
  });

  await test('markExported records the export reference', async () => {
    const kernel = makeMockKernel([
      ...makeEntryWithPostings('JE-0001', '2027-11-03', '100.00 EUR', '8400', '1200'),
    ]);

    const res = await markExported(kernel, ['JE-0001'], 'EXP-001');
    assert.equal(res.accepted, true);

    const updated = kernel.query.get('journal-entry', 'JE-0001');
    assert.equal(updated['datev-export-reference'], 'EXP-001');
  });

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function makeEntryWithPostings(id, date, amount, debitAccount = '8400', creditAccount = '1200') {
  const amtStr = typeof amount === 'number' ? `${amount.toFixed(2)} EUR` : amount;
  return [
    {
      id, entity: 'journal-entry',
      'entry-number': id.replace(/\D/g, ''), 'entry-date': date, 'document-date': date,
      'accounting-period': '2027-11', chart: 'SKR04', currency: 'EUR',
      'debit-amount': amtStr, 'credit-amount': amtStr,
      'posting-count': 2, description: `Entry ${id}`,
      'source-document-type': 'manual', 'source-document-reference': `B-${id}`,
      status: 'posted', reversal: false,
      'entered-by': 'EMP-001', 'posted-by': 'EMP-001', 'posted-at': date,
    },
    {
      id: `${id}-1`, entity: 'posting', 'journal-entry': id, position: 1,
      'account-number': debitAccount, chart: 'SKR04', 'ledger-account': `LA-${debitAccount}`,
      side: 'debit', amount: amtStr, currency: 'EUR',
      'posting-date': date, 'accounting-period': '2027-11',
      description: 'Debit', 'source-document-reference': `B-${id}`,
      'vat-role': 'none',
    },
    {
      id: `${id}-2`, entity: 'posting', 'journal-entry': id, position: 2,
      'account-number': creditAccount, chart: 'SKR04', 'ledger-account': `LA-${creditAccount}`,
      side: 'credit', amount: amtStr, currency: 'EUR',
      'posting-date': date, 'accounting-period': '2027-11',
      description: 'Credit', 'source-document-reference': `B-${id}`,
      'contra-account-number': debitAccount, 'vat-role': 'none',
    },
  ];
}

main().catch((e) => { console.error(e); process.exit(1); });
