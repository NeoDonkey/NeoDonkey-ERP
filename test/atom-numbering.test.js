// test/atom-numbering.test.js — cross-peer gapless document numbers (FD-6, COMPROMISES #19).
//
// THE TENSION, AND THE HONEST ANSWER
//
// Strict gaplessness needs coordination: "number 7 was issued exactly once" is a statement about
// every peer at once. Offline operation needs independence: Principle 2 says a peer keeps working
// with no network. Both cannot hold for the same document at the same moment.
//
// So this file proves two things that sound contradictory and are not:
//
//   1. AN OFFLINE PEER CANNOT ISSUE A LEGALLY GAPLESS INVOICE NUMBER, AND MUST QUEUE. The document
//      is recorded, the numbering waits, and the user is told why in a sentence. That is the
//      correct answer, not a shortfall — the alternative is two invoices numbered 7, one of which
//      is already at the customer.
//   2. NO TWO PEERS EVER BOTH ISSUE NUMBER 7. A value is proposed to the series' electors and a
//      MAJORITY must ack it before the consuming commit is written. Two disjoint majorities of one
//      fixed elector set do not exist.
//
// COMPROMISES #19 says, of v1.0: "two peers that both believe they are authoritative will both
// issue number 7 while disconnected." The test named for that sentence is the one that closes it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SEQUENCE_ENTITY, SEQUENCE_TRAILER_KEY, SEQUENCE_QUORUM_TRAILER_KEY,
  normalizeSeries, assertAuthoritative, auditIssuance,
  readSequenceTrailers, readSequenceQuorumTrailers, seriesResourceKey, numberingUnit,
  numberingQueue, numberAllocator, issuanceFloor,
} from '../runtime/truth/sequence.js';
import { AUTHORITY_PATH, collectAuthorities } from '../runtime/truth/authority.js';
import { initRepo, repo } from '../runtime/git/repo.js';
import { nodeFs } from '../runtime/git/fs-node.js';
import { signPayload, verifyPayload, allowedSignersLine } from '../runtime/identity/sshsig.js';
import { mesh, peerKeys } from './atom-mesh.js';

const SERIES_KEY = seriesResourceKey('invoice');           // 'sequence:invoice'
const UNIT = numberingUnit('invoice', '2027');             // 'invoice/2027'
const ELECTORS = ['berlin', 'hetzner', 'munich'];
const enc = new TextEncoder();
const temp = (tag) => mkdtempSync(join(tmpdir(), `neodonkey-atom-${tag}-`));
const git = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The series, as the workspace declares it (COMPROMISES #17: neodonkey.json for now). */
function invoiceSeries(over = {}) {
  const { declaration, errors } = normalizeSeries('invoice', {
    entity: 'invoice',
    pattern: 'RE-{period}-{0000}',
    reset: 'year',
    'date-field': 'invoice-date',
    ...over,
  }, 'neodonkey.json');
  assert.deepEqual(errors, []);
  return declaration;
}

/** The authority over that series, as the company declares it. */
function seriesAuthority() {
  const { authorities, errors } = collectAuthorities({
    files: new Map([[AUTHORITY_PATH, JSON.stringify({
      authorities: {
        [SERIES_KEY]: {
          peer: 'berlin', electors: ELECTORS, 'lease-ms': 300_000,
          'election-timeout-ms': 120_000,
        },
      },
    })]]),
  });
  assert.deepEqual(errors, []);
  return authorities;
}

async function numberingMesh() {
  const keys = await peerKeys(ELECTORS);
  return { keys, m: mesh({ peers: ELECTORS, declarations: seriesAuthority(), keys }) };
}

const allocatorFor = (m, peer, over = {}) => numberAllocator({
  declaration: invoiceSeries(over), peer, authority: m.m(peer),
});

const sequenceDoc = (next, lastIssued) => ({
  id: 'invoice-2027', entity: SEQUENCE_ENTITY, series: 'invoice', period: '2027',
  pattern: 'RE-{period}-{0000}', next, 'last-issued': lastIssued,
});

/**
 * Stand for election until this peer wins or the attempts run out.
 *
 * Raft retries, and so does this: a peer returning from a partition is behind, learns the current
 * term from the denial it gets (`currentTerm` on the vote frame) and stands again in the next one.
 * `attempts` bounds it so a protocol bug is a failure rather than a hang.
 */
async function elect(m, peer, key, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const ballot = m.m(peer).standFor(key);
    await m.settle();
    const v = ballot.verdict();
    if (v.elected) {
      m.m(peer).heartbeat(key);        // tell the electors who won, as a real leader would
      await m.settle();
      return v;
    }
  }
  assert.fail(`${peer} did not win an election for ${key} in ${attempts} attempts`);
  return null;
}

