// runtime/git/fs-opfs.js — the browser half of the storage abstraction.
//
// One implementation covers both browser storage worlds, because they speak the same
// interface (FileSystemDirectoryHandle):
//   • OPFS                    -> await navigator.storage.getDirectory()
//   • File System Access API  -> await window.showDirectoryPicker()
// The second one is what makes Appendix X literal: the user points us at
// ~/sarah-erp/ and afterwards `cd sarah-erp && git log` works in her terminal.
//
// Deliberately a line-for-line mirror of fs-node.js. Same order, same guards, same
// null/[]/no-op semantics — so the shared test body in test/a-git.test.js describes
// both. NOTE: this file cannot be executed by node --test; see the report.

import { splitPath } from './fs.js';

/** @typedef {import('./fs.js').FsAdapter} FsAdapter */

const isMissing = (err) => err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {FsAdapter}
 */
export function opfsFs(dirHandle) {
  if (!dirHandle || typeof dirHandle.getFileHandle !== 'function') {
    throw new Error('opfsFs: expected a FileSystemDirectoryHandle');
  }

  /** Walk to the directory holding `parts`, optionally creating it. */
  const dirFor = async (parts, create) => {
    let dir = dirHandle;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  };

  return {
    async read(path) {
      const parts = splitPath(path);
      const name = parts.pop();
      if (name === undefined) return null;
      try {
        const dir = await dirFor(parts, false);
        const fh = await dir.getFileHandle(name, { create: false });
        const file = await fh.getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async write(path, data) {
      const parts = splitPath(path);
      const name = parts.pop();
      if (name === undefined) throw new Error('fs: cannot write the root');
      const dir = await dirFor(parts, true);
      const fh = await dir.getFileHandle(name, { create: true });
      // createWritable() truncates by default, which is the semantics fs-node.js has
      // (writeFile overwrites). Do not pass { keepExistingData: true }.
      const w = await fh.createWritable();
      try {
        await w.write(data);
      } finally {
        await w.close();
      }
    },
    async list(path) {
      try {
        const dir = await dirFor(splitPath(path), false);
        const names = [];
        for await (const name of dir.keys()) names.push(name);
        return names;
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
    async remove(path) {
      const parts = splitPath(path);
      const name = parts.pop();
      if (name === undefined) throw new Error('fs: cannot remove the root');
      try {
        const dir = await dirFor(parts, false);
        await dir.removeEntry(name, { recursive: true });
      } catch (err) {
        if (isMissing(err)) return;
        throw err;
      }
    },
    async mkdir(path) {
      await dirFor(splitPath(path), true);
    },
    /**
     * Deliberately a no-op: neither OPFS nor the File System Access API exposes POSIX
     * permission bits. Defined anyway so callers need no environment check — but note
     * for COMPROMISES.md: a private key stored through this adapter is protected by the
     * browser's origin isolation, NOT by a 0600 file mode. That is a real difference
     * from the node path and from Appendix IV's "private key into the OS keychain".
     * @param {string} path @param {number} _mode
     */
    async chmod(path, _mode) {
      // Fail loudly if the path does not exist, so the no-op cannot mask a typo.
      const parts = splitPath(path);
      const name = parts.pop();
      if (name === undefined) return;
      const dir = await dirFor(parts, false);
      try {
        await dir.getFileHandle(name, { create: false });
      } catch (err) {
        if (isMissing(err)) {
          await dir.getDirectoryHandle(name, { create: false });
          return;
        }
        throw err;
      }
    },
  };
}
