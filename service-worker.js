// service-worker.js — offline delivery of the runtime. A classic worker, no dependencies.
//
// It must sit next to index.html so that its scope is the app directory: registered as
// `./service-worker.js`, it controls `https://erp.somecompany.de/neodonkey/` just as well as
// `https://neodonkey.eu/`. There is not one absolute path in this file.
//
// THREE RULES THIS FILE FOLLOWS, and why:
//
//  1. It never calls skipWaiting() by itself. A new version waits until the user says yes
//     (`{type:'skip-waiting'}` from the page). Appendix I's promise is that the accountant can
//     run version 2 while the warehouse still runs version 1 and both exchange the same facts —
//     an update that installs itself while someone is booking a pallet contradicts that
//     directly. "Update equals file replacement" (Appendix II) must still be the *user's* act.
//
//  2. It never touches the user's data. The company lives in OPFS or in a folder the user
//     picked; neither is HTTP, so neither can pass through here. Requests this worker does not
//     recognise are left entirely alone — no respondWith, no opinion.
//
//  3. It caches by exact URL from an explicit list. No wildcard, no "cache everything you see".
//     A stale module silently served from a wildcard cache is the kind of failure that makes
//     people distrust an ERP forever.
//
// The two constants below are duplicated from runtime/ui/shell-files.js because a classic
// worker cannot import an ES module. test/g-ui.test.js asserts they are identical.

