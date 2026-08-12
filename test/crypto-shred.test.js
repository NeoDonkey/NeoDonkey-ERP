// test/crypto-shred.test.js — gate item 5's second half: GDPR erasure by destroying a DEK **while
// the GoBD chain stays verifiable**.
//
// Appendix VII calls this "the most elegant known resolution of the GoBD-vs-GDPR conflict". The first
// half of the claim is easy and proves nothing — any system can delete data. The half that is worth
// a test is the one nobody usually writes: after the key is gone, does the audit chain still hold?
// So every assertion about the chain in this file is made by **real git**, shelled out to:
//
//   • `git fsck --strict` — the object database is intact, nothing dangling, nothing rewritten;
//   • `git log --format=%G?` with a real `allowedSignersFile` — every commit still reports `G`;
//   • `git log --show-signature` — a human sees "Good \"git\" signature" on each one;
//   • `git cat-file` — the shredded blob is still there, byte-identical, hash unchanged;
//   • `git status --porcelain` — the vault is not in the working tree, which is checkable rather
//     than merely asserted.
//
// Plus one thing `git` cannot tell us and a reviewer will ask: **is the key really not in history?**
// That is answered by walking every object in the database (`git cat-file --batch-all-objects`) and
// searching for the key material and for the plaintext. If either turned up, the erasure would be
// theatre and this file would be a lie.
//
// The second test is the finding that made the vault necessary, demonstrated rather than argued: a
// wrapped subject key committed to git is recoverable forever with one command, and the "fix" of
// rewriting history destroys exactly the signatures GoBD depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFs } from '../runtime/git/fs-node.js';
import { memFs } from '../runtime/git/fs.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { encodeCommit, commitPayload } from '../runtime/git/objects.js';
import { generateIdentity, exportPublicSsh, b64encode, b64decode, utf8 } from '../runtime/identity/ed25519.js';
import { signPayload, verifyPayload, allowedSignersLine, SSHSIG_NAMESPACE_GIT } from '../runtime/identity/sshsig.js';
import { materialize } from '../runtime/read/index.js';
import {
  generateEncryptionKeyPair, enrolment as enrol, CRYPTO_PATHS, jsonBytes,
  hkdf, unwrapSecret, gcmDecrypt, subjectWrapInfo, keyIdOf, generateDek,
} from '../runtime/crypto/keys.js';
import { seal, sealedPath, parseFrame } from '../runtime/crypto/envelope.js';
import { createGroup, manifestFile, offboard } from '../runtime/crypto/groups.js';
import { decryptingReader, keyringFromRepo } from '../runtime/crypto/reader.js';
import {
  vault, createSubjectKey, subjectRecordFile, storeSubjectKey, loadSubjectKey, attachVault,
  sealForSubject, eraseSubject, verifyErasure,
  SUBJECT_FORMAT, SUBJECT_WRAP_FORMAT, ERASURE_FORMAT, TOMBSTONE_FORMAT, DEFAULT_VAULT_PREFIX,
} from '../runtime/crypto/shred.js';

const AUTHOR = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' };
const T0 = 1_754_251_200;   // injected, never Date.now()
const TZ = 120;

