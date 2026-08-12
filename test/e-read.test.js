/**
 * test/e-read.test.js — the Read Path (agent E, runtime/read/).
 *
 * Zero dependencies: node:test + node:assert only. No git module needed — the object reader
 * is injected, which is exactly the seam the contract asks for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { materialize, update, indexOf, parseDocPath, docPath } from '../runtime/read/index.js';
import { select, QueryError, compareValues } from '../runtime/read/query.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// A fake object reader. Stands in for runtime/git/'s objectStore + repo.
// `readTree()` → flat path -> oid;  `readBlob(oid)` → bytes.
// Values may be: a JS object (serialized to JSON), a string (raw), a Uint8Array (opaque
// bytes, i.e. something this peer cannot decrypt), or the sentinel THROWS.
// ---------------------------------------------------------------------------
const THROWS = Symbol('readBlob throws');

function fakeRepo(files) {
  const blobs = new Map();
  const tree = new Map();
  let n = 0;
  const oidFor = () => (++n).toString(16).padStart(40, '0');

  for (const [path, value] of files) {
    const oid = oidFor();
    tree.set(path, oid);
    if (value === THROWS) blobs.set(oid, THROWS);
    else if (value instanceof Uint8Array) blobs.set(oid, value);
    else if (typeof value === 'string') blobs.set(oid, enc.encode(value));
    else blobs.set(oid, enc.encode(JSON.stringify(value)));
  }

  return {
    tree,
    readTree: async () => new Map(tree),
    readBlob: async (oid) => {
      const b = blobs.get(oid);
      if (b === THROWS) throw new Error('AES-GCM: authentication tag mismatch');
      if (b === undefined) return null;
      return b;
    },
    /** Apply a patch, return {repo, changed, removed} — what a diff of two commits gives us. */
    patch(edits) {
      const next = new Map(files);
      const removed = [];
      for (const [path, value] of edits) {
        if (value === null) {
          next.delete(path);
          removed.push(path);
        } else {
          next.set(path, value);
        }
      }
      const repo2 = fakeRepo(next);
      const changed = new Map();
      for (const [path, value] of edits) {
        if (value !== null) changed.set(path, repo2.tree.get(path));
      }
      return { repo: repo2, changed, removed };
    },
  };
}

/** Deterministic PRNG (no Math.random anywhere, per the contract). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canonical, comparable picture of an entire index — the whole observable surface. */
function snapshot(index) {
  const docs = {};
  for (const entity of index.entities()) {
    docs[entity] = index.all(entity).map((d) => JSON.stringify(d));
  }
  return { stats: index.stats(), problems: index.problems(), docs };
}

// ---------------------------------------------------------------------------
// Fixture for Appendix VI's own example query.
// "all invoices over 10,000 EUR from Q3 2027 for customers in Bavaria"
// Region lives on the customer, amount/date/currency on the invoice → needs the join.
// ---------------------------------------------------------------------------
const OPAQUE = new Uint8Array([0xff, 0xfe, 0x9c, 0x00, 0x42, 0x81]); // invalid UTF-8

function fixture() {
  return new Map([
    // --- customers -------------------------------------------------------
    ['documents/customer/C-001.json', { id: 'C-001', entity: 'customer', name: 'Alpenhof GmbH', region: 'Bavaria', city: 'München' }],
    ['documents/customer/C-002.json', { id: 'C-002', entity: 'customer', name: 'Spree Handel AG', region: 'Berlin', city: 'Berlin' }],
    ['documents/customer/C-003.json', { id: 'C-003', entity: 'customer', name: 'Frankenland KG', region: 'Bavaria', city: 'Nürnberg' }],
    // C-004 exists in the repo but this peer holds no key for it (Appendix VII).
    ['documents/customer/C-004.json', OPAQUE],

    // --- invoices: boundaries on amount, on the quarter, on region, on currency
    ['documents/invoice/INV-001.json', inv('INV-001', 'C-001', 10000.01, '2027-07-01')], // IN  (just over, first day of Q3)
    ['documents/invoice/INV-002.json', inv('INV-002', 'C-001', 10000.0, '2027-08-15')],  // out (not *over* 10,000)
    ['documents/invoice/INV-003.json', inv('INV-003', 'C-001', 9999.99, '2027-08-15')],  // out (just under)
    ['documents/invoice/INV-004.json', inv('INV-004', 'C-003', 25000, '2027-09-30')],    // IN  (last day of Q3)
    ['documents/invoice/INV-005.json', inv('INV-005', 'C-003', 25000, '2027-10-01')],    // out (Q4)
    ['documents/invoice/INV-006.json', inv('INV-006', 'C-003', 25000, '2027-06-30')],    // out (Q2)
    ['documents/invoice/INV-007.json', inv('INV-007', 'C-002', 50000, '2027-08-01')],    // out (Berlin)
    ['documents/invoice/INV-008.json', inv('INV-008', 'C-001', 12000, '2028-08-01')],    // out (Q3 2028)
    ['documents/invoice/INV-009.json', inv('INV-009', 'C-004', 30000, '2027-08-02')],    // out (customer opaque → join unresolved)
    ['documents/invoice/INV-010.json', inv('INV-010', 'C-001', 40000, '2027-09-15')],    // IN
    ['documents/invoice/INV-011.json', { id: 'INV-011', entity: 'invoice', total: 99999, currency: 'EUR', date: '2027-08-08' }], // out (no customer ref)
    ['documents/invoice/INV-012.json', inv('INV-012', 'C-001', 20000, '2027-08-09', 'USD')], // out (not EUR)

    // --- the shadow of Appendix VII, and non-documents --------------------
    ['documents/salary/S-001.json', OPAQUE],
    ['documents/salary/S-002.json', OPAQUE],
    ['documents/board-minutes/BM-001.json', THROWS],                 // decrypt attempt throws
    ['documents/invoice/INV-BROKEN.json', '{"id": "INV-BROKEN", tru'], // truncated JSON
    ['documents/invoice/INV-ARRAY.json', [1, 2, 3]],                  // parses, not a document
    ['documents/invoice/INV-WRONGID.json', { id: 'INV-999', entity: 'invoice', total: 1 }], // contradicts its path
    ['documents/memo/M-001.json', { id: 'M-001', entity: 'memo', text: 'lone survivor' }],
    ['operating-model/processes/goods-receipt.md', '# Goods Receipt\n'],
    ['operating-model/information/invoice.md', '# Invoice\n'],
    ['README.md', '# a folder, with her company inside\n'],
  ]);
}

function inv(id, customer, total, date, currency = 'EUR') {
  return { id, entity: 'invoice', customer, total, currency, date, vatRate: 19 };
}

/** Appendix VI's sentence, as a Query. */
const BAVARIA_Q3_2027 = {
  from: 'invoice',
  join: { as: 'customer', from: 'customer', on: 'customer' },
  where: {
    total: { op: '>', value: 10000 },
    currency: 'EUR',
    date: { op: 'between', value: ['2027-07-01', '2027-09-30'] },
    'customer.region': 'Bavaria',
  },
  orderBy: 'total',
  desc: true,
};

// ===========================================================================

test('path convention round-trips and rejects non-documents', () => {
  assert.deepEqual(parseDocPath('documents/goods-receipt/GR-0001.json'), {
    entity: 'goods-receipt',
    id: 'GR-0001',
  });
  assert.equal(docPath('goods-receipt', 'GR-0001'), 'documents/goods-receipt/GR-0001.json');
  assert.equal(parseDocPath('operating-model/processes/x.md'), null);
  assert.equal(parseDocPath('documents/invoice.json'), null);
  assert.equal(parseDocPath('documents/invoice/nested/INV-1.json'), null);
  assert.equal(parseDocPath('documents/invoice/INV-1.txt'), null);
});

test("Appendix VI's example query: invoices > 10,000 EUR, Q3 2027, customers in Bavaria", async () => {
  const repo = fakeRepo(fixture());
  const index = await materialize({ ...repo, builtFrom: 'a'.repeat(40) });

  const rows = index.select(BAVARIA_Q3_2027);
  assert.deepEqual(
    rows.map((d) => d.id),
    ['INV-010', 'INV-004', 'INV-001'],
    'ordered by total desc',
  );

  // Boundaries, stated one by one so a regression names itself.
  const ids = new Set(rows.map((d) => d.id));
  assert.ok(ids.has('INV-001'), '10,000.01 is over 10,000');
  assert.ok(!ids.has('INV-002'), 'exactly 10,000.00 is not *over* 10,000');
  assert.ok(!ids.has('INV-003'), '9,999.99 is under');
  assert.ok(ids.has('INV-004'), '2027-09-30 is inside Q3');
  assert.ok(!ids.has('INV-005'), '2027-10-01 is Q4');
  assert.ok(!ids.has('INV-006'), '2027-06-30 is Q2');
  assert.ok(!ids.has('INV-007'), 'Berlin is not Bavaria');
  assert.ok(!ids.has('INV-008'), 'Q3 of the wrong year');
  assert.ok(!ids.has('INV-011'), 'no customer reference at all');
  assert.ok(!ids.has('INV-012'), 'USD is not EUR');

  // Appendix VII in the query plane: the Bavarian-ness of C-004 is unknowable to this peer,
  // so the inner join drops INV-009. It is not "hidden by permission" — the fact is absent.
  assert.ok(!ids.has('INV-009'), 'unresolvable reference is dropped by the (inner) join');
  assert.equal(index.get('customer', 'C-004'), null);

  // The same sentence, aggregated.
  assert.equal(index.select({ ...BAVARIA_Q3_2027, count: true, orderBy: undefined }), 3);
  assert.equal(
    index.select({ ...BAVARIA_Q3_2027, sum: 'total', orderBy: undefined }),
    10000.01 + 25000 + 40000,
  );
  // Top-2 by amount, then summed: `limit` always means rows.
  assert.equal(index.select({ ...BAVARIA_Q3_2027, limit: 2, sum: 'total' }), 65000);
});

test('join: required:false is a left join and keeps the unresolvable row', async () => {
  const repo = fakeRepo(fixture());
  const index = await materialize(repo);

  const rows = index.select({
    from: 'invoice',
    join: { as: 'customer', from: 'customer', on: 'customer', required: false },
    where: { total: { op: '>', value: 10000 }, date: { op: 'between', value: ['2027-07-01', '2027-09-30'] } },
    orderBy: 'id',
  });
  // No region filter here, so everything over 10,000 in Q3 2027 survives — including
  // INV-009, whose customer document this peer cannot read. The inner join dropped it.
  assert.deepEqual(rows.map((d) => d.id), [
    'INV-001', 'INV-004', 'INV-007', 'INV-009', 'INV-010', 'INV-011', 'INV-012',
  ]);

  // ... and a left join can be used to *find* what this peer cannot read.
  const unreadable = index.select({
    from: 'invoice',
    join: { as: 'customer', from: 'customer', on: 'customer', required: false },
    where: { 'customer.id': { op: 'exists', value: false }, customer: { op: 'exists', value: true } },
  });
  assert.deepEqual(unreadable.map((d) => d.id), ['INV-009']);
});

test('join: the result rows are always documents of `from` (semi-join, not a widened row)', async () => {
  const index = await materialize(fakeRepo(fixture()));
  const [row] = index.select({
    from: 'invoice',
    join: { as: 'customer', from: 'customer', on: 'customer' },
    where: { id: 'INV-010' },
  });
  assert.equal(row.entity, 'invoice');
  assert.equal(row.customer, 'C-001', 'the reference field is untouched');
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'region'), false);
});

test('unknown query keys and unknown operators are refused loudly (Principle 6)', async () => {
  const index = await materialize(fakeRepo(fixture()));
  assert.throws(() => index.select({ from: 'invoice', having: 1 }), QueryError);
  assert.throws(() => index.select({ from: 'invoice', where: { total: { op: '~=', value: 1 } } }), QueryError);
  assert.throws(() => index.select({ from: 'invoice', join: { as: 'c', from: 'customer', onn: 'customer' } }), QueryError);
  assert.throws(() => index.select({ from: 'invoice', sum: 'total', count: true }), QueryError);
  assert.throws(() => index.select({ from: 'invoice', limit: -1 }), QueryError);
  assert.throws(() => index.select({ where: {} }), QueryError);
  assert.throws(() => index.select({ from: 'invoice', where: { total: { op: 'in', value: 5 } } }), QueryError);
  assert.throws(
    () => index.select({ from: 'invoice', where: { total: { op: 'between', value: [1] } } }),
    QueryError,
  );
});

test('opaque and invalid blobs are skipped, counted, and never fatal (Appendix VII)', async () => {
  const repo = fakeRepo(fixture());
  const index = await materialize({ ...repo, builtFrom: 'b'.repeat(40) });
  const st = index.stats();

  // 5 opaque: C-004, salary S-001/S-002, BM-001 (decrypt threw), INV-BROKEN (unparseable —
  // indistinguishable from ciphertext, so it counts as opaque, not as an error).
  assert.equal(st.opaque, 5);
  // 2 invalid: parsed fine but is not a document (array) / contradicts its own path.
  assert.equal(st.invalid, 2, 'JSON array and path/id contradiction are invalid, not opaque');
  assert.equal(st.ignored, 3, 'two operating-model files and README are not documents');
  assert.equal(st.readable + st.opaque + st.invalid + st.ignored, st.paths);
  assert.equal(st.builtFrom, 'b'.repeat(40));

  // The elegant side effect: there is no `salary` entity in this peer's index at all.
  assert.equal(st.entities.salary, undefined);
  assert.equal(st.entities['board-minutes'], undefined);
  assert.deepEqual(index.all('salary'), []);
  assert.deepEqual(index.entities(), ['customer', 'invoice', 'memo']);
  assert.equal(st.entities.customer, 3, 'C-004 is present in the repo but not in the index');
  assert.equal(st.entities.invoice, 12);

  // Every skipped path is reportable, with a reason. Nothing is silently dropped.
  const problems = index.problems();
  assert.equal(problems.length, 7);
  assert.deepEqual(problems.map((p) => p.path), [
    'documents/board-minutes/BM-001.json',
    'documents/customer/C-004.json',
    'documents/invoice/INV-ARRAY.json',
    'documents/invoice/INV-BROKEN.json',
    'documents/invoice/INV-WRONGID.json',
    'documents/salary/S-001.json',
    'documents/salary/S-002.json',
  ]);
  assert.match(
    problems.find((p) => p.path === 'documents/board-minutes/BM-001.json').reason,
    /authentication tag mismatch/,
  );
  assert.match(
    problems.find((p) => p.path === 'documents/customer/C-004.json').reason,
    /UTF-8/,
  );
  assert.match(
    problems.find((p) => p.path === 'documents/invoice/INV-WRONGID.json').reason,
    /contradicts its path/,
  );

  // "412 documents readable, 37 opaque" is exactly what stats() is for.
  assert.equal(typeof st.readable, 'number');
  assert.ok(st.readable > 0);

  // And the queries still work over the readable part.
  assert.equal(index.select({ from: 'invoice', count: true }), 12);
});

