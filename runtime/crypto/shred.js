// runtime/crypto/shred.js — GDPR erasure as cryptographic shredding, and the GoBD conflict.
//
// The claim from Appendix VII, in full: *"'Right to be forgotten' for a customer: all documents
// with their PII are held encrypted with a customer-specific DEK. On deletion request, this DEK is
// destroyed. The blobs remain (for GoBD chain traceability), but they are noise forever."*
//
// It is the strongest single idea in the manifesto and it is very nearly free — but only after one
// architectural fact is faced, and facing it is most of this file.
//
// ## The finding: an append-only store cannot hold a key you may have to destroy
//
// Git keeps every version of every committed file. If the wrapped subject key is committed, then
// after the "deletion" commit it is still reachable — `git log -p -- crypto/subjects/x.json`, one
// command, and the key is back, and with it every document it protected. The erasure would be
// theatre. Making it real by rewriting history is worse: it breaks the commit chain, invalidates
// every signature after the rewrite, and destroys precisely the GoBD property the design exists
// to preserve.
//
// So the resolution has a precondition nobody wrote down, and it is short enough to be a rule:
//
//   **Everything in NeoDonkey may be append-only except the key material of shreddable keys.
//   That material lives in exactly one mutable store — the vault — and never in a commit.**
//
// This is not a compromise; it is the correct shape, and it is the same shape every serious
// crypto-shredding design has (a KMS or an HSM beside the immutable object store). What is
// unusual here is only that we can say precisely which bytes are in the mutable store: wrapped
// subject keys, and nothing else. The vault is small, it is not the system of record, and losing
// it destroys confidential *content* while leaving the audit chain intact and verifiable — which
// is the same failure mode as erasure, deliberately.
//
// ## What lives where
//
//   in git (immutable, signed, auditable)        in the vault (mutable, per peer, never committed)
//   ------------------------------------         --------------------------------------------------
//   the ciphertext blobs                         `subject-keys/<key-id>.json`  the wrapped key
//   `crypto/subjects/<key-id>.json`              `subject-keys/<key-id>.destroyed`  a tombstone
//     the *record*: which subject, which
//     groups may open it, live or erased
//   `crypto/erasures/<key-id>.json`
//     who asked, on what legal basis, which
//     documents became noise
//
// The erasure is therefore itself a signed, dated, auditable commit. That is what makes this
// legally arguable rather than merely clever: a Betriebsprüfer sees an unbroken chain, sees the
// blob still there with its hash unchanged, and sees a signed record saying "on this date, on this
// legal basis, the key to this document was destroyed". Nothing was deleted from the books.
//
// ## Honest limits, stated where the code is rather than in a footnote
//
//   1. **Every peer must perform the erasure.** The vault is replicated between peers, so an
//      erasure is only complete when every peer has run it. This module makes each peer's half
//      real, local and verifiable (the tombstone), and it makes the order committable so the mesh
//      can carry it — but transport is `runtime/sync/`'s job, not this file's.
//   2. **Overwrite-then-unlink is best effort.** On a copy-on-write filesystem or an SSD with wear
//      levelling, the old sectors may survive. The guarantee that matters is that the key was
//      never in the append-only store, plus full-disk encryption (COMPROMISES #2 / Appendix XI).
//      We overwrite anyway, because it costs nothing and it removes the easy recovery.
//   3. **A cached key is not an erased key.** A destroyed vault file with the key still in a
//      running process's memory is unsaved, not erased. `eraseSubject` clears every keyring it is
//      given and refuses to report success for a keyring it was not given.
//   4. **The subject reference remains.** `crypto/subjects/<id>.json` names the subject
//      (`customer/C-1042`). That must be a pseudonymous business reference and never a name, an
//      address or an email — the reference is what a retention obligation legitimately keeps.

/** @typedef {Uint8Array} Bytes */

import {
  CryptoError, WRAP_ALG, KDF_ALG, SECRET_LEN, randomBytes, hkdf, wrapSecret, unwrapSecret,
  generateGroupSecret, keyIdOf, subjectWrapInfo, jsonBytes, parseJsonBytes, CRYPTO_PATHS,
} from './keys.js';
import { b64encode, b64decode } from '../identity/ed25519.js';
import { seal } from './envelope.js';

export const SUBJECT_FORMAT = 'neodonkey-subject-key';
export const SUBJECT_WRAP_FORMAT = 'neodonkey-subject-wrap';
export const ERASURE_FORMAT = 'neodonkey-erasure';
export const TOMBSTONE_FORMAT = 'neodonkey-key-destroyed';
export const SUBJECT_RECORD_VERSION = 1;

