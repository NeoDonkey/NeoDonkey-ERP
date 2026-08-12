// runtime/sync/sealed.js — the layer that makes Appendix X's sentence about the relay true.
//
// Appendix X, day 3, and it is normative:
//   "otherwise over a small relay (community server or Hetzner peer for €3/month).
//    **The relay sees nothing, decides nothing, stores nothing** — it only forwards encrypted
//    bytes, replaceable like any postal transit station."
//
// "Forwards encrypted bytes" is a requirement on us, not on the relay operator's good manners.
// A relay that could read a frame would learn the company's repo id, its peers' public keys, its
// invoice numbers and its documents — which is Principle 2 ("Serverless. Cloudless.") failing in
// the one place a reviewer would look first. So everything that crosses a relay is sealed here,
// and the relay is handed a mailbox identifier that is a hash of a secret it never sees.
//
// Two layers of key, for two different jobs:
//
//   1. THE OUTER KEY, derived from the 32-byte rendezvous secret that travelled in the QR code
//      (runtime/sync/introduce.js). Only the two peers that saw that QR have it. It protects the
//      handshake itself — so the relay never even learns *which two public keys* are talking,
//      which is the metadata leak a naive design ships without noticing.
//
//   2. THE SESSION KEYS, from an ephemeral X25519 exchange whose public halves are signed by the
//      peers' long-lived Ed25519 identity keys. This buys two things the outer key cannot:
//      forward secrecy (a rendezvous secret leaked next year does not decrypt this year's
//      traffic) and authentication of the *peer*, not merely of "somebody who saw the QR".
//
// Why not ECDH straight off the Ed25519 identity keys: WebCrypto exposes no Ed25519→X25519
// conversion, and doing the birational map by hand would mean writing curve arithmetic — which is
// exactly the "do not re-derive what you can ask" failure. So the identity key SIGNS an ephemeral
// key instead of agreeing with one. That is the standard construction and it is stronger anyway.
//
// No node:*. No dependencies. Loads in a browser as-is. All randomness and all clocks are
// injected, so every test in test/sync-*.test.js is reproducible from its seed.

import {
  b64encode, b64decode, concatBytes, utf8, fromUtf8, bytesEqual,
  sshString, parsePublicSsh, importPublicRaw, signRaw, verifyRaw, exportPublicRaw,
  exportPublicSsh,
} from '../identity/ed25519.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {{ id:string, send(frame:string):void, onFrame(h:(frame:string)=>void):void, close():void }} PeerLink */
/** @typedef {{ id:string, send(bytes:Bytes):void, onBytes(h:(bytes:Bytes)=>void):void, close():void, bufferedAmount?():number }} ByteLink */

/** Every label that ends up in a key derivation or a signature, in one place. */
export const LABELS = Object.freeze({
  mailbox: 'neodonkey-sync-mailbox-v1',
  outer: 'neodonkey-sync-outer-v1',
  hello: 'neodonkey-sync-hello-v1',
  hostToGuest: 'neodonkey-sync-host-to-guest-v1',
  guestToHost: 'neodonkey-sync-guest-to-host-v1',
  /** Used only on the no-forward-secrecy fallback path, so it can never collide with the above. */
  fallbackHostToGuest: 'neodonkey-sync-nofs-host-to-guest-v1',
  fallbackGuestToHost: 'neodonkey-sync-nofs-guest-to-host-v1',
});

export const RENDEZVOUS_BYTES = 32;
export const IV_BYTES = 12;
export const X25519_PUBLIC_BYTES = 32;
export const ROLES = Object.freeze(['host', 'guest']);

/** Thrown for every refusal in this file, so a caller can tell "hostile" from "broken". */
export class SyncError extends Error {
  /** @param {string} message @param {object} [detail] */
  constructor(message, detail = {}) {
    super(message);
    this.name = 'SyncError';
    Object.assign(this, detail);
  }
}

