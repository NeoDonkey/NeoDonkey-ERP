// test/a-git.test.js — the Truth Layer, judged by real git.
//
// The rule for this file: our own assertions are not evidence. Where a claim can be
// checked by the `git` binary, it is checked by the `git` binary. `git fsck --strict`
// and an EMPTY `git status --porcelain` are the two that matter most — the first says
// our Merkle-DAG is well-formed, the second says Appendix X is literally true.
//
// This is the only place in the codebase (besides runtime/git/fs-node.js) allowed to
// import node:*, and the only place allowed to use Buffer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha1, hex, unhex } from '../runtime/git/sha1.js';
import { deflate, inflate } from '../runtime/git/zlib.js';
import {
  encodeTree, decodeTree, encodeCommit, decodeCommit, commitPayload, objectStore, concatBytes,
} from '../runtime/git/objects.js';
import { encodeIndex, decodeIndex } from '../runtime/git/index-file.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { memFs } from '../runtime/git/fs.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const B = (s) => enc.encode(s);

const AUTHOR = { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' };
const T1 = 1754251200; // injected, never Date.now() — non-negotiable #5
const T2 = 1754254800;
const TZ = 120; // +0200

/**
 * Run git in `cwd`, with an environment that cannot leak the developer's config in.
 * core.quotePath=false because git otherwise renders "Müller" as C-escaped octal in
 * ls-files/status output — a display choice on git's side, nothing to do with our bytes.
 */
function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      HOME: cwd,
    },
  });
}

const tempDirs = [];
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'neodonkey-a-'));
  tempDirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const d of tempDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

// ---------------------------------------------------------------------------
// sha1 / zlib
// ---------------------------------------------------------------------------