/** The vault's default location. Not inside the repo's tracked tree, and never committed. */
export const DEFAULT_VAULT_PREFIX = 'vault';

// ---------------------------------------------------------------------------------------------
// the vault — the one mutable store
// ---------------------------------------------------------------------------------------------

/**
 * A vault over any `FsAdapter` (`runtime/git/fs.js`): the node one, the OPFS one, or `memFs()` in
 * a test. Reusing the adapter is deliberate — the vault must work in a browser tab and in a CLI
 * peer with the same code, and the adapter is the project's existing answer to that.
 *
 * @param {import('../git/fs.js').FsAdapter} fs
 * @param {string} [prefix]
 * @returns {object}
 */
export function vault(fs, prefix = DEFAULT_VAULT_PREFIX) {
  if (!fs || typeof fs.read !== 'function' || typeof fs.write !== 'function'
      || typeof fs.remove !== 'function') {
    throw new CryptoError('vault-required', 'a vault needs an FsAdapter with read/write/remove');
  }
  const at = (p) => `${prefix}/${p}`;
  return {
    prefix,
    /** @param {string} p @returns {Promise<Bytes|null>} */
    read: (p) => fs.read(at(p)),
    /** @param {string} p @param {Bytes} bytes */
    async write(p, bytes) {
      await fs.write(at(p), bytes);
      // 0600 where the environment has permission bits; a documented no-op where it does not.
      await fs.chmod(at(p), 0o600).catch(() => {});
    },
    /**
     * Destroy: overwrite with the same number of random bytes, then unlink. The overwrite is best
     * effort (see limit 2 in the file header) and is done because it is free, not because it is a
     * guarantee.
     * @param {string} p @returns {Promise<boolean>} whether anything was there
     */
    async destroy(p) {
      const existing = await fs.read(at(p));
      if (existing === null) return false;
      await fs.write(at(p), randomBytes(existing.length));
      await fs.remove(at(p));
      return true;
    },
    /** @param {string} dir @returns {Promise<string[]>} */
    list: (dir = '') => fs.list(dir === '' ? prefix : at(dir)),
    /** @param {string} p @returns {Promise<boolean>} */
    async has(p) { return (await fs.read(at(p))) !== null; },
  };
}

// ---------------------------------------------------------------------------------------------
// subject keys
// ---------------------------------------------------------------------------------------------

/**
 * Mint a subject key: one AES-256 key for everything that carries one data subject's PII.
 *
 * Returns three separable things, because they go to three different places and mixing them up is
 * the whole failure mode this file exists to avoid:
 *   • `key` — the raw key. In memory only. Never written by this function.
 *   • `record` — for the repo. Public, no key material.
 *   • `wrap` — for the vault. Key material, wrapped for the authorised groups.
 *
 * @param {{subject: string, groups: {id: string, epoch: number, secret: Bytes}[],
 *          key?: Bytes, random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<{keyId: string, key: Bytes, record: object, wrap: object}>}
 */
export async function createSubjectKey(o) {
  const { subject, groups, random } = o;
  if (typeof subject !== 'string' || subject === '') {
    throw new CryptoError('not-a-subject-record',
      'a subject key needs a subject reference (a pseudonymous business id, never a name)');
  }
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new CryptoError('unknown-group',
      'a subject key must be wrapped for at least one group, or nobody can ever open it');
  }
  const key = o.key ?? generateGroupSecret(random);
  const keyId = await keyIdOf(key);
  const wraps = [];
  for (const g of groups) {
    const salt = randomBytes(SECRET_LEN, random);
    const info = subjectWrapInfo(g.id, g.epoch, keyId);
    const kek = await hkdf(g.secret, salt, info);
    wraps.push({
      group: g.id,
      epoch: g.epoch,
      alg: WRAP_ALG,
      kdf: KDF_ALG,
      salt: b64encode(salt),
      info,
      wrapped: b64encode(await wrapSecret(kek, key)),
    });
  }
  return {
    keyId,
    key,
    record: {
      format: SUBJECT_FORMAT,
      version: SUBJECT_RECORD_VERSION,
      'key-id': keyId,
      subject,
      groups: groups.map((g) => `${g.id}@${g.epoch}`),
      state: 'live',
    },
    wrap: {
      format: SUBJECT_WRAP_FORMAT,
      version: SUBJECT_RECORD_VERSION,
      'key-id': keyId,
      subject,
      wraps,
    },
  };
}

/** The repo file for a subject record. @param {object} record */
export function subjectRecordFile(record) {
  return { path: CRYPTO_PATHS.subject(record['key-id']), bytes: jsonBytes(record) };
}