test('the path is authoritative: entity and id are filled in when the JSON omits them', async () => {
  const repo = fakeRepo(
    new Map([['documents/article/ART-7.json', { name: 'Cashew 1kg', price: 12.5 }]]),
  );
  const index = await materialize(repo);
  assert.deepEqual(index.get('article', 'ART-7'), {
    name: 'Cashew 1kg',
    price: 12.5,
    entity: 'article',
    id: 'ART-7',
  });
});

test('rebuild-from-scratch equals incremental-update on the same change set', async () => {
  const repo1 = fakeRepo(fixture());
  const index1 = await materialize({ ...repo1, builtFrom: '1'.repeat(40) });
  const before = snapshot(index1);

  const edits = new Map([
    // plain field update
    ['documents/invoice/INV-010.json', inv('INV-010', 'C-001', 41000, '2027-09-15')],
    // a customer moves out of Bavaria — changes the *join* result, not just a row
    ['documents/customer/C-003.json', { id: 'C-003', entity: 'customer', name: 'Frankenland KG', region: 'Hesse', city: 'Kassel' }],
    // brand-new document, brand-new entity
    ['documents/credit-note/CN-001.json', { id: 'CN-001', entity: 'credit-note', invoice: 'INV-010', total: 500 }],
    // readable → opaque (document re-encrypted for a group this peer left)
    ['documents/invoice/INV-002.json', OPAQUE],
    // opaque → readable (this peer was added to the HR group)
    ['documents/salary/S-001.json', { id: 'S-001', entity: 'salary', person: 'P-1', gross: 4200 }],
    // invalid → readable
    ['documents/invoice/INV-WRONGID.json', inv('INV-WRONGID', 'C-001', 77, '2027-01-01')],
    // deletions: one ordinary, one that empties an entire entity
    ['documents/invoice/INV-003.json', null],
    ['documents/memo/M-001.json', null],
    // a non-document changes, and one is deleted
    ['operating-model/processes/goods-receipt.md', '# Goods Receipt (v2)\n'],
    ['README.md', null],
    // removing something that was never there must be a no-op, not an error
    ['documents/invoice/NOPE.json', null],
  ]);
  const { repo: repo2, changed, removed } = repo1.patch(edits);

  const fullRebuild = await materialize({ ...repo2, builtFrom: '2'.repeat(40) });
  const incremental = await update(index1, {
    changed,
    removed,
    readBlob: repo2.readBlob,
    builtFrom: '2'.repeat(40),
  });

  assert.deepStrictEqual(snapshot(incremental), snapshot(fullRebuild));

  // ... and the specific things we asked for actually happened.
  const st = incremental.stats();
  assert.deepEqual(incremental.entities(), ['credit-note', 'customer', 'invoice', 'salary']);
  assert.equal(st.entities.memo, undefined, 'an emptied entity disappears entirely');
  assert.equal(st.entities.salary, 1, 'S-001 became readable');
  assert.equal(incremental.get('invoice', 'INV-002'), null, 'INV-002 became opaque');
  assert.equal(incremental.get('invoice', 'INV-010').total, 41000);
  assert.deepEqual(
    incremental.select(BAVARIA_Q3_2027).map((d) => d.id),
    ['INV-010', 'INV-001'],
    'INV-004 fell out because its customer left Bavaria',
  );

  // The index is a value, not a mutable cache: update() did not touch the old one.
  assert.deepStrictEqual(snapshot(index1), before);
  assert.equal(index1.get('invoice', 'INV-010').total, 40000);
  assert.equal(index1.entities().includes('memo'), true);
});

test('rebuild equals incremental across a long chain of randomized (seeded) change sets', async () => {
  const random = rng(20270903);
  const files = new Map();
  for (let i = 0; i < 60; i++) {
    files.set(`documents/thing/T-${String(i).padStart(3, '0')}.json`, {
      id: `T-${String(i).padStart(3, '0')}`,
      entity: 'thing',
      n: i,
      bucket: `b${i % 5}`,
    });
  }
  let repo = fakeRepo(files);
  let incremental = await materialize(repo);

  for (let round = 0; round < 25; round++) {
    const edits = new Map();
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(random() * 70);
      const id = `T-${String(i).padStart(3, '0')}`;
      const path = `documents/thing/${id}.json`;
      const dice = random();
      if (dice < 0.25) edits.set(path, null);
      else if (dice < 0.45) edits.set(path, OPAQUE);
      else if (dice < 0.55) edits.set(path, 'not json {');
      else edits.set(path, { id, entity: 'thing', n: Math.floor(random() * 1000), bucket: `b${i % 5}` });
    }
    const patched = repo.patch(edits);
    repo = patched.repo;
    incremental = await update(incremental, {
      changed: patched.changed,
      removed: patched.removed,
      readBlob: repo.readBlob,
    });
    const full = await materialize(repo);
    assert.deepStrictEqual(
      snapshot(incremental),
      snapshot(full),
      `divergence in round ${round}`,
    );
  }
});

test('sum, count and groupBy — including empty results and a one-member group', async () => {
  const index = indexOf([
    { id: 'O-1', entity: 'order', country: 'DE', total: 100.5, channel: 'b2c' },
    { id: 'O-2', entity: 'order', country: 'DE', total: 200, channel: 'b2c' },
    { id: 'O-3', entity: 'order', country: 'FR', total: 50, channel: 'retail' },
    { id: 'O-4', entity: 'order', country: 'IT', total: 0, channel: 'retail' },
    { id: 'O-5', entity: 'order', country: 'NL', total: 25, channel: null },
    { id: 'O-6', entity: 'order', country: 'DE', channel: 'b2c' }, // no total at all
  ]);

  assert.equal(index.select({ from: 'order', count: true }), 6);
  assert.equal(index.select({ from: 'order', sum: 'total' }), 375.5);
  assert.equal(
    index.select({ from: 'order', sum: 'total', where: { country: 'DE' } }),
    300.5,
    'a missing numeric field contributes nothing — a sum is never NaN',
  );

  // Empty result sets.
  assert.deepEqual(index.select({ from: 'order', where: { country: 'ES' } }), []);
  assert.equal(index.select({ from: 'order', where: { country: 'ES' }, count: true }), 0);
  assert.equal(index.select({ from: 'order', where: { country: 'ES' }, sum: 'total' }), 0);
  assert.equal(index.select({ from: 'unknown-entity', count: true }), 0);
  const emptyGroups = index.select({ from: 'order', where: { country: 'ES' }, groupBy: 'country' });
  assert.ok(emptyGroups instanceof Map);
  assert.equal(emptyGroups.size, 0);

  // groupBy + count, keys deterministically ascending.
  const counts = index.select({ from: 'order', groupBy: 'country', count: true });
  assert.deepEqual([...counts.keys()], ['DE', 'FR', 'IT', 'NL']);
  assert.deepEqual([...counts.values()], [3, 1, 1, 1]);

  // groupBy + sum, including a group with exactly one member and a zero-sum group.
  const sums = index.select({ from: 'order', groupBy: 'country', sum: 'total' });
  assert.deepEqual([...sums.entries()], [['DE', 300.5], ['FR', 50], ['IT', 0], ['NL', 25]]);
  const one = index.select({ from: 'order', where: { country: 'FR' }, groupBy: 'country', sum: 'total' });
  assert.deepEqual([...one.entries()], [['FR', 50]], 'a group of one is still a group');

  // groupBy alone yields the documents per group, each list id-ordered.
  const groups = index.select({ from: 'order', groupBy: 'channel' });
  assert.deepEqual([...groups.keys()], ['b2c', 'retail', null], 'missing keys sort last');
  assert.deepEqual(groups.get('b2c').map((d) => d.id), ['O-1', 'O-2', 'O-6']);
  assert.deepEqual(groups.get(null).map((d) => d.id), ['O-5']);
});

test('ordering is deterministic under ties, and independent of insertion order', async () => {
  const docs = [];
  for (let i = 0; i < 40; i++) {
    docs.push({ id: `X-${String(i).padStart(2, '0')}`, entity: 'tie', score: i % 3, note: 'x' });
  }
  const random = rng(7);
  const shuffled = docs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const a = indexOf(docs);
  const b = indexOf(shuffled);
  const q = { from: 'tie', orderBy: 'score' };
  const ra = a.select(q).map((d) => d.id);
  const rb = b.select(q).map((d) => d.id);
  assert.deepEqual(ra, rb, 'same documents, different insertion order, identical result order');

  // Ties broken by id ascending: score 0 first, and within it X-00 < X-03 < X-06 ...
  assert.deepEqual(ra.slice(0, 5), ['X-00', 'X-03', 'X-06', 'X-09', 'X-12']);

  // desc reverses the groups but ties are still id-ascending — never reversed, never random.
  const rd = a.select({ from: 'tie', orderBy: 'score', desc: true }).map((d) => d.id);
  assert.deepEqual(rd.slice(0, 3), ['X-02', 'X-05', 'X-08']);
  assert.deepEqual(rd.slice(-1), ['X-39']);

  // No orderBy → id ascending. Still a total order.
  assert.deepEqual(b.select({ from: 'tie', limit: 3 }).map((d) => d.id), ['X-00', 'X-01', 'X-02']);

  // Missing sort values sort last in both directions.
  const mixed = indexOf([
    { id: 'M-1', entity: 'm', v: 5 },
    { id: 'M-2', entity: 'm' },
    { id: 'M-3', entity: 'm', v: 1 },
    { id: 'M-4', entity: 'm', v: null },
  ]);
  assert.deepEqual(mixed.select({ from: 'm', orderBy: 'v' }).map((d) => d.id), ['M-3', 'M-1', 'M-2', 'M-4']);
  assert.deepEqual(
    mixed.select({ from: 'm', orderBy: 'v', desc: true }).map((d) => d.id),
    ['M-1', 'M-3', 'M-2', 'M-4'],
  );

  // The total order across mixed types is stable and documented.
  assert.equal(compareValues(1, 'a') < 0, true);
  assert.equal(compareValues('a', true) < 0, true);
  assert.equal(compareValues(undefined, 'z') > 0, true);
  assert.equal(compareValues(NaN, 5) > 0, true);
});

test('operators, nested fields, and the plain Index accessors', async () => {
  const index = await materialize(fakeRepo(fixture()));

  assert.equal(index.get('customer', 'C-001').city, 'München');
  assert.equal(index.get('customer', 'NOPE'), null);
  assert.equal(index.get('nope', 'NOPE'), null);
  assert.equal(index.where('invoice', (d) => d.total > 40000).length, 2);
  assert.throws(() => index.all('invoice').push({}), TypeError, 'all() is a frozen view');

  const ops = (where) => index.select({ from: 'invoice', where }).map((d) => d.id);
  assert.deepEqual(ops({ total: { op: '=', value: 25000 } }), ['INV-004', 'INV-005', 'INV-006']);
  assert.deepEqual(ops({ id: { op: 'in', value: ['INV-001', 'INV-007'] } }), ['INV-001', 'INV-007']);
  assert.deepEqual(ops({ currency: { op: 'not in', value: ['EUR'] } }), ['INV-012']);
  assert.deepEqual(ops({ date: { op: 'starts with', value: '2028' } }), ['INV-008']);
  assert.deepEqual(ops({ customer: { op: 'exists', value: false } }), ['INV-011']);
  assert.deepEqual(ops({ total: { op: '<=', value: 9999.99 } }), ['INV-003']);
  assert.equal(ops({ id: { op: 'contains', value: 'INV-01' } }).length, 3);

  // The id fast path is a shortcut, never a semantic change: every other predicate still runs.
  assert.deepEqual(ops({ id: 'INV-010' }), ['INV-010']);
  assert.deepEqual(ops({ id: 'NOPE' }), []);
  assert.deepEqual(ops({ id: 'INV-010', total: { op: '>', value: 1e9 } }), []);
  assert.deepEqual(ops({ id: 'INV-BROKEN' }), [], 'an opaque document is simply not there');
  assert.deepEqual(
    index
      .select({
        from: 'invoice',
        join: { as: 'customer', from: 'customer', on: 'customer' },
        where: { id: 'INV-009', 'customer.region': 'Bavaria' },
      })
      .map((d) => d.id),
    [],
    'the fast path does not skip the join',
  );

  // Nested field access on the document itself, and through the join.
  const nested = indexOf([
    { id: 'S-1', entity: 'shipment', to: { country: 'NL', city: 'Utrecht' }, tags: ['cold', 'eu'] },
    { id: 'S-2', entity: 'shipment', to: { country: 'IT' }, tags: ['eu'] },
  ]);
  assert.deepEqual(
    nested.select({ from: 'shipment', where: { 'to.country': 'NL' } }).map((d) => d.id),
    ['S-1'],
  );
  assert.deepEqual(
    nested.select({ from: 'shipment', where: { tags: { op: 'contains', value: 'cold' } } }).map((d) => d.id),
    ['S-1'],
  );
  assert.deepEqual(nested.select({ from: 'shipment', where: { 'to.zip': { op: 'exists', value: true } } }), []);
});

test('a query can group and sum across a join', async () => {
  const index = await materialize(fakeRepo(fixture()));
  const byRegion = index.select({
    from: 'invoice',
    join: { as: 'customer', from: 'customer', on: 'customer' },
    where: { currency: 'EUR', date: { op: 'starts with', value: '2027' } },
    groupBy: 'customer.region',
    sum: 'total',
  });
  assert.deepEqual([...byRegion.keys()], ['Bavaria', 'Berlin']);
  assert.equal(byRegion.get('Berlin'), 50000);
  assert.equal(byRegion.get('Bavaria'), 10000.01 + 10000 + 9999.99 + 25000 + 25000 + 25000 + 40000);
});

test('index rejects nonsense inputs instead of guessing', async () => {
  assert.throws(() => indexOf('nope'), TypeError);
  assert.throws(() => indexOf([{ entity: 'x' }]), TypeError, 'a document needs an id');
  assert.throws(() => indexOf([{ id: 'x' }]), TypeError, 'a document needs an entity');
  await assert.rejects(() => materialize({}), TypeError);
  await assert.rejects(() => update({ not: 'an index' }, { readBlob: async () => null }), TypeError);
});

