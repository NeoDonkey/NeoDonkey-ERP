// test/p-pack.test.js — packed object storage and the repo mesh, judged by real git.
//
// Standing rule 3 (ROADMAP-V1 Part 4): foreign tooling is the judge. Our code agreeing
// with itself proves nothing about a format we did not invent, so the load-bearing tests
// here are `git verify-pack -v`, `git fsck --strict`, `git cat-file` and an empty
// `git status --porcelain`. The two that matter most:
//
//   * we write a pack, real git verifies it and reads a whole repo out of it;
//   * real git writes a delta-compressed pack, and we return byte-identical content for
//     every single object in it. That is the test that says we can open a repo a human made.
//
// Two tests are gated behind environment variables because they cost minutes and
// gigabytes, not because they are optional:
//   NEODONKEY_BENCH=1     the 100 000-object benchmark (loose vs packed)
//   NEODONKEY_BIG_PACK=1  a real pack larger than 2 GB, i.e. the 64-bit offset path
// Both were run for the report; the numbers there come from these tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync,
  openSync, readSync, closeSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha1, hex, unhex } from '../runtime/git/sha1.js';
import { deflate } from '../runtime/git/zlib.js';
import { encodeTree, encodeCommit, concatBytes } from '../runtime/git/objects.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { memFs } from '../runtime/git/fs.js';
import {
  crc32, writePackIndex, readPackIndex, LARGE_OFFSET,
} from '../runtime/git/pack-index.js';
import {
  writePack, readPack, applyDelta, oidOf, sha1OfChunks,
  encodeEntryHeader, decodeEntryHeader,
} from '../runtime/git/pack.js';
import { packedStore } from '../runtime/git/store.js';
import { parseRef, formatRef, meshManifest, documentPath } from '../runtime/git/mesh.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const B = (s) => enc.encode(s);

const AUTHOR = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' };
const T1 = 1754251200;
const TZ = 120;

const BENCH = process.env.NEODONKEY_BENCH === '1';
const BIG_PACK = process.env.NEODONKEY_BIG_PACK === '1';

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const tempDirs = [];
function tempDir(tag = 'p') {
  const dir = mkdtempSync(join(tmpdir(), `neodonkey-${tag}-`));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of tempDirs) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

/** Run git with an environment that cannot leak the developer's config in. */
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      HOME: cwd,
    },
  });
}

/** git, with an identity, for commits we ask the real binary to make. */
function gitCommitting(cwd, ...args) {
  return git(cwd, '-c', 'user.name=Sarah Weber', '-c', 'user.email=sarah@neodonkey.eu', ...args);
}

