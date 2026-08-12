// runtime/crypto/keys.js — the three key levels of manifesto Appendix VII.
//
//   1. **Personal key pairs.** An Ed25519 pair for signatures (it already exists —
//      `runtime/identity/ed25519.js`, cross-verified against real `ssh-keygen`; this file does not
//      reimplement one byte of it) plus an X25519 pair *for encryption*. Appendix VII calls the
//      second one "a Curve25519 pair"; WebCrypto spells the ECDH half of Curve25519 `X25519`, and
//      that is what we generate. A P-256 fallback is implemented too, because it is the one curve
//      every engine has had for a decade and a format that cannot express the fallback would be a
//      format we have to break later (Principle 6).
//
//   2. **Group keys.** A group is a symmetric AES-256 secret. It is *epoched*: `hr@1`, `hr@2`,
//      because removing a member means minting a new one (see `groups.js`). Every secret is 32
//      random bytes and is only ever HKDF input — it is never used as an AES key directly, so a
//      wrap can be bound to a group, an epoch and a purpose by its `info` string alone.
//
//   3. **DEKs.** 32 random bytes per encrypted document, wrapped (AES-KW) for each authorised
//      group under a KEK derived from that group's epoch secret with a fresh random salt.
//
// Everything here is a WebCrypto primitive: AES-GCM for content, X25519/ECDH for key agreement,
// HKDF-SHA-256 for derivation, AES-KW for wrapping, HMAC-SHA-256 for sealed names. Zero
// dependencies, no `node:*`, no `Date.now()`, no `Math.random()`. Randomness comes from
// `crypto.getRandomValues` and is injectable so a test can pin it.
//
// **Fail closed is the whole security argument.** Every function in this file that can fail
// throws `CryptoError` with a machine-readable `reason`. There is no path that returns
// "probably fine": a wrap that does not unwrap, a MAC that does not verify, a curve we do not
// know, a shared secret that came out all zeroes — all of them throw, and the callers above turn
// a throw into *opaque bytes*, never into plaintext.
//
// Ids are unpadded base64url of a hash prefix, produced with `b64urlEncode` from the identity
// module. Deliberately not hex: hex would have meant importing `runtime/git/sha1.js` for its
// `hex()` (a dependency from crypto onto git, which is the wrong direction) or writing a second
// hex encoder (which is the mistake Wave 1 made three times).

/** @typedef {Uint8Array} Bytes */
/** @typedef {{ publicKey: CryptoKey, privateKey: CryptoKey, curve: string }} EncKeyPair */

import {
  concatBytes, bytesEqual, utf8, b64encode, b64decode, b64urlEncode,
  exportPublicSsh,
} from '../identity/ed25519.js';
import { signPayload, verifyPayload } from '../identity/sshsig.js';

const subtle = () => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new CryptoError('no-webcrypto',
      'this environment has no crypto.subtle; NeoDonkey encryption needs WebCrypto');
  }
  return crypto.subtle;
};

// ---------------------------------------------------------------------------------------------
// failure, with a reason
// ---------------------------------------------------------------------------------------------

/**
 * The only error type this layer throws. `reason` is a stable, machine-readable token: the read
 * path records it, the tamper matrix asserts on it, and a UI can translate it. `message` is for
 * a human and may be reworded freely; `reason` may not.
 */
export class CryptoError extends Error {
  /** @param {string} reason @param {string} message @param {object} [detail] */
  constructor(reason, message, detail = {}) {
    super(message);
    this.name = 'CryptoError';
    this.reason = reason;
    this.detail = detail;
  }
}

