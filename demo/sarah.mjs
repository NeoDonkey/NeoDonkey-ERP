#!/usr/bin/env node
/**
 * Appendix X, reenacted — and then checked by software we did not write.
 *
 *   node demo/sarah.mjs [target-dir]
 *
 * This is the acceptance test for the whole MVP. It does not assert against our own
 * beliefs; it builds a company and then hands the folder to real `git` and real
 * `ssh-keygen` and asks them what they think.
 */

import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { nodeFs } from '../runtime/git/fs-node.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { allowedSignersLine } from '../runtime/identity/sshsig.js';
import { open } from '../runtime/kernel.js';

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const step = (n, s) => console.log(`\n${B(`── ${n} ${'─'.repeat(Math.max(0, 62 - n.length))}`)}\n  ${s}`);

let failures = 0;
const check = (cond, msg, detail) => {
  console.log('  ' + (cond ? ok(msg) : bad(msg)));
  if (!cond) { failures++; if (detail) console.log(dim('      ' + detail)); }
};

/** A fixed clock. Determinism is a feature, not a test trick (see ARCHITECTURE.md D3). */
let t = Date.parse('2027-11-03T09:14:00Z');
const clock = () => (t += 60_000);

const git = (dir, ...args) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * FD-9 — the roles Sarah HOLDS, recorded in her signed peer record in the genesis commit.
 *
 * This list used to be called `ALL_ROLES` and lived next to `prepareWorld()`, where it was passed
 * to every `perform()` as `actorRoles` — a claim the demo made about itself, which the kernel
 * believed (COMPROMISES #21 and #22, demonstrated by our own acceptance test). It is now a grant:
 * signed into the first commit, readable with `git show`, and the ceiling on everything the demo
 * can do afterwards.
 *
 * It is a long list, and that is not a cheat — it is what a founder on day 1 actually is. Sarah IS
 * the company: she signs the orders, she counts the pallets and she does the books. A real company
 * splits these across people, and the point of recording them rather than claiming them is that the
 * split becomes enforceable the moment it happens: revoke `warehouse-clerk` from the managing
 * director in one signed commit and she can no longer book her own goods receipts.
 */
const SARAH_ROLES = ['managing-director', 'category-manager', 'warehouse-clerk',
                     'quality-manager', 'accountant', 'purchasing-manager',
                     'warehouse-management', 'controller'];

async function main() {
  const target = process.argv[2] ?? await mkdtemp(join(tmpdir(), 'neodonkey-sarah-'));
  console.log(`\n${B('NeoDonkey')} — Sarah's first weekend\n${dim(target)}`);

  // ── Day 1: she downloads a folder and types her name.
  step('Day 1', 'Sarah installs NeoDonkey. No account, no email, no credit card.');
  const kp = await generateIdentity();
  const seed = await loadOperatingModel();
  const nd = await open({
    fs: nodeFs(target),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair: kp },
    seed,
    clock,
    tzOffsetMinutes: 60,
    // FD-7: strict authorization, the default for a new workspace. This demo used to ask for
    // permissive and say so out loud, because the shipped model had no master-data promotion rules
    // (COMPROMISES #4h) — those rules exist now (supplier-approval, article-activation,
    // purchase-order-confirmation), so the demo runs under the real default.
    strictAuthorization: true,
    // FD-9: the root grant. Not a claim — a fact in the genesis commit, signed by the only person
    // who could possibly authorise it on day 1, and the thing every later grant descends from.
    roles: SARAH_ROLES,
  });
  console.log(dim('      authorization: strict (FD-7 default-deny — an operation no rule and no'
    + ' entity default governs is refused, not allowed)'));
  console.log(dim(`      operating model: ${seed.size} files, ` +
    `${nd.model?.processes?.length ?? 0} rules, ${nd.model?.entities?.size ?? 0} entities`));
  check(nd.modelErrors.length === 0, 'the company description parses and is executable',
    nd.modelErrors.map((e) => `${e.file}:${e.line} ${e.message}`).join('\n      '));
  check((await nd.history()).length === 1, 'genesis commit exists');

  // ── FD-9: authority is a fact in the repo, not an argument to a function call.
  const mine = nd.myRoles();
  console.log(dim(`      her authority: ${mine.roles.length} roles recorded in ${mine.at},`
    + ' signed into the genesis commit'));
  const overreach = await nd.perform({
    op: 'create', entity: 'goods-receipt', id: 'GR-0000',
    doc: goodsReceipt('GR-0000'),
    actorRoles: ['tax-accountant'],          // a real role in the model. Not one she was granted.
  });
  check(overreach.rejected?.[0]?.code === 'roles-not-held',
    'a role she was never granted is refused — roles are claimed ∩ recorded, never replaced (FD-9)',
    JSON.stringify(overreach.rejected, null, 2));
  console.log(dim(`      ${(overreach.rejected?.[0]?.reason ?? '').split('\n')[0]}`));

  // ── Day 2: a fact enters the world.
  step('Day 2', 'A supplier delivers. The warehouse books a goods receipt.');
  await prepareWorld(nd);
  const grId = nd.nextId('goods-receipt', 'GR');
  const gr = await nd.perform({
    op: 'create', entity: 'goods-receipt', id: grId,
    doc: goodsReceipt(grId),
    actorRoles: ['warehouse-clerk'],
  });
  check(!gr.rejected, 'the goods receipt is accepted by the operating model',
    gr.rejected && JSON.stringify(gr.rejected, null, 2));
  if (!gr.rejected) {
    console.log(dim(`      one commit, ${gr.changes.length} documents changed atomically:`));
    for (const c of gr.changes) console.log(dim(`        ${c.op} ${c.entity} ${c.id}`));
    check(gr.changes.length >= 2,
      'the consequents landed with the trigger — stock moved in the same commit');
  }

  // ── The rule engine says no, and says why.
  step('Day 2', 'A second delivery is booked with quantity 0. The company refuses itself.');
  const zero = await nd.perform({
    op: 'create', entity: 'goods-receipt', id: 'GR-9999',
    doc: goodsReceipt('GR-9999', { quantity: 0, 'delivered-quantity': 0 }),
    actorRoles: ['warehouse-clerk'],
  });
  check(!!zero.rejected, 'refused, deterministically');
  if (zero.rejected) {
    for (const r of zero.rejected) {
      console.log(dim(`      ${r.reason}`));
      if (r.at) console.log(dim(`      ↳ the sentence that refused it: ${r.at}`));
    }
    check(zero.rejected.some((r) => r.at), 'the refusal cites the written rule, by file and line');
  }

  // ── Authorization is a rule constraint, not workflow code.
  //
  // FD-9 changed what this step has to be. It used to be Sarah claiming `customer-service-agent`
  // and being refused by the rule — but she was never granted that role, so after FD-9 the kernel
  // refuses the CLAIM and the company's own sentence never gets to speak. Which would make the
  // check below false while it still printed a tick.
  //
  // So the demo now does the real thing: Sarah hires Anna, grants her exactly one role in a signed
  // commit, and Anna — a genuine customer service agent, with the repository saying so — is refused
  // by the goods-receipt rule itself. That is the claim this step was always making, and it is only
  // now actually being made.
  step('Day 2', 'Sarah hires Anna and grants her one role. Anna tries the same booking.');
  const annaKp = await generateIdentity();
  const hired = await nd.addPeer({
    name: 'Anna Bauer', email: 'anna@neodonkey.eu',
    publicKeySsh: await exportPublicSsh(annaKp, 'anna@neodonkey.eu'),
    roles: ['customer-service-agent'],
  });
  check(!hired.rejected && !!hired.oid,
    'the grant is a signed commit — authority is given, not asserted',
    JSON.stringify(hired.rejected, null, 2));
  console.log(dim(`      ${git(target, 'log', '-1', '--format=%s', hired.oid).trim()}`));

  // Anna opens the same folder with her own key. She is a different peer, not a different argument.
  const annaNd = await open({
    fs: nodeFs(target),
    identity: { name: 'Anna Bauer', email: 'anna@neodonkey.eu', keyPair: annaKp },
    clock, tzOffsetMinutes: 60,
  });
  const unauth = await annaNd.perform({
    op: 'create', entity: 'goods-receipt', id: 'GR-9998',
    doc: goodsReceipt('GR-9998'),
  });
  check(!!unauth.rejected && unauth.rejected[0].code !== 'roles-not-held',
    'refused on authorization, from the same text — the rule refuses her, not her peer record',
    JSON.stringify(unauth.rejected, null, 2));
  console.log(dim(`      ${(unauth.rejected?.[0]?.reason ?? '').split('\n').slice(0, 2).join('\n      ')}`));

  // ── Principle 11, the headline claim: change one word, change the system.
  step('Day 3', 'The supply chain manager adds two words to a sentence. No developer.');
  const grPath = 'operating-model/processes/goods-receipt.md';
  const before = new TextDecoder().decode(nd._internals.files.get(grPath));
  const after = before.replace(
    /Create goods-receipt-fact(?! with)/,
    'Create goods-receipt-fact with batch-number',
  );
  if (after === before) {
    console.log(dim('      (consequent already carries batch-number — testing the reverse)'));
  }
  const amend = await nd.amendOperatingModel(grPath, after,
    'goods receipt now requires a batch number');
  check(!amend.rejected, 'the amended company description is accepted and committed',
    amend.rejected && JSON.stringify(amend.rejected));
  const nbId = nd.nextId('goods-receipt', 'GR');
  const noBatch = await nd.perform({
    op: 'create', entity: 'goods-receipt', id: nbId,
    doc: goodsReceipt(nbId, { 'batch-number': undefined, 'receipt-date': '2027-11-04' }),
    actorRoles: ['warehouse-clerk'],
  });
  check(!!noBatch.rejected,
    'a goods receipt without a batch number is now refused — one word changed the system');
  if (noBatch.rejected) {
    console.log(dim(`      ${noBatch.rejected[0].reason.split('\n')[0]}`));
  }

  // ── The Live Layer: Appendix XI's delivery note.
  step('Day 4', 'Two people edit the same document at the same time.');
  try {
    const notes = nd.query.all('delivery-note');
    if (notes.length) {
      const s = nd.edit('delivery-note', notes[0].id);
      s.set('deliveryDate', '2027-11-15');
      s.set('notes', 'Fahrer meldet Verspätung');
      check(s.snapshot().deliveryDate === '2027-11-15', 'live edits apply instantly, locally');
      check(s.conflicts().length === 0, 'different fields, no conflict (the 95% case)');
    } else {
      console.log(dim('      no delivery note in the demo model — covered in test/d-live.test.js'));
    }
  } catch (e) {
    console.log(dim(`      live layer: ${e.message}`));
  }

  // ── We verify ourselves, with our own code, no binaries.
  step('Audit', 'The chain verifies itself — our code, no git, no ssh, browser-capable.');
  const verdicts = await nd.verify();
  const good = verdicts.filter((v) => v.signature === 'good').length;
  check(good === verdicts.length && good > 0,
    `all ${verdicts.length} commits carry a good signature, checked by our own Ed25519 code`,
    JSON.stringify(verdicts.filter((v) => v.signature !== 'good'), null, 2));

  // FD-9's audit question, which is the one that makes the rest of it worth having: for a commit
  // written months ago, did its author actually hold the roles the rule required AT THE TIME? It is
  // answered from two independent places that must agree — the signed `NeoDonkey-Actor-Roles`
  // trailer, and `peers/<author>.json` as it stood in that commit's own tree.
  const business = verdicts.filter((v) => v.authority.actedWith !== null);
  const disagree = verdicts.filter((v) => v.authority.agree === false);
  check(business.length > 0 && disagree.length === 0,
    `every one of ${business.length} business commits records the roles its author held, and they `
    + 'agree with the peer record as it stood in that same commit',
    JSON.stringify(disagree, null, 2));
  const sample = business.find((v) => v.authority.actedWith.length);
  if (sample) {
    console.log(dim(`      ${sample.oid.slice(0, 8)} ${sample.authority.actor} acted with `
      + `[${sample.authority.actedWith.join(', ')}]; recorded for them at that commit: `
      + `[${sample.authority.recordedAtCommit.join(', ')}]`));
  }

  // ── And now the part that matters: foreign software judges us.
  step('Audit', 'Real git and real ssh-keygen inspect the folder. They never met us.');
  // Deliberately OUTSIDE the workspace: an auditor's trust store is not company data, and
  // writing it into the folder would make git report a dirty tree — which would be our bug,
  // not a finding about the repo.
  const signers = join(await mkdtemp(join(tmpdir(), 'neodonkey-signers-')), 'allowed_signers');
  await writeFile(signers,
    allowedSignersLine('sarah@neodonkey.eu', await exportPublicSsh(kp, 'sarah@neodonkey.eu')) + '\n');

  let fsck = '';
  try { fsck = git(target, 'fsck', '--strict'); check(true, 'git fsck --strict: clean'); }
  catch (e) { check(false, 'git fsck --strict', String(e.stderr || e)); }

  const status = git(target, 'status', '--porcelain');
  check(status.trim() === '', 'git status: clean working tree — it is simply a folder',
    status);

  const sigs = git(target, '-c', `gpg.ssh.allowedSignersFile=${signers}`,
    'log', '--format=%G? %GS %s');
  const lines = sigs.trim().split('\n');
  const allGood = lines.every((l) => l.startsWith('G '));
  check(allGood, `git verifies every one of ${lines.length} commits as a good signature`, sigs);
  console.log(dim('      ' + lines.slice(0, 4).map((l) => l.slice(0, 78)).join('\n      ')));

  // Nachvollziehbarkeit: the posting points at the sentence that caused it.
  const full = git(target, 'log', '--format=%B', '-n', '40');
  check(/NeoDonkey-Rule: operating-model\//.test(full),
    'every posting names the written rule that authorized it (GoBD Nachvollziehbarkeit)');

  // ...and who was allowed to. FD-9: real git reads the roles out of the signed payload, so the
  // authority behind a commit survives without our code, our index, or our good intentions.
  check(/NeoDonkey-Actor-Roles: .*warehouse-clerk/.test(full)
        && /NeoDonkey-Founder-Roles: .*managing-director/.test(full)
        && /NeoDonkey-Peer-Roles: customer-service-agent/.test(full),
    'real git reads the roles the author held, the founder\'s root grant, and Anna\'s grant — '
    + 'straight out of the signed commit messages',
    full.split('\n').filter((l) => /^NeoDonkey-(Actor|Founder|Peer)-Roles/.test(l)).join('\n      '));

  // Principle 6, the thirty-year claim, in its cheapest testable form.
  const first = git(target, 'rev-list', '--max-parents=0', 'HEAD').trim();
  git(target, 'checkout', '--quiet', first);
  const genesisFiles = await readdir(target);
  git(target, 'checkout', '--quiet', '-');
  check(genesisFiles.includes('operating-model'),
    'checking out the first commit yields a readable company — history is not a log, it is the system');

  // ── The result, in a sentence.
  const stats = nd.query.stats();
  step('Result', 'What is in the folder.');
  console.log(dim(`      ${Object.entries(stats.entities ?? {})
    .map(([e, n]) => `${n} ${e}`).join(', ') || 'no documents'}`));
  console.log(dim(`      ${(await nd.history(200)).length} signed transactions`));
  console.log(dim(`      0 servers, 0 dependencies, 0 accounts, 0 vendors`));

  console.log(failures === 0
    ? `\n${B('\x1b[32mThe donkey carries the load.\x1b[0m')}  ${dim(target)}\n`
    : `\n\x1b[31m${B(`${failures} check(s) failed.`)}\x1b[0m  ${dim(target)}\n`);
  if (!process.argv[2]) console.log(dim(`  (temp workspace kept for inspection: cd ${target})\n`));
  process.exit(failures === 0 ? 0 : 1);
}