/** @returns {{ok: boolean, output: string}} */
function fsck(cwd) {
  try {
    const output = execFileSync('git', ['fsck', '--strict'], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: cwd },
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Every object in a repo, straight from the git binary, in one process. */
function catFileAll(dir) {
  const raw = execFileSync('git', ['cat-file', '--batch-all-objects', '--batch'], {
    cwd: dir, maxBuffer: 1 << 30,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: dir },
  });
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  /** @type {Map<string, {type:string, content:Uint8Array}>} */
  const out = new Map();
  let at = 0;
  while (at < bytes.length) {
    let eol = at;
    while (eol < bytes.length && bytes[eol] !== 0x0a) eol++;
    const [oid, type, size] = dec.decode(bytes.subarray(at, eol)).split(' ');
    const start = eol + 1;
    const length = Number(size);
    out.set(oid, { type, content: bytes.subarray(start, start + length) });
    at = start + length + 1; // content, then a newline
  }
  return out;
}

/** A .git directory with no objects of its own, ready for a pack to be dropped in. */
function bareish(dir) {
  execFileSync('mkdir', ['-p', `${dir}/.git/objects/pack`, `${dir}/.git/objects/info`, `${dir}/.git/refs/heads`, `${dir}/.git/refs/tags`]);
  writeFileSync(`${dir}/.git/HEAD`, 'ref: refs/heads/main\n');
  writeFileSync(`${dir}/.git/config`, '[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n');
  return dir;
}

function packBaseName(oids) {
  const sorted = [...oids].sort();
  const raw = new Uint8Array(sorted.length * 20);
  for (let i = 0; i < sorted.length; i++) raw.set(unhex(sorted[i]), i * 20);
  return `pack-${hex(sha1(raw))}`;
}

function assertSameBytes(a, b, what) {
  assert.equal(a.length, b.length, `${what}: length ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) assert.fail(`${what}: byte ${i} is ${a[i]}, expected ${b[i]}`);
  }
}

/** A little company's worth of objects: blobs, one tree per commit, commits. */
function sampleObjects(count) {
  /** @type {{type:string, content:Uint8Array}[]} */
  const objects = [];
  const entries = [];
  for (let i = 0; i < count; i++) {
    const content = B(JSON.stringify({
      id: `INV-${String(i).padStart(6, '0')}`,
      entity: 'invoice',
      'net-amount': `${1000 + (i % 8999)}.99 EUR`,
      customer: `customer/C-${i % 500}`,
      date: `2027-09-${String(1 + (i % 28)).padStart(2, '0')}`,
    }, null, 2));
    objects.push({ type: 'blob', content });
    entries.push({ mode: '100644', name: `INV-${String(i).padStart(6, '0')}.json`, oid: oidOf('blob', content) });
  }
  const tree = encodeTree(entries);
  objects.push({ type: 'tree', content: tree });
  const commit = encodeCommit({
    tree: oidOf('tree', tree), parents: [], author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
    message: `${count} invoices\n`,
  });
  objects.push({ type: 'commit', content: commit });
  return { objects, commitOid: oidOf('commit', commit) };
}

// ---------------------------------------------------------------------------
// CRC32 and the streaming SHA-1
// ---------------------------------------------------------------------------

test('crc32 is zlib\'s crc32, on the vectors everyone publishes', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
  assert.equal(crc32(B('123456789')), 0xcbf43926);
  assert.equal(crc32(B('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  assert.equal(crc32(B('a')), 0xe8b7be43);
  // 32 zero bytes, a value that catches a table built with the unreflected polynomial.
  assert.equal(crc32(new Uint8Array(32)), 0x190a55ad);
  // Chaining a seed must equal hashing the whole: pack.js relies on this to CRC an
  // entry header and its compressed body without joining them.
  const whole = B('operating-model/processes/goods-receipt.md');
  for (const cut of [0, 1, 7, 20, whole.length]) {
    assert.equal(
      crc32(whole.subarray(cut), crc32(whole.subarray(0, cut))),
      crc32(whole),
      `crc32 chaining at ${cut}`,
    );
  }
});

test('the streaming SHA-1 agrees with sha1.js at every block boundary', () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 65536, 100003]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const once = hex(sha1(bytes));
    assert.equal(hex(sha1OfChunks([bytes])), once, `whole, n=${n}`);
    for (const cut of [1, Math.floor(n / 3), 64, n - 1].filter((c) => c > 0 && c < n)) {
      assert.equal(
        hex(sha1OfChunks([bytes.subarray(0, cut), bytes.subarray(cut)])),
        once,
        `split at ${cut}, n=${n}`,
      );
    }
    // Many tiny updates, which is the case a naive buffer-carry implementation breaks on.
    const bits = [];
    for (let i = 0; i < n; i += 7) bits.push(bytes.subarray(i, Math.min(i + 7, n)));
    assert.equal(hex(sha1OfChunks(bits)), once, `7-byte chunks, n=${n}`);
  }
});

// ---------------------------------------------------------------------------
// entry framing
// ---------------------------------------------------------------------------

test('entry headers round-trip, including sizes no test repo could hold', () => {
  // A blob of 11 bytes: type 3, size 11 -> one byte, (3<<4)|11.
  assertSameBytes(encodeEntryHeader(3, 11), new Uint8Array([0x3b]), 'blob/11');
  // 300 bytes: low 4 bits 12, continuation, then 300>>4 = 18.
  assertSameBytes(encodeEntryHeader(3, 300), new Uint8Array([0xbc, 0x12]), 'blob/300');
  for (const type of [1, 2, 3, 4, 6, 7]) {
    for (const size of [0, 1, 15, 16, 127, 128, 2047, 65535, 1 << 20, 2 ** 31, 2 ** 32 + 12345, 2 ** 40 + 7]) {
      const header = encodeEntryHeader(type, size);
      const back = decodeEntryHeader(header, 0);
      assert.equal(back.typeNumber, type);
      assert.equal(back.size, size, `size ${size} did not survive the varint`);
      assert.equal(back.at, header.length);
    }
  }
  assert.throws(() => encodeEntryHeader(0, 10), /bad in-pack type/);
  assert.throws(() => encodeEntryHeader(8, 10), /bad in-pack type/);
  assert.throws(() => encodeEntryHeader(3, -1), /bad object size/);
  // A varint that never terminates is a truncated pack, not a large number.
  assert.throws(() => decodeEntryHeader(new Uint8Array([0xbc]), 0), /runs past the end/);
});

// ---------------------------------------------------------------------------
// .idx v2
// ---------------------------------------------------------------------------

test('the pack index round-trips, and its fanout is git\'s fanout', async () => {
  const entries = [];
  for (let i = 0; i < 2000; i++) {
    entries.push({ oid: hex(sha1(B(`object ${i}`))), offset: 12 + i * 97, crc32: crc32(B(`object ${i}`)) });
  }
  const idx = await writePackIndex(entries, sha1(B('a pack')));
  const read = readPackIndex(idx);
  assert.equal(read.count(), 2000);
  assert.equal(read.packChecksum(), hex(sha1(B('a pack'))));
  assert.equal(read.largeOffsetCount(), 0);
  for (const e of entries) {
    const got = read.lookup(e.oid);
    assert.deepEqual(got, { offset: e.offset, crc32: e.crc32 }, `lookup ${e.oid}`);
  }
  // Sorted ascending, which is what makes the binary search legal.
  const oids = read.oids();
  for (let i = 1; i < oids.length; i++) assert.ok(oids[i - 1] < oids[i]);
  // An oid that is not there is null, not a neighbour.
  assert.equal(read.lookup(hex(sha1(B('never packed')))), null);
  assert.equal(read.indexOf(hex(sha1(B('never packed')))), -1);
  // Fanout: count of oids whose first byte is <= b, read straight out of the bytes.
  const dv = new DataView(idx.buffer, idx.byteOffset, idx.byteLength);
  for (const b of [0, 1, 0x7f, 0xfe, 0xff]) {
    const expected = oids.filter((o) => Number.parseInt(o.slice(0, 2), 16) <= b).length;
    assert.equal(dv.getUint32(8 + b * 4), expected, `fanout[${b}]`);
  }
});

test('a pack index refuses to be written wrong', async () => {
  const good = { oid: hex(sha1(B('x'))), offset: 12, crc32: 7 };
  await assert.rejects(() => writePackIndex([good, { ...good, offset: 40 }], sha1(B('p'))), /duplicate oid/);
  await assert.rejects(
    () => writePackIndex([good, { oid: hex(sha1(B('y'))), offset: 12, crc32: 1 }], sha1(B('p'))),
    /claim pack offset 12/,
  );
  await assert.rejects(() => writePackIndex([{ ...good, offset: -1 }], sha1(B('p'))), /non-negative/);
  await assert.rejects(() => writePackIndex([{ ...good, crc32: 2 ** 33 }], sha1(B('p'))), /uint32/);
  await assert.rejects(() => writePackIndex([{ ...good, oid: 'nope' }], sha1(B('p'))), /not a git object id/);
  // The pack checksum is not defaultable: an index that records the wrong one is an index
  // real git refuses to open, so it is refused here instead.
  await assert.rejects(() => writePackIndex([good]), /trailing SHA-1/);
});

test('a corrupt pack index is refused, never read optimistically', async () => {
  const entries = [];
  for (let i = 0; i < 50; i++) entries.push({ oid: hex(sha1(B(`o${i}`))), offset: 12 + i * 30, crc32: i });
  const idx = await writePackIndex(entries, sha1(B('pack')));

  const bad = (mutate) => { const copy = new Uint8Array(idx); mutate(copy); return copy; };
  assert.throws(() => readPackIndex(bad((c) => { c[0] = 0xfe; })), /not a v2 pack index/);
  assert.throws(() => readPackIndex(bad((c) => { c[7] = 3; })), /unsupported index version 3/);
  assert.throws(() => readPackIndex(idx.subarray(0, idx.length - 1)), /checksum mismatch|truncated|whole number/);
  assert.throws(() => readPackIndex(idx.subarray(0, 100)), /too small|truncated/);
  assert.throws(() => readPackIndex(bad((c) => { c[c.length - 1] ^= 0xff; })), /checksum mismatch/);
  // A single flipped bit anywhere in the body is caught by the trailer.
  assert.throws(() => readPackIndex(bad((c) => { c[1200] ^= 0x01; })), /checksum mismatch/);
  // ... and with the checksum check switched off, the structural checks still hold:
  // a wrecked oid table stops being monotonic.
  assert.throws(
    () => readPackIndex(bad((c) => { c[1032] = 0xff; }), { verifyChecksum: false }),
    /ascending order|monotonic/,
  );
  assert.throws(() => readPackIndex(new Uint8Array(8)), /too small/);
  assert.throws(() => readPackIndex('not bytes'), /must be a Uint8Array/);
});

test('offsets past 2 GB go through the 64-bit table and come back exact', async () => {
  const entries = [
    { oid: hex(sha1(B('small'))), offset: 12, crc32: 1 },
    { oid: hex(sha1(B('just under'))), offset: LARGE_OFFSET - 1, crc32: 2 },
    { oid: hex(sha1(B('just over'))), offset: LARGE_OFFSET, crc32: 3 },
    { oid: hex(sha1(B('far out'))), offset: 5 * 1024 * 1024 * 1024 + 4242, crc32: 4 },
    { oid: hex(sha1(B('petabyte-ish'))), offset: 2 ** 45 + 1, crc32: 5 },
  ];
  const idx = await writePackIndex(entries, sha1(B('big pack')));
  const read = readPackIndex(idx);
  assert.equal(read.largeOffsetCount(), 3, 'three offsets need the 64-bit table');
  for (const e of entries) assert.equal(read.lookup(e.oid).offset, e.offset, `offset for ${e.oid}`);

  // The encoding, checked in the bytes rather than through our own reader: a large offset
  // is stored as 0x80000000 | index-into-the-table.
  const dv = new DataView(idx.buffer);
  const offsetsAt = 8 + 1024 + read.count() * 24;
  let bigSeen = 0;
  for (let i = 0; i < read.count(); i++) {
    const raw = dv.getUint32(offsetsAt + i * 4);
    if (read.offsetAt(i) >= LARGE_OFFSET) {
      assert.ok((raw & LARGE_OFFSET) !== 0, `entry ${i} should be flagged large`);
      assert.ok((raw & 0x7fffffff) < 3, 'slot must be inside the table');
      bigSeen++;
    } else {
      assert.equal(raw, read.offsetAt(i), `entry ${i} stored directly`);
    }
  }
  assert.equal(bigSeen, 3);

  // A large-offset slot pointing outside the table is corruption, and is named as such.
  const wrecked = new Uint8Array(idx);
  const wdv = new DataView(wrecked.buffer);
  for (let i = 0; i < read.count(); i++) {
    if (read.offsetAt(i) >= LARGE_OFFSET) { wdv.setUint32(offsetsAt + i * 4, (LARGE_OFFSET | 99) >>> 0); break; }
  }
  const relaxed = readPackIndex(wrecked, { verifyChecksum: false });
  assert.throws(() => { for (let i = 0; i < relaxed.count(); i++) relaxed.offsetAt(i); }, /64-bit offset slot/);
});

// ---------------------------------------------------------------------------
// what we write, judged by git
// ---------------------------------------------------------------------------

test('git verify-pack is happy with a pack we wrote', async () => {
  const dir = bareish(tempDir('write'));
  const { objects, commitOid } = sampleObjects(120);
  const { pack, idx, oids, packChecksum } = await writePack(objects);
  assert.equal(oids.length, objects.length);
  assert.equal(packChecksum, hex(pack.subarray(pack.length - 20)));
  assertSameBytes(pack.subarray(0, 8), new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2]), 'PACK v2 header');

  const name = packBaseName(oids);
  writeFileSync(`${dir}/.git/objects/pack/${name}.pack`, pack);
  writeFileSync(`${dir}/.git/objects/pack/${name}.idx`, idx);
  writeFileSync(`${dir}/.git/refs/heads/main`, `${commitOid}\n`);

  const verify = git(dir, 'verify-pack', '-v', `.git/objects/pack/${name}.idx`);
  assert.match(verify, /\.pack: ok$/m, `git verify-pack said:\n${verify}`);
  assert.match(verify, /^non delta: 122 objects$/m, verify);
  // Object ids, types and sizes as git reads them out of our pack.
  const first = objects[0];
  assert.match(verify, new RegExp(`^${oidOf('blob', first.content)} blob\\s+${first.content.length} `, 'm'));

  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
  assert.equal(checked.output.trim(), '', `git fsck --strict said:\n${checked.output}`);

  assert.match(git(dir, 'log', '--oneline'), /120 invoices/);
  assert.match(git(dir, 'cat-file', '-p', 'HEAD'), /^tree [0-9a-f]{40}$/m);
  assert.equal(git(dir, 'cat-file', '-t', commitOid).trim(), 'commit');
  assert.equal(
    git(dir, 'cat-file', 'blob', oidOf('blob', first.content)),
    dec.decode(first.content),
  );
  // count-objects proves there is nothing loose to fall back on: everything git just read
  // came out of the pack.
  const counts = git(dir, 'count-objects', '-v');
  assert.match(counts, /^count: 0$/m, counts);
  assert.match(counts, /^in-pack: 122$/m, counts);
  assert.match(counts, /^garbage: 0$/m, counts);
});

test('a repo whose objects exist only in a pack checks out clean', async () => {
  const dir = tempDir('checkout');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs, { repackThreshold: 0 });
  const files = new Map();
  for (let i = 0; i < 200; i++) {
    files.set(
      `documents/invoice/INV-${String(i).padStart(4, '0')}.json`,
      B(JSON.stringify({ id: `INV-${i}`, entity: 'invoice', 'net-amount': `${100 + i}.00 EUR` })),
    );
  }
  files.set('operating-model/processes/goods-receipt.md', B('# Goods receipt\n\n## Rules\n'));
  await r.commit({ files, message: 'the company', author: AUTHOR, time: T1, tzOffsetMinutes: TZ });

  const before = await r.stats();
  assert.equal(before.packed, 0);
  assert.ok(before.loose > 200);

  const result = await r.repack();
  assert.equal(result.packs.length, 1);
  const after = await r.stats();
  assert.equal(after.loose, 0, 'every loose object is gone');
  assert.equal(after.packed, before.loose, 'and all of them are in the pack');

  // Reads now come out of the pack, through the unchanged repo() interface.
  const tree = await r.readTreeAtHead();
  assert.equal(tree.size, 201);
  assert.equal(
    dec.decode(await r.readBlob(tree.get('documents/invoice/INV-0007.json'))),
    JSON.stringify({ id: 'INV-7', entity: 'invoice', 'net-amount': '107.00 EUR' }),
  );
  assert.equal((await r.log()).length, 1);

  await r.checkout();
  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
  assert.equal(checked.output.trim(), '');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'a human opening the folder sees no changes');
  assert.match(git(dir, 'count-objects', '-v'), /^count: 0$/m);
  assert.match(git(dir, 'log', '--oneline'), /the company/);
  assert.equal(
    git(dir, 'cat-file', 'blob', 'HEAD:documents/invoice/INV-0007.json'),
    JSON.stringify({ id: 'INV-7', entity: 'invoice', 'net-amount': '107.00 EUR' }),
  );
});

// ---------------------------------------------------------------------------
// what git writes, read by us
// ---------------------------------------------------------------------------

/**
 * Build a repo with the system git binary: several commits over a few hundred files whose
 * successive versions differ slightly, then `git repack` with a deep window, which is what
 * produces long OFS_DELTA chains.
 * @param {string} dir @param {string[]} repackArgs @param {string[]} [config] `-c` pairs,
 *   which git only accepts *before* the subcommand
 */
function buildGitRepo(dir, repackArgs, config = []) {
  gitCommitting(dir, 'init', '-q', '.');
  let text = '';
  for (let revision = 0; revision < 8; revision++) {
    text += `revision ${revision}\n${Array.from({ length: 40 }, (_, i) => `line ${revision}-${i} lorem ipsum dolor sit amet consectetur adipiscing\n`).join('')}`;
    for (let f = 0; f < 300; f++) {
      writeFileSync(`${dir}/documents-${f}.txt`, `${text}tail for document ${f}\n`);
    }
    writeFileSync(`${dir}/README.md`, `# revision ${revision}\n`);
    gitCommitting(dir, 'add', '-A');
    gitCommitting(dir, 'commit', '-q', '-m', `revision ${revision}`);
  }
  gitCommitting(dir, ...config, 'repack', ...repackArgs);
  const names = readdirSync(`${dir}/.git/objects/pack`).filter((n) => n.endsWith('.pack'));
  assert.equal(names.length, 1, `expected one pack, got ${names.join(', ')}`);
  const base = names[0].slice(0, -5);
  return {
    base,
    pack: new Uint8Array(readFileSync(`${dir}/.git/objects/pack/${base}.pack`)),
    idx: new Uint8Array(readFileSync(`${dir}/.git/objects/pack/${base}.idx`)),
  };
}

/** Deltas per chain depth, straight out of `git verify-pack -v`. */
function chainDepths(verifyOutput) {
  /** @type {Record<number, number>} */
  const depths = {};
  for (const line of verifyOutput.trim().split('\n')) {
    const m = /^[0-9a-f]{40} \S+\s+\d+ \d+ \d+ (\d+) [0-9a-f]{40}$/.exec(line);
    if (m) depths[Number(m[1])] = (depths[Number(m[1])] ?? 0) + 1;
  }
  return depths;
}

test('we read a delta-compressed pack real git wrote, byte for byte', async () => {
  const dir = tempDir('gitmade');
  const { base, pack, idx } = buildGitRepo(dir, ['-adf', '--depth=50', '--window=250']);

  const verify = git(dir, 'verify-pack', '-v', `.git/objects/pack/${base}.idx`);
  assert.match(verify, /\.pack: ok$/m);
  const depths = chainDepths(verify);
  const deepest = Math.max(...Object.keys(depths).map(Number));
  assert.ok(deepest >= 3, `expected OFS_DELTA chains at least 3 deep, got depths ${JSON.stringify(depths)}`);
  const deltaCount = Object.values(depths).reduce((a, b) => a + b, 0);
  assert.ok(deltaCount > 1000, `expected a delta-heavy pack, got ${deltaCount} deltas`);

  const reader = readPack(pack, idx);
  await reader.verifyChecksum();

  // The deltas in this pack really are OFS_DELTA (type 6 in the entry header), not
  // REF_DELTA: git's default. Checked in the raw bytes, so the next test's REF_DELTA case
  // cannot be silently testing the same code path.
  let ofsSeen = 0;
  let refSeen = 0;
  for (const oid of reader.oids()) {
    const type = (pack[await reader.offsetOf(oid)] >> 4) & 7;
    if (type === 6) ofsSeen++;
    if (type === 7) refSeen++;
  }
  assert.equal(ofsSeen, deltaCount, 'every delta git wrote is an OFS_DELTA');
  assert.equal(refSeen, 0);

  const theirs = catFileAll(dir);
  assert.ok(theirs.size > 2000, `expected a few thousand objects, got ${theirs.size}`);
  assert.equal(reader.count(), theirs.size, 'our index sees exactly the objects git sees');
  for (const [oid, expected] of theirs) {
    const ours = await reader.read(oid);
    assert.equal(ours.type, expected.type, `type of ${oid}`);
    assertSameBytes(ours.content, expected.content, `content of ${oid}`);
  }
});

test('we read a REF_DELTA pack real git wrote', async () => {
  const dir = tempDir('refdelta');
  buildGitRepo(dir, ['-adq']);
  // `git pack-objects --no-delta-base-offset` is how you ask git for REF_DELTA — the
  // encoding it still uses for old clients, and therefore an encoding a human's repo can
  // contain. Written next to the repo so the repo's own pack stays OFS_DELTA.
  execFileSync('mkdir', ['-p', `${dir}/refpack`]);
  const base = `pack-${execFileSync('bash', ['-c',
    'git rev-list --objects --all | awk \'{print $1}\' '
    + '| git pack-objects --no-delta-base-offset --no-reuse-delta --depth=20 --window=100 refpack/pack',
  ], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: dir },
  }).trim()}`;
  const pack = new Uint8Array(readFileSync(`${dir}/refpack/${base}.pack`));
  const idx = new Uint8Array(readFileSync(`${dir}/refpack/${base}.idx`));
  const verify = git(dir, 'verify-pack', '-v', `refpack/${base}.idx`);
  assert.match(verify, /\.pack: ok$/m);
  const deltaCount = Object.values(chainDepths(verify)).reduce((a, b) => a + b, 0);
  assert.ok(deltaCount > 100, `expected deltas, got ${deltaCount}`);

  const reader = readPack(pack, idx);
  let refSeen = 0;
  for (const oid of reader.oids()) {
    if (((pack[await reader.offsetOf(oid)] >> 4) & 7) === 7) refSeen++;
  }
  assert.equal(refSeen, deltaCount, 'this pack is REF_DELTA encoded');

  const theirs = catFileAll(dir);
  for (const [oid, expected] of theirs) {
    const ours = await reader.read(oid);
    assert.equal(ours.type, expected.type);
    assertSameBytes(ours.content, expected.content, `content of ${oid}`);
  }
});

test('a git-made pack is readable through the store, with no loose objects at all', async () => {
  const dir = tempDir('viastore');
  buildGitRepo(dir, ['-adf', '--depth=50', '--window=250']);
  assert.match(git(dir, 'count-objects', '-v'), /^count: 0$/m);
  const fs = nodeFs(dir);
  const store = packedStore(fs, { repackThreshold: 0 });
  const theirs = catFileAll(dir);
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  assert.ok(await store.has(head));
  const commit = await store.read(head);
  assert.equal(commit.type, 'commit');
  assertSameBytes(commit.content, theirs.get(head).content, 'HEAD commit through the store');
  // And the porcelain on top of it: log() walks eight commits that live only in a pack.
  const r = repo(fs, { repackThreshold: 0 });
  const log = await r.log();
  assert.equal(log.length, 8);
  assert.equal(log[0].message.trim(), 'revision 7');
  const tree = await r.readTreeAtHead();
  assert.equal(tree.size, 301);
});

test('applyDelta refuses a delta that does not fit its base', () => {
  const base = B('the quick brown fox');
  // copy 0..5, then insert "!" -> a well-formed delta, to prove the negatives below are
  // about the corruption and not about the format.
  const good = new Uint8Array([base.length, 6, 0x91, 0x00, 0x05, 0x01, 0x21]);
  assert.equal(dec.decode(applyDelta(base, good)), 'the q!');
  assert.throws(() => applyDelta(B('wrong length'), good), /expects a 19-byte base/);
  assert.throws(
    () => applyDelta(base, new Uint8Array([base.length, 6, 0x91, 0xf0, 0x05])),
    /from a 19-byte base/,
  );
  assert.throws(() => applyDelta(base, new Uint8Array([base.length, 6, 0x00])), /opcode 0 is reserved/);
  assert.throws(() => applyDelta(base, new Uint8Array([base.length, 6, 0x05, 0x61])), /truncated/);
  assert.throws(() => applyDelta(base, new Uint8Array([base.length, 2, 0x03, 0x61, 0x62, 0x63])), /past its declared target/);
  assert.throws(() => applyDelta(base, new Uint8Array([base.length, 9, 0x03, 0x61, 0x62, 0x63])), /produced 3 bytes, declared 9/);
});

// ---------------------------------------------------------------------------
// scale
// ---------------------------------------------------------------------------

test('10 000 objects survive writePack -> readPack unchanged', async () => {
  const { objects } = sampleObjects(10000);
  const { pack, idx, oids } = await writePack(objects);
  assert.equal(oids.length, 10002);
  const reader = readPack(pack, idx);
  await reader.verifyChecksum();
  assert.equal(reader.count(), 10002);
  for (let i = 0; i < objects.length; i++) {
    const got = await reader.read(oids[i]);
    assert.equal(got.type, objects[i].type);
    assertSameBytes(got.content, objects[i].content, `object ${i}`);
  }
  // Sorted index, one entry per object, and the same set of ids either way round.
  assert.deepEqual([...reader.oids()].sort(), [...oids].sort());
});

test('100 000 objects: pack, index and read timings, loose vs packed', { skip: BENCH ? false : 'set NEODONKEY_BENCH=1' }, async () => {
  const N = 100000;
  const dir = tempDir('bench');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const store = packedStore(fs, { repackThreshold: 0 });
  const contents = new Array(N);
  for (let i = 0; i < N; i++) {
    contents[i] = B(JSON.stringify({
      id: `INV-${i}`, entity: 'invoice', 'net-amount': `${i % 9999}.99 EUR`,
      customer: `customer/C-${i % 500}`, date: `2027-09-${1 + (i % 28)}`,
    }));
  }
  const du = (path) => Number(execFileSync('du', ['-sk', path], { encoding: 'utf8' }).split('\t')[0]);
  const files = (path) => Number(execFileSync('bash', ['-c', `find ${path} -type f | wc -l`], { encoding: 'utf8' }).trim());

  let t = Date.now();
  for (const content of contents) await store.write('blob', content);
  const looseMs = Date.now() - t;
  const looseKiB = du(`${dir}/.git/objects`);
  const looseFiles = files(`${dir}/.git/objects`);

  t = Date.now();
  const { pack, idx } = await writePack(contents.map((content) => ({ type: 'blob', content })));
  const packMs = Date.now() - t;

  t = Date.now();
  const result = await store.repack();
  const repackMs = Date.now() - t;
  const packedKiB = du(`${dir}/.git/objects`);
  const packedFiles = files(`${dir}/.git/objects`);

  const oids = await store.packs.oids();
  t = Date.now();
  for (let i = 0; i < 10000; i++) await store.read(oids[(i * 7919) % oids.length]);
  const readMs = Date.now() - t;

  const lines = [
    '',
    `  ${N} small JSON objects (mean ${Math.round(contents.reduce((n, c) => n + c.length, 0) / N)} bytes)`,
    `  loose write:      ${looseMs} ms  (${(looseMs / N * 1000).toFixed(0)} us/object)`,
    `  loose on disk:    ${looseKiB} KiB in ${looseFiles} files`,
    `  writePack+index:  ${packMs} ms  (${(packMs / N * 1000).toFixed(0)} us/object)`,
    `  pack bytes:       ${pack.length}   idx bytes: ${idx.length}`,
    `  repack (verified): ${repackMs} ms -> ${result.packs.length} pack(s)`,
    `  packed on disk:   ${packedKiB} KiB in ${packedFiles} files`,
    `  10 000 random reads through the pack: ${readMs} ms (${(readMs / 10).toFixed(0)} us/read)`,
    `  disk factor: ${(looseKiB / packedKiB).toFixed(1)}x smaller, ${(looseFiles / packedFiles).toFixed(0)}x fewer files`,
    '',
  ];
  console.log(lines.join('\n'));

  assert.equal((await store.stats()).loose, 0);
  assert.ok(packedKiB < looseKiB, 'packed must be smaller on disk than loose');
  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
});

test('the size cost of not writing deltas, measured against git', async () => {
  /** git's own pack for a repo, next to ours for the same object set. */
  async function compare(dir, label) {
    const gitPack = readdirSync(`${dir}/.git/objects/pack`).find((n) => n.endsWith('.pack'));
    const gitBytes = statSync(`${dir}/.git/objects/pack/${gitPack}`).size;
    const theirs = catFileAll(dir);
    const ours = await writePack([...theirs.values()].map((o) => ({ type: o.type, content: o.content })));
    console.log(
      `\n  delta cost (${label}), ${theirs.size} objects: git with deltas ${gitBytes} bytes, `
      + `ours with none ${ours.pack.length} bytes = ${(ours.pack.length / gitBytes).toFixed(2)}x`,
    );
    return ours;
  }

  // Corpus A: the worst case for us — eight successive revisions of 300 nearly identical
  // documents, which is exactly what delta compression was invented for.
  const versioned = tempDir('deltacost-a');
  buildGitRepo(versioned, ['-adf', '--depth=50', '--window=250']);
  await compare(versioned, 'eight revisions of 300 documents');

  // Corpus B: what an ERP's first year actually looks like — a few hundred *distinct*
  // documents, each written once. Deltas have much less to find here, which is the honest
  // half of the comparison.
  const distinct = tempDir('deltacost-b');
  gitCommitting(distinct, 'init', '-q', '.');
  execFileSync('mkdir', ['-p', `${distinct}/documents/invoice`]);
  for (let i = 0; i < 500; i++) {
    writeFileSync(`${distinct}/documents/invoice/INV-${String(i).padStart(4, '0')}.json`, JSON.stringify({
      id: `INV-${String(i).padStart(4, '0')}`,
      entity: 'invoice',
      customer: `customer/C-${i % 137}`,
      'net-amount': `${(i * 7919) % 100000}.${String(i % 100).padStart(2, '0')} EUR`,
      'vat-amount': `${Math.floor(((i * 7919) % 100000) * 0.19)}.${String((i * 3) % 100).padStart(2, '0')} EUR`,
      lines: Array.from({ length: 1 + (i % 5) }, (_, l) => ({ article: `article/A-${(i * 13 + l) % 900}`, quantity: 1 + ((i + l) % 40) })),
    }, null, 2));
  }
  gitCommitting(distinct, 'add', '-A');
  gitCommitting(distinct, 'commit', '-q', '-m', '500 invoices');
  gitCommitting(distinct, 'repack', '-adf', '--depth=50', '--window=250');
  const ours = await compare(distinct, '500 distinct documents');
  console.log('');
  // No assertion on the ratio: it is a measurement, and the honest number belongs in the
  // report either way. What is asserted is that our delta-free pack is still a pack git
  // accepts, which is the property v1.0 actually claims.
  const packDir = bareish(tempDir('deltacost-ours'));
  const name = packBaseName(ours.oids);
  writeFileSync(`${packDir}/.git/objects/pack/${name}.pack`, ours.pack);
  writeFileSync(`${packDir}/.git/objects/pack/${name}.idx`, ours.idx);
  assert.match(git(packDir, 'verify-pack', '-v', `.git/objects/pack/${name}.idx`), /\.pack: ok$/m);
});

// ---------------------------------------------------------------------------
// corruption
// ---------------------------------------------------------------------------

test('corruption is detected, never silently tolerated', async () => {
  const { objects } = sampleObjects(40);
  const { pack, idx, oids } = await writePack(objects);
  const clone = () => new Uint8Array(pack);

  // Clean baseline, so every failure below is about the mutation.
  await readPack(pack, idx).verifyChecksum();

  // 1. A rewritten trailer: caught on open, because the index records the pack's checksum.
  {
    const bad = clone();
    bad[bad.length - 1] ^= 0xff;
    await assert.rejects(() => readPack(bad, idx).open(), /does not match the .* its index records/);
  }
  // 2. A byte flipped inside an object: caught by that object's CRC32 on read.
  {
    const bad = clone();
    const at = await readPack(pack, idx).offsetOf(oids[3]);
    bad[at + 6] ^= 0x40;
    // The pack-level checksum notices too, but the point is the *per-object* check: a
    // reader that only verified the whole-pack SHA-1 would hand this object back untouched
    // to anyone who never asked for a full verification.
    const reader = readPack(bad, idx, { verifyIndexChecksum: true });
    reader.index.packChecksum(); // still the recorded one; the trailer was not touched
    await assert.rejects(() => reader.read(oids[3]), /CRC32 mismatch/);
    await assert.rejects(() => reader.verifyChecksum(), /hashes to/);
    // Other objects in the same pack are unaffected and still read.
    assertSameBytes((await reader.read(oids[5])).content, objects[5].content, 'neighbour object');
  }
  // 3. Truncation: the trailer is gone, so the pack cannot even be opened.
  {
    const short = pack.subarray(0, pack.length - 40);
    await assert.rejects(() => readPack(short, idx).open(), /does not match|too small/);
  }
  // 4. Truncated in the middle, with a valid-looking trailer re-attached: offsets now
  //    point past the end of the data.
  {
    const cut = pack.length - 400;
    const short = new Uint8Array(cut);
    short.set(pack.subarray(0, cut - 20));
    short.set(unhex(readPackIndex(idx).packChecksum()), cut - 20);
    await assert.rejects(() => readPack(short, idx).open(), /outside the pack's data/);
  }
  // 5. An oid that is not in the index.
  {
    const reader = readPack(pack, idx);
    const stranger = hex(sha1(B('never packed')));
    assert.equal(await reader.has(stranger), false);
    await assert.rejects(() => reader.read(stranger), /is not in this pack/);
    assert.equal(await reader.tryRead(stranger), null);
    await assert.rejects(() => reader.read('not-an-oid'), /not a git object id/);
  }
  // 6. A pack paired with a different pack's index.
  {
    const other = await writePack(sampleObjects(5).objects);
    await assert.rejects(() => readPack(pack, other.idx).open(), /does not match|declares/);
  }
  // 7. An index that claims the wrong object count.
  {
    const bad = clone();
    new DataView(bad.buffer).setUint32(8, 41);
    // Rehash so the trailer check passes and the count check is what fires.
    const rehashed = new Uint8Array(bad);
    rehashed.set(sha1(rehashed.subarray(0, rehashed.length - 20)), rehashed.length - 20);
    const reidx = await writePackIndex(
      readPackIndex(idx).oids().map((oid, i) => ({
        oid, offset: readPackIndex(idx).lookup(oid).offset, crc32: readPackIndex(idx).lookup(oid).crc32,
      })),
      rehashed.subarray(rehashed.length - 20),
    );
    await assert.rejects(() => readPack(rehashed, reidx).open(), /declares 41 objects/);
  }
  // 8. An object whose content was replaced with something that still passes the CRC:
  //    only the oid check can catch this, and it does.
  {
    const forged = clone();
    const at = await readPack(pack, idx).offsetOf(oids[7]);
    const original = objects[7].content;
    // Change one digit of the amount, keeping the length: the forgery a tamperer wants.
    const swapped = new Uint8Array(original);
    const amountAt = dec.decode(original).indexOf('net-amount') + 15;
    swapped[amountAt] = swapped[amountAt] === 0x39 ? 0x38 : swapped[amountAt] + 1;
    assert.equal(swapped.length, original.length, 'the forgery must be the same length');
    assert.notEqual(dec.decode(swapped), dec.decode(original), 'the forgery must actually differ');
    const compressed = await deflate(swapped);
    const header = encodeEntryHeader(3, swapped.length);
    forged.set(header, at);
    forged.set(compressed, at + header.length);
    // Rebuild the index around the forgery so its CRC32 and the pack SHA-1 both agree —
    // exactly what a determined tamperer would do.
    forged.set(sha1(forged.subarray(0, forged.length - 20)), forged.length - 20);
    const base = readPackIndex(idx);
    const entries = base.oids().map((oid) => ({ oid, ...base.lookup(oid) }));
    const target = entries.find((e) => e.oid === oids[7]);
    const end = Math.min(...entries.map((e) => e.offset).filter((o) => o > target.offset).concat(forged.length - 20));
    target.crc32 = crc32(forged.subarray(target.offset, end));
    const reidx = await writePackIndex(entries, forged.subarray(forged.length - 20));
    const reader = readPack(forged, reidx);
    await reader.verifyChecksum(); // the pack is internally consistent…
    await assert.rejects(() => reader.read(oids[7]), /is indexed as .* but hashes to/); // …and still refused
  }
});

test('a pack containing a delta cycle is refused rather than looped on', async () => {
  // Hand-built: two OFS_DELTA entries pointing at each other. No real git pack looks like
  // this, which is precisely why a reader has to be asked what it does with one.
  const delta = new Uint8Array([4, 4, 0x90, 0x00, 0x04]); // copy 4 bytes from base
  const compressed = await deflate(delta);
  const chunks = [];
  const header = new Uint8Array(12);
  header.set([0x50, 0x41, 0x43, 0x4b], 0);
  new DataView(header.buffer).setUint32(4, 2);
  new DataView(header.buffer).setUint32(8, 2);
  chunks.push(header);
  const offsets = [];
  let at = 12;
  // first entry: OFS_DELTA whose base is *after* it is impossible to encode (distance is
  // positive), so make the second point back at the first, and the first point back at
  // itself minus 0 — refused by the distance check.
  for (const distance of [0, 1]) {
    offsets.push(at);
    const entryHeader = encodeEntryHeader(6, delta.length);
    const distanceBytes = new Uint8Array([distance]);
    chunks.push(entryHeader, distanceBytes, compressed);
    at += entryHeader.length + 1 + compressed.length;
  }
  const body = concatBytes(...chunks);
  const pack = concatBytes(body, sha1(body));
  const entries = offsets.map((offset, i) => ({
    oid: hex(sha1(B(`cycle ${i}`))),
    offset,
    crc32: crc32(pack.subarray(offset, i === 0 ? offsets[1] : pack.length - 20)),
  }));
  const idx = await writePackIndex(entries, pack.subarray(pack.length - 20));
  const reader = readPack(pack, idx);
  await assert.rejects(() => reader.read(entries[0].oid), /OFS_DELTA at \d+ points at offset/);
  await assert.rejects(() => reader.read(entries[1].oid), /OFS_DELTA|delta chain deeper|no entry in the index/);
});

// ---------------------------------------------------------------------------
// repack safety
// ---------------------------------------------------------------------------

/**
 * An FsAdapter that fails partway through, the way a power cut does: the file exists with
 * some of its bytes, and then nothing else happens.
 * @param {import('../runtime/git/fs.js').FsAdapter} inner
 * @param {(path: string, n: number) => 'ok'|'throw'|'tear'} decide
 */
function crashingFs(inner, decide) {
  let writes = 0;
  let removes = 0;
  return {
    ...inner,
    async write(path, data) {
      writes++;
      const verdict = decide(path, writes, 'write');
      if (verdict === 'tear') {
        await inner.write(path, data.subarray(0, Math.floor(data.length / 2)));
        throw new Error('injected crash: power cut halfway through a write');
      }
      if (verdict === 'throw') throw new Error('injected crash: before the write happened');
      return inner.write(path, data);
    },
    async remove(path) {
      removes++;
      if (decide(path, removes, 'remove') === 'throw') throw new Error('injected crash: during cleanup');
      return inner.remove(path);
    },
  };
}

/** A repo with a commit and ~60 loose objects, ready to be repacked. */
async function repoToRepack(tag) {
  const dir = tempDir(tag);
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs, { repackThreshold: 0 });
  const files = new Map();
  for (let i = 0; i < 60; i++) {
    files.set(`documents/invoice/INV-${String(i).padStart(4, '0')}.json`, B(`{"id":"INV-${i}","net-amount":"${i}.00 EUR"}`));
  }
  await r.commit({ files, message: 'before the repack', author: AUTHOR, time: T1, tzOffsetMinutes: TZ });
  await r.checkout();
  const oids = await packedStore(fs, { repackThreshold: 0 }).looseOids();
  return { dir, fs, r, oids };
}

/** Every object still readable, and git still happy. */
async function assertRepoIntact(dir, fs, oids, expectedMessage) {
  const store = packedStore(fs, { repackThreshold: 0 });
  for (const oid of oids) {
    const object = await store.read(oid);
    assert.equal(hex(sha1(concatBytes(B(`${object.type} ${object.content.length}\0`), object.content))), oid);
  }
  const r = repo(fs, { repackThreshold: 0 });
  const log = await r.log();
  assert.equal(log[0].message.trim(), expectedMessage);
  assert.ok((await r.readTreeAtHead()).size >= 60);
  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
  assert.equal(checked.output.trim(), '');
  assert.equal(git(dir, 'status', '--porcelain'), '');
}

test('a repack interrupted before the pack is written leaves the repo untouched', async () => {
  const { dir, fs, oids } = await repoToRepack('crash-a');
  const store = packedStore(crashingFs(fs, (path) => (path.endsWith('.idx.part') ? 'throw' : 'ok')), { repackThreshold: 0 });
  await assert.rejects(() => store.repack(), /injected crash/);
  assert.equal(readdirSync(`${dir}/.git/objects/pack`).length, 0);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
});

test('a repack interrupted while writing the pack leaves the repo readable and fsck clean', async () => {
  const { dir, fs, oids } = await repoToRepack('crash-b');
  const store = packedStore(crashingFs(fs, (path) => (path.endsWith('.pack') ? 'tear' : 'ok')), { repackThreshold: 0 });
  await assert.rejects(() => store.repack(), /injected crash/);
  const left = readdirSync(`${dir}/.git/objects/pack`).sort();
  assert.equal(left.filter((n) => n.endsWith('.pack')).length, 1, 'a half-written pack is on disk');
  assert.equal(left.filter((n) => n.endsWith('.idx')).length, 0, 'and it is invisible to git: no .idx');
  // Not one loose object was deleted, so nothing is lost.
  assert.equal((await packedStore(fs, { repackThreshold: 0 }).looseOids()).length, oids.length);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
  // A later repack clears the wreckage and succeeds.
  const again = packedStore(fs, { repackThreshold: 0 });
  const result = await again.repack();
  assert.equal(result.objects, oids.length);
  assert.equal(readdirSync(`${dir}/.git/objects/pack`).filter((n) => n.endsWith('.part')).length, 0);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
  assert.equal((await again.stats()).loose, 0);
});

test('a repack interrupted while publishing the index self-heals from its marker', async () => {
  const { dir, fs, oids } = await repoToRepack('crash-c');
  // The one non-atomic window: the final .idx write. Tear it in half.
  const store = packedStore(
    crashingFs(fs, (path) => (path.endsWith('.idx') && !path.endsWith('.idx.part') ? 'tear' : 'ok')),
    { repackThreshold: 0 },
  );
  await assert.rejects(() => store.repack(), /injected crash/);

  // Honest about the intermediate state: real git *does* reject a torn index. This is the
  // window rename(2) would close and FsAdapter has no rename (amendment P-3).
  const wounded = fsck(dir);
  assert.equal(wounded.ok, false, 'a torn .idx is not something git tolerates');
  assert.match(wounded.output, /index file .* is too small|non-monotonic|packfile .* index not opened/);
  // No data is at risk: every object is still loose.
  assert.equal((await packedStore(fs, { repackThreshold: 0 }).looseOids()).length, oids.length);

  // Opening the store repairs the index from the .idx.part marker, and git is clean again.
  const notes = [];
  const healed = packedStore(fs, { repackThreshold: 0, onRepair: (n) => notes.push(n) });
  assert.equal((await healed.packs.list()).length, 1);
  assert.match(notes.join('\n'), /repaired .*\.idx from .*\.idx\.part/);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
  // And the repo converges: the next repack finishes the job and removes the marker.
  await healed.repack();
  assert.equal(readdirSync(`${dir}/.git/objects/pack`).filter((n) => n.endsWith('.part')).length, 0);
  assert.equal((await healed.stats()).loose, 0);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
});

test('a repack interrupted while deleting loose objects leaves both copies, which is harmless', async () => {
  const { dir, fs, oids } = await repoToRepack('crash-d');
  let removed = 0;
  const store = packedStore(
    crashingFs(fs, (path, n, op) => (op === 'remove' && ++removed === 5 ? 'throw' : 'ok')),
    { repackThreshold: 0 },
  );
  await assert.rejects(() => store.repack(), /injected crash/);
  const still = await packedStore(fs, { repackThreshold: 0 }).looseOids();
  assert.ok(still.length > 0 && still.length < oids.length, `some loose objects remain: ${still.length}/${oids.length}`);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
  // Duplicated objects are not garbage to git, they are "prune-packable" — and the
  // in-flight marker in objects/info is invisible to git even now, mid-repack.
  const counts = git(dir, 'count-objects', '-v');
  assert.match(counts, /^garbage: 0$/m, counts);
  assert.match(counts, /^prune-packable: \d+$/m, counts);
  const again = packedStore(fs, { repackThreshold: 0 });
  await again.repack();
  assert.equal((await again.stats()).loose, 0);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
});

test('a repack refuses to delete anything if the pack does not read back', async () => {
  const { dir, fs, oids } = await repoToRepack('crash-e');
  // Corrupt the pack between writing it and verifying it: the bytes on disk are not the
  // bytes we produced. Nothing may be deleted after that.
  const store = packedStore({
    ...fs,
    async write(path, data) {
      if (path.endsWith('.pack')) {
        const wrecked = new Uint8Array(data);
        wrecked[Math.floor(wrecked.length / 2)] ^= 0xff;
        return fs.write(path, wrecked);
      }
      return fs.write(path, data);
    },
  }, { repackThreshold: 0 });
  await assert.rejects(() => store.repack(), /CRC32 mismatch|hashes to|differs between/);
  assert.equal((await packedStore(fs, { repackThreshold: 0 }).looseOids()).length, oids.length);
  await assertRepoIntact(dir, fs, oids, 'before the repack');
});

test('a corrupt index with no in-flight marker is refused by name', async () => {
  const { dir, fs, oids } = await repoToRepack('corrupt-idx');
  const store = packedStore(fs, { repackThreshold: 0 });
  const { packs } = await store.repack();
  const idxPath = `${dir}/.git/objects/pack/${packs[0]}.idx`;
  const bytes = new Uint8Array(readFileSync(idxPath));
  bytes[bytes.length - 5] ^= 0xff;
  writeFileSync(idxPath, bytes);
  const reopened = packedStore(fs, { repackThreshold: 0 });
  await assert.rejects(() => reopened.read(oids[0]), /is corrupt and there is no .* to repair it from/);
});

test('objects already in a pack are never written loose again', async () => {
  const dir = tempDir('nodup');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs, { repackThreshold: 0 });
  const files = new Map([['documents/invoice/INV-0001.json', B('{"id":"INV-1"}')]]);
  await r.commit({ files, message: 'one', author: AUTHOR, time: T1, tzOffsetMinutes: TZ });
  await r.repack();
  assert.equal((await r.stats()).loose, 0);
  // Committing the identical tree again adds exactly one object: the new commit.
  await r.commit({ files, message: 'two', author: AUTHOR, time: T1 + 60, tzOffsetMinutes: TZ });
  assert.equal((await r.stats()).loose, 1, 'only the new commit object is loose');
  const checked = fsck(dir);
  assert.ok(checked.ok, checked.output);
});