// ===========================================================================
// Benchmark. The manifesto claims sub-millisecond (line 197) against SQLite/DuckDB;
// v0.1 ships an in-memory index. These are the real numbers on this machine.
// ===========================================================================
test('benchmark: 20,000 synthetic documents', async () => {
  const N_CUSTOMERS = 5000;
  const N_INVOICES = 15000;
  const REGIONS = ['Bavaria', 'Berlin', 'Hesse', 'Saxony', 'NRW', 'Ile-de-France', 'Lombardy', 'Noord-Holland'];
  const random = rng(2027);

  const files = new Map();
  for (let i = 0; i < N_CUSTOMERS; i++) {
    const id = `C-${String(i).padStart(6, '0')}`;
    files.set(docPath('customer', id), {
      id,
      entity: 'customer',
      name: `Customer ${i}`,
      region: REGIONS[i % REGIONS.length],
      country: i % 3 === 0 ? 'DE' : i % 3 === 1 ? 'FR' : 'IT',
    });
  }
  const months = ['01', '03', '05', '07', '08', '09', '10', '12'];
  for (let i = 0; i < N_INVOICES; i++) {
    const id = `INV-${String(i).padStart(7, '0')}`;
    const opaque = i % 40 === 0; // ~2.5% of documents this peer cannot decrypt
    files.set(
      docPath('invoice', id),
      opaque
        ? OPAQUE
        : {
            id,
            entity: 'invoice',
            customer: `C-${String(Math.floor(random() * N_CUSTOMERS)).padStart(6, '0')}`,
            total: Math.round(random() * 4000000) / 100,
            currency: random() < 0.95 ? 'EUR' : 'CHF',
            date: `${2026 + (i % 3)}-${months[i % months.length]}-${String((i % 27) + 1).padStart(2, '0')}`,
            vatRate: 19,
          },
    );
  }
  const repo = fakeRepo(files);

  const t0 = performance.now();
  const index = await materialize({ ...repo, builtFrom: 'f'.repeat(40) });
  const buildMs = performance.now() - t0;

  const st = index.stats();
  assert.equal(st.paths, N_CUSTOMERS + N_INVOICES);
  assert.equal(st.opaque, Math.ceil(N_INVOICES / 40));
  assert.equal(st.readable, N_CUSTOMERS + N_INVOICES - st.opaque);

  const queries = {
    'Appendix VI (join + 4 predicates + order)': {
      from: 'invoice',
      join: { as: 'customer', from: 'customer', on: 'customer' },
      where: {
        total: { op: '>', value: 10000 },
        currency: 'EUR',
        date: { op: 'between', value: ['2027-07-01', '2027-09-30'] },
        'customer.region': 'Bavaria',
      },
      orderBy: 'total',
      desc: true,
    },
    'filter + orderBy + limit 20': {
      from: 'invoice',
      where: { currency: 'EUR', total: { op: '>=', value: 30000 } },
      orderBy: 'total',
      desc: true,
      limit: 20,
    },
    'groupBy + sum over all invoices': { from: 'invoice', groupBy: 'date', sum: 'total' },
    'count with one predicate': { from: 'invoice', where: { currency: 'CHF' }, count: true },
    'point lookup by id': { from: 'invoice', where: { id: 'INV-0009999' } },
  };

  // Warm up the id-sorted views so we time the query, not the first-touch sort.
  for (const q of Object.values(queries)) index.select(q);

  const timings = {};
  const ITER = 50;
  for (const [name, q] of Object.entries(queries)) {
    let best = Infinity;
    let total = 0;
    for (let i = 0; i < ITER; i++) {
      const t = performance.now();
      index.select(q);
      const dt = performance.now() - t;
      total += dt;
      if (dt < best) best = dt;
    }
    timings[name] = { mean: total / ITER, best };
  }

  // Incremental update of 100 changed documents against the 20k index.
  const edits = new Map();
  for (let i = 0; i < 100; i++) {
    const id = `INV-${String(i * 37).padStart(7, '0')}`;
    edits.set(docPath('invoice', id), { id, entity: 'invoice', customer: 'C-000001', total: 1, currency: 'EUR', date: '2027-08-01' });
  }
  const patched = repo.patch(edits);
  const t1 = performance.now();
  const updated = await update(index, { changed: patched.changed, removed: [], readBlob: patched.repo.readBlob, builtFrom: 'e'.repeat(40) });
  const updateMs = performance.now() - t1;
  assert.equal(updated.get('invoice', 'INV-0000037').total, 1);
  assert.equal(index.get('invoice', 'INV-0000037').total !== 1, true, 'previous index untouched');

  const pad = (s, n) => String(s).padEnd(n);
  const lines = [
    '',
    '  ── read-path benchmark ─────────────────────────────────────────────────',
    `  documents in tree:            ${st.paths} (${st.readable} readable, ${st.opaque} opaque)`,
    `  full materialize:             ${buildMs.toFixed(1)} ms  (${((buildMs / st.paths) * 1000).toFixed(1)} µs/doc)`,
    `  incremental update (100 docs):${updateMs.toFixed(3)} ms`,
    '  queries (mean of 50 / best):',
  ];
  for (const [name, t] of Object.entries(timings)) {
    lines.push(`    ${pad(name, 42)} ${t.mean.toFixed(3)} ms / ${t.best.toFixed(3)} ms`);
  }
  lines.push('  ───────────────────────────────────────────────────────────────────────', '');
  console.log(lines.join('\n'));

  // No timing assertion — a flaky clock must never fail a test suite. The numbers above
  // are the deliverable; correctness of the results is what is asserted.
  const rows = index.select(queries['Appendix VI (join + 4 predicates + order)']);
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].total >= rows[i].total);
});

// ===========================================================================
// v1.0 — secondary indexes, money, aggregation, scale.
//
// The floor is the fifteen tests above: none of their meanings changed. What follows is what an
// index has to earn before it is allowed near a ledger.
//
// The load-bearing tests, in order of how much they matter:
//
//   1. `indexed and unindexed agree` — the property that makes an index safe at all. An index only
//      ever *narrows* the candidate set; `query.js` alone decides what matches. So the two paths
//      must return byte-identical results, and 4 000 randomised queries over randomised documents
//      say they do.
//   2. `rebuild == incremental, including every index structure` — an index that has drifted from
//      the documents is a wrong report, and a wrong report in an ERP is worse than a slow one.
//   3. `aggregation against a naive oracle` — the naive scan is the oracle, the maintained BigInt
//      aggregate is the thing under test.
//   4. `money conformance with runtime/money/` — the read path recognises FD-1 tokens without
//      throwing, which is only safe if it agrees with agent M's parser exactly. This test is the
//      agreement.
// ===========================================================================

import { readFileSync } from 'node:fs';
// Test-only imports. Nothing in `runtime/read/` may import a `node:*` module; a benchmark that
// reports the heap budget it measured against has to ask the platform for it.
import { getHeapStatistics } from 'node:v8';
// The one source scanner in the suite. Wave 1 had three of these and they disagreed; this one strips
// comments and literals first and is mutation-tested against agent M's known-bad fixtures.
import { scanSources } from './_source-guard.js';
import {
  compile, explain, parseMoney, formatMoney, compareMoney, looksLikeMoney,
  _moneyComparatorForTest,
} from '../runtime/read/query.js';
import {
  money as mMoney, compare as mCompare, toMinor as mToMinor, currencyOf as mCurrencyOf,
  sum as mSum, CURRENCIES as M_CURRENCIES,
} from '../runtime/money/money.js';

/** A Source with no index at all: the oracle for every "the index did not change the answer" test. */
function scanSource(index) {
  return {
    all: (entity) => index.all(entity),
    get: (entity, id) => index.get(entity, id),
  };
}

/** `select()` or the refusal it raised, in a shape `deepStrictEqual` can compare. */
function outcome(fn) {
  try {
    const v = fn();
    if (v instanceof Map) return { ok: [...v.entries()].map(([k, x]) => [k, shape(x)]) };
    return { ok: shape(v) };
  } catch (e) {
    // `.code` is the contract; the prose may name a different pair of currencies depending on
    // which row a plan reached first, and that is stated in query.js rather than asserted here.
    return { threw: e.name, code: e.code ?? null };
  }
}

function shape(v) {
  if (Array.isArray(v)) return v.map((d) => (d && d.id !== undefined ? d.id : d));
  return v;
}

// ---------------------------------------------------------------------------
// 1. Money: the read path's recogniser must agree with runtime/money/ exactly.
// ---------------------------------------------------------------------------

test('money conformance: the read path agrees with runtime/money/ on every token', () => {
  const table = [
    // From runtime/money/README.md's own table — accepted.
    '4999.99 EUR', '-12.00 EUR', '1000 JPY', '1.500 TND', '0.00 EUR', '5.00 EUR',
    '0.01 EUR', '99999999999999999.99 EUR', '-0.01 EUR', '1.0000 CLF',
    // Refused, and every one of these is a way a report could have gone quietly wrong.
    '4999.9 EUR', '+5.00 EUR', '1000.0 JPY', '1.5 TND', '-0.00 EUR', '5.00 eur',
    '5.00EUR', '5,00 EUR', '1e3 EUR', '05.00 EUR', ' 5.00 EUR', '5.00 XXX',
    '5.00 XYZ', '5.0 XYZ', '. EUR', '- EUR', '5. EUR', '5.00  EUR', '', 'EUR',
    'Bavaria', '2027-08-15', '19', '4999.99 E', '4999.99 EURO',
  ];
  const random = rng(4217);
  // ... plus generated ones, because a hand-written table only covers what the author thought of.
  const codes = Object.keys(M_CURRENCIES);
  for (let i = 0; i < 600; i++) {
    const code = codes[Math.floor(random() * codes.length)];
    const digits = Math.floor(random() * 8);
    const neg = random() < 0.3 ? '-' : '';
    const int = digits === 0 ? '0' : String(1 + Math.floor(random() * 999999));
    const frac = Math.floor(random() * 5); // deliberately often the *wrong* number of digits
    const body = frac === 0 ? int : `${int}.${'1234567890'.slice(0, frac)}`;
    table.push(`${neg}${body} ${code}`);
  }

  let accepted = 0;
  for (const token of table) {
    let strict = null;
    try {
      strict = mMoney(token);
    } catch {
      strict = null;
    }
    const mine = parseMoney(token);
    assert.equal(
      mine === null,
      strict === null,
      `disagreement on ${JSON.stringify(token)}: read=${mine === null ? 'null' : `${mine.minor} ${mine.code}`} money=${strict === null ? 'null' : String(strict)}`,
    );
    // `looksLikeMoney` is now agent M's own predicate, re-exported rather than reimplemented, so
    // the two must agree on **every** token — not merely on the ones a prefilter happens to reject.
    // This is the assertion that makes the deletion of the read path's own predicate safe.
    assert.equal(
      looksLikeMoney(token), strict !== null,
      `looksLikeMoney disagrees with parseMoney on ${JSON.stringify(token)}`,
    );
    if (strict === null) continue;
    accepted++;
    assert.equal(mine.code, mCurrencyOf(strict), token);
    assert.equal(mine.minor, mToMinor(strict), token);
    assert.equal(mine.scale, M_CURRENCIES[mine.code], token);
    // And the canonical form round-trips through *M's* formatter, which is the only one.
    assert.equal(formatMoney(mine), token);
  }
  assert.ok(accepted > 100, `the generator should produce real money too (got ${accepted})`);

  // compareMoney is exact and equivalent to runtime/money/'s compare for one currency.
  const amounts = ['0.00 EUR', '0.01 EUR', '-0.01 EUR', '9.00 EUR', '10.00 EUR',
    '99999999999999999.99 EUR', '-99999999999999999.99 EUR'];
  for (const a of amounts) {
    for (const b of amounts) {
      assert.equal(compareMoney(parseMoney(a), parseMoney(b)), mCompare(mMoney(a), mMoney(b)),
        `${a} vs ${b}`);
    }
  }
  // Different currencies are *not comparable*, which is not the same as unequal.
  assert.equal(compareMoney(parseMoney('10.00 EUR'), parseMoney('10.00 USD')), null);
  assert.equal(looksLikeMoney('Bavaria'), false);
  assert.equal(looksLikeMoney('4999.99 EUR'), true);
  // The Wave 1 divergence this re-export closes: the read path's own `looksLikeMoney` was a *shape*
  // test and answered `true` here, while `parseMoney` refused — one name, two meanings.
  assert.equal(looksLikeMoney('5.00 XXX'), false, 'an unknown currency code is not money');
  assert.equal(parseMoney('5.00 XXX'), null);
  assert.equal(looksLikeMoney(null), false, "and it never throws, on anything");
  assert.equal(looksLikeMoney(5), false);
  assert.equal(looksLikeMoney({}), false);
  assert.equal(looksLikeMoney(Symbol('x')), false);
});

test('the fast money comparator agrees with the exact one on everything, including rubbish', () => {
  // `moneyComparator` is a hand-rolled, allocation-free character scanner, and a hand-rolled parser
  // is exactly the kind of code that is right for a year and then wrong for one currency. So it is
  // pinned to `parseMoney` + `compareMoney` — which are themselves pinned to runtime/money/ — over
  // every awkward value, and over generated ones.
  const random = rng(60217);
  const probes = ['10000.00 EUR', '0.00 EUR', '-0.01 EUR', '0.01 EUR', '9.00 EUR', '10.00 EUR',
    '1000 JPY', '0 JPY', '1.500 TND', '-1.500 TND', '99999999999999999.99 EUR',
    '-99999999999999999.99 EUR', '1.0000 CLF'];
  const values = [...probes,
    // Same currency, adjacent magnitudes, and the shapes where a digit-count shortcut would break.
    '9.99 EUR', '10.01 EUR', '100.00 EUR', '-100.00 EUR', '0.10 EUR', '0.09 EUR', '1.00 EUR',
    // Wrong currency, and wrong scale for the right currency.
    '10000.00 USD', '10000.0 EUR', '10000 EUR', '10000.000 EUR', '1000.00 JPY', '1.50 TND',
    // Not money at all, in every way the read path will actually meet.
    '', 'EUR', 'Bavaria', '2027-08-15', '19', '-0.00 EUR', '05.00 EUR', '+5.00 EUR', '5,00 EUR',
    '5.00 eur', '5.00EUR', ' 5.00 EUR', '1e3 EUR', '.00 EUR', '-.00 EUR', '5.0a EUR', '5a.00 EUR',
    'x'.repeat(3), null, undefined, 5, 5.5, true, {}, [],
  ];
  const codes = ['EUR', 'USD', 'JPY', 'TND', 'CLF', 'XXX', 'eur'];
  for (let i = 0; i < 3000; i++) {
    const code = codes[Math.floor(random() * codes.length)];
    const neg = random() < 0.3 ? '-' : '';
    const int = random() < 0.15 ? '0' : String(Math.floor(random() * 10 ** (1 + Math.floor(random() * 9))));
    // Half canonical for that code, half deliberately off-spec — the point is that both sides
    // agree about which is which, not only that they agree about amounts.
    const nfrac = random() < 0.5 && M_CURRENCIES[code] !== undefined
      ? M_CURRENCIES[code]
      : Math.floor(random() * 5);
    const frac = nfrac === 0 ? '' : `.${String(Math.floor(random() * 10 ** nfrac)).padStart(nfrac, '0')}`;
    values.push(`${neg}${int}${frac} ${code}`);
  }

  let comparable = 0;
  for (const p of probes) {
    const fast = _moneyComparatorForTest(p);
    const mp = parseMoney(p);
    assert.notEqual(mp, null, p);
    for (const v of values) {
      const mv = typeof v === 'string' ? parseMoney(v) : null;
      const exact = mv === null ? NaN : (compareMoney(mv, mp) ?? NaN);
      const got = fast(v);
      if (Number.isNaN(exact)) {
        assert.ok(Number.isNaN(got), `${JSON.stringify(v)} vs ${p}: fast said ${got}, exact said NaN`);
      } else {
        comparable++;
        assert.equal(got, exact, `${JSON.stringify(v)} vs ${p}`);
      }
    }
  }
  assert.ok(comparable > 2000, `only ${comparable} comparable pairs — the generator is too fussy`);
});