/** Hex of a byte string. Lower case, the only case git or a URL ever wants. */
export function hex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** @param {string} s @returns {Bytes} */
export function unhex(s) {
  if (typeof s !== 'string' || s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) {
    throw new SyncError('sync: not a lower-case hex string');
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * HKDF-SHA256. One derivation function for the whole sync layer, so there is exactly one
 * answer to "where did this key come from".
 * @param {Bytes} ikm @param {string} info @param {Bytes} [salt] @param {number} [bytes]
 */
export async function hkdf(ikm, info, salt = new Uint8Array(0), bytes = 32) {
  if (!(ikm instanceof Uint8Array) || ikm.length === 0) {
    throw new SyncError('sync: HKDF input keying material must be a non-empty Uint8Array');
  }
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(info) }, key, bytes * 8,
  );
  return new Uint8Array(bits);
}

/** @param {Bytes} bytes @returns {Promise<Bytes>} */
export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** @param {Bytes} raw 32 bytes @returns {Promise<CryptoKey>} an AES-GCM key */
async function aesKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * What the relay is told, and what it can therefore learn.
 *
 * The mailbox is `HKDF(rendezvous, "…mailbox…")` — 32 bytes, hex. The relay routes on it and
 * nothing else. It is one-way: the relay cannot recover the rendezvous secret and therefore
 * cannot derive the outer key, so it cannot read the handshake, let alone the traffic. And
 * because it is a hash of a *secret* rather than of a public key, a relay operator who already
 * knows a company's public keys still cannot recognise its mailbox.
 *
 * @param {Bytes} rendezvous 32 random bytes from the introduction
 * @returns {Promise<{mailbox:string, outerKey:CryptoKey}>}
 */
export async function rendezvousFrom(rendezvous) {
  if (!(rendezvous instanceof Uint8Array) || rendezvous.length !== RENDEZVOUS_BYTES) {
    throw new SyncError(`sync: rendezvous secret must be ${RENDEZVOUS_BYTES} bytes`);
  }
  const mailbox = hex(await hkdf(rendezvous, LABELS.mailbox));
  const outerKey = await aesKey(await hkdf(rendezvous, LABELS.outer));
  return { mailbox, outerKey };
}

/**
 * AES-256-GCM, IV prefixed. `aad` is authenticated but not encrypted; we pass the direction
 * label, so a frame cannot be replayed back at its own sender.
 *
 * 96-bit random IVs are safe to about 2^32 messages under one key; at Appendix X's 30-second
 * sync interval that is longer than the company will exist, and the session key is fresh on
 * every connection anyway.
 *
 * @param {CryptoKey} key @param {Bytes} plaintext @param {string} aad
 * @param {() => Bytes} randomBytes injected — nothing in runtime/ calls crypto.getRandomValues
 *        directly, so a test can replay a session byte for byte
 */
export async function seal(key, plaintext, aad, randomBytes) {
  const iv = randomBytes(IV_BYTES);
  if (!(iv instanceof Uint8Array) || iv.length !== IV_BYTES) {
    throw new SyncError(`sync: randomBytes(${IV_BYTES}) must return ${IV_BYTES} bytes`);
  }
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, plaintext,
  ));
  return concatBytes(iv, ct);
}

/**
 * The inverse. Throws `SyncError` on anything that does not authenticate — which includes every
 * byte a hostile relay could invent, since it holds no key.
 * @param {CryptoKey} key @param {Bytes} frame @param {string} aad @returns {Promise<Bytes>}
 */
export async function unseal(key, frame, aad) {
  if (!(frame instanceof Uint8Array) || frame.length <= IV_BYTES) {
    throw new SyncError('sync: sealed frame is too short to contain an IV and a tag');
  }
  const iv = frame.subarray(0, IV_BYTES);
  const ct = frame.subarray(IV_BYTES);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, ct,
    );
    return new Uint8Array(pt);
  } catch {
    // Deliberately no detail: distinguishing "wrong key" from "tampered tag" is an oracle.
    throw new SyncError('sync: sealed frame did not authenticate');
  }
}

