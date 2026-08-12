// runtime/crypto/envelope.js — the on-disk format of an encrypted document.
//
// Principle 6 is the whole brief: a blob written in 2027 must be openable in 2057, by software
// nobody has written yet, with no side channel and no registry lookup. So the format is
// **self-describing and versioned in two independent places**, and it refuses to guess:
//
//   byte  0..5   magic       FF 4E 44 45 4E 56   — 0xFF then ASCII "NDENV"
//   byte  6      version     uint8, 1 today
//   byte  7      flags       uint8, must be 0 in version 1
//   byte  8..9   headerLen   uint16 big-endian
//   byte 10..     header      exactly `headerLen` bytes of UTF-8 JSON
//   then          ciphertext  AES-256-GCM output: ciphertext || 16-byte tag
//
// **Why the first byte is 0xFF.** 0xFF is not a legal byte anywhere in UTF-8. The read path
// (`runtime/read/index.js`) classifies a blob by trying `TextDecoder('utf-8', {fatal:true})` and
// treating a failure as `opaque`. Leading with 0xFF therefore makes "this peer cannot open it"
// the *structural* outcome rather than a probabilistic one: there is no random ciphertext that
// happens to parse as a JSON document. Appendix VII's personalized index rests on that, so it is
// a format guarantee, not an accident.
//
// **Why the header is JSON and outside the ciphertext.** A peer that cannot decrypt still needs
// to know *what it is holding* — which groups could open it, which algorithm, which version — or
// key rotation and re-wrapping become impossible for anyone but a member. And a human with
// `git show` in 2057 must be able to read the metadata of a blob whose key is long gone. The
// header is passed to AES-GCM as **AAD**, so every byte of it is authenticated: editing a wrap
// record, swapping the wrap list between two documents, or changing the declared entity or id
// breaks the content tag. Nothing in the header is confidential, and the one thing that would
// be — the plaintext filename — is deliberately *not* there.
//
// **Where the plaintext name lives.** Inside the ciphertext, in a small inner header
// (`{format, version, entity, name, doc}`), exactly as Appendix VII's metadata-leakage section
// asks. The repo shows `documents/<entity>/<sealed-id>.json`, where the sealed id is a keyed hash
// of the name (`keys.js` → `sealedId`). What still leaks is the entity directory, its size and
// its change frequency — Appendix VII says so too ("what cannot be hidden: the existence of an
// HR bucket"), and the reason the entity cannot be hidden here is concrete: the read path derives
// a document's entity from its path and refuses a body that contradicts it, so an entity-blind
// path would make a member's own index wrong.
//
// Fail closed, in order, with a distinct reason for each: too short, bad magic, unknown version,
// reserved flags set, header truncated, header not JSON, header schema wrong, the two version
// fields disagreeing, no ciphertext, unknown content algorithm, then the MAC.

/** @typedef {Uint8Array} Bytes */

import {
  CryptoError, CONTENT_ALG, WRAP_ALG, KDF_ALG, GCM_IV_LEN, GCM_TAG_LEN, SECRET_LEN,
  randomBytes, hkdf, wrapSecret, unwrapSecret, gcmEncrypt, gcmDecrypt,
  dekWrapInfo, deriveNameKey, deriveSubjectNameKey, sealedId, jsonBytes, parseJsonBytes,
} from './keys.js';
import { b64encode, b64decode, utf8 } from '../identity/ed25519.js';

export const MAGIC = Uint8Array.from([0xff, 0x4e, 0x44, 0x45, 0x4e, 0x56]);
export const ENVELOPE_VERSION = 1;
export const FRAME_PREFIX_LEN = MAGIC.length + 1 + 1 + 2; // 10
export const MAX_HEADER_LEN = 0xffff;
export const ENVELOPE_FORMAT = 'neodonkey-envelope';
export const SEALED_FORMAT = 'neodonkey-sealed';

const dec = new TextDecoder('utf-8', { fatal: true });

