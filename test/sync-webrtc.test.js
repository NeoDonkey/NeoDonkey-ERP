// test/sync-webrtc.test.js — the direct path, and an honest statement of what Node cannot execute.
//
// WHAT THIS FILE PROVES. `webrtcLink()` is a `PeerLink` in the full sense session.js requires: two
// Live-Layer sessions converge across a pair of adapted data channels, `converged()` says so, and
// the queueing, coercion and refusal behaviour is exercised frame by frame. `connectWebrtc()` runs
// its entire offer/answer/ICE sequence against an injected fake `RTCPeerConnection`, including the
// out-of-order candidate case, the unexpected-channel refusal and the ICE-failure path.
//
// WHAT THIS FILE CANNOT PROVE, and no test in Node can. Node has no `RTCPeerConnection`, so what is
// NOT executed anywhere is:
//
//   • real ICE — STUN binding requests, candidate gathering, connectivity checks, nomination;
//   • real DTLS — the handshake, the certificate fingerprints in the SDP, the SRTP keying;
//   • real SCTP — the data-channel association, `maxMessageSize` negotiation, and whether
//     `{ordered:false, maxRetransmits:0}` behaves as documented in Chrome, Firefox and Safari;
//   • real NAT traversal — the entire question of whether two machines on two home networks can
//     reach each other at all, which is the only interesting question about WebRTC in production.
//
// Everything in the list is a browser-and-network property. Nothing below claims otherwise, and
// `runtime/sync/webrtc.js` therefore KEEPS its entry in test/wired.test.js's UNFINISHED list. The
// path that IS proven end to end between two operating-system processes is the relay data path —
// test/sync-relay.test.js — which needs no WebRTC at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  webrtcLink, connectWebrtc, LIVE_CHANNEL_INIT, TRUTH_CHANNEL_INIT,
  LIVE_CHANNEL_LABEL, TRUTH_CHANNEL_LABEL, MAX_MESSAGE_BYTES, SIGNAL_CHANNEL,
} from '../runtime/sync/webrtc.js';
import { SyncError } from '../runtime/sync/sealed.js';
import { session, converged } from '../runtime/live/session.js';

// ---------------------------------------------------------------------------------------------
// the fakes
// ---------------------------------------------------------------------------------------------

/**
 * A fake `RTCDataChannel` with the surface `webrtcLink` uses and nothing more.
 *
 * `readyState` starts at 'connecting', exactly as a real one does, because "a caller gets its link
 * before ICE has finished" is the case the adapter exists to handle.
 */
function fakeChannel(label = LIVE_CHANNEL_LABEL) {
  const ch = {
    label,
    readyState: 'connecting',
    bufferedAmount: 0,
    /** @type {any[]} */
    sent: [],
    /** @type {any} */
    paired: null,
    send(data) {
      if (ch.readyState !== 'open') throw new Error('InvalidStateError: channel is not open');
      ch.sent.push(data);
      if (ch.paired && ch.paired.onmessage) ch.paired.onmessage({ data });
    },
    close() { ch.readyState = 'closed'; if (ch.onclose) ch.onclose(); },
    /** Test-only: pretend ICE finished. */
    open() {
      ch.readyState = 'open';
      if (ch.onopen) ch.onopen({});
    },
    /** Test-only: hand something up as if the peer had sent it. */
    arrive(data) { if (ch.onmessage) ch.onmessage({ data }); },
  };
  return ch;
}

/** Two fake channels wired to each other. */
function fakeChannelPair(label = LIVE_CHANNEL_LABEL) {
  const a = fakeChannel(label);
  const b = fakeChannel(label);
  a.paired = b;
  b.paired = a;
  return { a, b };
}

/**
 * A fake `RTCPeerConnection` factory, with two instances able to find each other.
 *
 * The SDP is a plain JSON object carrying the originator's id, because the real signalling path
 * (`signalChannel`) JSON-serialises every message — so a fake that passed object references would
 * be testing a code path the product does not have.
 */
