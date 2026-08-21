// test/g-ui.test.js — the UI, tested without a browser.
//
// The DOM is deliberately NOT tested here. What is tested is every function that *decides* what
// the DOM will be: the field-type mapping, column derivation, value formatting, the refusal
// formatter, and a full view model built from a real parsed operating model. That is where the
// logic is, and keeping it there is what made it testable in the first place.
//
// The most important test in this file is "a UI appears for an entity nobody wrote code for"
// (Principle 7), followed by the mechanical proof that no entity name is hardcoded anywhere in
// runtime/ui/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { connect } from 'node:net';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseOperatingModel } from '../runtime/polism/parse.js';
import { indexOf } from '../runtime/read/index.js';

import {
  ID_FIELD, allFields, coerceInput, columnsFor, displayLabel, emptyValue, formatDate,
  formatNumber, formatValue, inputTypeFor, isReference, labelFor, localeKey,
} from '../runtime/ui/fields.js';
import {
  collectForm, detailView, diagnosticsView, entityTitle, excerpt, formView, historyView, listView,
  navFor, operatingModelFileView, operatingModelTree, overview, parseAt, parseTrailers,
  permissionFor, refusalView, ruleAt, rulesFor,
} from '../runtime/ui/viewmodel.js';
import { CODE, SHELL, VERSION, CACHE_NAME } from '../runtime/ui/shell-files.js';
import { parseRoute } from '../runtime/ui/app.js';
import { starterModel } from '../runtime/ui/starter-model.js';

const REPO = new URL('../', import.meta.url);
const repoPath = (rel) => fileURLToPath(new URL(rel, REPO));

/** A raw HTTP GET, so a request path reaches the server exactly as written. */
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('raw request timed out')); });
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

// ---------------------------------------------------------------------------------------------
// the fixture: a small operating model containing an entity that exists NOWHERE in the UI code
// ---------------------------------------------------------------------------------------------

/**
 * `pallet-audit` and `dock-slot` are invented for this test. No line of runtime/ui/ has ever
 * heard of them. If a list, a detail page and a working form appear for them, views really are
 * generated from declarations — which is the entire claim of Principle 7.
 */
const FIXTURE = new Map([
  ['operating-model/information/dock-slot.md', `# Loading Dock Slot

Where a lorry may back up, and when.

## Fields
- name: text required
- gate-number: number required
- active: boolean

## Displayed by
name
`],
  ['operating-model/information/pallet-audit.md', `# Pallet Audit

A spot check on one pallet. Invented purely to prove that a working interface appears for a
kind of document no interface code knows about.

## Fields
- reference-code: text required
- audited-on: date required
- dock-slot: reference to dock-slot required
- shrinkage-value: money
- currency: text
- pallet-count: number required
- sealed: boolean
- remark: text

## Predicates
- unsealed: sealed is false

## Identified by
reference-code
`],
  ['operating-model/organisation/dock-supervisor.md', '# Dock Supervisor\n\nRuns the loading dock.\n'],
  ['operating-model/organisation/night-auditor.md', '# Night Auditor\n\nCounts pallets at night.\n'],
  ['operating-model/processes/pallet-audit.md', `# Pallet Audit

## Rules
If Create pallet-audit under condition
  pallet-count > 0 and
  dock-slot exists
then
  Update pallet-audit with sealed true

## Authorized by
night-auditor
`],
]);

function fixtureModel() {
  const { model, errors } = parseOperatingModel(FIXTURE);
  const hard = errors.filter((e) => e.severity === 'error');
  assert.deepEqual(hard.map((e) => `${e.file}:${e.line} ${e.message}`), [],
    'the fixture operating model must parse cleanly');
  return model;
}

const fixtureDocs = () => [
  { entity: 'dock-slot', id: 'DOCK-1', name: 'Gate West', 'gate-number': 3, active: true },
  { entity: 'dock-slot', id: 'DOCK-2', name: 'Gate East', 'gate-number': 4, active: false },
  {
    entity: 'pallet-audit', id: 'PA-0001', 'reference-code': 'PA-0001', 'audited-on': '2027-11-03',
    'dock-slot': 'DOCK-1', 'shrinkage-value': 1234.5, currency: 'EUR', 'pallet-count': 12,
    sealed: false, remark: 'film torn',
  },
  {
    entity: 'pallet-audit', id: 'PA-0002', 'reference-code': 'PA-0002', 'audited-on': '2027-11-04',
    'dock-slot': 'DOCK-9', 'shrinkage-value': 0, currency: 'EUR', 'pallet-count': 4, sealed: true,
  },
];

// ---------------------------------------------------------------------------------------------
// 1. every module imports, with no top-level side effect
// ---------------------------------------------------------------------------------------------

test('every runtime/ui module imports in Node without touching the DOM', async () => {
  const names = (await readdir(repoPath('runtime/ui'))).filter((n) => n.endsWith('.js')).sort();
  assert.ok(names.length >= 12, `expected the UI to be split into modules, found ${names.length}`);
  for (const name of names) {
    const mod = await import(new URL(`../runtime/ui/${name}`, import.meta.url));
    assert.equal(typeof mod, 'object', `${name} should import to a module object`);
  }
  // boot.js is the one with an entry point; importing it must not have started anything.
  assert.equal(globalThis.__NEODONKEY_BOOTED, undefined,
    'importing boot.js outside a browser must not run the app');
});

// ---------------------------------------------------------------------------------------------
// 2. field type -> input type
// ---------------------------------------------------------------------------------------------

test('a declared field type decides its input control, and an unknown type is refused', () => {
  const t = (type, extra = {}) => inputTypeFor({ name: 'f', type, refEntity: null, ...extra });

  assert.deepEqual(t('text'), { control: 'input', type: 'text' });
  assert.deepEqual(t('date'), { control: 'input', type: 'date' });
  assert.deepEqual(t('boolean'), { control: 'checkbox' });
  assert.deepEqual(t('number'),
    { control: 'input', type: 'number', step: 'any', inputmode: 'decimal', align: 'right' });
  // FD-1: a money field is a text control, deliberately. `type=number` lets the browser coerce,
  // re-round and localise the value before the operating model ever sees it — and a browser that
  // silently changes an amount on its way into the ledger is not something to build on.
  assert.deepEqual(t('money'),
    { control: 'input', type: 'text', inputmode: 'decimal',
      placeholder: '0.00 EUR', spellcheck: 'false', align: 'right' });
  assert.deepEqual(inputTypeFor({ name: 'x', type: 'reference', refEntity: 'dock-slot' }),
    { control: 'select', refEntity: 'dock-slot' });

  // Principle 6: a type from a later grammar version is shown as unknown, never as text.
  assert.deepEqual(t('one of "open", "closed"'),
    { control: 'unknown', declared: 'one of "open", "closed"' });
  assert.deepEqual(inputTypeFor(undefined), { control: 'unknown', declared: null });

  assert.equal(isReference({ type: 'reference', refEntity: 'x' }), true);
  assert.equal(isReference({ type: 'text', refEntity: null }), false);
  assert.equal(emptyValue({ type: 'boolean' }), false);
  assert.equal(emptyValue({ type: 'money' }), '');
});

// ---------------------------------------------------------------------------------------------
// 3. formatting: money, number, date, reference, boolean, empty
// ---------------------------------------------------------------------------------------------

test('numbers are grouped per locale, deterministically and without Intl', () => {
  assert.equal(formatNumber(1234567.5, { locale: 'de', decimals: 2 }), '1.234.567,50');
  assert.equal(formatNumber(1234567.5, { locale: 'en', decimals: 2 }), '1,234,567.50');
  assert.equal(formatNumber(1234567.5, { locale: 'fr', decimals: 2 }), '1 234 567,50');
  assert.equal(formatNumber(1234.5, { locale: 'ch', decimals: 2 }), "1'234.50");
  assert.equal(formatNumber(0, { locale: 'de', decimals: 2 }), '0,00');
  assert.equal(formatNumber(-42.5, { locale: 'de', decimals: 2 }), '−42,50'); // U+2212, a real minus
  assert.equal(formatNumber(999, { locale: 'de' }), '999');
  assert.equal(formatNumber(1000, { locale: 'de' }), '1.000');
  // An unknown language falls back to en rather than guessing separators.
  assert.equal(localeKey('pt-BR'), 'en');
  assert.equal(localeKey('de-AT'), 'de');
  assert.equal(formatNumber('not a number', { locale: 'de' }), 'not a number');
});