const VERSION = '0.1.0';
const CACHE_NAME = `neodonkey-shell-v${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'runtime/ui/style.css',
  'runtime/ui/icon.svg',
  'runtime/ui/icon-maskable.svg',
  'runtime/git/fs-opfs.js',
  'runtime/git/fs.js',
  'runtime/git/index-file.js',
  'runtime/git/objects.js',
  'runtime/git/pack-index.js',
  'runtime/git/pack.js',
  'runtime/git/repo.js',
  'runtime/git/sha1.js',
  'runtime/git/store.js',
  'runtime/git/zlib.js',
  'runtime/identity/cosign.js',
  'runtime/identity/ed25519.js',
  'runtime/identity/keystore.js',
  'runtime/identity/sshsig.js',
  'runtime/kernel.js',
  'runtime/crypto/envelope.js',
  'runtime/crypto/groups.js',
  'runtime/crypto/keys.js',
  'runtime/crypto/reader.js',
  'runtime/crypto/shred.js',
  'runtime/release/manifest.js',
  'runtime/release/pin.js',
  'runtime/live/crdt.js',
  'runtime/live/hlc.js',
  'runtime/live/session.js',
  'runtime/money/decimal.js',
  'runtime/money/money.js',
  'runtime/polism/execute.js',
  'runtime/polism/money.js',
  'runtime/polism/parse.js',
  'runtime/read/index.js',
  'runtime/read/query.js',
  'runtime/truth/sequence.js',
  'runtime/ui/app.js',
  'runtime/ui/boot.js',
  'runtime/ui/fields.js',
  'runtime/ui/forms.js',
  'runtime/ui/kernel-gaps.js',
  'runtime/ui/pwa.js',
  'runtime/ui/render.js',
  'runtime/ui/shell-files.js',
  'runtime/ui/starter-model.js',
  'runtime/ui/storage.js',
  'runtime/ui/viewmodel.js',
  'runtime/ui/views.js',
];

/** Absolute URLs of the shell, resolved against this worker's own location. */
const shellUrls = () => SHELL.map((p) => new URL(p, self.registration.scope).href);

// ---------------------------------------------------------------------------------------------
// RULE 4 — nothing enters the cache unverified.
//
// The origin that serves this code could change it. A signature is the only structural answer
// (docs/ARCHITECTURE.md D11, COMPROMISES #8/#15), and it is split across two places for a
// platform reason, not a design preference: a *classic* worker cannot import an ES module, so it
// cannot verify an Ed25519 signature. Therefore —
//
//   the page   verifies the signed manifest (it is a module, it has runtime/release/*.js)
//   the worker enforces a flat {url: sha256} table with crypto.subtle.digest
//
// The induction closes: after the first install, the page's own code is served from a cache this
// worker only ever filled with verified bytes.
// ---------------------------------------------------------------------------------------------

const TABLE_CACHE = 'neodonkey-release-table';
const relHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** undefined = not loaded yet; null = no table (an unsigned development build). */
let relTable;

async function releaseTable() {
  if (relTable !== undefined) return relTable;
  const res = await (await caches.open(TABLE_CACHE)).match('release-table');
  relTable = res ? await res.json() : null;
  return relTable;
}

/** Returns the response, or throws. A throw refuses the install — the safe state is stopped. */
async function checkRelease(url, res) {
  const table = await releaseTable();
  if (!table) return res; // not yet pinned — COMPROMISES #15, residual risk 4
  if (!table[url]) throw new Error(`release: unlisted file ${url}`);
  const digest = relHex(await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer()));
  if (digest !== table[url]) throw new Error(`release: hash mismatch ${url}`);
  return res;
}

// The operating model that ships next to the code. Repo content, not user data — safe and
// useful to cache, so a first run works offline too. Network first, so a `git pull` shows up.
const isRepoContent = (url) => url.pathname.includes('/operating-model/') && url.pathname.endsWith('.md');
const isFileIndex = (url) => url.pathname.endsWith('/_files') || url.pathname.endsWith('_files');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Individually, so one 404 names itself instead of failing the whole install silently.
    const failures = [];
    await Promise.all(shellUrls().map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await cache.put(url, await checkRelease(url, res));
      } catch (err) {
        failures.push(`${url}: ${err.message}`);
      }
    }));
    if (failures.length) {
      // Refuse the install rather than activate a half-cached shell that would break offline
      // in ways nobody could diagnose (Principle 6: the safe state is a stopped one).
      throw new Error(`shell precache incomplete:\n${failures.join('\n')}`);
    }
    // NOTE: no self.skipWaiting() here. Rule 1.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('neodonkey-shell-v') && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // The page asked for the waiting version to take over. This is the only path to skipWaiting.
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
  if (event.data?.type === 'version') {
    event.source?.postMessage({ type: 'version', version: VERSION, cache: CACHE_NAME });
  }

  // The page verified a signed manifest and is handing over the hash table.
  if (event.data?.type === 'release-table') {
    event.waitUntil((async () => {
      await (await caches.open(TABLE_CACHE)).put('release-table', new Response(
        JSON.stringify(event.data.table), { headers: { 'content-type': 'application/json' } }));
      relTable = event.data.table;

      // The very first install filled the cache before any table existed. Re-check it now, or
      // that install's bytes stay unverified forever — and "unverified once, trusted always"
      // would make the whole mechanism decorative.
      const cache = await caches.open(CACHE_NAME);
      for (const url of shellUrls()) {
        const hit = await cache.match(url);
        if (!hit) continue;
        try {
          await checkRelease(url, hit);
        } catch {
          await caches.delete(CACHE_NAME); // drop it all; the next load re-fetches under the table
          break;
        }
      }
    })());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never proxy anyone else's origin

  // A navigation (including a deep #/ link, and the standalone launch) must work offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(new URL('index.html', self.registration.scope).href);
      if (cached) return cached;
      try { return await fetch(req); } catch {
        return new Response('NeoDonkey is offline and the shell is not cached yet.',
          { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  const inShell = shellUrls().includes(url.href);
  if (inShell) {
    // Cache first: the shell is immutable for a given VERSION. On a miss we must still not hand
    // over bytes nobody checked — the `?? fetch(req)` fallback was the last unverified path in.
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url.href);
      if (cached) return cached;
      return await checkRelease(url.href, await fetch(req));
    })());
    return;
  }

  if (isRepoContent(url) || isFileIndex(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw new Error('offline and not cached');
      }
    })());
    return;
  }

  // Everything else: no opinion. Rule 2 — this is where the user's workspace would be, if it
  // ever came over HTTP, and it must pass through untouched.
});