test('no float ever touches money: the read path carries no numeric coercion in its money path', () => {
  const q = readFileSync(new URL('../runtime/read/query.js', import.meta.url), 'utf8');
  const i = readFileSync(new URL('../runtime/read/index.js', import.meta.url), 'utf8');

  // Nowhere in the read path, at all — through the *shared* scanner, which strips comments and
  // string literals first. Wave 1 used a raw regex here, which is the mistake `_source-guard.js`
  // exists to end: a guard that flags a file for the word in its own documentation teaches people to
  // delete the documentation.
  assert.deepEqual(
    scanSources(
      [['runtime/read/query.js', q], ['runtime/read/index.js', i]],
      [
        ['parseFloat', /\bparseFloat\b/, 'a float parsed from a monetary string is FD-1 defeated'],
        ['toFixed', /\btoFixed\b/, 'toFixed rounds a double — the rounding must be declared, FD-1'],
        ['parseInt', /\bparseInt\b/, 'parseInt truncates and accepts trailing rubbish'],
      ],
    ),
    [],
  );

  // **The read path must stay greppable.** A raw control character in a `.js` file makes `grep`,
  // `ripgrep` and anything passing `-I` treat it as *binary* and skip it silently — and gate
  // condition 2 is "asserted by a test that greps the runtime". A file a reviewer's grep cannot read
  // is not auditable, whatever this test says. `Secondary`'s composite keys are separated by U+0000
  // on purpose (a field path may contain a space); it is written as an escape, not as a byte.
  for (const [name, src] of [['query.js', q], ['index.js', i]]) {
    const bad = [...src].filter((c) => c < ' ' && c !== '\n' && c !== '\t');
    assert.deepEqual(
      bad.map((c) => `U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`), [],
      `${name} contains raw control characters, so grep will treat it as binary`,
    );
  }

  // And inside the money section specifically, not even `Number(` or `Math.`, so the guarantee is
  // a grep and not an argument. (`Number(` appears elsewhere for the *number* domain, which is
  // exactly where a double belongs.)
  const start = q.indexOf('// PART 1 — FD-1 money');
  const end = q.indexOf('// PART 2 — the query language');
  assert.ok(start > 0 && end > start);
  const moneySection = q.slice(start, end);
  for (const forbidden of ['Number(', 'Math.', '+ 0.', '* 1.']) {
    assert.equal(
      moneySection.includes(forbidden),
      false,
      `the money section must not contain ${forbidden}`,
    );
  }
  // The values that make the point: a double would mangle both.
  assert.equal(
    parseMoney('99999999999999999.99 EUR').minor,
    9999999999999999999n,
    'past Number.MAX_SAFE_INTEGER in minor units, and exact',
  );
  assert.equal(0.1 + 0.2 === 0.3, false, 'the reason this test exists');
  const cents = ['0.10 EUR', '0.20 EUR'];
  const idx = indexOf(cents.map((m, k) => ({ id: `P-${k}`, entity: 'p', amount: m })));
  assert.equal(idx.select({ from: 'p', sum: 'amount' }), '0.30 EUR');
  assert.equal(String(mSum(cents.map(mMoney), 'EUR')), '0.30 EUR');
});

test('money in queries: exact comparison, exact sums, mixed currencies refused', () => {
  const docs = [
    { id: 'I-1', entity: 'inv', total: '10000.01 EUR', currency: 'EUR' },
    { id: 'I-2', entity: 'inv', total: '10000.00 EUR', currency: 'EUR' },
    { id: 'I-3', entity: 'inv', total: '9999.99 EUR', currency: 'EUR' },
    { id: 'I-4', entity: 'inv', total: '25000.00 USD', currency: 'USD' },
    { id: 'I-5', entity: 'inv', total: '0.10 EUR', currency: 'EUR' },
    { id: 'I-6', entity: 'inv', total: '0.20 EUR', currency: 'EUR' },
    { id: 'I-7', entity: 'inv', currency: 'EUR' }, // no amount at all
  ];
  const index = indexOf(docs, { indexThreshold: 0 });

  // Comparison is by value, not by text: `9999.99` is not over `10000.00` even though the string
  // "9999.99 EUR" sorts after "10000.00 EUR".
  const over = index.select({ from: 'inv', where: { total: { op: '>', value: '10000.00 EUR' } } });
  assert.deepEqual(over.map((d) => d.id), ['I-1']);
  assert.deepEqual(
    index.select({ from: 'inv', where: { total: { op: '>=', value: '10000.00 EUR' } } }).map((d) => d.id),
    ['I-1', 'I-2'],
  );
  // A cross-currency comparison does not match. It does not throw — see query.js for why the
  // choice matters to the planner.
  assert.deepEqual(
    index.select({ from: 'inv', where: { total: { op: '>', value: '1.00 USD' } } }).map((d) => d.id),
    ['I-4'],
  );
  // Equality is by value, so a differently-spelled amount of the same currency still matches.
  assert.deepEqual(
    index.select({ from: 'inv', where: { total: '0.10 EUR' } }).map((d) => d.id),
    ['I-5'],
  );
  assert.deepEqual(
    index.select({ from: 'inv', where: { total: { op: 'between', value: ['0.10 EUR', '0.20 EUR'] } } })
      .map((d) => d.id),
    ['I-5', 'I-6'],
  );

  // Summation: exact, and refused across currencies.
  assert.equal(index.select({ from: 'inv', where: { currency: 'EUR' }, sum: 'total' }), '30000.30 EUR');
  const mixed = () => index.select({ from: 'inv', sum: 'total' });
  assert.throws(mixed, (e) => e.name === 'QueryError' && e.code === 'MIXED_CURRENCY');
  // ... and the shape a trial balance actually needs.
  const tb = index.select({ from: 'inv', groupBy: 'currency', sum: 'total' });
  assert.deepEqual([...tb.entries()], [['EUR', '30000.30 EUR'], ['USD', '25000.00 USD']]);

  // Money orders numerically, between numbers and text, in both directions.
  assert.deepEqual(
    index.select({ from: 'inv', where: { currency: 'EUR' }, orderBy: 'total' }).map((d) => d.id),
    ['I-5', 'I-6', 'I-3', 'I-2', 'I-1', 'I-7'],
    'ascending by value; the row with no amount sorts last',
  );
  assert.deepEqual(
    index.select({ from: 'inv', where: { currency: 'EUR' }, orderBy: 'total', desc: true }).map((d) => d.id),
    ['I-1', 'I-2', 'I-3', 'I-6', 'I-5', 'I-7'],
    'descending, and the missing value still sorts last',
  );

  // Money and plain numbers in one field is a modelling error, and it is refused rather than coerced.
  const bad = indexOf([
    { id: 'B-1', entity: 'b', v: '1.00 EUR' },
    { id: 'B-2', entity: 'b', v: 2 },
  ], { indexThreshold: 0 });
  assert.throws(() => bad.select({ from: 'b', sum: 'v' }),
    (e) => e.name === 'QueryError' && e.code === 'MIXED_KINDS');

  // An unknown currency code is not money — FD-1 forbids guessing a scale. It stays text, so it
  // sorts as text and contributes nothing to a sum. Visible, never silently wrong.
  const unknown = indexOf([{ id: 'U-1', entity: 'u', v: '5.0 XYZ' }, { id: 'U-2', entity: 'u', v: '5.00 XYZ' }],
    { indexThreshold: 0 });
  assert.equal(unknown.select({ from: 'u', sum: 'v' }), 0);
  assert.equal(parseMoney('5.0 XYZ'), null);
});

// ---------------------------------------------------------------------------
// 2. The property that makes an index safe.
// ---------------------------------------------------------------------------

/** Randomised documents with every indexable shape in them, including missing and awkward values. */
function randomWorld(random, nInv, nCust) {
  const REGIONS = ['Bavaria', 'Berlin', 'Hesse', 'Lombardy', 'Ile-de-France', 'Noord-Holland'];
  const CODES = ['EUR', 'USD', 'JPY', 'TND'];
  const docs = [];
  for (let i = 0; i < nCust; i++) {
    docs.push({
      id: `C-${String(i).padStart(4, '0')}`,
      entity: 'cust',
      region: random() < 0.08 ? undefined : REGIONS[Math.floor(random() * REGIONS.length)],
      country: ['DE', 'FR', 'IT', 'NL'][Math.floor(random() * 4)],
      blocked: random() < 0.2,
    });
  }
  for (let i = 0; i < nInv; i++) {
    const code = CODES[Math.floor(random() * CODES.length)];
    const scale = M_CURRENCIES[code];
    const units = Math.floor(random() * 30000);
    const frac = scale === 0 ? '' : `.${String(Math.floor(random() * 10 ** scale)).padStart(scale, '0')}`;
    const d = random();
    docs.push({
      id: `I-${String(i).padStart(5, '0')}`,
      entity: 'inv',
      cust: d < 0.05 ? undefined : `C-${String(Math.floor(random() * (nCust + 3))).padStart(4, '0')}`,
      total: d < 0.03 ? undefined : `${units}${frac} ${code}`,
      currency: code,
      net: d < 0.04 ? null : Math.round(random() * 1000000) / 100,
      date: `202${5 + Math.floor(random() * 4)}-${String(1 + Math.floor(random() * 12)).padStart(2, '0')}-` +
        `${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`,
      status: ['draft', 'posted', 'cancelled', 'paid'][Math.floor(random() * 4)],
      posted: random() < 0.5,
      note: random() < 0.1 ? undefined : `note-${Math.floor(random() * 50)}`,
      nested: { city: ['München', 'Berlin', 'Milano'][Math.floor(random() * 3)] },
    });
  }
  return docs;
}

/** A random *valid* query. Never invalid: a refusal is tested elsewhere, agreement is tested here. */
function randomQuery(random) {
  const CODES = ['EUR', 'USD', 'JPY', 'TND'];
  const money = () => {
    const code = CODES[Math.floor(random() * CODES.length)];
    const scale = M_CURRENCIES[code];
    const frac = scale === 0 ? '' : `.${String(Math.floor(random() * 10 ** scale)).padStart(scale, '0')}`;
    return `${Math.floor(random() * 30000)}${frac} ${code}`;
  };
  const pool = [
    () => ['total', { op: pick(random, ['=', '!=', '>', '>=', '<', '<=']), value: money() }],
    () => ['total', { op: 'between', value: [money(), money()] }],
    () => ['total', { op: 'in', value: [money(), money(), money()] }],
    () => ['net', { op: pick(random, ['=', '>', '>=', '<', '<=']), value: Math.round(random() * 1000000) / 100 }],
    () => ['net', { op: 'between', value: [random() * 5000, random() * 10000] }],
    () => ['date', { op: pick(random, ['=', '>', '>=', '<', '<=']), value: `202${5 + Math.floor(random() * 4)}-06-15` }],
    () => ['date', { op: 'between', value: ['2026-07-01', '2027-09-30'] }],
    () => ['date', { op: 'starts with', value: `202${5 + Math.floor(random() * 4)}` }],
    () => ['status', pick(random, ['draft', 'posted', 'cancelled', 'paid', 'nope'])],
    () => ['status', { op: 'in', value: ['draft', 'posted'] }],
    () => ['status', { op: 'not in', value: ['cancelled'] }],
    () => ['currency', pick(random, CODES)],
    () => ['posted', random() < 0.5],
    () => ['note', { op: 'starts with', value: `note-${Math.floor(random() * 10)}` }],
    () => ['note', { op: 'exists', value: random() < 0.5 }],
    () => ['note', { op: 'contains', value: '1' }],
    () => ['id', { op: 'in', value: [`I-00001`, `I-00002`, `I-99999`] }],
    () => ['id', `I-${String(Math.floor(random() * 400)).padStart(5, '0')}`],
    () => ['nested.city', pick(random, ['München', 'Berlin', 'Milano'])],
    () => ['cust', `C-${String(Math.floor(random() * 100)).padStart(4, '0')}`],
  ];
  const joinPool = [
    () => ['cust.region', pick(random, ['Bavaria', 'Berlin', 'Hesse', 'Lombardy'])],
    () => ['cust.country', pick(random, ['DE', 'FR', 'IT', 'NL'])],
    () => ['cust.blocked', random() < 0.5],
    () => ['cust.region', { op: 'in', value: ['Bavaria', 'Hesse'] }],
    () => ['cust.region', { op: 'exists', value: random() < 0.5 }],
  ];

  const withJoin = random() < 0.5;
  const where = {};
  const nClauses = Math.floor(random() * 4);
  for (let k = 0; k < nClauses; k++) {
    const [ref, spec] = pool[Math.floor(random() * pool.length)]();
    where[ref] = spec;
  }
  if (withJoin && random() < 0.7) {
    const [ref, spec] = joinPool[Math.floor(random() * joinPool.length)]();
    where[ref] = spec;
  }
  const q = { from: 'inv', where };
  if (withJoin) {
    q.join = { as: 'cust', from: 'cust', on: 'cust', required: random() < 0.7 };
  }
  const shapeDice = random();
  if (shapeDice < 0.2) q.count = true;
  else if (shapeDice < 0.35) q.sum = 'total';
  else if (shapeDice < 0.45) q.sum = 'net';
  if (random() < 0.4) {
    q.orderBy = pick(random, ['total', 'net', 'date', 'status', 'id', 'nested.city',
      ...(withJoin ? ['cust.region'] : [])]);
    if (random() < 0.5) q.desc = true;
  }
  if (random() < 0.3) q.groupBy = pick(random, ['currency', 'status', 'posted', 'date',
    ...(withJoin ? ['cust.country'] : [])]);
  if (random() < 0.25) q.limit = Math.floor(random() * 12);
  return q;
}

function pick(random, arr) {
  return arr[Math.floor(random() * arr.length)];
}

test('indexed and unindexed paths return identical results (4000 randomised queries)', () => {
  const random = rng(20270815);
  const docs = randomWorld(random, 1200, 300);
  // threshold 0 forces every index to be built, so the indexed path is genuinely exercised on a
  // fixture this small. Default is 256 documents, which is where a scan stops being free.
  const indexed = indexOf(docs, { indexThreshold: 0 });
  const oracle = scanSource(indexed);

  let planned = 0;
  const CASES = 4000;
  for (let c = 0; c < CASES; c++) {
    const q = randomQuery(random);
    const a = outcome(() => indexed.select(q));
    const b = outcome(() => select(oracle, q));
    assert.deepStrictEqual(a, b, `case ${c}: ${JSON.stringify(q)}`);
    const plan = explain(indexed, q).plan;
    if (plan !== 'full scan') planned++;
  }
  // If nothing were ever planned this test would be vacuous, so say what it covered.
  assert.ok(planned > CASES * 0.5, `${planned}/${CASES} queries used an index, not a scan`);

  // Every index the run happened to build must still match a fresh build of itself.
  assert.deepEqual(indexed.verifyIndexes(), []);
  const st = indexed.indexStats();
  assert.ok(st.fieldIndexes > 5, `built ${st.fieldIndexes} field indexes`);
});