function fakeRtcNetwork() {
  /** @type {Map<string, any>} */
  const peers = new Map();
  let next = 0;

  class FakePeerConnection {
    constructor(config) {
      this.id = `pc-${++next}`;
      this.config = config;
      this.connectionState = 'new';
      this.localDescription = null;
      this.remoteDescription = null;
      /** @type {Map<string, any>} */
      this.channels = new Map();
      /** @type {any[]} */
      this.addedCandidates = [];
      this.closed = false;
      peers.set(this.id, this);
    }

    createDataChannel(label, init) {
      const ch = fakeChannel(label);
      ch.init = init;
      this.channels.set(label, ch);
      return ch;
    }

    async createOffer() {
      return { type: 'offer', from: this.id, channels: [...this.channels.keys()] };
    }

    async createAnswer() {
      return { type: 'answer', from: this.id };
    }

    async setLocalDescription(d) {
      this.localDescription = d;
      // A real connection gathers candidates asynchronously and ends with a null candidate. On a
      // later macrotask, so the description is signalled before its candidates — which is the
      // order a browser produces and the order a reader expects to see in the log.
      setTimeout(() => {
        if (this.onicecandidate) {
          this.onicecandidate({ candidate: { candidate: `candidate:1 from ${this.id}`, toJSON() { return { candidate: this.candidate }; } } });
          this.onicecandidate({ candidate: null });
        }
      }, 0);
    }

    async setRemoteDescription(d) {
      this.remoteDescription = d;
      if (d.type === 'offer') {
        // The answerer learns about the offerer's channels through ondatachannel, exactly as the
        // real API does — it never has to agree on labels separately.
        for (const label of d.channels ?? []) {
          const ch = fakeChannel(label);
          this.channels.set(label, ch);
          if (this.ondatachannel) this.ondatachannel({ channel: ch });
        }
        return;
      }
      // The answer came back: both sides now know each other, so the association comes up.
      const other = peers.get(d.from);
      if (!other) return;
      this.connectionState = 'connected';
      other.connectionState = 'connected';
      for (const [label, mine] of this.channels) {
        const theirs = other.channels.get(label);
        if (!theirs) continue;
        mine.paired = theirs;
        theirs.paired = mine;
      }
      // Open in a later turn, so nothing depends on the open happening inside setRemoteDescription.
      queueMicrotask(() => {
        for (const [label, mine] of this.channels) {
          const theirs = other.channels.get(label);
          mine.open();
          if (theirs) theirs.open();
        }
        if (this.onconnectionstatechange) this.onconnectionstatechange();
        if (other.onconnectionstatechange) other.onconnectionstatechange();
      });
    }

    async addIceCandidate(c) { this.addedCandidates.push(c); }

    close() { this.closed = true; this.connectionState = 'closed'; }

    /** Test-only: ICE gave up. */
    fail() {
      this.connectionState = 'failed';
      if (this.onconnectionstatechange) this.onconnectionstatechange();
    }
  }

  return { Rtc: FakePeerConnection, peers };
}

