// test/wired.test.js — no orphans. Every module under runtime/ is either reachable from something
// that runs, or explicitly declared unfinished.
//
// Why this exists. Wave 2 was interrupted with six agents mid-flight, leaving thirteen modules that
// all *loaded* cleanly, were mostly unreferenced, and mostly untested. That is the worst state a
// repository can be in: a reviewer who clones it sees `runtime/sync/webrtc.js` and concludes peer
// sync exists. Orphaned code that looks finished is not neutral — it is a claim.
//
// So the rule is: a module is either wired in, or named below as unfinished. There is no third
// state where nobody has decided. This is the same deny-by-default discipline the release signer
// uses for files it cannot classify (release/sign-release.mjs), applied to the runtime itself.
//
// To finish a module: wire it in and delete its line here. To abandon one: delete the file.
// Adding a line is a decision that shows up in a diff, which is the point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * Modules that exist but are not yet reachable from anything that runs.
 *
 * Every entry states what it is for and what remains, because "unfinished" without a note is
 * indistinguishable from "forgotten". These are Wave 2 work, interrupted deliberately, and each is
 * category *real work* in docs/COMPROMISES.md terms — not *our shortfall*, because nothing here is
 * a defect in shipped behaviour. Nothing in this list may be described as working, anywhere.
 */
const UNFINISHED = {
  // KEPT, deliberately, after the rest of runtime/sync/ was finished (agent SYNC, Wave 2). The
  // adapter itself is exercised frame by frame against a fake channel, and connectWebrtc's whole
  // offer/answer/ICE sequence runs against an injected fake RTCPeerConnection — two Live-Layer
  // sessions converge across it and `converged()` says so (test/sync-webrtc.test.js, 11 tests).
  // What NO test in Node can execute is the part that decides whether WebRTC works at all: real
  // ICE, real DTLS, real SCTP, real NAT traversal. So Appendix III's "directly over LAN when in the
  // same network" is NOT demonstrated, and this file must not be described as working. What IS
  // demonstrated between two operating-system processes is the relay data path, which needs no
  // WebRTC: test/sync-relay.test.js. Closing this entry needs a browser, not more code.
  'runtime/sync/webrtc.js':
    'WebRTC adapter for the PeerLink interface. Exercised only against an injected fake — Node has '
    + 'no RTCPeerConnection, so real ICE, DTLS, SCTP and NAT traversal are UNEXECUTED and no '
    + 'browser has ever run this file. Gate item 4 is met over the relay (test/sync-relay.test.js, '
    + 'two processes), NOT over a direct LAN connection. Needs a browser to close.',
};

// Delisted 2026-08-04 by agent SYNC, with what proves each one:
//
//   runtime/sync/sealed.js      test/sync-sealed.test.js — the handshake and its tamper matrix, and
//                               a hostile relay that records every byte and can read none of them.
//   runtime/sync/signalling.js  test/sync-relay.test.js — two Node processes discover each other in
//                               a mailbox derived from a QR code and exchange sealed frames through
//                               a real `node relay.mjs`.
//   relay.mjs                   same file: "sees nothing, decides nothing, stores nothing" is
//                               checked against its source, its verbs and its actual stdout.
//   runtime/sync/gitsync.js     test/sync-gitsync.test.js — a peer twelve commits behind receives
//                               ONE packfile and `git fsck --strict` calls the result clean.
//   runtime/sync/introduce.js   test/sync-introduce.test.js — the full tamper matrix, every bit of
//                               every byte, plus replay, expiry and key pinning. The QR code is
//                               still not RENDERED or SCANNED by any UI: that is COMPROMISES #4.
//   runtime/sync/opbuffer.js    test/sync-opbuffer.test.js — a child process types, dies, and the
//                               op set comes back byte-identical; `git status` stays empty.
//
// Delisted 2026-08-04 by agent ATOM, with what proves each one:
//
//   runtime/truth/reservation.js  test/atom-reservation.test.js — Appendix VIII's own scenario, in
//                                 BOTH logical orders: Berlin selling 5 of the last 5 while Munich
//                                 sells 3. Exactly one succeeds, the loser is told which claim beat
//                                 it, and when the later claim is Berlin's own it is voided by a
//                                 storno that is a real signed commit — `git log` shows it,
//                                 `git fsck --strict` is clean and real `ssh-keygen` verifies it.
//                                 Also: lease expiry (the units become claimable again and the
//                                 abandoned reservation can never be redeemed), stock never
//                                 negative under eleven interleaved claims, and the audit that
//                                 catches a peer which ignored the protocol.
//   runtime/truth/authority.js    test/atom-authority.test.js — the election: the authority
//                                 disappears mid-transaction and the remaining majority elects a
//                                 successor that keeps every claim the old majority granted; a
//                                 partitioned MINORITY does not elect itself; a split vote elects
//                                 nobody; one vote per peer per term; a deposed authority may not
//                                 grant. The quorum evidence is signed with real Ed25519 keys and
//                                 verified in its own SSHSIG namespace. The split-brain that
//                                 CANNOT be prevented — two committed declarations of one resource,
//                                 each with its own real majority — is demonstrated, not described.
//   FD-6 cross-peer (#19)         test/atom-numbering.test.js — a number is issued only after a
//                                 majority acks it, and #19's own sentence ("two peers ... will
//                                 both issue number 7 while disconnected") is run: number 7 comes
//                                 out ONCE. An offline peer issues nothing and queues, which is the
//                                 honest answer; the queue drains in order once the peer may issue.
//
// What is NOT closed by those tests, and lives in COMPROMISES #4/#6/#19 rather than here: none of
// it has run over a real network (the transport is the loopback `PeerLink`), and `runtime/kernel.js`
// still calls `assertAuthoritative(decl, nodeId)` with two arguments, so the shipped single-peer
// behaviour is unchanged until the kernel is given an authority member.
//
// Only `runtime/sync/webrtc.js` remains, above, and its note says exactly why.

