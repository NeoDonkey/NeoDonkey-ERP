// runtime/truth/reservation.js — reservation events with a TTL, and the storno that voids the
// loser. Appendix VIII's complex case, as records in the repository.
//
// ---------------------------------------------------------------------------------------------
// The record, and why it has no `status` field
// ---------------------------------------------------------------------------------------------
//
// Appendix VIII: "A peer intending to change a scarce resource writes a *reservation event* into
// their Git commit first: 'I am claiming units 001-005 of article X until 14:22'. Other peers see
// this on next sync. If a second peer tried to claim the same units in the meantime, both
// reservation events land — but only the one with the earlier logical timestamp is valid. The
// later reservation is automatically voided via a follow-up storno event when the conflict is
// detected."
//
// So there are two kinds of record and one entity:
//
//   kind "claim"  — I am claiming <quantity> of <unit> of <resource>, granted in term T by peer P
//                   with a majority of electors behind it.
//   kind "void"   — claim X is void, because <reason>. A storno. A NEW record, never a mutation
//                   of the claim, for the same reason FD-5 item 7 gives for a locked period:
//                   a correction is an entry, not an edit.
//
// A claim carries NO status field, deliberately. Status is *derived* from the set of records —
// open unless a void for it exists. A stored status is a second source of truth that two peers
// can disagree about after a merge; a derived one cannot be. This is the same discipline the read
// index follows (a view, never truth).
//
// ---------------------------------------------------------------------------------------------
// The TTL, and the one thing that would have made it a bug
// ---------------------------------------------------------------------------------------------
//
// "until 14:22" is an absolute instant, and an absolute instant means nothing across two machines
// whose clocks differ. So this module splits the idea in two:
//
//   * `lease-ms` — a DURATION. The only thing anybody reasons with. A duration is compared against
//     one machine's own elapsed time (see authority.js), never against another machine's reading.
//   * `expires-advisory` — Appendix VIII's "until 14:22", written for the human who reads the
//     document and for nothing else. The field name says so, in the document, forever. No code in
//     this runtime branches on it, and `auditReservations()` says so out loud if one ever does.
//
// And the authoritative answer to "has it expired?" is not a computation at all. It is a fact:
// the authority (or its elected successor) writes a void record with reason `lease-expired`. One
// peer decides, so one clock is read, so there is nothing for two clocks to disagree about.
// `overdue()` below is what that one peer uses to make the decision; `statusOf()` is what every
// other peer uses to learn it.
//
// Quantities go through runtime/money/quantity.js — FD-1's discipline applies to stock as much as
// to money, and "5 pcs" minus "3 pcs" must not be a float subtraction.

import { compareStamps, stampId, assertStamp } from '../live/hlc.js';
import {
  quantity, toQuantity, add, subtract, compare, zero, sign as signOf, toString as qToString,
} from '../money/quantity.js';

/**
 * The entity reservations live in.
 *
 * A runtime-owned record type, exactly like `SEQUENCE_ENTITY` in sequence.js: the runtime writes
 * it, the model authorises it, and nothing about it is business vocabulary (compare COMPROMISES
 * #13 — `name`, `title`, `label` inside the runtime are the thing Principles 7 and 11 forbid).
 * WHICH business entity a unit refers to is declared, never assumed: a unit is an opaque string
 * the caller supplies, and `stock:berlin-main-warehouse` / `article/ART-4711` are the *company's*
 * words, not ours.
 */
export const RESERVATION_ENTITY = 'reservation';

/** The commit trailer that makes the reservation chain greppable in `git log`, like FD-6's. */
export const RESERVATION_TRAILER_KEY = 'NeoDonkey-Reservation';

const KINDS = new Set(['claim', 'void']);

/** Ids become file names (`documents/reservation/<id>.json`), so keep them boring. */
const safe = (s) => String(s).replace(/[^A-Za-z0-9._@-]+/g, '-');

/**
 * A reservation's id, derived from the Hybrid Logical Clock stamp that produced it.
 *
 * Deterministic: no counter, no clock read, no randomness — the same claim computed twice on two
 * peers is the same id, which is what makes a duplicated delivery idempotent rather than a second
 * reservation. (`stampId` already guarantees a node never issues the same stamp twice.)
 * @param {{wall:number,counter:number,node:string}} stamp
 */
export function reservationId(stamp) {
  assertStamp(stamp);
  return `RES-${safe(stampId(stamp))}`;
}

