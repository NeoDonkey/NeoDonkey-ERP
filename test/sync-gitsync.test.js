// test/sync-gitsync.test.js — the Truth Layer over a PeerLink. "Send me what I lack."
//
// CRDT ops are the process; commits are the result (Appendix III). A peer that received only ops
// received none of the company. So this file answers the question gate item 4 actually asks:
//
//   Herr Klein has been on holiday. Sarah has committed twelve business events. He opens his laptop.
//   ONE packfile crosses the link, and afterwards `git fsck --strict` in his folder is clean and
//   `git log` shows Sarah's twelve commits, with her signatures.
//
// Real `git` is the judge throughout (Part 4, rule 3). Our code agreeing with itself is not evidence
// that a peer received a valid repository — only git saying so is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  gitPeer, reachable, isAncestor, haveList, GIT_SYNC_VERSION, MAIN_REF, PEER_REF_PREFIX, CHUNK_BYTES,
} from '../runtime/sync/gitsync.js';
import { SyncError } from '../runtime/sync/sealed.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { writePack } from '../runtime/git/pack.js';

const enc = new TextEncoder();
const AUTHOR = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' };
const TZ = 120;

const tempDirs = [];
function tempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `neodonkey-sync-${tag}-`));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: cwd },
  });
}

/** A repository on the real filesystem, plus the handles the peers need. */
async function makeRepo(tag) {
  const dir = tempDir(tag);
  const fs = nodeFs(dir);
  await initRepo(fs);
  return { dir, fs, r: repo(fs) };
}

/**
 * `n` business events, each a document in `documents/goods-receipt/`. Every commit carries the
 * whole desired tree, exactly as repo.commit() requires, so commit `k` holds `k` documents.
 */
async function commitEvents(r, n, from = 1) {
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  const oids = [];
  for (let i = 1; i <= n; i++) {
    const id = `WE-2027-${String(from + i - 1).padStart(4, '0')}`;
    files.set(`documents/goods-receipt/${id}.json`, enc.encode(`${JSON.stringify({
      id, entity: 'goods-receipt', quantity: i, 'net-amount': `${i}00.00 EUR`,
    }, null, 2)}\n`));
    oids.push(await r.commit({
      files: new Map(files),
      message: `goods receipt ${id}\n`,
      author: AUTHOR,
      time: 1_754_251_200 + i * 60,
      tzOffsetMinutes: TZ,
    }));
  }
  return oids;
}

/**
 * Two `PeerLink`s wired to each other, delivering on the microtask queue.
 *
 * Deliberately NOT synchronous: the git exchange is request/response over promises, and a transport
 * that delivers inside `send()` would hide every ordering assumption in it. Frames are also counted
 * and recorded, because "ONE packfile crossed the link" is a claim about the wire, not about the
 * result, and the only way to check it is to look at the wire.
 */
function pipePair(idA = 'A', idB = 'B') {
  /** @type {Map<string, ((f:string)=>void)[]>} */
  const handlers = new Map([[idA, []], [idB, []]]);
  /** @type {Map<string, string[]>} */
  const queues = new Map([[idA, []], [idB, []]]);
  /** @type {{from:string, frame:string}[]} */
  const log = [];
  let open = true;

  const deliver = (to, frame) => {
    const list = handlers.get(to);
    if (list.length === 0) { queues.get(to).push(frame); return; }
    for (const h of list) h(frame);
  };

  const end = (self, peer) => ({
    id: peer,
    send(frame) {
      if (typeof frame !== 'string') throw new TypeError('PeerLink.send: frame must be a string');
      if (!open) return;
      log.push({ from: self, frame });
      queueMicrotask(() => deliver(peer, frame));
    },
    onFrame(handler) {
      handlers.get(self).push(handler);
      for (const f of queues.get(self).splice(0)) handler(f);
    },
    close() { handlers.set(self, []); },
  });

  return {
    a: end(idA, idB),
    b: end(idB, idA),
    log,
    /** Every message type sent by one side, in order. */
    typesFrom(id) {
      return log.filter((e) => e.from === id).map((e) => JSON.parse(e.frame).t);
    },
    cut() { open = false; },
  };
}

// ---------------------------------------------------------------------------------------------
// 1. reachability and ancestry — the two questions the protocol is built on
// ---------------------------------------------------------------------------------------------