test('a revoked index — one that update() took the structures from — is still correct', async () => {
  const random = rng(99);
  const docs = randomWorld(random, 600, 120);
  const files = new Map(docs.map((d) => [docPath(d.entity, d.id), d]));
  const repo = fakeRepo(files);
  const before = await materialize({ ...repo, indexThreshold: 0 });

  const q = { from: 'inv', where: { status: 'posted' }, orderBy: 'date' };
  const expected = before.select(q).map((d) => d.id);
  assert.ok(expected.length > 0);

  const patched = repo.patch(new Map([[docPath('inv', 'I-00000'), null]]));
  const after = await update(before, {
    changed: patched.changed, removed: patched.removed, readBlob: patched.repo.readBlob,
  });

  // `before` had its secondary indexes handed to `after`. It answers exactly as it did — the index
  // is a view, so a revoked handle rebuilds itself rather than reporting stale rows.
  assert.deepEqual(before.select(q).map((d) => d.id), expected);
  assert.deepEqual(before.verifyIndexes(), []);
  assert.deepEqual(after.verifyIndexes(), []);
  assert.equal(after.get('inv', 'I-00000'), null);
  assert.notEqual(before.get('inv', 'I-00000'), null, 'the old index still holds the old document');
});

// ---------------------------------------------------------------------------
// 2b. The columnar projection (FD-10 item 1).
//
// The column is a *second layout of the same information* the equality buckets already hold. So the
// only property that matters is that it changes nothing: same results, same refusals, same order,
// same money, in both layouts and against a source with no index at all. Three-way agreement is
// asserted rather than two-way, because a bug that moved both indexed paths the same way would pass
// a columnar-vs-boxed comparison and still be a wrong report.
//
// Whether the column is *worth* its 4 bytes a row is a measurement, not a test; §8.5 of
// runtime/read/README.md has it, and it is less flattering than FD-10 predicted.
// ---------------------------------------------------------------------------

test('columnar and boxed layouts return identical results (2500 randomised queries, seed 20270816)', () => {
  const random = rng(20270816);
  const docs = randomWorld(random, 1500, 350);
  const columnar = indexOf(docs, { indexThreshold: 0, columnar: true });
  const boxed = indexOf(docs, { indexThreshold: 0, columnar: false });
  const oracle = scanSource(boxed);

  assert.equal(columnar.indexStats().columnar, true);
  assert.equal(boxed.indexStats().columnar, false);

  let narrowed = 0;
  let scanned = 0;
  let plans = 0;
  const CASES = 2500;
  for (let c = 0; c < CASES; c++) {
    const q = randomQuery(random);
    const a = outcome(() => columnar.select(q));
    const b = outcome(() => boxed.select(q));
    const o = outcome(() => select(oracle, q));
    assert.deepStrictEqual(a, b, `columnar vs boxed, case ${c}: ${JSON.stringify(q)}`);
    assert.deepStrictEqual(a, o, `columnar vs scan, case ${c}: ${JSON.stringify(q)}`);
    // `explain()` re-runs the planner, so it is sampled rather than paid on every case: this test
    // already executes each query three times and other agents run the suite constantly.
    if (c % 4 === 0) {
      plans++;
      const plan = explain(columnar, q).plan;
      if (plan.includes('∩ columnar')) narrowed++;
      else if (plan.startsWith('columnar scan')) scanned++;
    }
  }
  // Not vacuous: say how many queries the column actually touched, in both of its two roles.
  assert.ok(narrowed > plans * 0.15, `only ${narrowed}/${plans} sampled queries were narrowed`);
  assert.ok(scanned > 0, 'no sampled query took the columnar-scan path');

  // Both layouts must also still match a fresh build of themselves.
  assert.deepEqual(columnar.verifyIndexes(), []);
  assert.deepEqual(boxed.verifyIndexes(), []);
});

test('the money column is exact at the edge of a 64-bit minor unit, where a BigInt64Array wraps', () => {
  // FD-10 asked for "a BigInt64Array of minor units for money". This is why the column is a dense
  // Int32Array of *ordinals* into the FD-1 token dictionary instead, and the difference is not a
  // preference — a 64-bit minor unit is reachable with real amounts and it wraps **silently**.
  const edge = new BigInt64Array(1);
  edge[0] = 9223372036854775807n; // 2^63-1: the last value it holds. `9223372036854775.807 TND`.
  assert.equal(edge[0], 9223372036854775807n);
  edge[0] = 9223372036854775808n; // 2^63: `92233720368547758.08 EUR`, a real (huge) invoice.
  assert.equal(edge[0], -9223372036854775808n, 'assignment wraps modulo 2^64 and does not throw');
  edge[0] = 9999999999999999999n; // the money README's own largest example amount.
  assert.equal(edge[0], -8446744073709551617n, 'a positive amount reads back negative');

  // What the read path does instead: the dictionary holds the canonical FD-1 token and the BigInt is
  // reconstructed from it, so there is no 64-bit edge at all. These four are, in order:
  // 2^63-1 minor units, 2^63, past Number.MAX_SAFE_INTEGER, and 36 digits of minor units.
  const docs = [
    { id: 'A', entity: 'big', amount: '9223372036854775.807 TND' },
    { id: 'B', entity: 'big', amount: '-9223372036854775.807 TND' },
    { id: 'C', entity: 'big', amount: '0.001 TND' },
  ];
  const eurDocs = [
    { id: 'D', entity: 'eur', amount: '92233720368547758.08 EUR' },
    { id: 'E', entity: 'eur', amount: '99999999999999999.99 EUR' },
    { id: 'F', entity: 'eur', amount: '1234567890123456789012345678901234.56 EUR' },
    { id: 'G', entity: 'eur', amount: '0.01 EUR' },
    { id: 'H', entity: 'eur', amount: '-0.01 EUR' },
  ];
  assert.equal(parseMoney('9223372036854775.807 TND').minor, 2n ** 63n - 1n);
  assert.equal(parseMoney('92233720368547758.08 EUR').minor, 2n ** 63n);
  assert.equal(
    parseMoney('1234567890123456789012345678901234.56 EUR').minor,
    123456789012345678901234567890123456n,
    'FD-1 puts no limit on magnitude, and neither does the index',
  );
  // ... and runtime/money/ agrees, which is the only opinion that counts.
  assert.equal(String(mMoney('92233720368547758.08 EUR')), '92233720368547758.08 EUR');

  for (const columnar of [true, false]) {
    const tnd = indexOf(docs, { indexThreshold: 0, columnar });
    const eur = indexOf(eurDocs, { indexThreshold: 0, columnar });
    const label = columnar ? 'columnar' : 'boxed';

    // Ordering: exact, and not by text (as text, "9223372036854775.807" < "9223372036854775.808").
    assert.deepEqual(
      tnd.select({ from: 'big', orderBy: 'amount' }).map((d) => d.id), ['B', 'C', 'A'], label,
    );
    assert.deepEqual(
      eur.select({ from: 'eur', orderBy: 'amount' }).map((d) => d.id), ['H', 'G', 'D', 'E', 'F'],
      label,
    );
    // A range whose boundary is exactly 2^63 minor units, and one exactly past it.
    assert.deepEqual(
      eur.select({ from: 'eur', where: { amount: { op: '>=', value: '92233720368547758.08 EUR' } } })
        .map((d) => d.id), ['D', 'E', 'F'], label,
    );
    assert.deepEqual(
      eur.select({ from: 'eur', where: { amount: { op: '>', value: '92233720368547758.08 EUR' } } })
        .map((d) => d.id), ['E', 'F'], label,
    );
    // Equality on the wrapping value: it is itself, not its two's-complement.
    assert.deepEqual(
      eur.select({ from: 'eur', where: { amount: '92233720368547758.08 EUR' } }).map((d) => d.id),
      ['D'], label,
    );
    // And the sum, which is where a truncation would print a negative balance sheet.
    assert.equal(tnd.select({ from: 'big', sum: 'amount' }), '0.001 TND', label);
    assert.equal(
      eur.select({ from: 'eur', sum: 'amount' }),
      formatMoney({ code: 'EUR', minor: eurDocs.reduce((a, d) => a + parseMoney(d.amount).minor, 0n) }),
      label,
    );
    assert.deepEqual(tnd.verifyIndexes(), []);
    assert.deepEqual(eur.verifyIndexes(), []);
  }
});

// ---------------------------------------------------------------------------
// 3. Rebuild == incremental, now including every index structure.
// ---------------------------------------------------------------------------

/** The fields the drift test insists both indexes carry, so their internals are comparable. */
const DRIFT_FIELDS = [
  ['invoice', 'total'], ['invoice', 'currency'], ['invoice', 'date'], ['invoice', 'customer'],
  ['invoice', 'vatRate'], ['customer', 'region'], ['customer', 'city'], ['salary', 'gross'],
  ['credit-note', 'total'], ['thing', 'n'], ['thing', 'bucket'], ['posting', 'amount'],
  ['posting', 'account'],
];
const DRIFT_AGGS = [
  ['invoice', 'total', 'currency'], ['posting', 'amount', 'account'], ['posting', 'amount', null],
  ['invoice', null, 'currency'],
];

/** Force the same structures into existence on both sides, then compare them byte for byte. */
function indexSnapshot(index) {
  for (const [entity, field] of DRIFT_FIELDS) index.ensureIndex(entity, field);
  for (const [entity, field, by] of DRIFT_AGGS) {
    // Provoked through the query surface, which is the only way an aggregate is ever created.
    try {
      if (field === null) index.select({ from: entity, groupBy: by, count: true });
      else if (by === null) index.select({ from: entity, sum: field });
      else index.select({ from: entity, groupBy: by, sum: field });
    } catch {
      /* a refusal is a legitimate outcome and is compared by `snapshot()` elsewhere */
    }
  }
  return index.dumpIndexes();
}

test('rebuild equals incremental for the index structures too, after every kind of change', async () => {
  const base = fixture();
  base.set('documents/posting/P-001.json',
    { id: 'P-001', entity: 'posting', account: '1200', amount: '100.00 EUR' });
  base.set('documents/posting/P-002.json',
    { id: 'P-002', entity: 'posting', account: '1200', amount: '-40.00 EUR' });
  base.set('documents/posting/P-003.json',
    { id: 'P-003', entity: 'posting', account: '4400', amount: '7.77 EUR' });
  // Money on invoices too, so the money domain of a range index is exercised by this test.
  for (const [path, value] of [...base]) {
    if (path.startsWith('documents/invoice/') && value && value.total !== undefined) {
      base.set(path, { ...value, total: `${value.total.toFixed(2)} ${value.currency ?? 'EUR'}` });
    }
  }

  const repo1 = fakeRepo(base);
  const opts = { indexThreshold: 0 };
  let incremental = await materialize({ ...repo1, ...opts, builtFrom: '1'.repeat(40) });
  const firstDocs = snapshot(incremental);
  const firstIdx = indexSnapshot(incremental);

  const rounds = [
    // a field update that moves a document between buckets of *three* different indexes
    new Map([['documents/invoice/INV-010.json',
      { id: 'INV-010', entity: 'invoice', customer: 'C-003', total: '41000.00 EUR', currency: 'EUR',
        date: '2028-01-02', vatRate: 7 }]]),
    // a money amount changes, which moves it inside the sorted money domain and the aggregate
    new Map([['documents/posting/P-001.json',
      { id: 'P-001', entity: 'posting', account: '1200', amount: '100.01 EUR' }]]),
    // the group key itself changes: the aggregate must move the whole amount to another account
    new Map([['documents/posting/P-003.json',
      { id: 'P-003', entity: 'posting', account: '1200', amount: '7.77 EUR' }]]),
    // a brand-new entity appears
    new Map([['documents/posting/P-004.json',
      { id: 'P-004', entity: 'posting', account: '9999', amount: '0.01 EUR' }]]),
    // readable → opaque (re-encrypted for a group this peer left)
    new Map([['documents/posting/P-002.json', OPAQUE]]),
    // opaque → readable (this peer joined the HR group)
    new Map([['documents/salary/S-001.json',
      { id: 'S-001', entity: 'salary', person: 'P-1', gross: '4200.00 EUR' }]]),
    // invalid → readable
    new Map([['documents/invoice/INV-WRONGID.json',
      { id: 'INV-WRONGID', entity: 'invoice', customer: 'C-001', total: '77.00 EUR',
        currency: 'EUR', date: '2027-01-01', vatRate: 19 }]]),
    // a deletion that empties an entity entirely
    new Map([['documents/memo/M-001.json', null]]),
    // a currency changes, which moves the row between *partitions* of the money range index
    new Map([['documents/invoice/INV-001.json',
      { id: 'INV-001', entity: 'invoice', customer: 'C-001', total: '10000.01 USD', currency: 'USD',
        date: '2027-07-01', vatRate: 19 }]]),
    // and a mixed-currency aggregate, which must refuse identically on both sides
    new Map([['documents/posting/P-005.json',
      { id: 'P-005', entity: 'posting', account: '1200', amount: '5.00 USD' }]]),
    // then remove the offender again, so the aggregate must go back to being answerable
    new Map([['documents/posting/P-005.json', null]]),
    // a non-document changes; a removal of something that was never there
    new Map([['README.md', '# v2\n'], ['documents/nope/NOPE.json', null]]),
  ];

  let repo = repo1;
  for (let r = 0; r < rounds.length; r++) {
    const patched = repo.patch(rounds[r]);
    repo = patched.repo;
    incremental = await update(incremental, {
      changed: patched.changed, removed: patched.removed, readBlob: repo.readBlob,
      builtFrom: String(r).repeat(40).slice(0, 40),
    });
    const full = await materialize({ ...repo, ...opts, builtFrom: String(r).repeat(40).slice(0, 40) });

    assert.deepStrictEqual(snapshot(incremental), snapshot(full), `documents diverged in round ${r}`);
    assert.deepStrictEqual(
      indexSnapshot(incremental),
      indexSnapshot(full),
      `index structures diverged in round ${r}`,
    );
    assert.deepEqual(incremental.verifyIndexes(), [], `index drift in round ${r}`);
  }

  // The first index is a value: it was never touched by any of the twelve updates.
  // (Its secondary structures were taken, then rebuilt on demand — same content, same answers.)
  assert.deepStrictEqual(snapshot(await materializeFrom(repo1, opts, '1'.repeat(40))), firstDocs);
  assert.ok(firstIdx.fields.length > 0);
});

async function materializeFrom(repo, opts, builtFrom) {
  return materialize({ ...repo, ...opts, builtFrom });
}

