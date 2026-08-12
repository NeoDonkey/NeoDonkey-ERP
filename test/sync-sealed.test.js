// test/sync-sealed.test.js — the layer that makes Appendix X's sentence about the relay true.
//
//   "The relay sees nothing, decides nothing, stores nothing — it only forwards encrypted bytes."
//
// A relay operator is not a friend of this test. So the byte pipe below is a HOSTILE relay: it
// records every byte it forwards, and the assertions are written from its point of view — what can
// it read, what can it inject, what can it replay, what can it reflect. If a company's repo id, a
// peer's public key, a document id or an amount can be recovered from the recording, Principle 2
// has failed and this file says so.
//
// Determinism: no Math.random anywhere. The randomness the handshake needs is an injected counter
// PRNG, so a failing run is reproducible from its seed (non-negotiable #5).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SyncError, LABELS, RENDEZVOUS_BYTES, IV_BYTES, X25519_PUBLIC_BYTES,
  hex, unhex, hkdf, sha256, rendezvousFrom, seal, unseal, x25519Available,
  buildHello, verifyHello, openSealed, mux, liveChannel, TRUTH_CHANNEL, CHANNEL_SEPARATOR,
  platformRandomBytes,
} from '../runtime/sync/sealed.js';
import { generateIdentity, exportPublicRaw, utf8, fromUtf8, b64encode, b64decode } from '../runtime/identity/ed25519.js';
import { session, converged } from '../runtime/live/session.js';

// ---------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------

/** A counter PRNG. Not secure and not meant to be — it makes a session byte-reproducible. */
function seededBytes(seed) {
  let x = seed >>> 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      x = (x * 1664525 + 1013904223) >>> 0;
      out[i] = (x >>> 24) & 0xff;
    }
    return out;
  };
}

const RENDEZVOUS = new Uint8Array(RENDEZVOUS_BYTES).map((_, i) => (i * 7 + 3) & 0xff);

/**
 * A hostile relay between two `ByteLink`s.
 *
 * Everything the real relay.mjs can do, this can do: forward, count, delay, drop, duplicate,
 * reflect a frame back at its sender, and inject bytes of its own. Everything it CANNOT do is
 * what the assertions below are about.
 */
function hostileRelay() {
  /** @type {Map<string, ((b:Uint8Array)=>void)[]>} */
  const handlers = new Map();
  /** frames that arrived before their recipient was listening @type {Map<string, Uint8Array[]>} */
  const queues = new Map([['a', []], ['b', []]]);
  /** every byte the relay ever saw, in order @type {{from:string, bytes:Uint8Array}[]} */
  const seen = [];
  let forwarding = true;

  const deliver = (to, bytes) => {
    const list = handlers.get(to) ?? [];
    if (list.length === 0) { queues.get(to).push(bytes); return; }
    for (const h of list) h(bytes);
  };

  const end = (self, peer) => ({
    id: `hostile:${self}`,
    send(bytes) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('ByteLink.send: expected bytes');
      seen.push({ from: self, bytes: bytes.slice() });
      if (!forwarding) return;
      deliver(peer, bytes.slice());
    },
    onBytes(handler) {
      const list = handlers.get(self) ?? [];
      list.push(handler);
      handlers.set(self, list);
      for (const bytes of queues.get(self).splice(0, queues.get(self).length)) handler(bytes);
    },
    close() { handlers.delete(self); },
  });

  return {
    a: end('a', 'b'),
    b: end('b', 'a'),
    seen,
    stop() { forwarding = false; },
    /** Everything the relay could try to read, as one buffer. */
    allBytes() {
      const total = seen.reduce((n, f) => n + f.bytes.length, 0);
      const out = new Uint8Array(total);
      let at = 0;
      for (const f of seen) { out.set(f.bytes, at); at += f.bytes.length; }
      return out;
    },
    /** Inject bytes of the relay's own invention at one peer. */
    inject(at, bytes) { deliver(at, bytes); },
    /** Replay a frame the relay recorded, at whichever peer it likes. */
    replay(index, at) { deliver(at, seen[index].bytes.slice()); },
  };
}