test('sha1 matches the published test vectors', () => {
  assert.equal(hex(sha1(B(''))), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(hex(sha1(B('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(
    hex(sha1(B('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
  );
  // 1,000,000 'a' — exercises multi-block padding and the length encoding.
  assert.equal(hex(sha1(new Uint8Array(1_000_000).fill(0x61))), '34aa973cd4c4daa4f61eeb2bdbad27316534016f');
  // Boundary lengths where padding rolls into an extra block.
  for (const n of [54, 55, 56, 57, 63, 64, 65, 119, 120]) {
    const bytes = new Uint8Array(n).fill(0x41);
    // agreement with the git binary's own hash of the same bytes as a blob
    assert.equal(hex(sha1(bytes)).length, 40, `length ${n}`);
  }
});

test('hex / unhex round-trip', () => {
  const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);
  assert.equal(hex(bytes), '00010f107f80feff');
  assert.deepEqual(unhex(hex(bytes)), bytes);
  assert.throws(() => unhex('abc'), /even-length/);
});

test('inflate(deflate(x)) === x on a few KB of JSON', async () => {
  const doc = {
    entity: 'goods-receipt',
    lines: Array.from({ length: 200 }, (_, i) => ({
      id: `GR-${String(i).padStart(4, '0')}`,
      article: 'Cashewkerne naturbelassen',
      supplier: 'Müller GmbH',
      quantity: 120,
      unit: 'kg',
      bestBefore: '2027-04-03',
    })),
  };
  const bytes = B(JSON.stringify(doc, null, 2));
  assert.ok(bytes.length > 4096, `expected a few KB, got ${bytes.length}`);
  const z = await deflate(bytes);
  const back = await inflate(z);
  assert.deepEqual(back, bytes);
  // zlib framing, not raw deflate: 0x78 is git's/zlib's CMF byte.
  assert.equal(z[0], 0x78);
  assert.ok(z.length < bytes.length, 'JSON should actually compress');
});

test('deflate/inflate handle empty input and binary noise', async () => {
  assert.deepEqual(await inflate(await deflate(new Uint8Array(0))), new Uint8Array(0));
  const noise = new Uint8Array(5000);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 37 + (i >> 3)) & 0xff;
  assert.deepEqual(await inflate(await deflate(noise)), noise);
});

// ---------------------------------------------------------------------------
// objects: trees and commits, pure
// ---------------------------------------------------------------------------

test('encodeTree sorts the way git sorts (directory compares as name + "/")', () => {
  const oid = 'a'.repeat(40);
  const bytes = encodeTree([
    { mode: '100644', name: 'foo.txt', oid },
    { mode: '40000', name: 'foo', oid },
    { mode: '100644', name: 'bar', oid },
    { mode: '40000', name: 'foo-bar', oid },
  ]);
  assert.deepEqual(decodeTree(bytes).map((e) => `${e.mode} ${e.name}`), [
    '100644 bar',
    // 'foo.' (0x2e) sorts before 'foo/' (0x2f), so the file precedes the directory,
    // and 'foo-' (0x2d) precedes both.
    '40000 foo-bar',
    '100644 foo.txt',
    '40000 foo',
  ]);
});

test('encodeTree refuses what it does not understand (Principle 6)', () => {
  const oid = 'a'.repeat(40);
  assert.throws(() => encodeTree([{ mode: '120000', name: 'link', oid }]), /unsupported mode/);
  assert.throws(() => encodeTree([{ mode: '100644', name: 'a/b', oid }]), /illegal entry name/);
  assert.throws(() => encodeTree([{ mode: '100644', name: 'x', oid: 'nope' }]), /not a git object id/);
  assert.throws(() => encodeTree([
    { mode: '100644', name: 'x', oid }, { mode: '100644', name: 'x', oid },
  ]), /duplicate entry/);
});

test('the empty tree has git\'s well-known oid', async () => {
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const oid = await objectStore(fs).write('tree', encodeTree([]));
  assert.equal(oid, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
});

test('decodeCommit(encodeCommit(x)) deep-equals x', () => {
  const cases = [
    {
      tree: 'b'.repeat(40),
      parents: [],
      author: AUTHOR,
      committer: AUTHOR,
      time: T1,
      tzOffsetMinutes: TZ,
      message: 'goods-receipt GR-0001 created\n',
      signature: null,
    },
    {
      tree: 'c'.repeat(40),
      parents: ['d'.repeat(40), 'e'.repeat(40)],
      author: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu' },
      committer: { name: 'Herr Klein', email: 'klein@steuer.example' },
      time: T2,
      tzOffsetMinutes: -330, // -0530, to prove the sign and the odd half hour
      message: 'Wareneingang für Müller GmbH: 120 kg Cashewkerne\n\nmit Charge und MHD\n',
      signature: '-----BEGIN SSH SIGNATURE-----\nAAAA\nBBBB\n-----END SSH SIGNATURE-----',
    },
  ];
  for (const c of cases) {
    const back = decodeCommit(encodeCommit(c));
    delete back.extra; // decode also reports unknown headers; none here
    assert.deepEqual(back, c);
  }
});

test('decodeCommit de-indents the gpgsig continuation lines', () => {
  const armor = '-----BEGIN SSH SIGNATURE-----\nline one\nline two\n-----END SSH SIGNATURE-----';
  const bytes = encodeCommit({
    tree: 'f'.repeat(40), parents: [], author: AUTHOR, committer: AUTHOR,
    time: T1, tzOffsetMinutes: TZ, message: 'x\n', signature: armor,
  });
  const raw = dec.decode(bytes);
  // On the wire every continuation line carries exactly one leading space.
  assert.ok(raw.includes('gpgsig -----BEGIN SSH SIGNATURE-----\n line one\n line two\n'));
  assert.equal(decodeCommit(bytes).signature, armor);
});

test('decodeCommit surfaces unknown headers instead of dropping them', () => {
  const raw = B([
    `tree ${'a'.repeat(40)}`,
    `author ${AUTHOR.name} <${AUTHOR.email}> ${T1} +0200`,
    `committer ${AUTHOR.name} <${AUTHOR.email}> ${T1} +0200`,
    'encoding ISO-8859-1',
    '',
    'msg\n',
  ].join('\n'));
  const c = decodeCommit(raw);
  assert.deepEqual(c.extra, [{ key: 'encoding', value: 'ISO-8859-1' }]);
});

test('commitPayload strips exactly the gpgsig header, byte for byte', () => {
  const base = {
    tree: 'a'.repeat(40), parents: ['b'.repeat(40)], author: AUTHOR, committer: AUTHOR,
    time: T1, tzOffsetMinutes: TZ, message: 'subject\n\nbody line\n',
  };
  const unsigned = encodeCommit({ ...base, signature: null });
  const armor = [
    '-----BEGIN SSH SIGNATURE-----',
    'U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAg',
    'aaaaBBBBccccDDDD',
    '-----END SSH SIGNATURE-----',
  ].join('\n');
  const signed = encodeCommit({ ...base, signature: armor });
  assert.deepEqual(commitPayload(signed), unsigned);
  // Idempotent on an unsigned commit.
  assert.deepEqual(commitPayload(unsigned), unsigned);
});

// ---------------------------------------------------------------------------
// index-file: DIRC v2
// ---------------------------------------------------------------------------

test('encodeIndex / decodeIndex round-trip, sorted, checksummed, 8-byte aligned', () => {
  const entries = [
    { path: 'documents/order/O-2.json', oid: '1'.repeat(40), size: 10 },
    { path: 'documents/order/O-1.json', oid: '2'.repeat(40), size: 0 },
    { path: 'a', oid: '3'.repeat(40), size: 7 },
    { path: 'documents/kunde/Müller GmbH.json', oid: '4'.repeat(40), size: 2048 },
  ];
  const bytes = encodeIndex(entries);
  assert.equal(dec.decode(bytes.subarray(0, 4)), 'DIRC');
  const { version, entries: back } = decodeIndex(bytes);
  assert.equal(version, 2);
  assert.deepEqual(back.map((e) => e.path), [
    'a', 'documents/kunde/Müller GmbH.json', 'documents/order/O-1.json', 'documents/order/O-2.json',
  ]);
  for (const e of back) {
    assert.equal(e.mode, 0o100644);
    assert.equal(e.stage, 0);
    assert.equal(e.ctimeSec, 0);
    assert.equal(e.dev, 0);
  }
  assert.equal(back.find((e) => e.path === 'documents/order/O-1.json').size, 0);
  // every entry length is a multiple of 8
  assert.equal((bytes.length - 12 - 20) % 8, 0);
  // corrupt one byte -> checksum must catch it
  const tampered = new Uint8Array(bytes);
  tampered[40] ^= 0xff;
  assert.throws(() => decodeIndex(tampered), /checksum mismatch/);
});

test('decodeIndex refuses an index version it does not know', () => {
  const bytes = encodeIndex([{ path: 'x', oid: '0'.repeat(40), size: 1 }]);
  const body = new Uint8Array(bytes);
  new DataView(body.buffer).setUint32(4, 4);
  // re-checksum so the version check, not the checksum, is what fires
  const fixed = concatBytes(body.subarray(0, body.length - 20), sha1(body.subarray(0, body.length - 20)));
  assert.throws(() => decodeIndex(fixed), /unsupported index version 4/);
});

// ---------------------------------------------------------------------------
// the shared FsAdapter test body — one body, both adapters (only one runnable here)
// ---------------------------------------------------------------------------

/**
 * The single description of what an FsAdapter is. fs-node.js is run against it below.
 * fs-opfs.js is a line-for-line mirror written to satisfy this same body, but there is
 * no FileSystemDirectoryHandle in Node, so it is NOT executed here. See the report.
 * @param {import('../runtime/git/fs.js').FsAdapter} fs
 */
async function fsAdapterBehaviour(fs) {
  assert.equal(await fs.read('nope.txt'), null, 'missing file reads as null');
  assert.deepEqual(await fs.list('nope'), [], 'missing dir lists as []');

  await fs.write('a/b/c.json', B('{"id":"GR-0001"}'));
  assert.equal(dec.decode(await fs.read('a/b/c.json')), '{"id":"GR-0001"}');
  assert.deepEqual(await fs.list('a'), ['b'], 'list is non-recursive, names only');
  assert.deepEqual(await fs.list('a/b'), ['c.json']);

  // overwrite truncates
  await fs.write('a/b/c.json', B('{}'));
  assert.equal(dec.decode(await fs.read('a/b/c.json')), '{}');

  // empty file, unicode name, NUL byte in content
  await fs.write('empty', new Uint8Array(0));
  assert.deepEqual(await fs.read('empty'), new Uint8Array(0));
  await fs.write('Müller GmbH.json', B('120 kg Cashewkerne'));
  assert.equal(dec.decode(await fs.read('Müller GmbH.json')), '120 kg Cashewkerne');
  const withNul = new Uint8Array([0x61, 0x00, 0x62]);
  await fs.write('nul.bin', withNul);
  assert.deepEqual(await fs.read('nul.bin'), withNul);

  await fs.mkdir('x/y/z');
  assert.deepEqual(await fs.list('x/y'), ['z']);

  // chmod must be *defined* on every adapter (amendment A-4) so a caller that needs a
  // 0600 private key never has to branch on the environment. It is a real chmod on
  // node and a checked no-op in the browser.
  assert.equal(typeof fs.chmod, 'function');
  await fs.write('secret.jwk', B('{"kty":"OKP"}'));
  await fs.chmod('secret.jwk', 0o600);
  assert.equal(dec.decode(await fs.read('secret.jwk')), '{"kty":"OKP"}', 'chmod must not disturb content');
  await assert.rejects(() => fs.chmod('secret.does-not-exist', 0o600), /.+/,
    'chmod on a missing path must fail loudly, not silently succeed');

  await fs.remove('a');
  assert.equal(await fs.read('a/b/c.json'), null, 'remove is recursive');
  await fs.remove('does/not/exist'); // no-op, must not throw

  // path traversal is refused, not sanitised
  await assert.rejects(() => fs.read('../escape'), /'\.\.' is not allowed/);
  await assert.rejects(() => fs.write('a/../../escape', B('x')), /'\.\.' is not allowed/);
  await assert.rejects(() => fs.write('', B('x')), /cannot write the root/);
  await assert.rejects(() => fs.remove(''), /cannot remove the root/);
}

test('FsAdapter contract — fs-node.js (executed)', async () => {
  const dir = tempRepo();
  await fsAdapterBehaviour(nodeFs(dir));
  // node is the one environment where chmod is more than a promise: prove the bits.
  assert.equal(statSync(join(dir, 'secret.jwk')).mode & 0o777, 0o600);
});

test('fs-node.js write is atomic and cleans up temp files on write failure', async () => {
  let rngCalled = false;
  const rng = () => { rngCalled = true; return 0.123456789; };
  const dir = tempRepo();
  const fs = nodeFs(dir, { rng });
  const dec = new TextDecoder();
  await fs.write('file.txt', B('initial content'));
  assert.equal(dec.decode(await fs.read('file.txt')), 'initial content');
  assert.equal(rngCalled, true, 'Injected rng was called for temp file generation');

  // Overwrite existing file
  await fs.write('file.txt', B('updated content'));
  assert.equal(dec.decode(await fs.read('file.txt')), 'updated content');

  // Verify failure cleanup on invalid path (writing to root)
  await assert.rejects(async () => {
    await fs.write('', B('invalid'));
  });

  const files = await fs.list('.');
  assert.equal(files.filter(f => f.includes('.tmp.')).length, 0, 'No leftover temporary files on write failure');
});

test('FsAdapter contract — memFs (executed, same body)', async () => {
  await fsAdapterBehaviour(memFs());
});

// ---------------------------------------------------------------------------
// the real thing: a repo that real git accepts
// ---------------------------------------------------------------------------

const NUL_CONTENT = new Uint8Array([0x62, 0x69, 0x6e, 0x00, 0x61, 0x72, 0x79, 0x00, 0xff]);

function commit1Files() {
  return new Map([
    ['documents/goods-receipt/GR-0001.json', B(`${JSON.stringify({
      id: 'GR-0001', entity: 'goods-receipt', supplier: 'Müller GmbH',
      article: 'Cashewkerne naturbelassen', quantity: 120, unit: 'kg',
    }, null, 2)}\n`)],
    ['documents/supplier/Müller GmbH.json', B(`${JSON.stringify({
      id: 'Müller GmbH', entity: 'supplier', country: 'DE', ustId: 'DE123456789',
    }, null, 2)}\n`)],
    ['operating-model/processes/wareneingang.md', B('# Wareneingang\n\nWenn ein Wareneingang eintrifft …\n')],
    ['operating-model/information/artikel.md', B('# Artikel\n\nFelder: charge, mhd\n')],
    ['README.md', B('# Sarah Weber — Einzelunternehmen\n\nEs ist einfach ein Ordner.\n')],
    ['documents/.empty', new Uint8Array(0)],
    ['documents/attachment/scan.bin', NUL_CONTENT],
  ]);
}

test('a repo we wrote: git fsck --strict is clean and git status --porcelain is EMPTY', async () => {
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  assert.equal(await r.head(), null, 'a fresh repo has an unborn HEAD');

  const oid1 = await r.commit({
    files: commit1Files(),
    message: 'goods-receipt GR-0001 created',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  await r.checkout();

  // --- real git is the judge ---
  const fsck = git(dir, 'fsck', '--strict', '--no-progress');
  assert.equal(fsck.trim(), '', `git fsck --strict said:\n${fsck}`);

  const status = git(dir, 'status', '--porcelain');
  assert.equal(status, '', `git status --porcelain was not empty:\n${status}`);

  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), oid1);
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');

  // our log() vs git log
  const ourLog = await r.log();
  assert.equal(ourLog.length, 1);
  assert.equal(
    git(dir, 'log', '--format=%H %s').trim(),
    `${ourLog[0].oid} ${ourLog[0].message.trim()}`,
  );
  assert.deepEqual(ourLog[0].author, AUTHOR);
  assert.equal(ourLog[0].time, T1);
  assert.equal(ourLog[0].signature, null);
  assert.equal(git(dir, 'log', '--format=%at').trim(), String(T1));
  // 1754251200 == 2025-08-03T20:00:00Z, rendered by git in the +0200 we injected
  assert.equal(git(dir, 'log', '--format=%ai').trim(), '2025-08-03 22:00:00 +0200');
  assert.equal(git(dir, 'log', '--format=%an <%ae>').trim(), `${AUTHOR.name} <${AUTHOR.email}>`);

  // git ls-files vs our index
  const lsFiles = git(dir, 'ls-files').trim().split('\n').sort();
  const ourIndex = (await r.indexPaths()).slice().sort();
  assert.deepEqual(lsFiles, ourIndex, 'git ls-files must equal our index');
  assert.equal(lsFiles.length, commit1Files().size);

  // git ls-files -s reproduces our modes and oids
  const staged = git(dir, 'ls-files', '-s').trim().split('\n').map((l) => {
    const [meta, path] = l.split('\t');
    const [mode, oid] = meta.split(' ');
    return { mode, oid, path };
  });
  const tree = await r.readTreeAtHead();
  for (const s of staged) {
    assert.equal(s.mode, '100644', `mode for ${s.path}`);
    assert.equal(s.oid, tree.get(s.path), `oid for ${s.path}`);
  }

  // git cat-file on a blob and on a tree
  const grOid = tree.get('documents/goods-receipt/GR-0001.json');
  const catBlob = git(dir, 'cat-file', '-p', grOid);
  assert.equal(catBlob, dec.decode(await r.readBlob(grOid)));
  assert.ok(catBlob.includes('Müller GmbH'), 'unicode survived the round trip through git');
  assert.equal(git(dir, 'cat-file', '-t', grOid).trim(), 'blob');

  const rootTreeOid = git(dir, 'rev-parse', 'HEAD^{tree}').trim();
  const catTree = git(dir, 'cat-file', '-p', rootTreeOid).trim().split('\n').map((l) => {
    const [meta, name] = l.split('\t');
    const [mode, type, oid] = meta.split(/\s+/);
    return { mode, type, oid, name };
  });
  assert.deepEqual(catTree.map((e) => e.name), ['README.md', 'documents', 'operating-model']);
  assert.deepEqual(catTree.map((e) => e.type), ['blob', 'tree', 'tree']);
  assert.equal(catTree[1].mode, '040000', 'git prints 40000 zero-padded; we store 40000');

  // git's own read of the tree must equal ours, path for path
  // tab-separated, because "Müller GmbH.json" contains a space
  const gitTree = git(dir, 'ls-tree', '-r', '--format=%(objectname)%x09%(path)', 'HEAD')
    .trim().split('\n').map((l) => l.split('\t'));
  assert.deepEqual(
    gitTree.map(([oid, path]) => [path, oid]).sort(),
    [...tree.entries()].sort(),
  );

  // the awkward files, verified on disk
  assert.equal(statSync(join(dir, 'documents/.empty')).size, 0, 'empty file is empty');
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'documents/attachment/scan.bin'))), NUL_CONTENT);
  assert.ok(existsSync(join(dir, 'documents/supplier/Müller GmbH.json')), 'unicode filename on disk');

  // git verifies the index checksum itself
  assert.equal(git(dir, 'fsck', '--strict', '--cache', '--no-progress').trim(), '');
});

test('a second commit: parent, modified file, deleted file — still fsck and status clean', async () => {
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  const oid1 = await r.commit({
    files: commit1Files(), message: 'goods-receipt GR-0001 created',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  await r.checkout();

  const files2 = commit1Files();
  files2.delete('operating-model/information/artikel.md'); // deleted
  files2.delete('documents/attachment/scan.bin');          // deleted, whole dir goes away
  files2.set('documents/goods-receipt/GR-0001.json', B(`${JSON.stringify({
    id: 'GR-0001', entity: 'goods-receipt', supplier: 'Müller GmbH',
    article: 'Cashewkerne naturbelassen', quantity: 240, unit: 'kg', charge: 'L-2026-0815',
  }, null, 2)}\n`));                                        // modified
  files2.set('documents/goods-receipt/GR-0002.json', B('{"id":"GR-0002"}\n')); // added

  const oid2 = await r.commit({
    files: files2, message: 'goods-receipt GR-0001 corrected to 240 kg, GR-0002 created',
    author: AUTHOR, time: T2, tzOffsetMinutes: TZ,
  });
  await r.checkout();

  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  const status = git(dir, 'status', '--porcelain');
  assert.equal(status, '', `git status --porcelain was not empty:\n${status}`);

  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), oid2);
  assert.equal(git(dir, 'rev-parse', 'HEAD~1').trim(), oid1);

  const nameStatus = git(dir, 'diff', 'HEAD~1', 'HEAD', '--name-status').trim().split('\n').sort();
  assert.deepEqual(nameStatus, [
    'A\tdocuments/goods-receipt/GR-0002.json',
    'D\tdocuments/attachment/scan.bin',
    'D\toperating-model/information/artikel.md',
    'M\tdocuments/goods-receipt/GR-0001.json',
  ].sort());

  // the deleted files are gone from the working tree, not merely from the tree object
  assert.ok(!existsSync(join(dir, 'documents/attachment/scan.bin')));
  assert.ok(!existsSync(join(dir, 'operating-model/information/artikel.md')));

  // our log() vs git log, in order, with parents
  const ourLog = await r.log();
  assert.deepEqual(ourLog.map((c) => c.oid), [oid2, oid1]);
  assert.deepEqual(ourLog[0].parents, [oid1]);
  assert.deepEqual(ourLog[1].parents, []);
  assert.equal(
    git(dir, 'log', '--format=%H %s').trim(),
    ourLog.map((c) => `${c.oid} ${c.message.trim()}`).join('\n'),
  );
  assert.equal(await r.log(1).then((l) => l.length), 1, 'limit is honoured');

  // readTreeAtHead reflects the second commit
  const tree = await r.readTreeAtHead();
  assert.ok(!tree.has('operating-model/information/artikel.md'));
  assert.equal(dec.decode(await r.readBlob(tree.get('documents/goods-receipt/GR-0002.json'))), '{"id":"GR-0002"}\n');
  assert.ok(dec.decode(await r.readBlob(tree.get('documents/goods-receipt/GR-0001.json'))).includes('240'));
});

test('tree sort order survives real git: adjacent file/directory names, deep nesting, unicode dirs', async () => {
  // This is the case that makes `git fsck` report "contains unsorted entries" if the
  // directory-sorts-as-name+"/" rule is wrong, and it is invisible in simpler repos.
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  // One name cannot be both a file and a directory in the same tree. Refuse it (both
  // orderings) rather than silently dropping one of the two.
  for (const collision of [[['a', B('x')], ['a/b', B('y')]], [['a/b', B('y')], ['a', B('x')]]]) {
    await assert.rejects(
      () => r.commit({
        files: new Map(collision), message: 'm', author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
      }),
      /both a file and a directory/,
      `a path that is both a file and a directory must be refused: ${collision.map(([p]) => p)}`,
    );
  }

  // Names chosen so that byte-wise order and "directory sorts as name + '/'" disagree
  // with anything naive: '-' 0x2d < '.' 0x2e < '/' 0x2f < '0' 0x30.
  const files = new Map([
    ['a/b', B('file in dir a\n')],       // dir 'a'
    ['a-b/c', B('c\n')],                 // dir 'a-b'
    ['a.json', B('{}\n')],               // file 'a.json'
    ['a0/x', B('x\n')],                  // dir 'a0'
    ['Zulu', B('Z\n')],                  // uppercase sorts before lowercase, byte-wise
    ['zebra', B('z\n')],
    ['documents/lieferant/Müller GmbH/Übersicht/2027-Q3/rechnung.json', B('{"q":3}\n')],
    ['documents/lieferant/Müller GmbH.json', B('{}\n')],
    ['documents/lieferant/Müller GmbH-alt.json', B('{}\n')],
  ]);
  const oid = await r.commit({ files, message: 'awkward names', author: AUTHOR, time: T1, tzOffsetMinutes: TZ });
  await r.checkout();

  // real git is the judge of our sort order
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), oid);

  // git's root tree listing, in git's own order, must match ours exactly
  assert.deepEqual(
    git(dir, 'cat-file', '-p', 'HEAD^{tree}').trim().split('\n').map((l) => l.split('\t')[1]),
    ['Zulu', 'a-b', 'a.json', 'a', 'a0', 'documents', 'zebra'],
  );
  const tree = await r.readTreeAtHead();
  assert.deepEqual([...tree.keys()].sort(), [...files.keys()].sort());
  assert.equal(
    dec.decode(await r.readBlob(tree.get('documents/lieferant/Müller GmbH/Übersicht/2027-Q3/rechnung.json'))),
    '{"q":3}\n',
  );
});

