// test/d-live.test.js — the Live Layer (runtime/live/).
//
// What is being proven, in order:
//   1. Appendix XI's delivery note LS-2027-0033, literally: the 95% case and the 5% case.
//   2. PN-Counter arithmetic across three peers, and duplicate delivery as a no-op.
//   3. OR-Set observed-remove, in both delivery orders.
//   4. HLC monotonicity under a backwards-jumping wall clock, and one total order on all peers.
//   5. The mathematical property — merge commutative, associative, idempotent — as a
//      property test over seeded random histories.
//   6. snapshot() yields a plain Doc: no CRDT metadata reaches git.
//   7. The ERP conflict policy: reject / notify / merge.
//   8. MONEY (FD-1): an exact-money PN-Counter, currency as identity, mixed currencies
//      refused rather than guessed, and the float-divergence hazard demonstrated by name.
//   9. A grep guard: no float construct on any monetary path in runtime/live/.
//
// node:test + node:assert only. No Math.random() anywhere: the PRNG below is ours, so a
// failing property test is reproducible from its seed alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hlc, compareStamps, stampId } from '../runtime/live/hlc.js';
import { pnCounter, lwwRegister, orSet, mvRegister } from '../runtime/live/crdt.js';
import { session, transport, PolicyError, compilePolicy, converged } from '../runtime/live/session.js';
// The money module is the judge of every monetary assertion below. The Live Layer must agree
// with it, not with a second opinion written here — that is how agent M's 87-currency table
// and this file stay one implementation (three Wave 1 defects came from the opposite).
import {
  money,
  fromMinor,
  toMinor,
  currencyOf,
  toString as moneyToString,
  add as moneyAdd,
  zero as moneyZero,
  compare as moneyCompare,
  MoneyError,
} from '../runtime/money/money.js';
// The one shared source scanner (test/_source-guard.js), used by the float guard in section 9.
// Not a fourth implementation: the naive version of that guard flagged a file for `Math.random`
// because its own comment promised the opposite.
import { scanSources } from './_source-guard.js';

// =======================================================================================
// Test helpers
// =======================================================================================

/**
 * A seeded deterministic PRNG (xorshift32). Written here on purpose: the CONTRACT forbids
 * Math.random() and a property test that cannot be replayed from its seed is not a proof of
 * anything. Same seed -> same history -> same failure, on any machine, in any year.
 * @param {number} seed
 */
function rng(seed) {
  let state = seed | 0;
  if (state === 0) state = 0x1a2b3c4d; // xorshift is stuck at zero
  function next() {
    state ^= state << 13;
    state |= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state |= 0;
    return (state >>> 0) / 0x100000000;
  }
  return {
    next,
    /** integer in [0, n) */
    int: (n) => Math.floor(next() * n) % n,
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    bool: (p = 0.5) => next() < p,
  };
}

/** A controllable wall clock. Nothing in the Live Layer ever calls Date.now(). */
function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  const c = () => t;
  c.tick = (ms = 1) => {
    t += ms;
    return t;
  };
  c.set = (ms) => {
    t = ms;
    return t;
  };
  return c;
}

/**
 * An invoice as it sits in git, with money as FD-1 tokens.
 *
 *   `revenue`  a money counter's starting point — the committed amount live ops move;
 *   `netTotal` a second one, so a test can prove two money fields do not interfere;
 *   `prices`   a set of amounts (OR-Set), for canonical dedupe and value ordering;
 *   `stock`    a plain counter, to prove the plain path is untouched by any of this.
 *
 * @param {string} [currency] @param {object} [extra]
 */
function invoice(currency = 'EUR', extra = {}) {
  const zero = moneyToString(fromMinor(0n, currency));
  return {
    id: 'R-2027-0451',
    entity: 'invoice',
    status: 'draft',
    revenue: zero,
    netTotal: moneyToString(fromMinor(100000n, currency)),
    prices: [moneyToString(fromMinor(1000n, currency)), moneyToString(fromMinor(900n, currency))],
    stock: 500,
    notes: '',
    ...extra,
  };
}

/** A policy that lets money converge by the counter/OR-Set rule, as the manifesto's line 130 wants. */
const MONEY_MERGE_POLICY = {
  stateField: 'status',
  rules: [
    { when: { status: ['released', 'sent', 'booked'] }, fields: '*', on: 'reject',
      message: 'Invoice R-2027-0451 is released. Reopen it before editing.' },
    { fields: ['revenue', 'netTotal', 'prices', 'stock', 'reference'], on: 'merge' },
  ],
  default: { on: 'notify' },
};

/** The delivery note of Appendix XI, as it sits in git before anybody opens it. */
function deliveryNote() {
  return {
    id: 'LS-2027-0033',
    entity: 'delivery-note',
    status: 'draft',
    customer: 'CUST-4711',
    deliveryDate: '2027-11-12',
    notes: '',
    items: ['ART-1001', 'ART-1002'],
    quantity: 24,
  };
}

// =======================================================================================
// 1. Appendix XI — parallel editing on the same delivery note
// =======================================================================================

test('Appendix XI 95% case: A edits deliveryDate, B types into notes — both survive, no conflict', () => {
  const clockA = fakeClock();
  const clockB = fakeClock();
  const a = session(deliveryNote(), 'A', clockA);
  const b = session(deliveryNote(), 'B', clockB);
  const bus = transport();
  bus.join(a);
  bus.join(b);

  // Both start from the same git HEAD.
  assert.equal(a.snapshot().deliveryDate, '2027-11-12');
  assert.deepEqual(a.snapshot(), b.snapshot());

  clockA.tick(5);
  a.set('deliveryDate', '2027-11-15'); // "12.11." -> "15.11."
  clockB.tick(7);
  b.set('notes', 'Ramp 3, ask for Mr Weber');

  bus.deliver();

  assert.deepEqual(a.conflicts(), [], 'different fields must not conflict');
  assert.deepEqual(b.conflicts(), []);
  assert.equal(a.snapshot().deliveryDate, '2027-11-15');
  assert.equal(a.snapshot().notes, 'Ramp 3, ask for Mr Weber');
  assert.deepEqual(a.snapshot(), b.snapshot(), 'both peers hold the same document');
  assert.ok(converged([a, b]));
});

test('Appendix XI 5% case: both set deliveryDate concurrently — conflicts() reports BOTH values with authors, resolve() settles it for both peers', () => {
  const clockA = fakeClock();
  const clockB = fakeClock();
  const a = session(deliveryNote(), 'A', clockA);
  const b = session(deliveryNote(), 'B', clockB);
  const bus = transport();
  bus.join(a);
  bus.join(b);

  // Concurrent: neither peer has heard from the other when it writes. Nothing is delivered
  // between these two lines — that is exactly what "simultaneously" means in a mesh.
  clockA.tick(3);
  a.set('deliveryDate', '2027-11-15');
  clockB.tick(3);
  b.set('deliveryDate', '2027-11-16');

  bus.deliver();

  for (const [name, peer] of [['A', a], ['B', b]]) {
    const conflicts = peer.conflicts();
    assert.equal(conflicts.length, 1, `${name} must see exactly one conflict`);
    assert.equal(conflicts[0].field, 'deliveryDate');
    const seen = conflicts[0].values.map((v) => `${v.by}:${v.value}`).sort();
    assert.deepEqual(
      seen,
      ['A:2027-11-15', 'B:2027-11-16'],
      `${name} must see BOTH values with their authors — no silent last-writer-wins`,
    );
  }

  // Both peers must agree on the conflict itself, byte for byte, or the two conflict UIs
  // would show different things.
  assert.equal(JSON.stringify(a.conflicts()), JSON.stringify(b.conflicts()));

  // A fact cannot have two values: committing is refused until a human decides.
  assert.throws(() => a.snapshot(), PolicyError);
  assert.throws(() => b.snapshot(), PolicyError);

  // The human at A clicks "keep 16.11." — the decision travels.
  clockA.tick(2);
  a.resolve('deliveryDate', '2027-11-16');
  bus.deliver();

  assert.deepEqual(a.conflicts(), []);
  assert.deepEqual(b.conflicts(), [], 'the other peer sees the decision, it does not re-decide');
  assert.equal(a.snapshot().deliveryDate, '2027-11-16');
  assert.equal(b.snapshot().deliveryDate, '2027-11-16');
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(converged([a, b]));
});

test('Appendix XI: nothing is lost when a peer was offline during the edit (LS-2027-0033, 3 peers)', () => {
  const clocks = { A: fakeClock(), B: fakeClock(), C: fakeClock() };
  const peers = {
    A: session(deliveryNote(), 'A', clocks.A),
    B: session(deliveryNote(), 'B', clocks.B),
    C: session(deliveryNote(), 'C', clocks.C),
  };
  const bus = transport();
  for (const p of Object.values(peers)) bus.join(p);

  bus.isolate('C'); // C's laptop is shut
  clocks.A.tick(4);
  peers.A.set('notes', 'picked by Ayse');
  clocks.B.tick(4);
  peers.B.inc('quantity', -2);
  bus.deliver();

  assert.equal(peers.C.snapshot().notes, '', 'C has not heard anything yet');
  assert.ok(bus.pending() > 0, 'C still has frames waiting');

  bus.rejoin('C');
  bus.deliver();

  assert.equal(bus.pending(), 0);
  assert.equal(peers.C.snapshot().notes, 'picked by Ayse');
  assert.equal(peers.C.snapshot().quantity, 22);
  assert.deepEqual(peers.A.snapshot(), peers.C.snapshot());
  assert.ok(converged([peers.A, peers.B, peers.C]));
});

// =======================================================================================
// 2. PN-Counter — stock and revenue
// =======================================================================================

test('PN-Counter: concurrent stock movements from 3 peers converge to the exact arithmetic total', () => {
  const clock = fakeClock();
  const a = pnCounter(hlc('A', clock));
  const b = pnCounter(hlc('B', clock));
  const c = pnCounter(hlc('C', clock));

  const opsA = [...a.inc(120), ...a.inc(-8)]; // goods receipt, then a damaged pallet
  const opsB = [...b.inc(-30), ...b.inc(-12)]; // two picks
  const opsC = [...c.inc(45)]; // a return

  a.merge([...opsB, ...opsC]);
  b.merge([...opsC, ...opsA]);
  c.merge([...opsA, ...opsB]);

  const expected = 120 - 8 - 30 - 12 + 45; // 115
  assert.equal(a.value(), expected);
  assert.equal(b.value(), expected);
  assert.equal(c.value(), expected);
  assert.equal(JSON.stringify(a.ops()), JSON.stringify(b.ops()));
  assert.equal(JSON.stringify(b.ops()), JSON.stringify(c.ops()));
});

test('PN-Counter: delivering the same op twice (or ten times) does not change the total — no double-counted stock', () => {
  const clock = fakeClock();
  const a = pnCounter(hlc('A', clock));
  const b = pnCounter(hlc('B', clock));

  const ops = [...a.inc(50), ...a.inc(-5)];
  b.merge(ops);
  assert.equal(b.value(), 45);

  for (let i = 0; i < 10; i += 1) b.merge(ops);
  assert.equal(b.value(), 45, 'a retransmitted goods receipt must not add stock again');

  // Also idempotent when the ops arrive out of order and duplicated.
  const c = pnCounter(hlc('C', clock));
  c.merge([ops[1], ops[0], ops[1], ops[1], ops[0]]);
  assert.equal(c.value(), 45);
  assert.equal(JSON.stringify(b.ops()), JSON.stringify(c.ops()));
});

