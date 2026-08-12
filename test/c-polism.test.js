/**
 * test/c-polism.test.js — the Operating Model runtime (module C, Appendix XII / Principle 11).
 *
 * `node --test test/c-polism.test.js`
 *
 * The fixture operating model is written inline, on purpose: this test must not depend on agent F's
 * content, which is authored in parallel. The process file is the goods-receipt example copied
 * verbatim out of the manifesto (Appendix XII, lines 452-472).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOperatingModel, parseRule, GRAMMAR_VERSION, RUNTIME_SECTIONS, AGGREGATE_FUNCTIONS,
} from '../runtime/polism/parse.js';
import { evaluate } from '../runtime/polism/execute.js';

// =============================================================================================
// Fixture: a small operating model
// =============================================================================================

const PROCESS = 'operating-model/processes/goods-receipt.md';

/** Appendix XII, lines 452-472 — verbatim. Do not "improve" this string. */
const GOODS_RECEIPT_PROCESS = `# Goods Receipt

The goods receipt is executed when a delivery arrives at the warehouse.
It checks whether the delivery matches the order and updates stock
plus order status.

## Triggered by
Arrival of a delivery at the location with reference to an order.

## Rules
If Create goods-receipt under condition
  quantity > 0 and
  order exists and
  order not already fully delivered
then
  Create goods-receipt-fact and
  Update stock with +quantity and
  Update order-line with status "delivered"

## Authorized by
warehouse-clerk or warehouse-management
`;

// Line numbers inside GOODS_RECEIPT_PROCESS, asserted below so that diagnostics stay honest.
const LINE_RULE = 11;
const LINE_COND_QUANTITY = 12;
const LINE_COND_ORDER_EXISTS = 13;
const LINE_COND_NOT_DELIVERED = 14;
const LINE_CONS_FACT = 16;
const LINE_CONS_STOCK = 17;
const LINE_CONS_ORDER_LINE = 18;
const LINE_AUTHORIZED_BY = 20;

function baseFiles(overrides = {}) {
  const files = new Map([
    [PROCESS, GOODS_RECEIPT_PROCESS],

    ['operating-model/information/goods-receipt.md', `# Goods receipt (document)

What the warehouse captures when a delivery arrives.

## Fields
- quantity: number required
- batch-number: text
- article: reference to article
- location: reference to location
- order: reference to order
- order-line: reference to order-line
`],

    ['operating-model/information/goods-receipt-fact.md', `# Goods receipt fact

The permanent fact that these goods arrived. Kept for ten years (GoBD).

## Fields
- quantity: number
- batch-number: text
- article: reference to article
- location: reference to location
- order: reference to order
- received-on: date
`],

    ['operating-model/information/stock.md', `# Stock

How much of one article lies at one location.

## Fields
- article: reference to article
- location: reference to location
- quantity: number

## Identified by
article and location

## Created on demand
yes
`],

    ['operating-model/information/order.md', `# Order

What we ordered from a supplier.

## Fields
- ordered-quantity: number
- delivered-quantity: number
- status: text

## Predicates
- fully delivered: delivered-quantity >= ordered-quantity
- already fully delivered: fully delivered
`],

    ['operating-model/information/order-line.md', `# Order line

## Fields
- order: reference to order
- article: reference to article
- status: text
`],

    ['operating-model/information/article.md', `# Article

## Fields
- name: text
`],

    ['operating-model/information/location.md', `# Location

## Fields
- name: text
`],

    ['operating-model/organisation/warehouse-clerk.md', '# Warehouse clerk\n\nBooks arriving goods.\n'],
    ['operating-model/organisation/warehouse-management.md', '# Warehouse management\n\nRuns the warehouse.\n'],
    ['operating-model/organisation/accountant.md', '# Accountant\n\nBooks invoices.\n'],
  ]);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) files.delete(k);
    else files.set(k, v);
  }
  return files;
}

/** A minimal World over a list of documents (the read side of Appendix VI, in ten lines). */
function makeWorld(docs) {
  const byEntity = new Map();
  for (const d of docs) {
    if (!byEntity.has(d.entity)) byEntity.set(d.entity, new Map());
    byEntity.get(d.entity).set(String(d.id), d);
  }
  return {
    get(entity, id) {
      const m = byEntity.get(entity);
      return (m && m.get(String(id))) || null;
    },
    find(entity, pred) {
      const m = byEntity.get(entity);
      return m ? [...m.values()].filter(pred) : [];
    },
  };
}

const WORLD_DOCS = () => [
  { id: 'cashew-1kg', entity: 'article', name: 'Cashews 1kg' },
  { id: 'berlin-main', entity: 'location', name: 'Berlin main warehouse' },
  { id: 'PO-77', entity: 'order', 'ordered-quantity': 100, 'delivered-quantity': 0, status: 'open' },
  { id: 'PO-88', entity: 'order', 'ordered-quantity': 100, 'delivered-quantity': 100, status: 'open' },
  { id: 'PO-77-1', entity: 'order-line', order: 'PO-77', article: 'cashew-1kg', status: 'open' },
  { id: 'PO-88-1', entity: 'order-line', order: 'PO-88', article: 'cashew-1kg', status: 'open' },
  { id: 'ST-1', entity: 'stock', article: 'cashew-1kg', location: 'berlin-main', quantity: 40 },
];

function receipt(overrides = {}) {
  return {
    op: 'create',
    entity: 'goods-receipt',
    id: 'GR-0001',
    doc: {
      quantity: 12,
      'batch-number': 'L-2027-04',
      article: 'cashew-1kg',
      location: 'berlin-main',
      order: 'PO-77',
      'order-line': 'PO-77-1',
      ...overrides,
    },
    actorRoles: ['warehouse-clerk'],
  };
}

function parseOk(files) {
  const { model, errors } = parseOperatingModel(files);
  assert.deepEqual(errors.filter((e) => e.severity === 'error').map((e) => e.message), [],
    'the fixture operating model must parse without errors');
  return model;
}

const errorsOf = (errors) => errors.filter((e) => e.severity === 'error');
const ruleOf = (model, file = PROCESS) => model.processes.find((r) => r.source.file === file);

/** A rules-only process file, so line numbers are predictable: the rule starts at line 4. */
function processFile(rulesBody, authorizedBy = 'warehouse-clerk') {
  return `# Test process\n\n## Rules\n${rulesBody}\n\n## Authorized by\n${authorizedBy}\n`;
}
const TEST_PROCESS = 'operating-model/processes/test-process.md';
const TEST_RULE_LINE = 4;

// =============================================================================================
// 1. The manifesto's rule, verbatim, parses into the expected AST
// =============================================================================================

test('Appendix XII goods-receipt rule parses verbatim into the expected AST', () => {
  const { model, errors } = parseOperatingModel(baseFiles());
  assert.deepEqual(errorsOf(errors).map((e) => e.message), []);
  // Nothing in this model cascades, and nothing in it is unsatisfiable. Grammar version 2 adds
  // ONE kind of warning to a version-1 model: the authority-coverage warning FD-7 asks for
  // (§16.2). It is the point of FD-7 that it is visible, so it is asserted rather than tolerated.
  const notCoverage = errors.filter((e) => !/nothing says who may/.test(e.message));
  assert.deepEqual(notCoverage, [], 'the only warnings are the FD-7 coverage warnings');
  assert.equal(errors.length, model.entities.size,
    'exactly one coverage warning per entity — grouped, so 7 entities give 7 lines and not 28');
  for (const e of errors) assert.equal(e.severity, 'warning');

  const rule = ruleOf(model);
  assert.ok(rule, 'the rule was found');
  assert.deepEqual(rule.trigger, { op: 'create', entity: 'goods-receipt' });
  assert.deepEqual(rule.source, { file: PROCESS, line: LINE_RULE });
  assert.deepEqual(rule.authorizedBy, ['warehouse-clerk', 'warehouse-management']);
  assert.deepEqual(rule.authorizedBySource, { file: PROCESS, line: LINE_AUTHORIZED_BY });

  const condition = (c) => {
    if (c.kind === 'compare') return { kind: c.kind, subject: c.subject.text, op: c.op, value: c.value.value, line: c.line };
    if (c.kind === 'exists') return { kind: c.kind, subject: c.subject.text, negated: c.negated, line: c.line };
    return { kind: c.kind, subject: c.subject.text, name: c.name, negated: c.negated, line: c.line };
  };
  assert.deepEqual(rule.conditions.map(condition), [
    { kind: 'compare', subject: 'quantity', op: '>', value: 0, line: LINE_COND_QUANTITY },
    { kind: 'exists', subject: 'order', negated: false, line: LINE_COND_ORDER_EXISTS },
    // "not already fully delivered" resolves against the predicate DECLARED in information/order.md
    { kind: 'predicate', subject: 'order', name: 'already fully delivered', negated: true, line: LINE_COND_NOT_DELIVERED },
  ]);

  const consequent = (c) => ({
    verb: c.verb,
    entity: c.entity,
    clauses: c.clauses.map((cl) => (cl.kind === 'set'
      ? { kind: cl.kind, field: cl.field, value: cl.value.value }
      : { kind: cl.kind, field: cl.field })),
    targeting: c.targeting,
    line: c.line,
  });
  assert.deepEqual(rule.consequents.map(consequent), [
    { verb: 'create', entity: 'goods-receipt-fact', clauses: [], targeting: { kind: 'self-id' }, line: LINE_CONS_FACT },
    {
      verb: 'update', entity: 'stock', clauses: [{ kind: 'add', field: 'quantity' }],
      // WHICH stock document: declared by "## Identified by article and location", not guessed
      targeting: { kind: 'key', fields: ['article', 'location'] }, line: LINE_CONS_STOCK,
    },
    {
      verb: 'update', entity: 'order-line', clauses: [{ kind: 'set', field: 'status', value: 'delivered' }],
      // WHICH order-line: the one the goods receipt references
      targeting: { kind: 'reference', field: 'order-line' }, line: LINE_CONS_ORDER_LINE,
    },
  ]);

  // the business meaning of "fully delivered" lives in the operating model, not in the parser
  const order = model.entities.get('order');
  assert.deepEqual([...order.predicates.keys()], ['fully delivered', 'already fully delivered']);
  assert.equal(order.predicates.get('fully delivered').text, 'delivered-quantity >= ordered-quantity');
});

test('parseRule alone parses the same rule, with absolute line numbers', () => {
  const text = GOODS_RECEIPT_PROCESS.split('\n').slice(10, 18).join('\n');
  const { rule, errors } = parseRule(text, { file: PROCESS, line: LINE_RULE });
  assert.deepEqual(errors, []);
  assert.deepEqual(rule.trigger, { op: 'create', entity: 'goods-receipt' });
  assert.equal(rule.source.line, LINE_RULE);
  assert.equal(rule.conditions.length, 3);
  assert.equal(rule.consequents.length, 3);
});

test('the one-line form from manifesto line 414 parses to the same shape', () => {
  const { rule, errors } = parseRule(
    'If Create goods-receipt under condition quantity > 0 and order exists, '
    + 'then Update stock with +quantity and Update order-line with status "delivered"',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rule.trigger, { op: 'create', entity: 'goods-receipt' });
  assert.equal(rule.conditions.length, 2);
  assert.equal(rule.consequents.length, 2);
});

// =============================================================================================
// 2. Execution: the happy path produces exactly the three consequent changes
// =============================================================================================

test('a valid goods receipt produces the trigger change plus exactly three consequent changes', () => {
  const model = parseOk(baseFiles());
  const world = makeWorld(WORLD_DOCS());
  const result = evaluate(model, receipt(), world);

  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 4, 'the trigger plus the three consequents, all in one commit');

  assert.deepEqual(result.changes.map((c) => [c.op, c.entity, c.id]), [
    ['create', 'goods-receipt', 'GR-0001'],
    ['create', 'goods-receipt-fact', 'GR-0001'],
    ['update', 'stock', 'ST-1'],
    ['update', 'order-line', 'PO-77-1'],
  ]);

  // 0 — the trigger itself
  assert.equal(result.changes[0].before, null);
  assert.deepEqual(result.changes[0].after, {
    id: 'GR-0001', entity: 'goods-receipt', quantity: 12, 'batch-number': 'L-2027-04',
    article: 'cashew-1kg', location: 'berlin-main', order: 'PO-77', 'order-line': 'PO-77-1',
  });

  // 1 — the fact: id derived from the trigger, fields declared on BOTH entities carried over
  assert.deepEqual(result.changes[1].after, {
    id: 'GR-0001', entity: 'goods-receipt-fact', quantity: 12, 'batch-number': 'L-2027-04',
    article: 'cashew-1kg', location: 'berlin-main', order: 'PO-77',
  });

  // 2 — stock, found by its declared business key, counted up
  assert.equal(result.changes[2].before.quantity, 40);
  assert.equal(result.changes[2].after.quantity, 52);

  // 3 — the referenced order line
  assert.equal(result.changes[3].before.status, 'open');
  assert.equal(result.changes[3].after.status, 'delivered');

  // every change carries the shape the contract defines, and nothing else
  for (const c of result.changes) {
    assert.deepEqual(Object.keys(c).sort(), ['after', 'before', 'entity', 'id', 'op']);
  }
});

test('quantity 0 is refused, quoting the condition, the file and the line', () => {
  const model = parseOk(baseFiles());
  const result = evaluate(model, receipt({ quantity: 0 }), makeWorld(WORLD_DOCS()));

  assert.equal(result.ok, false);
  assert.deepEqual(result.changes, [], 'a refusal changes nothing at all');
  assert.equal(result.violations.length, 1);

  const [violation] = result.violations;
  assert.equal(violation.rule.source.file, PROCESS);
  assert.equal(violation.rule.source.line, LINE_RULE);
  assert.equal(violation.file, PROCESS);
  assert.equal(violation.line, LINE_COND_QUANTITY);
  assert.match(violation.reason, /quantity > 0/, 'the broken condition is quoted');
  assert.match(violation.reason, /quantity is 0/, 'and the actual value is named');
  assert.match(violation.reason, new RegExp(`${PROCESS}:${LINE_RULE}`), 'by file and line');
  assert.match(violation.reason, /If Create goods-receipt under condition/, 'the rule itself is quoted');
});

test('a missing order is refused, quoting "order exists"', () => {
  const model = parseOk(baseFiles());
  const result = evaluate(model, receipt({ order: 'PO-999' }), makeWorld(WORLD_DOCS()));

  assert.equal(result.ok, false);
  assert.deepEqual(result.changes, []);
  const reasons = result.violations.map((v) => v.reason).join('\n---\n');
  assert.match(reasons, /order exists/);
  assert.match(reasons, /there is no order with the id "PO-999"/);
  // every broken condition is reported, not only the first one
  assert.equal(result.violations.length, 2);
  assert.match(reasons, /order not already fully delivered/);
});

test('an order that is already fully delivered is refused, naming where that meaning is declared', () => {
  const model = parseOk(baseFiles());
  const result = evaluate(
    model,
    receipt({ order: 'PO-88', 'order-line': 'PO-88-1' }),
    makeWorld(WORLD_DOCS()),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.changes, []);
  assert.equal(result.violations.length, 1);
  const [violation] = result.violations;
  assert.equal(violation.line, LINE_COND_NOT_DELIVERED);
  assert.match(violation.reason, /order not already fully delivered/);
  assert.match(violation.reason, /order "PO-88" is already fully delivered/);
  assert.match(violation.reason, /operating-model\/information\/order\.md:\d+/,
    'the refusal points at the entity file where the predicate is declared');
  assert.match(violation.reason, /delivered-quantity is 100/, 'and explains why it holds');
});

// =============================================================================================
// 3. The manifesto's headline demo (line 475): one word changed, system adapted
// =============================================================================================

test('adding the words "with batch-number" makes a receipt without a batch number fail — and changes nothing else', () => {
  const before = baseFiles();
  const after = baseFiles({
    [PROCESS]: GOODS_RECEIPT_PROCESS.replace(
      '  Create goods-receipt-fact and',
      '  Create goods-receipt-fact with batch-number and',
    ),
  });
  assert.notEqual(before.get(PROCESS), after.get(PROCESS), 'exactly one line differs');

  const modelBefore = parseOk(before);
  const modelAfter = parseOk(after);

  const withoutBatch = receipt({ 'batch-number': undefined });
  delete withoutBatch.doc['batch-number'];

  // before the change: accepted
  const okBefore = evaluate(modelBefore, withoutBatch, makeWorld(WORLD_DOCS()));
  assert.equal(okBefore.ok, true);
  assert.equal(okBefore.changes.length, 4);

  // after the change: refused, from this goods receipt onward
  const refused = evaluate(modelAfter, withoutBatch, makeWorld(WORLD_DOCS()));
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.changes, []);
  assert.equal(refused.violations.length, 1);
  assert.match(refused.violations[0].reason, /batch-number/);
  assert.match(refused.violations[0].reason, /Create goods-receipt-fact with batch-number/);
  assert.equal(refused.violations[0].file, PROCESS);
  assert.equal(refused.violations[0].line, LINE_CONS_FACT);

  // and nothing else in the system changed: a receipt WITH a batch number produces byte-identical
  // changes under the old and the new operating model
  const a = evaluate(modelBefore, receipt(), makeWorld(WORLD_DOCS()));
  const b = evaluate(modelAfter, receipt(), makeWorld(WORLD_DOCS()));
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(b.changes, a.changes);
});

// =============================================================================================
// 4. Principle 6: unknown constructions are refused loudly, never silently dropped
// =============================================================================================

/** @returns {{errors: import('../runtime/polism/parse.js').Diag[], model: any}} */
function parseVariant(files) {
  const { model, errors } = parseOperatingModel(files);
  return { model, errors: errorsOf(errors) };
}

test('Principle 6 — an unknown operator is refused with file, line, text and expectation', () => {
  const { model, errors } = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition quantity ~= 0 then Delete goods-receipt-fact'),
  }));

  const d = errors.find((e) => e.file === TEST_PROCESS);
  assert.ok(d, 'the unknown operator produced a diagnostic');
  assert.equal(d.line, TEST_RULE_LINE);
  assert.match(d.message, /"~="/);
  assert.match(d.message, /not an operator known to grammar version 1/);
  assert.match(d.message, /expected: .*">="/, 'it lists the operators that do exist');
  assert.equal(d.text, 'quantity ~= 0', 'the offending text is reported');
  assert.equal(model.processes.filter((r) => r.source.file === TEST_PROCESS).length, 0,
    'and the rule is NOT silently kept');
});

test('Principle 6 — an unknown consequent verb is refused', () => {
  const { model, errors } = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition quantity > 0 then Archive stock'),
  }));

  const d = errors.find((e) => e.file === TEST_PROCESS);
  assert.ok(d);
  assert.equal(d.line, TEST_RULE_LINE);
  assert.match(d.message, /"Archive" is not something the runtime can do/);
  assert.match(d.message, /"Create <entity>"/);
  assert.match(d.message, /"Delete <entity>"/);
  assert.equal(model.processes.filter((r) => r.source.file === TEST_PROCESS).length, 0);
});