/** Is an ephemeral X25519 exchange available on this platform? */
export async function x25519Available() {
  try {
    const kp = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']);
    return kp && kp.privateKey ? true : false;
  } catch {
    return false;
  }
}

// =======================================================================================
// The handshake
// =======================================================================================
//
// Symmetric: both peers send one sealed hello and consume the other's. The introduction decides
// who is 'host' (the peer that showed the QR code) and who is 'guest' (the peer that scanned it).
// The role is inside the signed transcript and each side refuses a hello carrying its OWN role,
// which is what stops a relay from reflecting a frame back and being taken for the peer.
//
// The transcript a signature covers:
//     LABELS.hello ‖ string(mailbox) ‖ string(role) ‖ string(ephemeralPublic) ‖ string(identityRaw)
// `sshString` framing (length-prefixed, from runtime/identity/ed25519.js) is what makes that
// unambiguous — no field can be shifted into another.

/** @param {string} mailbox @param {string} role @param {Bytes} eph @param {Bytes} identityRaw */
function helloTranscript(mailbox, role, eph, identityRaw) {
  return concatBytes(
    utf8(LABELS.hello),
    sshString(mailbox), sshString(role), sshString(eph), sshString(identityRaw),
  );
}

/**
 * Build this peer's hello. Exported because the tamper tests need to forge one.
 * @param {{ identity: {publicKey:CryptoKey, privateKey:CryptoKey}, mailbox: string,
 *           role: 'host'|'guest', ephemeralPublic: Bytes|null }} o
 */
export async function buildHello(o) {
  if (!ROLES.includes(o.role)) throw new SyncError(`sync: role must be one of ${ROLES.join(', ')}`);
  const identityRaw = await exportPublicRaw(o.identity);
  const eph = o.ephemeralPublic ?? new Uint8Array(0);
  const sig = await signRaw(o.identity, helloTranscript(o.mailbox, o.role, eph, identityRaw));
  return {
    v: 1,
    role: o.role,
    eph: b64encode(eph),
    key: await exportPublicSsh(o.identity),
    sig: b64encode(sig),
  };
}

/**
 * Check a hello. Every refusal is by name (Principle 6) and none of them guesses.
 * @param {unknown} raw
 * @param {{ mailbox:string, expectRole:'host'|'guest', expectKeyRaw?:Bytes|null }} o
 * @returns {Promise<{ role:string, ephemeralPublic:Bytes, identityRaw:Bytes, identitySsh:string }>}
 */
export async function verifyHello(raw, o) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SyncError('sync: hello must be a JSON object');
  }
  const m = /** @type {any} */ (raw);
  if (m.v !== 1) throw new SyncError(`sync: hello version ${JSON.stringify(m.v)} is not 1`);
  if (m.role !== o.expectRole) {
    throw new SyncError(
      `sync: hello claims role '${String(m.role)}', expected '${o.expectRole}'`
      + ' — a peer may not hold the same role as we do (reflection)',
    );
  }
  for (const field of ['key', 'sig']) {
    if (typeof m[field] !== 'string' || m[field] === '') {
      throw new SyncError(`sync: hello is missing '${field}'`);
    }
  }
  // `eph` may be the EMPTY string, and that is not a missing field — it is a peer saying "this
  // platform has no WebCrypto X25519, so I have no ephemeral key to offer". It is still covered by
  // the signature (as a zero-length `sshString`), so a relay cannot strip a real one and produce
  // this. openSealed then refuses the session unless the caller waived forward secrecy explicitly.
  //
  // This was a defect, found by test/sync-sealed.test.js: requiring `eph` to be non-empty made the
  // entire `allowNoForwardSecrecy` path unreachable — the option existed and the branch it enabled
  // could never be entered, on any platform. A half-capability, exactly the shape §Zero Tech Debt
  // warns about.
  if (typeof m.eph !== 'string') throw new SyncError("sync: hello is missing 'eph'");
  const eph = b64decode(m.eph);
  if (eph.length !== X25519_PUBLIC_BYTES && eph.length !== 0) {
    throw new SyncError(`sync: hello ephemeral key is ${eph.length} bytes, expected ${X25519_PUBLIC_BYTES}`);
  }
  const parsed = parsePublicSsh(m.key);
  if (o.expectKeyRaw && !bytesEqual(parsed.raw, o.expectKeyRaw)) {
    throw new SyncError(
      'sync: the peer that answered is not the peer the introduction named'
      + ' — refusing rather than trusting the relay about who is on the other end',
    );
  }
  const sig = b64decode(m.sig);
  const ok = await verifyRaw(
    await importPublicRaw(parsed.raw), sig,
    helloTranscript(o.mailbox, m.role, eph, parsed.raw),
  );
  if (!ok) throw new SyncError('sync: hello signature does not verify');
  return { role: m.role, ephemeralPublic: eph, identityRaw: parsed.raw, identitySsh: m.key };
}

