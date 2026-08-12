// test/sync-opbuffer.test.js — COMPROMISES #4a: an in-progress edit survives a closed tab.
//
// Appendix III gives the Live Layer "a local IndexedDB buffer" and there was not one, so ops died
// with the tab. The claim this file has to make good is small and exact:
//
//   Sarah is halfway through a delivery note. Her laptop dies. She opens it again. Her keystrokes
//   are there, and the document she ends up committing is byte-identical to the one she would have
//   committed if nothing had happened.
//
// "Byte-identical" is `converged()` from session.js, which is the assertion the whole Live Layer
// rests on — imported, not re-derived. And the closed tab is a REAL closed tab: a child process
// that writes the buffer and exits, so nothing is shared between the two halves but the bytes on
// disk. A test that reuses one process proves the map, not the territory.
//
// Then the second half, which is Appendix X's: `git status --porcelain` in the company folder must
// print NOTHING while the buffer exists. "It is simply a folder" is not true if a user who runs git
// in her own company sees an untracked file she did not create.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  opBuffer, fsKvStore, memoryKvStore, bufferKey, baseDigest, BUFFER_DIR, RECORD_VERSION,
} from '../runtime/sync/opbuffer.js';
import { SyncError } from '../runtime/sync/sealed.js';
import { session, converged } from '../runtime/live/session.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { initRepo, repo } from '../runtime/git/repo.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const enc = new TextEncoder();

/** The delivery note from Appendix XI, as committed. */
const NOTE = {
  id: 'LS-2027-0033',
  entity: 'delivery-note',
  status: 'draft',
  deliveryDate: '12.11.',
  notes: '',
  items: ['SKU-1', 'SKU-2'],
  quantity: 12,
};

/** A released invoice, so a `reject` policy has something to quarantine. */
const RELEASED = { id: 'RE-2027-0001', entity: 'invoice', status: 'released', 'gross-amount': '5949.99 EUR' };
const POLICY = {
  stateField: 'status',
  rules: [
    { when: { status: ['released', 'sent', 'booked'] }, fields: '*', on: 'reject',
      message: 'Document is released. Reopen it before editing.' },
    { fields: ['quantity', 'items'], on: 'merge' },
    { when: { status: 'draft' }, fields: '*', on: 'notify' },
  ],
  default: { on: 'notify' },
};

/** A session on a fixed clock. Nothing here reads a wall clock (non-negotiable #5). */
function open(doc, nodeId, start = 1_000, policy = undefined) {
  let t = start;
  return session(doc, nodeId, () => (t += 1), policy ? { policy } : {});
}

const tempDirs = [];
function tempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `neodonkey-buf-${tag}-`));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

/** Real git, with no chance of the developer's own config leaking in. */
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: cwd },
  });
}

// ---------------------------------------------------------------------------------------------
// 1. persist and replay
// ---------------------------------------------------------------------------------------------

test('a buffered op set replays into a fresh session and converges with the original', async () => {
  const buffer = opBuffer({ kv: memoryKvStore(), now: () => 1_700_000 });
  const live = open(NOTE, 'sarah');
  live.set('deliveryDate', '15.11.');
  live.set('notes', 'Ware unvollständig');
  live.add('items', 'SKU-3');
  live.inc('quantity', 4);

  const written = await buffer.persist(live, { baseDoc: NOTE });
  assert.equal(written.key, bufferKey('delivery-note', 'LS-2027-0033'));
  assert.equal(written.ops, live.ops().length);
  assert.ok(written.ops >= 4);

  // The tab closes. A completely new session, from the same committed document.
  const reopened = open(NOTE, 'sarah', 9_000);
  const restored = await buffer.restore(reopened, { baseDoc: NOTE });
  assert.equal(restored.status, 'restored');
  assert.equal(restored.restored, written.ops);

  assert.ok(converged([live, reopened]), 'the replayed session must hold a byte-identical op set');
  assert.deepEqual(reopened.snapshot(), live.snapshot());
  assert.equal(reopened.snapshot().deliveryDate, '15.11.');
  assert.equal(reopened.snapshot().quantity, 16);
  assert.deepEqual(reopened.snapshot().items, ['SKU-1', 'SKU-2', 'SKU-3']);

  // Replaying twice is harmless: the same idempotent path a peer's frames take.
  const again = await buffer.restore(reopened, { baseDoc: NOTE });
  assert.equal(again.status, 'restored');
  assert.ok(converged([live, reopened]));
});