test('PN-Counter: session-level stock movement starts from the committed value', () => {
  const clockA = fakeClock();
  const clockB = fakeClock();
  const base = { id: 'ART-1001', entity: 'article', status: 'active', stock: 500 };
  const a = session(base, 'A', clockA);
  const b = session(base, 'B', clockB);
  const bus = transport();
  bus.join(a);
  bus.join(b);

  a.inc('stock', 240); // pallet in
  b.inc('stock', -18); // order picked
  b.inc('stock', -2);
  bus.deliver();

  assert.equal(a.snapshot().stock, 500 + 240 - 18 - 2);
  assert.equal(b.snapshot().stock, 720);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

// =======================================================================================
// 3. OR-Set — observed-remove semantics
// =======================================================================================

test('OR-Set: concurrent remove(A) and re-add(B) of the same element — the element survives (remove-then-add delivery)', () => {
  const clock = fakeClock();
  const a = orSet(hlc('A', clock));
  const b = orSet(hlc('B', clock));

  const created = a.add('BATCH-77');
  b.merge(created); // both now observe tag t1

  const removedByA = a.remove('BATCH-77'); // A kills the only tag it has seen
  const readdedByB = b.add('BATCH-77'); // B mints a NEW tag, unseen by A

  a.merge(readdedByB);
  b.merge(removedByA);

  assert.deepEqual(a.value(), ['BATCH-77'], 'the re-add was never observed by the remove');
  assert.deepEqual(b.value(), ['BATCH-77']);
  assert.equal(JSON.stringify(a.ops()), JSON.stringify(b.ops()));
});

test('OR-Set: the other delivery order gives the same answer (add-then-remove delivery)', () => {
  const clock = fakeClock();
  const a = orSet(hlc('A', clock));
  const b = orSet(hlc('B', clock));

  const created = a.add('BATCH-77');
  b.merge(created);

  const removedByA = a.remove('BATCH-77');
  const readdedByB = b.add('BATCH-77');

  // Swap the order relative to the previous test.
  b.merge(removedByA);
  a.merge(readdedByB);

  assert.deepEqual(a.value(), ['BATCH-77']);
  assert.deepEqual(b.value(), ['BATCH-77']);
  assert.equal(JSON.stringify(a.ops()), JSON.stringify(b.ops()));
});

test('OR-Set: a removal both peers have observed really removes', () => {
  const clock = fakeClock();
  const a = orSet(hlc('A', clock));
  const b = orSet(hlc('B', clock));
  b.merge(a.add('ART-9'));
  b.merge(a.add('ART-8'));
  a.merge(b.remove('ART-9'));
  assert.deepEqual(a.value(), ['ART-8']);
  assert.deepEqual(b.value(), ['ART-8']);
});

test('OR-Set: you cannot remove what you have never seen — the op is not even produced', () => {
  const clock = fakeClock();
  const a = orSet(hlc('A', clock));
  assert.deepEqual(a.remove('never-added'), []);
});

test('OR-Set through a session: committed line items get deterministic base tags on every peer', () => {
  const clockA = fakeClock();
  const clockB = fakeClock();
  const a = session(deliveryNote(), 'A', clockA);
  const b = session(deliveryNote(), 'B', clockB);
  const bus = transport();
  bus.join(a);
  bus.join(b);

  a.remove('items', 'ART-1002'); // an item that came from git
  b.add('items', 'ART-1003');
  bus.deliver();

  assert.deepEqual(a.snapshot().items, ['ART-1001', 'ART-1003']);
  assert.deepEqual(b.snapshot().items, ['ART-1001', 'ART-1003']);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

// =======================================================================================
// 4. HLC
// =======================================================================================

test('HLC: stays monotonic when the wall clock jumps backwards (laptop sleeps, NTP corrects)', () => {
  const clock = fakeClock(1000);
  const c = hlc('A', clock);

  const stamps = [c.now(), c.now()];
  clock.set(400); // NTP correction, three quarters of a second into the past
  stamps.push(c.now(), c.now());
  clock.set(999); // still behind where we were
  stamps.push(c.now());
  clock.set(5000); // and now it leaps forward
  stamps.push(c.now());

  for (let i = 1; i < stamps.length; i += 1) {
    assert.equal(
      compareStamps(stamps[i - 1], stamps[i]),
      -1,
      `stamp ${i} must be strictly greater than stamp ${i - 1} despite the clock jump`,
    );
  }
  // Logical time carried on where the wall clock could not.
  assert.equal(stamps[2].wall, 1000);
  assert.equal(stamps[2].counter, 2);
  assert.equal(stamps[5].wall, 5000);
  assert.equal(stamps[5].counter, 0);
});

test('HLC: observing a remote stamp puts local time after it (causality without a server)', () => {
  const clockA = fakeClock(1000);
  const clockB = fakeClock(1000);
  const a = hlc('A', clockA);
  const b = hlc('B', clockB);

  clockA.set(9000);
  const fromA = a.now();
  b.observe(fromA); // B's wall clock is far behind A's
  const afterB = b.now();
  assert.equal(compareStamps(fromA, afterB), -1, 'B writes after what it has read');
});

test('HLC: the total order is stable and identical on every peer (3 peers, shuffled input)', () => {
  const clock = fakeClock(2000);
  const peers = ['A', 'B', 'C'];
  const clocks = Object.fromEntries(peers.map((p) => [p, hlc(p, clock)]));

  /** @type {any[]} */
  const stamps = [];
  const r = rng(20271112);
  for (let i = 0; i < 60; i += 1) {
    if (r.bool(0.4)) clock.tick(r.int(3)); // sometimes time stands still
    stamps.push(clocks[r.pick(peers)].now());
  }

  // Every peer receives the same stamps in a different order and sorts them itself.
  const orderings = [];
  for (let peer = 0; peer < 3; peer += 1) {
    const shuffled = [...stamps];
    const s = rng(1000 + peer);
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = s.int(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    orderings.push(shuffled.sort(compareStamps).map(stampId).join(','));
  }
  assert.equal(orderings[0], orderings[1]);
  assert.equal(orderings[1], orderings[2]);

  // And it is a strict total order: no two distinct stamps compare equal.
  const ids = new Set(stamps.map(stampId));
  assert.equal(ids.size, stamps.length, 'stamps must be unique');
  const sorted = [...stamps].sort(compareStamps);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.equal(compareStamps(sorted[i - 1], sorted[i]), -1);
  }
});

test('HLC: the wall clock is injected — a bad clock is refused, never worked around', () => {
  assert.throws(() => hlc('', () => 1), TypeError);
  assert.throws(() => hlc('A', 1234), TypeError);
  assert.throws(() => hlc('A', () => 'now')().now, TypeError);
  assert.throws(() => hlc('A', () => Number.NaN).now(), TypeError);
  assert.throws(() => hlc('A', () => 1.5).now(), TypeError);
});

// =======================================================================================
// 5. THE PROPERTY: merge is commutative, associative, idempotent
// =======================================================================================

/** Shuffle a copy of `arr` with our own PRNG. */
function shuffle(arr, r) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = r.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('property: all four CRDT types — merge is commutative, associative and idempotent (200 seeds, 3 replicas)', () => {
  const SEEDS = 200;
  let checked = 0;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const r = rng(seed * 7919);
    const clock = fakeClock(1_000_000 + seed);
    const nodes = ['A', 'B', 'C'];

    for (const kind of ['pn', 'lww', 'orset', 'mv']) {
      const make = { pn: pnCounter, lww: lwwRegister, orset: orSet, mv: mvRegister }[kind];
      // Three replicas, each producing ops without seeing the others: genuine concurrency.
      const authors = nodes.map((n) => make(hlc(n, clock)));
      /** @type {any[][]} */
      const histories = authors.map(() => []);

      const rounds = 2 + r.int(5);
      for (let i = 0; i < rounds; i += 1) {
        for (let n = 0; n < authors.length; n += 1) {
          if (r.bool(0.3)) continue;
          if (r.bool(0.5)) clock.tick(r.int(3));
          const reg = authors[n];
          let produced = [];
          if (kind === 'pn') produced = reg.inc(r.int(21) - 10);
          else if (kind === 'lww') produced = reg.set(`v${r.int(5)}`);
          else if (kind === 'mv') produced = reg.set(`v${r.int(5)}`);
          else produced = r.bool(0.6) ? reg.add(`e${r.int(4)}`) : reg.remove(`e${r.int(4)}`);
          histories[n].push(...produced);
        }
      }

      const all = histories.flat();

      // --- COMMUTATIVITY: three replicas, three different arrival orders, one state.
      const replicas = nodes.map((n, i) => {
        const reg = make(hlc(`R${n}`, clock));
        reg.merge(histories[i]); // it already knows what it authored
        return reg;
      });
      const states = replicas.map((reg, i) => {
        // random order, random duplication, random batching
        const order = shuffle(all, rng(seed * 31 + i));
        const withDupes = [];
        for (const op of order) {
          withDupes.push(op);
          if (r.bool(0.25)) withDupes.push(op); // the network delivered it twice
        }
        let cursor = 0;
        while (cursor < withDupes.length) {
          const batch = 1 + r.int(4);
          reg.merge(withDupes.slice(cursor, cursor + batch));
          cursor += batch;
        }
        return JSON.stringify({ ops: reg.ops(), value: reg.value() });
      });
      assert.equal(states[0], states[1], `${kind} seed ${seed}: order must not matter`);
      assert.equal(states[1], states[2], `${kind} seed ${seed}: order must not matter`);

      // --- IDEMPOTENCE: merging the whole history again changes nothing.
      replicas[0].merge(all);
      replicas[0].merge(all);
      assert.equal(
        JSON.stringify({ ops: replicas[0].ops(), value: replicas[0].value() }),
        states[0],
        `${kind} seed ${seed}: merge must be idempotent`,
      );

      // --- ASSOCIATIVITY: merge(merge(a,b),c) == merge(a,merge(b,c)).
      const left = make(hlc('L', clock));
      left.merge(histories[0]);
      left.merge(histories[1]);
      left.merge(histories[2]);

      const rightInner = [...histories[1], ...histories[2]];
      const right = make(hlc('Rr', clock));
      right.merge(rightInner);
      right.merge(histories[0]);

      assert.equal(
        JSON.stringify({ ops: left.ops(), value: left.value() }),
        JSON.stringify({ ops: right.ops(), value: right.value() }),
        `${kind} seed ${seed}: merge must be associative`,
      );
      checked += 1;
    }
  }
  assert.equal(checked, SEEDS * 4, `${SEEDS} seeds x 4 CRDT types must all have been exercised`);
});

test('property: sessions reach byte-identical state under random histories, orders, duplication and delay (150 seeds, 3-5 peers)', () => {
  const SEEDS = 150;
  const POLICY = {
    stateField: 'status',
    rules: [
      { when: { status: 'released' }, fields: '*', on: 'reject' },
      { fields: ['stock', 'revenue', 'items', 'pickers', 'reference'], on: 'merge' },
    ],
    default: { on: 'notify' },
  };
  // Which register a field gets is fixed by the method used on it, and must be the same on
  // every peer — so each pool below is only ever touched by one method.
  const MV_FIELDS = ['deliveryDate', 'notes', 'carrier']; // default 'notify' -> Multi-Value
  const LWW_FIELDS = ['reference']; // 'merge' below -> LWW
  const COUNTER_FIELDS = ['stock', 'revenue']; // 'merge' -> PN-Counter
  const SETS = ['items', 'pickers']; // 'merge' -> OR-Set

  let seedsPassed = 0;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const r = rng(seed * 104729);
    const peerCount = 3 + r.int(3); // 3, 4 or 5
    const names = ['A', 'B', 'C', 'D', 'E'].slice(0, peerCount);
    const clock = fakeClock(1_600_000_000_000 + seed * 1000);
    const base = {
      id: 'LS-2027-0033',
      entity: 'delivery-note',
      status: 'draft',
      deliveryDate: '2027-11-12',
      notes: '',
      carrier: 'DHL',
      items: ['ART-1001', 'ART-1002'],
      pickers: [],
      stock: 500,
      revenue: 0,
    };

    const peers = names.map((n) => session(structuredClone(base), n, hlc(n, clock), { policy: POLICY }));

    /** every op ever produced, in production order @type {any[]} */
    const wire = [];
    /** ops not yet delivered to peer i @type {any[][]} */
    const undelivered = peers.map(() => []);

    const steps = 15 + r.int(40);
    for (let step = 0; step < steps; step += 1) {
      if (r.bool(0.6)) clock.tick(r.int(4));
      const i = r.int(peerCount);
      const peer = peers[i];
      let produced = [];
      const dice = r.int(100);
      if (dice < 30) produced = peer.set(r.pick(MV_FIELDS), `v${r.int(6)}`);
      else if (dice < 40) produced = peer.set(r.pick(LWW_FIELDS), `r${r.int(4)}`);
      else if (dice < 65) produced = peer.inc(r.pick(COUNTER_FIELDS), r.int(41) - 20);
      else if (dice < 85) produced = peer.add(r.pick(SETS), `e${r.int(5)}`);
      else produced = peer.remove(r.pick(SETS), `e${r.int(5)}`);

      wire.push(...produced);
      for (let j = 0; j < peerCount; j += 1) {
        if (j !== i) undelivered[j].push(...produced);
      }

      // Partial, out-of-order, sometimes-duplicated delivery *while* editing continues.
      // This is what creates real concurrency: a peer writes before it has heard.
      if (r.bool(0.5)) {
        const j = r.int(peerCount);
        const queue = undelivered[j];
        const take = shuffle(queue, rng(seed * 13 + step)).slice(0, 1 + r.int(queue.length + 1));
        const batch = [];
        for (const op of take) {
          batch.push(op);
          if (r.bool(0.3)) batch.push(op);
        }
        peers[j].receive(batch);
        undelivered[j] = queue.filter((op) => !take.includes(op));
      }
    }

    // Now the network settles: everybody eventually gets everything, in their own random
    // order, some of it twice. Eventual delivery, at least once, any order — nothing more.
    for (let j = 0; j < peerCount; j += 1) {
      const order = shuffle(wire, rng(seed * 977 + j));
      const withDupes = [];
      for (const op of order) {
        withDupes.push(op);
        if (r.bool(0.2)) withDupes.push(op);
      }
      let cursor = 0;
      while (cursor < withDupes.length) {
        const size = 1 + r.int(6);
        peers[j].receive(withDupes.slice(cursor, cursor + size));
        cursor += size;
      }
    }

    const reference = JSON.stringify(peers[0].ops());
    const refConflicts = JSON.stringify(peers[0].conflicts());
    for (let j = 1; j < peerCount; j += 1) {
      assert.equal(
        JSON.stringify(peers[j].ops()),
        reference,
        `seed ${seed}, ${peerCount} peers: '${names[j]}' diverged from '${names[0]}'`,
      );
      assert.equal(
        JSON.stringify(peers[j].conflicts()),
        refConflicts,
        `seed ${seed}: conflict views must be identical on every peer`,
      );
    }

    // Resolve whatever is open and check the committed fact is identical too.
    for (const conflict of peers[0].conflicts()) {
      clock.tick(1);
      const ops = peers[0].resolve(conflict.field, conflict.values[0].value);
      for (let j = 1; j < peerCount; j += 1) peers[j].receive(ops);
    }
    const snap = JSON.stringify(peers[0].snapshot());
    for (let j = 1; j < peerCount; j += 1) {
      assert.equal(JSON.stringify(peers[j].snapshot()), snap, `seed ${seed}: snapshots must match`);
    }
    seedsPassed += 1;
  }
  assert.equal(seedsPassed, SEEDS, `all ${SEEDS} seeds must pass`);
});

test('property: the transport itself converges under random partitions (80 seeds, 4 peers)', () => {
  const SEEDS = 80;
  let seedsPassed = 0;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const r = rng(seed * 15485863);
    const clock = fakeClock(1_700_000_000_000 + seed);
    const names = ['A', 'B', 'C', 'D'];
    const base = { id: 'GR-0001', entity: 'goods-receipt', status: 'draft', stock: 0, notes: '', items: [] };
    const peers = names.map((n) => session(structuredClone(base), n, hlc(n, clock)));
    const bus = transport();
    for (const p of peers) bus.join(p);

    const steps = 10 + r.int(30);
    for (let step = 0; step < steps; step += 1) {
      clock.tick(r.int(3));
      const peer = peers[r.int(peers.length)];
      const dice = r.int(3);
      if (dice === 0) peer.inc('stock', r.int(21) - 10);
      else if (dice === 1) peer.set('notes', `n${r.int(4)}`);
      else peer.add('items', `e${r.int(4)}`);

      if (r.bool(0.3)) bus.isolate(r.pick(names));
      if (r.bool(0.4)) bus.rejoin(r.pick(names));
      if (r.bool(0.5)) bus.deliver();
    }

    for (const n of names) bus.rejoin(n);
    bus.deliver();

    assert.equal(bus.pending(), 0, `seed ${seed}: the network must drain`);
    assert.ok(converged(peers), `seed ${seed}: all peers must hold byte-identical op sets`);
    for (const conflict of peers[0].conflicts()) {
      clock.tick(1);
      peers[0].resolve(conflict.field, conflict.values[0].value);
    }
    bus.deliver();
    const snap = JSON.stringify(peers[0].snapshot());
    for (const p of peers) assert.equal(JSON.stringify(p.snapshot()), snap);
    seedsPassed += 1;
  }
  assert.equal(seedsPassed, SEEDS);
});

// =======================================================================================
// 6. snapshot() — the seam to eternity
// =======================================================================================

test('snapshot(): a clean Doc, no CRDT metadata, stable key order, plain JSON that opens in 30 years', () => {
  const clock = fakeClock();
  const s = session(deliveryNote(), 'A', clock);
  clock.tick(1);
  s.set('deliveryDate', '2027-11-15');
  s.set('notes', 'two pallets, ramp 3');
  s.inc('quantity', -4);
  s.add('items', 'ART-1003');
  s.remove('items', 'ART-1001');

  const doc = s.snapshot();

  assert.deepEqual(doc, {
    id: 'LS-2027-0033',
    entity: 'delivery-note',
    customer: 'CUST-4711',
    deliveryDate: '2027-11-15',
    items: ['ART-1002', 'ART-1003'],
    notes: 'two pallets, ramp 3',
    quantity: 20,
    status: 'draft',
  });

  // Doc typedef: id and entity present and first, everything else plain data.
  assert.deepEqual(Object.keys(doc).slice(0, 2), ['id', 'entity']);
  assert.deepEqual(
    Object.keys(doc).slice(2),
    [...Object.keys(doc).slice(2)].sort(),
    'remaining keys are sorted, so git diffs stay minimal and readable',
  );

  // No stamps, no tags, no node ids, no ops, no wall clocks anywhere in the bytes.
  const json = JSON.stringify(doc);
  for (const leak of ['stamp', 'counter', 'wall', 'node', 'tag', 'overwrites', 'seq', 'plus', 'minus', 'orset']) {
    assert.equal(json.includes(leak), false, `CRDT metadata '${leak}' leaked into the committed Doc`);
  }
  // And it survives a round trip through text, which is all git stores.
  assert.deepEqual(JSON.parse(json), doc);

  // The session is unchanged by snapshotting: it is a read, not a state transition.
  assert.deepEqual(s.snapshot(), doc);
});

test('snapshot(): an untouched document snapshots back to exactly what was committed', () => {
  const clock = fakeClock();
  const s = session(deliveryNote(), 'A', clock);
  assert.deepEqual(s.snapshot(), {
    id: 'LS-2027-0033',
    entity: 'delivery-note',
    customer: 'CUST-4711',
    deliveryDate: '2027-11-12',
    items: ['ART-1001', 'ART-1002'],
    notes: '',
    quantity: 24,
    status: 'draft',
  });
});

test('snapshot(): identifiers cannot be edited live, and non-JSON values are refused at the boundary', () => {
  const clock = fakeClock();
  const s = session(deliveryNote(), 'A', clock);
  assert.throws(() => s.set('id', 'LS-9999'), PolicyError);
  assert.throws(() => s.set('entity', 'invoice'), PolicyError);
  assert.throws(() => s.set('deliveryDate', new Date(0)), TypeError, 'a Date has no stable JSON meaning');
  assert.throws(() => s.set('quantity', Number.NaN), TypeError);
  assert.throws(() => s.set('meta', { a: undefined }), TypeError);
});

// =======================================================================================
// 7. ERP conflict policy — reject / notify / merge
// =======================================================================================

test('policy reject: a released invoice refuses local edits hard and quarantines remote ops', () => {
  const clock = fakeClock();
  const policy = {
    stateField: 'status',
    rules: [
      {
        when: { status: ['released', 'sent'] },
        fields: '*',
        on: 'reject',
        message: 'Invoice R-2027-0451 is released. Reopen it before editing.',
      },
    ],
    default: { on: 'notify' },
  };
  const released = { id: 'R-2027-0451', entity: 'invoice', status: 'released', total: 11900, notes: '' };
  const a = session(released, 'A', clock, { policy });
  const b = session({ ...released, status: 'draft' }, 'B', fakeClock(), {}); // B, wrongly, thinks it is a draft

  assert.throws(
    () => a.set('total', 1),
    (err) => err instanceof PolicyError && /is released/.test(err.message),
  );
  assert.equal(a.policyFor('total').on, 'reject');

  // A peer running a different policy pushes an op anyway. It is recorded, not obeyed.
  const rogue = b.set('total', 1);
  a.receive(rogue);
  assert.equal(a.snapshot().total, 11900, 'the released fact stands');
  const violations = a.violations();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'policy-reject');
  assert.equal(violations[0].field, 'total');
  assert.match(violations[0].detail, /released/);
  assert.deepEqual(a.conflicts(), [], 'a rejected op is a violation, not a conflict to be voted on');
});

