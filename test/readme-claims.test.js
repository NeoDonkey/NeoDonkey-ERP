// test/readme-claims.test.js — Verifying the 4 headline status claims from README.md.
//
// The 4 claims closed since v0.1:
//   1. Operations no rule governs are now refused (strict authorization default-deny, FD-7).
//   2. A caller's roles are the intersection of what it claims and what the repository records
//      (effective roles = claimed ∩ recorded, FD-9), so actorRoles is no longer a self-declaration.
//   3. The general ledger posts double-entry with the balance as a structural invariant.
//   4. Two processes have converged through a relay and recovered a company after one was destroyed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { memFs } from '../runtime/git/fs.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { generateIdentity, exportPublicSsh, exportPrivateJwk, exportPublicRaw } from '../runtime/identity/ed25519.js';
import { open } from '../runtime/kernel.js';
import { evaluate } from '../runtime/polism/execute.js';
import { parseOperatingModel } from '../runtime/polism/parse.js';
import { relay } from '../relay.mjs';
import { createIntroduction } from '../runtime/sync/introduce.js';
import { platformRandomBytes, hex } from '../runtime/sync/sealed.js';
import { canonicalManifestBytes, verifyRelease, RELEASE_NAMESPACE } from '../runtime/release/manifest.js';
import { memoryStore, pinKey, gateRelease } from '../runtime/release/pin.js';
import { signPayload } from '../runtime/identity/sshsig.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const enc = new TextEncoder();
const AUTHOR = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' };
const NOW = 1_780_000_000_000;
const REPO_ID = 'sarah-erp';
const NOTE = {
  id: 'LS-2027-0033', entity: 'delivery-note', status: 'draft', deliveryDate: '12.11.', notes: '',
};

function fixedClock() {
  let t = Date.parse('2027-11-03T09:00:00Z');
  return () => (t += 60_000);
}

function realOperatingModel() {
  const root = new URL('../operating-model/', import.meta.url);
  const seed = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(new URL(rel, root), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        seed.set(`operating-model/${rel}${e.name}`, readFileSync(new URL(`${rel}${e.name}`, root), 'utf8'));
      }
    }
  };
  walk('');
  return seed;
}

const tempDirs = [];
function tempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `nd-readme-${tag}-`));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
});

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: cwd },
  });
}

// =============================================================================================
// Claim 1: Operations no rule governs are now refused (FD-7 default-deny)
// =============================================================================================

test('README Claim 1: operations no rule governs are refused when strict authorization is enabled', async () => {
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const seed = new Map([
    ['operating-model/information/gadget.md', '# Gadget\n\nSome unmentioned item.\n\n## Fields\n- name: text required\n'],
  ]);
  const nd = await open({
    fs: memFs(),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair },
    seed, clock: fixedClock(), strictAuthorization: true,
  });

  const res = await nd.perform({
    op: 'create', entity: 'gadget', id: 'G-1',
    doc: { entity: 'gadget', id: 'G-1', name: 'Widget' },
  });

  assert.ok(res.rejected, 'An operation governed by no rule or authority must be refused in strict mode');
  const code = res.rejected[0].code;
  assert.equal(code, 'not-authorized-by-anything');
  assert.match(res.rejected[0].reason, /workspace runs with strict authorization/);
});

// =============================================================================================
// Claim 2: A caller\'s roles are the intersection of what it claims and what the repository records (FD-9)
// =============================================================================================

test('README Claim 2: actorRoles is grounded by the repository record (claimed ∩ recorded)', async () => {
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const seed = realOperatingModel();
  const nd = await open({
    fs: memFs(),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair },
    seed, clock: fixedClock(),
    roles: ['warehouse-clerk'], // Sarah holds ONLY warehouse-clerk
  });

  // Attempt self-declaration of managing-director role
  const attack = await nd.perform({
    op: 'create', entity: 'goods-receipt', id: 'GR-1001',
    doc: {
      entity: 'goods-receipt', id: 'GR-1001',
      quantity: 12, 'delivered-quantity': 12,
      order: 'PO-2027-0001', 'order-line': 'PO-2027-0001-1',
      article: 'cashewkerne-natur-1kg', location: 'berlin-main-warehouse',
      'batch-number': 'L-1', 'best-before-date': '2028-10-31',
      'delivery-note-reference': 'LS-1', 'packaging-intact': true,
      'receipt-date': '2027-11-03', 'received-by': 'SHA256-AB12CD34',
    },
    actorRoles: ['managing-director'], // Escalation claim
  });

  assert.ok(attack.rejected, 'Self-declared role escalation must be refused');
  assert.equal(attack.rejected[0].code, 'roles-not-held');
  assert.match(attack.rejected[0].reason, /managing-director/);

  // Omitting actorRoles defaults to recorded roles
  const mine = nd.myRoles();
  assert.deepEqual(mine.roles, ['warehouse-clerk']);
  assert.equal(mine.recorded, true);
});