/** A `PeerLink` pair for the signalling channel, delivering on the microtask queue. */
function signalPair() {
  /** @type {Map<string, ((f:string)=>void)[]>} */
  const handlers = new Map([['a', []], ['b', []]]);
  /** @type {Map<string, string[]>} */
  const queues = new Map([['a', []], ['b', []]]);
  /** @type {{from:string, msg:any}[]} */
  const log = [];
  let dropCandidatesUntilAnswer = false;
  /** @type {{to:string, frame:string}[]} */
  const held = [];

  const deliver = (to, frame) => {
    const list = handlers.get(to);
    if (list.length === 0) { queues.get(to).push(frame); return; }
    for (const h of list) h(frame);
  };

  const end = (self, peer) => ({
    id: peer,
    send(frame) {
      log.push({ from: self, msg: JSON.parse(frame) });
      const t = JSON.parse(frame).t;
      // Reorder the network: candidates before the description, which is the ordinary case in the
      // real world and the reason connectWebrtc keeps an early-candidate queue.
      if (dropCandidatesUntilAnswer && t === 'candidate') { held.push({ to: peer, frame }); return; }
      queueMicrotask(() => deliver(peer, frame));
      if (t === 'answer') {
        dropCandidatesUntilAnswer = false;
        for (const h of held.splice(0)) queueMicrotask(() => deliver(h.to, h.frame));
      }
    },
    onFrame(handler) {
      handlers.get(self).push(handler);
      for (const f of queues.get(self).splice(0)) handler(f);
    },
    close() { handlers.set(self, []); },
  });

  return {
    a: end('a', 'b'),
    b: end('b', 'a'),
    log,
    types: () => log.map((e) => e.msg.t),
    reorderCandidates() { dropCandidatesUntilAnswer = true; },
    /** Deliver an arbitrary message to one side, as a hostile or broken peer would. */
    inject(to, msg) { deliver(to, typeof msg === 'string' ? msg : JSON.stringify(msg)); },
  };
}

/**
 * Wait on a CONDITION, never on a duration — the rest of this suite learned that the hard way (a
 * relay test that slept on timers was flaky under load and took minutes). Gives up after 10 s so a
 * hang is a failure rather than a stalled suite.
 */
async function until(predicate, why, budgetMs = 10_000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) assert.fail(`${why} (waited ${budgetMs} ms)`);
    await new Promise((r) => setTimeout(r, 1));
  }
}

// ---------------------------------------------------------------------------------------------
// 1. the adapter — RTCDataChannel → PeerLink
// ---------------------------------------------------------------------------------------------

test('sends before the channel opens are queued, not dropped and not thrown', async () => {
  const ch = fakeChannel();
  const link = webrtcLink(ch);
  assert.equal(link.ready(), false);
  assert.equal(link.id, LIVE_CHANNEL_LABEL);

  link.send('op-1');
  link.send('op-2');
  assert.deepEqual(ch.sent, [], 'nothing may reach a connecting channel');
  assert.equal(link.stats().queued, 2);
  assert.equal(link.stats().pendingOut, 2);

  ch.open();
  assert.deepEqual(ch.sent, ['op-1', 'op-2'], 'in order, once ICE finishes');
  assert.equal(link.ready(), true);
  assert.equal(link.stats().sent, 2);
  assert.equal(link.stats().pendingOut, 0);

  link.send('op-3');
  assert.deepEqual(ch.sent, ['op-1', 'op-2', 'op-3']);
  assert.equal(link.stats().sent, 3);
  assert.equal(link.bufferedAmount(), 0);

  // A non-string is a programming error, refused rather than coerced.
  assert.throws(() => link.send(/** @type {any} */ ({})), TypeError);
  assert.throws(() => link.send(/** @type {any} */ (42)), TypeError);
});

test('frames that arrive before a handler is attached are queued, and every wire type is accepted', () => {
  const ch = fakeChannel();
  const link = webrtcLink(ch);
  ch.open();
  // session.receive() is wired one turn after the channel opens, and a peer catching us up sends
  // immediately. Dropping those would break "at least once" at the worst moment.
  ch.arrive('early-1');
  ch.arrive('early-2');
  assert.equal(link.stats().pendingIn, 2);

  /** @type {string[]} */
  const got = [];
  link.onFrame((f) => got.push(f));
  assert.deepEqual(got, ['early-1', 'early-2']);
  assert.equal(link.stats().pendingIn, 0);

  // A DataChannel may hand back a string, an ArrayBuffer or a Uint8Array depending on binaryType
  // and on the sender. All three are frames; nothing else is.
  const bytes = new TextEncoder().encode('from-bytes');
  ch.arrive('from-string');
  ch.arrive(bytes.buffer.slice(0));
  ch.arrive(bytes);
  assert.deepEqual(got.slice(2), ['from-string', 'from-bytes', 'from-bytes']);
  assert.equal(link.stats().received, 5);

  assert.throws(() => ch.arrive(42), /which is not a frame/);
  assert.throws(() => ch.arrive(null), /which is not a frame/);
  assert.equal(link.stats().refused, 2);
  assert.throws(() => link.onFrame(/** @type {any} */ ('nope')), TypeError);
});

