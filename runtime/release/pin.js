// runtime/release/pin.js — which release key this installation trusts, and how that can change.
//
// A signature is only worth the key you check it against. `manifest.js` verifies a release
// against an *expected* key; this file is the answer to "expected by whom?".
//
// The answer is trust on first use, then nothing but cryptography:
//
//   install #1   the release key is shown (fingerprint) and pinned into local storage
//   every load   a manifest signed by a *different* key is refused, full stop
//   rotation     the pin moves only on a statement signed by the *outgoing* key, and only after
//                the caller has echoed the incoming key's fingerprint back to us
//
// That is what makes a compromised — or legally compelled — origin unable to push code. It
// cannot mint a signature under the pinned key, and it cannot talk the client out of the pin,
// because moving the pin requires the old key's private half.
//
// The honest limit is stated where it belongs, in docs/_compromise-release.md: the *first*
// install has nothing to compare against. A hostile origin on day one is undetectable by any
// amount of cryptography. Only out-of-band publication of the fingerprint fixes that, which is
// why every function here that touches a key also hands back the fingerprint to show.
//
// STORAGE IS INJECTED. This file imports no browser API: `store` is `{get, set}`, IndexedDB in
// the browser, a Map in a test, a file in Node. Same reason `git/fs.js` exists — the environment
// leaks in at exactly one place, chosen by the caller (CONTRACT non-negotiable #4).
//
// TIME IS INJECTED. No `Date.now()` anywhere below; timestamps arrive in `meta.at` if the caller
// has a clock and cares (CONTRACT non-negotiable #5).

import { exportPublicRaw, bytesEqual, parsePublicSsh } from '../identity/ed25519.js';
import { inspectSignature, signPayload, verifyPayload } from '../identity/sshsig.js';
import {
  ManifestError, PRODUCT, ROTATION_NAMESPACE,
  canonicalBytes, inspectManifestUnverified, keyFingerprint, verifyRelease,
} from './manifest.js';

/** @typedef {{ get(key: string): Promise<unknown>, set(key: string, value: unknown): Promise<void> }} Store */
/** @typedef {{ key: string, fingerprint: string, why: 'first-use'|'rotation',
 *              at: number|null, note: string|null }} PinEvent */

/** Store keys. Namespaced, because the store is shared with whatever else the app keeps there. */
export const PIN_KEY = 'neodonkey/release/pinned-key';
export const INSTALLED_KEY = 'neodonkey/release/installed';

export const ROTATION_SCHEMA = 1;
const ROTATION_TAG = 'neodonkey-release-rotation';

const fail = (reason) => { throw new ManifestError(reason); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function assertStore(store) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    fail('store must provide async get(key) and set(key, value)');
  }
  return store;
}

/**
 * A `Store` over a Map. For tests, and for a Node peer that does not want a file. The browser
 * adapter (IndexedDB) is deliberately NOT here — see the header: this module must not import a
 * browser API, or it stops being the same bytes everywhere.
 * @param {Map<string, unknown>} [backing]
 */
export function memoryStore(backing = new Map()) {
  return {
    async get(key) { return backing.has(key) ? backing.get(key) : null; },
    async set(key, value) { backing.set(key, value); },
    _backing: backing,
  };
}

