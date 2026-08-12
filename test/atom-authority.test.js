// test/atom-authority.test.js — the authoritative peer per scarce resource, and the election that
// replaces it (Appendix VIII, "the trick" and "the fallback").
//
// What this file has to establish, in order:
//
//   1. WHERE authority-per-resource is declared, and that the runtime never invents it.
//   2. That an election needs a MAJORITY of a FIXED elector set — so a partitioned minority cannot
//      elect itself, a split vote elects nobody, and two leaders in one term are impossible.
//   3. That the winner cannot lose what an earlier majority granted (Raft's leader completeness).
//   4. That the quorum evidence is signed with a real Ed25519 key and verifies against the real
//      SSHSIG verifier, in its own namespace — so "a majority stood behind this" is checkable by
//      somebody who does not trust us.
//   5. The split-brain this mechanism CANNOT prevent, demonstrated rather than described.
//
// Standing rule 3: the signatures here are verified by `runtime/identity/sshsig.js`'s verifier, and
// the same evidence is re-verified by the real `ssh-keygen -Y verify` binary in
// test/atom-reservation.test.js, where it sits inside a real commit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AUTHORITY_PATH, AUTHORITY_PROTOCOL, AUTHORITY_NAMESPACE,
  collectAuthorities, normalizeAuthority, authorityFingerprint, checkQuorum,
  votePayloadText, ackPayloadText, payloadBytes, authorityMember,
} from '../runtime/truth/authority.js';
import { verifyPayload } from '../runtime/identity/sshsig.js';
import { loopbackPipe } from '../runtime/live/session.js';
import { mesh, peerKeys, testClock } from './atom-mesh.js';
import { scanSources } from './_source-guard.js';

const WAREHOUSE = 'stock:berlin-main-warehouse';
const ARTICLE = 'article/ART-4711';
const ELECTORS = ['berlin', 'hetzner', 'munich'];

/** The file a company commits to declare who owns what. Nothing here is hand-built downstream. */
function authoritiesJson(over = {}) {
  return new Map([[AUTHORITY_PATH, JSON.stringify({
    neodonkey: 1,
    authorities: {
      [WAREHOUSE]: {
        peer: 'berlin',
        electors: ELECTORS,
        'lease-ms': 300_000,
        'election-timeout-ms': 120_000,
        ...over,
      },
    },
  }, null, 2)]]);
}

function declarationsFromRepo(over = {}) {
  const { authorities, errors } = collectAuthorities({ files: authoritiesJson(over) });
  assert.deepEqual(errors, [], 'the declaration file used by these tests must be clean');
  return authorities;
}

/** A three-peer mesh with 5 pcs on the shelf and real signing keys. */
async function warehouseMesh(over = {}) {
  const onHand = { [ARTICLE]: '5 pcs' };
  const keys = await peerKeys(ELECTORS);
  const m = mesh({
    peers: ELECTORS,
    declarations: declarationsFromRepo(over),
    keys,
    available: (peer, key, unit) => (key === WAREHOUSE ? (onHand[unit] ?? null) : null),
  });
  return { m, onHand, keys };
}

const claim = (m, peer, quantity, unit = ARTICLE) => {
  const stamp = m.stamp(peer);
  return { id: `RES-${stamp.wall}.${stamp.counter}.${peer}`, unit, quantity, stamp, by: peer };
};

// =============================================================================================
// 1. the declaration — a business decision, in the repository, never in the runtime
// =============================================================================================

test('authority-per-resource is declared in the repository, and the path is a model file', () => {
  assert.equal(AUTHORITY_PATH, 'operating-model/authorities.json',
    'the declaration is a business decision and belongs with the model, not in neodonkey.json '
    + '(written once at genesis) and not in repos.json (the legal-entity mesh, FD-3)');
  const { authorities } = collectAuthorities({ files: authoritiesJson() });
  const d = authorities.get(WAREHOUSE);
  assert.equal(d.resource, 'stock');
  assert.equal(d.scope, 'berlin-main-warehouse');
  assert.equal(d.peer, 'berlin');
  assert.equal(d.quorum, 2, 'three electors: a majority is two');
  assert.equal(d.source, AUTHORITY_PATH, 'every refusal must be able to quote where it came from');
});