test('automatic repacking triggers on the threshold and nowhere else', async () => {
  const dir = tempDir('auto');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs, { repackThreshold: 40 });
  const files = new Map();
  for (let i = 0; i < 12; i++) {
    files.set(`documents/invoice/INV-${i}.json`, B(`{"id":"INV-${i}"}`));
    await r.commit({ files, message: `invoice ${i}`, author: AUTHOR, time: T1 + i, tzOffsetMinutes: TZ });
  }
  const stats = await r.stats();
  assert.ok(stats.packs.length >= 1, `expected an automatic repack, got ${JSON.stringify(stats)}`);
  assert.ok(stats.loose < 40, `loose objects should have been folded in: ${stats.loose}`);
  assert.equal((await r.log()).length, 12);
  await r.checkout();
  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  // And with the threshold off, nothing is ever packed behind the caller's back.
  const quiet = tempDir('auto-off');
  const qfs = nodeFs(quiet);
  await initRepo(qfs);
  const q = repo(qfs, { repackThreshold: 0 });
  for (let i = 0; i < 5; i++) {
    await q.commit({ files, message: `x ${i}`, author: AUTHOR, time: T1 + i, tzOffsetMinutes: TZ });
  }
  assert.equal((await q.stats()).packs.length, 0);
});

test('repack({all:true}) coalesces packs instead of accumulating them', async () => {
  const dir = tempDir('coalesce');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs, { repackThreshold: 0 });
  const files = new Map();
  /** @type {string[]} */
  const messages = [];
  // Five commits, each repacked on its own: five packs, which is what an unattended
  // installation accumulates one repack at a time.
  for (let c = 0; c < 5; c++) {
    for (let i = 0; i < 20; i++) files.set(`documents/invoice/INV-${c}-${i}.json`, B(`{"id":"INV-${c}-${i}","net-amount":"${i}.00 EUR"}`));
    messages.push(`batch ${c}`);
    await r.commit({ files, message: `batch ${c}`, author: AUTHOR, time: T1 + c * 60, tzOffsetMinutes: TZ });
    await r.repack();
  }
  const spread = await r.stats();
  assert.equal(spread.packs.length, 5, `expected five packs, got ${JSON.stringify(spread.packs)}`);
  assert.equal(spread.loose, 0);

  const store = packedStore(fs, { repackThreshold: 0 });
  const everything = await store.packs.oids();
  const result = await store.repack({ all: true });
  assert.equal(result.packs.length, 1, 'one pack out');
  assert.equal(result.removed.length, 5, 'five packs in');
  assert.equal(result.objects, everything.length);

  const folded = await packedStore(fs, { repackThreshold: 0 }).stats();
  assert.equal(folded.packs.length, 1);
  assert.equal(folded.loose, 0);
  assert.equal(folded.packed, everything.length);
  assert.equal(readdirSync(`${dir}/.git/objects/pack`).filter((n) => n.endsWith('.pack')).length, 1);
  assert.equal(readdirSync(`${dir}/.git/objects/info`).filter((n) => n.endsWith('.part')).length, 0);

  // Every object survived, git agrees, and the whole history still reads.
  const reopened = repo(fs, { repackThreshold: 0 });
  for (const oid of everything) assert.ok(await reopened.store.has(oid), `${oid} survived`);
  assert.deepEqual((await reopened.log()).map((c) => c.message.trim()).reverse(), messages);
  assert.equal((await reopened.readTreeAtHead()).size, 100);
  await reopened.checkout();
  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
  assert.equal(checked.output.trim(), '');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.match(git(dir, 'count-objects', '-v'), /^packs: 1$/m);
  assert.match(git(dir, 'count-objects', '-v'), /^garbage: 0$/m);

  // Idempotent: coalescing again finds the same object set, recognises the pack that
  // already holds it by name, and deletes nothing.
  const again = await packedStore(fs, { repackThreshold: 0 }).repack({ all: true });
  assert.deepEqual(again.packs, []);
  assert.deepEqual(again.removed, []);
  assert.equal(readdirSync(`${dir}/.git/objects/pack`).filter((n) => n.endsWith('.pack')).length, 1);
  assert.ok(fsck(dir).ok);
});