/** Every reason token this layer can produce, so a caller can exhaustively handle them. */
export const REASONS = Object.freeze([
  // environment
  'no-webcrypto',
  // personal keys
  'unknown-curve', 'bad-public-key', 'bad-private-key', 'enc-key-binding-invalid',
  'non-extractable',
  // symmetric material
  'bad-key-length', 'bad-secret-length',
  // wrapping
  'wrap-mac-failed', 'wrap-epoch-mismatch', 'wrap-info-mismatch', 'unknown-wrap-alg',
  'unknown-kdf',
  // content
  'content-mac-failed', 'unknown-content-alg', 'bad-iv-length',
  // envelope framing (envelope.js)
  'envelope-too-short', 'envelope-bad-magic', 'envelope-unknown-version',
  'envelope-reserved-flags', 'envelope-header-truncated', 'envelope-header-not-json',
  'envelope-header-invalid', 'envelope-version-disagreement', 'envelope-no-ciphertext',
  'sealed-name-mismatch', 'sealed-path-mismatch', 'inner-not-json', 'inner-invalid',
  // groups (groups.js)
  'not-a-group-manifest', 'unknown-manifest-version', 'unknown-group', 'not-a-member',
  'member-exists', 'member-unknown', 'duplicate-member', 'no-members-left',
  'manifest-epoch-invalid',
  // documents / keyring
  'no-key-for-envelope',
  // subjects and shredding (shred.js)
  'not-a-subject-record', 'subject-key-destroyed', 'subject-key-missing',
  'subject-already-erased', 'subject-mismatch', 'vault-required',
]);

// ---------------------------------------------------------------------------------------------
// randomness
// ---------------------------------------------------------------------------------------------

/**
 * CSPRNG bytes. Injectable — `random` is threaded through every generator above so a test can
 * pin key material — but the default is the platform CSPRNG and there is no other source
 * anywhere in this directory. `Math.random()` appears nowhere, by rule and by grep.
 * @param {number} n @param {(b: Bytes) => Bytes} [source]
 * @returns {Bytes}
 */