test('Principle 6 — an unknown entity is refused, naming the file that would declare it', () => {
  const { errors } = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create widget under condition quantity > 0 then Delete stock'),
  }));

  const d = errors.find((e) => e.file === TEST_PROCESS);
  assert.ok(d);
  assert.equal(d.line, TEST_RULE_LINE);
  assert.match(d.message, /no such kind of document is declared/);
  assert.match(d.message, /operating-model\/information\/widget\.md/);
});

test('Principle 6 — a malformed "If ... then" is refused', () => {
  const { model, errors } = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition quantity > 0'),
  }));

  const d = errors.find((e) => e.file === TEST_PROCESS);
  assert.ok(d);
  assert.equal(d.line, TEST_RULE_LINE);
  assert.match(d.message, /this rule has no "then"/);
  assert.match(d.message, /If <op> <entity> under condition/);
  assert.equal(model.processes.filter((r) => r.source.file === TEST_PROCESS).length, 0);

  // and the sibling malformations
  const noIf = parseRule('Create goods-receipt then Update stock with +quantity');
  assert.equal(noIf.rule, null);
  assert.match(noIf.errors[0].message, /must start with "If"/);

  const noConsequent = parseRule('If Create goods-receipt under condition quantity > 0 then');
  assert.equal(noConsequent.rule, null);
  assert.match(noConsequent.errors[0].message, /"then" is followed by nothing/);

  const badOp = parseRule('If Post goods-receipt then Delete stock');
  assert.equal(badOp.rule, null);
  assert.match(badOp.errors[0].message, /not one of the four operations/);
});

test('Principle 6 — a rule referring to an undeclared field is refused, listing the declared ones', () => {
  const { errors } = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition colour > 0 then Delete stock'),
  }));

  const d = errors.find((e) => e.file === TEST_PROCESS);
  assert.ok(d);
  assert.equal(d.line, TEST_RULE_LINE);
  assert.match(d.message, /"colour" is not a field of "goods-receipt"/);
  assert.match(d.message, /operating-model\/information\/goods-receipt\.md/);
  assert.match(d.message, /"batch-number"/, 'the fields that do exist are listed');
});

test('Principle 6 — "## Authorized by" naming an unknown role is refused', () => {
  const { errors } = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile(
      'If Create goods-receipt under condition quantity > 0 then Delete stock',
      'wharehouse-clerk',
    ),
  }));

  const d = errors.find((e) => e.file === TEST_PROCESS && /role/.test(e.message));
  assert.ok(d, 'the unknown role produced a diagnostic');
  assert.equal(d.line, 6, 'the line of "## Authorized by"');
  assert.match(d.message, /"wharehouse-clerk"/);
  assert.match(d.message, /Did you mean "warehouse-clerk"\?/);
  assert.match(d.message, /operating-model\/organisation\/wharehouse-clerk\.md/);
});

test('Principle 6 — an unknown section is refused, not read as prose', () => {
  const { errors } = parseVariant(baseFiles({
    [TEST_PROCESS]: '# Test\n\n## Approved by\nwarehouse-clerk\n',
  }));
  const d = errors.find((e) => e.file === TEST_PROCESS);
  assert.ok(d);
  assert.equal(d.line, 3);
  assert.match(d.message, /unknown section "## Approved by"/);
  assert.match(d.message, /Did you mean "authorized by"\?/);
});

test('Principle 6 — the refusals that keep business semantics out of the parser', () => {
  // an undeclared predicate: the parser must not invent what a phrase means
  let e = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition order nearly delivered then Delete stock'),
  })).errors.find((x) => x.file === TEST_PROCESS);
  assert.match(e.message, /"nearly delivered" is not something declared about an order/);
  assert.match(e.message, /"already fully delivered"/, 'the declared predicates are listed');

  // "or" between conditions does not exist in v1
  e = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition quantity > 0 or quantity < 5 then Delete stock'),
  })).errors.find((x) => x.file === TEST_PROCESS);
  assert.match(e.message, /"or" between conditions does not exist in grammar version 1/);

  // "and" in "## Authorized by" (four-eyes) does not exist in v1 and is not silently read as "or"
  e = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile(
      'If Create goods-receipt under condition quantity > 0 then Delete stock',
      'warehouse-clerk and warehouse-management',
    ),
  })).errors.find((x) => x.file === TEST_PROCESS);
  assert.match(e.message, /"and" in "## Authorized by" does not exist in grammar version 1/);

  // an unquoted text value would be read as a field name, so it is refused as such
  e = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition order.status is delivered then Delete stock'),
  })).errors.find((x) => x.file === TEST_PROCESS);
  assert.match(e.message, /"delivered" is not a field of "goods-receipt"/);

  // ">" on a text field
  e = parseVariant(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition batch-number > 3 then Delete stock'),
  })).errors.find((x) => x.file === TEST_PROCESS);
  assert.match(e.message, /">" has no meaning for "batch-number", which is declared as text/);

  // a consequent whose target document cannot be determined from the model
  e = parseVariant(baseFiles({
    'operating-model/information/stock.md': `# Stock\n\n## Fields\n- article: reference to article\n- quantity: number\n`,
  })).errors.find((x) => x.file === PROCESS);
  assert.match(e.message, /it is not determined which "stock" document/);
  assert.match(e.message, /## Identified by/);

  // an unknown field type
  e = parseVariant(baseFiles({
    'operating-model/information/article.md': '# Article\n\n## Fields\n- name: string\n',
  })).errors.find((x) => x.file === 'operating-model/information/article.md');
  assert.match(e.message, /"string" is not a field type known to grammar version 1/);
  assert.match(e.message, /Did you mean "text"\?/);
});

// =============================================================================================
// 5. Authorization is a rule constraint, not workflow code (manifesto lines 114, 471)
// =============================================================================================

test('an actor without the required role is refused even though every condition holds', () => {
  const model = parseOk(baseFiles());
  const world = makeWorld(WORLD_DOCS());

  const allowed = evaluate(model, { ...receipt(), actorRoles: ['warehouse-management'] }, world);
  assert.equal(allowed.ok, true, 'the second role in "warehouse-clerk or warehouse-management" works');

  const refused = evaluate(model, { ...receipt(), actorRoles: ['accountant'] }, world);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.changes, []);
  assert.equal(refused.violations.length, 1, 'no condition failed — only the authorization');
  assert.match(refused.violations[0].reason, /may not create a goods-receipt/);
  assert.match(refused.violations[0].reason, /## Authorized by/);
  assert.match(refused.violations[0].reason, /warehouse-clerk or warehouse-management/);
  assert.equal(refused.violations[0].file, PROCESS);
  assert.equal(refused.violations[0].line, LINE_AUTHORIZED_BY);

  const noRole = evaluate(model, { ...receipt(), actorRoles: [] }, world);
  assert.equal(noRole.ok, false);
  assert.match(noRole.violations[0].reason, /someone with no role/);
});

// =============================================================================================
// 6. Determinism (contract non-negotiable #5)
// =============================================================================================

test('same model + same intent + same world = identical Changes, 100 times', () => {
  const model = parseOk(baseFiles());
  const docs = WORLD_DOCS();
  const world = makeWorld(docs);
  const worldBefore = JSON.stringify(docs);

  const first = JSON.stringify(evaluate(model, receipt(), world).changes);
  for (let i = 0; i < 100; i++) {
    const again = evaluate(model, receipt(), world);
    assert.equal(again.ok, true);
    assert.equal(JSON.stringify(again.changes), first, `run ${i} differed`);
  }
  assert.equal(JSON.stringify(docs), worldBefore, 'evaluate() never mutates the world it reads');

  // a rebuilt model from the same text yields the same result, too
  const model2 = parseOk(baseFiles());
  assert.equal(JSON.stringify(evaluate(model2, receipt(), makeWorld(WORLD_DOCS())).changes), first);

  // and so does a refusal
  const r1 = evaluate(model, receipt({ quantity: 0 }), world);
  const r2 = evaluate(model2, receipt({ quantity: 0 }), makeWorld(WORLD_DOCS()));
  assert.equal(r1.violations[0].reason, r2.violations[0].reason);
});

// =============================================================================================
// 7. The four documented semantic decisions (grammar.md §5.1, §5.3, §7, §8)
// =============================================================================================

test('+field on a stock document that does not exist yet: created on demand, because the model says so', () => {
  const docs = WORLD_DOCS().filter((d) => d.entity !== 'stock');
  const model = parseOk(baseFiles());
  const result = evaluate(model, receipt(), makeWorld(docs));

  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 4);
  const stock = result.changes[2];
  assert.equal(stock.op, 'create');
  assert.equal(stock.id, 'cashew-1kg-berlin-main', 'the id is derived from the declared business key');
  assert.deepEqual(stock.after, {
    id: 'cashew-1kg-berlin-main', entity: 'stock',
    article: 'cashew-1kg', location: 'berlin-main', quantity: 12,
  });
});

test('+field on a missing document is refused when the model does not allow creating it on demand', () => {
  const model = parseOk(baseFiles({
    'operating-model/information/stock.md': `# Stock

## Fields
- article: reference to article
- location: reference to location
- quantity: number

## Identified by
article and location

## Created on demand
no
`,
  }));
  const result = evaluate(model, receipt(), makeWorld(WORLD_DOCS().filter((d) => d.entity !== 'stock')));

  assert.equal(result.ok, false);
  assert.deepEqual(result.changes, []);
  assert.match(result.violations[0].reason, /there is no stock for article "cashew-1kg" and location "berlin-main"/);
  assert.match(result.violations[0].reason, /## Created on demand/);
  assert.match(result.violations[0].reason, /operating-model\/information\/stock\.md/);
});

test('two rules triggering on the same operation: both apply, in file-then-line order', () => {
  const second = 'operating-model/processes/goods-receipt-audit.md';
  const model = parseOk(baseFiles({
    [second]: processFile('If Create goods-receipt then Update order with status "receiving"'),
  }));

  assert.deepEqual(model.processes.map((r) => r.source.file), [second, PROCESS],
    'rules are ordered by file path, then line — "goods-receipt-audit.md" sorts before "goods-receipt.md"');

  const result = evaluate(model, receipt(), makeWorld(WORLD_DOCS()));
  assert.equal(result.ok, true);
  assert.deepEqual(result.changes.map((c) => [c.op, c.entity, c.id]), [
    ['create', 'goods-receipt', 'GR-0001'],
    ['update', 'order', 'PO-77'],
    ['create', 'goods-receipt-fact', 'GR-0001'],
    ['update', 'stock', 'ST-1'],
    ['update', 'order-line', 'PO-77-1'],
  ]);
  assert.equal(result.changes[1].after.status, 'receiving');
  assert.deepEqual(result.appliedRules.map((r) => r.source.file), [second, PROCESS]);
});

test('two rules setting the same field to different values is a refusal, not last-writer-wins', () => {
  const model = parseOk(baseFiles({
    'operating-model/processes/a-other.md': processFile('If Create goods-receipt then Update order-line with status "checked"'),
  }));
  const result = evaluate(model, receipt(), makeWorld(WORLD_DOCS()));
  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /two rules disagree about order-line "PO-77-1"/);
  assert.match(result.violations[0].reason, /does not pick one/);
});

test('a consequent that matches another rule\'s trigger is reported as a warning, not silently ignored', () => {
  const { errors } = parseOperatingModel(baseFiles({
    'operating-model/processes/order-line-close.md': processFile(
      'If Update order-line under condition status is "delivered" then Update order with status "closed"',
    ),
  }));
  assert.deepEqual(errorsOf(errors), [], 'both rules are valid');
  const w = errors.find((e) => e.severity === 'warning' && /matches the trigger of the rule/.test(e.message));
  assert.ok(w, 'the non-cascade is stated out loud');
  assert.equal(w.file, PROCESS);
  assert.equal(w.line, LINE_CONS_ORDER_LINE);
  assert.match(w.message, /matches the trigger of the rule at operating-model\/processes\/order-line-close\.md:4/);
  assert.match(w.message, /consequences do not trigger further rules in grammar version 1/);
});

// =============================================================================================
// 8. Assorted execution semantics that the kernel depends on
// =============================================================================================

test('an operation on an entity the company has not described is refused', () => {
  const model = parseOk(baseFiles());
  const result = evaluate(model, { op: 'create', entity: 'widget', id: 'W-1', doc: {}, actorRoles: [] },
    makeWorld(WORLD_DOCS()));
  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /"widget" is not a kind of document this company has described/);
});

test('an operation no rule governs is allowed and produces only its own change', () => {
  const model = parseOk(baseFiles());
  const result = evaluate(model, {
    op: 'create', entity: 'article', id: 'almond-1kg', doc: { name: 'Almonds 1kg' }, actorRoles: [],
  }, makeWorld(WORLD_DOCS()));
  assert.equal(result.ok, true);
  assert.equal(result.changes.length, 1);
  assert.deepEqual(result.appliedRules, []);
});

test('a field declared "required" must be filled in, quoting the entity file', () => {
  const model = parseOk(baseFiles());
  const withoutQuantity = receipt();
  delete withoutQuantity.doc.quantity;
  const result = evaluate(model, withoutQuantity, makeWorld(WORLD_DOCS()));
  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /"quantity" must be filled in on every goods-receipt/);
  assert.match(result.violations[0].reason, /operating-model\/information\/goods-receipt\.md:6/);
});

test('creating a goods receipt whose id already exists is refused', () => {
  const model = parseOk(baseFiles());
  const world = makeWorld([...WORLD_DOCS(), { id: 'GR-0001', entity: 'goods-receipt', quantity: 1 }]);
  const result = evaluate(model, receipt(), world);
  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /already exists/);
});

test('an ambiguous business key is a refusal, not a coin flip', () => {
  const model = parseOk(baseFiles());
  const world = makeWorld([...WORLD_DOCS(),
    { id: 'ST-2', entity: 'stock', article: 'cashew-1kg', location: 'berlin-main', quantity: 5 }]);
  const result = evaluate(model, receipt(), world);
  assert.equal(result.ok, false);
  assert.match(result.violations[0].reason, /there are 2 stock documents/);
  assert.match(result.violations[0].reason, /"ST-1", "ST-2"/);
  assert.match(result.violations[0].reason, /does not pick one/);
});

test('a heading inside "## Rules" is refused with one precise diagnostic, not read as prose', () => {
  // grammar.md §1: "###" is prose everywhere EXCEPT inside "## Rules", where every line is enforced.
  const { model, errors } = parseOperatingModel(baseFiles({
    [TEST_PROCESS]: `# Test process

## Rules
### Small receipts
If Create goods-receipt under condition quantity > 0 then Delete stock

## Authorized by
warehouse-clerk
`,
  }));

  const d = errorsOf(errors).find((e) => e.file === TEST_PROCESS);
  assert.ok(d, 'the heading is refused');
  assert.equal(d.line, 4);
  assert.match(d.message, /"### Small receipts" is a heading inside "## Rules", where only rules may appear/);
  assert.match(d.message, /"## Notes"/, 'and the message says where the explanation belongs');
  assert.equal(errorsOf(errors).length, 1, 'exactly one diagnostic: the rule around it still parses');
  assert.equal(model.processes.filter((r) => r.source.file === TEST_PROCESS).length, 1);

  // a commentary line that is not a heading gets the same signpost
  const prose = parseOperatingModel(baseFiles({
    [TEST_PROCESS]: processFile('This rule exists because auditors ask for it.\n\nIf Create goods-receipt then Delete stock'),
  }));
  const p = errorsOf(prose.errors).find((e) => e.file === TEST_PROCESS);
  assert.match(p.message, /a rule must start with "If"/);
  assert.match(p.message, /"## Notes"/);
});

test('two files authorizing one operation with disjoint roles is warned about, loudly (§10.14)', () => {
  // The threshold-approval shape: it parses, it reads correct, and it refuses every instance.
  const HIGH = 'operating-model/processes/goods-receipt-large.md';
  const files = baseFiles({
    [HIGH]: `# Large goods receipts

## Rules
If Create goods-receipt under condition quantity > 1000 then Update order with status "checked"

## Authorized by
warehouse-management
`,
  });
  // make the two role sets disjoint
  files.set(PROCESS, GOODS_RECEIPT_PROCESS.replace(
    'warehouse-clerk or warehouse-management', 'warehouse-clerk',
  ));

  const { model, errors } = parseOperatingModel(files);
  assert.deepEqual(errorsOf(errors), [], 'nothing is syntactically wrong — that is the whole problem');

  const w = errors.find((e) => e.severity === 'warning' && /nothing in common/.test(e.message));
  assert.ok(w, 'the dead operation is named at parse time');
  assert.match(w.message, /both apply to "Create goods-receipt"/);
  assert.match(w.message, /"warehouse-management"/);
  assert.match(w.message, /"warehouse-clerk"/);
  assert.match(w.message, /will be refused, whoever attempts it/);
  assert.match(w.message, /grammar\.md §10\.14/);

  // and the warning tells the truth: both actors are in fact refused
  const world = makeWorld(WORLD_DOCS());
  for (const role of ['warehouse-clerk', 'warehouse-management']) {
    const r = evaluate(model, { ...receipt({ quantity: 2000 }), actorRoles: [role] }, world);
    assert.equal(r.ok, false, `${role} is refused too`);
    assert.match(r.violations.map((v) => v.reason).join('\n'), /may not create a goods-receipt/);
  }

  // sharing one role removes the contradiction, and no warning is emitted
  files.set(PROCESS, GOODS_RECEIPT_PROCESS);
  const shared = parseOperatingModel(files);
  assert.equal(shared.errors.filter((e) => /nothing in common/.test(e.message)).length, 0);
  const okResult = evaluate(shared.model, { ...receipt({ quantity: 2000 }), actorRoles: ['warehouse-management'] }, world);
  assert.equal(okResult.ok, true);
});

