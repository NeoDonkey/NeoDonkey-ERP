// test/security-fixes-2026-08-21.test.js — regression tests for the findings of the
// 2026-08-21 red-team report (docs/security-redteam-2026-08-21.md).
//
// F-1: the loose-object store served bytes without re-hashing them. A forged file placed at
//      `.git/objects/ab/cdef...` — by a hostile peer with write access, or by a disk error —
//      was inflated, header-checked, and returned as if it were the named object. The header
//      check only proves the bytes are self-consistent; the name is a claim, and a claim gets
//      checked. `objectStore.read` now re-hashes and refuses a mismatch.
//
// F-2 (`readSettings` calling a `normalizeSealedTable` that did not exist) is fixed
//      separately: issue #139 carries the exact patch and its regression tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memFs } from '../runtime/git/fs.js';
import { objectStore } from '../runtime/git/objects.js';
import { deflate } from '../runtime/git/zlib.js';

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

function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
}