/** A void's id is derived from the storno's own stamp, so two voids of one claim never collide. */
export function voidId(stamp) {
  assertStamp(stamp);
  return `VOID-${safe(stampId(stamp))}`;
}

// =============================================================================================
// building records
// =============================================================================================

/**
 * A claim record — the reservation event itself.
 *
 * @param {{
 *   resource: string,                 // the authority key, `<resource>:<scope>`
 *   unit: string,                     // what is being claimed, in the company's own words
 *   quantity: string,                 // a canonical quantity token, e.g. "5 pcs"
 *   by: string,                       // the peer that wants it
 *   stamp: {wall:number,counter:number,node:string},
 *   term: number,                     // the authority term it was granted in
 *   grantedBy: string,                // the peer that held the authority
 *   quorum: {voter:string, signature?:string|null}[],
 *   leaseMs: number,
 *   expiresAdvisory?: string|null,    // human-readable only. Never branched on.
 *   note?: string|null,
 * }} o
 * @returns {object} the document, ready to be staged into a commit
 */
export function claimRecord(o) {
  assertStamp(o.stamp);
  const q = toQuantity(o.quantity);           // refuses a Number outright
  if (signOf(q) <= 0) {
    throw new Error(`a reservation claims a positive quantity; ${qToString(q)} is not one.`);
  }
  if (!Number.isInteger(o.leaseMs) || o.leaseMs <= 0) {
    throw new Error(`a reservation needs a declared lease in whole milliseconds, got ${o.leaseMs}.`);
  }
  return {
    entity: RESERVATION_ENTITY,
    id: reservationId(o.stamp),
    kind: 'claim',
    resource: o.resource,
    unit: o.unit,
    quantity: qToString(q),
    'claimed-by': o.by,
    stamp: { wall: o.stamp.wall, counter: o.stamp.counter, node: o.stamp.node },
    term: o.term,
    'granted-by': o.grantedBy,
    quorum: (o.quorum || []).map((a) => ({
      voter: a.voter, ...(a.signature ? { signature: a.signature } : {}),
    })),
    'quorum-evidence': (o.quorum || []).every((a) => a.signature) ? 'signed' : 'unsigned',
    'lease-ms': o.leaseMs,
    ...(o.expiresAdvisory ? { 'expires-advisory': o.expiresAdvisory } : {}),
    ...(o.note ? { note: o.note } : {}),
  };
}

/**
 * A storno record. Appendix VIII's "follow-up storno event".
 *
 * @param {{ claim:string, reason:string, code:string, stamp:object, by:string,
 *           resource:string, unit:string, beatenBy?:string|null }} o
 */
export function voidRecord(o) {
  assertStamp(o.stamp);
  if (typeof o.claim !== 'string' || o.claim === '') {
    throw new Error('a storno must name the reservation it voids.');
  }
  if (typeof o.reason !== 'string' || o.reason === '') {
    throw new Error(`the storno of ${o.claim} must say why, in a sentence a person can read. `
      + 'A void with no reason is how an ERP loses an argument with an auditor.');
  }
  return {
    entity: RESERVATION_ENTITY,
    id: voidId(o.stamp),
    kind: 'void',
    voids: o.claim,
    resource: o.resource,
    unit: o.unit,
    reason: o.reason,
    code: o.code,
    ...(o.beatenBy ? { 'beaten-by': o.beatenBy } : {}),
    'voided-by': o.by,
    stamp: { wall: o.stamp.wall, counter: o.stamp.counter, node: o.stamp.node },
  };
}

/** The trailer for a reservation record, inside the signed commit payload. */
export function reservationTrailer(record) {
  return record.kind === 'void'
    ? `${RESERVATION_TRAILER_KEY}: void ${record.voids} ${record.resource} ${record.unit} ${record.code}`
    : `${RESERVATION_TRAILER_KEY}: claim ${record.id} ${record.resource} ${record.unit} `
      + `${record.quantity.replace(/ /g, '_')} term=${record.term}`;
}