test('the runtime contains no authority declaration of its own — no default peer, no default set', () => {
  const source = readFileSync(new URL('../runtime/truth/authority.js', import.meta.url), 'utf8');
  const violations = scanSources([['runtime/truth/authority.js', source]], [
    ['a hard-coded peer name', /berlin|munich|hetzner|warehouse/i,
      'which peer owns which resource is the company\'s decision, read from the repository'],
  ]);
  assert.deepEqual(violations, [],
    'a runtime that names a peer has decided something the company must decide');
});

test('a declaration is refused rather than guessed at: no peer, no electors, no lease', () => {
  const cases = [
    [{ electors: ELECTORS, 'lease-ms': 1000 }, /does not say which peer is authoritative/],
    [{ peer: 'berlin', 'lease-ms': 1000 }, /has no "electors" list/],
    [{ peer: 'berlin', electors: ELECTORS }, /does not declare a lease/],
    [{ peer: 'sarah', electors: ELECTORS, 'lease-ms': 1000 }, /does not list it among the electors/],
    [{ peer: 'berlin', electors: ['berlin', 'berlin'], 'lease-ms': 1000 }, /same elector twice/],
  ];
  for (const [raw, expected] of cases) {
    const { declaration, errors } = normalizeAuthority(WAREHOUSE, raw, AUTHORITY_PATH);
    assert.equal(declaration, null, `${JSON.stringify(raw)} must be refused`);
    assert.match(errors.join('\n'), expected);
    assert.match(errors.join('\n'), new RegExp(AUTHORITY_PATH.replace(/[/.]/g, '\\$&')),
      'a refusal must say which file it read');
  }
});

test('a quorum below a majority is refused — two disjoint groups could each reach it', () => {
  const { declaration, errors } = normalizeAuthority(
    WAREHOUSE, { peer: 'berlin', electors: ELECTORS, quorum: 1, 'lease-ms': 1000 }, AUTHORITY_PATH);
  assert.equal(declaration, null);
  assert.match(errors.join('\n'), /is not a majority \(2 is\)/);
  assert.match(errors.join('\n'), /both would believe they own the resource/);

  // Above the majority is allowed: a company may demand unanimity for its cash account.
  const strict = normalizeAuthority(
    WAREHOUSE, { peer: 'berlin', electors: ELECTORS, quorum: 3, 'lease-ms': 1000 }, AUTHORITY_PATH);
  assert.deepEqual(strict.errors, []);
  assert.equal(strict.declaration.quorum, 3);
});

test('an unreadable declaration file is treated as absent, and says so', () => {
  const { authorities, errors } = collectAuthorities({
    files: new Map([[AUTHORITY_PATH, '{ this is not json ']]),
  });
  assert.equal(authorities.size, 0);
  assert.match(errors.join('\n'), /is not readable JSON/);
  assert.match(errors.join('\n'), /every scarce-resource operation it would have governed is then refused/);
});

test('two declarations of one resource are refused, not merged', () => {
  const { errors } = collectAuthorities({
    model: { authorities: { [WAREHOUSE]: { peer: 'munich', electors: ELECTORS, 'lease-ms': 1000 } } },
    files: authoritiesJson(),
  });
  assert.match(errors.join('\n'), /is already declared in operating-model/);
});

// =============================================================================================
// 2. the election
// =============================================================================================

test('term 0 is the declaration itself: the declared peer leads until it is deposed', async () => {
  const { m } = await warehouseMesh();
  assert.equal(m.m('berlin').leaderOf(WAREHOUSE), 'berlin');
  assert.equal(m.m('munich').leaderOf(WAREHOUSE), 'berlin');
  assert.equal(m.m('berlin').isLeader(WAREHOUSE), true);
  assert.equal(m.m('munich').isLeader(WAREHOUSE), false);
  assert.equal(m.m('berlin').term(WAREHOUSE), 0);
});

