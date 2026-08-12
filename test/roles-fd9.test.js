// test/roles-fd9.test.js — FD-9: a caller's roles are `claimed ∩ recorded`.
//
// The defect this closes: `intent.actorRoles` used to be a claim the caller made about itself.
// The kernel enforced it faithfully and then trusted it completely, so
// `perform({actorRoles: ['managing-director']})` from any script, any MCP client, any browser tab
// *was* a managing director. Every authorisation guarantee rested on the caller being polite.
//
// These tests were written by the CTO after the implementing agent was stopped mid-flight, leaving
// the kernel implementation in place with nothing proving it. An implemented-but-unproven control
// is worse than an absent one, because the register reads as though it is closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { nodeFs } from '../runtime/git/fs-node.js';
import { memFs } from '../runtime/git/fs.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { open } from '../runtime/kernel.js';

const temp = (name) => mkdtempSync(join(tmpdir(), `nd-roles-${name}-`));

/** Injected, never read — determinism is a non-negotiable (CONTRACT #5). */
function fixedClock() {
  let t = Date.parse('2027-11-03T09:00:00Z');
  return () => (t += 60_000);
}

/** The shipped operating model, so these tests run against real rules and real roles. */
function realOperatingModel() {
  const root = new URL('../operating-model/', import.meta.url);
  const seed = new Map();
  const walk = (rel) => {
    for (const e of readdirSync(new URL(rel, root), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        seed.set(`operating-model/${rel}${e.name}`,
          readFileSync(new URL(`${rel}${e.name}`, root), 'utf8'));
      }
    }
  };
  walk('');
  return seed;
}

async function workspace({ dir = null, roles = undefined, seed = realOperatingModel() } = {}) {
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const nd = await open({
    fs: dir === null ? memFs() : nodeFs(dir),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair },
    seed, clock: fixedClock(), tzOffsetMinutes: 60,
    ...(roles === undefined ? {} : { roles }),
  });
  assert.deepEqual(nd.modelErrors.map((e) => `${e.file}:${e.line}`), [],
    'the model these tests fire at must be executable');
  return { nd, keyPair };
}


/**
 * A minimal model for the authority tests: one entity, one rule, three roles. Deliberately NOT the
 * shipped operating model — a goods receipt needs an order, an order line, an article and an
 * employee to exist first, so a test written against it fails for reasons that have nothing to do
 * with authority. That is the same coupling that broke the integrity tests when the model improved:
 * a mechanism test must depend on the mechanism and nothing else.
 */
const MINI = () => new Map([
  ['operating-model/information/pallet.md',
    '# Pallet\n\nA pallet in a warehouse.\n\n## Fields\n- label: text required\n'
    + '\n## Authorized by\n- read: warehouse-clerk or warehouse-management or managing-director\n'
    + '- update: warehouse-management\n- delete: managing-director\n'],
  ['operating-model/processes/pallet-intake.md',
    '# Pallet Intake\n\nBooking a pallet in.\n\n## Rules\n\n'
    + 'If Create pallet under condition\n  label exists\nthen\n  Update pallet with label\n'
    + '\n## Authorized by\nwarehouse-clerk\n'],
  ['operating-model/information/article.md',
    '# Article\n\nSomething sold.\n\n## Fields\n- name: text required\n'
    + '\n## Authorized by\n- create: category-manager\n- read: category-manager\n'
    + '- update: category-manager\n- delete: managing-director\n'],
  ['operating-model/organisation/warehouse-clerk.md', '# Warehouse Clerk\n\nCounts things.\n'],
  ['operating-model/organisation/warehouse-management.md', '# Warehouse Management\n\nRuns it.\n'],
  ['operating-model/organisation/managing-director.md', '# Managing Director\n\nDecides.\n'],
  ['operating-model/organisation/category-manager.md', '# Category Manager\n\nBuys.\n'],
]);

const pallet = (id) => ({ entity: 'pallet', id, label: `pallet ${id}` });

/** A goods receipt against the real model — used only where the real rules matter. */
const receipt = (id) => ({
  entity: 'goods-receipt', id,
  quantity: 12, 'delivered-quantity': 12,
  order: 'PO-2027-0001', 'order-line': 'PO-2027-0001-1',
  article: 'cashewkerne-natur-1kg', location: 'berlin-main-warehouse',
  'batch-number': 'L-1', 'best-before-date': '2028-10-31',
  'delivery-note-reference': 'LS-1', 'packaging-intact': true,
  'receipt-date': '2027-11-03', 'received-by': 'SHA256-AB12CD34',
});

// =============================================================================================
// 1 — the claim is no longer trusted
// =============================================================================================