/** Read them back out of a commit message. @returns {object[]} */
export function readReservationTrailers(message) {
  const out = [];
  for (const line of String(message).split('\n')) {
    if (!line.startsWith(`${RESERVATION_TRAILER_KEY}: `)) continue;
    const parts = line.slice(RESERVATION_TRAILER_KEY.length + 2).split(' ');
    if (parts[0] === 'void') {
      out.push({ kind: 'void', voids: parts[1], resource: parts[2], unit: parts[3], code: parts[4] });
    } else if (parts[0] === 'claim') {
      out.push({
        kind: 'claim', id: parts[1], resource: parts[2], unit: parts[3],
        quantity: (parts[4] || '').replace(/_/g, ' '),
        term: Number(String(parts[5] || 'term=0').slice(5)),
      });
    }
  }
  return out;
}

// =============================================================================================
// reading the set of records
// =============================================================================================

/**
 * @typedef {{ claims:Map<string,object>, voids:Map<string,object[]>, stray:object[] }} Ledger
 */

/**
 * Index a set of reservation records. Order-independent by construction: two peers that merged
 * the same commits in different orders build the same ledger.
 * @param {object[]} records
 * @returns {Ledger}
 */
export function ledgerOf(records) {
  /** @type {Map<string,object>} */
  const claims = new Map();
  /** @type {Map<string,object[]>} */
  const voids = new Map();
  const stray = [];
  for (const r of records || []) {
    if (!r || typeof r !== 'object') continue;
    if (r.kind === 'claim') claims.set(r.id, r);
    else if (r.kind === 'void') {
      if (!voids.has(r.voids)) voids.set(r.voids, []);
      voids.get(r.voids).push(r);
    } else stray.push(r);
  }
  return { claims, voids, stray };
}

/**
 * Is this claim still standing?
 *
 * Derived from the records alone — no clock, on purpose. Every peer computes the same answer from
 * the same commits, whatever its clock says. Expiry reaches this function as a *void record*
 * written by the authority, never as a comparison against a foreign timestamp.
 *
 * @param {string} claimId
 * @param {Ledger|object[]} ledgerOrRecords
 * @returns {{ status:'open'|'void'|'unknown', voidedBy:object|null, reason:string|null }}
 */
export function statusOf(claimId, ledgerOrRecords) {
  const l = Array.isArray(ledgerOrRecords) ? ledgerOf(ledgerOrRecords) : ledgerOrRecords;
  if (!l.claims.has(claimId)) {
    return { status: 'unknown', voidedBy: null, reason: `no reservation ${claimId} is on record.` };
  }
  const vs = l.voids.get(claimId);
  if (vs && vs.length) {
    // Deterministic when several voids landed: the earliest logical one is the operative storno.
    const first = [...vs].sort((a, b) => compareStamps(a.stamp, b.stamp))[0];
    return { status: 'void', voidedBy: first, reason: first.reason };
  }
  return { status: 'open', voidedBy: null, reason: null };
}

/**
 * May this reservation be redeemed — that is, may the document that consumes the stock be written?
 *
 * Fails closed on every uncertainty. An abandoned reservation whose lease ran out was voided by
 * the authority, so it is on record as void here and can never be redeemed afterwards, which is
 * exactly the "the abandoned reservation cannot later be redeemed" property.
 *
 * @param {string} claimId
 * @param {Ledger|object[]} ledgerOrRecords
 * @param {{ by?:string|null, resource?:string|null, unit?:string|null }} [expect]
 */
export function redeemable(claimId, ledgerOrRecords, expect = {}) {
  const l = Array.isArray(ledgerOrRecords) ? ledgerOf(ledgerOrRecords) : ledgerOrRecords;
  const s = statusOf(claimId, l);
  if (s.status === 'unknown') {
    return { ok: false, code: 'no-such-reservation', reason:
      `there is no reservation ${claimId} in this repository, so nothing authorises consuming the `
      + 'stock it claims. A scarce resource is consumed against a reservation or not at all.' };
  }
  if (s.status === 'void') {
    return { ok: false, code: 'reservation-void', reason:
      `reservation ${claimId} was voided: ${s.reason} (storno ${s.voidedBy.id}). A voided `
      + 'reservation cannot be redeemed later — the units went back into availability the moment '
      + 'the storno was committed, and something else may already hold them.' };
  }
  const claim = l.claims.get(claimId);
  if (expect.by && claim['claimed-by'] !== expect.by) {
    return { ok: false, code: 'reservation-not-yours', reason:
      `reservation ${claimId} was claimed by ${claim['claimed-by']}, not by ${expect.by}.` };
  }
  if (expect.resource && claim.resource !== expect.resource) {
    return { ok: false, code: 'reservation-other-resource', reason:
      `reservation ${claimId} claims "${claim.resource}", not "${expect.resource}".` };
  }
  if (expect.unit && claim.unit !== expect.unit) {
    return { ok: false, code: 'reservation-other-unit', reason:
      `reservation ${claimId} claims ${claim.unit}, not ${expect.unit}.` };
  }
  return { ok: true, code: null, reason: null, claim };
}