test('rebuild equals incremental — index structures too — over randomized change sets', async () => {
  const random = rng(31337);
  const CODES = ['EUR', 'USD', 'JPY'];
  const files = new Map();
  const mk = (i) => {
    const code = CODES[i % CODES.length];
    const scale = M_CURRENCIES[code];
    const cents = Math.floor(random() * 100000);
    const body = scale === 0
      ? String(cents)
      : `${Math.floor(cents / 10 ** scale)}.${String(cents % 10 ** scale).padStart(scale, '0')}`;
    return {
      id: `P-${String(i).padStart(3, '0')}`,
      entity: 'posting',
      account: `${1000 + (i % 7) * 100}`,
      amount: `${body} ${code}`,
      n: Math.floor(random() * 500),
      day: `2027-${String(1 + (i % 12)).padStart(2, '0')}-15`,
    };
  };
  for (let i = 0; i < 90; i++) files.set(docPath('posting', `P-${String(i).padStart(3, '0')}`), mk(i));

  let repo = fakeRepo(files);
  const opts = { indexThreshold: 0 };
  let incremental = await materialize({ ...repo, ...opts });
  const fields = [['posting', 'account'], ['posting', 'amount'], ['posting', 'n'], ['posting', 'day']];
  const snap = (ix) => {
    for (const [e, f] of fields) ix.ensureIndex(e, f);
    try {
      ix.select({ from: 'posting', groupBy: 'account', sum: 'amount' });
    } catch { /* mixed currency in a group is a legitimate refusal */ }
    try {
      ix.select({ from: 'posting', groupBy: 'account', count: true });
    } catch { /* unreachable, but a refusal is data too */ }
    return ix.dumpIndexes();
  };

  const ROUNDS = 40;
  for (let round = 0; round < ROUNDS; round++) {
    const edits = new Map();
    for (let k = 0; k < 5; k++) {
      const i = Math.floor(random() * 100);
      const path = docPath('posting', `P-${String(i).padStart(3, '0')}`);
      const dice = random();
      if (dice < 0.22) edits.set(path, null);
      else if (dice < 0.35) edits.set(path, OPAQUE);
      else if (dice < 0.42) edits.set(path, 'not json {');
      else edits.set(path, mk(i));
    }
    const patched = repo.patch(edits);
    repo = patched.repo;
    incremental = await update(incremental, {
      changed: patched.changed, removed: patched.removed, readBlob: repo.readBlob,
    });
    const full = await materialize({ ...repo, ...opts });
    assert.deepStrictEqual(snapshot(incremental), snapshot(full), `documents, round ${round}`);
    assert.deepStrictEqual(snap(incremental), snap(full), `index structures, round ${round}`);
    assert.deepEqual(incremental.verifyIndexes(), [], `drift, round ${round}`);
  }
});

test('rebuild == incremental in both layouts, across every transition (30 seeded rounds)', async () => {
  // The same change chain, maintained incrementally in a columnar index and in a boxed one, with a
  // full rebuild of each as the oracle every round. Four indexes are compared each round, and the
  // two layouts must also agree with each other *as answers* — a column that drifted while its
  // buckets stayed right would be caught by neither comparison alone.
  const random = rng(20270817);
  const CODES = ['EUR', 'USD', 'JPY'];
  const mk = (i) => {
    const code = CODES[i % CODES.length];
    const scale = M_CURRENCIES[code];
    const cents = Math.floor(random() * 100000);
    const body = scale === 0
      ? String(cents)
      : `${Math.floor(cents / 10 ** scale)}.${String(cents % 10 ** scale).padStart(scale, '0')}`;
    return {
      id: `P-${String(i).padStart(3, '0')}`,
      entity: 'posting',
      account: `${1000 + (i % 7) * 100}`,
      amount: `${body} ${code}`,
      n: Math.floor(random() * 500),
      day: `2027-${String(1 + (i % 12)).padStart(2, '0')}-15`,
    };
  };
  const files = new Map();
  for (let i = 0; i < 90; i++) files.set(docPath('posting', `P-${String(i).padStart(3, '0')}`), mk(i));

  const FIELDS = [['posting', 'account'], ['posting', 'amount'], ['posting', 'n'], ['posting', 'day']];
  const force = (ix) => {
    for (const [e, f] of FIELDS) ix.ensureIndex(e, f);
    return ix;
  };
  /** Answers that exercise every structure: equality, both ranges, money, the aggregate. */
  const QUERIES = [
    { from: 'posting', where: { account: '1300' }, orderBy: 'amount' },
    { from: 'posting', where: { n: { op: 'between', value: [100, 400] } }, orderBy: 'n' },
    { from: 'posting', where: { day: { op: '>=', value: '2027-06-15' } }, orderBy: 'id' },
    { from: 'posting', where: { amount: { op: '>', value: '200.00 EUR' } }, orderBy: 'amount' },
    { from: 'posting', where: { account: '1300', n: { op: '<', value: 250 } }, count: true },
    { from: 'posting', groupBy: 'account', count: true },
  ];
  const answers = (ix) => QUERIES.map((q) => outcome(() => ix.select(q)));

  let repo = fakeRepo(files);
  const optsCol = { indexThreshold: 0, columnar: true };
  const optsBox = { indexThreshold: 0, columnar: false };
  let col = force(await materialize({ ...repo, ...optsCol }));
  let box = force(await materialize({ ...repo, ...optsBox }));

  for (let round = 0; round < 30; round++) {
    const edits = new Map();
    for (let k = 0; k < 5; k++) {
      const i = Math.floor(random() * 100);
      const path = docPath('posting', `P-${String(i).padStart(3, '0')}`);
      const dice = random();
      if (dice < 0.22) edits.set(path, null);                 // deletion
      else if (dice < 0.35) edits.set(path, OPAQUE);          // readable → opaque
      else if (dice < 0.42) edits.set(path, 'not json {');    // readable → invalid
      else if (dice < 0.5) {
        // a value moving between buckets *and* between currency partitions
        edits.set(path, { ...mk(i), amount: `${Math.floor(random() * 999)}.00 ${pick(random, CODES)}` });
      } else edits.set(path, mk(i));
    }
    const patched = repo.patch(edits);
    repo = patched.repo;
    const args = { changed: patched.changed, removed: patched.removed, readBlob: repo.readBlob };
    col = force(await update(col, args));
    box = force(await update(box, args));
    const freshCol = force(await materialize({ ...repo, ...optsCol }));
    const freshBox = force(await materialize({ ...repo, ...optsBox }));

    // The answers first, on all four, because asking a question is what *creates* a maintained
    // aggregate — comparing structures before both sides have been asked would compare an index
    // that exists with one that does not, which is a fact about this test and not about drift.
    const [aCol, aBox, aFreshCol] = [answers(col), answers(box), answers(freshCol)];
    answers(freshBox);

    assert.deepStrictEqual(snapshot(col), snapshot(freshCol), `columnar documents, round ${round}`);
    assert.deepStrictEqual(
      col.dumpIndexes(), freshCol.dumpIndexes(), `columnar structures, round ${round}`,
    );
    assert.deepStrictEqual(box.dumpIndexes(), freshBox.dumpIndexes(), `boxed structures, round ${round}`);
    assert.deepEqual(col.verifyIndexes(), [], `columnar drift, round ${round}`);
    assert.deepEqual(box.verifyIndexes(), [], `boxed drift, round ${round}`);

    // The layouts answer identically — incrementally maintained against incrementally maintained,
    // and each against its own rebuild. A rank left stale by a merge would show up here.
    assert.deepStrictEqual(aCol, aBox, `layouts disagree, round ${round}`);
    assert.deepStrictEqual(aCol, aFreshCol, `columnar answers, round ${round}`);
  }
});

test('determinism: the column changes no order, no tie-break, and no group', () => {
  const random = rng(20270818);
  const docs = randomWorld(random, 900, 200);
  const shuffled = docs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const built = [
    ['columnar, insertion order', indexOf(docs, { indexThreshold: 0, columnar: true })],
    ['columnar, shuffled', indexOf(shuffled, { indexThreshold: 0, columnar: true })],
    ['boxed, insertion order', indexOf(docs, { indexThreshold: 0, columnar: false })],
    ['boxed, shuffled', indexOf(shuffled, { indexThreshold: 0, columnar: false })],
  ];
  const QS = [
    { from: 'inv', where: { status: 'posted' }, orderBy: 'total', desc: true },
    { from: 'inv', where: { currency: 'EUR', posted: true }, orderBy: 'total', limit: 40 },
    { from: 'inv', where: { currency: 'JPY' }, orderBy: 'vatRate' }, // every key missing → all ties
    { from: 'inv', where: { net: { op: '>', value: 5000 } }, orderBy: 'net', limit: 25 },
    { from: 'inv', groupBy: 'status', sum: 'net' },
    { from: 'inv', where: { date: { op: 'starts with', value: '2026' } }, orderBy: 'date' },
  ];
  for (const q of QS) {
    const expected = outcome(() => built[0][1].select(q));
    for (const [label, ix] of built.slice(1)) {
      assert.deepStrictEqual(outcome(() => ix.select(q)), expected, `${label}: ${JSON.stringify(q)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Aggregation, against the naive scan as the oracle.
// ---------------------------------------------------------------------------

test('aggregation matches a naive scan over randomised data, and is answered by the index', () => {
  const random = rng(1200);
  const N = 4000;
  const ACCOUNTS = 40;
  const docs = [];
  for (let i = 0; i < N; i++) {
    const cents = Math.floor(random() * 2000000) - 1000000;
    const body = `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, '0')}`;
    docs.push({
      id: `P-${String(i).padStart(6, '0')}`,
      entity: 'posting',
      account: `${1000 + Math.floor(random() * ACCOUNTS) * 10}`,
      amount: cents === 0 ? undefined : `${body.replace('-0.', '-0.')} EUR`,
      side: random() < 0.5 ? 'debit' : 'credit',
    });
  }
  const index = indexOf(docs, { indexThreshold: 0 });

  /** The oracle: no index, no BigInt accumulator reuse, one pass per question. */
  const naiveSum = (account) => {
    let total = 0n;
    for (const d of docs) {
      if (d.account !== account || d.amount === undefined) continue;
      total += parseMoney(d.amount).minor;
    }
    return formatMoney({ code: 'EUR', minor: total });
  };
  const naiveCount = (account) => docs.filter((d) => d.account === account).length;

  const accounts = [...new Set(docs.map((d) => d.account))].sort();
  for (const account of accounts) {
    assert.equal(
      index.sum('posting', 'amount', { account }),
      naiveSum(account),
      `sum of amount over posting where account = ${account}`,
    );
    assert.equal(index.count('posting', { account }), naiveCount(account), account);
  }

  // The trial-balance shape: every account at once.
  const byAccount = index.select({ from: 'posting', groupBy: 'account', sum: 'amount' });
  assert.deepEqual([...byAccount.keys()], accounts);
  for (const account of accounts) assert.equal(byAccount.get(account), naiveSum(account));

  // The whole-entity total, which is what "debits equal credits" reduces to.
  let all = 0n;
  for (const d of docs) if (d.amount !== undefined) all += parseMoney(d.amount).minor;
  assert.equal(index.select({ from: 'posting', sum: 'amount' }), formatMoney({ code: 'EUR', minor: all }));

  // And the counts, grouped.
  const counts = index.select({ from: 'posting', groupBy: 'account', count: true });
  for (const account of accounts) assert.equal(counts.get(account), naiveCount(account));
  assert.equal(index.select({ from: 'posting', count: true }), N);

  // These were answered from maintained aggregates, not by scanning. If that stops being true the
  // benchmark will say so, but the assertion belongs next to the correctness proof.
  const ist = index.indexStats();
  assert.ok(ist.aggIndexes >= 2, `expected maintained aggregates, got ${ist.aggIndexes}`);
  const agg = ist.aggs.find((a) => a.field === 'amount' && a.by === 'account');
  assert.ok(agg && agg.built && agg.usable, 'sum(posting.amount) by account is maintained');
  assert.equal(agg.groups, ACCOUNTS);
  assert.deepEqual(index.verifyIndexes(), []);
});

test('maintained aggregates track corrections exactly, and refuse what FD-1 refuses', async () => {
  const files = new Map();
  for (let i = 0; i < 300; i++) {
    files.set(docPath('posting', `P-${String(i).padStart(3, '0')}`), {
      id: `P-${String(i).padStart(3, '0')}`, entity: 'posting', account: '1200', amount: '0.01 EUR',
    });
  }
  const repo = fakeRepo(files);
  let index = await materialize({ ...repo, indexThreshold: 0 });
  assert.equal(index.sum('posting', 'amount', { account: '1200' }), '3.00 EUR');

  // A correcting entry — never a mutation of the original, per FD-6's spirit — and the maintained
  // sum must land where a fresh scan lands, to the cent.
  const patched = repo.patch(new Map([
    [docPath('posting', 'P-900'),
      { id: 'P-900', entity: 'posting', account: '1200', amount: '-0.01 EUR' }],
    [docPath('posting', 'P-000'), null],
  ]));
  index = await update(index, {
    changed: patched.changed, removed: patched.removed, readBlob: patched.repo.readBlob,
  });
  assert.equal(index.sum('posting', 'amount', { account: '1200' }), '2.98 EUR');
  const fresh = await materialize({ ...patched.repo, indexThreshold: 0 });
  assert.equal(index.sum('posting', 'amount', { account: '1200' }),
    fresh.sum('posting', 'amount', { account: '1200' }));
  assert.deepEqual(index.verifyIndexes(), []);

  // One foreign-currency posting and the account can no longer be summed. That refusal is the
  // point: a trial balance is per currency, and the alternative is a number nobody can defend.
  const mixedRepo = patched.repo.patch(new Map([
    [docPath('posting', 'P-901'),
      { id: 'P-901', entity: 'posting', account: '1200', amount: '1.00 USD', currency: 'USD' }],
  ]));
  const mixed = await update(index, {
    changed: mixedRepo.changed, removed: mixedRepo.removed, readBlob: mixedRepo.repo.readBlob,
  });
  assert.throws(() => mixed.sum('posting', 'amount', { account: '1200' }),
    (e) => e.name === 'QueryError' && e.code === 'MIXED_CURRENCY');
  assert.throws(() => mixed.select({ from: 'posting', sum: 'amount' }),
    (e) => e.name === 'QueryError' && e.code === 'MIXED_CURRENCY');

  // Grouping by currency is the way through — and it is the way through *from the same index*,
  // which is what makes a trial balance affordable. A document with no `currency` field of its own
  // groups under `undefined`, exactly as a scan groups it, so a modelling gap stays visible.
  const perCurrency = mixed.select({ from: 'posting', groupBy: 'currency', sum: 'amount' });
  assert.deepEqual([...perCurrency.entries()], [['USD', '1.00 USD'], [undefined, '2.98 EUR']],
    'the 300 EUR postings carry no currency field, so they group under undefined');
  assert.equal(mixed.select({ from: 'posting', where: { account: '1200' }, count: true }), 301,
    '300 EUR postings (299 originals + the correction) plus the one USD posting');
  assert.deepEqual(mixed.verifyIndexes(), []);
});

// ---------------------------------------------------------------------------
// 5. The planner: what it picks, and the traps it must refuse.
// ---------------------------------------------------------------------------

test('the planner picks the most selective predicate, and scans when an index would not help', () => {
  const random = rng(7788);
  const docs = randomWorld(random, 3000, 500);
  const index = indexOf(docs, { indexThreshold: 0 });

  // An equality predicate on a low-cardinality field is a bad plan; on a high-cardinality field a
  // good one. The planner must prefer the good one even when the bad one is listed first.
  const both = { from: 'inv', where: { posted: true, note: 'note-7' } };
  const plan = explain(index, both);
  assert.match(plan.plan, /note/, `expected the selective predicate to win, got ${plan.plan}`);
  assert.ok(plan.candidates < 200, `candidates ${plan.candidates}`);

  // A predicate that matches most of the entity is not worth an index walk: walking an index to
  // visit 900 of 1000 rows is slower than visiting the 1000. The planner says "scan" and means it.
  const skewed = [];
  for (let i = 0; i < 1000; i++) {
    skewed.push({ id: `S-${String(i).padStart(4, '0')}`, entity: 's', flag: i >= 100, k: i });
  }
  const sk = indexOf(skewed, { indexThreshold: 0 });
  assert.equal(explain(sk, { from: 's', where: { flag: true } }).plan, 'full scan');
  assert.equal(explain(sk, { from: 's', where: { flag: false } }).plan,
    's.flag = (exact 100 of 1000)', 'the selective side of the same field is planned');
  assert.equal(sk.select({ from: 's', where: { flag: true }, count: true }), 900);

  // A primary-key lookup beats everything and never resolves the join first.
  assert.deepEqual(explain(index, { from: 'inv', where: { id: 'I-00007' } }),
    { plan: 'primary key', candidates: 1 });

  // Join-driven: the predicate is on the customer, but the rows are invoices.
  const viaJoin = {
    from: 'inv',
    join: { as: 'cust', from: 'cust', on: 'cust' },
    where: { 'cust.region': 'Bavaria' },
  };
  assert.match(explain(index, viaJoin).plan, /cust\.region .* → inv\.cust/);

  // A range predicate on money uses only the currency's own partition — dinars are three-decimal,
  // so the *canonical* token is the one that gets a plan.
  assert.match(
    explain(index, { from: 'inv', where: { total: { op: '>', value: '29000.000 TND' } } }).plan,
    /inv\.total >/,
  );
  // `29000.00 TND` is not a TND amount at all (FD-1: exactly the minor-unit digits). It is
  // therefore text, the field holds money, and the planner refuses to serve a text range over it
  // rather than quietly dropping every monetary row. A scan, and the right answer.
  assert.equal(
    explain(index, { from: 'inv', where: { total: { op: '>', value: '29000.00 TND' } } }).plan,
    'full scan',
  );
});

test('the planner declines rather than risk a subset — the traps, named', () => {
  // A field holding *both* money and text. `"4999.99 EUR" > "2027"` is true as text, and the money
  // keys do not live in the text domain, so a text-range plan would silently drop rows.
  const docs = [];
  for (let i = 0; i < 400; i++) {
    docs.push({ id: `M-${String(i).padStart(3, '0')}`, entity: 'mixed', v: i % 2 === 0 ? `${i}.00 EUR` : `x${i}` });
  }
  const index = indexOf(docs, { indexThreshold: 0 });
  const oracle = scanSource(index);
  for (const q of [
    { from: 'mixed', where: { v: { op: '>', value: '2027' } } },
    { from: 'mixed', where: { v: { op: 'starts with', value: '1' } } },
    { from: 'mixed', where: { v: { op: 'between', value: ['1', 'z'] } } },
  ]) {
    assert.equal(explain(index, q).plan, 'full scan', JSON.stringify(q));
    assert.deepStrictEqual(outcome(() => index.select(q)), outcome(() => select(oracle, q)));
  }

  // `between [1, 'a']` mixes domains; `in [x, null]` also matches missing values. Both scan.
  assert.equal(explain(index, { from: 'mixed', where: { v: { op: 'between', value: [1, 'a'] } } }).plan,
    'full scan');
  assert.equal(explain(index, { from: 'mixed', where: { v: { op: 'in', value: ['x1', null] } } }).plan,
    'full scan');

  // BigInt and Number share an index bucket but are not `===`. The counting shortcut must decline,
  // and both paths must agree.
  const bigs = [];
  for (let i = 0; i < 400; i++) {
    bigs.push({ id: `B-${String(i).padStart(3, '0')}', entity`.slice(0, 5), entity: 'big', v: i % 3 === 0 ? BigInt(i) : i });
  }
  const bi = indexOf(bigs.map((d, k) => ({ ...d, id: `B-${String(k).padStart(3, '0')}` })), { indexThreshold: 0 });
  const biOracle = scanSource(bi);
  for (const q of [
    { from: 'big', where: { v: 3 }, count: true },
    { from: 'big', where: { v: 3 } },
    { from: 'big', where: { v: { op: '>', value: 100 } }, count: true },
  ]) {
    assert.deepStrictEqual(outcome(() => bi.select(q)), outcome(() => select(biOracle, q)),
      JSON.stringify(q));
  }
  assert.equal(bi.select({ from: 'big', where: { v: 3 }, count: true }), 0, '3n is not 3');
});