test('ISO dates become local dates, and anything not ISO is returned untouched', () => {
  assert.equal(formatDate('2027-11-03', { locale: 'de' }), '03.11.2027');
  assert.equal(formatDate('2027-11-03', { locale: 'fr' }), '03/11/2027');
  assert.equal(formatDate('2027-11-03', { locale: 'nl' }), '03-11-2027');
  assert.equal(formatDate('2027-11-03', { locale: 'en' }), '2027-11-03');
  assert.equal(formatDate('2027-11-03T14:22:31Z', { locale: 'de' }), '03.11.2027 14:22');
  // Guessing a date format would be a silent wrong calculation (Principle 6).
  assert.equal(formatDate('03/11/2027', { locale: 'de' }), '03/11/2027');
  assert.equal(formatDate('', { locale: 'de' }), '');
});

test('a value is formatted from its declaration — money renders from its own exact token (FD-1)', () => {
  const model = fixtureModel();
  const index = indexOf(fixtureDocs());
  const entityDef = model.entities.get('pallet-audit');
  const doc = index.get('pallet-audit', 'PA-0001');
  const ctx = {
    locale: 'de', doc, entityDef,
    resolve: (e, id) => index.get(e, id),
    entityDefOf: (e) => model.entities.get(e) ?? null,
  };

  // FD-1 superseded grammar §10.7: a money value carries its own currency in the token, and is
  // rendered from that token without ever becoming a JavaScript number.
  const m = formatValue('1234.50 EUR', entityDef.fields.get('shrinkage-value'), ctx);
  assert.equal(m.text, '1.234,50 EUR');
  assert.equal(m.kind, 'money');
  assert.equal(m.align, 'right');

  // Exactness is the whole point: a value that `toFixed(2)` would corrupt must survive intact.
  // `Number('99999999999999999.99').toFixed(2)` is '100000000000000000.00' — a unit invented.
  assert.equal(
    formatValue('99999999999999999.99 EUR', entityDef.fields.get('shrinkage-value'), ctx).text,
    '99.999.999.999.999.999,99 EUR',
  );
  // Scales other than 2 come from the token, never from an assumption about currencies.
  assert.equal(formatValue('1000 JPY', entityDef.fields.get('shrinkage-value'), ctx).text, '1.000 JPY');
  assert.equal(formatValue('1.500 TND', entityDef.fields.get('shrinkage-value'), ctx).text, '1,500 TND');
  assert.equal(formatValue('-12.00 EUR', entityDef.fields.get('shrinkage-value'), ctx).text, '−12,00 EUR');

  // A legacy bare number from a v0.1 workspace still opens (Principle 6). Padding `.5` to `.50`
  // at the currency's ISO scale is exact string work and decides nothing, so it is done...
  const legacy = formatValue(9.5, entityDef.fields.get('shrinkage-value'), ctx);
  assert.equal(legacy.text, '9,50 EUR');
  assert.match(legacy.title, /stored as a bare number/);

  // ...but a fraction longer than the scale would need *rounding*, which is a decision a display
  // has no business making. Shown verbatim and labelled instead.
  const tooPrecise = formatValue(1234.567, entityDef.fields.get('shrinkage-value'), ctx);
  assert.equal(tooPrecise.text, '1234.567 EUR');
  assert.match(tooPrecise.title, /rounding it here would invent a figure/);

  assert.equal(formatValue('2027-11-03', entityDef.fields.get('audited-on'), ctx).text, '03.11.2027');
  assert.equal(formatValue(12, entityDef.fields.get('pallet-count'), ctx).text, '12');
  assert.equal(formatValue(false, entityDef.fields.get('sealed'), ctx).text, 'no');
  assert.equal(formatValue(true, entityDef.fields.get('sealed'), ctx).text, 'yes');
  assert.equal(formatValue(null, entityDef.fields.get('remark'), ctx).text, '—');
  assert.equal(formatValue('', entityDef.fields.get('remark'), ctx).kind, 'empty');

  // a reference resolves to the target's human label and carries a link
  const ref = formatValue('DOCK-1', entityDef.fields.get('dock-slot'), ctx);
  assert.equal(ref.kind, 'reference');
  assert.equal(ref.text, 'Gate West');
  assert.deepEqual(ref.link, { entity: 'dock-slot', id: 'DOCK-1' });
  assert.equal(ref.dangling, undefined);

  // a reference to a document that does not exist is shown AS dangling, never hidden (§4.5)
  const dead = formatValue('DOCK-9', entityDef.fields.get('dock-slot'), ctx);
  assert.equal(dead.dangling, true);
  assert.equal(dead.text, 'DOCK-9');
  assert.match(dead.title, /no dock-slot with the id "DOCK-9"/);

  // an empty reference is empty, not dangling
  assert.equal(formatValue('', entityDef.fields.get('dock-slot'), ctx).kind, 'empty');
});

test('a document’s human label is derived: name field, then business key, then id', () => {
  const model = fixtureModel();
  const slot = model.entities.get('dock-slot');
  const audit = model.entities.get('pallet-audit');

  assert.deepEqual(displayLabel({ id: 'DOCK-1', name: 'Gate West' }, slot),
    { text: 'Gate West', id: 'DOCK-1', from: 'displayedBy' });
  // pallet-audit has no name field, but it has `## Identified by reference-code`
  assert.deepEqual(displayLabel({ id: 'PA-1', 'reference-code': 'PA-1' }, audit),
    { text: 'PA-1', id: 'PA-1', from: 'key' });
  // displayedBy section specified
  assert.deepEqual(displayLabel({ id: 'C-1', code: 'C-100', 'company-name': 'Acme Corp' },
    { fields: new Map([['code', { type: 'text' }], ['company-name', { type: 'text' }]]), displayedBy: ['code', 'company-name'] }),
    { text: 'C-100 · Acme Corp', id: 'C-1', from: 'displayedBy' });
  // nothing declared to go on: the id
  assert.deepEqual(displayLabel({ id: 'X-1' }, { fields: new Map(), identifiedBy: null }),
    { text: 'X-1', id: 'X-1', from: 'id' });
  assert.equal(displayLabel(null, slot).from, 'missing');
});

// Compromise #13's closure (issue #44) deleted the conventional candidate loop
// ['name', 'title', 'label', 'description'] from displayLabel and columnsFor. The source guard
// above pins the vocabulary by string search; this pins it by behaviour, which is what the
// closure's own verification note asked for: an entity that declares nothing gets nothing from
// a document that happens to carry a `name`.
test('an entity with no declaration gets the id, never a conventional fallback', () => {
  const undeclared = {
    fields: new Map([
      ['name', { name: 'name', type: 'text' }],
      ['code', { name: 'code', type: 'text', required: true }],
    ]),
    identifiedBy: null,
  };

  // before #29 this returned { text: 'Gate West', from: 'name' }
  assert.deepEqual(displayLabel({ id: 'X-1', name: 'Gate West' }, undeclared),
    { text: 'X-1', id: 'X-1', from: 'id' });

  // and before #29 `name` led the columns ahead of the required declared field
  assert.deepEqual(columnsFor(undeclared).map((c) => c.name), ['id', 'code', 'name']);
});

test('field labels are typography, not semantics', () => {
  assert.equal(labelFor('shrinkage-value'), 'Shrinkage value');
  assert.equal(labelFor('gate-number'), 'Gate number');
  assert.equal(labelFor('vat-id'), 'VAT ID');
  assert.equal(labelFor('iban'), 'IBAN');
  assert.equal(labelFor(''), '');
});