test('reachable() walks a commit closure exactly once, and refuses a hole rather than skipping it', async () => {
  const { r } = await makeRepo('reach');
  const oids = await commitEvents(r, 3);
  const head = oids[2];

  const all = await reachable(r.store, [head]);
  // 3 commits + 3 root trees + 3 documents/ trees + 3 goods-receipt/ trees + 3 blobs = 15,
  // minus the trees and blobs that are byte-identical across commits and therefore one object.
  assert.equal(all.oids.length, new Set(all.oids).size, 'no object is visited twice');
  assert.ok(all.oids.length >= 12, `expected the whole closure, saw ${all.oids.length}`);
  assert.equal(all.objects.length, all.oids.length);
  for (const o of all.objects) assert.ok(['commit', 'tree', 'blob'].includes(o.type));

  // Stopping at the second commit yields only what the third added.
  const delta = await reachable(r.store, [head], new Set((await reachable(r.store, [oids[1]])).oids));
  assert.ok(delta.oids.length < all.oids.length);
  assert.ok(delta.oids.includes(head));
  assert.equal(delta.oids.includes(oids[1]), false);

  // A missing object is a named refusal, not a short answer — this is the check that makes a
  // truncated history impossible to mistake for a small one.
  await assert.rejects(
    () => reachable(r.store, ['0'.repeat(40)]),
    /object 0{40} is reachable but not present/);

  // maxObjects turns an out-of-memory into a refusal that says the number.
  await assert.rejects(
    () => reachable(r.store, [head], new Set(), { maxObjects: 2 }),
    /would move more than 2 objects/);
});

test('isAncestor() answers ff/behind/unrelated, and never guesses about a history it lacks', async () => {
  const { r } = await makeRepo('anc');
  const oids = await commitEvents(r, 4);
  assert.equal(await isAncestor(r.store, oids[0], oids[3]), true);
  assert.equal(await isAncestor(r.store, oids[3], oids[0]), false);
  assert.equal(await isAncestor(r.store, oids[2], oids[2]), true);
  // A commit we do not hold cannot be proven an ancestor, and "not proven" is answered as false
  // rather than as an exception — the caller's next move is to fetch, not to fail.
  assert.equal(await isAncestor(r.store, '1'.repeat(40), oids[3]), false);

  const have = await haveList(r, 2);
  assert.equal(have.length, 2);
  assert.deepEqual(have, [oids[3], oids[2]]);
});

// ---------------------------------------------------------------------------------------------
// 2. THE GATE ITEM: a peer twelve commits behind catches up in one pack
// ---------------------------------------------------------------------------------------------

test('a peer with nothing receives the whole company in ONE pack, and real git calls it clean', async () => {
  const sarah = await makeRepo('sarah');
  const klein = await makeRepo('klein');
  const commits = await commitEvents(sarah.r, 12);
  const head = commits[11];
  assert.equal(await sarah.r.head(), head);
  assert.equal(await klein.r.head(), null, 'Herr Klein starts with an empty repository');

  const wire = pipePair('sarah', 'klein');
  const server = gitPeer({ link: wire.a, repo: sarah.r, fs: sarah.fs, peerId: 'klein' });
  /** @type {object[]} */
  const progress = [];
  const client = gitPeer({
    link: wire.b, repo: klein.r, fs: klein.fs, peerId: 'sarah',
    onProgress: (note) => progress.push(note),
  });

  const result = await client.fetch();

  assert.equal(result.status, 'received');
  assert.equal(result.peerHead, head);
  assert.equal(result.head, head);
  assert.deepEqual(result.refs, { [MAIN_REF]: head });
  assert.ok(result.objects > 12, `expected the whole closure, got ${result.objects} objects`);
  assert.ok(result.packBytes > 0);

  // ONE pack. Not one per commit, not one per object: the whole exchange is four rounds.
  const fromSarah = wire.typesFrom('sarah');
  assert.equal(fromSarah.filter((t) => t === 'pack!').length, 1, 'exactly one packfile crossed the link');
  assert.equal(fromSarah.filter((t) => t === 'done').length, 1);
  assert.deepEqual(wire.typesFrom('klein'), ['refs?', 'want']);
  assert.deepEqual([...new Set(fromSarah)], ['refs!', 'pack!', 'chunk', 'done']);
  // And every chunk is inside the frame size a WebSocket and a DataChannel both accept.
  for (const e of wire.log) assert.ok(e.frame.length < CHUNK_BYTES * 2, 'a frame must fit one message');

  // ---- and now the only judge that counts. --------------------------------------------------
  await klein.r.checkout();
  assert.equal(git(klein.dir, 'fsck', '--strict').trim(), '',
    'a fetched repository must be a valid one, according to git');
  assert.equal(git(klein.dir, 'status', '--porcelain'), '',
    'Appendix X: it is simply a folder, with her company inside');
  assert.equal(git(klein.dir, 'rev-parse', 'HEAD').trim(), head);
  const log = git(klein.dir, 'log', '--format=%s').trim().split('\n');
  assert.equal(log.length, 12);
  assert.equal(log[0], 'goods receipt WE-2027-0012');
  assert.equal(log[11], 'goods receipt WE-2027-0001');
  // Byte-identical documents, checked through git rather than through our own reader.
  for (let i = 1; i <= 12; i++) {
    const id = `WE-2027-${String(i).padStart(4, '0')}`;
    assert.equal(
      git(klein.dir, 'show', `HEAD:documents/goods-receipt/${id}.json`),
      git(sarah.dir, 'show', `HEAD:documents/goods-receipt/${id}.json`),
      `${id} must arrive byte-identical`);
    assert.ok(existsSync(join(klein.dir, `documents/goods-receipt/${id}.json`)));
  }
  assert.deepEqual(progress.map((p) => p.phase), ['fetching', 'fetched']);
});