// =============================================================================================
// Claim 3: General ledger posts double-entry with the balance as a structural invariant
// =============================================================================================

test('README Claim 3: general ledger posts double-entry with the balance as a structural invariant', async () => {
  const seed = realOperatingModel();
  const parsed = parseOperatingModel(seed);
  assert.equal(parsed.errors.filter((e) => e.severity === 'error').length, 0);

  const jeDef = parsed.model.entities.get('journal-entry');
  assert.ok(jeDef, 'journal-entry entity must exist');
  assert.ok(jeDef.invariants.has('debits equal credits'), 'debits equal credits invariant must be declared');

  // Evaluate an unbalanced journal entry
  const unbalancedJE = {
    id: 'JE-RT-0001', entity: 'journal-entry',
    'entry-number': 'JE-RT-0001', 'entry-date': '2027-11-03', 'document-date': '2027-11-03',
    'accounting-period': '2027-11', chart: 'skr03', currency: 'EUR',
    'debit-amount': '5949.99 EUR', 'credit-amount': '5949.99 EUR', 'posting-count': 2,
    description: 'Sales invoice R-2027-0001', 'source-document-type': 'sales-invoice',
    'source-document-reference': 'R-2027-0001', reversal: false, status: 'posted',
    'entered-by': 'employee-accountant-1', 'posted-by': 'employee-accountant-1', 'posted-at': '2027-11-03',
  };

  // Postings that do not balance: 5949.99 EUR debit vs 4999.99 EUR credit
  const postings = [
    { id: 'JE-RT-0001-1', entity: 'posting', 'journal-entry': 'JE-RT-0001', position: 1, 'account-number': '1400', chart: 'skr03', side: 'debit', amount: '5949.99 EUR', currency: 'EUR', 'vat-treatment': 'none', 'posting-type': 'line', 'line-description': 'line 1', 'reconciliation-status': 'unreconciled' },
    { id: 'JE-RT-0001-2', entity: 'posting', 'journal-entry': 'JE-RT-0001', position: 2, 'account-number': '8400', chart: 'skr03', side: 'credit', amount: '4999.99 EUR', currency: 'EUR', 'vat-treatment': 'taxable-turnover', 'posting-type': 'line', 'line-description': 'line 2', 'reconciliation-status': 'unreconciled' },
  ];

  const docs = new Map([
    ['posting/JE-RT-0001-1', postings[0]],
    ['posting/JE-RT-0001-2', postings[1]],
  ]);

  const world = {
    get: (e, id) => docs.get(`${e}/${id}`) || null,
    find: (e, pred) => [...docs.values()].filter((d) => d.entity === e && pred(d)),
  };

  const result = evaluate(parsed.model, {
    op: 'create', entity: 'journal-entry', id: 'JE-RT-0001', doc: unbalancedJE,
  }, world, { authorization: 'strict' });

  assert.equal(result.ok, false, 'Unbalanced journal entry must be refused');
  const invViolation = result.violations.find((v) => v.reason.includes('debits equal credits') || v.reason.includes('credit-amount') || v.reason.includes('would not be'));
  assert.ok(invViolation, `Expected invariant violation, got: ${JSON.stringify(result.violations)}`);

  // Also test perform via kernel
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const nd = await open({
    fs: memFs(),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair },
    seed, clock: fixedClock(),
    roles: ['accountant'],
  });

  const performRes = await nd.perform({
    op: 'create', entity: 'journal-entry', id: 'JE-RT-0002',
    doc: {
      ...unbalancedJE, id: 'JE-RT-0002', 'entry-number': 'JE-RT-0002',
      'debit-amount': '100.00 EUR', 'credit-amount': '50.00 EUR',
    },
  });

  assert.ok(performRes.rejected, 'Unbalanced entry perform() must be rejected');
});