/**
 * Cheap, allocation-free test: do these bytes claim to be a NeoDonkey envelope? Used by the
 * decrypting reader to pass plaintext documents straight through — most of an ERP is not
 * encrypted (Appendix VII: "perhaps 5–15% of data volume"), and the common path must be free.
 * @param {unknown} bytes @returns {boolean}
 */
export function isEnvelope(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < FRAME_PREFIX_LEN) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// framing
// ---------------------------------------------------------------------------------------------

/**
 * Assemble the frame. `seal()` goes through it too — a test that builds a deliberately malformed
 * envelope and the real writer must use the same assembler, or the malformed cases are testing a
 * different format from the one we ship. Pass `headerBytes` to control the exact AAD.
 * @param {{header?: object, headerBytes?: Bytes, ciphertext: Bytes,
 *          version?: number, flags?: number}} o
 * @returns {Bytes}
 */
export function frame(o) {
  const { header, ciphertext, version = ENVELOPE_VERSION, flags = 0 } = o;
  const headerBytes = o.headerBytes ?? jsonBytes(header);
  if (headerBytes.length > MAX_HEADER_LEN) {
    throw new CryptoError('envelope-header-invalid',
      `envelope header is ${headerBytes.length} bytes; the format allows ${MAX_HEADER_LEN}`);
  }
  const out = new Uint8Array(FRAME_PREFIX_LEN + headerBytes.length + ciphertext.length);
  out.set(MAGIC, 0);
  out[MAGIC.length] = version & 0xff;
  out[MAGIC.length + 1] = flags & 0xff;
  out[MAGIC.length + 2] = (headerBytes.length >>> 8) & 0xff;
  out[MAGIC.length + 3] = headerBytes.length & 0xff;
  out.set(headerBytes, FRAME_PREFIX_LEN);
  out.set(ciphertext, FRAME_PREFIX_LEN + headerBytes.length);
  return out;
}

/**
 * Take a frame apart, refusing anything we do not fully understand. Returns the header *bytes* as
 * well as the parsed object because the bytes are the AAD and must be used exactly as found — not
 * re-serialised, which would make the AAD depend on our JSON writer's whitespace choices thirty
 * years from now.
 * @param {Bytes} bytes
 * @returns {{version: number, flags: number, headerBytes: Bytes, header: object, ciphertext: Bytes}}
 */
export function parseFrame(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new CryptoError('envelope-too-short', 'an envelope must be bytes');
  }
  if (bytes.length < FRAME_PREFIX_LEN) {
    throw new CryptoError('envelope-too-short',
      `an envelope is at least ${FRAME_PREFIX_LEN} bytes, got ${bytes.length}`);
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new CryptoError('envelope-bad-magic', 'these bytes are not a NeoDonkey envelope');
    }
  }
  const version = bytes[MAGIC.length];
  if (version !== ENVELOPE_VERSION) {
    throw new CryptoError('envelope-unknown-version',
      `envelope format version ${version} is newer or older than this runtime knows `
      + `(it knows ${ENVELOPE_VERSION}). Refusing to guess: an envelope we half-understand is `
      + 'exactly the thing Principle 6 exists to prevent.');
  }
  const flags = bytes[MAGIC.length + 1];
  if (flags !== 0) {
    throw new CryptoError('envelope-reserved-flags',
      `envelope flags byte is 0x${flags.toString(16)}; version 1 reserves it and requires 0`);
  }
  const headerLen = (bytes[MAGIC.length + 2] << 8) | bytes[MAGIC.length + 3];
  const headerEnd = FRAME_PREFIX_LEN + headerLen;
  if (bytes.length < headerEnd) {
    throw new CryptoError('envelope-header-truncated',
      `header claims ${headerLen} bytes but only ${bytes.length - FRAME_PREFIX_LEN} follow`);
  }
  const headerBytes = bytes.subarray(FRAME_PREFIX_LEN, headerEnd);
  const header = parseJsonBytes(headerBytes, 'envelope-header-not-json');
  const ciphertext = bytes.subarray(headerEnd);
  if (ciphertext.length < GCM_TAG_LEN) {
    throw new CryptoError('envelope-no-ciphertext',
      `an envelope must carry at least a ${GCM_TAG_LEN}-byte tag, got ${ciphertext.length}`);
  }
  checkHeader(header, version);
  return { version, flags, headerBytes, header, ciphertext };
}

