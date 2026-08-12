// runtime/truth/authority.js — one authoritative peer per scarce resource, and a small
// Raft-like election when it goes away. Appendix VIII, the complex case.
//
// ---------------------------------------------------------------------------------------------
// What this module is for
// ---------------------------------------------------------------------------------------------
//
// Appendix VIII: "For scarce resources (physical stock, unique invoice numbers, cash-account
// balances), one peer per resource is declared the *authoritative* peer. Not authoritative for
// everything, just for this one resource type. […] This is not a central server but a distributed
// responsibility — the plant's warehouse peer is authoritative for that plant's stock, the finance
// peer for the finance journal." And: "If the authoritative peer is offline longer than a
// threshold, a democratic re-election happens among the remaining peers (Raft-like, but small)."
//
// So there are three separate things here and they must not be confused:
//
//   1. The DECLARATION — which peer owns which resource. A business decision, so it lives in the
//      repository as text (see `AUTHORITY_PATH` below), never in this file.
//   2. The TERM — who currently holds the authority. A fact that changes when a peer dies, so it
//      lives in the running peers and is re-derived by election, never persisted as settings.
//   3. The EVIDENCE — that a majority agreed to a particular scarce-resource decision. That is
//      what makes a reservation durable across a partition, so it is written into the repository
//      alongside the reservation itself and is verifiable by `ssh-keygen -Y verify`.
//
// ---------------------------------------------------------------------------------------------
// How this module avoids depending on wall-clock agreement between machines
// ---------------------------------------------------------------------------------------------
//
// Appendix VIII's own example of a reservation is "I am claiming units 001-005 of article X until
// 14:22". Taken literally that is a bug: 14:22 on whose clock? Two laptops five minutes apart
// would disagree about whether the claim is still alive, and the disagreement is silent.
//
// The rule this module holds to, without exception:
//
//   * EVERY time comparison reads ONE clock TWICE. `silenceMs()` is `clock() - lastHeardOn(me)`.
//     A lease is `clock() - ackedAtOn(me) < leaseMs`. Both operands come from the same machine,
//     so a skewed or jumping clock changes *when* a peer acts, never *whether* two peers agree.
//   * NO absolute instant from another machine is ever compared against a local one. A foreign
//     wall-clock reading is data to display, never data to branch on.
//   * ORDER between two competing claims comes from the Hybrid Logical Clock (`compareStamps`
//     from ../live/hlc.js), which is a *total order every peer computes identically*. Clock skew
//     can change which of two simultaneous claims wins — a fairness question — but never whether
//     the two peers agree on the winner, which is the correctness question.
//   * A lease handed over at an election RESTARTS on the new authority's clock rather than being
//     honoured to the old authority's absolute deadline. The error is therefore always in the
//     safe direction: a reservation may outlive its nominal TTL, and can never be reclaimed while
//     somebody still believes they hold it.
//
// `clock` is injected (CONTRACT non-negotiable #5). This file never calls `Date.now()`.
//
// ---------------------------------------------------------------------------------------------
// The protocol, in full. Eight messages, and that is the whole of it.
// ---------------------------------------------------------------------------------------------
//
//   heartbeat      leader → electors    "I am still here, in term T."
//   vote-request   candidate → electors "Term T+1, may I?"          (Raft RequestVote)
//   vote           elector → candidate  granted/denied, signed, plus the elector's claim table
//   propose        leader → electors    "Claim C, term T."           (Raft AppendEntries, n=1)
//   propose-ack    elector → leader     granted/denied, signed
//   release        leader → electors    "Claim C never reached a majority. Let it go."
//   claim-request  any peer → leader    "I want to claim C."
//   claim-verdict  leader → requester   granted (with the quorum evidence) or refused, with why
//
// `release` is the message a first draft of this file did without, and it was wrong. An elector
// records a claim when it ACKS it — it has to, or a successor elected by a different majority could
// lose a claim an earlier majority granted. But a proposal that never reaches a majority would then
// sit in the replicas of the peers that did ack it, holding stock nobody owns, until its lease ran
// out. So a refused round is released: explicitly, by the leader, to everybody.
//
// If the leader dies between the refusal and the release, the claim stays in those replicas until
// the lease expires. That is the safe direction — the units are briefly unavailable rather than
// briefly sold twice — and it self-heals without anybody intervening.
//
// Frames are strings, exactly as `PeerLink` requires (`{id, send, onFrame, close}` — see
// runtime/live/session.js, "THE SEAM"). Every frame this module sends is a JSON *object* with an
// `nd` field naming the protocol; the Live Layer's frames are JSON *arrays*. A frame that is not
// ours is ignored, so one `PeerLink` can carry both and agent SYNC's real WebRTC transport needs
// no knowledge of this file.
//
// Inbound frames are QUEUED, not handled inside `onFrame`. `pump()` drains the queue and advances
// every open round. That keeps the whole module free of timers and of hidden async, which is what
// makes the tests exact rather than flaky (standing rule 5: never report a pass you did not
// observe — a timing-dependent pass is not observed, it is hoped for).
//
// ---------------------------------------------------------------------------------------------
// What this module knows about stock, and what it deliberately does not
// ---------------------------------------------------------------------------------------------
//
// The collision rule itself is NOT here. `admitClaim()` in reservation.js decides whether an
// arriving claim fits alongside the claims already live on its unit, and the same function decides
// it for the after-the-fact audit of a merged history — so the live decision and the audit cannot
// drift apart. This module's job is narrower and is the half a single peer cannot do alone: make
// sure a MAJORITY stands behind the answer.
//
// How much of a unit exists is business data in the repository, so it is injected as
// `available(key, unit)` and this file never guesses it. When nothing is injected the unit is
// treated as indivisible — one live claim at a time — which is the fail-closed reading: a runtime
// that does not know how much there is must not hand out a second claim on it.

import { compareStamps, assertStamp } from '../live/hlc.js';
import { admitClaim } from './reservation.js';

/** The protocol tag on every frame. Bumping it is a compatibility act, so it is versioned. */
export const AUTHORITY_PROTOCOL = 'nd-authority/1';

/** The SSHSIG namespace quorum evidence is signed under. Distinct from 'git' and from cosign's. */
export const AUTHORITY_NAMESPACE = 'neodonkey-authority';

/**
 * Where the declaration lives.
 *
 * A business decision — "which site owns which stock" — belongs in `operating-model/`, next to
 * the `locations/` files that describe the sites it names (Appendix XII, Principle 11). It is
 * JSON rather than POLISM prose for exactly one reason: grammar version 2 has no section for it
 * and `parse.js` refuses unknown sections, rightly. That is the same shape as COMPROMISES #17,
 * and the exit is the same: a `## Authoritative peer` section on a location or information file.
 * `collectAuthorities()` reads the model FIRST, so the day that section exists nothing above it
 * changes.
 *
 * It is deliberately NOT `repos.json` (that manifest is the *legal-entity* mesh — FD-3, one repo
 * per entity — while authority-per-resource is about the peers of ONE repo; conflating them would
 * make "which plant owns this stock" a cross-repo question, which FD-3 rules out of scope), and
 * deliberately NOT `neodonkey.json` (written at genesis and never afterwards, whereas authority
 * must move by a signed commit when a plant reorganises — `kernel.amendOperatingModel()` commits
 * this path today, signed, with no kernel change).
 */
export const AUTHORITY_PATH = 'operating-model/authorities.json';

const enc = new TextEncoder();

// =============================================================================================
// 1. The declaration
// =============================================================================================

/**
 * @typedef {{ key:string, resource:string, scope:string, peer:string, electors:string[],
 *             quorum:number, leaseMs:number, electionTimeoutMs:number,
 *             fingerprint:string, source:string }} AuthorityDeclaration
 */