// =============================================================================================
// Claim 4: Two processes have converged through a relay and recovered a company after one is destroyed
// =============================================================================================

const spawnedPeers = new Set();
process.on('exit', () => { for (const c of spawnedPeers) { try { c.kill('SIGKILL'); } catch {} } });

async function startRelayProcess() {
  const child = spawn(process.execPath, [join(REPO_ROOT, 'relay.mjs'), '--port', '0'], {
    cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stderr.on('data', (d) => { err += d; });
  const url = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`relay.mjs start timeout:\n${out}\n${err}`)), 10_000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /neodonkey relay on (ws:\/\/\S+)/.exec(out);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    child.on('error', rej);
  });
  return {
    url, child,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((res) => child.on('exit', res));
    },
  };
}

async function commitEvents(r, n) {
  const files = new Map();
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

const scriptDir = tempDir('script-fixtures');
const PEER_SCRIPT = join(scriptDir, 'peer_readme_claim.mjs');

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
} else {
  rendezvous = unhex(o.rendezvousHex);
}

const conn = await connectRelay({
  relay: relayAddress, rendezvous, identity, role: o.role,
  expectPeerKeyRaw, randomBytes: platformRandomBytes, timers, timeoutMs: 20000,
});

const peer = gitPeer({
  link: conn.channels.channel(TRUTH_CHANNEL), repo: r, fs, peerId: o.peerId,
  onError: (err) => { process.stderr.write('git sync: ' + err.message + '\\n'); },
});

const NOTE = ${JSON.stringify(NOTE)};
let clock = o.clockStart;
const doc = session(NOTE, o.nodeId, () => (clock += 1));
const liveLink = conn.channels.channel(liveChannel(NOTE.entity, NOTE.id));
liveLink.onFrame((frame) => doc.receive(JSON.parse(frame)));
doc.onLocalOps((ops) => liveLink.send(JSON.stringify(ops)));
const buffer = opBuffer({ kv: fsKvStore(fs), now: () => o.now });
buffer.track(doc, { baseDoc: NOTE });
doc.set(o.field, o.value);

const control = conn.channels.channel('control');
let sawPeerOps = false, myOpsAcked = false;
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
  }
  check();
});

let fetched = null;
if (o.fetch) fetched = await peer.fetch();

control.send(JSON.stringify({ t: 'ops', ops: doc.ops() }));

await Promise.race([
  bothConverged,
  new Promise((_, rej) => setTimeout(() => rej(new Error('peer timeout')), o.watchdogMs)),
]);