const isB64 = (s) => typeof s === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0;

/** Header schema, version 1. Every branch throws; none warns. */
function checkHeader(h, frameVersion) {
  const bad = (msg) => { throw new CryptoError('envelope-header-invalid', msg); };
  if (h === null || typeof h !== 'object' || Array.isArray(h)) bad('envelope header is not an object');
  if (h.format !== ENVELOPE_FORMAT) bad(`envelope header format is ${JSON.stringify(h.format)}`);
  if (h.version !== frameVersion) {
    throw new CryptoError('envelope-version-disagreement',
      `the frame says version ${frameVersion} and the header says ${h.version}; two version `
      + 'fields that disagree mean the bytes were assembled from two different envelopes');
  }
  if (typeof h.entity !== 'string' || h.entity === '' || h.entity.includes('/')) {
    bad('envelope header needs an "entity" without "/"');
  }
  if (typeof h.id !== 'string' || h.id === '' || h.id.includes('/')) {
    bad('envelope header needs an "id" without "/"');
  }
  const c = h.content;
  if (!c || typeof c !== 'object') bad('envelope header has no "content" section');
  if (c.alg !== CONTENT_ALG) {
    throw new CryptoError('unknown-content-alg',
      `content algorithm ${JSON.stringify(c.alg)} is not one this runtime implements (${CONTENT_ALG})`);
  }
  if (!isB64(c.iv)) bad('content.iv is not base64');
  const k = h.key;
  if (!k || typeof k !== 'object') bad('envelope header has no "key" section');
  if (k.kind === 'dek') {
    if (!Array.isArray(k.wraps) || k.wraps.length === 0) bad('key.wraps must be a non-empty array');
    for (const w of k.wraps) checkWrap(w, bad);
  } else if (k.kind === 'subject') {
    if (typeof k['key-id'] !== 'string' || k['key-id'] === '') bad('key["key-id"] must be a string');
  } else {
    bad(`key.kind ${JSON.stringify(k.kind)} is not "dek" or "subject"`);
  }
  const n = h['named-by'];
  if (!n || typeof n !== 'object') bad('envelope header has no "named-by" section');
  if (n.group !== undefined) {
    if (typeof n.group !== 'string' || !Number.isInteger(n.epoch) || n.epoch < 1) {
      bad('named-by.group needs a string group and an integer epoch >= 1');
    }
  } else if (typeof n.subject !== 'string' || n.subject === '') {
    bad('named-by must carry either {group, epoch} or {subject}');
  }
}

function checkWrap(w, bad) {
  if (!w || typeof w !== 'object') bad('a wrap record is not an object');
  if (typeof w.group !== 'string' || w.group === '') bad('a wrap record needs a "group"');
  if (!Number.isInteger(w.epoch) || w.epoch < 1) bad('a wrap record needs an integer epoch >= 1');
  if (w.alg !== WRAP_ALG) {
    throw new CryptoError('unknown-wrap-alg',
      `wrap algorithm ${JSON.stringify(w.alg)} is not one this runtime implements (${WRAP_ALG})`);
  }
  if (w.kdf !== KDF_ALG) {
    throw new CryptoError('unknown-kdf',
      `wrap kdf ${JSON.stringify(w.kdf)} is not one this runtime implements (${KDF_ALG})`);
  }
  if (!isB64(w.salt)) bad('a wrap record needs a base64 "salt"');
  if (!isB64(w.wrapped)) bad('a wrap record needs a base64 "wrapped"');
  if (typeof w.info !== 'string' || w.info === '') bad('a wrap record needs its "info" string');
}