/** Two key lines denote the same key iff their raw 32 bytes match. Comments are not identity. */
export function sameKey(a, b) {
  try { return bytesEqual(parsePublicSsh(a).raw, parsePublicSsh(b).raw); } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// the pin
// ---------------------------------------------------------------------------------------------

/** @param {Store} store @returns {Promise<object|null>} the whole pin record, or null */
export async function pinRecord(store) {
  const rec = await assertStore(store).get(PIN_KEY);
  if (!rec || typeof rec !== 'object' || typeof rec.key !== 'string') return null;
  try { parsePublicSsh(rec.key); } catch { return null; }   // a corrupt pin is no pin, not a bad key
  return rec;
}

/**
 * The public key line this installation trusts for releases, or `null` on a fresh install.
 * @param {Store} store @returns {Promise<string|null>}
 */
export async function pinnedKey(store) {
  const rec = await pinRecord(store);
  return rec ? rec.key : null;
}

/** Every key this installation has ever trusted, oldest first. An auditable trust history —
 *  a user can see that the key changed, and when, and on whose signature.
 *  @param {Store} store @returns {Promise<PinEvent[]>} */
export async function keyHistory(store) {
  const rec = await pinRecord(store);
  return rec && Array.isArray(rec.history) ? rec.history : [];
}

/**
 * Pin a release key. This is trust on first use, and it is the ONLY unauthenticated trust
 * decision in the system — so it deliberately refuses to be a back door:
 *
 *   • pinning the same key again is a no-op (idempotent, safe to call on every install);
 *   • pinning a *different* key throws. There is no `force`. Replacing a pin is rotation, and
 *     rotation requires the outgoing key's signature (`applyRotation`). If `pinKey` could
 *     overwrite, every line of this file would be decoration.
 *
 * @param {Store} store
 * @param {string} publicSshLine
 * @param {{ at?: number|null, note?: string|null, origin?: string|null }} [meta]
 *   `at` is an injected timestamp (this module never reads a clock). `origin` is where the key
 *   came from, recorded for the audit trail, trusted for nothing.
 * @returns {Promise<void>}
 */
export async function pinKey(store, publicSshLine, meta = {}) {
  assertStore(store);
  let parsed;
  try { parsed = parsePublicSsh(publicSshLine); } catch { fail('bad-key-line'); }
  if (parsed.type !== 'ssh-ed25519') fail('bad-key-line');

  const existing = await pinRecord(store);
  if (existing) {
    if (sameKey(existing.key, publicSshLine)) return;       // idempotent
    fail('already-pinned-to-a-different-key');
  }

  const fingerprint = await keyFingerprint(publicSshLine);
  const at = typeof meta.at === 'number' ? meta.at : null;
  /** @type {PinEvent} */
  const event = { key: publicSshLine, fingerprint, why: 'first-use', at,
    note: typeof meta.note === 'string' ? meta.note : null };
  await store.set(PIN_KEY, {
    schema: 1,
    key: publicSshLine,
    fingerprint,
    pinnedAt: at,
    origin: typeof meta.origin === 'string' ? meta.origin : null,
    history: [event],
  });
}

/**
 * Is this key the pinned one? Fails closed, including when there is no pin at all — a caller
 * that has not pinned yet must take the explicit first-use path, not inherit an `ok: true`.
 * @param {Store} store @param {string} publicSshLine
 * @returns {Promise<{ ok: true, fingerprint: string } | { ok: false, reason: string,
 *                     pinned?: string, fingerprint?: string }>}
 */
export async function checkAgainstPin(store, publicSshLine) {
  const rec = await pinRecord(store);
  if (!rec) return { ok: false, reason: 'no-pin' };
  let fingerprint = null;
  try { fingerprint = await keyFingerprint(publicSshLine); } catch { return { ok: false, reason: 'bad-key-line', pinned: rec.key }; }
  if (!sameKey(rec.key, publicSshLine)) {
    return { ok: false, reason: 'key-not-pinned', pinned: rec.key, fingerprint };
  }
  return { ok: true, fingerprint };
}

// ---------------------------------------------------------------------------------------------
// key rotation
// ---------------------------------------------------------------------------------------------
//
// A release key will eventually have to change: a build machine is replaced, a signer leaves, a
// key is suspected. The two easy answers are both wrong. "Reinstall from scratch" throws away the
// only pin the user has and trains people to accept new keys — the exact reflex an attacker
// needs. "Accept any newer key" is not a mechanism at all.
//
// So trust transfers *cryptographically*: a rotation statement, signed by the OUTGOING key,
// naming the incoming one. The client already trusts the outgoing key, so it can check the
// statement without asking anyone. Its own namespace and its own domain tag mean it can never be
// confused with a manifest or a commit signature in either direction.
//
//   { "schema":1, "product":"neodonkey", "from":"ssh-ed25519 …", "to":"ssh-ed25519 …",
//     "note":"annual rotation, 2027-03", "signature":"-----BEGIN SSH SIGNATURE-----…" }
//
// AND, on top of the signature, `applyRotation` will not move the pin unless the caller passes
// back the incoming key's fingerprint (`confirmFingerprint`). That is structural, not advisory:
// there is no code path to a new pin that does not require the UI to have had the fingerprint in
// hand — which is how the user gets a chance to compare it with an out-of-band source.
//
// WHAT THIS DOES NOT SOLVE, stated plainly:
//
//   1. **No revocation.** A stolen outgoing key can sign a rotation to the thief's key. A
//      rotation statement proves continuity of *key control*, not authorisation by the project.
//      The fingerprint confirmation is the only brake, and it is a human one.
//   2. **No freshness.** There is no trustworthy clock here, so a statement never expires. Old
//      statements are harmless (`from` must equal the *current* pin, so a superseded one is
//      refused) but a leaked-and-unused statement stays valid forever.
//   3. **One signer.** v0.1 has a single release key, so a compelled vendor holding it can rotate
//      and then publish. Threshold signing (n-of-m) plus an append-only transparency log and
//      out-of-band fingerprint publication is the real fix, and it is the exit path in
//      docs/_compromise-release.md.

/** Validate a rotation statement into its normalised, signed form. Throws with a reason. */
export function normalizeRotation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('not-an-object');
  const allowed = new Set(['schema', 'product', 'from', 'to', 'note', 'signature']);
  for (const k of Object.keys(raw)) if (!allowed.has(k)) fail(`unknown-field:${k}`);
  for (const k of ['schema', 'product', 'from', 'to']) if (!own(raw, k)) fail(`missing-field:${k}`);
  if (raw.schema !== ROTATION_SCHEMA) fail('unknown-schema-version');
  if (raw.product !== PRODUCT) fail('wrong-product');
  for (const k of ['from', 'to']) {
    if (typeof raw[k] !== 'string') fail(`bad-key-line:${k}`);
    try { parsePublicSsh(raw[k]); } catch { fail(`bad-key-line:${k}`); }
  }
  if (sameKey(raw.from, raw.to)) fail('same-key');
  const note = own(raw, 'note') ? raw.note : '';
  if (typeof note !== 'string') fail('bad-note');
  return { schema: ROTATION_SCHEMA, product: PRODUCT, from: raw.from, to: raw.to, note };
}

