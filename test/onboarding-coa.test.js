/**
 * test/onboarding-coa.test.js — chart-of-accounts template onboarding (issue #122).
 *
 * Verifies `runtime/onboarding/chart-of-accounts.js` against the shipped SKR03 and SKR04 JSON
 * templates (`operating-model/information/_chart-skr03.json`, `_chart-skr04.json`) per the binding
 * decision record `2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`:
 * both templates parse into account rows with all mandatory fields; the opening-balance accounts
 * (EBK general, AR subledger, AP subledger) are declared by role; malformed templates — duplicate
 * account numbers, missing mandatory fields, three-digit account numbers, unbalanced control
 * totals — are rejected with a named `ValidationError`; and no float ever appears in an amount
 * path.
 *
 * Zero dependencies. `node --test test/onboarding-coa.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ValidationError, parseChartTemplate, instantiateLedgerAccounts, accountByNumber,
  OPENING_BALANCE_ROLES,
} from '../runtime/onboarding/chart-of-accounts.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const loadTemplate = (name) =>
  readFileSync(join(REPO, 'operating-model', 'information', name), 'utf8');

const SKR03_TEXT = loadTemplate('_chart-skr03.json');
const SKR04_TEXT = loadTemplate('_chart-skr04.json');
const SKR03 = parseChartTemplate(SKR03_TEXT);
const SKR04 = parseChartTemplate(SKR04_TEXT);

// ---------------------------------------------------------------------------------------------
// The shipped templates parse
// ---------------------------------------------------------------------------------------------

test('the shipped SKR03 and SKR04 templates parse and validate', () => {
  assert.equal(SKR03.standard, 'skr03');
  assert.equal(SKR04.standard, 'skr04');
  assert.equal(SKR03['ledger-currency'], 'EUR');
  assert.equal(SKR04['ledger-currency'], 'EUR');
  assert.ok(SKR03.accounts.length > 0);
  assert.ok(SKR04.accounts.length > 0);
});

test('every account row carries the mandatory fields of the decision record', () => {
  for (const template of [SKR03, SKR04]) {
    for (const a of template.accounts) {
      assert.match(a['account-number'], /^[0-9]{4}$/, `account-number on ${a.name}`);
      assert.ok(typeof a.name === 'string' && a.name.length > 0);
      assert.ok(['asset', 'liability', 'equity', 'revenue', 'expense'].includes(a['account-type']));
      assert.ok(['debit', 'credit'].includes(a['normal-balance']));
      assert.ok(['balance-sheet', 'income-statement'].includes(a['statement-section']));
      assert.ok(typeof a['vat-role'] === 'string');
      assert.ok(['none', 'bank', 'customer', 'supplier'].includes(a['reconciliation-account-for']));
      assert.equal(typeof a.manual, 'boolean');
    }
  }
});

test('both templates declare the three opening-balance accounts by role', () => {
  for (const template of [SKR03, SKR04]) {
    for (const role of OPENING_BALANCE_ROLES) {
      const account = template.openingBalanceAccounts[role];
      assert.ok(account, `${template.standard}: opening-balance account for role "${role}"`);
      assert.equal(account['statement-section'], 'balance-sheet');
      assert.equal(account.manual, true, 'only rules post to an opening-balance account');
    }
    // EBK 9000, AR 9008, AP 9009 — identical in SKR03 and SKR04 (record, source 3).
    assert.equal(template.openingBalanceAccounts.general['account-number'], '9000');
    assert.equal(template.openingBalanceAccounts.receivables['account-number'], '9008');
    assert.equal(template.openingBalanceAccounts.payables['account-number'], '9009');
  }
});

test('the accounts the issues name are present with the right shape', () => {
  // issue #121's worked example: 1000 Kasse, 1200 Bank, 0800 Gezeichnetes Kapital.
  for (const [number, name, type, normal] of [
    ['1000', 'Kasse', 'asset', 'debit'],
    ['1200', 'Bank', 'asset', 'debit'],
    ['0800', 'Gezeichnetes Kapital', 'equity', 'credit'],
  ]) {
    const a = accountByNumber(SKR03, number);
    assert.ok(a, `SKR03 ${number}`);
    assert.equal(a.name, name);
    assert.equal(a['account-type'], type);
    assert.equal(a['normal-balance'], normal);
    assert.equal(a['statement-section'], 'balance-sheet');
  }
  // SKR04 carries the same accounts, renumbered (Abschlussgliederung).
  assert.equal(accountByNumber(SKR04, '1600').name, 'Kasse');
  assert.equal(accountByNumber(SKR04, '1800').name, 'Bank');
  assert.equal(accountByNumber(SKR04, '2900').name, 'Gezeichnetes Kapital');
});

test('the shipped control totals are balanced', () => {
  for (const template of [SKR03, SKR04]) {
    assert.equal(template['control-totals']['account-count'], template.accounts.length);
    const bs = template.accounts.filter((a) => a['statement-section'] === 'balance-sheet').length;
    const is = template.accounts.filter((a) => a['statement-section'] === 'income-statement').length;
    assert.equal(template['control-totals']['by-statement-section']['balance-sheet'], bs);
    assert.equal(template['control-totals']['by-statement-section']['income-statement'], is);
  }
});

// ---------------------------------------------------------------------------------------------
// Malformed templates are rejected with named errors
// ---------------------------------------------------------------------------------------------

/** A minimal valid template, to be broken one way at a time. */
function validTemplate() {
  return {
    standard: 'skr03',
    'display-name': 'test chart',
    'ledger-currency': 'EUR',
    accounts: [
      { 'account-number': '1000', name: 'Kasse', 'account-type': 'asset', 'normal-balance': 'debit', 'statement-section': 'balance-sheet', 'vat-role': 'none', 'reconciliation-account-for': 'none', manual: false },
      { 'account-number': '0800', name: 'Gezeichnetes Kapital', 'account-type': 'equity', 'normal-balance': 'credit', 'statement-section': 'balance-sheet', 'vat-role': 'none', 'reconciliation-account-for': 'none', manual: true },
      { 'account-number': '9000', name: 'Saldenvorträge Sachkonten', 'account-type': 'equity', 'normal-balance': 'credit', 'statement-section': 'balance-sheet', 'vat-role': 'none', 'reconciliation-account-for': 'none', manual: true, 'opening-balance-role': 'general' },
      { 'account-number': '9008', name: 'Saldenvorträge Debitoren', 'account-type': 'equity', 'normal-balance': 'credit', 'statement-section': 'balance-sheet', 'vat-role': 'none', 'reconciliation-account-for': 'none', manual: true, 'opening-balance-role': 'receivables' },
      { 'account-number': '9009', name: 'Saldenvorträge Kreditoren', 'account-type': 'equity', 'normal-balance': 'credit', 'statement-section': 'balance-sheet', 'vat-role': 'none', 'reconciliation-account-for': 'none', manual: true, 'opening-balance-role': 'payables' },
    ],
    'control-totals': {
      'account-count': 5,
      'by-statement-section': { 'balance-sheet': 5 },
    },
  };
}