test('policy notify: a draft surfaces the conflict (this is the default)', () => {
  const clockA = fakeClock();
  const clockB = fakeClock();
  const policy = { rules: [{ when: { status: 'draft' }, fields: '*', on: 'notify' }] };
  const draft = { id: 'R-2027-0452', entity: 'invoice', status: 'draft', dueDate: '2027-12-01' };
  const a = session(draft, 'A', clockA, { policy });
  const b = session(draft, 'B', clockB, { policy });

  const opsA = a.set('dueDate', '2027-12-15');
  const opsB = b.set('dueDate', '2027-12-31');
  a.receive(opsB);
  b.receive(opsA);

  assert.equal(a.conflicts().length, 1);
  assert.equal(a.conflicts()[0].values.length, 2);
  assert.equal(JSON.stringify(a.conflicts()), JSON.stringify(b.conflicts()));
});

test('policy merge: a quantity converges silently by the counter/OR-Set rule, no conflict raised', () => {
  const clockA = fakeClock();
  const clockB = fakeClock();
  const policy = { rules: [{ fields: ['quantity', 'items', 'reference'], on: 'merge' }], default: { on: 'notify' } };
  const a = session(deliveryNote(), 'A', clockA, { policy });
  const b = session(deliveryNote(), 'B', clockB, { policy });
  const bus = transport();
  bus.join(a);
  bus.join(b);

  a.inc('quantity', 6);
  b.inc('quantity', -10);
  a.add('items', 'ART-1003');
  b.remove('items', 'ART-1001');
  // 'reference' is a scalar under 'merge' -> LWW, so a concurrent write converges silently.
  clockA.tick(1);
  a.set('reference', 'A-ref');
  clockB.tick(5);
  b.set('reference', 'B-ref');
  bus.deliver();

  assert.deepEqual(a.conflicts(), [], 'merge fields never raise a conflict');
  assert.deepEqual(b.conflicts(), []);
  assert.equal(a.snapshot().quantity, 24 + 6 - 10);
  assert.deepEqual(a.snapshot().items, ['ART-1002', 'ART-1003']);
  assert.equal(a.snapshot().reference, 'B-ref', 'later HLC stamp wins, identically on both peers');
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('policy is data: unknown keys and unknown verbs are refused loudly, never guessed at', () => {
  assert.throws(() => compilePolicy({ rulez: [] }), /unknown key 'rulez'/);
  assert.throws(() => compilePolicy({ rules: [{ fields: '*', on: 'rejct' }] }), /must be one of/);
  assert.throws(() => compilePolicy({ rules: [{ fields: '*', on: 'reject', extra: 1 }] }), /unknown key 'extra'/);
  assert.throws(() => compilePolicy({ rules: [{ fields: 42, on: 'reject' }] }), /fields must be/);
  assert.throws(() => compilePolicy({ default: { on: 'maybe' } }), /policy.default.on/);
  // The valid shape round-trips through JSON: it can come from the operating model.
  const policy = { stateField: 'status', rules: [{ when: { status: 'draft' }, fields: ['a'], on: 'notify' }] };
  assert.deepEqual(compilePolicy(JSON.parse(JSON.stringify(policy))).decide('a', { status: 'draft' }).on, 'notify');
});

test('policy: first matching rule wins, and the state is read from the committed document', () => {
  const policy = {
    rules: [
      { when: { status: 'released' }, fields: '*', on: 'reject' },
      { fields: 'stock', on: 'merge' },
      { fields: '*', on: 'notify' },
    ],
  };
  const p = compilePolicy(policy);
  assert.equal(p.decide('stock', { status: 'released' }).on, 'reject', 'the earlier rule wins');
  assert.equal(p.decide('stock', { status: 'draft' }).on, 'merge');
  assert.equal(p.decide('notes', { status: 'draft' }).on, 'notify');
  assert.equal(p.decide('notes', {}).on, 'notify');
});

test('session: a peer sending the wrong CRDT type for a field is refused loudly, not merged', () => {
  const clock = fakeClock();
  const a = session(deliveryNote(), 'A', clock);
  a.inc('quantity', 5);
  a.receive([{ field: 'quantity', type: 'lww', value: 99, stamp: { wall: 1, counter: 0, node: 'X' } }]);
  assert.equal(a.snapshot().quantity, 29, 'the counter is untouched');
  assert.equal(a.violations()[0].kind, 'crdt-type-mismatch');
});

test('session: resolve() on a counter or set field is refused with a message that says what to use instead', () => {
  const clock = fakeClock();
  const a = session(deliveryNote(), 'A', clock);
  a.inc('quantity', 1);
  a.add('items', 'ART-1003');
  assert.throws(() => a.resolve('quantity', 5), /use add\(\)\/remove\(\) or inc\(\)/);
  assert.throws(() => a.resolve('items', ['x']), /use add\(\)\/remove\(\) or inc\(\)/);
});

test('transport: the loopback seam — three sessions, ops as JSON frames, no automatic delivery', () => {
  const clock = fakeClock();
  const peers = ['A', 'B', 'C'].map((n) => session(deliveryNote(), n, hlc(n, clock)));
  const bus = transport();
  for (const p of peers) bus.join(p);
  assert.deepEqual(bus.peers(), ['A', 'B', 'C']);

  peers[0].set('notes', 'hello');
  assert.equal(peers[1].snapshot().notes, '', 'nothing is delivered until deliver() is called');
  assert.equal(bus.pending(), 2, 'one frame per peer');
  assert.equal(bus.deliver(), 2);
  assert.equal(peers[1].snapshot().notes, 'hello');
  assert.equal(peers[2].snapshot().notes, 'hello');

  // A late joiner catches up from the existing ops — no special protocol, ops are idempotent.
  const late = session(deliveryNote(), 'D', hlc('D', clock));
  bus.join(late);
  bus.deliver();
  assert.equal(late.snapshot().notes, 'hello');
  assert.ok(converged([...peers, late]));
});

// =======================================================================================
// 8. MONEY (FD-1) — the Live Layer can hold money, exactly
// =======================================================================================
//
// The defect this section closes: `pnCounter` demanded `Number.isFinite`, and under FD-1 a
// monetary value is the token `"10.00 EUR"`. So two peers could not concurrently adjust an
// amount at all — while the manifesto (Appendix III, line 123) assigns "stock additions,
// revenue" to a PN-Counter, and revenue is money. The gap contradicted the manifesto directly.
//
// What every test below is really defending is one sentence: TWO PEERS CAN CONCURRENTLY ADJUST
// A MONETARY AMOUNT, CONVERGE TO THE SAME EXACT VALUE, AND COMMIT A CANONICAL TOKEN — WITH A
// MIXED-CURRENCY ATTEMPT REFUSED RATHER THAN GUESSED.

test('money PN-Counter: three peers concurrently book revenue — all converge to ONE identical exact token, and duplicate delivery changes nothing', () => {
  const clock = fakeClock();
  const a = pnCounter(hlc('A', clock), { currency: 'EUR' });
  const b = pnCounter(hlc('B', clock), { currency: 'EUR' });
  const c = pnCounter(hlc('C', clock), { currency: 'EUR' });

  // Three peers, none of them having heard from the others: genuine concurrency.
  const opsA = [...a.inc('1250.00 EUR'), ...a.inc('-40.00 EUR')]; // a sale, then a credit note
  const opsB = [...b.inc('0.01 EUR'), ...b.inc('0.02 EUR')]; // two rounding differences
  const opsC = [...c.inc('333.33 EUR')]; // a third of a thousand

  a.merge([...opsB, ...opsC]);
  b.merge([...opsC, ...opsA]);
  c.merge([...opsA, ...opsB]);

  // The expected value is computed by runtime/money/, not by hand and not by this file: the
  // Live Layer must agree with agent M's module, which is the only judge of monetary truth.
  const expected = moneyToString(
    ['1250.00 EUR', '-40.00 EUR', '0.01 EUR', '0.02 EUR', '333.33 EUR']
      .reduce((total, amount) => moneyAdd(total, amount), moneyZero('EUR')),
  );
  assert.equal(expected, '1543.36 EUR', 'sanity: the oracle itself');
  assert.equal(a.value(), expected);
  assert.equal(b.value(), expected);
  assert.equal(c.value(), expected);

  // Byte-identical op sets, which is what "converged" means on the wire.
  assert.equal(JSON.stringify(a.ops()), JSON.stringify(b.ops()));
  assert.equal(JSON.stringify(b.ops()), JSON.stringify(c.ops()));

  // Duplicate delivery: a retransmitted revenue posting must not book revenue twice. This is
  // the running-totals decision earning its keep in money — with deltas, one duplicated packet
  // would be a real overstatement of revenue, which is worse than the stock case.
  for (let i = 0; i < 10; i += 1) a.merge([...opsA, ...opsB, ...opsC]);
  assert.equal(a.value(), expected, 'a retransmitted posting must not book revenue again');

  // And out of order, duplicated, in random batches.
  const all = [...opsA, ...opsB, ...opsC];
  const d = pnCounter(hlc('D', clock), { currency: 'EUR' });
  const r = rng(4999);
  const scrambled = [];
  for (const op of shuffle(all, r)) {
    scrambled.push(op);
    if (r.bool(0.4)) scrambled.push(op);
  }
  d.merge(scrambled);
  assert.equal(d.value(), expected);
  assert.equal(JSON.stringify(d.ops()), JSON.stringify(a.ops()));
});

/**
 * A float PN-Counter, written the obvious way.
 *
 * This is not a straw man. It is the same op shape and the same merge rule as the real thing
 * ("keep the newest op per node"), and it sums the per-node subtotals in the order the ops
 * arrived — which is what `for (const op of byNode.values())` does, because a Map iterates in
 * insertion order. Every line of it is what a competent person writes before thinking about
 * floating point. That is exactly why the divergence below matters.
 */
function floatPnCounter() {
  /** @type {Map<string, {node:string, seq:number, plus:number, minus:number}>} */
  const byNode = new Map();
  return {
    merge(ops) {
      for (const op of ops) {
        const prev = byNode.get(op.node);
        if (prev === undefined || op.seq > prev.seq) byNode.set(op.node, op);
      }
    },
    value() {
      let total = 0;
      for (const op of byNode.values()) total += op.plus - op.minus; // arrival order
      return total;
    },
  };
}

/** Every ordering of `arr`. Six for three peers — small enough to be exhaustive, not sampled. */
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  arr.forEach((x, i) => {
    for (const rest of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...rest]);
  });
  return out;
}

