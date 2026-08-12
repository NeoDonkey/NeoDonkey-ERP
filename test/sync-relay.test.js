// test/sync-relay.test.js — gate item 4, in operating-system processes.
//
//   4. **Two real machines sync**, and a company is recovered after one is destroyed.
//
// This file is the answer, and it is deliberately built out of separate PROCESSES rather than
// separate objects, because everything interesting about sync is what survives a process boundary:
//
//   • `node relay.mjs` is started as a real program and its stdout is captured, so the claim that it
//     "sees nothing, decides nothing, stores nothing" is checked against what it actually printed.
//   • Two peer programs are spawned. They discover each other through the relay, seal a session,
//     converge a live document, and exchange a packfile. Nothing is shared between them but the
//     relay's socket and a QR-code string.
//   • Then Sarah's repository is DELETED — the laptop falls into the sea, Appendix X — and a third
//     process with a brand-new key pair recovers the whole company from Herr Klein.
//
// Two processes on one machine is not two machines, and this file does not claim otherwise: what it
// removes is every shared object, every shared module instance and every shared piece of memory. The
// residual difference from two machines is the physical network, which is named in the report and in
// docs/COMPROMISES.md #4 rather than glossed over.
//
// Real `git` is the judge of every repository state here (Part 4, rule 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { relay, parseArgs } from '../relay.mjs';
import {
  connectRelay, mailboxUrl, mailboxFromPath, relaySocket,
  MAILBOX_PATH_PREFIX, MAILBOX_ID_PATTERN, MAILBOX_CAPACITY, CONTROL, CLOSE,
} from '../runtime/sync/signalling.js';
import {
  SyncError, TRUTH_CHANNEL, liveChannel, platformRandomBytes, rendezvousFrom, hex,
} from '../runtime/sync/sealed.js';
import { createIntroduction } from '../runtime/sync/introduce.js';
import { gitPeer } from '../runtime/sync/gitsync.js';
import {
  generateIdentity, exportPublicRaw, exportPrivateJwk,
} from '../runtime/identity/ed25519.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { scanSources } from './_source-guard.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const enc = new TextEncoder();
const AUTHOR = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' };
const NOW = 1_780_000_000_000;
const REPO_ID = 'sarah-erp';
/** The document the two peers edit live while their repositories catch up. */
const NOTE = {
  id: 'LS-2027-0033', entity: 'delivery-note', status: 'draft', deliveryDate: '12.11.', notes: '',
};

const timers = { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) };

const tempDirs = [];
function tempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `neodonkey-relay-${tag}-`));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

/**
 * Wait until `predicate()` holds, or fail with `why`.
 *
 * Every wait in this file is a CONDITION, not a duration — the two exceptions are marked in place
 * and both prove a negative, which no signal can. Polls at 2 ms so a fast machine is not punished
 * for being fast, and gives up after 10 s so a hang is a failure rather than a stalled suite.
 */
async function until(predicate, why, budgetMs = 10_000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) assert.fail(`${why} (waited ${budgetMs} ms)`);
    await new Promise((res) => setTimeout(res, 2));
  }
}

/** Poll the relay's own health endpoint until it says what we are waiting for. */
async function untilHealth(base, predicate, why) {
  /** @type {any} */
  let last = null;
  const deadline = Date.now() + 10_000;
  for (;;) {
    last = await (await fetch(`${base}/health`)).json();
    if (predicate(last)) return last;
    if (Date.now() > deadline) assert.fail(`${why} — last saw ${JSON.stringify(last)}`);
    await new Promise((res) => setTimeout(res, 10));
  }
}

/** Every peer process this file has spawned, so a failing test cannot leave one running. */
const spawnedPeers = new Set();
process.on('exit', () => { for (const c of spawnedPeers) { try { c.kill('SIGKILL'); } catch { /* gone */ } } });

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: cwd },
  });
}

/** `n` signed-shaped business events. The content is what the recovery test compares against. */
async function commitEvents(r, n) {
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  /** @type {Map<string, string>} */
  const expected = new Map();
  let head = null;
  for (let i = 1; i <= n; i++) {
    const id = `RE-2027-${String(i).padStart(4, '0')}`;
    const path = `documents/invoice/${id}.json`;
    const body = `${JSON.stringify({
      id, entity: 'invoice', customer: 'Müller GmbH', 'gross-amount': `${i}499.99 EUR`,
    }, null, 2)}\n`;
    files.set(path, enc.encode(body));
    expected.set(path, body);
    head = await r.commit({
      files: new Map(files),
      message: `invoice ${id} released\n`,
      author: AUTHOR,
      time: 1_754_251_200 + i * 60,
      tzOffsetMinutes: 120,
    });
  }
  return { head, expected };
}

