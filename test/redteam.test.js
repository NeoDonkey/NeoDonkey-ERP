// test/redteam.test.js — the internal red team. Gate condition 9: "An adversary tried".
//
// Every test in this file is an attack, run against the real public APIs of the runtime, and the
// expected outcome of every one of them is that the system REFUSES or DETECTS. A green test here
// does not mean "the feature works"; it means "the attack did not". The attacks are aimed at the
// four things the gate names:
//
//   1. forge a commit              — runtime/identity + runtime/git + kernel.verifyCommit
//   2. tamper with stored history  — runtime/git object store, with real `git fsck` as judge
//   3. bypass the rules            — kernel authorization (FD-7 strict default, FD-9 grounding)
//   4. unbalance the ledger        — the real operating model through runtime/polism/execute.js
//   5. breach the group encryption — runtime/crypto (envelope, groups, shred) and the kernel's
//      sealing policy
//   6. sneak a float into money    — runtime/money/money.js (FD-1)
//
// Two attacks in this file FOUND something. They are named "FINDING", they fail, and they are
// meant to: weakening them to make the suite green would hide the hole, which is the one thing
// a red team must never do. Both are written up in docs/security-redteam-2026-08-21.md.
//
// Standing rule 3 (foreign tooling is the judge) applies where history is tampered with: real
// `git fsck --strict` decides whether the repository notices. Determinism: every clock is fixed,
// every key is generated per test — no Date.now(), no Math.random() in the assertions' path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { memFs } from '../runtime/git/fs.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { objectStore, concatBytes, commitPayload } from '../runtime/git/objects.js';
import { deflate } from '../runtime/git/zlib.js';
import { packedStore } from '../runtime/git/store.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { signPayload } from '../runtime/identity/sshsig.js';
import { verifyCommitSignatures } from '../runtime/identity/cosign.js';
import { parseOperatingModel } from '../runtime/polism/parse.js';
import { evaluate } from '../runtime/polism/execute.js';
import * as Money from '../runtime/money/money.js';
import {
  generateEncryptionKeyPair, enrolment as enrol, CryptoError,
} from '../runtime/crypto/keys.js';
import { seal, parseFrame, frame } from '../runtime/crypto/envelope.js';
import { createGroup, keyring } from '../runtime/crypto/groups.js';
import {
  vault, createSubjectKey, storeSubjectKey, loadSubjectKey, attachVault, sealForSubject,
  eraseSubject, verifyErasure,
} from '../runtime/crypto/shred.js';
import { open, PATHS } from '../runtime/kernel.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const enc = new TextEncoder();
const dec = new TextDecoder();