test('an index for an absent entity, a capped index, and a below-threshold entity all stay correct', () => {
  const docs = [];
  for (let i = 0; i < 500; i++) docs.push({ id: `T-${i}`, entity: 't', a: i % 5, b: `v${i}` });
  // A cap of one field index: the second field must fall back to scanning, not to guessing.
  const capped = indexOf(docs, { indexThreshold: 0, maxFieldIndexes: 1 });
  const oracle = scanSource(capped);
  assert.deepEqual(capped.select({ from: 't', where: { a: 2 } }).length,
    select(oracle, { from: 't', where: { a: 2 } }).length);
  assert.deepEqual(capped.select({ from: 't', where: { b: 'v7' } }).map((d) => d.id), ['T-7']);
  const ist = capped.indexStats();
  assert.equal(ist.fieldIndexes, 1);
  assert.ok(ist.declined >= 1, 'a declined index is reported, not hidden');

  // The default threshold means a small entity is never indexed, and is answered identically.
  const small = indexOf(docs.slice(0, 10));
  assert.equal(small.indexStats().fieldIndexes, 0);
  assert.deepEqual(small.select({ from: 't', where: { a: 2 } }).map((d) => d.id), ['T-2', 'T-7']);

  // An entity this peer holds nothing of.
  assert.deepEqual(capped.select({ from: 'ghost', where: { a: 1 } }), []);
  assert.equal(capped.select({ from: 'ghost', count: true }), 0);
  assert.equal(capped.select({ from: 'ghost', sum: 'a' }), 0);
  assert.equal(capped.ensureIndex('ghost', 'a'), false);
});

test('determinism: identical order regardless of insertion order, with an index in play', () => {
  const random = rng(4242);
  const docs = randomWorld(random, 900, 200);
  const shuffled = docs.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const a = indexOf(docs, { indexThreshold: 0 });
  const b = indexOf(shuffled, { indexThreshold: 0 });

  for (const q of [
    { from: 'inv', where: { status: 'posted' } },
    { from: 'inv', where: { status: 'posted' }, limit: 25 },
    { from: 'inv', where: { currency: 'EUR' }, orderBy: 'total', desc: true, limit: 40 },
    { from: 'inv', where: { currency: 'JPY' }, orderBy: 'vatRate' }, // every key missing → all ties
    { from: 'inv', groupBy: 'status' },
    { from: 'inv', where: { date: { op: 'starts with', value: '2026' } }, orderBy: 'date' },
  ]) {
    const ra = shape(a.select(q));
    const rb = shape(b.select(q));
    if (ra instanceof Object && !Array.isArray(ra)) continue;
    assert.deepEqual(ra, rb, JSON.stringify(q));
  }
  // Groups too: same keys, same order, same members.
  const ga = a.select({ from: 'inv', groupBy: 'status' });
  const gb = b.select({ from: 'inv', groupBy: 'status' });
  assert.deepEqual([...ga.keys()], [...gb.keys()]);
  for (const k of ga.keys()) {
    assert.deepEqual(ga.get(k).map((d) => d.id), gb.get(k).map((d) => d.id), `group ${k}`);
  }
});

test('compile() validates without touching a document, so a rule can pay it once', () => {
  const index = indexOf([{ id: 'X-1', entity: 'x', v: 1 }]);
  assert.throws(() => compile(index, { from: 'x', nope: 1 }), QueryError);
  assert.throws(() => compile(index, { from: 'x', where: { v: { op: '?', value: 1 } } }), QueryError);
  const c = compile(index, { from: 'x', where: { v: 1 } });
  assert.equal(c.plain.length, 1);
  assert.equal(c.q.from, 'x');
});

// ===========================================================================
// The scale benchmark. Gate item 7 is "scale is measured, not asserted", and a missing benchmark is
// a failed gate — so this runs a real ladder to a million documents and prints the numbers,
// flattering or not. It is off by default because a million-document run costs about a gigabyte and
// several seconds, and `npm test` is something other agents run constantly:
//
//     ND_SCALE=15000,150000,1000000 node --expose-gc --test test/e-read.test.js
//
// `--expose-gc` is optional and only affects the memory column, which says which mode it used.
// Nothing here writes to disk: the whole repo is synthesised in memory, and the read path does not
// write anywhere by construction.
// ===========================================================================

/** A repo that *generates* its blobs, so the harness is not the thing being measured. */
function syntheticRepo(nInv, nCust, nPost) {
  const REGIONS = ['Bavaria', 'Berlin', 'Hesse', 'Saxony', 'NRW', 'Ile-de-France', 'Lombardy', 'Noord-Holland'];
  const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const enc2 = new TextEncoder();
  const override = new Map();

  /** Deterministic per-index hash — reproducible without holding any state. */
  const h = (i, salt) => {
    let x = (i ^ (salt * 0x9e3779b9)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };

  const custId = (i) => `C-${String(i).padStart(7, '0')}`;
  const invId = (i) => `INV-${String(i).padStart(8, '0')}`;
  const postId = (i) => `P-${String(i).padStart(8, '0')}`;

  const makeCust = (i) => ({
    id: custId(i), entity: 'customer', name: `Customer ${i}`,
    region: REGIONS[h(i, 1) % REGIONS.length],
    country: ['DE', 'FR', 'IT', 'NL'][h(i, 2) % 4],
  });
  const makeInv = (i) => {
    const cents = h(i, 4) % 4000000;
    return {
      id: invId(i), entity: 'invoice',
      customer: custId(h(i, 3) % nCust),
      total: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')} ` +
        (h(i, 5) % 20 === 0 ? 'CHF' : 'EUR'),
      currency: h(i, 5) % 20 === 0 ? 'CHF' : 'EUR',
      // The same amount as a plain JS number, carried only so the benchmark can separate "we added
      // indexes" from "money became an exact string". COMPROMISES #3 measured a numeric total; a
      // fair before/after has to measure both.
      totalNum: cents / 100,
      date: `${2026 + (h(i, 6) % 3)}-${MONTHS[h(i, 7) % 12]}-${String((h(i, 8) % 28) + 1).padStart(2, '0')}`,
      vatRate: 19,
    };
  };
  const makePost = (i) => {
    const cents = (h(i, 9) % 2000000) - 1000000;
    return {
      id: postId(i), entity: 'posting',
      account: `${1000 + (h(i, 10) % 400) * 10}`,
      amount: `${Math.trunc(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, '0')} EUR`,
      side: h(i, 11) % 2 === 0 ? 'debit' : 'credit',
      currency: 'EUR',
    };
  };

  const tree = new Map();
  for (let i = 0; i < nCust; i++) tree.set(docPath('customer', custId(i)), `c${i}`);
  for (let i = 0; i < nInv; i++) tree.set(docPath('invoice', invId(i)), `i${i}`);
  for (let i = 0; i < nPost; i++) tree.set(docPath('posting', postId(i)), `p${i}`);

  const readBlob = async (oid) => {
    const got = override.get(oid);
    if (got !== undefined) return enc2.encode(JSON.stringify(got));
    const i = Number(oid.slice(1));
    if (oid.charCodeAt(0) === 99) return enc2.encode(JSON.stringify(makeCust(i)));
    if (oid.charCodeAt(0) === 105) return enc2.encode(JSON.stringify(makeInv(i)));
    return enc2.encode(JSON.stringify(makePost(i)));
  };

  return {
    tree,
    readTree: async () => new Map(tree),
    readBlob,
    invId,
    custId,
    /** Change `n` invoices in place; returns the `changed` map `update()` wants. */
    changeInvoices(n) {
      const changed = new Map();
      for (let k = 0; k < n; k++) {
        const i = (k * 7919) % nInv;
        const oid = `x${i}`;
        override.set(oid, { ...makeInv(i), total: '1.00 EUR', currency: 'EUR', date: '2027-08-01' });
        changed.set(docPath('invoice', invId(i)), oid);
      }
      return changed;
    },
  };
}

function ms(t) {
  return `${t < 10 ? t.toFixed(3) : t.toFixed(1)} ms`;
}

function timeBest(fn, iterations) {
  let best = Infinity;
  let total = 0;
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    fn();
    const dt = performance.now() - t;
    total += dt;
    if (dt < best) best = dt;
  }
  return { mean: total / iterations, best };
}