/** The exact bytes a rotation signature covers. Same canonical form as a manifest, different
 *  domain tag — so the two byte strings are disjoint by construction. */
export function canonicalRotationBytes(statement) {
  const n = normalizeRotation(statement);
  return canonicalBytes(`${ROTATION_TAG}/${n.schema}`, n);
}

/**
 * Produce a rotation statement, signed by the outgoing key. Run by whoever holds the outgoing
 * private key; pure WebCrypto, so it works in the browser too.
 * @param {{privateKey: CryptoKey, publicKey: CryptoKey}} outgoingKeyPair
 * @param {{ from: string, to: string, note?: string }} o
 * @returns {Promise<object>} the statement, ready to serialise as JSON
 */
export async function createRotationStatement(outgoingKeyPair, { from, to, note = '' }) {
  const n = normalizeRotation({ schema: ROTATION_SCHEMA, product: PRODUCT, from, to, note });
  // Signing with a key that is not the one named in `from` would produce a statement that can
  // never verify. Catch it here, loudly, rather than shipping a dud rotation.
  const raw = await exportPublicRaw(outgoingKeyPair);
  if (!bytesEqual(raw, parsePublicSsh(n.from).raw)) fail('signing-key-is-not-the-from-key');
  const signature = await signPayload(outgoingKeyPair, canonicalRotationBytes(n), ROTATION_NAMESPACE);
  return { ...n, signature };
}

/**
 * Verify a rotation statement against the currently pinned key, and move the pin — but only with
 * explicit confirmation of the incoming fingerprint.
 *
 * Called WITHOUT `confirmFingerprint` it is a pure proposal: it verifies everything, writes
 * nothing, and returns the fingerprint a UI must show. Called WITH the correct fingerprint it
 * applies. That split is the whole design: cryptographic transfer of trust, plus a human who saw
 * which key they are moving to.
 *
 * @param {Store} store
 * @param {string|object} statementJson
 * @param {{ confirmFingerprint?: string, at?: number|null }} [opts]
 * @returns {Promise<{ ok: boolean, applied: boolean, reason?: string, from?: string, to?: string,
 *                     fingerprint?: string, previousFingerprint?: string }>}
 */
