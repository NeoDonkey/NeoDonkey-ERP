// test/s-integrity.test.js — the Truth Layer's integrity: two signatures over one payload,
// legally gapless numbering, and the kernel-side end of default-allow.
//
// Standing rule 3: foreign tooling is the judge. Every claim about a commit format here is
// checked by real `git` (`fsck --strict`, `log --show-signature`) and every claim about a
// signature by real `ssh-keygen -Y verify`. Our code agreeing with itself is not evidence.
//
// Standing rule 4: ask what happens when nothing applies. That question is the reason this file
// exists, and the last block of it is the v0.1 attack — `delete location` by an actor with no
// roles at all — fired at the real 28-rule operating model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFs } from '../runtime/git/fs-node.js';
import { memFs } from '../runtime/git/fs.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { allowedSignersLine, verifyPayload, inspectSignature, signPayload } from '../runtime/identity/sshsig.js';
import {
  COSIGN_NAMESPACE, COSIGN_TRAILER_KEY, cosignTrailer, cosignPayload, armorFromBase64,
  base64FromArmor, payloadWithCosignatures, readCosignTrailers, verifyCommitSignatures,
  matchDistinct,
} from '../runtime/identity/cosign.js';
import {
  SEQUENCE_ENTITY, normalizeSeries, formatNumber, allocate, periodOf, auditIssuance,
  readSequenceTrailers, assertAuthoritative, sequenceId,
} from '../runtime/truth/sequence.js';
import { encodeCommit, commitPayload, decodeCommit } from '../runtime/git/objects.js';
import { parseOperatingModel } from '../runtime/polism/parse.js';
import { open, PATHS } from '../runtime/kernel.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------------------------

const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-s-${tag}-`));
const git = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A fixed clock. Determinism is a feature, not a test trick. */
function fixedClock(from = '2027-11-03T09:14:00Z') {
  let t = Date.parse(from);
  return () => (t += 60_000);
}

/**
 * A small, complete operating model. Small on purpose: the four-eyes and numbering claims must be
 * readable in one screen, and the *real* model is used where the claim is about the real model
 * (the strict-authorization block at the end).
 */
function testModel() {
  const m = new Map();
  const role = (name, title) => m.set(`operating-model/organisation/${name}.md`,
    `# ${title}\n\n${title} of this company.\n`);
  role('accountant', 'Accountant');
  role('managing-director', 'Managing director');
  role('clerk', 'Clerk');

  m.set('operating-model/information/invoice.md', `# Invoice

An outgoing invoice. Its number is a legal artefact: sequential and gapless (GoBD).

## Fields
- invoice-date: date required — The date the invoice is issued.
- net-amount: number required — The net total.
- customer: text required — Who owes it.
- status: text — draft or issued.

## Identified by
customer

## Created on demand
no
`);

  m.set('operating-model/information/payment-run.md', `# Payment run

A batch of outgoing payments. The document a Wirtschaftsprüfer asks about first.

## Fields
- total: number required — The total being paid out.
- requested-by: text required — Who asked for the run.
- status: text — draft or released.

## Identified by
requested-by

## Created on demand
no
`);

  m.set('operating-model/processes/invoicing.md', `# Invoicing

## Authorized by
- accountant

## Rules

If Create invoice
  under condition net-amount > 0
  then Update invoice with status "issued"
`);

  m.set('operating-model/processes/payment.md', `# Payment runs

## Authorized by
- accountant
- managing-director

## Rules

If Create payment-run
  under condition total > 0
  then Update payment-run with status "released"
`);
  return m;
}

const SEQUENCES = {
  invoice: {
    entity: 'invoice',
    pattern: 'RE-{period}-{0000}',
    reset: 'year',
    'date-field': 'invoice-date',
  },
};

const FOUR_EYES = {
  'create payment-run': {
    roles: ['accountant', 'managing-director'],
    separateFrom: 'requested-by',
  },
};

/**
 * A workspace with two peers who can both sign, and the four-eyes rule armed.
 *
 * FD-9: `roles` is what the repository RECORDS for Sarah, and therefore the ceiling on anything a
 * test may claim through `actorRoles`. It defaults to `['accountant']` — deliberately not to every
 * role in the model, so that a test claiming authority nobody granted fails here rather than
 * passing on the strength of its own assertion. That is the whole of COMPROMISES #21 in one default.
 */
async function workspace(dir, {
  strict = true, sequences = SEQUENCES, fourEyes = FOUR_EYES, roles = ['accountant'],
} = {}) {
  const sarah = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const klein = await generateIdentity({ comment: 'klein@neodonkey.eu' });
  const nd = await open({
    fs: dir === null ? memFs() : nodeFs(dir),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
    seed: testModel(),
    clock: fixedClock(),
    tzOffsetMinutes: 60,
    strictAuthorization: strict,
    sequences,
    fourEyes,
    roles,
  });
  assert.deepEqual(nd.modelErrors, [], 'the test model must parse cleanly');
  await nd.addPeer({
    name: 'Herr Klein', email: 'klein@neodonkey.eu',
    publicKeySsh: await exportPublicSsh(klein, 'klein@neodonkey.eu'),
    roles: ['managing-director'],
  });
  return { nd, sarah, klein };
}

const invoiceDoc = (over = {}) => ({
  entity: 'invoice', 'invoice-date': '2027-11-03', 'net-amount': 100,
  customer: 'KoRo GmbH', ...over,
});

// =============================================================================================
// Part 1 — two signatures over one payload
// =============================================================================================

test('the co-signature trailer round-trips through armor byte-exactly', async () => {
  const kp = await generateIdentity({ comment: 'a@b.c' });
  const payload = enc.encode('tree 0000\nauthor a\n\nhello\n');
  const armored = await cosignPayload(kp, payload);

  const b64 = base64FromArmor(armored);
  assert.equal(armorFromBase64(b64), armored, 're-armoring must be byte-identical');
  assert.equal(b64.includes('\n'), false, 'a git trailer is one line');

  const line = cosignTrailer('a@b.c', armored);
  assert.match(line, new RegExp(`^${COSIGN_TRAILER_KEY}: a@b\\.c [A-Za-z0-9+/=]+$`));

  // The namespace is NOT 'git'. A co-signature must never be replayable as a commit signature.
  assert.equal(inspectSignature(armored).namespace, COSIGN_NAMESPACE);
  assert.notEqual(COSIGN_NAMESPACE, 'git');
  assert.equal(await verifyPayload(await exportPublicSsh(kp), payload, armored, 'git'), false,
    'a co-signature must not verify in the git namespace');
});

test('the staircase: signature k covers every co-signature before it and none after', async () => {
  const a = await generateIdentity({ comment: 'a@x' });
  const b = await generateIdentity({ comment: 'b@x' });
  const p0 = enc.encode('tree 0\nauthor x\n\nsubject\n\nNeoDonkey-Transaction: v1\n');

  const sigA = await cosignPayload(a, p0);
  const lineA = cosignTrailer('a@x', sigA);
  const p1 = payloadWithCosignatures(p0, [lineA]);
  const sigB = await cosignPayload(b, p1);
  const lineB = cosignTrailer('b@x', sigB);
  const p2 = payloadWithCosignatures(p0, [lineA, lineB]);

  const pubA = await exportPublicSsh(a, 'a@x');
  const pubB = await exportPublicSsh(b, 'b@x');

  assert.equal(await verifyPayload(pubA, p0, sigA, COSIGN_NAMESPACE), true);
  assert.equal(await verifyPayload(pubB, p1, sigB, COSIGN_NAMESPACE), true);
  // and neither covers the finished article, which is the primary's job
  assert.equal(await verifyPayload(pubA, p2, sigA, COSIGN_NAMESPACE), false);
  assert.equal(await verifyPayload(pubB, p2, sigB, COSIGN_NAMESPACE), false);

  // readCosignTrailers recovers P0 from Pn byte-exactly — the arithmetic both halves rely on
  const read = readCosignTrailers(p2);
  assert.deepEqual(read.trailers.map((t) => t.principal), ['a@x', 'b@x']);
  assert.deepEqual([...read.basePayload], [...p0]);
});