/**
 * Every claim still standing against one unit of one resource.
 * @param {Ledger|object[]} ledgerOrRecords
 * @param {{resource:string, unit:string}} of
 */
export function openClaims(ledgerOrRecords, of) {
  const l = Array.isArray(ledgerOrRecords) ? ledgerOf(ledgerOrRecords) : ledgerOrRecords;
  const out = [];
  for (const claim of l.claims.values()) {
    if (claim.resource !== of.resource || claim.unit !== of.unit) continue;
    if (statusOf(claim.id, l).status !== 'open') continue;
    out.push(claim);
  }
  return out.sort((a, b) => compareStamps(a.stamp, b.stamp));
}

/**
 * What is left to claim: on-hand minus every open claim. Exact decimal arithmetic (FD-1), and it
 * never goes below zero in the *answer* — but it reports when the records themselves imply an
 * over-claim, because silently clamping is how a negative stock becomes invisible.
 *
 * @param {string|object} onHand a quantity token, e.g. "5 pcs"
 * @param {Ledger|object[]} ledgerOrRecords
 * @param {{resource:string, unit:string}} of
 * @returns {{ available:string, claimed:string, overClaimed:boolean, claims:object[] }}
 */
export function availability(onHand, ledgerOrRecords, of) {
  const have = toQuantity(onHand);
  const claims = openClaims(ledgerOrRecords, of);
  let claimed = zero(have.unit);
  for (const c of claims) claimed = add(claimed, toQuantity(c.quantity));
  const left = subtract(have, claimed);
  const negative = signOf(left) < 0;
  return {
    available: negative ? qToString(zero(have.unit)) : qToString(left),
    claimed: qToString(claimed),
    overClaimed: negative,
    claims,
  };
}

/**
 * A claim's id, whichever shape it arrives in: a stored record carries `id`, a live claim-table
 * entry inside `authorityMember` carries `claim`. One accessor, so the collision rule below is
 * literally the same code in the live decision and in the after-the-fact audit.
 * @param {object} c
 */
export function claimIdOf(c) {
  return (c && (c.id ?? c.claim)) ?? '';
}

/** Who wants it. A stored record says `claimed-by`, a live entry says `by`. @param {object} c */
export function claimantOf(c) {
  return (c && (c.by ?? c['claimed-by'])) ?? '(unknown)';
}

/**
 * Appendix VIII's collision rule, as ONE decision over the claims on ONE unit.
 *
 * "Both reservation events land — but only the one with the earlier logical timestamp is valid."
 * Read literally, that is a rule for two claims on an indivisible thing. Stock is not indivisible:
 * with 10 pcs on hand, Berlin's 5 and Munich's 3 must BOTH stand, and a mechanism that serialised
 * them would make every second sale of an article wait out a five-minute lease. So the rule
 * generalises the only way it can without ever exceeding what exists: sort by logical timestamp,
 * admit claims in that order while they still fit, void the rest.
 *
 * With five units on hand, Berlin's 5 and Munich's 3, that is Appendix VIII's own scenario and its
 * own answer: the earlier stands, the later is voided, and the last five units are not sold twice.
 *
 * `onHand` of `null` means "nothing on record says how much exists". Then the unit is treated as
 * indivisible and admits exactly one claim — the fail-closed reading, because a runtime that does
 * not know how much there is must not hand out a second claim on it.
 *
 * Pure, deterministic, identical on every peer: `compareStamps` is a total order every peer
 * computes alone, and the arithmetic is exact decimal (FD-1), never a float subtraction.
 *
 * @param {{stamp:object, quantity?:string, unit?:string, id?:string, claim?:string}[]} claims
 * @param {string|object|null} onHand how much exists, e.g. `"5 pcs"`
 * @returns {{ winners:object[], losers:{claim:object, beatenBy:string, reason:string}[],
 *             taken:string|null, onHand:string|null }}
 */