test('input is decoded, not validated — an empty optional field becomes absent', () => {
  assert.deepEqual(coerceInput('  hello ', { type: 'text' }), { ok: true, value: 'hello' });
  assert.deepEqual(coerceInput('', { type: 'text' }), { ok: true, value: undefined, absent: true });
  assert.deepEqual(coerceInput('12.5', { type: 'money' }), { ok: true, value: 12.5 });
  // a German keyboard produces a comma
  assert.deepEqual(coerceInput('12,5', { type: 'money' }), { ok: true, value: 12.5 });
  assert.deepEqual(coerceInput(true, { type: 'boolean' }), { ok: true, value: true });
  assert.deepEqual(coerceInput(false, { type: 'boolean' }), { ok: true, value: false });
  assert.deepEqual(coerceInput('2027-11-03', { type: 'date' }), { ok: true, value: '2027-11-03' });
  // the one thing decoded locally: there is no number to send at all
  assert.deepEqual(coerceInput('abc', { type: 'number' }), { ok: false, reason: '"abc" is not a number' });
});

// ---------------------------------------------------------------------------------------------
// 4. column derivation
// ---------------------------------------------------------------------------------------------

test('list columns are derived from the declaration in a documented order, and capped', () => {
  const model = fixtureModel();
  const audit = model.entities.get('pallet-audit');

  const names = columnsFor(audit).map((c) => c.name);
  assert.equal(names[0], 'id', 'id always comes first');
  // no name/title/label field on this entity, so `## Identified by` leads
  assert.equal(names[1], 'reference-code');
  // required fields before optional ones
  for (const required of ['audited-on', 'dock-slot', 'pallet-count']) {
    assert.ok(names.includes(required), `required field ${required} should be a column`);
  }
  assert.ok(names.length <= 7, `capped, got ${names.length}`);
  assert.equal(new Set(names).size, names.length, 'no duplicated columns');

  // a name-ish text field wins the second slot when there is one
  assert.deepEqual(columnsFor(model.entities.get('dock-slot')).map((c) => c.name),
    ['id', 'name', 'gate-number', 'active']);

  // displayedBy section prioritises specified columns
  assert.deepEqual(
    columnsFor({ fields: new Map([['code', { name: 'code' }], ['company-name', { name: 'company-name' }]]), displayedBy: ['company-name'] }).map((c) => c.name),
    ['id', 'company-name', 'code']
  );

  assert.deepEqual(columnsFor(null), [ID_FIELD]);
  assert.equal(columnsFor(audit, { max: 2 }).length, 2);
  assert.equal(allFields(audit).length, audit.fields.size);
});

// ---------------------------------------------------------------------------------------------
// 5. role -> permission, derived from `## Authorized by` (grammar §6, §8)
// ---------------------------------------------------------------------------------------------

test('permission is derived from the rules, not from a permission table', () => {
  const model = fixtureModel();

  const asAuditor = permissionFor(model, 'pallet-audit', 'create', 'night-auditor');
  assert.equal(asAuditor.allowed, true);
  assert.equal(asAuditor.rules.length, 1);
  assert.equal(asAuditor.unconstrained, false);

  // §6: the role is missing, so it is refused even though every condition might hold
  const asSupervisor = permissionFor(model, 'pallet-audit', 'create', 'dock-supervisor');
  assert.equal(asSupervisor.allowed, false);
  assert.equal(asSupervisor.blockedBy.length, 1);

  // §8: an operation no rule matches is allowed — a model need not govern everything
  const ungoverned = permissionFor(model, 'dock-slot', 'create', 'dock-supervisor');
  assert.equal(ungoverned.allowed, true);
  assert.equal(ungoverned.rules.length, 0);
  assert.equal(ungoverned.unconstrained, true);

  // no role selected: a constrained rule cannot be satisfied
  assert.equal(permissionFor(model, 'pallet-audit', 'create', null).allowed, false);
});

test('the navigation is generated per role and hides nothing', () => {
  const model = fixtureModel();
  const nav = navFor(model, 'night-auditor');
  assert.deepEqual(nav.roles.map((r) => r.name), ['dock-supervisor', 'night-auditor']);
  assert.deepEqual(nav.all.map((e) => e.name).sort(), ['dock-slot', 'pallet-audit']);
  assert.ok(nav.work.some((e) => e.name === 'pallet-audit'), 'the auditor may create audits');

  // grammar §10 limit 11: Read rules do not filter visibility, so every entity stays reachable
  const other = navFor(model, 'dock-supervisor');
  assert.equal(other.all.length, nav.all.length,
    'no entity disappears for a different role — some are read-only, none are hidden');
  assert.ok(!other.work.some((e) => e.name === 'pallet-audit'));
  assert.ok(other.reference.some((e) => e.name === 'pallet-audit'));
});

// ---------------------------------------------------------------------------------------------
// 6. THE PRINCIPLE 7 TEST — a full interface for an entity no code has heard of
// ---------------------------------------------------------------------------------------------

test('Principle 7: a list, a detail page and a working form appear for an invented entity', () => {
  const model = fixtureModel();
  const index = indexOf(fixtureDocs());
  const common = { model, index, role: 'night-auditor', locale: 'de' };

  // --- the list
  const list = listView({ ...common, entity: 'pallet-audit' });
  assert.equal(list.kind, 'list');
  assert.equal(list.title, 'Pallet Audit', 'the title comes from the file’s # heading');
  assert.equal(list.total, 2);
  assert.equal(list.rows.length, 2);
  assert.ok(list.columns.length >= 4);
  assert.equal(list.rows[0].cells.length, list.columns.length);
  assert.equal(list.permissions.create.allowed, true);
  assert.equal(list.rules.length, 1);

  // the money column is right-aligned and formatted, because it was declared `money`
  const moneyCol = list.columns.findIndex((c) => c.name === 'shrinkage-value');
  if (moneyCol >= 0) {
    assert.equal(list.columns[moneyCol].align, 'right');
    assert.equal(list.rows[0].cells[moneyCol].text, '1.234,50 EUR');
  }
  // the reference column resolved to the target's label
  const refCol = list.columns.findIndex((c) => c.name === 'dock-slot');
  if (refCol >= 0) assert.equal(list.rows[0].cells[refCol].text, 'Gate West');

  // filtering is generic, over the rendered cells
  assert.equal(listView({ ...common, entity: 'pallet-audit', filter: 'Gate West' }).rows.length, 1);
  assert.equal(listView({ ...common, entity: 'pallet-audit', filter: 'zzz' }).rows.length, 0);

  // --- the detail page: every declared field, in declaration order
  const detail = detailView({ ...common, entity: 'pallet-audit', id: 'PA-0001' });
  assert.equal(detail.kind, 'detail');
  assert.deepEqual(detail.fields.map((f) => f.name),
    ['id', ...[...model.entities.get('pallet-audit').fields.keys()]]);
  const audited = detail.fields.find((f) => f.name === 'audited-on');
  assert.equal(audited.text, '03.11.2027');
  assert.equal(audited.required, true);
  assert.equal(audited.declaredAt.file, 'operating-model/information/pallet-audit.md');
  assert.ok(audited.declaredAt.line > 0, 'a required field knows which line declares it');
  assert.equal(detail.undeclared.length, 0);

  // incoming references are found through declared reference fields
  const slot = detailView({ ...common, entity: 'dock-slot', id: 'DOCK-1' });
  assert.deepEqual(slot.references,
    [{ entity: 'pallet-audit', title: 'Pallet Audit', via: 'dock-slot', ids: ['PA-0001'] }]);

  // --- the create form
  const form = formView({ ...common, entity: 'pallet-audit', nextId: 'PA-0003' });
  assert.equal(form.kind, 'form');
  assert.equal(form.mode, 'create');
  assert.equal(form.id, 'PA-0003');
  assert.equal(form.idEditable, true);
  assert.equal(form.fields.length, model.entities.get('pallet-audit').fields.size);

  const byName = Object.fromEntries(form.fields.map((f) => [f.name, f]));
  assert.equal(byName['audited-on'].control.type, 'date');
  // FD-1: money is a text control with no `step`. A numeric input would let the browser coerce and
  // re-round the amount before the operating model ever saw it.
  assert.equal(byName['shrinkage-value'].control.type, 'text');
  assert.equal(byName['shrinkage-value'].control.step, undefined);
  assert.equal(byName['shrinkage-value'].control.placeholder, '0.00 EUR');
  assert.equal(byName['pallet-count'].required, true);
  assert.equal(byName.remark.required, false);
  assert.equal(byName.sealed.control.control, 'checkbox');

  // the reference field became a picker, populated from the index
  assert.equal(byName['dock-slot'].control.control, 'select');
  assert.deepEqual(byName['dock-slot'].options,
    [{ value: 'DOCK-1', label: 'Gate West — DOCK-1' }, { value: 'DOCK-2', label: 'Gate East — DOCK-2' }]);
  assert.equal(byName['dock-slot'].emptyOption, '— choose —', 'required, so no "none" option');
  assert.equal(byName.remark.options, null);
  assert.equal(byName['dock-slot'].targetEmpty, false);

  // --- the edit form is prefilled from the document
  const edit = formView({ ...common, entity: 'pallet-audit', id: 'PA-0001' });
  assert.equal(edit.mode, 'edit');
  assert.equal(edit.idEditable, false);
  assert.equal(edit.fields.find((f) => f.name === 'remark').value, 'film torn');
  assert.equal(edit.fields.find((f) => f.name === 'sealed').value, false);

  // --- the form round-trips into an Intent's doc
  const values = { id: 'PA-0003', 'reference-code': 'PA-0003', 'audited-on': '2027-12-01',
    'dock-slot': 'DOCK-2', 'shrinkage-value': '10,50', currency: 'EUR', 'pallet-count': '7',
    sealed: false, remark: '' };
  const collected = collectForm(form, values);
  assert.deepEqual(collected.problems, []);
  assert.deepEqual(collected.doc, {
    entity: 'pallet-audit', id: 'PA-0003', 'reference-code': 'PA-0003', 'audited-on': '2027-12-01',
    'dock-slot': 'DOCK-2', 'shrinkage-value': 10.5, currency: 'EUR', 'pallet-count': 7, sealed: false,
  });
  assert.ok(!('remark' in collected.doc), 'an empty optional field is absent, not an empty string');

  // a required field left empty is NOT blocked here — the operating model gets to refuse it,
  // quoting its own declaration. That is a deliberate decision (docs/_compromise-ui.md).
  const sparse = collectForm(form, { id: 'PA-0004', 'pallet-count': '' });
  assert.deepEqual(sparse.problems, []);
  assert.ok(!('pallet-count' in sparse.doc));
});