/** Both halves of a sealed session over a hostile relay. */
async function sealedPair(opts = {}) {
  const wire = hostileRelay();
  const host = await generateIdentity({ comment: 'sarah' });
  const guest = await generateIdentity({ comment: 'klein' });
  const [hostSide, guestSide] = await Promise.all([
    openSealed({
      link: wire.a, identity: host, rendezvous: RENDEZVOUS, role: 'host',
      randomBytes: seededBytes(1), ...opts,
    }),
    openSealed({
      link: wire.b, identity: guest, rendezvous: RENDEZVOUS, role: 'guest',
      randomBytes: seededBytes(2), ...opts,
    }),
  ]);
  return { wire, host, guest, hostSide, guestSide };
}

/**
 * Wait until `predicate()` holds, or fail with `why`.
 *
 * Every wait in this file is a CONDITION, never a duration. Two reasons, and the second is the one
 * that matters: `crypto.subtle` resolves off the microtask queue, so a microtask spin returns before
 * a single frame has been sealed (that mistake made every convergence assertion here fail once); and
 * a fixed number of ticks is a bet on how loaded the machine is, which is how a suite stops being
 * evidence. Polls at 1 ms, gives up after 10 s so a hang is a failure rather than a stalled suite.
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
// 1. derivation — what the relay is told
// ---------------------------------------------------------------------------------------------

test('hex/unhex round-trip, and unhex refuses anything that is not lower-case hex', () => {
  const bytes = new Uint8Array([0x00, 0x0f, 0xa0, 0xff]);
  assert.equal(hex(bytes), '000fa0ff');
  assert.deepEqual(unhex('000fa0ff'), bytes);
  for (const bad of ['00F', 'GG', '0', 'AABB', '0x00']) {
    assert.throws(() => unhex(bad), SyncError, `unhex should refuse ${JSON.stringify(bad)}`);
  }
});

test('HKDF is deterministic, label-separated, and refuses empty keying material', async () => {
  const a = await hkdf(RENDEZVOUS, LABELS.outer);
  const b = await hkdf(RENDEZVOUS, LABELS.outer);
  const c = await hkdf(RENDEZVOUS, LABELS.mailbox);
  assert.deepEqual(a, b, 'HKDF must be a function of its inputs only');
  assert.notDeepEqual(a, c, 'two labels must not produce the same key');
  assert.equal(a.length, 32);
  await assert.rejects(() => hkdf(new Uint8Array(0), LABELS.outer), SyncError);
  // Every label is distinct — a collision would silently reuse a key across directions.
  assert.equal(new Set(Object.values(LABELS)).size, Object.values(LABELS).length);
});

test('the mailbox id is all the relay is told, and it is one-way', async () => {
  const { mailbox } = await rendezvousFrom(RENDEZVOUS);
  assert.match(mailbox, /^[0-9a-f]{64}$/);
  // Stable across calls: two peers derive the same mailbox from the same QR code without talking.
  assert.equal((await rendezvousFrom(RENDEZVOUS)).mailbox, mailbox);
  // A different secret is a different mailbox.
  const other = new Uint8Array(RENDEZVOUS_BYTES).fill(9);
  assert.notEqual((await rendezvousFrom(other)).mailbox, mailbox);
  // The mailbox is HKDF output, so it contains no part of the secret.
  assert.equal(hex(RENDEZVOUS).includes(mailbox.slice(0, 16)), false);
  for (const bad of [new Uint8Array(31), new Uint8Array(33), 'nope', null]) {
    await assert.rejects(() => rendezvousFrom(/** @type {any} */ (bad)), SyncError);
  }
});