// ---------------------------------------------------------------------------------------------
// DEK wraps — one per authorised group
// ---------------------------------------------------------------------------------------------

/**
 * Wrap one DEK for one group epoch. The KEK is `HKDF(epochSecret, randomSalt, info)` where the
 * info names the group and the epoch, so the same 40 bytes cannot be reused under another group
 * or another epoch even by someone holding both secrets.
 * @param {{dek: Bytes, group: string, epoch: number, secret: Bytes,
 *          random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<object>} a wrap record
 */
export async function wrapDekForGroup(o) {
  const { dek, group, epoch, secret, random } = o;
  if (!Number.isInteger(epoch) || epoch < 1) {
    throw new CryptoError('manifest-epoch-invalid', 'a group epoch is an integer >= 1');
  }
  const salt = randomBytes(SECRET_LEN, random);
  const info = dekWrapInfo(group, epoch);
  const kek = await hkdf(secret, salt, info);
  return {
    group,
    epoch,
    alg: WRAP_ALG,
    kdf: KDF_ALG,
    salt: b64encode(salt),
    info,
    wrapped: b64encode(await wrapSecret(kek, dek)),
  };
}

/**
 * Unwrap a DEK from one wrap record given the group epoch secret.
 *
 * The `info` string in the record is **verified against the group and epoch the record itself
 * declares** before it is used. Without that check, an attacker could take a wrap record from
 * epoch 1, relabel it `epoch: 2`, and have a member unwrap the *old* group key while believing
 * it is the new one — the classic replay across a rotation. With the check the relabelling is
 * refused outright (`wrap-epoch-mismatch`), and an untouched epoch-1 record offered where epoch 2
 * is expected simply fails to authenticate (`wrap-mac-failed`).
 *
 * @param {object} w @param {Bytes} secret @returns {Promise<Bytes>} the DEK
 */
export async function unwrapDekRecord(w, secret) {
  const expected = dekWrapInfo(w.group, w.epoch);
  if (w.info !== expected) {
    throw new CryptoError('wrap-epoch-mismatch',
      `wrap record declares group ${w.group} epoch ${w.epoch} but its derivation info says `
      + `${JSON.stringify(w.info)} — refusing to derive a key from a label that lies`);
  }
  const kek = await hkdf(secret, b64decode(w.salt), expected);
  return unwrapSecret(kek, b64decode(w.wrapped));
}

// ---------------------------------------------------------------------------------------------
// seal
// ---------------------------------------------------------------------------------------------

/**
 * Encrypt one document.
 *
 * Two shapes of `key`:
 *   • `{kind: 'dek', groups: [{id, epoch, secret}, …]}` — a fresh DEK per call, wrapped for each
 *     group. The ordinary case: salary documents for the HR group.
 *   • `{kind: 'subject', keyId, key}` — no wrap in the header at all; the content key is a
 *     subject key that lives in the vault and can be destroyed (`shred.js`). This is the GDPR
 *     case, and the *absence* of a wrap here is the reason erasure is possible.
 *
 * The naming slot decides the document's path and is recorded in `named-by`. For the DEK case it
 * is the first group listed; for the subject case it is the subject key. A peer that opens the
 * document through a different group still gets the plaintext — it simply cannot re-derive the id
 * and does not need to, because the id is authenticated by the content tag either way.
 *
 * @param {{entity: string, name: string, doc?: object, plaintext?: Bytes,
 *          key: {kind: 'dek', groups: {id: string, epoch: number, secret: Bytes}[]}
 *             | {kind: 'subject', keyId: string, key: Bytes},
 *          random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<{bytes: Bytes, entity: string, id: string, name: string, header: object}>}
 */