/**
 * Run the handshake over a ByteLink and return a sealed PeerLink.
 *
 * `allowNoForwardSecrecy` defaults to FALSE. On a platform without WebCrypto X25519 the honest
 * options are "refuse" and "continue with less". Standing rule 4 says ask what happens when
 * nothing applies, and the answer here is fail closed: a caller that would rather sync than have
 * forward secrecy has to say so, in code, once — and the returned session says
 * `forwardSecrecy: false` so a UI can put it on screen.
 *
 * @param {{ link: ByteLink,
 *           identity: {publicKey:CryptoKey, privateKey:CryptoKey},
 *           rendezvous: Bytes,
 *           role: 'host'|'guest',
 *           expectPeerKeyRaw?: Bytes|null,
 *           randomBytes: (n:number) => Bytes,
 *           allowNoForwardSecrecy?: boolean,
 *           timeoutMs?: number,
 *           timers?: { setTimer(fn:()=>void, ms:number):unknown, clearTimer(h:unknown):void } }} o
 * @returns {Promise<{ link: PeerLink, peerIdentityRaw: Bytes, peerIdentitySsh: string,
 *                     mailbox: string, forwardSecrecy: boolean, stats(): object }>}
 */
export async function openSealed(o) {
  const { mailbox, outerKey } = await rendezvousFrom(o.rendezvous);
  if (!ROLES.includes(o.role)) throw new SyncError(`sync: role must be one of ${ROLES.join(', ')}`);
  const peerRole = o.role === 'host' ? 'guest' : 'host';
  const randomBytes = o.randomBytes;
  if (typeof randomBytes !== 'function') {
    throw new SyncError('sync: openSealed needs an injected randomBytes(n)');
  }

  const fs = await x25519Available();
  if (!fs && o.allowNoForwardSecrecy !== true) {
    throw new SyncError(
      'sync: this platform has no WebCrypto X25519, so an ephemeral key exchange is impossible '
      + 'and the session would inherit the QR code\'s secret with no forward secrecy. Pass '
      + 'allowNoForwardSecrecy: true to accept that deliberately.',
    );
  }

  /** @type {CryptoKeyPair|null} */
  let ephemeral = null;
  /** @type {Bytes} */
  let ephemeralPublic = new Uint8Array(0);
  if (fs) {
    ephemeral = /** @type {CryptoKeyPair} */ (
      await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']));
    ephemeralPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  }

  // ---- exchange the sealed hellos -------------------------------------------------------
  /** @type {(v:any)=>void} */ let resolveHello;
  /** @type {(e:Error)=>void} */ let rejectHello;
  const gotHello = new Promise((res, rej) => { resolveHello = res; rejectHello = rej; });

  /** frames that arrive after the handshake and before the sealed link is wired @type {Bytes[]} */
  const early = [];
  /** Has the peer's hello been consumed? Declared before the handler that reads it. */
  let handshakeDone = false;
  /** Serialises the (async) sealing of outgoing frames, so per-link order is preserved. */
  let sendChain = Promise.resolve();
  /** @type {((frame:string)=>void)[]} */
  const frameHandlers = [];
  let sessionState = /** @type {null|{sendKey:CryptoKey, recvKey:CryptoKey, sendAad:string, recvAad:string}} */ (null);
  const counters = { sent: 0, received: 0, undecryptable: 0, bytesOut: 0, bytesIn: 0 };
  /** @type {((err:Error)=>void)[]} */
  const errorHandlers = [];
  const raise = (err) => { for (const h of errorHandlers) h(err); };

  o.link.onBytes((bytes) => {
    if (sessionState === null) {
      // Still handshaking. The first frame is the hello; anything after it is the peer being
      // eager, which is legal — hold it and deliver once the keys exist.
      if (handshakeDone) { early.push(bytes); return; }
      handshakeDone = true;
      unseal(outerKey, bytes, LABELS.outer)
        .then((pt) => verifyHello(JSON.parse(fromUtf8(pt)), {
          mailbox, expectRole: peerRole, expectKeyRaw: o.expectPeerKeyRaw ?? null,
        }))
        .then(resolveHello, rejectHello);
      return;
    }
    counters.received += 1;
    counters.bytesIn += bytes.length;
    unseal(sessionState.recvKey, bytes, sessionState.recvAad).then(
      (pt) => {
        const frame = fromUtf8(pt);
        for (const h of frameHandlers) h(frame);
      },
      (err) => {
        // A hostile or broken relay can inject bytes; a peer must not die of it. Counted and
        // reported, never silently dropped (Principle 6), never fatal.
        counters.undecryptable += 1;
        raise(err);
      },
    );
  });

  const myHello = await buildHello({
    identity: o.identity, mailbox, role: o.role, ephemeralPublic: fs ? ephemeralPublic : null,
  });
  o.link.send(await seal(outerKey, utf8(JSON.stringify(myHello)), LABELS.outer, randomBytes));

  const timeoutMs = o.timeoutMs ?? 0;
  let timer = null;
  const peer = await (timeoutMs > 0 && o.timers
    ? Promise.race([
      gotHello,
      new Promise((_, rej) => {
        timer = o.timers.setTimer(
          () => rej(new SyncError(`sync: no hello from the peer within ${timeoutMs} ms`)), timeoutMs,
        );
      }),
    ])
    : gotHello);
  if (timer !== null && o.timers) o.timers.clearTimer(timer);

  // ---- derive the session keys ----------------------------------------------------------
  const hostEph = o.role === 'host' ? ephemeralPublic : peer.ephemeralPublic;
  const guestEph = o.role === 'host' ? peer.ephemeralPublic : ephemeralPublic;
  const myRaw = await exportPublicRaw(o.identity);
  const hostKey = o.role === 'host' ? myRaw : peer.identityRaw;
  const guestKey = o.role === 'host' ? peer.identityRaw : myRaw;
  // The salt binds both ephemerals AND both identities, so neither side can be talked into a
  // session with a key it did not see (unknown-key-share).
  const salt = await sha256(concatBytes(
    utf8(mailbox), sshString(hostEph), sshString(guestEph),
    sshString(hostKey), sshString(guestKey),
  ));

  // Whether THIS SESSION has forward secrecy, which is not the same question as whether the
  // platform could provide it: a peer may have offered no ephemeral key. Reporting the platform
  // capability here would put "forward secrecy: yes" on screen for a session that has none, which
  // is the one thing a security indicator must never do.
  const sessionFs = fs && peer.ephemeralPublic.length === X25519_PUBLIC_BYTES;

  let h2g;
  let g2h;
  if (sessionFs) {
    const peerEph = await crypto.subtle.importKey(
      'raw', peer.ephemeralPublic, { name: 'X25519' }, false, [],
    );
    const shared = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'X25519', public: peerEph }, /** @type {CryptoKeyPair} */ (ephemeral).privateKey, 256,
    ));
    // An all-zero shared secret means a small-order peer key. Refuse rather than proceed.
    if (shared.every((b) => b === 0)) {
      throw new SyncError('sync: X25519 produced an all-zero shared secret (a degenerate peer key)');
    }
    h2g = await aesKey(await hkdf(shared, LABELS.hostToGuest, salt));
    g2h = await aesKey(await hkdf(shared, LABELS.guestToHost, salt));
  } else {
    if (o.allowNoForwardSecrecy !== true) {
      throw new SyncError(
        'sync: the peer offered no ephemeral key, so this session would have no forward secrecy',
      );
    }
    h2g = await aesKey(await hkdf(o.rendezvous, LABELS.fallbackHostToGuest, salt));
    g2h = await aesKey(await hkdf(o.rendezvous, LABELS.fallbackGuestToHost, salt));
  }

  sessionState = o.role === 'host'
    ? { sendKey: h2g, recvKey: g2h, sendAad: LABELS.hostToGuest, recvAad: LABELS.guestToHost }
    : { sendKey: g2h, recvKey: h2g, sendAad: LABELS.guestToHost, recvAad: LABELS.hostToGuest };

  // Anything the peer sent while we were deriving keys.
  const queued = early.splice(0, early.length);

  /** @type {PeerLink & {onError(h:(e:Error)=>void):void, stats():object, forwardSecrecy:boolean}} */
  const link = {
    id: hex(peer.identityRaw),
    send(frame) {
      if (typeof frame !== 'string') throw new TypeError('PeerLink.send: frame must be a string');
      const state = sessionState;
      if (state === null) throw new SyncError('sync: link is closed');
      counters.sent += 1;
      // Sealing is async and PeerLink.send is not. Ordering per link is preserved by chaining.
      sendChain = sendChain
        .then(() => seal(state.sendKey, utf8(frame), state.sendAad, randomBytes))
        .then((bytes) => { counters.bytesOut += bytes.length; o.link.send(bytes); })
        .catch(raise);
    },
    onFrame(handler) {
      if (typeof handler !== 'function') throw new TypeError('onFrame: handler must be a function');
      frameHandlers.push(handler);
      for (const bytes of queued.splice(0, queued.length)) {
        unseal(sessionState.recvKey, bytes, sessionState.recvAad).then(
          (pt) => { const f = fromUtf8(pt); for (const h of frameHandlers) h(f); },
          (err) => { counters.undecryptable += 1; raise(err); },
        );
      }
    },
    close() {
      sessionState = null;
      frameHandlers.length = 0;
      o.link.close();
    },
    onError(handler) { errorHandlers.push(handler); },
    stats() { return { ...counters, forwardSecrecy: sessionFs, platformX25519: fs }; },
    forwardSecrecy: sessionFs,
  };

  return {
    link,
    peerIdentityRaw: peer.identityRaw,
    peerIdentitySsh: peer.identitySsh,
    mailbox,
    /** THIS session's property, not the platform's. See the note above `sessionFs`. */
    forwardSecrecy: sessionFs,
    /** The platform's capability, so a UI can tell "we cannot" from "the peer would not". */
    platformX25519: fs,
    stats: () => ({ ...counters, forwardSecrecy: sessionFs, platformX25519: fs }),
  };
}

