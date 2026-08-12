// test/atom-reservation.test.js — Appendix VIII's complex case, end to end.
//
// THE QUESTION THIS FILE ANSWERS: can two peers try to sell the last five units at the same moment,
// and does exactly one succeed, with the loser told why?
//
// Appendix VIII's own scenario: "Berlin sells 5 units of the last 5 pieces, Munich sells 3
// simultaneously." Both orders of logical time are run, because "simultaneously" has two meanings
// and only one of them is Berlin's:
//
//   * Berlin's claim is logically earlier → Berlin gets the 5, Munich is refused with the reason.
//   * Munich's claim is logically earlier → Munich gets the 3, and Berlin's own already-granted
//     claim is VOIDED by a storno, which is the sentence Appendix VIII actually wrote.
//
// And the three things a reservation with a TTL has to survive:
//
//   * expiry — the lease runs out, the units are claimable again, and the abandoned reservation can
//     never be redeemed afterwards;
//   * the storno being a REAL commit — signed, in `git log`, verified by the `git` and `ssh-keygen`
//     binaries rather than by our own agreement with ourselves (standing rule 3);
//   * the audit — a peer that ignored the protocol is caught by reading the records back.
//
// Stock never goes negative anywhere in this file, and one test asserts exactly that after a
// deliberately adversarial sequence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AUTHORITY_PATH, AUTHORITY_NAMESPACE, collectAuthorities, ackPayloadText, payloadBytes }
  from '../runtime/truth/authority.js';
import {
  RESERVATION_ENTITY, RESERVATION_TRAILER_KEY, claimRecord, voidRecord, reservationTrailer,
  readReservationTrailers, ledgerOf, statusOf, redeemable, openClaims, availability,
  resolveCollisions, admissiblePrefix, admitClaim, overdue, expiryStorno, collisionStornos,
  auditReservations,
} from '../runtime/truth/reservation.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { signPayload, verifyPayload, allowedSignersLine } from '../runtime/identity/sshsig.js';
import { mesh, peerKeys } from './atom-mesh.js';

const WAREHOUSE = 'stock:berlin-main-warehouse';
const ARTICLE = 'article/ART-4711';
const ELECTORS = ['berlin', 'hetzner', 'munich'];
const LEASE = 300_000;