// =============================================================================================
// 1. the relay, judged against its own sentence
// =============================================================================================

test('relay.mjs contains no filesystem access, and never parses a payload', async () => {
  const src = readFileSync(join(REPO_ROOT, 'relay.mjs'), 'utf8');
  // "STORES NOTHING" as a property of the source, not a promise in a comment. `forbidden` strips
  // comments and string literals first, so the file's own documentation cannot trip it — the guard
  // that flagged its own comment is the mistake test/_source-guard.js exists to prevent.
  const hits = scanSources([['relay.mjs', src]], [
    ['filesystem', /node:fs|writeFileSync|readFileSync|createWriteStream|appendFile/,
      'a relay that can write a file is a relay that can store a payload'],
    ['a database', /localStorage|indexedDB|sqlite/i, 'same, with extra steps'],
    ['payload parsing', /JSON\.parse/,
      'the relay must have no code path in which it could learn what it forwards'],
    ['a random source', /Math\.random/, 'non-negotiable #5'],
  ]);
  assert.deepEqual(hits, [],
    `relay.mjs must not be able to store or read anything: ${JSON.stringify(hits)}`);
  // The only node: modules it may have are the server socket and the handshake digest.
  const imports = [...src.matchAll(/from '(node:[^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['node:crypto', 'node:http', 'node:url']);
  // And the protocol constants come from one place, so the two halves cannot drift apart.
  assert.match(src, /from '\.\/runtime\/sync\/signalling\.js'/);
});

test('the mailbox path scheme has one definition, and anything else is a 404', () => {
  const mailbox = 'a'.repeat(64);
  assert.equal(mailboxUrl('ws://127.0.0.1:8787', mailbox), `ws://127.0.0.1:8787${MAILBOX_PATH_PREFIX}${mailbox}`);
  assert.equal(mailboxUrl('wss://relay.neodonkey.eu/', mailbox), `wss://relay.neodonkey.eu/b/${mailbox}`);
  assert.equal(mailboxFromPath(`/b/${mailbox}`), mailbox);
  assert.equal(mailboxFromPath(`/b/${mailbox}?x=1`), mailbox);
  for (const bad of ['/', '/b/', '/b/short', `/b/${'A'.repeat(64)}`, '/health', `/x/${mailbox}`, null]) {
    assert.equal(mailboxFromPath(/** @type {any} */ (bad)), null, `${bad} must not be a mailbox`);
  }
  assert.throws(() => mailboxUrl('https://relay.neodonkey.eu', mailbox), /must start with ws:\/\/ or wss:\/\//);
  assert.throws(() => mailboxUrl('', mailbox), /relay address is empty/);
  assert.throws(() => mailboxUrl('ws://x', 'nope'), /64 lower-case hex/);
  assert.match(mailbox, MAILBOX_ID_PATTERN);
  assert.equal(MAILBOX_CAPACITY, 2);
  assert.deepEqual(Object.keys(CONTROL), ['ready', 'gone', 'full']);
});

test('the relay has no verbs: a client that sends text is disconnected', async (t) => {
  const r = relay({ port: 0, quiet: true });
  t.after(() => r.close());
  const where = await r.listen();
  const base = `ws://${where.host}:${where.port}`;
  const mailbox = 'b'.repeat(64);

  // A single peer waits; nothing is stored for it, so the mailbox exists only while it is connected.
  const first = new WebSocket(mailboxUrl(base, mailbox));
  await new Promise((res) => { first.onopen = res; });
  assert.equal(r.stats().mailboxes, 1);
  assert.equal(r.stats().sockets, 1);

  const second = new WebSocket(mailboxUrl(base, mailbox));
  /** @type {any[]} */
  const control = [];
  await new Promise((res) => {
    second.onmessage = (ev) => { control.push(JSON.parse(ev.data)); res(); };
  });
  assert.deepEqual(control, [{ t: CONTROL.ready }], 'the only thing it decides, by counting to two');

  // A THIRD peer is refused by name rather than turned into a conference call.
  const third = new WebSocket(mailboxUrl(base, mailbox));
  const refusal = await new Promise((res) => { third.onclose = (ev) => res(ev.code); });
  assert.equal(refusal, CLOSE.mailboxFull);

  // A text frame from a client is a protocol error: there is no verb it could be.
  const closed = new Promise((res) => { second.onclose = (ev) => res(ev.code); });
  second.send('{"t":"give me the other peer\'s address"}');
  assert.equal(await closed, CLOSE.unsupportedData);

  // The health endpoint says what it is, and a mailbox is gone the moment its last socket closes.
  const health = await (await fetch(`http://${where.host}:${where.port}/health`)).json();
  assert.equal(health.service, 'neodonkey-relay');
  assert.equal(health.stores, 'nothing');
  assert.equal((await fetch(`http://${where.host}:${where.port}/nope`)).status, 404);

  first.close();
  await until(() => r.stats().mailboxes === 0, 'a mailbox exists only while a socket is open');
  assert.equal(r.stats().sockets, 0);
});

test('relaySocket resolves only when the PARTNER is there, and says why when it cannot', async (t) => {
  const r = relay({ port: 0, quiet: true });
  t.after(() => r.close());
  const where = await r.listen();
  const base = `ws://${where.host}:${where.port}`;
  const mailbox = 'c'.repeat(64);

  // The relay stores nothing, so a frame sent into an empty mailbox is gone. That is the one place
  // "stores nothing" constrains the client, and it is cheaper than a retention policy.
  let settled = false;
  const waiting = relaySocket({ url: mailboxUrl(base, mailbox), timers }).then((l) => { settled = true; return l; });
  // A GENUINE wall-clock wait, and the only kind this file allows: the assertion is a NEGATIVE —
  // "nothing happens" — and no signal can announce the absence of one. 150 ms is far longer than the
  // loopback round trip that would settle it if the relay were buffering.
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(settled, false, 'a lone peer must not believe it is connected');

  const partner = await relaySocket({ url: mailboxUrl(base, mailbox), timers });
  const first = await waiting;
  assert.equal(settled, true);

  // Bytes flow, byte for byte, in both directions.
  /** @type {Uint8Array[]} */
  const atFirst = [];
  first.onBytes((b) => atFirst.push(b));
  partner.send(new Uint8Array([1, 2, 3, 250]));
  await until(() => atFirst.length === 1, 'the relay must forward the bytes it was given');
  assert.deepEqual(atFirst, [new Uint8Array([1, 2, 3, 250])]);
  assert.ok(r.stats().framesForwarded >= 1);
  assert.ok(r.stats().bytesForwarded >= 4);

  // A third connection is refused with a message a human can act on.
  await assert.rejects(
    () => relaySocket({ url: mailboxUrl(base, mailbox), timers }),
    /that mailbox already has two peers/);

  // A mailbox nobody joins times out rather than hanging for ever.
  await assert.rejects(
    () => relaySocket({ url: mailboxUrl(base, 'd'.repeat(64)), timers, timeoutMs: 200 }),
    /no peer joined the mailbox within 200 ms/);

  // A path that is not a mailbox is not a mailbox.
  await assert.rejects(() => relaySocket({ url: `${base}/nonsense`, timers, timeoutMs: 500 }), SyncError);

  first.close();
  partner.close();
});

test('parseArgs refuses an unknown argument rather than ignoring it', () => {
  assert.deepEqual(parseArgs([]), { port: 8787, host: '127.0.0.1', quiet: false });
  assert.deepEqual(parseArgs(['--port', '9000', '--host', '0.0.0.0', '--quiet']),
    { port: 9000, host: '0.0.0.0', quiet: true });
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--verbose']), /unknown argument "--verbose"/);
  assert.throws(() => parseArgs(['--port', '70000']), /--port must be 0\.\.65535/);
  assert.throws(() => parseArgs(['--port', 'eight']), /--port must be 0\.\.65535/);
});

// =============================================================================================
// 2. two peers over the relay, in one process — the sealed session end to end
// =============================================================================================

test('two peers meet in a mailbox they derived from a QR code, and the relay cannot read a byte', async (t) => {
  const r = relay({ port: 0, quiet: true });
  t.after(() => r.close());
  const where = await r.listen();
  const base = `ws://${where.host}:${where.port}`;

  const sarah = await generateIdentity({ comment: 'sarah' });
  const klein = await generateIdentity({ comment: 'klein' });
  const introduction = await createIntroduction({
    identity: sarah, repoId: REPO_ID, relay: base, now: NOW, randomBytes: platformRandomBytes,
  });
  const { mailbox } = await rendezvousFrom(introduction.mailboxSecret);

  const [host, guest] = await Promise.all([
    connectRelay({
      relay: base, rendezvous: introduction.mailboxSecret, identity: sarah, role: 'host',
      // Sarah does not know Herr Klein's key yet — she is showing a QR code, not receiving one.
      // She LEARNS it from a hello only somebody who saw that code could have sealed.
      expectPeerKeyRaw: null, timers, timeoutMs: 8_000,
    }),
    connectRelay({
      relay: base, rendezvous: introduction.mailboxSecret, identity: klein, role: 'guest',
      // He does know hers: it was inside the signed payload he scanned.
      expectPeerKeyRaw: introduction.fields.signerRaw, timers, timeoutMs: 8_000,
    }),
  ]);

  assert.equal(host.mailbox, mailbox);
  assert.equal(guest.mailbox, mailbox);
  assert.deepEqual(host.peerIdentityRaw, await exportPublicRaw(klein));
  assert.deepEqual(guest.peerIdentityRaw, await exportPublicRaw(sarah));
  assert.equal(host.forwardSecrecy, true);
  assert.equal(guest.forwardSecrecy, true);

  // One connection, many documents, plus the Truth Layer — all over the same socket.
  const channel = liveChannel(NOTE.entity, NOTE.id);
  /** @type {string[]} */
  const live = [];
  /** @type {string[]} */
  const truth = [];
  guest.channels.channel(channel).onFrame((f) => live.push(f));
  guest.channels.channel(TRUTH_CHANNEL).onFrame((f) => truth.push(f));
  host.channels.channel(channel).send('[{"field":"deliveryDate"}]');
  host.channels.channel(TRUTH_CHANNEL).send('{"t":"refs?","n":1}');
  await until(() => live.length === 1 && truth.length === 1,
    'both muxed channels must arrive over the one socket');
  assert.deepEqual(live, ['[{"field":"deliveryDate"}]']);
  assert.deepEqual(truth, ['{"t":"refs?","n":1}']);
  assert.deepEqual(guest.channels.names().sort(), [TRUTH_CHANNEL, channel].sort());

  // What the relay learned: two sockets in one mailbox, a frame count and a byte count. Its own
  // accounting is the only record it has, and this is all of it.
  const learned = r.stats();
  assert.deepEqual(Object.keys(learned).sort(), ['bytesForwarded', 'framesForwarded', 'mailboxes', 'sockets']);
  assert.equal(learned.mailboxes, 1);
  assert.equal(learned.sockets, 2);
  assert.ok(learned.framesForwarded >= 4);
  assert.ok(learned.bytesForwarded > 0);

  // A peer leaving is forgotten immediately: the relay's whole memory of a connection is the socket.
  host.close();
  await until(() => r.stats().sockets === 1, 'the relay must forget a peer when its socket closes');
  assert.equal(r.stats().mailboxes, 1, 'the mailbox survives while one peer is still in it');
  guest.close();
  await until(() => r.stats().mailboxes === 0, 'and is deleted when the last one leaves');
  assert.equal(r.stats().sockets, 0);
});

// =============================================================================================
// 3. THE GATE ITEM: two processes, then a destroyed laptop
// =============================================================================================

/** The peer program the two child processes run. Written once, spawned three times. */
const PEER_PROGRAM = `
import { readFile } from 'node:fs/promises';
import { nodeFs } from '${REPO_ROOT}runtime/git/fs-node.js';
import { repo } from '${REPO_ROOT}runtime/git/repo.js';
import { importPrivateJwk } from '${REPO_ROOT}runtime/identity/ed25519.js';
import { connectRelay } from '${REPO_ROOT}runtime/sync/signalling.js';
import {
  TRUTH_CHANNEL, liveChannel, platformRandomBytes, hex, unhex,
} from '${REPO_ROOT}runtime/sync/sealed.js';
import { gitPeer } from '${REPO_ROOT}runtime/sync/gitsync.js';
import { readIntroduction, seenStore } from '${REPO_ROOT}runtime/sync/introduce.js';
import { fsKvStore, opBuffer } from '${REPO_ROOT}runtime/sync/opbuffer.js';
import { session } from '${REPO_ROOT}runtime/live/session.js';

const o = JSON.parse(process.argv[2]);
const timers = { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) };
const identity = await importPrivateJwk(JSON.parse(await readFile(o.jwkPath, 'utf8')));
const fs = nodeFs(o.dir);
const r = repo(fs);

// The guest arrives holding nothing but a scanned string. Everything it needs to reach the other
// peer comes out of that string, and the replay guard that makes it single-use is on disk.
let relayAddress = o.relay;
let rendezvous;
let expectPeerKeyRaw = null;
if (o.role === 'guest') {
  const scanned = await readIntroduction(o.introduction, {
    now: o.now,
    expectRepo: o.repoId,
    expectSigner: o.expectSignerHex ? unhex(o.expectSignerHex) : null,
    seen: seenStore(fsKvStore(fs)),
  });
  relayAddress = scanned.relay;
  rendezvous = scanned.rendezvous;
  expectPeerKeyRaw = scanned.signerRaw;
  if (!scanned.replayChecked) throw new Error('peer: the replay guard did not run');
} else {
  rendezvous = unhex(o.rendezvousHex);
}

const conn = await connectRelay({
  relay: relayAddress, rendezvous, identity, role: o.role,
  expectPeerKeyRaw, randomBytes: platformRandomBytes, timers, timeoutMs: 20000,
});

// --- the Truth Layer -------------------------------------------------------------------------
const peer = gitPeer({
  link: conn.channels.channel(TRUTH_CHANNEL), repo: r, fs, peerId: o.peerId,
  onError: (err) => { process.stderr.write('git sync: ' + err.message + '\\n'); },
});

// --- the Live Layer, on the same socket ------------------------------------------------------
const NOTE = ${JSON.stringify(NOTE)};
let clock = o.clockStart;
const doc = session(NOTE, o.nodeId, () => (clock += 1));
const liveLink = conn.channels.channel(liveChannel(NOTE.entity, NOTE.id));
liveLink.onFrame((frame) => doc.receive(JSON.parse(frame)));
doc.onLocalOps((ops) => liveLink.send(JSON.stringify(ops)));
const buffer = opBuffer({ kv: fsKvStore(fs), now: () => o.now });
buffer.track(doc, { baseDoc: NOTE });
doc.set(o.field, o.value);

// --- convergence, by SIGNAL and not by clock ---------------------------------------------------
//
// The first version of this program resent its op set on a 60 ms timer and the other side waited a
// generous number of those ticks. That is what made the test flaky and slow: under load the guest's
// packfile fetch outlasted the host's patience, the host exited holding only its own op, and the
// convergence assertion failed — on the network's schedule, not on the protocol's. A red bar that
// means "run it again" is worse than a red bar.
//
// So the two peers hand-shake instead. Each sends its op set once, ON the control channel, and
// acknowledges the set it receives. A peer is finished when (a) it has seen the other's ops and
// (b) the other has acknowledged its own. No timer is on the success path; the only wall-clock
// number left is a watchdog whose sole job is to fail rather than hang.
const control = conn.channels.channel('control');
let sawPeerOps = false;
let myOpsAcked = false;
/** @type {() => void} */
let markReady = () => {};
const bothConverged = new Promise((res) => { markReady = res; });
const check = () => { if (sawPeerOps && myOpsAcked) markReady(); };
control.onFrame((frame) => {
  const msg = JSON.parse(frame);
  if (msg.t === 'ops') {
    doc.receive(msg.ops);
    sawPeerOps = true;
    control.send(JSON.stringify({ t: 'ack' }));
  } else if (msg.t === 'ack') {
    myOpsAcked = true;
  } else {
    throw new Error('peer: unknown control verb ' + JSON.stringify(msg.t));
  }
  check();
});

let fetched = null;
if (o.fetch) fetched = await peer.fetch();

// Sent AFTER the fetch, which is what lets the other side stay alive exactly as long as the fetch
// takes and not one tick longer — the host no longer has to guess how slow the machine is.
control.send(JSON.stringify({ t: 'ops', ops: doc.ops() }));

await Promise.race([
  bothConverged,
  new Promise((_, rej) => setTimeout(
    () => rej(new Error(
      'peer ' + o.role + ': no convergence within ' + o.watchdogMs + ' ms'
      + ' (sawPeerOps=' + sawPeerOps + ', myOpsAcked=' + myOpsAcked + ')')), o.watchdogMs)),
]);

process.stdout.write('RESULT ' + JSON.stringify({
  role: o.role,
  head: await r.head(),
  fetched,
  ops: doc.ops(),
  snapshot: doc.snapshot(),
  peerKey: hex(conn.peerIdentityRaw),
  mailbox: conn.mailbox,
  forwardSecrecy: conn.forwardSecrecy,
  stats: conn.stats(),
  buffered: await buffer.pending(),
}) + '\\n');
conn.close();
process.exit(0);
`;

/** Start the real relay as a program and wait until it says where it is listening. */
async function startRelayProcess() {
  const child = spawn(process.execPath, [join(REPO_ROOT, 'relay.mjs'), '--port', '0'], {
    cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const url = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`relay.mjs did not start:\n${out}\n${err}`)), 10_000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /neodonkey relay on (ws:\/\/\S+)/.exec(out);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    child.on('error', rej);
  });
  return {
    url,
    child,
    log: () => out,
    stderr: () => err,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((res) => child.on('exit', res));
    },
  };
}