export function admissiblePrefix(claims, onHand) {
  const sorted = [...(claims || [])].sort((a, b) => compareStamps(a.stamp, b.stamp));
  const winners = [];
  /** @type {{claim:object, beatenBy:string, reason:string}[]} */
  const losers = [];
  const first = () => (winners.length ? winners[0] : null);
  const earlier = () => {
    const w = first();
    return w ? `${claimIdOf(w)} (${claimantOf(w)}, logical time ${stampId(w.stamp)})` : null;
  };

  if (onHand === null || onHand === undefined) {
    for (const c of sorted) {
      if (winners.length === 0) { winners.push(c); continue; }
      losers.push({
        claim: c,
        beatenBy: claimIdOf(first()),
        reason: `${earlier()} already claims ${c.unit}, and nothing on record says how much of it `
          + 'exists — so this runtime treats the unit as indivisible and admits one claim at a '
          + 'time. Appendix VIII: both reservation events land, the earlier logical timestamp is '
          + 'valid, the later is voided.',
      });
    }
    return { winners, losers, taken: null, onHand: null };
  }

  const have = toQuantity(onHand);
  let taken = zero(have.unit);
  for (const c of sorted) {
    let want = null;
    try {
      want = toQuantity(c.quantity);
    } catch (e) {
      losers.push({
        claim: c,
        beatenBy: '',
        reason: `${claimIdOf(c)} does not state a quantity this runtime can add up (${e.message}). `
          + 'A claim on a scarce resource is refused, never counted as zero.',
      });
      continue;
    }
    if (want.unit !== have.unit) {
      losers.push({
        claim: c,
        beatenBy: '',
        reason: `${claimIdOf(c)} claims ${qToString(want)} of ${c.unit}, which is held in `
          + `${have.unit} (${qToString(have)} on hand). Mixed units never combine silently: the `
          + 'model declares the conversion factor, or the claim is refused.',
      });
      continue;
    }
    const after = add(taken, want);
    if (compare(after, have) <= 0) {
      taken = after;
      winners.push(c);
    } else {
      losers.push({
        claim: c,
        beatenBy: claimIdOf(first()),
        reason: first()
          ? `${earlier()} claimed ${qToString(toQuantity(first().quantity))} of ${c.unit} first, `
            + `${qToString(taken)} of ${qToString(have)} is already claimed, and ${claimIdOf(c)} `
            + `wants ${qToString(want)}. Appendix VIII: both reservation events land, the earlier `
            + 'logical timestamp is valid, the later is voided.'
          : `only ${qToString(have)} of ${c.unit} exist and ${claimIdOf(c)} wants `
            + `${qToString(want)}.`,
      });
    }
  }
  return { winners, losers, taken: qToString(taken), onHand: qToString(have) };
}

/**
 * May one arriving claim stand against the claims already live on its unit — and which of those
 * does it displace?
 *
 * This is what the authoritative peer AND every elector call on a proposal (see `authorityMember`
 * in authority.js), so the live decision and `resolveCollisions`'s audit of the merged history are
 * the same rule and cannot drift apart.
 *
 * The `supersedes` list is Appendix VIII's partition case: a claim that arrives late but is
 * logically EARLIER than one already granted wins, and what it displaces is to be voided by a
 * follow-up storno.
 *
 * @param {{live:object[], claim:object, onHand:string|object|null}} o
 * @returns {{granted:boolean, beatenBy:string|null, supersedes:string[], reason:string|null}}
 */
export function admitClaim(o) {
  const id = claimIdOf(o.claim);
  const others = (o.live || []).filter((c) => claimIdOf(c) !== id);
  const { losers } = admissiblePrefix([...others, o.claim], o.onHand);
  const mine = losers.find((l) => claimIdOf(l.claim) === id);
  if (mine) {
    return { granted: false, beatenBy: mine.beatenBy || null, supersedes: [], reason: mine.reason };
  }
  return {
    granted: true,
    beatenBy: null,
    reason: null,
    supersedes: losers.map((l) => claimIdOf(l.claim)),
  };
}

/**
 * Appendix VIII's collision rule, applied to a merged set of records: where two or more open
 * claims on the same unit cannot both be honoured, the earlier logical timestamp wins and the
 * later ones are to be voided.
 *
 * This is the *detection* half; `collisionStornos()` below turns the verdict into the storno
 * records a commit carries.
 *
 * @param {Ledger|object[]} ledgerOrRecords
 * @param {(o:{resource:string, unit:string}) => string|null} onHandOf how much there actually is
 * @returns {{ winners:object[], losers:{claim:object, beatenBy:string, reason:string}[] }}
 */