const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-shred-${tag}-`));
const git = (dir, ...args) => execFileSync('git', args, {
  cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const dec = new TextDecoder();

/**
 * Every byte of every object in the database, including unreachable ones, as one latin1 string so a
 * byte search is exact. This is the check a reviewer would run by hand and the only honest way to
 * answer "is the key in history".
 */
const objectDatabase = (dir) => execFileSync(
  'git', ['cat-file', '--batch-all-objects', '--batch'],
  { cwd: dir, encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 },
);

// ---------------------------------------------------------------------------------------------
// the company: an HR group, a customer with PII, a salary, and four signed commits
// ---------------------------------------------------------------------------------------------

/** The PII. A real name and a real address, because those are the strings that must vanish. */
const PII = {
  'display-name': 'Jonas Hartmann',
  street: 'Musterstrasse 14',
  city: '10999 Berlin',
  email: 'jonas.hartmann@example.invalid',
};
const SUBJECT = 'customer/C-1042';

async function person(local) {
  const principal = `${local}@neodonkey.eu`;
  const signing = await generateIdentity({ comment: principal });
  const encryption = await generateEncryptionKeyPair();
  return { principal, signing, encryption, enrolment: await enrol({ signing, encryption, principal }) };
}

async function company() {
  const dir = temp('company');
  const vaultDir = temp('vault');           // NOT inside the repo. The point of the whole file.
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  const v = vault(nodeFs(vaultDir));

  const sarah = await person('sarah');
  const anna = await person('anna');
  const pub = await exportPublicSsh(sarah.signing, AUTHOR.email);
  let time = T0;
  const sign = (payload) => signPayload(sarah.signing, payload, SSHSIG_NAMESPACE_GIT);
  const commit = async (files, message) => {
    time += 3600;
    const oid = await r.commit({ files, message, author: AUTHOR, time, tzOffsetMinutes: TZ, sign });
    await r.checkout();
    return oid;
  };

  const hr = await createGroup({ id: 'hr', title: 'HR', enrolments: [sarah.enrolment, anna.enrolment] });
  const groups = [{ id: 'hr', epoch: 1, secret: hr.secret }];

  // ---- commit 1: the group exists
  const files = new Map([
    [manifestFile(hr.manifest).path, manifestFile(hr.manifest).bytes],
    [CRYPTO_PATHS.enrolment(sarah.principal), jsonBytes(sarah.enrolment)],
    [CRYPTO_PATHS.enrolment(anna.principal), jsonBytes(anna.enrolment)],
    ['README.md', utf8('# Sarah Weber — Einzelunternehmen\n\nEs ist einfach ein Ordner.\n')],
  ]);
  const c1 = await commit(new Map(files), 'hr group created');

  // ---- the subject key: three separable things, going to three different places
  const subject = await createSubjectKey({ subject: SUBJECT, groups });
  assert.equal(subject.record.state, 'live');
  await storeSubjectKey(v, subject.wrap);                     // the vault, and only the vault

  const invoiceDoc = await sealForSubject({
    entity: 'customer-invoice', name: 'RE-2027-0042', keyId: subject.keyId, key: subject.key,
    doc: { customer: SUBJECT, ...PII, 'gross-amount': '119.00 EUR', 'vat-amount': '19.00 EUR' },
  });
  const contactDoc = await sealForSubject({
    entity: 'customer', name: 'C-1042', keyId: subject.keyId, key: subject.key,
    doc: { customer: SUBJECT, ...PII },
  });
  const salaryDoc = await seal({
    entity: 'salary', name: '2027-Q3-anna', doc: { 'gross-monthly': '5400.00 EUR' },
    key: { kind: 'dek', groups },
  });

  // ---- commit 2: the encrypted documents and the *public* subject record
  const rf = subjectRecordFile(subject.record);
  files.set(rf.path, rf.bytes);
  files.set(sealedPath(invoiceDoc), invoiceDoc.bytes);
  files.set(sealedPath(contactDoc), contactDoc.bytes);
  files.set(sealedPath(salaryDoc), salaryDoc.bytes);
  const c2 = await commit(new Map(files), 'customer C-1042 invoiced; salary sealed for hr');

  // ---- commit 3: ordinary business afterwards, so the erasure is not the tip of the chain
  files.set('documents/invoice/INV-0002.json',
    jsonBytes({ entity: 'invoice', id: 'INV-0002', 'net-amount': '100.00 EUR' }));
  const c3 = await commit(new Map(files), 'invoice INV-0002');

  return {
    dir, vaultDir, fs, r, v, sarah, anna, hr, groups, subject, pub, commit, files,
    docs: { invoiceDoc, contactDoc, salaryDoc },
    commits: [c1, c2, c3],
  };
}

/** HEAD as `Map<path, Bytes>`. */
async function filesAtHead(r) {
  const out = new Map();
  for (const [path, oid] of await r.readTreeAtHead()) out.set(path, await r.readBlob(oid));
  return out;
}

/**
 * A peer's keyring, vault-backed. Built in two steps here so `attachVault` — the one-line call that
 * makes `kind: "subject"` envelopes openable without `groups.js` knowing the vault format — is
 * exercised directly as well as through `keyringFromRepo`'s `vault` option.
 */
async function ringFor(c, p) {
  const ring = await keyringFromRepo({
    files: await filesAtHead(c.r), principal: p.principal, encryption: p.encryption,
  });
  return attachVault(ring, c.v);
}

/** An `allowed_signers` file, kept OUTSIDE the work tree so `git status` stays honest. */
function signersFile(pub) {
  const path = join(temp('signers'), 'allowed_signers');
  writeFileSync(path, `${allowedSignersLine(AUTHOR.email, pub)}\n`);
  return path;
}

// =============================================================================================
// gate item 5 — both halves, in one repository
// =============================================================================================

test('gate item 5: a customer\'s PII becomes permanently unreadable AND the commit chain still '
   + 'verifies end to end — real git fsck, real signatures, blobs byte-identical', async () => {
  const c = await company();
  const { dir, r, v, subject, docs } = c;

  // ---------------------------------------------------------------------------------------------
  // before: HR can read the customer's PII, because that is what the group is for
  // ---------------------------------------------------------------------------------------------
  const sarahRing = await ringFor(c, c.sarah);
  const openedBefore = await sarahRing.open(docs.contactDoc.bytes, sealedPath(docs.contactDoc));
  assert.equal(openedBefore.doc['display-name'], 'Jonas Hartmann');
  assert.equal(openedBefore.via, `subject:${subject.keyId}`);
  assert.equal(openedBefore.nameVerified, true);
  assert.deepEqual(sarahRing.cachedSubjectKeys(), [subject.keyId]);

  const indexBefore = await indexThrough(c, sarahRing);
  assert.deepEqual(indexBefore.idx.entities(), ['customer', 'customer-invoice', 'invoice', 'salary']);

  // ---------------------------------------------------------------------------------------------
  // the erasure request
  // ---------------------------------------------------------------------------------------------
  const erasedPaths = [sealedPath(docs.contactDoc), sealedPath(docs.invoiceDoc)];
  const result = await eraseSubject({
    vault: v,
    record: subject.record,
    reason: 'GDPR Art. 17 erasure request received in writing',
    requestedBy: 'sarah@neodonkey.eu',
    documents: erasedPaths,
    keyrings: [sarahRing],
    at: '2027-11-03T09:14:00Z',
  });
  assert.equal(result.destroyed, true, 'the vault really held the key and really lost it');
  assert.equal(result.keyringsCleared, 1);
  assert.equal(result.record.state, 'erased');
  assert.deepEqual([...result.files.keys()].sort(),
    [CRYPTO_PATHS.erasure(subject.keyId), CRYPTO_PATHS.subject(subject.keyId)]);

  // The two repo files carry NO key material. Checked, not assumed: this is the one place a
  // hopeful implementation would leak the thing it just destroyed.
  const erasureBytes = [...result.files.values()].map((b) => dec.decode(b)).join('\n');
  for (const needle of [b64encode(subject.key), ...subject.wrap.wraps.map((w) => w.wrapped)]) {
    assert.equal(erasureBytes.includes(needle), false, 'an erasure record leaked key material');
  }

  // ---- commit 4: the erasure is itself a signed, dated, auditable commit
  const files = await filesAtHead(r);
  for (const [p, b] of result.files) files.set(p, b);
  const c4 = await c.commit(files, `GDPR erasure: subject key for ${SUBJECT} destroyed`);

  // ---------------------------------------------------------------------------------------------
  // HALF ONE — the plaintext is genuinely unrecoverable
  // ---------------------------------------------------------------------------------------------
  const proof = await verifyErasure({
    vault: v, keyId: subject.keyId,
    envelopes: [docs.contactDoc.bytes, docs.invoiceDoc.bytes],
    keyrings: [sarahRing, await ringFor(c, c.anna)],
  });
  assert.equal(proof.unrecoverable, true, JSON.stringify(proof, null, 2));
  assert.equal(proof.vaultEntryGone, true);
  assert.equal(proof.tombstonePresent, true);
  assert.deepEqual(proof.cached, [], 'a key still in a process\'s memory is unsaved, not erased');
  assert.deepEqual([...new Set(proof.attempts.map((a) => a.reason))], ['subject-key-destroyed'],
    'every attempt by every keyring over every document must fail, with the reason that says why');

  // A peer that restarts and rebuilds everything from the repository and the vault gets the same
  // answer — the refusal is a property of the store, not of a cache.
  const freshRing = await ringFor(c, c.sarah);
  await assert.rejects(() => freshRing.open(docs.contactDoc.bytes, sealedPath(docs.contactDoc)),
    (e) => {
      assert.equal(e.reason, 'subject-key-destroyed');
      assert.match(e.message, /still hashed into the commit chain, and permanently unreadable/);
      return true;
    });

  // The erasure is *targeted*: everything else the group could read, it still reads.
  const after = await indexThrough(c, freshRing);
  assert.deepEqual(after.idx.entities(), ['invoice', 'salary'],
    'the customer entities are gone from the index entirely; the salary is untouched');
  assert.equal(after.idx.get('salary', docs.salaryDoc.id)['gross-monthly'], '5400.00 EUR');
  assert.equal(after.read.stats().opaque, 2);
  assert.deepEqual(after.read.stats().byReason, { 'subject-key-destroyed': 2 });

  // ---------------------------------------------------------------------------------------------
  // HALF TWO — the GoBD chain. This is the half that makes the first one interesting.
  // ---------------------------------------------------------------------------------------------
  const fsck = git(dir, 'fsck', '--strict', '--no-progress');
  assert.equal(fsck.trim(), '', `git fsck --strict after a GDPR erasure said:\n${fsck}`);
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress', '--unreachable').trim(), '',
    'no unreachable objects either: nothing was rewritten and nothing was orphaned');

  assert.equal(git(dir, 'status', '--porcelain').trim(), '',
    'the vault is not in the working tree — if it were, git would report it here');

  // Every signature, judged by real git, over the whole chain including the erasure commit.
  const signers = signersFile(c.pub);
  const verdicts = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--format=%G? %H')
    .trim().split('\n');
  assert.equal(verdicts.length, 4, 'four commits: setup, documents, business as usual, erasure');
  assert.deepEqual([...new Set(verdicts.map((l) => l.split(' ')[0]))], ['G'],
    `real git must report a good signature for every commit, got:\n${verdicts.join('\n')}`);
  const shown = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--show-signature');
  assert.equal((shown.match(/Good "git" signature/g) ?? []).length, 4);

  // Positive control for the check itself. A `G` verdict is only evidence if a wrong key produces
  // something else; without this, an empty or misread signers file would make the assertion above
  // pass for the wrong reason. (Standing rule 5: never report a pass you did not observe.)
  const strangerKey = await exportPublicSsh(await generateIdentity({ comment: AUTHOR.email }), AUTHOR.email);
  const wrongSigners = signersFile(strangerKey);
  const wrongVerdicts = git(dir, '-c', `gpg.ssh.allowedSignersFile=${wrongSigners}`, 'log', '--format=%G?')
    .trim().split('\n');
  assert.equal(wrongVerdicts.includes('G'), false,
    `%G? must not say G for a key that did not sign, got ${wrongVerdicts.join(',')}`);

  // The chain is a chain: four commits, single parents, HEAD is the erasure.
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '4');
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), c4);
  const ourLog = await r.log();
  assert.deepEqual(ourLog.map((e) => e.oid), [c4, ...c.commits.slice().reverse()]);
  for (const [i, entry] of ourLog.entries()) {
    assert.equal(await verifyPayload(c.pub, entry.payload, entry.signature, SSHSIG_NAMESPACE_GIT), true,
      `our own verifier must also accept commit ${i} (${entry.oid})`);
    assert.deepEqual(entry.parents, i === ourLog.length - 1 ? [] : [ourLog[i + 1].oid]);
  }

  // The shredded blobs are still there, byte-identical, with the hashes GoBD recorded. Asked of
  // git, and compared against the bytes we sealed — not against our own idea of them.
  for (const [name, doc] of Object.entries({ contact: docs.contactDoc, invoice: docs.invoiceDoc })) {
    const path = sealedPath(doc);
    const oidNow = git(dir, 'rev-parse', `HEAD:${path}`).trim();
    const oidThen = git(dir, 'rev-parse', `${c.commits[1]}:${path}`).trim();
    assert.equal(oidNow, oidThen, `${name}: the blob's hash changed, so the chain would not verify`);
    const raw = execFileSync('git', ['cat-file', 'blob', oidNow],
      { cwd: dir, maxBuffer: 8 * 1024 * 1024 });
    assert.deepEqual([...new Uint8Array(raw)], [...doc.bytes],
      `${name}: the ciphertext in the repository is not the ciphertext we committed`);
    // and it is still an envelope a human in 2057 can inspect without any key at all
    assert.equal(parseFrame(new Uint8Array(raw)).header.key['key-id'], subject.keyId);
  }

  // The erasure is auditable *from the repository*: a Betriebsprüfer reads the record, not our word.
  const record = JSON.parse(dec.decode(files.get(CRYPTO_PATHS.subject(subject.keyId))));
  const erasure = JSON.parse(dec.decode(files.get(CRYPTO_PATHS.erasure(subject.keyId))));
  assert.equal(record.format, SUBJECT_FORMAT);
  assert.equal(record.state, 'erased');
  assert.equal(record.subject, SUBJECT);
  assert.equal(erasure.format, ERASURE_FORMAT);
  assert.equal(erasure['key-destroyed'], true);
  assert.equal(erasure['requested-by'], 'sarah@neodonkey.eu');
  assert.match(erasure.reason, /GDPR Art\. 17/);
  assert.equal(erasure.at, '2027-11-03T09:14:00Z');
  assert.deepEqual(erasure.documents, erasedPaths.slice().sort());
  assert.match(erasure.note, /Unveränderbarkeit, Vollständigkeit, Nachvollziehbarkeit/);
  assert.match(erasure.note, /Nothing was removed from the books/);

  // ---------------------------------------------------------------------------------------------
  // the question a reviewer asks next: is the key REALLY not in history?
  // ---------------------------------------------------------------------------------------------
  const db = objectDatabase(dir);
  for (const needle of [b64encode(subject.key), ...subject.wrap.wraps.map((w) => w.wrapped)]) {
    assert.equal(db.includes(needle), false,
      'key material for a shreddable key is in the git object database — the erasure is theatre');
  }
  // And the plaintext itself appears nowhere, which is what makes the ciphertext ciphertext.
  for (const needle of Object.values(PII)) {
    assert.equal(db.includes(needle), false, `the plaintext ${JSON.stringify(needle)} is in git`);
  }
  // The control: the *pseudonymous* reference legitimately does remain, because a retention
  // obligation keeps it. Stating this is part of being honest about what erasure means here.
  assert.equal(db.includes(SUBJECT), true, 'the subject reference is kept, deliberately');
  assert.equal(db.includes(subject.keyId), true, 'and so is the destroyed key\'s public id');
});

