// test/b-identity.test.js — runtime/identity/ against itself AND against the system OpenSSH.
//
// The whole point of the cross-verification block: if our verifier only accepts signatures we
// produced ourselves, it is not a verifier, and Appendix XI's "any peer detects the compromised
// signature" is a bluff. Real `ssh-keygen` is the judge, in BOTH directions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
  generateIdentity, exportPublicSsh, exportPrivateJwk, importPrivateJwk,
  parsePublicSsh, exportPublicRaw, encodePublicWire,
  concatBytes, sshString, sshUint32, b64encode, b64decode, b64urlEncode, utf8, reader,
} from '../runtime/identity/ed25519.js';
import { signPayload, verifyPayload, allowedSignersLine, inspectSignature } from '../runtime/identity/sshsig.js';
import { keystore } from '../runtime/identity/keystore.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ARMOR_BEGIN = '-----BEGIN SSH SIGNATURE-----';
const ARMOR_END = '-----END SSH SIGNATURE-----';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'neodonkey-identity-'));
}

function armorBlob(blob) {
  const b64 = b64encode(blob);
  const lines = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));
  return `${ARMOR_BEGIN}\n${lines.join('\n')}\n${ARMOR_END}`;
}

function deArmorToBytes(armored) {
  const body = armored
    .slice(armored.indexOf(ARMOR_BEGIN) + ARMOR_BEGIN.length, armored.indexOf(ARMOR_END))
    .replace(/\s+/g, '');
  return b64decode(body);
}

/** Minimal FsAdapter over node:fs — the same shape agent A's `nodeFs` will have, plus chmod,
 *  so this test does not depend on runtime/git/ existing yet. */
function testNodeFs(root) {
  const abs = (p) => join(root, p);
  return {
    async read(p) {
      try { return new Uint8Array(readFileSync(abs(p))); } catch { return null; }
    },
    async write(p, data) {
      mkdirSync(dirname(abs(p)), { recursive: true });
      writeFileSync(abs(p), data);
    },
    async list(p) {
      try { return readdirSync(abs(p)); } catch { return []; }
    },
    async remove(p) {
      rmSync(abs(p), { force: true, recursive: true });
    },
    async chmod(p, mode) { chmodSync(abs(p), mode); },
  };
}

/** Parse an unencrypted `openssh-key-v1` private key file so the SAME key exists in both
 *  worlds — that is what makes the `ssh-keygen -y` byte-identity claim testable at all. */
async function importOpensshPrivateKey(text) {
  const body = text
    .replace('-----BEGIN OPENSSH PRIVATE KEY-----', '')
    .replace('-----END OPENSSH PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const r = reader(b64decode(body));
  const magic = new TextDecoder().decode(r.bytes(15));
  assert.equal(magic, 'openssh-key-v1\0');
  assert.equal(r.text(), 'none', 'cipher must be none (unencrypted key)');
  assert.equal(r.text(), 'none', 'kdf must be none');
  r.string();                                  // kdf options
  assert.equal(r.uint32(), 1, 'one key per file');
  r.string();                                  // public key wire
  const priv = reader(r.string());             // unencrypted private section
  priv.uint32(); priv.uint32();                // checkint1, checkint2
  assert.equal(priv.text(), 'ssh-ed25519');
  const pub32 = new Uint8Array(priv.string());
  const priv64 = new Uint8Array(priv.string()); // seed(32) || pub(32)
  const comment = priv.text();
  assert.equal(pub32.length, 32);
  assert.equal(priv64.length, 64);
  const kp = await importPrivateJwk({
    kty: 'OKP', crv: 'Ed25519',
    d: b64urlEncode(priv64.subarray(0, 32)),
    x: b64urlEncode(pub32),
  });
  return { ...kp, comment };
}

const payloadOf = (s) => utf8(s);

// A realistic subject: exactly the shape of a git commit payload our repo signs.
const COMMIT_PAYLOAD = payloadOf(
  'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n'
  + 'author Sarah Weber <sarah@neodonkey.eu> 1754251200 +0200\n'
  + 'committer Sarah Weber <sarah@neodonkey.eu> 1754251200 +0200\n'
  + '\n'
  + 'goods-receipt GR-0001 created\n',
);

// ---------------------------------------------------------------------------
// ed25519.js
// ---------------------------------------------------------------------------

test('exportPublicSsh emits a well-formed OpenSSH line that round-trips through parsePublicSsh', async () => {
  const kp = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const line = await exportPublicSsh(kp);
  assert.match(line, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]+ sarah@neodonkey\.eu$/);
  const parsed = parsePublicSsh(line);
  assert.equal(parsed.type, 'ssh-ed25519');
  assert.equal(parsed.comment, 'sarah@neodonkey.eu');
  assert.deepEqual(parsed.raw, await exportPublicRaw(kp));
  assert.deepEqual(parsed.wire, encodePublicWire(parsed.raw));

  // no comment -> no trailing space (this is what `ssh-keygen -y` does for a comment-less key)
  const bare = await exportPublicSsh({ ...kp, comment: '' });
  assert.equal(bare.includes(' ', bare.indexOf(' ') + 1), false);
});