test('a coalescing repack that fails verification deletes nothing', async () => {
  const dir = tempDir('coalesce-crash');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs, { repackThreshold: 0 });
  const files = new Map();
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < 15; i++) files.set(`documents/article/A-${c}-${i}.json`, B(`{"id":"A-${c}-${i}"}`));
    await r.commit({ files, message: `batch ${c}`, author: AUTHOR, time: T1 + c * 60, tzOffsetMinutes: TZ });
    await r.repack();
  }
  const before = readdirSync(`${dir}/.git/objects/pack`).sort();
  assert.equal(before.filter((n) => n.endsWith('.pack')).length, 2);
  const oids = await packedStore(fs, { repackThreshold: 0 }).packs.oids();

  const store = packedStore(crashingFs(fs, (path) => (path.endsWith('.idx') && !path.endsWith('.idx.part') ? 'throw' : 'ok')), { repackThreshold: 0 });
  await assert.rejects(() => store.repack({ all: true }), /injected crash/);
  // The two original packs are untouched; the new one is invisible for want of an index.
  const after = readdirSync(`${dir}/.git/objects/pack`);
  for (const name of before) assert.ok(after.includes(name), `${name} must still be there`);
  const reopened = packedStore(fs, { repackThreshold: 0 });
  for (const oid of oids) assert.ok(await reopened.has(oid), `${oid} survived`);
  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
  assert.equal(checked.output.trim(), '');
});