/** Issue one number on `peer`, driving the mesh. Returns the settled result. */
async function issue(m, alloc, peer, { ref, current, consumer }) {
  const pending = alloc.request({ ref, period: '2027', current, stamp: m.stamp(peer), consumer });
  if (pending.state !== 'proposed') return pending;
  await m.settle();
  return alloc.settle(pending);
}

// =============================================================================================
// 1. who may issue at all
// =============================================================================================

test('the ELECTED holder of the term decides who issues, not a name frozen in a settings file', async () => {
  const { m } = await numberingMesh();
  const decl = invoiceSeries();

  assert.equal(assertAuthoritative(decl, 'berlin', m.m('berlin')), null,
    'berlin holds the authority in term 0, because the declaration says so');
  const refusal = assertAuthoritative(decl, 'munich', m.m('munich'));
  assert.match(refusal, /issued by berlin \(term 0\), not by munich/);
  assert.match(refusal, /the document waits in the numbering queue until berlin issues its number/);

  // Munich wins an election. Now MUNICH issues, and berlin does not — with no change to any file.
  m.partition([['berlin'], ['hetzner', 'munich']]);
  m.clock('munich').advance(120_001);
  await elect(m, 'munich', SERIES_KEY);
  assert.equal(assertAuthoritative(decl, 'munich', m.m('munich')), null);
  assert.match(assertAuthoritative(decl, 'hetzner', m.m('hetzner')),
    /issued by munich \(term 1\), not by hetzner/);
});

test('an ambiguous authority refuses: nobody holding, or two declarations of one series', async () => {
  const { m } = await numberingMesh();
  const decl = invoiceSeries();

  // Mid-election: hetzner has voted, so it believes nobody holds the series.
  m.partition([['berlin'], ['hetzner', 'munich']]);
  m.clock('munich').advance(120_001);
  m.m('munich').standFor(SERIES_KEY);
  await m.settle();
  const nobody = assertAuthoritative(decl, 'hetzner', m.m('hetzner'));
  assert.match(nobody, /nobody currently holds the authority to issue "invoice" numbers/);
  assert.match(nobody, /A document number issued while the authority is ambiguous/);

  // Two declarations of one authority: the series file says one peer, authorities.json another.
  const conflicting = invoiceSeries({ 'authoritative-peer': 'munich' });
  const both = assertAuthoritative(conflicting, 'munich', m.m('munich'));
  assert.match(both, /two conflicting declarations of who issues its numbers/);
  assert.match(both, /this peer issues nothing until the company says which of the two it meant/);

  // With no authority member at all the behaviour is byte-for-byte v1.0's: the static declaration
  // decides. This is what the kernel does today, and 46 integrity tests depend on it.
  assert.equal(assertAuthoritative(invoiceSeries(), 'anybody'), null);
  assert.match(assertAuthoritative(conflicting, 'berlin'), /issued by munich, not by berlin/);
  assert.equal(assertAuthoritative(conflicting, 'munich'), null);
});

// =============================================================================================
// 2. issuing with a majority behind it
// =============================================================================================