test('seal/unseal authenticates the direction label, and refuses every tampered frame', async () => {
  const { outerKey } = await rendezvousFrom(RENDEZVOUS);
  const random = seededBytes(7);
  const plain = utf8('an invoice for Müller GmbH, 1500.00 EUR');
  const frame = await seal(outerKey, plain, LABELS.hostToGuest, random);

  assert.deepEqual(await unseal(outerKey, frame, LABELS.hostToGuest), plain);
  // Replayed back at its own sender: the direction label is in the AAD, so it does not open.
  await assert.rejects(() => unseal(outerKey, frame, LABELS.guestToHost), SyncError);
  // Every single byte matters — flip each one in turn and the frame must not authenticate.
  for (let i = 0; i < frame.length; i++) {
    const bent = frame.slice();
    bent[i] ^= 0x01;
    await assert.rejects(() => unseal(outerKey, bent, LABELS.hostToGuest), SyncError,
      `flipping byte ${i} of a sealed frame must be detected`);
  }
  // Truncation, at every length.
  for (let n = 0; n < frame.length; n++) {
    await assert.rejects(() => unseal(outerKey, frame.subarray(0, n), LABELS.hostToGuest), SyncError);
  }
  // The refusal carries no oracle: "wrong key" and "tampered tag" say the same thing.
  const wrong = (await rendezvousFrom(new Uint8Array(RENDEZVOUS_BYTES).fill(1))).outerKey;
  const bent = frame.slice();
  bent[frame.length - 1] ^= 0x80;
  const a = await unseal(outerKey, bent, LABELS.hostToGuest).catch((e) => e.message);
  const b = await unseal(wrong, frame, LABELS.hostToGuest).catch((e) => e.message);
  assert.equal(a, b, 'the refusal must not distinguish a wrong key from a bent tag');

  // An IV that is not IV_BYTES long is a programming error, refused rather than padded.
  await assert.rejects(
    () => seal(outerKey, plain, LABELS.outer, () => new Uint8Array(IV_BYTES - 1)), SyncError);
});

// ---------------------------------------------------------------------------------------------
// 2. the hello — the tamper matrix of the handshake
// ---------------------------------------------------------------------------------------------

test('a hello verifies, and every forgery of one is refused by name', async () => {
  const { mailbox } = await rendezvousFrom(RENDEZVOUS);
  const sarah = await generateIdentity();
  const attacker = await generateIdentity();
  const eph = new Uint8Array(X25519_PUBLIC_BYTES).fill(4);
  const hello = await buildHello({ identity: sarah, mailbox, role: 'host', ephemeralPublic: eph });

  const ok = await verifyHello(hello, { mailbox, expectRole: 'host' });
  assert.deepEqual(ok.identityRaw, await exportPublicRaw(sarah));
  assert.deepEqual(ok.ephemeralPublic, eph);

  /** @param {object} h @param {object} o @param {RegExp} why */
  const refuse = async (h, o, why) => {
    await assert.rejects(() => verifyHello(h, { mailbox, expectRole: 'host', ...o }), (err) => {
      assert.ok(err instanceof SyncError, `expected a SyncError, got ${err}`);
      assert.match(err.message, why);
      return true;
    });
  };

  // 1. REFLECTION. The relay bounces the host's own hello back at it. The role in the signed
  //    transcript is what stops it being taken for the peer.
  await refuse(hello, { expectRole: 'guest' }, /claims role 'host', expected 'guest'/);
  // 2. FORGED SIGNATURE — one bit.
  const sig = b64decode(hello.sig);
  sig[0] ^= 0x01;
  await refuse({ ...hello, sig: b64encode(sig) }, {}, /signature does not verify/);
  // 3. SUBSTITUTED EPHEMERAL KEY under a signature that still verifies for the old one.
  await refuse({ ...hello, eph: b64encode(new Uint8Array(X25519_PUBLIC_BYTES).fill(5)) }, {},
    /signature does not verify/);
  // 4. A DIFFERENT MAILBOX. The mailbox is in the transcript, so a hello cannot be moved.
  await assert.rejects(
    () => verifyHello(hello, { mailbox: hex(new Uint8Array(32).fill(2)), expectRole: 'host' }),
    /signature does not verify/);
  // 5. AN ATTACKER'S OWN, PERFECTLY VALID HELLO. Refused only because the introduction named a
  //    key — which is exactly why `expectPeerKeyRaw` exists and why it is not optional in
  //    connectRelay's caller.
  const theirs = await buildHello({ identity: attacker, mailbox, role: 'host', ephemeralPublic: eph });
  assert.ok(await verifyHello(theirs, { mailbox, expectRole: 'host' }), 'self-signed and valid');
  await refuse(theirs, { expectKeyRaw: await exportPublicRaw(sarah) },
    /not the peer the introduction named/);
  // 6. STRUCTURE. Missing fields, wrong version, wrong shapes — named, never guessed at.
  await refuse({ ...hello, v: 2 }, {}, /version 2 is not 1/);
  for (const field of ['eph', 'key', 'sig']) {
    const { [field]: _drop, ...without } = hello;
    await refuse(without, {}, new RegExp(`missing '${field}'`));
  }
  await refuse({ ...hello, eph: b64encode(new Uint8Array(8)) }, {}, /8 bytes, expected 32/);
  for (const bad of [null, 'x', 42, []]) {
    await assert.rejects(() => verifyHello(/** @type {any} */ (bad), { mailbox, expectRole: 'host' }),
      /must be a JSON object/);
  }
});