test('the quarantine survives too — the half of #4a that ops() alone does not carry', async () => {
  const buffer = opBuffer({ kv: memoryKvStore() });
  const live = open(RELEASED, 'sarah', 1_000, POLICY);

  // A peer on an older operating model pushes an op onto a released invoice. It is recorded and
  // kept out of the truth (session.js), and it is NOT in ops() — which is why persisting ops()
  // alone would lose it, and why the record carries a second list.
  live.receive([{ field: 'gross-amount', type: 'lww', value: '1.00 EUR', stamp: { wall: 5, counter: 0, node: 'klein' } }]);
  live.receive([{ field: 'id', type: 'lww', value: 'RE-9999', stamp: { wall: 6, counter: 0, node: 'klein' } }]);
  assert.equal(live.ops().length, 0, 'a rejected op creates no register, so ops() is empty');
  assert.equal(live.violations().length, 2);

  const written = await buffer.persist(live, { baseDoc: RELEASED });
  assert.equal(written.ops, 0);
  assert.equal(written.quarantined, 1, 'the policy-reject is replayable; the immutable-field is not');

  const reopened = open(RELEASED, 'sarah', 9_000, POLICY);
  const restored = await buffer.restore(reopened, { baseDoc: RELEASED });
  assert.equal(restored.status, 'restored');
  assert.equal(restored.quarantined, 1);
  const kinds = reopened.violations().map((v) => v.kind);
  assert.deepEqual(kinds, ['policy-reject']);
  assert.equal(reopened.violations()[0].field, 'gross-amount');
  // And the truth is untouched: a quarantined op never reaches a snapshot, before or after a reload.
  assert.deepEqual(reopened.snapshot(), RELEASED);
});

test('a record that does not belong to this session is refused, and never deleted', async () => {
  const kv = memoryKvStore();
  const buffer = opBuffer({ kv });
  const live = open(NOTE, 'sarah');
  live.set('notes', 'half a sentence');
  await buffer.persist(live, { baseDoc: NOTE });

  // 1. STALE: the document has been committed or pulled since. The keystrokes are KEPT, because
  //    deleting a human's unsaved work because we could not use it is the loss this file prevents.
  const moved = { ...NOTE, deliveryDate: '20.11.' };
  const onMoved = open(moved, 'sarah');
  const stale = await buffer.restore(onMoved, { baseDoc: moved });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.restored, 0);
  assert.match(stale.reason, /different version of delivery-note\/LS-2027-0033/);
  assert.equal(onMoved.ops().length, 0, 'nothing was applied');
  assert.notEqual(await kv.get(bufferKey('delivery-note', 'LS-2027-0033')), null, 'the record is kept');

  // 2. FOREIGN VERSION: a buffer written by a future NeoDonkey.
  await kv.put(bufferKey('invoice', 'RE-1'), { v: 99, entity: 'invoice', id: 'RE-1', ops: [] });
  const other = await buffer.restore(open({ id: 'RE-1', entity: 'invoice' }, 'sarah'), { baseDoc: { id: 'RE-1', entity: 'invoice' } });
  assert.equal(other.status, 'foreign');
  assert.match(other.reason, /version 99 is not 1/);

  // 3. FOREIGN DOCUMENT: the record names another document than the session.
  await kv.put(bufferKey('invoice', 'RE-2'), { v: RECORD_VERSION, entity: 'invoice', id: 'RE-9', ops: [] });
  const mismatch = await buffer.restore(open({ id: 'RE-2', entity: 'invoice' }, 'sarah'), { baseDoc: { id: 'RE-2', entity: 'invoice' } });
  assert.equal(mismatch.status, 'foreign');
  assert.match(mismatch.reason, /is for invoice\/RE-9, not invoice\/RE-2/);

  // 4. NO RECORD AT ALL is not an error.
  const empty = await buffer.restore(open({ id: 'X-1', entity: 'order' }, 'sarah'), { baseDoc: { id: 'X-1', entity: 'order' } });
  assert.deepEqual(empty, { restored: 0, quarantined: 0, status: 'empty' });

  // 5. A malformed record is refused rather than half-applied.
  await kv.put(bufferKey('order', 'O-1'), { v: RECORD_VERSION, entity: 'order', id: 'O-1', ops: 'nope' });
  const bad = await buffer.restore(open({ id: 'O-1', entity: 'order' }, 'sarah'), { baseDoc: { id: 'O-1', entity: 'order' } });
  assert.equal(bad.status, 'foreign');
});

