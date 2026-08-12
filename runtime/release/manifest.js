// runtime/release/manifest.js — the signed runtime. Trust signatures, not transport.
//
// WHY THIS FILE EXISTS (decision D11, Principle 9)
//
// We ship as a PWA, so an *origin* hands executable code to a machine that holds the user's
// Ed25519 signing key and their company's books. If that origin can silently swap the code, the
// data is local but the executable is rented — which is precisely the structure Principle 9
// exists to abolish, only with better rhetoric. "We promise not to push bad code" is a contract;
// Principle 9 demands that sovereignty be structural.
//
// The move is the one we already made for data: a release is a *signed manifest* over the hash of
// every file, and the runtime refuses to execute anything that is not in it. The origin becomes a
// dumb pipe. Compromise it, compel it, MITM it — it still cannot produce bytes that verify.
//
// SCOPE OF THIS FILE
//   • canonical serialisation of a manifest (the bytes a signature covers),
//   • verification of a manifest against an *expected* public key,
//   • verification of individual files, and of a whole file set, against a verified manifest.
// It never fetches, never stores, never installs, never decides to upgrade. Key trust lives in
// `pin.js`; the decision to install a new version belongs to the user (Appendix I).
//
// DEPENDENCY DISCIPLINE — this is a verifier, so its trusted computing base must be tiny.
// It imports only `identity/ed25519.js` and `identity/sshsig.js`, because SSHSIG is unavoidable.
// It deliberately does NOT import the git layer for `hex()` (a five-line function is duplicated
// below instead): the release check runs *before* any of the code it is checking is trusted, and
// every extra edge here is another file that has to be correct before verification can be
// believed. The TCB is: ed25519.js, sshsig.js, this file, pin.js, and the loader (index.html +
// service-worker.js). Nothing else.
//
// No `node:*`. Browser-loadable as-is, which is the whole point: a Service Worker runs this.

import { b64encode, bytesEqual, parsePublicSsh, utf8 } from '../identity/ed25519.js';
import { inspectSignature, verifyPayload } from '../identity/sshsig.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {{ path: string, sha256: string, bytes: number }} FileEntry */
/** @typedef {{ schema: number, product: string, version: string, key: string,
 *              files: FileEntry[], signature?: string }} Manifest */

/** The only manifest schema v0.1 understands. An unknown one is refused, never guessed at
 *  (Principle 6: a v0.2 construction is rejected loudly, not interpreted optimistically). */
export const MANIFEST_SCHEMA = 1;

/** Signed manifests only ever describe this product. Blocks cross-product signature replay. */
export const PRODUCT = 'neodonkey';

/**
 * SSHSIG namespace for release manifests. NOT 'git'.
 *
 * The namespace is inside the bytes Ed25519 actually signs
 * (`"SSHSIG" || string(namespace) || string("") || string(hash) || string(H(payload))`), so a
 * signature is only ever valid *for the namespace it was made under*. Two directions matter:
 *
 *   • A commit signature must not be usable as a release signature. Anyone who can get a
 *     signature out of the release key over attacker-chosen bytes — or who can commit through a
 *     shared/CI key — could otherwise craft a commit whose payload happens to be a canonical
 *     manifest and re-armor the resulting `gpgsig` into release.json. With separate namespaces
 *     that signature simply does not verify.
 *   • A release signature must not be usable as a commit signature. Signing a release must not
 *     grant the ability to forge a line of company history — the audit trail (Appendix IX) is
 *     the regulatory argument, and it must not be collateral of the build process.
 *
 * `canonicalBytes()` adds a second, independent layer: every signed byte string starts with a
 * domain tag line, so a canonical manifest can never *be* a git commit object (those start with
 * `tree `) even if the namespace check were ever weakened.
 */
export const RELEASE_NAMESPACE = 'neodonkey-release';

/** Third namespace, for key-rotation statements (see pin.js). Same reasoning, one step further:
 *  a rotation statement must not be replayable as a manifest, or a signer could be tricked into
 *  handing over the pin. */
export const ROTATION_NAMESPACE = 'neodonkey-release-rotation';

const MANIFEST_TAG = 'neodonkey-release-manifest';
const HEX = '0123456789abcdef';

