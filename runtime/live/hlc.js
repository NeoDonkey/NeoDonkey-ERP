// runtime/live/hlc.js — Hybrid Logical Clock.
//
// Manifesto Appendix III, line 123: "LWW-Register (Last-Writer-Wins with Hybrid Logical
// Clock) for simple fields." This file is the clock those registers order themselves by.
//
// Why not the wall clock alone: laptops sleep, users fly to Milan, NTP corrects backwards.
// A wall clock is *not* monotonic, and an ERP that loses a stock movement because a clock
// jumped 3 seconds back is broken in a way nobody notices until inventory day.
// Why not a Lamport counter alone: it carries no human-readable time, and an auditor in
// 2028 (Appendix IX) needs to see when something happened, not just in what order.
//
// A Hybrid Logical Clock gives us both:
//   * it never goes backwards, whatever the wall clock does;
//   * it stays within a few milliseconds of real time under normal conditions;
//   * it yields ONE total order that every peer computes identically, because the node id
//     is the final tiebreaker. Determinism, not luck.
//
// The wall clock is injected (CONTRACT non-negotiable #5). This module never asks the
// system what time it is — it asks the caller. That is what makes the tests exact and
// the "same foreign event -> same commit" claim of Appendix V reachable.
//
// No imports. No node:*. Loads in a browser as-is.

/** @typedef {{ wall:number, counter:number, node:string }} Stamp */

/**
 * The total order on stamps. Pure, deterministic, identical on every peer.
 *
 *   1. wall time     — real time wins, so the order matches human intuition
 *   2. counter       — resolves events inside the same millisecond
 *   3. node id       — resolves genuine concurrency, deterministically
 *
 * Step 3 is the important one: without it, two peers could disagree about which of two
 * simultaneous writes is "later", and then they would never converge. With it, every peer
 * reaches the same answer without talking to anyone. That is Principle 2 (no server) applied
 * to the problem of ordering.
 *
 * @param {Stamp} a
 * @param {Stamp} b
 * @returns {-1|0|1}
 */
export function compareStamps(a, b) {
  assertStamp(a);
  assertStamp(b);
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.node !== b.node) return a.node < b.node ? -1 : 1;
  return 0;
}

/**
 * A stamp's identity as a short string. Used as an op id (see crdt.js) and as an OR-Set tag.
 * Unique across the whole mesh: a node never issues the same (wall, counter) pair twice.
 * Not usable for ordering — use compareStamps for that.
 *
 * @param {Stamp} s
 * @returns {string}
 */
export function stampId(s) {
  assertStamp(s);
  return `${s.wall}.${s.counter}.${s.node}`;
}

/**
 * A hybrid logical clock for one peer.
 *
 * @param {string} nodeId    stable id of this peer (a device/identity, not a user session)
 * @param {() => number} clock   injected wall clock, milliseconds
 * @returns {{ now(): Stamp, observe(remote: Stamp): void,
 *             compare(a: Stamp, b: Stamp): -1|0|1, last(): Stamp }}
 */
export function hlc(nodeId, clock) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) {
    throw new TypeError('hlc: nodeId must be a non-empty string');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('hlc: clock must be a () => number function (injected, never Date.now)');
  }

  // The highest stamp this peer has ever issued or seen. Never decreases.
  let last = { wall: 0, counter: 0, node: nodeId };

  function readWall() {
    const wall = clock();
    if (typeof wall !== 'number' || !Number.isFinite(wall)) {
      throw new TypeError(`hlc: clock() must return a finite number, got ${String(wall)}`);
    }
    // Milliseconds, integral. Refuse fractions rather than silently rounding them
    // (Principle 6: no silent guessing).
    if (!Number.isInteger(wall)) {
      throw new TypeError(`hlc: clock() must return whole milliseconds, got ${wall}`);
    }
    return wall;
  }

  return {
    /**
     * Issue the next stamp for a local event. Strictly greater than every stamp this peer
     * has issued or observed — even if the wall clock just jumped backwards, in which case
     * we keep the old wall time and advance the counter instead.
     */
    now() {
      const wall = readWall();
      if (wall > last.wall) {
        last = { wall, counter: 0, node: nodeId };
      } else {
        // Wall clock stalled or went backwards: logical time carries on regardless.
        last = { wall: last.wall, counter: last.counter + 1, node: nodeId };
      }
      return { ...last };
    },

    /**
     * Fold a stamp received from another peer into this clock, so that anything we do next
     * is ordered *after* what we have just learned. This is what makes causality hold
     * across the mesh without a server.
     */
    observe(remote) {
      assertStamp(remote);
      const wall = readWall();
      const maxWall = Math.max(wall, last.wall, remote.wall);
      let counter;
      if (maxWall === last.wall && maxWall === remote.wall) {
        counter = Math.max(last.counter, remote.counter) + 1;
      } else if (maxWall === last.wall) {
        counter = last.counter + 1;
      } else if (maxWall === remote.wall) {
        counter = remote.counter + 1;
      } else {
        // The wall clock has genuinely moved on past both: restart the counter.
        counter = 0;
      }
      last = { wall: maxWall, counter, node: nodeId };
    },

    /** The total order (see compareStamps). Exposed here because the CONTRACT names it. */
    compare(a, b) {
      return compareStamps(a, b);
    },

    /** The highest stamp issued or observed. For inspection and tests; does not advance. */
    last() {
      return { ...last };
    },
  };
}

/**
 * Refuse a malformed stamp loudly. A stamp arriving from a peer is untrusted input;
 * silently coercing it is how a wrong ordering becomes a wrong invoice.
 * @param {unknown} s
 */
export function assertStamp(s) {
  if (
    s === null ||
    typeof s !== 'object' ||
    typeof (/** @type {any} */ (s).wall) !== 'number' ||
    !Number.isFinite(/** @type {any} */ (s).wall) ||
    typeof (/** @type {any} */ (s).counter) !== 'number' ||
    !Number.isInteger(/** @type {any} */ (s).counter) ||
    typeof (/** @type {any} */ (s).node) !== 'string' ||
    /** @type {any} */ (s).node.length === 0
  ) {
    throw new TypeError(`hlc: not a Stamp: ${JSON.stringify(s) ?? String(s)}`);
  }
}