export function resolveCollisions(ledgerOrRecords, onHandOf) {
  const l = Array.isArray(ledgerOrRecords) ? ledgerOf(ledgerOrRecords) : ledgerOrRecords;
  /** @type {Map<string, object[]>} */
  const byUnit = new Map();
  for (const claim of l.claims.values()) {
    if (statusOf(claim.id, l).status !== 'open') continue;
    const k = `${claim.resource}${claim.unit}`;
    if (!byUnit.has(k)) byUnit.set(k, []);
    byUnit.get(k).push(claim);
  }
  const winners = [];
  /** @type {{claim:object, beatenBy:string, reason:string}[]} */
  const losers = [];
  for (const [k, list] of [...byUnit].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const [resource, unit] = k.split('');
    const verdict = admissiblePrefix(list, onHandOf({ resource, unit }));
    winners.push(...verdict.winners);
    losers.push(...verdict.losers);
  }
  return { winners, losers };
}

// =============================================================================================
// the stornos — the follow-up events Appendix VIII calls for
// =============================================================================================

/**
 * The storno for a reservation whose lease has run out, written by the ONE peer that holds the
 * authority for the resource.
 *
 * Returns null when the lease has NOT run out, so a caller cannot accidentally void a live claim
 * by calling this at the wrong moment: the decision and the record are one step.
 *
 * `nowMs` and `grantedAtMs` must both be readings of the deciding peer's OWN clock — `overdue()`
 * enforces the shape and the module header explains why nothing else is comparable. The reason
 * text records the elapsed duration, never an absolute instant, because a duration is the only
 * time value another machine can check against its own experience.
 *
 * @param {{ claim:object, stamp:object, by:string, nowMs:number, grantedAtMs:number }} o
 * @returns {object|null} a void record, or null if the claim is still alive
 */
export function expiryStorno(o) {
  const claim = o.claim;
  if (!overdue(claim, { nowMs: o.nowMs, grantedAtMs: o.grantedAtMs })) return null;
  const lease = claim['lease-ms'] ?? claim.leaseMs;
  const elapsed = o.nowMs - o.grantedAtMs;
  return voidRecord({
    claim: claim.id ?? claim.claim,
    resource: claim.resource,
    unit: claim.unit,
    code: 'lease-expired',
    by: o.by,
    stamp: o.stamp,
    reason: `the reservation claimed ${claim.quantity} of ${claim.unit} under a lease of ${lease} ms `
      + `and ${elapsed} ms have passed on ${o.by}'s own clock since it was granted. The units are `
      + 'available again, and this reservation can no longer be redeemed. Measured as one clock read '
      + 'twice: no other machine\'s reading takes part in the decision.',
  });
}

/**
 * The stornos Appendix VIII's collision rule calls for over a merged set of records — "the later
 * reservation is automatically voided via a follow-up storno event when the conflict is detected".
 *
 * `stampFor` supplies one fresh logical stamp per storno, from the caller's own Hybrid Logical
 * Clock. This module never reads a clock and never invents a stamp.
 *
 * @param {Ledger|object[]} ledgerOrRecords
 * @param {(o:{resource:string, unit:string}) => string|null} onHandOf
 * @param {{ by:string, stampFor:(claim:object) => object }} o
 * @returns {object[]} void records, in the order the collision rule produced them
 */
export function collisionStornos(ledgerOrRecords, onHandOf, o) {
  const { losers } = resolveCollisions(ledgerOrRecords, onHandOf);
  return losers.map((l) => voidRecord({
    claim: l.claim.id,
    resource: l.claim.resource,
    unit: l.claim.unit,
    code: 'lost-collision',
    beatenBy: l.beatenBy || null,
    reason: l.reason,
    by: o.by,
    stamp: o.stampFor(l.claim),
  }));
}

/**
 * Has a lease run out? For the ONE peer that holds the authority, and nobody else.
 *
 * Both operands are readings of that peer's own clock: `nowMs` is `clock()` now, `grantedAtMs` is
 * `clock()` when it granted (or when it adopted the claim at an election). No foreign timestamp
 * enters. That is the whole trick, and it is why a laptop whose clock is ten minutes off cannot
 * reclaim somebody else's pallet.
 *
 * @param {{leaseMs:number}} claim
 * @param {{nowMs:number, grantedAtMs:number}} local
 */