test('exportPrivateJwk / importPrivateJwk round-trip keeps the same public key and can sign', async () => {
  const kp = await generateIdentity({ comment: 'anna@neodonkey.eu' });
  const line = await exportPublicSsh(kp);
  const jwk = await exportPrivateJwk(kp);
  assert.equal(jwk.kty, 'OKP');
  assert.equal(jwk.crv, 'Ed25519');
  assert.equal(typeof jwk.d, 'string');

  const back = await importPrivateJwk(jwk);
  assert.equal(await exportPublicSsh(back), line);
  const sig = await signPayload(back, COMMIT_PAYLOAD);
  assert.equal(await verifyPayload(line, COMMIT_PAYLOAD, sig), true);
});

test('parsePublicSsh refuses non-ed25519 and malformed lines', () => {
  assert.throws(() => parsePublicSsh('ssh-rsa AAAAB3NzaC1yc2E='), /unsupported type/);
  assert.throws(() => parsePublicSsh('ssh-ed25519'), /missing base64/);
  assert.throws(() => parsePublicSsh('ssh-ed25519 !!!!'), /base64/);
  assert.throws(() => parsePublicSsh(''), /empty/);
  // right type, wrong inner length
  const short = b64encode(concatBytes(sshString('ssh-ed25519'), sshString(new Uint8Array(31))));
  assert.throws(() => parsePublicSsh(`ssh-ed25519 ${short}`), /bad key length/);
});

test('b64decode is strict', () => {
  assert.deepEqual(b64decode('AAAA'), new Uint8Array([0, 0, 0]));
  assert.throws(() => b64decode('AAA'), /multiple of 4/);
  assert.throws(() => b64decode('AA=A'), /misplaced padding/);
  assert.throws(() => b64decode('A A='), /invalid character/);
  assert.throws(() => b64decode('AA-A'), /invalid character/);   // base64url is not base64
});

// ---------------------------------------------------------------------------
// sshsig.js — round trip
// ---------------------------------------------------------------------------

test('sign -> verify round-trip with our own code', async () => {
  const kp = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const pub = await exportPublicSsh(kp);
  const sig = await signPayload(kp, COMMIT_PAYLOAD, 'git');

  assert.ok(sig.startsWith(ARMOR_BEGIN));
  assert.ok(sig.endsWith(ARMOR_END));
  assert.equal(sig.endsWith('\n'), false, 'no trailing newline: git re-indents every line');

  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, sig, 'git'), true);

  const info = inspectSignature(sig);
  assert.equal(info.version, 1);
  assert.equal(info.namespace, 'git');
  assert.equal(info.hashAlg, 'sha512');
  assert.equal(info.publicSshLine, pub.slice(0, pub.lastIndexOf(' ')));
});

test('signatures are namespace-scoped and hash-agile', async () => {
  const kp = await generateIdentity();
  const pub = await exportPublicSsh(kp);

  const fileSig = await signPayload(kp, COMMIT_PAYLOAD, 'file');
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, fileSig, 'file'), true);
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, fileSig, 'git'), false);

  const sha256Sig = await signPayload(kp, COMMIT_PAYLOAD, 'git', { hashAlg: 'sha256' });
  assert.equal(inspectSignature(sha256Sig).hashAlg, 'sha256');
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, sha256Sig, 'git'), true);
});

test('empty payload signs and verifies (a legitimate edge, not an error)', async () => {
  const kp = await generateIdentity();
  const pub = await exportPublicSsh(kp);
  const sig = await signPayload(kp, new Uint8Array(0));
  assert.equal(await verifyPayload(pub, new Uint8Array(0), sig), true);
  assert.equal(await verifyPayload(pub, payloadOf('x'), sig), false);
});