test('an entity the model does not describe produces a helpful screen, not a crash', () => {
  const model = fixtureModel();
  const vm = listView({ model, index: indexOf([]), entity: 'sausage-ledger', role: null });
  assert.equal(vm.kind, 'unknown-entity');
  assert.match(vm.message, /"sausage-ledger" is not a kind of document/);
  assert.match(vm.hint, /operating-model\/information\/sausage-ledger\.md/);
  assert.deepEqual(vm.known, ['dock-slot', 'pallet-audit']);

  const missing = detailView({ model, index: indexOf([]), entity: 'pallet-audit', id: 'nope' });
  assert.equal(missing.kind, 'missing-document');
});

test('a document carrying fields the model does not declare shows them rather than hiding them', () => {
  const model = fixtureModel();
  const index = indexOf([{
    entity: 'dock-slot', id: 'DOCK-3', name: 'Gate South', 'gate-number': 5,
    'legacy-sap-code': 'WERK-4711',
  }]);
  const detail = detailView({ model, index, entity: 'dock-slot', id: 'DOCK-3' });
  assert.deepEqual(detail.undeclared,
    [{ name: 'legacy-sap-code', label: 'Legacy sap code', text: 'WERK-4711' }]);
});

// ---------------------------------------------------------------------------------------------
// 7. THE REFUSAL FORMATTER — the most important screen
// ---------------------------------------------------------------------------------------------

test('a refusal quotes the author’s own sentence, verbatim, with its file and line', () => {
  const model = fixtureModel();
  const sources = FIXTURE;
  const rulePath = 'operating-model/processes/pallet-audit.md';
  const rule = rulesFor(model, 'pallet-audit', 'create')[0];
  const at = `${rulePath}:${rule.source.line}`;

  // shaped exactly as runtime/kernel.js emits it
  const vm = refusalView([{
    reason: 'the condition "pallet-count > 0" is not met: pallet-count is 0, not greater than 0\n'
      + `  refused by the rule in ${at}:\n    If Create pallet-audit under condition …`,
    rule: 'If create pallet-audit under condition pallet-count > 0 and dock-slot exists then Update pallet-audit with sealed true',
    at,
  }], { model, sources });

  assert.equal(vm.kind, 'refusal');
  assert.equal(vm.count, 1);
  const item = vm.items[0];

  // the headline is the business reason, without the executor's appended rule dump
  assert.equal(item.reason,
    'the condition "pallet-count > 0" is not met: pallet-count is 0, not greater than 0');
  assert.ok(item.detail.length > 0, 'the rest of the message is kept, not thrown away');

  // the verbatim sentence beats the kernel's reconstructed one
  assert.equal(item.verbatim, true);
  assert.equal(item.sentence, rule.text);
  assert.match(item.sentence, /^If Create pallet-audit under condition/,
    'the author wrote "Create" with a capital C; that is what is shown');
  assert.deepEqual(item.at, { file: rulePath, line: rule.source.line });
  assert.equal(item.kind, 'rule');
  assert.deepEqual(item.authorizedBy, ['night-auditor']);
  assert.deepEqual(vm.files, [rulePath]);

  // the excerpt carries real line numbers from the real file, with the rule highlighted
  assert.ok(Array.isArray(item.excerpt) && item.excerpt.length > 0);
  const quoted = item.excerpt.filter((l) => l.highlight);
  assert.ok(quoted.length >= 1);
  assert.equal(quoted[0].line, rule.source.line);
  const fileLines = sources.get(rulePath).split('\n');
  for (const l of item.excerpt) {
    assert.equal(l.text, fileLines[l.line - 1], `excerpt line ${l.line} must be the real file line`);
  }
});

test('a refusal with no rule behind it still says where the declaration lives', () => {
  const model = fixtureModel();
  // This is the exact shape kernel.perform() returns for a missing required field: `at` is null.
  const vm = refusalView([{
    reason: '"pallet-count" must be filled in on every pallet-audit.\n'
      + '  declared in operating-model/information/pallet-audit.md:12: pallet-count is required',
    rule: null,
    at: null,
  }], { model, sources: FIXTURE });

  const item = vm.items[0];
  assert.equal(item.kind, 'no-source');
  assert.equal(item.at, null);
  assert.equal(item.sentence, null);
  assert.equal(item.verbatim, false);
  // the position is still in the message, so a human is not left without it
  assert.match(item.detail.join(' '), /pallet-audit\.md:12/);
  assert.deepEqual(vm.files, []);
});

test('a declaration-level refusal (a position but no rule) is labelled as such', () => {
  const model = fixtureModel();
  const vm = refusalView([{ reason: 'something about a field', rule: null,
    at: 'operating-model/information/pallet-audit.md:8' }], { model, sources: FIXTURE });
  assert.equal(vm.items[0].kind, 'declaration');
  assert.equal(vm.items[0].sentence, null);
  assert.ok(vm.items[0].excerpt.length > 0, 'the declaration is still quoted from the file');
});

test('refusalView survives a kernel that hands back nothing useful', () => {
  const model = fixtureModel();
  assert.equal(refusalView([], { model }).count, 0);
  assert.equal(refusalView(undefined, { model }).count, 0);
  const vm = refusalView([{ reason: 'boom' }], { model });
  assert.equal(vm.items[0].kind, 'no-source');
  assert.equal(vm.items[0].excerpt, null);
});