test('an empty op set removes the record — "unsaved work" must not be a lie', async () => {
  const kv = memoryKvStore();
  const buffer = opBuffer({ kv });
  const live = open(NOTE, 'sarah');
  live.set('notes', 'typo');
  await buffer.persist(live, { baseDoc: NOTE });
  assert.equal((await buffer.pending()).length, 1);

  const fresh = open(NOTE, 'sarah');
  await buffer.persist(fresh, { baseDoc: NOTE });
  assert.equal((await buffer.pending()).length, 0, 'a session with no ops must leave no record');

  // discard() after a successful commit. Appendix III: the process is over once the fact lands.
  await buffer.persist(live, { baseDoc: NOTE });
  await buffer.discard('delivery-note', 'LS-2027-0033');
  assert.equal((await buffer.pending()).length, 0);
  assert.equal(await kv.get(bufferKey('delivery-note', 'LS-2027-0033')), null);
});

test('pending() answers "you have unsaved work on three documents"', async () => {
  const buffer = opBuffer({ kv: memoryKvStore(), now: () => 4_242 });
  for (const id of ['LS-1', 'LS-2', 'LS-3']) {
    const live = open({ ...NOTE, id }, 'sarah');
    live.set('notes', `note on ${id}`);
    await buffer.persist(live, { baseDoc: { ...NOTE, id } });
  }
  const pending = await buffer.pending();
  assert.equal(pending.length, 3);
  assert.deepEqual(pending.map((p) => p.id).sort(), ['LS-1', 'LS-2', 'LS-3']);
  for (const p of pending) {
    assert.equal(p.entity, 'delivery-note');
    assert.equal(p.nodeId, 'sarah');
    assert.equal(p.at, 4_242);
    assert.ok(p.ops > 0);
  }
});

test('track() keeps a session persisted as it is typed, with an injected debounce', async () => {
  const kv = memoryKvStore();
  const buffer = opBuffer({ kv });
  const live = open(NOTE, 'sarah');
  /** @type {(()=>void)[]} */
  const scheduled = [];
  const stop = buffer.track(live, { baseDoc: NOTE, schedule: (fn) => scheduled.push(fn) });

  live.set('notes', 'a');
  live.set('notes', 'ab');
  live.set('notes', 'abc');
  assert.equal(scheduled.length, 1, 'three keystrokes coalesce into one scheduled save');
  scheduled[0]();
  /** @type {any} */
  let record = null;
  for (let i = 0; i < 100 && record === null; i++) {
    await new Promise((r) => setTimeout(r, 2));
    record = await kv.get(bufferKey('delivery-note', 'LS-2027-0033'));
  }
  assert.ok(record !== null, 'the scheduled save must have written the record');
  assert.ok(record.ops.length > 0);

  stop();
  live.set('notes', 'abcd');
  assert.equal(scheduled.length, 1, 'after stop() nothing more is scheduled');
});

