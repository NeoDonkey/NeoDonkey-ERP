// runtime/identity/keystore.js — where a peer's private identity key lives.
//
// Appendix IV says primary secrets ("the user's personal Ed25519 key") live in the OS keychain
// and never leave it. A browser cannot reach the OS keychain. This file is therefore the
// honest, documented approximation of that requirement, and it is deliberately two-headed:
//
//   backend 'browser' → IndexedDB holding *CryptoKey objects*. IndexedDB serialises CryptoKey
//                       via structured clone, so a key generated with `extractable: false`
//                       is persisted and reloaded without its private scalar ever existing
//                       as bytes in JS. Script that reads the record gets a signing *handle*,
//                       not key material. This is the closest a browser gets to a keychain.
//   backend 'node'    → a JWK file under the workspace, via the injected FsAdapter. The key
//                       material IS bytes here; that is a real, documented weakening.
//
// See docs/COMPROMISES.md ("Appendix IV — OS keychain").
//
// No `node:*` import: the node backend goes through the caller-supplied FsAdapter
// (`runtime/git/fs-node.js`), which keeps this file browser-loadable too.

import { exportPrivateJwk, importPrivateJwk, exportPublicSsh } from './ed25519.js';

/** @typedef {import('./ed25519.js').KeyPair} KeyPair */
/** @typedef {{ read(path:string): Promise<Uint8Array|null>,
 *              write(path:string, data:Uint8Array): Promise<void>,
 *              list(path:string): Promise<string[]>,
 *              remove(path:string): Promise<void>,
 *              chmod?(path:string, mode:number): Promise<void> }} FsAdapter */

const KEY_DIR = 'keys';
const FILE_EXT = '.json';
const RECORD_VERSION = 1;
const IDB_NAME = 'neodonkey-identity';
const IDB_STORE = 'keys';
const PRIVATE_FILE_MODE = 0o600;

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Key names become file names and IDB keys — keep them boring on purpose. */
function assertName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
    throw new Error('keystore: name must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/');
  }
  return name;
}

function assertKeyPair(kp) {
  if (!kp || typeof kp !== 'object' || !kp.privateKey || !kp.publicKey) {
    throw new Error('keystore: not a key pair');
  }
  return kp;
}

/**
 * @param {'node'|'browser'} backend
 * @param {FsAdapter} [fs] required for 'node'
 * @returns {{ save(name:string, kp:KeyPair): Promise<void>,
 *             load(name:string): Promise<KeyPair|null>,
 *             list(): Promise<string[]>,
 *             remove(name:string): Promise<void> }}
 */
export function keystore(backend, fs) {
  if (backend === 'node') return nodeKeystore(fs);
  if (backend === 'browser') return browserKeystore();
  throw new Error(`keystore: unknown backend ${JSON.stringify(backend)}`);
}

// ---------------------------------------------------------------------------
// node backend — JWK file under the workspace, 0600 when the adapter can do it
// ---------------------------------------------------------------------------

function nodeKeystore(fs) {
  if (!fs || typeof fs.read !== 'function' || typeof fs.write !== 'function'
      || typeof fs.list !== 'function' || typeof fs.remove !== 'function') {
    throw new Error("keystore('node') requires an FsAdapter (see runtime/git/fs-node.js)");
  }
  const pathOf = (name) => `${KEY_DIR}/${assertName(name)}${FILE_EXT}`;

  return {
    async save(name, kp) {
      assertKeyPair(kp);
      const path = pathOf(name);
      const record = {
        version: RECORD_VERSION,
        type: 'ed25519',
        name,
        comment: kp.comment || '',
        publicSsh: await exportPublicSsh(kp),
        // Throws for non-extractable keys — a browser-grade key cannot be filed to disk,
        // and pretending otherwise would be worse than failing.
        privateJwk: await exportPrivateJwk(kp),
      };
      await fs.write(path, enc.encode(`${JSON.stringify(record, null, 2)}\n`));
      // Appendix XI, first line of defence: the private key file must not be world-readable.
      // The FsAdapter contract has no chmod, so we use it only if the adapter offers one and
      // otherwise leave a loud trace rather than silently shipping a 0644 private key.
      if (typeof fs.chmod === 'function') {
        await fs.chmod(path, PRIVATE_FILE_MODE);
      } else {
        globalThis.console?.warn?.(
          `keystore: FsAdapter has no chmod(); ${path} keeps the umask default instead of 0600`,
        );
      }
    },

    async load(name) {
      const bytes = await fs.read(pathOf(name));
      if (!bytes) return null;
      let record;
      try {
        record = JSON.parse(dec.decode(bytes));
      } catch {
        throw new Error(`keystore: ${pathOf(name)} is not valid JSON`);
      }
      if (!record || record.version !== RECORD_VERSION || record.type !== 'ed25519') {
        throw new Error(`keystore: ${pathOf(name)} is not a v${RECORD_VERSION} ed25519 record`);
      }
      const kp = await importPrivateJwk(record.privateJwk);
      return { ...kp, comment: record.comment || kp.comment || '' };
    },

    async list() {
      const names = await fs.list(KEY_DIR);
      return names
        .filter((n) => n.endsWith(FILE_EXT))
        .map((n) => n.slice(0, -FILE_EXT.length))
        .sort();
    },

    async remove(name) {
      await fs.remove(pathOf(name));
    },
  };
}

// ---------------------------------------------------------------------------
// browser backend — IndexedDB storing CryptoKey objects, not key bytes
// ---------------------------------------------------------------------------

function idb() {
  const factory = globalThis.indexedDB;
  if (!factory) throw new Error("keystore('browser') requires IndexedDB");
  return new Promise((resolve, reject) => {
    const req = factory.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('keystore: IndexedDB open blocked'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(IDB_STORE, mode);
    let result;
    const req = fn(t.objectStore(IDB_STORE));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error || new Error('keystore: transaction aborted')); };
  });
}

function browserKeystore() {
  return {
    async save(name, kp) {
      assertName(name);
      assertKeyPair(kp);
      // Note what is NOT here: no exportKey('jwk'). The CryptoKey objects themselves are the
      // stored value. With a non-extractable private key the scalar never enters JS memory,
      // so XSS on the page can at worst *use* the key while the page is open — it cannot
      // exfiltrate it. That is the security win this backend exists for.
      const record = {
        name,
        version: RECORD_VERSION,
        type: 'ed25519',
        comment: kp.comment || '',
        publicSsh: await exportPublicSsh(kp),
        extractable: kp.privateKey.extractable === true,
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
      };
      const db = await idb();
      await tx(db, 'readwrite', (store) => store.put(record));
    },

    async load(name) {
      assertName(name);
      const db = await idb();
      const record = await tx(db, 'readonly', (store) => store.get(name));
      if (!record) return null;
      if (record.version !== RECORD_VERSION || record.type !== 'ed25519') {
        throw new Error(`keystore: '${name}' is not a v${RECORD_VERSION} ed25519 record`);
      }
      return { publicKey: record.publicKey, privateKey: record.privateKey, comment: record.comment || '' };
    },

    async list() {
      const db = await idb();
      const keys = await tx(db, 'readonly', (store) => store.getAllKeys());
      return (keys || []).map(String).sort();
    },

    async remove(name) {
      assertName(name);
      const db = await idb();
      await tx(db, 'readwrite', (store) => store.delete(name));
    },
  };
}