// ---------------------------------------------------------------------------
// sshsig.js — the tamper matrix. Every single one must be `false`, never a throw.
// ---------------------------------------------------------------------------

test('tamper matrix: every corruption verifies false and nothing throws', async () => {
  const kp = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const other = await generateIdentity({ comment: 'thief@example.com' });
  const pub = await exportPublicSsh(kp);
  const otherPub = await exportPublicSsh(other);
  const sig = await signPayload(kp, COMMIT_PAYLOAD, 'git');

  // control
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, sig, 'git'), true);

  // 1. flipped byte in the payload
  const badPayload = Uint8Array.from(COMMIT_PAYLOAD);
  badPayload[40] ^= 0x01;
  assert.equal(await verifyPayload(pub, badPayload, sig, 'git'), false, 'flipped payload byte');

  // 2. flipped byte inside the signature field (structurally valid armor, wrong signature)
  const blob = deArmorToBytes(sig);
  const flipped = Uint8Array.from(blob);
  flipped[flipped.length - 1] ^= 0x01;
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, armorBlob(flipped), 'git'), false, 'flipped signature byte');

  // 3. wrong namespace expectation ('file' vs 'git')
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, sig, 'file'), false, 'wrong namespace');

  // 4. public key of a different keypair
  assert.equal(await verifyPayload(otherPub, COMMIT_PAYLOAD, sig, 'git'), false, 'foreign public key');

  // 5. truncated armor
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, sig.slice(0, sig.length - 60), 'git'), false, 'truncated armor');
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, `${ARMOR_BEGIN}\n`, 'git'), false, 'BEGIN only');

  // 6. garbage base64 inside otherwise correct armor
  assert.equal(
    await verifyPayload(pub, COMMIT_PAYLOAD, `${ARMOR_BEGIN}\n@@@@not base64@@@@\n${ARMOR_END}`, 'git'),
    false, 'garbage base64',
  );

  // 7. empty string, and other non-signatures
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, '', 'git'), false, 'empty string');
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, 'hello', 'git'), false, 'plain text');
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, null, 'git'), false, 'null');
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, undefined, 'git'), false, 'undefined');
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, {}, 'git'), false, 'object');

  // 8. right shape, zeroed signature field
  const raw = await exportPublicRaw(kp);
  const zeroed = concatBytes(
    utf8('SSHSIG'), sshUint32(1),
    sshString(encodePublicWire(raw)),
    sshString('git'), sshString(new Uint8Array(0)), sshString('sha512'),
    sshString(concatBytes(sshString('ssh-ed25519'), sshString(new Uint8Array(64)))),
  );
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, armorBlob(zeroed), 'git'), false, 'zeroed signature');

  // 9. unknown version
  const badVersion = concatBytes(
    utf8('SSHSIG'), sshUint32(2),
    sshString(encodePublicWire(raw)),
    sshString('git'), sshString(new Uint8Array(0)), sshString('sha512'),
    sshString(concatBytes(sshString('ssh-ed25519'), sshString(new Uint8Array(64)))),
  );
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, armorBlob(badVersion), 'git'), false, 'version 2');

  // 10. bad magic
  const badMagic = Uint8Array.from(blob);
  badMagic[0] = 0x58;
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, armorBlob(badMagic), 'git'), false, 'bad magic');

  // 11. unknown hash algorithm (md5) — even with a real key embedded
  const badHash = concatBytes(
    utf8('SSHSIG'), sshUint32(1),
    sshString(encodePublicWire(raw)),
    sshString('git'), sshString(new Uint8Array(0)), sshString('md5'),
    sshString(concatBytes(sshString('ssh-ed25519'), sshString(new Uint8Array(64)))),
  );
  assert.equal(await verifyPayload(pub, COMMIT_PAYLOAD, armorBlob(badHash), 'git'), false, 'md5 hash alg');

  // 12. trailing bytes appended to an otherwise valid blob
  assert.equal(
    await verifyPayload(pub, COMMIT_PAYLOAD, armorBlob(concatBytes(blob, utf8('!'))), 'git'),
    false, 'trailing bytes',
  );

  // 13. truncated blob (valid base64, structurally short)
  assert.equal(
    await verifyPayload(pub, COMMIT_PAYLOAD, armorBlob(blob.subarray(0, blob.length - 20)), 'git'),
    false, 'truncated blob',
  );

  // 14. a broken expected-signer line must not throw either
  assert.equal(await verifyPayload('not a key', COMMIT_PAYLOAD, sig, 'git'), false, 'bad signer line');
  assert.equal(await verifyPayload('', COMMIT_PAYLOAD, sig, 'git'), false, 'empty signer line');
});

