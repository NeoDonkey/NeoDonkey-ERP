// test/kernel-crypto.test.js — gate item 5, through the front door.
//
// `runtime/crypto/` was finished and proven by agent CRYPTO, and then correctly refused to claim
// gate item 5 met, because `kernel.open()` hard-coded `readBlob: (oid) => repo.readBlob(oid)` and
// `perform()` had no way to say "seal this for group X". Encryption worked at the layer and not
// through the product: a program that composed the modules could do everything Appendix VII
// promises, and a company using `kernel.open()` could do none of it.
//
// So every assertion in this file goes through `kernel.open()`, `kernel.perform()` and the group
// administration methods **and nothing else**. Not one test here imports `runtime/crypto/envelope.js`
// to seal a document or `runtime/crypto/groups.js` to make a group — that is precisely the thing
// `test/crypto-*.test.js` already proves and precisely the thing that was not enough. The only
// crypto imports below are the two a *company* legitimately needs: a key-pair generator and the
// vault constructor, because a personal key pair and a directory outside the repository are the two
// things the kernel cannot invent for you.
//
// The judge of the git-level claims is real git, shelled out to:
//   • `git ls-files` — the plaintext path is absent from the tree. If both paths existed the
//     encryption would be decorative, and this is the first thing a reviewer would check;
//   • `git fsck --strict` (and `--unreachable`) — nothing rewritten, nothing orphaned;
//   • `git log --format=%G?` with a real `allowedSignersFile`, positive-controlled against a key
//     that did not sign — every commit reports `G`;
//   • `git log --show-signature` — a human sees "Good \"git\" signature";
//   • `git log -- crypto/groups/` — the history of who may read what is findable;
//   • `git cat-file --batch-all-objects` — the whole object database, searched for the plaintext.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { open, PATHS, SEALED_NAME, parseSealedTrailer } from '../runtime/kernel.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { allowedSignersLine, SSHSIG_NAMESPACE_GIT, verifyPayload } from '../runtime/identity/sshsig.js';
// The two things a company brings that the kernel cannot invent: a personal encryption key pair,
// and a mutable store that is not the repository.
import { generateEncryptionKeyPair } from '../runtime/crypto/keys.js';
import { vault } from '../runtime/crypto/shred.js';

const TZ = 60;
const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-kc-${tag}-`));
const git = (dir, ...args) => execFileSync('git', args, {
  cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

/** Every byte of every object in the database, including unreachable ones. A byte search. */
const objectDatabase = (dir) => execFileSync(
  'git', ['cat-file', '--batch-all-objects', '--batch'],
  { cwd: dir, encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 },
);

/** Injected, monotonic, never `Date.now()`. Determinism is a non-negotiable. */
const clockFrom = (iso) => {
  let t = Date.parse(iso);
  return () => (t += 1000);
};

/** The strings that must never appear in a non-member's index or in a public commit message. */
const SALARY_NAME = '2027-Q3-anna';
const SALARY = { 'gross-monthly': '5400.00 EUR', grade: 'S3' };
const PII = {
  'display-name': 'Jonas Hartmann',
  street: 'Musterstrasse 14',
  city: '10999 Berlin',
};
const SUBJECT = 'customer/C-1042';

/**
 * A small operating model with two confidential entities, both governed by an entity-level
 * authority so FD-7's strict default is satisfied without turning it off. The model says nothing
 * about encryption — Appendix VII is a property of the *storage*, not of the company's sentences —
 * which is exactly why `sealFor` is an option on `perform()` and not a word in the grammar.
 */
function seed() {
  const m = new Map();
  m.set('operating-model/organisation/hr-manager.md', '# HR manager\n\nHR of this company.\n');
  m.set('operating-model/organisation/intern.md', '# Intern\n\nAn intern.\n');
  m.set('operating-model/information/salary.md', `# Salary

What one person is paid. The single most confidential document a company holds.

## Fields
- gross-monthly: text required — The monthly gross.
- grade: text — The pay grade.

## Identified by
grade

## Authorized by
- create: hr-manager
- update: hr-manager
- delete: hr-manager
`);
  m.set('operating-model/information/customer.md', `# Customer

A customer, including the personal data GDPR Art. 17 applies to.

## Fields
- display-name: text — Their name.
- street: text — Their street.
- city: text — Their city.

## Authorized by
- create: hr-manager
- update: hr-manager
`);
  m.set('operating-model/information/note.md', `# Note

An ordinary, unconfidential document. Proof that sealing is per event, not per workspace.

## Fields
- body: text — What it says.