test('parseAt and excerpt behave at the edges', () => {
  assert.deepEqual(parseAt('a/b.md:12'), { file: 'a/b.md', line: 12 });
  assert.deepEqual(parseAt('a/b.md'), { file: 'a/b.md', line: null });
  assert.equal(parseAt(''), null);
  assert.equal(parseAt(null), null);
  // a Windows-ish path with a colon still takes the LAST colon as the line
  assert.deepEqual(parseAt('C:/x/b.md:3'), { file: 'C:/x/b.md', line: 3 });

  const text = 'one\ntwo\nthree\nfour\nfive';
  assert.deepEqual(excerpt(text, 3, 1, 1), [
    { line: 2, text: 'two', highlight: false },
    { line: 3, text: 'three', highlight: true },
    { line: 4, text: 'four', highlight: false },
  ]);
  // clamped at both ends, never out of range
  assert.deepEqual(excerpt(text, 1, 1, 5).map((l) => l.line), [1, 2, 3, 4, 5]);
  assert.equal(excerpt(text, NaN), null);
  assert.equal(excerpt(null, 1), null);
});

test('a parse error is shown against the text the author just wrote', () => {
  const text = '# Thing\n\n## Fields\n- broken line here\n';
  const vm = diagnosticsView([{ reason: '"- broken line here" is not a field declaration.',
    at: 'operating-model/information/thing.md:4' }], text);
  assert.equal(vm.items.length, 1);
  assert.deepEqual(vm.items[0].at, { file: 'operating-model/information/thing.md', line: 4 });
  assert.ok(vm.items[0].excerpt.some((l) => l.highlight && l.text === '- broken line here'));
});

// ---------------------------------------------------------------------------------------------
// 8. the transaction log
// ---------------------------------------------------------------------------------------------

test('commit trailers are parsed, including the rule that caused the commit', () => {
  const message = [
    'goods received',
    '',
    'NeoDonkey-Transaction: v1',
    'NeoDonkey-Change: create pallet-audit PA-0001',
    'NeoDonkey-Change: update dock-slot DOCK-1',
    'NeoDonkey-Rule: operating-model/processes/pallet-audit.md:4',
  ].join('\n');
  const t = parseTrailers(message);
  assert.deepEqual(t.changes, [
    { op: 'create', entity: 'pallet-audit', id: 'PA-0001' },
    { op: 'update', entity: 'dock-slot', id: 'DOCK-1' },
  ]);
  assert.deepEqual(t.rules, ['operating-model/processes/pallet-audit.md:4']);
  assert.equal(t.genesis, false);
  assert.equal(parseTrailers('x\n\nNeoDonkey-Genesis: true').genesis, true);
  assert.deepEqual(parseTrailers(undefined), { changes: [], rules: [], genesis: false });
});

test('the log pairs each commit with its signature verdict and its rule', () => {
  const model = fixtureModel();
  const rule = rulesFor(model, 'pallet-audit', 'create')[0];
  const transactions = [
    {
      oid: 'a'.repeat(40), time: 1830000000, author: { name: 'S', email: 's@local' }, signature: 'x',
      message: `pallet audit booked\n\nNeoDonkey-Change: create pallet-audit PA-0001\n`
        + `NeoDonkey-Rule: ${rule.source.file}:${rule.source.line}`,
      changes: [{ op: 'create', entity: 'pallet-audit', id: 'PA-0001' }],
    },
    {
      oid: 'b'.repeat(40), time: 1829999000, author: { name: 'S', email: 's@local' }, signature: 'y',
      message: 'S starts a company\n\nNeoDonkey-Genesis: true', changes: [],
    },
  ];
  const verdicts = [
    { oid: 'a'.repeat(40), signature: 'good', by: 's@local' },
    { oid: 'b'.repeat(40), signature: 'bad', by: 's@local' },
  ];

  const vm = historyView(transactions, verdicts, { locale: 'de', model });
  assert.equal(vm.total, 2);
  assert.equal(vm.entries[0].signature, 'good');
  assert.equal(vm.entries[1].signature, 'bad');
  assert.equal(vm.entries[1].genesis, true);
  assert.equal(vm.counts.good, 1);
  assert.equal(vm.counts.bad, 1);
  assert.equal(vm.allGood, false);
  assert.equal(vm.entries[0].short, 'aaaaaaaa');
  assert.equal(vm.entries[0].subject, 'pallet audit booked');
  // the rule trailer is resolved back to the sentence
  assert.equal(vm.entries[0].rules[0].sentence, rule.text);
  assert.deepEqual(vm.entries[0].rules[0].at, { file: rule.source.file, line: rule.source.line });
  assert.match(vm.entries[0].when, /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2} UTC$/);

  // a commit with a signature we never verified is 'unverified', never silently 'good'
  const unchecked = historyView(transactions, [], { model });
  assert.equal(unchecked.entries[0].signature, 'unverified');
  assert.equal(unchecked.allGood, false);
  assert.equal(historyView([], []).total, 0);
});

// ---------------------------------------------------------------------------------------------
// 9. the operating-model views
// ---------------------------------------------------------------------------------------------

test('the operating model browses as a tree grouped by POLISM category', () => {
  const tree = operatingModelTree(FIXTURE.keys());
  assert.deepEqual(tree.map((g) => g.category), ['information', 'organisation', 'processes']);
  assert.deepEqual(tree[0].files.map((f) => f.name), ['dock-slot', 'pallet-audit']);
  assert.equal(tree[0].files[0].path, 'operating-model/information/dock-slot.md');
  assert.equal(tree[1].title, 'Organisation');
});

test('one operating-model file shows what the runtime reads from it', () => {
  const model = fixtureModel();
  const path = 'operating-model/information/pallet-audit.md';
  const vm = operatingModelFileView({ model, path, text: FIXTURE.get(path) });
  assert.equal(vm.name, 'pallet-audit');
  assert.equal(vm.fields.length, 8);
  assert.deepEqual(vm.fields.find((f) => f.name === 'dock-slot').type, 'reference to dock-slot');
  assert.equal(vm.fields.find((f) => f.name === 'audited-on').required, true);
  assert.deepEqual(vm.predicates, [{ name: 'unsealed', text: 'sealed is false', line: 17 }]);
  assert.deepEqual(vm.identifiedBy, ['reference-code']);
  assert.equal(vm.createdOnDemand, false);
  assert.equal(vm.rules.length, 0, 'this file declares an entity, not rules');

  const rulesPath = 'operating-model/processes/pallet-audit.md';
  const rulesVm = operatingModelFileView({ model, path: rulesPath, text: FIXTURE.get(rulesPath) });
  assert.equal(rulesVm.rules.length, 1);
  assert.deepEqual(rulesVm.rules[0].authorizedBy, ['night-auditor']);
  assert.deepEqual(rulesVm.rules[0].trigger, { op: 'create', entity: 'pallet-audit' });
  assert.equal(rulesVm.fields.length, 0);

  // a prose-only file is valid and says so
  const roleVm = operatingModelFileView({ model, path: 'operating-model/organisation/night-auditor.md',
    text: FIXTURE.get('operating-model/organisation/night-auditor.md') });
  assert.ok(roleVm.roleDef, 'a file in organisation/ declares a role');
  assert.equal(roleVm.rules.length, 0);
});

test('the overview counts what the company is', () => {
  const model = fixtureModel();
  const vm = overview({ model, index: indexOf(fixtureDocs()), role: 'night-auditor',
    modelErrors: [], sources: FIXTURE });
  assert.equal(vm.entityCount, 2);
  assert.equal(vm.roleCount, 2);
  assert.equal(vm.ruleCount, 1);
  assert.equal(vm.fileCount, 5);
  assert.equal(vm.documentCount, 4);
  assert.equal(vm.entities.find((e) => e.name === 'pallet-audit').count, 2);
  assert.deepEqual(vm.modelErrors, []);

  const broken = overview({ model, index: indexOf([]), role: null,
    modelErrors: [{ message: 'nope', file: 'a.md', line: 3 }] });
  assert.deepEqual(broken.modelErrors, [{ reason: 'nope', at: 'a.md:3' }]);
});

test('entity titles come from the file heading, falling back to the slug', () => {
  const model = fixtureModel();
  assert.equal(entityTitle(model.entities.get('dock-slot'), 'dock-slot'), 'Loading Dock Slot');
  assert.equal(entityTitle({ title: null }, 'pallet-audit'), 'Pallet audit');
  assert.equal(ruleAt(model, 'nope.md', 1), null);
});

// ---------------------------------------------------------------------------------------------
// 10. routing
// ---------------------------------------------------------------------------------------------

