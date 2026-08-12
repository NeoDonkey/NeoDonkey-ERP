// runtime/sync/webrtc.js — the direct path. `RTCDataChannel` → `PeerLink`, plus the setup.
//
// session.js already wrote the whole contract, and it is three methods:
//
//   /** @typedef {{ id: string, send(frame: string): void,
//    *              onFrame(handler: (frame: string) => void): void, close(): void }} PeerLink */
//
// and one requirement on the network: *deliver each frame at least once, eventually, in any
// order*. That is the reason crdt.js's four types are commutative, associative and idempotent, and
// it is why this file is an adapter rather than a protocol. Nothing above `PeerLink` changes.
//
// TWO CHANNELS, AND THE REASON — this is the one place the brief's default is not what we ship.
//
//   `live`  {ordered: false, maxRetransmits: 0}   unreliable, unordered
//   `truth` {ordered: true}                        reliable, ordered (SCTP's default)
//
// The brief said `{ordered: false, maxRetransmits: null}` unless a reason can be shown. Two:
//
//   1. `maxRetransmits: null` is not what it looks like. `RTCDataChannelInit.maxRetransmits` is a
//      WebIDL `unsigned short`, and `null` converts to **0** — so `null` and `0` mean the same
//      thing to a browser, and `0` says it out loud. Written as 0 so nobody has to know the
//      coercion rule to read the line.
//
//   2. The Live Layer tolerates loss; the Truth Layer does not. A CRDT op frame may be dropped
//      because the next scheduled sync resends the whole idempotent op set — loss is repaired by
//      repetition one layer up, which is what "at least once, eventually" actually means in this
//      design (an unreliable DataChannel on its own does NOT promise at-least-once, and pretending
//      otherwise would be the quiet kind of wrong). A packfile has no such property: one lost
//      64 KiB chunk is a corrupt pack, and re-sending the whole pack on every loss is not a
//      protocol, it is a hope. So the git exchange gets a reliable ordered channel and pays the
//      head-of-line blocking, which is invisible to a user because it is not on the keystroke path.
//
// Both are adapted by the same `webrtcLink`, because the adapter has no opinion about reliability —
// that is the DataChannel's configuration, not ours.
//
// No node:*. Runs in a browser. `RTCPeerConnection` is injected so that Node — which has none —
// can run every line of the signalling sequence against a fake, and so that a test can be
// deterministic.
//
// WHAT IS THEREFORE UNEXECUTED, and it is why this file keeps its entry in test/wired.test.js's
// UNFINISHED list: real ICE (STUN, candidate gathering, connectivity checks), real DTLS, real SCTP
// (including whether `{ordered:false, maxRetransmits:0}` behaves as documented in Chrome, Firefox
// and Safari), and real NAT traversal — which is the only interesting question about WebRTC in
// production. No browser has run this file. The path that IS proven between two operating-system
// processes is the relay data path (runtime/sync/signalling.js, test/sync-relay.test.js), which
// needs no WebRTC at all. See test/sync-webrtc.test.js's header for the full list.

import { SyncError } from './sealed.js';
import { SIGNAL_CHANNEL, signalChannel } from './signalling.js';

/** @typedef {import('./sealed.js').PeerLink} PeerLink */

/** The live channel: loss is cheaper than latency, and the CRDTs do not care. */
export const LIVE_CHANNEL_INIT = Object.freeze({ ordered: false, maxRetransmits: 0 });
/** The truth channel: a packfile is not idempotent per frame. SCTP's reliable ordered default. */
export const TRUTH_CHANNEL_INIT = Object.freeze({ ordered: true });
export const LIVE_CHANNEL_LABEL = 'neodonkey-live';
export const TRUTH_CHANNEL_LABEL = 'neodonkey-truth';

/**
 * Chunk size for anything large crossing a DataChannel. 16 KiB is the value every implementation
 * agrees on; above 64 KiB Firefox and Chrome disagree about `maxMessageSize`, and a protocol that
 * works on one browser is not a protocol.
 */
export const MAX_MESSAGE_BYTES = 16 * 1024;

/**
 * Adapt an `RTCDataChannel` to a `PeerLink`.
 *
 * Three things this does beyond renaming methods, each of them a correctness matter rather than a
 * convenience:
 *
 *   • **Sends before `open` are queued, not thrown and not dropped.** A caller gets its link as
 *     soon as the connection exists; ICE may still be finishing. Dropping those frames would break
 *     "at least once" at exactly the moment a user is typing.
 *   • **Frames that arrive before a handler is attached are queued.** `session.receive()` is wired
 *     one turn after the channel opens, and a peer that was waiting to catch us up sends
 *     immediately.
 *   • **Inbound data is coerced to a string.** A `PeerLink` frame is a string; a DataChannel may
 *     hand back `string`, `ArrayBuffer` or `Blob` depending on `binaryType` and on the sender. We
 *     accept all three and refuse anything else by name rather than stringifying an object.
 *
 * @param {any} channel an RTCDataChannel (or anything with that surface)
 * @param {{ id?: string, onError?: (err: Error) => void }} [opts]
 * @returns {PeerLink & { ready(): boolean, bufferedAmount(): number, stats(): object }}
 */