test('silence is measured on the suspecting peer\'s own clock, and on nobody else\'s', async () => {
  const { m } = await warehouseMesh();
  // The three clocks are hours apart to begin with (see atom-mesh.js) — and it changes nothing.
  m.m('berlin').heartbeat(WAREHOUSE);
  await m.settle();
  assert.equal(m.m('munich').silenceMs(WAREHOUSE), 0);
  assert.equal(m.m('munich').suspectDown(WAREHOUSE), false);

  m.clock('berlin').advance(10 * 3_600_000);          // Berlin's clock jumps ten hours forward
  assert.equal(m.m('munich').silenceMs(WAREHOUSE), 0, 'a foreign clock cannot age a local lease');
  assert.equal(m.m('munich').suspectDown(WAREHOUSE), false);

  m.clock('munich').advance(120_001);                 // now MUNICH has waited past its timeout
  assert.equal(m.m('munich').silenceMs(WAREHOUSE), 120_001);
  assert.equal(m.m('munich').suspectDown(WAREHOUSE), true);
  assert.equal(m.m('berlin').suspectDown(WAREHOUSE), false, 'the leader never suspects itself');
});

test('the authority disappears mid-transaction: the remaining majority elects, and the claim it '
   + 'granted survives the handover', async () => {
  const { m } = await warehouseMesh();

  // --- Berlin grants 3 of the 5 pcs, with a majority behind it.
  const first = claim(m, 'berlin', '3 pcs');
  const round = m.m('berlin').propose(WAREHOUSE, first);
  await m.settle();
  const granted = round.verdict();
  assert.equal(granted.granted, true, granted.reason);
  assert.equal(granted.acks.length >= 2, true, 'a majority of three is two');

  // --- and then Berlin is gone. Mid-transaction: it has just proposed a second claim.
  const second = claim(m, 'berlin', '2 pcs');
  m.m('berlin').propose(WAREHOUSE, second);
  m.partition([['berlin'], ['munich', 'hetzner']]);
  assert.equal(await m.settle(), 0, 'nothing crosses a partition');

  // --- Munich waits out its own election timeout and stands.
  m.clock('munich').advance(120_001);
  assert.equal(m.m('munich').suspectDown(WAREHOUSE), true);
  const ballot = m.m('munich').standFor(WAREHOUSE);
  await m.settle();
  const verdict = ballot.verdict();
  assert.equal(verdict.elected, true, verdict.reason);
  assert.equal(verdict.term, 1);
  assert.deepEqual(verdict.votes, ['hetzner', 'munich']);
  assert.equal(m.m('munich').isLeader(WAREHOUSE), true);
  assert.equal(m.m('hetzner').leaderOf(WAREHOUSE), null,
    'hetzner voted, so it has no leader until the winner speaks — fail closed, not optimistic');

  // --- leader completeness: the new authority holds the claim the old majority granted.
  const table = m.m('munich').claimTable(WAREHOUSE);
  assert.deepEqual(table.map((c) => c.claim), [first.id],
    'a claim an earlier majority granted must not be lost by a later one');
  assert.equal(table[0].live, true, 'the adopted lease restarts on the new authority\'s clock');

  // --- and the adopted claim is *used*: 3 of 5 are gone, so 3 more do not fit and 2 do.
  const tooMuch = claim(m, 'munich', '3 pcs');
  const r2 = m.m('munich').propose(WAREHOUSE, tooMuch);
  await m.settle();
  const v2 = r2.verdict();
  assert.equal(v2.granted, false);
  assert.match(v2.reason, /3 pcs of 5 pcs is already claimed/);
  assert.equal(v2.beatenBy, first.id);

  const fits = claim(m, 'munich', '2 pcs');
  const r3 = m.m('munich').propose(WAREHOUSE, fits);
  await m.settle();
  assert.equal(r3.verdict().granted, true, r3.verdict().reason);
});