test('benchmark: the scale ladder (ND_SCALE=15000,150000,1000000 to run)', async (t) => {
  const spec = process.env.ND_SCALE;
  if (!spec) {
    t.diagnostic('skipped — set ND_SCALE=15000,150000,1000000 (see the comment above)');
    return;
  }
  const scales = spec.split(',').map((s) => Number.parseInt(s.trim(), 10)).filter((n) => n > 0);
  /** `ND_COLUMNAR=off` runs the same ladder with no columnar projection — the A/B of FD-10 item 1. */
  const columnar = process.env.ND_COLUMNAR !== 'off';
  const gc = typeof global.gc === 'function' ? global.gc : null;
  const heap = () => {
    if (gc) {
      gc();
      gc();
    }
    return process.memoryUsage().heapUsed / 1048576;
  };

  for (const S of scales) {
    const nCust = Math.max(1000, Math.floor(S / 8));
    const nPost = S;
    const repo = syntheticRepo(S, nCust, nPost);
    const docs = S + nCust + nPost;
    const before = heap();

    const t0 = performance.now();
    let index = await materialize({ ...repo, columnar, builtFrom: 'f'.repeat(40) });
    const buildMs = performance.now() - t0;
    const afterBuild = heap();

    const st = index.stats();
    assert.equal(st.readable, docs);

    const APPENDIX_VI = {
      from: 'invoice',
      join: { as: 'customer', from: 'customer', on: 'customer' },
      where: {
        total: { op: '>', value: '10000.00 EUR' },
        currency: 'EUR',
        date: { op: 'between', value: ['2027-07-01', '2027-09-30'] },
        'customer.region': 'Bavaria',
      },
      orderBy: 'total',
      desc: true,
    };
    const APPENDIX_VI_NUM = {
      ...APPENDIX_VI,
      where: { ...APPENDIX_VI.where, total: undefined, totalNum: { op: '>', value: 10000 } },
      orderBy: 'totalNum',
    };
    delete APPENDIX_VI_NUM.where.total;
    const EQ = { from: 'invoice', where: { customer: repo.custId(17) } };
    const RANGE = { from: 'invoice', where: { total: { op: '>=', value: '39000.00 EUR' } } };
    const TRIAL = { from: 'posting', groupBy: 'account', sum: 'amount' };
    const ONE_ACCOUNT = { from: 'posting', where: { account: '1200' }, sum: 'amount' };
    const PK = { from: 'invoice', where: { id: repo.invId(Math.floor(S / 2)) } };

    // Cold: the first execution of a novel query also *builds* the index it needs. That number is
    // published too, because "warm" alone would be a half-truth.
    const cold = {};
    for (const [name, q] of Object.entries({ APPENDIX_VI, APPENDIX_VI_NUM, EQ, RANGE, TRIAL, ONE_ACCOUNT })) {
      const t = performance.now();
      index.select(q);
      cold[name] = performance.now() - t;
    }
    const afterIndexes = heap();

    const warm = {
      'Appendix VI (join + 4 predicates + sort), FD-1 money': timeBest(() => index.select(APPENDIX_VI), 20),
      'Appendix VI, plain-number total (v0.1 comparison)': timeBest(() => index.select(APPENDIX_VI_NUM), 20),
      'indexed equality lookup (invoices of one customer)': timeBest(() => index.select(EQ), 200),
      'range query (total >= 39 000.00 EUR)': timeBest(() => index.select(RANGE), 20),
      'point lookup by id': timeBest(() => index.select(PK), 500),
      'sum of amount over posting where account = X': timeBest(() => index.select(ONE_ACCOUNT), 500),
      'trial balance: groupBy account + sum (all postings)': timeBest(() => index.select(TRIAL), 20),
      'count of all invoices': timeBest(() => index.select({ from: 'invoice', count: true }), 500),
      'sum of a plain-number field (vatRate) over all invoices':
        timeBest(() => index.select({ from: 'invoice', sum: 'vatRate' }), 5),
    };

    const changed = repo.changeInvoices(100);
    const t1 = performance.now();
    const updated = await update(index, { changed, removed: [], readBlob: repo.readBlob });
    const updateMs = performance.now() - t1;
    assert.equal(updated.get('invoice', repo.invId(0)).total, '1.00 EUR');

    // The same query again on the *updated* index, so the number includes maintaining the indexes
    // rather than only building them once.
    const afterUpdate = timeBest(() => updated.select(APPENDIX_VI), 20);
    assert.deepEqual(updated.verifyIndexes(), [], 'no drift at scale');

    const ist = updated.indexStats();
    const rows = updated.select(APPENDIX_VI);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(compareValues(rows[i - 1].total, rows[i].total) >= 0, 'ordered by amount, desc');
    }

    const pad = (s, n) => String(s).padEnd(n);
    const lines = [
      '',
      `  ══ scale ${S.toLocaleString('en-US')} invoices ` +
        `(+${nCust.toLocaleString('en-US')} customers, +${nPost.toLocaleString('en-US')} postings ` +
        `= ${docs.toLocaleString('en-US')} documents, columnar=${columnar}) ══`,
      `  materialize                                        ${ms(buildMs)}  ` +
        `(${((buildMs / docs) * 1000).toFixed(2)} µs/doc)`,
      `  incremental update, 100 changed invoices            ${ms(updateMs)}`,
      `  Appendix VI query after that update                 ${ms(afterUpdate.mean)} mean / ${ms(afterUpdate.best)} best`,
      '  cold (first run of the query, index build included):',
    ];
    for (const [name, v] of Object.entries(cold)) lines.push(`    ${pad(name, 48)} ${ms(v)}`);
    lines.push('  warm (mean / best):');
    for (const [name, v] of Object.entries(warm)) {
      lines.push(`    ${pad(name, 52)} ${ms(v.mean)} / ${ms(v.best)}`);
    }
    lines.push(
      `  heapUsed ${gc ? '(after global.gc)' : '(no --expose-gc: upper bound)'}:`,
      `    before materialize                               ${before.toFixed(0)} MB`,
      `    documents only                                   ${afterBuild.toFixed(0)} MB ` +
        `(+${(afterBuild - before).toFixed(0)} MB, ${(((afterBuild - before) * 1048576) / docs).toFixed(0)} B/doc)`,
      `    with ${ist.fieldIndexes} field + ${ist.aggIndexes} aggregate indexes            ` +
        `${afterIndexes.toFixed(0)} MB (+${(afterIndexes - afterBuild).toFixed(0)} MB for the indexes)`,
      `    distinct index keys                              ${ist.distinctKeys.toLocaleString('en-US')}`,
      '  ───────────────────────────────────────────────────────────────────────',
      '',
    );
    console.log(lines.join('\n'));
  }
});

// ===========================================================================
// The memory ceiling, in documents rather than in invoices.
//
// FD-10's target is stated in documents — "hold 10 M documents ... within a browser-plausible
// budget" — so it needs a ladder whose x-axis is documents, run in a heap the size of the budget.
// The ladder above is keyed on invoices and each rung is 2.125 documents per invoice, which is the
// right shape for query cost and the wrong one for a ceiling.
//
// This is README.md §8.4's fixture, unchanged so the numbers are comparable: N documents of one
// entity, two field indexes and one maintained aggregate, `heapUsed` after a forced collection.
//
//     ND_MEM=1000000,2000000,3000000,4000000 \
//       node --expose-gc --max-old-space-size=2048 --test test/e-read.test.js
//
// The heap size is the measurement. 2048 MB is a conservative browser tab; running it in 8 GB
// answers a different question (how much does a document cost) and the test prints which.
// `ND_COLUMNAR=off` measures the same ladder with no columnar projection, which is what a caller
// that is memory-bound rather than latency-bound would set.
// ===========================================================================
test('benchmark: the memory ceiling in documents (ND_MEM=1000000,... to run)', async (t) => {
  const spec = process.env.ND_MEM;
  if (!spec) {
    t.diagnostic('skipped — set ND_MEM=1000000,2000000,3000000,4000000 (see the comment above)');
    return;
  }
  const columnar = process.env.ND_COLUMNAR !== 'off';
  const gc = typeof global.gc === 'function' ? global.gc : null;
  const heap = () => {
    if (gc) {
      gc();
      gc();
    }
    return process.memoryUsage().heapUsed / 1048576;
  };
  // `getHeapStatistics()` is the only way to read `--max-old-space-size` back, so the ladder can
  // print the budget it measured against instead of asking the reader to remember the flag.
  const limitMB = Math.round(getHeapStatistics().heap_size_limit / 1048576);

  for (const N of spec.split(',').map((s) => Number.parseInt(s.trim(), 10)).filter((n) => n > 0)) {
    const enc3 = new TextEncoder();
    const h = (i, salt) => {
      let x = (i ^ (salt * 0x9e3779b9)) >>> 0;
      x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
      x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
      return (x ^ (x >>> 16)) >>> 0;
    };
    const id = (i) => `P-${String(i).padStart(9, '0')}`;
    const make = (i) => {
      const c = (h(i, 9) % 2000000) - 1000000;
      return {
        id: id(i), entity: 'posting', account: `${1000 + (h(i, 10) % 400) * 10}`,
        amount: `${Math.trunc(c / 100)}.${String(Math.abs(c % 100)).padStart(2, '0')} EUR`,
        side: h(i, 11) % 2 === 0 ? 'debit' : 'credit', currency: 'EUR',
      };
    };
    // The tree map is part of the peak and therefore part of the ceiling: it is what `readTree()`
    // hands over, and at these scales it is hundreds of megabytes on its own. Measured separately
    // rather than folded into the per-document figure, because it is the *caller's* allocation and
    // a streaming tree reader would remove it.
    const empty = heap();
    const tree = new Map();
    for (let i = 0; i < N; i++) tree.set(docPath('posting', id(i)), `p${i}`);
    const withTree = heap();
    const readBlob = async (oid) => enc3.encode(JSON.stringify(make(Number(oid.slice(1)))));

    const t0 = performance.now();
    const index = await materialize({
      readTree: async () => new Map(tree), readBlob, columnar,
      indexHints: [{ entity: 'posting', field: 'account' }, { entity: 'posting', field: 'amount' }],
      aggregateHints: [{ entity: 'posting', field: 'amount', by: 'account' }],
    });
    const buildMs = performance.now() - t0;
    const after = heap();
    assert.equal(index.stats().readable, N);

    const trial = timeBest(() => index.select({ from: 'posting', groupBy: 'account', sum: 'amount' }), 5);
    const one = timeBest(() => index.select({ from: 'posting', where: { account: '1200' }, sum: 'amount' }), 200);
    const pk = timeBest(() => index.select({ from: 'posting', where: { id: id(Math.floor(N / 2)) } }), 200);
    const balance = index.select({ from: 'posting', groupBy: 'account', sum: 'amount' });
    assert.equal(balance.size, 400);

    console.log(
      `\n  ══ ${N.toLocaleString('en-US')} documents, columnar=${columnar}, heap limit ${limitMB} MB ══\n` +
      `    materialize                    ${(buildMs / 1000).toFixed(1)} s\n` +
      `    heapUsed, tree map only        ${(withTree - empty).toFixed(0)} MB ` +
        `(${(((withTree - empty) * 1048576) / N).toFixed(0)} B/path — the caller's, not ours)\n` +
      `    heapUsed, index               +${(after - withTree).toFixed(0)} MB ` +
        `(${(((after - withTree) * 1048576) / N).toFixed(0)} B/doc, documents + 2 field + 1 aggregate)\n` +
      `    heapUsed, all-in               ${after.toFixed(0)} MB\n` +
      `    trial balance (400 accounts)   ${ms(trial.best)}\n` +
      `    sum over one account           ${ms(one.best)}\n` +
      `    point lookup by id             ${ms(pk.best)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 6. The aggregation contract with agent G2's grammar v2 §13.3.
// ---------------------------------------------------------------------------

test("World.matching and World.aggregate — the §13.3 contract, answered by the index", () => {
  const docs = [];
  for (let i = 0; i < 900; i++) {
    docs.push({
      id: `P-${String(i).padStart(4, '0')}`,
      entity: 'posting',
      'journal-entry': `JE-${String(i % 90).padStart(3, '0')}`,
      account: i % 2 === 0 ? '1200' : '4400',
      debit: i % 2 === 0 ? `${10 + (i % 7)}.00 EUR` : '0.00 EUR',
      credit: i % 2 === 0 ? '0.00 EUR' : `${10 + (i % 7)}.00 EUR`,
      cancelled: i % 100 === 0,
      lines: i % 3,
    });
  }
  const index = indexOf(docs, { indexThreshold: 0 });

  // `count of posting where account is "1200"` — one bucket size.
  assert.deepEqual(
    index.aggregate({ kind: 'count', entity: 'posting', field: null, fieldType: null,
      filter: [{ field: 'account', op: '=', value: '1200' }] }),
    { value: 450 },
  );
  // `count of posting` — O(1).
  assert.deepEqual(
    index.aggregate({ kind: 'count', entity: 'posting', field: null, fieldType: null, filter: [] }),
    { value: 900 },
  );
  // `sum of debit over posting where account is "1200"` — exact, from a maintained aggregate.
  const naive = (pred, field) => {
    let t = 0n;
    for (const d of docs) if (pred(d)) t += parseMoney(d[field]).minor;
    return formatMoney({ code: 'EUR', minor: t });
  };
  assert.deepEqual(
    index.aggregate({ kind: 'sum', entity: 'posting', field: 'debit', fieldType: 'money',
      filter: [{ field: 'account', op: '=', value: '1200' }] }),
    { value: naive((d) => d.account === '1200', 'debit') },
  );

  // §13's own example: debits equal credits, per account, both sides from the index.
  for (const account of ['1200', '4400']) {
    const f = [{ field: 'account', op: '=', value: account }];
    const dr = index.aggregate({ kind: 'sum', entity: 'posting', field: 'debit', fieldType: 'money', filter: f });
    const cr = index.aggregate({ kind: 'sum', entity: 'posting', field: 'credit', fieldType: 'money', filter: f });
    assert.equal(dr.value, naive((d) => d.account === account, 'debit'));
    assert.equal(cr.value, naive((d) => d.account === account, 'credit'));
  }

  // `for this journal-entry` plus `where cancelled is false` — two filters compose, and this is
  // still not a scan: the planner drives from the reference, which is the selective one.
  const two = [
    { field: 'journal-entry', op: '=', value: 'JE-000' },
    { field: 'cancelled', op: '=', value: false },
  ];
  assert.deepEqual(
    index.aggregate({ kind: 'count', entity: 'posting', field: null, fieldType: null, filter: two }),
    { value: docs.filter((d) => d['journal-entry'] === 'JE-000' && d.cancelled === false).length },
  );
  assert.match(
    explain(index, { from: 'posting', where: { 'journal-entry': 'JE-000', cancelled: false } }).plan,
    /journal-entry/,
    'the selective filter drives the plan, not the 99%-true one',
  );

  // `exists` / `not exists` from §13's filter production.
  assert.deepEqual(
    index.aggregate({ kind: 'count', entity: 'posting', field: null, fieldType: null,
      filter: [{ field: 'account', op: 'exists' }] }),
    { value: 900 },
  );
  assert.deepEqual(
    index.aggregate({ kind: 'count', entity: 'posting', field: null, fieldType: null,
      filter: [{ field: 'nope', op: 'not exists' }] }),
    { value: 900 },
  );

  // `matching()` hands back documents, in the deterministic order everything else uses.
  const m = index.matching('posting', [{ field: 'journal-entry', op: '=', value: 'JE-001' }]);
  assert.deepEqual(m.map((d) => d.id), docs.filter((d) => d['journal-entry'] === 'JE-001').map((d) => d.id));

  // The two documented declines. Both are "ask me differently", not failures.
  assert.equal(
    index.aggregate({ kind: 'sum', entity: 'posting', field: 'debit', fieldType: 'money',
      filter: [{ field: 'account', op: '=', value: '9999' }] }),
    null,
    'a money sum over an empty set: §19.3 currency-free zero is polism to spell, not the index',
  );
  const mixed = indexOf([
    ...docs,
    { id: 'P-9999', entity: 'posting', account: '1200', debit: '1.00 USD', credit: '0.00 USD',
      'journal-entry': 'JE-000', cancelled: false, lines: 0 },
  ], { indexThreshold: 0 });
  assert.equal(
    mixed.aggregate({ kind: 'sum', entity: 'posting', field: 'debit', fieldType: 'money',
      filter: [{ field: 'account', op: '=', value: '1200' }] }),
    null,
    'a mixed-currency sum is a refusal runtime/money/ owns, so the index declines rather than throw',
  );

  // A plain-number sum still works, and is a number.
  assert.deepEqual(
    index.aggregate({ kind: 'sum', entity: 'posting', field: 'lines', fieldType: 'number', filter: [] }),
    { value: docs.reduce((a, d) => a + d.lines, 0) },
  );

  // Nonsense in the spec is declined, not guessed at.
  assert.equal(index.aggregate(null), null);
  assert.equal(index.aggregate({ kind: 'average', entity: 'posting', filter: [] }), null);
  assert.equal(index.aggregate({ kind: 'sum', entity: 'posting', field: null, filter: [] }), null);
  assert.equal(index.aggregate({ kind: 'count', entity: 'posting', filter: 'nope' }), null);
});