test('a Blob — Firefox\'s default binaryType — is decoded rather than refused', async () => {
  const ch = fakeChannel();
  const link = webrtcLink(ch);
  ch.open();
  /** @type {string[]} */
  const got = [];
  link.onFrame((f) => got.push(f));
  const bytes = new TextEncoder().encode('from-a-blob');
  ch.arrive({ arrayBuffer: async () => bytes.buffer.slice(0) });
  await until(() => got.length === 1, 'a Blob must be decoded and delivered');
  assert.deepEqual(got, ['from-a-blob']);

  // And a Blob that fails to read is reported through onError, never swallowed.
  /** @type {Error[]} */
  const errors = [];
  const ch2 = fakeChannel();
  const link2 = webrtcLink(ch2, { onError: (e) => errors.push(e) });
  ch2.open();
  ch2.arrive({ arrayBuffer: async () => { throw new Error('blob is gone'); } });
  await until(() => errors.length === 1, 'a Blob that cannot be read must be reported');
  assert.match(errors[0].message, /blob is gone/);
  assert.equal(link2.stats().refused, 1);
});

test('close() stops the link in both directions, and a channel error is reported', () => {
  const ch = fakeChannel();
  /** @type {Error[]} */
  const errors = [];
  const link = webrtcLink(ch, { id: 'live', onError: (e) => errors.push(e) });
  assert.equal(link.id, 'live');
  ch.open();
  /** @type {string[]} */
  const got = [];
  link.onFrame((f) => got.push(f));

  ch.onerror({ type: 'error' });
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof SyncError);
  assert.match(errors[0].message, /data channel 'neodonkey-live' errored/);

  link.close();
  assert.equal(ch.readyState, 'closed');
  assert.equal(link.ready(), false);
  link.send('after close');       // silently dropped: the link is gone, and that is not an error
  assert.deepEqual(ch.sent, []);
  ch.arrive('after close');
  assert.deepEqual(got, [], 'a closed link delivers nothing');
  link.close();                   // idempotent

  // Without an onError, an error throws rather than disappearing.
  const ch2 = fakeChannel();
  webrtcLink(ch2);
  assert.throws(() => ch2.onerror({}), SyncError);
  assert.throws(() => webrtcLink(null), /needs an RTCDataChannel/);
  assert.throws(() => webrtcLink({}), /needs an RTCDataChannel/);
});

test('the two channel configurations are what the module argues for, and say so in one place', () => {
  // The brief's default was {ordered:false, maxRetransmits:null}. `null` converts to 0 through
  // WebIDL's `unsigned short`, so it is written as 0 — nobody should have to know the coercion rule.
  assert.deepEqual(LIVE_CHANNEL_INIT, { ordered: false, maxRetransmits: 0 });
  assert.deepEqual(TRUTH_CHANNEL_INIT, { ordered: true });
  assert.equal(Object.isFrozen(LIVE_CHANNEL_INIT), true);
  assert.equal(Object.isFrozen(TRUTH_CHANNEL_INIT), true);
  assert.equal(LIVE_CHANNEL_LABEL, 'neodonkey-live');
  assert.equal(TRUTH_CHANNEL_LABEL, 'neodonkey-truth');
  assert.equal(MAX_MESSAGE_BYTES, 16 * 1024);
  assert.equal(SIGNAL_CHANNEL, 'signal');
});

// ---------------------------------------------------------------------------------------------
// 2. the adapter is good enough for the Live Layer — the only test that matters about it
// ---------------------------------------------------------------------------------------------