test('a partitioned MINORITY does not elect itself, and refuses every scarce-resource decision '
   + 'while it is cut off', async () => {
  const { m } = await warehouseMesh();
  m.partition([['berlin'], ['munich', 'hetzner']]);

  // The majority side elects Munich.
  m.clock('munich').advance(120_001);
  const winner = m.m('munich').standFor(WAREHOUSE);
  await m.settle();
  assert.equal(winner.verdict().elected, true);

  // The minority side is Berlin alone — the peer the file actually names as authoritative.
  m.clock('berlin').advance(120_001);
  const ballot = m.m('berlin').standFor(WAREHOUSE);
  await m.settle();
  const v = ballot.verdict();
  assert.equal(v.elected, false);
  assert.equal(v.votes.length, 1, 'a peer votes for itself and that is one vote, not a majority');
  assert.match(v.reason, /1 of the 2 votes needed/);
  assert.match(v.reason, /A minority does not elect itself/);
  assert.equal(m.m('berlin').leaderOf(WAREHOUSE), null, 'no leader, therefore no decisions');

  // And it cannot grant anything, however much it wants to — not even to itself. A peer whose
  // ballot failed has no leader, and a peer with no leader may not become its own.
  const wanted = claim(m, 'berlin', '5 pcs');
  const round = m.m('berlin').propose(WAREHOUSE, wanted);
  await m.settle();
  const verdict = round.verdict();
  assert.equal(verdict.granted, false);
  assert.match(verdict.reason, /berlin does not hold "stock:berlin-main-warehouse" \(nobody does\)/);
  assert.match(verdict.denials.map((d) => d.reason).join('\n'),
    /no majority has elected it in term 1/,
    'and the inner refusal says why: a peer with no leader may not become its own');
  assert.equal(m.m('berlin').claimTable(WAREHOUSE).length, 0,
    'a refused claim is not written into the claim table either');

  // Nor can it ask anybody: an unreachable authority is a refusal, not an attempt.
  const asked = m.m('berlin').request(WAREHOUSE, claim(m, 'berlin', '1 pcs'));
  await m.settle();
  assert.equal(asked.verdict().granted, false);
  assert.match(asked.verdict().reason, /An unreachable authority means the scarce-resource operation is refused/);
});

test('a split vote elects nobody: two candidates in one term, and both fail closed', async () => {
  const { m } = await warehouseMesh();
  m.partition([['berlin'], ['munich', 'hetzner']]);   // Berlin, the declared holder, is away

  // Both remaining peers time out and stand for the SAME term before either hears the other.
  m.clock('munich').advance(120_001);
  m.clock('hetzner').advance(120_001);
  const a = m.m('munich').standFor(WAREHOUSE);
  const b = m.m('hetzner').standFor(WAREHOUSE);
  assert.equal(a.term, 1);
  assert.equal(b.term, 1);
  await m.settle();

  const va = a.verdict();
  const vb = b.verdict();
  assert.equal(va.elected, false, 'each voted for itself; neither reached two');
  assert.equal(vb.elected, false);
  // Raft's rule, and the message says which of the two reasons applied: a candidate is already IN
  // term 1, so a request for term 1 is not "greater than mine" and is refused before the
  // one-vote-per-term check is even reached.
  assert.match(va.refusals.map((r) => r.reason).join(' '),
    /hetzner is already in term 1 of "stock:berlin-main-warehouse"; munich stood for term 1/);
  assert.match(vb.refusals.map((r) => r.reason).join(' '),
    /munich is already in term 1 of "stock:berlin-main-warehouse"; hetzner stood for term 1/);
  assert.equal(m.m('munich').leaderOf(WAREHOUSE), null);
  assert.equal(m.m('hetzner').leaderOf(WAREHOUSE), null);

  // The recovery is Raft's: stand again in the next term. One vote per peer per term is what makes
  // two leaders in one term impossible, and it is also what makes this retry safe.
  const again = m.m('munich').standFor(WAREHOUSE);
  assert.equal(again.term, 2);
  await m.settle();
  assert.equal(again.verdict().elected, true);
  assert.equal(m.m('hetzner').term(WAREHOUSE), 2);
});