/**
 * A directory for the test's own fixtures — the peer program and the key files.
 *
 * Deliberately NOT inside any company folder: `git status --porcelain` in a recovered company must
 * print nothing, and a test that leaves `peer.mjs` next to `documents/` would be asserting against
 * its own litter. (It did, once. This is the fix.)
 */
const scriptDir = tempDir('fixtures');
const PEER_SCRIPT = join(scriptDir, 'peer.mjs');

/**
 * The watchdog every peer process carries, and the parent's own patience.
 *
 * Neither number is on a success path: the handshake in PEER_PROGRAM is signal-driven, so a healthy
 * run finishes as fast as the machine can spawn Node and move a packfile. These exist so that a
 * BROKEN run fails with a diagnosis instead of stalling the suite for fourteen minutes.
 */
const PEER_WATCHDOG_MS = 20_000;
const PEER_KILL_MS = 40_000;

/** Run one peer program to completion and return its parsed RESULT plus its output. */
function runPeer(dir, options) {
  const script = PEER_SCRIPT;
  writeFileSync(script, PEER_PROGRAM);
  return new Promise((res, rej) => {
    const child = spawn(process.execPath,
      [script, JSON.stringify({ watchdogMs: PEER_WATCHDOG_MS, ...options })], { cwd: dir });
    spawnedPeers.add(child);
    let out = '';
    let err = '';
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Error(`peer ${options.role} did not finish within ${PEER_KILL_MS} ms`
        + `\nSTDOUT:\n${out}\nSTDERR:\n${err}`));
    }, PEER_KILL_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(killer); rej(e); });
    child.on('exit', (code) => {
      clearTimeout(killer);
      spawnedPeers.delete(child);
      const m = /^RESULT (.*)$/m.exec(out);
      if (code !== 0 || !m) {
        rej(new Error(`peer ${options.role} exited ${code}\nSTDOUT:\n${out}\nSTDERR:\n${err}`));
        return;
      }
      res({ result: JSON.parse(m[1]), stdout: out, stderr: err });
    });
  });
}