export async function applyRotation(store, statementJson, opts = {}) {
  assertStore(store);
  let st;
  try {
    const raw = typeof statementJson === 'string' ? JSON.parse(statementJson) : statementJson;
    if (!raw || typeof raw !== 'object') return { ok: false, applied: false, reason: 'not-an-object' };
    // An unsigned rotation claim is not a weak claim, it is not a claim.
    if (!own(raw, 'signature') || typeof raw.signature !== 'string') {
      return { ok: false, applied: false, reason: 'missing-signature' };
    }
    st = { normalized: normalizeRotation(raw), signature: raw.signature };
  } catch (err) {
    return { ok: false, applied: false,
      reason: err instanceof ManifestError ? err.reason
        : err instanceof SyntaxError ? 'malformed-json' : 'malformed-rotation' };
  }

  const rec = await pinRecord(store);
  if (!rec) return { ok: false, applied: false, reason: 'no-pin' };
  // The statement must start from the key we currently trust. This is what makes an old or
  // foreign rotation statement inert, and what forbids skipping a link in the chain.
  if (!sameKey(rec.key, st.normalized.from)) {
    return { ok: false, applied: false, reason: 'not-from-pinned-key', from: st.normalized.from };
  }

  const shape = inspectSignature(st.signature);
  if (!shape) return { ok: false, applied: false, reason: 'malformed-signature' };
  if (shape.namespace !== ROTATION_NAMESPACE) {
    return { ok: false, applied: false, reason: `wrong-namespace:${shape.namespace}` };
  }

  const payload = canonicalRotationBytes(st.normalized);
  if (await verifyPayload(rec.key, payload, st.signature, ROTATION_NAMESPACE) !== true) {
    return { ok: false, applied: false, reason: 'bad-signature' };
  }

  const fingerprint = await keyFingerprint(st.normalized.to);
  const detail = { from: st.normalized.from, to: st.normalized.to, fingerprint,
    previousFingerprint: rec.fingerprint };

  if (opts.confirmFingerprint !== fingerprint) {
    // Verified, but not applied. The caller has to show this fingerprint to a human and come
    // back with it. There is no other route to a changed pin.
    return { ok: true, applied: false, reason: 'confirmation-required', ...detail };
  }

  const at = typeof opts.at === 'number' ? opts.at : null;
  const history = Array.isArray(rec.history) ? rec.history.slice() : [];
  history.push({ key: st.normalized.to, fingerprint, why: 'rotation', at,
    note: st.normalized.note || null });
  await store.set(PIN_KEY, { ...rec, key: st.normalized.to, fingerprint, pinnedAt: at, history });
  return { ok: true, applied: true, ...detail };
}

/**
 * Apply a chain of rotation statements in order (A→B, B→C). Each link is verified against the
 * pin produced by the previous one, so a chain cannot skip a key. Stops at the first failure and
 * reports how far it got.
 * @param {Store} store @param {Array<string|object>} statements
 * @param {{ confirmFingerprint?: string, at?: number|null }} [opts] confirms the FINAL key only
 */
export async function applyRotationChain(store, statements, opts = {}) {
  if (!Array.isArray(statements) || statements.length === 0) {
    return { ok: false, applied: 0, reason: 'no-statements' };
  }
  let applied = 0;
  for (let i = 0; i < statements.length; i++) {
    const last = i === statements.length - 1;
    // Intermediate links are mechanical: the user is being asked about the destination, not
    // about every key the project happened to use on the way there.
    const r = await applyRotation(store, statements[i], last ? opts
      : { at: opts.at, confirmFingerprint: await intermediateFingerprint(statements[i]) });
    if (!r.applied) return { ok: false, applied, reason: r.reason ?? 'rotation-failed', at: i, step: r };
    applied++;
  }
  return { ok: true, applied };
}