export function webrtcLink(channel, opts = {}) {
  if (!channel || typeof channel.send !== 'function') {
    throw new SyncError('sync: webrtcLink needs an RTCDataChannel');
  }
  /** @type {((frame:string)=>void)[]} */
  const handlers = [];
  /** @type {string[]} */
  const inbox = [];
  /** @type {string[]} */
  const outbox = [];
  let closed = false;
  const counters = { sent: 0, received: 0, queued: 0, refused: 0 };
  const raise = (err) => { if (opts.onError) opts.onError(err); else throw err; };

  const isOpen = () => channel.readyState === 'open';

  const flush = () => {
    while (outbox.length > 0 && isOpen() && !closed) {
      channel.send(outbox.shift());
      counters.sent += 1;
    }
  };

  const deliver = (frame) => {
    counters.received += 1;
    if (handlers.length === 0) { inbox.push(frame); return; }
    for (const h of handlers) h(frame);
  };

  channel.onopen = () => flush();
  channel.onclose = () => { closed = true; };
  channel.onerror = (ev) => {
    raise(new SyncError(`sync: data channel '${channel.label}' errored`, { event: ev }));
  };
  channel.onmessage = (ev) => {
    const data = ev && 'data' in ev ? ev.data : ev;
    if (typeof data === 'string') { deliver(data); return; }
    if (data instanceof ArrayBuffer) { deliver(new TextDecoder().decode(data)); return; }
    if (data instanceof Uint8Array) { deliver(new TextDecoder().decode(data)); return; }
    if (data && typeof data.arrayBuffer === 'function') {
      // A Blob, which is Firefox's default binaryType.
      data.arrayBuffer().then(
        (buf) => deliver(new TextDecoder().decode(buf)),
        (err) => { counters.refused += 1; raise(err); },
      );
      return;
    }
    counters.refused += 1;
    raise(new SyncError(`sync: data channel delivered a ${typeof data}, which is not a frame`));
  };

  return {
    id: opts.id ?? channel.label ?? 'webrtc',
    send(frame) {
      if (typeof frame !== 'string') throw new TypeError('PeerLink.send: frame must be a string');
      if (closed) return;
      if (!isOpen()) { outbox.push(frame); counters.queued += 1; return; }
      channel.send(frame);
      counters.sent += 1;
    },
    onFrame(handler) {
      if (typeof handler !== 'function') throw new TypeError('onFrame: handler must be a function');
      handlers.push(handler);
      for (const frame of inbox.splice(0, inbox.length)) handler(frame);
    },
    close() {
      closed = true;
      handlers.length = 0;
      try { channel.close(); } catch { /* already closed */ }
    },
    ready: () => isOpen() && !closed,
    bufferedAmount: () => channel.bufferedAmount ?? 0,
    stats: () => ({ ...counters, pendingOut: outbox.length, pendingIn: inbox.length }),
  };
}

/**
 * Establish a direct connection and return the two links.
 *
 * The signalling channel is a `PeerLink` — in practice a mux channel on the sealed relay
 * connection (runtime/sync/signalling.js), which means the SDP is encrypted end to end and the
 * relay does not learn the company's network topology. A signalling server that reads SDP knows
 * where every machine is; ours cannot.
 *
 * @param {{ signal: PeerLink,
 *           initiator: boolean,
 *           rtc?: any,
 *           iceServers?: {urls:string|string[]}[],
 *           timers?: { setTimer(fn:()=>void, ms:number):unknown, clearTimer(h:unknown):void },
 *           timeoutMs?: number,
 *           onStateChange?: (state:string) => void,
 *           onError?: (err:Error) => void }} o
 * @returns {Promise<{ live: PeerLink, truth: PeerLink, connection: any, close(): void }>}
 */