export function overdue(claim, local) {
  const lease = claim['lease-ms'] ?? claim.leaseMs;
  if (!Number.isInteger(lease) || lease <= 0) {
    throw new Error('overdue: the claim declares no lease duration, so no peer may decide it has '
      + 'expired. Refusing rather than guessing.');
  }
  if (!Number.isFinite(local.nowMs) || !Number.isFinite(local.grantedAtMs)) {
    throw new TypeError('overdue: both times must be readings of the SAME local clock.');
  }
  return (local.nowMs - local.grantedAtMs) >= lease;
}

// =============================================================================================
// the audit
// =============================================================================================

/**
 * The reservation audit an auditor (or a red team) actually wants, computed from the records:
 *
 *   * does every claim carry a majority of DECLARED electors behind it?
 *   * is that majority signed, or merely asserted?
 *   * does any storno void a reservation that does not exist?
 *   * did any unit end up over-claimed?
 *   * is anything on record that this runtime does not understand?
 *
 * A peer that ignores the protocol and writes a claim without a quorum cannot be *prevented* from
 * doing so — every peer can always write to its own repository. This function is how it is caught.
 *
 * @param {object[]} records
 * @param {Map<string, import('./authority.js').AuthorityDeclaration>} declarations
 * @param {{ onHandOf?: (o:{resource:string,unit:string}) => string }} [o]
 */
export function auditReservations(records, declarations, o = {}) {
  const l = ledgerOf(records);
  const problems = [];
  for (const stray of l.stray) {
    problems.push(`${stray.id ?? '(no id)'} is a reservation record of kind `
      + `${JSON.stringify(stray.kind)}, which this runtime does not know. Principle 6: an unknown `
      + 'construction is refused, never silently ignored.');
  }
  for (const [claimId, vs] of l.voids) {
    if (!l.claims.has(claimId)) {
      problems.push(`storno ${vs[0].id} voids reservation ${claimId}, which is not on record.`);
    }
  }
  for (const claim of l.claims.values()) {
    const decl = declarations ? declarations.get(claim.resource) : null;
    if (!decl) {
      problems.push(`reservation ${claim.id} claims "${claim.resource}", for which this workspace `
        + `declares no authoritative peer. Appendix VIII requires one per scarce resource; `
        + `without it nothing stopped a second peer claiming the same units.`);
      continue;
    }
    const check = quorumStructure(decl, claim);
    for (const p of check) problems.push(`reservation ${claim.id}: ${p}`);
    if (claim['expires-advisory'] !== undefined && claim['lease-ms'] === undefined) {
      problems.push(`reservation ${claim.id} carries an absolute expiry and no lease duration. `
        + 'An absolute instant is not comparable across two machines; the duration is the only '
        + 'thing any peer may reason with.');
    }
  }
  if (o.onHandOf) {
    const { losers } = resolveCollisions(l, o.onHandOf);
    for (const loser of losers) {
      problems.push(`reservation ${loser.claim.id} is still open and over-claims ${loser.claim.unit}`
        + ` — it should have been voided by a storno (${loser.reason})`);
    }
  }
  return { ok: problems.length === 0, problems, ledger: l };
}

/** The structural half of the quorum check on a stored claim. */
function quorumStructure(decl, claim) {
  const problems = [];
  const voters = (claim.quorum || []).map((a) => a.voter);
  const unknown = voters.filter((v) => !decl.electors.includes(v));
  if (unknown.length) {
    problems.push(`its quorum names ${unknown.join(', ')}, who are not electors of `
      + `"${decl.key}" (${decl.electors.join(', ')}).`);
  }
  const distinct = new Set(voters);
  if (distinct.size !== voters.length) problems.push('its quorum counts a peer twice.');
  const counted = [...distinct].filter((v) => decl.electors.includes(v)).length;
  if (counted < decl.quorum) {
    problems.push(`${counted} of the ${decl.quorum} electors required by "${decl.key}" stand `
      + 'behind it. A claim no majority granted is evidence of a peer that ignored the protocol, '
      + 'not of a reservation.');
  }
  if (claim['quorum-evidence'] !== 'signed') {
    problems.push('its quorum is recorded but not signed, so the acks are asserted rather than '
      + 'proven. Verifiable only once the peers sign their acks (pass `sign`/`verify` to '
      + 'authorityMember).');
  }
  return problems;
}

/** Re-exported so a caller needs one import for the reservation vocabulary. */
export { compareStamps, quantity, qToString as quantityToString };