## Authorized by
- create: hr-manager
- update: hr-manager
`);
  return m;
}

/** One person: an Ed25519 signing pair and an X25519 encryption pair. */
async function person(local, name) {
  const email = `${local}@neodonkey.eu`;
  return {
    email,
    name,
    signing: await generateIdentity({ comment: email }),
    encryption: await generateEncryptionKeyPair(),
  };
}

/** Open the workspace as one person. `encryption`/`vault` omitted reproduces v0.1 exactly. */
const as = (dir, p, at, extra = {}) => open({
  fs: nodeFs(dir),
  identity: { name: p.name, email: p.email, keyPair: p.signing },
  clock: clockFrom(at),
  tzOffsetMinutes: TZ,
  ...extra,
});

/**
 * A company with an HR group, one sealed salary, and three people: Sarah (founder, HR), Anna (HR),
 * Ida (an intern, in no group). Built entirely through the kernel.
 *
 * Each act reopens the workspace where a different peer performs it, because that is what actually
 * happens — Anna publishes her own encryption key on her own machine, and a `files` map held by
 * Sarah's process cannot see it until she reopens.
 */
async function company({ withVault = true } = {}) {
  const dir = temp('repo');
  const vaultDir = temp('vault');          // NOT inside the repo. The whole point of the vault.
  const v = () => (withVault ? { vault: vault(nodeFs(vaultDir)) } : {});

  const sarah = await person('sarah', 'Sarah Weber');
  const anna = await person('anna', 'Anna Klein');
  const ida = await person('ida', 'Ida Sommer');

  // ---- genesis, and the two other peers
  let nd = await as(dir, sarah, '2027-03-01T09:00:00Z', {
    seed: seed(), roles: ['hr-manager'], encryption: sarah.encryption, ...v(),
  });
  assert.deepEqual(nd.modelErrors, [], 'the test model must parse cleanly');
  for (const p of [anna, ida]) {
    const added = await nd.addPeer({
      name: p.name, email: p.email,
      publicKeySsh: await exportPublicSsh(p.signing, p.email),
      roles: p === anna ? ['hr-manager'] : ['intern'],
    });
    assert.ok(added.oid, JSON.stringify(added));
  }

  // ---- each person publishes their own encryption key, signed by their own signing key
  for (const p of [sarah, anna, ida]) {
    const peer = await as(dir, p, '2027-03-02T09:00:00Z', { encryption: p.encryption, ...v() });
    const enrolled = await peer.enrol();
    assert.ok(enrolled.oid, JSON.stringify(enrolled));
    assert.equal(enrolled.enrolment.principal, p.email);
  }

  // ---- the HR group, as a signed commit
  nd = await as(dir, sarah, '2027-03-03T09:00:00Z', { encryption: sarah.encryption, ...v() });
  const created = await nd.createGroup({
    id: 'hr', title: 'Human Resources', members: [sarah.email, anna.email],
  });
  assert.ok(created.oid, JSON.stringify(created));
  assert.equal(created.epoch, 1);

  // ---- one ordinary document and one sealed one, both through perform()
  const note = await nd.perform({
    op: 'create', entity: 'note', id: 'N-1', doc: { body: 'the office plant needs water' },
  });
  assert.ok(note.oid, JSON.stringify(note));
  assert.equal(note.sealed, undefined, 'an unsealed event must gain no new field at all');

  const salary = await nd.perform({
    op: 'create', entity: 'salary', id: SALARY_NAME, doc: { ...SALARY },
    sealFor: ['hr'],
    message: 'a salary sealed for the HR group',
  });
  assert.ok(salary.oid, JSON.stringify(salary));

  return { dir, vaultDir, v, sarah, anna, ida, nd, salary, sealedId: salary.changes[0].id };
}

/** An `allowed_signers` file for every peer, kept OUTSIDE the work tree. */
async function signersFile(people) {
  const path = join(temp('signers'), 'allowed_signers');
  const lines = [];
  for (const p of people) {
    lines.push(allowedSignersLine(p.email, await exportPublicSsh(p.signing, p.email)));
  }
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

/** Real git's verdict on every commit in the repository. */
const verdicts = (dir, signers) => git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`,
  'log', '--format=%G? %H').trim().split('\n');

/** Every string value anywhere in an index — the "not even a trace" assertion. */
const everythingReadable = (idx) =>
  idx.entities().map((e) => JSON.stringify(idx.all(e))).join('\n');

// =============================================================================================
// 1 — the gate question, end to end, through kernel.open() and kernel.perform() alone
// =============================================================================================