test('the threshold-approval shape — two rules with mutually exclusive conditions — is warned about (§10.14)', () => {
  // This is the trap agent F documented in processes/discount-posting.md: it parses, it reads
  // correct, and it refuses every instance. Exactly the shape of every value threshold.
  const HIGH = 'operating-model/processes/goods-receipt-large.md';
  const model0 = parseOperatingModel(baseFiles({
    [HIGH]: processFile('If Create goods-receipt under condition quantity > 1000 then Update order with status "checked"'),
    [PROCESS]: GOODS_RECEIPT_PROCESS.replace('  quantity > 0 and', '  quantity <= 1000 and'),
  }));
  assert.deepEqual(errorsOf(model0.errors), [], 'nothing is syntactically wrong — that is the whole problem');

  const w = model0.errors.find((e) => e.severity === 'warning' && /cannot both be true/.test(e.message));
  assert.ok(w, 'the dead process is named at parse time');
  assert.match(w.message, /both apply to "Create goods-receipt"/);
  assert.match(w.message, /"quantity <= 1000"/);
  assert.match(w.message, /"quantity > 1000"/);
  assert.match(w.message, /will be refused/);
  assert.match(w.message, /grammar\.md §10\.14/);

  // and the warning tells the truth: no quantity whatsoever gets through
  const world = makeWorld(WORLD_DOCS());
  for (const quantity of [12, 2000]) {
    const r = evaluate(model0.model, receipt({ quantity }), world);
    assert.equal(r.ok, false, `quantity ${quantity} is refused too`);
  }

  // a single rule that contradicts itself is named as well
  const selfContra = parseOperatingModel(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition quantity > 10 and quantity < 5 then Delete stock'),
  }));
  const s = selfContra.errors.find((e) => e.severity === 'warning' && /can never be satisfied/.test(e.message));
  assert.ok(s);
  assert.equal(s.file, TEST_PROCESS);

  // and the detector never cries wolf on overlapping ranges or unrelated fields
  for (const [x, y] of [
    ['quantity >= 5 and quantity <= 10', 'quantity > 7'],
    ['quantity > 0', 'batch-number is "L-1"'],
    ['order.status is "open"', 'order.status is not "closed"'],
  ]) {
    const clean = parseOperatingModel(baseFiles({
      [TEST_PROCESS]: processFile(`If Create goods-receipt under condition ${x} then Delete stock`),
      'operating-model/processes/zz-other.md': processFile(`If Create goods-receipt under condition ${y} then Delete order`),
    }));
    assert.deepEqual(errorsOf(clean.errors), []);
    assert.equal(clean.errors.filter((e) => /cannot both be true|can never be satisfied/.test(e.message)).length, 0,
      `"${x}" versus "${y}" is satisfiable and must not be flagged`);
  }
});

test('rule coverage is an authorization boundary in v0.1 — documented, not hidden (§8)', () => {
  // An entity no rule governs is open to an actor with no role at all. This locks in the CURRENT
  // behaviour so that the v0.2 change (entity-level "## Authorized by") is a visible decision.
  const model = parseOk(baseFiles());
  const r = evaluate(model, {
    op: 'delete', entity: 'article', id: 'cashew-1kg', doc: {}, actorRoles: [],
  }, makeWorld(WORLD_DOCS()));
  assert.equal(r.ok, true, 'no rule governs Delete article, so nothing refuses it');
  assert.deepEqual(r.appliedRules, []);
  assert.deepEqual(r.changes.map((c) => [c.op, c.entity, c.id]), [['delete', 'article', 'cashew-1kg']]);
});

test('a rule on Read enforces authorization and produces no change for the read itself', () => {
  const model = parseOk(baseFiles({
    [TEST_PROCESS]: processFile('If Read order then Update order with status "seen"', 'accountant'),
  }));
  const world = makeWorld(WORLD_DOCS());
  const intent = { op: 'read', entity: 'order', id: 'PO-77', doc: {}, actorRoles: ['accountant'] };

  const allowed = evaluate(model, intent, world);
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.changes.map((c) => [c.op, c.entity, c.id]), [['update', 'order', 'PO-77']],
    'reading changes nothing by itself; only the consequent is a change');

  const refused = evaluate(model, { ...intent, actorRoles: ['warehouse-clerk'] }, world);
  assert.equal(refused.ok, false);
  assert.match(refused.violations[0].reason, /may not read an order/);
});

test('the missing 1% is refused by name, not silently accepted (grammar.md §10, §20)', () => {
  const cases = [
    // Still missing in grammar version 2, and still refused BY NAME rather than misread.
    ['order.customer.country is "DE"', /goes through 2 references. Grammar version 1 follows one reference only/],
    ['average of quantity over order-line > 3', /"average of …" is not one of the two ways grammar version 2 reads other documents/],
    ['total of quantity over order-line > 3', /"total of …" is not one of the two ways/],
    ['for each order-line quantity > 0', /a condition over many documents at once — does not exist in this grammar/],
    // §20.1: an aggregate's `where` cannot see the document it is written on.
    ['count of order-line where order is this > 0', /is not how an aggregate refers to the document it is written on/],
    // §20.8: one `where` condition. The rule's own `and` keeps its version-1 meaning, so it splits
    // the sentence and the leftover total is refused — with the cause named, not just the symptom.
    ['count of order-line where status is "open" and status is not "x" > 0',
      /is a total with nothing said about it/],
  ];
  for (const [condition, pattern] of cases) {
    const { errors } = parseVariant(baseFiles({
      [TEST_PROCESS]: processFile(`If Create goods-receipt under condition ${condition} then Delete stock`),
    }));
    const d = errors.find((e) => e.file === TEST_PROCESS);
    assert.ok(d, `"${condition}" must be refused`);
    assert.match(d.message, pattern);
  }
});

test('field-to-field comparison, one-hop paths and self-targeting updates work', () => {
  const model = parseOk(baseFiles({
    [TEST_PROCESS]: processFile(
      'If Update order under condition delivered-quantity >= ordered-quantity then Update order with status "closed"',
    ),
  }));
  const world = makeWorld(WORLD_DOCS());

  const closes = evaluate(model, {
    op: 'update', entity: 'order', id: 'PO-77', doc: { 'delivered-quantity': 100 }, actorRoles: ['warehouse-clerk'],
  }, world);
  assert.deepEqual(closes.violations, []);
  assert.equal(closes.changes.length, 1, 'the consequent targets the trigger document itself');
  assert.equal(closes.changes[0].after.status, 'closed');
  assert.equal(closes.changes[0].after['delivered-quantity'], 100);
  assert.equal(closes.changes[0].before['delivered-quantity'], 0);

  const staysOpen = evaluate(model, {
    op: 'update', entity: 'order', id: 'PO-77', doc: { 'delivered-quantity': 30 }, actorRoles: ['warehouse-clerk'],
  }, world);
  assert.equal(staysOpen.ok, false);
  assert.match(staysOpen.violations[0].reason, /delivered-quantity is 30, not at least ordered-quantity \(100\)/);

  // one-hop path through a reference
  const hop = parseOk(baseFiles({
    [TEST_PROCESS]: processFile(
      'If Create goods-receipt under condition order.status is "blocked" then Delete goods-receipt',
    ),
  }));
  const hopResult = evaluate(hop, receipt(), world);
  assert.equal(hopResult.ok, false);
  assert.match(hopResult.violations[0].reason, /order\.status is "open", not equal to "blocked"/);
});

// =============================================================================================
// PART II — grammar version 2 (FD-5, FD-1, FD-7). runtime/polism/grammar.md §12-§20.
//
// Every test above this line is a grammar-version-1 test and still passes unchanged. That is the
// additive-only promise of §0, and the last test in this file checks it against the real
// operating-model/ and templates/ trees as well.
// =============================================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A double-entry ledger, modelled in POLISM (FD-4: modelled, not built in). This is the fixture
 * for §12 (invariants), §13 (aggregation), §18 (periods) and §19 (money). Agent F2 owns the real
 * one in operating-model/; this one is inline so these tests never depend on work in flight.
 */
function ledgerFiles(overrides = {}) {
  const files = new Map([
    ['operating-model/information/journal-entry.md', `# Journal entry

One business event, as the ledger records it. Its postings balance as a SET.

## Fields
- entry-date: date required
- narrative: text
- status: one of draft, posted, cancelled required
- corrects: reference to journal-entry

## Invariants
- balanced: sum of debit over posting for this journal-entry = sum of credit over posting for this journal-entry

## Dated in
- entry-date in accounting-period
`],

    ['operating-model/information/posting.md', `# Posting

One line of a journal entry: an account, and an amount on one side.

## Fields
- journal-entry: reference to journal-entry required
- account: reference to ledger-account required
- debit: money
- credit: money
`],

    ['operating-model/information/ledger-account.md', `# Ledger account

## Fields
- number: text
- name: text
- balance: money

## Authorized by
- create: accountant
- read: accountant or controller
- update: accountant
- delete: controller
`],

    ['operating-model/information/accounting-period.md', `# Accounting period

A month. Closing one is a business act with an author, a signature and an audit trail, which is
why it is a document and not a line in a configuration file (grammar.md §18.1).

## Fields
- starts-on: date required
- ends-on: date required
- status: one of open, locked required

## Period
- from: starts-on
- to: ends-on
- locked when: status is "locked"

## Authorized by
- create: controller
- read: accountant or controller
- update: controller
- delete: controller
`],

    ['operating-model/organisation/accountant.md', '# Accountant\n\nBooks entries.\n'],
    ['operating-model/organisation/controller.md', '# Controller\n\nCloses the month.\n'],
    ['operating-model/organisation/managing-director.md', '# Managing director\n'],
  ]);
  for (const [k, value] of Object.entries(overrides)) {
    if (value === null) files.delete(k);
    else files.set(k, value);
  }
  return files;
}

const LEDGER_WORLD = () => [
  { id: '2027-03', entity: 'accounting-period', 'starts-on': '2027-03-01', 'ends-on': '2027-03-31', status: 'locked' },
  { id: '2027-04', entity: 'accounting-period', 'starts-on': '2027-04-01', 'ends-on': '2027-04-30', status: 'open' },
  { id: '1200', entity: 'ledger-account', number: '1200', name: 'Bank', balance: '0.00 EUR' },
  { id: '4400', entity: 'ledger-account', number: '4400', name: 'Revenue', balance: '0.00 EUR' },
  { id: 'JE-0001', entity: 'journal-entry', 'entry-date': '2027-04-03', status: 'posted', narrative: 'Sale' },
  { id: 'JE-0001-1', entity: 'posting', 'journal-entry': 'JE-0001', account: '1200', debit: '119.00 EUR' },
  { id: 'JE-0001-2', entity: 'posting', 'journal-entry': 'JE-0001', account: '4400', credit: '119.00 EUR' },
];

/** Everything except the coverage warnings, which FD-7 makes deliberately loud (§16.2). */
const substantive = (errors) => errors.filter((e) => !/nothing says who may/.test(e.message));
const coverage = (errors) => errors.filter((e) => /nothing says who may/.test(e.message));

function parseLedger(overrides = {}) {
  const { model, errors } = parseOperatingModel(ledgerFiles(overrides));
  assert.deepEqual(errorsOf(errors).map((e) => e.message), [], 'the ledger fixture must parse');
  return { model, errors };
}

// ---------------------------------------------------------------------------------------------
// §12 Invariants — how "debits equal credits" becomes structural
// ---------------------------------------------------------------------------------------------

test('§12 an unbalanced journal entry is refused, quoting the invariant by name, file and line', () => {
  const { model } = parseLedger();
  // One posting too many on the debit side: the entry no longer balances.
  const r = evaluate(model, {
    op: 'create',
    entity: 'posting',
    id: 'JE-0001-3',
    doc: { 'journal-entry': 'JE-0001', account: '1200', debit: '1.00 EUR' },
    actorRoles: ['accountant'],
  }, makeWorld(LEDGER_WORLD()));

  assert.equal(r.ok, false);
  assert.deepEqual(r.changes, [], 'a refused commit writes nothing at all');
  assert.equal(r.violations.length, 1);
  const [v] = r.violations;
  assert.match(v.reason, /journal-entry "JE-0001" would not be balanced/);
  assert.match(v.reason, /sum of debit over posting for this journal-entry is "120\.00 EUR"/,
    'the actual total, exact, with its currency');
  assert.match(v.reason, /sum of credit over posting for this journal-entry \("119\.00 EUR"\)/);
  assert.match(v.reason, /- balanced: sum of debit over posting for this journal-entry = sum of credit/,
    'the invariant is quoted verbatim');
  assert.equal(v.file, 'operating-model/information/journal-entry.md');
  assert.equal(v.line, 12, 'the line the invariant is declared on');
});

test('§12 an invariant is checked on the entry a CHANGED POSTING implicates, not only on what changed', () => {
  // The commit touches a posting. Nothing touches the journal entry. The entry's invariant is
  // still checked, because the implication graph is read off the invariant at parse time (§12.1).
  const { model } = parseLedger();
  const changed = evaluate(model, {
    op: 'update',
    entity: 'posting',
    id: 'JE-0001-1',
    doc: { debit: '200.00 EUR' },
    actorRoles: ['accountant'],
  }, makeWorld(LEDGER_WORLD()));
  assert.equal(changed.ok, false);
  assert.match(changed.violations[0].reason, /journal-entry "JE-0001" would not be balanced/);
  assert.match(changed.violations[0].reason, /"200\.00 EUR"/);

  // Deleting one posting unbalances it too — and the entry is implicated through `before`.
  const deleted = evaluate(model, {
    op: 'delete', entity: 'posting', id: 'JE-0001-2', doc: {}, actorRoles: ['accountant'],
  }, makeWorld(LEDGER_WORLD()));
  assert.equal(deleted.ok, false);
  assert.match(deleted.violations[0].reason, /would not be balanced/);
});

test('§12 a SET of postings that balances only in aggregate commits, in one commit', () => {
  // This is the case per-document invariants cannot express and the reason §12.1 is per-commit:
  // no single posting balances, and the set only exists inside this one atomic commit.
  const { model } = parseLedger();
  // The grammar has no "create three postings with different amounts" — that would be a loop, and
  // there are no loops here. So the set is assembled the way a real ledger assembles it: the
  // postings already written, plus the one this commit adds. Only the SET balances; no member of
  // it does. That is precisely what a per-document invariant cannot say (§12.1).
  const world = makeWorld([
    ...LEDGER_WORLD().filter((d) => !String(d.id).startsWith('JE-0001')),
    { id: 'JE-0002', entity: 'journal-entry', 'entry-date': '2027-04-04', status: 'draft' },
    { id: 'JE-0002-1', entity: 'posting', 'journal-entry': 'JE-0002', account: '1200', debit: '100.00 EUR' },
    { id: 'JE-0002-2', entity: 'posting', 'journal-entry': 'JE-0002', account: '4400', credit: '60.00 EUR' },
  ]);
  // 100 debit vs 60 credit: the third posting completes the set, and only the set balances.
  const completes = evaluate(model, {
    op: 'create',
    entity: 'posting',
    id: 'JE-0002-3',
    doc: { 'journal-entry': 'JE-0002', account: '4400', credit: '40.00 EUR' },
    actorRoles: ['accountant'],
  }, world);
  assert.deepEqual(completes.violations, []);
  assert.equal(completes.ok, true, '60 + 40 = 100 as a set, so the commit stands');
  assert.deepEqual(completes.changes.map((c) => [c.op, c.entity, c.id]), [['create', 'posting', 'JE-0002-3']]);

  // 39.99 does not complete it, and the refusal names the exact shortfall.
  const short = evaluate(model, {
    op: 'create',
    entity: 'posting',
    id: 'JE-0002-3',
    doc: { 'journal-entry': 'JE-0002', account: '4400', credit: '39.99 EUR' },
    actorRoles: ['accountant'],
  }, world);
  assert.equal(short.ok, false);
  assert.match(short.violations[0].reason, /is "100\.00 EUR", not equal to .*\("99\.99 EUR"\)/);
});

test('§12 an invariant broken by a CONSEQUENT is caught — the staged world includes consequences', () => {
  // The intent is innocent; the rule's consequent is what breaks the invariant. §12.1 evaluates
  // invariants over the staged world, so the consequence is visible and the commit is refused.
  const { model } = parseLedger({
    'operating-model/information/journal-entry.md': `# Journal entry

## Fields
- entry-date: date required
- status: one of draft, posted, cancelled required
- reversal: reference to posting

## Invariants
- balanced: sum of debit over posting for this journal-entry = sum of credit over posting for this journal-entry
`,
    'operating-model/processes/void-a-line.md': `# Void a line

## Rules
If Update journal-entry under condition status is "cancelled" then
  Update posting with credit "0.00 EUR"

## Authorized by
accountant
`,
  });
  const world = makeWorld([
    ...LEDGER_WORLD().filter((d) => d.id !== 'JE-0001-2'),
    // exactly one posting references the entry, so the consequent's target is determined
    { id: 'JE-0001-2', entity: 'posting', 'journal-entry': 'JE-0001', account: '4400', credit: '119.00 EUR' },
  ]);
  const r = evaluate(model, {
    op: 'update',
    entity: 'journal-entry',
    id: 'JE-0001',
    doc: { status: 'cancelled', reversal: 'JE-0001-2' },
    actorRoles: ['accountant'],
  }, world);
  assert.equal(r.ok, false, 'the consequent zeroes the credit, so debits no longer equal credits');
  assert.deepEqual(r.changes, []);
  assert.match(r.violations.map((x) => x.reason).join('\n'), /would not be balanced/);
  assert.match(r.violations.map((x) => x.reason).join('\n'), /"0\.00 EUR"/);
});

test('§12 a balanced entry commits, and an untouched entry is never re-validated (§12.1, §20.3)', () => {
  const { model } = parseLedger();
  const docs = [
    ...LEDGER_WORLD(),
    // A pre-existing violation somebody else introduced. It must not refuse OUR commit: an
    // invariant is a guard on change, not a global consistency sweep.
    { id: 'JE-9999', entity: 'journal-entry', 'entry-date': '2027-04-09', status: 'posted' },
    { id: 'JE-9999-1', entity: 'posting', 'journal-entry': 'JE-9999', account: '1200', debit: '5.00 EUR' },
  ];
  const r = evaluate(model, {
    op: 'update', entity: 'ledger-account', id: '1200', doc: { name: 'Bank account' }, actorRoles: ['accountant'],
  }, makeWorld(docs));
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true, 'JE-9999 is broken and untouched, so it is not this commit\'s problem');
});

test('§12 an invariant may not aggregate over its own entity, and says why', () => {
  const { errors } = parseOperatingModel(ledgerFiles({
    'operating-model/information/journal-entry.md': `# Journal entry

## Fields
- entry-date: date required
- status: one of draft, posted required

## Invariants
- silly: count of journal-entry for this journal-entry > 0
`,
  }));
  const d = errorsOf(errors).find((e) => /for this journal-entry/.test(e.message));
  assert.ok(d, 'refused, not resolved into something meaningless');
  assert.match(d.message, /would ask a journal-entry to point at itself/);
});

// ---------------------------------------------------------------------------------------------
// §13 Aggregation
// ---------------------------------------------------------------------------------------------