test('the packed store works in RAM too, so a browser tab gets the same semantics', async () => {
  const fs = memFs();
  await initRepo(fs);
  const r = repo(fs, { repackThreshold: 0 });
  const files = new Map();
  for (let i = 0; i < 30; i++) files.set(`documents/article/A-${i}.json`, B(`{"id":"A-${i}"}`));
  await r.commit({ files, message: 'in RAM', author: AUTHOR, time: T1, tzOffsetMinutes: TZ });
  const before = await r.stats();
  await r.repack();
  const after = await r.stats();
  assert.equal(after.loose, 0);
  assert.equal(after.packed, before.loose);
  assert.equal((await r.readTreeAtHead()).size, 30);
  assert.equal((await r.log())[0].message.trim(), 'in RAM');
});

// ---------------------------------------------------------------------------
// the 64-bit offset path, for real
// ---------------------------------------------------------------------------

test('a pack larger than 2 GB, verified by git, read through 64-bit offsets', {
  skip: BIG_PACK ? false : 'set NEODONKEY_BIG_PACK=1 (writes ~2.2 GB and takes minutes)',
}, async () => {
  const dir = bareish(tempDir('bigpack'));
  const CHUNK = 4 * 1024 * 1024;
  const NEEDED = LARGE_OFFSET + 64 * 1024 * 1024; // comfortably past 2 GiB
  const count = Math.ceil(NEEDED / CHUNK) + 1;

  // Incompressible content, deterministically generated (no Math.random: non-negotiable
  // #5), so a 4 MB object stays 4 MB in the pack and offsets really do pass 2^31.
  const contentFor = (i) => {
    const out = new Uint8Array(CHUNK);
    let state = (i + 1) * 2654435761 >>> 0;
    for (let at = 0; at < CHUNK; at += 4) {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5; state >>>= 0;
      out[at] = state & 0xff; out[at + 1] = (state >>> 8) & 0xff;
      out[at + 2] = (state >>> 16) & 0xff; out[at + 3] = (state >>> 24) & 0xff;
    }
    return out;
  };

  const packPath = `${dir}/.git/objects/pack/tmp.pack`;
  writeFileSync(packPath, new Uint8Array(0));
  let pending = [];
  let pendingBytes = 0;
  const started = Date.now();
  const { idx, oids, packBytes } = await writePack(
    Array.from({ length: count }, (_, i) => ({ type: 'blob', read: async () => contentFor(i) })),
    {
      sink: (chunk) => {
        pending.push(chunk);
        pendingBytes += chunk.length;
        if (pendingBytes >= 32 * 1024 * 1024) {
          const flush = new Uint8Array(pendingBytes);
          let at = 0;
          for (const c of pending) { flush.set(c, at); at += c.length; }
          appendFileSync(packPath, flush);
          pending = []; pendingBytes = 0;
        }
      },
    },
  );
  if (pendingBytes > 0) {
    const flush = new Uint8Array(pendingBytes);
    let at = 0;
    for (const c of pending) { flush.set(c, at); at += c.length; }
    appendFileSync(packPath, flush);
  }
  const writeMs = Date.now() - started;
  assert.equal(statSync(packPath).size, packBytes);
  assert.ok(packBytes > LARGE_OFFSET, `pack is ${packBytes} bytes, needs to pass ${LARGE_OFFSET}`);

  const index = readPackIndex(idx);
  assert.ok(index.largeOffsetCount() > 0, 'the 64-bit table must be in use');
  const big = oids.filter((oid) => index.lookup(oid).offset >= LARGE_OFFSET);
  console.log(
    `\n  big pack: ${count} objects, ${packBytes} bytes written in ${writeMs} ms, `
    + `${index.largeOffsetCount()} objects past 2 GiB\n`,
  );

  const name = packBaseName(oids);
  execFileSync('mv', [packPath, `${dir}/.git/objects/pack/${name}.pack`]);
  writeFileSync(`${dir}/.git/objects/pack/${name}.idx`, idx);

  // Real git, on a pack whose last objects can only be found through the 64-bit table.
  const verify = git(dir, 'verify-pack', '-v', `.git/objects/pack/${name}.idx`);
  assert.match(verify, /\.pack: ok$/m, verify);
  for (const oid of [big[0], big[big.length - 1]]) {
    const offsetLine = verify.split('\n').find((l) => l.startsWith(oid));
    assert.ok(offsetLine, `verify-pack did not mention ${oid}`);
    const reported = Number(offsetLine.trim().split(/\s+/)[4]);
    assert.equal(reported, index.lookup(oid).offset, 'git reads the same 64-bit offset we wrote');
  }
  const checked = fsck(dir);
  assert.ok(checked.ok, `git fsck --strict failed:\n${checked.output}`);
  // This repo has no refs — it is a pack in a .git and nothing else — so every blob is
  // reachable from nothing and git says "dangling". That is a notice, not a complaint; what
  // must not appear is an error, a missing object or a broken link.
  const complaints = checked.output.split('\n').filter((l) => l !== '' && !l.startsWith('dangling blob'));
  assert.deepEqual(complaints, [], `git fsck --strict complained:\n${complaints.join('\n')}`);
  // Printed, not just asserted: this is the evidence for the 64-bit claim, and a claim of
  // this kind should be quotable from a test run rather than taken on trust.
  console.log([
    '  $ git verify-pack -v (last two lines)',
    ...verify.trim().split('\n').slice(-2).map((l) => `    ${l}`),
    `  $ git fsck --strict -> exit 0, ${checked.output.split('\n').filter((l) => l.startsWith('dangling blob')).length}`
    + ' "dangling blob" notices (no refs in this repo), no errors',
    `  objects past 2 GiB, offsets as git reports them: ${big.slice(0, 2).map((oid) => `${oid.slice(0, 8)}@${index.lookup(oid).offset}`).join(' ')}`,
    '',
  ].join('\n'));

  // And our own reader, through a lazy file source so 2.2 GB never has to be resident.
  const fd = openSync(`${dir}/.git/objects/pack/${name}.pack`, 'r');
  try {
    const source = {
      length: statSync(`${dir}/.git/objects/pack/${name}.pack`).size,
      slice(start, end) {
        const buf = Buffer.allocUnsafe(end - start);
        let got = 0;
        while (got < buf.length) {
          const n = readSync(fd, buf, got, buf.length - got, start + got);
          if (n <= 0) break;
          got += n;
        }
        assert.equal(got, buf.length);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      },
    };
    const reader = readPack(source, idx, { cacheBytes: 1 });
    for (const oid of [oids[0], big[0], big[big.length - 1]]) {
      const i = oids.indexOf(oid);
      const object = await reader.read(oid);
      assertSameBytes(object.content, contentFor(i), `object ${i} at offset ${index.lookup(oid).offset}`);
      // git's own answer, byte for byte, for the object behind a 64-bit offset.
      const theirs = execFileSync('git', ['cat-file', 'blob', oid], {
        cwd: dir, maxBuffer: 1 << 28,
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', HOME: dir },
      });
      assertSameBytes(object.content, new Uint8Array(theirs.buffer, theirs.byteOffset, theirs.byteLength), `git cat-file ${oid}`);
    }
  } finally {
    closeSync(fd);
  }
});