process.stdout.write('RESULT ' + JSON.stringify({
  role: o.role, head: await r.head(), fetched, ops: doc.ops(), snapshot: doc.snapshot(),
}) + '\\n');
conn.close();
process.exit(0);
`;

function runPeer(dir, options) {
  writeFileSync(PEER_SCRIPT, PEER_PROGRAM);
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [PEER_SCRIPT, JSON.stringify({ watchdogMs: 20000, ...options })], { cwd: dir });
    spawnedPeers.add(child);
    let out = '', err = '';
    const killer = setTimeout(() => { child.kill('SIGKILL'); rej(new Error(`peer timeout: ${out}\n${err}`)); }, 40000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(killer); rej(e); });
    child.on('exit', (code) => {
      clearTimeout(killer);
      spawnedPeers.delete(child);
      const m = /^RESULT (.*)$/m.exec(out);
      if (code !== 0 || !m) { rej(new Error(`peer failed code=${code}: ${out}\n${err}`)); return; }
      res(JSON.parse(m[1]));
    });
  });
}

test('README Claim 4: two processes converge through relay and recover company after process destruction', { timeout: 120_000 }, async (t) => {
  const relayProcess = await startRelayProcess();
  t.after(() => relayProcess.stop());

  const sarahDir = tempDir('sarah');
  const kleinDir = tempDir('klein');
  const sarahFs = nodeFs(sarahDir);
  const kleinFs = nodeFs(kleinDir);
  await initRepo(sarahFs);
  await initRepo(kleinFs);

  const { head: companyHead, expected } = await commitEvents(repo(sarahFs), 5);
  const sarah = await generateIdentity({ comment: 'sarah' });
  const klein = await generateIdentity({ comment: 'klein' });
  const sarahJwk = join(scriptDir, 'sarah.jwk.json');
  const kleinJwk = join(scriptDir, 'klein.jwk.json');
  writeFileSync(sarahJwk, JSON.stringify(await exportPrivateJwk(sarah)));
  writeFileSync(kleinJwk, JSON.stringify(await exportPrivateJwk(klein)));

  const introduction = await createIntroduction({
    identity: sarah, repoId: REPO_ID, relay: relayProcess.url, now: NOW,
    ttlMs: 15 * 60 * 1000, randomBytes: platformRandomBytes,
  });

  const [host, guest] = await Promise.all([
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

  assert.deepEqual(guest.ops, host.ops, 'Live layer ops converged');
  assert.equal(guest.head, companyHead, 'Truth layer head converged');

  // Destroy Sarah's workspace directory
  rmSync(sarahDir, { recursive: true, force: true });
  assert.equal(existsSync(sarahDir), false);

  // Recover company to new laptop with new keypair
  const newLaptopDir = tempDir('sarah-new');
  const newSarah = await generateIdentity({ comment: 'sarah-new' });
  const newJwk = join(scriptDir, 'sarah-new.jwk.json');
  writeFileSync(newJwk, JSON.stringify(await exportPrivateJwk(newSarah)));
  const newFs = nodeFs(newLaptopDir);
  await initRepo(newFs);

  const reIntroduction = await createIntroduction({
    identity: klein, repoId: REPO_ID, relay: relayProcess.url, now: NOW + 86_400_000,
    randomBytes: platformRandomBytes,
  });

  const [, sarahAgain] = await Promise.all([
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

  assert.equal(sarahAgain.head, companyHead, 'Recovered company head matches original head');
  await repo(newFs).checkout();
  assert.equal(git(newLaptopDir, 'fsck', '--strict').trim(), '');
  assert.equal(git(newLaptopDir, 'status', '--porcelain').trim(), '');
  for (const [path, body] of expected) {
    assert.equal(git(newLaptopDir, 'show', `HEAD:${path}`), body);
  }
});

// =============================================================================================
// Claim 5: Signed Runtime: release manifest verification and key pinning enforce structural sovereignty
// =============================================================================================

test('Signed Runtime: release manifest verification and key pinning enforce structural sovereignty', async () => {
  const releaseKeyPair = await generateIdentity({ comment: 'release-key@neodonkey.eu' });
  const publicSsh = await exportPublicSsh(releaseKeyPair, 'release-key@neodonkey.eu');

  const rawManifest = {
    schema: 1,
    product: 'neodonkey',
    version: '1.0.0',
    key: publicSsh,
    files: [
      { path: 'runtime/kernel.js', sha256: 'a'.repeat(64), bytes: 1024 },
      { path: 'runtime/polism/parse.js', sha256: 'b'.repeat(64), bytes: 2048 },
    ],
  };

  const payload = canonicalManifestBytes(rawManifest);
  const signature = await signPayload(releaseKeyPair, payload, RELEASE_NAMESPACE);
  const signedManifest = { ...rawManifest, signature };

  // 1. Direct verification against expected key
  const verified = await verifyRelease(signedManifest, publicSsh);
  assert.equal(verified.ok, true, 'Validly signed release manifest must verify');
  assert.equal(verified.version, '1.0.0');

  // 2. Gating before key pinning -> mode is 'first-use'
  const store = memoryStore();
  const firstUseGate = await gateRelease(store, signedManifest);
  assert.equal(firstUseGate.mode, 'first-use', 'First encounter with signed release must report first-use mode');

  // 3. Pin key and verify gate -> mode is 'verified'
  await pinKey(store, publicSsh, { at: 1_780_000_000_000, note: 'Initial release key pin' });
  const pinnedGate = await gateRelease(store, signedManifest);
  assert.equal(pinnedGate.mode, 'verified', 'Gate must report verified once key is pinned');

  // 4. Tampered manifest (altered file hash) -> mode is 'refused'
  const tamperedManifest = {
    ...signedManifest,
    files: [
      { path: 'runtime/kernel.js', sha256: 'f'.repeat(64), bytes: 1024 },
      { path: 'runtime/polism/parse.js', sha256: 'b'.repeat(64), bytes: 2048 },
    ],
  };
  const tamperedGate = await gateRelease(store, tamperedManifest);
  assert.equal(tamperedGate.mode, 'refused', 'Tampered manifest must be refused by release gate');
  assert.equal(tamperedGate.reason, 'bad-signature');
});