test('one vote per peer per term, so two candidates cannot both win one term', async () => {
  const { m } = await warehouseMesh();
  // All three reachable. Two peers stand for term 1 at once; berlin has exactly one vote to give.
  m.clock('munich').advance(120_001);
  m.clock('hetzner').advance(120_001);
  const a = m.m('hetzner').standFor(WAREHOUSE);
  const b = m.m('munich').standFor(WAREHOUSE);
  await m.settle();

  const elected = [a, b].map((x) => x.verdict()).filter((v) => v.elected);
  assert.equal(elected.length, 1,
    'exactly one candidate may hold a term — this is the property that makes two leaders, and '
    + 'therefore two conflicting grants of the same stock, impossible');
  const refused = [a, b].map((x) => x.verdict()).find((v) => !v.elected);
  assert.match(refused.refusals.map((r) => r.reason).join(' '),
    /already voted for hetzner in term 1, and a peer has one vote per term/,
    'the loser is told that berlin had already spent its vote, and why that rule exists');
  assert.equal(m.m('berlin').term(WAREHOUSE), 1);
});

test('a duplicated frame changes nothing: at-least-once delivery is all a PeerLink promises', async () => {
  const { m } = await warehouseMesh();

  // A claim, granted, and then every frame of the round delivered a second time.
  const proposal = claim(m, 'berlin', '2 pcs');
  const round = m.m('berlin').propose(WAREHOUSE, proposal);
  await m.settle();
  assert.equal(round.verdict().granted, true);
  const table = JSON.stringify(m.m('munich').claimTable(WAREHOUSE));

  const again = m.m('berlin').propose(WAREHOUSE, proposal);   // the very same proposal, resent
  await m.settle();
  assert.equal(again.verdict().granted, true, 're-delivery is idempotent, not a conflict');
  assert.equal(m.m('munich').claimTable(WAREHOUSE).length, 1, 'and it is still ONE claim');
  assert.equal(JSON.parse(table)[0].claim, proposal.id);

  // A vote-request, delivered twice.
  m.clock('munich').advance(120_001);
  const ballot = m.m('munich').standFor(WAREHOUSE);
  await m.settle();
  assert.equal(ballot.verdict().elected, true);
  const before = ballot.verdict().votes.length;
  m.m('munich').standFor(WAREHOUSE);            // a fresh term, and the old ballot is unaffected
  await m.settle();
  assert.equal(ballot.verdict().votes.length, before);
  assert.deepEqual(ballot.refusals, [], 'a re-delivered vote-request must not look like a retraction');
});

test('a deposed authority may not grant, and learns it is deposed from the first heartbeat', async () => {
  const { m } = await warehouseMesh();
  m.partition([['berlin'], ['munich', 'hetzner']]);
  m.clock('munich').advance(120_001);
  const ballot = m.m('munich').standFor(WAREHOUSE);
  await m.settle();
  assert.equal(ballot.verdict().elected, true);

  // Berlin, still believing it is the authority, proposes a claim into the void.
  const stale = claim(m, 'berlin', '4 pcs');
  const round = m.m('berlin').propose(WAREHOUSE, stale);
  assert.equal(m.m('berlin').isLeader(WAREHOUSE), true, 'it does not know yet');

  // The partition heals. Its proposal arrives at electors who have moved on.
  m.partition(null);
  m.m('munich').heartbeat(WAREHOUSE);
  await m.settle();

  const v = round.verdict();
  assert.equal(v.granted, false);
  assert.match(v.reason,
    /"stock:berlin-main-warehouse" has moved from term 0 to term 1 since claim .* was proposed/,
    'the round says exactly why it is void: the acks it collected describe a term that has passed');
  assert.equal(m.m('berlin').isLeader(WAREHOUSE), false, 'the heartbeat deposed it');
  assert.equal(m.m('berlin').leaderOf(WAREHOUSE), 'munich');
  assert.equal(m.m('berlin').term(WAREHOUSE), 1);

  // And the electors refused it on their side too — which is the half that matters, because it is
  // what stops the stale claim from existing anywhere. Their reason is the deposition itself.
  for (const elector of ['munich', 'hetzner']) {
    assert.deepEqual(m.m(elector).claimTable(WAREHOUSE).map((c) => c.claim), [],
      `${elector} must not have recorded a claim from a deposed authority`);
  }
  const direct = m.m('munich').propose(WAREHOUSE, claim(m, 'munich', '4 pcs'));
  await m.settle();
  assert.equal(direct.verdict().granted, true,
    'and the resource is not stuck: the new authority can grant what the old one could not');
});