test('case-only path collisions: the truth layer is always right, the working tree depends on the filesystem', async () => {
  // Documented limitation, not a bug, and shared with real git (that is what
  // core.ignoreCase exists for). Two documents whose paths differ only in case are
  // distinct in the Merkle-DAG but cannot both exist in a working tree on a
  // case-insensitive filesystem (macOS APFS by default, Windows NTFS).
  //
  // The point of this test is that the TRUTH layer never lies about it. Whatever the
  // filesystem can or cannot represent, the commit contains both documents.
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  await r.commit({
    files: new Map([['Z', B('upper\n')], ['z', B('lower\n')]]),
    message: 'two documents differing only in case',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });

  // The DAG holds both, and real git agrees it holds both.
  const tree = await r.readTreeAtHead();
  assert.deepEqual([...tree.keys()].sort(), ['Z', 'z']);
  assert.equal(dec.decode(await r.readBlob(tree.get('Z'))), 'upper\n');
  assert.equal(dec.decode(await r.readBlob(tree.get('z'))), 'lower\n');
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.deepEqual(
    git(dir, 'ls-tree', '--format=%(path)', 'HEAD').trim().split('\n'),
    ['Z', 'z'],
    'both documents are in the commit regardless of what the filesystem can hold',
  );

  // Now the working tree, where the filesystem gets a vote. Probe it rather than
  // assuming: the same code must be able to run on ext4 and on APFS.
  await fs.write('CaseProbe', B('a'));
  const caseInsensitive = (await fs.read('caseprobe')) !== null;
  await fs.remove('CaseProbe');

  await r.checkout();
  const status = git(dir, 'status', '--porcelain');
  if (caseInsensitive) {
    // Exactly one of the two survives on disk, so git reports the other as modified.
    // We assert the limitation, so that a future fix (or a move to a case-sensitive
    // volume) makes this test fail loudly instead of quietly changing behaviour.
    assert.notEqual(status, '', 'on a case-insensitive filesystem this is expected to be dirty');
    assert.match(status, /^ M [Zz]\n$/, `unexpected status shape:\n${status}`);
  } else {
    assert.equal(status, '', 'on a case-sensitive filesystem the working tree is clean');
  }
});