// ---------------------------------------------------------------------------
// Cross-verification against the system OpenSSH. Both directions.
// ---------------------------------------------------------------------------

test('system OpenSSH is present (the cross-checks below are the acceptance criterion)', () => {
  // `ssh -V` writes the banner to stderr.
  const r = spawnSync('ssh', ['-V'], { encoding: 'utf8' });
  const banner = `${r.stdout || ''}${r.stderr || ''}`;
  assert.match(banner, /OpenSSH/, `expected an OpenSSH binary, got ${JSON.stringify(banner)}`);
});

test('direction A: OUR signature + OUR allowed_signers line verify with the system ssh-keygen', async () => {
  const dir = tempDir();
  const email = 'sarah@neodonkey.eu';
  const kp = await generateIdentity({ comment: email });
  const pub = await exportPublicSsh(kp);
  const sig = await signPayload(kp, COMMIT_PAYLOAD, 'git');

  const allowed = join(dir, 'allowed_signers');
  const sigFile = join(dir, 'payload.sig');
  const payloadFile = join(dir, 'payload.bin');
  writeFileSync(allowed, `${allowedSignersLine(email, pub)}\n`);
  writeFileSync(sigFile, `${sig}\n`);
  writeFileSync(payloadFile, COMMIT_PAYLOAD);

  // `ssh-keygen -Y verify` reads the message from stdin.
  const out = execFileSync(
    'ssh-keygen',
    ['-Y', 'verify', '-f', allowed, '-I', email, '-n', 'git', '-s', sigFile],
    { input: readFileSync(payloadFile), encoding: 'utf8' },
  );
  assert.match(out, /Good "git" signature/);

  // and it must FAIL for a tampered message — otherwise the above proves nothing
  const tampered = Uint8Array.from(COMMIT_PAYLOAD);
  tampered[10] ^= 0x02;
  assert.throws(() => execFileSync(
    'ssh-keygen',
    ['-Y', 'verify', '-f', allowed, '-I', email, '-n', 'git', '-s', sigFile],
    { input: Buffer.from(tampered), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ), 'ssh-keygen must reject a tampered payload');

  // ... and for the wrong namespace
  assert.throws(() => execFileSync(
    'ssh-keygen',
    ['-Y', 'verify', '-f', allowed, '-I', email, '-n', 'file', '-s', sigFile],
    { input: readFileSync(payloadFile), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ), 'ssh-keygen must reject the wrong namespace');

  rmSync(dir, { recursive: true, force: true });
});

test('direction B: a signature made by the system ssh-keygen verifies with OUR verifyPayload', async () => {
  const dir = tempDir();
  const email = 'herr.klein@steuerberater.de';
  const keyFile = join(dir, 'id_ed25519');
  const payloadFile = join(dir, 'payload.bin');

  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', email, '-f', keyFile]);
  writeFileSync(payloadFile, COMMIT_PAYLOAD);
  execFileSync('ssh-keygen', ['-Y', 'sign', '-f', keyFile, '-n', 'git', payloadFile], { stdio: 'ignore' });

  const foreignPub = readFileSync(`${keyFile}.pub`, 'utf8').trim();
  const foreignSig = readFileSync(`${payloadFile}.sig`, 'utf8');

  // our parser must handle a public key line we did not write
  const parsed = parsePublicSsh(foreignPub);
  assert.equal(parsed.comment, email);

  const info = inspectSignature(foreignSig);
  assert.equal(info.version, 1);
  assert.equal(info.namespace, 'git');
  assert.equal(info.hashAlg, 'sha512');

  assert.equal(
    await verifyPayload(foreignPub, COMMIT_PAYLOAD, foreignSig, 'git'), true,
    'our verifier must accept a genuine ssh-keygen signature',
  );

  // and reject the same signature under tampering
  const tampered = Uint8Array.from(COMMIT_PAYLOAD);
  tampered[5] ^= 0x08;
  assert.equal(await verifyPayload(foreignPub, tampered, foreignSig, 'git'), false);
  assert.equal(await verifyPayload(foreignPub, COMMIT_PAYLOAD, foreignSig, 'file'), false);
  const stranger = await exportPublicSsh(await generateIdentity());
  assert.equal(await verifyPayload(stranger, COMMIT_PAYLOAD, foreignSig, 'git'), false);

  rmSync(dir, { recursive: true, force: true });
});

test('direction B with sha256: ssh-keygen -O hashalg=sha256 also verifies with our code', async () => {
  const dir = tempDir();
  const keyFile = join(dir, 'id_ed25519');
  const payloadFile = join(dir, 'payload.bin');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'anna@neodonkey.eu', '-f', keyFile]);
  writeFileSync(payloadFile, COMMIT_PAYLOAD);
  execFileSync('ssh-keygen',
    ['-Y', 'sign', '-O', 'hashalg=sha256', '-f', keyFile, '-n', 'git', payloadFile], { stdio: 'ignore' });

  const foreignPub = readFileSync(`${keyFile}.pub`, 'utf8').trim();
  const foreignSig = readFileSync(`${payloadFile}.sig`, 'utf8');
  assert.equal(inspectSignature(foreignSig).hashAlg, 'sha256');
  assert.equal(await verifyPayload(foreignPub, COMMIT_PAYLOAD, foreignSig, 'git'), true);

  rmSync(dir, { recursive: true, force: true });
});