test('gate item 5, through the front door: create an HR group, seal a salary into it, a '
   + 'non-member\'s index genuinely does not contain it, offboard a member, and shred a '
   + 'customer\'s PII — with git fsck --strict clean and every commit still G', async () => {
  const c = await company();
  const { dir, sarah, anna, ida, sealedId } = c;

  // ---------------------------------------------------------------------------------------------
  // the member reads it as an ordinary document; encryption is invisible above the read path
  // ---------------------------------------------------------------------------------------------
  const member = await as(dir, anna, '2027-03-04T09:00:00Z', { encryption: anna.encryption, ...c.v() });
  assert.deepEqual(member.query.entities(), ['note', 'salary']);
  const doc = member.query.get('salary', sealedId);
  assert.equal(doc['gross-monthly'], '5400.00 EUR');
  assert.equal(doc.grade, 'S3');
  // The business name comes back, so a member can find a file whose filename is a keyed hash.
  assert.equal(doc[SEALED_NAME], SALARY_NAME);
  assert.deepEqual(
    await member.findSealed({ entity: 'salary', name: SALARY_NAME, group: 'hr' }), doc,
    'seal a document by name through perform(), find it by name through the kernel');

  const status = member.encryptionStatus();
  assert.equal(status.enabled, true);
  assert.deepEqual(status.groups, ['hr']);
  assert.deepEqual(status.epochs, ['hr@1']);
  assert.equal(status.reads.opened, 1, 'one document was decrypted for this index');
  assert.equal(status.reads.opaque, 0);
  assert.deepEqual(status.keyringProblems, []);

  // ---------------------------------------------------------------------------------------------
  // the non-member's index does not CONTAIN the salary — absent, not filtered
  // ---------------------------------------------------------------------------------------------
  const intern = await as(dir, ida, '2027-03-04T10:00:00Z', { encryption: ida.encryption });
  assert.deepEqual(intern.query.entities(), ['note'], 'salary must not be in the entity list');
  const counts = intern.query.stats().entities;
  assert.deepEqual(Object.keys(counts), ['note']);
  assert.equal(Object.hasOwn(counts, 'salary'), false,
    'stats().entities is what mcp/server.mjs publishes — a "salary: 0" entry is already a leak');
  assert.deepEqual(intern.query.all('salary'), []);
  assert.equal(intern.query.get('salary', sealedId), null);
  for (const secret of ['5400', 'S3', SALARY_NAME, 'gross-monthly']) {
    assert.equal(everythingReadable(intern.query).includes(secret), false,
      `the intern's index must not physically contain ${JSON.stringify(secret)}`);
  }
  // And she is told, honestly, that there is something she cannot read. Appendix VII's shadow.
  assert.equal(intern.encryptionStatus().reads.opaque, 1);
  assert.deepEqual(intern.encryptionStatus().reads.byReason, { 'not-a-member': 1 });
  assert.equal(intern.query.stats().opaque, 1);

  // ---------------------------------------------------------------------------------------------
  // a customer's PII, under a shreddable subject key, then erased — both through the kernel
  // ---------------------------------------------------------------------------------------------
  const hr = await as(dir, sarah, '2027-03-05T09:00:00Z', { encryption: sarah.encryption, ...c.v() });
  const pii = await hr.perform({
    op: 'create', entity: 'customer', id: 'C-1042', doc: { ...PII },
    sealFor: { groups: ['hr'], subject: SUBJECT },
    message: 'a customer record, sealed under a key that can be destroyed',
  });
  assert.ok(pii.oid, JSON.stringify(pii));
  assert.equal(pii.sealed[0].subject !== null, true, 'a subject-keyed envelope carries no group wrap');
  assert.deepEqual(pii.sealed[0].groups, []);
  const piiId = pii.changes[0].id;
  assert.equal(hr.query.get('customer', piiId)['display-name'], 'Jonas Hartmann');
  assert.deepEqual(hr.subjects().map((s) => [s.subject, s.state, s.groups]),
    [[SUBJECT, 'live', ['hr@1']]]);

  // Ordinary business afterwards, so the erasure is never the tip of the chain.
  assert.ok((await hr.perform({
    op: 'create', entity: 'note', id: 'N-2', doc: { body: 'quarter closed' },
  })).oid);

  const erased = await hr.eraseSubject({
    subject: SUBJECT,
    reason: 'GDPR Art. 17 erasure request received in writing',
    at: '2027-11-03T09:14:00Z',
  });
  assert.ok(erased.oid, JSON.stringify(erased));
  assert.equal(erased.destroyed, true, 'the vault really held the key and really lost it');
  assert.equal(erased.keyringsCleared, 1, 'a key still in a process\'s memory is unsaved, not erased');
  assert.deepEqual(erased.documents, [PATHS.doc('customer', piiId)]);

  // The customer entity is gone from the index entirely; everything else is untouched.
  assert.deepEqual(hr.query.entities(), ['note', 'salary']);
  assert.equal(hr.query.get('salary', sealedId)['gross-monthly'], '5400.00 EUR');
  assert.deepEqual(hr.encryptionStatus().reads.byReason, { 'subject-key-destroyed': 1 });

  // A peer that restarts and rebuilds everything from the repository and the vault gets the same
  // answer — the refusal is a property of the store, not of a cache.
  const restarted = await as(dir, sarah, '2027-11-04T09:00:00Z',
    { encryption: sarah.encryption, ...c.v() });
  assert.equal(restarted.query.entities().includes('customer'), false);
  assert.deepEqual(restarted.encryptionStatus().reads.byReason, { 'subject-key-destroyed': 1 });
  assert.equal(restarted.subjects()[0].state, 'erased');

  // Nothing anywhere in the object database — reachable or not — holds the PII.
  const objects = objectDatabase(dir);
  for (const needle of Object.values(PII)) {
    assert.equal(objects.includes(needle), false,
      `${needle} is still recoverable from the object database — the erasure is theatre`);
  }
  // Positive control for the search itself: a string that IS in the repo must be found by it.
  assert.equal(objects.includes('the office plant needs water'), true,
    'the object-database search must be able to find a plaintext that is genuinely there');

  // ---------------------------------------------------------------------------------------------
  // offboarding Anna: one signed commit that rotates the key and re-seals the group's documents
  // ---------------------------------------------------------------------------------------------
  const off = await restarted.offboard('hr', anna.email);
  assert.ok(off.oid, JSON.stringify(off));
  assert.equal(off.epoch, 2);
  assert.equal(off.resealed, 1, 'the salary was re-sealed; the erased customer was left alone');
  assert.deepEqual(off.moved, [PATHS.doc('salary', sealedId)],
    're-sealing moves a document, because its filename is a keyed hash of the epoch name key');
  assert.match(off.limitation, /still physically holds the repository/);

  // Sarah still reads the salary, at its new sealed id, found by the same business name.
  const afterOff = await restarted.findSealed({ entity: 'salary', name: SALARY_NAME, group: 'hr' });
  assert.equal(afterOff['gross-monthly'], '5400.00 EUR');
  assert.notEqual(afterOff.id, sealedId, 'a rotation renames the file, so a former member cannot '
    + 'even tell which blob is which');

  // Anna cannot read it any more, and her index does not contain the entity at all.
  const exAnna = await as(dir, anna, '2027-11-05T09:00:00Z', { encryption: anna.encryption });
  assert.deepEqual(exAnna.query.entities(), ['note']);
  // Two opaque documents and two DIFFERENT reasons, which is the whole point of `byReason`: the
  // salary she was rotated out of, and the customer whose content key lives in a vault she was
  // never given. "I am not in that group" and "there is no vault here" are not the same event.
  assert.equal(exAnna.encryptionStatus().reads.opaque, 2);
  assert.deepEqual(exAnna.encryptionStatus().reads.byReason,
    { 'not-a-member': 1, 'vault-required': 1 });
  // Her wrap records were removed from the manifest, so the keyring she can build from HEAD holds
  // nothing — while `knownGroups` still lists the group, because a group's existence is public.
  assert.deepEqual(exAnna.encryptionStatus().groups, []);
  assert.deepEqual(exAnna.encryptionStatus().epochs, []);
  assert.deepEqual(exAnna.encryptionStatus().knownGroups, ['hr']);
  // The honest limit, stated as the assertion rather than as a comment: the epoch-1 wrap addressed
  // to her is still in git history, one `git show` away, and nothing in any design can change that
  // because she physically holds the repository. What the rotation bought is that the salary is no
  // longer sealed under epoch 1, and its filename is no longer the hash she knew.
  const oldManifest = git(dir, 'show', `${c.salary.oid}:crypto/groups/hr.json`);
  assert.equal(oldManifest.includes(anna.email), true,
    'cryptographically retroactive erasure exists nowhere, and offboard() says so in `limitation`');

  // And she cannot seal anything new for the group, because she holds no CURRENT epoch secret.
  const refused = await exAnna.perform({
    op: 'create', entity: 'salary', id: 'X', doc: { 'gross-monthly': '1.00 EUR' },
    sealFor: ['hr'], message: 'a salary',
  });
  assert.equal(refused.rejected[0].code, 'not-a-member');
  assert.match(refused.rejected[0].reason, /sealing under an older epoch would hand the document/);

  // ---------------------------------------------------------------------------------------------
  // and the chain — the half that makes all of the above interesting
  // ---------------------------------------------------------------------------------------------
  const fsck = git(dir, 'fsck', '--strict', '--no-progress');
  assert.equal(fsck.trim(), '', `git fsck --strict said:\n${fsck}`);
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress', '--unreachable').trim(), '',
    'nothing was rewritten and nothing was orphaned');
  assert.equal(git(dir, 'status', '--porcelain').trim(), '',
    'the vault is not in the working tree — if it were, git would report it here');

  const signers = await signersFile([sarah, anna, ida]);
  const all = verdicts(dir, signers);
  assert.deepEqual([...new Set(all.map((l) => l.split(' ')[0]))], ['G'],
    `real git must report a good signature for every commit, got:\n${all.join('\n')}`);
  const shown = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--show-signature');
  assert.equal((shown.match(/Good "git" signature/g) ?? []).length, all.length);

  // Positive control: a `G` verdict is only evidence if a wrong key produces something else.
  const stranger = await person('stranger', 'Nobody');
  const wrong = await signersFile([{ ...stranger, email: sarah.email }]);
  assert.equal(verdicts(dir, wrong).some((l) => l.startsWith('G ')), false,
    '%G? must not say G for a key that did not sign');

  // Our own verifier, which runs in a browser with no git and no ssh, must agree.
  for (const entry of await restarted.verify(Infinity)) {
    assert.equal(entry.signature, 'good', `${entry.oid} by ${entry.by}`);
  }
});