test('§13 a trial balance over 600 postings is exact, and both sides agree', () => {
  const { model } = parseLedger({
    'operating-model/information/trial-balance.md': `# Trial balance

## Fields
- as-at: date required

## Invariants
- in balance: sum of debit over posting = sum of credit over posting
`,
  });
  // 300 pairs. 0.01 EUR steps, which is exactly where a float loses: 300 additions of values a
  // double cannot hold gives a total a double cannot hold either.
  const docs = [
    { id: 'TB-1', entity: 'trial-balance', 'as-at': '2027-04-30' },
    { id: '1200', entity: 'ledger-account', number: '1200', name: 'Bank', balance: '0.00 EUR' },
    { id: 'JE-1', entity: 'journal-entry', 'entry-date': '2027-04-05', status: 'posted' },
  ];
  let expectedMinor = 0n;
  for (let i = 1; i <= 300; i++) {
    const cents = BigInt(i) * 7n + 1n; // 0.08, 0.15, 0.22 … nothing a float likes
    expectedMinor += cents;
    const amount = `${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, '0')} EUR`;
    docs.push({ id: `P-D-${String(i).padStart(4, '0')}`, entity: 'posting', 'journal-entry': 'JE-1', account: '1200', debit: amount });
    docs.push({ id: `P-C-${String(i).padStart(4, '0')}`, entity: 'posting', 'journal-entry': 'JE-1', account: '1200', credit: amount });
  }
  const world = makeWorld(docs);

  const r = evaluate(model, {
    op: 'update', entity: 'trial-balance', id: 'TB-1', doc: { 'as-at': '2027-04-30' }, actorRoles: [],
  }, world);
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true, '600 postings, and the two sides are exactly equal');

  // Now break it by one cent and check the refusal names the exact totals.
  docs.push({ id: 'P-D-9999', entity: 'posting', 'journal-entry': 'JE-1', account: '1200', debit: '0.01 EUR' });
  const off = evaluate(model, {
    op: 'update', entity: 'trial-balance', id: 'TB-1', doc: { 'as-at': '2027-04-30' }, actorRoles: [],
  }, makeWorld(docs));
  assert.equal(off.ok, false, 'one cent out of 600 postings is still out');
  const total = (m) => `${(m / 100n).toString()}.${(m % 100n).toString().padStart(2, '0')} EUR`;
  assert.match(off.violations[0].reason, new RegExp(`"${total(expectedMinor + 1n).replace('.', '\\.')}"`));
  assert.match(off.violations[0].reason, new RegExp(`"${total(expectedMinor).replace('.', '\\.')}"`));
});

test('§13 an empty set is zero, never NaN, never a refusal', () => {
  const { model } = parseLedger({
    'operating-model/information/journal-entry.md': `# Journal entry

## Fields
- entry-date: date required
- status: one of draft, posted required

## Invariants
- balanced: sum of debit over posting for this journal-entry = sum of credit over posting for this journal-entry
- nothing yet: count of posting for this journal-entry = 0
`,
  });
  const r = evaluate(model, {
    op: 'create',
    entity: 'journal-entry',
    id: 'JE-EMPTY',
    doc: { 'entry-date': '2027-04-07', status: 'draft' },
    actorRoles: [],
  }, makeWorld(LEDGER_WORLD()));
  assert.deepEqual(r.violations, [], 'zero equals zero, and zero is zero');
  assert.equal(r.ok, true);
  // The message path is exercised too: a total is never rendered as NaN.
  const broken = evaluate(model, {
    op: 'create',
    entity: 'journal-entry',
    id: 'JE-0001-CLONE',
    doc: { 'entry-date': '2027-04-07', status: 'draft' },
    actorRoles: [],
  }, makeWorld(LEDGER_WORLD()));
  assert.equal(broken.ok, true);
  for (const violation of [...r.violations, ...broken.violations]) {
    assert.doesNotMatch(violation.reason, /NaN|undefined|null/);
  }
});

test('§13 a money sum over mixed currencies is refused, naming both, never converted', () => {
  const { model } = parseLedger();
  const docs = [
    ...LEDGER_WORLD(),
    { id: 'JE-0001-3', entity: 'posting', 'journal-entry': 'JE-0001', account: '1200', debit: '10.00 USD' },
  ];
  const r = evaluate(model, {
    op: 'update', entity: 'posting', id: 'JE-0001-1', doc: { debit: '119.00 EUR' }, actorRoles: ['accountant'],
  }, makeWorld(docs));
  assert.equal(r.ok, false);
  const reason = r.violations.map((x) => x.reason).join('\n');
  assert.match(reason, /EUR/);
  assert.match(reason, /USD/);
  assert.match(reason, /different currencies/);
  assert.match(reason, /never converted|not converted/);
  assert.doesNotMatch(reason, /129|10\.00 EUR/, 'nothing was converted at any rate');
});

test('§13.3 the read path may answer an aggregate, and a non-exact answer is refused not trusted', () => {
  // A RULE condition reads the index, so the index may answer the aggregate (§13.3). An INVARIANT
  // reads the staged world instead, because the index does not know about changes in flight
  // (§12.1) — so the fast path is deliberately not offered there.
  const { model } = parseLedger({
    'operating-model/processes/close-entry.md': `# Close an entry

## Rules
If Update journal-entry under condition
  sum of debit over posting for this journal-entry = sum of credit over posting for this journal-entry
then
  Update journal-entry with status "posted"

## Authorized by
accountant
`,
  });
  const base = makeWorld(LEDGER_WORLD());
  const asked = [];

  // A world that answers aggregates itself, the way an index would.
  const fast = {
    ...base,
    matching: (entity, filter) => {
      asked.push(['matching', entity, JSON.stringify(filter)]);
      return base.find(entity, () => true);
    },
    aggregate: (spec) => {
      asked.push(['aggregate', spec.kind, spec.entity, JSON.stringify(spec.filter)]);
      return null; // "I cannot answer that" — the documented fallback
    },
  };
  const r = evaluate(model, {
    op: 'update', entity: 'journal-entry', id: 'JE-0001', doc: {}, actorRoles: ['accountant'],
  }, fast);
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true, 'falling back to matching() gives the same answer');
  assert.ok(asked.some(([kind]) => kind === 'aggregate'), 'the fast path was offered the question');
  assert.ok(asked.some(([kind]) => kind === 'matching'), 'and the narrowing question was asked too');
  // §13.3: for-this compiles into an indexed equality, so the question is answerable.
  const filters = asked.filter(([k]) => k === 'matching').map(([, , f]) => f).join(' ');
  assert.match(filters, /"field":"journal-entry","op":"=","value":"JE-0001"/);

  // A world that answers with a float pretending to be money is refused, not believed.
  const lying = {
    ...base,
    aggregate: (spec) => (spec.kind === 'sum' ? { value: 119.0 } : null),
  };
  const refused = evaluate(model, {
    op: 'update', entity: 'journal-entry', id: 'JE-0001', doc: {}, actorRoles: ['accountant'],
  }, lying);
  assert.equal(refused.ok, false);
  assert.match(refused.violations[0].reason, /the read path answered .* which is not an exact amount/);
});

test('§13.3 an aggregate with no "for this" and no "where" warns that it reads everything', () => {
  const { errors } = parseOperatingModel(ledgerFiles({
    'operating-model/information/trial-balance.md': `# Trial balance

## Fields
- as-at: date required

## Invariants
- in balance: sum of debit over posting = sum of credit over posting
`,
  }));
  assert.deepEqual(errorsOf(errors), []);
  const w = errors.filter((e) => /reads every posting there is/.test(e.message));
  assert.equal(w.length, 2, 'both totals are named');
  assert.match(w[0].message, /names no "for this" and no "where"/);
  assert.match(w[0].message, /grammar\.md §13\.3/);
});

// ---------------------------------------------------------------------------------------------
// §14 Branches — the 10 000 € case that was impossible in version 1
// ---------------------------------------------------------------------------------------------

const THRESHOLD = 'operating-model/processes/purchase-approval.md';

function thresholdFiles(overrides = {}) {
  return ledgerFiles({
    'operating-model/information/purchase-order.md': `# Purchase order

## Fields
- net-amount: money required
- status: one of draft, approved, rejected required
- approval-count: number
`,
    [THRESHOLD]: `# Purchase approval

## Rules
If Create purchase-order under condition net-amount > 0 then
  when net-amount > 10000.00 EUR authorized by managing-director then
    Update purchase-order with status "approved"
  otherwise
    Update purchase-order with status "rejected"

## Authorized by
accountant
`,
    ...overrides,
  });
}

test('§14 threshold authorisation works — the case §10.14 said was impossible in version 1', () => {
  const { model, errors } = parseOperatingModel(thresholdFiles());
  assert.deepEqual(errorsOf(errors).map((e) => e.message), []);
  const rule = model.processes.find((r) => r.source.file === THRESHOLD);
  assert.equal(rule.branches.length, 2);
  assert.deepEqual(rule.branches.map((b) => [b.isDefault, b.authority.scope, b.authorizedBy]), [
    [false, 'arm', ['managing-director']],
    [true, 'file', ['accountant']],
  ], 'the high arm carries its own authority; the default arm falls back to the file');

  const small = { 'net-amount': '500.00 EUR', status: 'draft', 'approval-count': 0 };
  const large = { 'net-amount': '10000.01 EUR', status: 'draft', 'approval-count': 0 };
  const world = makeWorld(LEDGER_WORLD());
  const order = (doc, roles) => ({ op: 'create', entity: 'purchase-order', id: 'PO-1', doc, actorRoles: roles });

  // low arm: the accountant may
  const low = evaluate(model, order(small, ['accountant']), world);
  assert.deepEqual(low.violations, []);
  assert.equal(low.ok, true);
  assert.equal(low.changes.length, 1, 'only the trigger — the arm updates the trigger itself');
  assert.equal(low.changes[0].after.status, 'rejected', 'the default arm ran, and only it');

  // high arm: the accountant may NOT
  const refused = evaluate(model, order(large, ['accountant']), world);
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.changes, []);
  assert.match(refused.violations[0].reason, /may not create a purchase-order/);
  assert.match(refused.violations[0].reason, /managing-director/);
  assert.equal(refused.violations[0].line, 5, 'the arm\'s own "authorized by", on the "when" line');

  // high arm: the managing director may, and gets the other arm's consequents
  const approved = evaluate(model, order(large, ['managing-director']), world);
  assert.deepEqual(approved.violations, []);
  assert.equal(approved.ok, true);
  assert.equal(approved.changes[0].after.status, 'approved', 'the high arm ran, and only it');

  // and the low case is NOT open to the managing director's authority by accident: most specific
  // scope wins, and for the low arm that is the file.
  const mdLow = evaluate(model, order(small, ['managing-director']), world);
  assert.equal(mdLow.ok, false, 'the default arm says accountant, and only accountant');
  assert.match(mdLow.violations[0].reason, /accountant/);
});

test('§14 exactly one arm runs, in written order, and money thresholds are exact at the boundary', () => {
  const { model } = parseOperatingModel(thresholdFiles());
  const world = makeWorld(LEDGER_WORLD());
  const at = (amount, roles) => evaluate(model, {
    op: 'create',
    entity: 'purchase-order',
    id: 'PO-1',
    doc: { 'net-amount': amount, status: 'draft', 'approval-count': 0 },
    actorRoles: roles,
  }, world);

  // 10000.00 is NOT > 10000.00 — exactly, with no float anywhere near it.
  const boundary = at('10000.00 EUR', ['accountant']);
  assert.equal(boundary.ok, true, 'the boundary itself falls to the default arm');
  assert.equal(boundary.changes[0].after.status, 'rejected');
  // one cent over is over — and it is the managing director's, exactly from that cent
  assert.equal(at('10000.01 EUR', ['accountant']).ok, false);
  assert.equal(at('10000.01 EUR', ['managing-director']).changes[0].after.status, 'approved');
});

test('§14.1 an unreachable arm warns, and so does a branch set with no "otherwise"', () => {
  // Thresholds ordered ascending: the 10 000 arm can never run, because the 1 000 arm catches it.
  const ascending = parseOperatingModel(thresholdFiles({
    [THRESHOLD]: `# Purchase approval

## Rules
If Create purchase-order then
  when net-amount > 1000.00 EUR then
    Update purchase-order with status "approved"
  otherwise when net-amount > 10000.00 EUR then
    Update purchase-order with status "rejected"
  otherwise
    Update purchase-order with status "draft"

## Authorized by
accountant
`,
  }));
  assert.deepEqual(errorsOf(ascending.errors).map((e) => e.message), []);
  const unreachable = ascending.errors.find((e) => /this branch can never run: everything that satisfies/.test(e.message));
  assert.ok(unreachable, 'the dead arm is named at parse time');
  assert.match(unreachable.message, /net-amount > 10000\.00 EUR/);
  assert.match(unreachable.message, /net-amount > 1000\.00 EUR/);
  assert.match(unreachable.message, /put the narrower case first/);
  assert.equal(unreachable.line, 7);

  // A self-contradictory arm is named too.
  const contradiction = parseOperatingModel(thresholdFiles({
    [THRESHOLD]: `# Purchase approval

## Rules
If Create purchase-order then
  when approval-count > 10 and approval-count < 5 then
    Update purchase-order with status "approved"
  otherwise
    Update purchase-order with status "draft"

## Authorized by
accountant
`,
  }));
  assert.ok(contradiction.errors.find((e) => /this branch can never run: "approval-count > 10"/.test(e.message)));

  // No default arm: some cases fall through and do nothing at all. Not an error — the author asked
  // for nothing — but never silent (§14.1).
  const noDefault = parseOperatingModel(thresholdFiles({
    [THRESHOLD]: `# Purchase approval

## Rules
If Create purchase-order then
  when net-amount > 10000.00 EUR then
    Update purchase-order with status "approved"

## Authorized by
accountant
`,
  }));
  assert.deepEqual(errorsOf(noDefault.errors), []);
  const fallthrough = noDefault.errors.find((e) => /has no "otherwise" branch/.test(e.message));
  assert.ok(fallthrough);
  assert.match(fallthrough.message, /nothing at all happens to a purchase-order that satisfies none of "net-amount > 10000\.00 EUR"/);

  // …and it tells the truth: a small order goes through, unchanged, with no consequents.
  const world = makeWorld(LEDGER_WORLD());
  const small = evaluate(noDefault.model, {
    op: 'create',
    entity: 'purchase-order',
    id: 'PO-9',
    doc: { 'net-amount': '5.00 EUR', status: 'draft' },
    actorRoles: ['accountant'],
  }, world);
  assert.equal(small.ok, true);
  assert.equal(small.changes.length, 1, 'the trigger only: no arm matched, so no consequence');
  assert.equal(small.changes[0].after.status, 'draft', 'nothing was invented for the case nobody wrote');
});

test('§14 a branch is refused loudly when its shape is wrong — never guessed (Principle 6)', () => {
  const cases = [
    ['If Create purchase-order then when net-amount > 0 Update purchase-order with status "approved"',
      /this "when" branch has no "then"/],
    ['If Create purchase-order then when then Update purchase-order with status "approved"',
      /"when" is followed by no condition at all/],
    ['If Create purchase-order then when net-amount > 0 then Update purchase-order with status "approved" otherwise',
      /"otherwise" is followed by nothing/],
    ['If Create purchase-order then Update purchase-order with status "approved" otherwise Update purchase-order with status "draft"',
      /"otherwise" only has a meaning after a "when" branch/],
    ['If Create purchase-order then when net-amount > 0 then Update purchase-order with status "approved" otherwise Update purchase-order with status "draft" otherwise when net-amount > 5 then Delete purchase-order',
      /has no "when", so it covers every remaining case/],
  ];
  for (const [body, pattern] of cases) {
    const { errors } = parseOperatingModel(thresholdFiles({
      [THRESHOLD]: `# T\n\n## Rules\n${body}\n\n## Authorized by\naccountant\n`,
    }));
    const d = errorsOf(errors).find((e) => e.file === THRESHOLD);
    assert.ok(d, `"${body.slice(0, 50)}…" must be refused`);
    assert.match(d.message, pattern);
  }
});

// ---------------------------------------------------------------------------------------------
// §15 Enumerations
// ---------------------------------------------------------------------------------------------

test('§15 "delivrd" is refused by name in the model text, listing the values that exist', () => {
  const { errors } = parseOperatingModel(baseFiles({
    'operating-model/information/order-line.md': `# Order line

## Fields
- order: reference to order
- article: reference to article
- status: one of open, delivered, cancelled
`,
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition quantity > 0 then Update order-line with status "delivrd"'),
  }));
  const d = errorsOf(errors).find((e) => e.file === TEST_PROCESS);
  assert.ok(d, 'the typo never reaches production');
  assert.equal(d.line, TEST_RULE_LINE);
  assert.match(d.message, /"delivrd" is not one of the values it can have/);
  assert.match(d.message, /Did you mean "delivered"\?/);
  assert.match(d.message, /"open", "delivered", "cancelled"/);
  assert.match(d.message, /operating-model\/information\/order-line\.md:6/);

  // A condition, not just a consequent.
  const cond = parseOperatingModel(baseFiles({
    'operating-model/information/order-line.md': `# Order line

## Fields
- order: reference to order
- status: one of open, delivered, cancelled
`,
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition order-line.status is "delivrd" then Delete stock'),
  }));
  const c = errorsOf(cond.errors).find((e) => e.file === TEST_PROCESS);
  assert.match(c.message, /"delivrd" is not one of the values it can have/);
});

test('§15 a valid value passes, a wrong value in the DATA is refused, and ">" on an enum is refused', () => {
  const files = baseFiles({
    'operating-model/information/order-line.md': `# Order line

## Fields
- order: reference to order
- article: reference to article
- status: one of open, delivered, cancelled
`,
  });
  const model = parseOk(files);
  assert.deepEqual(model.entities.get('order-line').fields.get('status').values,
    ['open', 'delivered', 'cancelled'], 'in declaration order');

  // The model text says "delivered", which is declared, so the goods receipt works as before.
  const ok = evaluate(model, receipt(), makeWorld(WORLD_DOCS()));
  assert.deepEqual(ok.violations, []);
  assert.equal(ok.changes[3].after.status, 'delivered');

  // A value that arrives in the DATA — from a foreign dialect, say — is refused too.
  const bad = evaluate(model, {
    op: 'update', entity: 'order-line', id: 'PO-77-1', doc: { status: 'delivrd' }, actorRoles: [],
  }, makeWorld(WORLD_DOCS()));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.changes, []);
  assert.match(bad.violations[0].reason, /"status" on order-line "PO-77-1" is "delivrd", which is not one of the values a order-line may have/);
  assert.match(bad.violations[0].reason, /status: one of open, delivered, cancelled/);

  // An enumeration is a set, not a scale.
  const ordered = parseOperatingModel(baseFiles({
    'operating-model/information/order-line.md': `# Order line

## Fields
- order: reference to order
- status: one of open, delivered
`,
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition order-line.status > "open" then Delete stock'),
  }));
  const o = errorsOf(ordered.errors).find((e) => e.file === TEST_PROCESS);
  assert.match(o.message, /">" has no meaning for "order-line\.status", which is declared as one of "open", "delivered"/);
  assert.match(o.message, /an enumeration is a set, not a scale/);
});