const enc = new TextEncoder();
const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-atom-${tag}-`));
const git = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function declarations() {
  const { authorities, errors } = collectAuthorities({
    files: new Map([[AUTHORITY_PATH, JSON.stringify({
      authorities: {
        [WAREHOUSE]: {
          peer: 'berlin', electors: ELECTORS, 'lease-ms': LEASE, 'election-timeout-ms': 120_000,
        },
      },
    })]]),
  });
  assert.deepEqual(errors, []);
  return authorities;
}

/**
 * The warehouse: 5 pcs of one article, and three peers who all believe it.
 * `onHand` is what each peer's own repository says — a test may change one peer's view alone.
 *
 * `offsets` sets where each peer's clock starts. It is passed explicitly wherever a test needs a
 * particular peer to be logically FIRST, because "Berlin and Munich at the same moment" has two
 * cases and both are Appendix VIII's. The offsets are hours apart in every case: no test in this
 * file ever runs against clocks that agree.
 */
async function warehouse(stock = '5 pcs', offsets = undefined) {
  const onHand = new Map(ELECTORS.map((p) => [p, { [ARTICLE]: stock }]));
  const keys = await peerKeys(ELECTORS);
  const m = mesh({
    peers: ELECTORS,
    declarations: declarations(),
    keys,
    offsets,
    available: (peer, key, unit) => (key === WAREHOUSE ? (onHand.get(peer)[unit] ?? null) : null),
  });
  return { m, onHand, keys };
}

/** Clocks where Munich runs an hour BEHIND Berlin, so Munich's stamps are logically earlier. */
const MUNICH_FIRST = {
  munich: Date.parse('2027-11-03T08:00:00Z'),
  hetzner: Date.parse('2027-11-03T09:30:00Z'),
  berlin: Date.parse('2027-11-03T10:00:00Z'),
};

/** A proposal, stamped by the peer's own Hybrid Logical Clock. */
function proposalFrom(m, peer, quantity, unit = ARTICLE) {
  const stamp = m.stamp(peer);
  return { id: `RES-${stamp.wall}.${stamp.counter}.${peer}`, unit, quantity, stamp, by: peer };
}

/** The record a granted round becomes. */
const recordOf = (proposal, verdict, grantedBy) => claimRecord({
  resource: WAREHOUSE, unit: proposal.unit, quantity: proposal.quantity, by: proposal.by,
  stamp: proposal.stamp, term: verdict.term, grantedBy, quorum: verdict.acks, leaseMs: LEASE,
  expiresAdvisory: '14:22 local time on the granting peer — for the reader, never for the code',
});

// =============================================================================================
// 1. APPENDIX VIII'S SCENARIO
// =============================================================================================

test('APPENDIX VIII: Berlin sells the last 5 while Munich sells 3 at the same moment — Berlin '
   + 'logically first. Exactly one succeeds, and the loser is told why.', async () => {
  const { m } = await warehouse('5 pcs');

  // Berlin, the authoritative peer for its own warehouse, stamps first.
  const berlin = proposalFrom(m, 'berlin', '5 pcs');
  const munich = proposalFrom(m, 'munich', '3 pcs');

  // Both act before either has heard of the other. That is what "simultaneously" means with no
  // server: two peers, two local decisions, one shelf.
  const berlinRound = m.m('berlin').propose(WAREHOUSE, berlin);
  const munichAsk = m.m('munich').request(WAREHOUSE, munich);
  await m.settle();

  const won = berlinRound.verdict();
  const lost = munichAsk.verdict();

  assert.equal(won.granted, true, won.reason);
  assert.equal(lost.granted, false, 'the last five units must not be sold twice');
  assert.equal(won.acks.length >= 2, true, 'a majority of the three electors stood behind it');
  assert.equal(lost.beatenBy, berlin.id, 'the loser is told WHICH claim beat it');
  assert.match(lost.reason, /5 pcs of 5 pcs is already claimed/);
  assert.match(lost.reason, /Appendix VIII: both reservation events land, the earlier logical/);

  // The output Appendix VIII's paragraph describes, printed so a reader can see it rather than
  // take our word for it.
  console.log(`\n  Appendix VIII, Berlin first — on hand: 5 pcs\n`
    + `    berlin claims 5 pcs → GRANTED in term ${won.term} by ${won.acks.length} electors `
    + `(${won.quorum} required): ${won.acks.map((a) => a.voter).sort().join(', ')}\n`
    + `    munich claims 3 pcs → REFUSED: ${lost.reason}\n`);

  // Every peer agrees, and nothing is negative anywhere.
  for (const p of ELECTORS) {
    const table = m.m(p).claimTable(WAREHOUSE);
    assert.deepEqual(table.map((c) => c.claim), [berlin.id], `${p} must hold exactly one claim`);
  }
  const records = [recordOf(berlin, won, 'berlin')];
  const left = availability('5 pcs', records, { resource: WAREHOUSE, unit: ARTICLE });
  assert.equal(left.available, '0 pcs');
  assert.equal(left.claimed, '5 pcs');
  assert.equal(left.overClaimed, false);
});

test('APPENDIX VIII, the other order: Munich is logically first, so Berlin\'s own granted claim is '
   + 'the one that gets a storno', async () => {
  const { m } = await warehouse('5 pcs', MUNICH_FIRST);

  // Munich stamps first this time. (Its clock runs an hour behind Berlin's, which is exactly the
  // situation that makes wall-clock reasoning wrong and logical ordering right.)
  const munich = proposalFrom(m, 'munich', '3 pcs');
  const berlin = proposalFrom(m, 'berlin', '5 pcs');
  assert.equal(munich.stamp.wall < berlin.stamp.wall, true, 'munich is logically earlier');

  // Berlin grants its own 5 first — it has heard nothing yet, and it is the authority.
  const berlinRound = m.m('berlin').propose(WAREHOUSE, berlin);
  const munichAsk = m.m('munich').request(WAREHOUSE, munich);
  await m.settle();

  const munichVerdict = munichAsk.verdict();
  assert.equal(munichVerdict.granted, true,
    'the EARLIER logical timestamp is valid — Appendix VIII, verbatim');
  assert.deepEqual(berlinRound.verdict().supersedes, [],
    'berlin\'s own round was granted before munich\'s arrived; the void comes from the later round');

  // The later reservation — Berlin's own — is superseded, and Berlin knows which one it owes a
  // storno for. That is `supersedes` on the round that displaced it.
  const displaced = m.m('berlin').claimTable(WAREHOUSE);
  assert.deepEqual(displaced.map((c) => c.claim), [munich.id],
    'the displaced claim leaves the table; only the earlier one still stands');

  // The storno is written from the records, by the collision rule, not by hand.
  const records = [
    recordOf(berlin, berlinRound.verdict(), 'berlin'),
    recordOf(munich, munichVerdict, 'berlin'),
  ];
  const stornos = collisionStornos(records, () => '5 pcs', {
    by: 'berlin', stampFor: () => m.stamp('berlin'),
  });
  assert.equal(stornos.length, 1);
  assert.equal(stornos[0].voids, records[0].id, 'berlin\'s later claim is the one voided');
  assert.equal(stornos[0].code, 'lost-collision');
  assert.equal(stornos[0]['beaten-by'], records[1].id);
  assert.match(stornos[0].reason, /logical time/);

  const after = [...records, ...stornos];
  assert.equal(statusOf(records[0].id, after).status, 'void');
  assert.equal(statusOf(records[1].id, after).status, 'open');
  assert.equal(availability('5 pcs', after, { resource: WAREHOUSE, unit: ARTICLE }).available, '2 pcs');
  assert.equal(redeemable(records[0].id, after).ok, false, 'a voided reservation cannot be redeemed');
  assert.equal(redeemable(records[1].id, after, { by: 'munich' }).ok, true);

  console.log(`\n  Appendix VIII, Munich first — on hand: 5 pcs\n`
    + `    munich claims 3 pcs → GRANTED (earlier logical timestamp)\n`
    + `    berlin claims 5 pcs → VOIDED by storno ${stornos[0].id}\n`
    + `    remaining: ${availability('5 pcs', after, { resource: WAREHOUSE, unit: ARTICLE }).available}\n`);
});

test('two claims that BOTH fit are both granted — a reservation system that serialised every sale '
   + 'of an article would be useless', async () => {
  const { m } = await warehouse('10 pcs');
  const berlin = proposalFrom(m, 'berlin', '5 pcs');
  const munich = proposalFrom(m, 'munich', '3 pcs');

  const r1 = m.m('berlin').propose(WAREHOUSE, berlin);
  const ask = m.m('munich').request(WAREHOUSE, munich);
  await m.settle();

  assert.equal(r1.verdict().granted, true);
  assert.equal(ask.verdict().granted, true, '5 + 3 fits inside 10, so both stand');
  assert.equal(m.m('hetzner').claimTable(WAREHOUSE).length, 2, 'and every elector holds both');

  // The third one does not fit. It comes from Munich, whose clock runs last in this harness, so it
  // is also logically last — and the refusal shows the arithmetic rather than asserting a conflict.
  const third = m.m('munich').request(WAREHOUSE, proposalFrom(m, 'munich', '3 pcs'));
  await m.settle();
  assert.equal(third.verdict().granted, false);
  assert.match(third.verdict().reason, /8 pcs of 10 pcs is already claimed/);
  assert.equal(m.m('berlin').claimTable(WAREHOUSE).length, 2, 'and the refusal wrote nothing');
});

test('stock never goes negative, however the requests are interleaved', async () => {
  const { m } = await warehouse('5 pcs');
  const asks = [];
  // Eleven claims of 1–3 pcs from all three peers, all before any delivery: the adversarial case.
  for (let i = 0; i < 11; i++) {
    const peer = ELECTORS[i % 3];
    const proposal = proposalFrom(m, peer, `${(i % 3) + 1} pcs`);
    asks.push(peer === 'berlin'
      ? { proposal, handle: m.m('berlin').propose(WAREHOUSE, proposal) }
      : { proposal, handle: m.m(peer).request(WAREHOUSE, proposal) });
  }
  await m.settle(64);

  const granted = asks.filter((a) => a.handle.verdict().granted);
  const refused = asks.filter((a) => !a.handle.verdict().granted);
  assert.ok(granted.length >= 1, 'somebody must get some of it');
  assert.equal(granted.length + refused.length, 11);
  for (const r of refused) {
    assert.ok(typeof r.handle.verdict().reason === 'string' && r.handle.verdict().reason.length > 20,
      'every refusal carries a sentence a person can act on');
  }

  // The claim tables of all three peers agree, and the total claimed never exceeds the shelf.
  const records = granted.map((a) => recordOf(a.proposal, a.handle.verdict(), 'berlin'));
  const left = availability('5 pcs', records, { resource: WAREHOUSE, unit: ARTICLE });
  assert.equal(left.overClaimed, false,
    `granted claims total ${left.claimed} against 5 pcs on hand — the shelf went negative`);
  const { losers } = resolveCollisions(records, () => '5 pcs');
  assert.deepEqual(losers, [], 'nothing granted needs a storno: the live rule already held');
});

// =============================================================================================
// 2. THE TTL
// =============================================================================================

test('the lease runs out on the authority\'s own clock, the units are claimable again, and the '
   + 'abandoned reservation can never be redeemed', async () => {
  const { m } = await warehouse('5 pcs');
  const abandoned = proposalFrom(m, 'berlin', '5 pcs');
  const round = m.m('berlin').propose(WAREHOUSE, abandoned);
  await m.settle();
  const granted = round.verdict();
  assert.equal(granted.granted, true);

  // Nothing has expired yet, and a claim on the remaining nothing is refused.
  assert.deepEqual(m.m('berlin').lapsed(WAREHOUSE), []);
  const tooEarly = m.m('munich').request(WAREHOUSE, proposalFrom(m, 'munich', '5 pcs'));
  await m.settle();
  assert.equal(tooEarly.verdict().granted, false);

  // Time passes. Every peer's clock advances by its own amount — that is what a lease is: a
  // DURATION each machine measures against its own experience. No absolute instant is exchanged, so
  // the offsets between these three clocks (hours) are irrelevant and only the elapsed time counts.
  m.clock('berlin').advance(LEASE + 1);
  m.clock('munich').advance(LEASE + 4_012);
  m.clock('hetzner').advance(LEASE + 77);
  const lapsed = m.m('berlin').lapsed(WAREHOUSE);
  assert.equal(lapsed.length, 1);
  assert.equal(lapsed[0].claim, abandoned.id);
  assert.equal(lapsed[0].elapsedMs, LEASE + 1);
  assert.equal(m.m('munich').lapsed(WAREHOUSE)[0].elapsedMs, LEASE + 4_012,
    'each peer measures the same lease against its own clock, and gets its own elapsed number');

  // The authority records the fact. `overdue()` refuses to be handed two different clocks.
  const claim = recordOf(abandoned, granted, 'berlin');
  assert.equal(overdue(claim, { nowMs: lapsed[0].nowMs, grantedAtMs: lapsed[0].grantedAtMs }), true);
  assert.throws(() => overdue(claim, { nowMs: NaN, grantedAtMs: 0 }),
    /both times must be readings of the SAME local clock/);
  assert.equal(expiryStorno({
    claim, stamp: m.stamp('berlin'), by: 'berlin', nowMs: lapsed[0].nowMs - LEASE, grantedAtMs: lapsed[0].grantedAtMs,
  }), null, 'a live claim is never voided by calling the expiry writer at the wrong moment');

  const storno = expiryStorno({
    claim, stamp: m.stamp('berlin'), by: 'berlin',
    nowMs: lapsed[0].nowMs, grantedAtMs: lapsed[0].grantedAtMs,
  });
  assert.equal(storno.code, 'lease-expired');
  assert.match(storno.reason, /300001 ms have passed on berlin's own clock/);
  assert.match(storno.reason, /no other machine's reading takes part in the decision/);

  // The record settles it for every peer, whatever their clocks say.
  const records = [claim, storno];
  assert.equal(statusOf(claim.id, records).status, 'void');
  const redeem = redeemable(claim.id, records, { by: 'berlin' });
  assert.equal(redeem.ok, false);
  assert.equal(redeem.code, 'reservation-void');
  assert.match(redeem.reason, /the units went back into availability the moment the storno was committed/);
  assert.equal(availability('5 pcs', records, { resource: WAREHOUSE, unit: ARTICLE }).available, '5 pcs');

  // And the resource really is claimable again.
  m.m('berlin').retire(WAREHOUSE, [{ unit: ARTICLE, claim: abandoned.id }]);
  const next = proposalFrom(m, 'munich', '5 pcs');
  const again = m.m('munich').request(WAREHOUSE, next);
  await m.settle();
  assert.equal(again.verdict().granted, true, 'the last five units are available to the next buyer');
  assert.equal(redeemable(claim.id, [claim, storno]).ok, false,
    'and the abandoned reservation STILL cannot be redeemed, now that somebody else holds the units');
});

test('an elector whose clock has stopped blocks the reclaim rather than allowing a double grant', async () => {
  // The awkward case, stated rather than avoided. A lease is a duration each peer measures for
  // itself, so peers agree about expiry to within clock DRIFT — not offset. A suspended laptop has
  // no drift, it has a stopped clock, and it will still believe it holds the claim.
  const { m } = await warehouse('5 pcs');
  const held = proposalFrom(m, 'berlin', '5 pcs');
  const round = m.m('berlin').propose(WAREHOUSE, held);
  await m.settle();
  assert.equal(round.verdict().granted, true);

  // Only the authority experiences the lease running out. Both electors are asleep.
  m.clock('berlin').advance(LEASE + 1);
  assert.equal(m.m('berlin').lapsed(WAREHOUSE).length, 1);
  assert.equal(m.m('munich').lapsed(WAREHOUSE).length, 0);
  m.m('berlin').retire(WAREHOUSE, [{ unit: ARTICLE, claim: held.id }]);

  const next = m.m('munich').request(WAREHOUSE, proposalFrom(m, 'munich', '5 pcs'));
  await m.settle();
  const v = next.verdict();
  assert.equal(v.granted, false,
    'the electors still hold the old claim, so there is no majority for a second one — and a delay '
    + 'is the right answer, because granting it would put 10 pcs of claims on a 5 pcs shelf');
  assert.match(v.reason, /5 pcs of 5 pcs is already claimed/);

  // It resolves by itself the moment a majority has experienced the same duration.
  m.clock('munich').advance(LEASE + 1);
  const after = m.m('munich').request(WAREHOUSE, proposalFrom(m, 'munich', '5 pcs'));
  await m.settle();
  assert.equal(after.verdict().granted, true,
    'berlin and munich are now a majority that agrees the lease is over; hetzner is still asleep');
});

test('a peer that has settled eighty claims holds no index of the settled ones', async () => {
  // An ERP peer runs for weeks. A protocol that kept one entry per business event would be a slow
  // leak in exactly the process that must never be restarted at an awkward moment.
  const { m } = await warehouse('1 pcs');
  for (let i = 0; i < 40; i++) {
    const p = proposalFrom(m, 'berlin', '1 pcs');
    const round = m.m('berlin').propose(WAREHOUSE, p);
    const asked = m.m('munich').request(WAREHOUSE, proposalFrom(m, 'munich', '1 pcs'));
    await m.settle();
    assert.equal(round.verdict().granted, true, round.verdict().reason);
    assert.equal(asked.verdict().granted, false, 'one piece, two claimants, every round');
    // The lease runs out on every peer, so the shelf frees up for the next iteration.
    for (const peer of ELECTORS) m.clock(peer).advance(LEASE + 1);
    m.m('berlin').retire(WAREHOUSE, [{ unit: ARTICLE, claim: p.id }]);
  }
  for (const peer of ELECTORS) {
    const open = m.m(peer).stats(WAREHOUSE).open;
    assert.equal(open.rounds, 0, `${peer} still indexes settled rounds`);
    assert.equal(open.requests, 0, `${peer} still indexes answered requests`);
    assert.equal(open.forwards, 0, `${peer} still indexes forwarded claim-requests`);
    assert.equal(open.inbox, 0, `${peer} has undrained frames`);
  }
  // And the verdict handles the caller kept are still readable: forgetting the index is not
  // forgetting the answer.
  const last = m.m('berlin').claimTable(WAREHOUSE);
  assert.ok(last.length <= 40, 'lapsed entries are retired as their stornos are written');
});

test('the advisory expiry time is written for the reader and branched on by nothing', () => {
  const claim = claimRecord({
    resource: WAREHOUSE, unit: ARTICLE, quantity: '5 pcs', by: 'berlin',
    stamp: { wall: 1, counter: 0, node: 'berlin' }, term: 0, grantedBy: 'berlin',
    quorum: [{ voter: 'berlin', signature: 'x' }, { voter: 'munich', signature: 'y' }],
    leaseMs: LEASE, expiresAdvisory: 'until 14:22',
  });
  assert.equal(claim['expires-advisory'], 'until 14:22', 'Appendix VIII\'s own words, kept');
  assert.equal(claim['lease-ms'], LEASE, 'and the duration, which is the only comparable value');
  // statusOf takes no clock at all — that is the proof that no absolute instant can affect it.
  assert.equal(statusOf(claim.id, [claim]).status, 'open');
  assert.equal(statusOf.length, 2, 'statusOf(claimId, records) — there is no third, clock argument');
});

// =============================================================================================
// 3. THE STORNO IS A REAL, SIGNED COMMIT
// =============================================================================================

test('the storno is itself a signed commit: visible in real `git log`, verified by real '
   + '`ssh-keygen`, and git fsck --strict clean', async () => {
  const { m, keys } = await warehouse('5 pcs', MUNICH_FIRST);
  const dir = temp('storno');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);

  const identity = { name: 'Berlin warehouse', email: 'berlin@neodonkey.eu' };
  const sign = (payload) => signPayload(keys.get('berlin').keyPair, payload, 'git');
  const files = new Map();
  const put = (record) => {
    files.set(`documents/${RESERVATION_ENTITY}/${record.id}.json`,
      enc.encode(`${JSON.stringify(record, null, 2)}\n`));
    return record;
  };

  // --- Munich is logically first with 3 pcs; Berlin's own 5 pcs is granted first and then loses.
  const munich = proposalFrom(m, 'munich', '3 pcs');
  const berlin = proposalFrom(m, 'berlin', '5 pcs');
  const berlinRound = m.m('berlin').propose(WAREHOUSE, berlin);
  const munichAsk = m.m('munich').request(WAREHOUSE, munich);
  await m.settle();
  assert.equal(berlinRound.verdict().granted, true);
  assert.equal(munichAsk.verdict().granted, true);

  const claimA = put(recordOf(berlin, berlinRound.verdict(), 'berlin'));
  const claimB = put(recordOf(munich, munichAsk.verdict(), 'berlin'));

  // commit 1: both reservation events land. Appendix VIII's own wording.
  let message = 'Two reservations on the last five units\n\n'
    + `${reservationTrailer(claimA)}\n${reservationTrailer(claimB)}\n`;
  const first = await r.commit({
    files, message, author: identity, time: 1_800_000_000, tzOffsetMinutes: 60, sign,
  });

  // commit 2: the storno. A NEW record, never an edit of the claim.
  const stornos = collisionStornos([claimA, claimB], () => '5 pcs', {
    by: 'berlin', stampFor: () => m.stamp('berlin'),
  });
  assert.equal(stornos.length, 1);
  const storno = put(stornos[0]);
  message = `Storno: reservation ${storno.voids} is void\n\n${storno.reason}\n\n`
    + `${reservationTrailer(storno)}\n`;
  const second = await r.commit({
    files, message, author: identity, time: 1_800_000_060, tzOffsetMinutes: 60, sign,
  });
  assert.notEqual(first, second);

  // ---- real git: the storno is a commit, and the repository is clean.
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), second);
  const log = git(dir, 'log', '--format=%H%x09%s');
  assert.match(log, new RegExp(`${second}\\tStorno: reservation ${storno.voids} is void`));
  assert.equal(log.trim().split('\n').length, 2, 'a correction is an entry, not an edit');

  // ---- the trailer makes the chain greppable, which is how an auditor finds it.
  const bodies = git(dir, 'log', '--format=%B');
  const trailers = readReservationTrailers(bodies);
  assert.equal(trailers.filter((t) => t.kind === 'claim').length, 2);
  assert.equal(trailers.filter((t) => t.kind === 'void').length, 1);
  assert.equal(trailers.find((t) => t.kind === 'void').voids, claimA.id);
  assert.match(bodies, new RegExp(`${RESERVATION_TRAILER_KEY}: void `));
  assert.deepEqual(
    trailers.filter((t) => t.kind === 'claim').map((t) => t.quantity).sort(),
    ['3 pcs', '5 pcs'], 'the quantities survive the trailer round-trip');

  // ---- real ssh-keygen verifies the commit signature (standing rule 3).
  const signers = join(temp('signers'), 'allowed_signers');
  writeFileSync(signers, `${allowedSignersLine(identity.email, keys.get('berlin').publicSsh, 'git')}\n`);
  const status = git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--format=%G? %GS');
  for (const line of status.trim().split('\n')) {
    assert.match(line, /^G /, `real git must report a good signature, got: ${line}`);
  }

  // ---- and the quorum evidence inside the storno's claim verifies too, in its own namespace.
  for (const ack of claimB.quorum) {
    assert.ok(ack.signature, 'the claim records the acks it was granted on');
    const text = ackPayloadText({
      key: WAREHOUSE, term: claimB.term, leader: 'berlin', voter: ack.voter,
      claim: claimB.id, granted: true,
      fingerprint: `${WAREHOUSE}#2of3/berlin,hetzner,munich`,
    });
    assert.equal(
      await verifyPayload(keys.get(ack.voter).publicSsh, payloadBytes(text), ack.signature,
        AUTHORITY_NAMESPACE),
      true, `${ack.voter}'s ack inside the committed record must verify`);
  }
  assert.equal(claimB['quorum-evidence'], 'signed');

  console.log(`\n  Storno in real git log (${dir}):\n${
    git(dir, 'log', '--format=    %h %s').trimEnd()}\n`);
});