// =============================================================================================
// 2 — the plaintext path is never written. If both existed, the encryption would be decorative.
// =============================================================================================

test('sealing writes ONLY the sealed path: the plaintext path is absent from the tree, from the '
   + 'working directory and from the whole object database', async () => {
  const c = await company();
  const { dir, sealedId } = c;

  const tracked = git(dir, 'ls-files').trim().split('\n');
  assert.equal(tracked.includes(PATHS.doc('salary', sealedId)), true,
    'the sealed document is where sealedPath() says it is');
  assert.equal(tracked.includes(PATHS.doc('salary', SALARY_NAME)), false,
    'the plaintext path must not be in the index at all');
  assert.deepEqual(tracked.filter((p) => p.startsWith('documents/salary/')),
    [PATHS.doc('salary', sealedId)], 'exactly one file, and it is the sealed one');

  // Not merely untracked — never written. `git status --porcelain` would list it if it were.
  assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  assert.equal(git(dir, 'ls-tree', '-r', '--name-only', 'HEAD').includes(SALARY_NAME), false);

  // Not in any version of any tree, ever: the search is over every object git holds. The needles
  // are deliberately long — a two-character grade like "S3" turns up in base64 by chance, and an
  // assertion that fails at random teaches people to delete assertions.
  const objects = objectDatabase(dir);
  for (const needle of ['5400.00 EUR', SALARY_NAME, '"grade"']) {
    assert.equal(objects.includes(needle), false,
      `${JSON.stringify(needle)} appears somewhere in the object database`);
  }
  // Positive control for the search: a plaintext that IS in the repository must be found.
  assert.equal(objects.includes('the office plant needs water'), true);

  // The public trailer and the blob's own public header must say the same thing about who could
  // open it. Two independent sources, deliberately: the trailer is inside the signed payload, the
  // header is readable by a peer holding no key at all.
  const [head] = await c.nd.history(1);
  const fromTrailer = head.sealed;
  assert.deepEqual(fromTrailer, [{ entity: 'salary', id: sealedId, groups: ['hr@1'], subject: null }]);
  const fromBlob = c.nd.inspectSealed('salary', sealedId);
  assert.deepEqual(fromBlob.groups, fromTrailer[0].groups);
  assert.equal(fromBlob.entity, 'salary');
  assert.equal(fromBlob.id, sealedId);
  assert.equal(fromBlob.version, 1);

  // The same fact, from `git log` alone, by somebody who does not trust our code.
  const raw = git(dir, 'log', '-1', '--format=%B', head.oid);
  assert.match(raw, /^NeoDonkey-Sealed: salary \S+ hr@1$/m);
  assert.deepEqual(parseSealedTrailer(raw.split('\n').find((l) => l.startsWith('NeoDonkey-Sealed:'))),
    { entity: 'salary', id: sealedId, groups: ['hr@1'], subject: null });
  assert.equal(raw.includes(SALARY_NAME), false,
    'a commit message is a public file; the sealed name must not be in it');

  // An update to a sealed document stays sealed, stays at one path, and does not resurrect the
  // plaintext one. This is the case a naive implementation gets wrong, because by now the caller is
  // holding a document whose `id` is a keyed hash and whose name is in a field.
  const updated = await c.nd.perform({
    op: 'update', entity: 'salary', id: sealedId,
    doc: { ...c.nd.query.get('salary', sealedId), 'gross-monthly': '5600.00 EUR' },
    sealFor: ['hr'], message: 'a pay rise, sealed',
  });
  assert.ok(updated.oid, JSON.stringify(updated));
  assert.equal(updated.changes[0].id, sealedId, 'the same name under the same epoch is the same path');
  assert.deepEqual(git(dir, 'ls-files', 'documents/salary/').trim().split('\n'),
    [PATHS.doc('salary', sealedId)]);
  assert.equal(c.nd.query.get('salary', sealedId)['gross-monthly'], '5600.00 EUR');
  assert.equal(c.nd.query.get('salary', sealedId)[SEALED_NAME], SALARY_NAME,
    'the business name survives the round trip through the envelope');
  assert.equal(objectDatabase(dir).includes('5600.00 EUR'), false);
});

