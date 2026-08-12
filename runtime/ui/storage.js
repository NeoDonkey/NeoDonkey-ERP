// runtime/ui/storage.js — where the company's folder lives, in a browser.
//
// Both options below are the same `FileSystemDirectoryHandle` interface, which is why
// runtime/git/fs-opfs.js covers both with one implementation:
//
//   • a real folder   — showDirectoryPicker(). This is Appendix X literally: afterwards
//                       `cd ~/sarah-erp && git log` works in her terminal. Preferred whenever
//                       the browser has it.
//   • OPFS            — navigator.storage.getDirectory(). Invisible, always there, nothing to
//                       open in a terminal. The fallback.
//
// MEASURED, not assumed (see docs/_compromise-ui.md):
//   * `typeof navigator.storage.getDirectory === 'function'` is TRUE on file:// in Chrome and
//     calling it still throws SecurityError. So capability detection here *performs a real
//     round-trip* rather than trusting a typeof check.
//   * `showDirectoryPicker` is undefined in Safari 26 entirely — on every scheme. The real-folder
//     promise is Chromium-only today, and no amount of our code changes that.

import { opfsFs } from '../git/fs-opfs.js';

const IDB_NAME = 'neodonkey-workspace';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'workspace';

/**
 * What this browser can actually do — established by trying, not by feature-sniffing.
 * @returns {Promise<{protocol: string, secureContext: boolean, opfs: boolean,
 *                    opfsError: string|null, picker: boolean, indexedDB: boolean,
 *                    modulesLoaded: true}>}
 */
export async function capabilities() {
  const out = {
    protocol: location.protocol,
    secureContext: Boolean(globalThis.isSecureContext),
    opfs: false,
    opfsError: null,
    picker: typeof globalThis.showDirectoryPicker === 'function',
    indexedDB: typeof globalThis.indexedDB === 'object' && globalThis.indexedDB !== null,
    // If this code is running at all, the module graph loaded. Worth stating, because it is
    // exactly what fails on file://.
    modulesLoaded: true,
  };
  try {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle('.neodonkey-probe', { create: true });
    const w = await fh.createWritable();
    await w.write(new Uint8Array([1]));
    await w.close();
    await root.removeEntry('.neodonkey-probe');
    out.opfs = true;
  } catch (err) {
    out.opfsError = `${err.name}: ${err.message}`;
  }
  return out;
}

/** OPFS root as an FsAdapter. */
export async function openOpfs() {
  const dir = await navigator.storage.getDirectory();
  return { fs: opfsFs(dir), handle: dir, kind: 'opfs', label: null };
}

/**
 * Ask for a real folder. MUST be called from a user gesture (a click) — the browser refuses
 * otherwise, and the error it gives is a SecurityError that mentions the gesture.
 */
export async function openFolder() {
  if (typeof globalThis.showDirectoryPicker !== 'function') {
    throw new Error('this browser has no directory picker');
  }
  const dir = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'neodonkey' });
  await requirePermission(dir);
  await rememberHandle(dir);
  return { fs: opfsFs(dir), handle: dir, kind: 'folder', label: dir.name };
}

/** Reopen the folder chosen last time, if the grant is still live. */
export async function restoreFolder({ prompt = false } = {}) {
  const dir = await recallHandle();
  if (!dir) return null;
  const state = await dir.queryPermission?.({ mode: 'readwrite' });
  if (state !== 'granted') {
    if (!prompt) return { needsPermission: true, handle: dir, label: dir.name, kind: 'folder' };
    const asked = await dir.requestPermission?.({ mode: 'readwrite' });
    if (asked !== 'granted') return { needsPermission: true, handle: dir, label: dir.name, kind: 'folder' };
  }
  return { fs: opfsFs(dir), handle: dir, kind: 'folder', label: dir.name };
}

async function requirePermission(dir) {
  const state = await dir.queryPermission?.({ mode: 'readwrite' });
  if (state === 'granted') return;
  const asked = await dir.requestPermission?.({ mode: 'readwrite' });
  if (asked && asked !== 'granted') throw new Error('permission to write to that folder was not granted');
}

// --- persisting the handle. A FileSystemDirectoryHandle survives structured clone, which is
// --- the only reason a chosen folder can be remembered across reloads at all.

function idb() {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('workspace store blocked'));
  });
}

export async function rememberHandle(handle) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const t = db.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }).finally(() => db.close());
}

export async function recallHandle() {
  if (!globalThis.indexedDB) return null;
  const db = await idb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(IDB_STORE, 'readonly');
      const q = t.objectStore(IDB_STORE).get(HANDLE_KEY);
      t.oncomplete = () => resolve(q.result ?? null);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export async function forgetHandle() {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const t = db.transaction(IDB_STORE, 'readwrite');
    t.objectStore(IDB_STORE).delete(HANDLE_KEY);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  }).finally(() => db.close());
}

/**
 * The operating model that ships next to this code, as a seed for a fresh workspace.
 *
 * HTTP has no directory listing, so `serve.mjs` provides one at `/_files`. If that endpoint is
 * absent (a plain static host), we say so instead of silently seeding something else — a
 * workspace opened on the wrong operating model would be a silent wrong system.
 *
 * @returns {Promise<{files: Map<string,string>, source: 'repo'|'none', error: string|null}>}
 */
export async function loadRepoOperatingModel() {
  let listing;
  try {
    const res = await fetch('_files?under=operating-model', { cache: 'no-store' });
    if (!res.ok) throw new Error(`the file index returned ${res.status}`);
    listing = await res.json();
  } catch (err) {
    return { files: new Map(), source: 'none', error: `${err.message}` };
  }
  const files = new Map();
  for (const path of listing.files ?? []) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return { files: new Map(), source: 'none', error: `${path} returned ${res.status}` };
    files.set(path, await res.text());
  }
  return { files, source: files.size ? 'repo' : 'none', error: null };
}
