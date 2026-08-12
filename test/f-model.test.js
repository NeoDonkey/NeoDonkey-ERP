/**
 * test/f-model.test.js — validation of the POLISM *content* in `operating-model/` and
 * `templates/`.
 *
 * Owner: agent F. Refactored 2026-08-03 by agent V.
 *
 * WHAT CHANGED AND WHY. Until now this file carried an independently written parser that
 * re-derived the grammar from `runtime/polism/grammar.md`. That duplication was deliberate and it
 * earned its keep: written in parallel with `runtime/polism/parse.js`, it caught real defects
 * precisely because it shared none of the parser's assumptions. But *the grammar* was the wrong
 * axis of independence. Grammar version 2 (grammar.md Part II, §12–§21) is now normative, and the
 * copy still knew only version 1 — so `## Invariants`, `## Period`, `## Dated in`, `one of …`
 * enumerations, `- create: <role>` entity authority, `when … otherwise …` branch arms and
 * `Create <entity> as "<label>"` were all reported as content defects when the content was right
 * and the checker was out of date. A second implementation of the grammar guarantees a broken test
 * on every future grammar addition, which trains people to edit the test instead of reading it.
 *
 * So syntax now comes from one place: `parseOperatingModel`, asserted to produce **zero hard
 * errors** on both trees. That single assertion subsumes every syntactic check this file used to
 * make by hand — unknown sections, rule shape, known verbs, undeclared entities, undeclared
 * predicates, predicate-body operators, dangling references, consequent targeting, counter fields,
 * id collisions within one rule, and role existence.
 *
 * What remains here is what the parser does not and *should not* check, because it is a statement
 * about our content and our modelling standards rather than about the language:
 *
 *   1. every root populates all six POLISM categories;
 *   2. every model file has a title and prose a human can read before the first `## ` section;
 *   3. every entity declares `## Identified by` and answers `## Created on demand`;
 *   4. every line-item entity declares an explicit `position` (COMPROMISES #4b — an OR-Set has no
 *      order, so array position is not a business fact and a line number must be one);
 *   5. no personal data anywhere — no names-with-addresses, e-mail, phone, IBAN;
 *   6. every role named by an authority clause exists as `organisation/<role>.md`;
 *   7. `NEEDS-GRAMMAR` / `GRAMMAR-REQUEST` markers never appear in `operating-model/` (they are
 *      allowed, and expected, in `templates/`);
 *   8. no two rules on the same trigger create the same document — the parser catches this within
 *      one rule but not across two, so it stays here;
 *   9. the counts, reported;
 *  10. the manifesto's goods-receipt rule is still on disk, word for word.
 *
 * Zero dependencies. `node --test test/f-model.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOperatingModel, GRAMMAR_VERSION, POLISM_CATEGORIES } from '../runtime/polism/parse.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The six POLISM categories (Appendix XII). Taken from the parser so they cannot drift. */
const CATEGORIES = POLISM_CATEGORIES;

// ---------------------------------------------------------------------------- loading

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Is this file documentation rather than model content? (grammar §1) */
const isDoc = (p) => {
  const b = basename(p);
  return b === 'README.md' || b === 'index.md' || b.startsWith('_');
};

/**
 * One model root = a directory that directly contains POLISM category folders.
 * `operating-model/` is one; `templates/<name>/` is another. Names resolve per root, so a
 * template's roles never satisfy the live model's `## Authorized by` and vice versa.
 */
function roots() {
  const found = [];
  const consider = (dir) => {
    if (!existsSync(dir)) return;
    if (CATEGORIES.some((c) => existsSync(join(dir, c)))) found.push(dir);
  };
  consider(join(REPO, 'operating-model'));
  const t = join(REPO, 'templates');
  if (existsSync(t)) for (const n of readdirSync(t).sort()) {
    const p = join(t, n);
    if (statSync(p).isDirectory()) consider(p);
  }
  return found;
}

/**
 * Load one root and hand it to the real parser. Paths are repo-relative, exactly as the runtime
 * sees them, so every diagnostic below names a file a human can open.
 */
function loadRoot(absRoot) {
  const rel = (p) => relative(REPO, p).split('\\').join('/');
  const root = rel(absRoot);
  const all = walk(absRoot);
  const modelFiles = all.filter((p) => !isDoc(p));
  const docFiles = all.filter(isDoc);
  const files = new Map(all.map((p) => [rel(p), readFileSync(p, 'utf8')]));
  const { model, errors } = parseOperatingModel(files);
  return {
    root,
    files,                                       // every .md, repo-relative -> text
    modelFiles: modelFiles.map(rel),
    docFiles: docFiles.map(rel),
    model,
    errors,
    hard: errors.filter((e) => e.severity === 'error'),
    warnings: errors.filter((e) => e.severity === 'warning'),
  };
}