// ---------------------------------------------------------------------------
// the repo mesh (FD-3)
// ---------------------------------------------------------------------------

test('cross-references parse and format, and refuse what they do not understand', () => {
  assert.deepEqual(parseRef('koro-de:invoice/INV-2027-0042'), { repo: 'koro-de', entity: 'invoice', id: 'INV-2027-0042' });
  assert.deepEqual(parseRef('invoice/INV-0001'), { repo: null, entity: 'invoice', id: 'INV-0001' });
  assert.deepEqual(parseRef('koro-fr:goods-receipt/GR-0001'), { repo: 'koro-fr', entity: 'goods-receipt', id: 'GR-0001' });
  for (const bad of [
    '', ':invoice/X', 'koro-de:', 'koro-de:invoice', 'invoice/', '/INV-1', 'invoice//INV-1',
    'invoice/a/b', 'KORO:invoice/X', 'koro de:invoice/X', 'invoice/../../etc/passwd',
    'invoice/.', 'koro-de:Invoice/X', '-koro:invoice/X', 'invoice/-', 42, null, undefined, {},
  ]) {
    assert.equal(parseRef(bad), null, `parseRef(${JSON.stringify(bad)}) must be null`);
  }
  assert.equal(formatRef({ repo: 'koro-de', entity: 'invoice', id: 'INV-1' }), 'koro-de:invoice/INV-1');
  assert.equal(formatRef({ repo: null, entity: 'invoice', id: 'INV-1' }), 'invoice/INV-1');
  assert.equal(formatRef({ entity: 'invoice', id: 'INV-1' }), 'invoice/INV-1');
  for (const text of ['koro-de:invoice/INV-2027-0042', 'invoice/INV-0001', 'koro.fr-2:ledger-entry/L_1']) {
    assert.equal(formatRef(parseRef(text)), text, `round-trip ${text}`);
  }
  assert.throws(() => formatRef({ entity: 'invoice', id: 'a/b' }), /not a document id/);
  assert.throws(() => formatRef({ entity: 'In voice', id: 'X' }), /not an entity name/);
  assert.throws(() => formatRef({ repo: 'Bad Repo', entity: 'invoice', id: 'X' }), /not a repo id/);
  assert.throws(() => formatRef(null), /expected/);
  assert.equal(documentPath('invoice', 'INV-1'), 'documents/invoice/INV-1.json');
});