test('a number is issued only after a MAJORITY of the series\' electors has acked it, and the '
   + 'evidence goes into the commit', async () => {
  const { m } = await numberingMesh();
  const alloc = allocatorFor(m, 'berlin');
  const trailers = [];
  let current = null;

  for (let i = 1; i <= 3; i++) {
    const result = await issue(m, alloc, 'berlin', {
      ref: `invoice/draft-${i}`, current, consumer: { entity: 'invoice', id: `INV-2027-${i}` },
    });
    assert.equal(result.state, 'issued', result.reason);
    assert.equal(result.number, `RE-2027-000${i}`);
    assert.equal(result.value, i);
    assert.equal(result.evidence.acks.length >= 2, true,
      'two of the three electors is a majority, and nothing is issued on fewer');
    assert.equal(result.evidence.unsignedAcks, 0, 'and the acks are signed, not asserted');
    trailers.push(...result.trailers);
    current = result.sequenceAfter;
  }

  assert.equal(current.next, 4);
  assert.equal(current['last-issued'], 'RE-2027-0003');
  assert.equal(alloc.queue.size(), 0, 'nothing had to wait');

  // The chain is reconstructible from the trailers alone — which is how an auditor checks it.
  const body = trailers.join('\n');
  const issuances = readSequenceTrailers(body);
  assert.deepEqual(issuances.map((i) => i.value), [1, 2, 3]);
  assert.deepEqual(issuances.map((i) => i.id), ['INV-2027-1', 'INV-2027-2', 'INV-2027-3']);
  const audit = auditIssuance(issuances, 1);
  assert.deepEqual(audit.problems, []);
  assert.equal(audit.ok, true);

  // And the quorum trailer names the term and the electors that stood behind each value.
  const quorums = readSequenceQuorumTrailers(body);
  assert.equal(quorums.length, 3);
  for (const q of quorums) {
    assert.equal(q.term, 0);
    assert.equal(q.leader, 'berlin');
    assert.ok(q.acks.length >= 2, 'the electors are named, so the claim is checkable');
    for (const voter of q.acks) assert.ok(ELECTORS.includes(voter));
  }

  // Every peer's watermark agrees, and it is the floor a successor must start above.
  for (const p of ELECTORS) {
    assert.equal(m.m(p).highestWatermark(SERIES_KEY, UNIT), 3, `${p} must know 3 was issued`);
  }
  assert.deepEqual(m.m('berlin').stats(SERIES_KEY).numbers, [{ unit: UNIT, value: 3, claim: 'invoice/2027#3' }]);
});

test('the same number can never be acked twice, whoever asks', async () => {
  const { m } = await numberingMesh();
  const alloc = allocatorFor(m, 'berlin');
  const first = await issue(m, alloc, 'berlin', {
    ref: 'invoice/a', current: sequenceDoc(7, 'RE-2027-0006'),
    consumer: { entity: 'invoice', id: 'INV-A' },
  });
  assert.equal(first.state, 'issued');
  assert.equal(first.number, 'RE-2027-0007');

  // A second proposal of the very same value, under a different claim id.
  const round = m.m('berlin').propose(SERIES_KEY, {
    id: 'invoice/2027#7-again', unit: UNIT, watermark: 7, by: 'berlin', stamp: m.stamp('berlin'),
  });
  await m.settle();
  const v = round.verdict();
  assert.equal(v.granted, false);
  assert.match(v.reason, /number 7 of invoice\/2027 has already been acknowledged as issued by a majority/);
  assert.match(v.reason, /rather than let two documents carry one invoice number/);
  assert.equal(m.m('berlin').highestWatermark(SERIES_KEY, UNIT), 7, 'and the watermark did not move');
});

// =============================================================================================
// 3. THE OFFLINE ANSWER
// =============================================================================================