test('§15 adding a value to an enumeration is additive: everything before it is untouched', () => {
  const before = baseFiles({
    'operating-model/information/order-line.md': '# Order line\n\n## Fields\n- order: reference to order\n- article: reference to article\n- status: one of open, delivered\n',
  });
  const after = baseFiles({
    'operating-model/information/order-line.md': '# Order line\n\n## Fields\n- order: reference to order\n- article: reference to article\n- status: one of open, delivered, part-delivered\n',
  });
  const a = evaluate(parseOk(before), receipt(), makeWorld(WORLD_DOCS()));
  const b = evaluate(parseOk(after), receipt(), makeWorld(WORLD_DOCS()));
  assert.equal(a.ok, true);
  assert.deepEqual(b.changes, a.changes, 'byte-identical changes before and after the new value');

  // Quoted values, and "or" as the separator, both work; duplicates and an empty list do not.
  const quoted = parseOk(baseFiles({
    'operating-model/information/vat-treatment.md': '# VAT\n\n## Fields\n- kind: one of "standard", "reverse-charge" or "oss"\n',
  }));
  assert.deepEqual(quoted.entities.get('vat-treatment').fields.get('kind').values,
    ['standard', 'reverse-charge', 'oss']);
  for (const [decl, pattern] of [
    ['- kind: one of a, a', /"a" is listed twice among the values of "kind"/],
    ['- kind: one of', /is not a field type known/],
  ]) {
    const { errors } = parseOperatingModel(baseFiles({
      'operating-model/information/vat-treatment.md': `# VAT\n\n## Fields\n${decl}\n`,
    }));
    assert.match(errorsOf(errors).map((e) => e.message).join('\n'), pattern);
  }
});

// ---------------------------------------------------------------------------------------------
// §16 Authority in three scopes, and FD-7's coverage
// ---------------------------------------------------------------------------------------------

test('§16 arm, rule, file and entity scopes compose — most specific wins, and only it', () => {
  const files = ledgerFiles({
    'operating-model/information/purchase-order.md': `# Purchase order

## Fields
- net-amount: money required
- status: one of draft, approved required

## Authorized by
- create: accountant
- read: accountant or controller
- update: controller
- delete: managing-director
`,
    'operating-model/processes/po-file-scope.md': `# File scope

## Rules
If Update purchase-order under condition net-amount > 0 then Update purchase-order with status "approved"

If Delete purchase-order authorized by managing-director then Delete purchase-order

## Authorized by
accountant
`,
    'operating-model/processes/po-entity-scope.md': `# No authority of its own

## Rules
If Read purchase-order then Update purchase-order with status "draft"
`,
  });
  const { model, errors } = parseOperatingModel(files);
  assert.deepEqual(errorsOf(errors).map((e) => e.message), []);

  const by = (op) => model.processes.find((r) => r.trigger.entity === 'purchase-order' && r.trigger.op === op);
  assert.deepEqual([by('update').authority.scope, by('update').authorizedBy], ['file', ['accountant']],
    'file scope beats the entity default');
  assert.deepEqual([by('delete').authority.scope, by('delete').authorizedBy], ['rule', ['managing-director']],
    'an inline "authorized by" on the rule beats its own file');
  assert.deepEqual([by('read').authority.scope, by('read').authorizedBy], ['entity', ['accountant', 'controller']],
    'a file with no "## Authorized by" falls back to the entity default (FD-7)');

  // The composition is not a union and not an intersection: exactly the winning scope applies.
  const world = makeWorld([{ id: 'PO-1', entity: 'purchase-order', 'net-amount': '5.00 EUR', status: 'draft' }]);
  const upd = (roles) => evaluate(model, { op: 'update', entity: 'purchase-order', id: 'PO-1', doc: {}, actorRoles: roles }, world);
  assert.equal(upd(['accountant']).ok, true);
  assert.equal(upd(['controller']).ok, false, 'the entity default for update is NOT added to the file scope');
  const del = (roles) => evaluate(model, { op: 'delete', entity: 'purchase-order', id: 'PO-1', doc: {}, actorRoles: roles }, world);
  assert.equal(del(['managing-director']).ok, true);
  assert.equal(del(['accountant']).ok, false, 'the file scope is NOT added to the rule scope');
});

test('§16.2 the coverage warning fires for every uncovered pair, grouped by entity', () => {
  const { model, errors } = parseOperatingModel(ledgerFiles());
  const warnings = coverage(errors);
  const forEntity = (name) => warnings.find((w) => w.file === `operating-model/information/${name}.md`);

  // ledger-account and accounting-period declare all four operations, so they are covered.
  assert.equal(forEntity('ledger-account'), undefined);
  assert.equal(forEntity('accounting-period'), undefined);

  // journal-entry and posting declare none and no rule governs them.
  const je = forEntity('journal-entry');
  assert.ok(je, 'the hole is named when the repository is opened');
  assert.equal(je.severity, 'warning');
  assert.match(je.message, /nothing says who may create a journal-entry, read a journal-entry, update a journal-entry, delete a journal-entry/);
  assert.match(je.message, /open to an actor with no role at all/);
  assert.match(je.message, /- create: <role>/, 'and the message says exactly how to close it');
  assert.match(je.message, /grammar\.md §16\.2/);
  assert.equal(warnings.length, 2, 'one warning per entity, not one per operation');

  // The warning tells the truth: permissively, an actor with no role may do it (version 1's
  // default, kept on purpose — FD-7).
  const world = makeWorld(LEDGER_WORLD());
  const open = evaluate(model, {
    op: 'delete', entity: 'journal-entry', id: 'JE-0001', doc: {}, actorRoles: [],
  }, world);
  assert.equal(open.ok, true, 'grammar version 1 behaviour, unchanged');
});

test('§16.2 strict mode refuses an uncovered operation, and changes nothing that IS covered', () => {
  const { model } = parseLedger();
  const world = makeWorld(LEDGER_WORLD());
  const strict = { authorization: 'strict' };

  const uncovered = evaluate(model, {
    op: 'update', entity: 'journal-entry', id: 'JE-0001', doc: { narrative: 'x' }, actorRoles: ['accountant'],
  }, world, strict);
  assert.equal(uncovered.ok, false);
  assert.deepEqual(uncovered.changes, []);
  assert.match(uncovered.violations[0].reason, /nothing says who may change a journal-entry, and this workspace refuses what no one is authorised to do/);
  assert.match(uncovered.violations[0].reason, /- update: <role>/);
  assert.match(uncovered.violations[0].reason, /authorized by <role>/);

  // Covered by the entity default: strict mode does not change its meaning, in either direction.
  const covered = (roles, options) => evaluate(model, {
    op: 'update', entity: 'ledger-account', id: '1200', doc: { name: 'Bank' }, actorRoles: roles,
  }, world, options);
  assert.equal(covered(['accountant'], strict).ok, true);
  assert.equal(covered(['accountant'], undefined).ok, true);
  assert.equal(covered(['controller'], strict).ok, false, 'update is the accountant\'s, strictly or not');
  assert.equal(covered(['controller'], undefined).ok, false);
  assert.deepEqual(covered(['accountant'], strict).changes, covered(['accountant'], undefined).changes);
});

test('§16 a plain "## Authorized by" in an entity file keeps its version-1 meaning, and says so', () => {
  // operating-model/information/stock-adjustment.md contains exactly this today. Giving those
  // words a new meaning would change an existing model's behaviour, which §0 forbids.
  const { model, errors } = parseOperatingModel(baseFiles({
    'operating-model/information/stock.md': `# Stock

## Fields
- article: reference to article
- location: reference to location
- quantity: number

## Identified by
article and location

## Created on demand
yes

## Authorized by
warehouse-management
`,
  }));
  assert.deepEqual(errorsOf(errors).map((e) => e.message), []);
  assert.equal(model.entities.get('stock').authority, null, 'no entity-scope authority was invented');

  const w = errors.find((e) => /govern nothing at all/.test(e.message));
  assert.ok(w, 'but the author is told that those words do nothing');
  assert.match(w.message, /"warehouse-management"/);
  assert.match(w.message, /- create: warehouse-management/, 'and how to make them mean something');
  assert.match(w.message, /grammar\.md §0, §16\.1/);

  // Behaviour is unchanged: the goods receipt still works exactly as it did.
  const r = evaluate(model, receipt(), makeWorld(WORLD_DOCS()));
  assert.equal(r.ok, true);
  assert.equal(r.changes.length, 4);

  // Per-operation authority in a PROCESS file is refused, pointing at where it belongs.
  const wrongPlace = parseOperatingModel(baseFiles({
    [TEST_PROCESS]: '# T\n\n## Rules\nIf Create goods-receipt then Delete stock\n\n## Authorized by\n- create: warehouse-clerk\n',
  }));
  const d = errorsOf(wrongPlace.errors).find((e) => e.file === TEST_PROCESS);
  assert.match(d.message, /authority per operation is a declaration about a kind of document, so it belongs in an "information\/" file/);
});

test('§16 an unknown role is refused in every scope, and "and" between roles still is', () => {
  const cases = [
    ['If Create purchase-order authorized by contoller then Delete purchase-order', /names the role "contoller"/],
    ['If Create purchase-order then when net-amount > 0 authorized by contoller then Delete purchase-order otherwise Delete purchase-order', /names the role "contoller"/],
    ['If Create purchase-order authorized by accountant and controller then Delete purchase-order', /"and" between roles does not exist/],
    ['If Create purchase-order authorized then Delete purchase-order', /must be followed by "by"/],
  ];
  for (const [body, pattern] of cases) {
    const { errors } = parseOperatingModel(ledgerFiles({
      'operating-model/information/purchase-order.md': '# PO\n\n## Fields\n- net-amount: money required\n',
      [THRESHOLD]: `# T\n\n## Rules\n${body}\n`,
    }));
    const d = errorsOf(errors).find((e) => e.file === THRESHOLD);
    assert.ok(d, `"${body.slice(0, 60)}" must be refused`);
    assert.match(d.message, pattern);
  }
  // The entity scope validates its roles too.
  const entity = parseOperatingModel(ledgerFiles({
    'operating-model/information/purchase-order.md': '# PO\n\n## Fields\n- net-amount: money required\n\n## Authorized by\n- create: contoller\n',
  }));
  assert.match(errorsOf(entity.errors).map((e) => e.message).join('\n'), /names the role "contoller"/);
});

// ---------------------------------------------------------------------------------------------
// §17 `with +<field> from <other-field>`
// ---------------------------------------------------------------------------------------------

test('§17 a counter can name its source field, which kills the duplicate-field workaround', () => {
  // §10.13: "add the receipt's quantity to the order's delivered-quantity" could not be written in
  // version 1, and §10.1 recommended maintained totals — which needed exactly this.
  const model = parseOk(baseFiles({
    [TEST_PROCESS]: processFile('If Create goods-receipt under condition quantity > 0 then Update order with +delivered-quantity from quantity'),
  }));
  const rule = model.processes.find((r) => r.source.file === TEST_PROCESS);
  assert.equal(rule.consequents[0].clauses.length, 1);
  const clause = rule.consequents[0].clauses[0];
  assert.equal(clause.kind, 'add');
  assert.equal(clause.field, 'delivered-quantity');
  assert.equal(clause.from.text, 'quantity', 'the source is on the AST, not inferred at run time');
  assert.equal(clause.from.root, 'quantity');
  assert.equal(clause.from.field, null, 'no hop here');
  assert.deepEqual(clause.resolvedFrom.steps, [{ step: 'value', field: 'quantity' }],
    'and the steps execute.js follows were computed by the parser');
  assert.equal(clause.line, TEST_RULE_LINE);

  const r = evaluate(model, receipt(), makeWorld(WORLD_DOCS()));
  assert.deepEqual(r.violations, []);
  const order = r.changes.find((c) => c.entity === 'order');
  assert.equal(order.before['delivered-quantity'], 0);
  assert.equal(order.after['delivered-quantity'], 12, 'the receipt\'s quantity, on the order\'s field');

  // Money into money is exact; money into number is refused rather than guessed.
  const money = parseOk(new Map([
    ['operating-model/information/receipt.md', '# Receipt\n\n## Fields\n- account: reference to account\n- amount: money required\n'],
    ['operating-model/information/account.md', '# Account\n\n## Fields\n- balance: money\n'],
    ['operating-model/processes/post.md', '# Post\n\n## Rules\nIf Create receipt then Update account with +balance from amount\n'],
  ]));
  const exact = evaluate(money, {
    op: 'create', entity: 'receipt', id: 'R-1', doc: { account: 'A-1', amount: '0.10 EUR' }, actorRoles: [],
  }, makeWorld([{ id: 'A-1', entity: 'account', balance: '0.20 EUR' }]));
  // The classic float failure: 0.1 + 0.2 !== 0.3 in IEEE 754.
  assert.notEqual(0.1 + 0.2, 0.3, 'this is what we are not doing');
  assert.deepEqual(exact.violations, []);
  const account = exact.changes.find((c) => c.entity === 'account');
  assert.equal(account.after.balance, '0.30 EUR', 'and this is what we do instead — exactly');

  const mismatch = parseOperatingModel(baseFiles({
    'operating-model/information/order.md': '# Order\n\n## Fields\n- ordered-quantity: number\n- delivered-quantity: number\n- net-amount: money\n- status: text\n',
    [TEST_PROCESS]: processFile('If Create goods-receipt then Update order with +net-amount from quantity'),
  }));
  const d = errorsOf(mismatch.errors).find((e) => e.file === TEST_PROCESS);
  assert.match(d.message, /counting one into the other has no defined meaning/);
  assert.match(d.message, /An amount of money is not a count/);

  // And the shape is refused when it is wrong.
  for (const [body, pattern] of [
    ['If Create goods-receipt then Update order with +delivered-quantity from', /"from" must be followed by a field/],
    // FD-5 item 9: the non-counter form is no longer refused — it SETS rather than adds. Asserted
    // as working, below, rather than deleted, so the change of meaning is visible in this test.
    ['If Create goods-receipt then Update order with status from quantity',
      /cannot carry the value across: one is number and the other is text/],
    ['If Create goods-receipt then Update order with +delivered-quantity from colour',
      /"from colour" reads "colour", which is not a field of "goods-receipt"/],
  ]) {
    const bad = parseOperatingModel(baseFiles({ [TEST_PROCESS]: processFile(body) }));
    assert.match(errorsOf(bad.errors).map((e) => e.message).join('\n'), pattern, body);
  }
});

// ---------------------------------------------------------------------------------------------
// §18 Periods — and why correction is a new entry, never a mutation
// ---------------------------------------------------------------------------------------------

test('§18 a posting dated inside a locked period is refused, quoting both declarations', () => {
  const { model } = parseLedger();
  const world = makeWorld(LEDGER_WORLD());
  const r = evaluate(model, {
    op: 'create',
    entity: 'journal-entry',
    id: 'JE-LATE',
    doc: { 'entry-date': '2027-03-15', status: 'draft' },
    actorRoles: ['accountant'],
  }, world);

  assert.equal(r.ok, false);
  assert.deepEqual(r.changes, []);
  const [v] = r.violations;
  assert.match(v.reason, /journal-entry "JE-LATE" is dated "2027-03-15", which falls in accounting-period "2027-03", and that period is locked/);
  assert.match(v.reason, /- locked when: status is "locked"/);
  assert.match(v.reason, /and it holds: status is "locked"/);
  assert.match(v.reason, /- entry-date in accounting-period/);
  assert.match(v.reason, /corrected by a NEW entry dated in an open one/);
  assert.equal(v.file, 'operating-model/information/journal-entry.md');

  // The boundaries are inclusive, and nothing outside them is touched.
  for (const date of ['2027-03-01', '2027-03-31']) {
    const edge = evaluate(model, {
      op: 'create', entity: 'journal-entry', id: 'JE-E', doc: { 'entry-date': date, status: 'draft' }, actorRoles: ['accountant'],
    }, world);
    assert.equal(edge.ok, false, `${date} is inside the locked month`);
  }
  // A date in no period at all is allowed: refusing it would make a new company's first entry
  // impossible, and that is a business decision, not the runtime's (§18).
  const nowhere = evaluate(model, {
    op: 'create', entity: 'journal-entry', id: 'JE-N', doc: { 'entry-date': '2026-01-01', status: 'draft' }, actorRoles: ['accountant'],
  }, world);
  assert.equal(nowhere.ok, true);
});

test('§18 an existing document in a locked period cannot be changed OR deleted, or moved out of it', () => {
  const { model } = parseLedger();
  const docs = [
    ...LEDGER_WORLD(),
    { id: 'JE-MAR', entity: 'journal-entry', 'entry-date': '2027-03-10', status: 'posted', narrative: 'March sale' },
  ];
  const world = makeWorld(docs);

  const changed = evaluate(model, {
    op: 'update', entity: 'journal-entry', id: 'JE-MAR', doc: { narrative: 'edited' }, actorRoles: ['accountant'],
  }, world);
  assert.equal(changed.ok, false, 'GoBD Unveränderbarkeit: the March entry is frozen');
  assert.match(changed.violations.map((x) => x.reason).join('\n'), /cannot be changed/);

  const deleted = evaluate(model, {
    op: 'delete', entity: 'journal-entry', id: 'JE-MAR', doc: {}, actorRoles: ['accountant'],
  }, world);
  assert.equal(deleted.ok, false);
  assert.match(deleted.violations.map((x) => x.reason).join('\n'), /cannot be deleted/);

  // Moving it into the open month is refused too — an update is checked against BOTH dates.
  const moved = evaluate(model, {
    op: 'update', entity: 'journal-entry', id: 'JE-MAR', doc: { 'entry-date': '2027-04-10' }, actorRoles: ['accountant'],
  }, world);
  assert.equal(moved.ok, false, 'you cannot carry a booking out of a closed month');
  assert.match(moved.violations.map((x) => x.reason).join('\n'), /"2027-03-10"/);
});

test('§18 the correcting entry into an open period succeeds and leaves the original untouched', () => {
  const { model } = parseLedger();
  const original = { id: 'JE-MAR', entity: 'journal-entry', 'entry-date': '2027-03-10', status: 'posted', narrative: 'March sale' };
  const docs = [...LEDGER_WORLD(), original];
  const snapshot = JSON.stringify(original);
  const world = makeWorld(docs);

  const correction = evaluate(model, {
    op: 'create',
    entity: 'journal-entry',
    id: 'JE-COR',
    doc: { 'entry-date': '2027-04-02', status: 'draft', narrative: 'Corrects JE-MAR', corrects: 'JE-MAR' },
    actorRoles: ['accountant'],
  }, world);

  assert.deepEqual(correction.violations, []);
  assert.equal(correction.ok, true, 'a NEW entry in an open month is an ordinary create');
  assert.deepEqual(correction.changes.map((c) => [c.op, c.entity, c.id]), [['create', 'journal-entry', 'JE-COR']]);
  assert.equal(correction.changes[0].after.corrects, 'JE-MAR');
  assert.equal(JSON.stringify(original), snapshot,
    'the original is byte-identical: nothing in a closed month is ever rewritten');
  assert.equal(correction.changes.some((c) => c.id === 'JE-MAR'), false,
    'and no change touches it, not even an empty one');
});

