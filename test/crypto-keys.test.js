// test/crypto-keys.test.js — the three key levels of Appendix VII, level by level, and the
// platform report the CTO asked for: which primitives WebCrypto *actually* gives us here.
//
// Standing rule 3 (foreign tooling is the judge) is honoured twice in this file: the encryption
// key binding is an SSHSIG, so it is verified by real `ssh-keygen -Y verify` as well as by us, and
// the curve report is produced by *asking WebCrypto*, never by assuming.
//
// Standing rule 5: nothing in here reports a pass it did not observe. Where a primitive is
// missing, the test says which one and what we did instead — see the first block.

import { test } from 'node:test';
import { scanSources } from './_source-guard.js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

import { generateIdentity, exportPublicSsh, b64encode, b64decode, utf8 } from '../runtime/identity/ed25519.js';
import { allowedSignersLine } from '../runtime/identity/sshsig.js';
import {
  CryptoError, REASONS, SECRET_LEN, GCM_IV_LEN, ENC_CURVES, DEFAULT_CURVE,
  generateEncryptionKeyPair, exportEncPublicRaw, importEncPublicRaw,
  exportEncPrivateJwk, importEncPrivateJwk,
  bindEncryptionKey, verifyEncryptionKeyBinding, encKeyBindingPayload,
  enrolment, verifyEnrolment, ENC_KEY_NAMESPACE,
  availableCurves, curveAvailable, agree, hkdf, wrapSecret, unwrapSecret,
  gcmEncrypt, gcmDecrypt, generateGroupSecret, generateDek, deriveNameKey, sealedId,
  keyIdOf, randomBytes, CRYPTO_PATHS, memberWrapInfo, dekWrapInfo,
} from '../runtime/crypto/keys.js';

const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-crypto-${tag}-`));

// =============================================================================================
// the platform report — what WebCrypto actually offers, in this engine
// =============================================================================================

test('platform report: which primitives Appendix VII assumes, and which this engine has', async () => {
  // Appendix VII's claim: "WebCrypto natively provides AES-GCM (content encryption), ECDH with
  // Curve25519 (key wrapping), HKDF (key derivation), AES-KW (wrap operations)."
  const report = {};
  const probe = async (name, fn) => {
    try { await fn(); report[name] = 'present'; } catch (e) { report[name] = `MISSING: ${e.name}`; }
  };
  await probe('AES-GCM', () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']));
  await probe('AES-KW', () => crypto.subtle.generateKey({ name: 'AES-KW', length: 256 }, true, ['wrapKey']));
  await probe('HKDF', () => crypto.subtle.importKey('raw', new Uint8Array(32), 'HKDF', false, ['deriveBits']));
  await probe('HMAC-SHA-256', () => crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  await probe('X25519', () => crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']));
  await probe('ECDH P-256', () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  await probe('Ed25519', () => crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']));

  // Every primitive Appendix VII names must be present, or the appendix is wrong about the
  // platform and that is a finding, not a workaround. Asserted rather than printed.
  assert.equal(report['AES-GCM'], 'present', JSON.stringify(report));
  assert.equal(report['AES-KW'], 'present', JSON.stringify(report));
  assert.equal(report.HKDF, 'present', JSON.stringify(report));
  assert.equal(report.Ed25519, 'present', JSON.stringify(report));

  // Curve25519 for *key agreement* is spelled `X25519` in WebCrypto, not `ECDH` with a named
  // curve. That is the one place the appendix's wording and the standard's differ.
  assert.equal(report.X25519, 'present',
    `Appendix VII assumes ECDH over Curve25519. If this ever reads MISSING, the format's `
    + `"kex" field is the fallback route and P-256 is the implemented alternative: ${JSON.stringify(report)}`);

  // Both curves are implemented, so a peer on an engine without X25519 is expressible rather
  // than excluded.
  const available = await availableCurves();
  assert.deepEqual(available, ['X25519', 'P-256'], `available curves: ${available.join(', ')}`);
  assert.equal(DEFAULT_CURVE, 'X25519', 'X25519 is the default because Appendix VII asks for it');
  assert.equal(await curveAvailable('Curve448'), false, 'an unknown curve is never "available"');
});