/** One peer's index, built through the decrypting reader. */
async function indexThrough(c, ring) {
  const read = decryptingReader({ readBlob: c.r.readBlob, keyring: ring });
  const idx = await materialize({ readTree: () => c.r.readTreeAtHead(), readBlob: read });
  return { read, idx };
}

// =============================================================================================
// the finding: why the vault exists at all
// =============================================================================================

test('the finding, demonstrated: a wrapped subject key committed to git is recoverable forever, and '
   + 'the only way to remove it destroys the signatures GoBD depends on', async () => {
  // This is the architectural fact `shred.js` is built around, and it is the one thing in this area
  // that must not be taken on trust. If committing the key were survivable, the vault — the single
  // mutable store in an otherwise append-only system — would be unnecessary complexity.
  const dir = temp('naive');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  const sarah = await person('sarah');
  const pub = await exportPublicSsh(sarah.signing, AUTHOR.email);
  const sign = (payload) => signPayload(sarah.signing, payload, SSHSIG_NAMESPACE_GIT);

  const hr = await createGroup({ id: 'hr', title: 'HR', enrolments: [sarah.enrolment] });
  const groups = [{ id: 'hr', epoch: 1, secret: hr.secret }];
  const subject = await createSubjectKey({ subject: SUBJECT, groups });
  const pii = await sealForSubject({
    entity: 'customer', name: 'C-1042', keyId: subject.keyId, key: subject.key, doc: { ...PII },
  });

  // The naive design: the wrap goes in the repo, next to the record.
  const wrongPath = `crypto/subject-keys/${subject.keyId}.json`;
  const files = new Map([
    [manifestFile(hr.manifest).path, manifestFile(hr.manifest).bytes],
    [wrongPath, jsonBytes(subject.wrap)],
    [sealedPath(pii), pii.bytes],
  ]);
  const c1 = await r.commit({ files, message: 'customer C-1042', author: AUTHOR, time: T0, tzOffsetMinutes: TZ, sign });
  const keyOid = git(dir, 'rev-parse', `${c1}:${wrongPath}`).trim();

  // The "erasure": remove the file and commit. HEAD no longer has it. `git status` is clean. A
  // dashboard would show the customer as erased.
  files.delete(wrongPath);
  const c2 = await r.commit({ files, message: 'GDPR erasure (naive)', author: AUTHOR, time: T0 + 3600, tzOffsetMinutes: TZ, sign });
  await r.checkout();
  assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  assert.equal((await r.readTreeAtHead()).has(wrongPath), false, 'HEAD looks erased');
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');

  // Positive control for the object-database scan the main test relies on. That scan asserts a
  // *negative* — "the key material is not in git" — and a negative assertion is worthless unless the
  // same search finds the material when it really is there. Here it is there, so it must be found.
  const naiveDb = objectDatabase(dir);
  for (const w of subject.wrap.wraps) {
    assert.equal(naiveDb.includes(w.wrapped), true,
      'objectDatabase() must find committed key material, or the main test proves nothing');
  }
  assert.equal(naiveDb.includes(b64encode(subject.key)), false,
    'even the naive design never writes the RAW key — only the wrap, which is bad enough');

  // And it is recoverable with one command, by anyone holding the repo, forever.
  const recovered = JSON.parse(git(dir, 'cat-file', 'blob', keyOid));
  assert.equal(recovered.format, SUBJECT_WRAP_FORMAT);
  assert.match(git(dir, 'log', '-p', '--', wrongPath), /neodonkey-subject-wrap/);

  // Not just the record — the actual plaintext, end to end, from git history plus a group secret.
  const w = recovered.wraps[0];
  const kek = await hkdf(hr.secret, b64decode(w.salt), subjectWrapInfo(w.group, w.epoch, subject.keyId));
  const key = await unwrapSecret(kek, b64decode(w.wrapped));
  assert.deepEqual([...key], [...subject.key], 'the destroyed key is back');
  const { headerBytes, header, ciphertext } = parseFrame(pii.bytes);
  const plain = await gcmDecrypt({
    key, iv: b64decode(header.content.iv), ciphertext, aad: headerBytes,
  });
  assert.match(dec.decode(plain), /Jonas Hartmann/,
    'the "erased" PII is readable again — this is why an append-only store cannot hold a '
    + 'shreddable key');

  // The other route — rewriting history so the key was never committed — destroys the chain.
  // Demonstrated on the arithmetic, not by running filter-branch: the signature covers the commit
  // bytes, and the commit bytes contain the tree oid.
  const original = (await r.log()).find((e) => e.oid === c1);
  const rewrittenTree = await (async () => {
    const clean = new Map(files);
    clean.set(sealedPath(pii), pii.bytes);
    const dir2 = temp('rewrite');
    const r2 = repo(nodeFs(dir2));
    await initRepo(nodeFs(dir2));
    await r2.commit({ files: clean, message: 'x', author: AUTHOR, time: T0, tzOffsetMinutes: TZ });
    return (await r2.log())[0];
  })();
  const rewrittenPayload = commitPayload(encodeCommit({
    tree: rewrittenTree.oid, parents: [], author: AUTHOR, committer: AUTHOR,
    time: T0, tzOffsetMinutes: TZ, message: original.message, signature: null,
  }));
  assert.notDeepEqual([...rewrittenPayload], [...original.payload]);
  assert.equal(await verifyPayload(pub, rewrittenPayload, original.signature, SSHSIG_NAMESPACE_GIT), false,
    'a rewritten commit is not covered by the signature over the original — every signature from '
    + 'the rewrite point onward is invalidated, which is precisely the GoBD property (Unveränder'
    + 'barkeit) that this whole design exists to preserve');
  // and the descendant commit's parent pointer no longer resolves, so the chain is broken twice over
  assert.equal((await r.log()).find((e) => e.oid === c2).parents[0], c1);
});