test('§18 a period declaration is refused when it is not a period, or names the wrong field', () => {
  const cases = [
    [{ 'operating-model/information/journal-entry.md': '# J\n\n## Fields\n- entry-date: date required\n- status: one of draft, posted required\n\n## Dated in\n- entry-date in ledger-account\n' },
      /"ledger-account" is not a period/],
    [{ 'operating-model/information/journal-entry.md': '# J\n\n## Fields\n- entry-date: date required\n- status: one of draft, posted required\n\n## Dated in\n- narrative in accounting-period\n' },
      /"## Dated in" names "narrative", which is not a field/],
    [{ 'operating-model/information/journal-entry.md': '# J\n\n## Fields\n- entry-date: date required\n- narrative: text\n- status: one of draft, posted required\n\n## Dated in\n- narrative in accounting-period\n' },
      /it must be a date, but it is declared as a text/],
    [{ 'operating-model/information/accounting-period.md': '# P\n\n## Fields\n- starts-on: date required\n- status: one of open, locked required\n\n## Period\n- from: starts-on\n- to: ends-on\n- locked when: status is "locked"\n' },
      /"## Period" names "ends-on" as its "to", which is not a field/],
    [{ 'operating-model/information/accounting-period.md': '# P\n\n## Fields\n- starts-on: date required\n- ends-on: date required\n\n## Period\n- from: starts-on\n- to: ends-on\n' },
      /"## Period" does not say "locked when"/],
    [{ 'operating-model/information/accounting-period.md': '# P\n\n## Fields\n- starts-on: date required\n- ends-on: date required\n\n## Period\n- from: starts-on\n- to: ends-on\n- closed if: status is "x"\n' },
      /"closed if" is not part of a period declaration/],
  ];
  for (const [overrides, pattern] of cases) {
    const { errors } = parseOperatingModel(ledgerFiles(overrides));
    assert.match(errorsOf(errors).map((e) => e.message).join('\n'), pattern);
  }
});

test('§18.2 periods read no clock at all: the same document refuses identically, forever', () => {
  const { model } = parseLedger();
  const world = makeWorld(LEDGER_WORLD());
  const intent = {
    op: 'create', entity: 'journal-entry', id: 'JE-LATE', doc: { 'entry-date': '2027-03-15', status: 'draft' }, actorRoles: ['accountant'],
  };
  const first = evaluate(model, intent, world).violations[0].reason;
  for (let i = 0; i < 20; i++) {
    assert.equal(evaluate(model, intent, world).violations[0].reason, first);
  }
  // And the module reads no clock: asserted structurally, not by hoping.
  for (const f of ['parse.js', 'execute.js', 'money.js']) {
    const src = readFileSync(join('runtime/polism', f), 'utf8');
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /Date\.now\(\)|new Date\(|Math\.random\(\)/, `${f} reads a clock`);
  }
});

// ---------------------------------------------------------------------------------------------
// §19 Money is exact, or it is refused (FD-1)
// ---------------------------------------------------------------------------------------------

test('§19 NO FLOAT touches a monetary value anywhere in runtime/polism — release blocker (FD-1)', () => {
  for (const f of readdirSync('runtime/polism').filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join('runtime/polism', f), 'utf8');
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /parseFloat|parseInt/, `${f} contains parseFloat/parseInt`);
    assert.doesNotMatch(code, /toFixed|Math\.round|Number\.parseFloat/, `${f} rounds a float`);
  }
  // Money arithmetic is agent M's, imported — not reimplemented here.
  const money = readFileSync('runtime/polism/money.js', 'utf8');
  assert.match(money, /from '\.\.\/money\/money\.js'/);
  assert.match(money, /from '\.\.\/money\/decimal\.js'/);
});

test('§19 comparisons, counters and sums over "4999.99 EUR" are exact, and 19% VAT is not 949.9981', () => {
  const { model } = parseLedger({
    'operating-model/information/invoice.md': `# Invoice

## Fields
- net-amount: money required
- vat-amount: money required
- gross-amount: money required
- status: one of draft, issued required
`,
    'operating-model/processes/issue.md': `# Issue

## Rules
If Create invoice under condition
  net-amount > 4999.98 EUR and
  net-amount <= 4999.99 EUR and
  vat-amount = 950.00 EUR
then
  Update invoice with status "issued"

## Authorized by
accountant
`,
  });
  const world = makeWorld(LEDGER_WORLD());
  const inv = (doc) => evaluate(model, {
    op: 'create', entity: 'invoice', id: 'INV-1', doc: { status: 'draft', ...doc }, actorRoles: ['accountant'],
  }, world);

  // 19 % of 4999.99 is 949.9981, which is not an amount of money. Commercial rounding half-up
  // gives 950.00, and the model compares against exactly that.
  const ok = inv({ 'net-amount': '4999.99 EUR', 'vat-amount': '950.00 EUR', 'gross-amount': '5949.99 EUR' });
  assert.deepEqual(ok.violations, []);
  assert.equal(ok.changes[0].after.status, 'issued');

  // The float answer is refused as a value: 949.9981 is not writable in EUR.
  const float = inv({ 'net-amount': '4999.99 EUR', 'vat-amount': '949.9981 EUR', 'gross-amount': '5949.99 EUR' });
  assert.equal(float.ok, false);
  assert.match(float.violations[0].reason, /"vat-amount" on invoice "INV-1" is not an exact amount/);
  assert.match(float.violations[0].reason, /decimal digit\(s\) but EUR has a scale of 2/);

  // A JSON number is refused outright — that is the defect this whole decision exists for.
  const number = inv({ 'net-amount': 4999.99, 'vat-amount': '950.00 EUR', 'gross-amount': '5949.99 EUR' });
  assert.equal(number.ok, false);
  assert.match(number.violations[0].reason, /is not an exact amount/);
  assert.match(number.violations[0].reason, /IEEE 754 doubles, which is exactly what FD-1 forbids/);

  // One cent under the threshold is under it, exactly.
  const under = inv({ 'net-amount': '4999.98 EUR', 'vat-amount': '950.00 EUR', 'gross-amount': '5949.98 EUR' });
  assert.equal(under.ok, false);
  assert.match(under.violations.map((x) => x.reason).join('\n'), /net-amount > 4999\.98 EUR/);
});

test('§19 a money literal is refused when its scale is wrong, and mixed currencies never compare', () => {
  const wrongScale = parseOperatingModel(ledgerFiles({
    'operating-model/information/purchase-order.md': '# PO\n\n## Fields\n- net-amount: money required\n',
    [THRESHOLD]: '# T\n\n## Rules\nIf Create purchase-order under condition net-amount > 10000 EUR then Delete purchase-order\n',
  }));
  const d = errorsOf(wrongScale.errors).find((e) => e.file === THRESHOLD);
  assert.match(d.message, /decimal digit\(s\) but EUR has a scale of 2/);
  assert.match(d.message, /write "10000\.00 EUR"/);

  // JPY has none, and the same strictness applies in the other direction.
  const jpy = parseOperatingModel(ledgerFiles({
    'operating-model/information/purchase-order.md': '# PO\n\n## Fields\n- net-amount: money required\n',
    [THRESHOLD]: '# T\n\n## Rules\nIf Create purchase-order under condition net-amount > 1000.00 JPY then Delete purchase-order\n',
  }));
  assert.match(errorsOf(jpy.errors).map((e) => e.message).join('\n'), /JPY has a scale of 0/);

  // Mixed currencies in a comparison are refused at execution, and nothing is converted.
  const model = parseOk(ledgerFiles({
    'operating-model/information/purchase-order.md': '# PO\n\n## Fields\n- net-amount: money required\n',
    [THRESHOLD]: '# T\n\n## Rules\nIf Create purchase-order under condition net-amount > 1000.00 EUR then Delete purchase-order\n',
  }));
  const usd = evaluate(model, {
    op: 'create', entity: 'purchase-order', id: 'PO-1', doc: { 'net-amount': '2000.00 USD' }, actorRoles: [],
  }, makeWorld([]));
  assert.equal(usd.ok, false);
  const reason = usd.violations.map((x) => x.reason).join('\n');
  assert.match(reason, /in USD/);
  assert.match(reason, /in EUR/);
  assert.match(reason, /not compared and never converted/);
});

test('§19.2 a version-1 "amount > 0" keeps working exactly, and a non-zero bare number warns', () => {
  // Real version-1 models contain `payable-amount > 0`, `net-amount > 0`, `value > 0`. §0 is
  // absolute: they keep their meaning, and they are exact.
  const files = ledgerFiles({
    'operating-model/information/invoice.md': '# Invoice\n\n## Fields\n- payable-amount: money required\n- status: one of draft, issued\n',
    [THRESHOLD]: '# T\n\n## Rules\nIf Create invoice under condition payable-amount > 0 then Update invoice with status "issued"\n',
  });
  const { model, errors } = parseOperatingModel(files);
  assert.deepEqual(errorsOf(errors).map((e) => e.message), []);
  assert.equal(errors.filter((e) => /names no currency/.test(e.message)).length, 0,
    'zero is currency-free, so there is nothing to warn about');

  const world = makeWorld([]);
  const at = (amount) => evaluate(model, {
    op: 'create', entity: 'invoice', id: 'INV-1', doc: { 'payable-amount': amount }, actorRoles: [],
  }, world);
  assert.equal(at('0.01 EUR').ok, true);
  assert.equal(at('0.00 EUR').ok, false, '0.00 is not > 0');
  assert.equal(at('-0.01 EUR').ok, false);
  assert.equal(at('1 JPY').ok, true, 'and it works for a currency with a different scale');

  // A NON-zero bare number names no currency. It keeps its version-1 meaning — so it is a
  // warning, which §0 requires, and never an error.
  const nonZero = parseOperatingModel(ledgerFiles({
    'operating-model/information/invoice.md': '# Invoice\n\n## Fields\n- payable-amount: money required\n- status: one of draft, issued\n',
    [THRESHOLD]: '# T\n\n## Rules\nIf Create invoice under condition payable-amount > 1000 then Update invoice with status "issued"\n',
  }));
  assert.deepEqual(errorsOf(nonZero.errors), [], 'still not an error: §0 does not allow that');
  const w = nonZero.errors.find((e) => /names no currency/.test(e.message));
  assert.ok(w);
  assert.match(w.message, /compares the same against 1000 EUR and 1000 JPY/);
  assert.match(w.message, /write it as "1000\.00 EUR"/);
  assert.match(w.message, /§19\.2/);
  // and it is exact, in whatever currency the value happens to be in
  const exact = evaluate(nonZero.model, {
    op: 'create', entity: 'invoice', id: 'INV-1', doc: { 'payable-amount': '1000.01 EUR' }, actorRoles: [],
  }, makeWorld([]));
  assert.equal(exact.ok, true);
});

test('§19.3 a counter creating a row on demand does not invent a currency', () => {
  const model = parseOk(new Map([
    ['operating-model/information/ledger-account.md', `# Ledger account

## Fields
- number: text
- balance: money

## Identified by
number

## Created on demand
yes
`],
    ['operating-model/information/posting.md', '# Posting\n\n## Fields\n- number: text\n- debit: money\n'],
    ['operating-model/processes/post.md', '# Post\n\n## Rules\nIf Create posting then Update ledger-account with +balance from debit\n'],
  ]));
  const r = evaluate(model, {
    op: 'create', entity: 'posting', id: 'P-NEW', doc: { number: '9999', debit: '12.34 EUR' }, actorRoles: [],
  }, makeWorld([]));
  assert.deepEqual(r.violations, []);
  const account = r.changes.find((c) => c.entity === 'ledger-account');
  assert.equal(account.op, 'create');
  assert.equal(account.after.balance, '12.34 EUR',
    'the new row takes the currency of the amount added — the only currency anyone declared');
  assert.equal(typeof account.after.balance, 'string', 'and never a float 0');
});

// ---------------------------------------------------------------------------------------------
// §0 — the additive-only promise, against the real trees
// ---------------------------------------------------------------------------------------------