// =============================================================================================
// 3 — group administration is a signed commit, every time
// =============================================================================================

test('create / add / rotate / offboard are signed commits: findable with git log -- crypto/groups/, '
   + 'fsck clean, every one of them G under a real allowedSignersFile', async () => {
  const c = await company();
  const { dir, sarah, anna, ida } = c;
  let nd = await as(dir, sarah, '2027-04-01T09:00:00Z', { encryption: sarah.encryption, ...c.v() });

  const added = await nd.addGroupMember('hr', ida.email);
  assert.ok(added.oid, JSON.stringify(added));
  assert.deepEqual(nd.encryptionGroups()[0].members, [anna.email, ida.email, sarah.email].sort());

  // Ida is a member now, so she reads the salary — through the kernel and nothing else.
  const idaNow = await as(dir, ida, '2027-04-02T09:00:00Z', { encryption: ida.encryption });
  assert.deepEqual(idaNow.query.entities(), ['note', 'salary']);
  assert.equal(idaNow.query.get('salary', c.sealedId)['gross-monthly'], '5400.00 EUR');

  const rotated = await nd.rotateGroup('hr', { because: 'quarterly key rotation' });
  assert.ok(rotated.oid, JSON.stringify(rotated));
  assert.equal(rotated.epoch, 2);
  // Rotation alone moves nothing: what is already sealed stays where it is, and members keep the
  // older epoch secret. Said out loud here because "rotate" that silently rewrote the tree would be
  // a very expensive surprise.
  assert.deepEqual(git(dir, 'ls-files', 'documents/salary/').trim().split('\n'),
    [PATHS.doc('salary', c.sealedId)]);
  assert.equal(nd.query.get('salary', c.sealedId)['gross-monthly'], '5400.00 EUR');
  assert.deepEqual(nd.encryptionStatus().epochs, ['hr@1', 'hr@2']);

  const removed = await nd.removeGroupMember('hr', ida.email);
  assert.ok(removed.oid, JSON.stringify(removed));
  assert.match(removed.limitation, /stops all future wraps and nothing else/);

  const off = await nd.offboard('hr', anna.email);
  assert.ok(off.oid, JSON.stringify(off));
  assert.equal(off.epoch, 3);
  assert.equal(off.resealed, 1);

  // ---- every one of them is in the history of who may read what
  const groupLog = git(dir, 'log', '--format=%H %s', '--', 'crypto/groups/').trim().split('\n');
  assert.equal(groupLog.length, 5, `create, add, rotate, remove, offboard — got:\n${groupLog.join('\n')}`);
  const subjects = groupLog.map((l) => l.slice(41));
  assert.match(subjects[4], /^encryption group hr created with /);
  assert.match(subjects[3], /^ida@neodonkey\.eu added to encryption group hr$/);
  assert.match(subjects[2], /^encryption group hr rotated to epoch 2 \(quarterly key rotation\)$/);
  assert.match(subjects[1], /^ida@neodonkey\.eu removed from encryption group hr \(no rotation\)$/);
  assert.match(subjects[0], /^anna@neodonkey\.eu offboarded from encryption group hr: rotated to epoch 3/);

  // The membership is in the signed payload, not only in the file the commit happens to change.
  const body = git(dir, 'log', '-1', '--format=%B', off.oid);
  assert.match(body, /^NeoDonkey-Group: hr$/m);
  assert.match(body, /^NeoDonkey-Group-Epoch: 3$/m);
  assert.match(body, /^NeoDonkey-Group-Members: sarah@neodonkey\.eu$/m);
  assert.match(body, /^NeoDonkey-Group-Removed: anna@neodonkey\.eu$/m);
  assert.match(body, /^NeoDonkey-Group-Resealed: 1$/m);
  assert.match(body, /^NeoDonkey-Actor-Roles: hr-manager$/m);

  // ---- and real git is the judge of the signatures
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress', '--unreachable').trim(), '');
  const signers = await signersFile([sarah, anna, ida]);
  const all = verdicts(dir, signers);
  assert.deepEqual([...new Set(all.map((l) => l.split(' ')[0]))], ['G'], all.join('\n'));
  const shown = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--show-signature');
  assert.equal((shown.match(/Good "git" signature/g) ?? []).length, all.length);

  // Our own verifier, on the same commits, without git.
  const log = await nd._internals.repo.log(Infinity);
  for (const entry of log) {
    const p = [sarah, anna, ida].find((x) => x.email === entry.author.email);
    assert.equal(
      await verifyPayload(await exportPublicSsh(p.signing, p.email), entry.payload,
        entry.signature, SSHSIG_NAMESPACE_GIT),
      true, `our own verifier must accept ${entry.oid}`);
  }
});

// =============================================================================================
// 4 — fail closed, every way in
// =============================================================================================

