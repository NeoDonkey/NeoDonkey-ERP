// runtime/sync/signalling.js — how two peers find each other, and what the relay is allowed to be.
//
// Appendix X is normative and this file is written against the sentence, not around it:
//   "The relay sees nothing, decides nothing, stores nothing — it only forwards encrypted bytes,
//    replaceable like any postal transit station."
//
// So the protocol is deliberately the smallest thing that can work:
//
//   • A peer connects to `<relay>/b/<mailbox>`, where the mailbox is a hash of the rendezvous
//     secret from the QR code (runtime/sync/sealed.js). Two peers per mailbox; a third is refused.
//   • BINARY frames are peer↔peer payload. The relay forwards them byte for byte to the other
//     occupant and never looks inside. It cannot: they are AES-GCM sealed under a key derived from
//     a secret the relay has never seen.
//   • TEXT frames are relay↔peer control, and there are exactly three of them, all from the relay:
//     `ready` (your partner is here), `gone` (your partner left), `full` (this mailbox has two).
//     A client that sends a text frame is disconnected — the relay has no client-driven verbs at
//     all, which is what makes "decides nothing" checkable rather than asserted.
//
// Using the frame *opcode* to separate control from payload is the point: the relay never parses
// a byte it forwards, so there is no code path in which it could learn something. `relay.mjs`
// imports the constants below rather than restating them, so client and server cannot drift.
//
// WHAT A RELAY OPERATOR CAN STILL LEARN, stated plainly because the alternative is shipping it
// silently: the mailbox id (a hash of a secret, so it links to no key and to no company), the two
// source IP addresses, connection times, and byte counts. That is exactly "these two endpoints
// exchanged N bytes" and no more — no repo id, no public key, no commit id, no document. The IP
// correlation is unavoidable for any relay and is only removable by a network-level mitigation
// (VPN, Tor), which is outside this file and is named in docs/COMPROMISES.md rather than hidden.
//
// No node:*. The client half runs in a browser on `globalThis.WebSocket`; the server half is
// `relay.mjs`, which is a host-side tool like `serve.mjs`.

import {
  SyncError, openSealed, mux, platformRandomBytes, rendezvousFrom,
} from './sealed.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {import('./sealed.js').ByteLink} ByteLink */
/** @typedef {import('./sealed.js').PeerLink} PeerLink */

/** The path a mailbox lives at. One definition, imported by relay.mjs. */
export const MAILBOX_PATH_PREFIX = '/b/';
/** A mailbox id is 32 bytes of HKDF output, hex. */
export const MAILBOX_ID_PATTERN = /^[0-9a-f]{64}$/;
/** Two peers per mailbox. A third is refused rather than silently ignored. */
export const MAILBOX_CAPACITY = 2;

/** Every control message the relay may send, and there are no others. */
export const CONTROL = Object.freeze({
  ready: 'ready',
  gone: 'gone',
  full: 'full',
});

/** WebSocket close codes this protocol uses, so both halves agree on the reason. */
export const CLOSE = Object.freeze({
  normal: 1000,
  unsupportedData: 1003,
  policyViolation: 1008,
  mailboxFull: 4001,
  badMailbox: 4002,
});

/**
 * The URL for a mailbox on a relay. Exported so that the introduction carries a relay *base*
 * and nobody has to know the path scheme twice.
 * @param {string} relay e.g. `wss://relay.neodonkey.eu` or `ws://127.0.0.1:8787`
 * @param {string} mailbox 64 hex characters
 */
export function mailboxUrl(relay, mailbox) {
  if (typeof relay !== 'string' || relay === '') throw new SyncError('sync: relay address is empty');
  if (!MAILBOX_ID_PATTERN.test(mailbox)) {
    throw new SyncError('sync: mailbox id must be 64 lower-case hex characters');
  }
  if (!/^wss?:\/\//.test(relay)) {
    throw new SyncError(`sync: relay address must start with ws:// or wss://, got ${JSON.stringify(relay)}`);
  }
  return `${relay.replace(/\/+$/, '')}${MAILBOX_PATH_PREFIX}${mailbox}`;
}

/**
 * The inverse, for the server. Returns null for anything that is not a mailbox path — the relay
 * answers 404 to those rather than guessing.
 * @param {string} path a request path, possibly with a query string
 * @returns {string|null}
 */
export function mailboxFromPath(path) {
  if (typeof path !== 'string') return null;
  const clean = path.split('?')[0];
  if (!clean.startsWith(MAILBOX_PATH_PREFIX)) return null;
  const id = clean.slice(MAILBOX_PATH_PREFIX.length);
  return MAILBOX_ID_PATTERN.test(id) ? id : null;
}