/**
 * Normalise one authority declaration, refusing everything we would otherwise have to guess.
 *
 * The key is `<resource>:<scope>` — `stock:berlin-main-warehouse`, `sequence:invoice`,
 * `bank-account:DE89370400440532013000`. Resource and scope are split on the first colon, so a
 * scope may contain colons and an IBAN or a URI is a usable scope.
 *
 * @param {string} key
 * @param {object} raw
 * @param {string} source where it came from, quoted verbatim in every refusal
 * @returns {{ declaration:AuthorityDeclaration|null, errors:string[] }}
 */
export function normalizeAuthority(key, raw, source) {
  const errors = [];
  const fail = (m) => { errors.push(`${source}: ${m}`); };

  if (typeof key !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*:[^\s]+$/.test(key)) {
    fail(`${JSON.stringify(key)} is not a usable resource key. A key is `
      + '"<resource>:<scope>" — for example "stock:berlin-main-warehouse", "sequence:invoice" or '
      + '"bank-account:DE89370400440532013000".');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(`the declaration for ${JSON.stringify(key)} must be an object.`);
    return { declaration: null, errors };
  }
  const colon = typeof key === 'string' ? key.indexOf(':') : -1;
  const resource = colon > 0 ? key.slice(0, colon) : '';
  const scope = colon > 0 ? key.slice(colon + 1) : '';

  const peer = raw.peer ?? raw['authoritative-peer'] ?? null;
  if (typeof peer !== 'string' || peer === '') {
    fail(`"${key}" does not say which peer is authoritative for it ("peer": `
      + '"warehouse@berlin.example"). Appendix VIII requires exactly one, per resource.');
  }
  const rawElectors = raw.electors ?? null;
  if (!Array.isArray(rawElectors) || rawElectors.length === 0) {
    fail(`"${key}" has no "electors" list. Re-election needs a fixed set of peers to count a `
      + 'majority of; a majority of "whoever happens to be reachable" is how a partitioned '
      + 'minority elects itself and sells the last pallet twice.');
  }
  /** @type {string[]} */
  let electors = [];
  if (Array.isArray(rawElectors)) {
    if (rawElectors.some((e) => typeof e !== 'string' || e === '')) {
      fail(`"${key}" lists an elector that is not a peer name.`);
    } else {
      electors = [...rawElectors].sort();
      if (new Set(electors).size !== electors.length) {
        fail(`"${key}" lists the same elector twice; a peer has one vote.`);
      }
      if (typeof peer === 'string' && peer !== '' && !electors.includes(peer)) {
        fail(`"${key}" declares ${peer} authoritative but does not list it among the electors. `
          + 'The holder of an authority votes in its own re-election, or it cannot hand over.');
      }
    }
  }
  const floorQuorum = electors.length > 0 ? Math.floor(electors.length / 2) + 1 : 0;
  let quorum = floorQuorum;
  if (raw.quorum !== undefined) {
    if (!Number.isInteger(raw.quorum) || raw.quorum < 1) {
      fail(`"${key}" has a "quorum" of ${JSON.stringify(raw.quorum)}; it must be a whole number `
        + 'of peers, at least 1.');
    } else if (raw.quorum < floorQuorum) {
      fail(`"${key}" asks for a quorum of ${raw.quorum} out of ${electors.length} electors, which `
        + `is not a majority (${floorQuorum} is). Two disjoint groups could each reach it, and `
        + 'then both would believe they own the resource — the exact failure this mechanism '
        + 'exists to prevent. A quorum above the majority is allowed; below it is refused.');
    } else {
      quorum = raw.quorum;
    }
  }
  const leaseMs = raw['lease-ms'] ?? raw.leaseMs ?? null;
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    fail(`"${key}" does not declare a lease ("lease-ms": 300000). A reservation with no declared `
      + 'TTL is a reservation somebody has to guess the lifetime of, and Appendix VIII gives it '
      + 'one on purpose. A resource whose claims are monotonic rather than leased — a number '
      + 'series, where an issued number stays issued — still needs the value, because '
      + '"election-timeout-ms" defaults to it.');
  }
  // A default with a reason, not a guess: waiting at least one full lease before deposing the
  // holder means every reservation it granted has nominally elapsed by the time a successor
  // exists, so the successor never has to reclaim a live lease.
  const electionTimeoutMs = raw['election-timeout-ms'] ?? raw.electionTimeoutMs ?? leaseMs;
  if (!Number.isInteger(electionTimeoutMs) || electionTimeoutMs <= 0) {
    fail(`"${key}" has an "election-timeout-ms" of ${JSON.stringify(electionTimeoutMs)}; it must `
      + 'be a whole number of milliseconds above zero.');
  }
  if (errors.length) return { declaration: null, errors };

  const declaration = {
    key, resource, scope, peer: /** @type {string} */ (peer), electors,
    quorum, leaseMs, electionTimeoutMs, fingerprint: '', source,
  };
  declaration.fingerprint = authorityFingerprint(declaration);
  return { declaration, errors };
}

/**
 * The constitution of one authority, as a short readable string.
 *
 * Not a hash: the declaration's integrity already comes from the signed commit it sits in, so all
 * this has to do is make two *different* constitutions unequal — and a string an operator can read
 * in a refusal message ("your electors are A,B,C; mine are A,B,C,D,E") is worth more here than an
 * opaque digest. It is carried on every vote and every ack, so a peer never counts a majority of
 * one elector set against a majority of another.
 *
 * @param {{key:string, quorum:number, electors:string[]}} decl
 */
export function authorityFingerprint(decl) {
  return `${decl.key}#${decl.quorum}of${decl.electors.length}/${[...decl.electors].sort().join(',')}`;
}

/**
 * Every authority declaration a workspace has: from the model first, the repository's
 * `operating-model/authorities.json` second, the workspace settings third.
 *
 * Exactly the layering `collectSeries()` uses in sequence.js, and for the same reason — the model
 * is the intended home, and the day the grammar grows a section for it nothing above this
 * function changes.
 *
 * @param {{ model?:{authorities?:object}|null,
 *           files?:Map<string, Uint8Array|string>|null,
 *           settings?:{authorities?:object}|null }} sources
 * @returns {{ authorities:Map<string,AuthorityDeclaration>, errors:string[] }}
 */
export function collectAuthorities(sources = {}) {
  const { model = null, files = null, settings = null } = sources;
  /** @type {Map<string,AuthorityDeclaration>} */
  const authorities = new Map();
  const errors = [];

  const take = (key, raw, source) => {
    const { declaration, errors: errs } = normalizeAuthority(key, raw, source);
    errors.push(...errs);
    if (!declaration) return;
    if (authorities.has(key)) {
      errors.push(`${source}: the authority "${key}" is already declared in ${authorities.get(key).source}.`);
      return;
    }
    authorities.set(key, declaration);
  };

  // 1. from the model, if a future grammar puts them there (see AUTHORITY_PATH's note).
  if (model && model.authorities && typeof model.authorities === 'object') {
    const entries = model.authorities instanceof Map
      ? [...model.authorities.entries()] : Object.entries(model.authorities);
    for (const [key, raw] of entries) take(key, raw, 'operating-model');
  }
  // 2. from the repository file. Data in the repo, signed into a commit, changeable by another.
  if (files) {
    const bytes = files.get(AUTHORITY_PATH);
    if (bytes !== undefined) {
      const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);
      let doc = null;
      try {
        doc = JSON.parse(text);
      } catch (e) {
        errors.push(`${AUTHORITY_PATH}: is not readable JSON (${e.message}). An authority `
          + 'declaration that cannot be read is treated as absent, and every scarce-resource '
          + 'operation it would have governed is then refused rather than guessed at.');
      }
      if (doc !== null) {
        if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
          errors.push(`${AUTHORITY_PATH}: must be a JSON object of "<resource>:<scope>" → declaration.`);
        } else {
          const body = doc.authorities && typeof doc.authorities === 'object' ? doc.authorities : doc;
          for (const [key, raw] of Object.entries(body)) {
            if (key === 'neodonkey' || key === 'version') continue;
            take(key, raw, AUTHORITY_PATH);
          }
        }
      }
    }
  }
  // 3. from the workspace settings, for symmetry with the number series (COMPROMISES #17).
  if (settings && settings.authorities && typeof settings.authorities === 'object') {
    for (const [key, raw] of Object.entries(settings.authorities)) take(key, raw, 'neodonkey.json');
  }
  return { authorities, errors };
}

