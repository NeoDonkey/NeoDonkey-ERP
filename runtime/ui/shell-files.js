// runtime/ui/shell-files.js — what "the runtime" consists of, as data.
//
// Two things need this list and must never disagree about it:
//   • service-worker.js, to precache the shell so the app works offline / air-gapped
//     (Appendix II line 92: "the repo fits on a USB stick … an auditor takes the whole system
//     offline");
//   • runtime/ui/pwa.js, to hash every file so a user can check that the code they are running
//     is the code in the repository.
//
// The service worker is a *classic* script (module service workers are still uneven across
// engines and I cannot test them here), so it cannot import this file and carries its own copy.
// That duplication is guarded by a test: test/g-ui.test.js parses the list out of
// service-worker.js, asserts it is byte-identical to the one below, asserts every entry exists
// on disk, and asserts the list equals the real ES module graph reachable from boot.js. A
// precache list that silently drifts would produce an app that half-works offline, which is
// worse than one that does not work at all.
//
// EVERY PATH IS RELATIVE. Not one leading slash, anywhere in the PWA. That is what lets this
// run unchanged from https://neodonkey.eu/, from https://erp.somecompany.de/neodonkey/ and from
// http://localhost:8080/ — see docs/_compromise-ui.md on why origin-independence is the whole
// argument that neodonkey.eu is a convenience and not an authority.

/** Must match `version` in package.json. Asserted by test/g-ui.test.js. */
export const VERSION = '0.1.0';

/** The cache name. Changing VERSION is what makes a new shell install. */
export const CACHE_NAME = `neodonkey-shell-v${VERSION}`;

/**
 * The app shell: everything needed to start with no network at all.
 * Relative to the directory index.html lives in.
 */
export const SHELL = [
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

/** The executable part — what "verify this runtime" hashes. `./` and `.css` are not code. */
export const CODE = SHELL.filter((p) => p.endsWith('.js'));