test('AN OFFLINE PEER CANNOT ISSUE A GAPLESS NUMBER AND MUST QUEUE — and the queue works', async () => {
  const { m } = await numberingMesh();

  // Munich is not the authority. It records the business event; the number waits.
  const munich = allocatorFor(m, 'munich');
  const waiting = munich.request({
    ref: 'invoice/draft-munich-1', period: '2027', current: sequenceDoc(4, 'RE-2027-0003'),
    stamp: m.stamp('munich'), consumer: { entity: 'invoice', id: 'INV-M1' },
  });
  assert.equal(waiting.state, 'queued');
  assert.equal(waiting.number, null, 'nothing was issued, and nothing was written');
  assert.equal(waiting.position, 1);
  assert.match(waiting.reason, /numbers in the "invoice" series are issued by berlin \(term 0\), not by munich/);
  assert.match(waiting.reason, /the document waits in the numbering queue/);

  // A second document joins behind it, and the order is the order they arrived.
  const second = munich.request({
    ref: 'invoice/draft-munich-2', period: '2027', current: sequenceDoc(4, 'RE-2027-0003'),
    stamp: m.stamp('munich'), consumer: { entity: 'invoice', id: 'INV-M2' },
  });
  assert.equal(second.state, 'queued');
  assert.equal(second.position, 2);
  assert.equal(munich.queue.size(), 2);
  assert.deepEqual(munich.queue.items().map((i) => i.ref),
    ['invoice/draft-munich-1', 'invoice/draft-munich-2']);

  // Asking again does not queue the same document twice.
  munich.request({
    ref: 'invoice/draft-munich-1', period: '2027', current: sequenceDoc(4, 'RE-2027-0003'),
    stamp: m.stamp('munich'), consumer: { entity: 'invoice', id: 'INV-M1' },
  });
  assert.equal(munich.queue.size(), 2);
  assert.equal(munich.queue.items()[0].attempts, 2);

  // Berlin goes away for good. Munich and hetzner elect Munich.
  m.partition([['berlin'], ['hetzner', 'munich']]);
  m.clock('munich').advance(120_001);
  await elect(m, 'munich', SERIES_KEY);

  // Now the queue drains, in order, and the numbers follow the order of the queue.
  let current = sequenceDoc(4, 'RE-2027-0003');
  const issued = [];
  for (let i = 0; i < 2; i++) {
    const pending = munich.resume({ current, stamp: m.stamp('munich') });
    assert.equal(pending.state, 'proposed', pending.reason);
    await m.settle();
    const done = munich.settle(pending);
    assert.equal(done.state, 'issued', done.reason);
    issued.push(done.number);
    current = done.sequenceAfter;
  }
  assert.deepEqual(issued, ['RE-2027-0004', 'RE-2027-0005']);
  assert.equal(munich.queue.size(), 0, 'the queue is empty and every document has its number');
  assert.equal(munich.resume({ current, stamp: m.stamp('munich') }), null);
});

test('a document cannot jump the queue, because a gapless series issues in the order events happened', async () => {
  const { m } = await numberingMesh();
  const berlin = allocatorFor(m, 'berlin');

  // Berlin IS the authority, but its first document lost its majority (the electors are away), so
  // it is in the queue. The next document must not overtake it.
  m.partition([['berlin'], ['hetzner', 'munich']]);
  const stuck = berlin.request({
    ref: 'invoice/first', period: '2027', current: sequenceDoc(9, 'RE-2027-0008'),
    stamp: m.stamp('berlin'), consumer: { entity: 'invoice', id: 'INV-FIRST' },
  });
  assert.equal(stuck.state, 'proposed', 'it believes it leads, so it proposes');
  assert.equal(await m.settle(), 0, 'and nothing crosses the partition');
  const failed = berlin.settle(stuck);
  assert.equal(failed.state, 'queued');
  assert.match(failed.reason, /was not confirmed by a majority of the electors/);
  assert.match(failed.reason, /Nothing was issued and nothing was written/);

  const behind = berlin.request({
    ref: 'invoice/second', period: '2027', current: sequenceDoc(9, 'RE-2027-0008'),
    stamp: m.stamp('berlin'), consumer: { entity: 'invoice', id: 'INV-SECOND' },
  });
  assert.equal(behind.state, 'queued');
  assert.match(behind.reason, /have been waiting longer for a "invoice" number, starting with invoice\/first/);
  assert.equal(berlin.queue.positionOf('invoice/first'), 1);
  assert.equal(berlin.queue.positionOf('invoice/second'), 2);

  // The partition heals; the head of the queue goes first and gets 9, the one behind it gets 10.
  m.partition(null);
  let current = sequenceDoc(9, 'RE-2027-0008');
  const numbers = [];
  for (let i = 0; i < 2; i++) {
    const pending = berlin.resume({ current, stamp: m.stamp('berlin') });
    await m.settle();
    const done = berlin.settle(pending);
    assert.equal(done.state, 'issued', done.reason);
    assert.deepEqual(done.retire, [],
      'a failed attempt must not burn a number: the retry asks for the SAME value, so there is '
      + 'nothing to retire and no gap to document');
    numbers.push(done.number);
    current = done.sequenceAfter;
  }
  assert.deepEqual(numbers, ['RE-2027-0009', 'RE-2027-0010']);
});