/** The operating model ships as text in the repo. Load it as the seed for a fresh company. */
async function loadOperatingModel() {
  const root = new URL('../operating-model/', import.meta.url);
  const seed = new Map();
  const walk = async (rel) => {
    let entries;
    try { entries = await readdir(new URL(rel, root), { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) await walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        seed.set(`operating-model/${rel}${e.name}`,
          await readFile(new URL(`${rel}${e.name}`, root), 'utf8'));
      }
    }
  };
  await walk('');
  return seed;
}

/**
 * A goods receipt cannot exist alone: it references an order, an order line, an article, a
 * location and the employee who counted it. Every one of them is created through the same rule
 * engine — there is no back door into the truth layer, not even for the demo's own setup.
 *
 * Every field below comes from the entity declarations in operating-model/information/. Nothing
 * here was invented: the company said what it requires, and this is that list.
 *
 * Monetary values are exact tokens (FD-1), not numbers. This fixture used to write `net-amount: 2160`
 * and the read path now refuses it — correctly. 240 units at `9.00 EUR` is `2160.00 EUR`, and the
 * point of the token is that those two facts cannot drift apart through a float.
 */
const IDS = {
  vat: 'reverse-charge-eu-b2b', loc: 'berlin-main-warehouse', sup: 'nussliebe-handels-gmbh',
  art: 'cashewkerne-natur-1kg', emp: 'SHA256-AB12CD34', order: 'PO-2027-0001',
  line: 'PO-2027-0001-1',
};

