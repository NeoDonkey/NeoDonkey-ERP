// runtime/git/fs-node.js — THE ONLY FILE IN THE CODEBASE ALLOWED TO IMPORT node:*.
//
// If you are adding a `node:` import anywhere else, you are breaking non-negotiable #2
// of docs/CONTRACT.md: the same ES modules must load in a browser with no build step.

import { readFile, writeFile, readdir, rm, mkdir, chmod, rename } from 'node:fs/promises';
import { splitPath } from './fs.js';

/** @typedef {import('./fs.js').FsAdapter} FsAdapter */

const isMissing = (err) => err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/**
 * @param {string} rootDir absolute or process-relative directory; created on demand
 * @param {{ rng?: () => number }} [opts] optional options including injectable rng
 * @returns {FsAdapter}
 */
export function nodeFs(rootDir, opts = {}) {
  if (typeof rootDir !== 'string' || rootDir === '') {
    throw new Error('nodeFs: rootDir must be a non-empty string');
  }
  // Join by hand rather than with node:path so the logic is identical to fs-opfs.js.
  const resolve = (path) => {
    const parts = splitPath(path);
    return parts.length ? `${rootDir}/${parts.join('/')}` : rootDir;
  };
  const parentOf = (path) => {
    const parts = splitPath(path);
    parts.pop();
    return parts.length ? `${rootDir}/${parts.join('/')}` : rootDir;
  };

  return {
    async read(path) {
      try {
        const buf = await readFile(resolve(path));
        // Views the same memory without ever naming Buffer above this line.
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (err) {
        if (isMissing(err) || err.code === 'EISDIR') return null;
        throw err;
      }
    },
    async write(path, data) {
      const target = resolve(path);
      if (target === rootDir) throw new Error('fs: cannot write the root');
      await mkdir(parentOf(path), { recursive: true });
      let seq = 0;
      const randStr = opts.rng
        ? String(Math.floor(opts.rng() * 1e9))
        : `${process.hrtime.bigint()}.${++seq}`;
      const tmp = `${target}.tmp.${process.pid}.${randStr}`;
      try {
        await writeFile(tmp, data);
        await rename(tmp, target);
      } catch (err) {
        try { await rm(tmp, { force: true }); } catch {}
        throw err;
      }
    },
    async list(path) {
      try {
        return await readdir(resolve(path));
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
    async remove(path) {
      const target = resolve(path);
      if (target === rootDir) throw new Error('fs: cannot remove the root');
      await rm(target, { recursive: true, force: true });
    },
    async mkdir(path) {
      await mkdir(resolve(path), { recursive: true });
    },
    /**
     * The one capability that exists purely for security: runtime/identity/keystore.js
     * needs a private key file at 0600, and umask alone would not guarantee it.
     * @param {string} path @param {number} mode e.g. 0o600
     */
    async chmod(path, mode) {
      await chmod(resolve(path), mode);
    },
  };
}