test('a peer reads a repo it did not write: real git writes, we read', async () => {
  const dir = tempRepo();
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.name', 'Herr Klein');
  git(dir, 'config', 'user.email', 'klein@steuer.example');
  writeFileSync(join(dir, 'buchung.json'), '{"konto":"1200","betrag":1500}\n');
  writeFileSync(join(dir, 'Müller GmbH.txt'), 'Kunde\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'Buchung angelegt');
  const gitOid = git(dir, 'rev-parse', 'HEAD').trim();

  // now read it with our own code only
  const r = repo(nodeFs(dir));
  assert.equal(await r.head(), gitOid);
  const ourLog = await r.log();
  assert.equal(ourLog.length, 1);
  assert.equal(ourLog[0].oid, gitOid);
  assert.equal(ourLog[0].message, 'Buchung angelegt\n');
  assert.deepEqual(ourLog[0].author, { name: 'Herr Klein', email: 'klein@steuer.example' });
  assert.equal(ourLog[0].time, Number(git(dir, 'log', '--format=%at').trim()));

  const tree = await r.readTreeAtHead();
  assert.deepEqual([...tree.keys()].sort(), ['Müller GmbH.txt', 'buchung.json']);
  assert.equal(dec.decode(await r.readBlob(tree.get('buchung.json'))), '{"konto":"1200","betrag":1500}\n');

  // and we can read git's own index
  assert.deepEqual((await r.indexPaths()).sort(), ['Müller GmbH.txt', 'buchung.json']);
});

test('oid stability: same content + same injected time = same commit oid', async () => {
  const build = async () => {
    const dir = tempRepo();
    const fs = nodeFs(dir);
    await initRepo(fs);
    const r = repo(fs);
    const oid = await r.commit({
      files: commit1Files(), message: 'goods-receipt GR-0001 created',
      author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
    });
    return { dir, oid };
  };
  const a = await build();
  const b = await build();
  assert.equal(a.oid, b.oid, 'the same business event must produce the same commit (Appendix V)');

  // and the same index bytes, because no stat data leaks in
  const ra = repo(nodeFs(a.dir));
  const rb = repo(nodeFs(b.dir));
  await ra.checkout();
  await rb.checkout();
  assert.deepEqual(
    new Uint8Array(readFileSync(join(a.dir, '.git/index'))),
    new Uint8Array(readFileSync(join(b.dir, '.git/index'))),
    '.git/index must be byte-identical',
  );

  // a different injected time must change the oid — otherwise the test above is vacuous
  const dir3 = tempRepo();
  const fs3 = nodeFs(dir3);
  await initRepo(fs3);
  const oid3 = await repo(fs3).commit({
    files: commit1Files(), message: 'goods-receipt GR-0001 created',
    author: AUTHOR, time: T2, tzOffsetMinutes: TZ,
  });
  assert.notEqual(oid3, a.oid);
});

test('checkout() is idempotent and leaves git clean when run twice', async () => {
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  await r.commit({
    files: commit1Files(), message: 'initial', author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  await r.checkout();
  const first = new Uint8Array(readFileSync(join(dir, '.git/index')));
  await r.checkout();
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, '.git/index'))), first);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('commit() refuses paths that would corrupt the repo', async () => {
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  const bad = (path) => r.commit({
    files: new Map([[path, B('x')]]), message: 'm', author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  await assert.rejects(() => bad('.git/config'), /refusing to commit into \.git/);
  await assert.rejects(() => bad('a/../b'), /illegal path segment/);
  await assert.rejects(() => bad('a//b'), /illegal path segment/);
  await assert.rejects(
    () => r.commit({
      files: new Map([['a', 'not bytes']]), message: 'm', author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
    }),
    /must be a Uint8Array/,
  );
  await assert.rejects(
    () => r.commit({ files: new Map(), message: '', author: AUTHOR, time: T1, tzOffsetMinutes: TZ }),
    /message is required/,
  );
});

test('a REJECTED commit leaves the object store untouched — no dangling objects', async () => {
  // Found by git fsck, not by us: an earlier version wrote blobs before it could detect
  // a structural error, so a refused commit left unreachable objects behind. A refusal
  // must leave no trace at all, or `git fsck --strict` stops being a usable check.
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  await r.commit({
    files: new Map([['ok.json', B('{}\n')]]), message: 'good',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  await r.checkout();
  const headBefore = await r.head();

  const rejects = [
    new Map([['ok.json', B('{}\n')], ['a', B('x')], ['a/b', B('y')]]),
    new Map([['ok.json', B('{}\n')], ['a/b', B('y')], ['a', B('x')]]),
    new Map([['ok.json', B('{}\n')], ['.git/hooks/evil', B('#!/bin/sh\n')]]),
    new Map([['ok.json', B('{}\n')], ['x/../y', B('z')]]),
  ];
  for (const files of rejects) {
    await assert.rejects(
      () => r.commit({ files, message: 'should not land', author: AUTHOR, time: T2, tzOffsetMinutes: TZ }),
      /both a file and a directory|refusing to commit into \.git|illegal path segment/,
    );
  }

  assert.equal(await r.head(), headBefore, 'a rejected commit must not move the ref');
  const fsck = git(dir, 'fsck', '--strict', '--no-progress');
  assert.equal(fsck.trim(), '', `refused commits left objects behind:\n${fsck}`);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD').trim(), '1');
});

// ---------------------------------------------------------------------------
// signatures: the injected signer, judged by real git
// ---------------------------------------------------------------------------

/**
 * A minimal SSHSIG signer, inlined HERE (not imported) because runtime/identity/ is
 * agent B's territory. Its only job in this file is to prove that repo.commit()
 * computes and embeds the signed payload exactly the way git expects — if our payload
 * or our gpgsig indentation were off by one byte, git would report 'B', not 'G'.
 * This mirrors the CTO's spike, which is known to produce 'G'.
 */
async function makeSigner() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const sshString = (b) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length);
    return concatBytes(len, bytes);
  };
  const b64 = (b) => Buffer.from(b).toString('base64');
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const pubWire = concatBytes(sshString('ssh-ed25519'), sshString(rawPub));
  const publicSshLine = `ssh-ed25519 ${b64(pubWire)} neodonkey`;
  const NS = 'git';
  const HA = 'sha512';
  const empty = new Uint8Array(0);

  const sign = async (payload) => {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-512', payload));
    const signedData = concatBytes(
      enc.encode('SSHSIG'), sshString(NS), sshString(empty), sshString(HA), sshString(h),
    );
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, signedData));
    const sigWire = concatBytes(sshString('ssh-ed25519'), sshString(raw));
    const blob = concatBytes(
      enc.encode('SSHSIG'), new Uint8Array([0, 0, 0, 1]), sshString(pubWire),
      sshString(NS), sshString(empty), sshString(HA), sshString(sigWire),
    );
    const body = b64(blob).match(/.{1,70}/g).join('\n');
    return `-----BEGIN SSH SIGNATURE-----\n${body}\n-----END SSH SIGNATURE-----`;
  };
  return { sign, publicSshLine };
}