test('two sessions converge across a pair of adapted data channels', () => {
  const { a: chA, b: chB } = fakeChannelPair();
  const linkA = webrtcLink(chA, { id: 'A' });
  const linkB = webrtcLink(chB, { id: 'B' });

  const doc = { id: 'LS-2027-0033', entity: 'delivery-note', status: 'draft', deliveryDate: '12.11.', notes: '', quantity: 12 };
  let t = 1_000;
  const a = session(doc, 'A', () => (t += 1));
  const b = session(doc, 'B', () => (t += 1));
  linkA.onFrame((f) => a.receive(JSON.parse(f)));
  linkB.onFrame((f) => b.receive(JSON.parse(f)));
  a.onLocalOps((ops) => linkA.send(JSON.stringify(ops)));
  b.onLocalOps((ops) => linkB.send(JSON.stringify(ops)));

  // Both edit while the channels are still connecting: the queue is what makes this survivable.
  a.set('deliveryDate', '15.11.');
  b.set('notes', 'Ware unvollständig');
  b.inc('quantity', -2);
  assert.equal(converged([a, b]), false, 'nothing has been delivered yet');

  chA.open();
  chB.open();

  assert.ok(converged([a, b]), 'once the channels open, the queued ops converge the two sessions');
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(a.snapshot().deliveryDate, '15.11.');
  assert.equal(a.snapshot().notes, 'Ware unvollständig');
  assert.equal(a.snapshot().quantity, 10);
  assert.deepEqual(a.conflicts(), []);

  // Appendix XI's 5% case, over the same transport: both values survive with their authors, and a
  // human's decision propagates. Real concurrency needs the network to be *slow*, so the pairing is
  // cut while both peers type — a synchronous pipe cannot produce a conflict at all, which is
  // exactly the trap the first version of this test fell into.
  const pairedA = chA.paired;
  const pairedB = chB.paired;
  chA.paired = null;
  chB.paired = null;
  a.set('deliveryDate', '16.11.');
  b.set('deliveryDate', '17.11.');
  const withheldFromA = chA.sent.at(-1);
  const withheldFromB = chB.sent.at(-1);
  chA.paired = pairedA;
  chB.paired = pairedB;
  chB.arrive(withheldFromA);
  chA.arrive(withheldFromB);
  assert.equal(a.conflicts().length, 1);
  assert.equal(b.conflicts().length, 1);
  assert.throws(() => a.snapshot(), /unresolved conflict on 'deliveryDate'/);
  a.resolve('deliveryDate', '16.11.');
  assert.deepEqual(a.conflicts(), []);
  assert.deepEqual(b.conflicts(), []);
  assert.ok(converged([a, b]));
  assert.equal(b.snapshot().deliveryDate, '16.11.');

  // Duplication and reordering are what an unreliable unordered channel actually delivers.
  const frames = chA.sent.slice();
  for (const f of [...frames].reverse()) chB.arrive(f);
  for (const f of frames) chB.arrive(f);
  assert.ok(converged([a, b]), 'duplicate and out-of-order delivery must change nothing');
});

// ---------------------------------------------------------------------------------------------
// 3. connectWebrtc — the whole signalling sequence, against an injected fake
// ---------------------------------------------------------------------------------------------