// =============================================================================================
// fail closed — three outcomes, three reasons, and none of them "probably fine"
// =============================================================================================

test('destroyed, missing and not-a-member are three different answers, and a missing key is never '
   + 'reported as an honoured erasure', async () => {
  const c = await company();
  const ring = await ringFor(c, c.sarah);

  // (1) present and openable
  assert.equal((await loadSubjectKey({ vault: c.v, keyId: c.subject.keyId, keyring: ring })).length, 32);

  // (2) absent, with no tombstone — a peer that was never given the key, or an unreplicated vault.
  // Reporting this as "erased" would be a lie to a regulator, so it has its own reason.
  const orphanId = await keyIdOf(generateDek());
  await assert.rejects(() => loadSubjectKey({ vault: c.v, keyId: orphanId, keyring: ring }), (e) => {
    assert.equal(e.reason, 'subject-key-missing');
    assert.match(e.message, /no tombstone says it was destroyed/);
    return true;
  });

  // (3) present but wrapped for a group this peer is not in
  const other = await createGroup({ id: 'board', title: 'Board', enrolments: [c.anna.enrolment] });
  const boardOnly = await createSubjectKey({
    subject: 'customer/C-9999', groups: [{ id: 'board', epoch: 1, secret: other.secret }],
  });
  await storeSubjectKey(c.v, boardOnly.wrap);
  const ida = await person('ida');
  const idaRing = await keyringFromRepo({
    files: await filesAtHead(c.r), principal: ida.principal, encryption: ida.encryption, vault: c.v,
  });
  await assert.rejects(() => loadSubjectKey({ vault: c.v, keyId: boardOnly.keyId, keyring: idaRing }),
    (e) => e.reason === 'not-a-member');

  // (4) a vault entry that is not what it claims to be
  await c.v.write(CRYPTO_PATHS.vaultSubject('bogus'), jsonBytes({ format: 'something-else' }));
  await assert.rejects(() => loadSubjectKey({ vault: c.v, keyId: 'bogus', keyring: ring }),
    (e) => e.reason === 'not-a-subject-record');

  // (5) after destruction, the tombstone answer wins and says why
  await eraseSubject({
    vault: c.v, record: c.subject.record, reason: 'test', requestedBy: 'sarah@neodonkey.eu',
    keyrings: [ring],
  });
  await assert.rejects(() => loadSubjectKey({ vault: c.v, keyId: c.subject.keyId, keyring: ring }),
    (e) => e.reason === 'subject-key-destroyed');
});