test('two processes converge through the relay, and a destroyed company is recovered',
  { timeout: 120_000 }, async (t) => {
  // ---- the world ---------------------------------------------------------------------------
  const relayProcess = await startRelayProcess();
  t.after(() => relayProcess.stop());
  t.after(() => { for (const c of spawnedPeers) c.kill('SIGKILL'); });

  const sarahDir = tempDir('sarah');
  const kleinDir = tempDir('klein');
  const sarahFs = nodeFs(sarahDir);
  const kleinFs = nodeFs(kleinDir);
  await initRepo(sarahFs);
  await initRepo(kleinFs);
  const { head: companyHead, expected } = await commitEvents(repo(sarahFs), 12);
  assert.equal(await repo(kleinFs).head(), null);

  const sarah = await generateIdentity({ comment: 'sarah' });
  const klein = await generateIdentity({ comment: 'klein' });
  const sarahJwk = join(scriptDir, 'sarah.jwk.json');
  const kleinJwk = join(scriptDir, 'klein.jwk.json');
  writeFileSync(sarahJwk, JSON.stringify(await exportPrivateJwk(sarah)));
  writeFileSync(kleinJwk, JSON.stringify(await exportPrivateJwk(klein)));

  // Day 3. Sarah clicks "Add peer" and a QR code appears. This string IS the QR code.
  const introduction = await createIntroduction({
    identity: sarah, repoId: REPO_ID, relay: relayProcess.url, now: NOW,
    ttlMs: 15 * 60 * 1000, randomBytes: platformRandomBytes,
  });
  assert.ok(introduction.text.length < 321, 'and it still fits one scan with a real relay address');

  // ---- Herr Klein scans it, in another process ---------------------------------------------
  const [hostRun, guestRun] = await Promise.all([
    runPeer(sarahDir, {
      role: 'host', dir: sarahDir, jwkPath: sarahJwk, relay: relayProcess.url,
      rendezvousHex: hex(introduction.mailboxSecret), repoId: REPO_ID,
      nodeId: 'sarah', clockStart: 1_000, field: 'deliveryDate', value: '15.11.',
      peerId: 'klein', fetch: false, now: NOW + 1_000,
    }),
    runPeer(kleinDir, {
      role: 'guest', dir: kleinDir, jwkPath: kleinJwk, introduction: introduction.text,
      repoId: REPO_ID, expectSignerHex: hex(introduction.fields.signerRaw),
      nodeId: 'klein', clockStart: 5_000, field: 'notes', value: 'Ware unvollständig',
      peerId: 'sarah', fetch: true, now: NOW + 1_000,
    }),
  ]);
  const host = hostRun.result;
  const guest = guestRun.result;

  // ---- they found each other, and they know who the other is -------------------------------
  assert.equal(host.mailbox, guest.mailbox);
  assert.equal(host.peerKey, hex(await exportPublicRaw(klein)));
  assert.equal(guest.peerKey, hex(await exportPublicRaw(sarah)));
  assert.equal(host.forwardSecrecy, true);
  assert.equal(guest.forwardSecrecy, true);
  assert.equal(host.stats.undecryptable, 0);
  assert.equal(guest.stats.undecryptable, 0);

  // ---- THE LIVE LAYER CONVERGED ACROSS TWO PROCESSES ---------------------------------------
  // `converged()` is byte-identical op sets. Two separate operating-system processes, two separate
  // module instances, one document.
  assert.deepEqual(guest.ops, host.ops,
    'two processes must hold byte-identical op sets — this is converged(), across a process boundary');
  assert.deepEqual(guest.snapshot, host.snapshot);
  assert.equal(host.snapshot.deliveryDate, '15.11.');
  assert.equal(host.snapshot.notes, 'Ware unvollständig');
  assert.equal(host.ops.length, 2, 'one op each, both surviving — Appendix XI\'s 95% case');

  // ---- THE TRUTH LAYER: one packfile, twelve commits ---------------------------------------
  assert.equal(host.head, companyHead);
  assert.equal(guest.fetched.status, 'received');
  assert.equal(guest.fetched.peerHead, companyHead);
  assert.equal(guest.head, companyHead);
  assert.ok(guest.fetched.objects >= 12, `expected the whole company, got ${guest.fetched.objects} objects`);
  assert.ok(guest.fetched.packBytes > 0);

  await repo(kleinFs).checkout();
  assert.equal(git(kleinDir, 'fsck', '--strict').trim(), '');
  assert.equal(git(kleinDir, 'status', '--porcelain'), '',
    'a fetched company folder must be clean — including the live-op buffer inside .git/');
  assert.equal(git(kleinDir, 'rev-parse', 'HEAD').trim(), companyHead);
  assert.equal(git(kleinDir, 'log', '--format=%s').trim().split('\n').length, 12);
  for (const [path, body] of expected) {
    assert.equal(git(kleinDir, 'show', `HEAD:${path}`), body, `${path} must arrive byte-identical`);
  }

  // ---- what the relay printed ---------------------------------------------------------------
  const log = relayProcess.log();
  const lines = log.trim().split('\n').filter((l) => !l.startsWith('neodonkey relay on'));
  assert.ok(lines.length >= 3, `expected join/join/leave lines, got:\n${log}`);
  for (const line of lines) {
    assert.match(line, /^(join|leave|refused) [0-9a-f]{8}… \((\d\/2|already \d peers)\)?$/,
      `the relay printed something other than a mailbox event: ${JSON.stringify(line)}`);
  }
  // Nothing a company would mind an operator reading. Checked against the actual content that
  // crossed the wire, not against a list of guesses.
  for (const secret of ['Müller', 'RE-2027', 'gross-amount', '499.99', 'invoice', 'LS-2027-0033',
    'deliveryDate', 'notes', 'refs', 'pack', REPO_ID, companyHead,
    hex(await exportPublicRaw(sarah)), hex(await exportPublicRaw(klein)),
    hex(introduction.mailboxSecret), introduction.text]) {
    assert.equal(log.includes(secret), false,
      `the relay's own log contains ${JSON.stringify(secret)} — it is meant to see nothing`);
  }
  // Not even the whole mailbox id: eight characters, enough to correlate two sockets and no more.
  assert.equal(log.includes(host.mailbox), false);
  assert.equal(log.includes(host.mailbox.slice(0, 8)), true);
  assert.equal(relayProcess.stderr(), '');

  // The mailbox is gone. The relay is holding nothing at all.
  const health = await untilHealth(
    relayProcess.url.replace('ws://', 'http://'),
    (h) => h.mailboxes === 0 && h.sockets === 0,
    'the relay must be holding nothing once both peers have gone');
  assert.equal(health.stores, 'nothing');

  // ---- IF SARAH'S LAPTOP FALLS INTO THE SEA -------------------------------------------------
  // "Anna still has everything. Herr Klein too. The company continues. Sarah buys a new laptop,
  //  clones Anna's repo, generates a NEW key pair (the old one gone with the laptop)."
  rmSync(sarahDir, { recursive: true, force: true });
  assert.equal(existsSync(sarahDir), false, 'the laptop is gone, bytes and key and all');

  const newLaptopDir = tempDir('sarah-new');
  const newSarah = await generateIdentity({ comment: 'sarah-new-laptop' });
  const newJwk = join(scriptDir, 'sarah-new.jwk.json');
  writeFileSync(newJwk, JSON.stringify(await exportPrivateJwk(newSarah)));
  const newFs = nodeFs(newLaptopDir);
  await initRepo(newFs);
  assert.notDeepEqual(await exportPublicRaw(newSarah), await exportPublicRaw(sarah),
    'the old key went into the sea with the laptop');

  // This time HERR KLEIN shows the QR code, and Sarah's new laptop scans it. A new introduction
  // means a new rendezvous secret and therefore a new mailbox — the old one is not reusable.
  const reIntroduction = await createIntroduction({
    identity: klein, repoId: REPO_ID, relay: relayProcess.url, now: NOW + 86_400_000,
    randomBytes: platformRandomBytes,
  });
  assert.notEqual(
    (await rendezvousFrom(reIntroduction.mailboxSecret)).mailbox,
    (await rendezvousFrom(introduction.mailboxSecret)).mailbox);

  const [kleinAgain, sarahAgain] = await Promise.all([
    runPeer(kleinDir, {
      role: 'host', dir: kleinDir, jwkPath: kleinJwk, relay: relayProcess.url,
      rendezvousHex: hex(reIntroduction.mailboxSecret), repoId: REPO_ID,
      nodeId: 'klein', clockStart: 20_000, field: 'notes', value: 'Ware unvollständig',
      peerId: 'sarah-new', fetch: false, now: NOW + 86_401_000,
    }),
    runPeer(newLaptopDir, {
      role: 'guest', dir: newLaptopDir, jwkPath: newJwk, introduction: reIntroduction.text,
      repoId: REPO_ID, expectSignerHex: hex(reIntroduction.fields.signerRaw),
      nodeId: 'sarah-new', clockStart: 30_000, field: 'deliveryDate', value: '15.11.',
      peerId: 'klein', fetch: true, now: NOW + 86_401_000,
    }),
  ]);

  assert.equal(sarahAgain.result.fetched.status, 'received');
  assert.equal(sarahAgain.result.head, companyHead, 'the company is back, to the commit');
  assert.equal(kleinAgain.result.peerKey, hex(await exportPublicRaw(newSarah)),
    'and Herr Klein is talking to the NEW key, not the drowned one');

  await repo(newFs).checkout();
  assert.equal(git(newLaptopDir, 'fsck', '--strict').trim(), '',
    'a recovered company must be a valid repository, according to git');
  assert.equal(git(newLaptopDir, 'status', '--porcelain'), '',
    'Appendix X: it is simply a folder, with her company inside');
  assert.equal(git(newLaptopDir, 'rev-parse', 'HEAD').trim(), companyHead);
  assert.equal(git(newLaptopDir, 'log', '--format=%s').trim().split('\n').length, 12);
  for (const [path, body] of expected) {
    assert.equal(git(newLaptopDir, 'show', `HEAD:${path}`), body,
      `${path} must come back byte-identical after the laptop was destroyed`);
  }
  // No backups, no restore procedure — the other peer WAS the backup.
  assert.equal(existsSync(join(newLaptopDir, 'documents/invoice/RE-2027-0012.json')), true);
});