test('FD-9: a caller may not act in a role the repository does not record for it', async () => {
  const { nd } = await workspace({ roles: ['warehouse-clerk'] });
  assert.deepEqual(nd.myRoles().roles, ['warehouse-clerk']);
  assert.equal(nd.myRoles().recorded, true);

  // The exact v0.1 attack: assert an authority you do not hold.
  const r = await nd.perform({
    op: 'create', entity: 'goods-receipt', id: 'GR-9001',
    doc: receipt('GR-9001'), actorRoles: ['managing-director'],
  });
  assert.ok(r.rejected, 'claiming managing-director must not work');
  const reason = r.rejected.map((v) => `${v.code ?? ''} ${v.reason}`).join('\n');
  assert.match(reason, /managing-director/,
    'the refusal names the role that was claimed but not held');
});

test('FD-9 refuses rather than silently narrowing — the two cases stay distinguishable',
  async () => {
    const { nd } = await workspace({ roles: ['warehouse-clerk'], seed: MINI() });

    // A caller asking for authority it does not hold is either a bug or an attack. Silently
    // intersecting would make it indistinguishable from a correct call, which is the whole
    // argument recorded in the kernel: a typo and an escalation attempt must not look alike.
    const overreach = await nd.perform({
      op: 'create', entity: 'pallet', id: 'P-9002',
      doc: pallet('P-9002'), actorRoles: ['warehouse-clerk', 'managing-director'],
    });
    assert.ok(overreach.rejected,
      'a claim that exceeds the record is refused, not quietly reduced to the intersection');

    // Whereas the honest subset of the same set is accepted.
    const honest = await nd.perform({
      op: 'create', entity: 'pallet', id: 'P-9003',
      doc: pallet('P-9003'), actorRoles: ['warehouse-clerk'],
    });
    assert.equal(honest.rejected, undefined, JSON.stringify(honest.rejected, null, 2));
  });

test('FD-9: narrowing is legitimate — a peer may act as a subset of what it holds', async () => {
  const { nd } = await workspace({
    roles: ['managing-director', 'warehouse-clerk', 'category-manager'], seed: MINI() });

  // Deliberately acting as the clerk is how a careful operator tests a rule, and it must work.
  const asClerk = await nd.perform({
    op: 'create', entity: 'pallet', id: 'P-9010',
    doc: pallet('P-9010'), actorRoles: ['warehouse-clerk'],
  });
  assert.equal(asClerk.rejected, undefined, JSON.stringify(asClerk.rejected, null, 2));
});

test('FD-9: an omitted claim means every recorded role, never more', async () => {
  const { nd } = await workspace({ roles: ['warehouse-clerk'], seed: MINI() });
  const r = await nd.perform({
    op: 'create', entity: 'pallet', id: 'P-9020', doc: pallet('P-9020'),
    // no actorRoles at all
  });
  assert.equal(r.rejected, undefined,
    'omitting the claim acts with what the repository records');

  // And an omitted claim cannot conjure authority the record does not contain: the same peer
  // still cannot do something only another role may.
  const { nd: clerkOnly } = await workspace({ roles: ['warehouse-clerk'], seed: MINI() });
  const forbidden = await clerkOnly.perform({
    op: 'create', entity: 'article', id: 'ART-X',
    doc: { entity: 'article', id: 'ART-X', name: 'X' },   // category-manager only
  });
  assert.ok(forbidden.rejected, 'an omitted claim is not a wildcard');
});

// =============================================================================================
// 2 — no record, no authority
// =============================================================================================

test('FD-9: a peer with no recorded roles can perform nothing the model governs, and is told why',
  async () => {
    const { nd } = await workspace({ roles: undefined });   // genesis without roles
    const mine = nd.myRoles();
    assert.equal(mine.roles.length, 0);

    const r = await nd.perform({
      op: 'create', entity: 'pallet', id: 'P-9030',
      doc: pallet('P-9030'), actorRoles: ['warehouse-clerk'],
    });
    assert.ok(r.rejected);
    // The refusal must name the fix. A control that looks like a malfunction gets worked around.
    const reason = r.rejected.map((v) => v.reason).join('\n');
    assert.match(reason, /grantRoles|addPeer|peers\//,
      'the refusal names how a human grants the role');
    // The kernel distinguishes two situations I had assumed were one, and the distinction is
    // worth keeping: `roles-not-recorded` means there is no peer record at all, while
    // `roles-not-held` means there is one and it grants nothing. The second is the ordinary state
    // of a freshly opened workspace, and telling them apart is what lets the refusal name the
    // right fix — introduce the peer, versus grant them something.
    const codes = r.rejected.map((v) => v.code);
    assert.ok(codes.includes('roles-not-held') || codes.includes('roles-not-recorded'),
      `expected an authority refusal, got ${JSON.stringify(codes)}`);
  });

// =============================================================================================
// 3 — granting authority is itself a governed, signed, visible act
// =============================================================================================