test('an erasure that cannot be defended is refused: no reason, no requester, or already done',
  async () => {
    const c = await company();
    const base = { vault: c.v, record: c.subject.record };
    for (const bad of [{}, { reason: 'x' }, { requestedBy: 'y' }, { reason: '', requestedBy: 'y' }]) {
      await assert.rejects(() => eraseSubject({ ...base, ...bad }),
        (e) => e.reason === 'not-a-subject-record');
    }
    await assert.rejects(() => eraseSubject({ vault: c.v, record: { format: 'nope' }, reason: 'r', requestedBy: 'q' }),
      (e) => e.reason === 'not-a-subject-record');

    const done = await eraseSubject({ ...base, reason: 'r', requestedBy: 'q' });
    await assert.rejects(() => eraseSubject({ vault: c.v, record: done.record, reason: 'r', requestedBy: 'q' }),
      (e) => {
        assert.equal(e.reason, 'subject-already-erased');
        return true;
      });
    // Erasing a key this peer never had is still recorded, and says so rather than claiming success
    // it did not have: `destroyed: false` is the honest report of limit 1 in shred.js's header.
    const elsewhere = await createSubjectKey({ subject: 'customer/C-2', groups: c.groups });
    const partial = await eraseSubject({
      vault: c.v, record: elsewhere.record, reason: 'r', requestedBy: 'q',
    });
    assert.equal(partial.destroyed, false);
    assert.equal(partial.record.state, 'erased');
  });