test('THE FLOAT-DIVERGENCE TEST: a float counter converges to DIFFERENT TOTALS ON DIFFERENT PEERS depending on merge order — BigInt minor units cannot, and that is the whole of FD-1 in one test', () => {
  // Three peers book revenue on the same invoice. The amounts are ordinary: FD-1's own worked
  // example (4999.99), a one-cent rounding difference, and a small line.
  const movements = [
    { node: 'A', amount: '4999.99 EUR', float: 4999.99 },
    { node: 'B', amount: '0.01 EUR', float: 0.01 },
    { node: 'C', amount: '22.22 EUR', float: 22.22 },
  ];

  // ---- The float counter: the SAME op set, six delivery orders, more than one answer. ----
  const floatOps = movements.map((m) => ({ type: 'pn', node: m.node, seq: 1, plus: m.float, minus: 0 }));
  const floatTotals = new Set();
  for (const order of permutations(floatOps)) {
    const counter = floatPnCounter();
    counter.merge(order);
    floatTotals.add(counter.value());
  }

  assert.ok(
    floatTotals.size > 1,
    'a float counter must be shown to diverge here, or this test proves nothing',
  );
  assert.deepEqual(
    [...floatTotals].map(String).sort(),
    ['5022.219999999999', '5022.22'],
    'two peers holding the IDENTICAL op set report different revenue — because the network ' +
      'happened to deliver in a different order. Neither peer is broken. Nothing retries. ' +
      'The invoice simply has two totals, and no amount of convergence proof can see it.',
  );

  // ---- The money counter: the same movements, all six orders, exactly one answer. ----
  const clock = fakeClock();
  const authored = movements.map((m) => pnCounter(hlc(m.node, clock), { currency: 'EUR' }).inc(m.amount));
  const moneyOps = authored.flat();
  const moneyTotals = new Set();
  for (const order of permutations(moneyOps)) {
    const counter = pnCounter(hlc('R', clock), { currency: 'EUR' });
    counter.merge(order);
    moneyTotals.add(counter.value());
  }

  assert.equal(moneyTotals.size, 1, 'BigInt minor units: integer addition is associative, so merge order cannot matter');
  assert.deepEqual([...moneyTotals], ['5022.22 EUR']);

  // The one answer is also the RIGHT answer, per runtime/money/ — convergence on a wrong value
  // would satisfy every property test in this file and still be a defect. (Wave 1's finding:
  // convergence proofs cannot catch wrong semantics. It applies to this test too.)
  assert.equal(
    moneyToString(movements.reduce((t, m) => moneyAdd(t, m.amount), moneyZero('EUR'))),
    '5022.22 EUR',
  );

  // And the float answer that "looked right" is not even reliably the right one: one of the two
  // totals a float counter produces is not representable as a euro amount at all.
  assert.equal(floatTotals.has(5022.219999999999), true);
  assert.throws(() => money('5022.219999999999 EUR'), MoneyError, 'not a euro amount, at any scale');
});

test('the plain counter DEPENDS on its node sort to be deterministic at all; the money counter does not need one, because integer addition is associative', () => {
  // Added after a mutation exercise: deleting `.sort()` from `value()` killed no test. That is
  // two findings, not one.
  //
  //   * For the PLAIN counter the sort is load-bearing and was untested — the latent defect
  //     crdt.js documents (a Map iterates in ARRIVAL order, float addition is not associative)
  //     was only fixed by a line nothing was holding in place. Pinned here.
  //   * For the MONEY counter the sort is a courtesy. Removing it cannot change a total. That
  //     is not luck; it is the property FD-1 buys, and it deserves to be stated positively.
  const clock = fakeClock();

  // Ops arriving B, C, A — an ordinary delivery order, and NOT the sorted one.
  const arrival = [
    { type: 'pn', node: 'B', seq: 1, plus: 0.01, minus: 0 },
    { type: 'pn', node: 'C', seq: 1, plus: 22.22, minus: 0 },
    { type: 'pn', node: 'A', seq: 1, plus: 4999.99, minus: 0 },
  ];

  const plain = pnCounter(hlc('P', clock));
  plain.merge(arrival);
  assert.equal(plain.value(), 5022.22, 'the sort is what makes this the same on every peer');

  // What the same peer would have reported summing in arrival order instead. Both numbers come
  // out of the identical op set; only the iteration order differs.
  const naive = floatPnCounter();
  naive.merge(arrival);
  assert.equal(naive.value(), 5022.219999999999);
  assert.notEqual(naive.value(), plain.value(), 'so the sort in value() is load-bearing, and is now pinned');

  // The money counter: every arrival order, one answer, sort or no sort. Nothing to pin.
  const moneyArrival = [
    { type: 'pn', node: 'B', seq: 1, plus: '0.01 EUR', minus: '0.00 EUR' },
    { type: 'pn', node: 'C', seq: 1, plus: '22.22 EUR', minus: '0.00 EUR' },
    { type: 'pn', node: 'A', seq: 1, plus: '4999.99 EUR', minus: '0.00 EUR' },
  ];
  const totals = new Set();
  for (const order of permutations(moneyArrival)) {
    const c = pnCounter(hlc('R', clock), { currency: 'EUR' });
    c.merge(order);
    totals.add(c.value());
  }
  assert.deepEqual([...totals], ['5022.22 EUR'], 'exact minor units: no iteration order can move this');
});

test('session.inc(): a plain-number movement on a committed SCALED QUANTITY token is refused — a unit and a scale are never guessed either, and it fails closed instead of committing 0.25 over "120.500 kg"', () => {
  // Found while checking the other three types for the same class of assumption as the money
  // defect, one level out. FD-1 mandates scaled quantities by the same string mechanism as
  // money ("120.500 kg", 0.001 kg scale). A goods receipt weighed in kilograms therefore has a
  // string where a plain PN-Counter expects a number.
  //
  // What used to happen: `effective()` started the counter from zero (`typeof baseValue ===
  // 'number' ? baseValue : 0`), so `inc('net-weight', 0.25)` committed `"net-weight": 0.25` —
  // a float, with the unit gone and 120.500 kg silently discarded. That is worse than the money
  // defect it sits next to: money was refused outright, this one succeeded and was wrong.
  const clock = fakeClock();
  const receipt = {
    id: 'GR-2027-0001',
    entity: 'goods-receipt',
    status: 'draft',
    'net-weight': '120.500 kg',
    pieces: 48,
  };
  const s = session(receipt, 'A', hlc('A', clock), {
    policy: { rules: [{ fields: ['net-weight', 'pieces'], on: 'merge' }], default: { on: 'notify' } },
  });

  assert.throws(
    () => s.inc('net-weight', 0.25),
    (err) => err instanceof PolicyError && err.code === 'not-a-counter',
    'a Number may not be counted onto a scaled quantity token',
  );
  // A quantity token is refused too — this module has no exact quantity counter yet, and it says
  // so rather than guessing a scale.
  assert.throws(
    () => s.inc('net-weight', '0.250 kg'),
    (err) => err instanceof MoneyError && err.code === 'currency-required',
  );
  // Nothing happened: no op, and the committed value is intact with its unit.
  assert.deepEqual(s.ops(), []);
  assert.equal(s.snapshot()['net-weight'], '120.500 kg');
  assert.throws(() => s.inc('net-weight', 0.25), /runtime\/money\/quantity\.js/, 'and it names where the fix belongs');

  // The genuine count on the same document is unaffected: a piece count is a number (FD-1 keeps
  // `number` for counts), and a money field is unaffected because it has exact arithmetic.
  s.inc('pieces', -6);
  assert.equal(s.snapshot().pieces, 42);
  const withMoney = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });
  assert.doesNotThrow(() => withMoney.inc('revenue', '1.00 EUR'));
  assert.equal(withMoney.snapshot().revenue, '1.00 EUR');

  // A field that does not exist in git yet still counts from zero — that is not a guess, it is
  // an absent checkpoint, and it is how a live-created counter has always worked.
  assert.doesNotThrow(() => s.inc('damaged', 3));
  assert.equal(s.snapshot().damaged, 3);

  // AND OVER THE WIRE. A guard the local API enforces and the receive path does not is
  // decorative: a peer would simply do what the API refuses. This half was missing when the
  // local half was written, which is the "complete sentences, not half-capabilities" trap in
  // miniature — so it is asserted separately rather than assumed to follow.
  const remote = session(receipt, 'B', hlc('B', clock), {
    policy: { rules: [{ fields: ['net-weight', 'pieces'], on: 'merge' }], default: { on: 'notify' } },
  });
  remote.receive([{ field: 'net-weight', type: 'pn', node: 'Z', seq: 1, plus: 0.25, minus: 0 }]);
  assert.equal(remote.snapshot()['net-weight'], '120.500 kg', 'the weight and its unit are intact');
  assert.equal(remote.violations().length, 1);
  assert.equal(remote.violations()[0].kind, 'not-a-counter');
  assert.equal(remote.violations()[0].origin, 'remote');
  assert.match(remote.violations()[0].detail, /never guessed/);
  // Quarantined, not fatal: the document is still committable, and the op is preserved.
  assert.doesNotThrow(() => remote.snapshot());
  assert.equal(remote.violations()[0].op.plus, 0.25);
  // A genuine count arriving for the numeric field on the same document still applies.
  remote.receive([{ field: 'pieces', type: 'pn', node: 'Z', seq: 1, plus: 0, minus: 6 }]);
  assert.equal(remote.snapshot().pieces, 42);
});

