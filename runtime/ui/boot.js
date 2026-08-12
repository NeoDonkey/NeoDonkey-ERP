// runtime/ui/boot.js — the entry point. index.html loads this and nothing else.
//
// Appendix X, day 1, is the entire specification for what happens here:
//
//   "She double-clicks the HTML, her browser opens NeoDonkey. On first launch it asks her name
//    — she types Sarah Weber. In the background, the client generates an Ed25519 key pair …
//    She is now Sarah Weber in the NeoDonkey universe."
//
// So: one text field. No account, no email, no password, no verification, no confirmation
// screen. The only thing this file adds to that story is a choice of where the folder lives,
// because a browser cannot pick a folder without being asked (see docs/_compromise-ui.md).

import { open } from '../kernel.js';
import { generateIdentity, exportPublicSsh } from '../identity/ed25519.js';
import { keystore } from '../identity/keystore.js';
import { h, replace, frag } from './render.js';
import { createApp } from './app.js';
import { starterModel, STARTER_NOTE } from './starter-model.js';
import {
  capabilities, loadRepoOperatingModel, openFolder, openOpfs, restoreFolder, forgetHandle,
} from './storage.js';
import { registerRuntime, requestPersistence, VERSION } from './pwa.js';
import { gateRelease, pinKey, recordInstalledRelease } from '../release/pin.js';

const KEY_NAME = 'identity';

// Guarded so that this module can be *imported* outside a browser without running or throwing —
// which is how test/g-ui.test.js proves the whole module graph is free of top-level side
// effects. In a browser both are true and the app starts exactly as before.
const root = typeof document === 'undefined' ? null : document.getElementById('app');

/** Filled in by registerRuntime(); the app is handed it and shows it under "This runtime". */
let worker = { supported: false, status: 'pending' };
let persistence = null;
let app = null;
/** What the release gate concluded, shown to the user under "This runtime". */
let release = { mode: 'unchecked', version: null, fingerprint: null };
let releaseStore = null;

if (root) {
  /** Tells the inline fallback in index.html that we started, so it stays quiet. */
  globalThis.__NEODONKEY_BOOTED = VERSION;
  main().catch(fatal);
}

async function main() {
  // Register the offline runtime first and in parallel — it must never delay or block the app,
  // and a failure here only costs offline support.
  const registering = registerRuntime({
    onUpdateWaiting: ({ registration }) => {
      // Never installed automatically. The user is asked, by the banner in app.js.
      worker = { ...worker, registration };
      app?.updateAvailable(registration);
    },
  }).then((result) => { worker = result; return result; })
    .catch((err) => { worker = { supported: true, status: 'failed', error: String(err) }; });

  const caps = await capabilities();
  await registering;

  // Before anything else runs: is the code on this page the code that was published?
  // A refusal here stops the boot. See docs/ARCHITECTURE.md D11.
  if (!await releaseGate()) return;

  if (!caps.indexedDB) {
    return fatal(new Error('This browser has no IndexedDB, so there is nowhere to keep your '
      + 'signing key. Private browsing mode is the usual cause.'));
  }
  if (!caps.opfs && !caps.picker) {
    return fatal(new Error('This browser offers neither a directory picker nor a usable private '
      + `file system, so there is nowhere to put the repository. ${caps.opfsError ?? ''}`));
  }

  const store = keystore('browser');
  const existing = await store.load(KEY_NAME).catch(() => null);
  if (existing) return resume(existing, caps, store);
  return firstRun(caps, store);
}

// ---------------------------------------------------------------------------------------------
// the release gate — "is this the code that was published?"
// ---------------------------------------------------------------------------------------------

/**
 * Verifies the signed release manifest, pins its key on first use, and hands the worker a hash
 * table to enforce. Returns false when the boot must stop.
 *
 * The whole point of this function is that a compromised — or legally compelled — origin cannot
 * push code to an existing installation. Once a key is pinned, a manifest signed by any other key
 * is refused, and there is no code path that overwrites a pin without a fingerprint the user
 * supplied. That is what makes Principle 9 structural rather than a promise from us.
 */
