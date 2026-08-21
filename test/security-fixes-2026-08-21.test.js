// test/security-fixes-2026-08-21.test.js — regression tests for the two findings of the
// 2026-08-21 red-team report (docs/security-redteam-2026-08-21.md).
//
// F-1: the loose-object store served bytes without re-hashing them. A forged file placed at
//      `.git/objects/ab/cdef...` — by a hostile peer with write access, or by a disk error —
//      was inflated, header-checked, and returned as if it were the named object. The header
//      check only proves the bytes are self-consistent; the name is a claim, and a claim gets
//      checked. `objectStore.read` now re-hashes and refuses a mismatch.
//
// F-2: `readSettings` in runtime/kernel.js called `normalizeSealedTable`, which did not exist.
//      Reopening a sealed workspace with the `sealed` option died with a bare ReferenceError
//      instead of either agreeing with the record or refusing with the repository-decides
//      message. The function exists now, and this file proves all three directions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memFs } from '../runtime/git/fs.js';
import { objectStore } from '../runtime/git/objects.js';
import { deflate } from '../runtime/git/zlib.js';
import { open } from '../runtime/kernel.js';
import { generateIdentity } from '../runtime/identity/ed25519.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// F-1: a forged loose object is refused, not served
// ---------------------------------------------------------------------------------------------

test('F-1: loose-object read re-hashes and refuses forged bytes', async () => {
  const fs = memFs();
  const store = objectStore(fs);

  const content = enc.encode('the honest invoice');
  const oid = await store.write('blob', content);

  // Sanity: the honest object still reads back fine under the new check.
  const back = await store.read(oid);
  assert.equal(back.type, 'blob');
  assert.deepEqual(back.content, content);

  // The forgery is deliberately SELF-CONSISTENT: a valid zlib stream holding a well-formed
  // "blob <length>\0<body>" frame whose body is exactly the announced length. Every check the
  // old read() performed passes on these bytes. Only re-hashing sees the lie.
  const forgedBody = enc.encode('invoice total: EUR 5.00, payable to the attacker');
  const forgedFrame = concat(enc.encode(`blob ${forgedBody.length}`), new Uint8Array([0]), forgedBody);
  await fs.write(`.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`, await deflate(forgedFrame));

  await assert.rejects(
    () => store.read(oid),
    (e) => {
      assert.match(e.message, /hash mismatch/);
      assert.match(e.message, new RegExp(oid));
      return true;
    },
    'a forged loose object must be refused, never served',
  );
});

test('F-1: the honest read path is untouched by the check', async () => {
  const fs = memFs();
  const store = objectStore(fs);
  for (const text of ['', 'a', '1.000,00 EUR', 'x'.repeat(100_000)]) {
    const oid = await store.write('blob', enc.encode(text));
    const back = await store.read(oid);
    assert.equal(new TextDecoder().decode(back.content), text);
  }
  await assert.rejects(
    () => store.read('0'.repeat(40)),
    /object not found/,
    'absence is still absence, not an integrity error',
  );
});

// ---------------------------------------------------------------------------------------------
// F-2: reopening a sealed workspace with the `sealed` option works, and still refuses a lie
// ---------------------------------------------------------------------------------------------

const clockFrom = (iso) => {
  let t = Date.parse(iso);
  return () => (t += 1000);
};

async function founder(local, name) {
  const email = `${local}@neodonkey.eu`;
  return {
    name, email,
    keyPair: await generateIdentity({ comment: email }),
  };
}

const reopen = (fs, who, extra) => open({
  fs,
  identity: { name: who.name, email: who.email, keyPair: who.keyPair },
  clock: clockFrom('2026-08-21T12:00:00Z'),
  tzOffsetMinutes: 120,
  ...extra,
});

test('F-2: sealed reopen agrees when the table means the same thing in another order', async () => {
  const fs = memFs();
  const sarah = await founder('sarah', 'Sarah Weber');

  // Genesis records the sealed table. `board` before `hr`, alphabetically backwards on purpose.
  await reopen(fs, sarah, { sealed: { salary: ['board', 'hr'] } });

  // Before the fix this died with `ReferenceError: normalizeSealedTable is not defined`.
  // The caller writes the same fact in a different order; the workspace must agree.
  const k = await reopen(fs, sarah, { sealed: { salary: ['hr', 'board'] } });
  assert.ok(k, 'reopen with an equivalent sealed table must succeed');
});

test('F-2: sealed reopen still refuses a table that disagrees with the record', async () => {
  const fs = memFs();
  const sarah = await founder('sarah', 'Sarah Weber');

  await reopen(fs, sarah, { sealed: { salary: ['hr'] } });

  // Dropping an entity is the dangerous direction: the caller would believe customer documents
  // are sealed while the repository never recorded that.
  await assert.rejects(
    () => reopen(fs, sarah, { sealed: { salary: ['hr'], customer: ['hr'] } }),
    /repository decides/,
  );
  // And the silent-plaintext direction from the comment in readSettings: the caller believes
  // salary is sealed, the workspace recorded nothing of the kind.
  const fs2 = memFs();
  await reopen(fs2, sarah, {});
  await assert.rejects(
    () => reopen(fs2, sarah, { sealed: { salary: ['hr'] } }),
    /repository decides/,
  );
});

function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
}