test('the queue refuses a document with no ref, because a queue you cannot resume is a lost invoice', () => {
  const q = numberingQueue();
  assert.throws(() => q.enqueue({ period: '2027', reason: 'waiting' }),
    /a waiting document needs a ref, or it cannot be resumed/);
  assert.equal(q.size(), 0);
  q.enqueue({ ref: 'a', period: '2027', reason: 'waiting' });
  assert.equal(q.head().ref, 'a');
  assert.equal(q.remove('a'), true);
  assert.equal(q.remove('a'), false);
  assert.equal(q.size(), 0);
});

// =============================================================================================
// 4. COMPROMISES #19, VERBATIM: "two peers ... will both issue number 7 while disconnected"
// =============================================================================================

test('COMPROMISES #19: two peers both believe they are authoritative and are disconnected. '
   + 'Number 7 is issued ONCE.', async () => {
  const { m } = await numberingMesh();
  const start = sequenceDoc(7, 'RE-2027-0006');

  // The partition: berlin alone, munich with hetzner. Berlin still believes it is the authority —
  // the declaration names it, and nothing has told it otherwise. That is exactly #19's scenario.
  m.partition([['berlin'], ['hetzner', 'munich']]);
  m.clock('munich').advance(120_001);
  const ballot = m.m('munich').standFor(SERIES_KEY);
  await m.settle();
  assert.equal(ballot.verdict().elected, true, 'the majority side has an authority');
  assert.equal(m.m('berlin').isLeader(SERIES_KEY), true, 'and the minority side still thinks it has one');

  // Both try to issue 7, at the same moment, from the same sequence document.
  const berlinAlloc = allocatorFor(m, 'berlin');
  const munichAlloc = allocatorFor(m, 'munich');
  const berlinTry = berlinAlloc.request({
    ref: 'invoice/berlin-7', period: '2027', current: start, stamp: m.stamp('berlin'),
    consumer: { entity: 'invoice', id: 'INV-BERLIN' },
  });
  const munichTry = munichAlloc.request({
    ref: 'invoice/munich-7', period: '2027', current: start, stamp: m.stamp('munich'),
    consumer: { entity: 'invoice', id: 'INV-MUNICH' },
  });
  assert.equal(berlinTry.state, 'proposed');
  assert.equal(munichTry.state, 'proposed');
  assert.equal(berlinTry.value, 7);
  assert.equal(munichTry.value, 7, 'both computed the same value: that is the hazard');
  await m.settle();

  const berlinResult = berlinAlloc.settle(berlinTry);
  const munichResult = munichAlloc.settle(munichTry);
  assert.equal(munichResult.state, 'issued', munichResult.reason);
  assert.equal(munichResult.number, 'RE-2027-0007');
  assert.equal(berlinResult.state, 'queued',
    'the minority peer issues NOTHING — it has no majority, so it has no number');
  assert.equal(berlinResult.number, null);
  assert.match(berlinResult.reason, /was not confirmed by a majority of the electors/);

  console.log(`\n  COMPROMISES #19, the scenario it names:\n`
    + `    partition: [berlin] | [hetzner, munich]\n`
    + `    munich (elected, term 1) → ${munichResult.number} issued, `
    + `acks: ${munichResult.evidence.acks.map((a) => a.voter).sort().join(', ')}\n`
    + `    berlin (still believes it is authoritative) → nothing issued; document queued\n`
    + `    reason: ${berlinResult.reason}\n`);

  // The whole history, from both sides, contains exactly one 7 — and it audits clean.
  const trailers = readSequenceTrailers(munichResult.trailers.join('\n'));
  assert.deepEqual(trailers.map((t) => t.value), [7]);
  assert.equal(auditIssuance(trailers, 7).ok, true);

  // Berlin's queued document is not lost. Once the partition heals it learns it was deposed, and
  // its document waits for munich — which is the honest answer, not a silent renumbering.
  m.partition(null);
  m.m('munich').heartbeat(SERIES_KEY);
  await m.settle();
  const stillWaiting = berlinAlloc.resume({ current: start, stamp: m.stamp('berlin') });
  assert.equal(stillWaiting.state, 'queued');
  assert.match(stillWaiting.reason, /issued by munich \(term 1\), not by berlin/);
  assert.equal(berlinAlloc.queue.size(), 1, 'the document is still queued, and still recoverable');
});