// ---------------------------------------------------------------------------------------------
// 3. the sealed session
// ---------------------------------------------------------------------------------------------

test('two peers seal a session, and each learns the other\'s real identity key', async () => {
  const { host, guest, hostSide, guestSide } = await sealedPair();
  assert.deepEqual(hostSide.peerIdentityRaw, await exportPublicRaw(guest));
  assert.deepEqual(guestSide.peerIdentityRaw, await exportPublicRaw(host));
  assert.equal(hostSide.mailbox, guestSide.mailbox);
  assert.equal(hostSide.forwardSecrecy, true);
  assert.equal(guestSide.forwardSecrecy, true);
  assert.ok(await x25519Available(), 'this Node has WebCrypto X25519; the fallback path is not taken');

  /** @type {string[]} */
  const atGuest = [];
  guestSide.link.onFrame((f) => atGuest.push(f));
  hostSide.link.send('hello, Herr Klein');
  await until(() => atGuest.length === 1, 'the guest must receive the host\'s frame');
  assert.deepEqual(atGuest, ['hello, Herr Klein']);

  /** @type {string[]} */
  const atHost = [];
  hostSide.link.onFrame((f) => atHost.push(f));
  guestSide.link.send('received');
  await until(() => atHost.length === 1, 'and the host the guest\'s');
  assert.deepEqual(atHost, ['received']);
});

test('the whole Live Layer converges over a sealed link — the PeerLink contract holds', async () => {
  const { hostSide, guestSide } = await sealedPair();
  const doc = { id: 'LS-2027-0033', entity: 'delivery-note', status: 'draft', deliveryDate: '12.11.', notes: '' };
  let t = 1_000;
  const a = session(doc, 'A', () => (t += 1));
  const b = session(doc, 'B', () => (t += 1));

  // Appendix XI's 95% case, over the sealed transport rather than over an array.
  hostSide.link.onFrame((f) => a.receive(JSON.parse(f)));
  guestSide.link.onFrame((f) => b.receive(JSON.parse(f)));
  a.onLocalOps((ops) => hostSide.link.send(JSON.stringify(ops)));
  b.onLocalOps((ops) => guestSide.link.send(JSON.stringify(ops)));

  a.set('deliveryDate', '15.11.');
  b.set('notes', 'Ware unvollständig');
  await until(() => converged([a, b]) && a.ops().length === 2,
    'two peers over a sealed link must converge');

  assert.ok(converged([a, b]), 'two peers over a sealed link must hold byte-identical op sets');
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(a.snapshot().deliveryDate, '15.11.');
  assert.equal(a.snapshot().notes, 'Ware unvollständig');
  assert.deepEqual(a.conflicts(), []);
});

