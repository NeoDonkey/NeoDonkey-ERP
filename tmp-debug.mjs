import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFs } from './runtime/git/fs-node.js';
import { generateIdentity } from './runtime/identity/ed25519.js';
import { open } from './runtime/kernel.js';

const dir = await mkdtemp(join(tmpdir(), 'neodonkey-datev-dbg-'));
const kp = await generateIdentity();

const seed = new Map();
const root = new URL('./operating-model/', import.meta.url);
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
  identity: { name: 'Test', email: 'test@neodonkey.eu', keyPair: kp },
  seed,
  clock: () => Date.now(),
  tzOffsetMinutes: 60,
  roles: ['managing-director', 'accountant', 'tax-accountant', 'controller'],
});

let r;

// Create chart of accounts (starts as retired)
r = await nd.perform({
  op: 'create', entity: 'chart-of-accounts', id: 'SKR04',
  doc: {
    entity: 'chart-of-accounts', id: 'SKR04',
    name: 'SKR 04', 'display-name': 'SKR 04', standard: 'skr04',
    'ledger-currency': 'EUR', 'rounding-rule': 'per-document', 'rounding-mode': 'half-up',
    'fiscal-year-start-month': 1,
    'receivables-account-number': '1200', 'payables-account-number': '3300',
    'bank-account-number': '1800', 'inventory-account-number': '1140',
    'inventory-change-account-number': '5880', 'write-off-account-number': '4855',
    'fx-loss-account-number': '4840', 'fx-gain-account-number': '2660',
    'vat-prepayment-account-number': '1780', 'retained-earnings-account-number': '0868',
    'opening-balance-account-number': '9000',
    'adopted-on': '2024-01-01', status: 'active'
  },
});
console.log('chart:', r.rejected ? 'REJECTED: ' + JSON.stringify(r.rejected, null, 2).slice(0, 200) : 'OK');

// Create ledger accounts
for (const [num, name, bal, section, vatRole, recon] of [
  ['1200', 'Bank', 'debit', 'balance-sheet', 'none', 'bank'],
  ['8400', 'Wareneinsatz', 'debit', 'profit-and-loss', 'none', 'none'],
]) {
  r = await nd.perform({
    op: 'create', entity: 'ledger-account', id: `LA-${num}`,
    doc: {
      entity: 'ledger-account', id: `LA-${num}`,
      'account-number': num, chart: 'SKR04', name,
      'account-type': num.startsWith('1') ? 'asset' : 'expense',
      'normal-balance': bal, 'statement-section': section,
      'vat-role': vatRole, 'reconciliation-account-for': recon,
      'blocked-for-manual-posting': false, 'account-source': 'published-standard',
      'opened-on': '2024-01-01', status: 'active'
    },
  });
  console.log(`ledger ${num}:`, r.rejected ? 'REJECTED: ' + JSON.stringify(r.rejected, null, 2).slice(0, 200) : 'OK');
}

// Activate chart after ledger accounts exist
r = await nd.perform({
  op: 'update', entity: 'chart-of-accounts', id: 'SKR04',
  doc: { entity: 'chart-of-accounts', id: 'SKR04', status: 'active' },
});
console.log('chart activate:', r.rejected ? 'REJECTED: ' + JSON.stringify(r.rejected, null, 2).slice(0, 200) : 'OK');

// Create accounting period
r = await nd.perform({
  op: 'create', entity: 'accounting-period', id: '2027-11',
  doc: {
    entity: 'accounting-period', id: '2027-11', 'period-key': '2027-11',
    'fiscal-year': '2027', month: 11, 'from-date': '2027-11-01', 'to-date': '2027-11-30',
    chart: 'SKR04', status: 'open',
    'vat-return-filed': false, 'trial-balance-agreed': false, 'bank-reconciled': false, 'carried-forward': false
  },
});
console.log('period:', r.rejected ? 'REJECTED: ' + JSON.stringify(r.rejected, null, 2).slice(0, 200) : 'OK');

// Create location
r = await nd.perform({
  op: 'create', entity: 'location', id: 'LOC-001',
  doc: { entity: 'location', id: 'LOC-001', name: 'Hauptsitz', 'location-type': 'office', country: 'DE', city: 'Munich', 'in-eu-customs-union': true, 'stock-holding': false, 'operated-by': 'own', 'haccp-scope': false, status: 'active' },
});
console.log('location:', r.rejected ? 'REJECTED: ' + JSON.stringify(r.rejected, null, 2).slice(0, 200) : 'OK');

// Create employee
r = await nd.perform({
  op: 'create', entity: 'employee', id: 'EMP-001',
  doc: { entity: 'employee', id: 'EMP-001', 'display-name': 'Test', 'signing-key-fingerprint': 'TEST', roles: ['accountant'], 'employment-status': 'active', 'primary-location': 'LOC-001' },
});
console.log('employee:', r.rejected ? 'REJECTED: ' + JSON.stringify(r.rejected, null, 2).slice(0, 200) : 'OK');

// Create journal entry
r = await nd.perform({
  op: 'create', entity: 'journal-entry', id: 'JE-0001',
  doc: {
    entity: 'journal-entry', id: 'JE-0001',
    'entry-number': '1', 'entry-date': '2027-11-03', 'document-date': '2027-11-03',
    'accounting-period': '2027-11', chart: 'SKR04', currency: 'EUR',
    'debit-amount': '1000.00 EUR', 'credit-amount': '1000.00 EUR',
    'posting-count': 2, description: 'Test', 'source-document-type': 'manual', 'source-document-reference': 'B-001',
    status: 'posted', reversal: false,
    'entered-by': 'EMP-001', 'posted-by': 'EMP-001', 'posted-at': '2027-11-03',
  },
});
console.log('journal-entry:', r.rejected ? 'REJECTED: ' + JSON.stringify(r.rejected, null, 2) : 'OK, commit=' + r.oid);

console.log('\nHistory:');
const hist = await nd.history(10);
for (const h of hist) console.log('  ', h.message.split('\n')[0]);

await rm(dir, { recursive: true, force: true });