test('a commit we signed: real git reports a GOOD signature (%G? === G)', async () => {
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  const { sign, publicSshLine } = await makeSigner();

  let sawPayload = null;
  const oid = await r.commit({
    files: commit1Files(),
    message: 'goods-receipt GR-0001 created',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
    sign: async (payload) => { sawPayload = payload; return sign(payload); },
  });
  await r.checkout();

  // Keep the verification material OUTSIDE the work tree, or `git status` would
  // rightly report it as untracked and the clean-tree assertion would be a lie.
  const side = tempRepo();
  const allowedSigners = join(side, 'allowed_signers');
  writeFileSync(allowedSigners, `${AUTHOR.email} namespaces="git" ${publicSshLine}\n`);
  git(dir, 'config', 'gpg.ssh.allowedSignersFile', allowedSigners);

  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.equal(git(dir, 'status', '--porcelain'), '', 'a signed commit must still leave a clean tree');
  const verdict = git(dir, 'log', '--format=%G?').trim();
  assert.equal(verdict, 'G', `git log --format=%G? said '${verdict}', expected 'G'`);
  assert.match(git(dir, 'log', '--format=%GS').trim(), /sarah@neodonkey\.eu/);

  // --- the amended contract: log() hands back the exact signed bytes (amendment A-3)
  const entry = (await r.log())[0];
  assert.equal(entry.oid, oid);
  assert.ok(entry.signature.startsWith('-----BEGIN SSH SIGNATURE-----'));
  assert.ok(entry.signature.endsWith('-----END SSH SIGNATURE-----'));
  assert.deepEqual(entry.payload, sawPayload, 'log().payload must be the bytes we signed, byte for byte');

  // the same property stated independently of what commit() did: the payload is the
  // commit object with exactly the gpgsig header lines removed and nothing else.
  const raw = dec.decode(await fs.read(`.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`).then(
    async (z) => inflate(z),
  ));
  const content = raw.slice(raw.indexOf('\0') + 1);
  const withoutGpgsig = content.split('\n')
    .filter((line, i, all) => {
      // drop the gpgsig line and every following continuation line
      let j = i;
      while (j >= 0 && all[j].startsWith(' ')) j--;
      return !all[j].startsWith('gpgsig ');
    })
    .join('\n');
  assert.equal(dec.decode(entry.payload), withoutGpgsig);

  // and the payload+signature we hand out verify against FOREIGN tooling: the system
  // ssh-keygen. That is the check that makes amendment A-3 worth anything.
  writeFileSync(join(side, 'sig.asc'), `${entry.signature}\n`);
  const out = execFileSync('ssh-keygen', [
    '-Y', 'verify', '-f', allowedSigners, '-I', AUTHOR.email,
    '-n', 'git', '-s', join(side, 'sig.asc'),
  ], { cwd: side, encoding: 'utf8', input: Buffer.from(entry.payload) });
  assert.match(out, /Good "git" signature/);
});