test('a successor never restarts below the highest value any majority acked, and the gap it leaves '
   + 'is documented rather than silent', async () => {
  const { m } = await numberingMesh();

  // Munich, elected, issues 7. Berlin's repository never receives the consuming commit.
  m.partition([['berlin'], ['hetzner', 'munich']]);
  m.clock('munich').advance(120_001);
  await elect(m, 'munich', SERIES_KEY);
  const munichAlloc = allocatorFor(m, 'munich');
  const issued = await issue(m, munichAlloc, 'munich', {
    ref: 'invoice/munich-7', current: sequenceDoc(7, 'RE-2027-0006'),
    consumer: { entity: 'invoice', id: 'INV-MUNICH' },
  });
  assert.equal(issued.number, 'RE-2027-0007');

  // Now munich goes away and berlin comes back with hetzner. Hetzner acked 7, so the election hands
  // that fact to berlin — even though berlin's own sequence document still says `next: 7`.
  m.partition([['munich'], ['berlin', 'hetzner']]);
  m.clock('berlin').advance(120_001);
  await elect(m, 'berlin', SERIES_KEY);
  assert.equal(m.m('berlin').highestWatermark(SERIES_KEY, UNIT), 7,
    'leader completeness applies to numbers too: the successor learns what was issued');

  const stale = sequenceDoc(7, 'RE-2027-0006');
  const floor = issuanceFloor(invoiceSeries(), stale, 7);
  assert.equal(floor.next, 8);
  assert.deepEqual(floor.retire, [7]);
  assert.equal(floor.raisedFrom, 7);

  const berlinAlloc = allocatorFor(m, 'berlin');
  const next = await issue(m, berlinAlloc, 'berlin', {
    ref: 'invoice/berlin-next', current: stale, consumer: { entity: 'invoice', id: 'INV-BERLIN' },
  });
  assert.equal(next.state, 'issued', next.reason);
  assert.equal(next.number, 'RE-2027-0008', 'never 7 again, whatever the local sequence says');
  assert.deepEqual(next.retire, [7],
    'and the caller is told which value it must commit a retirement record for');

  // From berlin's repository alone the history reads 6 → 8. That is a gap, and a gap is acceptable
  // to FD-6 only if it is accounted for. `retired` is how it is accounted for.
  const local = readSequenceTrailers(next.trailers.join('\n'));
  const undocumented = auditIssuance([{ series: 'invoice', period: '2027', value: 6, entity: 'invoice', id: 'X' }, ...local], 6);
  assert.equal(undocumented.ok, false);
  assert.match(undocumented.problems.join('\n'), /jumps from 6 to 8/);
  const documented = auditIssuance(
    [{ series: 'invoice', period: '2027', value: 6, entity: 'invoice', id: 'X' }, ...local], 6,
    ['invoice 2027 7']);
  assert.deepEqual(documented.problems, []);
  assert.deepEqual(documented.retired, ['invoice 2027 7']);

  // And when munich's commit finally arrives, 7 is not a gap at all: it was issued, once.
  const merged = auditIssuance([
    { series: 'invoice', period: '2027', value: 6, entity: 'invoice', id: 'X' },
    ...readSequenceTrailers(issued.trailers.join('\n')),
    ...local,
  ], 6, ['invoice 2027 7']);
  assert.deepEqual(merged.problems, [], 'no duplicate, no gap: 6, 7, 8');
  assert.deepEqual([...merged.perSeries.keys()], ['invoice 2027']);
  assert.deepEqual(merged.perSeries.get('invoice 2027'), { count: 3, min: 6, max: 8 });
});

test('issuanceFloor never lowers the sequence document, and asks for no retirement when it agrees', () => {
  const decl = invoiceSeries();
  assert.deepEqual(issuanceFloor(decl, sequenceDoc(9, 'RE-2027-0008'), 8),
    { next: 9, raisedFrom: null, retire: [] });
  assert.deepEqual(issuanceFloor(decl, sequenceDoc(9, 'RE-2027-0008'), null),
    { next: 9, raisedFrom: null, retire: [] });
  assert.deepEqual(issuanceFloor(decl, null, null), { next: 1, raisedFrom: null, retire: [] });
  assert.deepEqual(issuanceFloor(decl, sequenceDoc(4, 'RE-2027-0003'), 6),
    { next: 7, raisedFrom: 4, retire: [4, 5, 6] });
});