// =============================================================================================
// 2. The evidence — the bytes a quorum signs
// =============================================================================================

/**
 * The exact text an elector signs when it votes. One line per field, in this order, terminated —
 * so an auditor (or `ssh-keygen -Y verify -n neodonkey-authority`) can reconstruct it by hand.
 * @param {{key:string, term:number, candidate:string, voter:string, granted:boolean, fingerprint:string}} v
 */
export function votePayloadText(v) {
  return `neodonkey-vote\n${v.key}\n${v.term}\n${v.candidate}\n${v.voter}\n`
    + `${v.granted ? 'granted' : 'denied'}\n${v.fingerprint}\n`;
}

/**
 * The exact text an elector signs when it acknowledges a claim. This is the byte sequence that
 * makes a reservation durable: a majority of these, kept with the reservation, is the proof that
 * no second majority could have granted a conflicting one.
 * @param {{key:string, term:number, leader:string, voter:string, claim:string,
 *          granted:boolean, fingerprint:string}} a
 */
export function ackPayloadText(a) {
  return `neodonkey-claim-ack\n${a.key}\n${a.term}\n${a.leader}\n${a.voter}\n${a.claim}\n`
    + `${a.granted ? 'granted' : 'denied'}\n${a.fingerprint}\n`;
}

/** @param {string} text */
export const payloadBytes = (text) => enc.encode(text);

/**
 * Is this quorum evidence sufficient, and does it belong to this declaration?
 *
 * Signature checking is the caller's (it needs the peer records); this function answers the
 * structural half, which is the half people get wrong: enough acks, all from *declared* electors,
 * all distinct, all for the same term and claim, all under the same constitution.
 *
 * @param {AuthorityDeclaration} decl
 * @param {{voter:string, term:number, claim:string, granted:boolean, fingerprint:string,
 *          signature?:string|null}[]} acks
 * @param {{term:number, claim:string}} expect
 * @returns {{ok:boolean, problems:string[], signed:number, unsigned:number}}
 */
export function checkQuorum(decl, acks, expect) {
  const problems = [];
  const list = Array.isArray(acks) ? acks : [];
  const seen = new Set();
  let signed = 0;
  let unsigned = 0;
  for (const a of list) {
    if (!a || a.granted !== true) {
      problems.push(`an ack that does not grant is not evidence (${a && a.voter}).`);
      continue;
    }
    if (!decl.electors.includes(a.voter)) {
      problems.push(`${a.voter} is not one of the declared electors of "${decl.key}" `
        + `(${decl.electors.join(', ')}), so its ack counts for nothing.`);
      continue;
    }
    if (seen.has(a.voter)) {
      problems.push(`${a.voter} acked twice; a peer has one vote.`);
      continue;
    }
    if (a.fingerprint !== decl.fingerprint) {
      problems.push(`${a.voter} acked under a different declaration of "${decl.key}" `
        + `(${a.fingerprint} vs ${decl.fingerprint}). Two peers counting majorities of two `
        + 'different elector sets is the one split-brain this mechanism cannot resolve, so the '
        + 'ack is refused instead.');
      continue;
    }
    if (a.term !== expect.term) {
      problems.push(`${a.voter} acked term ${a.term}, not ${expect.term}.`);
      continue;
    }
    if (a.claim !== expect.claim) {
      problems.push(`${a.voter} acked claim ${a.claim}, not ${expect.claim}.`);
      continue;
    }
    seen.add(a.voter);
    if (typeof a.signature === 'string' && a.signature !== '') signed += 1; else unsigned += 1;
  }
  if (seen.size < decl.quorum) {
    problems.push(`${seen.size} of the required ${decl.quorum} electors granted claim `
      + `${expect.claim} in term ${expect.term}. A scarce-resource decision that no majority `
      + 'stands behind is refused, not taken optimistically — a delay is cheaper than selling '
      + 'the last pallet twice.');
  }
  return { ok: problems.length === 0, problems, signed, unsigned };
}

// =============================================================================================
// 3. The member — this peer's part in every authority it belongs to
// =============================================================================================

/**
 * @typedef {{ id:string, send(frame:string):void, onFrame(h:(frame:string)=>void):void,
 *             close():void }} PeerLink
 */

/**
 * One peer's participation in the authorities it is an elector of.
 *
 * @param {{
 *   self: string,                             // this peer's id, as it appears in `electors`
 *   clock: () => number,                      // injected. Read only against itself. Never Date.now
 *   declarations: Map<string, AuthorityDeclaration>|AuthorityDeclaration[],
 *   links?: PeerLink[],
 *   sign?: ((payload:Uint8Array) => Promise<string>)|null,   // armored SSHSIG, or null
 *   verify?: ((peer:string, payload:Uint8Array, armored:string) => Promise<boolean>)|null,
 *   order?: (a:object, b:object) => number,   // total order on claims. HLC by default.
 *   available?: ((key:string, unit:string) => string|null)|null,
 *      // how much of `unit` exists, as a quantity token ("5 pcs"), read from THIS peer's own
 *      // repository. Absent or null ⇒ the unit is indivisible and admits one live claim.
 * }} o
 */
