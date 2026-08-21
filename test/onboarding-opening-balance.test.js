/**
 * test/onboarding-opening-balance.test.js — the initial Eröffnungsbilanz engine (issue #121).
 *
 * Verifies `runtime/onboarding/opening-balance.js` per the binding decision record
 * `2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`
 * (GoBD Rz. 86–89; HGB § 240, § 242, § 252 Abs. 1 Nr. 1):
 *
 *  1. A worked mini-company — cash, bank, inventory, a loan, equity — posts its opening balance
 *     against EBK 9000, with AR/AP control-account openings mirrored into 9008/9009.
 *  2. Debits equal credits exactly (BigInt minor units, no float anywhere) and EBK 9000 nets to
 *     exactly `0n` after posting — the macro invariant of record §Answer 3.
 *  3. The produced journal-entry and posting documents are accepted by the REAL ledger: they are
 *     evaluated through `runtime/polism/execute.js` against the parsed `operating-model/`, so the
 *     declared invariants of `information/journal-entry.md` and `information/posting.md` check
 *     them — debits equal credits is structural, not asserted from a report.
 *  4. An opening balance sheet that does not balance (one cent missing) is refused with
 *     `InvariantError("Opening balance sheet account 9000 does not balance to zero")`.
 *  5. Bilanzidentität: opening values must equal a supplied prior closing balance; at founding
 *     (no prior closing) the Eröffnungsbilanz is the first.
 *  6. Re-running onboarding on an already-onboarded chart is refused (GoBD Rz. 86–89).
 *
 * Zero dependencies. `node --test test/onboarding-opening-balance.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Money from '../runtime/money/money.js';
import { parseChartTemplate, instantiateLedgerAccounts } from '../runtime/onboarding/chart-of-accounts.js';
import {
  InvariantError, postOpeningBalance, openingBalanceNet, assertOpeningBalanceZero,
} from '../runtime/onboarding/opening-balance.js';
import { parseOperatingModel } from '../runtime/polism/parse.js';
import { evaluate } from '../runtime/polism/execute.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OM = join(REPO, 'operating-model');

// ---------------------------------------------------------------------------------------------
// The real operating model, parsed from disk — the same files `npm test` validates.
// ---------------------------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const MODEL_FILES = new Map();
for (const p of walk(OM)) {
  const rel = relative(REPO, p).split('\\').join('/');
  const base = rel.split('/').pop();
  if (base.startsWith('_') || /^(readme|index)\.md$/i.test(base)) continue;
  MODEL_FILES.set(rel, readFileSync(p, 'utf8'));
}
const { model: MODEL, errors: MODEL_ERRORS } = parseOperatingModel(MODEL_FILES);

const SKR03 = parseChartTemplate(readFileSync(join(OM, 'information', '_chart-skr03.json'), 'utf8'));
const SKR04 = parseChartTemplate(readFileSync(join(OM, 'information', '_chart-skr04.json'), 'utf8'));

// ---------------------------------------------------------------------------------------------
// A tiny world: one active chart, the instantiated accounts, one open period.
// ---------------------------------------------------------------------------------------------

const PERIOD = '2026-01';

function buildWorld(template, chartId) {
  const chartDoc = {
    name: chartId, standard: template.standard, 'display-name': template['display-name'],
    'ledger-currency': template['ledger-currency'], 'rounding-rule': 'per-document',
    'rounding-mode': 'half-up', 'fiscal-year-start-month': 1,
    'receivables-account-number': '1400', 'payables-account-number': '1600',
    'bank-account-number': '1200', 'inventory-account-number': '3980',
    'inventory-change-account-number': '3960', 'write-off-account-number': '4855',
    'fx-loss-account-number': '4840', 'fx-gain-account-number': '2660',
    'vat-prepayment-account-number': '1780', 'retained-earnings-account-number': '0868',
    'opening-balance-account-number': template.openingBalanceAccounts.general['account-number'],
    'adopted-on': '2026-01-01', status: 'active',
  };
  const accounts = {};
  for (const doc of instantiateLedgerAccounts(template, { chart: chartId, openedOn: '2026-01-01' })) {
    accounts[doc.id] = doc;
  }
  const store = {
    'chart-of-accounts': { [chartId]: chartDoc },
    'ledger-account': accounts,
    'accounting-period': {
      [PERIOD]: {
        'period-key': PERIOD, 'fiscal-year': 2026, month: 1,
        'from-date': '2026-01-01', 'to-date': '2026-01-31', chart: chartId, status: 'open',
        'vat-return-filed': false, 'trial-balance-agreed': false, 'bank-reconciled': false,
        'carried-forward': false, 'locked-on': '', 'locked-by': '',
      },
    },
    'journal-entry': {},
    posting: {},
    // The rule on Create journal-entry requires `posted-by exists` — the signer is a document.
    employee: {
      'employee-accountant-1': { id: 'employee-accountant-1', name: 'A. Accountant', status: 'active' },
    },
  };
  return {
    store,
    get(entity, id) { return store[entity]?.[String(id)] ?? null; },
    find(entity, pred) { return Object.values(store[entity] ?? {}).filter(pred); },
  };
}

// ---------------------------------------------------------------------------------------------
// The worked mini-company: cash, bank, inventory; a loan and equity. Assets 35,000.00 EUR.
// ---------------------------------------------------------------------------------------------

const FOUNDING_OPENINGS = [
  { account: '1000', amount: '2500.00 EUR' },      // Kasse
  { account: '1200', amount: '22500.00 EUR' },     // Bank
  { account: '3980', amount: '10000.00 EUR' },     // Bestand Waren
  { account: '1700', amount: '10000.00 EUR' },     // Darlehen
  { account: '0800', amount: '25000.00 EUR' },     // Gezeichnetes Kapital
];

const SPEC = {
  template: SKR03,
  chartId: 'skr03',
  entryNumber: 'JE-2026-0001',
  entryDate: '2026-01-01',
  period: PERIOD,
  enteredBy: 'employee-accountant-1',
  postedBy: 'employee-accountant-1',
  description: 'Eröffnungsbilanz zum 01.01.2026 (Unternehmensgründung)',
  openings: FOUNDING_OPENINGS,
};

test('a founding Eröffnungsbilanz posts and EBK 9000 nets to exactly zero (BigInt)', () => {
  const result = postOpeningBalance(SPEC);

  // The entry, as information/journal-entry.md declares it.
  assert.equal(result.entry['source-document-type'], 'opening-balance');
  assert.equal(result.entry['entry-type'], 'initial-opening-balance');
  assert.equal(result.entry['entry-number'], 'JE-2026-0001');
  assert.equal(result.entry.status, 'posted');
  assert.equal(result.entry.currency, 'EUR');

  // Debits equal credits, exactly. Every opening value books twice — the account leg and its
  // EBK mirror — so each side totals the balance sheet's two faces: 70,000.00 EUR.
  assert.equal(result.totals.debits, '70000.00 EUR');
  assert.equal(result.totals.credits, '70000.00 EUR');
  assert.equal(result.entry['debit-amount'], result.totals.debits);
  assert.equal(result.entry['credit-amount'], result.totals.credits);

  // Two postings per opening value: the account leg and the EBK mirror.
  assert.equal(result.postings.length, FOUNDING_OPENINGS.length * 2);
  assert.equal(result.entry['posting-count'], result.postings.length);

  // The macro invariant: EBK 9000 nets to exactly zero — a BigInt zero, not a rounded float.
  const net = openingBalanceNet(result.postings, '9000');
  assert.equal(typeof net, 'bigint');
  assert.equal(net, 0n);
  assert.equal(result.openingBalanceNets['9000'], '0.00 EUR');
  assert.doesNotThrow(() => assertOpeningBalanceZero(result.postings, SKR03));

  // The asset legs debit, the passive legs credit, the mirrors point the other way.
  const kasse = result.postings.find((p) => p['account-number'] === '1000');
  assert.equal(kasse.side, 'debit');
  assert.equal(kasse.amount, '2500.00 EUR');
  const kapital = result.postings.find((p) => p['account-number'] === '0800');
  assert.equal(kapital.side, 'credit');
  const ebkLegs = result.postings.filter((p) => p['account-number'] === '9000');
  assert.equal(ebkLegs.length, FOUNDING_OPENINGS.length);
  assert.equal(ebkLegs.filter((p) => p.side === 'credit').length, 3); // the three assets
  assert.equal(ebkLegs.filter((p) => p.side === 'debit').length, 2);  // loan and equity
});

test('the produced documents pass the REAL ledger: execute.js enforces the declared invariants', () => {
  const parseErrors = MODEL_ERRORS.filter((e) => e.severity !== 'warning');
  assert.deepEqual(parseErrors, [], 'the operating model must parse cleanly for this test to mean anything');
  const world = buildWorld(SKR03, 'skr03');
  const result = postOpeningBalance(SPEC);

  // Postings first, then the entry — one atomic set, exactly as §21.5 stages the legs of any
  // other booking. Every commit is evaluated by the real runtime against the real model.
  for (const p of result.postings) {
    const r = evaluate(MODEL, {
      op: 'create', entity: 'posting', id: `${p['journal-entry']}-${p.position}`,
      doc: p, actorRoles: ['accountant'],
    }, world);
    assert.ok(r.ok, `posting ${p.position} refused by the ledger:\n${r.violations.map((v) => v.reason).join('\n')}`);
    for (const c of r.changes) world.store[c.entity][c.id] = c.after;
  }
  const r = evaluate(MODEL, {
    op: 'create', entity: 'journal-entry', id: result.entry['entry-number'],
    doc: result.entry, actorRoles: ['accountant'],
  }, world);
  assert.ok(r.ok, `the opening entry was refused by the ledger:\n${r.violations.map((v) => v.reason).join('\n')}`);
  for (const c of r.changes) world.store[c.entity][c.id] = c.after;

  // After the commit, the world's postings still net EBK 9000 to exactly zero — the invariant
  // holds over what the ledger actually accepted, not over what we intended to write.
  assert.equal(openingBalanceNet(Object.values(world.store.posting), '9000'), 0n);
  const entry = world.store['journal-entry']['JE-2026-0001'];
  assert.equal(entry.status, 'posted');
});

test('SKR04 posts the same company, renumbered, against its own 9000', () => {
  const openings = [
    { account: '1600', amount: '2500.00 EUR' },   // Kasse
    { account: '1800', amount: '22500.00 EUR' },  // Bank
    { account: '1140', amount: '10000.00 EUR' },  // Waren
    { account: '3200', amount: '10000.00 EUR' },  // Darlehen
    { account: '2900', amount: '25000.00 EUR' },  // Gezeichnetes Kapital
  ];
  const result = postOpeningBalance({ ...SPEC, template: SKR04, chartId: 'skr04', openings });
  assert.equal(result.totals.debits, '70000.00 EUR');
  assert.equal(result.totals.credits, '70000.00 EUR');
  assert.equal(openingBalanceNet(result.postings, '9000'), 0n);
  assert.ok(result.postings.every((p) => p.chart === 'skr04'));
});

test('AR and AP control accounts open item by item against 9008 and 9009, transferred into 9000', () => {
  const openings = [
    { account: '1200', amount: '10000.00 EUR' },
    // Forderungen 3,000.00 = the two open customer items behind it.
    { account: '1400', items: [
      { customer: 'customer-1', amount: '1200.00 EUR' },
      { customer: 'customer-2', amount: '1800.00 EUR' },
    ] },
    // Verbindlichkeiten 4,000.00 = the one open supplier item behind it.
    { account: '1600', items: [{ supplier: 'supplier-1', amount: '4000.00 EUR' }] },
    { account: '0800', amount: '9000.00 EUR' },
  ];
  const result = postOpeningBalance({ ...SPEC, openings });

  const arItems = result.postings.filter((p) => p['account-number'] === '1400');
  assert.equal(arItems.length, 2);
  assert.ok(arItems.every((p) => p.side === 'debit'));
  assert.deepEqual(arItems.map((p) => p.customer), ['customer-1', 'customer-2']);
  // Each item is mirrored into the AR subledger opening account 9008, not into 9000.
  for (const leg of arItems) {
    const mirror = result.postings[leg.position]; // positions are 1-based and adjacent
    assert.equal(mirror['account-number'], '9008');
    assert.equal(mirror.side, 'credit');
    assert.equal(mirror.amount, leg.amount);
  }
  const apLeg = result.postings.find((p) => p['account-number'] === '1600');
  assert.equal(apLeg.side, 'credit');
  assert.equal(apLeg.supplier, 'supplier-1');
  assert.equal(result.postings[apLeg.position]['account-number'], '9009');
  assert.equal(result.postings[apLeg.position].side, 'debit');

  // The general EBK carries the control totals, as if the control accounts had posted directly:
  // 10,000 bank + 3,000 receivables in credit; 4,000 payables + 9,000 equity in debit.
  const ebk9000 = result.postings.filter((p) => p['account-number'] === '9000');
  const credit9000 = ebk9000.filter((p) => p.side === 'credit')
    .reduce((a, p) => Money.add(a, Money.money(p.amount)), Money.zero('EUR'));
  const debit9000 = ebk9000.filter((p) => p.side === 'debit')
    .reduce((a, p) => Money.add(a, Money.money(p.amount)), Money.zero('EUR'));
  assert.equal(Money.toString(credit9000), '13000.00 EUR');
  assert.equal(Money.toString(debit9000), '13000.00 EUR');

  // All three opening-balance accounts net to exactly zero — BigInt zero.
  for (const number of ['9000', '9008', '9009']) {
    assert.equal(openingBalanceNet(result.postings, number), 0n, `EBK ${number}`);
  }
  assert.doesNotThrow(() => assertOpeningBalanceZero(result.postings, SKR03));
});

test('a control account opening without its open items is refused', () => {
  const openings = [
    { account: '1200', amount: '10000.00 EUR' },
    { account: '1400', amount: '3000.00 EUR' },  // a figure with no customers behind it
    { account: '0800', amount: '13000.00 EUR' },
  ];
  assert.throws(() => postOpeningBalance({ ...SPEC, openings }), /control account/);
  // And a declared total that disagrees with the items is refused.
  assert.throws(
    () => postOpeningBalance({
      ...SPEC,
      openings: [
        { account: '1200', amount: '10000.00 EUR' },
        { account: '1400', amount: '3000.01 EUR', items: [{ customer: 'customer-1', amount: '3000.00 EUR' }] },
        { account: '0800', amount: '13000.00 EUR' },
      ],
    }),
    /does not equal the sum of its open items/,
  );
});

test('an opening balance sheet that does not balance is refused — one cent missing', () => {
  const openings = [
    { account: '1000', amount: '2500.00 EUR' },
    { account: '1200', amount: '22500.00 EUR' },
    { account: '3980', amount: '10000.00 EUR' },
    { account: '1700', amount: '10000.00 EUR' },
    { account: '0800', amount: '24999.99 EUR' },   // one cent short: debits exceed credits by 0.01
  ];
  assert.throws(() => postOpeningBalance({ ...SPEC, openings }), (err) => {
    assert.ok(err instanceof InvariantError);
    assert.equal(err.name, 'InvariantError');
    assert.match(err.message, /Opening balance sheet account 9000 does not balance to zero/);
    return true;
  });
});

test('Bilanzidentität: openings must equal the prior closing balance (HGB § 252 Abs. 1 Nr. 1)', () => {
  const priorClosing = {
    1000: '2500.00 EUR', 1200: '22500.00 EUR', 3980: '10000.00 EUR',
    1700: '10000.00 EUR', '0800': '25000.00 EUR',
  };
  // Equal: the takeover opening posts.
  const ok = postOpeningBalance({ ...SPEC, priorClosing });
  assert.equal(openingBalanceNet(ok.postings, '9000'), 0n);

  // Divergent by one cent: refused.
  assert.throws(
    () => postOpeningBalance({ ...SPEC, priorClosing: { ...priorClosing, 1200: '22500.01 EUR' } }),
    (err) => {
      assert.ok(err instanceof InvariantError);
      assert.match(err.message, /Bilanzidentität.*HGB § 252 Abs\. 1 Nr\. 1/s);
      assert.match(err.message, /1200/);
      return true;
    },
  );
  // A closing account with no opening value: refused.
  assert.throws(
    () => postOpeningBalance({ ...SPEC, priorClosing: { ...priorClosing, 1576: '100.00 EUR' } }),
    /Bilanzidentität/,
  );
});

test('re-running onboarding on an already-onboarded chart is refused (GoBD Rz. 86–89)', () => {
  const first = postOpeningBalance(SPEC);
  assert.throws(
    () => postOpeningBalance({ ...SPEC, entryNumber: 'JE-2026-0002', existingEntries: [first.entry] }),
    (err) => {
      assert.ok(err instanceof InvariantError);
      assert.match(err.message, /already has an initial opening balance/);
      return true;
    },
  );
});

test('an income-statement account cannot carry an opening value', () => {
  const openings = [
    { account: '1200', amount: '10000.00 EUR' },
    { account: '8400', amount: '10000.00 EUR' },   // Erlöse — an Eröffnungsbilanz has no P&L
  ];
  assert.throws(() => postOpeningBalance({ ...SPEC, openings }), (err) => {
    assert.ok(err instanceof InvariantError);
    assert.match(err.message, /income-statement account/);
    return true;
  });
});

test('nothing is ever posted to an opening-balance account by hand', () => {
  const openings = [
    { account: '1200', amount: '10000.00 EUR' },
    { account: '9000', amount: '10000.00 EUR' },
  ];
  assert.throws(() => postOpeningBalance({ ...SPEC, openings }), /opening-balance account/);
});

test('no float ever touches an amount; every amount is exact and in the ledger currency', () => {
  // A JSON number is refused, loudly — this is the FD-1 defect class.
  assert.throws(
    () => postOpeningBalance({ ...SPEC, openings: [{ account: '1000', amount: 2500.00 }] }),
    /an amount is never a Number/,
  );
  // A non-canonical token is refused.
  assert.throws(
    () => postOpeningBalance({ ...SPEC, openings: [{ account: '1000', amount: '2500 EUR' }] }),
    /not an exact amount/,
  );
  // A foreign currency is refused, not converted.
  assert.throws(
    () => postOpeningBalance({ ...SPEC, openings: [{ account: '1000', amount: '2500.00 USD' }] }),
    /not in the ledger currency EUR/,
  );
  // A negative amount is refused: the side carries the direction.
  assert.throws(
    () => postOpeningBalance({ ...SPEC, openings: [{ account: '1000', amount: '-2500.00 EUR' }] }),
    /always positive/,
  );
});

test('determinism: same input, same documents, byte for byte', () => {
  const a = postOpeningBalance(SPEC);
  const b = postOpeningBalance(SPEC);
  assert.deepEqual(a, b);
});

test('an unknown account is refused, naming the chart', () => {
  assert.throws(
    () => postOpeningBalance({ ...SPEC, openings: [{ account: '9999', amount: '1.00 EUR' }] }),
    /not in chart "skr03"/,
  );
});