test('a two-signature commit: git fsck clean, git log --show-signature reports G, both '
   + 'signatures verified by us AND by ssh-keygen independently', async () => {
  const dir = temp('twosig');
  const { nd, sarah, klein } = await workspace(dir);

  const result = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-1',
    doc: { entity: 'payment-run', total: 50_000, 'requested-by': 'anna@neodonkey.eu' },
    actorRoles: ['accountant'],
    signers: [
      { principal: 'klein@neodonkey.eu', keyPair: klein },
      { principal: 'sarah@neodonkey.eu' },
    ],
  });
  assert.equal(result.rejected, undefined, JSON.stringify(result.rejected, null, 2));
  assert.deepEqual(result.cosigners, ['klein@neodonkey.eu']);

  // ---- real git is happy with the object
  git(dir, 'fsck', '--strict');
  assert.equal(git(dir, 'status', '--porcelain').trim(), '',
    'a workspace with a co-signed commit is still simply a folder');

  // ---- real git verifies the PRIMARY signature as good
  const signers = join(temp('signers'), 'allowed_signers');
  writeFileSync(signers, [
    allowedSignersLine('sarah@neodonkey.eu', await exportPublicSsh(sarah, 'sarah@neodonkey.eu')),
    allowedSignersLine('klein@neodonkey.eu', await exportPublicSsh(klein, 'klein@neodonkey.eu'), COSIGN_NAMESPACE),
  ].join('\n') + '\n');

  const status = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--format=%G? %GS');
  const codes = status.trim().split('\n').map((l) => l.split(' ')[0]);
  assert.deepEqual([...new Set(codes)], ['G'],
    `real git must report G for every commit, got:\n${status}`);

  const shown = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`,
    'log', '--show-signature', '-n', '1');
  assert.match(shown, /Good "git" signature/);
  // the co-signature is visible to a human reading git log, as a trailer
  assert.match(shown, new RegExp(`${COSIGN_TRAILER_KEY}: klein@neodonkey\\.eu `));

  // ---- our own verifier reports BOTH, in order
  const report = await nd.verifyCommit(result.oid);
  assert.equal(report.ok, true, JSON.stringify(report.problems, null, 2));
  assert.deepEqual(report.signatures.map((s) => [s.order, s.role, s.principal, s.status]), [
    [1, 'cosignature', 'klein@neodonkey.eu', 'good'],
    [2, 'primary', 'sarah@neodonkey.eu', 'good'],
  ]);
  assert.match(report.signatures[0].fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);

  // ---- and ssh-keygen accepts EACH signature independently, over the payload it covers
  const [commit] = await nd._internals.repo.log(1);
  const { trailers, basePayload } = readCosignTrailers(commit.payload);
  const sigFile = join(dir, '..', 'cosign.sig');

  writeFileSync(sigFile, armorFromBase64(trailers[0].base64) + '\n');
  const outCo = execFileSync('ssh-keygen',
    ['-Y', 'verify', '-f', signers, '-I', 'klein@neodonkey.eu', '-n', COSIGN_NAMESPACE, '-s', sigFile],
    { input: Buffer.from(basePayload), encoding: 'utf8' });
  assert.match(outCo, new RegExp(`Good "${COSIGN_NAMESPACE}" signature`));

  const primaryFile = join(dir, '..', 'primary.sig');
  writeFileSync(primaryFile, commit.signature + '\n');
  const outPrimary = execFileSync('ssh-keygen',
    ['-Y', 'verify', '-f', signers, '-I', 'sarah@neodonkey.eu', '-n', 'git', '-s', primaryFile],
    { input: Buffer.from(commit.payload), encoding: 'utf8' });
  assert.match(outPrimary, /Good "git" signature/);

  // ssh-keygen must REFUSE the co-signature against the full payload — otherwise the staircase
  // proves nothing about ordering.
  assert.throws(() => execFileSync('ssh-keygen',
    ['-Y', 'verify', '-f', signers, '-I', 'klein@neodonkey.eu', '-n', COSIGN_NAMESPACE, '-s', sigFile],
    { input: Buffer.from(commit.payload), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
});

// ---------------------------------------------------------------------------------------------
// the tamper matrix — every case refused, each with its own reason
// ---------------------------------------------------------------------------------------------

/**
 * Build a two-signature commit in memory, then let a test mutate its message before verification.
 * Working on raw commit bytes rather than through the kernel is the point: an attacker does not
 * use our API.
 */
async function cosignedCommit({ cosigners, tamper = (lines) => lines, primary }) {
  const base = {
    tree: 'a'.repeat(40), parents: [], author: { name: 'S', email: 'sarah@x' },
    committer: { name: 'S', email: 'sarah@x' }, time: 1_700_000_000, tzOffsetMinutes: 60,
  };
  const baseMessage = 'payment run PR-1 created\n\nNeoDonkey-Transaction: v1\n';
  const p0 = encodeCommit({ ...base, message: baseMessage, signature: null });

  let lines = [];
  let payload = p0;
  for (const c of cosigners) {
    const armored = await cosignPayload(c.keyPair, payload);
    lines.push(cosignTrailer(c.principal, armored));
    payload = payloadWithCosignatures(p0, lines);
  }
  lines = await tamper(lines, p0);
  const finalPayload = payloadWithCosignatures(p0, lines);
  const signature = await signPayload(primary.keyPair, payload, 'git'); // signs the HONEST payload
  void finalPayload;
  const content = encodeCommit({
    ...base,
    message: baseMessage + lines.map((l) => `${l}\n`).join(''),
    signature,
  });
  return { content, payload: commitPayload(content), signature };
}

async function keyring(names) {
  const keys = new Map();
  for (const n of names) {
    const kp = await generateIdentity({ comment: n });
    keys.set(n, { keyPair: kp, principal: n, pub: await exportPublicSsh(kp, n) });
  }
  return {
    keys,
    resolve: (principal) => (keys.get(principal) ? keys.get(principal).pub : null),
  };
}

async function verdict(commit, ring, extra = {}) {
  return verifyCommitSignatures({
    payload: commit.payload,
    primarySignature: commit.signature,
    primaryPrincipal: 'sarah@x',
    resolveKey: ring.resolve,
    ...extra,
  });
}

test('tamper: a stripped co-signature invalidates the primary signature', async () => {
  const ring = await keyring(['sarah@x', 'klein@x']);
  const commit = await cosignedCommit({
    cosigners: [ring.keys.get('klein@x')],
    primary: ring.keys.get('sarah@x'),
    tamper: () => [],                        // remove it after the primary signed over it
  });
  const r = await verdict(commit, ring);
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems.map((p) => p.code), ['primary-signature-invalid']);
  assert.match(r.problems[0].message, /does not verify/);
});

test('tamper: reordered co-signatures are refused, and the reason names the position', async () => {
  const ring = await keyring(['sarah@x', 'klein@x', 'anna@x']);
  const commit = await cosignedCommit({
    cosigners: [ring.keys.get('klein@x'), ring.keys.get('anna@x')],
    primary: ring.keys.get('sarah@x'),
    tamper: (lines) => [lines[1], lines[0]],
  });
  const r = await verdict(commit, ring);
  assert.equal(r.ok, false);
  const codes = r.problems.map((p) => p.code);
  assert.ok(codes.includes('cosignature-invalid'), codes.join(', '));
  assert.ok(codes.includes('trailer-block-altered'), codes.join(', '));
  assert.match(r.problems[0].message, /position 1/);
});

test('tamper: a duplicated co-signature is refused as one pair of eyes, not two', async () => {
  const ring = await keyring(['sarah@x', 'klein@x']);
  const commit = await cosignedCommit({
    cosigners: [ring.keys.get('klein@x')],
    primary: ring.keys.get('sarah@x'),
    tamper: (lines) => [lines[0], lines[0]],
  });
  const r = await verdict(commit, ring);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'duplicate-cosigner'), JSON.stringify(r.problems));
  assert.match(r.problems.find((p) => p.code === 'duplicate-cosigner').message,
    /same principal signing twice is one person signing twice/);
});

test('tamper: a foreign co-signature from a key the repository does not know is refused', async () => {
  const ring = await keyring(['sarah@x', 'klein@x']);
  const stranger = await generateIdentity({ comment: 'mallory@x' });
  const commit = await cosignedCommit({
    cosigners: [ring.keys.get('klein@x')],
    primary: ring.keys.get('sarah@x'),
    tamper: async (lines, p0) => [
      ...lines, cosignTrailer('mallory@x', await cosignPayload(stranger, p0)),
    ],
  });
  const r = await verdict(commit, ring);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'unknown-cosigner'), JSON.stringify(r.problems));
  assert.ok(r.problems.some((p) => p.code === 'trailer-block-altered'));
});

test('tamper: the same key signing under two names is refused (same key twice)', async () => {
  const ring = await keyring(['sarah@x', 'klein@x']);
  const klein = ring.keys.get('klein@x');
  // "anna" is a second name for Klein's key — the classic four-eyes bypass.
  ring.keys.set('anna@x', { ...klein, principal: 'anna@x' });
  const commit = await cosignedCommit({
    cosigners: [klein, { ...klein, principal: 'anna@x' }],
    primary: ring.keys.get('sarah@x'),
  });
  const r = await verdict(commit, ring);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'same-key-twice'), JSON.stringify(r.problems));
});

test('tamper: the primary key may not also co-sign', async () => {
  const ring = await keyring(['sarah@x']);
  const sarah = ring.keys.get('sarah@x');
  ring.keys.set('sarah-again@x', { ...sarah, principal: 'sarah-again@x' });
  const commit = await cosignedCommit({
    cosigners: [{ ...sarah, principal: 'sarah-again@x' }],
    primary: sarah,
  });
  const r = await verdict(commit, ring);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'primary-also-cosigned'), JSON.stringify(r.problems));
});

test('tamper: a co-signature over a different payload is refused even when the primary sealed it',
  async () => {
    const ring = await keyring(['sarah@x', 'klein@x']);
    const klein = ring.keys.get('klein@x');
    const elsewhere = enc.encode('tree bbbb\n\nsome other commit entirely\n');
    const commit = await cosignedCommit({
      cosigners: [klein],
      primary: ring.keys.get('sarah@x'),
      tamper: async () => [cosignTrailer('klein@x', await cosignPayload(klein.keyPair, elsewhere))],
    });
    // the primary signed over the honest payload, so here we re-sign over the tampered one to
    // isolate the case: a genuinely sealed commit carrying a co-signature for other bytes.
    const resigned = await (async () => {
      const c = decodeCommit(commit.content);
      const message = c.message;
      const unsigned = encodeCommit({ ...c, message, signature: null });
      const sig = await signPayload(ring.keys.get('sarah@x').keyPair, unsigned, 'git');
      const content = encodeCommit({ ...c, message, signature: sig });
      return { content, payload: commitPayload(content), signature: sig };
    })();
    const r = await verdict(resigned, ring);
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems.map((p) => p.code), ['cosignature-invalid']);
    assert.match(r.problems[0].message, /made\s+over different bytes|over different bytes/);
  });

test('tamper: a co-signature trailer outside the trailer block has no position and is refused',
  async () => {
    const ring = await keyring(['sarah@x', 'klein@x']);
    const klein = ring.keys.get('klein@x');
    const base = {
      tree: 'a'.repeat(40), parents: [], author: { name: 'S', email: 'sarah@x' },
      committer: { name: 'S', email: 'sarah@x' }, time: 1_700_000_000, tzOffsetMinutes: 60,
    };
    // the trailer is smuggled into the middle of the message, then the whole thing is signed
    const p0 = encodeCommit({ ...base, message: 'subject\n\nbody\n', signature: null });
    const line = cosignTrailer('klein@x', await cosignPayload(klein.keyPair, p0));
    const message = `subject\n\n${line}\nbody\n`;
    const unsigned = encodeCommit({ ...base, message, signature: null });
    const sig = await signPayload(ring.keys.get('sarah@x').keyPair, unsigned, 'git');
    const content = encodeCommit({ ...base, message, signature: sig });
    const r = await verdict({ content, payload: commitPayload(content), signature: sig }, ring);
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => p.code === 'cosign-trailer-out-of-place'),
      JSON.stringify(r.problems));
  });

test('tamper: a trailer forged OUTSIDE the signed region is invisible and counts for nothing',
  async () => {
    const ring = await keyring(['sarah@x', 'klein@x']);
    const commit = await cosignedCommit({
      cosigners: [],
      primary: ring.keys.get('sarah@x'),
    });
    // The only bytes of a commit object outside the signed payload are the gpgsig header's own
    // continuation lines. Smuggle a co-signature trailer in there.
    const text = dec.decode(commit.content);
    const forged = text.replace('\n\npayment run', `\n ${COSIGN_TRAILER_KEY}: klein@x AAAA\n\npayment run`);
    const bytes = enc.encode(forged);
    const r = await verdict({ content: bytes, payload: commitPayload(bytes), signature: commit.signature }, ring);
    // Our verifier reads trailers from the SIGNED bytes only, so the forgery is not a signature.
    assert.deepEqual(r.signatures.map((s) => s.role), ['primary']);
    assert.equal(r.cosigners.length, 0);
    // and a requirement for two signers is therefore not satisfied
    const r2 = await verdict({ content: bytes, payload: commitPayload(bytes), signature: commit.signature },
      ring, { requirement: { minSigners: 2 } });
    assert.equal(r2.ok, false);
    assert.ok(r2.problems.some((p) => p.code === 'missing-required-signer'));
  });

test('tamper: a `git`-namespace signature cannot be reused as a co-signature', async () => {
  const ring = await keyring(['sarah@x', 'klein@x']);
  const klein = ring.keys.get('klein@x');
  const commit = await cosignedCommit({
    cosigners: [klein],
    primary: ring.keys.get('sarah@x'),
    tamper: async (lines, p0) => [cosignTrailer('klein@x', await signPayload(klein.keyPair, p0, 'git'))],
  });
  const r = await verdict(commit, ring);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'cosignature-wrong-namespace'),
    JSON.stringify(r.problems));
});

test('a commit with no gpgsig at all is not a signed commit, whatever it co-signs', async () => {
  const ring = await keyring(['sarah@x', 'klein@x']);
  const commit = await cosignedCommit({
    cosigners: [ring.keys.get('klein@x')],
    primary: ring.keys.get('sarah@x'),
  });
  const r = await verifyCommitSignatures({
    payload: commit.payload, primarySignature: null, primaryPrincipal: 'sarah@x',
    resolveKey: ring.resolve,
  });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'primary-signature-missing'));
  // the co-signature itself is still good — which is exactly why it is not enough
  assert.equal(r.signatures[0].status, 'good');
});

test('matchDistinct: one person holding both roles does not satisfy two roles', () => {
  assert.deepEqual(matchDistinct([['a'], ['a']]), null);
  assert.deepEqual(matchDistinct([['a', 'b'], ['a']]), ['b', 'a']);
  assert.deepEqual(matchDistinct([['a'], ['b']]), ['a', 'b']);
});

// ---------------------------------------------------------------------------------------------
// four-eyes, end to end through the kernel
// ---------------------------------------------------------------------------------------------

test('four-eyes end to end: one signer refused, two distinct signers commit, the same signer '
   + 'twice refused', async () => {
  const dir = temp('foureyes');
  const { nd, klein } = await workspace(dir);
  const doc = { entity: 'payment-run', total: 12_000, 'requested-by': 'anna@neodonkey.eu' };

  // one signer — the actor alone, exactly as v0.1 would have done it
  const one = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-1', doc, actorRoles: ['accountant'],
  });
  assert.ok(one.rejected, 'a payment run with one signature must be refused');
  assert.equal(one.rejected[0].code, 'missing-required-signer');
  assert.match(one.rejected[0].reason,
    /requires 2 distinct signatures and has 1|not one person clicking twice/);

  // the same signer twice
  const twice = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-1', doc, actorRoles: ['accountant'],
    signers: [{ principal: 'sarah@neodonkey.eu' }, { principal: 'sarah@neodonkey.eu' }],
  });
  assert.ok(twice.rejected);
  assert.equal(twice.rejected[0].code, 'duplicate-signer');

  // a co-signer who cannot actually sign
  const asserted = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-1', doc, actorRoles: ['accountant'],
    signers: [{ principal: 'klein@neodonkey.eu' }, { principal: 'sarah@neodonkey.eu' }],
  });
  assert.ok(asserted.rejected);
  assert.equal(asserted.rejected[0].code, 'cosigner-cannot-sign');

  // two distinct signers, each holding one of the two required roles — this one commits
  const good = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-1', doc, actorRoles: ['accountant'],
    signers: [{ principal: 'klein@neodonkey.eu', keyPair: klein }, { principal: 'sarah@neodonkey.eu' }],
  });
  assert.equal(good.rejected, undefined, JSON.stringify(good.rejected, null, 2));
  const report = await nd.verifyCommit(good.oid, {
    requirement: { roles: ['accountant', 'managing-director'], separateFrom: 'requested-by' },
    document: doc,
  });
  assert.equal(report.ok, true, JSON.stringify(report.problems, null, 2));

  // and nothing was written for any of the three refusals
  assert.equal(nd.query.all('payment-run').length, 1);
  git(dir, 'fsck', '--strict');
});

test('four-eyes: a principal cannot co-sign their own document', async () => {
  const dir = temp('sod');
  const { nd, klein } = await workspace(dir);
  const r = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-2',
    // Klein raised the run AND is offered as a signer
    doc: { entity: 'payment-run', total: 9_000, 'requested-by': 'klein@neodonkey.eu' },
    actorRoles: ['accountant'],
    signers: [{ principal: 'klein@neodonkey.eu', keyPair: klein }, { principal: 'sarah@neodonkey.eu' }],
  });
  assert.ok(r.rejected, 'the requester may not sign their own payment run');
  assert.equal(r.rejected[0].code, 'separation-of-duties');
  assert.match(r.rejected[0].reason, /separation of duties/);
});

test('four-eyes: two roles cannot be covered by one person holding both', async () => {
  const dir = temp('bothroles');
  const sarah = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const klein = await generateIdentity({ comment: 'klein@neodonkey.eu' });
  const nd = await open({
    fs: nodeFs(dir),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
    seed: testModel(), clock: fixedClock(), tzOffsetMinutes: 60,
    sequences: SEQUENCES, fourEyes: FOUR_EYES,
    // Sarah holds BOTH required roles. Two increments of one person are not two signers.
    roles: ['accountant', 'managing-director'],
  });
  await nd.addPeer({
    name: 'Herr Klein', email: 'klein@neodonkey.eu',
    publicKeySsh: await exportPublicSsh(klein, 'klein@neodonkey.eu'),
    roles: ['clerk'],
  });
  const alone = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-3',
    doc: { entity: 'payment-run', total: 1, 'requested-by': 'anna@x' },
    actorRoles: ['accountant', 'managing-director'],
  });
  assert.ok(alone.rejected);
  assert.equal(alone.rejected[0].code, 'missing-required-signer');

  // Klein signs, but only holds "clerk": the roles still cannot be covered by distinct people
  const wrongRole = await nd.perform({
    op: 'create', entity: 'payment-run', id: 'PR-3',
    doc: { entity: 'payment-run', total: 1, 'requested-by': 'anna@x' },
    actorRoles: ['accountant', 'managing-director'],
    signers: [{ principal: 'klein@neodonkey.eu', keyPair: klein }, { principal: 'sarah@neodonkey.eu' }],
  });
  assert.ok(wrongRole.rejected);
  assert.equal(wrongRole.rejected[0].code, 'missing-required-role');
  assert.match(wrongRole.rejected[0].reason, /different people/);
});

// =============================================================================================
// Part 2 — legally gapless numbering
// =============================================================================================

test('a series declaration is refused unless it says exactly what it means', () => {
  const bad = [
    [{ entity: 'invoice' }, /no "pattern"/],
    [{ entity: 'invoice', pattern: 'RE-2027' }, /exactly one counter placeholder/],
    [{ entity: 'invoice', pattern: 'RE-{0000}-{0000}' }, /exactly one counter placeholder/],
    [{ entity: 'invoice', pattern: 'RE-{month}-{0000}' }, /\{month\}, which this runtime does not know/],
    [{ pattern: 'RE-{0000}' }, /which kind of document it numbers/],
    [{ entity: 'invoice', pattern: 'RE-{0000}', reset: 'quarter' }, /not one of never, year/],
    [{ entity: 'invoice', pattern: 'RE-{period}-{0000}', reset: 'year' }, /must name the date field/],
    [{ entity: 'invoice', pattern: 'RE-{period}-{0000}' }, /never resets, so \{period\}/],
    [{ entity: 'invoice', pattern: 'RE-{0000}', start: 0 }, /positive whole number/],
  ];
  for (const [raw, re] of bad) {
    const { declaration, errors } = normalizeSeries('invoice', raw, 'neodonkey.json');
    assert.equal(declaration, null, `${JSON.stringify(raw)} should not be accepted`);
    assert.ok(errors.some((e) => re.test(e)), `${JSON.stringify(raw)} -> ${errors.join(' | ')}`);
  }
  const { declaration } = normalizeSeries('invoice', SEQUENCES.invoice, 'neodonkey.json');
  assert.equal(formatNumber(declaration, '2027', 1), 'RE-2027-0001');
  assert.equal(formatNumber(declaration, '2028', 4711), 'RE-2028-4711');
  assert.equal(sequenceId('invoice', '2027'), 'invoice-2027');
});

test('the period comes from the document, never from a clock', () => {
  const { declaration } = normalizeSeries('invoice', SEQUENCES.invoice, 'x');
  assert.deepEqual(periodOf(declaration, { 'invoice-date': '2029-01-02' }), { period: '2029', error: null });
  assert.match(periodOf(declaration, {}).error, /has no invoice-date/);
  assert.match(periodOf(declaration, { 'invoice-date': 'soon' }).error, /not a date of the form YYYY-MM-DD/);
});

test('allocate() is pure: it issues a number and never writes one', () => {
  const { declaration } = normalizeSeries('invoice', SEQUENCES.invoice, 'x');
  const first = allocate({ declaration, period: '2027', current: null });
  assert.equal(first.number, 'RE-2027-0001');
  assert.equal(first.op, 'create');
  assert.equal(first.sequenceAfter.next, 2);
  // calling it again with the SAME state issues the SAME number: nothing was consumed
  const again = allocate({ declaration, period: '2027', current: null });
  assert.equal(again.number, 'RE-2027-0001');
  const second = allocate({ declaration, period: '2027', current: first.sequenceAfter });
  assert.equal(second.number, 'RE-2027-0002');
  assert.equal(second.op, 'update');
  // a series cannot change shape once it has issued a number
  assert.throws(() => allocate({
    declaration: { ...declaration, pattern: 'INV-{period}-{000000}' },
    period: '2027', current: first.sequenceAfter,
  }), /cannot\s+change shape|change shape/);
});

test('gaplessness: 1000 allocations with refusals and rollbacks interleaved, no gap and no '
   + 'duplicate — audited from the commit history', async () => {
  const { nd } = await workspace(null, { fourEyes: {} });   // memFs: 1000 commits
  const issued = [];
  let refusals = 0;

  for (let i = 1; i <= 1000; i++) {
    // Every third attempt is refused by the operating model (net-amount > 0), and every
    // seventh is refused on authorization. Neither may consume a number.
    if (i % 3 === 0) {
      const r = await nd.perform({
        op: 'create', entity: 'invoice', doc: invoiceDoc({ 'net-amount': 0, customer: `C-${i}` }),
        actorRoles: ['accountant'],
      });
      assert.ok(r.rejected, 'a zero invoice must be refused');
      refusals++;
      continue;
    }
    if (i % 7 === 0) {
      const r = await nd.perform({
        op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: `C-${i}` }),
        actorRoles: ['clerk'],
      });
      assert.ok(r.rejected, 'a clerk may not issue an invoice');
      refusals++;
      continue;
    }
    const year = i > 700 ? '2028' : '2027';       // a per-year reset, mid-run
    const r = await nd.perform({
      op: 'create', entity: 'invoice',
      doc: invoiceDoc({ customer: `C-${i}`, 'invoice-date': `${year}-06-01`, 'net-amount': i }),
      actorRoles: ['accountant'],
    });
    assert.equal(r.rejected, undefined, JSON.stringify(r.rejected));
    issued.push(r.number);
  }

  assert.ok(refusals > 300, `${refusals} refusals interleaved`);
  assert.equal(new Set(issued).size, issued.length, 'no number issued twice');

  // the numbers themselves, per year, are 1..n with no gap
  const audit = await nd.auditNumbering();
  assert.deepEqual(audit.problems, [], audit.problems.join('\n'));
  assert.equal(audit.ok, true);
  assert.equal(audit.issuances.length, issued.length);
  assert.equal(audit.perSeries.get('invoice 2027').min, 1);
  assert.equal(audit.perSeries.get('invoice 2028').min, 1,
    'a per-year series restarts at 1 — that is what "reset: year" means');
  assert.equal(
    audit.perSeries.get('invoice 2027').count + audit.perSeries.get('invoice 2028').count,
    issued.length);
  assert.equal(issued[0], 'RE-2027-0001');
  assert.ok(issued.includes('RE-2028-0001'), 'the 2028 series starts at 1');

  // and the sequence documents agree with the history
  const state = nd.sequenceState('invoice');
  const total = state.reduce((n, d) => n + (d.next - 1), 0);
  assert.equal(total, issued.length);
});

test('a refused commit leaves the sequence document untouched, byte for byte', async () => {
  const dir = temp('refusal');
  const { nd } = await workspace(dir, { fourEyes: {} });

  const first = await nd.perform({
    op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'A' }), actorRoles: ['accountant'],
  });
  assert.equal(first.number, 'RE-2027-0001');
  const seqPath = PATHS.doc(SEQUENCE_ENTITY, 'invoice-2027');
  const before = nd._internals.files.get(seqPath);
  const headBefore = await nd._internals.repo.head();

  for (const bad of [
    { doc: invoiceDoc({ customer: 'B', 'net-amount': 0 }), actorRoles: ['accountant'] },  // rule
    { doc: invoiceDoc({ customer: 'B' }), actorRoles: [] },                               // authority
    { doc: invoiceDoc({ customer: 'B', 'invoice-date': undefined }), actorRoles: ['accountant'] }, // no period
  ]) {
    const r = await nd.perform({ op: 'create', entity: 'invoice', ...bad });
    assert.ok(r.rejected, JSON.stringify(bad));
    assert.deepEqual([...nd._internals.files.get(seqPath)], [...before],
      'a refusal must not move the sequence by a single byte');
    assert.equal(await nd._internals.repo.head(), headBefore, 'a refusal writes no commit');
  }

  // the next successful invoice gets 0002, not 0005
  const next = await nd.perform({
    op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'B' }), actorRoles: ['accountant'],
  });
  assert.equal(next.number, 'RE-2027-0002');
  git(dir, 'fsck', '--strict');
});

test('a crash between allocation and commit cannot lose a number, because there is no between',
  async () => {
    const dir = temp('crash');
    const { nd, sarah } = await workspace(dir, { fourEyes: {} });
    const first = await nd.perform({
      op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'A' }), actorRoles: ['accountant'],
    });
    assert.equal(first.number, 'RE-2027-0001');
    const headAfterFirst = await nd._internals.repo.head();

    // A real crash, at the worst possible instant: the blobs and trees for the new invoice AND the
    // bumped sequence are already in the object store, and the process dies before HEAD moves. It
    // is provoked by a signing key that cannot sign, which is the last step `commit()` takes.
    const cannotSign = await open({
      fs: nodeFs(dir),
      identity: {
        name: 'Sarah Weber', email: 'sarah@neodonkey.eu',
        keyPair: { publicKey: sarah.publicKey, privateKey: null },
      },
      clock: fixedClock('2027-12-01T00:00:00Z'), tzOffsetMinutes: 60,
    });
    await assert.rejects(
      async () => cannotSign.perform({
        op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'B' }), actorRoles: ['accountant'],
      }),
      /no private key/);

    // Reopen from disk, discarding every byte of in-memory state — which is what a restart is.
    const reopened = await open({
      fs: nodeFs(dir),
      identity: {
        name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity(),
      },
      clock: fixedClock('2028-01-01T00:00:00Z'), tzOffsetMinutes: 60,
    });
    assert.equal(await reopened._internals.repo.head(), headAfterFirst,
      'the crashed attempt moved no ref: HEAD is still the last complete business event');

    // Number 2 was never consumed. The next invoice is 0002, not 0003.
    const next = await reopened.perform({
      op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'B' }), actorRoles: ['accountant'],
    });
    assert.equal(next.number, 'RE-2027-0002');

    const audit = await reopened.auditNumbering();
    assert.deepEqual(audit.problems, [], audit.problems.join('\n'));
    assert.equal(audit.issuances.length, 2);
    // and the sequence document in the tree matches the issuance count exactly
    const total = reopened.query.all(SEQUENCE_ENTITY).reduce((n, d) => n + (d.next - 1), 0);
    assert.equal(total, audit.issuances.length,
      'the sequence document and the signed history must agree — a number issued but not '
      + 'committed, or committed but not issued, would show up here');

    // The orphaned objects from the crash are unreachable, and git says so without complaining:
    // `fsck --strict` is clean, which is what "a failure leaves no trace either" has to mean.
    git(dir, 'fsck', '--strict');
    assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  });

test('concurrent allocation attempts on one peer are serialised, not interleaved', async () => {
  const { nd } = await workspace(null, { fourEyes: {} });
  const attempts = [];
  for (let i = 0; i < 25; i++) {
    attempts.push(nd.perform({
      op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: `C-${i}` }),
      actorRoles: ['accountant'],
    }));
  }
  const results = await Promise.all(attempts);
  const numbers = results.map((r) => r.number);
  assert.equal(results.filter((r) => r.rejected).length, 0, JSON.stringify(results.filter((r) => r.rejected)));
  assert.equal(new Set(numbers).size, 25, `two concurrent attempts got the same number: ${numbers}`);
  const audit = await nd.auditNumbering();
  assert.deepEqual(audit.problems, []);
});

test('the sequence entity cannot be written by hand', async () => {
  const { nd } = await workspace(null, { fourEyes: {} });
  const r = await nd.perform({
    op: 'create', entity: SEQUENCE_ENTITY, id: 'invoice-2027',
    doc: { entity: SEQUENCE_ENTITY, series: 'invoice', next: 9999 },
    actorRoles: ['accountant', 'managing-director'],
  });
  assert.ok(r.rejected);
  assert.equal(r.rejected[0].code, 'sequence-is-not-writable');
  assert.match(r.rejected[0].reason, /a hand-written sequence is a hand-written invoice number/);
});

test('nextId() refuses to invent a number for an entity a series governs', async () => {
  const { nd } = await workspace(null, { fourEyes: {} });
  assert.throws(() => nd.nextId('invoice'), /must be gapless \(GoBD\)/);
  // and it still works for an entity whose ids carry no legal meaning
  assert.equal(nd.nextId('payment-run', 'PR'), 'PR-0001');
});

test('the authoritative-peer rule is an enforcement point, not a comment', () => {
  const { declaration } = normalizeSeries('invoice',
    { ...SEQUENCES.invoice, 'authoritative-peer': 'finance@neodonkey.eu' }, 'x');
  assert.equal(assertAuthoritative(declaration, 'finance@neodonkey.eu'), null);
  assert.match(assertAuthoritative(declaration, 'warehouse@neodonkey.eu'),
    /issued by finance@neodonkey\.eu.*one authoritative peer per scarce resource/s);
});

test('a peer that is not the authoritative one refuses to issue a number', async () => {
  const { nd } = await workspace(null, {
    fourEyes: {},
    sequences: { invoice: { ...SEQUENCES.invoice, 'authoritative-peer': 'finance@neodonkey.eu' } },
  });
  const r = await nd.perform({
    op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'A' }), actorRoles: ['accountant'],
  });
  assert.ok(r.rejected);
  assert.equal(r.rejected[0].code, 'not-authoritative-peer');
});

test('auditIssuance names a gap and a duplicate rather than reporting "invalid"', () => {
  const trailer = (v) => ({ series: 'invoice', period: '2027', value: v, entity: 'invoice', id: `RE-${v}` });
  assert.deepEqual(auditIssuance([1, 2, 3].map(trailer)).problems, []);
  assert.match(auditIssuance([1, 2, 4].map(trailer)).problems[0], /jumps from 2 to 4 — 1 number\(s\) missing/);
  assert.match(auditIssuance([1, 2, 2].map(trailer)).problems[0], /issued number 2 twice/);
  assert.match(auditIssuance([2, 3].map(trailer)).problems[0], /starts at 2, not at 1/);
});

test('the issuance trailer is inside the signed payload, so `git log` can prove gaplessness',
  async () => {
    const dir = temp('trailer');
    const { nd } = await workspace(dir, { fourEyes: {} });
    for (const c of ['A', 'B', 'C']) {
      await nd.perform({
        op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: c }), actorRoles: ['accountant'],
      });
    }
    // read the trailers with real git, out of the commit messages it parsed itself
    const log = git(dir, 'log', '--format=%B');
    const found = readSequenceTrailers(log).map((t) => t.value).sort((a, b) => a - b);
    assert.deepEqual(found, [1, 2, 3]);
    // and they are covered by the signature: they are part of the payload our verifier checks
    for (const commit of await nd._internals.repo.log(10)) {
      if (!/NeoDonkey-Sequence:/.test(commit.message)) continue;
      assert.match(dec.decode(commit.payload), /NeoDonkey-Sequence: invoice 2027 \d+ invoice\/RE-/);
    }
    const verdicts = await nd.verify();
    assert.deepEqual([...new Set(verdicts.map((v) => v.signature))], ['good']);
  });

// =============================================================================================
// Part 3 — strict authorization: the v0.1 attack, fired at the real operating model
// =============================================================================================

/**
 * The operating model this product actually ships. The attack has to be aimed at the real thing:
 * COMPROMISES #4c-bis was verified against this model, with this `location.md`, and a synthetic
 * model would prove nothing about it.
 *
 * One concession to parallel development, made explicit rather than hidden: other agents are
 * writing model files in this same wave, and a model that does not parse cannot be executed at
 * all (Principle 6), which would mask this finding instead of testing it. So:
 *
 *   * a file the parser currently rejects is dropped, and NAMED in the test output;
 *   * a reference left dangling by that drop is filled with a minimal stub entity, rather than
 *     dropping the referring file too — otherwise one broken finance file cascades through
 *     `vat-treatment` and `supplier` and takes `location.md` with it, and the attack would end up
 *     fired at a model we wrote instead of the one we ship.
 *
 * When the model is clean, nothing is dropped, nothing is stubbed, and this returns the whole
 * thing. `location.md` is always the real file; the test asserts that.
 */
function realOperatingModel(context) {
  const root = new URL('../operating-model/', import.meta.url);
  const seed = new Map();
  const walk = (rel) => {
    let entries;
    try { entries = readdirSync(new URL(rel, root), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        seed.set(`operating-model/${rel}${e.name}`,
          readFileSync(new URL(`${rel}${e.name}`, root), 'utf8'));
      }
    }
  };
  walk('');

  const dropped = [];
  const stubbed = [];
  const DANGLING = /points at "([a-z0-9-]+)", but no such kind of document is declared/;
  for (let round = 0; round < 24; round++) {
    const errors = parseOperatingModel(seed).errors.filter((e) => e.severity === 'error');
    if (!errors.length) break;
    let progressed = false;
    // First fill holes, so a real file is never dropped for referring to a dropped one.
    for (const e of errors) {
      const m = DANGLING.exec(e.message);
      if (!m) continue;
      const path = `operating-model/information/${m[1]}.md`;
      if (seed.has(path)) continue;
      seed.set(path, `# ${m[1]}\n\nStub, so that a real file's reference resolves.\n\n`
        + '## Fields\n- name: text\n\n## Identified by\nname\n\n## Created on demand\nno\n');
      stubbed.push(m[1]);
      progressed = true;
    }
    if (progressed) continue;
    for (const f of [...new Set(errors.map((e) => e.file))]) {
      if (seed.delete(f)) { dropped.push(f); progressed = true; }
    }
    if (!progressed) break;
  }
  if (context && (dropped.length || stubbed.length)) {
    if (dropped.length) {
      context.diagnostic('operating model files excluded because they do not currently parse '
        + `(another agent's work in flight, not this test's finding): ${dropped.sort().join(', ')}`);
    }
    if (stubbed.length) {
      context.diagnostic(`entities stubbed to keep the remaining real files parseable: `
        + `${[...new Set(stubbed)].sort().join(', ')}`);
    }
  }
  const location = readFileSync(new URL('information/location.md', root), 'utf8');
  assert.equal(seed.get('operating-model/information/location.md'), location,
    'the real, verbatim location.md must be part of the model this attack is fired at');
  return seed;
}