const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-redteam-${tag}-`));
const git = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gitFails = (dir, ...args) => {
  try {
    const out = execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { failed: false, out };
  } catch (e) {
    return { failed: true, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};

/** A fixed clock. Determinism is a feature, not a test trick. */
function fixedClock(from = '2027-11-03T09:14:00Z') {
  let t = Date.parse(from);
  return () => (t += 60_000);
}

/** Latin-1 view of bytes, so a substring search over ciphertext is exact. */
const latin = (b) => [...b].map((c) => String.fromCharCode(c)).join('');

// =============================================================================================
// A small company: one governed entity (invoice, accountant only), one entity no rule governs
// (sticky-note), strict authorization, gapless invoice numbering.
// =============================================================================================

function testModel() {
  const m = new Map();
  const role = (name, title) => m.set(`operating-model/organisation/${name}.md`,
    `# ${title}\n\n${title} of this company.\n`);
  role('accountant', 'Accountant');
  role('managing-director', 'Managing director');

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

  m.set('operating-model/information/sticky-note.md', `# Sticky note

An informal note. Deliberately, no rule and no entity default says who may create one:
it is the "nothing applies" probe (standing rule 4).

## Fields
- text: text required — What it says.

## Identified by
text

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
  return m;
}

const SEQUENCES = {
  invoice: {
    entity: 'invoice', pattern: 'RE-{period}-{0000}', reset: 'year', 'date-field': 'invoice-date',
  },
};

const INVOICE = { entity: 'invoice', 'invoice-date': '2027-11-03', 'net-amount': 100, customer: 'KoRo GmbH' };

/**
 * Open a workspace as Sarah, whom the repository records as an accountant — and nothing else.
 * memFs: the authorization attacks below do not need a disk, and fast tests get run.
 */
async function workspace({ roles = ['accountant'], ...opts } = {}) {
  const sarah = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const nd = await open({
    fs: memFs(),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
    seed: testModel(), clock: fixedClock(), tzOffsetMinutes: 60,
    strictAuthorization: true, sequences: SEQUENCES, ...(roles === null ? {} : { roles }),
    ...opts,
  });
  assert.deepEqual(nd.modelErrors, [], 'the test model must parse cleanly');
  return { nd, sarah };
}

// =============================================================================================
// 1 — FORGED COMMITS. The claim under attack: "every business fact is a signed commit, and any
// peer detects a compromised signature" (Appendix XI). Attacker model: Mallory holds no private
// key of any peer, but can construct arbitrary commit-shaped bytes and call the verifier.
// =============================================================================================

test('attack: a commit signed by a stranger\'s key, presented as the founder\'s, is refused',
  async () => {
    const { nd, sarah } = await workspace();
    const honest = await nd.perform({
      op: 'create', entity: 'invoice', doc: INVOICE, actorRoles: ['accountant'],
    });
    assert.ok(honest.oid, JSON.stringify(honest.rejected));

    // Control: the honest commit verifies.
    const good = await nd.verifyCommit(honest.oid);
    assert.equal(good.ok, true, JSON.stringify(good.problems));

    const [commit] = await nd._internals.repo.log(1);
    const sarahPub = await exportPublicSsh(sarah, 'sarah@neodonkey.eu');
    const repoKey = (p) => (p === 'sarah@neodonkey.eu' ? sarahPub : null);

    // Mallory generates her own key, signs Sarah's commit payload, and presents the result as
    // Sarah's commit. The verifier resolves the claimed principal against the repository's
    // recorded key, exactly as kernel.verifyCommit does.
    const mallory = await generateIdentity({ comment: 'mallory@evil.example' });
    const forgedSig = await signPayload(mallory, commit.payload, 'git');
    const verdict = await verifyCommitSignatures({
      payload: commit.payload, primarySignature: forgedSig,
      primaryPrincipal: 'sarah@neodonkey.eu', resolveKey: repoKey,
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.problems.map((p) => p.code), ['primary-signature-invalid']);

    // And if Mallory also claims a principal the repository has never recorded a key for, the
    // answer is "unknown signer", never "unverifiable, so perhaps fine".
    const stranger = await verifyCommitSignatures({
      payload: commit.payload, primarySignature: forgedSig,
      primaryPrincipal: 'mallory@evil.example', resolveKey: repoKey,
    });
    assert.equal(stranger.ok, false);
    assert.ok(stranger.problems.some((p) => p.code === 'unknown-signer'),
      JSON.stringify(stranger.problems));
  });

test('attack: the honest signature re-attached to a mutated payload (the amount changed)',
  async () => {
    const { nd, sarah } = await workspace();
    const honest = await nd.perform({
      op: 'create', entity: 'invoice', doc: INVOICE, actorRoles: ['accountant'],
    });
    const [commit] = await nd._internals.repo.log(1);
    const sarahPub = await exportPublicSsh(sarah, 'sarah@neodonkey.eu');

    // Mallory rewrites the commit — points the audit trail at a different invoice number —
    // and keeps Sarah's genuine signature, which is right there in the object to copy.
    // (The document bytes sit under the tree oid; editing the commit is what the signature
    // exists to catch.)
    const mutated = enc.encode(
      dec.decode(commit.payload).replace('RE-2027-0001', 'RE-2027-9999'),
    );
    assert.notEqual(dec.decode(mutated), dec.decode(commit.payload), 'the mutation must be real');
    const verdict = await verifyCommitSignatures({
      payload: mutated, primarySignature: commit.signature,
      primaryPrincipal: 'sarah@neodonkey.eu',
      resolveKey: (p) => (p === 'sarah@neodonkey.eu' ? sarahPub : null),
    });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.problems.map((p) => p.code), ['primary-signature-invalid']);
  });

test('attack: a genuine signature replayed from one commit onto the next (same key, new bytes)',
  async () => {
    const { nd, sarah } = await workspace();
    const first = await nd.perform({
      op: 'create', entity: 'invoice', doc: INVOICE, actorRoles: ['accountant'],
    });
    const second = await nd.perform({
      op: 'create', entity: 'invoice',
      doc: { ...INVOICE, customer: 'KoRo GmbH (branch)', 'net-amount': 999999 },
      actorRoles: ['accountant'],
    });
    assert.ok(first.oid && second.oid);
    const [c2, c1] = await nd._internals.repo.log(2);   // newest first
    const sarahPub = await exportPublicSsh(sarah, 'sarah@neodonkey.eu');
    const resolve = (p) => (p === 'sarah@neodonkey.eu' ? sarahPub : null);

    // Both signatures are genuine Sarah signatures. The replay attack presents the FIRST
    // commit's signature over the SECOND commit's payload: same key, same namespace, one day
    // later and six euros short of a million.
    const replayed = await verifyCommitSignatures({
      payload: c2.payload, primarySignature: c1.signature,
      primaryPrincipal: 'sarah@neodonkey.eu', resolveKey: resolve,
    });
    assert.equal(replayed.ok, false);
    assert.ok(replayed.problems.some((p) => p.code === 'primary-signature-invalid'));

    // Sanity: each honest pair still verifies, so the refusal above is about the replay.
    for (const c of [c1, c2]) {
      const v = await verifyCommitSignatures({
        payload: c.payload, primarySignature: c.signature,
        primaryPrincipal: 'sarah@neodonkey.eu', resolveKey: resolve,
      });
      assert.equal(v.ok, true, JSON.stringify(v.problems));
    }
  });

test('attack: a commit whose signature was stripped is "missing", not "unverifiable"', async () => {
  const { nd, sarah } = await workspace();
  await nd.perform({ op: 'create', entity: 'invoice', doc: INVOICE, actorRoles: ['accountant'] });
  const [commit] = await nd._internals.repo.log(1);
  const sarahPub = await exportPublicSsh(sarah, 'sarah@neodonkey.eu');
  const verdict = await verifyCommitSignatures({
    payload: commitPayload(commit.payload), primarySignature: null,
    primaryPrincipal: 'sarah@neodonkey.eu',
    resolveKey: (p) => (p === 'sarah@neodonkey.eu' ? sarahPub : null),
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((p) => p.code === 'primary-signature-missing'));
});

// =============================================================================================
// 2 — TAMPERED HISTORY. Attacker model: write access to the workspace folder (a stolen laptop,
// a malicious sync peer that also controls the disk). The object store is content-addressed, so
// the question is: who notices when the bytes behind a name stop matching the name?
// =============================================================================================

/** A one-commit company on disk, and the oid of its one document blob. */
async function companyOnDisk(tag) {
  const dir = temp(tag);
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  const doc = enc.encode(JSON.stringify(
    { entity: 'invoice', id: 'INV-1', 'net-amount': '100.00 EUR' }, null, 2) + '\n');
  await r.commit({
    files: new Map([['documents/invoice/INV-1.json', doc]]),
    message: 'invoice INV-1', author: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' },
    time: 1_793_523_240, tzOffsetMinutes: 60,
  });
  const tree = await r.readTreeAtHead();
  return { dir, fs, r, blobOid: tree.get('documents/invoice/INV-1.json'), doc };
}

const loosePath = (oid) => `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;

test('attack: one flipped byte in a stored object — the runtime read throws, and git fsck agrees',
  async () => {
    const { dir, fs, blobOid } = await companyOnDisk('flip');
    const path = loosePath(blobOid);
    const bytes = Uint8Array.from(await fs.read(path));
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await fs.write(path, bytes);

    // The runtime notices: the zlib stream no longer inflates to a well-formed object.
    await assert.rejects(() => objectStore(fs).read(blobOid));

    // The foreign judge notices too, by name.
    const fsck = gitFails(dir, 'fsck', '--strict', '--no-progress');
    assert.equal(fsck.failed, true, 'git fsck --strict must fail on a corrupted object');
  });

test('attack: a WELL-FORMED forgery behind an honest name — what notices, and what does not',
  async () => {
    // The stronger attack: not corruption but substitution. Mallory rewrites the loose object
    // file with a valid zlib stream around forged content (an invoice 10,000x larger), keeping
    // the file at the path of the honest oid. Everything that parses will parse.
    const { dir, fs, blobOid } = await companyOnDisk('substitute');
    const forged = enc.encode(JSON.stringify(
      { entity: 'invoice', id: 'INV-1', 'net-amount': '1000000.00 EUR' }, null, 2) + '\n');
    await fs.write(loosePath(blobOid),
      await deflate(concatBytes(enc.encode(`blob ${forged.length}\0`), forged)));

    // What notices:
    //  * git fsck --strict, the standing foreign judge, reports the hash mismatch.
    const fsck = gitFails(dir, 'fsck', '--strict', '--no-progress');
    assert.equal(fsck.failed, true, 'git fsck --strict must name the substitution');
    //  * the pack path: a repack recomputes every object's hash from its bytes, and refuses to
    //    fold the forgery into a pack under a name it does not hash to.
    await assert.rejects(() => packedStore(fs).repack(), /differs|not in this pack/);
    //  * a syncing peer: runtime/sync/gitsync.js reads incoming packs with verifyOids: true,
    //    so the forged bytes cannot cross to another machine under this name.

    // What does NOT notice, stated as the assertion rather than discovered later: the loose
    // read path returns the forged bytes without re-hashing them. This is FINDING F-1 of the
    // report, and the next test pins the required behaviour.
    const served = await objectStore(fs).read(blobOid);
    assert.match(dec.decode(served.content), /1000000\.00 EUR/,
      'as of this audit the loose read path serves the forgery — see FINDING F-1');
  });

test('FINDING F-1 (real hole, kept failing on purpose): the loose-object read path must refuse '
   + 'bytes whose hash is not their name', async () => {
    // Git itself does not re-hash loose objects on read either — but this runtime is built to
    // run in a browser with no git binary, its PACK reader verifies every oid by default
    // (runtime/git/pack.js verifyOids), and "content-addressed" is the integrity argument the
    // whole truth layer rests on. A read path that serves bytes whose SHA-1 is not their name
    // breaks that argument silently. The pack side of the same store already refuses this.
    const { fs, blobOid } = await companyOnDisk('f1');
    const forged = enc.encode('{"entity":"invoice","id":"INV-1","net-amount":"1000000.00 EUR"}\n');
    await fs.write(loosePath(blobOid),
      await deflate(concatBytes(enc.encode(`blob ${forged.length}\0`), forged)));

    await assert.rejects(
      () => objectStore(fs).read(blobOid),
      /hash|mismatch|integrity/,
      'objectStore.read must re-hash loose object bytes and refuse a name/content mismatch',
    );
  });

// =============================================================================================
// 3 — RULE BYPASS. The claim under attack: authorisation is closed (FD-7 strict default-deny)
// and a caller's roles are what the REPOSITORY records, intersected with what it claims (FD-9).
// Attacker model: Mallory can call kernel.perform with any intent she likes — she just cannot
// edit the signed peer records.
// =============================================================================================

test('attack: claim a role the repository never recorded (claimed ∩ recorded must shrink, '
   + 'never grow)', async () => {
    const { nd } = await workspace();   // records Sarah as: accountant
    const attempt = await nd.perform({
      op: 'create', entity: 'invoice', doc: INVOICE,
      actorRoles: ['accountant', 'managing-director'],
    });
    assert.ok(attempt.rejected, 'a widened claim must be refused, not quietly narrowed');
    assert.equal(attempt.rejected[0].code, 'roles-not-held');
    assert.match(attempt.rejected[0].reason, /does not record that role/);
    assert.match(attempt.rejected[0].reason, /never widen/);
    // and the refusal names the place the truth lives: the signed peer record
    assert.equal(attempt.rejected[0].at, PATHS.peer('sarah@neodonkey.eu'));
    // nothing was written
    assert.equal(nd.query.all('invoice').length, 0);
  });

test('attack: claim a role that exists nowhere in the company at all', async () => {
  const { nd } = await workspace();
  const attempt = await nd.perform({
    op: 'create', entity: 'invoice', doc: INVOICE, actorRoles: ['superuser'],
  });
  assert.ok(attempt.rejected);
  assert.equal(attempt.rejected[0].code, 'roles-not-held');
});

test('attack: a peer whose signed record carries no roles holds no authority at all', async () => {
  // Eve's genesis peer record records no roles array — the FD-9 default. She may read; she may
  // not perform anything any rule governs, whatever she claims.
  const { nd } = await workspace({ roles: null });
  const eve = await generateIdentity({ comment: 'eve@neodonkey.eu' });
  void eve;
  const attempt = await nd.perform({ op: 'create', entity: 'invoice', doc: INVOICE });
  assert.ok(attempt.rejected);
  assert.equal(attempt.rejected[0].code, 'roles-not-recorded');
  assert.match(attempt.rejected[0].reason, /never granted/);
});

test('attack: an operation no POLISM rule covers is refused, and the refusal names the sentence '
   + 'that is missing', async () => {
    const { nd } = await workspace();
    // sticky-note is deliberately ungoverned: no rule triggers on it, no entity default.
    const attempt = await nd.perform({
      op: 'create', entity: 'sticky-note',
      doc: { entity: 'sticky-note', text: 'pay cash, no receipt' },
      actorRoles: ['accountant'],
    });
    assert.ok(attempt.rejected, 'default-deny: nothing says who may, so nobody may');
    assert.equal(attempt.rejected[0].code, 'not-authorized-by-anything');
    // The refusing sentence is identified: the file where the missing authority would live.
    assert.equal(attempt.rejected[0].at, 'operating-model/information/sticky-note.md');
    assert.match(attempt.rejected[0].reason,
      /nothing in this company's operating model says who may create a sticky-note, so nobody may/);
    assert.equal(nd.query.all('sticky-note').length, 0, 'a refusal writes no document');
  });

test('attack: narrow authority to nothing and try the governed operation anyway', async () => {
  const { nd } = await workspace();
  const attempt = await nd.perform({
    op: 'create', entity: 'invoice', doc: INVOICE, actorRoles: [],
  });
  assert.ok(attempt.rejected, 'an empty claim is a claim to no role, not a claim to all of them');
  assert.match(attempt.rejected.map((v) => v.reason).join('\n'), /no role/);
});

// =============================================================================================
// 4 — LEDGER UNBALANCE. The claim under attack: debits = credits is a STRUCTURAL invariant,
// executed by runtime/polism/execute.js against the real operating model. Attacker model:
// Mallory is a recorded accountant and may post; she wants the books not to add up.
// =============================================================================================

function walkMd(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** The operating model this product ships, parsed by the real parser. */
function realModel() {
  const files = new Map();
  for (const p of walkMd(join(REPO_ROOT, 'operating-model'))) {
    files.set(relative(REPO_ROOT, p), readFileSync(p, 'utf8'));
  }
  const parsed = parseOperatingModel(files);
  const errors = (parsed.errors || []).filter((d) => d.severity === 'error');
  assert.deepEqual(errors, [], 'the shipped operating model must parse');
  return parsed.model;
}

/** A World over plain objects, the two methods execute.js requires (grammar §13.3). */
function worldOf(docs) {
  return {
    get: (entity, id) => {
      const d = (docs[entity] || {})[String(id)];
      return d ? { ...d, id: String(id) } : null;
    },
    find: (entity, pred) => Object.entries(docs[entity] || {})
      .map(([id, d]) => ({ ...d, id })).filter(pred || (() => true)),
  };
}

const CHART_DOC = {
  name: 'skr03', standard: 'skr03', 'display-name': 'DATEV SKR03', 'ledger-currency': 'EUR',
  'rounding-rule': 'per-document', 'rounding-mode': 'half-up', 'fiscal-year-start-month': 1,
  'receivables-account-number': '1400', 'payables-account-number': '1600',
  'bank-account-number': '1200', 'inventory-account-number': '3980',
  'inventory-change-account-number': '3960', 'write-off-account-number': '4855',
  'fx-loss-account-number': '4840', 'fx-gain-account-number': '2660',
  'vat-prepayment-account-number': '1780', 'retained-earnings-account-number': '0868',
  'opening-balance-account-number': '9000', 'adopted-on': '2026-01-01', status: 'active',
  'receivables-account': 'skr03-1400', 'payables-account': 'skr03-1600',
  'bank-account': 'skr03-1200', 'inventory-account': 'skr03-3980',
  'inventory-change-account': 'skr03-3960', 'write-off-account': 'skr03-4855',
  'fx-loss-account': 'skr03-4840', 'fx-gain-account': 'skr03-2660',
  'vat-prepayment-account': 'skr03-1780', 'retained-earnings-account': 'skr03-0868',
  'opening-balance-account': 'skr03-9000',
};

const account = (n, over = {}) => ({
  'account-number': n, name: `Account ${n}`, chart: 'skr03', 'account-type': 'asset',
  'normal-balance': 'debit', 'statement-section': 'balance-sheet', 'vat-role': 'none',
  'reconciliation-account-for': 'none', 'blocked-for-manual-posting': false,
  'account-source': 'published-standard', 'opened-on': '2026-01-01', status: 'active', ...over,
});

function period(key, status) {
  return {
    'period-key': key, 'fiscal-year': 2026, month: Number(key.slice(5)),
    'from-date': `${key}-01`, 'to-date': `${key}-31`, chart: 'skr03', status,
    'vat-return-filed': status === 'locked', 'trial-balance-agreed': status === 'locked',
    'bank-reconciled': status === 'locked', 'carried-forward': status === 'locked',
    'locked-on': status === 'locked' ? '2026-08-10' : '',
    'locked-by': status === 'locked' ? 'employee-controller-1' : '',
  };
}

/** A sales-invoice journal entry with two of its three postings: debit 5,949.99, credit 4,999.99. */
function ledgerWorld({ periodStatus = 'open' } = {}) {
  const posting = (position, acct, side, amount) => ({
    'journal-entry': 'JE-RT-0001', position, 'account-number': acct, chart: 'skr03',
    'ledger-account': `skr03-${acct}`, side, amount, currency: 'EUR',
    'posting-date': '2026-07-05', 'accounting-period': '2026-07',
    description: `${acct} ${side}`, 'source-document-reference': 'R-2026-0001', 'vat-role': 'none',
  });
  return {
    'chart-of-accounts': { skr03: { ...CHART_DOC } },
    'accounting-period': { '2026-07': period('2026-07', periodStatus) },
    'ledger-account': {
      'skr03-1400': account('1400'),
      'skr03-8400': account('8400', {
        'account-type': 'revenue', 'normal-balance': 'credit',
        'statement-section': 'profit-and-loss', 'vat-role': 'taxable-turnover', 'vat-kennzahl': '81',
      }),
      'skr03-1776': account('1776', {
        'account-type': 'liability', 'normal-balance': 'credit',
        'vat-role': 'output-tax', 'vat-kennzahl': '81',
      }),
    },
    'journal-entry': {
      'JE-RT-0001': {
        'entry-number': 'JE-RT-0001', 'entry-date': '2026-07-05', 'document-date': '2026-07-05',
        'accounting-period': '2026-07', chart: 'skr03', currency: 'EUR',
        'debit-amount': '5949.99 EUR', 'credit-amount': '5949.99 EUR', 'posting-count': 3,
        description: 'Sales invoice R-2026-0001', 'source-document-type': 'sales-invoice',
        'source-document-reference': 'R-2026-0001', reversal: false, status: 'posted',
        'entered-by': 'mallory', 'posted-by': 'mallory', 'posted-at': '2026-07-05',
      },
    },
    posting: {
      'JE-RT-0001-1': posting(1, '1400', 'debit', '5949.99 EUR'),
      'JE-RT-0001-2': posting(2, '8400', 'credit', '4999.99 EUR'),
    },
  };
}

/** Mallory's third posting: the VAT line. 19 % of 4,999.99 is 950.00. She controls `amount`. */
function vatPosting(amount, world) {
  return evaluate(realModel(), {
    op: 'create', entity: 'posting', id: 'JE-RT-0001-3', actorRoles: ['accountant'],
    doc: {
      'journal-entry': 'JE-RT-0001', position: 3, 'account-number': '1776', chart: 'skr03',
      'ledger-account': 'skr03-1776', side: 'credit', amount, currency: 'EUR',
      'posting-date': '2026-07-05', 'accounting-period': '2026-07',
      description: 'VAT 19 %', 'source-document-reference': 'R-2026-0001', 'vat-role': 'none',
    },
  }, worldOf(world));
}

test('attack: post a journal entry one cent out of balance', () => {
  const refused = vatPosting('949.99 EUR', ledgerWorld());
  assert.equal(refused.ok, false, 'an unbalanced entry must be refused, structurally');
  const text = refused.violations.map((v) => `${v.reason}`).join('\n');
  assert.match(text, /debits equal credits/, 'the refusal quotes the invariant by name');
  assert.match(text, /information\/journal-entry\.md/, 'and names the file that declares it');
  assert.match(text, /JE-RT-0001/, 'and names the document that would break');

  // Control: the honest 950.00 is accepted — the refusal is about the cent, not the path.
  const accepted = vatPosting('950.00 EUR', ledgerWorld());
  assert.equal(accepted.ok, true,
    `the balanced entry must post: ${(accepted.violations || []).map((v) => v.reason).join('; ')}`);
});

test('attack: backdate a posting into a locked period', () => {
  const locked = vatPosting('950.00 EUR', ledgerWorld({ periodStatus: 'locked' }));
  assert.equal(locked.ok, false, 'a locked period is closed, even to a balanced posting');
  assert.match(locked.violations.map((v) => `${v.reason}`).join('\n'), /2026-07|locked/i);

  // Control: the same posting lands in the open period.
  const open = vatPosting('950.00 EUR', ledgerWorld());
  assert.equal(open.ok, true);
});

test('attack: inject a float as the posting amount (FD-1 at the rule-engine boundary)', () => {
  // 950.0 as a Number is the correct amount — if any code path coerces it, the entry balances
  // and the float is inside the ledger.
  const viaFloat = vatPosting(950.0, ledgerWorld());
  assert.equal(viaFloat.ok, false, 'a Number amount must never reach the invariant arithmetic');
  assert.match(viaFloat.violations.map((v) => `${v.reason}`).join('\n'),
    /not an exact amount/, 'the refusal must say why, in FD-1 terms');

  // The nastier version: a float that carries more precision than the currency has.
  const sneaky = vatPosting(950.0000001, ledgerWorld());
  assert.equal(sneaky.ok, false);

  // And the string with hidden precision: three decimals in a two-decimal currency.
  const overPrecise = vatPosting('950.001 EUR', ledgerWorld());
  assert.equal(overPrecise.ok, false);
  assert.match(overPrecise.violations.map((v) => `${v.reason}`).join('\n'), /not an exact amount/);
});

// =============================================================================================
// 5 — GROUP ENCRYPTION BREACH. Attacker model: Mallory holds a full copy of the repository,
// holds her own enrolment and her own group's key, and is NOT in HR. She wants the salary.
// =============================================================================================

async function person(local) {
  const principal = `${local}@neodonkey.eu`;
  const signing = await generateIdentity({ comment: principal });
  const encryption = await generateEncryptionKeyPair();
  return { principal, signing, encryption, enrolment: await enrol({ signing, encryption, principal }) };
}

const SALARY_DOC = { 'gross-monthly': '5400.00 EUR', grade: 'S3' };
const SALARY_NAME = '2027-Q3-anna';

/** HR holds Sarah; Mallory holds board. The salary is sealed for HR. */
async function cryptoSetup() {
  const sarah = await person('sarah');
  const mallory = await person('mallory');
  const hr = await createGroup({ id: 'hr', title: 'HR', enrolments: [sarah.enrolment] });
  const board = await createGroup({ id: 'board', title: 'Board', enrolments: [mallory.enrolment] });
  const salary = await seal({
    entity: 'salary', name: SALARY_NAME, doc: SALARY_DOC,
    key: { kind: 'dek', groups: [{ id: 'hr', epoch: 1, secret: hr.secret }] },
  });
  const minutes = await seal({
    entity: 'board-minutes', name: '2027-11-03', doc: { note: 'attacker-controlled plaintext' },
    key: { kind: 'dek', groups: [{ id: 'board', epoch: 1, secret: board.secret }] },
  });
  // Mallory's keyring, built from every manifest in the repo: she knows the groups exist.
  const malloryRing = await keyring({
    principal: mallory.principal, encryption: mallory.encryption,
    manifests: [hr.manifest, board.manifest],
  });
  return { sarah, mallory, hr, board, salary, minutes, malloryRing };
}

test('attack: read a sealed document without the group key', async () => {
  const { salary, malloryRing } = await cryptoSetup();
  assert.deepEqual(malloryRing.knownGroups(), ['board', 'hr'], 'the manifests are public, on purpose');
  assert.deepEqual(malloryRing.epochs(), ['board@1'], 'she holds no HR epoch secret');

  await assert.rejects(() => malloryRing.open(salary.bytes), (e) => {
    assert.ok(e instanceof CryptoError);
    assert.equal(e.reason, 'not-a-member');
    return true;
  });
  // And she cannot even compute where a salary would live: the id is a keyed hash under a key
  // she does not hold, so a dictionary of business names confirms nothing.
  assert.equal(await malloryRing.pathFor({ entity: 'salary', name: SALARY_NAME, group: 'hr' }), null);
});

test('attack: swap the attacker\'s own wrap header onto the victim ciphertext (AAD transplant)',
  async () => {
    // Mallory cannot unwrap the HR DEK — but she CAN unwrap her own board DEK. So she takes the
    // header of a document sealed for HER (whose wrap record her key opens) and transplants it
    // onto the salary ciphertext, hoping the runtime unwraps her DEK and decrypts with it.
    // The entire header is AES-GCM additional authenticated data, so the tag must fail.
    const { salary, minutes, malloryRing } = await cryptoSetup();
    const victim = parseFrame(salary.bytes);
    const hers = parseFrame(minutes.bytes);

    // Control: the setup is real — her header plus her ciphertext opens for her.
    const control = await malloryRing.open(frame({ headerBytes: hers.headerBytes, ciphertext: hers.ciphertext }));
    assert.equal(control.doc.note, 'attacker-controlled plaintext');

    const transplanted = frame({ headerBytes: hers.headerBytes, ciphertext: victim.ciphertext });
    await assert.rejects(() => malloryRing.open(transplanted), (e) => {
      assert.equal(e.reason, 'content-mac-failed');
      return true;
    });
  });

test('attack: harvest the sealed blob for plaintext patterns (a ciphertext must leak nothing)',
  async () => {
    const { salary } = await cryptoSetup();
    const bytes = latin(salary.bytes);
    // Every content string, and the business name, must be absent from every byte of the blob.
    for (const needle of ['5400.00', 'S3', 'gross-monthly', 'grade', SALARY_NAME]) {
      assert.equal(bytes.includes(needle), false,
        `the sealed blob contains ${JSON.stringify(needle)} in the clear`);
    }
    // Deliberately NOT asserted: the entity name "salary" and the group id "hr" ARE visible in
    // the header. That is designed (runtime/crypto/envelope.js): a non-member must be able to
    // see which groups could open a blob, or key rotation is impossible for anyone but a member.
    // The metadata-leakage boundary is documented, not accidental.
  });

test('attack: read a GDPR-shredded document — the key is destroyed, the bytes are not enough',
  async () => {
    // Jonas Hartmann's PII, sealed under a subject key wrapped for HR, the key in Sarah's vault.
    const sarah = await person('sarah');
    const mallory = await person('mallory');
    const hr = await createGroup({ id: 'hr', title: 'HR', enrolments: [sarah.enrolment] });
    const groups = [{ id: 'hr', epoch: 1, secret: hr.secret }];
    const v = vault(memFs());

    const PII = { 'display-name': 'Jonas Hartmann', street: 'Musterstrasse 14', city: '10999 Berlin' };
    const subject = await createSubjectKey({ subject: 'customer/C-1042', groups });
    await storeSubjectKey(v, subject.wrap);
    const sealedPII = await sealForSubject({
      entity: 'customer', name: 'C-1042', keyId: subject.keyId, key: subject.key, doc: PII,
    });

    // Control: Sarah (HR, with vault) can open it before the erasure.
    const sarahRing = attachVault(await keyring({
      principal: sarah.principal, encryption: sarah.encryption, manifests: [hr.manifest],
    }), v);
    const before = await sarahRing.open(sealedPII.bytes);
    assert.equal(before.doc['display-name'], 'Jonas Hartmann');

    // The erasure happens: the vault key is destroyed, a tombstone is left.
    const erased = await eraseSubject({
      vault: v, record: subject.record, reason: 'GDPR Art. 17 erasure request',
      requestedBy: 'jonas.hartmann@example.invalid',
      documents: ['documents/customer/C-1042.json'], keyrings: [sarahRing],
      at: '2027-11-03T09:14:00Z',
    });
    assert.equal(erased.destroyed, true);

    // ATTACK 1: Sarah — a legitimate member, holding the group secret — tries to read it back.
    await assert.rejects(() => sarahRing.open(sealedPII.bytes), (e) => {
      assert.equal(e.reason, 'subject-key-destroyed');
      return true;
    });
    // ATTACK 2: the vault is interrogated directly — no cached keyring involved.
    await assert.rejects(
      () => loadSubjectKey({ vault: v, keyId: subject.keyId, keyring: sarahRing }),
      (e) => e.reason === 'subject-key-destroyed');
    // ATTACK 3: Mallory holds the blob AND a stolen copy of the vault directory after the
    // erasure. (The honest limit, documented in shred.js: a copy taken BEFORE the erasure
    // still opens it — no cryptographic erasure is retroactive over copies already made.)
    const malloryRing = attachVault(await keyring({
      principal: mallory.principal, encryption: mallory.encryption, manifests: [hr.manifest],
    }), v);
    await assert.rejects(() => malloryRing.open(sealedPII.bytes));

    // The runtime's own erasure proof agrees: no keyring opens it, the vault entry is gone,
    // the tombstone stands.
    const proof = await verifyErasure({
      vault: v, keyId: subject.keyId, envelopes: [sealedPII.bytes], keyrings: [sarahRing, malloryRing],
    });
    assert.equal(proof.unrecoverable, true, JSON.stringify(proof));

    // And the ciphertext itself still carries nothing: the blob stays in the repo forever
    // (GoBD), so it had better not contain the PII in any recoverable form.
    const bytes = latin(sealedPII.bytes);
    for (const needle of Object.values(PII)) {
      assert.equal(bytes.includes(needle), false, `${needle} survived sealing`);
    }
  });

// =============================================================================================
// 5b — SEALING POLICY DOWNGRADE. The company recorded in its signed genesis that salary is
// confidential. Mallory cannot edit that file without breaking signatures, so she attacks the
// RUNTIME: open the workspace with options that quietly weaken it.
// =============================================================================================

function policyModel() {
  const m = new Map();
  m.set('operating-model/organisation/hr-manager.md', '# HR manager\n\nHR of this company.\n');
  m.set('operating-model/information/salary.md', `# Salary

What one person is paid.

## Fields
- gross-monthly: text required — The monthly gross.

## Identified by
gross-monthly

## Authorized by
- create: hr-manager
- update: hr-manager
`);
  return m;
}

async function policyWorkspaceOnDisk() {
  const dir = temp('policy');
  const sarah = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const encryption = await generateEncryptionKeyPair();
  const nd = await open({
    fs: nodeFs(dir), identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
    seed: policyModel(), clock: fixedClock(), tzOffsetMinutes: 60,
    roles: ['hr-manager'], encryption, sealed: { salary: ['hr'] },
  });
  assert.deepEqual(nd.sealingPolicy(), { salary: ['hr'] });
  return { dir, sarah, encryption };
}

test('attack: write a confidential document in the clear by omitting the encryption key',
  async () => {
    // The classic downgrade: the caller "forgets" to pass encryption and writes a plaintext
    // salary. mcp/server.mjs and a browser tab are exactly this caller today.
    const { dir, sarah } = await policyWorkspaceOnDisk();
    const blind = await open({
      fs: nodeFs(dir),
      identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
      clock: fixedClock('2027-11-04T09:00:00Z'), tzOffsetMinutes: 60,
      // note: no encryption, no vault — the omission IS the attack
    });
    const attempt = await blind.perform({
      op: 'create', entity: 'salary', id: 'S-1', doc: { 'gross-monthly': '5400.00 EUR' },
    });
    assert.ok(attempt.rejected, 'a declared-confidential entity must never be written in the clear');
    assert.equal(attempt.rejected[0].code, 'encryption-not-configured');
  });

test('attack: declare a confidential entity, then perform with a sealFor that drops it',
  async () => {
    const dir = temp('narrow');
    const sarah = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
    const encryption = await generateEncryptionKeyPair();
    const nd = await open({
      fs: nodeFs(dir), identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
      seed: policyModel(), clock: fixedClock(), tzOffsetMinutes: 60,
      roles: ['hr-manager'], encryption, sealed: { salary: ['hr'] },
    });
    const narrowed = await nd.perform({
      op: 'create', entity: 'salary', id: 'X', doc: { 'gross-monthly': '1.00 EUR' },
      sealFor: ['board'],
    });
    assert.ok(narrowed.rejected);
    assert.equal(narrowed.rejected[0].code, 'sealing-narrowed');
  });

test('FINDING F-2 (real defect, kept failing on purpose): reopening a workspace while passing '
   + 'the IDENTICAL sealing policy crashes the runtime', async () => {
    // readSettings (runtime/kernel.js) intends: a caller that passes a `sealed` table different
    // from the recorded one gets a descriptive refusal; a caller passing the SAME table opens
    // normally. What actually happens is a ReferenceError — `normalizeSealedTable` is called at
    // kernel.js:3002 and defined nowhere — so open() crashes for BOTH. The security property
    // holds by accident (you cannot relax the policy; the process dies first), but the intended
    // refusal message is dead code and every caller that passes the documented option dies.
    const { dir, sarah, encryption } = await policyWorkspaceOnDisk();

    // The attack half still fails closed: a relaxation attempt throws. (Today it throws the
    // ReferenceError rather than the intended descriptive refusal — the outcome is closed,
    // the reason is a bug.)
    await assert.rejects(() => open({
      fs: nodeFs(dir), identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
      clock: fixedClock('2027-11-05T09:00:00Z'), tzOffsetMinutes: 60,
      encryption, sealed: {},
    }), 'relaxing the recorded policy must never succeed');

    // The defect: passing the policy the repository ACTUALLY records must open, and does not.
    const reopened = await open({
      fs: nodeFs(dir), identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: sarah },
      clock: fixedClock('2027-11-05T10:00:00Z'), tzOffsetMinutes: 60,
      encryption, sealed: { salary: ['hr'] },
    });
    assert.deepEqual(reopened.sealingPolicy(), { salary: ['hr'] });
  });

// =============================================================================================
// 6 — MONEY PATH. The claim under attack (gate condition 2, FD-1): no float ever touches a
// monetary path. Attacker model: Mallory controls a JSON document and will put a Number where
// an amount belongs, or a token whose precision exceeds the currency's scale.
// =============================================================================================

test('attack: every float-injection path into money is refused by name', () => {
  const refuses = (name, fn, code) => {
    assert.throws(fn, (e) => {
      assert.ok(e instanceof Money.MoneyError, `${name} threw ${e.constructor.name}, not MoneyError`);
      if (code) assert.equal(e.code, code, name);
      return true;
    }, `${name} must throw`);
  };

  // A Number where money belongs — the constructor, the coercion boundary, the arithmetic.
  refuses('money(4.99)', () => Money.money(4.99));
  refuses('toMoney(4.99)', () => Money.toMoney(4.99), 'not-a-string');
  refuses('fromMinor(499.0)', () => Money.fromMinor(499.0, 'EUR'), 'not-a-bigint');
  refuses('add(token, 0.1)', () => Money.add(Money.money('1.00 EUR'), 0.1));
  refuses('multiply(token, 1.19)', () => Money.multiply(Money.money('10.00 EUR'), 1.19));

  // Numeric coercion of a Money value — the silent IEEE-754 trap.
  refuses('Number(money)', () => Number(Money.money('1.00 EUR')), 'numeric-coercion');
  refuses('money + money', () => Money.money('1.00 EUR') + Money.money('1.00 EUR'), 'numeric-coercion');

  // Tokens that smuggle float semantics into a string.
  refuses('money("1e3 EUR") — exponent notation', () => Money.money('1e3 EUR'));
  refuses('money("4.999 EUR") — over-precision', () => Money.money('4.999 EUR'));
  refuses('money("NaN EUR")', () => Money.money('NaN EUR'));
  refuses('money("Infinity EUR")', () => Money.money('Infinity EUR'));

  // Controls: the honest paths work, or every refusal above is just a broken API.
  assert.equal(Money.toString(Money.money('4.99 EUR')), '4.99 EUR');
  assert.equal(Money.toString(Money.fromMinor(499n, 'EUR')), '4.99 EUR');
  assert.equal(Money.toString(Money.multiply(Money.money('10.00 EUR'), '1.19')), '11.90 EUR');
  assert.equal(Money.toString(Money.add(Money.money('1.00 EUR'), Money.money('0.10 EUR'))), '1.10 EUR');
});