test('session: a MIXED or EMPTY committed array of amounts denominates nothing — a currency is never taken from the first element', () => {
  // Also found by the mutation exercise: `moneyShape` requires every element of a committed
  // array to agree before it calls the field a set of amounts, and nothing tested it. Reading
  // the currency off element 0 would let a document that is already inconsistent dictate the
  // currency of every amount added to it afterwards.
  const clock = fakeClock();
  const policy = { rules: [{ fields: ['prices'], on: 'merge' }], default: { on: 'notify' } };

  // A mixed array: the field is NOT denominated, so nothing is validated against a currency
  // the document never actually declared. (The mixture itself is a modelling error for the
  // Truth Layer to refuse — the Live Layer's job is not to invent an answer for it.)
  const mixed = session(
    { id: 'R-1', entity: 'invoice', status: 'draft', prices: ['10.00 EUR', '5.00 USD'] },
    'A', hlc('A', clock), { policy },
  );
  assert.doesNotThrow(() => mixed.add('prices', '5.00 GBP'), 'no currency was declared, so none is enforced');

  // An empty array declares nothing either — there is no element to read a currency from, and
  // guessing one is exactly what agent M refused for `sum([])`.
  const empty = session(
    { id: 'R-2', entity: 'invoice', status: 'draft', prices: [] },
    'A', hlc('A', clock), { policy },
  );
  assert.doesNotThrow(() => empty.add('prices', '5.00 USD'));

  // And the contrast: an array that DOES agree denominates the field, and then a foreign
  // currency is refused.
  const declared = session(
    { id: 'R-3', entity: 'invoice', status: 'draft', prices: ['10.00 EUR', '9.00 EUR'] },
    'A', hlc('A', clock), { policy },
  );
  assert.throws(
    () => declared.add('prices', '5.00 USD'),
    (err) => err instanceof MoneyError && err.code === 'currency-mismatch',
  );
  assert.doesNotThrow(() => declared.add('prices', '5.00 EUR'));
});

test('money PN-Counter: sorting the nodes removes the ORDER dependence; only BigInt removes the INEXACTNESS — 0.10 + 0.20 is 0.30 EUR, never 0.30000000000000004', () => {
  const clock = fakeClock();

  // The plain-number counter sums its nodes in sorted order, so it is order-independent. It is
  // still inexact, and a counter that is deterministic about the wrong number is not fixed.
  const plain = pnCounter(hlc('A', clock));
  plain.inc(0.1);
  plain.inc(0.2);
  assert.equal(plain.value(), 0.30000000000000004, 'deterministic, and wrong by 5.5e-17 euros');
  assert.notEqual(plain.value(), 0.3);

  const exact = pnCounter(hlc('A', clock), { currency: 'EUR' });
  exact.inc('0.10 EUR');
  exact.inc('0.20 EUR');
  assert.equal(exact.value(), '0.30 EUR');

  // The same at a scale where a float has no chance: a JPY counter has no minor units, and a
  // CLF one has four. Both are exact, because neither is a Number.
  const jpy = pnCounter(hlc('A', clock), { currency: 'JPY' });
  jpy.inc('1 JPY');
  jpy.inc('162500 JPY');
  assert.equal(jpy.value(), '162501 JPY');

  const clf = pnCounter(hlc('A', clock), { currency: 'CLF' });
  clf.inc('0.0001 CLF');
  clf.inc('0.0002 CLF');
  assert.equal(clf.value(), '0.0003 CLF');

  // Past Number.MAX_SAFE_INTEGER in minor units, where a double stops being able to count at
  // all. This is a real amount for a counter denominated in a hyperinflated currency.
  const huge = pnCounter(hlc('A', clock), { currency: 'EUR' });
  const beyond = moneyToString(fromMinor(90071992547409911n, 'EUR'));
  huge.inc(beyond);
  huge.inc('0.01 EUR');
  assert.equal(toMinor(money(huge.value())), 90071992547409912n, 'exact one minor unit past a double');
  assert.equal(huge.value(), '900719925474099.12 EUR');
});

test('money PN-Counter: the currency is the counter IDENTITY — a foreign-currency op is refused, never converted and never silently picked', () => {
  const clock = fakeClock();
  const eur = pnCounter(hlc('A', clock), { currency: 'EUR' });
  eur.inc('10.00 EUR');

  // The whole argument, in one assertion: a USD op on a EUR counter has no correct answer that
  // this file is allowed to produce. Converting needs a rate and a date it does not have (FD-1:
  // a conversion is a modelled act); picking one fabricates an amount in a ledger. So: refuse.
  assert.throws(
    () => eur.apply({ type: 'pn', node: 'Z', seq: 1, plus: '5.00 USD', minus: '0.00 USD' }),
    (err) => err instanceof MoneyError && err.code === 'currency-mismatch',
  );
  assert.equal(eur.value(), '10.00 EUR', 'and the counter is untouched by the attempt');
  assert.throws(
    () => eur.inc('5.00 USD'),
    (err) => err instanceof MoneyError && err.code === 'currency-mismatch',
  );

  // A Number is refused on a money counter. This is FD-1's release blocker, at the boundary.
  assert.throws(() => eur.inc(5), (err) => err instanceof MoneyError && err.code === 'not-a-string');
  assert.throws(() => eur.inc(0.05), (err) => err instanceof MoneyError && err.code === 'not-a-string');
  assert.throws(() => eur.inc(null), (err) => err instanceof MoneyError && err.code === 'not-a-string');

  // An off-spec spelling is refused by money() itself — one recogniser, 87 currencies, no
  // second opinion written in this directory.
  for (const [bad, code] of [['10.0 EUR', 'wrong-scale'], ['10,00 EUR', 'decimal-comma'], ['10.00 eur', 'currency-case'], ['10.00EUR', 'missing-space'], ['1e3 EUR', 'exponent'], ['10.00 XXX', 'unknown-currency']]) {
    assert.throws(() => eur.inc(bad), (err) => err instanceof MoneyError && err.code === code, bad);
  }

  // The counter reports its own denomination, and a plain counter reports none.
  assert.equal(eur.currency(), 'EUR');
  assert.equal(pnCounter(hlc('A', clock)).currency(), null);
  assert.equal(pnCounter(hlc('A', clock), {}).currency(), null);

  // An unknown currency is never given a guessed scale of 2, and a typo in the option key is
  // refused rather than ignored — a silently dropped `{ currncy: 'EUR' }` would build a FLOAT
  // counter on a money field, which is the exact defect FD-1 exists to prevent.
  assert.throws(() => pnCounter(hlc('A', clock), { currency: 'XXX' }), MoneyError);
  assert.throws(() => pnCounter(hlc('A', clock), { currncy: 'EUR' }), /unknown option 'currncy'/);

  // A running total can never be negative: that means a corrupt op or two peers sharing a node
  // id, and it must not be averaged out into a plausible amount.
  assert.throws(
    () => eur.apply({ type: 'pn', node: 'Z', seq: 1, plus: '-5.00 EUR', minus: '0.00 EUR' }),
    (err) => err instanceof MoneyError && err.code === 'negative-total',
  );
});

test('money PN-Counter: monotonicity is checked with compare() over minor units, never by comparing token strings ("9.00 EUR" > "10.00 EUR" lexically)', () => {
  const clock = fakeClock();
  const c = pnCounter(hlc('A', clock), { currency: 'EUR' });

  // A node's running total goes 9.00 -> 10.00. Lexically that is a DECREASE, so a string
  // comparison here would reject an honest op as non-monotonic.
  c.apply({ type: 'pn', node: 'Z', seq: 1, plus: '9.00 EUR', minus: '0.00 EUR' });
  c.apply({ type: 'pn', node: 'Z', seq: 2, plus: '10.00 EUR', minus: '0.00 EUR' });
  assert.equal(c.value(), '10.00 EUR', 'an honest increase from 9.00 to 10.00 must be accepted');
  assert.ok('9.00 EUR' > '10.00 EUR', 'sanity: lexically it really is the wrong way round');

  // And the reverse must still be caught: 10.00 -> 9.00 is a genuine decrease, which lexically
  // looks like an increase. A string comparison would accept the corrupt op.
  const d = pnCounter(hlc('A', clock), { currency: 'EUR' });
  d.apply({ type: 'pn', node: 'Z', seq: 1, plus: '10.00 EUR', minus: '0.00 EUR' });
  assert.throws(
    () => d.apply({ type: 'pn', node: 'Z', seq: 2, plus: '9.00 EUR', minus: '0.00 EUR' }),
    /non-monotonic/,
  );

  // Duplicate delivery of the same seq with a different amount is a duplicate node id, not a
  // merge to be attempted.
  assert.throws(
    () => d.apply({ type: 'pn', node: 'Z', seq: 1, plus: '11.00 EUR', minus: '0.00 EUR' }),
    /two different ops/,
  );
  // The genuine duplicate is a silent no-op: one amount has exactly one canonical spelling.
  d.apply({ type: 'pn', node: 'Z', seq: 1, plus: '10.00 EUR', minus: '0.00 EUR' });
  assert.equal(d.value(), '10.00 EUR');
});

test('money PN-Counter: the op payload is plain JSON with the SAME key shape as a plain counter — only the value domain widens (the IndexedDB buffer and the wire are unaffected)', () => {
  const clock = fakeClock();
  const plain = pnCounter(hlc('A', clock));
  const exact = pnCounter(hlc('A', clock), { currency: 'EUR' });

  const [plainOp] = plain.inc(5);
  const [moneyOp] = exact.inc('5.00 EUR');

  // Agent SYNC persists session.ops() in IndexedDB. The keys are unchanged; `plus`/`minus`
  // widen from number to canonical token string. Nothing new, nothing removed, nothing nested.
  assert.deepEqual(Object.keys(plainOp), ['type', 'node', 'seq', 'plus', 'minus']);
  assert.deepEqual(Object.keys(moneyOp), ['type', 'node', 'seq', 'plus', 'minus']);
  assert.deepEqual(moneyOp, { type: 'pn', node: 'A', seq: 1, plus: '5.00 EUR', minus: '0.00 EUR' });

  // It survives JSON and structuredClone byte-exactly — a BigInt would survive neither, which
  // is why the token is the wire form and BigInt is only ever the arithmetic.
  assert.deepEqual(JSON.parse(JSON.stringify(moneyOp)), moneyOp);
  assert.deepEqual(structuredClone(moneyOp), moneyOp);
  assert.equal(JSON.stringify(moneyOp).includes('9007199254740991'), false);

  // A replayed op from a buffer reconstructs the same value on a fresh counter.
  const restored = pnCounter(hlc('R', clock), { currency: 'EUR' });
  restored.merge(JSON.parse(JSON.stringify([moneyOp])));
  assert.equal(restored.value(), '5.00 EUR');
});

// ---------------------------------------------------------------------------------------
// 8b. Money through a session — inc(), the policy, and snapshot()
// ---------------------------------------------------------------------------------------

test('session.inc(): three peers concurrently move a money field — identical exact token on every peer, credit note included', () => {
  const clock = fakeClock();
  const names = ['A', 'B', 'C'];
  const peers = names.map((n) => session(invoice(), n, hlc(n, clock), { policy: MONEY_MERGE_POLICY }));
  const bus = transport();
  for (const p of peers) bus.join(p);

  // All three edit before any of them has heard from the others.
  peers[0].inc('revenue', '1250.00 EUR'); // a B2B order
  peers[1].inc('revenue', '0.01 EUR'); // a rounding difference
  peers[2].inc('revenue', '-40.00 EUR'); // a credit note: a negative delta
  bus.deliver();

  const expected = moneyToString(
    ['0.00 EUR', '1250.00 EUR', '0.01 EUR', '-40.00 EUR'].reduce((t, a) => moneyAdd(t, a), moneyZero('EUR')),
  );
  assert.equal(expected, '1210.01 EUR');
  for (const [i, p] of peers.entries()) {
    assert.equal(p.snapshot().revenue, expected, `${names[i]} must hold the exact total`);
    assert.deepEqual(p.conflicts(), [], 'a money counter under `merge` converges, it does not conflict');
  }
  assert.ok(converged(peers));
  assert.equal(JSON.stringify(peers[0].snapshot()), JSON.stringify(peers[2].snapshot()));

  // The committed amount is the checkpoint; live ops are movements since. A second money field
  // on the same document is independent — no shared accumulator, no crosstalk.
  peers[0].inc('netTotal', '0.01 EUR');
  bus.deliver();
  assert.equal(peers[1].snapshot().netTotal, '1000.01 EUR');
  assert.equal(peers[1].snapshot().revenue, expected, 'the other money field did not move');

  // The plain counter on the same document is untouched by any of this.
  peers[1].inc('stock', -18);
  bus.deliver();
  assert.equal(peers[0].snapshot().stock, 482);

  // A `Money` from runtime/money/ is accepted as well as its token — a caller that has already
  // parsed an amount must not have to stringify it back by hand — and what lands on the wire is
  // the token either way, never the {minor, currency} shape (a BigInt cannot be JSON).
  peers[2].inc('netTotal', money('0.09 EUR'));
  bus.deliver();
  assert.equal(peers[0].snapshot().netTotal, '1000.10 EUR');
  for (const op of peers[0].ops()) {
    if (op.field === 'netTotal') assert.equal(typeof op.plus, 'string');
  }
  assert.equal(JSON.stringify(peers[0].ops()).includes('minor'), false);
});

