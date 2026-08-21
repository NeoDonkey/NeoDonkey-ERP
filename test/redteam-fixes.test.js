// test/redteam-fixes.test.js — regression tests for the two findings of the internal red team
// (docs/security-redteam-2026-08-21.md), fixed in this change:
//
//   F-1  runtime/git/objects.js objectStore.read served a well-formed forged loose object
//        silently under the honest oid — the loose read path never re-hashed. It now recomputes
//        the oid from the inflated bytes and refuses a name/content mismatch, matching what the
//        pack reader has always done (runtime/git/pack.js verifyOids).
//
//   F-2  runtime/kernel.js readSettings called normalizeSealedTable, defined nowhere, so every
//        open() passing a `sealed` table on an existing workspace died with a ReferenceError —
//        fail-closed by accident, the intended comparison unreachable. The function now exists,
//        so an identical policy reopens and a different one refuses with the descriptive error.
//
// These tests pin the FIXES. The attacks themselves, and the controls around them, live in the
// red team's own suite; this file does not duplicate it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { memFs } from '../runtime/git/fs.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { objectStore, concatBytes } from '../runtime/git/objects.js';
import { deflate } from '../runtime/git/zlib.js';
import { packedStore } from '../runtime/git/store.js';
import { generateIdentity } from '../runtime/identity/ed25519.js';
import { open } from '../runtime/kernel.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-redteam-fix-${tag}-`));
const loosePath = (oid) => `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;

/** A fixed clock. Determinism is a feature, not a test trick. */
function fixedClock(from = '2027-11-03T09:14:00Z') {
  let t = Date.parse(from);
  return () => (t += 60_000);
}

// =============================================================================================
// F-1 — the loose-object read path re-hashes what it serves.
// =============================================================================================

test('F-1: a well-formed forged loose object is refused by name, never served', async () => {
  const fs = memFs();
  const store = objectStore(fs);
  const honest = enc.encode('{"entity":"invoice","id":"INV-1","net-amount":"100.00 EUR"}\n');
  const oid = await store.write('blob', honest);

  // Control: the honest object reads back, byte for byte.
  const before = await store.read(oid);
  assert.equal(before.type, 'blob');
  assert.deepEqual(before.content, honest);

  // Mallory, holding write access to the workspace folder, replaces the loose object with a
  // valid zlib stream around forged content — everything that parses will parse.
  const forged = enc.encode('{"entity":"invoice","id":"INV-1","net-amount":"1000000.00 EUR"}\n');
  await fs.write(loosePath(oid),
    await deflate(concatBytes(enc.encode(`blob ${forged.length}\0`), forged)));

  await assert.rejects(() => store.read(oid), (e) => {
    assert.match(e.message, /hash mismatch/, 'the refusal must name the integrity failure');
    assert.match(e.message, new RegExp(oid), 'and the oid whose bytes do not hash to it');
    return true;
  });
  assert.equal(await store.has(oid), true, 'the file exists; it is the CONTENT that is refused');

  // Control: a neighbouring honest object is unaffected — the check is per object, not a
  // blanket refusal of the store.
  const other = await store.write('blob', enc.encode('untouched\n'));
  assert.equal(dec.decode((await store.read(other)).content), 'untouched\n');
});

test('F-1: a forged loose object is refused for every type, not only blobs', async () => {
  const fs = memFs();
  const store = objectStore(fs);
  const tree = await store.write('tree', enc.encode('100644 blob aaaa\tf\n'));
  await fs.write(loosePath(tree),
    await deflate(concatBytes(enc.encode('tree 4\0'), enc.encode('evil'))));
  await assert.rejects(() => store.read(tree), /hash mismatch/);
});

test('F-1: a repack still refuses to fold a forged loose object into a pack', async () => {
  // The pre-existing defence from the report must survive the fix: repack recomputes every
  // object's hash from its bytes, and now the loose read underneath it refuses even earlier.
  const dir = temp('repack');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  const doc = enc.encode('{"entity":"invoice","id":"INV-1","net-amount":"100.00 EUR"}\n');
  await r.commit({
    files: new Map([['documents/invoice/INV-1.json', doc]]),
    message: 'invoice INV-1', author: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' },
    time: 1_793_523_240, tzOffsetMinutes: 60,
  });
  const blobOid = (await r.readTreeAtHead()).get('documents/invoice/INV-1.json');
  const forged = enc.encode('{"entity":"invoice","id":"INV-1","net-amount":"1000000.00 EUR"}\n');
  await fs.write(loosePath(blobOid),
    await deflate(concatBytes(enc.encode(`blob ${forged.length}\0`), forged)));

  await assert.rejects(() => packedStore(fs).repack(), /hash mismatch|differs|not in this pack/);
});

test('F-1: the pack read path is untouched — packed objects still read, verified, as before',
  async () => {
    // The fix targets the LOOSE path only; the pack reader already verifies every oid
    // (runtime/git/pack.js verifyOids) and must not be slowed or changed. Prove a repacked
    // object reads back intact, served from the pack rather than a loose file.
    const dir = temp('packed');
    const fs = nodeFs(dir);
    await initRepo(fs);
    const r = repo(fs);
    const doc = enc.encode('{"entity":"invoice","id":"INV-2","net-amount":"42.00 EUR"}\n');
    await r.commit({
      files: new Map([['documents/invoice/INV-2.json', doc]]),
      message: 'invoice INV-2', author: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' },
      time: 1_793_523_240, tzOffsetMinutes: 60,
    });
    const blobOid = (await r.readTreeAtHead()).get('documents/invoice/INV-2.json');

    const store = packedStore(fs, { repackThreshold: 0 });
    await store.repack();
    assert.equal(await fs.read(loosePath(blobOid)), null, 'the loose copy is gone after repack');

    const read = await store.read(blobOid);
    assert.equal(read.type, 'blob');
    assert.equal(dec.decode(read.content), dec.decode(doc), 'the pack serves the honest bytes');
  });

// =============================================================================================
// F-2 — the sealing-policy comparison at open() actually runs.
// =============================================================================================

/** A minimal company: one role, one entity that the company records as confidential. */
function policySeed() {
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

/** A workspace on disk that records `sealed: { salary: ['hr'] }` in its signed genesis. */
async function sealedWorkspace() {
  const dir = temp('sealed');
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const identity = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair };
  const nd = await open({
    fs: nodeFs(dir), identity, seed: policySeed(), clock: fixedClock(), tzOffsetMinutes: 60,
    roles: ['hr-manager'], sealed: { salary: ['hr'] },
  });
  assert.deepEqual(nd.sealingPolicy(), { salary: ['hr'] }, 'the setup itself must hold');
  return { dir, identity };
}

const reopen = (dir, identity, extra = {}) => open({
  fs: nodeFs(dir), identity, clock: fixedClock('2027-11-05T09:00:00Z'), tzOffsetMinutes: 60,
  ...extra,
});

test('F-2: reopening while passing the IDENTICAL sealing policy opens normally', async () => {
  const { dir, identity } = await sealedWorkspace();
  const reopened = await reopen(dir, identity, { sealed: { salary: ['hr'] } });
  assert.deepEqual(reopened.sealingPolicy(), { salary: ['hr'] });
});

test('F-2: the same policy written in another accepted shape is still the same policy',
  async () => {
    // The comparison asks "the same policy", not "the same JSON text": the string shape and
    // the duplicate-laden shape both normalise to ['hr'].
    const one = await sealedWorkspace();
    const asString = await reopen(one.dir, one.identity, { sealed: { salary: 'hr' } });
    assert.deepEqual(asString.sealingPolicy(), { salary: ['hr'] });

    const two = await sealedWorkspace();
    const withDupes = await reopen(two.dir, two.identity, { sealed: { salary: ['hr', 'hr'] } });
    assert.deepEqual(withDupes.sealingPolicy(), { salary: ['hr'] });
  });

test('F-2: reopening with a NARROWED policy refuses descriptively — fail closed, not a crash',
  async () => {
    const { dir, identity } = await sealedWorkspace();
    await assert.rejects(() => reopen(dir, identity, { sealed: {} }), (e) => {
      assert.ok(!(e instanceof ReferenceError),
        'the refusal must be the intended comparison, not the dead-code ReferenceError of F-2');
      assert.match(e.message, /The repository decides/);
      assert.match(e.message, /neodonkey\.json/);
      return true;
    });
  });

test('F-2: reopening with a DIFFERENT policy — even a wider one — refuses the same way',
  async () => {
    // Widening is not the attack (it protects more, not less), but it is still not the recorded
    // policy: the repository decides, and a silent disagreement about a security setting is the
    // defect class this refusal exists for.
    const { dir, identity } = await sealedWorkspace();
    await assert.rejects(() => reopen(dir, identity, { sealed: { salary: ['hr', 'board'] } }),
      /The repository decides/);
  });

test('F-2: omitting the sealed option does not re-litigate the recorded policy', async () => {
  // The option exists so a caller can ASSERT the policy it expects, not so every caller must
  // repeat it: the record in the signed genesis is the source of truth either way.
  const { dir, identity } = await sealedWorkspace();
  const reopened = await reopen(dir, identity);
  assert.deepEqual(reopened.sealingPolicy(), { salary: ['hr'] });
});