/** Every `.md` under a directory, sorted, as parseOperatingModel wants it. */
function loadTree(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.set(p, readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return out;
}

/** Does this file's text use any grammar-version-2 construction at all? */
function usesV2(text) {
  return /^\s*##\s*(Invariants|Period|Dated in)\s*:?\s*$/im.test(text)
    || /\bsum of\b|\bcount of\b/i.test(text)
    || /^\s*[-*]?\s*(create|read|update|delete)\s*:/im.test(text)
    || /\bauthorized by\b|\bauthorised by\b/i.test(text.replace(/^##\s*Authorized by\s*:?\s*$/gim, ''))
    || /\bone of\b/i.test(text)
    || /\bwhen\b[\s\S]*\botherwise\b/i.test(text)
    || /\bwith\s*[+-][a-z0-9-]+\s+from\b/i.test(text);
}

test('v1 compatibility — the real operating-model/ and templates/ trees behave as they did', () => {
  for (const root of ['operating-model', 'templates/d2c-retail-europe']) {
    const files = loadTree(root);
    assert.ok(files.size > 40, `${root}: expected a real tree, found ${files.size} files`);
    const { model, errors } = parseOperatingModel(files);

    // 1. Nothing in a file that uses no version-2 construction may be refused BY version 2.
    //    This is the additive-only promise, stated as an assertion (§0): new behaviour appears
    //    only where new syntax is used.
    const v2Words = /aggregate|invariant|"for this|"one of|branch|"otherwise"|"when"|per operation|exact amount|names no currency|"where"/i;
    for (const e of errorsOf(errors)) {
      const text = files.get(e.file);
      if (text !== undefined && usesV2(text)) continue;
      assert.doesNotMatch(e.message, v2Words,
        `${root}: a file using no grammar-version-2 construction was refused by one:\n${e.message}`);
    }

    // 2. No entity gained an invariant, a period or a "dated in" it did not ask for.
    for (const [name, def] of model.entities) {
      const text = files.get(def.source.file) || '';
      if (!/^##\s*Invariants\s*:?\s*$/im.test(text)) assert.equal(def.invariants.size, 0, `${name} invented invariants`);
      if (!/^##\s*Period\s*:?\s*$/im.test(text)) assert.equal(def.period, null, `${name} invented a period`);
      if (!/^##\s*Dated in\s*:?\s*$/im.test(text)) assert.deepEqual(def.datedIn, [], `${name} invented a "dated in"`);
      if (!/^\s*[-*]?\s*(create|read|update|delete)\s*:/im.test(text)) {
        assert.equal(def.authority, null, `${name} invented entity-scope authority — that would change an existing model`);
      }
    }

    // 3. No rule gained a branch or an authority scope it did not ask for, and every rule whose
    //    file declares "## Authorized by" still has exactly those roles, from the file scope.
    for (const rule of model.processes) {
      const text = files.get(rule.source.file) || '';
      const inlineAuthority = /\bauthorized by\b|\bauthorised by\b/i.test(
        rule.text.replace(/\n/g, ' '),
      );
      if (!/\bwhen\b/i.test(rule.text)) {
        assert.equal(rule.branches, undefined, `${rule.source.file}:${rule.source.line} invented branches`);
      }
      if (!inlineAuthority) {
        assert.equal(rule.inlineAuthority, undefined,
          `${rule.source.file}:${rule.source.line} invented an inline authority`);
        const declared = /^##\s*Authorized by\s*:?\s*$/im.test(text);
        if (declared) {
          assert.equal(rule.authority && rule.authority.scope, 'file',
            `${rule.source.file}:${rule.source.line} changed which scope decides`);
        } else {
          // With no inline clause and no file section, the only scope left is the entity default —
          // and that only exists where the ENTITY file uses the new per-operation syntax. So a rule
          // gains authority only from text somebody wrote in grammar version 2. Never from nowhere.
          const target = model.entities.get(rule.trigger.entity);
          const entityDeclares = target
            && /^\s*[-*]?\s*(create|read|update|delete)\s*:/im.test(files.get(target.source.file) || '');
          if (entityDeclares) {
            assert.equal(rule.authority.scope, 'entity',
              `${rule.source.file}:${rule.source.line} should fall back to the entity default`);
          } else {
            assert.equal(rule.authorizedBy.length, 0,
              `${rule.source.file}:${rule.source.line} gained authority from nowhere`);
          }
        }
      }
    }

    // 4. The trees are still the size the manifesto asks for, so this test cannot pass vacuously.
    assert.ok(model.entities.size >= 15, `${root}: only ${model.entities.size} entities`);
    assert.ok(model.processes.length >= 20, `${root}: only ${model.processes.length} rules`);
  }
});

test('v1 compatibility — the manifesto goods-receipt rule in the REAL tree is unchanged', () => {
  // Appendix XII's rule, as it stands on disk, parsed in its own tree (agent F2 owns that tree and
  // extends it; this pins the manifesto's rule inside it, not the whole file). The four consequents
  // and — most importantly — the three TARGETING MECHANISMS are what "unchanged behaviour" means:
  // which document each consequent changes was decided by version 1 and is decided identically now.
  const { model, errors } = parseOperatingModel(loadTree('operating-model'));
  const rules = model.processes.filter(
    (r) => r.source.file === 'operating-model/processes/goods-receipt.md'
      && r.trigger.op === 'create' && r.trigger.entity === 'goods-receipt',
  );
  assert.ok(rules.length >= 1, 'the manifesto rule is still there');
  const rule = rules[0];
  assert.equal(rule.branches, undefined, 'a version-1 rule has no branches');
  assert.equal(rule.inlineAuthority, undefined);
  assert.deepEqual(rule.authorizedBy, ['warehouse-clerk', 'warehouse-management'],
    'the roles the manifesto prints, from the file scope, unchanged');
  assert.equal(rule.authority.scope, 'file');

  const texts = rule.conditions.map((c) => c.text);
  assert.ok(texts.includes('quantity > 0'), `conditions were ${JSON.stringify(texts)}`);
  assert.ok(texts.includes('order exists'));
  assert.ok(texts.some((t) => /order not already fully delivered/.test(t)));

  const stock = rule.consequents.find((c) => c.entity === 'stock');
  assert.ok(stock, 'the stock consequent is still there');
  assert.deepEqual(stock.targeting, { kind: 'key', fields: ['article', 'location'] },
    'mechanism KEY, via "## Identified by article and location" — decided exactly as in version 1');
  const fact = rule.consequents.find((c) => c.entity === 'goods-receipt-fact');
  assert.deepEqual(fact.targeting, { kind: 'self-id' });

  // No error anywhere in this tree comes from a version-1 construction losing its meaning.
  for (const e of errorsOf(errors)) {
    assert.doesNotMatch(e.message, /grammar version 1/,
      `a version-1 construction was refused by version 2:\n${e.message}`);
  }

  // The grammar version is a property of the RUNTIME, never of the text (§0): no file carries a
  // version marker, and none ever will.
  assert.equal(model.grammarVersion, 2);
  for (const [, text] of loadTree('operating-model')) {
    assert.doesNotMatch(text, /^grammar-version:/m);
  }
});

test('§13.3 an aggregate is deterministic whatever order the index hands rows back in', () => {
  // Contract non-negotiable #5, and it must hold across peers whose indexes iterate differently.
  const { model } = parseLedger();
  const docs = LEDGER_WORLD();
  const shuffled = (list) => {
    // A fixed, reproducible reversal — not Math.random(), which this repo does not use anywhere.
    const out = list.slice().reverse();
    return out;
  };
  const worldFrom = (list) => {
    const base = makeWorld(list);
    return { get: base.get, find: (entity, pred) => shuffled(base.find(entity, pred)) };
  };
  const intent = {
    op: 'create',
    entity: 'posting',
    id: 'JE-0001-3',
    doc: { 'journal-entry': 'JE-0001', account: '1200', debit: '0.01 EUR' },
    actorRoles: ['accountant'],
  };
  const forward = evaluate(model, intent, makeWorld(docs));
  const backward = evaluate(model, intent, worldFrom(docs));
  assert.equal(forward.ok, false);
  assert.equal(backward.ok, false);
  assert.deepEqual(
    backward.violations.map((v) => v.reason),
    forward.violations.map((v) => v.reason),
    'byte-identical refusals, so two peers refuse the same commit with the same words',
  );
});

test('§12/§18 the version-2 sections belong to an entity file, and are refused elsewhere', () => {
  for (const section of ['Invariants', 'Period', 'Dated in']) {
    const { errors } = parseOperatingModel(ledgerFiles({
      [THRESHOLD]: `# T\n\n## Rules\nIf Create journal-entry then Delete journal-entry\n\n## ${section}\n- x: y\n`,
    }));
    const d = errorsOf(errors).find((e) => e.file === THRESHOLD);
    assert.ok(d, `"## ${section}" in a process file must be refused`);
    assert.match(d.message, /describes a kind of document, so it belongs in an "information\/" file/);
  }
  // And an unknown section is still refused by name, with a suggestion — Principle 6 is not
  // weakened by having more sections to be wrong about.
  const { errors } = parseOperatingModel(ledgerFiles({
    [THRESHOLD]: '# T\n\n## Invariant\n- x: y\n',
  }));
  const d = errorsOf(errors).find((e) => e.file === THRESHOLD);
  assert.match(d.message, /unknown section "## Invariant"/);
  assert.match(d.message, /Did you mean "invariants"\?/);
});

test('grammar.md and parse.js agree about what exists — the spec is normative, so this must hold', () => {
  // grammar.md says: "If parse.js and this file disagree, that is a bug in parse.js." A file that
  // documents constructions the parser does not have, or vice versa, is how a specification rots.
  const spec = readFileSync('runtime/polism/grammar.md', 'utf8');
  assert.match(spec, /^grammar-version: 2$/m, 'the spec declares the version this runtime implements');
  assert.equal(GRAMMAR_VERSION, 2);

  for (const section of RUNTIME_SECTIONS) {
    const title = section.replace(/\b[a-z]/, (c) => c.toUpperCase());
    assert.match(spec, new RegExp(`\`## ${title}\``, 'i'), `grammar.md does not document "## ${section}"`);
  }
  // Every construction version 2 added has its own numbered section.
  for (const anchor of [
    '## 12. `## Invariants`', '## 13. Aggregation', '## 14. Branches', '## 15. Enumerations',
    '## 16. Authority in three scopes', '## 17. `with <field> from <other-field>`',
    '## 18. Periods', '## 19. Money is exact', '## 20. Known limits of version 2',
  ]) {
    assert.ok(spec.includes(anchor), `grammar.md is missing "${anchor}"`);
  }
  // And the four decisions FD-5 left open are answered in writing, not only in code.
  for (const decision of [
    'Scope: per commit, over what the commit touches or implicates (decision)',
    'The performance contract with the read path (decision)',
    'Evaluation order (decision)',
    'Why a period is an entity, and not a declaration (decision)',
  ]) {
    assert.ok(spec.includes(decision), `grammar.md does not decide: ${decision}`);
  }
  // The two aggregate functions, and only those two.
  assert.deepEqual(AGGREGATE_FUNCTIONS, ['sum', 'count']);
});

// ---------------------------------------------------------------------------------------------
// §21 Labelled creates (FD-5 item 8) — how a journal entry gets its two-to-four postings.
//
// Items 1 and 8 of FD-5 are one decision: an invariant over a set is worthless if the grammar
// cannot create the set. Every test below is about that sentence.
// ---------------------------------------------------------------------------------------------

const POSTING_RULE = 'operating-model/processes/journal-posting.md';

/** A ledger whose one rule creates a whole balanced entry, the way double-entry actually works. */
function postingFiles(rules, overrides = {}) {
  return ledgerFiles({
    'operating-model/information/posting.md': `# Posting

## Fields
- journal-entry: reference to journal-entry required
- account: reference to ledger-account required
- side: one of debit, credit required
- debit: money
- credit: money
`,
    [POSTING_RULE]: `# Journal posting

## Rules
${rules}

## Authorized by
accountant
`,
    ...overrides,
  });
}

const entry = (doc = {}) => ({
  op: 'create',
  entity: 'journal-entry',
  id: 'JE-0042',
  doc: { 'entry-date': '2027-04-03', status: 'draft', narrative: 'Sale', ...doc },
  actorRoles: ['accountant'],
});

test('§21 a balanced two-leg entry commits, and both legs land in the ONE commit', () => {
  const model = parseOk(postingFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "receivable" with account "1200" with side "debit" with debit "119.00 EUR" and
  Create posting as "revenue" with account "4400" with side "credit" with credit "119.00 EUR"`));

  const r = evaluate(model, entry(), makeWorld(LEDGER_WORLD()));
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true, 'debits equal credits, so the entry stands');

  // Appendix VIII: one business event, one commit. The entry and both legs, together.
  assert.deepEqual(r.changes.map((c) => [c.op, c.entity, c.id]), [
    ['create', 'journal-entry', 'JE-0042'],
    ['create', 'posting', 'JE-0042-receivable'],
    ['create', 'posting', 'JE-0042-revenue'],
  ]);
  // The id is exactly <trigger>-<label>. Deterministic: no counter, no clock, no randomness.
  assert.equal(r.changes[1].id, 'JE-0042-receivable');
  assert.equal(r.changes[2].id, 'JE-0042-revenue');
  // Each leg says whose leg it is, or the set could not be found and the invariant would silently
  // aggregate over nothing (§21).
  assert.equal(r.changes[1].after['journal-entry'], 'JE-0042');
  assert.equal(r.changes[2].after['journal-entry'], 'JE-0042');
  assert.equal(r.changes[1].after.side, 'debit');
  assert.equal(r.changes[2].after.side, 'credit');
  // The Change shape is untouched: the label lives in the id, so nothing in the contract moved.
  for (const c of r.changes) assert.deepEqual(Object.keys(c).sort(), ['after', 'before', 'entity', 'id', 'op']);
});

test('§21 a three-leg and a four-leg entry commit — VAT and a split payment', () => {
  const three = parseOk(postingFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "receivable" with account "1200" with side "debit" with debit "119.00 EUR" and
  Create posting as "revenue" with account "4400" with side "credit" with credit "100.00 EUR" and
  Create posting as "output-vat" with account "4400" with side "credit" with credit "19.00 EUR"`));
  const r3 = evaluate(three, entry(), makeWorld(LEDGER_WORLD()));
  assert.deepEqual(r3.violations, []);
  assert.equal(r3.ok, true, '119 debit = 100 + 19 credit, exactly');
  assert.deepEqual(r3.changes.map((c) => c.id), ['JE-0042', 'JE-0042-receivable', 'JE-0042-revenue', 'JE-0042-output-vat']);

  const four = parseOk(postingFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "bank" with account "1200" with side "debit" with debit "100.00 EUR" and
  Create posting as "cash-discount" with account "1200" with side "debit" with debit "19.00 EUR" and
  Create posting as "revenue" with account "4400" with side "credit" with credit "100.00 EUR" and
  Create posting as "output-vat" with account "4400" with side "credit" with credit "19.00 EUR"`));
  const r4 = evaluate(four, entry(), makeWorld(LEDGER_WORLD()));
  assert.deepEqual(r4.violations, []);
  assert.equal(r4.ok, true);
  assert.equal(r4.changes.length, 5, 'the entry plus four legs, in one commit');
  assert.deepEqual(r4.changes.slice(1).map((c) => c.id),
    ['JE-0042-bank', 'JE-0042-cash-discount', 'JE-0042-revenue', 'JE-0042-output-vat']);
  // A hyphenated label stays one path segment, because an id is a path segment.
  for (const c of r4.changes) assert.match(String(c.id), /^[A-Za-z0-9][A-Za-z0-9-]*$/);
});

test('§21 an unbalanced set is refused, quoting the invariant, and the balance is checked ONCE', () => {
  const model = parseOk(postingFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "receivable" with account "1200" with side "debit" with debit "119.00 EUR" and
  Create posting as "revenue" with account "4400" with side "credit" with credit "100.00 EUR"`));

  const r = evaluate(model, entry(), makeWorld(LEDGER_WORLD()));
  assert.equal(r.ok, false);
  assert.deepEqual(r.changes, [], 'nothing at all is written — not the entry, not either leg');

  // Checked ONCE against the staged world, not once per posting: exactly one violation, and it
  // names both totals of the completed set rather than complaining about the first leg alone.
  assert.equal(r.violations.length, 1, 'one invariant, one violation — not one per posting');
  const [v] = r.violations;
  assert.match(v.reason, /journal-entry "JE-0042" would not be balanced/);
  assert.match(v.reason, /is "119\.00 EUR", not equal to .*\("100\.00 EUR"\)/);
  assert.match(v.reason, /- balanced: sum of debit over posting for this journal-entry/);
  assert.equal(v.file, 'operating-model/information/journal-entry.md');

  // One cent is enough, and the arithmetic is exact.
  const cent = parseOk(postingFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "receivable" with account "1200" with side "debit" with debit "0.30 EUR" and
  Create posting as "a" with account "4400" with side "credit" with credit "0.10 EUR" and
  Create posting as "b" with account "4400" with side "credit" with credit "0.20 EUR"`));
  assert.notEqual(0.1 + 0.2, 0.3, 'a float would not have managed this');
  const exact = evaluate(cent, entry(), makeWorld(LEDGER_WORLD()));
  assert.deepEqual(exact.violations, []);
  assert.equal(exact.ok, true, '0.10 + 0.20 = 0.30, exactly');
});

test('§21 duplicate labels in one rule are a PARSE error, not an execution surprise', () => {
  const { model, errors } = parseOperatingModel(postingFiles(
    `If Create journal-entry then
  Create posting as "receivable" with account "1200" with side "debit" and
  Create posting as "receivable" with account "4400" with side "credit"`,
  ));
  const d = errorsOf(errors).find((e) => e.file === POSTING_RULE);
  assert.ok(d, 'refused when the repository is opened, not when the data arrives');
  assert.match(d.message, /creates two "posting" documents labelled "receivable", and they would need the same id/);
  assert.match(d.message, /a different label/);
  assert.match(d.message, /grammar\.md §21/);
  assert.equal(model.processes.filter((r) => r.source.file === POSTING_RULE).length, 0,
    'and the rule is not silently kept');

  // Two UNLABELLED creates of one entity collide for the same reason, and now say so at parse time.
  const unlabelled = parseOperatingModel(postingFiles(
    'If Create journal-entry then Create posting with account "1200" and Create posting with account "4400"',
  ));
  const u = errorsOf(unlabelled.errors).find((e) => e.file === POSTING_RULE);
  assert.match(u.message, /creates two "posting" documents with no label/);
  assert.match(u.message, /a label on each of them, for example: posting as "receivable"/);
});

test('§21 two branch arms may each create the same label, because only one arm runs', () => {
  const model = parseOk(postingFiles(`If Create journal-entry under condition entry-date exists then
  when status is "posted" then
    Create posting as "receivable" with account "1200" with side "debit" with debit "10.00 EUR" and
    Create posting as "revenue" with account "4400" with side "credit" with credit "10.00 EUR"
  otherwise
    Create posting as "receivable" with account "1200" with side "debit" with debit "5.00 EUR" and
    Create posting as "revenue" with account "4400" with side "credit" with credit "5.00 EUR"`));

  const world = makeWorld(LEDGER_WORLD());
  const posted = evaluate(model, entry({ status: 'posted' }), world);
  assert.deepEqual(posted.violations, []);
  assert.deepEqual(posted.changes.map((c) => c.id), ['JE-0042', 'JE-0042-receivable', 'JE-0042-revenue']);
  assert.equal(posted.changes[1].after.debit, '10.00 EUR');

  const draft = evaluate(model, entry({ status: 'draft' }), world);
  assert.deepEqual(draft.violations, []);
  assert.deepEqual(draft.changes.map((c) => c.id), ['JE-0042', 'JE-0042-receivable', 'JE-0042-revenue']);
  assert.equal(draft.changes[1].after.debit, '5.00 EUR', 'the other arm, same labels, no collision');

  // A collision inside ONE arm is still the error case.
  const inOneArm = parseOperatingModel(postingFiles(`If Create journal-entry then
  when status is "posted" then
    Create posting as "receivable" with account "1200" with side "debit" and
    Create posting as "receivable" with account "4400" with side "credit"
  otherwise
    Create posting as "receivable" with account "1200" with side "debit"`));
  const d = errorsOf(inOneArm.errors).find((e) => e.file === POSTING_RULE);
  assert.ok(d, 'the same label twice in one arm is refused');
  assert.match(d.message, /labelled "receivable"/);
});

test('§21 the label is in the id, so the commit trailer carries it — an auditor sees which leg', () => {
  const model = parseOk(postingFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "receivable" with account "1200" with side "debit" with debit "119.00 EUR" and
  Create posting as "output-vat" with account "4400" with side "credit" with credit "119.00 EUR"`));
  const r = evaluate(model, entry(), makeWorld(LEDGER_WORLD()));
  assert.equal(r.ok, true);

  // The kernel writes one `NeoDonkey-Change:` trailer per change, interpolating the id. Asserted
  // against the kernel's SOURCE rather than a copy of its format, so that if the audit property
  // ever moves, this test says so instead of quietly agreeing with itself.
  const kernel = readFileSync('runtime/kernel.js', 'utf8');
  assert.match(kernel, /NeoDonkey-Change: \$\{c\.op\} \$\{c\.entity\} \$\{c\.id\}/,
    'the trailer still carries the id, which is where the label lives');

  const trailers = r.changes.map((c) => `NeoDonkey-Change: ${c.op} ${c.entity} ${c.id}`);
  assert.deepEqual(trailers, [
    'NeoDonkey-Change: create journal-entry JE-0042',
    'NeoDonkey-Change: create posting JE-0042-receivable',
    'NeoDonkey-Change: create posting JE-0042-output-vat',
  ]);
  // "posting JE-0042-receivable" tells a Wirtschaftsprüfer more than "posting JE-0042-2" does.
  for (const t of trailers.slice(1)) assert.doesNotMatch(t, /JE-0042-[0-9]+$/);
});

test('§21 a labelled create is refused loudly when it is wrong — never guessed (Principle 6)', () => {
  const cases = [
    ['If Create journal-entry then Create posting as "Receivable Leg" with account "1200"',
      /is not a usable label/],
    ['If Create journal-entry then Create posting as "receivable/1" with account "1200"',
      /is not a usable label/],
    ['If Create journal-entry then Create posting as with account "1200"',
      /"as" must be followed by a label in double quotes/],
    ['If Create journal-entry then Update posting as "receivable" with side "debit"',
      /"as" says which of several NEW documents this is, so it has no meaning for "Update"/],
    ['If Create journal-entry then Delete posting as "receivable"',
      /has no meaning for "Delete"/],
  ];
  for (const [body, pattern] of cases) {
    const { errors } = parseOperatingModel(postingFiles(body));
    const d = errorsOf(errors).find((e) => e.file === POSTING_RULE);
    assert.ok(d, `"${body.slice(0, 60)}…" must be refused`);
    assert.match(d.message, pattern);
  }

  // An unlabelled create of the trigger's own entity still collides and is still refused; WITH a
  // label there is no collision, so the reason is gone and it is allowed.
  const collides = parseOperatingModel(postingFiles('If Create journal-entry then Create journal-entry'));
  assert.match(errorsOf(collides.errors).map((e) => e.message).join('\n'), /both would need the same id/);
  assert.match(errorsOf(collides.errors).map((e) => e.message).join('\n'), /or a label, which gives the new one its own id/);
  const labelled = parseOk(postingFiles('If Create journal-entry under condition entry-date exists then Create journal-entry as "reversal" with status "cancelled"'));
  const rev = evaluate(labelled, entry(), makeWorld(LEDGER_WORLD()));
  assert.deepEqual(rev.violations, []);
  assert.deepEqual(rev.changes.map((c) => c.id), ['JE-0042', 'JE-0042-reversal']);

  // Two candidate back-references is the §10.5 ambiguity, and it is refused rather than picked.
  const ambiguous = parseOperatingModel(postingFiles(
    'If Create journal-entry then Create posting as "receivable" with account "1200" with side "debit"',
    {
      'operating-model/information/posting.md': `# Posting

## Fields
- journal-entry: reference to journal-entry required
- reversed-entry: reference to journal-entry
- account: reference to ledger-account required
- side: one of debit, credit required
- debit: money
- credit: money
`,
    },
  ));
  const a = errorsOf(ambiguous.errors).find((e) => e.file === POSTING_RULE);
  assert.ok(a, 'two references to the trigger entity is ambiguous, so it is refused');
  assert.match(a.message, /has 2 references to "journal-entry"/);
  assert.match(a.message, /"journal-entry", "reversed-entry"/);
});

test('§21 FD-5 item 8 is normative in grammar.md, and §20.9 no longer calls it a hole', () => {
  const spec = readFileSync('runtime/polism/grammar.md', 'utf8');
  assert.ok(spec.includes('## 21. `Create <entity> as "<label>"`'), 'grammar.md documents the construct');
  assert.doesNotMatch(spec, /\| 20\.9 \|/, '§20.9 is no longer a known limit — it shipped');
  assert.match(spec, /^grammar-version: 2$/m, 'and it is additive, so the version does not move');
  assert.equal(GRAMMAR_VERSION, 2);
});

test('§13 REGRESSION — the balance invariant parses in its natural one-line, two-sided form', () => {
  // The defect: the `where … is this` diagnostic scanned the rest of the condition for the word
  // `this`, so a legitimate `for this` on the RIGHT-hand side was misread as a misuse on the left.
  // That made the single most important sentence in the product unwritable in one line.
  const ONE_LINE = 'sum of amount over posting for this journal-entry where side is "debit"'
    + ' = sum of amount over posting for this journal-entry where side is "credit"';

  const oneLine = parseOperatingModel(sidedLedger(`- balanced: ${ONE_LINE}`));
  assert.deepEqual(errorsOf(oneLine.errors).map((e) => e.message), [],
    'the one-line form is valid grammar version 2 and must parse');

  // It resolves to what it says: two aggregates, each scoped to this entry, each filtered to one
  // side, both money — and both compiled into filters an index can answer (§13.3).
  const inv = oneLine.model.entities.get('journal-entry').invariants.get('balanced');
  assert.ok(inv, 'the invariant is declared');
  assert.equal(inv.conditions.length, 1, 'one condition, not a chain');
  const [c] = inv.conditions;
  assert.equal(c.op, '=');
  for (const [agg, side] of [[c.subjectAgg, 'debit'], [c.valueAgg, 'credit']]) {
    assert.equal(agg.fn, 'sum');
    assert.equal(agg.field, 'amount');
    assert.equal(agg.entity, 'posting');
    assert.deepEqual(agg.scope, { entity: 'journal-entry' });
    assert.equal(agg.where.field, 'side');
    assert.equal(agg.where.op, '=');
    assert.equal(agg.where.value.value, side, 'each side filters to its own side');
    assert.equal(agg.resolved.fieldType, 'money', 'and it is money, so the sum is exact');
    assert.deepEqual(agg.resolved.filters.map((f) => f.field), ['journal-entry', 'side'],
      'both the link and the where compile into filters — no residual scan (§13.3)');
  }

  // The chained form agent F2 used as a workaround is transitively equivalent, and both forms
  // refuse the same unbalanced entry with the same arithmetic.
  const chained = parseOperatingModel(sidedLedger(
    `- debits agree: debit-amount = sum of amount over posting for this journal-entry where side is "debit"
- credits agree: credit-amount = sum of amount over posting for this journal-entry where side is "credit"
- balanced: debit-amount = credit-amount`,
  ));
  assert.deepEqual(errorsOf(chained.errors).map((e) => e.message), []);

  const world = (debit, credit) => makeWorld([
    ...LEDGER_WORLD().filter((d) => d.entity !== 'posting' && d.entity !== 'journal-entry'),
    {
      id: 'JE-0042', entity: 'journal-entry', 'entry-date': '2027-04-03', status: 'draft',
      'debit-amount': debit, 'credit-amount': credit,
    },
    { id: 'JE-0042-receivable', entity: 'posting', 'journal-entry': 'JE-0042', side: 'debit', amount: debit },
    { id: 'JE-0042-revenue', entity: 'posting', 'journal-entry': 'JE-0042', side: 'credit', amount: credit },
  ]);
  const touch = { op: 'update', entity: 'journal-entry', id: 'JE-0042', doc: {}, actorRoles: ['accountant'] };

  for (const model of [oneLine.model, chained.model]) {
    assert.equal(evaluate(model, touch, world('119.00 EUR', '119.00 EUR')).ok, true,
      'balanced: both forms accept');
    const off = evaluate(model, touch, world('119.00 EUR', '118.99 EUR'));
    assert.equal(off.ok, false, 'one cent out: both forms refuse');
    assert.match(off.violations.map((v) => v.reason).join('\n'), /119\.00 EUR/);
    assert.match(off.violations.map((v) => v.reason).join('\n'), /118\.99 EUR/);
  }

  // The one-line form names the two sums directly, which is the point of writing it in one line.
  const refusal = evaluate(oneLine.model, touch, world('119.00 EUR', '118.99 EUR')).violations[0].reason;
  assert.match(refusal, /would not be balanced/);
  assert.match(refusal, /sum of amount over posting for this journal-entry where side is "debit" is "119\.00 EUR"/);
  assert.match(refusal, /where side is "credit" \("118\.99 EUR"\)/);

  // And `where <field> is this` — the thing that diagnostic exists for — is still refused.
  const misuse = parseOperatingModel(sidedLedger(
    '- balanced: count of posting where journal-entry is this > 0',
  ));
  const d = errorsOf(misuse.errors).find((e) => /is this/.test(e.message));
  assert.ok(d, 'the real misuse is still named');
  assert.match(d.message, /"for this <entity>" BEFORE the "where"/);
});

/** A ledger whose postings carry a `side` and an `amount`, plus header totals for the chained form. */
function sidedLedger(invariants) {
  return ledgerFiles({
    'operating-model/information/journal-entry.md': `# Journal entry

## Fields
- entry-date: date required
- status: one of draft, posted, cancelled required
- debit-amount: money
- credit-amount: money

## Invariants
${invariants}
`,
    'operating-model/information/posting.md': `# Posting

## Fields
- journal-entry: reference to journal-entry required
- side: one of debit, credit required
- amount: money required
- position: number
`,
  });
}

// ---------------------------------------------------------------------------------------------
// §17 (FD-5 item 9) — `with <field> from <other-field>`, the SET twin of the counter twin.
//
// A labelled create is useless without this: a posting's account number, ledger account, amount
// and date come from the chart, the invoice and the entry, and none of those is a literal. Items
// 1, 8 and 9 are one sentence — create the legs, fill the legs, check the total.
// ---------------------------------------------------------------------------------------------

/** The ledger F2 actually needs: an entry whose legs are filled from the chart and the invoice. */
function schemeFiles(rules, overrides = {}) {
  const files = new Map([
    ['operating-model/information/journal-entry.md', `# Journal entry

## Fields
- entry-date: date required
- invoice: reference to invoice
- chart: reference to chart-of-accounts
- status: one of draft, posted required

## Invariants
- balanced: sum of amount over posting for this journal-entry where side is "debit" = sum of amount over posting for this journal-entry where side is "credit"
`],
    ['operating-model/information/posting.md', `# Posting

## Fields
- journal-entry: reference to journal-entry required
- account-number: text required
- ledger-account: reference to ledger-account required
- side: one of debit, credit required
- amount: money required
- posting-date: date required
- vat-role: one of none, output-tax, input-tax
`],
    ['operating-model/information/ledger-account.md', '# Ledger account\n\n## Fields\n- name: text\n'],
    ['operating-model/information/chart-of-accounts.md', `# Chart of accounts

## Fields
- receivables-account-number: text
- receivables-account: reference to ledger-account
- revenue-account-number: text
- revenue-account: reference to ledger-account
- default-vat-role: one of none, output-tax, input-tax
- house-currency: text
`],
    ['operating-model/information/invoice.md', `# Invoice

## Fields
- gross-amount: money required
- net-amount: money required
- line-count: number
- customer-name: text
`],
    ['operating-model/processes/journal-posting.md', `# Journal posting\n\n## Rules\n${rules}\n`],
  ]);
  for (const [k, value] of Object.entries(overrides)) {
    if (value === null) files.delete(k);
    else files.set(k, value);
  }
  return files;
}

const SCHEME_RULE = 'operating-model/processes/journal-posting.md';

const schemeWorld = () => [
  {
    id: 'CH-1', entity: 'chart-of-accounts',
    'receivables-account-number': '1200', 'receivables-account': 'LA-1200',
    'revenue-account-number': '4400', 'revenue-account': 'LA-4400',
    'default-vat-role': 'output-tax', 'house-currency': 'EUR',
  },
  { id: 'LA-1200', entity: 'ledger-account', name: 'Bank' },
  { id: 'LA-4400', entity: 'ledger-account', name: 'Revenue' },
  {
    id: 'INV-1', entity: 'invoice', 'gross-amount': '119.00 EUR', 'net-amount': '100.00 EUR',
    'line-count': 3, 'customer-name': 'KoRo GmbH',
  },
];

const schemeEntry = (doc = {}) => ({
  op: 'create',
  entity: 'journal-entry',
  id: 'JE-0042',
  doc: { 'entry-date': '2027-04-03', invoice: 'INV-1', chart: 'CH-1', status: 'draft', ...doc },
  actorRoles: [],
});

test('§17 a journal entry posts end to end: legs created, legs FILLED from one hop, total checked', () => {
  const model = parseOk(schemeFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "receivable"
    with side "debit"
    with account-number from chart.receivables-account-number
    with ledger-account from chart.receivables-account
    with amount from invoice.gross-amount
    with posting-date from entry-date and
  Create posting as "revenue"
    with side "credit"
    with account-number from chart.revenue-account-number
    with ledger-account from chart.revenue-account
    with amount from invoice.gross-amount
    with posting-date from entry-date
    with vat-role from chart.default-vat-role`));

  const r = evaluate(model, schemeEntry(), makeWorld(schemeWorld()));
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true, 'debits equal credits, so the entry is posted');
  assert.equal(r.changes.length, 3, 'the entry and both legs, in ONE commit');

  const [, debit, credit] = r.changes;
  assert.deepEqual(debit.after, {
    id: 'JE-0042-receivable', entity: 'posting', 'journal-entry': 'JE-0042',
    side: 'debit', 'account-number': '1200', 'ledger-account': 'LA-1200',
    amount: '119.00 EUR', 'posting-date': '2027-04-03',
  }, 'every field of the leg came from a declaration, none from a literal in the rule');
  assert.equal(credit.after['account-number'], '4400');
  assert.equal(credit.after['ledger-account'], 'LA-4400', 'a reference copies its id, not the document');
  assert.equal(credit.after.amount, '119.00 EUR');
  assert.equal(credit.after['vat-role'], 'output-tax', 'an enum copies into a compatible enum');
  // §21.3 still links each leg to its entry, or the balance invariant would see an empty set.
  assert.equal(debit.after['journal-entry'], 'JE-0042');
  assert.equal(credit.after['journal-entry'], 'JE-0042');

  // And the invariant is load-bearing: change one leg's source and the commit is refused.
  const unbalanced = parseOk(schemeFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "receivable"
    with side "debit"
    with account-number from chart.receivables-account-number
    with ledger-account from chart.receivables-account
    with amount from invoice.gross-amount
    with posting-date from entry-date and
  Create posting as "revenue"
    with side "credit"
    with account-number from chart.revenue-account-number
    with ledger-account from chart.revenue-account
    with amount from invoice.net-amount
    with posting-date from entry-date`));
  const off = evaluate(unbalanced, schemeEntry(), makeWorld(schemeWorld()));
  assert.equal(off.ok, false, '119.00 debit against 100.00 credit is not an entry');
  assert.deepEqual(off.changes, []);
  assert.match(off.violations[0].reason, /would not be balanced/);
  assert.match(off.violations[0].reason, /"119\.00 EUR"/);
  assert.match(off.violations[0].reason, /"100\.00 EUR"/);
});

test('§17.1 one hop, and exactly one — a second hop is refused by name', () => {
  const model = parseOk(schemeFiles(
    'If Create journal-entry then Create posting as "x" with amount from invoice.gross-amount with side "debit" with account-number from chart.revenue-account-number with ledger-account from chart.revenue-account with posting-date from entry-date',
  ));
  const cons = model.processes[0].consequents[0];
  const amount = cons.clauses.find((c) => c.field === 'amount');
  assert.equal(amount.kind, 'copy');
  assert.deepEqual(amount.from, { root: 'invoice', field: 'gross-amount', text: 'invoice.gross-amount', line: 4 });
  assert.deepEqual(amount.resolvedFrom.steps, [
    { step: 'ref', field: 'invoice', entity: 'invoice' },
    { step: 'value', field: 'gross-amount' },
  ], 'the hop is a plan the parser computed, not a path execute.js walks by guessing');
  assert.equal(amount.resolvedFrom.type, 'money');

  const twoHops = parseOperatingModel(schemeFiles(
    'If Create journal-entry then Create posting as "x" with account-number from invoice.customer.name',
  ));
  const d = errorsOf(twoHops.errors).find((e) => e.file === SCHEME_RULE);
  assert.match(d.message, /goes through 2 references. A "from" follows one reference only/);
  assert.match(d.message, /grammar\.md §20\.1/, 'and it says why two hops are not coming');

  // A hop through something that is not a reference is refused, naming what it is.
  const notARef = parseOperatingModel(schemeFiles(
    'If Create journal-entry then Create posting as "x" with account-number from status.value',
  ));
  const n = errorsOf(notARef.errors).find((e) => e.file === SCHEME_RULE);
  assert.match(n.message, /"status" is one of "draft", "posted" on "journal-entry", so "status\.value" has no meaning/);

  // A field that does not exist at the far end is refused, listing the ones that do.
  const noField = parseOperatingModel(schemeFiles(
    'If Create journal-entry then Create posting as "x" with account-number from chart.nonesuch',
  ));
  const f = errorsOf(noField.errors).find((e) => e.file === SCHEME_RULE);
  assert.match(f.message, /reads "nonesuch", which is not a field of "chart-of-accounts"/);
  assert.match(f.message, /"receivables-account-number"/);
});

test('§17.2 a "from" that cannot carry its value is a PARSE error naming both declarations', () => {
  const cases = [
    // money into text, and text into money
    ['with account-number from invoice.gross-amount', /one is money and the other is text/],
    ['with amount from chart.house-currency', /one is text and the other is money/],
    // a count is not an amount of money (FD-1)
    ['with amount from invoice.line-count', /an amount of money is not a count/],
    // a reference and a plain value are not interchangeable
    ['with ledger-account from chart.revenue-account-number', /one of them points at another document and the other is a plain value/],
    ['with account-number from chart.revenue-account', /one of them points at another document and the other is a plain value/],
    // a reference to the wrong entity
    ['with ledger-account from invoice', /one points at an invoice and the other at a ledger-account/],
    // text into a closed set could carry anything
    ['with side from chart.house-currency', /could carry any value at all into a closed set/],
    // an enum whose values are not all allowed by the target
    ['with side from chart.default-vat-role', /it can be "none", "output-tax", "input-tax", which the target does not allow/],
  ];
  for (const [clause, pattern] of cases) {
    const { errors } = parseOperatingModel(schemeFiles(
      `If Create journal-entry then Create posting as "x" ${clause}`,
    ));
    const d = errorsOf(errors).find((e) => e.file === SCHEME_RULE && /cannot carry the value across/.test(e.message));
    assert.ok(d, `"${clause}" must be refused`);
    assert.match(d.message, pattern);
    // Both declarations are named, so the author can see the two lines that disagree.
    assert.match(d.message, /operating-model\/information\/[a-z-]+\.md:\d+/);
  }

  // The compatible crossings are allowed: an enumeration into text, and identical types. Both legs,
  // so the entry balances and the crossing is what is being tested rather than the invariant.
  const leg = (labelName, sideValue) => `Create posting as "${labelName}"`
    + ` with side "${sideValue}" with account-number from status`
    + ' with amount from invoice.gross-amount with ledger-account from chart.revenue-account'
    + ' with posting-date from entry-date';
  const ok = parseOk(schemeFiles(
    `If Create journal-entry then ${leg('d', 'debit')} and ${leg('c', 'credit')}`,
  ));
  const r = evaluate(ok, schemeEntry(), makeWorld(schemeWorld()));
  assert.deepEqual(r.violations, []);
  assert.equal(r.changes[1].after['account-number'], 'draft', 'an enumeration is text, so it copies into text');
  assert.equal(r.changes[2].after['account-number'], 'draft');
});

test('§17 a missing referenced document is refused; an empty value is left to "required"', () => {
  const model = parseOk(schemeFiles(`If Create journal-entry under condition entry-date exists then
  Create posting as "x"
    with side "debit"
    with account-number from chart.receivables-account-number
    with ledger-account from chart.receivables-account
    with amount from invoice.gross-amount
    with posting-date from entry-date`));

  // The model asserted a relationship that is not there: refused, naming the document.
  const missing = evaluate(model, schemeEntry({ invoice: 'INV-999' }), makeWorld(schemeWorld()));
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.changes, []);
  assert.match(missing.violations[0].reason, /with amount from invoice\.gross-amount" cannot be done/);
  assert.match(missing.violations[0].reason, /there is no invoice with the id "INV-999"/);

  // No reference filled in at all is the same class of refusal, and says which field is empty.
  const noRef = evaluate(model, schemeEntry({ chart: undefined }), makeWorld(schemeWorld()));
  assert.equal(noRef.ok, false);
  assert.match(noRef.violations.map((v) => v.reason).join('\n'), /no chart is filled in on it/);

  // An EMPTY value at the far end writes nothing, and `required` is what refuses — a better
  // message than this clause could give.
  const emptyAtFarEnd = evaluate(model, schemeEntry(), makeWorld([
    ...schemeWorld().filter((d) => d.id !== 'CH-1'),
    { id: 'CH-1', entity: 'chart-of-accounts', 'receivables-account': 'LA-1200' },
  ]));
  assert.equal(emptyAtFarEnd.ok, false);
  assert.match(emptyAtFarEnd.violations.map((v) => v.reason).join('\n'),
    /"account-number" must be filled in on every posting/);
});

test('§17 the counter form and the set form resolve through the SAME code, so they cannot drift', () => {
  // `+field from x.y` and `field from x.y` share fromSource/resolveFromSource. An asymmetry where
  // one accepted a hop and the other did not would be a wart, so it is asserted away.
  const model = parseOk(schemeFiles(
    `If Create journal-entry then Update ledger-account with +balance from invoice.gross-amount`,
    {
      'operating-model/information/ledger-account.md': '# Ledger account\n\n## Fields\n- name: text\n- balance: money\n',
      'operating-model/information/journal-entry.md': `# Journal entry

## Fields
- entry-date: date required
- invoice: reference to invoice
- ledger-account: reference to ledger-account
- status: one of draft, posted required
`,
    },
  ));
  const clause = model.processes[0].consequents[0].clauses[0];
  assert.equal(clause.kind, 'add');
  assert.deepEqual(clause.resolvedFrom.steps, [
    { step: 'ref', field: 'invoice', entity: 'invoice' },
    { step: 'value', field: 'gross-amount' },
  ], 'a counter hops too, through the same resolver');

  const r = evaluate(model, {
    op: 'create',
    entity: 'journal-entry',
    id: 'JE-1',
    doc: { 'entry-date': '2027-04-03', invoice: 'INV-1', 'ledger-account': 'LA-1200', status: 'draft' },
    actorRoles: [],
  }, makeWorld([
    ...schemeWorld().filter((d) => d.id !== 'LA-1200'),
    { id: 'LA-1200', entity: 'ledger-account', name: 'Bank', balance: '0.01 EUR' },
  ]));
  const account = r.changes.find((c) => c.entity === 'ledger-account');
  assert.equal(account.after.balance, '119.01 EUR', 'exact, one hop away, no float');
});

test('§17/§21 FD-5 items 8 and 9 are normative in grammar.md, and version 2 still does not move', () => {
  const spec = readFileSync('runtime/polism/grammar.md', 'utf8');
  assert.ok(spec.includes('## 17. `with <field> from <other-field>`'), '§17 documents both forms');
  assert.ok(spec.includes('### 17.1'), 'and the one-hop rule');
  assert.ok(spec.includes('### 17.2'), 'and the type rule');
  assert.match(spec, /^grammar-version: 2$/m);
  assert.equal(GRAMMAR_VERSION, 2);
});