// =======================================================================================
// Multiplexing — one connection, many documents, plus the Truth Layer
// =======================================================================================
//
// session.js's frame is `JSON.stringify(Envelope[])` and an Envelope carries a FIELD but no
// document identity: the loopback transport assumes one document per mesh. A real peer link
// carries every open document and the git exchange at once, so the routing has to live
// somewhere — and the cheapest correct place is the channel name, not the frame.
//
// A muxed frame is `<channel>\0<frame>`. A JSON string can never contain a raw NUL (JSON.stringify
// escapes it as \0), so the separator is unambiguous and costs no re-encoding of the payload.
// Every sub-link is a PeerLink, exactly the three methods, so nothing above knows this exists.

export const CHANNEL_SEPARATOR = '\u0000';

/** The channel name for one document's live session. */
export function liveChannel(entity, id) {
  if (typeof entity !== 'string' || entity === '' || typeof id !== 'string' || id === '') {
    throw new SyncError('sync: liveChannel needs a non-empty entity and id');
  }
  if (entity.includes(CHANNEL_SEPARATOR) || id.includes(CHANNEL_SEPARATOR)) {
    throw new SyncError('sync: entity and id must not contain NUL');
  }
  return `live:${entity}/${id}`;
}

/** The one channel the Truth Layer (git) exchange uses. */
export const TRUTH_CHANNEL = 'truth';