export async function seal(o) {
  const { entity, name, doc, plaintext, key, random } = o;
  if (typeof entity !== 'string' || entity === '' || entity.includes('/')) {
    throw new CryptoError('envelope-header-invalid', 'seal() needs an entity without "/"');
  }
  if (typeof name !== 'string' || name === '') {
    throw new CryptoError('sealed-name-mismatch', 'seal() needs the document\'s plaintext name');
  }
  if ((doc === undefined) === (plaintext === undefined)) {
    throw new CryptoError('inner-invalid', 'seal() takes exactly one of `doc` or `plaintext`');
  }

  /** @type {Bytes} */ let contentKey;
  /** @type {Bytes} */ let nameKey;
  /** @type {object} */ let keyRecord;
  /** @type {object} */ let namedBy;

  if (key && key.kind === 'subject') {
    contentKey = key.key;
    nameKey = await deriveSubjectNameKey(key.key, key.keyId);
    keyRecord = { kind: 'subject', 'key-id': key.keyId };
    namedBy = { subject: key.keyId };
  } else if (key && key.kind === 'dek') {
    const groups = key.groups;
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new CryptoError('unknown-group', 'seal() needs at least one authorised group');
    }
    const seen = new Set();
    for (const g of groups) {
      if (seen.has(`${g.id}@${g.epoch}`)) {
        throw new CryptoError('duplicate-member', `group ${g.id}@${g.epoch} listed twice`);
      }
      seen.add(`${g.id}@${g.epoch}`);
    }
    contentKey = key.dek ?? randomBytes(SECRET_LEN, random);
    const wraps = [];
    for (const g of groups) {
      wraps.push(await wrapDekForGroup({
        dek: contentKey, group: g.id, epoch: g.epoch, secret: g.secret, random,
      }));
    }
    keyRecord = { kind: 'dek', wraps };
    const first = groups[0];
    nameKey = await deriveNameKey(first.secret, first.id, first.epoch);
    namedBy = { group: first.id, epoch: first.epoch };
  } else {
    throw new CryptoError('envelope-header-invalid',
      'seal() needs key.kind "dek" or "subject"');
  }

  const id = await sealedId({ nameKey, entity, name });
  const iv = randomBytes(GCM_IV_LEN, random);
  const header = {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    entity,
    id,
    content: { alg: CONTENT_ALG, iv: b64encode(iv) },
    key: keyRecord,
    'named-by': namedBy,
  };
  // The header bytes we authenticate must be the header bytes we ship — build them once.
  const headerBytes = jsonBytes(header);
  const inner = plaintext !== undefined
    ? plaintext
    : jsonBytes({ format: SEALED_FORMAT, version: 1, entity, name, doc });
  const ciphertext = await gcmEncrypt({ key: contentKey, iv, plaintext: inner, aad: headerBytes });
  return { bytes: frame({ headerBytes, ciphertext }), entity, id, name, header };
}

// ---------------------------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------------------------

/**
 * Decrypt one envelope.
 *
 * `resolve` is the only thing that knows about keys: it is handed the parsed `key` section and
 * must return `{key, nameKey?, via}` or throw a `CryptoError`. `groups.js` supplies one built
 * from a keyring; `shred.js` supplies one backed by the vault. This file therefore contains no
 * membership logic and no key storage at all, which is what keeps the *format* reviewable on its
 * own.
 *
 * `path`, when given, is checked against the header: the header's entity and id must be the last
 * two path components. That check needs no key, so it holds for every peer, and it is what stops
 * an authenticated-but-relocated envelope from appearing in an index under someone else's id.
 *
 * @param {Bytes} bytes
 * @param {{resolve: (keyRecord: object, header: object) =>
 *            Promise<{key: Bytes, nameKey?: Bytes, via?: string}>,
 *          path?: string}} o
 * @returns {Promise<{entity: string, id: string, name: string, doc: object, plaintext: Bytes,
 *                    header: object, via: string, nameVerified: boolean}>}
 */