test('a keyring not handed to eraseSubject keeps the key in memory, and verifyErasure says so '
   + 'instead of reporting success', async () => {
  // shred.js's honest limit 3, as a test. This is the failure mode a plausible implementation has:
  // the vault file is gone, the tombstone is written, the dashboard says "erased", and a long-lived
  // process is still holding the key and still serving plaintext.
  const c = await company();
  const forgotten = await ringFor(c, c.anna);
  await forgotten.open(c.docs.contactDoc.bytes);            // caches the subject key
  assert.deepEqual(forgotten.cachedSubjectKeys(), [c.subject.keyId]);

  await eraseSubject({
    vault: c.v, record: c.subject.record, reason: 'r', requestedBy: 'sarah@neodonkey.eu',
    keyrings: [],                                            // the mistake
  });

  const bad = await verifyErasure({
    vault: c.v, keyId: c.subject.keyId,
    envelopes: [c.docs.contactDoc.bytes], keyrings: [forgotten],
  });
  assert.equal(bad.unrecoverable, false, 'a cached key is not an erased key');
  assert.deepEqual(bad.cached, [c.subject.keyId]);
  assert.equal(bad.vaultEntryGone, true);
  assert.deepEqual(bad.attempts.map((a) => a.reason), ['OPENED']);

  // Doing it properly closes it, with no further vault work.
  forgotten.forget(c.subject.keyId);
  const good = await verifyErasure({
    vault: c.v, keyId: c.subject.keyId,
    envelopes: [c.docs.contactDoc.bytes], keyrings: [forgotten],
  });
  assert.equal(good.unrecoverable, true);
  assert.deepEqual(good.attempts.map((a) => a.reason), ['subject-key-destroyed']);
});