// ---------------------------------------------------------------------------------------------
// 4. what the relay can learn — Principle 2, from the adversary's seat
// ---------------------------------------------------------------------------------------------

test('the relay sees nothing: no plaintext of any kind is recoverable from what it forwarded', async () => {
  const { wire, host, guest, hostSide, guestSide } = await sealedPair();
  const doc = { id: 'RE-2027-0001', entity: 'invoice', status: 'draft', 'gross-amount': '5949.99 EUR' };
  let t = 5_000;
  const a = session(doc, 'A', () => (t += 1));
  const b = session(doc, 'B', () => (t += 1));
  hostSide.link.onFrame((f) => a.receive(JSON.parse(f)));
  guestSide.link.onFrame((f) => b.receive(JSON.parse(f)));
  a.onLocalOps((ops) => hostSide.link.send(JSON.stringify(ops)));
  b.onLocalOps((ops) => guestSide.link.send(JSON.stringify(ops)));
  a.set('customer', 'Müller GmbH');
  b.set('reference', 'PO-4711');
  await until(() => converged([a, b]) && a.ops().length === 2, 'the two peers must converge first');
  assert.ok(converged([a, b]));

  const forwarded = fromUtf8(wire.allBytes());
  const raw = wire.allBytes();
  const contains = (needle) => forwarded.includes(needle);

  // Business content.
  for (const secret of ['RE-2027-0001', 'invoice', '5949.99', 'Müller GmbH', 'PO-4711',
    'customer', 'reference', 'gross-amount', 'field', 'stamp', 'lww']) {
    assert.equal(contains(secret), false, `the relay could read ${JSON.stringify(secret)}`);
  }
  // Identity. Neither public key crosses the wire in the clear — that is the metadata leak a
  // naive design ships without noticing, and it is why the hello itself is sealed.
  for (const keyRaw of [await exportPublicRaw(host), await exportPublicRaw(guest)]) {
    assert.equal(indexOfBytes(raw, keyRaw), -1, 'a peer public key crossed the relay in the clear');
  }
  // The rendezvous secret itself, obviously, and the mailbox is NOT in the payload either — the
  // relay learns it from the URL, and that is the whole of its routing information.
  assert.equal(indexOfBytes(raw, RENDEZVOUS), -1);
  assert.equal(contains(hostSide.mailbox), false);

  // What it CAN learn, stated as an assertion so the claim is checkable rather than asserted:
  // two endpoints, a frame count, and a byte count.
  const learned = {
    endpoints: new Set(wire.seen.map((f) => f.from)).size,
    frames: wire.seen.length,
    bytes: raw.length,
  };
  assert.equal(learned.endpoints, 2);
  assert.ok(learned.frames >= 4, `expected at least the two hellos and two op frames, saw ${learned.frames}`);
  assert.ok(learned.bytes > 0);
  // And nothing else: every byte it holds is 12 bytes of IV plus AES-GCM ciphertext.
  for (const frame of wire.seen) {
    assert.ok(frame.bytes.length > IV_BYTES + 16, 'every forwarded frame is IV + ciphertext + tag');
  }
});

/** Index of `needle` in `hay`, or -1. Written out because there is no Buffer above this line. */
function indexOfBytes(hay, needle) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

