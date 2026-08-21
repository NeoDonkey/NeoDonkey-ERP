/**
 * test/datev-extf-select.test.js — the DATEV EXTF export against the REAL kernel (issue #134).
 *
 * `runtime/export/datev-extf.js` reads each entry's postings through `kernel.query.select(...)`,
 * which is the read index (`runtime/read/index.js`) over the real query language
 * (`runtime/read/query.js`). That language has no "is" operator — `compileWhere` refuses it with
 * `QueryError` — but `selectPostings` asked for it, so the export threw on every posted entry in a
 * real workspace. The old test (`test/datev-export.test.js`) never saw it because it drives the
 * serializer with a mock kernel whose `select` hand-implements "is".
 *
 * This file closes both halves: a real workspace is seeded through `runtime/kernel.js` `open()`,
 * an issued sales invoice is posted through the real rule engine (`processes/journal-posting.md`
 * creates the three legs, `information/journal-entry.md`'s invariants check them), and the export
 * is asserted against what is actually in the repository — header row, one booking line per
 * posting, ordered by position, with the accounts and amounts the rules determined.
 *
 * Zero dependencies. `node --test test/datev-extf-select.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFs } from '../runtime/git/fs-node.js';
import { generateIdentity } from '../runtime/identity/ed25519.js';
import { open } from '../runtime/kernel.js';
import { buildDatevExtf } from '../runtime/export/datev-extf.js';

/** A fixed clock. Determinism is a feature, not a test trick. */
let t = Date.parse('2026-01-10T09:00:00Z');
const clock = () => (t += 60_000);

/** The operating model ships as text in the repo; it seeds every fresh workspace. */
async function loadOperatingModel() {
  const root = new URL('../operating-model/', import.meta.url);
  const seed = new Map();
  const walk = async (rel) => {
    let entries;
    try { entries = await readdir(new URL(rel, root), { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) await walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        seed.set(`operating-model/${rel}${e.name}`,
          await readFile(new URL(`${rel}${e.name}`, root), 'utf8'));
      }
    }
  };
  await walk('');
  return seed;
}

/**
 * Open a real workspace in a temp directory. The founder holds every role the world below
 * needs — what a founder on day 1 actually is (see demo/sarah.mjs).
 */
async function openWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'neodonkey-datev-select-'));
  const kp = await generateIdentity();
  const nd = await open({
    fs: nodeFs(dir),
    identity: { name: 'Test Accountant', email: 'test@neodonkey.eu', keyPair: kp },
    seed: await loadOperatingModel(),
    clock,
    tzOffsetMinutes: 60,
    roles: ['managing-director', 'controller', 'tax-accountant', 'accountant',
            'customer-service-agent', 'category-manager'],
  });
  return { dir, nd };
}

/** perform() that fails the test loudly instead of letting a rejection slip through. */
async function mustPerform(nd, label, intent) {
  const r = await nd.perform(intent);
  assert.ok(!r.rejected,
    `${label} was rejected: ${(r.rejected ?? []).map((x) => `${x.reason} (${x.at ?? 'no ref'})`).join(' | ')}`);
  return r;
}

/**
 * Build the smallest world in which the shipped model posts a sales invoice:
 * location → employee → chart (SKR03, three accounts, then activated) → VAT treatment →
 * customer → sales order (shipped) → issued invoice → open period. Every document goes
 * through the real rule engine; nothing is written behind its back.
 */