/**
 * The same rules as the rest of the runtime. Scanned with the shared source guard, which strips
 * comments and string literals first — the naive version of this test flagged `keys.js` for
 * `Math.random` because the file's own comment promises it appears nowhere. A guard that cannot
 * read its own documentation is a guard people learn to silence.
 */
test('runtime/crypto uses no clock, no Math.random, and no node:* — the same rules as the rest',
  () => {
    const dir = new URL('../runtime/crypto/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
    assert.ok(files.length >= 5, `expected the crypto modules, found ${files.join(', ')}`);

    const sources = new Map(files.map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]));
    const violations = scanSources(sources, [
      ['Math.random', /\bMath\s*\.\s*random\b/,
        'not a CSPRNG — key material must come from crypto.getRandomValues'],
      ['clock', /\bDate\s*\.\s*now\b|\bnew\s+Date\s*\(/,
        'time is injected, never read (CONTRACT non-negotiable #5)'],
      ['node builtin', /from\s+'(node:|fs|path|os|crypto)'/,
        'must load in a browser unchanged'],
    ]);
    assert.deepEqual(violations.map((v) => `${v.file}:${v.line} ${v.rule}`), [],
      JSON.stringify(violations, null, 2));

    // The CSPRNG is reached through one function, so there is one place to audit.
    for (const [f, text] of sources) {
      if (f === 'keys.js') continue;
      const direct = scanSources([[f, text]],
        [['direct getRandomValues', /getRandomValues/, 'randomness belongs in keys.js']]);
      assert.deepEqual(direct.map((v) => `${v.file}:${v.line}`), [],
        `${f} should take randomness from keys.js, not call getRandomValues itself`);
    }
  });


test('every reason token this layer can throw is declared in REASONS', () => {
  // A reason that is thrown but not declared is a reason a caller cannot handle. This test is
  // the thing that keeps the list honest as the code grows.
  const dir = new URL('../runtime/crypto/', import.meta.url);
  const thrown = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    for (const m of text.matchAll(/new CryptoError\(\s*'([a-z0-9-]+)'/g)) thrown.add(m[1]);
  }
  const declared = new Set(REASONS);
  const undeclared = [...thrown].filter((r) => !declared.has(r)).sort();
  assert.deepEqual(undeclared, [], `these reasons are thrown but not in REASONS: ${undeclared}`);
});

// =============================================================================================
// LEVEL 1 — personal key pairs
// =============================================================================================

test('level 1: an X25519 pair alongside the Ed25519 pair, and the Ed25519 module is reused as is', async () => {
  const signing = await generateIdentity({ comment: 'anna@neodonkey.eu' });
  const enc = await generateEncryptionKeyPair();

  assert.equal(enc.curve, 'X25519');
  const raw = await exportEncPublicRaw(enc);
  assert.equal(raw.length, 32, 'an X25519 public key is 32 bytes');

  // The signing key is untouched: still Ed25519, still 32 bytes, still an ssh-ed25519 line.
  const line = await exportPublicSsh(signing, 'anna@neodonkey.eu');
  assert.match(line, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5/);

  // The two keys are different objects with different algorithms — no reuse of one key for both
  // purposes, which is the mistake that makes signature and encryption compromises the same event.
  assert.equal(signing.publicKey.algorithm.name, 'Ed25519');
  assert.equal(enc.publicKey.algorithm.name, 'X25519');
});

