// test/readme-rule-trailer.test.js — README.md: "When a posting is made, the commit records the
// rule that authorized it — inside the signed payload."
//
// Why this exists. Until now that sentence was proven only by demo/sarah.mjs, which CI runs as a
// separate job — `npm test` itself never executed the chain it describes. g-ui.test.js feeds a
// hand-built message to parseTrailers, and c-polism.test.js greps kernel source for a trailer
// template; delete the two lines in buildMessage() that push `NeoDonkey-Rule:` and the suite
// stays green. This test runs the real path instead: kernel.open on a written model, one perform,
// then the commit read back out of the object store and its signature verified over exactly the
// bytes that carry the trailer.
//
// Owner: audit lane. Zero dependencies. `node --test test/readme-rule-trailer.test.js`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memFs } from '../runtime/git/fs.js';
import { repo } from '../runtime/git/repo.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { verifyPayload } from '../runtime/identity/sshsig.js';
import { open } from '../runtime/kernel.js';

/** Injected, never read — determinism is a non-negotiable (CONTRACT #5). */
function fixedClock() {
  let t = Date.parse('2027-11-03T09:00:00Z');
  return () => (t += 60_000);
}

/** One entity, one rule, three roles — mechanism only, per roles-fd9.test.js's reasoning. */
const MODEL = () => new Map([
  ['operating-model/information/pallet.md',
    '# Pallet\n\nA pallet in a warehouse.\n\n## Fields\n- label: text required\n'
    + '\n## Authorized by\n- read: warehouse-clerk or warehouse-management or managing-director\n'
    + '- update: warehouse-management\n- delete: managing-director\n'],
  ['operating-model/processes/pallet-intake.md',
    '# Pallet Intake\n\nBooking a pallet in.\n\n## Rules\n\n'
    + 'If Create pallet under condition\n  label exists\nthen\n  Update pallet with label\n'
    + '\n## Authorized by\nwarehouse-clerk\n'],
  ['operating-model/organisation/warehouse-clerk.md', '# Warehouse Clerk\n\nCounts things.\n'],
  ['operating-model/organisation/warehouse-management.md', '# Warehouse Management\n\nRuns it.\n'],
  ['operating-model/organisation/managing-director.md', '# Managing Director\n\nDecides.\n'],
]);

async function workspace() {
  const fs = memFs();
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const nd = await open({
    fs,
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair },
    seed: MODEL(), clock: fixedClock(), tzOffsetMinutes: 60,
    roles: ['warehouse-clerk'],
  });
  assert.deepEqual(nd.modelErrors.map((e) => `${e.file}:${e.line}`), [],
    'the model this test fires at must be executable');
  return { fs, nd, keyPair };
}

test('the posting commit names the rule that authorized it, inside the signed payload', async () => {
  const { fs, nd, keyPair } = await workspace();

  const r = await nd.perform({
    op: 'create', entity: 'pallet', id: 'P-4242',
    doc: { entity: 'pallet', id: 'P-4242', label: 'pallet 4242' },
  });
  assert.equal(r.rejected, undefined, JSON.stringify(r.rejected ?? null));

  // The business commit, read back from the object store like an auditor would.
  const log = await repo(fs).log(Infinity);
  const business = log.filter((c) => /NeoDonkey-Transaction: v1/.test(c.message)
    && !/NeoDonkey-Genesis/.test(c.message));
  assert.equal(business.length, 1, `expected exactly one business commit, got ${business.length}`);
  const commit = business[0];

  // 1. The trailer exists and cites a line in a file the model actually contains.
  const m = /^NeoDonkey-Rule: (operating-model\/[^\s]+):(\d+)$/m.exec(commit.message);
  assert.ok(m, `expected a NeoDonkey-Rule trailer in:\n${commit.message}`);
  const [, file, lineStr] = m;
  const ruleFileText = MODEL().get(file);
  assert.ok(ruleFileText, `the cited rule file "${file}" must be part of the model`);
  const cited = (ruleFileText.split('\n')[Number(lineStr) - 1] ?? '').trim();
  assert.match(cited, /Create pallet/,
    `the cited line (${file}:${lineStr}) is the If-sentence that caused this commit`);

  // 2. The same message records the roles the author actually held (FD-9's half of the sentence).
  assert.match(commit.message, /^NeoDonkey-Actor-Roles: warehouse-clerk$/m);

  // 3. "Inside the signed payload": our own SSHSIG verifier accepts these exact bytes...
  const publicSsh = await exportPublicSsh(keyPair, 'sarah@neodonkey.eu');
  assert.equal(typeof commit.signature, 'string', 'the commit carries a signature');
  assert.ok(commit.signature.length > 0, 'the commit is signed');
  const verdict = await verifyPayload(publicSsh, commit.payload, commit.signature, 'git');
  assert.equal(verdict, true, 'the signature must verify over the payload carrying the trailers');

  // 4. Control: flip one byte of that payload and the verification must fail — so step 3 binds
  //    the trailers to the signature instead of passing for any reason.
  const tampered = new Uint8Array(commit.payload);
  tampered[0] ^= 0x01;
  const tamperedVerdict = await verifyPayload(publicSsh, tampered, commit.signature, 'git');
  assert.equal(tamperedVerdict, false, 'a modified payload must not verify');
});