/**
 * A ByteLink over a relay WebSocket.
 *
 * Resolves once the relay says the *partner* is present (`ready`), not merely when the socket
 * opens — because the relay stores nothing, so a frame sent into an empty mailbox is gone. That
 * is the one place the "stores nothing" rule shows up as a constraint on the client, and it is
 * cheaper than giving the relay a buffer and a retention policy.
 *
 * @param {{ url: string,
 *           WebSocketImpl?: any,
 *           timers?: { setTimer(fn:()=>void, ms:number):unknown, clearTimer(h:unknown):void },
 *           timeoutMs?: number,
 *           onGone?: () => void,
 *           onError?: (err: Error) => void }} o
 * @returns {Promise<ByteLink & {socket:any}>}
 */
export function relaySocket(o) {
  const Impl = o.WebSocketImpl ?? globalThis.WebSocket;
  if (typeof Impl !== 'function') {
    throw new SyncError(
      'sync: no WebSocket implementation. A browser has one; Node has had a global WebSocket '
      + 'since 22. Pass WebSocketImpl if you need to inject one.',
    );
  }
  return new Promise((resolve, reject) => {
    const socket = new Impl(o.url);
    try { socket.binaryType = 'arraybuffer'; } catch { /* some implementations refuse; handled below */ }

    /** @type {((bytes:Bytes)=>void)[]} */
    const byteHandlers = [];
    /** frames that arrived before anybody was listening — never dropped @type {Bytes[]} */
    const queue = [];
    let settled = false;
    let timer = null;
    const clear = () => { if (timer !== null && o.timers) o.timers.clearTimer(timer); timer = null; };

    /** @type {ByteLink & {socket:any}} */
    const link = {
      id: o.url,
      socket,
      send(bytes) {
        if (!(bytes instanceof Uint8Array)) {
          throw new TypeError('relaySocket.send: expected a Uint8Array');
        }
        // A copy, because some WebSocket implementations keep the view and we hand out subarrays.
        socket.send(bytes.slice().buffer);
      },
      onBytes(handler) {
        if (typeof handler !== 'function') throw new TypeError('onBytes: handler must be a function');
        byteHandlers.push(handler);
        for (const b of queue.splice(0, queue.length)) handler(b);
      },
      close() { try { socket.close(CLOSE.normal); } catch { /* already gone */ } },
      bufferedAmount: () => socket.bufferedAmount ?? 0,
    };

    const fail = (err) => {
      if (!settled) { settled = true; clear(); reject(err); return; }
      if (o.onError) o.onError(err);
    };

    socket.onerror = () => fail(new SyncError(`sync: relay connection to ${o.url} failed`));
    socket.onclose = (ev) => {
      const code = ev && typeof ev.code === 'number' ? ev.code : 0;
      if (!settled) {
        fail(new SyncError(
          code === CLOSE.mailboxFull
            ? 'sync: that mailbox already has two peers — an introduction is for exactly one pair'
            : `sync: the relay closed the connection before the peer arrived (code ${code})`,
          { code },
        ));
        return;
      }
      if (o.onGone) o.onGone();
    };
    socket.onmessage = async (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        // Control. Exactly three verbs; anything else is a relay we do not understand.
        let msg;
        try { msg = JSON.parse(data); } catch { fail(new SyncError('sync: relay sent unparseable control text')); return; }
        if (msg && msg.t === CONTROL.ready) {
          if (!settled) { settled = true; clear(); resolve(link); }
          return;
        }
        if (msg && msg.t === CONTROL.gone) {
          if (o.onGone) o.onGone();
          return;
        }
        if (msg && msg.t === CONTROL.full) {
          fail(new SyncError('sync: that mailbox already has two peers'));
          return;
        }
        fail(new SyncError(`sync: relay sent an unknown control verb ${JSON.stringify(msg && msg.t)}`));
        return;
      }
      let bytes;
      if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else if (data instanceof Uint8Array) bytes = data;
      else if (data && typeof data.arrayBuffer === 'function') bytes = new Uint8Array(await data.arrayBuffer());
      else { fail(new SyncError('sync: relay delivered a frame of an unexpected type')); return; }
      if (byteHandlers.length === 0) { queue.push(bytes); return; }
      for (const h of byteHandlers) h(bytes);
    };

    if (o.timeoutMs && o.timers) {
      timer = o.timers.setTimer(() => {
        link.close();
        fail(new SyncError(`sync: no peer joined the mailbox within ${o.timeoutMs} ms`));
      }, o.timeoutMs);
    }
  });
}