// =============================================================================================
// 3. the evidence
// =============================================================================================

test('the quorum evidence is signed by real Ed25519 keys and verifies under its own namespace', async () => {
  const { m, keys } = await warehouseMesh();
  const proposal = claim(m, 'berlin', '5 pcs');
  const round = m.m('berlin').propose(WAREHOUSE, proposal);
  await m.settle();
  const v = round.verdict();
  assert.equal(v.granted, true, v.reason);
  assert.equal(v.unsignedAcks, 0, 'every ack in the evidence must be signed');
  assert.ok(v.signedAcks >= 2);

  for (const ack of v.acks) {
    const text = ackPayloadText({
      key: WAREHOUSE, term: ack.term, leader: 'berlin', voter: ack.voter,
      claim: proposal.id, granted: true, fingerprint: ack.fingerprint,
    });
    assert.equal(
      await verifyPayload(keys.get(ack.voter).publicSsh, payloadBytes(text), ack.signature,
        AUTHORITY_NAMESPACE),
      true, `${ack.voter}'s ack must verify`);

    // The namespace is not 'git': an ack must never be replayable as a commit signature.
    assert.equal(
      await verifyPayload(keys.get(ack.voter).publicSsh, payloadBytes(text), ack.signature, 'git'),
      false, 'an ack must not verify in the git namespace');

    // And it covers the term: an ack from term 0 must not stand in for term 1.
    const forged = ackPayloadText({
      key: WAREHOUSE, term: ack.term + 1, leader: 'berlin', voter: ack.voter,
      claim: proposal.id, granted: true, fingerprint: ack.fingerprint,
    });
    assert.equal(
      await verifyPayload(keys.get(ack.voter).publicSsh, payloadBytes(forged), ack.signature,
        AUTHORITY_NAMESPACE),
      false, 'the term is inside the signed bytes');
  }
});

test('a vote whose signature does not verify is not counted', async () => {
  const keys = await peerKeys(ELECTORS);
  const decls = declarationsFromRepo();

  // The control case: everybody signs with the key the others verify against.
  const honest = mesh({ peers: ELECTORS, declarations: decls, keys });
  const control = honest.m('munich').standFor(WAREHOUSE);
  await honest.settle();
  assert.equal(control.verdict().elected, true, 'the control case must elect');

  // The same mesh, except hetzner signs with a key nobody has declared for it.
  const stranger = await peerKeys(['stranger']);
  const forged = mesh({
    peers: ELECTORS,
    declarations: decls,
    keys,
    signKeys: new Map([...keys, ['hetzner', stranger.get('stranger')]]),
  });
  // Berlin is away, so hetzner's vote is the only one that could complete the majority.
  forged.partition([['berlin'], ['munich', 'hetzner']]);
  const ballot = forged.m('munich').standFor(WAREHOUSE);
  await forged.settle();
  const v = ballot.verdict();
  assert.equal(v.elected, false, 'without hetzner\'s real signature there is no majority');
  assert.match(v.refusals.map((r) => r.reason).join(' '), /the vote signature does not verify/);
  assert.equal(forged.m('munich').leaderOf(WAREHOUSE), null, 'and therefore no leader');
});

