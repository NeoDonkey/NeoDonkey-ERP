// runtime/crypto/reader.js — the decrypting reader the read path accepts.
//
// `runtime/read/index.js` states the contract this file exists to satisfy, and it is worth quoting
// because the design is agent E's, not ours: *"Decryption is not implemented here and must not be.
// It is injected: `readBlob` is whatever the caller hands us. A decrypting reader returns plaintext
// for what the peer can open, and opaque bytes (or throws) for what it cannot."*
//
// So this module edits nothing in the read path. It wraps a `readBlob` and returns a `readBlob`.
// Everything Appendix VII promises about personalized indexes falls out of that one substitution:
//
//   • openable → the reader returns the plaintext document JSON, and the read path indexes it
//     exactly as if it had never been encrypted;
//   • not openable → the reader returns the envelope bytes unchanged. They begin 0xFF, which is
//     not legal UTF-8 anywhere, so the read path's `classify()` records `opaque` and moves on.
//
// **Why this is stronger than filtering.** The read path only ever creates an entity bucket for a
// document it could *read*. An intern who is not in the HR group therefore has no `salary` key in
// her index at all: `entities()` does not list it, `all('salary')` is the empty frozen array,
// `stats().entities` has no such property, and the MCP interface cannot name a table that is not
// there. That is Appendix VII's "elegant side effect" and it is literally true — not a predicate
// applied late, which could be forgotten, mis-scoped, or bypassed by a second query path.
//
// The reader is also the honest accountant of what it could not open: `stats()` and `problems()`
// report every refusal with its reason, so "37 documents opaque" can be shown to a user and
// "opaque because the wrap was tampered with" is never quietly the same event as "opaque because
// I am not in that group".

/** @typedef {Uint8Array} Bytes */

import { CryptoError, jsonBytes, CRYPTO_PATHS } from './keys.js';
import { isEnvelope } from './envelope.js';
import { keyring } from './groups.js';
import { attachVault } from './shred.js';

/** The field a decrypted document gains, carrying the plaintext name from the sealed header. */
export const DEFAULT_NAME_FIELD = 'sealed-name';

/**
 * Turn one opened envelope into the document bytes the read path expects.
 *
 * The sealed id wins over anything in the document body, because the path is authoritative for
 * identity in this codebase and the read path refuses a body that contradicts its path. The
 * plaintext name is added back as a field so a member can still search for "2027-Q3-anna" —
 * without it, encrypted filenames would leave a member able to decrypt a document but unable to
 * find it, which is a half-capability of exactly the kind Wave 1 kept producing.
 *
 * @param {{entity: string, id: string, name: string, doc: object}} opened
 * @param {string|null} [nameField]
 * @returns {Bytes}
 */
export function documentBytes(opened, nameField = DEFAULT_NAME_FIELD) {
  const out = { ...opened.doc, entity: opened.entity, id: opened.id };
  if (nameField !== null) out[nameField] = opened.name;
  return jsonBytes(out);
}

/**
 * Wrap a `readBlob` so that what this peer can decrypt becomes plaintext and what it cannot stays
 * opaque.
 *
 * @param {{readBlob: (oid: string, path?: string) => Promise<Bytes>,
 *          keyring: object,
 *          nameField?: string|null,
 *          requirePath?: boolean}} o
 *   `requirePath` (default false) refuses to open an envelope when the read path did not tell us
 *   which path it came from, so the header↔path binding can always be checked. It is off by
 *   default because the binding is a *consistency* check — the entity and id are inside the
 *   AES-GCM AAD and so cannot be altered — and because a reader that goes blind if a caller
 *   changes one argument would be a worse failure than the one it prevents. Turn it on for a
 *   deployment that wants the stricter posture.
 * @returns {((oid: string, path?: string) => Promise<Bytes>) & {stats: Function, problems: Function}}
 */
export function decryptingReader(o) {
  const { readBlob, keyring: ring, nameField = DEFAULT_NAME_FIELD, requirePath = false } = o;
  if (typeof readBlob !== 'function') {
    throw new CryptoError('vault-required', 'decryptingReader() needs a readBlob to wrap');
  }
  if (!ring || typeof ring.open !== 'function') {
    throw new CryptoError('vault-required', 'decryptingReader() needs a keyring');
  }

  let plain = 0;
  let opened = 0;
  let opaque = 0;
  /** @type {Map<string, number>} */
  const byReason = new Map();
  /** @type {{path: string|null, reason: string, message: string}[]} */
  const problems = [];

  const refuse = (path, reason, message) => {
    opaque++;
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    problems.push({ path: path ?? null, reason, message });
  };

  /** @type {any} */
  const read = async (oid, path) => {
    const bytes = await readBlob(oid, path);
    if (!isEnvelope(bytes)) {
      plain++;
      return bytes;
    }
    if (requirePath && typeof path !== 'string') {
      refuse(path, 'sealed-path-mismatch',
        'requirePath is set and this blob arrived without a path');
      return bytes;
    }
    try {
      const result = await ring.open(bytes, typeof path === 'string' ? path : undefined);
      opened++;
      return documentBytes(result, nameField);
    } catch (e) {
      if (!(e instanceof CryptoError)) throw e;
      refuse(path, e.reason, e.message);
      return bytes;
    }
  };

  /**
   * `plain` + `opened` is what the index will contain; `opaque` is the shadow of Appendix VII.
   * Counts are cumulative over the reader's life, matching how the read path uses it (one reader
   * per materialize, then per update).
   */
  read.stats = () => ({
    plain,
    opened,
    opaque,
    byReason: Object.fromEntries([...byReason.entries()].sort()),
  });
  read.problems = () => problems.map((p) => ({ ...p }));
  read.keyring = ring;
  return read;
}

/**
 * Build a keyring from a repo tree the peer already has in memory.
 *
 * The kernel materialises HEAD into a `Map<path, Bytes>`; this turns the `crypto/groups/*.json`
 * entries of such a map into a working keyring, optionally vault-backed. It exists so that "open
 * the workspace, then read what I am allowed to read" is one call and not a recipe — the group
 * manifests are public repo files, so finding them needs no key and no configuration.
 *
 * @param {{files: Map<string, Bytes>, principal: string,
 *          encryption: {privateKey: CryptoKey, curve?: string}, vault?: object}} o
 * @returns {Promise<object>} a keyring
 */
export async function keyringFromRepo(o) {
  const { files, principal, encryption } = o;
  const manifests = [];
  for (const [path, bytes] of files) {
    if (!path.startsWith('crypto/groups/') || !path.endsWith('.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (e) {
      throw new CryptoError('not-a-group-manifest',
        `${path} is not readable JSON (${e.message}). A group manifest that cannot be parsed is `
        + 'refused, not skipped: skipping it would silently downgrade this peer to a non-member.');
    }
    if (parsed && parsed.id !== undefined && CRYPTO_PATHS.group(parsed.id) !== path) {
      throw new CryptoError('not-a-group-manifest',
        `${path} declares group id ${JSON.stringify(parsed.id)}, which belongs at `
        + `${CRYPTO_PATHS.group(parsed.id)}`);
    }
    manifests.push(parsed);
  }
  manifests.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ring = await keyring({ principal, encryption, manifests });
  if (o.vault) attachVault(ring, o.vault);
  return ring;
}