test('FD-9: a grant is a signed commit, visible in git log, and real git agrees', async () => {
  const dir = temp('grant');
  const { nd } = await workspace({ dir, roles: ['managing-director'] });

  const peerKey = await generateIdentity({ comment: 'anna@neodonkey.eu' });
  await nd.addPeer({
    name: 'Anna', email: 'anna@neodonkey.eu',
    publicKeySsh: await exportPublicSsh(peerKey, 'anna@neodonkey.eu'),
  });
  assert.deepEqual(nd.rolesOf('anna@neodonkey.eu').roles, [],
    'a new peer starts with no authority — the safe default');

  const granted = await nd.grantRoles('anna@neodonkey.eu', ['warehouse-clerk']);
  assert.equal(granted.rejected, undefined, JSON.stringify(granted.rejected, null, 2));
  assert.deepEqual(nd.rolesOf('anna@neodonkey.eu').roles, ['warehouse-clerk']);

  // Foreign tooling is the judge (ROADMAP Part 4, rule 3).
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(git('fsck', '--strict').trim(), '');
  assert.equal(git('status', '--porcelain').trim(), '');
  const log = git('log', '--format=%s', '--', 'peers/');
  assert.match(log, /anna/i, 'the grant is findable with `git log -- peers/`');
});

test('FD-9: revocation is the same act, and takes effect', async () => {
  const { nd } = await workspace({ roles: ['managing-director'] });
  const peerKey = await generateIdentity({ comment: 'anna@neodonkey.eu' });
  await nd.addPeer({
    name: 'Anna', email: 'anna@neodonkey.eu',
    publicKeySsh: await exportPublicSsh(peerKey, 'anna@neodonkey.eu'),
    roles: ['warehouse-clerk'],
  });
  assert.deepEqual(nd.rolesOf('anna@neodonkey.eu').roles, ['warehouse-clerk']);

  // Appendix XI's revocation, expressed as an ordinary grant of nothing rather than a special path.
  const revoked = await nd.grantRoles('anna@neodonkey.eu', []);
  assert.equal(revoked.rejected, undefined, JSON.stringify(revoked.rejected, null, 2));
  assert.deepEqual(nd.rolesOf('anna@neodonkey.eu').roles, []);
});

test('FD-9: a grant to a peer this repository does not know is refused', async () => {
  const { nd } = await workspace({ roles: ['managing-director'] });
  const r = await nd.grantRoles('stranger@example.com', ['managing-director']);
  assert.ok(r.rejected);
  assert.equal(r.rejected[0].code, 'no-such-peer');
  assert.match(r.rejected[0].reason, /a role is granted to a key, not to an email/,
    'the refusal explains the model rather than just saying no');
});

// =============================================================================================
// 4 — the audit question
// =============================================================================================

test('FD-9: the roles a peer held are recoverable from the repository itself', async () => {
  const dir = temp('audit');
  const { nd } = await workspace({ dir, roles: ['managing-director'] });
  const peerKey = await generateIdentity({ comment: 'anna@neodonkey.eu' });
  await nd.addPeer({
    name: 'Anna', email: 'anna@neodonkey.eu',
    publicKeySsh: await exportPublicSsh(peerKey, 'anna@neodonkey.eu'),
    roles: ['warehouse-clerk'],
  });
  await nd.grantRoles('anna@neodonkey.eu', ['warehouse-clerk', 'warehouse-management']);

  // Every peer and its authority, from the repo — this is what a UI role selector must be built
  // from, so that it can only ever offer authority the peer actually holds.
  const peers = nd.peers();
  const anna = peers.find((p) => p.email === 'anna@neodonkey.eu');
  assert.ok(anna, `expected anna among ${JSON.stringify(peers.map((p) => p.email))}`);
  assert.deepEqual([...anna.roles].sort(), ['warehouse-clerk', 'warehouse-management']);

  // And the history of that authority is in git, not in a side table nobody audits.
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const revisions = git('log', '--format=%H', '--', 'peers/anna@neodonkey.eu.json')
    .trim().split('\n').filter(Boolean);
  assert.ok(revisions.length >= 2,
    `the grant and the change are separate commits, found ${revisions.length}`);
});

// =============================================================================================
// 5 — the shape the UI and MCP must build on
// =============================================================================================

test('FD-9: myRoles() says what is held and where it is recorded', async () => {
  const { nd } = await workspace({ roles: ['accountant'] });
  const mine = nd.myRoles();
  assert.equal(mine.principal, 'sarah@neodonkey.eu');
  assert.deepEqual(mine.roles, ['accountant']);
  assert.equal(mine.recorded, true);
  assert.match(mine.at, /^peers\//,
    'and it says which file to look at, so the answer is checkable by hand');
});