// ---------------------------------------------------------------------------------------------
// failure: one reason code per defect, so a caller can tell *which* thing was wrong
// ---------------------------------------------------------------------------------------------

/** Every rejection carries a stable machine-readable `reason`. UIs show it, tests assert it. */
export class ManifestError extends Error {
  /** @param {string} reason */
  constructor(reason) { super(`release: ${reason}`); this.name = 'ManifestError'; this.reason = reason; }
}
const fail = (reason) => { throw new ManifestError(reason); };

// ---------------------------------------------------------------------------------------------
// canonical serialisation — the bytes the signature covers
// ---------------------------------------------------------------------------------------------
//
// A signature covers bytes, so the manifest must serialise identically every time, from any
// equivalent input, on any engine, forever. `JSON.stringify` is not that: its output follows
// property *insertion* order, so the same manifest re-parsed from differently-ordered JSON, or
// rebuilt by a future version of our own tool, can produce different bytes and a signature that
// mysteriously stops verifying. So we define our own form, and it is deliberately narrow:
//
//   1. Object keys are emitted in ascending code-unit order. Reordering the input JSON therefore
//      cannot change one signed byte. Keys must match /^[a-z][a-z0-9]*$/ — all ASCII, so
//      code-unit order and byte order are the same thing and no locale can ever be involved.
//   2. The `files` array is sorted by path (byte order on ASCII), and duplicate paths are
//      refused, so array order carries no meaning either.
//   3. Numbers are non-negative safe integers only, printed as plain decimal. No floats, no
//      exponents, no -0, no NaN — the three classic "same value, different bytes" traps.
//   4. Strings are restricted to printable ASCII (0x20-0x7E) and escaped with exactly two rules
//      (`\` and `"`). That kills the entire class of Unicode serialisation ambiguity (lone
//      surrogates, \u vs literal, normalisation forms) *and* it means nothing a manifest can put
//      on screen — a version, a path, a key comment — can contain a bidi override, a zero-width
//      character or a control code. A fingerprint a user is asked to compare cannot be dressed up.
//   5. There is no whitespace, and the byte string is exactly: tag, LF, JSON, LF. One trailing
//      newline, never zero, never two, and no CR anywhere — so a file that has been through a
//      Windows checkout, an editor or a copy-paste either is byte-identical or is refused.
//   6. Unknown keys are a rejection, not ignored data. If a field were allowed through
//      unsigned, an attacker could add one that a future version honours.
//
// The result: exactly one thing in release.json is not covered by the signature — the
// `signature` field itself. Everything else, including the signer's own key line and the schema
// version, is inside the signed region.

const SAFE_STRING = /^[\x20-\x7E]*$/;
const SAFE_KEY = /^[a-z][a-z0-9]*$/;

/** @param {string} s */
function canonicalString(s) {
  if (typeof s !== 'string') fail('non-string where a string was required');
  if (!SAFE_STRING.test(s)) fail('string contains characters outside printable ASCII');
  let out = '"';
  for (const ch of s) out += (ch === '\\' || ch === '"') ? `\\${ch}` : ch;
  return `${out}"`;
}

/** @param {number} n */
function canonicalNumber(n) {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || Object.is(n, -0)) {
    fail('numbers in a manifest must be non-negative safe integers');
  }
  return String(n);
}