test('the relay decides nothing: injection, replay and reflection cannot corrupt a peer', async () => {
  const { wire, hostSide, guestSide } = await sealedPair();
  /** @type {Error[]} */
  const hostErrors = [];
  /** @type {string[]} */
  const atHost = [];
  hostSide.link.onError((e) => hostErrors.push(e));
  hostSide.link.onFrame((f) => atHost.push(f));
  /** @type {string[]} */
  const atGuest = [];
  guestSide.link.onFrame((f) => atGuest.push(f));

  guestSide.link.send('a real frame');
  await until(() => atHost.length === 1, 'the first real frame must arrive');
  assert.deepEqual(atHost, ['a real frame']);
  const realFrameIndex = wire.seen.length - 1;

  // 1. INJECTION — bytes of the relay's own invention.
  wire.inject('a', new Uint8Array(64).fill(0xab));
  // 2. REPLAY — the same sealed frame again. AES-GCM authenticates it, so it is delivered again;
  //    that is by design and is why every CRDT type in crdt.js is idempotent. The Live Layer, not
  //    the transport, is what makes a duplicate harmless (session.js's stated network contract:
  //    at least once, eventually, in any order).
  wire.replay(realFrameIndex, 'a');
  // 3. REFLECTION — the host's own frame bounced back at it. The direction label is in the AAD,
  //    so it does not decrypt: a relay cannot impersonate the peer by echoing.
  hostSide.link.send('mine');
  await until(() => wire.seen.length > realFrameIndex + 1, 'the host\'s own frame must reach the relay');
  const mineIndex = wire.seen.length - 1;
  wire.replay(mineIndex, 'a');
  await until(() => atHost.length === 2 && hostErrors.length >= 2,
    'the replay must be delivered and the injection and reflection reported');

  assert.deepEqual(atHost, ['a real frame', 'a real frame'],
    'a replayed frame is delivered (idempotent by design); an injected or reflected one is not');
  assert.ok(hostErrors.length >= 2,
    `injection and reflection must each be reported, saw ${hostErrors.length}`);
  for (const err of hostErrors) assert.ok(err instanceof SyncError);
  assert.ok(hostSide.stats().undecryptable >= 2, 'undecryptable frames are counted, never silent');
  // And the peer is still alive after all of it.
  guestSide.link.send('still here');
  await until(() => atHost.length === 3, 'the peer must still be alive after all of it');
  assert.equal(atHost.at(-1), 'still here');
});

test('a peer that offers no ephemeral key is refused unless forward secrecy is waived', async () => {
  // The relay cannot do this; a downgraded or hostile *peer* can. Fail closed (standing rule 4).
  //
  // This test is the reason two defects in sealed.js are fixed rather than shipped: verifyHello
  // used to refuse an EMPTY `eph` as a missing field, which made this whole branch unreachable —
  // `allowNoForwardSecrecy` was an option with no behaviour behind it. And `forwardSecrecy` used to
  // report the platform's capability rather than the session's, so a downgraded session would have
  // displayed "forward secrecy: yes".
  const guest = await generateIdentity();
  const host = await generateIdentity();
  const { mailbox, outerKey } = await rendezvousFrom(RENDEZVOUS);
  const downgraded = await buildHello({ identity: guest, mailbox, role: 'guest', ephemeralPublic: null });
  assert.equal(downgraded.eph, '', 'a peer with no X25519 offers a zero-length ephemeral key');
  // It is still a signed hello: the empty ephemeral is inside the transcript, so a relay cannot
  // strip a real key and produce this.
  assert.ok(await verifyHello(downgraded, { mailbox, expectRole: 'guest' }));

  const attempt = async (allow, seed) => {
    const wire = hostileRelay();
    const opening = openSealed({
      link: wire.a, identity: host, rendezvous: RENDEZVOUS, role: 'host',
      randomBytes: seededBytes(seed), allowNoForwardSecrecy: allow,
    });
    wire.b.onBytes(() => {});
    wire.b.send(await seal(outerKey, utf8(JSON.stringify(downgraded)), LABELS.outer, seededBytes(seed + 1)));
    return opening;
  };

  await assert.rejects(() => attempt(undefined, 30), /no forward secrecy/);
  const opened = await attempt(true, 40);
  assert.equal(opened.forwardSecrecy, false, 'a session with no ephemeral exchange must say so');
  assert.equal(opened.platformX25519, true, 'and must distinguish "we cannot" from "the peer would not"');
  assert.equal(opened.stats().forwardSecrecy, false);
});