// =============================================================================================
// 4. THE RULE ITSELF, AND THE AUDIT
// =============================================================================================

test('the collision rule is one function, and the live decision uses the same one as the audit', () => {
  const at = (wall, node) => ({ wall, counter: 0, node });
  const claims = [
    { id: 'RES-late', unit: ARTICLE, quantity: '5 pcs', stamp: at(200, 'berlin'), by: 'berlin' },
    { id: 'RES-early', unit: ARTICLE, quantity: '3 pcs', stamp: at(100, 'munich'), by: 'munich' },
  ];
  const verdict = admissiblePrefix(claims, '5 pcs');
  assert.deepEqual(verdict.winners.map((c) => c.id), ['RES-early']);
  assert.deepEqual(verdict.losers.map((l) => l.claim.id), ['RES-late']);
  assert.equal(verdict.taken, '3 pcs');

  // The same rule as one incremental decision.
  const live = [claims[1]];
  assert.equal(admitClaim({ live, claim: claims[0], onHand: '5 pcs' }).granted, false);
  assert.deepEqual(admitClaim({ live: [claims[0]], claim: claims[1], onHand: '5 pcs' }).supersedes,
    ['RES-late'], 'an earlier claim arriving late displaces the later one');

  // Order-independence: the verdict cannot depend on which peer merged which commit first.
  assert.deepEqual(
    admissiblePrefix([...claims].reverse(), '5 pcs').winners.map((c) => c.id),
    verdict.winners.map((c) => c.id));

  // An unstated quantity means the unit is indivisible — the fail-closed reading.
  const exclusive = admissiblePrefix(claims, null);
  assert.deepEqual(exclusive.winners.map((c) => c.id), ['RES-early']);
  assert.match(exclusive.losers[0].reason, /nothing on record says how much of it exists/);

  // Mixed units never combine silently.
  const wrongUnit = admissiblePrefix(
    [{ id: 'RES-kg', unit: ARTICLE, quantity: '1.000 kg', stamp: at(1, 'a'), by: 'a' }], '5 pcs');
  assert.equal(wrongUnit.winners.length, 0);
  assert.match(wrongUnit.losers[0].reason, /which is held in pcs/);
});