const MODELS = roots().map(loadRoot);

/** Every consequent of a rule, main and in every branch arm (grammar.md §14). */
const allConsequents = (r) => [...r.consequents, ...(r.branches || []).flatMap((b) => b.consequents)];

/** Every role any authority scope of this model names (grammar.md §16). */
function referencedRoles(m) {
  const out = [];
  for (const r of m.model.processes) {
    const at = r.authorizedBySource || r.source;
    for (const role of r.authorizedBy || []) out.push({ role, where: `${at.file}:${at.line}` });
    for (const b of r.branches || []) {
      for (const role of b.authorizedBy || []) {
        const bat = (b.authority && b.authority.source) || r.source;
        out.push({ role, where: `${bat.file}:${bat.line}` });
      }
    }
  }
  for (const [, def] of m.model.entities) {
    if (!def.authority) continue;
    for (const [op, entry] of def.authority.byOp) {
      for (const role of entry.roles) {
        out.push({ role, where: `${def.authority.source.file}:${entry.line} (- ${op}:)` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- tests

test('there is an operating-model root and at least one template root', () => {
  assert.ok(MODELS.length >= 2, `expected operating-model plus a template, found: ${MODELS.map((m) => m.root).join(', ')}`);
  assert.ok(MODELS.some((m) => m.root === 'operating-model'), 'operating-model/ is missing');
  assert.ok(MODELS.some((m) => m.root.startsWith('templates/')), 'no template root found');
});

test('all six POLISM categories are populated in every root', () => {
  for (const m of MODELS) for (const c of CATEGORIES) {
    const dir = join(REPO, m.root, c);
    assert.ok(existsSync(dir), `${m.root}/${c}/ is missing`);
    assert.ok(walk(dir).filter((p) => !isDoc(p)).length > 0, `${m.root}/${c}/ is empty`);
  }
});

/**
 * THE syntax test. Everything the grammar decides is decided here, once, by the runtime that will
 * decide it in production — not by a second implementation in a test file (which is how this file
 * came to refuse legitimate grammar-version-2 content).
 *
 * Warnings are counted and printed but not asserted to be zero: FD-7 ships a *warning* for every
 * uncovered entity+operation pair on purpose, so an empty warning list would mean that mechanism
 * had been switched off.
 */
test('the real parser accepts every root with zero hard errors', () => {
  assert.equal(GRAMMAR_VERSION, 2, 'this file is written against grammar version 2');
  const lines = [];
  for (const m of MODELS) {
    lines.push(`${m.root}: ${m.hard.length} errors, ${m.warnings.length} warnings`);
    const shown = m.hard.slice(0, 25).map((e) => `${e.message}`);
    assert.deepEqual(m.hard.map((e) => e.message.split('\n')[0]), [],
      `${m.root}: the parser refuses ${m.hard.length} thing(s) in the content:\n\n${shown.join('\n\n')}`);
    assert.ok(m.model.processes.length > 0, `${m.root}: parsed no rules at all — this test would pass vacuously`);
    assert.ok(m.model.entities.size > 0, `${m.root}: parsed no entities at all`);
  }
  console.log('\n  parser diagnostics\n  ' + lines.join('\n  ') + '\n');
});

test('every model file has a title and prose a human can read before the first section', () => {
  // Not a grammar rule and it must never become one: the parser is right to accept a file with no
  // prose. Appendix III wants a document an auditor can read, so this is a content standard.
  const bad = [];
  for (const m of MODELS) for (const p of m.modelFiles) {
    const text = m.files.get(p);
    const lines = text.split('\n');
    if (!/^#\s+\S/.test(lines[0] || '')) bad.push(`${p}:1: no "# Title" on the first line`);
    const head = [];
    for (const l of lines.slice(1)) { if (/^##\s+/.test(l)) break; head.push(l); }
    const paragraphs = head.join('\n').trim().split(/\n\s*\n/)
      .filter((x) => x.replace(/^#.*$/m, '').trim());
    if (paragraphs.length < 2) bad.push(`${p}: no prose for a human above the first "## " section`);
  }
  assert.deepEqual(bad, [], `unreadable files:\n  ${bad.join('\n  ')}`);
});

test('every entity declares its business key and answers created-on-demand', () => {
  // The parser checks that "## Identified by" names real fields; it does not *demand* the section,
  // and it should not — a grammar that refuses an incomplete document refuses a draft. Demanding it
  // of our own content is a modelling standard, so it lives here.
  const bad = [];
  for (const m of MODELS) for (const [name, def] of m.model.entities) {
    if (!def.identifiedBy || !def.identifiedBy.length) bad.push(`${def.source.file}: "${name}" has no "## Identified by"`);
    const text = m.files.get(def.source.file) || '';
    if (!/^##\s*Created on demand\s*:?\s*$/im.test(text)) {
      bad.push(`${def.source.file}: "${name}" does not answer "## Created on demand" — `
        + 'so nobody has decided whether a first document of this kind may be created by a rule');
    }
  }
  assert.deepEqual(bad, [], `business key problems:\n  ${bad.join('\n  ')}`);
});

test('line-item entities declare an explicit position rather than relying on order', () => {
  // COMPROMISES #4b, agent D: an OR-Set has no order, so array position is lost. A line number is
  // a business fact and must be stored as one. The parser cannot know which entities are lines.
  const bad = [];
  const seen = [];
  for (const m of MODELS) for (const [name, def] of m.model.entities) {
    if (!/(^|-)line$/.test(name)) continue;
    seen.push(`${m.root}/${name}`);
    if (!def.fields.has('position')) bad.push(`${def.source.file}: line-item entity "${name}" does not declare "position"`);
  }
  assert.ok(seen.length >= 4, `expected several line-item entities, found: ${seen.join(', ') || 'none'}`);
  assert.deepEqual(bad, [], `missing position:\n  ${bad.join('\n  ')}`);
});

test('no personal data: no email addresses, phone numbers, postal addresses or IBANs', () => {
  // The operating model describes *kinds* of documents. A real person's data in it would be a
  // GDPR problem in a Git history that is designed never to forget.
  const bad = [];
  for (const m of MODELS) for (const p of [...m.modelFiles, ...m.docFiles]) {
    const text = m.files.get(p);
    for (const [label, re] of [
      ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
      // A phone number, not a document number: an international prefix or a leading zero,
      // then groups separated by spaces or slashes. `PO-2026-0417-03` must not match.
      ['a phone number', /(?:^|[\s(])(?:\+\d{1,3}[\s/]\d{2,5}[\s/]\d{4,}|0\d{2,4}[\s/]\d{5,})/m],
      ['a street address', /\b[A-ZÄÖÜ][a-zäöüß]{2,}(?:stra(?:ss|ß)e|weg|allee|platz|gasse)\s+\d+/],
      ['an IBAN', /\b[A-Z]{2}\d{2}[\sA-Z0-9]{12,}\b/],
    ]) if (re.test(text)) bad.push(`${p}: contains what looks like ${label}`);
  }
  assert.deepEqual(bad, [], `possible personal data:\n  ${bad.join('\n  ')}`);
});

test('every role an authority clause names exists in organisation/ of the same root', () => {
  // The parser refuses an unknown role too, so a failure here would also fail the zero-errors test
  // above. It is kept because it names the root, so a template role satisfying the live model — the
  // mistake that is easy to make and hard to see — is reported in the words of the person who made it.
  const bad = [];
  for (const m of MODELS) {
    const seen = new Set();
    for (const { role, where } of referencedRoles(m)) {
      if (seen.has(`${where}|${role}`)) continue;
      seen.add(`${where}|${role}`);
      if (!m.model.roles.has(role)) {
        bad.push(`${where}: "${role}" has no organisation/${role}.md in ${m.root}. `
          + `Declared roles: ${[...m.model.roles.keys()].sort().join(', ')}`);
      }
    }
    assert.ok(seen.size > 0, `${m.root}: no rule names any role at all`);
  }
  assert.deepEqual(bad, [], `unknown roles:\n  ${bad.join('\n  ')}`);
});

test('no two rules on the same trigger create the same document', () => {
  // Two rules on one trigger both run (grammar.md §8 conjoins them), and an unlabelled create takes
  // the trigger's id, so the second collides with the first. The parser catches this *within* one
  // rule (§21) but not across two, so this check is not duplication — it is the half nobody covers.
  // Two arms of one rule are exclusive, so a rule's own creates are deduplicated first.
  const bad = [];
  for (const m of MODELS) {
    const made = new Map();
    for (const r of m.model.processes) {
      const mine = new Set();
      for (const c of allConsequents(r)) {
        if (c.verb !== 'create') continue;
        mine.add(`${c.entity}${c.label ? ` as "${c.label}"` : ''}`);
      }
      for (const what of [...mine].sort()) {
        const k = `${r.trigger.op} ${r.trigger.entity} -> create ${what}`;
        const at = `${r.source.file}:${r.source.line}`;
        if (made.has(k)) {
          bad.push(`${at}: "Create ${what}" is already created by ${made.get(k)} on the same `
            + `"${r.trigger.op} ${r.trigger.entity}" trigger; both would use the trigger's id. `
            + 'Give one of them a label (grammar.md §21).');
        } else made.set(k, at);
      }
    }
  }
  assert.deepEqual(bad, [], `duplicate creates:\n  ${bad.join('\n  ')}`);
});

test('operating-model contains no NEEDS-GRAMMAR or GRAMMAR-REQUEST markers — those belong in the template', () => {
  const om = MODELS.find((m) => m.root === 'operating-model');
  const bad = [];
  for (const p of [...om.modelFiles, ...om.docFiles]) {
    const text = om.files.get(p);
    for (const marker of ['NEEDS-GRAMMAR', 'GRAMMAR-REQUEST']) {
      if (text.includes(marker)) bad.push(`${p}: ${marker}`);
    }
  }
  assert.deepEqual(bad, [],
    `a grammar marker in operating-model/ means the live model needs syntax that does not exist.\n`
    + `Markers are only allowed in templates/:\n  ${bad.join('\n  ')}`);
});

test('counts — the manifesto asks for 20-30 entities, 40-60 rules, 10-15 roles per template', () => {
  const lines = [];
  for (const m of MODELS) {
    const perCat = CATEGORIES.map((c) => `${c}=${walk(join(REPO, m.root, c)).filter((p) => !isDoc(p)).length}`).join(' ');
    const invariants = [...m.model.entities.values()].reduce((n, d) => n + d.invariants.size, 0);
    lines.push(`${m.root}: files=${m.files.size} entities=${m.model.entities.size} `
      + `rules=${m.model.processes.length} roles=${m.model.roles.size} invariants=${invariants}\n    ${perCat}`);
  }
  console.log('\n  POLISM content counts\n  ' + lines.join('\n  ') + '\n');

  const tpl = MODELS.filter((m) => m.root.startsWith('templates/'));
  for (const m of tpl) {
    assert.ok(m.model.entities.size >= 20, `${m.root}: ${m.model.entities.size} entities, manifesto asks for at least 20`);
    assert.ok(m.model.processes.length >= 40, `${m.root}: ${m.model.processes.length} rules, manifesto asks for at least 40`);
    assert.ok(m.model.roles.size >= 10 && m.model.roles.size <= 15, `${m.root}: ${m.model.roles.size} roles, manifesto asks for 10-15`);
  }
  const om = MODELS.find((m) => m.root === 'operating-model');
  assert.ok(om.model.entities.size >= 15, `operating-model: only ${om.model.entities.size} entities`);
  assert.ok(om.model.processes.length >= 20, `operating-model: only ${om.model.processes.length} rules`);
  assert.ok(om.model.roles.size >= 7, `operating-model: only ${om.model.roles.size} roles`);
});

test('goods-receipt is the reference process and carries the manifesto rule', () => {
  const p = join(REPO, 'operating-model', 'processes', 'goods-receipt.md');
  assert.ok(existsSync(p), 'operating-model/processes/goods-receipt.md is missing');
  const text = readFileSync(p, 'utf8');
  for (const s of ['## Triggered by', '## Rules', '## Authorized by']) assert.ok(text.includes(s), `goods-receipt.md has no "${s}"`);
  for (const phrase of [
    'If Create goods-receipt under condition',
    'quantity > 0',
    'order exists',
    'order not already fully delivered',
    'Update stock with +quantity',
    'Update order-line with status "delivered"',
    'Create goods-receipt-fact with batch-number',   // Appendix XII line 475, the one-word change
  ]) assert.ok(text.includes(phrase), `goods-receipt.md is missing the manifesto text: ${phrase}`);
  assert.match(text, /^warehouse-clerk or warehouse-management$/m, 'goods-receipt.md must be authorized by warehouse-clerk or warehouse-management');

  // "fully delivered" must get its meaning from the operating model, never from the parser.
  const om = MODELS.find((m) => m.root === 'operating-model');
  const order = om.model.entities.get('order');
  assert.ok(order, 'operating-model/information/order.md is missing');
  assert.ok(order.predicates.has('already fully delivered'), '"already fully delivered" is not declared on order');
  assert.ok(order.predicates.has('fully delivered'), '"fully delivered" is not declared on order');
  assert.match(order.predicates.get('fully delivered').text, /delivered-quantity\s*>=\s*ordered-quantity/,
    '"fully delivered" must be defined as a comparison in the rule grammar, not assumed');

  // stock must be findable and creatable, or the manifesto rule cannot execute.
  const stock = om.model.entities.get('stock');
  assert.deepEqual(stock.identifiedBy, ['article', 'location'], 'stock must be identified by article and location');
  assert.ok(stock.createdOnDemand, 'stock must declare "## Created on demand: yes" so a first pallet is not refused');
});