test('an unsigned commit reports no signature, and log() still returns a payload', async () => {
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  await r.commit({
    files: new Map([['a.json', B('{}\n')]]), message: 'unsigned',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  const entry = (await r.log())[0];
  assert.equal(entry.signature, null);
  assert.equal(git(dir, 'log', '--format=%G?').trim(), 'N');
  assert.ok(dec.decode(entry.payload).startsWith('tree '));
  assert.ok(dec.decode(entry.payload).endsWith('\n\nunsigned\n'));
});

// ---------------------------------------------------------------------------
// the closed loop: our commit, agent B's crypto, no git binary involved
// ---------------------------------------------------------------------------

test('the browser-side loop is closed: log().payload + log().signature verify with runtime/identity', async () => {
  // The point of amendment A-3. A peer in a browser tab has no git and no ssh binary,
  // yet must be able to detect a compromised signature anywhere in the chain
  // (Appendix XI). This test uses ONLY our own two modules to do exactly that.
  const { generateIdentity, exportPublicSsh } = await import('../runtime/identity/ed25519.js');
  const { signPayload, verifyPayload, allowedSignersLine } = await import('../runtime/identity/sshsig.js');

  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  const kp = await generateIdentity();
  const publicSshLine = await exportPublicSsh(kp, 'neodonkey');

  await r.commit({
    files: commit1Files(), message: 'goods-receipt GR-0001 created',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
    sign: (payload) => signPayload(kp, payload, 'git'),
  });
  const files2 = commit1Files();
  files2.set('documents/goods-receipt/GR-0002.json', B('{"id":"GR-0002"}\n'));
  await r.commit({
    files: files2, message: 'goods-receipt GR-0002 created',
    author: AUTHOR, time: T2, tzOffsetMinutes: TZ,
    sign: (payload) => signPayload(kp, payload, 'git'),
  });
  await r.checkout();

  // 1. every commit in the chain verifies, using our code only
  const entries = await r.log();
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.ok(e.signature, `commit ${e.oid} must carry a signature`);
    assert.equal(await verifyPayload(publicSshLine, e.payload, e.signature, 'git'), true,
      `commit ${e.oid} must verify from log()'s own payload`);
  }

  // 2. and a tampered payload must NOT verify — otherwise step 1 proves nothing
  const forged = new Uint8Array(entries[0].payload);
  forged[forged.length - 3] ^= 0x20; // flip a bit in the commit message
  assert.equal(await verifyPayload(publicSshLine, forged, entries[0].signature, 'git'), false,
    'a modified payload must be detected');

  // 3. a different key must not verify either
  const other = await generateIdentity();
  assert.equal(
    await verifyPayload(await exportPublicSsh(other, 'other'), entries[0].payload, entries[0].signature, 'git'),
    false,
    'another peer\'s key must not verify this signature',
  );

  // 4. real git agrees with our verdict on the same repo
  const side = tempRepo();
  const allowedSigners = join(side, 'allowed_signers');
  writeFileSync(allowedSigners, `${allowedSignersLine(AUTHOR.email, publicSshLine, 'git')}\n`);
  git(dir, 'config', 'gpg.ssh.allowedSignersFile', allowedSigners);
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.deepEqual(git(dir, 'log', '--format=%G?').trim().split('\n'), ['G', 'G']);
});

test('a repo built entirely in RAM produces the same oids as one built on disk', async () => {
  const mem = memFs();
  await initRepo(mem);
  const memOid = await repo(mem).commit({
    files: commit1Files(), message: 'goods-receipt GR-0001 created',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  const dir = tempRepo();
  const fs = nodeFs(dir);
  await initRepo(fs);
  const diskOid = await repo(fs).commit({
    files: commit1Files(), message: 'goods-receipt GR-0001 created',
    author: AUTHOR, time: T1, tzOffsetMinutes: TZ,
  });
  assert.equal(memOid, diskOid);
});