test('level 1: private encryption keys default to non-extractable — COMPROMISES #2 is not made worse', async () => {
  const enc = await generateEncryptionKeyPair();
  assert.equal(enc.privateKey.extractable, false,
    'the default must be the browser-strong case: a CryptoKey handle, never key bytes in JS');
  await assert.rejects(() => exportEncPrivateJwk(enc), (e) => {
    assert.equal(e.reason, 'non-extractable');
    return true;
  });

  // The node peer's weak case is available but must be asked for explicitly, exactly like the
  // signing key in runtime/identity/keystore.js. Same posture, no new exposure.
  const extractable = await generateEncryptionKeyPair({ extractable: true });
  const jwk = await exportEncPrivateJwk(extractable);
  assert.equal(jwk.kty, 'OKP');
  assert.equal(jwk.crv, 'X25519');
  const back = await importEncPrivateJwk(jwk);
  assert.equal(back.curve, 'X25519');
  // and it is the same key: agreement with a third party matches
  const other = await generateEncryptionKeyPair({ extractable: true });
  const z1 = await agree({ privateKey: extractable.privateKey, publicKey: other.publicKey, curve: 'X25519' });
  const z2 = await agree({ privateKey: back.privateKey, publicKey: other.publicKey, curve: 'X25519' });
  assert.deepEqual([...z1], [...z2]);
});

test('level 1: P-256 is a real fallback, not a field in a document nobody implemented', async () => {
  const a = await generateEncryptionKeyPair({ curve: 'P-256', extractable: true });
  const b = await generateEncryptionKeyPair({ curve: 'P-256', extractable: true });
  assert.equal((await exportEncPublicRaw(a)).length, 65);
  const z1 = await agree({ privateKey: a.privateKey, publicKey: b.publicKey, curve: 'P-256' });
  const z2 = await agree({ privateKey: b.privateKey, publicKey: a.publicKey, curve: 'P-256' });
  assert.deepEqual([...z1], [...z2], 'ECDH is symmetric or it is broken');
  const jwk = await exportEncPrivateJwk(a);
  assert.equal((await importEncPrivateJwk(jwk)).curve, 'P-256');
});

test('level 1: an unknown curve is refused with a reason, never defaulted', async () => {
  await assert.rejects(() => generateEncryptionKeyPair({ curve: 'X448' }), (e) => {
    assert.ok(e instanceof CryptoError);
    assert.equal(e.reason, 'unknown-curve');
    return true;
  });
  await assert.rejects(() => importEncPublicRaw(new Uint8Array(32), 'secp256k1'),
    (e) => e.reason === 'unknown-curve');
  await assert.rejects(() => importEncPublicRaw(new Uint8Array(31), 'X25519'),
    (e) => e.reason === 'bad-public-key');
});

test('level 1: a mismatched curve/key length pair is refused rather than silently reinterpreted', async () => {
  const p256 = await generateEncryptionKeyPair({ curve: 'P-256', extractable: true });
  const raw = await exportEncPublicRaw(p256);           // 65 bytes
  await assert.rejects(() => importEncPublicRaw(raw, 'X25519'),
    (e) => e.reason === 'bad-public-key');
});

// --- the binding, which is the hole the manifest would otherwise have -------------------------

test('the encryption key is bound to its owner\'s signing key, and real ssh-keygen agrees', async () => {
  const signing = await generateIdentity({ comment: 'anna@neodonkey.eu' });
  const enc = await generateEncryptionKeyPair();
  const raw = await exportEncPublicRaw(enc);
  const armored = await bindEncryptionKey(signing, raw);
  const line = await exportPublicSsh(signing, 'anna@neodonkey.eu');

  assert.equal(await verifyEncryptionKeyBinding(line, raw, 'X25519', armored), true);

  // --- foreign tooling is the judge
  const dir = temp('bind');
  const signers = join(dir, 'allowed_signers');
  writeFileSync(signers, `${allowedSignersLine('anna@neodonkey.eu', line, ENC_KEY_NAMESPACE)}\n`);
  const sigFile = join(dir, 'binding.sig');
  writeFileSync(sigFile, `${armored}\n`);
  const out = execFileSync('ssh-keygen',
    ['-Y', 'verify', '-f', signers, '-I', 'anna@neodonkey.eu', '-n', ENC_KEY_NAMESPACE, '-s', sigFile],
    { input: Buffer.from(encKeyBindingPayload('X25519', raw)), encoding: 'utf8' });
  assert.match(out, new RegExp(`Good "${ENC_KEY_NAMESPACE}" signature`));
});