async function seedWorld(nd) {
  await mustPerform(nd, 'location', { op: 'create', entity: 'location', id: 'LOC-1', doc: {
    id: 'LOC-1', name: 'Hauptlager', 'location-type': 'warehouse', country: 'DE', city: 'Berlin',
    'in-eu-customs-union': true, 'stock-holding': true, 'operated-by': 'own',
    'haccp-scope': false, status: 'active' } });

  await mustPerform(nd, 'employee', { op: 'create', entity: 'employee', id: 'EMP-1', doc: {
    id: 'EMP-1', 'display-name': 'A. Accountant', 'signing-key-fingerprint': 'EMP-1',
    roles: 'accountant', 'primary-location': 'LOC-1', 'employment-status': 'active' } });

  await mustPerform(nd, 'chart-of-accounts', {
    op: 'create', entity: 'chart-of-accounts', id: 'CHART-SKR03', doc: {
      id: 'CHART-SKR03', name: 'skr03', standard: 'skr03', 'display-name': 'SKR03 Test',
      'ledger-currency': 'EUR', 'rounding-rule': 'per-document', 'rounding-mode': 'half-up',
      'fiscal-year-start-month': 1,
      'receivables-account-number': '1400', 'payables-account-number': '1600',
      'bank-account-number': '1200', 'inventory-account-number': '3980',
      'inventory-change-account-number': '3960', 'write-off-account-number': '4855',
      'fx-loss-account-number': '4840', 'fx-gain-account-number': '2660',
      'vat-prepayment-account-number': '1780', 'retained-earnings-account-number': '0868',
      'opening-balance-account-number': '9000',
      'adopted-on': '2026-01-01', status: 'retired' } });

  const account = (id, num, name, type, balance, section, vatRole, reconFor) =>
    mustPerform(nd, `ledger-account ${num}`, {
      op: 'create', entity: 'ledger-account', id, doc: {
        id, 'account-number': num, name, chart: 'CHART-SKR03', 'account-type': type,
        'normal-balance': balance, 'statement-section': section, 'vat-role': vatRole,
        'reconciliation-account-for': reconFor, 'blocked-for-manual-posting': true,
        'account-source': 'published-standard', 'opened-on': '2026-01-01', status: 'active' } });
  await account('LA-1400', '1400', 'Forderungen aus L&L', 'asset', 'debit', 'balance-sheet',
    'none', 'receivables');
  await account('LA-8400', '8400', 'Erlöse 19% USt', 'revenue', 'credit', 'profit-and-loss',
    'taxable-turnover', 'none');
  await account('LA-1776', '1776', 'Umsatzsteuer 19%', 'liability', 'credit', 'balance-sheet',
    'output-tax', 'vat');

  // Adoption's second step: the account references are filled in and the chart goes active.
  const chart = nd.query.get('chart-of-accounts', 'CHART-SKR03');
  await mustPerform(nd, 'chart activation', {
    op: 'update', entity: 'chart-of-accounts', id: 'CHART-SKR03', doc: {
      ...chart, status: 'active', 'receivables-account': 'LA-1400' } });

  await mustPerform(nd, 'vat-treatment', { op: 'create', entity: 'vat-treatment', id: 'VAT-19', doc: {
    id: 'VAT-19', name: 'Inland 19%', 'applies-to': 'domestic', 'vat-rate-percent': 19,
    'rate-determined-by': 'seller', 'requires-buyer-vat-id': false,
    'requires-exemption-reason': false, 'requires-ec-sales-list': false,
    'requires-oss-return': false, 'requires-customs-declaration': false,
    'requires-proof-of-transport': false, status: 'active',
    'revenue-account-number': '8400', 'revenue-account': 'LA-8400',
    'output-vat-account-number': '1776', 'output-vat-account': 'LA-1776',
    'vat-kennzahl-base': '81', 'vat-kennzahl-tax': '81', 'vat-role-base': 'taxable-turnover' } });

  await mustPerform(nd, 'customer', { op: 'create', entity: 'customer', id: 'CUST-1', doc: {
    id: 'CUST-1', name: 'Kunde GmbH', 'customer-type': 'b2b', country: 'DE',
    'vat-treatment': 'VAT-19', channel: 'retail', 'payment-terms-days': 30, currency: 'EUR',
    'invoice-delivery-format': 'pdf-email', status: 'active' } });

  await mustPerform(nd, 'sales-order', { op: 'create', entity: 'sales-order', id: 'SO-1', doc: {
    id: 'SO-1', customer: 'CUST-1', channel: 'retail', 'order-date': '2026-01-10',
    'ship-from-location': 'LOC-1', 'ship-to-country': 'DE', currency: 'EUR',
    'net-amount': '100.00 EUR', 'vat-amount': '19.00 EUR', 'gross-amount': '119.00 EUR',
    'vat-treatment': 'VAT-19', 'payment-status': 'open', 'fulfilment-status': 'new',
    'requires-electronic-invoice': false } });

  // processes/invoice-issuance.md: only a shipped order may be invoiced.
  const order = nd.query.get('sales-order', 'SO-1');
  await mustPerform(nd, 'sales-order shipped', {
    op: 'update', entity: 'sales-order', id: 'SO-1', doc: { ...order, 'fulfilment-status': 'shipped' } });

  await mustPerform(nd, 'invoice', { op: 'create', entity: 'invoice', id: 'INV-1', doc: {
    id: 'INV-1', 'invoice-number': 'RE-2026-0001', 'invoice-date': '2026-01-15',
    'invoice-type-code': '380', currency: 'EUR', status: 'issued',
    'sales-order': 'SO-1', customer: 'CUST-1',
    'seller-name': 'NeoDonkey GmbH', 'seller-vat-identifier': 'DE123456789',
    'seller-legal-registration': 'HRB 12345', 'seller-address-country': 'DE',
    'buyer-name': 'Kunde GmbH', 'buyer-address-country': 'DE',
    'net-amount': '100.00 EUR', 'vat-amount': '19.00 EUR', 'gross-amount': '119.00 EUR',
    'payable-amount': '119.00 EUR', 'vat-treatment': 'VAT-19',
    'vat-breakdown': '19%: base 100.00 EUR, tax 19.00 EUR',
    'payment-due-date': '2026-02-14', 'payment-terms': '30 days net',
    'payment-means-code': '58', 'delivery-format': 'pdf-email' } });

  await mustPerform(nd, 'accounting-period', {
    op: 'create', entity: 'accounting-period', id: '2026-01', doc: {
      id: '2026-01', 'period-key': '2026-01', 'fiscal-year': 2026, month: 1,
      'from-date': '2026-01-01', 'to-date': '2026-01-31', chart: 'CHART-SKR03', status: 'open',
      'vat-return-filed': false, 'trial-balance-agreed': false, 'bank-reconciled': false,
      'carried-forward': false } });
}