test('the hash is the whole router', () => {
  assert.deepEqual(parseRoute(''), { kind: 'overview' });
  assert.deepEqual(parseRoute('#/'), { kind: 'overview' });
  assert.deepEqual(parseRoute('#/e/pallet-audit'), { kind: 'list', entity: 'pallet-audit' });
  assert.deepEqual(parseRoute('#/e/pallet-audit/new'), { kind: 'create', entity: 'pallet-audit' });
  assert.deepEqual(parseRoute('#/e/pallet-audit/PA-0001'),
    { kind: 'detail', entity: 'pallet-audit', id: 'PA-0001' });
  assert.deepEqual(parseRoute('#/e/pallet-audit/PA-0001/edit'),
    { kind: 'edit', entity: 'pallet-audit', id: 'PA-0001' });
  assert.deepEqual(parseRoute('#/model'), { kind: 'model' });
  assert.deepEqual(parseRoute('#/log'), { kind: 'log' });
  assert.deepEqual(parseRoute('#/runtime'), { kind: 'runtime' });
  assert.deepEqual(parseRoute('#/nonsense'), { kind: 'unknown' });

  // an id with a slash or a space survives the round trip
  assert.deepEqual(parseRoute(`#/e/x/${encodeURIComponent('A B/C')}`),
    { kind: 'detail', entity: 'x', id: 'A B/C' });
  // a file path plus the line to jump to
  assert.deepEqual(
    parseRoute(`#/model/${encodeURIComponent('operating-model/processes/x.md')}?line=12`),
    { kind: 'model-file', path: 'operating-model/processes/x.md', line: 12 });
  assert.equal(parseRoute(`#/model/${encodeURIComponent('a/b.md')}`).line, null);
});

// ---------------------------------------------------------------------------------------------
// 11. THE MECHANICAL PRINCIPLE 7 GUARD — no per-entity code anywhere
// ---------------------------------------------------------------------------------------------

/** Source of every UI module except the fallback operating model, which IS business content. */
async function uiSources() {
  const names = (await readdir(repoPath('runtime/ui')))
    .filter((n) => n.endsWith('.js') && n !== 'starter-model.js');
  const out = new Map();
  for (const n of names) out.set(n, await readFile(repoPath(`runtime/ui/${n}`), 'utf8'));
  return out;
}

/** Strip comments, so prose about invoices does not count as code about invoices. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('Principle 7: no entity name is hardcoded in any view module', async () => {
  const sources = await uiSources();
  // Entity names from the shipped starter model AND from this test's invented fixture.
  const { model: starter } = parseOperatingModel(starterModel());
  const entityNames = [...new Set([...starter.entities.keys(), ...fixtureModel().entities.keys()])];
  assert.ok(entityNames.length >= 9, 'expected a decent list of entity names to check against');

  for (const [name, src] of sources) {
    const code = stripComments(src);
    for (const entity of entityNames) {
      for (const literal of [`'${entity}'`, `"${entity}"`, `\`${entity}\``]) {
        assert.ok(!code.includes(literal),
          `runtime/ui/${name} contains the entity name ${literal} as a literal — that is a `
          + 'per-entity view, which Principle 7 forbids. Views must come from the declaration.');
      }
      // ...and not as a property access either (`doc.invoice`, `model.entities.invoice`)
      assert.ok(!new RegExp(`\\.${entity.replace(/-/g, '\\-')}\\b`).test(code),
        `runtime/ui/${name} reaches for a property named after the entity "${entity}"`);
    }
  }
});

test('unsigned builds show the unverified/unsigned state in "This runtime" screen', async () => {
  const originalDocument = globalThis.document;

  globalThis.document = {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        childNodes: [],
        attributes: {},
        appendChild(child) {
          this.childNodes.push(child);
          return child;
        },
        setAttribute(k, v) {
          this.attributes[k] = v;
        },
        addEventListener(type, fn) {
          // No-op for testing
        }
      };
    },
    createDocumentFragment() {
      return {
        nodeType: 11,
        childNodes: [],
        appendChild(child) {
          this.childNodes.push(child);
          return child;
        }
      };
    },
    createTextNode(text) {
      return {
        nodeType: 3,
        textContent: text
      };
    }
  };

  try {
    const { renderRuntime } = await import('../runtime/ui/views.js');

    const mockVm = {
      version: '1.0.0',
      hashes: { files: [], combined: 'abc', command: [] },
      origin: { origin: 'http://localhost:8080', base: 'http://localhost:8080/', secureContext: true, standalone: false, shellFiles: 0 },
      worker: { supported: false },
      persistence: null,
      update: { waiting: false },
      release: { mode: 'unsigned', version: null, fingerprint: null }
    };
    const mockHandlers = { onRehash: () => {}, onCheckUpdate: () => {}, onApplyUpdate: () => {} };

    const rendered = renderRuntime(mockVm, mockHandlers);

    // Helpers to search rendered output
    function findNodeByClass(node, className) {
      if (node.className === className) return node;
      for (const child of node.childNodes || []) {
        const found = findNodeByClass(child, className);
        if (found) return found;
      }
      return null;
    }

    function findTextInNode(node, text) {
      if (node.textContent && node.textContent.includes(text)) return true;
      for (const child of node.childNodes || []) {
        if (findTextInNode(child, text)) return true;
      }
      return false;
    }

    // Verify 'unsigned' state notice notice-warn is displayed
    const noticeNode = findNodeByClass(rendered, 'notice notice-warn');
    assert.ok(noticeNode, 'should render notice notice-warn for unsigned release');
    assert.ok(findTextInNode(noticeNode, 'This runtime is not signed'), 'should mention unsigned release');

    // Verify 'verified' state displays correctly
    const mockVmVerified = {
      ...mockVm,
      release: { mode: 'verified', version: '1.0.0', fingerprint: 'SHA256:123' }
    };
    const renderedVerified = renderRuntime(mockVmVerified, mockHandlers);
    const okNode = findNodeByClass(renderedVerified, 'notice notice-ok');
    assert.ok(okNode, 'should render notice notice-ok for verified release');
    assert.ok(findTextInNode(okNode, 'Signature verified against the key pinned on this machine'), 'should mention verified release');

  } finally {
    globalThis.document = originalDocument;
  }
});

/**
 * The honest counterpart to the test above. The UI *does* know a few conventional FIELD names —
 * only `currency` for rendering `money` (which is grammar §10.7's own documented workaround for
 * money having no currency). The display candidates 'name', 'title', 'label', and 'description'
 * have been completely removed from the runtime and moved to the operating model via the
 * '## Displayed by' grammar section (Close compromise #13). That is a small amount of hidden
 * semantics, and it is pinned here so it cannot quietly grow into the per-entity knowledge
 * Principle 7 forbids.
 */
test('the UI knows exactly one conventional field name, and no more', async () => {
  const CONVENTIONAL = ['currency'];
  const src = stripComments(await readFile(repoPath('runtime/ui/fields.js'), 'utf8'));

  for (const field of CONVENTIONAL) {
    assert.ok(src.includes(`'${field}'`), `fields.js should still know the convention '${field}'`);
  }
  // Anything else that looks like a business field name must not be in here.
  const { model: starter } = parseOperatingModel(starterModel());
  const businessFields = new Set();
  for (const def of starter.entities.values()) {
    for (const f of def.fields.keys()) if (!CONVENTIONAL.includes(f)) businessFields.add(f);
  }
  assert.ok(businessFields.size > 15, 'expected plenty of business field names to check');
  for (const field of businessFields) {
    assert.ok(!src.includes(`'${field}'`),
      `fields.js hardcodes the business field name '${field}'`);
  }
});

