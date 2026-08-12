// test/crypto-reader.test.js — Appendix VII's "elegant side effect", proved literally.
//
// The manifesto's claim is not "the intern is refused when she queries salaries". It is stronger and
// more specific:
//
//   *"The intern cannot execute `SELECT * FROM salaries` because the table does not exist in her
//    index. Not 'she is not allowed' (which could be circumvented) but 'she does not physically hold
//    the data in readable form' — structurally stronger than any role-based access control."*
//
// A test that asserted "the query returns no rows" would pass on a filtered index and would prove
// nothing, because a filter can be forgotten, mis-scoped, or bypassed by a second query path. So
// every assertion in this file is about *absence*: `entities()` does not list the entity,
// `stats().entities` has no such property (and that object is exactly what `mcp/server.mjs` line 151
// publishes to an LLM), `all()` is the empty array, `get()` is null, and no string of the salary
// appears anywhere in her index.
//
// Standing rule 3 — foreign tooling is the judge — applies to the *store*: the documents are read
// out of a real git repository built by `runtime/git/repo.js`, verified by real `git fsck --strict`
// and real `git status --porcelain`, not out of a Map that a test invented.
//
// Standing rule 4 — ask what happens when nothing applies — is the last two blocks: a tampered
// envelope, an envelope from a future format version, and an envelope wrapped for a group that does
// not exist all end up opaque with *distinct* reasons, and never as plaintext.
//
// What this file does NOT touch: `runtime/read/index.js`. Decryption is injected there by design
// (agent E's contract, quoted in `runtime/crypto/reader.js`), so the only thing substituted is
// `readBlob`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFs } from '../runtime/git/fs-node.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { materialize, update } from '../runtime/read/index.js';
import { generateIdentity } from '../runtime/identity/ed25519.js';
import {
  generateEncryptionKeyPair, enrolment as enrol, CRYPTO_PATHS, jsonBytes, CryptoError,
} from '../runtime/crypto/keys.js';
import { seal, sealedPath, MAGIC, FRAME_PREFIX_LEN, frame, parseFrame } from '../runtime/crypto/envelope.js';
import { createGroup, manifestFile, offboard, keyring } from '../runtime/crypto/groups.js';
import {
  decryptingReader, keyringFromRepo, documentBytes, DEFAULT_NAME_FIELD,
} from '../runtime/crypto/reader.js';

const AUTHOR = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' };
const T1 = 1_754_251_200;   // injected, never Date.now() — non-negotiable #5
const TZ = 120;

