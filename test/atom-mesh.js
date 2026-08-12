// test/atom-mesh.js — the harness the three atom-*.test.js files share: a mesh of authority
// members over the loopback `PeerLink`, with explicit delivery and an explicit partition.
//
// Why a shared file rather than three copies: "do not re-derive what you can ask" applies to test
// infrastructure too (see test/_source-guard.js, written after three copies of one guard
// disagreed). This file contains no assertions and proves nothing on its own.
//
// THREE PROPERTIES THIS HARNESS HAS, AND THEY ARE THE REASON THE TESTS ARE EXACT:
//
//  1. NO TIMERS. Nothing is delivered, and no peer thinks, until the test says so. A partition is
//     produced by not delivering, which is what a partition is; healing it is delivering the frames
//     that were queued all along.
//  2. ONE CLOCK PER PEER, DELIBERATELY DISAGREEING. `mesh()` starts the peers hours apart by
//     default. Every test therefore runs against clocks that do not agree, and a verdict that
//     depended on wall-clock agreement between machines would fail here rather than in Milan.
//  3. THE TRANSPORT IS THE PRODUCT'S. `loopbackPipe` from runtime/live/session.js, whose three
//     methods are the whole seam an `RTCDataChannel` implements. Nothing in these tests knows that
//     the transport is loopback, so agent SYNC's WebRTC link replaces it without touching them.

import { loopbackPipe } from '../runtime/live/session.js';
import { hlc } from '../runtime/live/hlc.js';
import { authorityMember, AUTHORITY_NAMESPACE } from '../runtime/truth/authority.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { signPayload, verifyPayload } from '../runtime/identity/sshsig.js';

/**
 * A clock that only ever moves when a test moves it. `advance` is the only mutation, so "time
 * passed" is a line in a test rather than a hope about the scheduler.
 * @param {number} start
 */
export function testClock(start) {
  let t = start;
  return {
    now: () => t,
    advance(ms) { t += ms; return t; },
    fn() { return t; },
  };
}

/** Real Ed25519 identities, one per peer, so the acks are signed rather than asserted. */
export async function peerKeys(peers) {
  /** @type {Map<string, {keyPair:object, publicSsh:string}>} */
  const out = new Map();
  for (const p of peers) {
    const keyPair = await generateIdentity({ comment: p });
    out.set(p, { keyPair, publicSsh: await exportPublicSsh(keyPair, p) });
  }
  return out;
}

/**
 * A fully connected mesh of `authorityMember`s.
 *
 * @param {{
 *   peers: string[],
 *   declarations: Map<string, object>,
 *   offsets?: Record<string, number>,     // each peer's starting clock. Default: hours apart.
 *   available?: (peer:string, key:string, unit:string) => string|null,
 *   keys?: Map<string, {keyPair:object, publicSsh:string}>|null,
 *   signKeys?: Map<string, {keyPair:object, publicSsh:string}>|null,
 * }} o
 */
export function mesh(o) {
  const peers = [...o.peers];
  /** @type {Map<string, ReturnType<typeof testClock>>} */
  const clocks = new Map();
  peers.forEach((p, i) => {
    const offset = o.offsets && o.offsets[p] !== undefined
      ? o.offsets[p]
      // Deliberately absurd: three peers whose clocks disagree by hours, and one of them behind
      // the others. If any comparison in the runtime crossed machines, these numbers would break it.
      : Date.parse('2027-11-03T09:00:00Z') + (i - 1) * 3_600_000 + i * 137;
    clocks.set(p, testClock(offset));
  });

  /** @type {Map<string, object>} */
  const members = new Map();
  /** @type {Map<string, ReturnType<typeof hlc>>} */
  const stamps = new Map();
  /** @type {Map<string, ReturnType<typeof loopbackPipe>>} */
  const pipes = new Map();
  /** @type {Set<string>[]|null} */
  let partitions = null;

  const keys = o.keys ?? null;
  // `signKeys` lets a test give a peer a signing key that is NOT the one the others verify against
  // — the only honest way to check that an unverifiable vote is not counted.
  const signing = o.signKeys ?? keys;
  const signFor = (peer) => (signing
    ? (payload) => signPayload(signing.get(peer).keyPair, payload, AUTHORITY_NAMESPACE)
    : null);
  const verifyAny = keys
    ? async (peer, payload, armored) => {
      const k = keys.get(peer);
      if (!k) return false;
      return verifyPayload(k.publicSsh, payload, armored, AUTHORITY_NAMESPACE);
    }
    : null;

  for (const p of peers) {
    stamps.set(p, hlc(p, clocks.get(p).fn));
    members.set(p, authorityMember({
      self: p,
      clock: clocks.get(p).fn,
      declarations: o.declarations,
      sign: signFor(p),
      verify: verifyAny,
      available: o.available ? (key, unit) => o.available(p, key, unit) : null,
    }));
  }

  for (let i = 0; i < peers.length; i++) {
    for (let j = i + 1; j < peers.length; j++) {
      const a = peers[i];
      const b = peers[j];
      const pipe = loopbackPipe(a, b);
      pipes.set(`${a}|${b}`, pipe);
      members.get(a).attach(pipe.ends[a]);
      members.get(b).attach(pipe.ends[b]);
    }
  }

  /** Can these two exchange frames right now? */
  const reachable = (a, b) => !partitions || partitions.some((g) => g.has(a) && g.has(b));

  return {
    peers,
    members,
    m: (peer) => members.get(peer),
    hlcOf: (peer) => stamps.get(peer),
    stamp: (peer) => stamps.get(peer).now(),
    clock: (peer) => clocks.get(peer),
    keyOf: (peer) => (keys ? keys.get(peer) : null),

    /**
     * Cut the mesh into groups that cannot reach each other. Frames already sent across a boundary
     * are NOT lost — they sit in the pipe until the partition heals, which is what a real network
     * queue does and the reason a "deposed" leader's stale proposal can still arrive later.
     * @param {string[][]|null} groups null ⇒ fully connected again
     */
    partition(groups) {
      partitions = groups ? groups.map((g) => new Set(g)) : null;
    },

    /** Frames sitting in the pipes, whether deliverable or not. */
    pendingFrames() {
      let n = 0;
      for (const [pair, pipe] of pipes) {
        for (const id of pair.split('|')) n += pipe.pendingFor(id);
      }
      return n;
    },

    /**
     * Deliver everything deliverable and let every peer think, until the mesh is quiet.
     *
     * `rounds` bounds it so a protocol bug shows up as a bounded failure rather than a hang. The
     * returned count is frames delivered, which several tests assert on: "nothing crossed the
     * partition" is `0`.
     */
    async settle(rounds = 16) {
      let delivered = 0;
      for (let r = 0; r < rounds; r++) {
        let moved = 0;
        for (const [pair, pipe] of pipes) {
          const [a, b] = pair.split('|');
          if (reachable(a, b)) {
            moved += pipe.flushTo(a);
            moved += pipe.flushTo(b);
          }
        }
        let worked = 0;
        for (const p of peers) worked += await members.get(p).pump();
        delivered += moved;
        if (moved === 0 && worked === 0) break;
      }
      return delivered;
    },
  };
}