test('checkQuorum refuses evidence that does not add up, and says which part', () => {
  const decl = declarationsFromRepo().get(WAREHOUSE);
  const ok = (over) => ({
    voter: 'munich', term: 1, claim: 'RES-1', granted: true,
    fingerprint: decl.fingerprint, signature: 'x', ...over,
  });
  const expect = { term: 1, claim: 'RES-1' };

  assert.equal(checkQuorum(decl, [ok(), ok({ voter: 'hetzner' })], expect).ok, true);

  const twice = checkQuorum(decl, [ok(), ok()], expect);
  assert.equal(twice.ok, false);
  assert.match(twice.problems.join('\n'), /acked twice; a peer has one vote/);

  const stranger = checkQuorum(decl, [ok(), ok({ voter: 'sarah@example.com' })], expect);
  assert.equal(stranger.ok, false);
  assert.match(stranger.problems.join('\n'), /is not one of the declared electors/);

  const foreign = checkQuorum(decl, [ok(), ok({ voter: 'hetzner', fingerprint: 'other#2of2/a,b' })], expect);
  assert.equal(foreign.ok, false);
  assert.match(foreign.problems.join('\n'), /acked under a different declaration/);

  const short = checkQuorum(decl, [ok()], expect);
  assert.equal(short.ok, false);
  assert.match(short.problems.join('\n'), /1 of the required 2 electors granted/);
  assert.match(short.problems.join('\n'), /a delay is cheaper than selling the last pallet twice/);
});

// =============================================================================================
// 4. the split-brain this mechanism cannot prevent — demonstrated, not described
// =============================================================================================

test('TWO DECLARATIONS, TWO MAJORITIES: the split-brain no protocol can resolve, and what the '
   + 'runtime does instead', async () => {
  // The company commits one elector set. Somebody else commits another — a reorganisation whose
  // two commits never met. Each declaration is internally valid and each has its own majority.
  const wide = declarationsFromRepo();                                  // berlin, hetzner, munich
  const { authorities: narrowSet, errors } = collectAuthorities({
    files: new Map([[AUTHORITY_PATH, JSON.stringify({
      authorities: {
        [WAREHOUSE]: { peer: 'munich', electors: ['munich', 'lyon'], 'lease-ms': 300_000 },
      },
    })]]),
  });
  assert.deepEqual(errors, []);
  const narrow = narrowSet;

  assert.notEqual(wide.get(WAREHOUSE).fingerprint, narrow.get(WAREHOUSE).fingerprint,
    'the fingerprint is what makes two constitutions distinguishable at all');

  // 1. Across the boundary, no vote counts. Munich stands under the narrow constitution and Berlin,
  //    which holds the wide one, refuses — naming both, so an operator can see the real problem.
  const pipe = loopbackPipe('berlin', 'munich');
  const berlin = authorityMember({
    self: 'berlin', clock: testClock(1_000).fn, declarations: wide, links: [pipe.ends.berlin],
  });
  const munich = authorityMember({
    self: 'munich', clock: testClock(9_000_000).fn, declarations: narrow, links: [pipe.ends.munich],
  });
  const ballot = munich.standFor(WAREHOUSE);
  pipe.flushTo('berlin');
  await berlin.pump();
  pipe.flushTo('munich');
  await munich.pump();
  const refused = ballot.verdict();
  assert.equal(refused.elected, false, 'one vote of the two its own constitution requires');
  assert.match(refused.refusals.map((r) => r.reason).join('\n'),
    /berlin holds a different declaration of "stock:berlin-main-warehouse"/);
  assert.match(refused.refusals.map((r) => r.reason).join('\n'),
    /it will not vote under two constitutions at once/);

  // 2. A cross-constitution ack is refused with both fingerprints named, so a majority of one
  //    elector set is never counted against a majority of another.
  const cross = checkQuorum(wide.get(WAREHOUSE), [
    { voter: 'munich', term: 1, claim: 'RES-1', granted: true, signature: 'x',
      fingerprint: wide.get(WAREHOUSE).fingerprint },
    { voter: 'hetzner', term: 1, claim: 'RES-1', granted: true, signature: 'x',
      fingerprint: narrow.get(WAREHOUSE).fingerprint },
  ], { term: 1, claim: 'RES-1' });
  assert.equal(cross.ok, false);
  assert.match(cross.problems.join('\n'),
    /Two peers counting majorities of two different elector sets is the one split-brain this mechanism cannot resolve/);

  // 3. AND YET: each group, on its own, elects a leader and grants claims. This is the case that
  //    cannot be prevented — the two groups are not disagreeing about who won an election, they
  //    are running two different elections. It is only detectable when the commits meet, and
  //    `auditReservations` is what detects it (see atom-reservation.test.js).
  const groupA = mesh({ peers: ['berlin', 'hetzner', 'munich'], declarations: wide });
  const groupB = mesh({ peers: ['munich', 'lyon'], declarations: narrow });
  groupA.clock('hetzner').advance(300_001);
  const a = groupA.m('hetzner').standFor(WAREHOUSE);
  await groupA.settle();
  const b = groupB.m('munich').standFor(WAREHOUSE);
  await groupB.settle();
  assert.equal(a.verdict().elected, true, 'the wide constitution elects hetzner');
  assert.equal(b.verdict().elected, true, 'the narrow constitution elects munich');
  assert.notEqual(groupA.m('hetzner').fingerprint(WAREHOUSE), groupB.m('munich').fingerprint(WAREHOUSE),
    'two holders of one resource, each with a real majority of its own elector set. This is the '
    + 'limit: authority.js can refuse to MIX the two, and cannot stop the company from declaring '
    + 'them. The exit is a single signed declaration, which is why AUTHORITY_PATH is one file.');
});