test('a claim with no majority behind it is caught by the audit, not by trust', () => {
  const decls = declarations();
  const forged = claimRecord({
    resource: WAREHOUSE, unit: ARTICLE, quantity: '5 pcs', by: 'lyon',
    stamp: { wall: 5, counter: 0, node: 'lyon' }, term: 0, grantedBy: 'lyon',
    quorum: [{ voter: 'lyon', signature: 'x' }], leaseMs: LEASE,
  });
  const audit = auditReservations([forged], decls);
  assert.equal(audit.ok, false);
  assert.match(audit.problems.join('\n'), /lyon.*are not electors of "stock:berlin-main-warehouse"/);
  assert.match(audit.problems.join('\n'), /0 of the 2 electors required/);
  assert.match(audit.problems.join('\n'), /evidence of a peer that ignored the protocol/);
});

test('the audit catches a storno for a claim nobody has, an unknown record kind, an undeclared '
   + 'resource, and an open claim that should have been voided', () => {
  const decls = declarations();
  const stamp = (w) => ({ wall: w, counter: 0, node: 'berlin' });
  const good = claimRecord({
    resource: WAREHOUSE, unit: ARTICLE, quantity: '3 pcs', by: 'berlin', stamp: stamp(1),
    term: 1, grantedBy: 'berlin',
    quorum: [{ voter: 'berlin', signature: 'a' }, { voter: 'munich', signature: 'b' }],
    leaseMs: LEASE,
  });
  const alsoGood = claimRecord({
    resource: WAREHOUSE, unit: ARTICLE, quantity: '4 pcs', by: 'munich', stamp: stamp(2),
    term: 1, grantedBy: 'berlin',
    quorum: [{ voter: 'berlin', signature: 'a' }, { voter: 'hetzner', signature: 'c' }],
    leaseMs: LEASE,
  });
  const orphan = voidRecord({
    claim: 'RES-does-not-exist', resource: WAREHOUSE, unit: ARTICLE, code: 'lost-collision',
    reason: 'a storno for something that is not there', by: 'berlin', stamp: stamp(3),
  });
  const elsewhere = claimRecord({
    resource: 'stock:lyon-warehouse', unit: ARTICLE, quantity: '1 pcs', by: 'lyon', stamp: stamp(4),
    term: 0, grantedBy: 'lyon', quorum: [{ voter: 'lyon', signature: 'x' }], leaseMs: LEASE,
  });
  const nonsense = { entity: RESERVATION_ENTITY, id: 'RES-weird', kind: 'maybe' };

  const audit = auditReservations([good, alsoGood, orphan, elsewhere, nonsense], decls,
    { onHandOf: () => '5 pcs' });
  const text = audit.problems.join('\n');
  assert.equal(audit.ok, false);
  assert.match(text, /voids reservation RES-does-not-exist, which is not on record/);
  assert.match(text, /which this runtime does not know/);
  assert.match(text, /for which this workspace declares no authoritative peer/);
  assert.match(text, /is still open and over-claims/, '3 + 4 > 5, and no storno is on record');

  // With the storno present, the same records audit clean.
  const stornos = collisionStornos([good, alsoGood], () => '5 pcs',
    { by: 'berlin', stampFor: () => stamp(9) });
  assert.equal(stornos.length, 1);
  assert.equal(stornos[0].voids, alsoGood.id);
  const clean = auditReservations([good, alsoGood, ...stornos], decls, { onHandOf: () => '5 pcs' });
  assert.deepEqual(clean.problems, []);
  assert.equal(clean.ok, true);
});