test('a peer a few commits behind receives only the difference, not the history again', async () => {
  const sarah = await makeRepo('ff-s');
  const klein = await makeRepo('ff-k');
  const first = await commitEvents(sarah.r, 3);

  // Herr Klein catches up to commit 3 the honest way — by fetching it.
  const wire1 = pipePair();
  gitPeer({ link: wire1.a, repo: sarah.r, fs: sarah.fs });
  const catchUp = await gitPeer({ link: wire1.b, repo: klein.r, fs: klein.fs }).fetch();
  assert.equal(catchUp.status, 'received');
  const fullObjects = catchUp.objects;

  // Sarah commits nine more while he is away.
  await commitEvents(sarah.r, 9, 4);
  const head = await sarah.r.head();

  const wire2 = pipePair();
  gitPeer({ link: wire2.a, repo: sarah.r, fs: sarah.fs });
  const client = gitPeer({ link: wire2.b, repo: klein.r, fs: klein.fs });
  const result = await client.fetch();

  assert.equal(result.status, 'fast-forward');
  assert.equal(result.head, head);
  assert.equal(await klein.r.head(), head);
  // The `have` list did its job: the three commits he already held were not sent again.
  const whole = (await reachable(sarah.r.store, [head], new Set(), { collect: false })).oids.length;
  assert.ok(result.objects < whole,
    `sent ${result.objects} of ${whole} objects — a fetch must not resend what the peer has`);
  assert.ok(result.objects >= 9, 'but it must send everything the nine new commits need');
  assert.ok(fullObjects > 0);

  await klein.r.checkout();
  assert.equal(git(klein.dir, 'fsck', '--strict').trim(), '');
  assert.equal(git(klein.dir, 'status', '--porcelain'), '');
  assert.equal(git(klein.dir, 'log', '--format=%s').trim().split('\n').length, 12);

  // Fetching again moves nothing at all.
  const wire3 = pipePair();
  gitPeer({ link: wire3.a, repo: sarah.r, fs: sarah.fs });
  const noop = await gitPeer({ link: wire3.b, repo: klein.r, fs: klein.fs }).fetch();
  assert.equal(noop.status, 'up-to-date');
  assert.equal(noop.objects, 0);
  assert.equal(wire3.typesFrom('B').includes('want'), false, 'nothing to want, so nothing is asked');
});