const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-reader-${tag}-`));
const git = (dir, ...args) => execFileSync('git', args, {
  cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

// ---------------------------------------------------------------------------------------------
// a company: three people, one HR group, one salary document, one invoice everybody may read
// ---------------------------------------------------------------------------------------------

/** One person: an Ed25519 signing pair, an X25519 encryption pair, and the enrolment record. */
async function person(local) {
  const principal = `${local}@neodonkey.eu`;
  const signing = await generateIdentity({ comment: principal });
  // Non-extractable on purpose: the browser-strong case (COMPROMISES #2). Everything below has to
  // work with a private key that never exists as bytes in JavaScript, or the good case is theatre.
  const encryption = await generateEncryptionKeyPair();
  return {
    principal, signing, encryption,
    enrolment: await enrol({ signing, encryption, principal }),
  };
}

/** The plaintext part of the company: an invoice every employee may read. */
const INVOICE = jsonBytes({ entity: 'invoice', id: 'INV-0001', 'net-amount': '1000.00 EUR', customer: 'Kunde GmbH' });

const SALARY_DOC = { 'gross-monthly': '5400.00 EUR', person: 'anna@neodonkey.eu', grade: 'S3' };
const SALARY_NAME = '2027-Q3-anna';

async function company(dir) {
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  const sarah = await person('sarah');       // HR
  const anna = await person('anna');         // HR
  const ida = await person('ida');           // intern — not in HR

  const hr = await createGroup({ id: 'hr', title: 'HR', enrolments: [sarah.enrolment, anna.enrolment] });

  const salary = await seal({
    entity: 'salary', name: SALARY_NAME, doc: SALARY_DOC,
    key: { kind: 'dek', groups: [{ id: 'hr', epoch: 1, secret: hr.secret }] },
  });

  const files = new Map([
    [manifestFile(hr.manifest).path, manifestFile(hr.manifest).bytes],
    ['documents/invoice/INV-0001.json', INVOICE],
    [sealedPath(salary), salary.bytes],
    ['README.md', jsonBytes({ note: 'it is simply a folder' })],
  ]);
  for (const p of [sarah, anna, ida]) {
    files.set(CRYPTO_PATHS.enrolment(p.principal), jsonBytes(p.enrolment));
  }

  await r.commit({ files, message: 'hr group created, salary sealed', author: AUTHOR, time: T1, tzOffsetMinutes: TZ });
  await r.checkout();
  return { fs, r, sarah, anna, ida, hr, salary, files };
}

/** HEAD as `Map<path, Bytes>`, the shape the kernel hands `keyringFromRepo`. */
async function filesAtHead(r) {
  const out = new Map();
  for (const [path, oid] of await r.readTreeAtHead()) out.set(path, await r.readBlob(oid));
  return out;
}

/** One peer's whole read path: keyring from the repo, decrypting reader, materialised index. */
async function indexFor(r, p, opts = {}) {
  const ring = await keyringFromRepo({
    files: await filesAtHead(r), principal: p.principal, encryption: p.encryption,
  });
  const read = decryptingReader({ readBlob: r.readBlob, keyring: ring, ...opts });
  const idx = await materialize({ readTree: () => r.readTreeAtHead(), readBlob: read });
  return { ring, read, idx };
}

/** Every string value anywhere in an index, for the "not even a trace" assertion. */
function everythingReadable(idx) {
  return idx.entities().map((e) => JSON.stringify(idx.all(e))).join('\n');
}

// =============================================================================================
// the claim, both sides of it
// =============================================================================================

test('a member\'s index contains the salary as an ordinary document — encryption is invisible to '
   + 'the read path', async () => {
  const dir = temp('member');
  const { r, anna, salary } = await company(dir);

  // The repository really is a repository: real git is the judge of that, not us.
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.equal(git(dir, 'status', '--porcelain').trim(), '',
    'a company with encrypted documents in it is still simply a folder');

  const { idx, read, ring } = await indexFor(r, anna);

  assert.deepEqual(idx.entities(), ['invoice', 'salary']);
  const doc = idx.get('salary', salary.id);
  assert.equal(doc['gross-monthly'], '5400.00 EUR');
  assert.equal(doc.grade, 'S3');
  assert.equal(doc.entity, 'salary');
  assert.equal(doc.id, salary.id);

  // The plaintext name is carried back into the document, so a member can search for the business
  // name of a file whose filename is a keyed hash. Without this a member could decrypt a document
  // and never find it — a half-capability.
  assert.equal(doc[DEFAULT_NAME_FIELD], SALARY_NAME);
  assert.equal(await ring.pathFor({ entity: 'salary', name: SALARY_NAME, group: 'hr' }),
    sealedPath(salary), 'a member can compute the path of a document from its business name');

  // Nothing was opaque, and the money survived as an exact FD-1 token the index can sum.
  // `plain: 1` is the invoice: the read path never reads a blob whose path is not a document path
  // (`readOne` declines before `readBlob`), so the manifests and the README never reach the reader
  // at all. That is worth pinning down — it means the group manifests cannot be accidentally
  // decrypted, counted, or indexed.
  assert.deepEqual(read.stats(), { plain: 1, opened: 1, opaque: 0, byReason: {} });
  assert.equal(idx.stats().opaque, 0);
  assert.equal(idx.select({ from: 'salary', sum: 'gross-monthly' }), '5400.00 EUR');
  assert.deepEqual(read.problems(), []);
});

test('the intern\'s index does not CONTAIN the salary table — absent, not filtered', async () => {
  const dir = temp('intern');
  const { r, ida, salary } = await company(dir);
  const { idx, read } = await indexFor(r, ida);

  // ---- the claim, five independent ways, every one of them about absence
  assert.deepEqual(idx.entities(), ['invoice'],
    'entities() is the list of entities this peer holds in readable form; salary must not be in it');
  assert.equal(idx.entities().includes('salary'), false);

  // `stats().entities` is the object `mcp/server.mjs` publishes as `documentCounts`. A key with the
  // value 0 would be enough for an LLM to name the table and write a query against it; there is no
  // key at all.
  const counts = idx.stats().entities;
  assert.deepEqual(Object.keys(counts), ['invoice']);
  assert.equal(Object.hasOwn(counts, 'salary'), false,
    'the MCP interface enumerates this object — a "salary: 0" entry would already be a leak');

  assert.deepEqual(idx.all('salary'), [], 'and asking anyway is answered with nothing, never a throw');
  assert.equal(idx.get('salary', salary.id), null);
  assert.equal(idx.select({ from: 'salary', count: true }), 0);
  assert.equal(idx.explain({ from: 'salary' }).candidates, 0);

  // ---- and she does not physically hold it in readable form: no trace of the plaintext anywhere
  const readable = everythingReadable(idx);
  for (const secret of ['5400', 'S3', SALARY_NAME, 'gross-monthly']) {
    assert.equal(readable.includes(secret), false,
      `the intern's index contains the string ${JSON.stringify(secret)}`);
  }

  // ---- the shadow of Appendix VII is counted, honestly, with its reason
  assert.equal(idx.stats().opaque, 1);
  assert.deepEqual(read.stats(), { plain: 1, opened: 0, opaque: 1, byReason: { 'not-a-member': 1 } });
  const [problem] = read.problems();
  assert.equal(problem.path, sealedPath(salary));
  assert.equal(problem.reason, 'not-a-member');
  assert.match(problem.message, /ida@neodonkey\.eu holds no secret for it/);

  // ---- what she legitimately does hold is untouched: this is targeted confidentiality, not a wall
  assert.equal(idx.get('invoice', 'INV-0001')['net-amount'], '1000.00 EUR');
});