test('a substituted encryption key is refused: a manifest entry is not a claim its subject made', async () => {
  const anna = await generateIdentity({ comment: 'anna@neodonkey.eu' });
  const mallory = await generateEncryptionKeyPair();
  const annaEnc = await generateEncryptionKeyPair();

  const good = await enrolment({ signing: anna, encryption: annaEnc, principal: 'anna@neodonkey.eu' });
  assert.equal((await verifyEnrolment(good)).principal, 'anna@neodonkey.eu');

  // The attack: an admin writes Anna's row but puts *their own* encryption key in it, so every
  // wrap "for Anna" is readable by them. The commit is signed — by the admin — so commit
  // signatures do not catch this. The binding does.
  const forged = { ...good, 'enc-public-key': b64encode(await exportEncPublicRaw(mallory)) };
  await assert.rejects(() => verifyEnrolment(forged), (e) => {
    assert.equal(e.reason, 'enc-key-binding-invalid');
    return true;
  });

  // and the mirror: keeping Anna's encryption key but claiming a different owner's signing key
  const bob = await generateIdentity({ comment: 'bob@neodonkey.eu' });
  const swapped = { ...good, 'signing-public-key': await exportPublicSsh(bob, 'bob@neodonkey.eu') };
  await assert.rejects(() => verifyEnrolment(swapped), (e) => e.reason === 'enc-key-binding-invalid');
});

test('a binding over one curve does not verify as a binding over another', async () => {
  const signing = await generateIdentity();
  const enc = await generateEncryptionKeyPair({ curve: 'P-256' });
  const raw = await exportEncPublicRaw(enc);
  const armored = await bindEncryptionKey(signing, raw, 'P-256');
  const line = await exportPublicSsh(signing, 'x@y');
  assert.equal(await verifyEncryptionKeyBinding(line, raw, 'P-256', armored), true);
  assert.equal(await verifyEncryptionKeyBinding(line, raw, 'X25519', armored), false,
    'the curve is inside the signed payload, so it cannot be reinterpreted');
});

test('enrolment refuses garbage rather than accepting it as an unverifiable record', async () => {
  for (const bad of [null, {}, { format: 'other' }, { format: 'neodonkey-enrolment', version: 99 }]) {
    await assert.rejects(() => verifyEnrolment(bad), (e) => e.reason === 'enc-key-binding-invalid');
  }
  const signing = await generateIdentity();
  const enc = await generateEncryptionKeyPair();
  const good = await enrolment({ signing, encryption: enc, principal: 'a@b' });
  await assert.rejects(() => verifyEnrolment({ ...good, 'enc-curve': 'X448' }),
    (e) => e.reason === 'enc-key-binding-invalid');
  await assert.rejects(() => verifyEnrolment({ ...good, 'enc-public-key': 'not base64!!' }),
    (e) => e.reason === 'enc-key-binding-invalid');
});

test('key agreement refuses an all-zero shared secret (a small-order public key)', async () => {
  const mine = await generateEncryptionKeyPair({ extractable: true });
  // The canonical low-order point for X25519: all zeroes.
  const lowOrder = new Uint8Array(32);
  let refused = false;
  try {
    const publicKey = await importEncPublicRaw(lowOrder, 'X25519');
    await agree({ privateKey: mine.privateKey, publicKey, curve: 'X25519' });
  } catch (e) {
    refused = e instanceof CryptoError && e.reason === 'bad-public-key';
  }
  assert.equal(refused, true,
    'a low-order public key must be refused, either by the engine or by our zero check');
});

// =============================================================================================
// LEVEL 2 and 3 — symmetric material, derivation, wrapping
// =============================================================================================