test('a peer that ignores the protocol cannot be prevented from writing a claim — only caught', () => {
  // Stated here because it is a property of the design, not of a bug: every peer can always write
  // to its own repository. The defence is that the claim carries no majority, and the audit says so.
  const decl = declarationsFromRepo().get(WAREHOUSE);
  const result = checkQuorum(decl, [], { term: 0, claim: 'RES-forged' });
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /0 of the required 2 electors granted claim RES-forged/);
});

// =============================================================================================
// 5. no wall clock, and no clock at all in the record layer
// =============================================================================================

test('neither authority.js nor reservation.js reads the system clock', () => {
  const sources = ['runtime/truth/authority.js', 'runtime/truth/reservation.js']
    .map((f) => [f, readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]);
  const violations = scanSources(sources, [
    ['Date.now', /\bDate\s*\.\s*now\b/, 'the clock is injected (CONTRACT non-negotiable #5)'],
    ['new Date', /\bnew\s+Date\b/, 'the clock is injected (CONTRACT non-negotiable #5)'],
    ['performance.now', /\bperformance\s*\.\s*now\b/, 'the clock is injected'],
    ['setTimeout', /\bsetTimeout\b/, 'a TTL enforced by a timer is a TTL two peers disagree about'],
    ['setInterval', /\bsetInterval\b/, 'no hidden async: the caller decides when a peer thinks'],
  ]);
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});

test('the protocol tag is versioned, and a frame that is not ours is ignored', async () => {
  const { m } = await warehouseMesh();
  assert.equal(AUTHORITY_PROTOCOL, 'nd-authority/1');
  // The Live Layer's frames are JSON arrays and share the link. Neither must disturb the other.
  const link = {
    id: 'munich',
    send() {},
    onFrame(h) { link.handler = h; },
    close() {},
    handler: null,
  };
  m.m('berlin').attach(link);
  link.handler('[[1,"not-ours"]]');
  link.handler('not json at all');
  link.handler(JSON.stringify({ nd: 'nd-authority/2', t: 'heartbeat', key: WAREHOUSE, term: 99 }));
  assert.equal(m.m('berlin').pending(), 3);
  await m.m('berlin').pump();
  assert.equal(m.m('berlin').term(WAREHOUSE), 0, 'a foreign frame changed nothing');
  assert.equal(m.m('berlin').leaderOf(WAREHOUSE), 'berlin');
});

test('the fingerprint is readable, so a refusal can show an operator both constitutions', () => {
  const decl = declarationsFromRepo().get(WAREHOUSE);
  assert.equal(authorityFingerprint(decl), `${WAREHOUSE}#2of3/berlin,hetzner,munich`);
  assert.equal(votePayloadText({
    key: WAREHOUSE, term: 1, candidate: 'munich', voter: 'hetzner', granted: true,
    fingerprint: decl.fingerprint,
  }).split('\n').length, 8, 'one field per line, terminated, so an auditor can rebuild it by hand');
});