async function releaseGate() {
  let gate;
  try {
    const text = await fetch(new URL('release.json', document.baseURI), { cache: 'reload' })
      .then((r) => (r.ok ? r.text() : null)).catch(() => null);
    gate = await gateRelease(browserStore(), text);
  } catch (err) {
    // A gate that cannot run must not silently become an open door.
    return refuse('The runtime could not be verified', describe(err)), false;
  }

  if (gate.mode === 'refused') {
    return refuse('This copy of NeoDonkey was not signed by the key you trust', gate.reason), false;
  }

  if (gate.mode === 'first-use') {
    const accepted = await confirmFingerprint(gate);
    if (!accepted) return false;
    await pinKey(browserStore(), gate.key, { at: Date.now(), origin: location.origin });
    await recordInstalledRelease(browserStore(), { manifestText: gate.manifestText, at: Date.now() });
  }

  if (gate.files) {
    const base = new URL('./', document.baseURI).href;
    const table = Object.fromEntries([...gate.files.values()]
      .map((f) => [new URL(f.path, document.baseURI).href, f.sha256]));
    table[base] = table[new URL('index.html', document.baseURI).href];
    navigator.serviceWorker?.controller?.postMessage({ type: 'release-table', table });
  }

  release = { mode: gate.mode, version: gate.version ?? null, fingerprint: gate.fingerprint ?? null };
  return true;
}

/**
 * Trust on first use, made into a decision instead of a shrug. No cryptography can protect the
 * first install (COMPROMISES #15) — only a fingerprint published where the origin cannot reach
 * it. So we show the fingerprint and ask, rather than pinning silently and calling it security.
 */
function confirmFingerprint(gate) {
  return new Promise((resolve) => {
    replace(root, h.section({ class: 'onboard' },
      h.h1({ text: 'Check the software before you trust it' }),
      h.p({ class: 'lead' }, 'This is NeoDonkey ', h.strong({ text: gate.version ?? '—' }),
        '. It was signed with the key below, and from now on this installation will refuse any '
        + 'update that is not signed by the same key — including from us.'),
      h.dl({ class: 'fields' },
        capRow('Version', gate.version ?? 'unknown'),
        capRow('Signing key fingerprint', gate.fingerprint ?? 'unknown'),
        capRow('Served from', location.origin)),
      h.p({ class: 'muted' }, 'Compare that fingerprint against the one published in the '
        + 'repository, in the release notes, and on paper. If it matches, the code here is the '
        + 'code that was published. If it does not, stop.'),
      h.div({ class: 'onboard-actions' },
        h.button({ class: 'primary', type: 'button', text: 'The fingerprint matches — continue',
          on: { click: () => resolve(true) } }),
        h.button({ class: 'ghost', type: 'button', text: 'Stop',
          on: { click: () => { refuse('Stopped', 'You did not accept this signing key.'); resolve(false); } } }))));
  });
}

function refuse(title, detail) {
  replace(root, h.section({ class: 'onboard' },
    h.h1({ text: title }),
    h.p({ class: 'lead', text: String(detail ?? '') }),
    h.p({ class: 'muted' }, 'Nothing was opened and nothing was changed. This is the system '
      + 'refusing to run code it cannot vouch for, which is the safe state.')));
}

/** The tiny async key-value store pin.js expects, over IndexedDB. */
function browserStore() {
  if (releaseStore) return releaseStore;
  const DB = 'neodonkey-release';
  const withStore = (mode, fn) => new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', mode);
      const out = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { req.result.close(); resolve(out.result ?? null); };
      tx.onerror = () => { req.result.close(); reject(tx.error); };
    };
  });
  releaseStore = {
    get: (k) => withStore('readonly', (s) => s.get(k)),
    set: (k, v) => withStore('readwrite', (s) => s.put(v, k)),
  };
  return releaseStore;
}

// ---------------------------------------------------------------------------------------------
// first run — one question
// ---------------------------------------------------------------------------------------------