test('exportPublicSsh is byte-identical to `ssh-keygen -y` for the same key', async () => {
  const dir = tempDir();
  const email = 'byte.identity@neodonkey.eu';
  const keyFile = join(dir, 'id_ed25519');
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', email, '-f', keyFile]);

  // Import OpenSSH's own private key so both sides describe the SAME key.
  const kp = await importOpensshPrivateKey(readFileSync(keyFile, 'utf8'));
  const theirs = execFileSync('ssh-keygen', ['-y', '-f', keyFile], { encoding: 'utf8' });
  const ours = await exportPublicSsh(kp);

  assert.equal(`${ours}\n`, theirs, 'our public key line must equal ssh-keygen -y byte for byte');
  assert.equal(ours, readFileSync(`${keyFile}.pub`, 'utf8').trim());

  // full closure: our signature with OpenSSH's key verifies under OpenSSH
  const sig = await signPayload(kp, COMMIT_PAYLOAD, 'git');
  const allowed = join(dir, 'allowed_signers');
  const sigFile = join(dir, 'p.sig');
  writeFileSync(allowed, `${allowedSignersLine(email, ours)}\n`);
  writeFileSync(sigFile, `${sig}\n`);
  const out = execFileSync('ssh-keygen', ['-Y', 'verify', '-f', allowed, '-I', email, '-n', 'git', '-s', sigFile],
    { input: Buffer.from(COMMIT_PAYLOAD), encoding: 'utf8' });
  assert.match(out, /Good "git" signature/);

  rmSync(dir, { recursive: true, force: true });
});

test('allowedSignersLine: shape, comment stripping, and input validation', async () => {
  const kp = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const pub = await exportPublicSsh(kp);
  const line = allowedSignersLine('sarah@neodonkey.eu', pub);
  assert.match(line, /^sarah@neodonkey\.eu namespaces="git" ssh-ed25519 [A-Za-z0-9+/=]+$/);
  assert.equal(line.includes(' sarah@neodonkey.eu ssh-ed25519'), false);
  assert.equal(allowedSignersLine('x@y.z', pub, 'file').includes('namespaces="file"'), true);
  assert.throws(() => allowedSignersLine('', pub), /empty principal/);
  assert.throws(() => allowedSignersLine('a b', pub), /whitespace/);
  assert.throws(() => allowedSignersLine('a@b', 'ssh-rsa AAAA'), /unsupported type/);
});

// ---------------------------------------------------------------------------
// keystore.js
// ---------------------------------------------------------------------------