/** Post the invoice: the rules create receivable / revenue / output-VAT legs in one commit. */
async function postSalesInvoice(nd) {
  return mustPerform(nd, 'journal-entry', {
    op: 'create', entity: 'journal-entry', id: 'JE-2026-0001', doc: {
      id: 'JE-2026-0001', 'entry-number': 'JE-2026-0001', 'entry-date': '2026-01-15',
      'document-date': '2026-01-15', 'accounting-period': '2026-01', chart: 'CHART-SKR03',
      currency: 'EUR', 'debit-amount': '119.00 EUR', 'credit-amount': '119.00 EUR',
      'posting-count': 3, description: 'Kundenrechnung RE-2026-0001',
      'source-document-type': 'sales-invoice', 'source-document-reference': 'RE-2026-0001',
      'vat-treatment': 'VAT-19', invoice: 'INV-1',
      status: 'draft', reversal: false,
      'entered-by': 'EMP-1', 'posted-by': 'EMP-1', 'posted-at': '2026-01-15' } });
}

test('EXTF export runs end to end through the real kernel query layer (issue #134)', async () => {
  const { dir, nd } = await openWorkspace();
  try {
    assert.equal(nd.modelErrors.length, 0, 'the shipped operating model must parse');
    await seedWorld(nd);
    await postSalesInvoice(nd);

    // The rules did what the model says: one posted entry, three legs, balanced.
    const entry = nd.query.get('journal-entry', 'JE-2026-0001');
    assert.equal(entry.status, 'posted');
    const postings = nd.query.select({ from: 'posting', orderBy: 'position' });
    assert.equal(postings.length, 3);

    // The export. On the unfixed code this throws
    // QueryError: unknown operator "is" — the defect this test pins down.
    const result = await buildDatevExtf({
      kernel: nd, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20260101',
      sachkontenrahmen: 'SKR03', bezeichnung: 'Regression Export',
    });

    assert.equal(result.entries, 1);
    assert.equal(result.rows, 3, 'one booking line per posting');
    assert.equal(result.skipped, 0);
    assert.ok(result.csv.endsWith('\r\n'));

    const lines = result.csv.trim().split('\r\n');
    assert.equal(lines.length, 4, 'header plus three booking lines');

    // Header (Kopfsatz): format, category, consultant/client numbers, WJ, chart, label.
    const header = lines[0].split(';');
    assert.equal(header[0], 'EXTF');
    assert.equal(header[1], '700');
    assert.equal(header[3], '1234567');
    assert.equal(header[4], '00001');
    assert.equal(header[5], '20260101');
    assert.equal(header[12], 'SKR03');
    assert.equal(header[39], 'Regression Export');

    // Booking lines, ordered by posting position: 1400 S 119,00 — 8400 H 100,00 — 1776 H 19,00.
    // Amounts are DATEV minor units without a decimal point; dates are YYYYMMDD.
    const rows = lines.slice(1).map((l) => l.split(';'));
    assert.deepEqual(
      rows.map((r) => [r[0], r[1], r[6]]),
      [['11900', 'S', '1400'], ['10000', 'H', '8400'], ['1900', 'H', '1776']],
    );
    for (const r of rows) {
      assert.equal(r[9], '20260115', 'Belegdatum');
      assert.equal(r[12], '20260115', 'Buchungsdatum');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('EXTF date-range filter narrows the export through the real kernel', async () => {
  const { dir, nd } = await openWorkspace();
  try {
    await seedWorld(nd);
    await postSalesInvoice(nd);

    const outside = await buildDatevExtf({
      kernel: nd, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20260101',
      datumBeginn: '20260201', datumEnde: '20260228',
    });
    assert.equal(outside.rows, 0);
    assert.equal(outside.entries, 0);

    const inside = await buildDatevExtf({
      kernel: nd, beraterNr: '1234567', mandantenNr: '00001', wjBeginn: '20260101',
      datumBeginn: '20260101', datumEnde: '20260131',
    });
    assert.equal(inside.rows, 3);
    assert.equal(inside.entries, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