function firstRun(caps, store) {
  const name = h.input({
    type: 'text', id: 'your-name', autocomplete: 'name', autofocus: true,
    placeholder: 'Sarah Weber', spellcheck: 'false',
  });
  const problem = h.div({ class: 'onboard-problem' });
  const busy = (on, label) => {
    for (const b of card.querySelectorAll('button')) b.disabled = on;
    if (on) replace(problem, h.small({ class: 'muted', text: label }));
    else replace(problem);
  };

  const start = async (chooseFolder) => {
    const typed = name.value.trim();
    if (typed === '') {
      replace(problem, h.small({ class: 'form-problem', text: 'Please type your name first.' }));
      name.focus();
      return;
    }
    busy(true, chooseFolder ? 'Waiting for you to choose a folder…' : 'Creating your workspace…');
    try {
      // The picker must be called from the click, so it goes first.
      const workspace = chooseFolder ? await openFolder() : await openOpfs();
      // Ask now, while a user gesture is in hand: browsers weigh a gesture when deciding whether
      // to grant persistence, and an ERP whose storage can be evicted is not one.
      persistence = await requestPersistence();
      busy(true, 'Generating your key pair…');
      const email = localIdentifier(typed);
      // extractable:false — the private scalar never exists as bytes in JS (COMPROMISES #2).
      const keyPair = await generateIdentity({ extractable: false, comment: `${typed} <${email}>` });
      await store.save(KEY_NAME, keyPair);
      await launch({ name: typed, email, keyPair }, workspace, caps);
    } catch (err) {
      busy(false);
      replace(problem, h.small({ class: 'form-problem', text: describe(err) }));
    }
  };

  const card = h.section({ class: 'onboard' },
    h.h1({ text: 'Welcome to NeoDonkey' }),
    h.p({ class: 'lead', text: 'This is an ERP that belongs to you. There is no account to '
      + 'create, no email to verify and no password to choose — because there is no server to '
      + 'log in to. Your company will be a folder, on your machine.' }),
    h.form({ on: { submit: (e) => { e.preventDefault(); start(caps.picker); } } },
      h.label({ for: 'your-name' }, h.span({ class: 'form-label', text: 'What is your name?' })),
      name,
      h.small({ class: 'muted', text: 'It goes into a key pair that signs everything you do, '
        + 'and into your commits. It never leaves this machine.' }),
      h.div({ class: 'onboard-actions' },
        caps.picker
          ? h.button({ type: 'button', class: 'primary', text: 'Choose a folder and start',
            on: { click: () => start(true) } })
          : null,
        h.button({
          type: 'button', class: caps.picker ? 'ghost' : 'primary',
          text: caps.picker ? 'Use browser storage instead' : 'Start',
          disabled: !caps.opfs,
          title: caps.opfs ? null : `this browser refuses private storage here: ${caps.opfsError}`,
          on: { click: () => start(false) },
        })),
      problem),
    storageExplanation(caps));

  replace(root, card);
  name.focus();
}

/** The honest version of "where do you want your company to live". */
function storageExplanation(caps) {
  return h.div({ class: 'onboard-note' },
    caps.picker
      ? frag(
        h.h2({ text: 'A folder, or browser storage?' }),
        h.p({}, h.strong({ text: 'A folder' }), ' is the real thing: afterwards you can open a '
          + 'terminal in it and run ', h.code({ class: 'mono', text: 'git log' }),
        '. Your company is a git repository you own, and this software is just something that '
        + 'reads and writes it.'),
        h.p({}, h.strong({ text: 'Browser storage' }), ' works everywhere and needs no '
          + 'permission, but it is private to this browser — there is no folder to open, and '
          + 'clearing site data deletes the company.'))
      : frag(
        h.h2({ text: 'About storage in this browser' }),
        h.p({ text: 'This browser has no directory picker, so the repository has to live in the '
          + 'browser’s private file system. It works, but there is no folder you can open in a '
          + 'terminal — which is a real part of the promise this browser cannot keep. Chrome or '
          + 'Edge can.' })),
    h.details({},
      h.summary({ text: 'What this browser can do' }),
      h.dl({ class: 'fields' },
        capRow('Page origin', caps.protocol),
        capRow('Secure context', caps.secureContext ? 'yes' : 'no'),
        capRow('ES modules loaded', 'yes — you are reading a page that proves it'),
        capRow('Private file system (OPFS)', caps.opfs ? 'yes' : `no — ${caps.opfsError}`),
        capRow('Directory picker', caps.picker ? 'yes' : 'not implemented by this browser'))));
}

const capRow = (label, value) => frag(h.dt({ text: label }), h.dd({ class: 'mono', text: String(value) }));

// ---------------------------------------------------------------------------------------------
// returning user
// ---------------------------------------------------------------------------------------------