/**
 * The whole client side of "two peers find each other and can talk", in one call.
 *
 * @param {{ relay: string, rendezvous: Bytes, mailbox?: string,
 *           identity: {publicKey:CryptoKey, privateKey:CryptoKey},
 *           role: 'host'|'guest',
 *           expectPeerKeyRaw?: Bytes|null,
 *           randomBytes?: (n:number)=>Bytes,
 *           WebSocketImpl?: any,
 *           timers?: object, timeoutMs?: number,
 *           allowNoForwardSecrecy?: boolean,
 *           onGone?: () => void, onError?: (e:Error)=>void }} o
 * @returns {Promise<{ link: PeerLink, channels: ReturnType<typeof mux>,
 *                     peerIdentityRaw: Bytes, peerIdentitySsh: string, mailbox: string,
 *                     forwardSecrecy: boolean, close(): void, stats(): object }>}
 */
export async function connectRelay(o) {
  const { mailbox } = await rendezvousFrom(o.rendezvous);
  if (o.mailbox !== undefined && o.mailbox !== mailbox) {
    throw new SyncError('sync: the mailbox given does not match the rendezvous secret');
  }
  const raw = await relaySocket({
    url: mailboxUrl(o.relay, mailbox),
    WebSocketImpl: o.WebSocketImpl,
    timers: o.timers,
    timeoutMs: o.timeoutMs,
    onGone: o.onGone,
    onError: o.onError,
  });
  const sealed = await openSealed({
    link: raw,
    identity: o.identity,
    rendezvous: o.rendezvous,
    role: o.role,
    expectPeerKeyRaw: o.expectPeerKeyRaw ?? null,
    randomBytes: o.randomBytes ?? platformRandomBytes,
    allowNoForwardSecrecy: o.allowNoForwardSecrecy,
    timeoutMs: o.timeoutMs,
    timers: o.timers,
  });
  const channels = mux(sealed.link, { onError: o.onError });
  return {
    link: sealed.link,
    channels,
    peerIdentityRaw: sealed.peerIdentityRaw,
    peerIdentitySsh: sealed.peerIdentitySsh,
    mailbox: sealed.mailbox,
    forwardSecrecy: sealed.forwardSecrecy,
    close() { channels.close(); raw.close(); },
    stats: sealed.stats,
  };
}

// =======================================================================================
// The signalling channel — SDP offers and ICE candidates, over the sealed link
// =======================================================================================
//
// WebRTC needs an out-of-band channel to exchange an offer, an answer and ICE candidates. Ours is
// a mux channel on the already-sealed relay connection, which has a consequence worth stating: the
// SDP — which contains the peers' local and reflexive IP addresses — is encrypted end to end, so
// the relay does not learn the network topology of the company. A signalling server that reads SDP
// knows where every machine is. Ours cannot.

export const SIGNAL_CHANNEL = 'signal';

/**
 * JSON messages over one channel. Deliberately not a state machine: `webrtc.js` owns the
 * offer/answer sequence, this owns only the encoding.
 *
 * `onError` exists for the same reason `mux`'s does: this handler runs inside somebody else's
 * promise chain (the sealed link's decrypt), so throwing here would surface as an unhandled
 * rejection three layers away instead of as a diagnosis, and would take the connection with it.
 * A malformed frame is still never ignored (Principle 6) — with no `onError` it throws.
 *
 * @param {PeerLink} link
 * @param {{ onError?: (err: Error) => void }} [opts]
 */
export function signalChannel(link, opts = {}) {
  /** @type {((msg:any)=>void)[]} */
  const handlers = [];
  /** Messages that arrived before anybody was listening. Queued, never dropped — every other
   * layer in this file does the same, and an offer that arrives one turn early is an offer. */
  const queue = [];
  link.onFrame((frame) => {
    let msg;
    try { msg = JSON.parse(frame); } catch {
      const err = new SyncError('sync: signalling frame is not JSON');
      if (opts.onError) { opts.onError(err); return; }
      throw err;
    }
    if (handlers.length === 0) { queue.push(msg); return; }
    for (const h of handlers) h(msg);
  });
  return {
    send(msg) { link.send(JSON.stringify(msg)); },
    onMessage(handler) {
      if (typeof handler !== 'function') throw new TypeError('onMessage: handler must be a function');
      handlers.push(handler);
      for (const msg of queue.splice(0, queue.length)) handler(msg);
    },
    close() { link.close(); },
  };
}