test('a reservation is derived, never stored: two peers that merged in different orders agree', () => {
  const stamp = (w, n) => ({ wall: w, counter: 0, node: n });
  const claim = claimRecord({
    resource: WAREHOUSE, unit: ARTICLE, quantity: '2 pcs', by: 'berlin', stamp: stamp(1, 'berlin'),
    term: 1, grantedBy: 'berlin',
    quorum: [{ voter: 'berlin', signature: 'a' }, { voter: 'munich', signature: 'b' }],
    leaseMs: LEASE,
  });
  const voidA = voidRecord({
    claim: claim.id, resource: WAREHOUSE, unit: ARTICLE, code: 'lease-expired',
    reason: 'the lease ran out', by: 'berlin', stamp: stamp(20, 'berlin'),
  });
  const voidB = voidRecord({
    claim: claim.id, resource: WAREHOUSE, unit: ARTICLE, code: 'lost-collision',
    reason: 'a second storno, from another peer, for the same claim', by: 'munich',
    stamp: stamp(10, 'munich'),
  });
  const one = statusOf(claim.id, [claim, voidA, voidB]);
  const other = statusOf(claim.id, [voidB, claim, voidA]);
  assert.equal(one.status, 'void');
  assert.deepEqual(one.voidedBy, other.voidedBy,
    'the earliest logical storno is the operative one, whatever order the commits merged in');
  assert.equal(one.voidedBy.id, voidB.id);
  assert.equal(openClaims([claim, voidB], { resource: WAREHOUSE, unit: ARTICLE }).length, 0);
  assert.equal(ledgerOf([claim, voidA, voidB]).voids.get(claim.id).length, 2);

  // And a claim nobody has ever heard of is 'unknown', never 'open'.
  assert.equal(statusOf('RES-nothing', [claim]).status, 'unknown');
  assert.equal(redeemable('RES-nothing', [claim]).code, 'no-such-reservation');
});

test('a claim record refuses what it cannot state: a Number quantity, a zero, a missing lease', () => {
  const base = {
    resource: WAREHOUSE, unit: ARTICLE, by: 'berlin', stamp: { wall: 1, counter: 0, node: 'b' },
    term: 0, grantedBy: 'berlin', quorum: [], leaseMs: LEASE,
  };
  assert.throws(() => claimRecord({ ...base, quantity: 5 }), /a scaled quantity is never a Number/);
  assert.throws(() => claimRecord({ ...base, quantity: '0 pcs' }), /claims a positive quantity/);
  assert.throws(() => claimRecord({ ...base, quantity: '5 pcs', leaseMs: 0 }),
    /needs a declared lease in whole milliseconds/);
  assert.throws(() => voidRecord({ ...base, claim: 'RES-1', reason: '', code: 'x' }),
    /must say why, in a sentence a person can read/);
  assert.throws(() => voidRecord({ ...base, claim: '', reason: 'because', code: 'x' }),
    /must name the reservation it voids/);
});