test('no module reaches into kernel internals except the one that documents why', async () => {
  const sources = await uiSources();
  for (const [name, src] of sources) {
    if (name === 'kernel-gaps.js') continue;
    assert.ok(!src.includes('_internals'),
      `runtime/ui/${name} touches kernel._internals — that belongs in kernel-gaps.js with a `
      + 'written reason, so the reach-around stays visible and removable.');
  }
  // ...and every escape hatch is a *documented* gap.
  const gaps = await readFile(repoPath('runtime/ui/kernel-gaps.js'), 'utf8');
  for (const n of ['GAP 1', 'GAP 2', 'GAP 3']) {
    assert.ok(gaps.includes(n), `kernel-gaps.js should document ${n}`);
  }
  // The stale-index bug was fixed in the kernel while this UI was written. The workaround must
  // be gone, not left behind as a permanent full rebuild on every commit.
  const app = await readFile(repoPath('runtime/ui/app.js'), 'utf8');
  assert.ok(!app.includes('afterWrite'), 'the reindex-after-every-write workaround is obsolete');
  assert.ok(gaps.includes('FIXED WHILE THIS UI WAS BEING WRITTEN'),
    'kernel-gaps.js should keep the record of what was fixed and why it mattered');
});

test('no innerHTML anywhere in the UI: every document value reaches the DOM as text', async () => {
  // Comments stripped: render.js explains at length why it does NOT use innerHTML, and that
  // explanation must not fail the test that enforces it.
  for (const [name, src] of await uiSources()) {
    const code = stripComments(src);
    assert.ok(!/\binnerHTML\b/.test(code),
      `runtime/ui/${name} uses innerHTML — documents arrive from other peers and are untrusted`);
    assert.ok(!/\bouterHTML\b|insertAdjacentHTML/.test(code), `runtime/ui/${name} injects HTML`);
  }
  // index.html's inline fallback DOES use innerHTML, on strings it builds itself and escapes.
  // It is the one place, it never touches a document value, and it is checked here so it stays
  // that way.
  const html = await readFile(repoPath('index.html'), 'utf8');
  const uses = [...html.matchAll(/innerHTML/g)].length;
  assert.equal(uses, 1, 'index.html should have exactly one innerHTML, in the boot fallback');
  assert.ok(html.includes("replace(/[<>&]/g"), 'that one place must escape what it interpolates');
});