/** Files whose job is to be imported by a browser only, or by nothing but their own tests. */
const EXEMPT = new Set([
  'runtime/git/fs-opfs.js',   // browser-only adapter; verified against real OPFS by agent G
  'runtime/git/mesh.js',      // FD-3 foundation; consolidation is Wave 3, tested standalone
]);

function runtimeModules() {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(new URL(`../${rel}`, import.meta.url), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk('runtime');
  return out;
}

/** Everything that could reference a module: other runtime code, tests, and the entry points. */
/**
 * Resolve every import in every source file to a repo-relative path, so that a relative specifier
 * (`./groups.js` inside `runtime/crypto/`) is recognised as a reference to `runtime/crypto/groups.js`.
 *
 * The first version of this guard matched on substrings and produced two false findings: it called
 * `crypto/groups.js` an orphan because its importer says `./groups.js`, and it called
 * `sync/signalling.js` wired-in because another *unfinished* module imports it. Resolving properly
 * is the difference between a guard that is trusted and one that is disabled.
 *
 * @returns {Map<string, Set<string>>} importer -> set of repo-relative modules it imports
 */
function importGraph() {
  const roots = ['runtime', 'test', 'mcp', 'demo', 'release'];
  const files = [];
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(new URL(`../${rel}`, import.meta.url), { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(e.name)) files.push(p);
    }
  };
  for (const r of roots) walk(r);
  for (const f of ['service-worker.js', 'serve.mjs', 'relay.mjs']) {
    try { statSync(new URL(`../${f}`, import.meta.url)); files.push(f); } catch { /* absent */ }
  }

  /** Collapse `a/b/../c` to `a/c` without touching the filesystem. */
  const normalise = (path) => {
    const out = [];
    for (const part of path.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') out.pop(); else out.push(part);
    }
    return out.join('/');
  };

  const graph = new Map();
  for (const file of files) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const dir = file.split('/').slice(0, -1).join('/');
    const targets = new Set();
    // static imports, re-exports, and dynamic import() — enough for this codebase, which has no
    // computed specifiers anywhere (a rule worth keeping).
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;         // no bare specifiers: zero dependencies
      targets.add(normalise(`${dir}/${spec}`));
    }
    // index.html and service-worker.js name shell files as plain strings, not imports.
    for (const m of text.matchAll(/['"](runtime\/[\w./-]+\.js)['"]/g)) targets.add(normalise(m[1]));
    graph.set(file, targets);
  }
  return graph;
}

test('every runtime module is either wired in or declared unfinished — no silent orphans', () => {
  const modules = runtimeModules();
  const graph = importGraph();
  assert.ok(modules.length > 30, `expected the runtime, found ${modules.length} modules`);

  const importedBy = (mod) => [...graph.entries()]
    .filter(([file, targets]) => file !== mod && targets.has(mod)).map(([file]) => file);

  const orphans = [];
  for (const mod of modules) {
    if (EXEMPT.has(mod) || mod in UNFINISHED) continue;
    if (importedBy(mod).length === 0) orphans.push(mod);
  }

  assert.deepEqual(orphans, [],
    'these modules are imported by nothing and are not declared unfinished. Wire them in, delete '
    + 'them, or add them to UNFINISHED with a note saying what remains — but do not leave code in '
    + 'the tree that a reader would mistake for a working feature.');
});

test('the unfinished list contains no module the product actually depends on', () => {
  const graph = importGraph();
  const unfinished = new Set(Object.keys(UNFINISHED));

  // "The product depends on it" means: imported by something that is neither a test nor itself
  // unfinished. A cluster of unfinished modules importing each other is still unfinished — that
  // distinction is what the first version of this test got wrong.
  const stale = [];
  for (const mod of unfinished) {
    const realUsers = [...graph.entries()].filter(([file, targets]) =>
      file !== mod && targets.has(mod) && !file.startsWith('test/') && !unfinished.has(file));
    if (realUsers.length) stale.push(`${mod} <- ${realUsers.map(([f]) => f).join(', ')}`);
  }
  assert.deepEqual(stale, [],
    'these are now depended on by shipping code, so either finish and delist them, or the '
    + 'dependency is a mistake. Also check that COMPROMISES.md no longer calls the gate item unmet.');
});

test('every unfinished module still parses and loads, so the tree is never broken', async () => {
  for (const mod of Object.keys(UNFINISHED)) {
    await assert.doesNotReject(
      () => import(new URL(`../${mod}`, import.meta.url).href),
      `${mod} does not load — an unfinished module may be unwired, but never broken`);
  }
});

test('each unfinished entry says what remains, not merely that it is unfinished', () => {
  for (const [mod, note] of Object.entries(UNFINISHED)) {
    assert.ok(note.length > 40, `${mod}: the note must say what remains`);
  }
});