test('session.inc(): a Number on a money field is refused at the keystroke, and a money token on a field git HEAD does not denominate is refused rather than guessed', () => {
  const clock = fakeClock();
  const s = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });

  // FD-1's release blocker, refused where the user can still see it, with no op produced.
  assert.throws(
    () => s.inc('revenue', 1250),
    (err) => err instanceof MoneyError && err.code === 'not-a-string',
  );
  assert.throws(
    () => s.inc('revenue', 12.5),
    (err) => err instanceof MoneyError && err.code === 'not-a-string',
  );
  assert.throws(
    () => s.inc('revenue', '1250.00 USD'),
    (err) => err instanceof MoneyError && err.code === 'currency-mismatch',
  );
  assert.deepEqual(s.ops(), [], 'a refused write produces no op at all — nothing to undo, nothing on the wire');
  assert.equal(s.snapshot().revenue, '0.00 EUR');

  // A field the committed document does not denominate has no currency, and a currency is
  // never guessed. Declaring the currency of an amount is a FACT and belongs in a signed
  // commit — the same argument agent M made for `sum([])`.
  assert.throws(
    () => s.inc('freight', '30.00 EUR'),
    (err) => err instanceof MoneyError && err.code === 'currency-required',
  );
  assert.throws(
    () => s.inc('freight', money('30.00 EUR')),
    (err) => err instanceof MoneyError && err.code === 'currency-required',
  );
  // ... and the message says what to do instead, because a refusal a user cannot act on is a
  // dead end rather than a safeguard.
  assert.throws(() => s.inc('freight', '30.00 EUR'), /Commit the amount first/);
  assert.throws(() => s.inc('freight', '30.00 EUR'), /use set\(\)/);

  // The plain-number path is unchanged: a count is still a count (FD-1 keeps `number` for those).
  s.inc('stock', 240);
  assert.equal(s.snapshot().stock, 740);
  assert.throws(() => s.inc('stock', '240 EUR'), (err) => err instanceof MoneyError && err.code === 'currency-required');
});

test('session: a remote op in a FOREIGN CURRENCY is quarantined in violations() — kept, visible, never merged, never converted, and it cannot freeze the document', () => {
  const clock = fakeClock();
  const a = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });
  a.inc('revenue', '100.00 EUR');

  // A misconfigured peer — or a peer that loaded a different HEAD — pushes USD at a EUR field.
  a.receive([{ field: 'revenue', type: 'pn', node: 'Z', seq: 1, plus: '5.00 USD', minus: '0.00 USD' }]);

  assert.equal(a.snapshot().revenue, '100.00 EUR', 'the EUR total is untouched: nothing was converted or picked');
  const violations = a.violations();
  assert.equal(violations.length, 1);
  assert.equal(violations[0].field, 'revenue');
  assert.equal(violations[0].kind, 'money-refused');
  assert.equal(violations[0].code, 'currency-mismatch');
  assert.equal(violations[0].origin, 'remote');
  assert.match(violations[0].detail, /Mixed currencies never combine silently/);
  // The op itself is preserved: we never destroy what a peer sent us.
  assert.deepEqual(violations[0].op.plus, '5.00 USD');

  // Deliberately NOT a conflict. A conflict blocks snapshot(), and one misconfigured peer must
  // not be able to freeze an invoice by asserting a currency the repo never declared.
  assert.deepEqual(a.conflicts(), [], 'a currency the document never declared is a violation, not a vote');
  assert.doesNotThrow(() => a.snapshot());
  assert.equal(a.snapshot().revenue, '100.00 EUR');

  // Every peer holding this committed document reaches the same verdict from the same base, so
  // quarantining cannot make two peers diverge.
  const b = session(invoice(), 'B', hlc('B', clock), { policy: MONEY_MERGE_POLICY });
  b.receive(a.ops());
  b.receive([{ field: 'revenue', type: 'pn', node: 'Z', seq: 1, plus: '5.00 USD', minus: '0.00 USD' }]);
  assert.equal(JSON.stringify(b.ops()), JSON.stringify(a.ops()));
  assert.equal(b.snapshot().revenue, a.snapshot().revenue);
  assert.equal(b.violations()[0].kind, 'money-refused');
});

test('session: a remote PLAIN-NUMBER movement on a money field is quarantined — no float reaches an amount over the wire — and a money movement on a plain counter likewise', () => {
  const clock = fakeClock();
  const a = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });

  // A peer running pre-FD-1 code sends `plus: 5` at a EUR field. This is FD-1's release blocker
  // arriving over the network; accepting it would put a double into an amount.
  a.receive([{ field: 'revenue', type: 'pn', node: 'Z', seq: 1, plus: 5, minus: 0 }]);
  assert.equal(a.snapshot().revenue, '0.00 EUR');
  assert.equal(a.violations()[0].kind, 'money-mode-mismatch');
  assert.match(a.violations()[0].detail, /no Number ever touches a monetary value/);
  assert.equal(typeof a.snapshot().revenue, 'string', 'the field is still a token, not a number');

  // The mirror image: a monetary movement on a field the document holds as a count.
  a.receive([{ field: 'stock', type: 'pn', node: 'Z', seq: 1, plus: '5.00 EUR', minus: '0.00 EUR' }]);
  assert.equal(a.snapshot().stock, 500);
  assert.equal(a.violations()[1].kind, 'money-mode-mismatch');
  assert.match(a.violations()[1].detail, /a currency is never guessed/);

  // No float anywhere in the committed bytes of a money field.
  assert.equal(JSON.stringify(a.snapshot()).includes('"revenue":0'), false);
  assert.equal(JSON.stringify(a.snapshot()).includes('"revenue":5'), false);
});

test('conflict policy over money: reject freezes a released amount, merge converges it, notify surfaces both tokens — the same three verbs, as plain JSON', () => {
  const clock = fakeClock();

  // --- reject: a released invoice refuses a monetary edit hard, at the keystroke.
  const released = session(invoice('EUR', { status: 'released' }), 'A', hlc('A', clock), {
    policy: MONEY_MERGE_POLICY,
  });
  assert.equal(released.policyFor('revenue').on, 'reject');
  assert.throws(() => released.inc('revenue', '1.00 EUR'), (err) => err instanceof PolicyError && /is released/.test(err.message));
  // A peer running a different policy pushes a monetary op anyway: recorded, not obeyed.
  released.receive([{ field: 'revenue', type: 'pn', node: 'Z', seq: 1, plus: '999.00 EUR', minus: '0.00 EUR' }]);
  assert.equal(released.snapshot().revenue, '0.00 EUR', 'the released amount stands');
  assert.equal(released.violations()[0].kind, 'policy-reject');

  // --- merge: the counter rule IS the business rule (manifesto line 130, "on a quantity").
  const m1 = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });
  const m2 = session(invoice(), 'B', hlc('B', clock), { policy: MONEY_MERGE_POLICY });
  const bus = transport();
  bus.join(m1);
  bus.join(m2);
  m1.inc('revenue', '70.51 EUR');
  m2.inc('revenue', '1.16 EUR');
  bus.deliver();
  assert.deepEqual(m1.conflicts(), []);
  assert.equal(m1.snapshot().revenue, '71.67 EUR');
  assert.equal(m2.snapshot().revenue, '71.67 EUR');

  // --- notify: a monetary field under the default policy conflicts instead of overwriting.
  const goodwill = { id: 'CN-2027-0009', entity: 'credit-note', status: 'draft', amount: '0.00 EUR' };
  const n1 = session(goodwill, 'A', hlc('A', clock), {}); // default: notify
  const n2 = session(goodwill, 'B', hlc('B', clock), {});
  const bus2 = transport();
  bus2.join(n1);
  bus2.join(n2);
  clock.tick(1);
  n1.set('amount', '9.00 EUR');
  clock.tick(1);
  n2.set('amount', '10.00 EUR');
  bus2.deliver();

  const conflicts = n1.conflicts();
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, 'amount');
  assert.deepEqual(
    conflicts[0].values.map((v) => `${v.by}:${v.value}`).sort(),
    ['A:9.00 EUR', 'B:10.00 EUR'],
    'both amounts, both authors, as tokens — no silent last-writer-wins on money',
  );
  assert.equal(JSON.stringify(n1.conflicts()), JSON.stringify(n2.conflicts()));
  assert.throws(() => n1.snapshot(), PolicyError, 'an amount cannot have two values');

  // A human settling it is still not allowed to invent a currency: that would be a conversion
  // without a rate, which is the one thing FD-1 refuses outright.
  assert.throws(
    () => n1.resolve('amount', '10.00 USD'),
    (err) => err instanceof MoneyError && err.code === 'currency-mismatch',
  );
  assert.throws(() => n1.resolve('amount', 10), (err) => err instanceof MoneyError && err.code === 'not-a-string');
  clock.tick(1);
  n1.resolve('amount', '10.00 EUR');
  bus2.deliver();
  assert.deepEqual(n1.conflicts(), []);
  assert.deepEqual(n2.conflicts(), []);
  assert.equal(n2.snapshot().amount, '10.00 EUR');
});

test('snapshot(): a money field commits as a canonical FD-1 token — no CRDT metadata, no BigInt, and no float anywhere in the bytes', () => {
  const clock = fakeClock();
  const s = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });
  clock.tick(1);
  s.inc('revenue', '4999.99 EUR');
  s.inc('revenue', '0.01 EUR');
  s.inc('netTotal', '-0.01 EUR');
  s.add('prices', '99.99 EUR');
  s.inc('stock', -20);

  const doc = s.snapshot();
  assert.deepEqual(doc, {
    id: 'R-2027-0451',
    entity: 'invoice',
    netTotal: '999.99 EUR',
    notes: '',
    prices: ['9.00 EUR', '10.00 EUR', '99.99 EUR'],
    revenue: '5000.00 EUR',
    status: 'draft',
    stock: 480,
  });

  // Every monetary value in the committed document is a canonical token that round-trips
  // through money() byte-exactly. That is the thirty-year promise (Principle 6), asserted.
  for (const value of [doc.revenue, doc.netTotal, ...doc.prices]) {
    assert.equal(typeof value, 'string');
    assert.equal(moneyToString(money(value)), value, `${value} must be canonical`);
  }
  // 4999.99 + 0.01 is exactly 5000.00, and the scale is kept: not "5000 EUR", not "5e3 EUR".
  assert.equal(doc.revenue, '5000.00 EUR');

  // No CRDT metadata, and nothing monetary that is a JSON number.
  const json = JSON.stringify(doc);
  for (const leak of ['stamp', 'counter', 'wall', 'node', 'tag', 'overwrites', 'seq', 'plus', 'minus', 'orset', 'minor', 'currency']) {
    assert.equal(json.includes(leak), false, `CRDT or internal metadata '${leak}' leaked into the committed Doc`);
  }
  assert.equal(/:\s*-?\d+\.\d+/.test(json), false, 'no bare decimal number may appear in a committed document');
  assert.equal(json.includes('5000.00 EUR'), true, 'the amount is there — as a self-describing string');
  assert.deepEqual(JSON.parse(json), doc, 'and it survives the round trip through text, which is all git stores');

  // JSON.stringify is enough: nothing in a snapshot needs a replacer, and a BigInt would have
  // thrown here rather than serialize.
  assert.doesNotThrow(() => JSON.stringify(doc));
});

// ---------------------------------------------------------------------------------------
// 8c. The other three types holding money — canonical comparison, canonical dedupe
// ---------------------------------------------------------------------------------------

test('LWW-Register holding money: the winner is the greatest HLC stamp — even when it wrote the SMALLER amount. Never a comparison of the tokens', () => {
  // The hazard: an LWW register that ordered by value, or by the token string, would pick a
  // winner from the amount. Lexically "9.00 EUR" > "10.00 EUR", so such a register would hand
  // an invoice 9.00 when a human had just typed 10.00 — and vice versa.
  for (const [first, second] of [['9.00 EUR', '10.00 EUR'], ['10.00 EUR', '9.00 EUR']]) {
    const clock = fakeClock();
    const a = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });
    const b = session(invoice(), 'B', hlc('B', clock), { policy: MONEY_MERGE_POLICY });
    const bus = transport();
    bus.join(a);
    bus.join(b);

    clock.tick(1);
    a.set('netTotal', first);
    clock.tick(5); // B writes strictly later in the HLC total order
    b.set('netTotal', second);
    bus.deliver();

    assert.equal(a.snapshot().netTotal, second, `the later writer wins: ${first} then ${second}`);
    assert.equal(b.snapshot().netTotal, second);
    assert.deepEqual(a.conflicts(), []);
    assert.ok(converged([a, b]));
  }

  // A bare LWW register holding tokens converges on the stamp too, and still refuses anything
  // that is not plain JSON.
  const clock = fakeClock();
  const reg = lwwRegister(hlc('A', clock));
  reg.set('9.00 EUR');
  clock.tick(1);
  reg.set('10.00 EUR');
  assert.equal(reg.value(), '10.00 EUR');
  assert.throws(() => reg.set(money('10.00 EUR')), TypeError, 'a Money instance is not plain JSON — store the token');
});

test('MV-Register holding money: two concurrent amounts both survive as tokens, ordered by stamp, identically on every peer', () => {
  const clock = fakeClock();
  const a = mvRegister(hlc('A', clock));
  const b = mvRegister(hlc('B', clock));

  clock.tick(1);
  const opsA = a.set('9.00 EUR');
  clock.tick(1);
  const opsB = b.set('10.00 EUR'); // concurrent: B has not seen A
  a.merge(opsB);
  b.merge(opsA);

  assert.equal(a.conflicted(), true);
  assert.deepEqual(a.value(), ['9.00 EUR', '10.00 EUR']);
  assert.deepEqual(b.value(), ['9.00 EUR', '10.00 EUR'], 'same order on both peers: by stamp, not by amount');
  assert.deepEqual(a.entries().map((e) => e.by), ['A', 'B']);
  assert.equal(JSON.stringify(a.ops()), JSON.stringify(b.ops()));

  // Both values are canonical tokens, so a conflict UI renders exactly what git would hold.
  for (const value of a.value()) assert.equal(moneyToString(money(value)), value);

  // A resolution observes both and supersedes both, on every peer.
  clock.tick(1);
  const decision = a.set('10.00 EUR');
  b.merge(decision);
  assert.equal(a.conflicted(), false);
  assert.deepEqual(b.value(), ['10.00 EUR']);
});