// =============================================================================================
// 5. the trailers are inside the signed payload
// =============================================================================================

test('both trailers live inside the bytes the commit signature covers: editing either one breaks '
   + 'the signature, and real git says so', async () => {
  const { m, keys } = await numberingMesh();
  const alloc = allocatorFor(m, 'berlin');
  const result = await issue(m, alloc, 'berlin', {
    ref: 'invoice/one', current: null, consumer: { entity: 'invoice', id: 'INV-2027-1' },
  });
  assert.equal(result.state, 'issued');

  const dir = temp('numbering');
  const fs = nodeFs(dir);
  await initRepo(fs);
  const r = repo(fs);
  const identity = { name: 'Berlin', email: 'berlin@neodonkey.eu' };
  const sign = (payload) => signPayload(keys.get('berlin').keyPair, payload, 'git');

  const files = new Map([
    ['documents/invoice/INV-2027-1.json', enc.encode(`${JSON.stringify({
      entity: 'invoice', id: 'INV-2027-1', 'invoice-date': '2027-11-03',
      number: result.number, 'net-amount': 1500, customer: 'KoRo GmbH',
    }, null, 2)}\n`)],
    [`documents/${SEQUENCE_ENTITY}/invoice-2027.json`,
      enc.encode(`${JSON.stringify(result.sequenceAfter, null, 2)}\n`)],
  ]);
  const message = `Invoice ${result.number} for KoRo GmbH\n\n${result.trailers.join('\n')}\n`;
  const oid = await r.commit({
    files, message, author: identity, time: 1_800_000_000, tzOffsetMinutes: 60, sign,
  });

  // The invoice and the sequence document are ONE commit — atomic by nature (Appendix VIII).
  assert.equal(git(dir, 'fsck', '--strict', '--no-progress').trim(), '');
  const names = git(dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort();
  assert.deepEqual(names, [
    'documents/document-number-sequence/invoice-2027.json',
    'documents/invoice/INV-2027-1.json',
  ]);

  // FD-6's audit path, run against real git output.
  const body = git(dir, 'log', '--format=%B');
  assert.match(body, new RegExp(`${SEQUENCE_TRAILER_KEY}: invoice 2027 1 invoice/INV-2027-1`));
  assert.match(body, new RegExp(`${SEQUENCE_QUORUM_TRAILER_KEY}: invoice 2027 1 term=0 by=berlin acks=`));
  assert.equal(readSequenceTrailers(body).length, 1);
  assert.equal(readSequenceQuorumTrailers(body)[0].acks.length >= 2, true);

  // Real ssh-keygen, through real git, says the signature is good.
  const signers = join(temp('signers'), 'allowed_signers');
  writeFileSync(signers, `${allowedSignersLine(identity.email, keys.get('berlin').publicSsh, 'git')}\n`);
  assert.match(git(dir, '-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '--format=%G?').trim(),
    /^G$/, 'real git must report a good signature');

  // And the trailers are INSIDE those bytes: change one character and the signature fails.
  // `commit.payload` is recovered from the object itself, not re-encoded — the exact bytes signed.
  const commit = (await r.log(1))[0];
  assert.equal(commit.oid, oid);
  const good = commit.payload;
  assert.match(new TextDecoder().decode(good), new RegExp(SEQUENCE_QUORUM_TRAILER_KEY),
    'the quorum trailer must be part of the signed payload, not a note beside it');
  assert.equal(
    await verifyPayload(keys.get('berlin').publicSsh, good, commit.signature, 'git'), true);
  const tampered = new Uint8Array(good);
  const needle = enc.encode('acks=');
  outer: for (let i = 0; i < tampered.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (tampered[i + j] !== needle[j]) continue outer;
    tampered[i] = 'A'.charCodeAt(0);                     // 'acks=' → 'Acks='
    break;
  }
  assert.notDeepEqual([...tampered], [...good], 'the tamper must actually change a byte');
  assert.equal(
    await verifyPayload(keys.get('berlin').publicSsh, tampered, commit.signature, 'git'), false,
    'a quorum trailer that could be edited after the fact would prove nothing');
});