test('a repos.json manifest names the siblings and who may sign in them', () => {
  const KEY_DE = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGdeIn0tk3pxK1BQK1LqBqoLK6dTn8m1QcJ4B2fH5xYz sarah@koro.de';
  const KEY_FR = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB2fH5xYzGdeIn0tk3pxK1BQK1LqBqoLK6dTn8m1QcJ4 luc@koro.fr';
  const mesh = meshManifest({
    version: 1,
    self: 'koro-de',
    repos: [
      { id: 'koro-de', name: 'KoRo Handels GmbH', country: 'DE', keys: [KEY_DE] },
      { id: 'koro-fr', name: 'KoRo France SAS', country: 'FR', location: '../koro-fr', keys: [KEY_FR], retention: '10y' },
      { id: 'koro-holding', name: 'KoRo Holding', country: 'DE', keys: [] },
    ],
  });
  assert.deepEqual(mesh.repos().map((r) => r.id), ['koro-de', 'koro-fr', 'koro-holding']);
  assert.equal(mesh.self(), 'koro-de');
  assert.deepEqual(mesh.keysFor('koro-fr'), [KEY_FR]);
  assert.deepEqual(mesh.keysFor('koro-holding'), [], 'declared with no signers means nothing verifies there');
  assert.throws(() => mesh.keysFor('koro-it'), /no repo "koro-it"/);
  assert.equal(mesh.has('koro-it'), false);
  // An unknown field survives the read rather than being dropped.
  assert.equal(mesh.repos().find((r) => r.id === 'koro-fr').extra.retention, '10y');

  const local = mesh.resolve('invoice/INV-0001');
  assert.equal(local.local, true);
  assert.equal(local.repo.id, 'koro-de');
  assert.equal(local.path, 'documents/invoice/INV-0001.json');
  assert.equal(local.ref, 'koro-de:invoice/INV-0001');

  const foreign = mesh.resolve('koro-fr:goods-receipt/GR-0007');
  assert.equal(foreign.local, false);
  assert.equal(foreign.repo.location, '../koro-fr');
  assert.equal(foreign.path, 'documents/goods-receipt/GR-0007.json');
  assert.deepEqual(mesh.keysFor(foreign.repo.id), [KEY_FR]);
  assert.deepEqual(mesh.resolve({ repo: 'koro-fr', entity: 'invoice', id: 'F-1' }).path, 'documents/invoice/F-1.json');

  assert.throws(() => mesh.resolve('koro-it:invoice/X'), /not in this mesh/);
  assert.throws(() => mesh.resolve('nonsense'), /not a cross-reference/);
});