export function randomBytes(n, source) {
  const out = new Uint8Array(n);
  if (source) {
    const got = source(out);
    if (!(got instanceof Uint8Array) || got.length !== n) {
      throw new CryptoError('bad-key-length', `injected random source must return ${n} bytes`);
    }
    return got;
  }
  crypto.getRandomValues(out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// sizes and names — one place, so a format field never disagrees with a length check
// ---------------------------------------------------------------------------------------------

export const SECRET_LEN = 32;        // group epoch secrets, DEKs, subject keys: AES-256
export const GCM_IV_LEN = 12;        // 96 bits, the only nonce length AES-GCM should ever use
export const GCM_TAG_LEN = 16;       // 128-bit tag, appended by WebCrypto
export const KW_OVERHEAD = 8;        // AES-KW output is input + 8 bytes
export const ID_BYTES = 20;          // sealed document ids: 160 bits, 27 base64url chars
export const KEY_ID_BYTES = 16;      // subject/group key ids: 128 bits, 22 base64url chars

export const CONTENT_ALG = 'A256GCM';
export const WRAP_ALG = 'A256KW';
export const KDF_ALG = 'HKDF-SHA-256';

/** The namespace for the SSHSIG that binds an encryption key to its owner's signing key. */
export const ENC_KEY_NAMESPACE = 'neodonkey-enc-key';

// ---------------------------------------------------------------------------------------------
// curves
// ---------------------------------------------------------------------------------------------

/**
 * The key-agreement curves this format can express. `X25519` is what Appendix VII asks for and
 * what we default to. `P-256` exists because it is universally available and because a wrap
 * record naming its curve costs one JSON field now and saves a format break later.
 */
const CURVES = {
  X25519: { algorithm: { name: 'X25519' }, rawPublicLen: 32, jwkCrv: 'X25519', kty: 'OKP' },
  'P-256': {
    algorithm: { name: 'ECDH', namedCurve: 'P-256' }, rawPublicLen: 65,
    jwkCrv: 'P-256', kty: 'EC',
  },
};

export const ENC_CURVES = Object.freeze(Object.keys(CURVES));
export const DEFAULT_CURVE = 'X25519';

function curveSpec(curve) {
  const spec = CURVES[curve];
  if (!spec) {
    throw new CryptoError('unknown-curve',
      `unknown key-agreement curve ${JSON.stringify(curve)}; known: ${ENC_CURVES.join(', ')}`);
  }
  return spec;
}

/**
 * Is a curve actually usable in *this* engine? Answers by trying, not by sniffing a user agent.
 * The point of asking is that a peer which cannot do X25519 must be told so at enrolment time,
 * not discover it when it fails to open a document.
 * @param {string} curve @returns {Promise<boolean>}
 */
export async function curveAvailable(curve) {
  if (!CURVES[curve]) return false;
  try {
    await subtle().generateKey(CURVES[curve].algorithm, true, ['deriveBits']);
    return true;
  } catch {
    return false;
  }
}

/** Which of `ENC_CURVES` this engine can actually perform, best first. @returns {Promise<string[]>} */
export async function availableCurves() {
  const out = [];
  for (const c of ENC_CURVES) if (await curveAvailable(c)) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------------------------
// LEVEL 1 — personal encryption key pairs
// ---------------------------------------------------------------------------------------------

/**
 * A personal encryption key pair, alongside (never instead of) the Ed25519 signing pair.
 *
 * `extractable` defaults to **false**: a browser peer stores the `CryptoKey` object itself in
 * IndexedDB (COMPROMISES #2's good case) and the private scalar then never exists as bytes in
 * JavaScript. Pass `extractable: true` only where a JWK must be written to a file, which is
 * COMPROMISES #2's weak case and is not made worse here: the encryption key is exactly as
 * protected as the signing key already is, on both peer kinds, and no code path in this directory
 * exports a private key unless the caller explicitly asks.
 *
 * @param {{curve?: string, extractable?: boolean}} [opts]
 * @returns {Promise<EncKeyPair>}
 */
export async function generateEncryptionKeyPair(opts = {}) {
  const { curve = DEFAULT_CURVE, extractable = false } = opts;
  const spec = curveSpec(curve);
  let kp;
  try {
    kp = await subtle().generateKey(spec.algorithm, extractable, ['deriveBits']);
  } catch (e) {
    throw new CryptoError('unknown-curve',
      `this engine cannot generate ${curve} keys (${e.message}); available: `
      + `${(await availableCurves()).join(', ') || 'none'}`);
  }
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, curve };
}

/** @param {EncKeyPair|CryptoKey} kpOrKey @param {string} [curve] @returns {Promise<Bytes>} */
export async function exportEncPublicRaw(kpOrKey, curve) {
  const key = kpOrKey && 'publicKey' in kpOrKey ? kpOrKey.publicKey : kpOrKey;
  const c = curve ?? (kpOrKey && kpOrKey.curve) ?? DEFAULT_CURVE;
  const spec = curveSpec(c);
  const raw = new Uint8Array(await subtle().exportKey('raw', key));
  if (raw.length !== spec.rawPublicLen) {
    throw new CryptoError('bad-public-key',
      `${c} public key must be ${spec.rawPublicLen} bytes, got ${raw.length}`);
  }
  return raw;
}

/** @param {Bytes} raw @param {string} [curve] @returns {Promise<CryptoKey>} */
export async function importEncPublicRaw(raw, curve = DEFAULT_CURVE) {
  const spec = curveSpec(curve);
  if (!(raw instanceof Uint8Array) || raw.length !== spec.rawPublicLen) {
    throw new CryptoError('bad-public-key',
      `${curve} public key must be ${spec.rawPublicLen} bytes`);
  }
  try {
    return await subtle().importKey('raw', raw, spec.algorithm, true, []);
  } catch (e) {
    throw new CryptoError('bad-public-key', `${curve} public key is not on the curve (${e.message})`);
  }
}

/**
 * Export the private key as a JWK — the Node keystore's only option, and refused outright for a
 * key generated the browser way. That refusal is the point of `extractable: false`.
 * @param {EncKeyPair} kp @returns {Promise<object>}
 */
export async function exportEncPrivateJwk(kp) {
  if (!kp || !kp.privateKey) throw new CryptoError('bad-private-key', 'no private key');
  if (!kp.privateKey.extractable) {
    throw new CryptoError('non-extractable',
      'encryption private key is non-extractable (by design) — cannot export JWK');
  }
  const jwk = await subtle().exportKey('jwk', kp.privateKey);
  jwk.nd_curve = kp.curve;
  return jwk;
}

/** @param {object} jwk @returns {Promise<EncKeyPair>} */
export async function importEncPrivateJwk(jwk) {
  if (!jwk || typeof jwk !== 'object') {
    throw new CryptoError('bad-private-key', 'jwk must be an object');
  }
  const curve = typeof jwk.nd_curve === 'string' ? jwk.nd_curve : jwk.crv;
  const spec = curveSpec(curve);
  if (jwk.kty !== spec.kty || jwk.crv !== spec.jwkCrv) {
    throw new CryptoError('bad-private-key',
      `jwk is not a ${curve} key (kty=${jwk.kty}, crv=${jwk.crv})`);
  }
  if (typeof jwk.d !== 'string') throw new CryptoError('bad-private-key', 'jwk has no private part');
  const priv = { ...jwk };
  delete priv.nd_curve;
  delete priv.key_ops;
  delete priv.ext;
  let privateKey;
  try {
    privateKey = await subtle().importKey('jwk', { ...priv, key_ops: ['deriveBits'] },
      spec.algorithm, true, ['deriveBits']);
  } catch (e) {
    throw new CryptoError('bad-private-key', `jwk did not import as ${curve} (${e.message})`);
  }
  const pubJwk = { ...priv };
  delete pubJwk.d;
  const publicKey = await subtle().importKey('jwk', { ...pubJwk, key_ops: [] },
    spec.algorithm, true, []);
  return { publicKey, privateKey, curve };
}

// --- binding an encryption key to its owner's signing key --------------------------------------

/**
 * The bytes an owner signs to say "this encryption key is mine". Versioned and namespaced, so a
 * signature over one curve's key can never be replayed as a signature over another's.
 * @param {string} curve @param {Bytes} rawPublic @returns {Bytes}
 */
export function encKeyBindingPayload(curve, rawPublic) {
  curveSpec(curve);
  return concatBytes(utf8(`${ENC_KEY_NAMESPACE}\nv1\n${curve}\n`), rawPublic);
}

/**
 * Sign the binding with the personal **Ed25519** key, using the existing SSHSIG implementation.
 *
 * Why this exists: the group manifest is a repo file, and the commit that writes it is signed by
 * whoever wrote it — which authenticates the *writer*, not the claim. Without this binding, a
 * group admin (or anyone who can get a commit accepted) could enrol Anna with an encryption key
 * they hold themselves and read everything wrapped "for Anna". The binding makes the claim
 * Anna's own, verifiable by every peer, with no new crypto: it is an SSHSIG in its own namespace,
 * checkable by `ssh-keygen -Y verify`.
 *
 * @param {{publicKey: CryptoKey, privateKey: CryptoKey}} signingPair Ed25519 pair
 * @param {Bytes} rawEncPublic @param {string} [curve] @returns {Promise<string>} armored SSHSIG
 */
export async function bindEncryptionKey(signingPair, rawEncPublic, curve = DEFAULT_CURVE) {
  const spec = curveSpec(curve);
  if (!(rawEncPublic instanceof Uint8Array) || rawEncPublic.length !== spec.rawPublicLen) {
    throw new CryptoError('bad-public-key', `${curve} public key must be ${spec.rawPublicLen} bytes`);
  }
  return signPayload(signingPair, encKeyBindingPayload(curve, rawEncPublic), ENC_KEY_NAMESPACE);
}

/**
 * Verify a binding. Returns a boolean rather than throwing, because "is this claim good" is a
 * question with two legitimate answers; the *callers* (`groups.js`) turn `false` into a refusal.
 * @param {string} signingPublicSsh `ssh-ed25519 AAAA...`
 * @param {Bytes} rawEncPublic @param {string} curve @param {string} armored
 * @returns {Promise<boolean>}
 */
export async function verifyEncryptionKeyBinding(signingPublicSsh, rawEncPublic, curve, armored) {
  if (typeof signingPublicSsh !== 'string' || typeof armored !== 'string') return false;
  if (!CURVES[curve]) return false;
  if (!(rawEncPublic instanceof Uint8Array)
      || rawEncPublic.length !== CURVES[curve].rawPublicLen) return false;
  try {
    return await verifyPayload(signingPublicSsh, encKeyBindingPayload(curve, rawEncPublic),
      armored, ENC_KEY_NAMESPACE);
  } catch {
    return false;
  }
}

/**
 * Everything one person publishes so others can encrypt to them: the pair of public keys plus the
 * binding. This is Appendix VII's onboarding step 1 — "new employee generates a key pair locally,
 * public key committed to the person manifest" — as one object a commit can carry.
 *
 * @param {{signing: {publicKey: CryptoKey, privateKey: CryptoKey, comment?: string},
 *          encryption: EncKeyPair, principal: string}} o
 * @returns {Promise<object>} an enrolment record
 */
export async function enrolment(o) {
  const { signing, encryption, principal } = o;
  if (typeof principal !== 'string' || principal === '') {
    throw new CryptoError('member-unknown', 'enrolment needs a principal');
  }
  const raw = await exportEncPublicRaw(encryption);
  return {
    format: 'neodonkey-enrolment',
    version: 1,
    principal,
    'signing-public-key': await exportPublicSsh(signing, principal),
    'enc-curve': encryption.curve,
    'enc-public-key': b64encode(raw),
    'key-binding': await bindEncryptionKey(signing, raw, encryption.curve),
  };
}

/**
 * Check an enrolment record end to end: shape, curve, key length, and the binding signature
 * against the *signing* key in the same record. Throws `enc-key-binding-invalid` on any failure —
 * there is no partially acceptable enrolment.
 * @param {object} record @returns {Promise<{principal: string, curve: string, raw: Bytes}>}
 */
export async function verifyEnrolment(record) {
  if (!record || typeof record !== 'object' || record.format !== 'neodonkey-enrolment') {
    throw new CryptoError('enc-key-binding-invalid', 'not an enrolment record');
  }
  if (record.version !== 1) {
    throw new CryptoError('enc-key-binding-invalid',
      `enrolment version ${record.version} is not one this runtime knows`);
  }
  const curve = record['enc-curve'];
  if (!CURVES[curve]) {
    throw new CryptoError('enc-key-binding-invalid', `enrolment names unknown curve ${curve}`);
  }
  let raw;
  try {
    raw = b64decode(record['enc-public-key']);
  } catch (e) {
    throw new CryptoError('enc-key-binding-invalid', `enc-public-key is not base64 (${e.message})`);
  }
  const ok = await verifyEncryptionKeyBinding(
    record['signing-public-key'], raw, curve, record['key-binding']);
  if (!ok) {
    throw new CryptoError('enc-key-binding-invalid',
      `${record.principal}'s encryption key is not signed by their own signing key — refusing to `
      + 'encrypt to it. Anyone can write a manifest entry; only the owner can sign this binding.');
  }
  return { principal: record.principal, curve, raw };
}

// ---------------------------------------------------------------------------------------------
// symmetric material
// ---------------------------------------------------------------------------------------------

/** A fresh group epoch secret: 32 random bytes, HKDF input only. @returns {Bytes} */
export function generateGroupSecret(random) { return randomBytes(SECRET_LEN, random); }

/** A fresh DEK: 32 random bytes, one per encrypted document. @returns {Bytes} */
export function generateDek(random) { return randomBytes(SECRET_LEN, random); }

function checkSecret(raw, what) {
  if (!(raw instanceof Uint8Array) || raw.length !== SECRET_LEN) {
    throw new CryptoError('bad-secret-length', `${what} must be ${SECRET_LEN} bytes`);
  }
  return raw;
}

/**
 * HKDF-SHA-256. `info` is a string and is *always* meaningful: every derived key in NeoDonkey is
 * bound by its info to a purpose, a group and an epoch, which is what makes an old wrap
 * unreplayable into a new epoch.
 * @param {Bytes} ikm @param {Bytes} salt @param {string} info @param {number} [bytes]
 * @returns {Promise<Bytes>}
 */
export async function hkdf(ikm, salt, info, bytes = SECRET_LEN) {
  const key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** The info string for a group-key wrap addressed to one member. */
export const memberWrapInfo = (group, epoch) => `neodonkey/group-wrap/v1/${group}/${epoch}`;
/** The info string for a DEK wrap under a group epoch secret. */
export const dekWrapInfo = (group, epoch) => `neodonkey/dek-wrap/v1/${group}/${epoch}`;
/** The info string for a group epoch's name key. */
export const nameKeyInfo = (group, epoch) => `neodonkey/name-key/v1/${group}/${epoch}`;
/** The info string for a subject key's name key. */
export const subjectNameKeyInfo = (keyId) => `neodonkey/name-key/v1/subject/${keyId}`;
/** The info string for the KEK that protects a subject key in the vault. */
export const subjectWrapInfo = (group, epoch, keyId) =>
  `neodonkey/subject-wrap/v1/${group}/${epoch}/${keyId}`;

const ZERO_SALT = new Uint8Array(SECRET_LEN);

/**
 * A group epoch's **name key**: deterministic (zero salt), so every member computes the same one
 * and therefore agrees on sealed document ids without any extra state in the repo.
 * @param {Bytes} epochSecret @param {string} group @param {number} epoch @returns {Promise<Bytes>}
 */
export function deriveNameKey(epochSecret, group, epoch) {
  return hkdf(checkSecret(epochSecret, 'group epoch secret'), ZERO_SALT, nameKeyInfo(group, epoch));
}

/** The name key belonging to a subject key. @param {Bytes} subjectKey @param {string} keyId */
export function deriveSubjectNameKey(subjectKey, keyId) {
  return hkdf(checkSecret(subjectKey, 'subject key'), ZERO_SALT, subjectNameKeyInfo(keyId));
}

/**
 * X25519 (or ECDH P-256) key agreement. An all-zero shared secret means a small-order public key
 * was supplied; RFC 7748 permits rejecting it and we do, because accepting it would let an
 * attacker force a shared secret they know.
 * @param {{privateKey: CryptoKey, publicKey: CryptoKey, curve: string}} o @returns {Promise<Bytes>}
 */
export async function agree(o) {
  const spec = curveSpec(o.curve);
  let bits;
  try {
    bits = await subtle().deriveBits({ ...spec.algorithm, public: o.publicKey }, o.privateKey, 256);
  } catch (e) {
    throw new CryptoError('bad-public-key', `${o.curve} key agreement refused (${e.message})`);
  }
  const z = new Uint8Array(bits);
  if (bytesEqual(z, ZERO_SALT)) {
    throw new CryptoError('bad-public-key', 'key agreement produced an all-zero shared secret');
  }
  return z;
}

// --- AES-KW ----------------------------------------------------------------------------------

/**
 * AES-KW wrap. Both arguments are raw bytes and the result is `key.length + 8`. AES-KW carries
 * its own integrity check, which is why an unwrap with the wrong KEK fails rather than returning
 * garbage — the property the whole "fail closed" claim leans on for key material.
 * @param {Bytes} kek @param {Bytes} key @returns {Promise<Bytes>}
 */
export async function wrapSecret(kek, key) {
  checkSecret(kek, 'wrapping key');
  if (!(key instanceof Uint8Array) || key.length < 16 || key.length % 8 !== 0) {
    throw new CryptoError('bad-key-length',
      'AES-KW can only wrap a key of at least 16 bytes whose length is a multiple of 8');
  }
  const kekKey = await subtle().importKey('raw', kek, 'AES-KW', false, ['wrapKey']);
  const inner = await subtle().importKey('raw', key, { name: 'AES-GCM' }, true, ['encrypt']);
  return new Uint8Array(await subtle().wrapKey('raw', inner, kekKey, 'AES-KW'));
}

/**
 * AES-KW unwrap. Throws `wrap-mac-failed` on *any* failure, which is the same answer for a
 * flipped byte, a wrong KEK, a wrap from another group and a wrap from another epoch — they are
 * the same event from here, and the caller supplies the context in its own reason.
 * @param {Bytes} kek @param {Bytes} wrapped @returns {Promise<Bytes>}
 */
export async function unwrapSecret(kek, wrapped) {
  checkSecret(kek, 'wrapping key');
  if (!(wrapped instanceof Uint8Array) || wrapped.length < 16 + KW_OVERHEAD
      || wrapped.length % 8 !== 0) {
    throw new CryptoError('wrap-mac-failed', 'wrapped key has an impossible length');
  }
  const kekKey = await subtle().importKey('raw', kek, 'AES-KW', false, ['unwrapKey']);
  let inner;
  try {
    inner = await subtle().unwrapKey('raw', wrapped, kekKey, 'AES-KW',
      { name: 'AES-GCM', length: (wrapped.length - KW_OVERHEAD) * 8 }, true, ['encrypt']);
  } catch {
    throw new CryptoError('wrap-mac-failed',
      'the wrapped key did not authenticate under this key — wrong key, wrong epoch, or tampered');
  }
  return new Uint8Array(await subtle().exportKey('raw', inner));
}

// --- AES-GCM ---------------------------------------------------------------------------------

/**
 * AES-256-GCM encrypt. `aad` is authenticated but not encrypted; the envelope passes its entire
 * header bytes as `aad`, so editing any header field — including swapping the wrap list between
 * two documents — breaks the content tag.
 * @param {{key: Bytes, iv: Bytes, plaintext: Bytes, aad?: Bytes}} o @returns {Promise<Bytes>}
 */
export async function gcmEncrypt(o) {
  checkSecret(o.key, 'content key');
  if (!(o.iv instanceof Uint8Array) || o.iv.length !== GCM_IV_LEN) {
    throw new CryptoError('bad-iv-length', `AES-GCM nonce must be ${GCM_IV_LEN} bytes`);
  }
  const key = await subtle().importKey('raw', o.key, 'AES-GCM', false, ['encrypt']);
  const params = { name: 'AES-GCM', iv: o.iv, tagLength: GCM_TAG_LEN * 8 };
  if (o.aad) params.additionalData = o.aad;
  return new Uint8Array(await subtle().encrypt(params, key, o.plaintext));
}

/**
 * AES-256-GCM decrypt. Throws `content-mac-failed` on any authentication failure. There is no
 * variant of this function that returns unauthenticated plaintext, and there never should be.
 * @param {{key: Bytes, iv: Bytes, ciphertext: Bytes, aad?: Bytes}} o @returns {Promise<Bytes>}
 */
export async function gcmDecrypt(o) {
  checkSecret(o.key, 'content key');
  if (!(o.iv instanceof Uint8Array) || o.iv.length !== GCM_IV_LEN) {
    throw new CryptoError('bad-iv-length', `AES-GCM nonce must be ${GCM_IV_LEN} bytes`);
  }
  if (!(o.ciphertext instanceof Uint8Array) || o.ciphertext.length < GCM_TAG_LEN) {
    throw new CryptoError('content-mac-failed', 'ciphertext is shorter than its own tag');
  }
  const key = await subtle().importKey('raw', o.key, 'AES-GCM', false, ['decrypt']);
  const params = { name: 'AES-GCM', iv: o.iv, tagLength: GCM_TAG_LEN * 8 };
  if (o.aad) params.additionalData = o.aad;
  try {
    return new Uint8Array(await subtle().decrypt(params, key, o.ciphertext));
  } catch {
    throw new CryptoError('content-mac-failed',
      'the content did not authenticate — wrong key, or the bytes were altered');
  }
}

// --- HMAC, ids -------------------------------------------------------------------------------

/** HMAC-SHA-256. @param {Bytes} key @param {Bytes} data @returns {Promise<Bytes>} */
export async function hmac(key, data) {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}

/** SHA-256. @param {Bytes} data @returns {Promise<Bytes>} */
export async function sha256(data) {
  return new Uint8Array(await subtle().digest('SHA-256', data));
}

/**
 * An id from a hash: unpadded base64url of the first `bytes` bytes. base64url because it is
 * filename-safe, `/`-free (so `parseDocPath` in the read path accepts it) and shorter than hex,
 * and because `b64urlEncode` already exists in the identity module.
 * @param {Bytes} digest @param {number} [bytes] @returns {string}
 */
export function idFromDigest(digest, bytes = ID_BYTES) {
  return b64urlEncode(digest.subarray(0, bytes));
}

/**
 * A key id: a public, non-secret handle for a secret. `HMAC(secret, "key-id/v1")` rather than
 * `SHA-256(secret)` so that publishing the id says nothing about the key even to someone who can
 * guess candidate keys.
 * @param {Bytes} secret @returns {Promise<string>}
 */
export async function keyIdOf(secret) {
  checkSecret(secret, 'secret');
  return idFromDigest(await hmac(secret, utf8('neodonkey/key-id/v1')), KEY_ID_BYTES);
}

/**
 * The **sealed id** of a document: `HMAC(nameKey, "…\0<entity>\0<name>")`, base64url, 160 bits.
 *
 * Appendix VII's metadata-leakage section asks for "a content-hash ID" in the repo with the
 * plaintext name inside the encrypted header. We use a *keyed* hash rather than a plain one, and
 * that is a deliberate strengthening worth stating: a plain hash of `Salaries_Q3_2027` is a hash
 * of a guessable string, so anyone holding the repo confirms the filename with one dictionary
 * pass and the mitigation buys nothing. Keyed, a non-member cannot even test a guess.
 *
 * The name key belongs to a group *epoch*, so rotating a group renames its sealed documents. That
 * is a real cost (`groups.js` returns the removals so the rename is one commit) and it is the
 * price of a former member not being able to map new names to ids.
 *
 * @param {{nameKey: Bytes, entity: string, name: string}} o @returns {Promise<string>}
 */
export async function sealedId(o) {
  const { nameKey, entity, name } = o;
  checkSecret(nameKey, 'name key');
  if (typeof entity !== 'string' || entity === '' || entity.includes('/')) {
    throw new CryptoError('sealed-name-mismatch', 'entity must be a non-empty name without "/"');
  }
  if (typeof name !== 'string' || name === '') {
    throw new CryptoError('sealed-name-mismatch', 'a sealed document needs a plaintext name');
  }
  return idFromDigest(await hmac(nameKey, utf8(`neodonkey/sealed-id/v1\x00${entity}\x00${name}`)));
}

// ---------------------------------------------------------------------------------------------
// where crypto material lives in the repo — and the one place it must not
// ---------------------------------------------------------------------------------------------

/**
 * Repo paths. Everything here is **public** — manifests, enrolments, subject *records*, erasure
 * records. No wrapped subject key is ever written to a path in this table, and that is the single
 * most important line in this file; see `shred.js` for why an append-only store cannot hold a key
 * you may have to destroy.
 *
 * `safe()` mirrors `PATHS.peer()` in `runtime/kernel.js` on purpose: a principal is turned into a
 * path the same way in both places. It is a path-safety rule, not a parser, and crypto/ importing
 * the kernel would be the wrong direction of dependency.
 */
const safe = (s) => String(s).replace(/[^a-zA-Z0-9._@-]/g, '_');

export const CRYPTO_PATHS = Object.freeze({
  group: (id) => `crypto/groups/${safe(id)}.json`,
  enrolment: (principal) => `crypto/enrolments/${safe(principal)}.json`,
  subject: (keyId) => `crypto/subjects/${safe(keyId)}.json`,
  erasure: (keyId) => `crypto/erasures/${safe(keyId)}.json`,
  /** Inside the **vault**, which is not the repo. Named here so the two never collide. */
  vaultSubject: (keyId) => `subject-keys/${safe(keyId)}.json`,
  safe,
});

/** Canonical JSON bytes for a repo file: stable, 2-space, newline-terminated, like the kernel's. */
export function jsonBytes(value) {
  return utf8(`${JSON.stringify(value, null, 2)}\n`);
}

/** The inverse, with a reason instead of a `SyntaxError`. @param {Bytes} bytes */
export function parseJsonBytes(bytes, reason = 'envelope-header-not-json') {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    throw new CryptoError(reason, `not readable JSON (${e.message})`);
  }
}