export function authorityMember(o) {
  const self = o.self;
  const clock = o.clock;
  if (typeof self !== 'string' || self === '') {
    throw new TypeError('authorityMember: self must be a non-empty peer id');
  }
  if (typeof clock !== 'function') {
    throw new TypeError('authorityMember: clock must be an injected () => number (never Date.now)');
  }
  const sign = o.sign ?? null;
  const verify = o.verify ?? null;
  const available = o.available ?? null;
  const order = o.order ?? ((a, b) => {
    assertStamp(a.stamp);
    assertStamp(b.stamp);
    return compareStamps(a.stamp, b.stamp);
  });

  /** @type {Map<string, AuthorityDeclaration>} */
  const decls = new Map();
  const declare = (d) => {
    decls.set(d.key, d);
    if (!state.has(d.key)) state.set(d.key, freshState(d));
  };

  /**
   * Per-resource state. `term` is this peer's own view; `leader` is who it believes holds the
   * authority in that term. `granted` is this peer's replica of the claim table — the reason a
   * successor elected by a majority cannot lose a claim an earlier majority granted.
   */
  const freshState = (d) => ({
    decl: d,
    term: 0,
    leader: d.peer,          // term 0 is the declaration itself: the declared peer leads until deposed
    votedFor: new Map(),     // term -> candidate this peer voted for. At most one per term.
    lastHeard: clock(),      // MY clock, compared only against MY clock
    /**
     * The leased claims this peer has acked, `unit -> claim id -> entry`. Several claims may be
     * live on one unit at once — five units on hand admit a claim for 3 and a claim for 2 — and
     * `admitClaim()` is what decides whether one more of them fits. `ackedAt` is a reading of MY
     * clock and is only ever compared against another reading of MY clock.
     * @type {Map<string, Map<string, {claim:string, unit:string, quantity:string, stamp:object,
     *                                by:string, term:number, ackedAt:number}>>}
     */
    granted: new Map(),
    /**
     * The monotonic claims: `unit -> {value, claim, term}`. A document number is not leased and
     * never lapses, so it lives apart from the claim table rather than pretending to have a TTL.
     * @type {Map<string, {unit:string, value:number, claim:string, term:number, by:string,
     *                     stamp:object, ackedAt:number}>}
     */
    watermarks: new Map(),
    /** open ballots and rounds this peer started */
    ballots: new Map(),      // term -> ballot
    rounds: new Map(),       // claim id -> round
    requests: new Map(),     // claim id -> outbound request handle
    pendingForwards: new Map(), // claim id -> {from, proposal}
  });

  /** @type {Map<string, ReturnType<typeof freshState>>} */
  const state = new Map();

  const list = o.declarations instanceof Map ? [...o.declarations.values()] : (o.declarations || []);
  for (const d of list) declare(d);

  /** @type {PeerLink[]} */
  const links = [];
  /** @type {string[]} */
  const inbox = [];

  const attach = (link) => {
    links.push(link);
    link.onFrame((frame) => { inbox.push(frame); });
    return link;
  };
  for (const link of o.links || []) attach(link);

  const broadcast = (msg) => {
    const frame = JSON.stringify({ nd: AUTHORITY_PROTOCOL, ...msg });
    for (const link of links) link.send(frame);
    return links.length;
  };
  /** There is one link per peer and `link.id` is the peer at the far end (see loopbackPipe). */
  const sendTo = (peer, msg) => {
    const frame = JSON.stringify({ nd: AUTHORITY_PROTOCOL, ...msg });
    let sent = 0;
    for (const link of links) if (link.id === peer) { link.send(frame); sent += 1; }
    return sent;
  };

  const st = (key) => {
    const s = state.get(key);
    if (!s) throw new Error(`authorityMember: no authority "${key}" is declared for ${self}. `
      + `Declared: ${[...state.keys()].join(', ') || 'none'}.`);
    return s;
  };

  const signIf = async (text) => (sign ? await sign(payloadBytes(text)) : null);

  /**
   * A claim's lease, measured only against the clock that acked it — one clock, read twice.
   * (A document number has no lease and never lapses — see `s.watermarks`, which this never sees.)
   */
  const alive = (s, entry) => (clock() - entry.ackedAt) < s.decl.leaseMs;

  /** Every claim on one unit, alive or lapsed. */
  const claimsOn = (s, unit) => [...(s.granted.get(unit) ?? new Map()).values()];

  /** Every claim on one unit whose lease is still running, in logical order. */
  const liveOn = (s, unit) => claimsOn(s, unit).filter((e) => alive(s, e)).sort(order);

  /** Write one claim into this peer's replica. `ackedAt` is always THIS peer's clock. */
  const record = (s, p, term) => {
    if (!s.granted.has(p.unit)) s.granted.set(p.unit, new Map());
    const entry = {
      claim: p.id, unit: p.unit, quantity: p.quantity, stamp: p.stamp, by: p.by,
      term, ackedAt: clock(),
    };
    s.granted.get(p.unit).set(p.id, entry);
    return entry;
  };

  /** Drop claims from the replica once their storno is on record. */
  const drop = (s, unit, ids) => {
    const perUnit = s.granted.get(unit);
    if (!perUnit) return 0;
    let gone = 0;
    for (const id of ids) if (perUnit.delete(id)) gone += 1;
    if (perUnit.size === 0) s.granted.delete(unit);
    return gone;
  };

  /**
   * Everything a successor must learn from this peer if it wins an election: the leases still
   * running and the document numbers already issued. Raft's leader completeness, made explicit —
   * any majority intersects the majority that granted any claim, so a winner that reads this off
   * every voter cannot lose what an earlier majority granted.
   */
  const handover = (s) => ({
    claims: [...s.granted.values()]
      .flatMap((perUnit) => [...perUnit.values()])
      .filter((e) => alive(s, e))
      .map((e) => ({
        unit: e.unit, claim: e.claim, stamp: e.stamp, by: e.by, quantity: e.quantity, term: e.term,
      })),
    watermarks: [...s.watermarks.values()].map((w) => ({
      unit: w.unit, value: w.value, claim: w.claim, term: w.term, by: w.by, stamp: w.stamp,
    })),
  });

  /**
   * Take a handover into this peer's replica.
   *
   * A lease adopted here RESTARTS on this peer's clock rather than being honoured to the old
   * authority's absolute deadline — there is no way to compare that deadline against a local
   * reading, and the error is therefore always in the safe direction: a reservation may outlive its
   * nominal TTL, and can never be reclaimed while somebody still believes they hold it.
   *
   * A document number is adopted by MAXIMUM, never overwritten: a successor that restarted below
   * the highest value any majority ever acked would reissue a number somebody already used.
   */
  const adopt = (s, claims, watermarks) => {
    for (const c of claims || []) {
      if (!c || typeof c.unit !== 'string' || typeof c.claim !== 'string') continue;
      if (!s.granted.has(c.unit)) s.granted.set(c.unit, new Map());
      const perUnit = s.granted.get(c.unit);
      if (perUnit.has(c.claim)) continue;
      perUnit.set(c.claim, {
        claim: c.claim, unit: c.unit, quantity: c.quantity, stamp: c.stamp, by: c.by,
        term: c.term, ackedAt: clock(),
      });
    }
    for (const w of watermarks || []) {
      if (!w || typeof w.unit !== 'string' || !Number.isInteger(w.value)) continue;
      const mine = s.watermarks.get(w.unit);
      if (mine && w.value <= mine.value) continue;
      s.watermarks.set(w.unit, {
        unit: w.unit, value: w.value, claim: w.claim, term: w.term, by: w.by, stamp: w.stamp,
        ackedAt: clock(),
      });
    }
  };

  /**
   * How much of a unit exists, as this peer's own repository reports it. Injected, never guessed;
   * `null` means "not stated", and `admitClaim` then treats the unit as indivisible.
   */
  const onHandOf = (s, unit) => {
    if (!available) return null;
    const v = available(s.decl.key, unit);
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string' && !(typeof v === 'object' && v !== null)) {
      throw new TypeError(`authorityMember: available("${s.decl.key}", "${unit}") must return a `
        + `quantity token such as "5 pcs", or null when nothing states it — got ${JSON.stringify(v)}.`);
    }
    return v;
  };

  // -------------------------------------------------------------------------------------------
  // the elector's two decisions
  // -------------------------------------------------------------------------------------------

  /**
   * Raft's RequestVote, with the fingerprint check added. Grant if:
   *   the constitution matches, the candidate's term is strictly greater than ours, and we have
   *   not already voted in that term. One vote per peer per term is what makes two disjoint
   *   majorities impossible, and therefore two leaders in one term impossible.
   */
  function decideVote(s, msg) {
    if (msg.fingerprint !== s.decl.fingerprint) {
      return { granted: false, reason: `${self} holds a different declaration of "${s.decl.key}" `
        + `(${s.decl.fingerprint}) than ${msg.candidate} (${msg.fingerprint}); it will not vote `
        + 'under two constitutions at once.' };
    }
    if (!s.decl.electors.includes(msg.candidate)) {
      return { granted: false, reason: `${msg.candidate} is not an elector of "${s.decl.key}".` };
    }
    const already = s.votedFor.get(msg.term);
    // A `PeerLink` promises each frame AT LEAST ONCE, in any order (session.js, "THE SEAM"), so the
    // same vote-request will sometimes arrive twice. The second copy must get the same answer, not a
    // refusal — otherwise a duplicated frame would look to the candidate like a retracted vote.
    if (already === msg.candidate && msg.term >= s.term) {
      return { granted: true, reason: null };
    }
    if (msg.term <= s.term) {
      return { granted: false, reason: `${self} is already in term ${s.term} of "${s.decl.key}"; `
        + `${msg.candidate} stood for term ${msg.term}.`
        + (already !== undefined
          ? ` ${self} already voted for ${already} in term ${msg.term}, and a peer has one vote per `
            + 'term — which is what makes two leaders in one term impossible.'
          : '') };
    }
    // Note there is no separate "already voted for somebody else in this term" branch: a vote is
    // only ever recorded together with the term it belongs to, so every recorded vote is for a term
    // that is not greater than `s.term` and the check above has already covered it. A branch that
    // cannot be reached is a branch nobody maintains.
    s.votedFor.set(msg.term, msg.candidate);
    s.term = msg.term;
    s.leader = null;              // fail closed: no leader until somebody wins
    s.lastHeard = clock();
    return { granted: true, reason: null };
  }

  /**
   * Raft's AppendEntries for a single entry, plus the reservation collision rule Appendix VIII
   * states: "only the one with the earlier logical timestamp is valid. The later reservation is
   * automatically voided via a follow-up storno event when the conflict is detected."
   *
   * The elector is a replica, not a second brain: availability is the leader's business (it holds
   * the index). What the elector adds is the guarantee the leader cannot give itself — that a
   * claim an earlier majority granted is not silently forgotten by a later one.
   *
   * A proposal carrying a `watermark` is a *monotonic* claim rather than a leased one: a document
   * number (FD-6). The rule for those is different and stricter, so it is handled first.
   */
  function decideAck(s, msg) {
    const p = msg.proposal;
    if (p && p.watermark !== undefined) return decideWatermark(s, msg);
    const refusal = leaderGuard(s, msg, 'grant a claim on');
    if (refusal) return refusal;

    const existing = (s.granted.get(p.unit) ?? new Map()).get(p.id);
    if (existing) {
      existing.ackedAt = clock();                     // idempotent re-ack: refresh, do not refuse
      return { granted: true, reason: null, supersedes: [] };
    }

    const live = liveOn(s, p.unit);
    const lapsed = claimsOn(s, p.unit).filter((e) => !alive(s, e)).map((e) => e.claim);

    let decision;
    try {
      decision = admitClaim({
        live,
        claim: { claim: p.id, unit: p.unit, quantity: p.quantity, stamp: p.stamp, by: p.by },
        onHand: onHandOf(s, p.unit),
      });
    } catch (e) {
      // A quantity this runtime cannot add up, or an availability function that answered nonsense.
      // Fail closed: an ambiguous scarce-resource decision is a refusal, never an optimistic guess.
      return {
        granted: false, supersedes: [],
        reason: `${self} cannot decide claim ${p.id} on ${p.unit} of "${s.decl.key}": ${e.message} `
          + 'A scarce-resource decision this peer cannot compute is refused.',
      };
    }
    if (!decision.granted) {
      return {
        granted: false, reason: decision.reason, beatenBy: decision.beatenBy ?? null,
        supersedes: [],
      };
    }
    record(s, p, msg.term);
    // Appendix VIII's partition case: an arriving claim that is logically EARLIER displaces the
    // later ones. They leave this replica now and the leader owes each of them a storno — which is
    // what `supersedes` carries back up to `propose().verdict()`.
    drop(s, p.unit, decision.supersedes);
    return {
      granted: true, reason: null, supersedes: decision.supersedes,
      ...(lapsed.length ? { lapsed } : {}),
    };
  }

  /**
   * Is this round settled — either granted, or refused for good?
   *
   * The subtle half is "for good". A first draft answered the requester as soon as ANY elector
   * denied, which turned one slow or stale elector into a refusal for a claim that the majority was
   * about to grant. A round is refused for good only when a quorum has become arithmetically
   * impossible: every elector that denied can never ack, so `electors - denials < quorum`. Until
   * then the round waits, and a requester that never gets an answer refuses locally anyway (see
   * `request().verdict()`), so waiting is never the same as allowing.
   *
   * The leader's own refusal is decisive immediately: it holds the resource.
   */
  const decided = (s, round, v) => {
    if (v.granted) return true;
    if (round.selfDenied) return true;
    const denied = new Set(round.denials.filter((d) => d.voter !== self).map((d) => d.voter));
    return (s.decl.electors.length - denied.size) < s.decl.quorum;
  };

  /**
   * The checks a proposal must pass before its content is even looked at: one constitution, one
   * term, one leader. Shared by the leased and the monotonic rule so they cannot disagree.
   */
  function leaderGuard(s, msg, what) {
    if (msg.fingerprint !== s.decl.fingerprint) {
      return { granted: false, supersedes: [], reason: `${self} holds a different declaration of `
        + `"${s.decl.key}" (${s.decl.fingerprint}) than ${msg.leader} (${msg.fingerprint}); it will `
        + `not ${what} "${s.decl.key}" under two constitutions at once.` };
    }
    if (msg.term < s.term) {
      return { granted: false, supersedes: [], reason: `${msg.leader} proposed in term ${msg.term} `
        + `but ${self} is already in term ${s.term} of "${s.decl.key}" — a deposed authority may `
        + `not ${what} it.` };
    }
    if (msg.term > s.term) { s.term = msg.term; s.leader = msg.leader; }
    if (s.leader === null) {
      // A peer with no leader adopts the one it hears from — but NEVER itself. Only a majority may
      // make this peer the holder (`standFor().verdict()`), and a peer that has just lost an
      // election or is mid-ballot has `leader === null`: without this branch it could install
      // itself simply by proposing, which is exactly the minority-elects-itself failure the whole
      // mechanism exists to prevent.
      if (msg.leader === self) {
        return { granted: false, supersedes: [], reason: `${self} does not hold "${s.decl.key}": no `
          + `majority has elected it in term ${s.term} (electors: ${s.decl.electors.join(', ')}). An `
          + `ambiguous authority refuses the operation rather than ${what} it.` };
      }
      s.leader = msg.leader;
    }
    if (s.leader !== msg.leader) {
      return { granted: false, supersedes: [], reason: `${self} believes ${s.leader} holds `
        + `"${s.decl.key}" in term ${s.term}, not ${msg.leader}.` };
    }
    s.lastHeard = clock();
    return null;
  }

  /**
   * The monotonic rule, for document numbers (FD-6).
   *
   * A number is not leased and never expires: once a majority has acked that value N of series S
   * period P was issued, no majority may ever ack N again. That single sentence is what makes
   * "a number is never issued twice" true across peers — two issuances of N would need two
   * disjoint majorities of one fixed elector set, and there are none.
   *
   * Gaplessness comes from the other direction: the leader derives N from the sequence document
   * (S's design in sequence.js, unchanged), and `nextAllowed` below tells a fresh leader the
   * highest value any majority has ever acked, so a successor never restarts below it.
   */
  function decideWatermark(s, msg) {
    const p = msg.proposal;
    const refusal = leaderGuard(s, msg, 'issue a document number for');
    if (refusal) return refusal;
    if (!Number.isInteger(p.watermark) || p.watermark < 1) {
      return { granted: false, reason: `${JSON.stringify(p.watermark)} is not a document number.`,
        supersedes: [] };
    }
    const existing = s.watermarks.get(p.unit);
    if (existing && existing.claim === p.id) {
      return { granted: true, reason: null, supersedes: [] };   // idempotent re-delivery
    }
    if (existing && p.watermark <= existing.value) {
      return {
        granted: false,
        reason: `number ${p.watermark} of ${p.unit} has already been acknowledged as issued by a `
          + `majority (highest: ${existing.value}, issuance ${existing.claim}). A gapless sequence `
          + 'issues each number exactly once, so this peer refuses rather than let two documents '
          + 'carry one invoice number.',
        beatenBy: existing.claim,
        supersedes: [],
      };
    }
    s.watermarks.set(p.unit, {
      unit: p.unit, value: p.watermark, claim: p.id, term: msg.term,
      by: p.by, stamp: p.stamp, ackedAt: clock(),
    });
    return { granted: true, reason: null, supersedes: [] };
  }

  // -------------------------------------------------------------------------------------------
  // inbound
  // -------------------------------------------------------------------------------------------

  /**
   * Raft's rule for a response from the future: if anybody is in a higher term than we are, we are
   * behind — and if we thought we were the leader, we are not any more. Stepping down here is what
   * makes a peer returning from a partition able to rejoin at all, and it fails closed: it gives up
   * a leadership it may still hold rather than keeping one it may have lost.
   */
  const adoptHigherTerm = (s, term) => {
    if (!Number.isInteger(term) || term <= s.term) return false;
    s.term = term;
    if (s.leader === self) s.leader = null;
    return true;
  };

  async function handle(frame) {
    let msg;
    try {
      msg = JSON.parse(frame);
    } catch { return; }                     // not for us; the Live Layer shares the link
    if (msg === null || typeof msg !== 'object' || msg.nd !== AUTHORITY_PROTOCOL) return;
    const s = state.get(msg.key);
    if (!s) return;                          // an authority this peer does not participate in

    switch (msg.t) {
      case 'heartbeat': {
        if (msg.fingerprint !== s.decl.fingerprint) return;
        if (msg.term >= s.term) { s.term = msg.term; s.leader = msg.leader; s.lastHeard = clock(); }
        return;
      }
      case 'vote-request': {
        const d = decideVote(s, msg);
        const vote = {
          key: msg.key, term: msg.term, candidate: msg.candidate, voter: self,
          granted: d.granted, fingerprint: s.decl.fingerprint,
        };
        sendTo(msg.candidate, {
          // Raft: a response carries the responder's term, so a candidate (or a leader that has
          // been deposed while cut off) learns it is behind from the answer instead of having to
          // guess a higher term and try again. Without this a peer returning from a partition
          // cannot stand for election at all until a heartbeat happens to reach it.
          t: 'vote', ...vote, currentTerm: s.term, reason: d.reason,
          signature: await signIf(votePayloadText(vote)),
          // Raft's leader completeness, made explicit: the winner learns every claim and every
          // issued number this elector holds, so no majority can lose what an earlier one granted.
          ...handover(s),
        });
        return;
      }
      case 'vote': {
        adoptHigherTerm(s, msg.currentTerm);
        const ballot = s.ballots.get(msg.term);
        if (!ballot) return;
        if (verify && msg.granted && typeof msg.signature === 'string') {
          const ok = await verify(msg.voter, payloadBytes(votePayloadText({
            key: msg.key, term: msg.term, candidate: msg.candidate, voter: msg.voter,
            granted: true, fingerprint: msg.fingerprint,
          })), msg.signature);
          if (!ok) {
            ballot.refusals.push({ voter: msg.voter, reason: 'the vote signature does not verify.' });
            return;
          }
        }
        if (msg.granted) {
          ballot.votes.set(msg.voter, msg);
          for (const c of msg.claims || []) ballot.learned.push(c);
          for (const w of msg.watermarks || []) ballot.learnedWatermarks.push(w);
        } else {
          ballot.refusals.push({ voter: msg.voter, reason: msg.reason });
        }
        return;
      }
      case 'propose': {
        const d = decideAck(s, msg);
        const ack = {
          key: msg.key, term: msg.term, leader: msg.leader, voter: self,
          claim: msg.proposal.id, granted: d.granted, fingerprint: s.decl.fingerprint,
        };
        sendTo(msg.leader, {
          t: 'propose-ack', ...ack, currentTerm: s.term, reason: d.reason,
          beatenBy: d.beatenBy ?? null, supersedes: d.supersedes ?? [],
          signature: await signIf(ackPayloadText(ack)),
        });
        return;
      }
      case 'propose-ack': {
        adoptHigherTerm(s, msg.currentTerm);
        const round = s.rounds.get(msg.claim);
        if (!round || round.term !== msg.term) return;
        if (verify && msg.granted && typeof msg.signature === 'string') {
          const ok = await verify(msg.voter, payloadBytes(ackPayloadText({
            key: msg.key, term: msg.term, leader: msg.leader, voter: msg.voter,
            claim: msg.claim, granted: true, fingerprint: msg.fingerprint,
          })), msg.signature);
          if (!ok) {
            round.denials.push({ voter: msg.voter, reason: 'the ack signature does not verify.' });
            return;
          }
        }
        if (msg.granted) {
          round.acks.set(msg.voter, {
            voter: msg.voter, term: msg.term, leader: msg.leader, claim: msg.claim,
            granted: true, fingerprint: msg.fingerprint, signature: msg.signature ?? null,
          });
          for (const id of msg.supersedes || []) round.supersedes.add(id);
        } else {
          round.denials.push({ voter: msg.voter, reason: msg.reason, beatenBy: msg.beatenBy ?? null });
        }
        return;
      }
      case 'release': {
        // The leader says a claim never reached a majority. Only the leader may say it, and only
        // for the term this peer is in or a later one — otherwise any peer could free anyone's
        // stock by sending one frame.
        if (msg.fingerprint !== s.decl.fingerprint) return;
        if (msg.term < s.term) return;
        if (s.leader !== null && s.leader !== msg.leader) return;
        for (const c of msg.claims || []) drop(s, c.unit, [c.claim]);
        s.lastHeard = clock();
        return;
      }
      case 'claim-request': {
        // Only the leader answers, and only if it still believes it is the leader.
        if (s.leader !== self) {
          sendTo(msg.from, {
            t: 'claim-verdict', key: msg.key, claim: msg.proposal.id, granted: false,
            reason: `${self} does not hold "${s.decl.key}" — ${s.leader ?? 'nobody'} does, in `
              + `term ${s.term}.`, term: s.term, leader: s.leader, acks: [],
          });
          return;
        }
        s.pendingForwards.set(msg.proposal.id, { from: msg.from, proposal: msg.proposal });
        return;
      }
      case 'claim-verdict': {
        const req = s.requests.get(msg.claim);
        if (!req) return;
        req.answer = msg;
        return;
      }
      default: return;
    }
  }

  // -------------------------------------------------------------------------------------------
  // the API
  // -------------------------------------------------------------------------------------------

  const api = {
    self,
    attach,
    keys: () => [...state.keys()].sort(),
    declare,
    declaration: (key) => st(key).decl,
    fingerprint: (key) => st(key).decl.fingerprint,
    term: (key) => st(key).term,
    leaderOf: (key) => st(key).leader,
    isLeader: (key) => st(key).leader === self,
    quorumOf: (key) => st(key).decl.quorum,

    /** Claims this peer holds as a replica, for inspection and for handover. */
    claimTable(key) {
      const s = st(key);
      return [...s.granted.values()]
        .flatMap((perUnit) => [...perUnit.values()])
        .map((e) => ({ ...e, live: alive(s, e) }))
        .sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : order(a, b)));
    },

    /** What this unit still has room for, as this peer sees it. `null` ⇒ nothing states it. */
    onHand(key, unit) { return onHandOf(st(key), unit); },

    /** The claims on one unit whose leases are still running, in logical order. */
    liveClaims(key, unit) { return liveOn(st(key), unit).map((e) => ({ ...e })); },

    /**
     * The claims whose lease has run out on THIS peer's clock, with the elapsed duration — the
     * input to `expiryStorno()` in reservation.js. A lapsed claim already blocks nothing (every
     * decision reads `alive`), but it is not *gone* until its storno is committed and `retire()`
     * is called, because a reservation that vanished without a record is a reservation nobody can
     * prove was ever abandoned.
     * @param {string} key
     */
    lapsed(key) {
      const s = st(key);
      const now = clock();
      return [...s.granted.values()]
        .flatMap((perUnit) => [...perUnit.values()])
        .filter((e) => !alive(s, e))
        .map((e) => ({ ...e, nowMs: now, grantedAtMs: e.ackedAt, elapsedMs: now - e.ackedAt }))
        .sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : order(a, b)));
    },

    /**
     * Forget claims whose storno is on record. Called AFTER the void commit exists, never before:
     * the record is the truth, this table is only a replica of it.
     * @param {string} key @param {{unit:string, claim:string}[]} claims
     */
    retire(key, claims) {
      const s = st(key);
      let gone = 0;
      for (const c of claims || []) gone += drop(s, c.unit, [c.claim ?? c.id]);
      return gone;
    },

    /**
     * FD-6, cross-peer. The highest value any majority has ever acknowledged as issued for this
     * numbering unit, as known to this peer — and therefore the floor a fresh leader must start
     * above. Null when nothing has been acked, in which case the sequence document decides alone
     * (which is correct: nothing was ever issued).
     * @param {string} key @param {string} unit `<series>/<period>`
     */
    highestWatermark(key, unit) {
      const w = st(key).watermarks.get(unit);
      return w ? w.value : null;
    },

    /**
     * The same watermark, with the issuance that put it there.
     *
     * The id matters to a retry. A leader acks its own proposal as it makes it, so after a round
     * that failed to reach a majority the highest watermark this peer knows IS its own unconfirmed
     * attempt. An issuer that treated that as a floor would ask for the next number every time it
     * retried, and burn one number per attempt. Knowing the id lets it re-propose the same value.
     * @param {string} key @param {string} unit
     */
    watermarkOf(key, unit) {
      const w = st(key).watermarks.get(unit);
      return w ? { value: w.value, claim: w.claim, term: w.term, by: w.by } : null;
    },

    /** The leader says it is still there. Followers reset their own silence counter. */
    heartbeat(key) {
      const s = st(key);
      if (s.leader !== self) return 0;
      s.lastHeard = clock();
      return broadcast({
        t: 'heartbeat', key, term: s.term, leader: self, fingerprint: s.decl.fingerprint,
      });
    },

    /** How long since this peer last heard from the authority — on ITS OWN clock, twice read. */
    silenceMs(key) {
      const s = st(key);
      return clock() - s.lastHeard;
    },

    /** Is the authority overdue? A local suspicion, never a fact, and never a foreign clock. */
    suspectDown(key) {
      const s = st(key);
      if (s.leader === self) return false;
      return api.silenceMs(key) > s.decl.electionTimeoutMs;
    },

    /**
     * Stand for election. Raft, minus log matching (there is no log — the claim table travels on
     * the votes instead, which is sufficient because any majority intersects the majority that
     * granted any claim).
     *
     * Returns a ballot; `verdict()` reads whatever has arrived so far and fails closed. It is
     * deliberately not a promise: a promise that never settles under a partition is worse than a
     * verdict that says "no majority yet, so no".
     */
    standFor(key) {
      const s = st(key);
      const term = s.term + 1;
      s.term = term;
      s.leader = null;
      s.votedFor.set(term, self);
      const ballot = {
        key, term, candidate: self,
        votes: new Map([[self, { voter: self, term, granted: true, fingerprint: s.decl.fingerprint }]]),
        refusals: [],
        learned: handover(s).claims,
        learnedWatermarks: handover(s).watermarks,
        verdict() {
          const granted = [...ballot.votes.keys()].filter((v) => s.decl.electors.includes(v));
          const elected = granted.length >= s.decl.quorum;
          if (elected && s.term === term) {
            s.leader = self;
            s.lastHeard = clock();
            adopt(s, ballot.learned, ballot.learnedWatermarks);
          }
          return {
            elected, term, votes: granted.sort(), quorum: s.decl.quorum,
            electors: s.decl.electors,
            refusals: ballot.refusals,
            adopted: elected ? api.claimTable(key) : [],
            reason: elected ? null
              : `${granted.length} of the ${s.decl.quorum} votes needed to hold "${key}" in term `
                + `${term} arrived (electors: ${s.decl.electors.join(', ')}). A minority does not `
                + 'elect itself, so this peer refuses every scarce-resource decision on this '
                + 'resource until a majority speaks.'
                + (ballot.refusals.length
                  ? `\n  Refused by: ${ballot.refusals.map((r) => `${r.voter} (${r.reason})`).join('; ')}`
                  : ''),
          };
        },
      };
      s.ballots.set(term, ballot);
      broadcast({
        t: 'vote-request', key, term, candidate: self, fingerprint: s.decl.fingerprint,
      });
      return ballot;
    },

    /**
     * The leader proposes a claim to its electors. Returns a round; `verdict()` fails closed.
     * @param {string} key
     * @param {{id:string, unit:string, quantity:string, stamp:object, by:string}} proposal
     */
    propose(key, proposal) {
      const s = st(key);
      const term = s.term;
      const round = {
        key, term, proposal,
        acks: new Map(),
        denials: [],
        supersedes: new Set(),
        verdict() {
          // The term moved on while this round was open — an election happened. The acks it
          // collected describe who held the resource then, not now, so the round is void even if a
          // majority of them arrived. Without this, a caller holding the handle could cash in a
          // stale round after being deposed and re-elected.
          if (s.term !== term) {
            return { granted: false, acks: [], quorum: s.decl.quorum, supersedes: [], term,
              denials: round.denials, beatenBy: null, signedAcks: 0, unsignedAcks: 0,
              reason: `"${key}" has moved from term ${term} to term ${s.term} since claim `
                + `${proposal.id} was proposed, so the acks it collected no longer say who holds the `
                + 'resource. The claim is refused; it may be proposed again in the current term.' };
          }
          if (s.leader !== self) {
            return { granted: false, acks: [], quorum: s.decl.quorum, supersedes: [], term,
              denials: round.denials, beatenBy: null, signedAcks: 0, unsignedAcks: 0,
              reason: `${self} does not hold "${key}" (${s.leader ?? 'nobody'} does), so it may `
                + 'not grant a claim on it.' };
          }
          // The leader refused its own proposal — because the unit is already claimed out, or
          // because it cannot compute the answer. Its own refusal is decisive: an elector whose
          // replica of the stock is behind must never be able to out-vote the peer that holds the
          // resource. Without this, `checkQuorum` would count the leader's ack as implicitly
          // granted below and two electors could carry a claim the leader had already refused.
          if (round.selfDenied) {
            return {
              granted: false, acks: [], quorum: s.decl.quorum, supersedes: [],
              denials: round.denials, term, beatenBy: round.selfDenied.beatenBy ?? null,
              signedAcks: 0, unsignedAcks: 0, reason: round.selfDenied.reason,
            };
          }
          const acks = [...round.acks.values()];
          // The leader's own ack is implicit and counts once — it is an elector too.
          if (!round.acks.has(self) && s.decl.electors.includes(self)) {
            acks.push({
              voter: self, term, leader: self, claim: proposal.id, granted: true,
              fingerprint: s.decl.fingerprint, signature: round.selfSignature ?? null,
            });
          }
          const check = checkQuorum(s.decl, acks, { term, claim: proposal.id });
          const beaten = round.denials.find((d) => d.beatenBy);
          return {
            granted: check.ok,
            acks,
            quorum: s.decl.quorum,
            supersedes: [...round.supersedes],
            denials: round.denials,
            term,
            beatenBy: beaten ? beaten.beatenBy : null,
            signedAcks: check.signed,
            unsignedAcks: check.unsigned,
            reason: check.ok ? null
              : (beaten ? beaten.reason : check.problems.join('\n  ')),
          };
        },
      };
      s.rounds.set(proposal.id, round);
      // Record the leader's own replica entry, then ask everybody else.
      const own = decideAck(s, {
        key, term, leader: self, fingerprint: s.decl.fingerprint, proposal,
      });
      if (!own.granted) {
        round.selfDenied = own;
        round.denials.push({ voter: self, reason: own.reason, beatenBy: own.beatenBy ?? null });
        // Nothing is broadcast. A proposal the holder of the resource has already refused must not
        // reach the electors: it would ask them to record a claim that will never be granted.
        return round;
      }
      for (const id of own.supersedes) round.supersedes.add(id);
      if (sign) {
        // Signed lazily but before any verdict is read: `pump()` awaits it.
        round.signing = signIf(ackPayloadText({
          key, term, leader: self, voter: self, claim: proposal.id, granted: true,
          fingerprint: s.decl.fingerprint,
        })).then((sig) => { round.selfSignature = sig; });
      }
      broadcast({
        t: 'propose', key, term, leader: self, fingerprint: s.decl.fingerprint, proposal,
      });
      return round;
    },

    /**
     * A non-leader asks the leader for a claim. Returns a request; `answer` is null until the
     * verdict arrives, and a null answer is a refusal for every caller that fails closed.
     *
     * If the verdict frame is lost, the requester refuses locally while the authority has in fact
     * granted the claim — so the units stay held by a reservation nobody redeems until its lease
     * runs out. That is the safe direction (unavailable, briefly, rather than sold twice) and it
     * needs nobody to intervene. The requester may simply ask again: a claim id is derived from the
     * asking peer's own logical stamp, so the retry is the same claim and the leader's decision is
     * idempotent.
     */
    request(key, proposal) {
      const s = st(key);
      const handle = {
        key, proposal, answer: null,
        verdict() {
          if (handle.answer === null) {
            return { granted: false, acks: [], reason:
              `no verdict on claim ${proposal.id} has come back from ${s.leader ?? 'any holder'} `
              + `of "${key}". An unreachable authority means the scarce-resource operation is `
              + 'refused, not attempted.' };
          }
          return {
            granted: handle.answer.granted === true,
            acks: handle.answer.acks || [],
            term: handle.answer.term,
            leader: handle.answer.leader,
            beatenBy: handle.answer.beatenBy ?? null,
            reason: handle.answer.reason ?? null,
          };
        },
      };
      s.requests.set(proposal.id, handle);
      const sent = sendTo(s.leader, {
        t: 'claim-request', key, from: self, proposal,
      });
      if (sent === 0 && s.leader !== self) handle.answer = null;
      return handle;
    },

    /**
     * Let claims go that never reached a majority, everywhere at once. Leader-only: an elector
     * cannot free stock it does not hold the authority for.
     * @param {string} key @param {{unit:string, claim?:string, id?:string}[]} claims
     * @param {string|null} [reason]
     */
    release(key, claims, reason = null) {
      const s = st(key);
      if (s.leader !== self) return 0;
      const list = (claims || []).map((c) => ({ unit: c.unit, claim: c.claim ?? c.id }));
      for (const c of list) drop(s, c.unit, [c.claim]);
      return broadcast({
        t: 'release', key, term: s.term, leader: self, fingerprint: s.decl.fingerprint,
        claims: list, reason,
      });
    },

    /** How many inbound frames are waiting. */
    pending: () => inbox.length,

    /**
     * Drain the inbox and advance every open round. No timers, no hidden async: the caller decides
     * when a peer thinks, which is what makes a partition reproducible.
     *
     * A forwarded claim-request becomes a proposal to the electors; whether it fits is decided by
     * `admitClaim()` against `available()`, in exactly the same code path as the leader's own
     * claims — so the leader cannot be more generous to itself than to anyone else.
     */
    async pump() {
      let worked = 0;
      while (inbox.length) {
        const frame = inbox.shift();
        await handle(frame);
        worked += 1;
      }
      // Let every in-flight signature land before any verdict can be read.
      for (const s of state.values()) {
        for (const round of s.rounds.values()) if (round.signing) await round.signing;
      }
      // Answer claim-requests this peer accepted as leader.
      for (const [key, s] of state) {
        if (s.pendingForwards.size === 0) continue;
        for (const [claimId, fwd] of [...s.pendingForwards]) {
          if (s.leader !== self) {
            s.pendingForwards.delete(claimId);
            sendTo(fwd.from, {
              t: 'claim-verdict', key, claim: claimId, granted: false, term: s.term,
              leader: s.leader, acks: [],
              reason: `${self} no longer holds "${key}".`,
            });
            continue;
          }
          let round = s.rounds.get(claimId);
          if (!round) {
            round = api.propose(key, fwd.proposal);
            worked += 1;
            if (round.signing) await round.signing;
          }
          const v = round.verdict();
          if (decided(s, round, v)) {
            s.pendingForwards.delete(claimId);
            sendTo(fwd.from, {
              t: 'claim-verdict', key, claim: claimId, granted: v.granted, term: v.term,
              leader: self, acks: v.acks, reason: v.reason, beatenBy: v.beatenBy ?? null,
            });
          }
        }
      }
      // A round that is decided AGAINST the claim leaves it in the replicas of every peer that
      // acked it, and in this peer's own. Let it go — see `release` in the protocol list above.
      //
      // A settled round is then forgotten. Its `verdict()` closes over the round object rather than
      // looking it up, so the caller's handle keeps working forever; what is dropped is only this
      // peer's index of open rounds, which would otherwise grow by one entry per business event for
      // as long as the peer runs. Forgetting also means a late ack for a settled round is ignored,
      // which is correct: the decision is made.
      for (const [key, s] of state) {
        for (const round of [...s.rounds.values()]) {
          if (round.settled) continue;
          // A round from a term that has passed can never be granted (see `verdict()`), so it is
          // settled by definition — including on a peer that is no longer the leader.
          if (round.term < s.term) {
            round.settled = true;
            s.rounds.delete(round.proposal.id);
            continue;
          }
          if (s.leader !== self) continue;
          const v = round.verdict();
          if (!decided(s, round, v)) continue;
          if (!v.granted && !round.selfDenied) {
            api.release(key, [{ unit: round.proposal.unit, claim: round.proposal.id }], v.reason);
            worked += 1;
          }
          round.settled = true;
          s.rounds.delete(round.proposal.id);
        }
        // Same for answered outbound requests: the handle the caller holds is unaffected.
        for (const [claimId, handle] of [...s.requests]) {
          if (handle.answer !== null) s.requests.delete(claimId);
        }
      }
      return worked;
    },

    /** Everything worth showing an operator, per resource. */
    stats(key) {
      const s = st(key);
      return {
        key, self, term: s.term, leader: s.leader, isLeader: s.leader === self,
        quorum: s.decl.quorum, electors: s.decl.electors,
        fingerprint: s.decl.fingerprint,
        silenceMs: api.silenceMs(key), leaseMs: s.decl.leaseMs,
        electionTimeoutMs: s.decl.electionTimeoutMs,
        claims: api.claimTable(key),
        numbers: [...s.watermarks.values()].map((w) => ({ unit: w.unit, value: w.value, claim: w.claim })),
        // Exposed so that "this peer does not accumulate one entry per business event" is a property
        // a test can check rather than a claim in a comment.
        open: {
          rounds: s.rounds.size, requests: s.requests.size, forwards: s.pendingForwards.size,
          ballots: s.ballots.size, inbox: inbox.length,
        },
      };
    },
  };

  return api;
}