test('the peer that is ahead is told so, and an empty peer is not mistaken for a fetch', async () => {
  const sarah = await makeRepo('ahead-s');
  const klein = await makeRepo('ahead-k');
  await commitEvents(sarah.r, 2);

  // Sarah asks an EMPTY Herr Klein. Nothing to fetch, and nothing is broken by asking.
  const wire = pipePair();
  gitPeer({ link: wire.a, repo: klein.r, fs: klein.fs });
  const asEmpty = await gitPeer({ link: wire.b, repo: sarah.r, fs: sarah.fs }).fetch();
  assert.equal(asEmpty.status, 'up-to-date');
  assert.equal(asEmpty.peerHead, null);
  assert.deepEqual(asEmpty.refs, {});

  // Klein catches up, Sarah commits more, then Klein asks Sarah — Sarah is ahead of him, so from
  // *Sarah's* side asking Klein reports 'ahead'.
  const w2 = pipePair();
  gitPeer({ link: w2.a, repo: sarah.r, fs: sarah.fs });
  await gitPeer({ link: w2.b, repo: klein.r, fs: klein.fs }).fetch();
  await commitEvents(sarah.r, 1, 3);
  const w3 = pipePair();
  gitPeer({ link: w3.a, repo: klein.r, fs: klein.fs });
  const ahead = await gitPeer({ link: w3.b, repo: sarah.r, fs: sarah.fs }).fetch();
  assert.equal(ahead.status, 'ahead');
  assert.equal(ahead.objects, 0);
  assert.equal(await sarah.r.head(), (await sarah.r.log(1))[0].oid, 'HEAD must not move backwards');
});

test('divergence is named, never merged — and the fetched history stays git-fsck clean', async () => {
  const sarah = await makeRepo('div-s');
  const klein = await makeRepo('div-k');
  const base = (await commitEvents(sarah.r, 1))[0];

  const w1 = pipePair();
  gitPeer({ link: w1.a, repo: sarah.r, fs: sarah.fs });
  await gitPeer({ link: w1.b, repo: klein.r, fs: klein.fs }).fetch();
  assert.equal(await klein.r.head(), base);

  // Both commit, offline, from the same base. This is Appendix VIII's hard case and gitsync.js
  // deliberately does not decide it: nothing is lost, and a human is told.
  await commitEvents(sarah.r, 1, 10);
  await commitEvents(klein.r, 1, 20);
  const sarahHead = await sarah.r.head();
  const kleinHead = await klein.r.head();
  assert.notEqual(sarahHead, kleinHead);

  const w2 = pipePair();
  gitPeer({ link: w2.a, repo: sarah.r, fs: sarah.fs });
  const client = gitPeer({ link: w2.b, repo: klein.r, fs: klein.fs, peerId: 'sarah/laptop:1' });
  const result = await client.fetch();

  assert.equal(result.status, 'diverged');
  assert.ok(result.objects > 0, 'the objects are fetched — nothing a peer sent is ever discarded');
  assert.equal(await klein.r.head(), kleinHead, 'a diverged fetch must NOT move main');

  // The peer's head is recorded as a ref, which is what keeps git fsck clean and lets a human look.
  const refPath = join(klein.dir, `.git/${PEER_REF_PREFIX}/sarah_laptop_1/main`);
  assert.ok(existsSync(refPath), 'the peer head must be a real ref, or the objects are dangling');
  assert.equal(readFileSync(refPath, 'utf8').trim(), sarahHead);
  assert.equal(git(klein.dir, 'fsck', '--strict').trim(), '',
    'without the peer ref, fsck would report every fetched object as dangling');
  assert.equal(git(klein.dir, 'rev-parse', `${PEER_REF_PREFIX}/sarah_laptop_1/main`).trim(), sarahHead);
  assert.equal(git(klein.dir, 'log', '--format=%s', `${PEER_REF_PREFIX}/sarah_laptop_1/main`).trim().split('\n').length, 2);
  // And git itself agrees the two are unrelated by ancestry, which is what 'diverged' means.
  assert.equal(git(klein.dir, 'merge-base', sarahHead, kleinHead).trim(), base);
});

// ---------------------------------------------------------------------------------------------
// 3. the sender is not trusted
// ---------------------------------------------------------------------------------------------