test('a duplicate account number is rejected', () => {
  const t = validTemplate();
  t.accounts.push({ ...t.accounts[0] });
  assert.throws(() => parseChartTemplate(t), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /duplicate account-number "1000"/);
    return true;
  });
});

test('a missing mandatory field is rejected', () => {
  const t = validTemplate();
  delete t.accounts[0]['account-type'];
  assert.throws(() => parseChartTemplate(t), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /"account-type" must be one of/);
    return true;
  });
  const t2 = validTemplate();
  delete t2.accounts[1].name;
  assert.throws(() => parseChartTemplate(t2), ValidationError);
});

test('a three-digit account number is rejected — 800 is not 0800', () => {
  const t = validTemplate();
  t.accounts[0]['account-number'] = '100';
  assert.throws(() => parseChartTemplate(t), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /"account-number" must be four digits as text/);
    return true;
  });
  const t2 = validTemplate();
  t2.accounts[0]['account-number'] = 1000; // a JSON number: 0800 is not 800
  assert.throws(() => parseChartTemplate(t2), ValidationError);
});

test('unbalanced control totals are rejected', () => {
  const t = validTemplate();
  t['control-totals']['account-count'] = 6;
  assert.throws(() => parseChartTemplate(t), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /control totals do not balance/);
    return true;
  });
  const t2 = validTemplate();
  t2['control-totals']['by-statement-section']['balance-sheet'] = 4;
  assert.throws(() => parseChartTemplate(t2), /control totals do not balance/);
  const t3 = validTemplate();
  delete t3['control-totals'];
  assert.throws(() => parseChartTemplate(t3), /"control-totals" is missing/);
});