test('every encryption act fails closed: no key pair, no vault, no such group, not a member, a '
   + 'manifest we cannot parse, and a commit message that would leak the name', async () => {
  const c = await company();
  const { dir, sarah, ida } = c;

  // ---- no `encryption` option: a sealed document is opaque and counted, never guessed at, and
  // asking to seal is refused rather than quietly written in the clear.
  const blind = await as(dir, sarah, '2027-05-01T09:00:00Z');
  assert.equal(blind.encryptionStatus().enabled, false);
  assert.deepEqual(blind.query.entities(), ['note']);
  assert.equal(blind.query.stats().opaque, 1);
  assert.equal(blind.encryptionStatus().reads, null);
  for (const call of [
    () => blind.perform({
      op: 'create', entity: 'salary', id: 'S', doc: { 'gross-monthly': '1.00 EUR' },
      sealFor: ['hr'], message: 'a salary',
    }),
    () => blind.enrol(),
    () => blind.createGroup({ id: 'board', members: [sarah.email] }),
    () => blind.addGroupMember('hr', ida.email),
    () => blind.rotateGroup('hr'),
    () => blind.offboard('hr', ida.email),
    () => blind.eraseSubject({ subject: SUBJECT, reason: 'x' }),
  ]) {
    const r = await call();
    assert.equal(r.rejected[0].code, 'encryption-not-configured', JSON.stringify(r));
    assert.match(r.rejected[0].reason, /opened without one/);
  }
  assert.equal(await blind.sealedPathFor({ entity: 'salary', name: SALARY_NAME, group: 'hr' }), null);

  // ---- a key pair but no vault: only the shreddable half is refused, and by name.
  const noVault = await as(dir, sarah, '2027-05-02T09:00:00Z', { encryption: sarah.encryption });
  const pii = await noVault.perform({
    op: 'create', entity: 'customer', id: 'C-1', doc: { ...PII },
    sealFor: { groups: ['hr'], subject: SUBJECT }, message: 'a customer',
  });
  assert.equal(pii.rejected[0].code, 'vault-required');
  assert.match(pii.rejected[0].reason, /append-only store cannot hold key material/);
  // …while an ordinary group seal still works without a vault at all.
  const fine = await noVault.perform({
    op: 'create', entity: 'salary', id: '2027-Q4-sarah', doc: { 'gross-monthly': '9000.00 EUR' },
    sealFor: ['hr'], message: 'a salary sealed for hr',
  });
  assert.ok(fine.oid, JSON.stringify(fine));

  // ---- refusals that need no new state
  const nd = await as(dir, sarah, '2027-05-03T09:00:00Z', { encryption: sarah.encryption, ...c.v() });
  const cases = [
    [await nd.perform({
      op: 'create', entity: 'salary', id: 'A', doc: { 'gross-monthly': '1.00 EUR' },
      sealFor: ['board'], message: 'a salary',
    }), 'unknown-group', /no encryption group called "board"/],
    [await nd.perform({
      op: 'create', entity: 'salary', id: 'B', doc: { 'gross-monthly': '1.00 EUR' },
      sealFor: [], message: 'a salary',
    }), 'unknown-group', /sealed for nobody/],
    [await nd.perform({
      op: 'create', entity: 'salary', id: 'C', doc: { 'gross-monthly': '1.00 EUR' },
      sealFor: ['hr', 'hr'], message: 'a salary',
    }), 'duplicate-group', /twice/],
    [await nd.perform({
      op: 'create', entity: 'salary', id: SALARY_NAME, doc: { 'gross-monthly': '1.00 EUR' },
      sealFor: ['hr'], message: `salary ${SALARY_NAME} created`,
    }), 'sealed-name-in-message', /public repo file/],
    [await nd.createGroup({ id: 'board', members: [ida.email] }),
      'not-a-member', /would be handing out a key they then could not use/],
    [await nd.createGroup({ id: 'hr', members: [sarah.email] }),
      'member-exists', /already has an encryption group/],
    [await nd.addGroupMember('nope', ida.email), 'unknown-group', /no encryption group called/],
    [await nd.eraseSubject({ subject: 'customer/NOBODY', reason: 'x' }),
      'subject-key-missing', /never given would be a lie to a regulator/],
  ];
  for (const [r, code, pattern] of cases) {
    assert.equal(r.rejected?.[0]?.code, code, JSON.stringify(r));
    assert.match(r.rejected[0].reason, pattern);
  }
  // Nothing above wrote anything: a refusal is not a commit.
  assert.equal(git(dir, 'status', '--porcelain').trim(), '');

  // ---- a non-member cannot administer a group they are not in
  const outsider = await as(dir, ida, '2027-05-04T09:00:00Z', { encryption: ida.encryption });
  const nope = await outsider.rotateGroup('hr');
  assert.equal(nope.rejected[0].code, 'not-a-member');
  assert.match(nope.rejected[0].reason, /administering a group means handing out its epoch secret/);

  // ---- someone with no published encryption key cannot be added: a key somebody else generated
  // "for" them is a key somebody else can read with.
  const stranger = await person('stranger', 'Nobody');
  await nd.addPeer({
    name: stranger.name, email: stranger.email,
    publicKeySsh: await exportPublicSsh(stranger.signing, stranger.email), roles: ['intern'],
  });
  const unenrolled = await nd.addGroupMember('hr', stranger.email);
  assert.equal(unenrolled.rejected[0].code, 'member-unknown');
  assert.match(unenrolled.rejected[0].reason, /They publish it themselves/);

  // ---- a group manifest we cannot parse REFUSES to open the workspace, rather than silently
  // downgrading this peer to a non-member. Agent CRYPTO's reasoning, enforced at the front door.
  const broken = temp('broken');
  execFileSync('cp', ['-R', `${dir}/.`, broken]);
  writeFileSync(join(broken, 'crypto', 'groups', 'hr.json'), '{ not json');
  execFileSync('git', ['add', '-A'], { cwd: broken });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'corrupt'],
    { cwd: broken, stdio: 'ignore' });
  await assert.rejects(
    () => as(broken, sarah, '2027-05-05T09:00:00Z', { encryption: sarah.encryption }),
    (e) => {
      assert.match(e.message, /will not open/);
      assert.match(e.message, /silently downgrade this peer to a non-member/);
      return true;
    });
  // …and the same folder opens perfectly well for a peer that asked for no decryption, because for
  // that peer the manifest was never load-bearing. Fail closed is about the claim, not the folder.
  const plain = await as(broken, sarah, '2027-05-05T10:00:00Z');
  assert.equal(plain.encryptionStatus().enabled, false);
  assert.equal(plain.query.entities().includes('salary'), false);
});

// =============================================================================================
// 5 — regression: a workspace with no `encryption` option behaves EXACTLY as it did before
// =============================================================================================