/** Put the wrapped key in the vault. @param {object} v @param {object} wrap */
export async function storeSubjectKey(v, wrap) {
  if (!wrap || wrap.format !== SUBJECT_WRAP_FORMAT) {
    throw new CryptoError('not-a-subject-record', 'not a subject-key wrap record');
  }
  await v.write(CRYPTO_PATHS.vaultSubject(wrap['key-id']), jsonBytes(wrap));
}

const tombstonePath = (keyId) => `${CRYPTO_PATHS.vaultSubject(keyId)}.destroyed`;

/**
 * Recover a subject key from the vault, using a keyring's group secrets to unwrap it.
 *
 * The three outcomes are distinct and all of them fail closed:
 *   • the tombstone is present → `subject-key-destroyed`. Erased here, deliberately, and the
 *     tombstone says when and why.
 *   • nothing is present → `subject-key-missing`. Not erased, just absent — a peer that has never
 *     been given this key, or a vault that was not replicated. Never treated as "erased", because
 *     reporting a missing key as an honoured erasure request would be a lie to a regulator.
 *   • present but no group secret unwraps it → `not-a-member`.
 *
 * @param {{vault: object, keyId: string, keyring: object}} o @returns {Promise<Bytes>}
 */
export async function loadSubjectKey(o) {
  const { keyId, keyring: ring } = o;
  const v = o.vault;
  const tomb = await v.read(tombstonePath(keyId));
  if (tomb !== null) {
    const t = parseJsonBytes(tomb, 'not-a-subject-record');
    throw new CryptoError('subject-key-destroyed',
      `subject key ${keyId} was destroyed on this peer (${t.reason ?? 'no reason recorded'}). `
      + 'The documents it protected are still in the repository, still hashed into the commit '
      + 'chain, and permanently unreadable. This is the erasure, not a fault.');
  }
  const raw = await v.read(CRYPTO_PATHS.vaultSubject(keyId));
  if (raw === null) {
    throw new CryptoError('subject-key-missing',
      `subject key ${keyId} is not in this peer's vault and no tombstone says it was destroyed — `
      + 'this peer was never given it, or its vault was not replicated');
  }
  const wrap = parseJsonBytes(raw, 'not-a-subject-record');
  if (wrap.format !== SUBJECT_WRAP_FORMAT || wrap['key-id'] !== keyId) {
    throw new CryptoError('not-a-subject-record',
      `the vault entry for ${keyId} is not a subject-key wrap for ${keyId}`);
  }
  /** @type {CryptoError|null} */
  let last = null;
  for (const w of wrap.wraps ?? []) {
    const expected = subjectWrapInfo(w.group, w.epoch, keyId);
    if (w.info !== expected) {
      last = new CryptoError('wrap-epoch-mismatch',
        `a subject-key wrap labelled ${w.group}@${w.epoch} derives with ${JSON.stringify(w.info)}`);
      continue;
    }
    const secret = ring.secretFor(w.group, w.epoch);
    if (secret === null) {
      last = new CryptoError('not-a-member',
        `subject key ${keyId} is wrapped for ${w.group}@${w.epoch}, which ${ring.principal} `
        + 'does not hold');
      continue;
    }
    try {
      return await unwrapSecret(await hkdf(secret, b64decode(w.salt), expected),
        b64decode(w.wrapped));
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new CryptoError('not-a-member', `no wrap of subject key ${keyId} is openable here`);
}

/**
 * Teach a keyring to fetch subject keys from a vault. One line at a call site, and it is what
 * makes `kind: 'subject'` envelopes openable without `groups.js` knowing the vault format.
 * @param {object} keyring @param {object} v @returns {object} the same keyring
 */
export function attachVault(keyring, v) {
  keyring.provideSubjectKeys((keyId) => loadSubjectKey({ vault: v, keyId, keyring }));
  return keyring;
}

/**
 * Seal a document under a subject key — the PII case. Note what is *absent* from the resulting
 * envelope: any wrapped key at all. The header names the subject key id and stops. That absence is
 * the erasability.
 * @param {{entity: string, name: string, doc: object, keyId: string, key: Bytes,
 *          random?: (b: Bytes) => Bytes}} o
 */
export function sealForSubject(o) {
  return seal({
    entity: o.entity,
    name: o.name,
    doc: o.doc,
    key: { kind: 'subject', keyId: o.keyId, key: o.key },
    random: o.random,
  });
}

// ---------------------------------------------------------------------------------------------
// erasure
// ---------------------------------------------------------------------------------------------

/**
 * Honour an erasure request.
 *
 * Destroys the key material in this peer's vault, leaves a tombstone, clears the key out of every
 * keyring handed to it, and produces the two repo files that make the act auditable. It writes
 * nothing to the repo itself — the caller commits, signs, and thereby dates it, because a signed
 * commit *is* the audit trail (Appendix IX) and this module has no business owning a clock.
 *
 * @param {{vault: object, record: object, reason: string, requestedBy: string,
 *          documents?: string[], keyrings?: object[], at?: string}} o
 * @returns {Promise<{record: object, erasure: object, files: Map<string, Bytes>,
 *                    destroyed: boolean, keyringsCleared: number}>}
 */
export async function eraseSubject(o) {
  const { record, reason, requestedBy, documents = [], keyrings = [], at = null } = o;
  const v = o.vault;
  if (!record || record.format !== SUBJECT_FORMAT) {
    throw new CryptoError('not-a-subject-record', 'eraseSubject() needs a subject record');
  }
  if (record.state === 'erased') {
    throw new CryptoError('subject-already-erased',
      `subject key ${record['key-id']} is already recorded as erased; erasing twice would write a `
      + 'second erasure record for one request');
  }
  if (typeof reason !== 'string' || reason === '' || typeof requestedBy !== 'string'
      || requestedBy === '') {
    throw new CryptoError('not-a-subject-record',
      'an erasure needs a reason and a requester — an undocumented key destruction is indefensible '
      + 'to both regulators at once');
  }
  const keyId = record['key-id'];
  const destroyed = await v.destroy(CRYPTO_PATHS.vaultSubject(keyId));
  await v.write(tombstonePath(keyId), jsonBytes({
    format: TOMBSTONE_FORMAT,
    version: SUBJECT_RECORD_VERSION,
    'key-id': keyId,
    subject: record.subject,
    reason,
    'requested-by': requestedBy,
    at,
  }));
  for (const ring of keyrings) ring.forget(keyId);

  const erasure = {
    format: ERASURE_FORMAT,
    version: SUBJECT_RECORD_VERSION,
    'key-id': keyId,
    subject: record.subject,
    reason,
    'requested-by': requestedBy,
    at,
    'key-destroyed': true,
    documents: [...documents].sort(),
    note:
      'The documents listed remain in this repository, byte-identical, with their hashes still in '
      + 'the commit chain (GoBD: Unveränderbarkeit, Vollständigkeit, Nachvollziehbarkeit). Their '
      + 'content key has been destroyed, so their content is permanently unreadable (GDPR Art. 17). '
      + 'Nothing was removed from the books.',
  };
  const updated = { ...record, state: 'erased', 'erased-by': requestedBy, 'erased-because': reason };
  const files = new Map();
  const rf = subjectRecordFile(updated);
  files.set(rf.path, rf.bytes);
  files.set(CRYPTO_PATHS.erasure(keyId), jsonBytes(erasure));
  return { record: updated, erasure, files, destroyed, keyringsCleared: keyrings.length };
}

/**
 * Prove the first half of the claim: the plaintext really is gone.
 *
 * Tries, for every envelope and every keyring supplied, to open the document. A single success is
 * a failed erasure. Also checks the things a hopeful implementation gets wrong: the vault entry is
 * gone, the tombstone is there, and no keyring is still holding the key in memory.
 *
 * @param {{vault: object, keyId: string, envelopes: Bytes[], keyrings: object[]}} o
 * @returns {Promise<{unrecoverable: boolean, attempts: {via: string, reason: string}[],
 *                    vaultEntryGone: boolean, tombstonePresent: boolean, cached: string[]}>}
 */
export async function verifyErasure(o) {
  const { keyId, envelopes, keyrings } = o;
  const v = o.vault;
  const attempts = [];
  let anyOpened = false;
  for (const ring of keyrings) {
    for (const [i, bytes] of envelopes.entries()) {
      try {
        await ring.open(bytes);
        attempts.push({ via: `${ring.principal}#${i}`, reason: 'OPENED' });
        anyOpened = true;
      } catch (e) {
        attempts.push({ via: `${ring.principal}#${i}`, reason: e.reason ?? 'unknown' });
      }
    }
  }
  const cached = keyrings.flatMap((r) => r.cachedSubjectKeys()).filter((k) => k === keyId);
  const vaultEntryGone = !(await v.has(CRYPTO_PATHS.vaultSubject(keyId)));
  const tombstonePresent = await v.has(tombstonePath(keyId));
  return {
    unrecoverable: !anyOpened && vaultEntryGone && tombstonePresent && cached.length === 0,
    attempts,
    vaultEntryGone,
    tombstonePresent,
    cached,
  };
}