async function resume(keyPair, caps, store) {
  const { name, email } = parseComment(keyPair.comment);
  const saved = await restoreFolder().catch(() => null);

  if (saved?.needsPermission) {
    // A folder grant does not survive a restart. That is the browser being careful, and it
    // needs a click — so we ask for one rather than silently falling back to OPFS, which
    // would open a *different, empty* company and look like data loss.
    const problem = h.div({ class: 'onboard-problem' });
    const attempt = async (button, getWorkspace) => {
      button.disabled = true;
      replace(problem, h.small({ class: 'muted', text: 'Waiting for the browser…' }));
      try {
        const ws = await getWorkspace();
        if (!ws || ws.needsPermission) throw new Error('permission was not granted');
        await launch({ name, email, keyPair }, ws, caps);
      } catch (err) {
        button.disabled = false;
        replace(problem, h.small({ class: 'form-problem', text: describe(err) }));
      }
    };

    return replace(root, h.section({ class: 'onboard' },
      h.h1({ text: `Welcome back, ${name}.` }),
      h.p({ class: 'lead' }, 'Your company lives in the folder ',
        h.code({ class: 'mono', text: saved.label }),
        '. The browser needs your permission again before this page may read it.'),
      h.div({ class: 'onboard-actions' },
        h.button({
          class: 'primary', type: 'button', text: `Reconnect to ${saved.label}`,
          on: { click: (e) => attempt(e.target, () => restoreFolder({ prompt: true })) },
        }),
        h.button({
          class: 'ghost', type: 'button', text: 'Choose a different folder',
          on: { click: (e) => attempt(e.target, () => openFolder()) },
        }),
        h.button({
          class: 'ghost', type: 'button', text: 'Forget that folder',
          on: { click: async () => { await forgetHandle(); location.reload(); } },
        })),
      problem));
  }

  if (saved?.fs) return launch({ name, email, keyPair }, saved, caps);
  if (caps.opfs) return launch({ name, email, keyPair }, await openOpfs(), caps);
  return fatal(new Error('Your key is here, but there is no readable workspace to open it on.'));
}

// ---------------------------------------------------------------------------------------------
// open the kernel and hand over to the app
// ---------------------------------------------------------------------------------------------

async function launch(identity, workspace, caps) {
  replace(root, h.section({ class: 'onboard' }, h.h1({ text: 'Opening your company…' }),
    h.p({ class: 'muted', text: 'Reading the operating model and rebuilding the index.' })));

  // The operating model in the repo wins. Only when there is none do we seed the starter,
  // because opening on the wrong description would be a silently wrong system.
  const repo = await loadRepoOperatingModel();
  const usingStarter = repo.source !== 'repo';
  const seed = usingStarter ? starterModel() : repo.files;

  const kernel = await open({
    fs: workspace.fs,
    identity,
    seed,
    // A browser has a real clock; determinism is the *core's* requirement, not the shell's,
    // and the kernel injects it precisely so that tests can replace it.
    clock: () => Date.now(),
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  });

  const publicSsh = await exportPublicSsh(identity.keyPair, identity.email).catch(() => null);

  // A returning user never went through onboarding, so the answer is not known yet. Read it
  // without asking again (persisted() does not prompt).
  if (!persistence) persistence = await requestPersistence().catch(() => null);

  app = createApp({
    kernel,
    root,
    capabilities: caps,
    workspace: { kind: workspace.kind, label: workspace.label },
    publicSsh,
    worker,
    persistence,
    release,
    starterNote: usingStarter
      ? `${STARTER_NOTE}${repo.error ? ` (the repository's own operating-model/ could not be read: ${repo.error})` : ''}`
      : null,
  });

  // If a new version was already waiting before the app existed, tell it now.
  if (worker?.registration?.waiting) app.updateAvailable(worker.registration);
}

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

/**
 * The kernel's `Identity` requires an email, but Appendix X's onboarding asks only for a name.
 * We derive a local identifier rather than inventing a question the manifesto does not ask.
 * It is what appears in `git log` as the author address, and it is deliberately not a
 * deliverable address — nothing in this system sends mail.
 */
export function localIdentifier(name) {
  const slug = String(name).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining marks: Müller -> muller
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'peer'}@local`;
}

/** `keystore` keeps the comment, so the name survives a reload without a second store. */
export function parseComment(comment) {
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(String(comment ?? ''));
  if (m) return { name: m[1], email: m[2] };
  const name = String(comment ?? '').trim() || 'Peer';
  return { name, email: localIdentifier(name) };
}

function describe(err) {
  if (err?.name === 'AbortError') return 'No folder was chosen.';
  if (err?.name === 'NotAllowedError') return 'The browser did not grant access to that folder.';
  if (err?.name === 'SecurityError') return `The browser refused: ${err.message}`;
  return err?.message ? String(err.message) : String(err);
}

function fatal(err) {
  const detail = describe(err);
  replace(root, h.section({ class: 'onboard' },
    h.h1({ text: 'NeoDonkey cannot start here' }),
    h.p({ class: 'lead', text: detail }),
    h.p({ class: 'muted' }, 'If you opened this file directly from disk, that is the cause — see ',
      h.code({ class: 'mono', text: 'node serve.mjs' }), ' in the README.')));
  globalThis.console?.error?.(err);
}
