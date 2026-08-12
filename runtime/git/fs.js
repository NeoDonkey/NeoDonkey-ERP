// runtime/git/fs.js — the one place the environment leaks in.
//
// Everything above this file is pure and portable. Below it there are exactly two
// implementations: fs-node.js (the only file in the codebase allowed to touch node:*)
// and fs-opfs.js (FileSystemDirectoryHandle — OPFS *and* File System Access).
// Both satisfy the same semantics and the same test body.

/**
 * @typedef {Uint8Array} Bytes
 *
 * @typedef {object} FsAdapter
 * @property {(path: string) => Promise<Bytes|null>} read   null when absent
 * @property {(path: string, data: Bytes) => Promise<void>} write  creates parent dirs
 * @property {(path: string) => Promise<string[]>} list     names, non-recursive, [] if missing
 * @property {(path: string) => Promise<void>} remove       recursive, no-op if absent
 * @property {(path: string) => Promise<void>} mkdir        recursive; see CONTRACT amendment A-1
 * @property {(path: string, mode: number) => Promise<void>} chmod  POSIX mode where the
 *   environment has one, no-op where it does not. Always defined, so callers never need
 *   an environment check. See CONTRACT amendment A-4: runtime/identity/keystore.js must
 *   be able to create a private key file 0600, and this is the only file allowed to
 *   reach node:fs — so the capability has to exist here or not at all.
 */

/**
 * Split a '/'-separated path into segments, rejecting anything that could escape
 * the adapter root. Shared by both adapters so their semantics cannot drift.
 * @param {string} path
 * @returns {string[]}
 */
export function splitPath(path) {
  if (typeof path !== 'string') throw new Error(`fs: path must be a string, got ${typeof path}`);
  const parts = path.split('/').filter((p) => p !== '' && p !== '.');
  for (const p of parts) {
    if (p === '..') throw new Error(`fs: '..' is not allowed in paths: ${path}`);
  }
  return parts;
}

/**
 * An in-memory FsAdapter. Not part of the environment story — it exists so the
 * shared adapter test body can run with no environment at all, and so callers can
 * build a repo in RAM (a browser tab that has not yet been given a directory handle).
 * See CONTRACT amendment A-2.
 * @returns {FsAdapter}
 */
export function memFs() {
  /** @type {Map<string, Bytes>} */
  const files = new Map();
  /** @type {Set<string>} */
  const dirs = new Set();
  /** @type {Map<string, number>} */
  const modes = new Map();

  const key = (path) => splitPath(path).join('/');
  const markDirs = (k) => {
    const parts = k.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  };

  return {
    async read(path) {
      const v = files.get(key(path));
      return v ? new Uint8Array(v) : null;
    },
    async write(path, data) {
      const k = key(path);
      if (!k) throw new Error('fs: cannot write the root');
      markDirs(k);
      files.set(k, new Uint8Array(data));
    },
    async list(path) {
      const k = key(path);
      const prefix = k === '' ? '' : `${k}/`;
      const names = new Set();
      for (const name of [...files.keys(), ...dirs]) {
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        if (rest === '') continue;
        names.add(rest.split('/')[0]);
      }
      return [...names];
    },
    async remove(path) {
      const k = key(path);
      if (!k) throw new Error('fs: cannot remove the root');
      files.delete(k);
      dirs.delete(k);
      const prefix = `${k}/`;
      for (const name of [...files.keys()]) if (name.startsWith(prefix)) files.delete(name);
      for (const name of [...dirs]) if (name.startsWith(prefix)) dirs.delete(name);
    },
    async mkdir(path) {
      const k = key(path);
      if (k) { markDirs(k); dirs.add(k); }
    },
    async chmod(path, mode) {
      // RAM has no permission bits. Recorded so a test can assert the call happened.
      const k = key(path);
      if (!files.has(k) && !dirs.has(k)) throw new Error(`fs: chmod on missing path: ${path}`);
      modes.set(k, mode);
    },
    /** Test-only window onto the recorded modes; not part of FsAdapter. */
    _modes: modes,
  };
}