test('a sender that sends too little is caught: a truncated history is never a short one', async () => {
  const klein = await makeRepo('short');
  const sarah = await makeRepo('short-src');
  const commits = await commitEvents(sarah.r, 2);
  const head = commits[1];

  // A pack containing the commit but NOT its tree — the interesting attack, because every object
  // in it is genuine and hashes correctly. Only the completeness walk catches it.
  const commit = await sarah.r.store.read(head);
  const written = await writePack([{ type: commit.type, content: commit.content }]);

  const wire = pipePair();
  const peer = gitPeer({ link: wire.b, repo: klein.r, fs: klein.fs });
  await assert.rejects(
    () => peer.ingestPack(written.pack, written.idx, [head]),
    (err) => {
      assert.ok(err instanceof SyncError);
      assert.match(err.message, /is reachable but not present in this repository/);
      return true;
    });
  assert.equal(await klein.r.head(), null, 'a refused pack must not move HEAD');
});

test('a corrupted pack is refused by content, not believed because a peer sent it', async () => {
  const klein = await makeRepo('corrupt');
  const sarah = await makeRepo('corrupt-src');
  const head = (await commitEvents(sarah.r, 2))[1];
  const { objects } = await reachable(sarah.r.store, [head]);
  const written = await writePack(objects.map((o) => ({ type: o.type, content: o.content })));

  const wire = pipePair();
  const peer = gitPeer({ link: wire.b, repo: klein.r, fs: klein.fs });
  // The honest pack is accepted, so the refusals below are not vacuous.
  const ok = await peer.ingestPack(written.pack.slice(), written.idx.slice(), [head]);
  assert.equal(ok, objects.length);

  // One byte flipped in the compressed object data. Three independent layers can catch it: the
  // pack checksum, the CRC32 in the index, and the recomputed SHA-1 of the object.
  const klein2 = await makeRepo('corrupt2');
  const peer2 = gitPeer({ link: pipePair().b, repo: klein2.r, fs: klein2.fs });
  const bent = written.pack.slice();
  bent[40] ^= 0x40;
  await assert.rejects(() => peer2.ingestPack(bent, written.idx.slice(), [head]));
  // A truncated pack, likewise.
  await assert.rejects(
    () => peer2.ingestPack(written.pack.subarray(0, 20), written.idx.slice(), [head]));
});

test('an unknown verb and a foreign protocol version are refused by name, never ignored', async () => {
  const sarah = await makeRepo('proto');
  await commitEvents(sarah.r, 1);
  const wire = pipePair();
  /** @type {Error[]} */
  const errors = [];
  gitPeer({ link: wire.a, repo: sarah.r, fs: sarah.fs, onError: (e) => errors.push(e) });

  /** @type {any[]} */
  const answers = [];
  wire.b.onFrame((f) => answers.push(JSON.parse(f)));

  // Polled rather than slept on. A fixed 20 ms wait passed alone and failed under the full suite,
  // which is the definition of a flaky test: it was asserting about the machine's load, not about
  // the protocol.
  const until = async (predicate, why) => {
    for (let i = 0; i < 400; i++) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.fail(why);
  };

  // A peer speaking version 2 is told the number, rather than being served something it cannot read.
  wire.b.send(JSON.stringify({ t: 'refs?', n: 1, v: GIT_SYNC_VERSION + 1 }));
  await until(() => answers.length === 1, 'a version-2 refs? must be answered');
  assert.equal(answers[0].t, 'no');
  assert.match(answers[0].why, /git sync version 2 — this peer speaks 1/);

  // An unknown message type is an error the caller sees (Principle 6).
  wire.b.send(JSON.stringify({ t: 'gossip', n: 2 }));
  await until(() => errors.length === 1, 'an unknown verb must be reported');
  assert.match(errors[0].message, /unknown message type "gossip"/);

  // Rubbish on the link is reported, and the peer stays alive.
  wire.b.send('not json at all');
  await until(() => errors.length === 2, 'a non-JSON frame must be reported');
  assert.match(errors[1].message, /frame is not JSON/);
  wire.b.send(JSON.stringify({ t: 'refs?', n: 3 }));
  await until(() => answers.length === 2, 'and the peer must still answer afterwards');
  assert.equal(answers[1].t, 'refs!');
  assert.equal(answers[1].v, GIT_SYNC_VERSION);
});

test('gitPeer refuses to be constructed without the two things it cannot work without', () => {
  const wire = pipePair();
  assert.throws(() => gitPeer({ link: wire.a }), SyncError);
  assert.throws(() => gitPeer({ repo: {} }), SyncError);
  assert.throws(() => gitPeer(null), SyncError);
});