// =============================================================================================
// the vault itself
// =============================================================================================

test('the vault is destroy-then-unlink, and its paths can never collide with a repo path', async () => {
  // Overwrite-then-unlink is best effort on a copy-on-write filesystem (shred.js limit 2). What can
  // be proven is that it is attempted, with the right length, before the unlink — observed through a
  // recording adapter rather than asserted in a comment.
  const calls = [];
  const inner = memFs();
  const recorder = {
    ...inner,
    write: (p, b) => { calls.push(['write', p, b.length]); return inner.write(p, b); },
    remove: (p) => { calls.push(['remove', p]); return inner.remove(p); },
  };
  const v = vault(recorder);
  const groups = [{ id: 'hr', epoch: 1, secret: new Uint8Array(32).fill(1) }];
  const subject = await createSubjectKey({ subject: 'customer/C-3', groups });
  await storeSubjectKey(v, subject.wrap);
  const stored = calls.find((k) => k[0] === 'write');
  calls.length = 0;

  assert.equal(await v.destroy(CRYPTO_PATHS.vaultSubject(subject.keyId)), true);
  assert.deepEqual(calls.map((k) => k[0]), ['write', 'remove'], 'overwrite, then unlink');
  assert.equal(calls[0][2], stored[2], 'the overwrite is the same length as what was there');
  assert.equal(await v.destroy(CRYPTO_PATHS.vaultSubject(subject.keyId)), false,
    'destroying what is not there is false, not a throw and not a claimed success');

  // The one rule the whole file rests on, as an assertion: a vault path is not a repo path.
  assert.equal(CRYPTO_PATHS.vaultSubject('x').startsWith('crypto/'), false);
  const repoPaths = ['group', 'enrolment', 'subject', 'erasure'].map((k) => CRYPTO_PATHS[k]('x'));
  for (const p of repoPaths) assert.match(p, /^crypto\//);
  assert.equal(repoPaths.includes(CRYPTO_PATHS.vaultSubject('x')), false);
  assert.equal(DEFAULT_VAULT_PREFIX, 'vault');

  // And a vault needs a real adapter, refused rather than half-built.
  assert.throws(() => vault(null), (e) => e.reason === 'vault-required');
  assert.throws(() => vault({ read: () => {} }), (e) => e.reason === 'vault-required');

  // `destroy()` is a primitive and writes no tombstone: only `eraseSubject()` does, because only an
  // erasure has a reason and a requester to record. A tombstone written by the primitive would let
  // an accidental deletion masquerade as an honoured request.
  const tombPath = `${CRYPTO_PATHS.vaultSubject(subject.keyId)}.destroyed`;
  assert.equal(await v.has(tombPath), false);
  await eraseSubject({
    vault: v, record: subject.record, reason: 'why', requestedBy: 'who', at: '2027-11-03T09:14:00Z',
  });
  const written = JSON.parse(dec.decode(await v.read(tombPath)));
  assert.equal(written.format, TOMBSTONE_FORMAT);
  assert.equal(written.subject, 'customer/C-3');
  assert.equal(written.reason, 'why');
  assert.equal(written['requested-by'], 'who');
  assert.equal(written.at, '2027-11-03T09:14:00Z');
});

test('a subject-key envelope carries no wrapped key at all — the absence IS the erasability',
  async () => {
    const groups = [{ id: 'hr', epoch: 1, secret: new Uint8Array(32).fill(2) }];
    const subject = await createSubjectKey({ subject: SUBJECT, groups });
    const doc = await sealForSubject({
      entity: 'customer', name: 'C-1042', keyId: subject.keyId, key: subject.key, doc: { ...PII },
    });
    const { header } = parseFrame(doc.bytes);
    assert.equal(header.key.kind, 'subject');
    assert.equal(header.key['key-id'], subject.keyId);
    assert.equal(Object.hasOwn(header.key, 'wraps'), false,
      'a wrap in the header would make the key recoverable from the repo, which is the whole bug');
    assert.deepEqual(header['named-by'], { subject: subject.keyId });
    // The public record names the groups that may open it, so access is auditable without the key.
    assert.deepEqual(subject.record.groups, ['hr@1']);
    assert.equal(subject.record.subject, SUBJECT);
    assert.equal(Object.hasOwn(subject.record, 'wraps'), false,
      'the repo-side record must never carry key material');
  });

// =============================================================================================
// the whole sentence — the four things a company has to be able to do, in one repository
// =============================================================================================

test('the whole sentence: put a salary in an HR group, have a non-member\'s index genuinely not '
   + 'contain it, offboard a member, and shred a customer\'s PII — with git fsck clean throughout',
async () => {
  const c = await company();
  const { dir, r } = c;
  const ida = await person('ida');
  const signers = signersFile(c.pub);
  const clean = (where) => {
    const out = git(dir, 'fsck', '--strict', '--no-progress');
    assert.equal(out.trim(), '', `${where}: git fsck --strict said:\n${out}`);
    assert.equal(git(dir, 'status', '--porcelain').trim(), '', `${where}: working tree not clean`);
    const codes = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--format=%G?')
      .trim().split('\n');
    assert.deepEqual([...new Set(codes)], ['G'], `${where}: a signature stopped verifying`);
  };
  const indexOf = async (p) => {
    const ring = await keyringFromRepo({
      files: await filesAtHead(r), principal: p.principal, encryption: p.encryption, vault: c.v,
    });
    return { ring, ...(await indexThrough(c, ring)) };
  };

  // 1 — the salary is in the HR group, and HR reads it
  clean('after setup');
  assert.equal((await indexOf(c.anna)).idx.get('salary', c.docs.salaryDoc.id)['gross-monthly'],
    '5400.00 EUR');

  // 2 — the intern's index does not contain the table
  const intern = await indexOf(ida);
  assert.deepEqual(intern.idx.entities(), ['invoice']);
  assert.equal(Object.hasOwn(intern.idx.stats().entities, 'salary'), false);
  assert.equal(intern.idx.entities().includes('customer'), false);
  assert.equal(intern.read.stats().opaque, 3);

  // 3 — offboard Anna: one commit, and her index loses the table
  const sarahRing = (await indexOf(c.sarah)).ring;
  const off = await offboard({
    manifest: c.hr.manifest, secrets: c.hr.secrets, principal: c.anna.principal,
    documents: [{ path: sealedPath(c.docs.salaryDoc), bytes: c.docs.salaryDoc.bytes }],
    resolve: sarahRing.resolve,
  });
  const files = await filesAtHead(r);
  for (const p of off.removals) files.delete(p);
  for (const [p, b] of off.writes) files.set(p, b);
  await c.commit(files, `offboard ${c.anna.principal}`);
  clean('after offboarding');
  const annaAfter = await indexOf(c.anna);
  assert.deepEqual(annaAfter.idx.entities(), ['invoice'],
    'the leaver keeps the bytes and loses the table — and the customer entities go with it, because '
    + 'the subject key was wrapped for the group she left');
  assert.equal((await indexOf(c.sarah)).idx.entities().includes('salary'), true);

  // 4 — shred the customer's PII. Note Sarah's keyring must be rebuilt: the subject key is wrapped
  // for hr@1, which she still holds, so the erasure is about the vault and not about membership.
  const before = await indexOf(c.sarah);
  assert.equal(before.idx.entities().includes('customer'), true);
  const erasure = await eraseSubject({
    vault: c.v, record: c.subject.record, reason: 'GDPR Art. 17', requestedBy: c.sarah.principal,
    documents: [sealedPath(c.docs.contactDoc), sealedPath(c.docs.invoiceDoc)],
    keyrings: [before.ring, sarahRing, annaAfter.ring],
    at: '2027-11-04T08:00:00Z',
  });
  const withErasure = await filesAtHead(r);
  for (const [p, b] of erasure.files) withErasure.set(p, b);
  await c.commit(withErasure, 'GDPR erasure: C-1042');

  // and the sentence ends where it has to end
  clean('after the GDPR erasure');
  const after = await indexOf(c.sarah);
  assert.deepEqual(after.idx.entities(), ['invoice', 'salary']);
  assert.deepEqual(after.read.stats().byReason, { 'subject-key-destroyed': 2 });
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '5');
  const db = objectDatabase(dir);
  for (const needle of Object.values(PII)) assert.equal(db.includes(needle), false);
  for (const w of c.subject.wrap.wraps) assert.equal(db.includes(w.wrapped), false);
});