/**
 * Split one PeerLink into named PeerLinks.
 *
 * `onError` exists because this handler runs inside somebody else's promise chain: throwing here
 * would surface as an unhandled rejection three layers away instead of as a diagnosis. A frame
 * with no channel prefix is still never ignored (Principle 6) — with no `onError` it throws.
 *
 * @param {PeerLink} link
 * @param {{ onError?: (err: Error) => void }} [opts]
 * @returns {{ channel(name:string): PeerLink, onChannel(h:(name:string, link:PeerLink)=>void):void,
 *             names(): string[], close(): void }}
 */
export function mux(link, opts = {}) {
  /** @type {Map<string, {handlers:((f:string)=>void)[], queue:string[]}>} */
  const channels = new Map();
  /** @type {((name:string, sub:any)=>void)[]} */
  const openHandlers = [];
  let closed = false;

  /** @param {string} name */
  function entry(name) {
    let e = channels.get(name);
    if (e === undefined) { e = { handlers: [], queue: [] }; channels.set(name, e); }
    return e;
  }

  link.onFrame((frame) => {
    const at = typeof frame === 'string' ? frame.indexOf(CHANNEL_SEPARATOR) : -1;
    if (at < 0) {
      // Not ours. Refused, never guessed at (Principle 6) — reported where a caller can see it.
      const err = new SyncError('sync: muxed frame has no channel prefix');
      if (opts.onError) { opts.onError(err); return; }
      throw err;
    }
    const name = frame.slice(0, at);
    const payload = frame.slice(at + 1);
    const fresh = !channels.has(name);
    const e = entry(name);
    if (fresh && openHandlers.length > 0) {
      for (const h of openHandlers) h(name, channel(name));
    }
    if (e.handlers.length === 0) { e.queue.push(payload); return; }
    for (const h of e.handlers) h(payload);
  });

  /** @param {string} name @returns {PeerLink} */
  function channel(name) {
    if (typeof name !== 'string' || name === '' || name.includes(CHANNEL_SEPARATOR)) {
      throw new SyncError('sync: channel name must be a non-empty string without NUL');
    }
    const e = entry(name);
    return {
      id: `${link.id}#${name}`,
      send(frame) {
        if (typeof frame !== 'string') throw new TypeError('PeerLink.send: frame must be a string');
        if (closed) return;
        link.send(name + CHANNEL_SEPARATOR + frame);
      },
      onFrame(handler) {
        if (typeof handler !== 'function') throw new TypeError('onFrame: handler must be a function');
        e.handlers.push(handler);
        for (const f of e.queue.splice(0, e.queue.length)) handler(f);
      },
      close() { e.handlers.length = 0; },
    };
  }

  return {
    channel,
    onChannel(handler) {
      if (typeof handler !== 'function') throw new TypeError('onChannel: handler must be a function');
      openHandlers.push(handler);
      for (const name of channels.keys()) handler(name, channel(name));
    },
    names: () => [...channels.keys()].sort(),
    close() { closed = true; channels.clear(); link.close(); },
  };
}

/**
 * The default source of randomness: the platform's. Injected everywhere else so that tests are
 * reproducible; this is the one place the real thing is named.
 * @param {number} n @returns {Bytes}
 */
export function platformRandomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}