test('level 2/3: a group secret and a DEK are 32 CSPRNG bytes, and randomness is injectable', () => {
  assert.equal(generateGroupSecret().length, SECRET_LEN);
  assert.equal(generateDek().length, SECRET_LEN);
  assert.notDeepEqual([...generateDek()], [...generateDek()], 'two DEKs must differ');

  const pinned = generateDek((b) => b.fill(7));
  assert.deepEqual([...pinned], new Array(32).fill(7),
    'an injected source is honoured, so a test can pin key material without a global');
  assert.throws(() => randomBytes(32, () => new Uint8Array(8)), (e) => e.reason === 'bad-key-length');
});

test('HKDF binds a derived key to its purpose: one changed character in `info` is a different key', async () => {
  const ikm = generateGroupSecret();
  const salt = randomBytes(32);
  const a = await hkdf(ikm, salt, dekWrapInfo('hr', 1));
  const b = await hkdf(ikm, salt, dekWrapInfo('hr', 2));
  const c = await hkdf(ikm, salt, dekWrapInfo('board', 1));
  const d = await hkdf(ikm, salt, memberWrapInfo('hr', 1));
  const all = [a, b, c, d].map((x) => b64encode(x));
  assert.equal(new Set(all).size, 4, 'group, epoch and purpose must all change the derived key');
  assert.deepEqual([...await hkdf(ikm, salt, dekWrapInfo('hr', 1))], [...a], 'and it is deterministic');
});

test('AES-KW round-trips, and a single flipped bit anywhere refuses with wrap-mac-failed', async () => {
  const kek = generateGroupSecret();
  const dek = generateDek();
  const wrapped = await wrapSecret(kek, dek);
  assert.equal(wrapped.length, SECRET_LEN + 8);
  assert.deepEqual([...await unwrapSecret(kek, wrapped)], [...dek]);

  for (const i of [0, 7, 20, wrapped.length - 1]) {
    const t = Uint8Array.from(wrapped);
    t[i] ^= 1;
    await assert.rejects(() => unwrapSecret(kek, t), (e) => {
      assert.equal(e.reason, 'wrap-mac-failed', `byte ${i} should refuse as wrap-mac-failed`);
      return true;
    });
  }
  const otherKek = generateGroupSecret();
  await assert.rejects(() => unwrapSecret(otherKek, wrapped), (e) => e.reason === 'wrap-mac-failed');
  await assert.rejects(() => unwrapSecret(kek, wrapped.subarray(0, 24)),
    (e) => e.reason === 'wrap-mac-failed');
});

test('AES-GCM authenticates its AAD: the same ciphertext under a different header is refused', async () => {
  const key = generateDek();
  const iv = randomBytes(GCM_IV_LEN);
  const aad = utf8('{"header":1}');
  const ct = await gcmEncrypt({ key, iv, plaintext: utf8('salary 5400'), aad });
  assert.deepEqual([...await gcmDecrypt({ key, iv, ciphertext: ct, aad })], [...utf8('salary 5400')]);

  await assert.rejects(() => gcmDecrypt({ key, iv, ciphertext: ct, aad: utf8('{"header":2}') }),
    (e) => e.reason === 'content-mac-failed');
  await assert.rejects(() => gcmDecrypt({ key, iv, ciphertext: ct }),
    (e) => e.reason === 'content-mac-failed');
  const flipped = Uint8Array.from(ct);
  flipped[0] ^= 1;
  await assert.rejects(() => gcmDecrypt({ key, iv, ciphertext: flipped, aad }),
    (e) => e.reason === 'content-mac-failed');
  await assert.rejects(() => gcmDecrypt({ key, iv: randomBytes(GCM_IV_LEN), ciphertext: ct, aad }),
    (e) => e.reason === 'content-mac-failed');
  await assert.rejects(() => gcmDecrypt({ key, iv: randomBytes(16), ciphertext: ct, aad }),
    (e) => e.reason === 'bad-iv-length');
});

// =============================================================================================
// sealed ids — Appendix VII's metadata-leakage mitigation
// =============================================================================================