test('the intern can see that an HR group exists and who is in it — access control is itself '
   + 'readable, which is more than a classical ERP tells you', async () => {
  const dir = temp('transparent');
  const { r, ida } = await company(dir);
  const { ring } = await indexFor(r, ida);

  assert.deepEqual(ring.knownGroups(), ['hr'], 'the manifest is public, on purpose');
  assert.deepEqual(ring.groups(), [], 'and she is in none of them');
  assert.deepEqual(ring.epochs(), [], 'she holds no epoch secret, which is the whole point');
  assert.deepEqual(ring.problems(), [],
    'a non-member is not a broken keyring — there is nothing here that failed');
  assert.equal(await ring.pathFor({ entity: 'salary', name: SALARY_NAME, group: 'hr' }), null,
    'she cannot even compute where a salary document would live');
});

// =============================================================================================
// offboarding — and the table leaving an index that already had it
// =============================================================================================

test('offboarding in one commit: the table disappears from the leaver\'s index, incrementally as '
   + 'well as on a rebuild', async () => {
  const dir = temp('offboard');
  const { r, sarah, anna, hr, salary } = await company(dir);

  // Anna's index before: she is a member and holds the salary.
  const before = await indexFor(r, anna);
  assert.deepEqual(before.idx.entities(), ['invoice', 'salary']);

  // Sarah offboards her: remove from the manifest, mint epoch 2, re-seal the document under it.
  const sarahRing = (await indexFor(r, sarah)).ring;
  const result = await offboard({
    manifest: hr.manifest,
    secrets: hr.secrets,
    principal: anna.principal,
    documents: [{ path: sealedPath(salary), bytes: salary.bytes }],
    resolve: sarahRing.resolve,
  });
  assert.equal(result.epoch, 2);
  assert.equal(result.resealed, 1);
  assert.deepEqual(result.removals, [sealedPath(salary)],
    're-sealing renames the document, because its id is a keyed hash under the epoch name key');
  assert.match(result.limitation, /still physically holds the repository/);

  const newPath = [...result.writes.keys()].find((p) => p.startsWith('documents/'));
  assert.notEqual(newPath, sealedPath(salary));

  // One commit: the new manifest, the re-sealed document, and the old path gone.
  const files = await filesAtHead(r);
  for (const p of result.removals) files.delete(p);
  for (const [p, b] of result.writes) files.set(p, b);
  await r.commit({ files, message: `offboard ${anna.principal}`, author: AUTHOR, time: T1 + 3600, tzOffsetMinutes: TZ });
  await r.checkout();
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  // What real git makes of it, stated as it is rather than as one might hope: an added path, a
  // deleted path, and a modified manifest — in ONE commit, so `git log --name-status` shows the
  // whole offboarding as a single event. It is *not* detected as a rename even with `-M`, and it
  // cannot be: the re-sealed blob shares no bytes with the old one (fresh DEK, fresh IV), which is
  // precisely the property that makes the leaver's copy useless. Rename detection working here
  // would be evidence that re-sealing had not happened.
  const names = git(dir, 'log', '-1', '--name-status', '--format=', '-M');
  assert.match(names, /^A\tdocuments\/salary\//m);
  assert.match(names, new RegExp(`^D\\t${sealedPath(salary).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(names, /^M\tcrypto\/groups\/hr\.json$/m);
  assert.equal(/^R/m.test(names), false, 're-sealed bytes must share nothing with the old blob');
  // and the old blob is still in history, byte-identical — GoBD keeps it, the key no longer opens it
  assert.equal(git(dir, 'cat-file', '-t', git(dir, 'rev-parse', `HEAD~1:${sealedPath(salary)}`).trim()).trim(),
    'blob');

  // --- a full rebuild of Anna's index: the entity is gone
  const after = await indexFor(r, anna);
  assert.deepEqual(after.idx.entities(), ['invoice']);
  assert.equal(Object.hasOwn(after.idx.stats().entities, 'salary'), false);
  assert.equal(after.read.stats().byReason['not-a-member'], 1);
  assert.equal(everythingReadable(after.idx).includes('5400'), false);

  // --- and incrementally, from the index she was already holding. `update()` is the path a running
  //     peer takes, and an entity that only disappears on a rebuild would leave the leaver's live
  //     session still showing the table.
  const tree = await r.readTreeAtHead();
  const changed = new Map([[newPath, tree.get(newPath)]]);
  const stillAnna = decryptingReader({ readBlob: r.readBlob, keyring: after.ring });
  const incremental = await update(before.idx, {
    changed, removed: result.removals, readBlob: stillAnna,
  });
  assert.deepEqual(incremental.entities(), ['invoice'],
    'pruneEmpty must drop the entity, or an offboarded member keeps the table until she restarts');
  assert.equal(Object.hasOwn(incremental.stats().entities, 'salary'), false);
  assert.equal(everythingReadable(incremental).includes('5400'), false);

  // --- the honest half: the epoch-1 secret she still physically holds does not open epoch 2
  const oldRing = before.ring;
  assert.deepEqual(oldRing.epochs(), ['hr@1']);
  await assert.rejects(() => oldRing.open(result.writes.get(newPath)), (e) => {
    assert.equal(e.reason, 'not-a-member');
    return true;
  });

  // --- and Sarah, who stayed, reads exactly the same document under its new name
  const sarahAfter = await indexFor(r, sarah);
  assert.deepEqual(sarahAfter.idx.entities(), ['invoice', 'salary']);
  const resealed = sarahAfter.idx.all('salary')[0];
  assert.equal(resealed['gross-monthly'], '5400.00 EUR');
  assert.equal(resealed[DEFAULT_NAME_FIELD], SALARY_NAME);
  assert.equal(sarahAfter.read.stats().opaque, 0);
});

// =============================================================================================
// fail closed — three ways to be unreadable, three distinct reasons, never plaintext
// =============================================================================================

/** Re-commit HEAD with one document's bytes replaced, so the read path meets the real thing. */
async function withMutatedSalary(r, path, mutate) {
  const files = await filesAtHead(r);
  const bytes = Uint8Array.from(files.get(path));
  mutate(bytes);
  files.set(path, bytes);
  await r.commit({ files, message: 'mutation', author: AUTHOR, time: T1 + 60, tzOffsetMinutes: TZ });
  await r.checkout();
}

test('a tampered envelope is opaque with content-mac-failed — never quietly the same event as '
   + '"I am not in that group"', async () => {
  const dir = temp('tamper');
  const { r, anna, salary } = await company(dir);
  const path = sealedPath(salary);

  // Flip one bit of the ciphertext. A member — someone who *does* hold the key — must be told the
  // bytes were altered, not that she lacks permission.
  await withMutatedSalary(r, path, (b) => { b[b.length - 1] ^= 1; });
  const { idx, read } = await indexFor(r, anna);

  assert.deepEqual(idx.entities(), ['invoice'], 'a document that fails its MAC does not enter an index');
  assert.deepEqual(read.stats().byReason, { 'content-mac-failed': 1 });
  assert.equal(read.problems()[0].reason, 'content-mac-failed');
  assert.notEqual(read.problems()[0].reason, 'not-a-member');
  assert.equal(idx.stats().opaque, 1);
});

test('the public header is authenticated: rewriting a field no key derivation even reads still '
   + 'refuses, because the header bytes are the AAD', async () => {
  // The isolated proof. The header is deliberately *not* encrypted — a non-member must be able to
  // see which groups could open a blob, or key rotation becomes impossible for anyone but a member.
  // The question that matters is whether being able to *read* it means being able to *rewrite* it.
  //
  // `id` is the ideal probe: no key is derived from it, so the DEK still unwraps perfectly. The only
  // thing standing between a rewritten id and a happily decrypted document is AES-GCM's AAD.
  const dir = temp('aad');
  const { r, anna, salary } = await company(dir);
  const ring = await keyringFromRepo({
    files: await filesAtHead(r), principal: anna.principal, encryption: anna.encryption,
  });

  const { headerBytes, header, ciphertext } = parseFrame(salary.bytes);
  const flipped = `${header.id.slice(0, -1)}${header.id.endsWith('A') ? 'B' : 'A'}`;
  const tampered = frame({ headerBytes: jsonBytes({ ...header, id: flipped }), ciphertext });

  // The key resolution succeeds — this is not a permission failure and must not be reported as one.
  const resolved = await ring.resolve(header.key, header);
  assert.equal(resolved.key.length, 32);
  assert.equal(resolved.via, 'hr@1');

  await assert.rejects(() => ring.open(tampered), (e) => {
    assert.equal(e.reason, 'content-mac-failed');
    return true;
  });
  // and the untouched bytes still open, so the refusal is about the edit and nothing else
  const untouched = await ring.open(salary.bytes, sealedPath(salary));
  assert.equal(untouched.doc['gross-monthly'], '5400.00 EUR');
  assert.deepEqual([...headerBytes], [...parseFrame(salary.bytes).headerBytes]);
});

test('a tamper matrix over the whole frame: every single-byte edit is a refusal with a reason, and '
   + 'no edit anywhere produces a document', async () => {
  // Standing rule 4, applied byte by byte. The frame has five structurally different regions and an
  // edit in each has to land somewhere defined — never in the index, never silently.
  const dir = temp('matrix');
  const { r, anna, salary } = await company(dir);
  const ring = await keyringFromRepo({
    files: await filesAtHead(r), principal: anna.principal, encryption: anna.encryption,
  });

  const positions = [0, 5, MAGIC.length, MAGIC.length + 1, MAGIC.length + 2,
    FRAME_PREFIX_LEN, FRAME_PREFIX_LEN + 40, salary.bytes.length - 1];
  const seen = new Set();
  for (const at of positions) {
    const bytes = Uint8Array.from(salary.bytes);
    bytes[at] ^= 1;
    let reason = 'OPENED';
    try {
      await ring.open(bytes);
    } catch (e) {
      assert.ok(e instanceof CryptoError, `byte ${at} threw a non-CryptoError: ${e}`);
      reason = e.reason;
    }
    assert.notEqual(reason, 'OPENED', `flipping byte ${at} produced a readable document`);
    seen.add(reason);
  }
  // Distinct reasons, not one catch-all: a UI that has to explain "this blob is unreadable" needs
  // to be able to tell a corrupt repository from a document that is not for this peer.
  assert.ok(seen.size >= 4, `the frame regions must be distinguishable, got ${[...seen].sort()}`);
  for (const reason of seen) assert.match(reason, /^[a-z][a-z0-9-]+$/);
});

test('an envelope from a format version this runtime does not know is opaque, not guessed at',
  async () => {
    const dir = temp('version');
    const { r, anna, salary } = await company(dir);
    await withMutatedSalary(r, sealedPath(salary), (b) => { b[MAGIC.length] = 2; });
    const { idx, read } = await indexFor(r, anna);
    assert.deepEqual(idx.entities(), ['invoice']);
    assert.deepEqual(read.stats().byReason, { 'envelope-unknown-version': 1 });
    assert.match(read.problems()[0].message, /Refusing to guess/);
  });

test('an envelope wrapped for a group whose manifest is absent says so, and is not confused with '
   + 'a group the peer is merely not in', async () => {
  const dir = temp('unknown-group');
  const { r, ida } = await company(dir);

  // A blob wrapped for "board", of which there is no manifest at all.
  const ghost = await seal({
    entity: 'board-minutes', name: '2027-11-03', doc: { subject: 'M&A' },
    key: { kind: 'dek', groups: [{ id: 'board', epoch: 1, secret: new Uint8Array(32).fill(9) }] },
  });
  const files = await filesAtHead(r);
  files.set(sealedPath(ghost), ghost.bytes);
  await r.commit({ files, message: 'board minutes', author: AUTHOR, time: T1 + 120, tzOffsetMinutes: TZ });
  await r.checkout();

  const { idx, read } = await indexFor(r, ida);
  assert.deepEqual(idx.entities(), ['invoice'], 'neither entity exists in the intern\'s index');
  assert.deepEqual(read.stats().byReason, { 'not-a-member': 1, 'unknown-group': 1 },
    'two different refusals, so a UI can tell "not for me" from "this repo is inconsistent"');
});

// =============================================================================================
// the reader's own contract
// =============================================================================================

test('a subject-key envelope with no vault attached refuses with vault-required, and stays opaque',
  async () => {
    // The GDPR shape (`kind: "subject"`) reaching a keyring that has no vault must not be reported
    // as a membership problem: the peer may well be authorised and simply lack the key store.
    const dir = temp('novault');
    const { r, anna } = await company(dir);
    const subjectKey = new Uint8Array(32).fill(3);
    const pii = await seal({
      entity: 'customer', name: 'C-1042', doc: { note: 'Anschrift' },
      key: { kind: 'subject', keyId: 'kkkkkkkkkkkkkkkkkkkkkk', key: subjectKey },
    });
    const files = await filesAtHead(r);
    files.set(sealedPath(pii), pii.bytes);
    await r.commit({ files, message: 'pii', author: AUTHOR, time: T1 + 180, tzOffsetMinutes: TZ });
    await r.checkout();

    const { idx, read } = await indexFor(r, anna);
    assert.deepEqual(idx.entities(), ['invoice', 'salary']);
    assert.deepEqual(read.stats().byReason, { 'vault-required': 1 });
  });

test('plaintext documents cost nothing: a repo with no envelopes never invokes the keyring',
  async () => {
    // Appendix VII: "perhaps 5–15% of data volume". The common path must not pay for the rare one.
    const dir = temp('plain');
    const { r, ida, salary } = await company(dir);
    const files = await filesAtHead(r);
    files.delete(sealedPath(salary));
    await r.commit({ files, message: 'no secrets here', author: AUTHOR, time: T1 + 240, tzOffsetMinutes: TZ });
    await r.checkout();

    let asked = 0;
    const ring = await keyringFromRepo({
      files: await filesAtHead(r), principal: ida.principal, encryption: ida.encryption,
    });
    const spy = { ...ring, open: (...a) => { asked++; return ring.open(...a); } };
    const read = decryptingReader({ readBlob: r.readBlob, keyring: spy });
    const idx = await materialize({ readTree: () => r.readTreeAtHead(), readBlob: read });
    assert.equal(asked, 0, 'isEnvelope() must decide this without touching a key');
    assert.deepEqual(idx.entities(), ['invoice']);
    assert.deepEqual(read.stats(), { plain: 1, opened: 0, opaque: 0, byReason: {} });
  });

test('requirePath refuses to open an envelope that arrived without a path, rather than going blind',
  async () => {
    const dir = temp('requirepath');
    const { r, anna, salary } = await company(dir);
    const ring = await keyringFromRepo({
      files: await filesAtHead(r), principal: anna.principal, encryption: anna.encryption,
    });
    const tree = await r.readTreeAtHead();
    const oid = tree.get(sealedPath(salary));

    const strict = decryptingReader({ readBlob: r.readBlob, keyring: ring, requirePath: true });
    // With the path: opened.
    assert.match(new TextDecoder().decode(await strict(oid, sealedPath(salary))), /5400\.00 EUR/);
    // Without it: opaque, with the reason that says why, and the bytes handed back untouched.
    const back = await strict(oid);
    assert.deepEqual([...back.subarray(0, MAGIC.length)], [...MAGIC]);
    assert.equal(strict.stats().byReason['sealed-path-mismatch'], 1);

    // And a relocated envelope is refused even by the default reader, because the header↔path
    // binding needs no key: it is checked before the DEK is ever unwrapped.
    const lenient = decryptingReader({ readBlob: r.readBlob, keyring: ring });
    await lenient(oid, 'documents/invoice/INV-0001.json');
    assert.equal(lenient.stats().byReason['sealed-path-mismatch'], 1);
  });

test('decryptingReader and documentBytes refuse to be constructed or used half-configured', async () => {
  assert.throws(() => decryptingReader({ keyring: {} }), (e) => e instanceof CryptoError);
  assert.throws(() => decryptingReader({ readBlob: () => {} }), (e) => e.reason === 'vault-required');

  // The sealed id and entity win over anything in the document body: the path is authoritative for
  // identity everywhere in this codebase, and a body that disagreed would be refused by the read
  // path as `invalid` rather than indexed under the wrong id.
  const bytes = documentBytes({
    entity: 'salary', id: 'ID', name: 'n',
    doc: { entity: 'lie', id: 'other', amount: 1 },
  });
  const parsed = JSON.parse(new TextDecoder().decode(bytes));
  assert.deepEqual(parsed, { entity: 'salary', id: 'ID', amount: 1, [DEFAULT_NAME_FIELD]: 'n' });
  // and the name field can be switched off for a deployment that considers it leakage
  assert.equal(Object.hasOwn(JSON.parse(new TextDecoder().decode(
    documentBytes({ entity: 'e', id: 'i', name: 'n', doc: {} }, null))), DEFAULT_NAME_FIELD), false);
});

test('keyringFromRepo refuses a group manifest it cannot parse rather than silently downgrading '
   + 'the peer to a non-member', async () => {
  const dir = temp('badmanifest');
  const { r, anna } = await company(dir);
  const files = await filesAtHead(r);

  // Skipping an unreadable manifest would turn a member into a non-member with no error anywhere:
  // her index would simply be missing a table, which is indistinguishable from correct behaviour.
  const broken = new Map(files);
  broken.set('crypto/groups/hr.json', new Uint8Array([0x7b, 0x00]));
  await assert.rejects(() => keyringFromRepo({
    files: broken, principal: anna.principal, encryption: anna.encryption,
  }), (e) => e.reason === 'not-a-group-manifest');

  // And a manifest filed under the wrong name is refused too — the path is authoritative.
  const misfiled = new Map(files);
  misfiled.set('crypto/groups/finance.json', files.get('crypto/groups/hr.json'));
  await assert.rejects(() => keyringFromRepo({
    files: misfiled, principal: anna.principal, encryption: anna.encryption,
  }), (e) => e.reason === 'not-a-group-manifest');

  // A keyring built with no manifests at all is a valid, empty keyring — "nothing applies" is a
  // defined state (standing rule 4), and it grants nothing.
  const empty = await keyring({ principal: 'nobody@x', encryption: anna.encryption, manifests: [] });
  assert.deepEqual(empty.knownGroups(), []);
  assert.deepEqual(empty.epochs(), []);
});