test('OR-Set of amounts: dedupe is on the CANONICAL form (a Money object and its token are one element), and the committed order is by exact value, never lexical', () => {
  const clock = fakeClock();
  const a = session(invoice(), 'A', hlc('A', clock), { policy: MONEY_MERGE_POLICY });
  const b = session(invoice(), 'B', hlc('B', clock), { policy: MONEY_MERGE_POLICY });
  const bus = transport();
  bus.join(a);
  bus.join(b);

  // Two peers add the same amount concurrently, one as a token and one as a Money object.
  // They must be ONE element in the set: an amount has exactly one canonical spelling, and
  // dedupe that missed this would put 100.00 EUR in a price list twice.
  a.add('prices', '100.00 EUR');
  b.add('prices', money('100.00 EUR'));
  a.add('prices', '9.50 EUR');
  bus.deliver();

  assert.deepEqual(
    a.snapshot().prices,
    ['9.00 EUR', '9.50 EUR', '10.00 EUR', '100.00 EUR'],
    'deduped to one 100.00 EUR, and ordered by exact value',
  );
  assert.deepEqual(b.snapshot().prices, a.snapshot().prices);
  assert.ok(converged([a, b]));

  // The lexical order is a different, wrong answer — this is what a committed document would
  // have shown a human if the set had sorted its tokens as strings.
  assert.deepEqual(
    [...a.snapshot().prices].sort(),
    ['10.00 EUR', '100.00 EUR', '9.00 EUR', '9.50 EUR'],
    'sanity: lexical order really does interleave the magnitudes',
  );
  assert.notDeepEqual(a.snapshot().prices, [...a.snapshot().prices].sort());

  // A removal addressed by a Money object hits the same element as one addressed by its token.
  b.remove('prices', money('100.00 EUR'));
  bus.deliver();
  assert.deepEqual(a.snapshot().prices, ['9.00 EUR', '9.50 EUR', '10.00 EUR']);
  assert.deepEqual(b.snapshot().prices, a.snapshot().prices);

  // A foreign currency cannot enter a set of amounts either.
  assert.throws(
    () => a.add('prices', '5.00 USD'),
    (err) => err instanceof MoneyError && err.code === 'currency-mismatch',
  );
  assert.throws(
    () => a.add('prices', '10.0 EUR'),
    (err) => err instanceof MoneyError && err.code === 'wrong-scale',
  );

  // Observed-remove still beats a concurrent re-add, exactly as it does for a batch number:
  // the money value domain changes nothing about the set semantics.
  const removed = a.remove('prices', '10.00 EUR');
  const readded = b.add('prices', '10.00 EUR');
  a.receive(readded);
  b.receive(removed);
  assert.equal(a.snapshot().prices.includes('10.00 EUR'), true, 'the re-add was never observed by the remove');
  assert.deepEqual(b.snapshot().prices, a.snapshot().prices);
});

test('session: two peers set an UNDECLARED field to different currencies — a genuine two-value conflict, with no authority to appeal to and nothing silently picked', () => {
  const clock = fakeClock();
  const base = { id: 'PO-2027-0001', entity: 'purchase-order', status: 'draft' };
  const a = session(base, 'A', hlc('A', clock), {});
  const b = session(base, 'B', hlc('B', clock), {});
  const bus = transport();
  bus.join(a);
  bus.join(b);

  // Nothing in git says what currency `freight` is in. A is a German buyer, B an American one.
  clock.tick(1);
  a.set('freight', '30.00 EUR');
  clock.tick(1);
  b.set('freight', '35.00 USD');
  bus.deliver();

  const conflicts = a.conflicts();
  assert.equal(conflicts.length, 1);
  assert.deepEqual(
    conflicts[0].values.map((v) => `${v.by}:${v.value}`).sort(),
    ['A:30.00 EUR', 'B:35.00 USD'],
    'both currencies shown to a human — the only honest answer when the repo declared neither',
  );
  assert.equal(JSON.stringify(a.conflicts()), JSON.stringify(b.conflicts()));
  assert.throws(() => a.snapshot(), PolicyError, 'and it is NOT committable until somebody decides');

  // Once decided, the decision travels — and the amount that lands in git is canonical.
  clock.tick(1);
  a.resolve('freight', '30.00 EUR');
  bus.deliver();
  assert.deepEqual(b.conflicts(), []);
  assert.equal(b.snapshot().freight, '30.00 EUR');
  assert.equal(moneyToString(money(b.snapshot().freight)), b.snapshot().freight);
});

// ---------------------------------------------------------------------------------------
// 8d. The seeded property tests, extended to money
// ---------------------------------------------------------------------------------------
//
// WHY THESE ASSERT A VALUE AND NOT ONLY AGREEMENT. Wave 1's mutation exercise on this file
// produced its most-quoted finding: CONVERGENCE PROOFS CANNOT CATCH WRONG SEMANTICS. Three
// replicas agreeing byte-for-byte on the wrong total is a passing property test and a
// misstated set of books. So every money property below checks the converged value against an
// ORACLE computed independently by runtime/money/ — the module that owns monetary truth —
// and not merely that the peers agree with each other.

/** The four minor-unit scales ISO 4217 actually uses, so no test is a two-decimal test. */
const SCALE_SAMPLE = [
  ['EUR', 2n], // 62 of the 87 currencies
  ['JPY', 0n], // 16 have no minor unit at all
  ['TND', 3n], // 7 have three
  ['CLF', 4n], // 2 have four
];

/** A random canonical token in `currency`, magnitude bounded, sign from the caller. */
function randomAmount(r, currency, allowNegative = true) {
  const minor = BigInt(r.int(2_000_000)) - (allowNegative ? 1_000_000n : 0n);
  return moneyToString(fromMinor(minor, currency));
}

test('property: the money PN-Counter is commutative, associative and idempotent AND lands on the value runtime/money/ computes — 800 cases (200 seeds x 4 minor-unit scales), 3 replicas', () => {
  const SEEDS = 200;
  let cases = 0;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    for (const [currency] of SCALE_SAMPLE) {
      const r = rng(seed * 7919 + currency.charCodeAt(0));
      const clock = fakeClock(1_000_000 + seed);
      const nodes = ['A', 'B', 'C'];

      // Three replicas author movements without seeing each other: genuine concurrency.
      const authors = nodes.map((n) => pnCounter(hlc(n, clock), { currency }));
      /** @type {any[][]} */
      const histories = authors.map(() => []);
      /** every delta ever applied, for the oracle @type {string[]} */
      const deltas = [];

      const rounds = 2 + r.int(5);
      for (let i = 0; i < rounds; i += 1) {
        for (let n = 0; n < authors.length; n += 1) {
          if (r.bool(0.3)) continue;
          if (r.bool(0.5)) clock.tick(r.int(3));
          const delta = randomAmount(r, currency);
          deltas.push(delta);
          histories[n].push(...authors[n].inc(delta));
        }
      }
      const all = histories.flat();

      // THE ORACLE: the exact total, computed by runtime/money/ over the same deltas. This is
      // the assertion that a convergence proof cannot make.
      const oracle = moneyToString(deltas.reduce((t, d) => moneyAdd(t, d), moneyZero(currency)));

      // --- COMMUTATIVITY: three arrival orders, random duplication, random batching.
      const states = nodes.map((n, i) => {
        const reg = pnCounter(hlc(`R${n}`, clock), { currency });
        reg.merge(histories[i]);
        const withDupes = [];
        for (const op of shuffle(all, rng(seed * 31 + i))) {
          withDupes.push(op);
          if (r.bool(0.25)) withDupes.push(op); // the network delivered it twice
        }
        let cursor = 0;
        while (cursor < withDupes.length) {
          const batch = 1 + r.int(4);
          reg.merge(withDupes.slice(cursor, cursor + batch));
          cursor += batch;
        }
        assert.equal(reg.value(), oracle, `${currency} seed ${seed}: converged on the WRONG total`);
        return JSON.stringify({ ops: reg.ops(), value: reg.value() });
      });
      assert.equal(states[0], states[1], `${currency} seed ${seed}: order must not matter`);
      assert.equal(states[1], states[2], `${currency} seed ${seed}: order must not matter`);

      // --- IDEMPOTENCE.
      const again = pnCounter(hlc('I', clock), { currency });
      again.merge(all);
      const once = JSON.stringify({ ops: again.ops(), value: again.value() });
      again.merge(all);
      again.merge(all);
      assert.equal(
        JSON.stringify({ ops: again.ops(), value: again.value() }),
        once,
        `${currency} seed ${seed}: merge must be idempotent`,
      );
      assert.equal(again.value(), oracle);

      // --- ASSOCIATIVITY: merge(merge(a,b),c) == merge(a,merge(b,c)).
      const left = pnCounter(hlc('L', clock), { currency });
      left.merge(histories[0]);
      left.merge(histories[1]);
      left.merge(histories[2]);
      const right = pnCounter(hlc('Rr', clock), { currency });
      right.merge([...histories[1], ...histories[2]]);
      right.merge(histories[0]);
      assert.equal(
        JSON.stringify({ ops: left.ops(), value: left.value() }),
        JSON.stringify({ ops: right.ops(), value: right.value() }),
        `${currency} seed ${seed}: merge must be associative`,
      );
      assert.equal(left.value(), oracle);

      // The value is a canonical token at this currency's own scale, at every step. A JPY
      // total may never grow a decimal point; a CLF total may never lose one.
      assert.equal(moneyToString(money(left.value())), left.value());
      assert.equal(currencyOf(left.value()), currency);
      cases += 1;
    }
  }
  assert.equal(cases, SEEDS * SCALE_SAMPLE.length, `${SEEDS} seeds x ${SCALE_SAMPLE.length} scales = 800 cases must all have run`);
});

test('property: money sessions reach byte-identical snapshots under random histories, orders, duplication and delay, and every amount matches the oracle — 120 seeds, 3-5 peers', () => {
  const SEEDS = 120;
  const POLICY = {
    stateField: 'status',
    rules: [
      { when: { status: 'released' }, fields: '*', on: 'reject' },
      { fields: ['revenue', 'netTotal', 'prices', 'stock', 'reference'], on: 'merge' },
    ],
    default: { on: 'notify' },
  };
  let seedsPassed = 0;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const r = rng(seed * 104729);
    const [currency] = SCALE_SAMPLE[seed % SCALE_SAMPLE.length];
    const peerCount = 3 + r.int(3);
    const names = ['A', 'B', 'C', 'D', 'E'].slice(0, peerCount);
    const clock = fakeClock(1_600_000_000_000 + seed * 1000);
    const openingRevenue = randomAmount(r, currency, false);
    const openingNet = randomAmount(r, currency, false);
    const base = {
      id: 'R-2027-0451',
      entity: 'invoice',
      status: 'draft',
      revenue: openingRevenue,
      netTotal: openingNet,
      prices: [moneyToString(fromMinor(1000n, currency)), moneyToString(fromMinor(900n, currency))],
      stock: 500,
      notes: '',
      reference: 'r0',
    };

    const peers = names.map((n) => session(structuredClone(base), n, hlc(n, clock), { policy: POLICY }));

    /** @type {any[]} */
    const wire = [];
    /** @type {any[][]} */
    const undelivered = peers.map(() => []);
    /** the oracle's running deltas per money counter field @type {Record<string, string[]>} */
    const applied = { revenue: [], netTotal: [] };

    const steps = 15 + r.int(30);
    for (let step = 0; step < steps; step += 1) {
      if (r.bool(0.6)) clock.tick(r.int(4));
      const i = r.int(peerCount);
      const peer = peers[i];
      let produced = [];
      const dice = r.int(100);
      if (dice < 45) {
        // A monetary movement on a field git HEAD denominates.
        const field = r.bool(0.5) ? 'revenue' : 'netTotal';
        const delta = randomAmount(r, currency);
        applied[field].push(delta);
        produced = peer.inc(field, delta);
      } else if (dice < 60) {
        produced = peer.inc('stock', r.int(41) - 20); // the plain path, alongside
      } else if (dice < 72) {
        produced = peer.add('prices', randomAmount(r, currency, false));
      } else if (dice < 80) {
        produced = peer.remove('prices', moneyToString(fromMinor(1000n, currency)));
      } else if (dice < 90) {
        produced = peer.set('reference', `r${r.int(4)}`); // LWW under 'merge'
      } else {
        produced = peer.set('notes', `n${r.int(4)}`); // MV under the default 'notify'
      }

      wire.push(...produced);
      for (let j = 0; j < peerCount; j += 1) if (j !== i) undelivered[j].push(...produced);

      // Partial, out-of-order, sometimes-duplicated delivery WHILE editing continues. This is
      // what creates real concurrency: a peer writes an amount before it has heard.
      if (r.bool(0.5)) {
        const j = r.int(peerCount);
        const queue = undelivered[j];
        const take = shuffle(queue, rng(seed * 13 + step)).slice(0, 1 + r.int(queue.length + 1));
        const batch = [];
        for (const op of take) {
          batch.push(op);
          if (r.bool(0.3)) batch.push(op);
        }
        peers[j].receive(batch);
        undelivered[j] = queue.filter((op) => !take.includes(op));
      }
    }

    // The network settles: everybody eventually gets everything, own order, some of it twice.
    for (let j = 0; j < peerCount; j += 1) {
      const withDupes = [];
      for (const op of shuffle(wire, rng(seed * 977 + j))) {
        withDupes.push(op);
        if (r.bool(0.2)) withDupes.push(op);
      }
      let cursor = 0;
      while (cursor < withDupes.length) {
        const size = 1 + r.int(6);
        peers[j].receive(withDupes.slice(cursor, cursor + size));
        cursor += size;
      }
    }

    const reference = JSON.stringify(peers[0].ops());
    for (let j = 1; j < peerCount; j += 1) {
      assert.equal(JSON.stringify(peers[j].ops()), reference, `seed ${seed} (${currency}): '${names[j]}' diverged`);
      assert.equal(
        JSON.stringify(peers[j].conflicts()),
        JSON.stringify(peers[0].conflicts()),
        `seed ${seed}: conflict views must be identical on every peer`,
      );
    }
    assert.deepEqual(peers[0].violations(), [], `seed ${seed}: nothing here should have been quarantined`);

    // THE ORACLE, per money field: the committed opening balance plus every delta that was
    // actually applied, computed by runtime/money/. A money counter under `merge` may never
    // conflict, so the amount is committable without anybody deciding anything.
    /** @type {Record<string, string>} */
    const oracles = {};
    for (const field of ['revenue', 'netTotal']) {
      oracles[field] = moneyToString(applied[field].reduce((t, d) => moneyAdd(t, d), money(base[field])));
      for (let j = 0; j < peerCount; j += 1) {
        assert.equal(
          peers[j].conflicts().some((c) => c.field === field),
          false,
          `seed ${seed}: a money counter must converge, never conflict`,
        );
      }
    }

    // Settle whatever the MV field left open, then compare the committed facts.
    for (const conflict of peers[0].conflicts()) {
      clock.tick(1);
      const ops = peers[0].resolve(conflict.field, conflict.values[0].value);
      for (let j = 1; j < peerCount; j += 1) peers[j].receive(ops);
    }
    const snap = peers[0].snapshot();
    for (let j = 1; j < peerCount; j += 1) {
      assert.equal(JSON.stringify(peers[j].snapshot()), JSON.stringify(snap), `seed ${seed}: snapshots must match`);
    }
    for (const field of ['revenue', 'netTotal']) {
      assert.equal(snap[field], oracles[field], `seed ${seed} (${currency}): '${field}' is not the exact total`);
      assert.equal(moneyToString(money(snap[field])), snap[field], 'and it is canonical');
    }
    // Every amount in the committed set is canonical and in this currency, ordered by value.
    for (const price of snap.prices) assert.equal(currencyOf(price), currency);
    const ascending = [...snap.prices].sort((x, y) => moneyCompare(x, y));
    assert.deepEqual(snap.prices, ascending, `seed ${seed}: a committed set of amounts is ordered by value`);
    assert.equal(typeof snap.stock, 'number', 'the plain counter is still a count');
    seedsPassed += 1;
  }
  assert.equal(seedsPassed, SEEDS, `all ${SEEDS} seeds must pass`);
});