test('a sealed id is a keyed hash: stable for a member, unguessable for everyone else', async () => {
  const secret = generateGroupSecret();
  const nameKey = await deriveNameKey(secret, 'hr', 1);
  const a = await sealedId({ nameKey, entity: 'salary', name: '2027-Q3-anna' });
  const b = await sealedId({ nameKey, entity: 'salary', name: '2027-Q3-anna' });
  assert.equal(a, b, 'stable: a document keeps its path across updates');
  assert.match(a, /^[A-Za-z0-9_-]{27}$/, 'base64url, filename-safe, no "/" for the read path');

  // Different name, different entity, different group, different epoch: all different ids.
  const others = new Set([
    await sealedId({ nameKey, entity: 'salary', name: '2027-Q3-bernd' }),
    await sealedId({ nameKey, entity: 'bonus', name: '2027-Q3-anna' }),
    await sealedId({ nameKey: await deriveNameKey(secret, 'board', 1), entity: 'salary', name: '2027-Q3-anna' }),
    await sealedId({ nameKey: await deriveNameKey(secret, 'hr', 2), entity: 'salary', name: '2027-Q3-anna' }),
    await sealedId({ nameKey: await deriveNameKey(generateGroupSecret(), 'hr', 1), entity: 'salary', name: '2027-Q3-anna' }),
  ]);
  assert.equal(others.size, 5);
  assert.equal(others.has(a), false);
});

test('the keyed sealed id is strictly stronger than the plain content hash the appendix describes', async () => {
  // The point of the strengthening, as a test rather than a claim: an adversary who holds the repo
  // and guesses the filename cannot confirm the guess, because confirming needs the name key.
  const secret = generateGroupSecret();
  const nameKey = await deriveNameKey(secret, 'hr', 1);
  const real = await sealedId({ nameKey, entity: 'salary', name: 'Salaries_Q3_2027' });

  // What a non-member can compute: SHA-256 of the guess. It is not the id.
  const plainHash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8('salary/Salaries_Q3_2027')));
  assert.notEqual(real, b64encode(plainHash).slice(0, 27));

  // And with the *wrong* name key — every candidate key a non-member could try — the guess fails.
  for (let i = 0; i < 8; i++) {
    const wrong = await deriveNameKey(generateGroupSecret(), 'hr', 1);
    assert.notEqual(await sealedId({ nameKey: wrong, entity: 'salary', name: 'Salaries_Q3_2027' }), real);
  }
});

test('a sealed id refuses a name or entity it cannot bind unambiguously', async () => {
  const nameKey = await deriveNameKey(generateGroupSecret(), 'hr', 1);
  await assert.rejects(() => sealedId({ nameKey, entity: 'a/b', name: 'x' }),
    (e) => e.reason === 'sealed-name-mismatch');
  await assert.rejects(() => sealedId({ nameKey, entity: '', name: 'x' }),
    (e) => e.reason === 'sealed-name-mismatch');
  await assert.rejects(() => sealedId({ nameKey, entity: 'salary', name: '' }),
    (e) => e.reason === 'sealed-name-mismatch');
  await assert.rejects(() => sealedId({ nameKey: new Uint8Array(16), entity: 'salary', name: 'x' }),
    (e) => e.reason === 'bad-secret-length');
});

test('a key id says nothing about its key, and every path it lands in is path-safe', async () => {
  const key = generateDek();
  const id = await keyIdOf(key);
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await keyIdOf(key), id, 'deterministic');
  assert.notEqual(await keyIdOf(generateDek()), id);
  // base64url can contain '-' and '_'; the path helpers must not mangle them.
  assert.equal(CRYPTO_PATHS.subject(id), `crypto/subjects/${id}.json`);
  assert.equal(CRYPTO_PATHS.vaultSubject(id), `subject-keys/${id}.json`);
  // and anything hostile is flattened, never allowed to escape
  assert.equal(CRYPTO_PATHS.group('../../etc/passwd'), 'crypto/groups/.._.._etc_passwd.json');
  assert.equal(b64decode(b64encode(key)).length, 32);
});