test('the option is inert: two identical workspaces, one opened with an encryption key pair and '
   + 'one without, produce byte-identical commits for the same unsealed events', async () => {
  const sarah = await person('sarah', 'Sarah Weber');
  const heads = [];
  const histories = [];

  for (const withKeys of [false, true]) {
    const dir = temp(`inert-${withKeys}`);
    const nd = await as(dir, sarah, '2027-06-01T09:00:00Z', {
      seed: seed(), roles: ['hr-manager'],
      ...(withKeys ? { encryption: sarah.encryption, vault: vault(nodeFs(temp('v'))) } : {}),
    });
    assert.deepEqual(nd.modelErrors, []);
    assert.ok((await nd.perform({
      op: 'create', entity: 'note', id: 'N-1', doc: { body: 'the office plant needs water' },
    })).oid);
    assert.ok((await nd.perform({
      op: 'update', entity: 'note', id: 'N-1', doc: { entity: 'note', id: 'N-1', body: 'watered' },
    })).oid);
    heads.push(await nd._internals.repo.head());
    histories.push((await nd.history(10)).map((h) => [h.oid, h.message, h.changes, h.sealed]));

    // The surface a UI, mcp/server.mjs and demo/sarah.mjs depend on is unchanged either way.
    assert.deepEqual(nd.query.entities(), ['note']);
    assert.equal(nd.query.get('note', 'N-1').body, 'watered');
    assert.deepEqual(nd.encryptionGroups(), []);
    assert.deepEqual(nd.subjects(), []);
    assert.equal(git(dir, 'status', '--porcelain').trim(), '');
    assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
    // `history()` gained one additive field and it is empty for a commit that sealed nothing.
    for (const h of await nd.history(10)) assert.deepEqual(h.sealed, []);
  }

  assert.equal(heads[0], heads[1],
    'supplying `encryption` must not change a single byte of a commit that seals nothing');
  assert.deepEqual(histories[0], histories[1]);
});

// =============================================================================================
// 6 — the policy that makes it non-forgettable. A control you defeat by leaving out an argument
//     is not a control.
// =============================================================================================

test('a workspace that records `sealed: {salary: ["hr"]}` in its signed genesis will not write a '
   + 'salary in the clear, whatever the caller passes or forgets', async () => {
  const dir = temp('policy');
  const vaultDir = temp('policy-vault');
  const sarah = await person('sarah', 'Sarah Weber');
  const ida = await person('ida', 'Ida Sommer');
  const v = () => ({ vault: vault(nodeFs(vaultDir)) });

  let nd = await as(dir, sarah, '2027-08-01T09:00:00Z', {
    seed: seed(), roles: ['hr-manager'], encryption: sarah.encryption, ...v(),
    sealed: { salary: ['hr'] },
  });
  assert.deepEqual(nd.sealingPolicy(), { salary: ['hr'] });
  assert.deepEqual(nd.settings.sealed, { salary: ['hr'] });

  // It is in the genesis commit, signed, where a person looks first — the same place FD-7's
  // authorization setting lives, for the same reason.
  const genesis = git(dir, 'rev-list', '--max-parents=0', 'HEAD').trim();
  assert.match(git(dir, 'log', '-1', '--format=%B', genesis), /^NeoDonkey-Sealed-Entities: salary$/m);

  // ---- before the group exists, a salary cannot be written AT ALL. That is the guarantee: not
  // "it will be plaintext for now", but "this company does not have anywhere to put this yet".
  const early = await nd.perform({
    op: 'create', entity: 'salary', id: SALARY_NAME, doc: { ...SALARY }, message: 'a salary',
  });
  assert.equal(early.rejected[0].code, 'unknown-group');
  assert.equal(git(dir, 'ls-files', 'documents/').trim(), '');

  await nd.enrol();
  nd = await as(dir, sarah, '2027-08-02T09:00:00Z', { encryption: sarah.encryption, ...v() });
  assert.ok((await nd.createGroup({ id: 'hr', members: [sarah.email] })).oid);

  // ---- and now the SAME call, with no `sealFor` anywhere, seals it. The company already said so.
  const sealed = await nd.perform({
    op: 'create', entity: 'salary', id: SALARY_NAME, doc: { ...SALARY }, message: 'a salary',
  });
  assert.ok(sealed.oid, JSON.stringify(sealed));
  assert.deepEqual(sealed.sealed, [{
    entity: 'salary', id: sealed.changes[0].id, groups: ['hr@1'], subject: null,
  }]);
  assert.deepEqual(git(dir, 'ls-files', 'documents/salary/').trim().split('\n'),
    [PATHS.doc('salary', sealed.changes[0].id)]);
  assert.equal(objectDatabase(dir).includes('5400.00 EUR'), false);

  // ---- the caller may WIDEN: adding a group, or upgrading to a shreddable subject key.
  assert.ok((await nd.createGroup({ id: 'board', members: [sarah.email] })).oid);
  const wider = await nd.perform({
    op: 'create', entity: 'salary', id: '2027-Q4-sarah', doc: { 'gross-monthly': '9000.00 EUR' },
    sealFor: ['hr', 'board'], message: 'a salary for two groups',
  });
  assert.deepEqual(wider.sealed[0].groups, ['hr@1', 'board@1']);

  // ---- and may never NARROW. This is the assertion the whole option exists for.
  const narrowed = await nd.perform({
    op: 'create', entity: 'salary', id: 'X', doc: { 'gross-monthly': '1.00 EUR' },
    sealFor: ['board'], message: 'a salary',
  });
  assert.equal(narrowed.rejected[0].code, 'sealing-narrowed');
  assert.deepEqual(narrowed.rejected[0].dropped, ['hr']);
  assert.match(narrowed.rejected[0].reason, /may never drop a group the workspace itself recorded/);

  // ---- an unrelated entity is untouched: sealing is per entity, not per workspace.
  const plain = await nd.perform({
    op: 'create', entity: 'note', id: 'N-1', doc: { body: 'the office plant needs water' },
  });
  assert.equal(plain.sealed, undefined);
  assert.equal(objectDatabase(dir).includes('the office plant needs water'), true);

  // ---- and the guarantee holds for a peer that opened the workspace with NO key pair at all,
  // which is the case that matters: mcp/server.mjs and a browser tab do not pass `encryption` yet,
  // and they must not be able to write a plaintext salary by omission.
  const blind = await as(dir, sarah, '2027-08-03T09:00:00Z');
  const refused = await blind.perform({
    op: 'create', entity: 'salary', id: 'Y', doc: { 'gross-monthly': '1.00 EUR' }, message: 'a salary',
  });
  assert.equal(refused.rejected[0].code, 'encryption-not-configured');
  assert.match(refused.rejected[0].reason, /will not write one in the clear/);
  assert.equal(refused.rejected[0].at, PATHS.settings);
  // …while an ordinary document still writes exactly as it always did.
  assert.ok((await blind.perform({
    op: 'create', entity: 'note', id: 'N-2', doc: { body: 'plain' },
  })).oid);

  // ---- a declaration naming no group is a warning, not a silent no-op.
  const junkDir = temp('junk');
  const junk = await as(junkDir, sarah, '2027-08-04T09:00:00Z', {
    seed: seed(), roles: ['hr-manager'], sealed: { salary: [] },
  });
  assert.deepEqual(junk.sealingPolicy(), {});
  assert.ok((await junk.perform({
    op: 'create', entity: 'salary', id: SALARY_NAME, doc: { ...SALARY }, message: 'a salary',
  })).oid, 'an empty declaration cannot be satisfied, so it is ignored rather than a deadlock');
  assert.equal(junk.warnings.some((w) => w.at === 'sealed'), true,
    'and it is a warning, because a declaration nobody can satisfy is not a control');

  // The policy is enforced against the acting peer too: Ida, in no group, cannot seal for hr.
  await nd.addPeer({
    name: ida.name, email: ida.email,
    publicKeySsh: await exportPublicSsh(ida.signing, ida.email), roles: ['hr-manager'],
  });
  const idaNd = await as(dir, ida, '2027-08-05T09:00:00Z', { encryption: ida.encryption });
  const idaTry = await idaNd.perform({
    op: 'create', entity: 'salary', id: 'Z', doc: { 'gross-monthly': '1.00 EUR' }, message: 'a salary',
  });
  assert.equal(idaTry.rejected[0].code, 'not-a-member');
});