test('the UI imports only the kernel, identity, the browser FS adapter and the release gate', async () => {
  const sources = await uiSources();
  const allowed = new Set([
    '../kernel.js', '../identity/ed25519.js', '../identity/keystore.js', '../git/fs-opfs.js',
    // Widened deliberately by the CTO when wiring the signed runtime (ARCHITECTURE.md D11).
    // The release gate cannot sit behind the kernel: it must decide whether this code may run
    // *at all*, before a workspace is opened, so it is reachable only from boot.js. That is why
    // it is an exception to the "everything goes through the kernel" rule rather than a breach
    // of it — and why this list is edited in a diff a reviewer can see, not bypassed.
    '../release/pin.js',
  ]);
  for (const [name, src] of sources) {
    for (const m of src.matchAll(/from\s+'(\.\.\/[^']+)'/g)) {
      assert.ok(allowed.has(m[1]),
        `runtime/ui/${name} imports ${m[1]}, which is outside the UI's allowed surface `
        + `(${[...allowed].join(', ')})`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// 12. the PWA shell list must not drift
// ---------------------------------------------------------------------------------------------

/** Walk the real ES module graph from boot.js, exactly as a browser would. */
async function moduleGraph(entry) {
  const seen = new Set();
  const walk = async (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = await readFile(repoPath(rel), 'utf8');
    const re = /(?:^|[\s;])(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const m of src.matchAll(re)) {
      const spec = m[1] ?? m[2];
      if (!spec?.startsWith('.')) continue;
      const dir = rel.split('/').slice(0, -1).join('/');
      await walk(new URL(spec, `file:///${dir}/`).pathname.slice(1));
    }
  };
  await walk(entry);
  return [...seen].sort();
}

test('the precache list is exactly the real module graph — offline cannot half-work', async () => {
  const graph = await moduleGraph('runtime/ui/boot.js');
  const listed = CODE.slice().sort();
  assert.deepEqual(listed, graph,
    'runtime/ui/shell-files.js CODE must equal the modules reachable from boot.js');
  // fs-node.js is a Node-only module and must never be shipped to a browser.
  assert.ok(!listed.includes('runtime/git/fs-node.js'));
});

test('service-worker.js and shell-files.js agree, byte for byte', async () => {
  const sw = await readFile(repoPath('service-worker.js'), 'utf8');
  const listed = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(listed, 'service-worker.js must declare a SHELL array');
  const swShell = [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(swShell, SHELL,
    'the service worker precache list has drifted from runtime/ui/shell-files.js');

  const swVersion = /const VERSION = '([^']+)'/.exec(sw);
  assert.equal(swVersion[1], VERSION, 'service worker VERSION has drifted');

  // Rule 1: an update must never install itself.
  assert.ok(!/^\s*self\.skipWaiting\(\)/m.test(sw),
    'the service worker must not call skipWaiting() outside the message handler');
  assert.ok(/event\.data\?\.type === 'skip-waiting'/.test(sw),
    'skipWaiting must be reachable only when the page asks for it');
});

test('the version matches package.json, and every shell file exists', async () => {
  const pkg = JSON.parse(await readFile(repoPath('package.json'), 'utf8'));
  assert.equal(VERSION, pkg.version, 'shell-files.js VERSION must match package.json');
  assert.equal(CACHE_NAME, `neodonkey-shell-v${pkg.version}`);
  for (const rel of SHELL) {
    if (rel === './') continue;
    await readFile(repoPath(rel)); // throws if missing
  }
});

test('the PWA is origin-independent: no absolute path anywhere in the shell', async () => {
  const manifest = JSON.parse(await readFile(repoPath('manifest.webmanifest'), 'utf8'));
  for (const key of ['start_url', 'scope', 'id']) {
    assert.ok(!manifest[key].startsWith('/'),
      `manifest ${key} is "${manifest[key]}" — an absolute path breaks subdirectory hosting`);
  }
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/') && !/^https?:/.test(icon.src),
      `manifest icon "${icon.src}" must be relative`);
    await readFile(repoPath(icon.src));
  }
  // No entry in either shell list may be rooted.
  for (const rel of SHELL) assert.ok(!rel.startsWith('/'), `${rel} must be relative`);

  // index.html must not reference anything with a leading slash, and must not pull a CDN.
  const html = await readFile(repoPath('index.html'), 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (url.startsWith('data:') || url.startsWith('#') || url.startsWith('http://127.0.0.1')) continue;
    assert.ok(!url.startsWith('/'), `index.html references "${url}" absolutely`);
    assert.ok(!/^https?:\/\//.test(url), `index.html loads "${url}" from the network — no CDN`);
  }
  // and the service worker registration must be relative too
  const pwa = await readFile(repoPath('runtime/ui/pwa.js'), 'utf8');
  assert.ok(pwa.includes("appUrl('service-worker.js')"),
    'the service worker must be registered by a relative URL');
  assert.ok(!/register\(\s*['"]\//.test(pwa), 'no absolute service worker path');
});

test('zero dependencies, and no node: import outside the two files allowed to have one', async () => {
  const pkg = JSON.parse(await readFile(repoPath('package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'the core has no dependencies and never will');
  assert.equal(pkg.devDependencies, undefined);

  for (const [name, src] of await uiSources()) {
    assert.ok(!/from\s+'node:/.test(src), `runtime/ui/${name} imports a node: module`);
  }
  const sw = stripComments(await readFile(repoPath('service-worker.js'), 'utf8'));
  assert.ok(!/\bimport\b|\brequire\(|importScripts/.test(sw),
    'the service worker must be a self-contained classic script');
});

// ---------------------------------------------------------------------------------------------
// 13. serve.mjs actually serves the app — the most likely real-world failure
// ---------------------------------------------------------------------------------------------

test('serve.mjs serves every shell file with a correct MIME type and no 404', async (t) => {
  const port = 8123;
  const child = await new Promise((resolve, reject) => {
    const proc = execFile(process.execPath, [repoPath('serve.mjs'), String(port)],
      { cwd: repoPath('.') });
    let out = '';
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('http://127.0.0.1')) resolve(proc);
    });
    proc.on('error', reject);
    setTimeout(() => reject(new Error(`serve.mjs did not start:\n${out}`)), 8000);
  });

  try {
    const base = `http://127.0.0.1:${port}/`;
    const expected = {
      '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css',
      '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.md': 'text/markdown',
    };

    for (const rel of SHELL) {
      const res = await fetch(base + (rel === './' ? '' : rel));
      assert.equal(res.status, 200, `${rel} returned ${res.status} — a 404 here is a blank app`);
      const ext = rel === './' ? '.html' : rel.slice(rel.lastIndexOf('.'));
      const type = res.headers.get('content-type') ?? '';
      assert.ok(type.startsWith(expected[ext]),
        `${rel} was served as "${type}", but a browser needs ${expected[ext]}`);
    }

    // the service worker itself, at the app root so its scope covers the app
    const sw = await fetch(`${base}service-worker.js`);
    assert.equal(sw.status, 200);
    assert.ok((sw.headers.get('content-type') ?? '').startsWith('text/javascript'));

    // the directory listing the browser needs to seed a workspace
    const files = await fetch(`${base}_files?under=operating-model`);
    assert.equal(files.status, 200);
    const listing = await files.json();
    assert.equal(listing.root, 'operating-model');
    assert.ok(Array.isArray(listing.files));
    for (const f of listing.files) assert.match(f, /^operating-model\/.*\.md$/);

    // a missing module must 404 rather than return HTML a browser would try to execute
    assert.equal((await fetch(`${base}runtime/ui/does-not-exist.js`)).status, 404);

    // The server must not hand out the rest of the disk. These go over a raw socket, because
    // `fetch` normalises `..` and `%2e%2e` away *client side* — a traversal test written with
    // fetch never reaches the server and passes for the wrong reason.
    //
    // Two layers do the work, and both are asserted:
    //   • `new URL(req.url, base)` collapses `..` and `%2e%2e` path segments within the root, so
    //     they cannot climb out. `/runtime/../../package.json` becomes `/package.json` — served,
    //     correctly, because the repository is meant to be readable (Appendix II).
    //   • `%2f`-encoded separators survive URL parsing, so resolveInRoot() refuses them itself.
    const escapes = [
      '/../../../etc/passwd',
      '/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      '/..%2f..%2f..%2fetc%2fpasswd',
      '/..%5c..%5cetc%5cpasswd',
      '/%00/etc/passwd',
      '/runtime/ui/../../../../../../etc/passwd',
    ];
    for (const rawPath of escapes) {
      const raw = await rawGet(port, rawPath);
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1]);
      assert.ok(status === 403 || status === 404,
        `"${rawPath}" returned ${status}; nothing outside the repo may resolve`);
      assert.ok(!raw.includes('root:x:'), `the server leaked /etc/passwd via "${rawPath}"`);
    }
    // A `..` that stays inside the repo is collapsed and served — that is correct, not a hole.
    const inside = await rawGet(port, '/runtime/../../neodonkey/package.json');
    assert.ok(/^HTTP\/1\.1 (200|404)/.test(inside), 'a repo-internal .. must not 403');
    // the listing endpoint refuses '..' rather than quietly listing something else
    assert.equal((await fetch(`${base}_files?under=../../..`)).status, 403);
    assert.equal((await fetch(`${base}_files?under=`)).status, 403);
    // a legitimate subfolder still works
    assert.equal((await fetch(`${base}_files?under=templates`)).status, 200);
  } finally {
    child.kill('SIGKILL');
  }
});

// ---------------------------------------------------------------------------------------------
// 14. the shipped starter operating model must parse and be renderable
// ---------------------------------------------------------------------------------------------

test('the starter operating model parses with no errors and no warnings', () => {
  const { model, errors } = parseOperatingModel(starterModel());
  const hard = errors.filter((e) => e.severity === 'error');
  const warn = errors.filter((e) => e.severity === 'warning');
  assert.deepEqual(hard.map((e) => `${e.file}:${e.line} ${e.message}`), []);
  assert.deepEqual(warn.map((e) => `${e.file}:${e.line} ${e.message}`), [],
    'a warning the kernel cannot surface (kernel-gaps GAP 3) must not be shipped');
  assert.ok(model.entities.size >= 8);
  assert.ok(model.roles.size >= 5);
  assert.ok(model.processes.length >= 3);
});

/** The operating model this repo actually ships — what the UI will really open on. */
async function repoOperatingModel() {
  const files = new Map();
  const walk = async (rel) => {
    for (const e of await readdir(repoPath(`operating-model/${rel}`), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        files.set(`operating-model/${rel}${e.name}`,
          await readFile(repoPath(`operating-model/${rel}${e.name}`), 'utf8'));
      }
    }
  };
  await walk('');
  return files;
}

/**
 * THE REVIEWER'S CHECK, automated. This is the real operating model from the repository — not a
 * fixture and not the fallback — and every entity in it must produce a working list, detail page
 * and form with no UI code that mentions any of them. If someone adds an entity file, this test
 * covers it the moment it lands.
 */
test('every entity in the repo’s own operating model produces a usable list, detail and form', async () => {
  const sources = await repoOperatingModel();
  const { model, errors } = parseOperatingModel(sources);
  assert.deepEqual(errors.filter((e) => e.severity === 'error')
    .map((e) => `${e.file}:${e.line} ${e.message}`), [],
  'the shipped operating model must parse, or the UI has nothing to render');
  assert.ok(model.entities.size >= 15,
    `expected a real model, got ${model.entities.size} entities`);

  const roles = [...model.roles.keys()];
  for (const entity of model.entities.keys()) {
    const def = model.entities.get(entity);
    // one synthetic document, so detail/reference rendering is exercised too
    const doc = { entity, id: 'X-1' };
    for (const f of def.fields.values()) {
      doc[f.name] = f.type === 'boolean' ? true
        : f.type === 'number' || f.type === 'money' ? 1
          : f.type === 'date' ? '2027-11-03' : 'v';
    }
    const index = indexOf([doc]);

    const list = listView({ model, index, entity, role: roles[0] ?? null, locale: 'de' });
    assert.equal(list.kind, 'list', `no list view for ${entity}`);
    assert.equal(list.columns[0].name, 'id');
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0].cells.length, list.columns.length,
      `${entity}: a row must have exactly one cell per column`);
    for (const cell of list.rows[0].cells) {
      assert.equal(typeof cell.text, 'string', `${entity}: a cell rendered as ${typeof cell.text}`);
    }

    const detail = detailView({ model, index, entity, id: 'X-1', role: roles[0] ?? null, locale: 'de' });
    assert.equal(detail.kind, 'detail', `no detail view for ${entity}`);
    assert.equal(detail.fields.length, def.fields.size + 1, `${entity}: id plus every field`);

    for (const role of [...roles, null]) {
      const form = formView({ model, index, entity, role, nextId: 'X-2' });
      assert.equal(form.kind, 'form', `no form for ${entity}`);
      assert.equal(form.fields.length, def.fields.size);
      for (const f of form.fields) {
        assert.ok(['input', 'select', 'checkbox'].includes(f.control.control),
          `${entity}.${f.name} (declared ${f.type}) got control "${f.control.control}"`);
        // A reference pointing at an entity the model never described would be a model bug —
        // and the form says so rather than rendering a dead picker.
        assert.equal(f.problem, null, `${entity}.${f.name}: ${f.problem}`);
      }
    }
  }
});

test('every entity in the starter model produces a usable list and form', () => {
  const { model } = parseOperatingModel(starterModel());
  const index = indexOf([]);
  for (const entity of model.entities.keys()) {
    for (const role of [...model.roles.keys(), null]) {
      const list = listView({ model, index, entity, role, locale: 'de' });
      assert.equal(list.kind, 'list', `no list view for ${entity}`);
      assert.ok(list.columns.length >= 1);
      assert.equal(list.columns[0].name, 'id');

      const form = formView({ model, index, entity, role, nextId: 'X-1' });
      assert.equal(form.kind, 'form', `no form for ${entity}`);
      assert.equal(form.fields.length, model.entities.get(entity).fields.size);
      for (const f of form.fields) {
        assert.ok(['input', 'select', 'checkbox'].includes(f.control.control),
          `${entity}.${f.name} (${f.type}) got no usable control`);
        assert.equal(f.problem, null, `${entity}.${f.name}: ${f.problem}`);
      }
    }
  }
});