async function intermediateFingerprint(statement) {
  try {
    const raw = typeof statement === 'string' ? JSON.parse(statement) : statement;
    return await keyFingerprint(normalizeRotation(raw).to);
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------------------------
// what is installed — the other half of version coexistence (Appendix I)
// ---------------------------------------------------------------------------------------------

/**
 * Remember the release this installation is *running*, manifest text and all.
 *
 * This is what lets the warehouse stay on v1 while the accountant moves to v2. Every subsequent
 * boot verifies the cached shell against the manifest recorded HERE, not against whatever
 * release.json the origin is serving today. The origin's copy is only ever an offer.
 *
 * @param {Store} store
 * @param {{ manifestText: string, at?: number|null }} o the exact release.json bytes as text,
 *   so the installed release can be re-verified offline, forever, with no network at all.
 */
export async function recordInstalledRelease(store, { manifestText, at = null }) {
  assertStore(store);
  if (typeof manifestText !== 'string') fail('manifestText must be the raw release.json text');
  const info = inspectManifestUnverified(manifestText);
  if (!info.ok) fail(info.reason);
  await store.set(INSTALLED_KEY, { schema: 1, version: info.version, manifestText,
    installedAt: typeof at === 'number' ? at : null });
}

/** @param {Store} store @returns {Promise<{version: string, manifestText: string,
 *           installedAt: number|null}|null>} */
export async function installedRelease(store) {
  const rec = await assertStore(store).get(INSTALLED_KEY);
  if (!rec || typeof rec !== 'object' || typeof rec.manifestText !== 'string') return null;
  return { version: rec.version, manifestText: rec.manifestText, installedAt: rec.installedAt ?? null };
}

/**
 * The single decision function a loader needs: given the pin state and whatever the origin
 * served, what am I allowed to run?
 *
 *   pin + valid manifest   → 'verified'    run it; `files` is the allowlist to enforce
 *   pin + bad manifest     → 'refused'     fail closed, with a reason
 *   pin + NO manifest      → 'refused'     ← an origin that simply *stops* serving release.json
 *                                            is the cheapest attack there is: strip the
 *                                            signature layer and hope the client shrugs. Once
 *                                            pinned, we never shrug.
 *   no pin + manifest      → 'first-use'   show the fingerprint, then pinKey(). TOFU, named.
 *   no pin + no manifest   → 'unsigned'    an unsigned development build. Runnable, but the UI
 *                                          must say so — this is the escape hatch that exists
 *                                          only because `node serve.mjs` on a checkout has no
 *                                          release key. It is a real hole and it is documented.
 *
 * @param {Store} store
 * @param {string|null} manifestJson raw release.json text, or null if the origin has none
 * @param {string} [expectedKey] override the pin (audit tooling only; not for the loader)
 * @returns {Promise<{ mode: 'verified'|'refused'|'first-use'|'unsigned', reason?: string,
 *                     version?: string, key?: string, fingerprint?: string,
 *                     files?: Map<string, object> }>}
 */
export async function gateRelease(store, manifestJson, expectedKey) {
  const pinned = expectedKey ?? await pinnedKey(store);

  if (pinned == null) {
    if (manifestJson == null) return { mode: 'unsigned', reason: 'no-release-manifest-and-no-pin' };
    const info = inspectManifestUnverified(manifestJson);
    if (!info.ok) return { mode: 'refused', reason: info.reason };
    // Self-signed by definition on first use: verify the manifest against the key it names, so
    // that at least the bytes are internally consistent, then hand the fingerprint up for a
    // human decision. This proves the signer holds the private key. It proves nothing about WHO.
    const res = await verifyRelease(manifestJson, info.key);
    if (!res.ok) return { mode: 'refused', reason: res.reason };
    return { mode: 'first-use', version: res.version, key: res.key,
      fingerprint: await keyFingerprint(res.key), files: res.files };
  }

  if (manifestJson == null) return { mode: 'refused', reason: 'release-manifest-missing' };
  const res = await verifyRelease(manifestJson, pinned);
  if (!res.ok) return { mode: 'refused', reason: res.reason };
  return { mode: 'verified', version: res.version, key: res.key,
    fingerprint: await keyFingerprint(res.key), files: res.files };
}