/**
 * This test asserted the opposite until agent F2 closed the hole: it required the shipped
 * `location.md` to declare no authority, so that the v0.1 attack below could be fired at the real
 * model. That coupling was the defect — a test that proves a safety mechanism by depending on a
 * live hole starts failing the moment somebody fixes the hole, which is precisely backwards.
 *
 * So it now asserts the fix, on the shipped files: every operation on every declared entity is
 * governed by something. The *mechanism* is proven separately, against a synthetic entity that
 * declares nothing (`ungoverned-thing` below), which is a property of the runtime and cannot be
 * invalidated by anyone improving the model.
 */
/** Open a workspace on the real, shipped operating model. */
async function realWorkspace(dir, opts = {}, context = null) {
  const kp = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const nd = await open({
    fs: dir === null ? memFs() : nodeFs(dir),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: kp },
    seed: realOperatingModel(context), clock: fixedClock(), tzOffsetMinutes: 60, ...opts,
  });
  assert.deepEqual(nd.modelErrors.map((e) => `${e.file}:${e.line}`), [],
    'the model under test must be executable');
  return { nd, kp };
}

test('the shipped operating model leaves no operation ungoverned — COMPROMISES #4c-bis, closed '
   + 'and measured by the runtime that enforces it', async (t) => {
  const { nd } = await realWorkspace(null, {}, t);

  // Ask the runtime, do not re-derive its rule. The first version of this test reimplemented
  // §16.2's coverage logic and disagreed with the kernel twice — once by reading a Map as a plain
  // object, once by getting the rule itself wrong. A test that re-implements the thing it is
  // checking is testing its own copy, and this project has now been bitten by that three times
  // (this test, test/f-model.test.js's duplicate parser, and pack.js's duplicate SHA-1).
  assert.deepEqual(nd.uncoveredOperations(), [],
    'every operation on every declared entity is governed by a rule or an entity default');

  // `location` specifically — the entity the v0.1 attack used — now says who may do what.
  for (const op of ['create', 'read', 'update', 'delete']) {
    const authority = nd.authorityOf('location', op);
    assert.equal(authority.covered, true, `something governs ${op} location`);
    assert.ok(authority.by, `and it is nameable: ${op} location`);
    assert.match(authority.at, /^operating-model\//);
  }
});

/**
 * The v0.1 attack, reproduced against a synthetic entity so that the assertion is about the
 * *runtime* rather than about whatever the shipped model happens to declare this month. An actor
 * with no roles at all could create, update and delete any entity no rule governed. It cannot now.
 */
const UNGOVERNED_ENTITY = `# Ungoverned Thing

A document whose file deliberately says nothing about who may touch it.

It exists so that the runtime's default can be tested directly. Under FD-7 an operation that
neither a rule nor an entity default governs is refused — and this file governs nothing, so every
operation on it must be refused, for everyone, including a managing director.

## Fields
- label: text
`;

test('THE v0.1 ATTACK IS DEAD: an actor with no roles cannot touch an ungoverned entity',
  async (t) => {
    const seed = realOperatingModel(t);
    seed.set('operating-model/information/ungoverned-thing.md', UNGOVERNED_ENTITY);
    const kp = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
    const nd = await open({
      fs: memFs(),
      identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: kp },
      seed, clock: fixedClock(), tzOffsetMinutes: 60,
      // FD-9: recorded, not claimed. The last assertion in this test is that holding the most
      // powerful role in the company does not help against an entity nothing governs — and after
      // FD-9 that assertion is only worth making if Sarah GENUINELY holds it. Granting it here
      // makes the test stronger: a real managing director, with a signed grant in the genesis
      // commit, still cannot touch `ungoverned-thing`.
      roles: ['managing-director'],
    });
    assert.deepEqual(nd.modelErrors.map((e) => `${e.file}:${e.line}`), []);

    for (const op of ['create', 'update', 'delete']) {
      assert.equal(nd.authorityOf('ungoverned-thing', op).by, null,
        `nothing governs ${op} ungoverned-thing — that is the point of the fixture`);
    }
    assert.equal(nd.strictAuthorization, true, 'a new workspace is strict by default (FD-7)');

    for (const op of ['create', 'update', 'delete']) {
      const r = await nd.perform({
        op, entity: 'ungoverned-thing', id: 'UT-1',
        doc: { entity: 'ungoverned-thing', id: 'UT-1', label: 'anything' },
        actorRoles: [],                     // NO ROLES AT ALL — v0.1 accepted all three
      });
      assert.ok(r.rejected, `${op} with no roles must be refused`);
      assert.equal(r.rejected[0].code, 'not-authorized-by-anything');
      assert.equal(r.rejected[0].entity, 'ungoverned-thing');
      assert.equal(r.rejected[0].operation, op);
      assert.match(r.rejected[0].at, /^operating-model\/information\/ungoverned-thing\.md/);
    }

    // The refusal names the entity, the operation, and the file to edit — written for the person
    // who must fix it, not for a compiler.
    const r = await nd.perform({
      op: 'delete', entity: 'ungoverned-thing', id: 'UT-1', doc: {}, actorRoles: [],
    });
    assert.match(r.rejected[0].reason,
      /nothing in this company's operating model says who may delete an? ungoverned-thing, so nobody may/);
    assert.match(r.rejected[0].reason, /operating-model\/information\/ungoverned-thing\.md/);
    assert.match(r.rejected[0].reason, /## Authorized by/);
    assert.match(r.rejected[0].reason, /- delete: <role>/);

    // And holding every role in the company does not help: nothing governs it at all.
    const withRoles = await nd.perform({
      op: 'delete', entity: 'ungoverned-thing', id: 'UT-1', doc: {},
      actorRoles: ['managing-director'],
    });
    assert.equal(withRoles.rejected[0].code, 'not-authorized-by-anything');
  });

test('an operation the real model DOES cover is still governed by its rule, not by strict mode',
  async (t) => {
    // FD-9: the point of this test is that the RULE refuses her, in the rule's own words, rather
    // than strict mode refusing her. That distinction only exists if she genuinely holds the role
    // she acts with — otherwise the kernel refuses the claim first and the rule never speaks.
    const { nd } = await realWorkspace(null, { roles: ['customer-service-agent'] }, t);
    assert.equal(nd.authorityOf('goods-receipt', 'create').covered, true);
    assert.match(nd.authorityOf('goods-receipt', 'create').at, /^operating-model\/processes\//);
    assert.equal(nd.authorityOf('goods-receipt', 'create').by, 'rule');

    // the rule refuses it for the wrong role — the rule's own sentence, not our strict message
    const r = await nd.perform({
      op: 'create', entity: 'goods-receipt', id: 'GR-1',
      doc: { entity: 'goods-receipt', quantity: 1 }, actorRoles: ['customer-service-agent'],
    });
    assert.ok(r.rejected);
    assert.notEqual(r.rejected[0].code, 'not-authorized-by-anything');
    assert.ok(r.rejected.some((v) => /## Authorized by|must be filled in/.test(v.reason)));

    // The coverage report told the company where its boundary ran; the boundary has since been
    // closed, so the correct assertion is that it reports nothing. Kept rather than deleted,
    // because a coverage report that silently stops working would be invisible.
    assert.deepEqual(nd.uncoveredOperations(), [],
      'the shipped model now governs every operation — COMPROMISES #4c-bis closed');
  });

test('an operation covered by a rule succeeds under strict authorization', async () => {
  const dir = temp('covered');
  const { nd } = await workspace(dir, { fourEyes: {} });
  const r = await nd.perform({
    op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'KoRo' }), actorRoles: ['accountant'],
  });
  assert.equal(r.rejected, undefined, JSON.stringify(r.rejected, null, 2));
  assert.equal(nd.query.get('invoice', r.number).status, 'issued');
  // ... and one the model does not cover is refused in the same workspace
  const del = await nd.perform({
    op: 'delete', entity: 'invoice', id: r.number, doc: {}, actorRoles: ['accountant'],
  });
  assert.ok(del.rejected);
  assert.equal(del.rejected[0].code, 'not-authorized-by-anything');
  git(dir, 'fsck', '--strict');
});

test('an entity-scope authority default (grammar.md §16.1) covers the operation and is enforced',
  async () => {
    // FD-9: Sarah acts as both an accountant and a managing director below, so the repository has
    // to RECORD both for her. Before FD-9 the test simply asserted them at call time and was
    // believed, which is the defect (#21) rather than a convenience.
    const { nd } = await workspace(null, { fourEyes: {}, roles: ['accountant', 'managing-director'] });
    // The shape agent G2's parser produces for `## Authorized by` / `- delete: managing-director`
    // in an information/ file. Written here rather than in the model text because the section is
    // grammar v2 and this test is about the kernel's half of FD-7, not the parser's.
    const def = nd.model.entities.get('invoice');
    def.authority = {
      byOp: new Map([['delete', { roles: ['managing-director'], line: 12 }]]),
      source: { file: 'operating-model/information/invoice.md', line: 10 },
    };
    const c = nd.authorityOf('invoice', 'delete');
    assert.equal(c.by, 'entity');
    assert.deepEqual(c.roles, ['managing-director']);
    assert.equal(c.at, 'operating-model/information/invoice.md:12');

    const created = await nd.perform({
      op: 'create', entity: 'invoice', doc: invoiceDoc({ customer: 'X' }),
      actorRoles: ['accountant'],
    });
    assert.equal(created.rejected, undefined, JSON.stringify(created.rejected));

    const refused = await nd.perform({
      op: 'delete', entity: 'invoice', id: created.number, doc: {}, actorRoles: ['accountant'],
    });
    assert.ok(refused.rejected, 'an accountant may not delete an invoice');
    assert.match(refused.rejected[0].reason, /managing-director/);

    const allowed = await nd.perform({
      op: 'delete', entity: 'invoice', id: created.number, doc: {}, actorRoles: ['managing-director'],
    });
    assert.equal(allowed.rejected, undefined, JSON.stringify(allowed.rejected));
    assert.equal(nd.query.get('invoice', created.number), null);
  });

test('the kernel reads an entity authority declaration in every shape the grammar has used',
  async () => {
    const { nd } = await workspace(null, { fourEyes: {} });
    const def = nd.model.entities.get('invoice');
    const shapes = [
      // grammar v2, exactly as parse.js builds it
      { authority: { byOp: new Map([['delete', { roles: ['managing-director'], line: 3 }]]),
                     source: { file: 'operating-model/information/invoice.md', line: 2 } } },
      { authority: { byOp: new Map([['delete', ['managing-director']]]) } },
      { authority: { byOp: { delete: ['managing-director'] } } },
      { operationAuthority: { delete: ['managing-director'] } },
      { authority: { '*': ['managing-director'] } },
      { authorizedBy: ['managing-director'] },
    ];
    for (const shape of shapes) {
      for (const k of ['operationAuthority', 'authorizedBy', 'authority']) delete def[k];
      Object.assign(def, shape);
      const c = nd.authorityOf('invoice', 'delete');
      assert.equal(c.by, 'entity', JSON.stringify(shape, (k, v) => (v instanceof Map ? [...v] : v)));
      assert.deepEqual(c.roles, ['managing-director']);
    }
    // and with none of them, the pair is uncovered
    for (const k of ['operationAuthority', 'authorizedBy', 'authority']) delete def[k];
    assert.equal(nd.authorityOf('invoice', 'delete').covered, false);
  });

// ---------------------------------------------------------------------------------------------
// the setting lives in the repo, and an existing workspace keeps its meaning
// ---------------------------------------------------------------------------------------------

test('the authorization setting is recorded in the genesis commit, signed, and readable by git',
  async () => {
    const dir = temp('genesis');
    await workspace(dir);
    const settings = JSON.parse(git(dir, 'show', `HEAD~1:${PATHS.settings}`).trim() || git(dir, 'show', `HEAD:${PATHS.settings}`));
    assert.equal(settings.authorization.strict, true);
    const first = git(dir, 'rev-list', '--max-parents=0', 'HEAD').trim();
    assert.match(git(dir, 'show', '--format=%B', '-s', first), /NeoDonkey-Authorization: strict/);
    assert.match(git(dir, 'show', `${first}:${PATHS.settings}`), /"strict": true/);
  });

/**
 * Principle 6, and agent C's correction that flipping the default is a major-version act: a folder
 * written by v0.1 must behave under a v1.0 runtime exactly as it did.
 *
 * The subtlety this test originally got wrong — it seeded the *current* operating model into a
 * pre-strict workspace and expected an ungoverned create to succeed. But entity-scope authority is
 * enforced in every mode by design (grammar §16.1), and the current model declares it, so it was
 * correctly refused. That is not drift: the model is part of the folder. A real 2027 folder carries
 * a 2027 model, which declares no entity authority at all — so that is what must be tested.
 */
test('a pre-strict workspace with a v0.1-era model keeps its meaning', async () => {
  const dir = temp('legacy');
  const legacy = new Map([
    // Exactly what a v0.1 model looked like: fields, no `## Authorized by` anywhere, no rules.
    ['operating-model/information/widget.md',
      '# Widget\n\nA thing v0.1 described without saying who may touch it.\n\n## Fields\n- label: text\n'],
  ]);
  const nd = await open({
    fs: nodeFs(dir),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
    seed: legacy, clock: fixedClock(), tzOffsetMinutes: 60, strictAuthorization: false,
  });
  assert.equal(nd.strictAuthorization, false);

  // v0.1's behaviour, pinned: nothing governs `widget`, and permissive means permitted.
  const r = await nd.perform({
    op: 'create', entity: 'widget', id: 'W-1',
    doc: { entity: 'widget', id: 'W-1', label: 'anything' }, actorRoles: [],
  });
  assert.equal(r.rejected, undefined, JSON.stringify(r.rejected, null, 2));

  // Reopening must NOT flip the meaning, even if the caller asks for strict.
  await assert.rejects(
    async () => open({
      fs: nodeFs(dir),
      identity: { name: 'S', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
      clock: fixedClock(), strictAuthorization: true,
    }),
    /authorization/i,
    'a caller may not strengthen an existing workspace behind its own back');
});

test('entity authority is enforced even in a permissive workspace', async () => {
  // The other half of the same decision, and the reason the test above had to be rewritten: a
  // *declaration* is a statement by the company, so it binds regardless of the workspace setting.
  // Only the treatment of SILENCE differs between strict and permissive.
  const dir = temp('permissive-declared');
  const seed = new Map([
    ['operating-model/information/widget.md',
      '# Widget\n\nA thing whose file says who may touch it.\n\n## Fields\n- label: text\n'
      + '\n## Authorized by\n- create: boss\n- read: boss\n- update: boss\n- delete: boss\n'],
    ['operating-model/organisation/boss.md', '# Boss\n\nRuns the company.\n\n## Purpose\nDecides.\n'],
  ]);
  const nd = await open({
    fs: nodeFs(dir),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
    seed, clock: fixedClock(), tzOffsetMinutes: 60, strictAuthorization: false,
    // FD-9 and §16.1 together: a DECLARED authority binds in every mode, and the role that
    // satisfies it must be a recorded fact even in a permissive workspace. Permissive governs what
    // SILENCE means; it never made a claimed role true.
    roles: ['boss'],
  });
  const refused = await nd.perform({
    op: 'create', entity: 'widget', id: 'W-1',
    doc: { entity: 'widget', id: 'W-1', label: 'x' }, actorRoles: [],
  });
  assert.ok(refused.rejected, 'a declared authority binds even when the workspace is permissive');
  const allowed = await nd.perform({
    op: 'create', entity: 'widget', id: 'W-2',
    doc: { entity: 'widget', id: 'W-2', label: 'x' }, actorRoles: ['boss'],
  });
  assert.equal(allowed.rejected, undefined, JSON.stringify(allowed.rejected, null, 2));
});

test('open() refuses to create a workspace in a directory marked as the source checkout, and '
   + 'writes nothing', async () => {
  const dir = temp('devmarker');
  writeFileSync(join(dir, '.neodonkey-dev'), 'source checkout, not a company\n');
  const identity = {
    name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity(),
  };

  await assert.rejects(
    async () => open({ fs: nodeFs(dir), identity, clock: fixedClock() }),
    /refusing to create a NeoDonkey workspace here.*\.neodonkey-dev/s);

  // Nothing was written: no `.git`, no peers, no settings. A guard that half-creates a repository
  // is the same accident with an extra step.
  assert.deepEqual(readdirSync(dir).sort(), ['.neodonkey-dev'],
    'the refusal must leave the directory exactly as it was');

  // The documented escape, for a test that wants to prove the guard exists.
  const nd = await open({ fs: nodeFs(dir), identity, clock: fixedClock(), allowDevWorkspace: true });
  assert.ok(await nd.history(1));
  assert.ok(readdirSync(dir).includes('.git'));

  // And once a workspace DOES exist here, reopening it is unaffected — the guard is genesis-only.
  const again = await open({ fs: nodeFs(dir), identity, clock: fixedClock() });
  assert.equal((await again.history(10)).length, 1);
});

test('a directory without the marker is unaffected by the guard', async () => {
  const dir = temp('nomarker');
  const nd = await open({
    fs: nodeFs(dir),
    identity: { name: 'S', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
    clock: fixedClock(),
  });
  assert.equal((await nd.history(10)).length, 1);
  assert.equal(readdirSync(dir).includes('.neodonkey-dev'), false);
  git(dir, 'fsck', '--strict');
});

test('the source checkout itself carries the marker, so this cannot regress silently', () => {
  const marker = readFileSync(new URL('../.neodonkey-dev', import.meta.url), 'utf8');
  assert.match(marker, /source checkout/i);
});

test('editing neodonkey.json to weaken authorization is refused, and the refusal says where to '
   + 'look', async () => {
  const dir = temp('tamperset');
  const { nd } = await workspace(dir);
  // The attack: commit a change to the settings file with real git and reopen. A signing key is
  // not needed — the file is just a file, which is exactly why HEAD alone cannot be the authority.
  const settingsPath = join(dir, PATHS.settings);
  const weakened = JSON.parse(readFileSync(settingsPath, 'utf8'));
  weakened.authorization.strict = false;
  writeFileSync(settingsPath, `${JSON.stringify(weakened, null, 2)}\n`);
  git(dir, '-c', 'user.name=Mallory', '-c', 'user.email=m@x', 'commit', '-a', '-m', 'housekeeping');

  await assert.rejects(
    async () => open({
      fs: nodeFs(dir),
      identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
      clock: fixedClock(),
    }),
    /genesis commit .* records "NeoDonkey-Authorization: strict"/s);
  await assert.rejects(
    async () => open({
      fs: nodeFs(dir),
      identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
      clock: fixedClock(),
    }),
    /git log -p -- neodonkey\.json/);
  void nd;
});

test('a workspace deliberately created permissive opens fine — genesis and HEAD agree', async () => {
  const dir = temp('genuinepermissive');
  await workspace(dir, { strict: false });
  const again = await open({
    fs: nodeFs(dir),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
    clock: fixedClock(),
  });
  assert.equal(again.strictAuthorization, false);
  assert.match(git(dir, 'show', '--format=%B', '-s',
    git(dir, 'rev-list', '--max-parents=0', 'HEAD').trim()), /NeoDonkey-Authorization: permissive/);
});

test('a strict workspace cannot be quietly reopened as a permissive one', async () => {
  const dir = temp('noflip');
  await workspace(dir);
  await assert.rejects(
    async () => open({
      fs: nodeFs(dir),
      identity: { name: 'S', email: 'sarah@neodonkey.eu', keyPair: await generateIdentity() },
      clock: fixedClock(), strictAuthorization: false,
    }),
    /major-version act, not an option/);
});