test("keystore('node'): save -> load round-trip, and the loaded key signs verifiably", async () => {
  const dir = tempDir();
  const ks = keystore('node', testNodeFs(dir));

  assert.deepEqual(await ks.list(), []);
  assert.equal(await ks.load('sarah'), null);

  const kp = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const originalPub = await exportPublicSsh(kp);
  await ks.save('sarah', kp);

  assert.deepEqual(await ks.list(), ['sarah']);

  const loaded = await ks.load('sarah');
  assert.ok(loaded);
  assert.equal(loaded.comment, 'sarah@neodonkey.eu');
  assert.equal(await exportPublicSsh(loaded), originalPub);

  // the real acceptance: a key that came back off disk produces a signature that verifies
  // against the public key we exported BEFORE it was ever stored.
  const sig = await signPayload(loaded, COMMIT_PAYLOAD, 'git');
  assert.equal(await verifyPayload(originalPub, COMMIT_PAYLOAD, sig, 'git'), true);

  // and that signature is accepted by the system binary too
  const allowed = join(dir, 'allowed_signers');
  const sigFile = join(dir, 'p.sig');
  writeFileSync(allowed, `${allowedSignersLine('sarah@neodonkey.eu', originalPub)}\n`);
  writeFileSync(sigFile, `${sig}\n`);
  const out = execFileSync(
    'ssh-keygen',
    ['-Y', 'verify', '-f', allowed, '-I', 'sarah@neodonkey.eu', '-n', 'git', '-s', sigFile],
    { input: Buffer.from(COMMIT_PAYLOAD), encoding: 'utf8' },
  );
  assert.match(out, /Good "git" signature/);

  // 0600 via the adapter's optional chmod
  const mode = (await import('node:fs')).statSync(join(dir, 'keys/sarah.json')).mode & 0o777;
  assert.equal(mode, 0o600, 'private key file must not be readable by anyone else');

  await ks.remove('sarah');
  assert.deepEqual(await ks.list(), []);
  assert.equal(await ks.load('sarah'), null);

  rmSync(dir, { recursive: true, force: true });
});

test("keystore('node'): rejects bad names, non-key-pairs, and non-extractable keys", async () => {
  const dir = tempDir();
  const ks = keystore('node', testNodeFs(dir));
  const kp = await generateIdentity();

  await assert.rejects(() => ks.save('../escape', kp), /name must match/);
  await assert.rejects(() => ks.save('with space', kp), /name must match/);
  await assert.rejects(() => ks.save('ok', {}), /not a key pair/);

  const hardened = await generateIdentity({ extractable: false });
  await assert.rejects(() => ks.save('hardened', hardened), /non-extractable/);

  assert.throws(() => keystore('node'), /requires an FsAdapter/);
  assert.throws(() => keystore('sqlite'), /unknown backend/);

  rmSync(dir, { recursive: true, force: true });
});

test("keystore('node'): a corrupted record is refused, not half-loaded", async () => {
  const dir = tempDir();
  const fs = testNodeFs(dir);
  const ks = keystore('node', fs);
  await fs.write('keys/broken.json', utf8('{not json'));
  await assert.rejects(() => ks.load('broken'), /not valid JSON/);
  await fs.write('keys/wrong.json', utf8('{"version":99,"type":"ed25519"}'));
  await assert.rejects(() => ks.load('wrong'), /not a v1 ed25519 record/);
  rmSync(dir, { recursive: true, force: true });
});

test("keystore('browser') premise: a non-extractable CryptoKey survives structured clone and stays opaque", async () => {
  // IndexedDB is not available in Node, so the browser backend itself cannot run here. What CAN
  // be verified is the security claim it rests on: structured clone (the mechanism IndexedDB
  // uses to persist values) preserves a CryptoKey *without* exposing its bytes.
  const kp = await generateIdentity({ extractable: false, comment: 'sarah@neodonkey.eu' });
  assert.equal(kp.privateKey.extractable, false);

  const clone = structuredClone(kp.privateKey);
  assert.equal(clone.type, 'private');
  assert.equal(clone.algorithm.name, 'Ed25519');
  assert.equal(clone.extractable, false, 'the clone must stay non-extractable');
  await assert.rejects(() => crypto.subtle.exportKey('jwk', clone), /.*/, 'key bytes must remain unreachable');

  // it is still a usable signing handle after the clone — that is the whole point
  const sig = await signPayload({ ...kp, privateKey: clone }, COMMIT_PAYLOAD, 'git');
  assert.equal(await verifyPayload(await exportPublicSsh(kp), COMMIT_PAYLOAD, sig, 'git'), true);

  // and the browser backend fails loudly rather than silently, when there is no IndexedDB
  await assert.rejects(() => keystore('browser').list(), /IndexedDB/);
});