// =============================================================================================
// 7 — the accounting Appendix VII's honesty depends on
// =============================================================================================

test('"412 readable, 37 opaque": the counters distinguish why each document could not be opened, '
   + 'and never report a stale tally as a current one', async () => {
  const c = await company();
  const { dir, sarah, anna, ida } = c;

  // Two more sealed documents, one for a group Ida is in and one for a group she is not.
  let nd = await as(dir, sarah, '2027-07-01T09:00:00Z', { encryption: sarah.encryption, ...c.v() });
  assert.ok((await nd.createGroup({ id: 'board', title: 'Board', members: [sarah.email, ida.email] })).oid);
  assert.ok((await nd.perform({
    op: 'create', entity: 'note', id: 'B-1', doc: { body: 'board paper' },
    sealFor: ['board'], message: 'a board paper sealed for the board',
  })).oid);

  // Sarah, in both groups, reads everything.
  nd = await as(dir, sarah, '2027-07-02T09:00:00Z', { encryption: sarah.encryption, ...c.v() });
  const mine = nd.encryptionStatus();
  assert.deepEqual(mine.groups, ['board', 'hr']);
  assert.equal(mine.reads.plain, 1, 'the unsealed note needed no key');
  assert.equal(mine.reads.opened, 2, 'the salary and the board paper were decrypted');
  assert.equal(mine.reads.opaque, 0);
  assert.equal(mine.reads.builtFrom, nd.query.stats().builtFrom);

  // Ida, in the board only, sees the board paper and not the salary — and is told which is which.
  const idaNd = await as(dir, ida, '2027-07-03T09:00:00Z', { encryption: ida.encryption });
  const hers = idaNd.encryptionStatus();
  assert.deepEqual(hers.groups, ['board']);
  assert.deepEqual(hers.knownGroups, ['board', 'hr'],
    'knowing that an HR group exists is public; only its key is not');
  assert.equal(hers.reads.opened, 1);
  assert.equal(hers.reads.opaque, 1);
  assert.deepEqual(hers.reads.byReason, { 'not-a-member': 1 });
  assert.deepEqual(hers.problems.map((p) => p.reason), ['not-a-member']);
  assert.match(hers.problems[0].message, /wrapped for hr@1; ida@neodonkey\.eu holds no secret/);
  assert.equal(hers.problems[0].path, PATHS.doc('salary', c.sealedId));
  // "not in that group" and "the wrap was tampered with" are never quietly the same event.
  assert.equal(Object.keys(hers.reads.byReason).length, 1);

  // The tally covers the commit it read, and says so. An incremental update advances the index
  // without reading one blob through the reader, so the two numbers get two names rather than one
  // that silently goes stale.
  const before = idaNd.encryptionStatus().reads.builtFrom;
  const outsider = await as(dir, anna, '2027-07-04T09:00:00Z', { encryption: anna.encryption });
  assert.ok((await outsider.perform({
    op: 'create', entity: 'note', id: 'N-9', doc: { body: 'plain' },
  })).oid);
  const idaAgain = await as(dir, ida, '2027-07-05T09:00:00Z', { encryption: ida.encryption });
  assert.notEqual(idaAgain.encryptionStatus().reads.builtFrom, before);
  assert.equal(idaAgain.encryptionStatus().reads.plain, 2, 'the two unsealed notes');
  assert.equal(idaAgain.encryptionStatus().reads.opened, 1, 'the board paper');
  assert.equal(idaAgain.query.stats().readable, 3);
  assert.equal(idaAgain.query.stats().opaque, 1, 'the salary, and it has no entity bucket');
  assert.equal(Object.hasOwn(idaAgain.query.stats().entities, 'salary'), false);
});