// =======================================================================================
// 9. The float guard over runtime/live/
// =======================================================================================
//
// Gate condition 2 of the roadmap: "No float in any monetary path. Asserted by a test that
// greps the runtime." This is that grep for runtime/live/.
//
// It uses test/_source-guard.js — the ONE shared scanner, which strips comments and string and
// regex literals before scanning. That matters here more than anywhere: crdt.js and session.js
// are almost half prose, and the naive version of this guard flagged runtime/crypto/keys.js for
// `Math.random` because the file's own comment promised the opposite. A guard that fails on its
// own documentation teaches people to delete the documentation.
//
// THE DESIGN PROBLEM, stated because a blanket ban would be a lie here. FD-1 keeps `number`
// for counts and quantities, and the Live Layer legitimately holds two non-monetary integer
// domains: a plain PN-Counter (stock: 500 pieces) and the HLC's wall clock and counter. So the
// guard is split in two:
//
//   9a. The constructs that can ONLY mean a float — zero tolerance, no exceptions, no allowlist.
//   9b. `Number`, `Math.*` and `isFinite`, which have honest integer-domain uses — every
//       occurrence must be on an allowlist that names the integer it validates, and the count
//       is pinned, so a new one cannot appear silently on the way to a monetary path.

const LIVE_DIR = new URL('../runtime/live/', import.meta.url);

/** Every `.js` file agent LIVEMONEY owns, as [name, source]. */
function liveSources() {
  const dir = new URL('.', LIVE_DIR).pathname;
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => [`runtime/live/${f}`, readFileSync(join(dir, f), 'utf8')]);
}

/**
 * Constructs that cannot mean anything but a floating-point value. Same rules and the same
 * reasons as agent M's guard over runtime/money/ — deliberately identical, because two guards
 * that disagree about what a float is were how this project got three of them.
 */
const FLOAT_ONLY = [
  ['parseFloat', /\bparseFloat\b/, 'parseFloat on a money field is the release blocker FD-1 names'],
  ['parseInt', /\bparseInt\b/, 'parseInt silently truncates and accepts trailing garbage'],
  ['toFixed', /\.toFixed\b/, 'toFixed rounds a double: (1.005).toFixed(2) === "1.00"'],
  ['toPrecision', /\.toPrecision\b/, 'same defect as toFixed'],
  ['toLocaleString', /\.toLocaleString\b/, 'locale formatting belongs in the UI, over the canonical token'],
  ['valueOf', /\bvalueOf\b/, 'a numeric valueOf would re-open implicit coercion on a Money'],
  ['NaN', /\bNaN\b|\bisNaN\b/, 'a BigInt cannot be NaN; testing for it means a Number got in'],
  ['float literal', /(?:^|[^\w.$])\d+\.\d+/, 'a decimal literal is a double, e.g. 1.19 -> 1.1899999999999999'],
  ['bare fractional literal', /(?:^|[^\w.$)\]])\.\d/, 'e.g. .5'],
  ['exponent literal', /\b\d+e[+-]?\d+\b/i, 'an exponent literal is a double'],
  ['Number literal as divisor/multiplier', /(\*\*?|\/|%)\s*\d+(?![\dn])/, 'e.g. `/ 100` — must be `/ 100n`'],
  ['Number literal as dividend/multiplicand', /(?<![\w$.])\d+(?![\dn])\s*(\*\*?|\/|%)/, 'e.g. `19 / 100` — must be BigInt'],
  ['unary plus coercion', /(?:[=(,:[]|\breturn\b|=>)\s*\+[A-Za-z_$(]/, '`+value` is Number coercion'],
];

/** The constructs that DO have an honest integer-domain use in this directory. */
const INTEGER_DOMAIN = [
  ['Number identifier', /\bNumber\b/, 'a Number may only ever validate a count or a clock reading here'],
  ['Math.*', /\bMath\s*\./, 'every Math function is double-valued'],
  ['isFinite', /\bisFinite\b/, 'a BigInt is always finite; asking means a Number is in play'],
];

/**
 * The complete, enumerated list of non-monetary integer sites in runtime/live/.
 *
 * Each entry is `file:rule` -> the count that is correct today, with the integer it guards.
 * Pinning the counts is the point: a fourteenth `Number` cannot appear without this test
 * naming it, so the next person to reach for `Number(...)` on a money path is stopped by a
 * failing test rather than by a code review that may not happen.
 */
const INTEGER_DOMAIN_ALLOWED = new Map([
  // crdt.js — canonicalize()'s plain-JSON number branch, op.seq, and the PLAIN counter's delta.
  // None of the three is reachable from money mode: normalize() and inc() both return before
  // them when a currency is set, which the behavioural tests above assert from the outside.
  ['runtime/live/crdt.js:Number identifier', 4],
  ['runtime/live/crdt.js:isFinite', 3],
  // hlc.js — the wall clock (integer milliseconds) and the logical counter. A stamp is not an
  // amount, and the HLC has never touched one.
  ['runtime/live/hlc.js:Number identifier', 4],
  ['runtime/live/hlc.js:isFinite', 2],
  ['runtime/live/hlc.js:Math.*', 2],
]);

test('float guard: runtime/live/ contains NO construct that can only mean a float — zero tolerance, no allowlist', () => {
  const sources = liveSources();
  assert.ok(sources.length >= 3, 'the guard must actually have found the module it is guarding');
  assert.deepEqual(
    sources.map(([f]) => f),
    ['runtime/live/crdt.js', 'runtime/live/hlc.js', 'runtime/live/session.js'],
    'every file in runtime/live/ is scanned — a new file is scanned automatically, not forgotten',
  );

  const violations = scanSources(sources, FLOAT_ONLY);
  assert.deepEqual(
    violations,
    [],
    violations.length === 0
      ? ''
      : `no float construct may appear anywhere in runtime/live/:\n${violations
          .map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.text}\n      -> ${v.why}`)
          .join('\n')}`,
  );

  // Not one decimal literal in the whole Live Layer. Worth asserting on its own: every amount
  // in this module arrives as a token and leaves as a token, and the arithmetic in between is
  // runtime/money/'s BigInt, so there was never an occasion to write one.
  assert.equal(scanSources(sources, [FLOAT_ONLY[7]]).length, 0);
});

test('float guard: Number, Math and isFinite appear ONLY at the enumerated non-monetary integer sites, and the counts are pinned so a new one cannot slip in', () => {
  const sources = liveSources();
  const violations = scanSources(sources, INTEGER_DOMAIN);

  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const v of violations) {
    const key = `${v.file}:${v.rule}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  const unexpected = [...seen.keys()].filter((k) => !INTEGER_DOMAIN_ALLOWED.has(k));
  assert.deepEqual(
    unexpected,
    [],
    `a Number, Math or isFinite appeared where the allowlist does not permit one:\n${violations
      .filter((v) => unexpected.includes(`${v.file}:${v.rule}`))
      .map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.text}`)
      .join('\n')}`,
  );

  for (const [key, expected] of INTEGER_DOMAIN_ALLOWED) {
    assert.equal(
      seen.get(key) ?? 0,
      expected,
      `${key}: expected exactly ${expected} non-monetary integer site(s), found ${seen.get(key) ?? 0}. ` +
        'If you added one, prove it cannot see a monetary value and update the allowlist deliberately.',
    );
  }

  // session.js — the file that routes every monetary write — has NO Number, Math or isFinite
  // at all. It delegates all arithmetic to runtime/money/, which is the whole design.
  assert.deepEqual(
    violations.filter((v) => v.file === 'runtime/live/session.js'),
    [],
    'session.js must contain no Number, Math or isFinite whatsoever',
  );
});

test('float guard: the scanner is not blind — every historical and hypothetical float defect in a CRDT is still flagged', () => {
  // Positive controls, written as the defect would actually appear in THIS module. If any of
  // them stops being reported, the guard has gone blind and the two tests above are decoration.
  const bad = [
    ['the counter defect this wave fixed', 'total += op.plus - op.minus;\nconst vat = net * 1.19;'],
    ['a float total in value()', 'let total = 0.0; for (const op of byNode.values()) total += op.plus;'],
    ['parseFloat on a token', 'const amount = parseFloat(op.plus.split(" ")[0]);'],
    ['toFixed to make a token', 'return `${(total).toFixed(2)} EUR`;'],
    ['Math.round cents trick', 'return Math.round(minor * 100) / 100;'],
    ['a cent as a decimal literal', 'const cent = 0.01;'],
    ['dividing minor units by a Number literal', 'const major = minor / 100;'],
    ['unary plus on an amount', 'const n = +op.plus;'],
    ['an exponent literal', 'const big = 1e3;'],
    ['isNaN implying doubles', 'if (isNaN(total)) return 0;'],
    ['toLocaleString on an amount', 'return total.toLocaleString("de-DE");'],
    ['a float hidden in a template expression', 'const s = `${op.plus * 1.19}`;'],
    ['parseInt on minor units', 'const minor = parseInt(text, 10);'],
    ['scaling by a float', 'const scaled = minor * 0.01;'],
  ];
  for (const [label, src] of bad) {
    const found = scanSources([[`fixture:${label}`, src]], FLOAT_ONLY);
    assert.ok(found.length > 0, `the guard failed to flag: ${label} — ${src}`);
  }

  // Negative controls: the legitimate code and prose of this directory must never be flagged.
  // The second and third are real lines of crdt.js, and the naive guard flagged both.
  const good = [
    ['exact BigInt arithmetic', 'const total = a + b; const q = n / d; const twice = m * 2n;'],
    ['prose about the defect', '// (0.1 + 0.2) + 0.3 = 0.6000000000000001 while 0.3 + (0.2 + 0.1) = 0.6'],
    ['a doc comment with an amount', '/** e.g. `"4999.99 EUR"`, and 19 % of it is 949.9981 */ export const X = 1n;'],
    ['a canonical token in a string', 'const zero = "0.00 EUR"; const jpy = "1000 JPY";'],
    ['a token inside a template', 'throw new MoneyError("x", `expected "10.00 ${currency}", got ${raw}`);'],
    ['a regex over a token', 'const RE = /^(-?)(0|[1-9][0-9]*)(?:\\.([0-9]+))?$/;'],
    ['integer indexing and counting', 'for (let i = 0; i < ops.length; i++) out.push(ops[i]);'],
    ['a seq comparison', 'if (op.seq > prev.seq) byNode.set(op.node, op);'],
    ['delegated money arithmetic', 'total = moneyAdd(total, moneySubtract(op.plus, op.minus));'],
  ];
  for (const [label, src] of good) {
    const found = scanSources([[`fixture:${label}`, src]], FLOAT_ONLY);
    assert.deepEqual(found, [], `false positive on legitimate code: ${label} — ${JSON.stringify(found)}`);
  }
});