test('a template without the opening-balance accounts is rejected', () => {
  const t = validTemplate();
  t.accounts = t.accounts.filter((a) => a['opening-balance-role'] !== 'payables');
  assert.throws(() => parseChartTemplate(t), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /opening-balance-role "payables"/);
    return true;
  });
});

test('invalid JSON and non-objects are rejected', () => {
  assert.throws(() => parseChartTemplate('{ not json'), (err) => {
    assert.ok(err instanceof ValidationError);
    assert.match(err.message, /not valid JSON/);
    return true;
  });
  assert.throws(() => parseChartTemplate('[]'), ValidationError);
  assert.throws(() => parseChartTemplate(null), ValidationError);
});

test('the error is named ValidationError', () => {
  try {
    parseChartTemplate({});
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.name, 'ValidationError');
    assert.ok(Array.isArray(err.problems) && err.problems.length > 0);
  }
});

// ---------------------------------------------------------------------------------------------
// No float in any amount path; ledger-account instantiation
// ---------------------------------------------------------------------------------------------

test('a JSON number where a rate belongs is refused; no float slips through', () => {
  const t = validTemplate();
  t.accounts[0]['vat-rate-percent'] = 19.5; // not an integer rate
  assert.throws(() => parseChartTemplate(t), ValidationError);
  // And there is no money field on a template row at all — amounts only ever appear as exact
  // string tokens in the opening-balance engine (test/onboarding-opening-balance.test.js).
  const t2 = validTemplate();
  t2.accounts[0]['vat-rate-percent'] = 19;
  assert.doesNotThrow(() => parseChartTemplate(t2));
});

test('instantiateLedgerAccounts produces ledger-account documents as the model declares them', () => {
  const docs = instantiateLedgerAccounts(SKR03, { chart: 'skr03', openedOn: '2026-01-01' });
  assert.equal(docs.length, SKR03.accounts.length);
  const bank = docs.find((d) => d['account-number'] === '1200');
  assert.deepEqual({ ...bank }, {
    id: 'skr03-1200',
    'account-number': '1200',
    name: 'Bank',
    chart: 'skr03',
    'account-type': 'asset',
    'normal-balance': 'debit',
    'statement-section': 'balance-sheet',
    'vat-role': 'none',
    'vat-kennzahl': '',
    'vat-rate-percent': '',
    'reconciliation-account-for': 'bank',
    'blocked-for-manual-posting': true,
    'account-source': 'published-standard',
    'opened-on': '2026-01-01',
    status: 'active',
  });
  // The record's "income-statement" maps to the model's "profit-and-loss" enumeration value.
  const revenue = docs.find((d) => d['account-number'] === '8400');
  assert.equal(revenue['statement-section'], 'profit-and-loss');
  // The record's "customer"/"supplier" map to the model's "receivables"/"payables".
  assert.equal(docs.find((d) => d['account-number'] === '1400')['reconciliation-account-for'], 'receivables');
  assert.equal(docs.find((d) => d['account-number'] === '1600')['reconciliation-account-for'], 'payables');
});

test('instantiation is deterministic and refuses an uninjected date', () => {
  const a = instantiateLedgerAccounts(SKR03, { chart: 'skr03', openedOn: '2026-01-01' });
  const b = instantiateLedgerAccounts(SKR03, { chart: 'skr03', openedOn: '2026-01-01' });
  assert.deepEqual(a, b);
  assert.throws(() => instantiateLedgerAccounts(SKR03, { chart: 'skr03' }), ValidationError);
});