/** Deterministic serialisation of the narrow value language above. @param {unknown} v */
function canonicalValue(v) {
  if (typeof v === 'string') return canonicalString(v);
  if (typeof v === 'number') return canonicalNumber(v);
  if (Array.isArray(v)) return `[${v.map(canonicalValue).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v).sort();          // ASCII keys → code-unit order == byte order
    for (const k of keys) if (!SAFE_KEY.test(k)) fail(`illegal manifest key ${JSON.stringify(k)}`);
    return `{${keys.map((k) => `${canonicalString(k)}:${canonicalValue(v[k])}`).join(',')}}`;
  }
  fail('unsupported value type in a manifest (only strings, integers, arrays and objects)');
  return '';
}

/**
 * Domain-tagged canonical bytes. The tag is the second layer of the namespace separation
 * argument: signed byte strings from two different purposes cannot collide even by accident,
 * and no canonical NeoDonkey artefact can ever also be a valid git object.
 * @param {string} tag e.g. 'neodonkey-release-manifest/1'
 * @param {unknown} value
 * @returns {Bytes}
 */
export function canonicalBytes(tag, value) {
  if (typeof tag !== 'string' || !/^[a-z][a-z0-9-]*\/[0-9]+$/.test(tag)) fail('bad domain tag');
  return utf8(`${tag}\n${canonicalValue(value)}\n`);
}

// ---------------------------------------------------------------------------------------------
// validation / normalisation
// ---------------------------------------------------------------------------------------------

/** Paths are a strict subset: relative, POSIX, no traversal, no case-collisions, no surprises. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SEMVERISH = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Reject anything that could make the manifest key and the URL the browser actually fetches
 * disagree: absolute paths, `.` / `..`, empty segments, backslashes, percent-escapes, spaces.
 * A path that needs normalising is a path that two pieces of code will normalise differently.
 * @param {string} p
 */
export function validatePath(p) {
  if (typeof p !== 'string' || p === '') fail('bad-path');
  if (p !== p.trim() || /[\\\s%:*?"<>|]/.test(p)) fail('bad-path');
  if (p.startsWith('/') || p.endsWith('/')) fail('bad-path');
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') fail('bad-path');
    if (!SAFE_PATH_SEGMENT.test(seg)) fail('bad-path');
  }
  return p;
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Refuse unknown fields by name — the same discipline `polism/` uses for rules. */
function exactKeys(obj, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(obj)) if (!allowed.has(k)) fail(`unknown-field:${k}`);
  for (const k of required) if (!own(obj, k)) fail(`missing-field:${k}`);
}

/**
 * Validate a raw manifest object and return the normalised, canonical-ready form (signature
 * stripped, files sorted). Throws `ManifestError` with a precise reason on any defect.
 * @param {unknown} raw
 * @returns {{ schema: number, product: string, version: string, key: string, files: FileEntry[] }}
 */
export function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('not-an-object');
  const m = /** @type {Record<string, unknown>} */ (raw);
  exactKeys(m, ['schema', 'product', 'version', 'key', 'files'], ['signature']);

  if (m.schema !== MANIFEST_SCHEMA) fail('unknown-schema-version');
  if (m.product !== PRODUCT) fail('wrong-product');
  if (typeof m.version !== 'string' || !SEMVERISH.test(m.version)) fail('bad-version');
  if (typeof m.key !== 'string') fail('bad-key-line');
  try { parsePublicSsh(m.key); } catch { fail('bad-key-line'); }
  if (!SAFE_STRING.test(m.key)) fail('bad-key-line');
  if (!Array.isArray(m.files)) fail('bad-file-list');
  if (m.files.length === 0) fail('empty-file-list');

  const seen = new Set();
  const files = m.files.map((e) => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) fail('bad-file-entry');
    const f = /** @type {Record<string, unknown>} */ (e);
    exactKeys(f, ['path', 'sha256', 'bytes']);
    const path = validatePath(/** @type {string} */ (f.path));
    if (typeof f.sha256 !== 'string' || !SHA256_HEX.test(f.sha256)) fail('bad-hash');
    if (typeof f.bytes !== 'number' || !Number.isSafeInteger(f.bytes) || f.bytes < 0) fail('bad-size');
    // Case-insensitive duplicate check: `App.js` and `app.js` are two URLs but one file on
    // macOS and Windows. A release that cannot exist on disk unambiguously is refused.
    const dedupe = path.toLowerCase();
    if (seen.has(dedupe)) fail('duplicate-path');
    seen.add(dedupe);
    return { path, sha256: f.sha256, bytes: f.bytes };
  });

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { schema: MANIFEST_SCHEMA, product: PRODUCT, version: /** @type {string} */ (m.version),
    key: /** @type {string} */ (m.key), files };
}

/**
 * The exact bytes a release signature covers. Order-independent and byte-stable: permuting the
 * object's keys or the file array cannot change the result.
 * @param {Manifest|object} manifest raw or normalised; `signature` is ignored if present
 * @returns {Bytes}
 */
export function canonicalManifestBytes(manifest) {
  const n = normalizeManifest(manifest);
  return canonicalBytes(`${MANIFEST_TAG}/${n.schema}`, n);
}

// ---------------------------------------------------------------------------------------------
// hashing
// ---------------------------------------------------------------------------------------------

/** @param {Bytes} b @returns {string} lowercase hex */
export function hexOf(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
}

/**
 * SHA-256 of file bytes, as it appears in a manifest. There is no algorithm-agility field
 * anywhere in the format: the field is literally named `sha256`, so no manifest can ever ask a
 * verifier to accept a weaker hash. Agility is where downgrade attacks live; we have none.
 * @param {Bytes} bytes @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  if (!(bytes instanceof Uint8Array)) fail('bytes expected');
  return hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

// ---------------------------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------------------------

/**
 * Read a manifest's *claims* without believing any of them. This is the only supported way to
 * get at the key line of an unverified manifest — the trust-on-first-use path in `pin.js` needs
 * it, and naming it `inspect…Unverified` is deliberate so no caller mistakes it for a check.
 * @param {string|object} manifestJson
 * @returns {{ ok: true, version: string, key: string, fileCount: number, totalBytes: number }
 *          | { ok: false, reason: string }}
 */
export function inspectManifestUnverified(manifestJson) {
  try {
    const raw = typeof manifestJson === 'string' ? JSON.parse(manifestJson) : manifestJson;
    const n = normalizeManifest(raw);
    return { ok: true, version: n.version, key: n.key, fileCount: n.files.length,
      totalBytes: n.files.reduce((s, f) => s + f.bytes, 0) };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

const reasonOf = (err) => (err instanceof ManifestError ? err.reason
  : err instanceof SyntaxError ? 'malformed-json' : 'malformed-manifest');

/**
 * Verify a release manifest against the key the caller *already trusts* (the pinned one).
 *
 * Fails closed on everything, with a distinct reason per defect. It never throws: an exception
 * escaping a verifier is how a `catch` somewhere upstream turns into "well, carry on".
 *
 * @param {string|object} manifestJson raw release.json text, or the parsed object
 * @param {string} publicSshLine the expected signer, `ssh-ed25519 AAAA... [comment]`
 * @returns {Promise<{ ok: true, version: string, files: Map<string, FileEntry>, key: string,
 *                     schema: number, totalBytes: number }
 *                  | { ok: false, reason: string }>}
 */
export async function verifyRelease(manifestJson, publicSshLine) {
  try {
    const raw = typeof manifestJson === 'string' ? JSON.parse(manifestJson) : manifestJson;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-an-object' };
    if (!own(raw, 'signature') || typeof raw.signature !== 'string') {
      return { ok: false, reason: 'missing-signature' };
    }

    const n = normalizeManifest(raw);                       // throws with a precise reason

    // The expected key is the whole point. No fallback to the manifest's own claim: a manifest
    // that vouches for itself is not a check, it is a formality.
    let expected;
    try { expected = parsePublicSsh(publicSshLine); } catch { return { ok: false, reason: 'bad-expected-key' }; }

    // The manifest names its signer *inside* the signed region, and it must be the key we
    // expect. Compared on the raw 32 bytes, so a differing key comment is not a mismatch.
    const claimed = parsePublicSsh(n.key);
    if (!bytesEqual(claimed.raw, expected.raw)) return { ok: false, reason: 'key-mismatch' };

    // Namespace first, so a replayed 'git' signature reports *why* it was refused instead of
    // hiding inside a generic bad-signature. inspectSignature makes no trust claim at all.
    const shape = inspectSignature(raw.signature);
    if (!shape) return { ok: false, reason: 'malformed-signature' };
    // The offending namespace is named in the reason: 'wrong-namespace:git' says out loud that
    // someone tried to pass a commit signature off as a release.
    if (shape.namespace !== RELEASE_NAMESPACE) return { ok: false, reason: `wrong-namespace:${shape.namespace}` };

    const payload = canonicalManifestBytes(n);
    if (await verifyPayload(publicSshLine, payload, raw.signature, RELEASE_NAMESPACE) !== true) {
      return { ok: false, reason: 'bad-signature' };
    }

    const files = new Map(n.files.map((f) => [f.path, f]));
    return { ok: true, version: n.version, files, key: n.key, schema: n.schema,
      totalBytes: n.files.reduce((s, f) => s + f.bytes, 0) };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

/** Accept either a `verifyRelease` result (files: Map) or a normalised manifest (files: Array). */
function fileTable(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  if (manifest.ok === false) return null;                    // a failed verification is not a manifest
  if (manifest.files instanceof Map) return manifest.files;
  if (Array.isArray(manifest.files)) {
    try { return new Map(normalizeManifest(manifest).files.map((f) => [f.path, f])); } catch { return null; }
  }
  return null;
}

/**
 * Check one file's bytes against a manifest.
 *
 * PRECONDITION, and it is load-bearing: `manifest` must be the result of a successful
 * `verifyRelease`. This function checks membership and hash; it cannot check a signature it was
 * not given. Calling it with an unverified manifest verifies nothing.
 *
 * A path that is not in the manifest is `false`. Not "unconstrained" — `false`. See
 * `verifyFileSet` for why that is the more important half of this whole mechanism.
 *
 * @param {string} path repo-relative, exactly as it appears in the manifest
 * @param {Bytes} bytes
 * @param {object} manifest
 * @returns {Promise<boolean>}
 */
export async function verifyFile(path, bytes, manifest) {
  return (await checkFile(path, bytes, manifest)).ok;
}

/**
 * `verifyFile` with a reason, for logs and UIs.
 * @returns {Promise<{ok: true, entry: FileEntry} | {ok: false, reason: string}>}
 */
export async function checkFile(path, bytes, manifest) {
  const table = fileTable(manifest);
  if (!table) return { ok: false, reason: 'no-verified-manifest' };
  if (!(bytes instanceof Uint8Array)) return { ok: false, reason: 'bytes-expected' };
  let p;
  try { p = validatePath(path); } catch { return { ok: false, reason: 'bad-path' }; }
  const entry = table.get(p);
  // THE unlisted-file check. An attacker who cannot modify a signed file will simply add an
  // unsigned one, so "not mentioned" must mean "refused", never "no constraint".
  if (!entry) return { ok: false, reason: 'unlisted-file' };
  if (entry.bytes !== bytes.length) return { ok: false, reason: 'size-mismatch' };
  if (await sha256Hex(bytes) !== entry.sha256) return { ok: false, reason: 'hash-mismatch' };
  return { ok: true, entry };
}

/**
 * Verify a *complete* set of files against one manifest. This is what a Service Worker install
 * must use, because the three interesting attacks are set-shaped, not file-shaped:
 *
 *   • modified file  → `mismatched`
 *   • added file     → `unlisted`   (the attack that "verify each file you fetch" misses)
 *   • removed file   → `missing`    (delete the module that enforces something)
 *
 * And a fourth, which is why this takes exactly one manifest: **mixed-version assembly**. Files
 * from two genuinely-signed releases, combined, are a build nobody signed and nobody tested. A
 * runtime is verified as a whole or not at all.
 *
 * @param {Map<string, Bytes>|Iterable<[string, Bytes]>} entries every file about to be trusted
 * @param {object} manifest a successful `verifyRelease` result
 * @param {{ allowSubset?: boolean }} [opts] `allowSubset` permits a manifest that legitimately
 *   describes more than the browser fetches (e.g. the Node-only `fs-node.js`). It NEVER permits
 *   an unlisted or mismatched file — it only relaxes `missing`.
 * @returns {Promise<{ok: boolean, reason?: string, unlisted: string[], missing: string[],
 *                     mismatched: string[]}>}
 */
export async function verifyFileSet(entries, manifest, opts = {}) {
  const table = fileTable(manifest);
  const map = entries instanceof Map ? entries : new Map(entries);
  const out = { ok: false, unlisted: [], missing: [], mismatched: [] };
  if (!table) return { ...out, reason: 'no-verified-manifest' };

  for (const [path, bytes] of map) {
    const r = await checkFile(path, bytes, manifest);
    if (r.ok) continue;
    if (r.reason === 'unlisted-file' || r.reason === 'bad-path') out.unlisted.push(path);
    else out.mismatched.push(path);
  }
  if (!opts.allowSubset) for (const path of table.keys()) if (!map.has(path)) out.missing.push(path);

  out.unlisted.sort(); out.missing.sort(); out.mismatched.sort();
  const reason = out.unlisted.length ? `unlisted-file:${out.unlisted[0]}`
    : out.mismatched.length ? `file-mismatch:${out.mismatched[0]}`
      : out.missing.length ? `missing-file:${out.missing[0]}` : undefined;
  out.ok = reason === undefined;
  return reason === undefined ? out : { ...out, reason };
}

// ---------------------------------------------------------------------------------------------
// version coexistence (Appendix I) — describing a release is not installing it
// ---------------------------------------------------------------------------------------------

/**
 * OpenSSH-style key fingerprint, byte-identical to `ssh-keygen -lf key.pub`:
 * `SHA256:` + unpadded base64 of SHA-256 over the public key wire blob. Identical format on
 * purpose — the user's independent check is `ssh-keygen -lf` against a key published somewhere
 * that is not the origin, and two different-looking fingerprints for the same key would make
 * that comparison useless.
 * @param {string} publicSshLine @returns {Promise<string>}
 */
export async function keyFingerprint(publicSshLine) {
  const { wire } = parsePublicSsh(publicSshLine);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', wire));
  return `SHA256:${b64encode(d).replace(/=+$/, '')}`;
}

/**
 * Compare two versions. `1.10.0 > 1.9.0`; a pre-release sorts before its release
 * (`0.2.0-rc.1 < 0.2.0`). Returns -1 / 0 / 1, or `null` if either side is unparseable —
 * `null` rather than a guess, because guessing here would silently mis-order an upgrade offer.
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    if (typeof v !== 'string' || !SEMVERISH.test(v)) return null;
    const [core, pre = null] = v.split('-', 2);
    return { nums: core.split('.').map(Number), pre };
  };
  const A = parse(a); const B = parse(b);
  if (!A || !B) return null;
  for (let i = 0; i < 3; i++) if (A.nums[i] !== B.nums[i]) return A.nums[i] < B.nums[i] ? -1 : 1;
  if (A.pre === B.pre) return 0;
  if (A.pre === null) return 1;
  if (B.pre === null) return -1;
  return A.pre < B.pre ? -1 : 1;
}

/**
 * Everything a UI needs to say "version X is available, here is its fingerprint, install when
 * you want" — and nothing that could install it.
 *
 * Appendix I is explicit: every major version is a standalone work, bought once and owned
 * forever, and *whoever does not want version 2 keeps running version 1*. The accountant on v2
 * and the warehouse on v1 exchange the same facts. So an offer is information, never a mandate:
 *
 *   • `mandatory` is `false`. It is a literal constant. There is no code path that sets it.
 *   • Nothing here writes to a store, a cache, or the network.
 *   • A *lower* offered version is reported as `'downgrade'`, not hidden — a user is allowed to
 *     go back to v1 (that is Appendix I working as designed) — but it is never presented as an
 *     update, because a silently-accepted rollback to a version with a known hole is a real
 *     attack an origin can mount with a genuinely signed old manifest.
 *
 * @param {{ installedVersion: string|null, offered: string|object, pinnedKey: string }} o
 * @returns {Promise<{ kind: 'update'|'same'|'downgrade'|'unverified'|'incomparable',
 *                     version: string|null, fingerprint: string|null, mandatory: false,
 *                     verified: boolean, reason?: string }>}
 */
export async function describeOffer({ installedVersion, offered, pinnedKey }) {
  const base = { mandatory: /** @type {false} */ (false), verified: false,
    version: null, fingerprint: null };
  const res = await verifyRelease(offered, pinnedKey);
  if (!res.ok) return { ...base, kind: 'unverified', reason: res.reason };

  const fingerprint = await keyFingerprint(res.key);
  const common = { ...base, verified: true, version: res.version, fingerprint };
  if (installedVersion == null) return { ...common, kind: 'update' };
  const cmp = compareVersions(res.version, installedVersion);
  if (cmp === null) return { ...common, kind: 'incomparable', reason: 'unparseable-version' };
  return { ...common, kind: cmp > 0 ? 'update' : cmp === 0 ? 'same' : 'downgrade' };
}