test('two peers exchange offer, answer and candidates, and end up with both channels', async () => {
  const { Rtc } = fakeRtcNetwork();
  const signal = signalPair();
  /** @type {string[]} */
  const states = [];

  const initiator = connectWebrtc({
    signal: signal.a, initiator: true, rtc: Rtc, onStateChange: (s) => states.push(s),
  });
  const answerer = connectWebrtc({ signal: signal.b, initiator: false, rtc: Rtc });
  const [up, down] = await Promise.all([initiator, answerer]);

  for (const side of [up, down]) {
    assert.equal(side.live.id, 'live');
    assert.equal(side.truth.id, 'truth');
    assert.equal(side.live.ready(), true);
    assert.equal(side.truth.ready(), true);
  }
  // The initiator decides the labels and the configuration in one place; the answerer receives them.
  assert.deepEqual([...up.connection.channels.keys()].sort(), [LIVE_CHANNEL_LABEL, TRUTH_CHANNEL_LABEL].sort());
  assert.deepEqual(up.connection.channels.get(LIVE_CHANNEL_LABEL).init, LIVE_CHANNEL_INIT);
  assert.deepEqual(up.connection.channels.get(TRUTH_CHANNEL_LABEL).init, TRUTH_CHANNEL_INIT);

  // The sequence, in order, and nothing else in it. Candidates are gathered on a later turn, as a
  // browser gathers them, so the log is only complete once both ends have added one.
  await until(
    () => up.connection.addedCandidates.length >= 1 && down.connection.addedCandidates.length >= 1,
    'both ends must have exchanged and applied a candidate');
  const types = signal.types();
  assert.equal(types[0], 'offer');
  assert.ok(types.includes('answer'));
  assert.ok(types.includes('candidate'));
  assert.ok(types.includes('candidate-end'));
  assert.deepEqual([...new Set(types)].sort(), ['answer', 'candidate', 'candidate-end', 'offer']);
  assert.ok(up.connection.addedCandidates.length >= 1, 'candidates must actually be added');
  assert.ok(down.connection.addedCandidates.length >= 1);

  // Appendix X's relay is for bytes, not for STUN: no ICE server is contacted unless a company
  // supplies one, because a silent probe to a Google STUN server is Principle 2 leaking.
  assert.deepEqual(up.connection.config.iceServers, []);

  // The two links carry the Live Layer and the Truth Layer separately.
  /** @type {string[]} */
  const atDown = [];
  down.live.onFrame((f) => atDown.push(f));
  /** @type {string[]} */
  const truthAtDown = [];
  down.truth.onFrame((f) => truthAtDown.push(f));
  up.live.send('[{"field":"notes"}]');
  up.truth.send('{"t":"refs?"}');
  await until(() => atDown.length === 1 && truthAtDown.length === 1,
    'the live and truth channels must both carry their frame');
  assert.deepEqual(atDown, ['[{"field":"notes"}]']);
  assert.deepEqual(truthAtDown, ['{"t":"refs?"}']);

  up.close();
  assert.equal(up.connection.closed, true);
  assert.equal(up.live.ready(), false);
  down.close();
  assert.deepEqual(states.at(-1), 'connected');

  // A caller-supplied STUN/TURN configuration is passed through untouched.
  const custom = fakeRtcNetwork();
  const s2 = signalPair();
  const iceServers = [{ urls: 'stun:stun.company.example:3478' }];
  const pair = await Promise.all([
    connectWebrtc({ signal: s2.a, initiator: true, rtc: custom.Rtc, iceServers }),
    connectWebrtc({ signal: s2.b, initiator: false, rtc: custom.Rtc }),
  ]);
  assert.deepEqual(pair[0].connection.config.iceServers, iceServers);
  pair[0].close();
  pair[1].close();
});

test('candidates that arrive before the description are held, not discarded', async () => {
  // The ordinary case on a real network, and the reason the early-candidate queue exists: a
  // discarded candidate is a connection that silently never comes up.
  const { Rtc } = fakeRtcNetwork();
  const signal = signalPair();
  signal.reorderCandidates();
  const [up, down] = await Promise.all([
    connectWebrtc({ signal: signal.a, initiator: true, rtc: Rtc }),
    connectWebrtc({ signal: signal.b, initiator: false, rtc: Rtc }),
  ]);
  await until(
    () => up.connection.addedCandidates.length >= 1 && down.connection.addedCandidates.length >= 1,
    'the held candidates must be applied once the description arrives, not discarded');
  assert.equal(up.live.ready(), true);
  up.close();
  down.close();
});