export async function connectWebrtc(o) {
  const RTC = o.rtc ?? globalThis.RTCPeerConnection;
  if (typeof RTC !== 'function') {
    throw new SyncError(
      'sync: no RTCPeerConnection on this platform. A browser has one; Node does not. '
      + 'Pass `rtc` to inject one, or use the relay data path (runtime/sync/signalling.js), '
      + 'which needs no WebRTC at all.',
    );
  }
  /** @type {(v:any)=>void} */ let resolveBoth;
  /** @type {(e:Error)=>void} */ let rejectBoth;
  const bothOpen = new Promise((res, rej) => { resolveBoth = res; rejectBoth = rej; });
  /** Anything that goes wrong out of band: reported if the caller asked, fatal otherwise. */
  const fail = (err) => { if (o.onError) o.onError(err); else rejectBoth(err); };

  // Declared before the signalling channel, because a malformed frame may arrive on the very first
  // delivery and has to have somewhere to go other than an unhandled rejection.
  const signal = signalChannel(o.signal, { onError: fail });
  const pc = new RTC({
    // Appendix X's relay is for bytes, not for STUN. A company that wants NAT traversal supplies
    // its own STUN/TURN here; the default is none, because silently sending a probe to a Google
    // STUN server would be Principle 2 leaking out of the bottom of the stack.
    iceServers: o.iceServers ?? [],
  });

  /** @type {Map<string, any>} */
  const channels = new Map();
  /** ICE candidates that arrive before the remote description is set. @type {any[]} */
  const earlyCandidates = [];
  let remoteSet = false;

  const noteChannel = (channel) => {
    if (channel.label !== LIVE_CHANNEL_LABEL && channel.label !== TRUTH_CHANNEL_LABEL) {
      // Refused by name: an unexpected channel is either a bug or a peer running something else.
      rejectBoth(new SyncError(`sync: peer opened an unexpected data channel '${channel.label}'`));
      return;
    }
    channels.set(channel.label, channel);
    const check = () => {
      const live = channels.get(LIVE_CHANNEL_LABEL);
      const truth = channels.get(TRUTH_CHANNEL_LABEL);
      if (live && truth && live.readyState === 'open' && truth.readyState === 'open') {
        resolveBoth({ live, truth });
      }
    };
    if (channel.readyState === 'open') check();
    const previous = channel.onopen;
    channel.onopen = (ev) => { if (typeof previous === 'function') previous(ev); check(); };
  };

  pc.onicecandidate = (ev) => {
    if (ev && ev.candidate) signal.send({ t: 'candidate', candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate });
    else signal.send({ t: 'candidate-end' });
  };
  pc.onconnectionstatechange = () => {
    if (o.onStateChange) o.onStateChange(pc.connectionState);
    if (pc.connectionState === 'failed') {
      rejectBoth(new SyncError('sync: ICE failed — no direct path to the peer. Fall back to the relay.'));
    }
  };
  pc.ondatachannel = (ev) => noteChannel(ev.channel);

  signal.onMessage(async (msg) => {
    try {
      if (!msg || typeof msg.t !== 'string') {
        throw new SyncError('sync: signalling message has no type');
      }
      if (msg.t === 'offer') {
        await pc.setRemoteDescription(msg.sdp ?? msg);
        remoteSet = true;
        for (const c of earlyCandidates.splice(0, earlyCandidates.length)) await pc.addIceCandidate(c);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signal.send({ t: 'answer', sdp: pc.localDescription });
        return;
      }
      if (msg.t === 'answer') {
        await pc.setRemoteDescription(msg.sdp ?? msg);
        remoteSet = true;
        for (const c of earlyCandidates.splice(0, earlyCandidates.length)) await pc.addIceCandidate(c);
        return;
      }
      if (msg.t === 'candidate') {
        if (!remoteSet) { earlyCandidates.push(msg.candidate); return; }
        await pc.addIceCandidate(msg.candidate);
        return;
      }
      if (msg.t === 'candidate-end') return;
      // Principle 6 again: an unknown verb is refused with its name in the message.
      throw new SyncError(`sync: unknown signalling verb ${JSON.stringify(msg.t)}`);
    } catch (err) {
      fail(/** @type {Error} */ (err));
    }
  });

  if (o.initiator) {
    // The initiator creates both channels, so the labels and the configuration are decided in one
    // place. The answerer receives them through `ondatachannel` and never has to agree separately.
    noteChannel(pc.createDataChannel(LIVE_CHANNEL_LABEL, { ...LIVE_CHANNEL_INIT }));
    noteChannel(pc.createDataChannel(TRUTH_CHANNEL_LABEL, { ...TRUTH_CHANNEL_INIT }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    signal.send({ t: 'offer', sdp: pc.localDescription });
  }

  let timer = null;
  const timeoutMs = o.timeoutMs ?? 0;
  const opened = await (timeoutMs > 0 && o.timers
    ? Promise.race([bothOpen, new Promise((_, rej) => {
      timer = o.timers.setTimer(
        () => rej(new SyncError(`sync: no direct connection within ${timeoutMs} ms`)), timeoutMs,
      );
    })])
    : bothOpen);
  if (timer !== null && o.timers) o.timers.clearTimer(timer);

  const live = webrtcLink(opened.live, { id: 'live', onError: o.onError });
  const truth = webrtcLink(opened.truth, { id: 'truth', onError: o.onError });
  return {
    live,
    truth,
    connection: pc,
    close() {
      live.close();
      truth.close();
      try { pc.close(); } catch { /* already closed */ }
    },
  };
}

/** Re-exported so a caller needs one import to set up signalling and WebRTC. */
export { SIGNAL_CHANNEL };