export async function open(bytes, o) {
  const { headerBytes, header, ciphertext } = parseFrame(bytes);
  if (typeof o.path === 'string') assertPathMatches(o.path, header);

  const resolved = await o.resolve(header.key, header);
  if (!resolved || !(resolved.key instanceof Uint8Array)) {
    throw new CryptoError('no-key-for-envelope',
      'no content key is available for this envelope on this peer');
  }
  const iv = b64decode(header.content.iv);
  const plaintext = await gcmDecrypt({
    key: resolved.key, iv, ciphertext, aad: headerBytes,
  });

  const innerRaw = parseJsonBytes(plaintext, 'inner-not-json');
  if (!innerRaw || typeof innerRaw !== 'object' || Array.isArray(innerRaw)
      || innerRaw.format !== SEALED_FORMAT) {
    throw new CryptoError('inner-invalid', 'the decrypted bytes are not a sealed NeoDonkey document');
  }
  if (innerRaw.version !== 1) {
    throw new CryptoError('inner-invalid', `sealed document version ${innerRaw.version} is unknown`);
  }
  if (innerRaw.entity !== header.entity) {
    throw new CryptoError('inner-invalid',
      `the sealed document says entity ${JSON.stringify(innerRaw.entity)}, the header says `
      + `${JSON.stringify(header.entity)}`);
  }
  if (typeof innerRaw.name !== 'string' || innerRaw.name === '') {
    throw new CryptoError('inner-invalid', 'the sealed document carries no plaintext name');
  }
  if (innerRaw.doc === null || typeof innerRaw.doc !== 'object' || Array.isArray(innerRaw.doc)) {
    throw new CryptoError('inner-invalid', 'the sealed document carries no document object');
  }

  let nameVerified = false;
  if (resolved.nameKey instanceof Uint8Array) {
    const recomputed = await sealedId({
      nameKey: resolved.nameKey, entity: header.entity, name: innerRaw.name,
    });
    if (recomputed !== header.id) {
      throw new CryptoError('sealed-name-mismatch',
        `the sealed id in the header is not the keyed hash of the name inside it — this envelope `
        + 'was named by a different key than the one that opened it');
    }
    nameVerified = true;
  }

  return {
    entity: header.entity,
    id: header.id,
    name: innerRaw.name,
    doc: innerRaw.doc,
    plaintext,
    header,
    via: resolved.via ?? 'unknown',
    nameVerified,
  };
}

/**
 * The keyless path binding. A suffix comparison on purpose: it mirrors the read path's
 * `documents/<entity>/<id>.json` convention without re-implementing its parser, which is the
 * duplication Wave 1 was bitten by three times.
 * @param {string} path @param {object} header
 */
export function assertPathMatches(path, header) {
  const want = `/${header.entity}/${header.id}.json`;
  if (!path.endsWith(want)) {
    throw new CryptoError('sealed-path-mismatch',
      `this envelope declares ${header.entity}/${header.id} but was found at ${path}`);
  }
}

/** The `documents/…` path an envelope belongs at. @param {{entity: string, id: string}} sealed */
export function sealedPath(sealed) {
  return `documents/${sealed.entity}/${sealed.id}.json`;
}

/**
 * What a peer *without* the key can still learn from an envelope — the honest statement of
 * metadata leakage, as a function, so a UI can show it and a test can assert on it.
 * @param {Bytes} bytes
 * @returns {{entity: string, id: string, groups: string[], subject: string|null,
 *            contentAlg: string, size: number, version: number}}
 */
export function inspect(bytes) {
  const { version, header, ciphertext } = parseFrame(bytes);
  return {
    version,
    entity: header.entity,
    id: header.id,
    groups: header.key.kind === 'dek' ? header.key.wraps.map((w) => `${w.group}@${w.epoch}`) : [],
    subject: header.key.kind === 'subject' ? header.key['key-id'] : null,
    contentAlg: header.content.alg,
    size: ciphertext.length - GCM_TAG_LEN,
  };
}