test('an unexpected channel, an unknown verb and a failed ICE are each refused by name', async () => {
  // 1. A peer that opens a channel we did not agree on is either a bug or something else entirely.
  const net1 = fakeRtcNetwork();
  const s1 = signalPair();
  const answerer = connectWebrtc({ signal: s1.b, initiator: false, rtc: net1.Rtc });
  s1.inject('b', { t: 'offer', sdp: { type: 'offer', from: 'pc-does-not-exist', channels: ['chat'] } });
  await assert.rejects(() => answerer, /opened an unexpected data channel 'chat'/);

  // 2. An unknown signalling verb (Principle 6 — named, never ignored).
  const net2 = fakeRtcNetwork();
  const s2 = signalPair();
  const pending = connectWebrtc({ signal: s2.b, initiator: false, rtc: net2.Rtc });
  s2.inject('b', { t: 'gossip' });
  await assert.rejects(() => pending, /unknown signalling verb "gossip"/);

  // 3. A message with no type at all.
  const net3 = fakeRtcNetwork();
  const s3 = signalPair();
  const noType = connectWebrtc({ signal: s3.b, initiator: false, rtc: net3.Rtc });
  s3.inject('b', { sdp: 'v=0' });
  await assert.rejects(() => noType, /signalling message has no type/);

  // 4. ICE gave up. The refusal names the fallback, because "connection failed" without one is a
  //    dead end for a user standing in an office with a firewall.
  const net4 = fakeRtcNetwork();
  const s4 = signalPair();
  const failing = connectWebrtc({ signal: s4.a, initiator: true, rtc: net4.Rtc });
  await until(() => net4.peers.size === 1, 'the connection must exist before ICE can fail on it');
  [...net4.peers.values()][0].fail();
  await assert.rejects(() => failing, /ICE failed — no direct path to the peer\. Fall back to the relay\./);

  // 5. Rubbish on the signalling channel.
  const net5 = fakeRtcNetwork();
  const s5 = signalPair();
  /** @type {Error[]} */
  const junkErrors = [];
  const junk = connectWebrtc({
    signal: s5.b, initiator: false, rtc: net5.Rtc, onError: (e) => junkErrors.push(e),
  });
  s5.inject('b', 'not json');
  assert.equal(junkErrors.length, 1);
  assert.match(junkErrors[0].message, /signalling frame is not JSON/);
  // With no onError the same frame is fatal to the connection rather than silent — but it must not
  // throw out of the transport's delivery, because over a sealed mux link that would become an
  // unhandled rejection three layers away. (That is why signalChannel gained an onError.)
  const s6 = signalPair();
  const net6 = fakeRtcNetwork();
  const fatal = connectWebrtc({ signal: s6.b, initiator: false, rtc: net6.Rtc });
  s6.inject('b', 'not json either');
  await assert.rejects(() => fatal, /signalling frame is not JSON/);
  assert.ok(junk instanceof Promise, 'the reported-error connection is still pending, not rejected');
});

test('connectWebrtc times out rather than hanging, with injected timers', async () => {
  const { Rtc } = fakeRtcNetwork();
  const signal = signalPair();
  /** @type {(()=>void)[]} */
  const armed = [];
  const timers = { setTimer: (fn) => { armed.push(fn); return armed.length; }, clearTimer: () => {} };
  const pending = connectWebrtc({
    signal: signal.a, initiator: true, rtc: Rtc, timeoutMs: 10_000, timers,
  });
  await until(() => armed.length === 1, 'a timeout must have been armed');
  armed[0]();
  await assert.rejects(() => pending, /no direct connection within 10000 ms/);
});

test('on a platform with no RTCPeerConnection the refusal names the path that does work', async () => {
  // This is Node, and this assertion is the whole reason webrtc.js keeps its UNFINISHED entry.
  assert.equal(typeof globalThis.RTCPeerConnection, 'undefined',
    'if Node ever grows one, this test becomes executable and the entry can be revisited');
  await assert.rejects(
    () => connectWebrtc({ signal: signalPair().a, initiator: true }),
    (err) => {
      assert.ok(err instanceof SyncError);
      assert.match(err.message, /no RTCPeerConnection on this platform/);
      assert.match(err.message, /use the relay data path/);
      return true;
    });
});
