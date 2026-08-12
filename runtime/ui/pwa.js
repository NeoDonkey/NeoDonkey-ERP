// runtime/ui/pwa.js — the runtime as an installable app, and as something you can check.
//
// Three jobs, all of them consequences of shipping from an origin rather than a folder:
//
//  1. Register the service worker so the app runs offline and air-gapped, and detect a new
//     version WITHOUT installing it. The user decides when to update (Appendix I: the
//     accountant on v2 and the warehouse on v1 must be able to coexist).
//  2. Ask for persistent storage, and report the answer honestly. Safari evicts storage from
//     apps it considers unused; for an ERP that is data loss, so it is not something to
//     discover later.
//  3. Hash every runtime file the browser loaded, so "the code is auditable" is a thing the
//     user can check rather than a thing we assert.
//
// Everything resolves relative to `document.baseURI`. Not one absolute path — the app must work
// identically at https://neodonkey.eu/, at https://erp.somecompany.de/neodonkey/ and at
// http://localhost:8080/.

import { CODE, SHELL, VERSION, CACHE_NAME } from './shell-files.js';

export { VERSION };

/** Resolve a shell-relative path against the page, wherever the page happens to live. */
export const appUrl = (path) => new URL(path, document.baseURI).href;

/**
 * Register the service worker and watch for a waiting version. Never installs it.
 *
 * @param {{ onUpdateWaiting?: (info: {registration: ServiceWorkerRegistration}) => void }} handlers
 * @returns {Promise<{supported: boolean, status: string, registration: object|null, error: string|null}>}
 */
export async function registerRuntime({ onUpdateWaiting = null } = {}) {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, status: 'unsupported', registration: null, error: null,
      note: 'This browser cannot cache the runtime, so NeoDonkey needs the network to start.' };
  }
  if (!globalThis.isSecureContext) {
    return { supported: false, status: 'insecure-context', registration: null, error: null,
      note: 'Service workers need a secure context (https, or http on localhost).' };
  }
  try {
    // './service-worker.js' — relative, so the scope is this app's directory and a
    // subdirectory install works with no configuration.
    const registration = await navigator.serviceWorker.register(appUrl('service-worker.js'), {
      scope: appUrl('./'),
      updateViaCache: 'none',
    });

    const announce = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        onUpdateWaiting?.({ registration });
      }
    };
    announce();
    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing;
      incoming?.addEventListener('statechange', () => {
        if (incoming.state === 'installed') announce();
      });
    });

    return {
      supported: true,
      registration,
      status: navigator.serviceWorker.controller ? 'controlling'
        : registration.active ? 'active' : 'installing',
      error: null,
    };
  } catch (err) {
    // A failed registration must not stop the app — it only means no offline.
    return { supported: true, status: 'failed', registration: null, error: `${err.name}: ${err.message}` };
  }
}

/**
 * Install the waiting version, because the user asked. The page reloads once the new worker
 * takes control, so the running code and the cached code can never disagree.
 */
export function applyUpdate(registration) {
  if (!registration?.waiting) { location.reload(); return; }
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
  registration.waiting.postMessage({ type: 'skip-waiting' });
}

/** Ask the browser to check for a new version now. Used by the "This runtime" view. */
export async function checkForUpdate(registration) {
  if (!registration) return { checked: false, waiting: false };
  await registration.update();
  return { checked: true, waiting: Boolean(registration.waiting) };
}

/**
 * Persistent storage. Without it, a browser may evict the workspace — and OPFS *is* the
 * workspace when the user did not pick a folder.
 * @returns {Promise<{supported: boolean, persisted: boolean, asked: boolean, estimate: object|null}>}
 */
export async function requestPersistence() {
  const out = { supported: false, persisted: false, asked: false, estimate: null };
  if (!navigator.storage?.persist) return out;
  out.supported = true;
  try {
    out.persisted = await navigator.storage.persisted();
    if (!out.persisted) {
      out.asked = true;
      out.persisted = await navigator.storage.persist();
    }
    if (navigator.storage.estimate) out.estimate = await navigator.storage.estimate();
  } catch (err) {
    out.error = `${err.name}: ${err.message}`;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// "verify this runtime" — the hashes
// ---------------------------------------------------------------------------------------------

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Hash every executable file of the runtime, as the browser actually received it.
 *
 * This is deliberately over the *served* bytes, not over anything we hold in memory: it is the
 * one check that catches an origin (or a proxy, or a CDN) modifying the code in flight. It is
 * also why the combined hash is defined so that `shasum` can reproduce it exactly — a number
 * only we can compute would prove nothing.
 *
 * combined = SHA-256 over the concatenation of `"<sha256>  <path>\n"` for every file in CODE
 * order, which is byte-for-byte what `shasum -a 256 <files…>` prints.
 *
 * @returns {Promise<{version: string, files: Array, combined: string, failed: Array,
 *                    command: string[]}>}
 */
export async function hashRuntime() {
  const files = [];
  const failed = [];
  let manifestText = '';

  for (const path of CODE) {
    try {
      const res = await fetch(appUrl(path), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const digest = hex(await sha256(bytes));
      files.push({ path, sha256: digest, bytes: bytes.length });
      manifestText += `${digest}  ${path}\n`;
    } catch (err) {
      failed.push({ path, reason: `${err.name}: ${err.message}` });
    }
  }

  const combined = failed.length
    ? null
    : hex(await sha256(new TextEncoder().encode(manifestText)));

  return {
    version: VERSION,
    cache: CACHE_NAME,
    files,
    failed,
    combined,
    totalBytes: files.reduce((n, f) => n + f.bytes, 0),
    // Runnable, zero-dependency, and it reads the file list out of the runtime itself so it
    // cannot drift from what was hashed above.
    command: [
      '# in the repository root — reproduces the combined hash above',
      'node -e "import(\'./runtime/ui/shell-files.js\').then(m=>console.log(m.CODE.join(String.fromCharCode(10))))" \\',
      '  | xargs shasum -a 256 | shasum -a 256',
      '',
      '# or check any single file',
      'shasum -a 256 runtime/kernel.js',
    ],
  };
}

/** Where the runtime is being served from — the thing a user should look at first. */
export function origin() {
  return {
    origin: location.origin,
    base: document.baseURI,
    protocol: location.protocol,
    secureContext: Boolean(globalThis.isSecureContext),
    standalone: matchMedia?.('(display-mode: standalone)')?.matches === true,
    shellFiles: SHELL.length,
  };
}