test('a repos.json manifest refuses to be read optimistically', () => {
  assert.throws(() => meshManifest({ repos: [] }), /unsupported repos.json version/);
  assert.throws(() => meshManifest({ version: 2, repos: [] }), /unsupported repos.json version 2/);
  assert.throws(() => meshManifest({ version: 1 }), /needs a "repos" array/);
  assert.throws(() => meshManifest('[]'), /must be a JSON object/);
  assert.throws(() => meshManifest({ version: 1, repos: [{ id: 'a' }] }), /has no "keys" array/);
  assert.throws(() => meshManifest({ version: 1, repos: [{ id: 'Bad', keys: [] }] }), /not a usable repo id/);
  assert.throws(
    () => meshManifest({ version: 1, repos: [{ id: 'a', keys: [] }, { id: 'a', keys: [] }] }),
    /declared twice/,
  );
  assert.throws(
    () => meshManifest({ version: 1, repos: [{ id: 'a', keys: ['hunter2'] }] }),
    /not an OpenSSH public key line/,
  );
  assert.throws(() => meshManifest({ version: 1, self: 'b', repos: [{ id: 'a', keys: [] }] }), /"self" names b/);
  // A local reference with no "self" cannot be resolved, and says so rather than guessing.
  const mesh = meshManifest({ version: 1, repos: [{ id: 'a', keys: [] }] });
  assert.throws(() => mesh.resolve('invoice/X'), /does not say which repo is "self"/);
  // JSON text is accepted as well as a parsed object, because that is what a repos.json is.
  assert.equal(meshManifest('{"version":1,"repos":[{"id":"a","keys":[]}]}').repos().length, 1);
});

test('two repos, read across, with each entity\'s objects only in its own pack', async () => {
  // FD-3 end to end at the smallest honest scale: two repos, each packed, a document in
  // one referring to a document in the other, resolved through repos.json and read.
  const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGdeIn0tk3pxK1BQK1LqBqoLK6dTn8m1QcJ4B2fH5xYz sarah@koro.de';
  const dirs = {};
  const repos = {};
  for (const id of ['koro-de', 'koro-fr']) {
    const dir = tempDir(id);
    dirs[id] = dir;
    const fs = nodeFs(dir);
    await initRepo(fs);
    repos[id] = { fs, r: repo(fs, { repackThreshold: 0 }) };
  }
  const manifest = {
    version: 1,
    self: 'koro-de',
    repos: [
      { id: 'koro-de', keys: [KEY], location: dirs['koro-de'] },
      { id: 'koro-fr', keys: [KEY], location: dirs['koro-fr'] },
    ],
  };

  await repos['koro-fr'].r.commit({
    files: new Map([[documentPath('invoice', 'FR-0001'), B(JSON.stringify({ id: 'FR-0001', entity: 'invoice', 'net-amount': '1200.00 EUR' }))]]),
    message: 'French invoice', author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  await repos['koro-de'].r.commit({
    files: new Map([[documentPath('intercompany-charge', 'IC-0001'), B(JSON.stringify({
      id: 'IC-0001', entity: 'intercompany-charge', counterparty: 'koro-fr:invoice/FR-0001',
    }))]]),
    message: 'German side of the intercompany charge', author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  for (const id of ['koro-de', 'koro-fr']) {
    await repos[id].r.repack();
    assert.equal((await repos[id].r.stats()).loose, 0);
  }

  const mesh = meshManifest(manifest);
  const own = await repos['koro-de'].r.readTreeAtHead();
  const charge = JSON.parse(dec.decode(await repos['koro-de'].r.readBlob(own.get(documentPath('intercompany-charge', 'IC-0001')))));
  const target = mesh.resolve(charge.counterparty);
  assert.equal(target.local, false);
  assert.equal(target.repo.id, 'koro-fr');

  // Cross-repo *reading*: open the sibling by the location its manifest entry gives, and
  // read the document out of its pack. No distributed transaction anywhere in sight — and
  // by FD-3 there will not be one.
  const sibling = repo(nodeFs(target.repo.location), { repackThreshold: 0 });
  const siblingTree = await sibling.readTreeAtHead();
  const invoice = JSON.parse(dec.decode(await sibling.readBlob(siblingTree.get(target.path))));
  assert.equal(invoice['net-amount'], '1200.00 EUR');
  assert.equal(invoice.id, 'FR-0001');

  for (const id of ['koro-de', 'koro-fr']) {
    const checked = fsck(dirs[id]);
    assert.ok(checked.ok, `${id}: git fsck --strict failed:\n${checked.output}`);
  }
});