test('openSealed refuses a bad role, a missing randomBytes, and times out rather than hanging', async () => {
  const wire = hostileRelay();
  const id = await generateIdentity();
  await assert.rejects(() => openSealed({
    link: wire.a, identity: id, rendezvous: RENDEZVOUS, role: 'referee', randomBytes: seededBytes(1),
  }), /role must be one of host, guest/);
  await assert.rejects(() => openSealed({
    link: wire.a, identity: id, rendezvous: RENDEZVOUS, role: 'host',
  }), /needs an injected randomBytes/);

  // A partner that never answers. Injected timers, so no wall clock is involved.
  /** @type {(()=>void)[]} */
  const fired = [];
  const timers = { setTimer: (fn) => { fired.push(fn); return fired.length; }, clearTimer: () => {} };
  const silent = hostileRelay();
  silent.b.onBytes(() => {});
  const pending = openSealed({
    link: silent.a, identity: id, rendezvous: RENDEZVOUS, role: 'host',
    randomBytes: seededBytes(9), timeoutMs: 5_000, timers,
  });
  await until(() => fired.length === 1, 'a timeout must have been armed');
  fired[0]();
  await assert.rejects(() => pending, /no hello from the peer within 5000 ms/);
});

// ---------------------------------------------------------------------------------------------
// 5. the mux — one connection, many documents, plus the Truth Layer
// ---------------------------------------------------------------------------------------------

test('mux routes by channel, queues before anyone listens, and refuses a frame it cannot route', async () => {
  const { hostSide, guestSide } = await sealedPair();
  const up = mux(hostSide.link);
  /** @type {Error[]} */
  const downErrors = [];
  const down = mux(guestSide.link, { onError: (e) => downErrors.push(e) });

  const liveName = liveChannel('delivery-note', 'LS-2027-0033');
  assert.equal(liveName, 'live:delivery-note/LS-2027-0033');

  // Sent before the far side has attached a handler: queued, never dropped.
  up.channel(liveName).send('op-1');
  up.channel(TRUTH_CHANNEL).send('refs?');
  await until(() => down.names().length === 2, 'both channels must have been seen by the far side');

  /** @type {string[]} */
  const live = [];
  /** @type {string[]} */
  const truth = [];
  down.channel(liveName).onFrame((f) => live.push(f));
  down.channel(TRUTH_CHANNEL).onFrame((f) => truth.push(f));
  assert.deepEqual(live, ['op-1'], 'queued until somebody listened, then delivered');
  assert.deepEqual(truth, ['refs?']);

  // A channel opening is observable, so a peer can react to a document it did not open itself.
  /** @type {string[]} */
  const opened = [];
  down.onChannel((name) => opened.push(name));
  assert.deepEqual(opened.sort(), [TRUTH_CHANNEL, liveName].sort());

  // A payload containing the separator would be ambiguous; JSON.stringify escapes NUL, so it
  // cannot happen by accident — and a channel NAME containing one is refused outright.
  assert.throws(() => up.channel(`bad${CHANNEL_SEPARATOR}name`), SyncError);
  assert.throws(() => up.channel(''), SyncError);
  assert.throws(() => liveChannel('a', `b${CHANNEL_SEPARATOR}c`), SyncError);

  // An unprefixed frame is reported, never guessed at (Principle 6).
  hostSide.link.send('no channel here');
  await until(() => downErrors.length === 1, 'an unprefixed frame must be reported');
  assert.match(downErrors[0].message, /no channel prefix/);

  // Without an onError it throws instead of being swallowed.
  /** @type {(f:string)=>void} */
  let deliverRaw = () => {};
  mux({ id: 'x', send() {}, onFrame(h) { deliverRaw = h; }, close() {} });
  assert.throws(() => deliverRaw('unprefixed'), /no channel prefix/);
});

test('platformRandomBytes is the one place the real generator is named', () => {
  const a = platformRandomBytes(32);
  const b = platformRandomBytes(32);
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
  // The rest of runtime/sync/ takes randomness as a parameter; asserted by the source guard in
  // test/sync-relay.test.js so that a hidden call cannot creep back in.
});

test('sha256 matches the published vector, so the digest under the mailbox is not ours to argue with', async () => {
  assert.equal(hex(await sha256(utf8('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