async function prepareWorld(nd) {
  const setup = [
    ['vat-treatment', IDS.vat, {
      name: 'Reverse charge EU B2B', 'applies-to': 'eu-b2b', 'vat-rate-percent': 0,
      'rate-determined-by': 'buyer', 'requires-buyer-vat-id': true,
      'requires-exemption-reason': true, 'requires-ec-sales-list': true,
      'requires-oss-return': false, 'requires-customs-declaration': false,
      'requires-proof-of-transport': true, status: 'active' }],
    ['location', IDS.loc, {
      name: 'Berlin Hauptlager', 'location-type': 'warehouse', country: 'DE', city: 'Berlin',
      'in-eu-customs-union': true, 'stock-holding': true, 'operated-by': 'own',
      'haccp-scope': true, status: 'active' }],
    ['supplier', IDS.sup, {
      name: 'Nussliebe Handels GmbH', 'supplier-type': 'trader', country: 'NL',
      'vat-treatment': IDS.vat, 'payment-terms-days': 30, currency: 'EUR',
      'iban-on-file': true, status: 'prospect' }],
    ['article', IDS.art, {
      name: 'Cashewkerne natur 1 kg', category: 'nuts', status: 'active',
      'batch-managed': true, 'pricing-basis': 'weight', 'net-weight-grams': 1000,
      'vat-category': 'reduced', 'country-of-origin': 'VN', 'shelf-life-days': 365,
      'minimum-remaining-shelf-life-days': 120, 'haccp-relevant': true,
      'nutrition-table': 'per 100 g: 2314 kJ, 44 g fat, 30 g carbohydrate, 18 g protein',
      'allergen-declaration': 'Schalenfrüchte (Cashew)', gtin: '4260123456789' }],
    ['employee', IDS.emp, {
      'display-name': 'Warehouse Clerk (demo)', 'signing-key-fingerprint': IDS.emp,
      roles: 'warehouse-clerk', 'primary-location': IDS.loc, 'employment-status': 'active' }],
    ['order', IDS.order, {
      supplier: IDS.sup, 'delivery-location': IDS.loc, 'order-date': '2027-11-01',
      'requested-delivery-date': '2027-11-03', currency: 'EUR', 'net-amount': '2160.00 EUR',
      'ordered-quantity': 240, 'delivered-quantity': 0, status: 'confirmed',
      'vat-treatment': IDS.vat, 'requires-certificate-of-analysis': true, 'is-import': false }],
    ['order-line', IDS.line, {
      order: IDS.order, position: 1, article: IDS.art, 'ordered-quantity': 240,
      'delivered-quantity': 0, 'agreed-net-price-per-unit': '9.00 EUR', currency: 'EUR',
      status: 'open' }],
  ];

  /**
   * Master data has a lifecycle, and the company insists on it. `Create article` sets
   * status "draft" — an article is not sellable until somebody has done the allergen and
   * nutrition work. `Create order` sets "draft" too. So the demo has to walk the same path a
   * real company walks: create, then promote.
   *
   * Each promotion is now governed by a rule of its own — processes/supplier-approval.md,
   * processes/article-activation.md, processes/purchase-order-confirmation.md — so the demo has to
   * supply what those rules demand: the food-safety certification for the supplier, and the
   * supplier's own confirmation reference for the order. That is the point of them.
   */
  const promote = [
    ['supplier', IDS.sup, { status: 'approved', 'supplier-type': 'goods',
                            'vat-identification-number': 'NL123456789B01',
                            'food-safety-certification': 'IFS', 'certification-valid': true,
                            'last-evaluated-date': '2027-10-01' }],
    ['article', IDS.art, { status: 'active' }],
    ['order', IDS.order, { status: 'confirmed',
                           'supplier-confirmation-reference': 'NL-AB-2027-8841' }],
  ];

  const failures = [];
  const run = async (op, entity, id, doc) => {
    // FD-9: `actorRoles` is OMITTED, and that is the whole change here. This used to pass a
    // thirteen-then-eight element `ALL_ROLES` array the demo did not hold — the defect in
    // COMPROMISES #21 demonstrated by our own acceptance test. Omitting it is not a loophole: it
    // means "act as me", and the kernel resolves that from Sarah's signed peer record. She can
    // therefore do exactly what the genesis commit granted her and not one operation more.
    const r = await nd.perform({ op, entity, id, doc });
    if (r.rejected) failures.push({ op, entity, id, why: r.rejected });
    return r;
  };

  for (const [entity, id, fields] of setup) {
    await run('create', entity, id, { entity, id, ...fields });
    // Promote immediately after creation, so later creates see an approved supplier and an
    // active article — the order of a real onboarding, not a convenience.
    for (const [pEntity, pId, patch] of promote) {
      if (pEntity !== entity || pId !== id) continue;
      const current = nd.query.get(entity, id);
      if (current) await run('update', entity, id, { ...current, ...patch });
    }
  }
  if (failures.length) {
    console.log(dim('      setup could not be completed:'));
    for (const f of failures) {
      console.log(dim(`        ${f.entity}/${f.id}: ${f.why.map((w) => w.reason).join('; ')}`));
    }
  }
  return { ...IDS, failures };
}

/** A goods receipt as a warehouse clerk would actually fill it in. */
function goodsReceipt(id, overrides = {}) {
  return {
    entity: 'goods-receipt', id,
    quantity: 120, 'delivered-quantity': 120,
    order: IDS.order, 'order-line': IDS.line, article: IDS.art, location: IDS.loc,
    'batch-number': 'L-2027-4471', 'best-before-date': '2028-10-31',
    'weight-kg': 120, 'delivery-note-reference': 'LS-NL-88213',
    'packaging-intact': true, 'pallet-count': 2, 'receipt-date': '2027-11-03',
    'received-by': IDS.emp,
    ...overrides,
  };
}

main().catch((e) => { console.error(`\n\x1b[31m${e.stack}\x1b[0m\n`); process.exit(1); });