test('a replayed introduction is refused by the second process that tries it',
  { timeout: 90_000 }, async (t) => {
  // The other half of "an introduction an attacker can forge is a peer they can insert": one that
  // is redeemed twice. The guard is on disk, so this is a property of the PROGRAM, not of a session.
  const relayProcess = await startRelayProcess();
  t.after(() => relayProcess.stop());
  t.after(() => { for (const c of spawnedPeers) c.kill('SIGKILL'); });
  const dir = tempDir('replay');
  const hostDir = tempDir('replay-host');
  await initRepo(nodeFs(dir));
  await initRepo(nodeFs(hostDir));
  const sarah = await generateIdentity();
  const klein = await generateIdentity();
  const jwk = join(scriptDir, 'k.jwk.json');
  const hostJwkPath = join(scriptDir, 's.jwk.json');
  writeFileSync(jwk, JSON.stringify(await exportPrivateJwk(klein)));
  writeFileSync(hostJwkPath, JSON.stringify(await exportPrivateJwk(sarah)));
  const introduction = await createIntroduction({
    identity: sarah, repoId: REPO_ID, relay: relayProcess.url, now: NOW,
    randomBytes: platformRandomBytes,
  });

  const guestArgs = {
    role: 'guest', dir, jwkPath: jwk, introduction: introduction.text, repoId: REPO_ID,
    expectSignerHex: hex(introduction.fields.signerRaw), nodeId: 'klein', clockStart: 1_000,
    field: 'notes', value: 'first use', peerId: 'sarah', fetch: true, now: NOW + 1_000,
  };
  await Promise.all([
    runPeer(hostDir, {
      role: 'host', dir: hostDir, jwkPath: hostJwkPath, relay: relayProcess.url,
      rendezvousHex: hex(introduction.mailboxSecret), repoId: REPO_ID, nodeId: 'sarah',
      clockStart: 9_000, field: 'deliveryDate', value: '15.11.', peerId: 'klein',
      fetch: false, now: NOW + 1_000,
    }),
    runPeer(dir, guestArgs),
  ]);

  // The same QR code, photographed and used again the next morning.
  await assert.rejects(
    () => runPeer(dir, { ...guestArgs, value: 'second use' }),
    /already been used — an introduction is single use/);
});