test('baseDigest is the Live Layer\'s own canonicalisation, so key order cannot change the verdict', async () => {
  const a = await baseDigest({ id: 'X', entity: 'e', b: 1, a: 2 });
  const b = await baseDigest({ entity: 'e', a: 2, id: 'X', b: 1 });
  assert.equal(a, b);
  assert.notEqual(a, await baseDigest({ id: 'X', entity: 'e', b: 1, a: 3 }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('opBuffer and its kv store refuse the arguments they cannot honour', async () => {
  assert.throws(() => opBuffer({}), SyncError);
  assert.throws(() => bufferKey('', 'x'), SyncError);
  assert.throws(() => bufferKey('e', ''), SyncError);
  const buffer = opBuffer({ kv: memoryKvStore() });
  await assert.rejects(() => buffer.persist(open(NOTE, 'sarah'), {}), /needs the committed base document/);
  await assert.rejects(() => buffer.persist(open(NOTE, 'sarah'), { baseDoc: null }), /needs the committed base document/);
});

// ---------------------------------------------------------------------------------------------
// 2. a real closed tab, and a real folder
// ---------------------------------------------------------------------------------------------

test('the buffer survives a process that dies mid-edit, on the real filesystem', async () => {
  const dir = tempDir('tab');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  await r.commit({
    files: new Map([['documents/delivery-note/LS-2027-0033.json', enc.encode(`${JSON.stringify(NOTE, null, 2)}\n`)]]),
    message: 'the delivery note as committed\n',
    author: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' },
    time: 1_754_251_200,
    tzOffsetMinutes: 120,
  });
  await r.checkout();

  // ---- the tab: a separate process that types, persists, and dies. -------------------------
  const child = `
    import { nodeFs } from '${REPO_ROOT}runtime/git/fs-node.js';
    import { opBuffer, fsKvStore } from '${REPO_ROOT}runtime/sync/opbuffer.js';
    import { session } from '${REPO_ROOT}runtime/live/session.js';
    const NOTE = ${JSON.stringify(NOTE)};
    const fs = nodeFs(${JSON.stringify(dir)});
    const buffer = opBuffer({ kv: fsKvStore(fs), now: () => 1_754_251_500 });
    let t = 1_000;
    const live = session(NOTE, 'sarah', () => (t += 1));
    live.set('deliveryDate', '15.11.');
    live.set('notes', 'Ware unvollständig, Klärung mit Müller GmbH');
    live.inc('quantity', -2);
    await buffer.persist(live, { baseDoc: NOTE });
    process.stdout.write(JSON.stringify({ ops: live.ops(), snapshot: live.snapshot() }));
    process.exit(0);              // the tab closes. Nothing is handed over but the bytes on disk.
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
  const inTheTab = JSON.parse(out);
  assert.ok(inTheTab.ops.length >= 3);

  // ---- Appendix X: a user runs git in her own folder and sees nothing unexpected. -----------
  assert.ok(existsSync(join(dir, BUFFER_DIR)), 'the buffer must actually be on disk');
  assert.ok(readdirSync(join(dir, BUFFER_DIR)).length > 0);
  assert.equal(git(dir, 'status', '--porcelain'), '',
    'git must report NOTHING — a buffer a user did not create must be invisible to her');
  assert.equal(git(dir, 'fsck', '--strict').trim(), '',
    'the buffer must not make the object database look broken');
  // git does not track it and does not carry it into a commit.
  assert.equal(git(dir, 'ls-files').includes('neodonkey-live'), false);

  // ---- she opens the laptop again. -----------------------------------------------------------
  const buffer = opBuffer({ kv: fsKvStore(fs) });
  const pending = await buffer.pending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'LS-2027-0033');
  assert.equal(pending[0].at, 1_754_251_500);

  let t = 50_000;
  const reopened = session(NOTE, 'sarah', () => (t += 1));
  const restored = await buffer.restore(reopened, { baseDoc: NOTE });
  assert.equal(restored.status, 'restored');
  assert.equal(restored.restored, inTheTab.ops.length);
  assert.deepEqual(reopened.ops(), inTheTab.ops,
    'the op set after a crash must be byte-identical to the one that was lost');
  assert.deepEqual(reopened.snapshot(), inTheTab.snapshot);
  assert.equal(reopened.snapshot().notes, 'Ware unvollständig, Klärung mit Müller GmbH');
  assert.equal(reopened.snapshot().quantity, 10);

  // ---- and the fact lands, after which the process is discarded. ----------------------------
  await r.commit({
    files: new Map([['documents/delivery-note/LS-2027-0033.json',
      enc.encode(`${JSON.stringify(reopened.snapshot(), null, 2)}\n`)]]),
    message: 'delivery note released\n',
    author: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' },
    time: 1_754_254_800,
    tzOffsetMinutes: 120,
  });
  await r.checkout();
  await buffer.discard('delivery-note', 'LS-2027-0033');
  assert.deepEqual(await buffer.pending(), []);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'fsck', '--strict').trim(), '');
});

test('fsKvStore encodes a key into exactly one flat filename that cannot escape its directory', async () => {
  const dir = tempDir('kv');
  const fs = nodeFs(dir);
  const kv = fsKvStore(fs, '.git/neodonkey-live');
  for (const key of ['ops/invoice/RE 2027/0001', 'ops/../../escape', 'ops/Müller GmbH/x']) {
    await kv.put(key, { key });
    assert.deepEqual(await kv.get(key), { key });
  }
  const names = readdirSync(join(dir, '.git/neodonkey-live'));
  assert.equal(names.length, 3);
  for (const name of names) {
    assert.equal(name.includes('/'), false, `${name} must be a flat filename`);
    assert.equal(name.startsWith('..'), false);
  }
  assert.deepEqual((await kv.keys()).sort(), ['ops/../../escape', 'ops/Müller GmbH/x', 'ops/invoice/RE 2027/0001'].sort());
  await kv.delete('ops/../../escape');
  assert.equal(await kv.get('ops/../../escape'), null);

  // A half-written buffer is refused rather than guessed at.
  await fs.write('.git/neodonkey-live/broken.json', enc.encode('{not json'));
  await assert.rejects(() => kv.get('broken'), /is not JSON/);
  await assert.rejects(() => fsKvStore(fs).get(''), SyncError);
});
