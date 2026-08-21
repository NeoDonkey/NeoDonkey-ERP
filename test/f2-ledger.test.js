/**
 * test/f2-ledger.test.js — the general ledger, as an operating model.
 *
 * Owner: agent F2. Covers the POLISM content added for FD-4 (double entry modelled, not built in):
 * the chart of accounts, journal entries and postings, the posting flows, VAT, period close,
 * multi-currency, the trial balance and the statements.
 *
 * Three things this file does that `test/f-model.test.js` cannot:
 *
 *  1. It re-derives the **grammar version 2** structure (`## Invariants`, `one of` enumerations,
 *     `sum of … over … where …`, `count of`, `then when … otherwise …`, per-rule `authorized by`,
 *     `with <field> from <other>`, `Create <entity> as "<name>"`). `f-model.test.js` re-derives
 *     grammar version 1 and therefore reports six failures against this content; each one is a v1
 *     limit that FD-5 removes, and each one is named in `V2_CONSTRUCTS_F_MODEL_REFUSES` below.
 *
 *  2. It refuses an unbalanced journal entry **twice over**: once through its own evaluator of the
 *     declared invariants over a hand-built world, and once through the real
 *     `runtime/polism/execute.js`, which quotes the invariant by name and names the file that
 *     declares it. The second is the one that matters for gate item 1 and it passes.
 *
 *  3. It works a full month end to end with exact decimal money from `runtime/money/money.js`
 *     (FD-1, BigInt minor units, no float anywhere) and asserts the trial balance, the VAT return,
 *     the balance sheet and the profit and loss figures to the cent.
 *
 * Zero dependencies. `node --test test/f2-ledger.test.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Money from '../runtime/money/money.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OM = join(REPO, 'operating-model');

// ---------------------------------------------------------------------------------------------
// Owed items and known collateral, stated up front so nothing hides in a passing suite.
// ---------------------------------------------------------------------------------------------

/**
 * Grammar version 2 constructs this content uses, and the `f-model.test.js` test each one trips.
 * `f-model.test.js` re-derives grammar version 1 from `runtime/polism/grammar.md`; every entry here
 * is a v1 limit that FD-5 removes additively, so the fix belongs in that file (and in `parse.js`),
 * not here. Listed so the six failures are accounted for rather than discovered.
 */
const V2_CONSTRUCTS_F_MODEL_REFUSES = [
  ['## Invariants, ## Period, ## Dated in', 'every file is structurally well formed', 'grammar §12, §18'],
  ['one of a, b, c field type', 'structurally well formed / business key', 'grammar §15'],
  ['- create: <roles> entity authority', 'every file is structurally well formed', 'grammar §16.1'],
  ['when … then … otherwise …', 'every rule has a trigger and a matching then', 'grammar §14'],
  ['arm guards read as consequents', 'every entity a rule touches / can be targeted', 'grammar §14'],
  ['Create <entity> as "<name>"', 'no two rules create the same document from the same trigger', 'NOT IN GRAMMAR v2 — requested'],
];

/** Is the balance invariant executable by the real runtime yet? Set by the feature-detect test. */
const INVARIANTS_ARE_EXECUTABLE_IN_THE_RUNTIME = { value: null, why: 'not probed' };

// ---------------------------------------------------------------------------------------------
// Money helpers — exact decimal only. No Number ever touches an amount (FD-1).
// ---------------------------------------------------------------------------------------------

const eur = (t) => Money.money(t);
const ZERO = eur('0.00 EUR');
const sum = (list) => (list.length ? list.reduce((a, b) => Money.add(a, b), ZERO) : ZERO);
const str = (m) => Money.toString(m);
const eq = (a, b) => Money.equals(a, b);

/** Truncate a EUR amount to whole euros, the way an ELSTER Bemessungsgrundlage is submitted. */
function toFullEuros(m) {
  return Money.round(m, 0, 'down');
}

// ---------------------------------------------------------------------------------------------
// Reading the model — a grammar version 2 aware structural loader.
// ---------------------------------------------------------------------------------------------

const CATEGORIES = ['processes', 'organisation', 'locations', 'information', 'suppliers', 'management-system'];
const RUNTIME_SECTIONS = new Set(['rules', 'authorized by', 'fields', 'predicates', 'identified by',
  'created on demand', 'invariants', 'period', 'dated in', 'displayed by']);
const PROSE_SECTIONS = new Set(['triggered by', 'purpose', 'notes', 'description', 'context', 'owner',
  'inputs', 'outputs', 'measures', 'cadence', 'retention', 'references', 'examples', 'open questions']);
const KNOWN_SECTIONS = new Set([...RUNTIME_SECTIONS, ...PROSE_SECTIONS]);

const SCALARS = new Set(['text', 'number', 'money', 'date', 'boolean']);
const OPS = new Set(['create', 'read', 'update', 'delete']);
const VERBS = new Set(['create', 'update', 'delete']);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** grammar v2 field declaration, including `one of a, b, c`. */
const FIELD = new RegExp(
  '^\\s*[-*]\\s*([a-z0-9-]+)\\s*:\\s*'
  + '(?:(?:reference to)\\s+([a-z0-9-]+)'
  + '|(?:one of)\\s+([a-z0-9-]+(?:\\s*,\\s*[a-z0-9-]+)*)'
  + '|(text|number|money|date|boolean))'
  + '\\s*(required)?\\s*(?:—.*)?$');

const NAMED = /^\s*[-*]\s*([a-z0-9 -]+?)\s*:\s*(.+)$/;
const MONEY_LITERAL = /^"(-?\d+\.?\d*\s[A-Z]{3})"$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}
const isDoc = (p) => {
  const b = basename(p);
  return b === 'README.md' || b === 'index.md' || b.startsWith('_');
};

function sections(text) {
  const out = [];
  let cur = { name: null, lines: [], line: 0 };
  text.split('\n').forEach((l, i) => {
    const m = /^##\s+(.+?):?\s*$/.exec(l);
    if (m && !l.startsWith('###')) { out.push(cur); cur = { name: m[1].trim(), lines: [], line: i + 1 }; }
    else cur.lines.push({ text: l, line: i + 1 });
  });
  out.push(cur);
  return out;
}

/** Load `operating-model/` into entities, roles, rules, invariants and diagnostics. */
function loadModel() {
  const rel = (p) => relative(REPO, p);
  const problems = [];
  const entities = new Map();
  const pendingAuthority = new Map();
  const roles = new Set();
  const rules = [];
  const files = walk(OM).filter((p) => !isDoc(p));
  const docFiles = walk(OM).filter(isDoc);

  for (const p of files) {
    const category = basename(dirname(p));
    const name = basename(p, '.md');
    const text = readFileSync(p, 'utf8');
    if (!CATEGORIES.includes(category)) { problems.push(`${rel(p)}: not inside a POLISM category folder`); continue; }
    if (!SLUG.test(name)) problems.push(`${rel(p)}: file name "${name}" is not a lower-case slug`);
    if (!/^#\s+\S/.test(text.split('\n')[0] || '')) problems.push(`${rel(p)}:1: no "# Title" on the first line`);

    const secs = sections(text);
    const prose = secs[0].lines.map((l) => l.text).join('\n').trim();
    if (prose.split(/\n\s*\n/).filter((x) => x.replace(/^#.*$/m, '').trim()).length < 2) {
      problems.push(`${rel(p)}: no prose for a human above the first "## " section`);
    }
    const seen = new Set();
    for (const s of secs.slice(1)) {
      const key = s.name.toLowerCase();
      if (!KNOWN_SECTIONS.has(key)) { problems.push(`${rel(p)}:${s.line}: unknown section "## ${s.name}"`); continue; }
      if (seen.has(key)) problems.push(`${rel(p)}:${s.line}: section "## ${s.name}" appears twice`);
      seen.add(key);
      const entityOnly = key === 'fields' || key === 'predicates' || key === 'identified by'
        || key === 'created on demand' || key === 'invariants' || key === 'period' || key === 'dated in' || key === 'displayed by';
      if (entityOnly && category !== 'information') {
        problems.push(`${rel(p)}:${s.line}: "## ${s.name}" is only allowed in information/`);
      }
    }
    const sec = (k) => secs.slice(1).find((s) => s.name.toLowerCase() === k);

    if (category === 'organisation') roles.add(name);

    if (category === 'information') {
      const def = {
        name, file: rel(p), fields: new Map(), predicates: new Map(), invariants: new Map(),
        key: [], onDemand: false,
      };
      const f = sec('fields');
      if (!f) problems.push(`${rel(p)}: an entity must declare "## Fields"`);
      else for (const { text: l, line } of f.lines) {
        if (!/^\s*[-*]\s/.test(l)) { if (l.trim()) problems.push(`${rel(p)}:${line}: stray text in "## Fields": ${l.trim().slice(0, 60)}`); continue; }
        const m = FIELD.exec(l);
        if (!m) { problems.push(`${rel(p)}:${line}: not a field declaration: ${l.trim().slice(0, 80)}`); continue; }
        if (def.fields.has(m[1])) problems.push(`${rel(p)}:${line}: field "${m[1]}" declared twice`);
        const values = m[3] ? m[3].split(',').map((x) => x.trim()) : null;
        if (values) {
          if (new Set(values).size !== values.length) problems.push(`${rel(p)}:${line}: "one of" repeats a value`);
          if (values.length < 2) problems.push(`${rel(p)}:${line}: "one of" needs at least two values`);
        }
        def.fields.set(m[1], {
          type: m[2] ? 'reference' : (values ? 'enum' : m[4]),
          target: m[2] || null, values, required: !!m[5], line,
        });
      }
      for (const [secName, into] of [['predicates', def.predicates], ['invariants', def.invariants]]) {
        const s = sec(secName);
        if (!s) continue;
        for (const { text: l, line } of s.lines) {
          if (!/^\s*[-*]\s/.test(l)) { if (l.trim()) problems.push(`${rel(p)}:${line}: stray text in "## ${secName}": ${l.trim().slice(0, 60)}`); continue; }
          const m = NAMED.exec(l);
          if (!m) { problems.push(`${rel(p)}:${line}: not a ${secName.slice(0, -1)} declaration: ${l.trim().slice(0, 70)}`); continue; }
          if (/\band\b/.test(m[1])) problems.push(`${rel(p)}:${line}: ${secName.slice(0, -1)} name may not contain "and"`);
          if (into.has(m[1].trim())) problems.push(`${rel(p)}:${line}: "${m[1].trim()}" declared twice`);
          into.set(m[1].trim(), { body: m[2].trim(), line, file: rel(p) });
        }
      }
      // grammar §18: the period declaration, and the date field a document is dated by.
      const per = sec('period');
      if (per) {
        def.period = {};
        for (const { text: l, line } of per.lines) {
          if (!l.trim()) continue;
          const m = /^\s*[-*]\s*(from|to|locked when)\s*:\s*(.+)$/.exec(l);
          if (!m) { problems.push(`${rel(p)}:${line}: not a "## Period" bullet: ${l.trim().slice(0, 60)}`); continue; }
          def.period[m[1]] = m[2].trim();
        }
        for (const k of ['from', 'to', 'locked when']) {
          if (!def.period[k]) problems.push(`${rel(p)}: "## Period" is missing "- ${k}:"`);
        }
        for (const k of ['from', 'to']) {
          if (def.period[k] && !def.fields.has(def.period[k])) {
            problems.push(`${rel(p)}: "## Period - ${k}: ${def.period[k]}" is not a declared field`);
          }
        }
      }
      const dated = sec('dated in');
      if (dated) {
        def.datedIn = [];
        for (const { text: l, line } of dated.lines) {
          if (!l.trim()) continue;
          const m = /^\s*[-*]\s*([a-z0-9-]+)\s+in\s+([a-z0-9-]+)\s*$/.exec(l);
          if (!m) { problems.push(`${rel(p)}:${line}: not a "## Dated in" bullet: ${l.trim().slice(0, 60)}`); continue; }
          def.datedIn.push({ field: m[1], period: m[2] });
        }
      }
      const idBy = sec('identified by');
      if (idBy) def.key = idBy.lines.map((l) => l.text).join(' ').split(/\band\b|,/).map((x) => x.trim()).filter(Boolean);
      const od = sec('created on demand');
      if (od) {
        const v = od.lines.map((l) => l.text).join(' ').trim().toLowerCase();
        if (!['yes', 'no'].includes(v)) problems.push(`${rel(p)}: "## Created on demand" must be yes or no, got "${v}"`);
        def.onDemand = v === 'yes';
      }
      if (pendingAuthority.has(name)) { def.authority = pendingAuthority.get(name); pendingAuthority.delete(name); }
      entities.set(name, def);
    }

    const authSec = sec('authorized by');
    let fileRoles = [];
    if (authSec) {
      const bullets = authSec.lines
        .map((l) => /^\s*[-*]\s*(create|read|update|delete)\s*:\s*(.+)$/i.exec(l.text))
        .filter(Boolean);
      if (bullets.length) {
        // grammar §16.1: entity-scope authority, per operation. Only in information/.
        if (category !== 'information') {
          problems.push(`${rel(p)}:${authSec.line}: the "- <operation>: <roles>" form is entity scope and belongs in information/`);
        }
        const ops = new Map();
        for (const b of bullets) {
          const key = b[1].toLowerCase();
          if (ops.has(key)) problems.push(`${rel(p)}:${authSec.line}: "- ${key}:" appears twice`);
          ops.set(key, b[2].split(/\bor\b|,/).map((x) => x.trim()).filter(Boolean));
        }
        if (entities.has(name)) entities.get(name).authority = ops;
        else pendingAuthority.set(name, ops);
        const stray = authSec.lines.filter((l) => l.text.trim() && !/^\s*[-*]\s*(create|read|update|delete)\s*:/i.test(l.text));
        for (const l of stray) problems.push(`${rel(p)}:${l.line}: entity authority may not mix the bullet form with a plain role list`);
      } else {
        const raw = authSec.lines.map((l) => l.text).join(' ').trim();
        fileRoles = raw.split(/\bor\b|,|\n/).map((x) => x.trim()).filter(Boolean);
      }
    }
    const rs = sec('rules');
    if (rs) {
      let block = null;
      const finish = () => {
        if (!block) return;
        rules.push({ file: rel(p), line: block.line, raw: block.lines.join(' ').replace(/\s+/g, ' ').trim(), fileRoles });
        block = null;
      };
      for (const { text: l, line } of rs.lines) {
        if (/^#/.test(l.trim())) { problems.push(`${rel(p)}:${line}: a heading inside "## Rules" is refused`); continue; }
        if (/^If\b/i.test(l.trim()) && !/^\s/.test(l)) { finish(); block = { line, lines: [l] }; continue; }
        if (block && (l.trim() === '' || /^\s+\S/.test(l) || /^then\b/i.test(l.trim()))) { block.lines.push(l); continue; }
        if (l.trim()) problems.push(`${rel(p)}:${line}: text inside "## Rules" that is not part of a rule: ${l.trim().slice(0, 60)}`);
      }
      finish();
    }
  }
  return { problems, entities, roles, rules, files, docFiles };
}

// ---------------------------------------------------------------------------------------------
// Grammar version 2 rule shape.
// ---------------------------------------------------------------------------------------------

const CONSEQUENT_SPLIT = /\s+and\s+(?=(?:Create|Update|Delete)\s)/i;
const FIRST_VERB = /\b(Create|Update|Delete)\s+[a-z0-9-]+/i;

/**
 * `If <op> <entity> [under condition <c>] then <body> [authorized by <roles>]`
 * where `<body>` is a consequent list or `when <c> <cons> [otherwise when <c> <cons>]* [otherwise <cons>]`.
 */
const AUTHORIZED = /\s+authoris?zed by\s+([a-z0-9 ,-]+?)\s*$/i;
const roleList = (s) => s.split(/\bor\b|,/).map((x) => x.trim()).filter(Boolean);

function shapeV2(raw) {
  const head = /^If\s+(create|read|update|delete)\s+([a-z0-9-]+)\s*(?:under condition\s+(.*?))?\s*\bthen\b\s*(.*)$/i.exec(raw);
  if (!head) return null;
  const body = head[4];
  let conds = head[3] || '';

  // §16: the inline clause sits immediately before the `then` it belongs to.
  let ruleRoles = null;
  const ra = AUTHORIZED.exec(conds);
  if (ra) { ruleRoles = roleList(ra[1]); conds = conds.slice(0, ra.index); }

  const splitCons = (s) => (s || '').split(CONSEQUENT_SPLIT).map((x) => x.trim().replace(/[,;.]$/, '')).filter(Boolean);
  const branches = [];
  const branched = /^when\s/i.test(body);
  if (branched) {
    for (const part of body.split(/\s+otherwise\s+/i)) {
      const seg = part.trim();
      const w = /^when\s+(.*)$/i.exec(seg);
      if (!w) { branches.push({ guard: null, armRoles: null, consequents: splitCons(seg) }); continue; }
      // §14: `then` inside an arm is required — it is what separates conditions from consequents.
      const at = w[1].search(/\bthen\b/i);
      if (at < 0) return null;
      let armConds = w[1].slice(0, at);
      const cons = w[1].slice(at).replace(/^then\b/i, '');
      let armRoles = null;
      const aa = AUTHORIZED.exec(armConds);
      if (aa) { armRoles = roleList(aa[1]); armConds = armConds.slice(0, aa.index); }
      branches.push({ guard: splitConditionList(armConds), armRoles, consequents: splitCons(cons) });
    }
    // §14: the default arm must be last.
    const defaultAt = branches.findIndex((b) => b.guard === null);
    if (defaultAt >= 0 && defaultAt !== branches.length - 1) return null;
  } else {
    branches.push({ guard: null, armRoles: null, consequents: splitCons(body) });
  }
  return { op: head[1].toLowerCase(), entity: head[2], conditions: splitConditionList(conds), branches, ruleRoles, branched };
}

/** `Create posting as "revenue" with a 1 with b from x.y` -> parts. */
function shapeConsequent(text) {
  const m = /^(Create|Update|Delete)\s+([a-z0-9-]+)\s*(?:as\s+"([a-z0-9-]+)")?\s*(.*)$/i.exec(text);
  if (!m) return null;
  const clauses = [];
  const rest = m[4] || '';
  for (const c of rest.split(/\s+(?=with\s)/i)) {
    if (!c.trim()) continue;
    const w = /^with\s+([+-]?)([a-z0-9-]+)(?:\s+from\s+([a-z0-9.-]+)|\s+(.+))?$/i.exec(c.trim());
    if (!w) { clauses.push({ bad: c.trim() }); continue; }
    clauses.push({ sign: w[1] || '', field: w[2], from: w[3] || null, value: w[4] || null });
  }
  return { verb: m[1].toLowerCase(), entity: m[2], as: m[3] || null, clauses };
}

const AGG = /^(?:sum of\s+([a-z0-9-]+)\s+over|count of)\s+([a-z0-9-]+)(?:\s+for this\s+([a-z0-9-]+))?(?:\s+where\s+(.+?))?$/i;
const AGG_START = /\b(?:sum of|count of)\b/gi;
const OPERATORS = ['not exists', 'exists', 'is not', '>=', '<=', '!=', 'is', '>', '<', '='];

/**
 * Split a condition list on the top-level `and`. An `and` inside an aggregation's `where` clause is
 * not top level, so a body containing `sum of`/`count of` is one condition: every aggregation in
 * this model appears as one side of one comparison, which `splitAggComparison` then takes apart.
 */
function splitConditionList(body) {
  if (/\b(?:sum of|count of)\b/i.test(body)) return [body.trim()];
  return body.split(/\s+and\s+/i).map((x) => x.trim().replace(/[,;.]$/, '')).filter(Boolean);
}

/**
 * `A = sum of x over E where p and q` or `sum of … where p and q = sum of … where r and s`.
 * The comparison operator is the one immediately before the aggregation that is *not* the first
 * token of the expression; if the expression opens with a plain path, it is the first operator
 * before the single aggregation.
 */
function splitAggComparison(t) {
  const starts = [...t.matchAll(AGG_START)].map((m) => m.index);
  if (!starts.length) return null;
  const boundary = starts[0] === 0 ? starts[1] : starts[0];
  if (boundary === undefined) return null;
  const before = t.slice(0, boundary);
  // The separating operator is the rightmost one before the aggregation, whichever it is: an `and
  // side is "debit"` filter inside a `where` clause puts an earlier `is` in the way.
  let best = null;
  for (const op of OPERATORS) {
    const needle = ` ${op} `;
    const at = before.lastIndexOf(needle);
    if (at >= 0 && (best === null || at > best.at)) best = { op, at, len: needle.length };
  }
  if (!best) return null;
  return { op: best.op, lhs: t.slice(0, best.at).trim(), rhs: t.slice(best.at + best.len).trim() };
}

/** Classify one condition into an operator comparison, an aggregation, or a named predicate. */
function classify(text) {
  const t = text.trim();
  if (/\b(?:sum of|count of)\b/i.test(t)) {
    // A comparison whose sides are aggregations must be taken apart before AGG's `where (.+)$`
    // swallows the second one.
    const c = splitAggComparison(t);
    if (c) return { kind: 'operator', op: c.op, lhs: c.lhs, rhs: c.rhs };
  }
  const agg = /^(?:sum of|count of)\b/i.test(t) ? AGG.exec(t) : null;
  if (agg) return { kind: 'aggregation', field: agg[1] || null, over: agg[2], forThis: agg[3] || null, where: agg[4] || null };
  for (const op of OPERATORS) {
    const re = new RegExp(`(^|\\s)${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    const m = re.exec(t);
    if (m) return { kind: 'operator', op, lhs: t.slice(0, m.index).trim(), rhs: t.slice(m.index + m[0].length).trim() };
  }
  const parts = t.split(/\s+/);
  if (parts.length < 2) return { kind: 'malformed' };
  let rest = parts.slice(1);
  let negated = false;
  if (rest[0] === 'not') { negated = true; rest = rest.slice(1); }
  return { kind: 'predicate', subject: parts[0], predicate: rest.join(' '), negated };
}

const MODEL = loadModel();

/** Resolve the entity a path root refers to, in the context of `ctx` (an entity def). */
function rootEntity(model, ctx, root) {
  if (root === 'this' || root === ctx.name) return ctx;
  const f = ctx.fields.get(root);
  if (f && f.type === 'reference') return model.entities.get(f.target) || null;
  if (f) return ctx;
  if (model.entities.has(root)) return model.entities.get(root);
  return null;
}

/** Validate one condition against a context entity. Pushes human-readable problems. */
function checkCondition(model, ctx, raw, where, bad, extraRoots = new Set()) {
  const c = classify(raw);
  const fieldOk = (entity, field) => entity && entity.fields.has(field);
  const pathOk = (text) => {
    const t = text.trim();
    if (!t) return false;
    if (MONEY_LITERAL.test(t)) return Money.isMoney(Money.money(t.slice(1, -1)));
    if (/^"[^"]*"$/.test(t)) return true;                        // text literal
    if (/^-?\d+(\.\d+)?$/.test(t)) return true;                  // number literal
    if (t === 'true' || t === 'false') return true;              // boolean literal
    if (t === 'this') return true;
    const [root, hop, ...more] = t.split('.');
    if (more.length) return false;                               // one hop only
    if (extraRoots.has(root) && !hop) return true;
    const owner = rootEntity(model, ctx, root);
    if (!owner) return false;
    if (!hop) return root === 'this' || root === ctx.name || ctx.fields.has(root) || model.entities.has(root);
    return fieldOk(owner, hop);
  };

  if (c.kind === 'malformed') { bad.push(`${where}: unreadable condition "${raw}"`); return; }
  if (c.kind === 'aggregation') {
    const over = model.entities.get(c.over);
    if (!over) { bad.push(`${where}: "sum of/count of … over ${c.over}" has no information/${c.over}.md`); return; }
    if (c.field) {
      const f = over.fields.get(c.field);
      if (!f) bad.push(`${where}: "${c.field}" is not a field of ${c.over}`);
      else if (f.type !== 'number' && f.type !== 'money') {
        bad.push(`${where}: "sum of ${c.field}" needs a number or money field; ${c.over}.${c.field} is ${f.type}`);
      }
    }
    // grammar §13.2: `for this <entity>` links to the outer document, and only by reference.
    if (c.forThis) {
      if (c.forThis !== ctx.name) {
        bad.push(`${where}: "for this ${c.forThis}" needs the context entity to be ${c.forThis}, and it is ${ctx.name}`);
      }
      const links = [...over.fields].filter(([, f]) => f.type === 'reference' && f.target === c.forThis);
      if (links.length !== 1) {
        bad.push(`${where}: "for this ${c.forThis}" needs exactly one "reference to ${c.forThis}" field on ${c.over}, found ${links.length}`);
      }
    }
    // grammar §13.1: exactly one `where`, on a direct scalar field, compared with a literal.
    if (c.where) {
      if (/\s+and\s+/i.test(c.where)) bad.push(`${where}: a "where" takes exactly one condition (grammar §13.1): "${c.where}"`);
      const ic = classify(c.where);
      if (ic.kind !== 'operator') { bad.push(`${where}: "where ${c.where}" is not a comparison`); return; }
      const fname = ic.lhs.trim();
      if (fname.includes('.')) bad.push(`${where}: "where ${c.where}" uses a path; a where takes a direct field`);
      else if (!over.fields.has(fname)) bad.push(`${where}: "where ${c.where}" names "${fname}", not a field of ${c.over}`);
      if (ic.op !== 'exists' && ic.op !== 'not exists') {
        const r = ic.rhs.trim();
        const literal = /^"[^"]*"$/.test(r) || /^-?\d+(\.\d+)?$/.test(r) || r === 'true' || r === 'false'
          || MONEY_LITERAL.test(r) || /^-?\d+\.\d+\s[A-Z]{3}$/.test(r);
        if (!literal) bad.push(`${where}: "where ${c.where}" compares with "${r}", which is not a literal (grammar §13.1)`);
      }
    }
    if (!c.forThis && !c.where) {
      // legal, but it reads the whole entity on every evaluation (§13.3). Not an error.
    }
    return;
  }
  if (c.kind === 'operator') {
    // An aggregation may appear on either side of a comparison.
    const sides = (c.op === 'exists' || c.op === 'not exists') ? [c.lhs] : [c.lhs, c.rhs];
    for (const side of sides) {
      const t = side.trim();
      if (AGG.test(t)) { checkCondition(model, ctx, t, where, bad, extraRoots); continue; }
      if (!pathOk(t)) bad.push(`${where}: "${t}" in "${raw}" is neither a declared path nor a literal`);
    }
    return;
  }
  // grammar §2.2: a bare predicate name in a body references a sibling predicate of this entity.
  const bare = raw.trim();
  if (ctx.predicates.has(bare)) return;
  if (bare.startsWith('not ') && ctx.predicates.has(bare.slice(4))) return;
  const owner = rootEntity(model, ctx, c.subject);
  if (!owner) { bad.push(`${where}: "${c.subject}" in "${raw}" is neither a field of ${ctx.name} nor an entity`); return; }
  if (owner.predicates.has(c.predicate)) return;
  if (c.negated && owner.predicates.has(`not ${c.predicate}`)) return;
  bad.push(`${where}: predicate "${c.predicate}" is not declared in ${owner.file}`);
}

// ---------------------------------------------------------------------------------------------
// The chart-of-accounts seeds, parsed from the tables a bookkeeper reads.
// ---------------------------------------------------------------------------------------------

const CHART_COLUMNS = ['account-number', 'name', 'account-type', 'normal-balance', 'statement-section',
  'vat-role', 'vat-kennzahl', 'vat-rate-percent', 'reconciliation-account-for', 'manual', 'source'];

function parseTable(file, expectedHeader) {
  const text = readFileSync(join(OM, 'information', file), 'utf8');
  const rows = [];
  let header = null;
  let found = null;
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) { if (header && rows.length) header = null; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (/^-+$/.test(cells[0].replace(/[^-]/g, '-')) && cells.every((c) => /^-*$/.test(c))) continue;
    if (!header) {
      if (cells[0] === expectedHeader[0] && cells.length === expectedHeader.length) { header = cells; found = cells; }
      continue;
    }
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    rows.push(row);
  }
  return { header: found, rows };
}

const CHARTS = {
  skr03: parseTable('_chart-skr03.md', CHART_COLUMNS),
  skr04: parseTable('_chart-skr04.md', CHART_COLUMNS),
  international: parseTable('_chart-international.md', CHART_COLUMNS),
};

const POSITION_COLUMNS = ['position-code', 'caption', 'statement', 'section', 'position', 'level',
  'parent-position-code', 'legal-reference', 'account-range-from', 'account-range-to',
  'included-accounts', 'normal-balance', 'is-subtotal'];
const POSITIONS = parseTable('_statement-positions.md', POSITION_COLUMNS);

// ---------------------------------------------------------------------------------------------
// A tiny world, and an evaluator for the declared invariants.
// ---------------------------------------------------------------------------------------------

/**
 * Evaluate one declared invariant body against a document. Supports exactly the constructs the
 * ledger model uses: field-to-field and field-to-literal comparisons over money / number / text /
 * date, one-hop paths, named predicates on referenced documents (with `not`), and
 * `sum of … over … where …` / `count of … where …` correlated with `this`.
 */
function evaluateCondition(world, model, entityName, doc, raw) {
  const def = model.entities.get(entityName);
  const c = classify(raw);

  const readPath = (t) => {
    t = t.trim();
    if (MONEY_LITERAL.test(t)) return { money: Money.money(t.slice(1, -1)) };
    if (/^"([^"]*)"$/.test(t)) return { text: t.slice(1, -1) };
    if (/^-?\d+(\.\d+)?$/.test(t)) return { number: Number(t) };
    if (t === 'true') return { text: true };
    if (t === 'false') return { text: false };
    if (AGG.test(t)) {
      const a = aggregate(t);
      return (a && a.count !== undefined) ? { count: a.count } : { money: a };
    }
    const [root, hop] = t.split('.');
    let target = doc;
    let tdef = def;
    if (hop) {
      const f = def.fields.get(root);
      if (!f || f.type !== 'reference') throw new Error(`not a reference field: ${root}`);
      target = (world[f.target] || {})[doc[root]];
      tdef = model.entities.get(f.target);
      if (!target) return { missing: true };
      return typed(tdef, hop, target[hop]);
    }
    return typed(tdef, root, target[root]);
  };

  const typed = (tdef, field, value) => {
    const f = tdef.fields.get(field);
    if (value === undefined || value === null || value === '') return { missing: true };
    if (f && f.type === 'money') return { money: Money.money(value) };
    if (f && f.type === 'number') return { number: value };
    return { text: value };
  };

  function aggregate(t) {
    const c = classify(t);
    const overDef = model.entities.get(c.over);
    let docs = Object.values(world[c.over] || {});
    if (c.forThis) {
      const [linkField] = [...overDef.fields].find(([, f]) => f.type === 'reference' && f.target === c.forThis);
      docs = docs.filter((d) => String(d[linkField]) === String(doc.__id));
    }
    if (c.where) {
      const f = classify(c.where);
      docs = docs.filter((d) => {
        const left = d[f.lhs.trim()];
        if (f.op === 'exists') return left !== undefined && left !== null && left !== '';
        if (f.op === 'not exists') return left === undefined || left === null || left === '';
        const r = f.rhs.trim();
        const right = /^"([^"]*)"$/.test(r) ? r.slice(1, -1)
          : (/^-?\d+(\.\d+)?$/.test(r) ? Number(r) : r);
        switch (f.op) {
          case 'is': case '=': return String(left) === String(right);
          case 'is not': case '!=': return String(left) !== String(right);
          default: throw new Error(`where operator not supported: ${f.op}`);
        }
      });
    }
    if (!c.field) return { count: docs.length };
    const fdef = overDef.fields.get(c.field);
    docs = docs.slice().sort();
    if (fdef && fdef.type === 'money') return sum(docs.map((h) => Money.money(h[c.field])));
    return { count: docs.reduce((a, h) => a + (h[c.field] || 0), 0) };
  }

  if (c.kind === 'aggregation') throw new Error('a bare aggregation is not a condition');

  if (c.kind === 'predicate') {
    const bare = raw.trim();
    const selfP = def.predicates.get(bare)
      || (bare.startsWith('not ') ? def.predicates.get(bare.slice(4)) : null);
    if (selfP && !def.fields.has(c.subject)) {
      const inner = splitConditionList(selfP.body)
        .every((b) => evaluateCondition(world, model, entityName, doc, b.trim()));
      return bare.startsWith('not ') && !def.predicates.has(bare) ? !inner : inner;
    }
    const f = def.fields.get(c.subject);
    let ownerDef = def;
    let target = doc;
    if (f && f.type === 'reference') {
      ownerDef = model.entities.get(f.target);
      target = (world[f.target] || {})[doc[c.subject]];
      if (!target) return false;                       // grammar §4.5: no truth value, not satisfied
    } else if (c.subject !== entityName && !f) {
      return false;
    }
    const p = ownerDef.predicates.get(c.predicate) || ownerDef.predicates.get(`not ${c.predicate}`);
    if (!p) throw new Error(`predicate not declared: ${c.subject} ${c.predicate}`);
    const inner = splitConditionList(p.body)
      .every((b) => evaluateCondition(world, model, ownerDef.name, target, b.trim()));
    return c.negated ? !inner : inner;
  }

  const L = readPath(c.lhs);
  if (c.op === 'exists') return !L.missing;
  if (c.op === 'not exists') return !!L.missing;
  const R = readPath(c.rhs);
  if (L.missing || R.missing) return false;            // grammar §4.5

  const cmp = () => {
    if (L.money !== undefined && R.money !== undefined) {
      if (L.money.count !== undefined || R.money.count !== undefined) {
        return Number(L.money.count ?? 0) - Number(R.money.count ?? 0);
      }
      return Money.compare(L.money, R.money);
    }
    if (L.money !== undefined && R.count !== undefined) throw new Error('money vs count');
    if (L.count !== undefined || R.count !== undefined) {
      const a = L.count !== undefined ? L.count : (L.number ?? Number(L.text));
      const b = R.count !== undefined ? R.count : (R.number ?? Number(R.text));
      return a - b;
    }
    if (L.number !== undefined || R.number !== undefined) {
      const a = L.number !== undefined ? L.number : Number(L.text);
      const b = R.number !== undefined ? R.number : Number(R.text);
      return a - b;
    }
    return String(L.text) === String(R.text) ? 0 : 1;
  };
  switch (c.op) {
    case 'is': case '=': return cmp() === 0;
    case 'is not': case '!=': return cmp() !== 0;
    case '>': return cmp() > 0;
    case '>=': return cmp() >= 0;
    case '<': return cmp() < 0;
    case '<=': return cmp() <= 0;
    default: throw new Error(`operator not supported: ${c.op}`);
  }
}

/**
 * Check every declared invariant of `entityName` on the documents a commit touches.
 *
 * `touched` is the set of ids the commit creates or changes; omit it to check all of them. That
 * distinction is not decoration: `the period is not locked` on a journal entry means *this entry
 * may not be written while its period is locked*, not *every entry in a locked period is invalid*.
 * If invariants were re-evaluated over the whole repository on every commit, locking a month would
 * invalidate every entry inside it, and the close would be impossible. See the note under
 * "When an invariant is checked" in `information/journal-entry.md`.
 */
function checkInvariants(world, model, entityName, touched = null) {
  const def = model.entities.get(entityName);
  const out = [];
  for (const [id, doc] of Object.entries(world[entityName] || {})) {
    if (touched && !touched.includes(id)) continue;
    for (const [name, inv] of def.invariants) {
      const holds = splitConditionList(inv.body)
        .every((b) => evaluateCondition(world, model, entityName, { ...doc, __id: id }, b.trim()));
      if (!holds) out.push({ entity: entityName, id, invariant: name, body: inv.body, file: inv.file, line: inv.line });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The worked month. Fictional companies only; no personal data anywhere.
// ---------------------------------------------------------------------------------------------

const PERIOD = '2026-07';
const NEXT_PERIOD = '2026-08';

const CHART_DOC = {
  name: 'skr03', standard: 'skr03', 'display-name': 'DATEV SKR03', 'ledger-currency': 'EUR',
  'rounding-rule': 'per-document', 'rounding-mode': 'half-up', 'fiscal-year-start-month': 1,
  'receivables-account-number': '1400', 'payables-account-number': '1600',
  'bank-account-number': '1200', 'inventory-account-number': '3980',
  'inventory-change-account-number': '3960', 'write-off-account-number': '4855',
  'fx-loss-account-number': '4840', 'fx-gain-account-number': '2660',
  'vat-prepayment-account-number': '1780', 'retained-earnings-account-number': '0868',
  'opening-balance-account-number': '9000', 'adopted-on': '2026-01-01', status: 'active',
  // The account references, filled in by processes/chart-of-accounts-adoption.md once the account
  // documents exist. `with ledger-account from chart.receivables-account` copies the id (§17.1).
  'receivables-account': 'skr03-1400', 'payables-account': 'skr03-1600',
  'bank-account': 'skr03-1200', 'inventory-account': 'skr03-3980',
  'inventory-change-account': 'skr03-3960', 'write-off-account': 'skr03-4855',
  'fx-loss-account': 'skr03-4840', 'fx-gain-account': 'skr03-2660',
  'vat-prepayment-account': 'skr03-1780', 'retained-earnings-account': 'skr03-0868',
  'opening-balance-account': 'skr03-9000',
};

/** One posting: [account, side, amount, kennzahl, vat-role, extras] */
const ENTRIES = [
  ['JE-2026-0001', 'opening-balance', '2026-07-01', PERIOD, [
    ['1200', 'debit', '50000.00 EUR'], ['0800', 'credit', '50000.00 EUR'],
  ]],
  ['JE-2026-0002', 'sales-invoice', '2026-07-05', PERIOD, [
    ['1400', 'debit', '5949.99 EUR'],
    ['8400', 'credit', '4999.99 EUR', '81', 'taxable-turnover'],
    ['1776', 'credit', '950.00 EUR', '81', 'output-tax', { 'tax-base-amount': '4999.99 EUR', 'vat-rate-percent': 19 }],
  ]],
  ['JE-2026-0003', 'incoming-payment', '2026-07-15', PERIOD, [
    ['1200', 'debit', '5949.99 EUR'], ['1400', 'credit', '5949.99 EUR'],
  ]],
  ['JE-2026-0004', 'supplier-invoice', '2026-07-08', PERIOD, [
    ['3425', 'debit', '12000.00 EUR', '89', 'acquisition-turnover'],
    ['1600', 'credit', '12000.00 EUR'],
    ['1772', 'credit', '2280.00 EUR', '89', 'output-tax', { 'tax-base-amount': '12000.00 EUR', 'vat-rate-percent': 19 }],
    ['1574', 'debit', '2280.00 EUR', '61', 'input-tax', { 'tax-base-amount': '12000.00 EUR', 'vat-rate-percent': 19 }],
  ]],
  ['JE-2026-0005', 'goods-receipt', '2026-07-09', PERIOD, [
    ['3980', 'debit', '12000.00 EUR'], ['3960', 'credit', '12000.00 EUR'],
  ]],
  ['JE-2026-0006', 'stock-adjustment', '2026-07-20', PERIOD, [
    ['4855', 'debit', '300.00 EUR'], ['3980', 'credit', '300.00 EUR'],
  ]],
  ['JE-2026-0007', 'sales-invoice', '2026-07-22', PERIOD, [
    ['1400', 'debit', '600.00 EUR'],
    ['8336', 'credit', '500.00 EUR', '45', 'non-taxable-turnover'],
    ['1791', 'credit', '100.00 EUR', '', 'output-tax', { 'tax-base-amount': '500.00 EUR', 'vat-rate-percent': 20 }],
  ]],
  ['JE-2026-0008', 'sales-invoice', '2026-07-20', PERIOD, [
    ['1400', 'debit', '10500.00 EUR', '', 'none', { 'original-currency': 'CHF', 'original-amount': '10000.00 CHF', 'exchange-rate': 'CHF-EUR-2026-07-20-bookkeeping' }],
    ['8120', 'credit', '10500.00 EUR', '43', 'exempt-turnover'],
  ]],
  ['JE-2026-0009', 'incoming-payment', '2026-07-28', PERIOD, [
    ['1200', 'debit', '10300.00 EUR', '', 'none', { 'original-currency': 'CHF', 'original-amount': '10000.00 CHF', 'exchange-rate': 'CHF-EUR-2026-07-28-bookkeeping' }],
    ['4840', 'debit', '200.00 EUR', '', 'none', { 'exchange-rate': 'CHF-EUR-2026-07-28-bookkeeping' }],
    ['1400', 'credit', '10500.00 EUR'],
  ]],
];

/** The August correction of the July write-off: 300.00 booked, 250.00 correct. */
const CORRECTION = ['JE-2026-0010', 'stock-adjustment', '2026-08-03', NEXT_PERIOD, [
  ['3980', 'debit', '50.00 EUR'], ['4855', 'credit', '50.00 EUR'],
], { corrects: 'JE-2026-0006', 'correction-reason': 'Write-off booked at 300.00 EUR; the counted loss was 250.00 EUR.' }];

function buildWorld(entrySpecs, periodStatus = { [PERIOD]: 'open', [NEXT_PERIOD]: 'open' }) {
  const accounts = {};
  for (const row of CHARTS.skr03.rows) {
    accounts[`skr03-${row['account-number']}`] = {
      'account-number': row['account-number'], name: row.name, chart: 'skr03',
      'account-type': row['account-type'], 'normal-balance': row['normal-balance'],
      'statement-section': row['statement-section'], 'vat-kennzahl': row['vat-kennzahl'],
      'vat-role': row['vat-role'] || 'none', 'vat-rate-percent': row['vat-rate-percent'] === '' ? '' : Number(row['vat-rate-percent']),
      'reconciliation-account-for': row['reconciliation-account-for'],
      'blocked-for-manual-posting': row.manual === 'true', 'account-source': row.source,
      'opened-on': '2026-01-01', status: 'active',
    };
  }
  const periods = {};
  for (const [key, status] of Object.entries(periodStatus)) {
    periods[key] = {
      'period-key': key, 'fiscal-year': 2026, month: Number(key.slice(5)),
      'from-date': `${key}-01`, 'to-date': key === PERIOD ? '2026-07-31' : '2026-08-31',
      chart: 'skr03', status, 'vat-return-filed': status === 'locked', 'trial-balance-agreed': status === 'locked',
      'bank-reconciled': status === 'locked', 'carried-forward': status === 'locked',
      'locked-on': status === 'locked' ? '2026-08-10' : '', 'locked-by': status === 'locked' ? 'employee-controller-1' : '',
    };
  }
  const rates = {
    'CHF-EUR-2026-07-20-bookkeeping': { 'from-currency': 'CHF', 'to-currency': 'EUR', 'rate-date': '2026-07-20', rate: '1.0500', source: 'ecb-reference', 'source-reference': 'ECB daily reference 2026-07-20', purpose: 'bookkeeping', 'captured-by': 'employee-treasurer-1', 'captured-on': '2026-07-20', status: 'active' },
    'CHF-EUR-2026-07-28-bookkeeping': { 'from-currency': 'CHF', 'to-currency': 'EUR', 'rate-date': '2026-07-28', rate: '1.0300', source: 'ecb-reference', 'source-reference': 'ECB daily reference 2026-07-28', purpose: 'bookkeeping', 'captured-by': 'employee-treasurer-1', 'captured-on': '2026-07-28', status: 'active' },
  };

  const journal = {};
  const postings = {};
  for (const spec of entrySpecs) {
    const [id, kind, date, period, lines, extra = {}] = spec;
    const debits = sum(lines.filter((l) => l[1] === 'debit').map((l) => eur(l[2])));
    const credits = sum(lines.filter((l) => l[1] === 'credit').map((l) => eur(l[2])));
    journal[id] = {
      'entry-number': id, 'entry-date': date, 'document-date': date, 'accounting-period': period,
      chart: 'skr03', currency: 'EUR', 'debit-amount': str(debits), 'credit-amount': str(credits),
      'posting-count': lines.length, description: `${kind} ${id}`, 'source-document-type': kind,
      'source-document-reference': id, reversal: false, status: 'posted',
      'entered-by': 'employee-accountant-1', 'posted-by': 'employee-accountant-1', 'posted-at': date,
      ...extra,
    };
    lines.forEach((l, i) => {
      const [acct, side, amount, kz = '', role = 'none', more = {}] = l;
      postings[`${id}-${i + 1}`] = {
        'journal-entry': id, position: i + 1, 'account-number': acct, chart: 'skr03',
        'ledger-account': `skr03-${acct}`, side, amount, currency: 'EUR', 'posting-date': date,
        'accounting-period': period, description: `${acct} ${side}`, 'source-document-reference': id,
        'vat-kennzahl': kz, 'vat-role': role, ...more,
      };
    });
  }
  return {
    'chart-of-accounts': { skr03: CHART_DOC },
    'ledger-account': accounts,
    'accounting-period': periods,
    'exchange-rate': rates,
    'journal-entry': journal,
    posting: postings,
  };
}

const WORLD = buildWorld(ENTRIES);

/** Debit/credit totals per account for one period, from the postings alone. */
function accountTotals(world, period) {
  const out = new Map();
  for (const p of Object.values(world.posting)) {
    if (p['accounting-period'] !== period) continue;
    if (!out.has(p['account-number'])) out.set(p['account-number'], { debit: ZERO, credit: ZERO });
    const t = out.get(p['account-number']);
    t[p.side] = Money.add(t[p.side], eur(p.amount));
  }
  return out;
}

/** One UStVA line, computed exactly as `information/vat-return.md` declares it. */
function vatLine(world, period, kennzahl, role) {
  return sum(Object.values(world.posting)
    .filter((p) => p['accounting-period'] === period && p['vat-kennzahl'] === kennzahl && p['vat-role'] === role)
    .map((p) => eur(p.amount)));
}

// =============================================================================================
// Tests
// =============================================================================================

const LEDGER_ENTITIES = ['chart-of-accounts', 'ledger-account', 'accounting-period', 'journal-entry',
  'posting', 'number-sequence', 'exchange-rate', 'supplier-invoice', 'payment', 'payment-run',
  'bank-statement', 'bank-statement-line', 'vat-return', 'oss-return', 'trial-balance',
  'financial-statement-line'];
const LEDGER_PROCESSES = ['journal-posting', 'invoice-posting', 'supplier-invoice-posting',
  'period-close', 'journal-correction', 'trial-balance', 'vat-return', 'oss-return', 'payment-run',
  'bank-reconciliation', 'chart-of-accounts-adoption', 'foreign-currency-settlement',
  'financial-statements'];

test('the ledger entities and processes all exist', () => {
  for (const e of LEDGER_ENTITIES) {
    assert.ok(MODEL.entities.has(e), `information/${e}.md is missing`);
  }
  for (const p of LEDGER_PROCESSES) {
    assert.ok(existsSync(join(OM, 'processes', `${p}.md`)), `processes/${p}.md is missing`);
  }
  for (const r of ['accountant', 'controller', 'treasurer', 'tax-accountant', 'auditor', 'managing-director']) {
    assert.ok(MODEL.roles.has(r), `organisation/${r}.md is missing`);
  }
});

test('every file is structurally well formed under grammar version 2', () => {
  assert.deepEqual(MODEL.problems, [], `structural problems:\n  ${MODEL.problems.join('\n  ')}`);
});

test('every entity declares a business key whose fields exist, and its created-on-demand answer', () => {
  const bad = [];
  for (const [, def] of MODEL.entities) {
    if (!def.key.length) bad.push(`${def.file}: no "## Identified by"`);
    for (const k of def.key) if (!def.fields.has(k)) bad.push(`${def.file}: "## Identified by" names "${k}", which is not a declared field`);
  }
  assert.deepEqual(bad, [], `business key problems:\n  ${bad.join('\n  ')}`);
});

test('every rule parses as grammar version 2, with declared entities, fields, predicates and roles', () => {
  const bad = [];
  for (const r of MODEL.rules) {
    const s = shapeV2(r.raw);
    if (!s) { bad.push(`${r.file}:${r.line}: cannot read as a grammar version 2 rule`); continue; }
    if (!OPS.has(s.op)) bad.push(`${r.file}:${r.line}: unknown operation "${s.op}"`);
    const trigger = MODEL.entities.get(s.entity);
    if (!trigger) { bad.push(`${r.file}:${r.line}: trigger "${s.entity}" has no information/${s.entity}.md`); continue; }
    const where = `${r.file}:${r.line}`;

    for (const c of s.conditions) checkCondition(MODEL, trigger, c, where, bad);
    for (const role of (s.ruleRoles || [])) {
      if (!MODEL.roles.has(role)) bad.push(`${where}: rule authority names "${role}", which has no organisation/${role}.md`);
    }
    for (const b of s.branches) for (const role of (b.armRoles || [])) {
      if (!MODEL.roles.has(role)) bad.push(`${where}: arm authority names "${role}", which has no organisation/${role}.md`);
    }
    for (const role of r.fileRoles) {
      if (!MODEL.roles.has(role)) bad.push(`${where}: file authority names "${role}", which has no organisation/${role}.md`);
    }
    if (!s.branches.length) bad.push(`${where}: "then" with no consequents`);

    const seenAs = new Set();
    s.branches.forEach((b, i) => {
      for (const c of (b.guard || [])) checkCondition(MODEL, trigger, c, `${where} branch ${i + 1}`, bad);
      if (!b.consequents.length) bad.push(`${where} branch ${i + 1}: no consequents`);
      for (const raw of b.consequents) {
        const q = shapeConsequent(raw);
        if (!q) { bad.push(`${where}: unreadable consequent "${raw.slice(0, 60)}"`); continue; }
        if (!VERBS.has(q.verb)) bad.push(`${where}: "${q.verb}" is not Create, Update or Delete`);
        const target = MODEL.entities.get(q.entity);
        if (!target) { bad.push(`${where}: consequent entity "${q.entity}" has no information/${q.entity}.md`); continue; }
        if (q.verb === 'create' && q.entity === s.entity && !q.as) {
          bad.push(`${where}: "Create ${q.entity}" would collide with the trigger's own id`);
        }
        if (q.as) {
          const k = `${i}|${q.entity}|${q.as}`;
          if (seenAs.has(k)) bad.push(`${where}: two consequents create ${q.entity} as "${q.as}" in one branch`);
          seenAs.add(k);
        }
        for (const cl of q.clauses) {
          if (cl.bad) { bad.push(`${where}: unreadable with-clause "${cl.bad.slice(0, 50)}"`); continue; }
          if (!target.fields.has(cl.field)) {
            bad.push(`${where}: "with ${cl.sign}${cl.field}" names a field ${q.entity} does not declare`);
          }
          if (cl.sign && !trigger.fields.has(cl.field)) {
            bad.push(`${where}: counter "with ${cl.sign}${cl.field}" needs a "${cl.field}" field on ${s.entity}`);
          }
          if (cl.from) {
            const [root, hop] = cl.from.split('.');
            const owner = rootEntity(MODEL, trigger, root);
            if (!owner) bad.push(`${where}: "from ${cl.from}" root "${root}" is not a field of ${s.entity}`);
            else if (hop && !owner.fields.has(hop)) bad.push(`${where}: "from ${cl.from}" — ${owner.name} has no field "${hop}"`);
            else if (!hop && !trigger.fields.has(root)) bad.push(`${where}: "from ${root}" is not a field of ${s.entity}`);
          }
          if (cl.value && /^"/.test(cl.value) && MONEY_LITERAL.test(cl.value)) {
            assert.doesNotThrow(() => Money.money(cl.value.slice(1, -1)), `${where}: bad money literal`);
          }
          const fd = target.fields.get(cl.field);
          if (fd && fd.type === 'enum' && cl.value && /^"([a-z0-9-]+)"$/.test(cl.value)) {
            const v = cl.value.slice(1, -1);
            if (!fd.values.includes(v)) {
              bad.push(`${where}: "with ${cl.field} "${v}"" is not one of ${fd.values.join(', ')} (${target.file}:${fd.line})`);
            }
          }
        }
      }
    });
  }
  assert.deepEqual(bad, [], `rule problems:\n  ${bad.join('\n  ')}`);
});

test('every declared invariant and predicate body resolves against its own entity', () => {
  const bad = [];
  for (const [name, def] of MODEL.entities) {
    for (const [pname, p] of [...def.invariants, ...def.predicates]) {
      for (const raw of splitConditionList(p.body)) {
        checkCondition(MODEL, def, raw.trim(), `${p.file}:${p.line} ("${pname}")`, bad);
      }
    }
    void name;
  }
  assert.deepEqual(bad, [], `invariant / predicate body problems:\n  ${bad.join('\n  ')}`);
});

test('every money literal anywhere in the ledger model is in FD-1 canonical form', () => {
  const bad = [];
  for (const p of [...MODEL.files, ...MODEL.docFiles]) {
    const text = readFileSync(p, 'utf8');
    // Only inside runtime sections and rule text; prose may write "5,949.99".
    for (const m of text.matchAll(/"(-?[\d.,]+\s+[A-Z]{3})"/g)) {
      try { Money.money(m[1]); } catch (e) { bad.push(`${relative(REPO, p)}: "${m[1]}" — ${e.message}`); }
    }
  }
  assert.deepEqual(bad, [], `non-canonical money literals:\n  ${bad.join('\n  ')}`);
});

test('the chart seeds parse, and every column value is one the entity declares', () => {
  const acct = MODEL.entities.get('ledger-account');
  const enumOf = (f) => acct.fields.get(f).values;
  const bad = [];
  for (const [chart, table] of Object.entries(CHARTS)) {
    assert.ok(table.header, `${chart}: no table with the expected header`);
    assert.ok(table.rows.length > 0, `${chart}: no rows`);
    const seen = new Set();
    for (const row of table.rows) {
      const at = `${chart} ${row['account-number']}`;
      if (!/^\d{4}$/.test(row['account-number'])) bad.push(`${at}: account number is not four digits`);
      if (seen.has(row['account-number'])) bad.push(`${at}: duplicate account number`);
      seen.add(row['account-number']);
      if (!row.name) bad.push(`${at}: no name`);
      for (const [col, field] of [['account-type', 'account-type'], ['normal-balance', 'normal-balance'],
        ['statement-section', 'statement-section'], ['vat-role', 'vat-role'],
        ['reconciliation-account-for', 'reconciliation-account-for'], ['source', 'account-source']]) {
        if (!enumOf(field).includes(row[col])) bad.push(`${at}: ${col} "${row[col]}" is not one of ${enumOf(field).join(', ')}`);
      }
      if (!['true', 'false'].includes(row.manual)) bad.push(`${at}: manual is "${row.manual}", not true or false`);
      if (row['vat-kennzahl'] && !/^\d{2}$/.test(row['vat-kennzahl'])) bad.push(`${at}: vat-kennzahl "${row['vat-kennzahl']}" is not two digits`);
      if (row['vat-rate-percent'] && !/^\d+$/.test(row['vat-rate-percent'])) bad.push(`${at}: vat-rate-percent "${row['vat-rate-percent']}" is not a whole number`);
    }
  }
  assert.deepEqual(bad, [], `chart seed problems:\n  ${bad.join('\n  ')}`);
  assert.equal(CHARTS.skr03.rows.length, 34, 'SKR03 seed should hold 34 accounts');
  assert.equal(CHARTS.skr04.rows.length, 34, 'SKR04 seed should hold 34 accounts');
  assert.equal(CHARTS.international.rows.length, 13, 'the international seed should hold 13 accounts');
});

test('SKR03 and SKR04 cover the same ground, and both keep control accounts off manual posting', () => {
  const byPurpose = (rows) => rows.map((r) => `${r['account-type']}|${r['statement-section']}|${r['vat-role']}|${r['reconciliation-account-for']}|${r['vat-kennzahl']}|${r.manual}`).sort();
  assert.deepEqual(byPurpose(CHARTS.skr03.rows), byPurpose(CHARTS.skr04.rows),
    'SKR03 and SKR04 seeds must describe the same set of account purposes');

  const bad = [];
  for (const [chart, table] of Object.entries(CHARTS)) {
    for (const row of table.rows) {
      const isControl = row['reconciliation-account-for'] !== 'none';
      const isVat = row['vat-role'] === 'output-tax' || row['vat-role'] === 'input-tax';
      if ((isControl || isVat) && row.manual !== 'true') {
        bad.push(`${chart} ${row['account-number']} ${row.name}: a control or VAT account must be blocked for manual posting`);
      }
    }
  }
  assert.deepEqual(bad, [], `manual-posting problems:\n  ${bad.join('\n  ')}`);
});

test('every SKR03 account maps to exactly one leaf statement position', () => {
  const leaves = POSITIONS.rows.filter((r) => r['is-subtotal'] === 'false');
  assert.ok(leaves.length >= 10, `only ${leaves.length} leaf positions`);
  const bad = [];
  for (const row of CHARTS.skr03.rows) {
    const n = row['account-number'];
    const hits = leaves.filter((pos) => {
      const inRange = pos['account-range-from'] && n >= pos['account-range-from'] && n <= pos['account-range-to'];
      const included = (pos['included-accounts'] || '').split(',').map((x) => x.trim()).includes(n);
      return inRange || included;
    });
    if (hits.length === 0) bad.push(`${n} ${row.name}: no statement position`);
    if (hits.length > 1) bad.push(`${n} ${row.name}: mapped to ${hits.map((h) => h['position-code']).join(' and ')}`);
  }
  assert.deepEqual(bad, [], `statement mapping problems:\n  ${bad.join('\n  ')}`);
  for (const pos of POSITIONS.rows) {
    assert.match(pos['legal-reference'], /§ (266|275)/, `${pos['position-code']}: no HGB reference`);
  }
});

test('the sales branch quoted in invoice-posting.md is byte-identical to the live rule', () => {
  const master = readFileSync(join(OM, 'processes', 'journal-posting.md'), 'utf8');
  const quoted = readFileSync(join(OM, 'processes', 'invoice-posting.md'), 'utf8');
  const block = /```\n( {2}when journal-entry from a sales invoice[\s\S]*?)```/.exec(quoted);
  assert.ok(block, 'invoice-posting.md has no quoted rule block');
  assert.ok(master.includes(block[1]),
    'the block quoted in invoice-posting.md is not present verbatim in journal-posting.md');
});

test('the purchase branches quoted in supplier-invoice-posting.md are byte-identical to the live rule', () => {
  const master = readFileSync(join(OM, 'processes', 'journal-posting.md'), 'utf8');
  const quoted = readFileSync(join(OM, 'processes', 'supplier-invoice-posting.md'), 'utf8');
  const block = /```\n( {2}otherwise when journal-entry from a supplier invoice[\s\S]*?)```/.exec(quoted);
  assert.ok(block, 'supplier-invoice-posting.md has no quoted rule block');
  assert.ok(master.includes(block[1]),
    'the block quoted in supplier-invoice-posting.md is not present verbatim in journal-posting.md');
});

test('the posting rule names no account number — account determination is data', () => {
  const text = readFileSync(join(OM, 'processes', 'journal-posting.md'), 'utf8');
  const rules = /## Rules\n([\s\S]*?)\n## Notes/.exec(text);
  assert.ok(rules, 'journal-posting.md has no ## Rules section');
  const literals = [...rules[1].matchAll(/"(\d{4})"/g)].map((m) => m[1]);
  assert.deepEqual(literals, [], `the posting rule hard-codes account numbers: ${literals.join(', ')}`);
});

// ---------------------------------------------------------------------------- the invariants

test('the balance invariant is one sentence, an aggregation over the entry\'s own postings', () => {
  const je = MODEL.entities.get('journal-entry');
  assert.equal(je.invariants.get('debits equal credits').body,
    'sum of amount over posting for this journal-entry where side is "debit"'
    + ' = sum of amount over posting for this journal-entry where side is "credit"');
  // The header totals stay pinned to the postings as well: a set can balance while the header lies,
  // and the header is what the journal printout, the DATEV export and `git show` display.
  assert.equal(je.invariants.get('the debit total agrees with the postings').body,
    'debit-amount = sum of amount over posting for this journal-entry where side is "debit"');
  assert.equal(je.invariants.get('the credit total agrees with the postings').body,
    'credit-amount = sum of amount over posting for this journal-entry where side is "credit"');
  assert.equal(je.invariants.get('the posting count agrees with the postings').body,
    'posting-count = count of posting for this journal-entry');
  assert.ok(je.invariants.has('an entry has at least two postings'));
  assert.ok(je.invariants.has('the period is not locked'));
  assert.equal(je.invariants.size, 7, 'journal-entry should declare seven invariants');

  // And the lock is declared on both sides of grammar §18.
  assert.deepEqual(je.datedIn, [{ field: 'entry-date', period: 'accounting-period' }]);
  assert.deepEqual(MODEL.entities.get('posting').datedIn, [{ field: 'posting-date', period: 'accounting-period' }]);
  assert.deepEqual(MODEL.entities.get('accounting-period').period,
    { from: 'from-date', to: 'to-date', 'locked when': 'status is "locked"' });
});

test('every journal entry in the worked month satisfies every declared invariant', () => {
  const v = checkInvariants(WORLD, MODEL, 'journal-entry');
  assert.deepEqual(v, [], `invariant violations:\n  ${v.map((x) => `${x.id}: ${x.invariant}`).join('\n  ')}`);
  const p = checkInvariants(WORLD, MODEL, 'posting');
  assert.deepEqual(p, [], `posting invariant violations:\n  ${p.map((x) => `${x.id}: ${x.invariant}`).join('\n  ')}`);
  assert.equal(Object.keys(WORLD['journal-entry']).length, 9);
  assert.equal(Object.keys(WORLD.posting).length, 23);
});

test('an unbalanced journal entry is refused both ways round, quoting the invariant', () => {
  // The classic VAT rounding slip: 19 % of 4,999.99 booked as 949.99 instead of 950.00.
  const lines = [
    ['1400', 'debit', '5949.99 EUR'],
    ['8400', 'credit', '4999.99 EUR', '81', 'taxable-turnover'],
    ['1776', 'credit', '949.99 EUR', '81', 'output-tax'],
  ];

  // (a) The header is honest about both sides, so the header totals differ.
  const honest = buildWorld([['JE-2026-9001', 'sales-invoice', '2026-07-05', PERIOD, lines]]);
  const a = checkInvariants(honest, MODEL, 'journal-entry', ['JE-2026-9001']);
  const aNames = a.map((x) => x.invariant);
  assert.ok(aNames.includes('debits equal credits'),
    `expected "debits equal credits" to be violated, got: ${aNames.join(', ') || '(none)'}`);
  const first = a.find((x) => x.invariant === 'debits equal credits');
  assert.equal(first.file, 'operating-model/information/journal-entry.md');
  assert.ok(first.line > 0);
  assert.match(first.body, /^sum of amount over posting for this journal-entry where side is "debit"/);

  // (b) The header claims both sides are 5,949.99, which is what a dishonest caller would write.
  //     Now the aggregation invariant catches it instead. There is no third option.
  const lying = buildWorld([['JE-2026-9002', 'sales-invoice', '2026-07-05', PERIOD, lines]]);
  lying['journal-entry']['JE-2026-9002']['debit-amount'] = '5949.99 EUR';
  lying['journal-entry']['JE-2026-9002']['credit-amount'] = '5949.99 EUR';
  const b = checkInvariants(lying, MODEL, 'journal-entry', ['JE-2026-9002']);
  const bNames = b.map((x) => x.invariant);
  assert.ok(bNames.includes('the credit total agrees with the postings'),
    `expected the aggregation invariant to catch a lying header, got: ${bNames.join(', ') || '(none)'}`);
  assert.equal(b.find((x) => x.invariant === 'the credit total agrees with the postings').body,
    'credit-amount = sum of amount over posting for this journal-entry where side is "credit"');

  // Either way the commit is refused. That is the chain: the header cannot lie about a side, and
  // the two sides must be equal, so the postings must balance.
  assert.ok(a.length > 0 && b.length > 0);
});

test('a one-sided entry and a negative posting are both refused', () => {
  const oneSided = buildWorld([
    ['JE-2026-9003', 'manual', '2026-07-05', PERIOD, [['1200', 'debit', '100.00 EUR']]],
  ]);
  const v = checkInvariants(oneSided, MODEL, 'journal-entry', ['JE-2026-9003']).map((x) => x.invariant);
  assert.ok(v.includes('an entry has at least two postings'), `got: ${v.join(', ')}`);
  assert.ok(v.includes('debits equal credits'), 'a single debit cannot equal the credits');

  const negative = buildWorld([
    ['JE-2026-9004', 'manual', '2026-07-05', PERIOD, [
      ['1200', 'debit', '-100.00 EUR'], ['0800', 'credit', '-100.00 EUR'],
    ]],
  ]);
  const p = checkInvariants(negative, MODEL, 'posting').map((x) => x.invariant);
  assert.ok(p.includes('the amount is positive'), `got: ${p.join(', ')}`);
});

test('a posting into a locked period is refused; the same posting in the next period is accepted', () => {
  const locked = buildWorld([...ENTRIES, CORRECTION], { [PERIOD]: 'locked', [NEXT_PERIOD]: 'open' });
  assert.deepEqual(checkInvariants(locked, MODEL, 'journal-entry', ['JE-2026-0010']), [],
    'a correction dated in the next open period must be accepted');
  // Locking July does not invalidate the entries already inside it: invariants are checked on the
  // documents a commit touches, and a July entry nobody touches is never re-evaluated. But any
  // commit that *did* touch one would be refused, which is exactly Unveränderbarkeit.
  const wouldTouchJuly = checkInvariants(locked, MODEL, 'journal-entry', ['JE-2026-0002'])
    .map((x) => x.invariant);
  assert.deepEqual(wouldTouchJuly, ['the period is not locked'],
    'once July is locked, any commit touching a July entry must be refused — and only for that reason');

  const inJuly = [...CORRECTION];
  inJuly[2] = '2026-07-31';
  inJuly[3] = PERIOD;
  const refused = buildWorld([inJuly], { [PERIOD]: 'locked', [NEXT_PERIOD]: 'open' });
  const names = checkInvariants(refused, MODEL, 'journal-entry', ['JE-2026-0010']).map((x) => x.invariant);
  assert.ok(names.includes('the period is not locked'),
    `a July-dated entry must be refused once July is locked; got: ${names.join(', ') || '(none)'}`);
  const pnames = checkInvariants(refused, MODEL, 'posting').map((x) => x.invariant);
  assert.ok(pnames.includes('the posting is inside an open period'),
    'the lock must also be refused at the posting line');
});

test('a correction is a new entry that leaves the original byte-identical', () => {
  const before = JSON.stringify(WORLD['journal-entry']['JE-2026-0006']);
  const beforeLines = JSON.stringify([WORLD.posting['JE-2026-0006-1'], WORLD.posting['JE-2026-0006-2']]);

  const corrected = buildWorld([...ENTRIES, CORRECTION], { [PERIOD]: 'locked', [NEXT_PERIOD]: 'open' });
  assert.equal(JSON.stringify(corrected['journal-entry']['JE-2026-0006']), before,
    'the corrected entry must not be touched');
  assert.equal(JSON.stringify([corrected.posting['JE-2026-0006-1'], corrected.posting['JE-2026-0006-2']]), beforeLines,
    'the corrected entry\'s postings must not be touched');

  const c = corrected['journal-entry']['JE-2026-0010'];
  assert.equal(c.corrects, 'JE-2026-0006');
  assert.ok(c['correction-reason'].length > 10, 'a correction states why');
  assert.equal(c['accounting-period'], NEXT_PERIOD, 'the correction lands in the next open period');
  assert.equal(MODEL.entities.get('journal-entry').fields.has('corrected-by'), false,
    'journal-entry must not carry a back-reference: writing one would change the original');

  // The write-off nets to 250.00 EUR across the two entries, and both are individually balanced.
  const writeOff = Object.values(corrected.posting)
    .filter((p) => p['account-number'] === '4855');
  const net = Money.subtract(
    sum(writeOff.filter((p) => p.side === 'debit').map((p) => eur(p.amount))),
    sum(writeOff.filter((p) => p.side === 'credit').map((p) => eur(p.amount))));
  assert.equal(str(net), '250.00 EUR', 'the corrected write-off is 250.00 EUR');
  assert.deepEqual(checkInvariants(corrected, MODEL, 'journal-entry', ['JE-2026-0010']), []);
});

// ---------------------------------------------------------------------------- the worked month

test('the trial balance for 2026-07 balances exactly, in Summen and in Salden', () => {
  const totals = accountTotals(WORLD, PERIOD);

  // Summen: the gross debit and credit movement per account, added up. This is the figure that
  // proves the journal balances, and it is the one an auditor recomputes first.
  const debits = sum([...totals.values()].map((t) => t.debit));
  const credits = sum([...totals.values()].map((t) => t.credit));
  assert.equal(str(debits), '110079.98 EUR');
  assert.equal(str(credits), '110079.98 EUR');
  assert.ok(eq(debits, credits), 'the sum of all debits must equal the sum of all credits');

  const balance = (n) => {
    const t = totals.get(n) || { debit: ZERO, credit: ZERO };
    return Money.subtract(t.debit, t.credit);
  };
  const expected = {
    '0800': '-50000.00 EUR', 1200: '66249.99 EUR', 1400: '600.00 EUR', 1574: '2280.00 EUR',
    1600: '-12000.00 EUR', 1772: '-2280.00 EUR', 1776: '-950.00 EUR', 1791: '-100.00 EUR',
    3425: '12000.00 EUR', 3960: '-12000.00 EUR', 3980: '11700.00 EUR', 4840: '200.00 EUR',
    4855: '300.00 EUR', 8120: '-10500.00 EUR', 8336: '-500.00 EUR', 8400: '-4999.99 EUR',
  };
  for (const [acct, want] of Object.entries(expected)) {
    assert.equal(str(balance(acct)), want, `account ${acct}`);
  }
  assert.equal(totals.size, Object.keys(expected).length,
    `unexpected accounts moved: ${[...totals.keys()].filter((k) => !(k in expected)).join(', ')}`);

  // Salden: the closing balance per account, split onto the side it stands on. The two columns of
  // a Summen- und Saldenliste must agree too, and they are a different number from the Summen.
  const all = [...totals.keys()].map(balance);
  const saldenDebit = sum(all.filter((b) => Money.isPositive(b)));
  const saldenCredit = Money.negate(sum(all.filter((b) => Money.isNegative(b))));
  assert.equal(str(saldenDebit), '93329.99 EUR');
  assert.equal(str(saldenCredit), '93329.99 EUR');
  assert.ok(eq(saldenDebit, saldenCredit), 'the Salden columns must agree');
  assert.equal(str(sum(all)), '0.00 EUR', 'every balance in the ledger sums to nothing');
});

test('19 % VAT on 4,999.99 EUR is 950.00 EUR, computed exactly and not as a float', () => {
  const net = eur('4999.99 EUR');
  const vat = Money.percentage(net, '19', 'half-up');
  assert.equal(str(vat), '950.00 EUR');
  assert.equal(str(Money.add(net, vat)), '5949.99 EUR');
  // What a float does with the same arithmetic, for the record.
  assert.notEqual(0.1 + 0.2, 0.3, 'the reason money is not a float');
  assert.equal(String(1234567.89 * 0.19), '234567.89909999998',
    'a five-figure net times 19 % is already wrong in the fourth decimal');
  assert.equal(str(Money.percentage(eur('1234567.89 EUR'), '19', 'half-up')), '234567.90 EUR',
    'and exact BigInt arithmetic gets it right');
  assert.equal(str(vat), str(sum([eur('950.00 EUR')])));

  // Largest-remainder allocation: the parts sum to the whole, always (FD-1).
  const parts = Money.allocate(eur('950.00 EUR'), [1n, 1n, 1n], 'half-up');
  assert.equal(str(sum(parts)), '950.00 EUR');
  assert.deepEqual(parts.map(str), ['316.66 EUR', '316.67 EUR', '316.67 EUR']);
});

test('the Umsatzsteuervoranmeldung for 2026-07 is right to the cent', () => {
  const line = {
    41: vatLine(WORLD, PERIOD, '41', 'exempt-turnover'),
    43: vatLine(WORLD, PERIOD, '43', 'exempt-turnover'),
    45: vatLine(WORLD, PERIOD, '45', 'non-taxable-turnover'),
    '81-base': vatLine(WORLD, PERIOD, '81', 'taxable-turnover'),
    '81-tax': vatLine(WORLD, PERIOD, '81', 'output-tax'),
    '86-base': vatLine(WORLD, PERIOD, '86', 'taxable-turnover'),
    '86-tax': vatLine(WORLD, PERIOD, '86', 'output-tax'),
    '89-base': vatLine(WORLD, PERIOD, '89', 'acquisition-turnover'),
    '89-tax': vatLine(WORLD, PERIOD, '89', 'output-tax'),
    84: vatLine(WORLD, PERIOD, '84', 'output-tax'),
    61: vatLine(WORLD, PERIOD, '61', 'input-tax'),
    66: vatLine(WORLD, PERIOD, '66', 'input-tax'),
    67: vatLine(WORLD, PERIOD, '67', 'input-tax'),
  };
  assert.equal(str(line['81-base']), '4999.99 EUR');
  assert.equal(str(line['81-tax']), '950.00 EUR');
  assert.equal(str(line['86-base']), '0.00 EUR');
  assert.equal(str(line[41]), '0.00 EUR');
  assert.equal(str(line[43]), '10500.00 EUR', 'the export belongs in line 43');
  assert.equal(str(line[45]), '500.00 EUR', 'the OSS distance sale belongs in line 45');
  assert.equal(str(line['89-base']), '12000.00 EUR');
  assert.equal(str(line['89-tax']), '2280.00 EUR');
  assert.equal(str(line[61]), '2280.00 EUR');
  assert.equal(str(line[66]), '0.00 EUR');
  assert.equal(str(line[84]), '0.00 EUR');

  const output = sum([line['81-tax'], line['86-tax'], line['89-tax'], line[84]]);
  const input = sum([line[61], line[66], line[67]]);
  assert.equal(str(output), '3230.00 EUR');
  assert.equal(str(input), '2280.00 EUR');
  assert.equal(str(Money.subtract(output, input)), '950.00 EUR', 'line 83, the amount payable');

  // Reverse charge nets to nothing: declared in 89, deducted in 61, both visible.
  assert.ok(eq(line['89-tax'], line[61]), 'reverse-charge output tax equals the input tax deducted');

  // The OSS output tax of 100.00 EUR must not appear in any German line.
  const oss = Object.values(WORLD.posting).filter((p) => p['account-number'] === '1791');
  assert.equal(oss.length, 1);
  assert.equal(oss[0]['vat-kennzahl'], '', 'the OSS VAT account feeds no UStVA line');

  // Bases go to ELSTER truncated to whole euros; the tax stays as booked.
  assert.equal(str(toFullEuros(line['81-base'])), '4999.00 EUR');
  assert.equal(str(toFullEuros(line[43])), '10500.00 EUR');
  assert.equal(str(toFullEuros(line['89-base'])), '12000.00 EUR');
  const elsterWouldCompute = Money.percentage(toFullEuros(line['81-base']), '19', 'half-up');
  assert.equal(str(elsterWouldCompute), '949.81 EUR');
  assert.equal(str(Money.subtract(line['81-tax'], elsterWouldCompute)), '0.19 EUR',
    'the 19-cent reconciliation item that stays on the VAT account');
});

test('the OSS return for France is 500.00 EUR base and 100.00 EUR tax', () => {
  const ossPostings = Object.values(WORLD.posting)
    .filter((p) => p['accounting-period'] === PERIOD && p['vat-kennzahl'] === '45');
  const base = sum(ossPostings.map((p) => eur(p.amount)));
  assert.equal(str(base), '500.00 EUR');
  const tax = sum(Object.values(WORLD.posting)
    .filter((p) => p['account-number'] === '1791').map((p) => eur(p.amount)));
  assert.equal(str(tax), '100.00 EUR');
  assert.equal(str(Money.percentage(base, '20', 'half-up')), '100.00 EUR',
    'French VAT at 20 % on the net');
});

test('the CHF sale settles with a 200.00 EUR exchange loss, and the receivable clears to zero', () => {
  const invoiceRate = WORLD['exchange-rate']['CHF-EUR-2026-07-20-bookkeeping'];
  const paymentRate = WORLD['exchange-rate']['CHF-EUR-2026-07-28-bookkeeping'];
  const chf = Money.money('10000.00 CHF');

  const atInvoice = Money.multiply(Money.fromMinor(Money.toMinor(chf), 'EUR'), invoiceRate.rate, 'half-up');
  const atPayment = Money.multiply(Money.fromMinor(Money.toMinor(chf), 'EUR'), paymentRate.rate, 'half-up');
  assert.equal(str(atInvoice), '10500.00 EUR');
  assert.equal(str(atPayment), '10300.00 EUR');
  assert.equal(str(Money.subtract(atInvoice, atPayment)), '200.00 EUR');

  // FD-1: the two currencies do not add, and no rate is invented inside a comparison.
  assert.throws(() => Money.add(chf, eur('1.00 EUR')), /currency|mixed|EUR|CHF/i);
  assert.throws(() => Money.compare(chf, eur('1.00 EUR')), /currency|mixed|EUR|CHF/i);

  // The receivable is cleared at the amount it was raised at.
  const receivable = Object.values(WORLD.posting).filter((p) => p['account-number'] === '1400');
  const open = Money.subtract(
    sum(receivable.filter((p) => p.side === 'debit').map((p) => eur(p.amount))),
    sum(receivable.filter((p) => p.side === 'credit').map((p) => eur(p.amount))));
  assert.equal(str(open), '600.00 EUR', 'only the OSS invoice is still open');

  const loss = Object.values(WORLD.posting).filter((p) => p['account-number'] === '4840');
  assert.equal(loss.length, 1);
  assert.equal(str(eur(loss[0].amount)), '200.00 EUR');
  assert.equal(loss[0]['exchange-rate'], 'CHF-EUR-2026-07-28-bookkeeping',
    'a foreign-currency posting names the rate document it used');
});

test('the balance sheet and the profit and loss account agree on 15,499.99 EUR', () => {
  const totals = accountTotals(WORLD, PERIOD);
  const acct = (n) => WORLD['ledger-account'][`skr03-${n}`];
  const net = (n) => {
    const t = totals.get(n) || { debit: ZERO, credit: ZERO };
    return Money.subtract(t.debit, t.credit);
  };
  const group = (type) => sum([...totals.keys()].filter((n) => acct(n)['account-type'] === type).map(net));

  const assets = group('asset');
  const liabilities = group('liability');
  const equity = group('equity');
  const revenue = group('revenue');
  const expense = group('expense');

  assert.equal(str(assets), '80829.99 EUR');
  assert.equal(str(liabilities), '-15330.00 EUR');
  assert.equal(str(equity), '-50000.00 EUR');
  assert.equal(str(revenue), '-15999.99 EUR');
  // 3425 acquisition 12,000.00 debit, 4855 300.00 debit, 4840 200.00 debit, 3960 12,000.00 credit.
  assert.equal(str(expense), '500.00 EUR');

  // Result from the profit and loss side: revenue less expenses (both as signed net balances).
  const resultFromPL = Money.negate(Money.add(revenue, expense));
  assert.equal(str(resultFromPL), '15499.99 EUR');

  // Result from the balance sheet side: assets less liabilities less opening equity.
  const resultFromBS = Money.add(Money.add(assets, liabilities), equity);
  assert.equal(str(resultFromBS), '15499.99 EUR');
  assert.ok(eq(resultFromPL, resultFromBS), 'the two routes to the result must agree exactly');

  // And every account is on the statement its own document says it is.
  for (const n of totals.keys()) {
    const a = acct(n);
    const bs = a['account-type'] === 'asset' || a['account-type'] === 'liability' || a['account-type'] === 'equity';
    assert.equal(a['statement-section'], bs ? 'balance-sheet' : 'profit-and-loss', `account ${n}`);
  }
});

test('the period close checklist is what the model says it is', () => {
  const ap = MODEL.entities.get('accounting-period');
  const ready = ap.predicates.get('ready to lock');
  assert.ok(ready, 'accounting-period declares no "ready to lock"');
  for (const part of ['trial-balance-agreed is true', 'bank-reconciled is true', 'vat-return-filed is true']) {
    assert.ok(ready.body.includes(part), `"ready to lock" is missing: ${part}`);
  }
  // A period that is not ready must not satisfy the predicate.
  const world = buildWorld(ENTRIES);
  const july = { ...world['accounting-period'][PERIOD], __id: PERIOD };
  assert.equal(evaluateCondition(world, MODEL, 'accounting-period', july, 'accounting-period ready to lock'), false);
  const done = { ...july, 'trial-balance-agreed': true, 'bank-reconciled': true, 'vat-return-filed': true };
  assert.equal(evaluateCondition(world, MODEL, 'accounting-period', done, 'accounting-period ready to lock'), true);
  // `accepts postings` is stated negatively so a status added later does not gain the permission.
  assert.equal(ap.predicates.get('accepts postings').body, 'status is not "locked"');
});

test('gapless numbering: no ledger number is derived from a count of documents', () => {
  const seq = MODEL.entities.get('number-sequence');
  assert.ok(seq.invariants.has('the sequence only moves forward'));
  assert.equal(seq.invariants.get('the sequence only moves forward').body, 'next-value > highest-issued');
  const bad = [];
  for (const p of MODEL.files) {
    const text = readFileSync(p, 'utf8');
    const rules = /## Rules\n([\s\S]*?)(\n## |$)/.exec(text);
    if (!rules) continue;
    for (const m of rules[1].matchAll(/count of\s+([a-z0-9-]+)/g)) {
      if (/entry-number|invoice-number|run-reference/.test(rules[1])) {
        bad.push(`${relative(REPO, p)}: a rule counts ${m[1]} near a document number`);
      }
    }
  }
  assert.deepEqual(bad, [], `numbers derived from counts:\n  ${bad.join('\n  ')}`);
});

test('no personal data and no bank identifiers anywhere in the ledger model', () => {
  const bad = [];
  for (const p of [...MODEL.files, ...MODEL.docFiles]) {
    const text = readFileSync(p, 'utf8');
    for (const [label, re] of [
      ['an email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
      ['an IBAN', /\b[A-Z]{2}\d{2}[\sA-Z0-9]{12,}\b/],
      ['a BIC', /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b(?=\s*(?:BIC|SWIFT))/],
    ]) if (re.test(text)) bad.push(`${relative(REPO, p)}: contains what looks like ${label}`);
  }
  assert.deepEqual(bad, [], `possible personal or bank data:\n  ${bad.join('\n  ')}`);
});


// ---------------------------------------------------------------------------------------------
// The worked month, posted for real: nine journal entries through `runtime/polism/execute.js`,
// with every posting line produced by the rules in `processes/journal-posting.md`.
// ---------------------------------------------------------------------------------------------

/** Every SKR03 account from the seed table, as `ledger-account` documents. */
function seedAccounts() {
  const out = {};
  for (const row of CHARTS.skr03.rows) {
    out[`skr03-${row['account-number']}`] = {
      'account-number': row['account-number'], name: row.name, chart: 'skr03',
      'account-type': row['account-type'], 'normal-balance': row['normal-balance'],
      'statement-section': row['statement-section'], 'vat-kennzahl': row['vat-kennzahl'],
      'vat-role': row['vat-role'] || 'none',
      'vat-rate-percent': row['vat-rate-percent'] === '' ? '' : Number(row['vat-rate-percent']),
      'reconciliation-account-for': row['reconciliation-account-for'],
      'blocked-for-manual-posting': row.manual === 'true', 'account-source': row.source,
      'opened-on': '2026-01-01', status: 'active',
    };
  }
  return out;
}

/** The four tax situations this month uses, with their account determination filled in. */
const TREATMENTS = {
  'domestic-standard': {
    name: 'domestic-standard', 'applies-to': 'sale', 'vat-rate-percent': 19,
    'rate-determined-by': 'origin-country', 'requires-buyer-vat-id': false,
    'requires-exemption-reason': false, 'requires-ec-sales-list': false, 'requires-oss-return': false,
    'requires-customs-declaration': false, 'requires-proof-of-transport': false, status: 'active',
    'revenue-account-number': '8400', 'revenue-account': 'skr03-8400',
    'output-vat-account-number': '1776', 'output-vat-account': 'skr03-1776',
    'vat-kennzahl-base': '81', 'vat-kennzahl-tax': '81',
    'vat-role-base': 'taxable-turnover', 'vat-role-tax': 'output-tax',
  },
  'oss-distance-sale': {
    name: 'oss-distance-sale', 'applies-to': 'sale', 'vat-rate-percent': 20,
    'rate-determined-by': 'destination-country', 'requires-buyer-vat-id': false,
    'requires-exemption-reason': false, 'requires-ec-sales-list': false, 'requires-oss-return': true,
    'requires-customs-declaration': false, 'requires-proof-of-transport': false, status: 'active',
    'revenue-account-number': '8336', 'revenue-account': 'skr03-8336',
    'output-vat-account-number': '1791', 'output-vat-account': 'skr03-1791',
    'vat-kennzahl-base': '45', 'vat-kennzahl-tax': '',
    'vat-role-base': 'non-taxable-turnover', 'vat-role-tax': 'output-tax',
  },
  export: {
    name: 'export', 'applies-to': 'sale', 'vat-rate-percent': 0,
    'rate-determined-by': 'zero', 'requires-buyer-vat-id': false,
    'requires-exemption-reason': true, 'requires-ec-sales-list': false, 'requires-oss-return': false,
    'requires-customs-declaration': true, 'requires-proof-of-transport': true, status: 'active',
    'revenue-account-number': '8120', 'revenue-account': 'skr03-8120',
    'vat-kennzahl-base': '43', 'vat-role-base': 'exempt-turnover', 'vat-role-tax': 'none',
  },
  'eu-acquisition': {
    name: 'eu-acquisition', 'applies-to': 'purchase', 'vat-rate-percent': 19,
    'rate-determined-by': 'destination-country', 'requires-buyer-vat-id': true,
    'requires-exemption-reason': false, 'requires-ec-sales-list': false, 'requires-oss-return': false,
    'requires-customs-declaration': false, 'requires-proof-of-transport': false, status: 'active',
    'acquisition-account-number': '3425', 'acquisition-account': 'skr03-3425',
    'self-assessed-vat-account-number': '1772', 'self-assessed-vat-account': 'skr03-1772',
    'input-vat-account-number': '1574', 'input-vat-account': 'skr03-1574',
    'vat-kennzahl-base': '89', 'vat-kennzahl-tax': '89',
    'vat-role-base': 'acquisition-turnover', 'vat-role-tax': 'output-tax',
  },
};

/** The source documents behind the month. Fictional companies only; no personal data. */
function seedSources() {
  return {
    customer: {
      'feinkost-weber-gmbh': { name: 'Feinkost Weber GmbH', country: 'DE' },
      'alpina-delikatessen-ag': { name: 'Alpina Delikatessen AG', country: 'CH' },
      'epicerie-lyonnaise-sas': { name: 'Epicerie Lyonnaise SAS', country: 'FR' },
    },
    supplier: { 'zuidvrucht-handel-bv': { name: 'Zuidvrucht Handel B.V.', country: 'NL' } },
    article: { 'cashew-1kg': { name: 'Cashews 1 kg' } },
    invoice: {
      'R-2026-0001': {
        'invoice-number': 'R-2026-0001', 'invoice-date': '2026-07-05', currency: 'EUR',
        'net-amount': '4999.99 EUR', 'vat-amount': '950.00 EUR', 'gross-amount': '5949.99 EUR',
        'payable-amount': '5949.99 EUR', status: 'issued', customer: 'feinkost-weber-gmbh',
        'vat-treatment': 'domestic-standard',
      },
      'R-2026-0002': {
        'invoice-number': 'R-2026-0002', 'invoice-date': '2026-07-20', currency: 'CHF',
        'net-amount': '10500.00 EUR', 'vat-amount': '0.00 EUR', 'gross-amount': '10500.00 EUR',
        'payable-amount': '10500.00 EUR', status: 'issued', customer: 'alpina-delikatessen-ag',
        'vat-treatment': 'export',
      },
      'R-2026-0003': {
        'invoice-number': 'R-2026-0003', 'invoice-date': '2026-07-22', currency: 'EUR',
        'net-amount': '500.00 EUR', 'vat-amount': '100.00 EUR', 'gross-amount': '600.00 EUR',
        'payable-amount': '600.00 EUR', status: 'issued', customer: 'epicerie-lyonnaise-sas',
        'vat-treatment': 'oss-distance-sale',
      },
    },
    'supplier-invoice': {
      'EK-2026-0001': {
        'supplier-invoice-number': '2026-4471', 'our-reference': 'EK-2026-0001',
        supplier: 'zuidvrucht-handel-bv', 'invoice-date': '2026-07-06', 'received-on': '2026-07-08',
        currency: 'EUR', 'net-amount': '12000.00 EUR', 'vat-amount': '0.00 EUR',
        'gross-amount': '12000.00 EUR', 'posting-total': '14280.00 EUR',
        'ledger-net-amount': '12000.00 EUR', 'ledger-vat-amount': '2280.00 EUR',
        'vat-treatment': 'eu-acquisition', 'supplier-vat-identifier': 'NL-VAT-PLACEHOLDER',
        'vat-rate-percent': 19, 'expense-account-number': '3425', 'reverse-charge': true,
        'input-vat-deductible': true, 'payment-due-date': '2026-08-07',
        'payment-terms': '30 days net', 'accounting-period': '2026-07', 'approval-count': 2,
        'blocked-for-payment': false, status: 'approved', 'entered-by': 'employee-accountant-1',
        'document-hash': 'sha256-placeholder-supplier-invoice',
      },
    },
    payment: {
      'PAY-2026-0001': {
        'payment-reference': 'PAY-2026-0001', direction: 'incoming', 'payment-date': '2026-07-15',
        currency: 'EUR', amount: '5949.99 EUR', 'ledger-amount': '5949.99 EUR',
        'settled-amount': '5949.99 EUR', 'difference-reason': 'none',
        'bank-account-number': '1200', 'payment-means-code': '58', invoice: 'R-2026-0001',
        customer: 'feinkost-weber-gmbh', 'accounting-period': '2026-07', status: 'executed',
        'entered-by': 'employee-treasurer-1',
      },
      'PAY-2026-0002': {
        'payment-reference': 'PAY-2026-0002', direction: 'incoming', 'payment-date': '2026-07-28',
        currency: 'CHF', amount: '10000.00 CHF', 'ledger-amount': '10300.00 EUR',
        'settled-amount': '10500.00 EUR', 'difference-amount': '200.00 EUR',
        'difference-reason': 'exchange-difference', 'exchange-rate': 'CHF-EUR-2026-07-28-bookkeeping',
        'bank-account-number': '1200', 'payment-means-code': '58', invoice: 'R-2026-0002',
        customer: 'alpina-delikatessen-ag', 'accounting-period': '2026-07', status: 'executed',
        'entered-by': 'employee-treasurer-1',
      },
    },
    'goods-receipt': {
      'GR-2026-0044': {
        quantity: 400, 'delivered-quantity': 400, order: 'PO-2026-0031',
        'order-line': 'PO-2026-0031-1', article: 'cashew-1kg', location: 'berlin-main',
        'delivery-note-reference': 'DN-88213', 'packaging-intact': true,
        'receipt-date': '2026-07-09', 'received-by': 'employee-warehouse-1',
      },
    },
    'stock-adjustment': {
      'SA-2026-0007': {
        'adjustment-type': 'write-off-damage', article: 'cashew-1kg', location: 'berlin-main',
        quantity: 10, direction: 'decrease', value: '300.00 EUR', currency: 'EUR',
        'reason-code': 'DAMAGE', 'reason-note': 'Pallet crushed on the dock.',
        'created-by': 'employee-warehouse-1', 'approval-count': 2, status: 'posted',
      },
      'SA-2026-0008': {
        'adjustment-type': 'count-correction', article: 'cashew-1kg', location: 'berlin-main',
        quantity: 2, direction: 'increase', value: '50.00 EUR', currency: 'EUR',
        'reason-code': 'RECOUNT', 'reason-note': 'Recount: eight units damaged, not ten.',
        'created-by': 'employee-warehouse-1', 'approval-count': 2, status: 'posted',
      },
    },
    'exchange-rate': {
      'CHF-EUR-2026-07-20-bookkeeping': { 'from-currency': 'CHF', 'to-currency': 'EUR', 'rate-date': '2026-07-20', rate: '1.0500', source: 'ecb-reference', 'source-reference': 'ECB daily reference 2026-07-20', purpose: 'bookkeeping', 'captured-by': 'employee-treasurer-1', 'captured-on': '2026-07-20', status: 'active' },
      'CHF-EUR-2026-07-28-bookkeeping': { 'from-currency': 'CHF', 'to-currency': 'EUR', 'rate-date': '2026-07-28', rate: '1.0300', source: 'ecb-reference', 'source-reference': 'ECB daily reference 2026-07-28', purpose: 'bookkeeping', 'captured-by': 'employee-treasurer-1', 'captured-on': '2026-07-28', status: 'active' },
    },
    employee: {
      'employee-accountant-1': { 'display-name': 'Accountant 1' },
      'employee-treasurer-1': { 'display-name': 'Treasurer 1' },
      'employee-warehouse-1': { 'display-name': 'Warehouse clerk 1' },
      'employee-controller-1': { 'display-name': 'Controller 1' },
    },
    location: { 'berlin-main': { name: 'Berlin main warehouse' } },
    order: { 'PO-2026-0031': { 'ordered-quantity': 400, 'delivered-quantity': 400, status: 'closed' } },
    'order-line': { 'PO-2026-0031-1': { position: 1, status: 'delivered' } },
  };
}

/**
 * The header an accountant supplies. Every posting line comes from the rules — this names the source
 * document, the period, the chart, the tax situation and the totals the invariants will check.
 */
function header(id, kind, date, period, debit, credit, count, extra = {}) {
  return {
    'entry-number': id, 'entry-date': date, 'document-date': date, 'accounting-period': period,
    chart: 'skr03', currency: 'EUR', 'debit-amount': debit, 'credit-amount': credit,
    'posting-count': count, description: `${kind} ${id}`, 'source-document-type': kind,
    'source-document-reference': id, reversal: false, status: 'draft',
    'entered-by': 'employee-accountant-1', 'posted-by': 'employee-accountant-1', 'posted-at': date,
    ...extra,
  };
}

/** The eight entries the rules post. The opening balance is not one of them — see the note below. */
const POSTED_MONTH = [
  ['JE-2026-0002', 'sales-invoice', '2026-07-05', PERIOD, '5949.99 EUR', '5949.99 EUR', 3,
    { invoice: 'R-2026-0001', 'vat-treatment': 'domestic-standard' }],
  ['JE-2026-0003', 'incoming-payment', '2026-07-15', PERIOD, '5949.99 EUR', '5949.99 EUR', 2,
    { payment: 'PAY-2026-0001' }],
  ['JE-2026-0004', 'supplier-invoice', '2026-07-08', PERIOD, '14280.00 EUR', '14280.00 EUR', 4,
    { 'supplier-invoice': 'EK-2026-0001', 'vat-treatment': 'eu-acquisition' }],
  ['JE-2026-0005', 'goods-receipt', '2026-07-09', PERIOD, '12000.00 EUR', '12000.00 EUR', 2,
    { 'goods-receipt': 'GR-2026-0044' }],
  ['JE-2026-0006', 'stock-adjustment', '2026-07-20', PERIOD, '300.00 EUR', '300.00 EUR', 2,
    { 'stock-adjustment': 'SA-2026-0007' }],
  ['JE-2026-0007', 'sales-invoice', '2026-07-22', PERIOD, '600.00 EUR', '600.00 EUR', 3,
    { invoice: 'R-2026-0003', 'vat-treatment': 'oss-distance-sale' }],
  ['JE-2026-0008', 'sales-invoice', '2026-07-20', PERIOD, '10500.00 EUR', '10500.00 EUR', 2,
    { invoice: 'R-2026-0002', 'vat-treatment': 'export', 'exchange-rate': 'CHF-EUR-2026-07-20-bookkeeping' }],
  ['JE-2026-0009', 'incoming-payment', '2026-07-28', PERIOD, '10500.00 EUR', '10500.00 EUR', 3,
    { payment: 'PAY-2026-0002', 'exchange-rate': 'CHF-EUR-2026-07-28-bookkeeping' }],
];

/** The August correction of the July write-off: 300.00 booked, 250.00 counted. */
const POSTED_CORRECTION = ['JE-2026-0010', 'stock-adjustment', '2026-08-03', NEXT_PERIOD,
  '50.00 EUR', '50.00 EUR', 2,
  { 'stock-adjustment': 'SA-2026-0008', corrects: 'JE-2026-0006',
    'correction-reason': 'Write-off booked at 300.00 EUR; the counted loss was 250.00 EUR.' }];

/** The opening balance, which no arm posts. Written directly — see the report. */
const OPENING = {
  'journal-entry': {
    'JE-2026-0001': header('JE-2026-0001', 'opening-balance', '2026-07-01', PERIOD,
      '50000.00 EUR', '50000.00 EUR', 2),
  },
  posting: {
    'JE-2026-0001-bank': { 'journal-entry': 'JE-2026-0001', position: 1, 'account-number': '1200', chart: 'skr03', 'ledger-account': 'skr03-1200', side: 'debit', amount: '50000.00 EUR', currency: 'EUR', 'posting-date': '2026-07-01', 'accounting-period': PERIOD, description: 'opening balance', 'source-document-reference': 'JE-2026-0001', 'vat-role': 'none' },
    'JE-2026-0001-capital': { 'journal-entry': 'JE-2026-0001', position: 2, 'account-number': '0800', chart: 'skr03', 'ledger-account': 'skr03-0800', side: 'credit', amount: '50000.00 EUR', currency: 'EUR', 'posting-date': '2026-07-01', 'accounting-period': PERIOD, description: 'opening balance', 'source-document-reference': 'JE-2026-0001', 'vat-role': 'none' },
  },
};

function ledgerBase(periodStatus = { [PERIOD]: 'open', [NEXT_PERIOD]: 'open' }) {
  const periods = {};
  for (const [key, status] of Object.entries(periodStatus)) {
    periods[key] = {
      'period-key': key, 'fiscal-year': 2026, month: Number(key.slice(5)),
      'from-date': `${key}-01`, 'to-date': key === PERIOD ? '2026-07-31' : '2026-08-31',
      chart: 'skr03', status, 'vat-return-filed': status === 'locked',
      'trial-balance-agreed': status === 'locked', 'bank-reconciled': status === 'locked',
      'carried-forward': status === 'locked',
      'locked-on': status === 'locked' ? '2026-08-10' : '',
      'locked-by': status === 'locked' ? 'employee-controller-1' : '',
    };
  }
  return {
    'chart-of-accounts': { skr03: { ...CHART_DOC } },
    'ledger-account': seedAccounts(),
    'accounting-period': periods,
    'vat-treatment': { ...TREATMENTS },
    ...seedSources(),
    'journal-entry': { ...OPENING['journal-entry'] },
    posting: { ...OPENING.posting },
  };
}

/** Post one entry through `execute.js` and fold the resulting changes into `docs`. */
function post(model, evaluate, docs, spec) {
  const [id, kind, date, period, debit, credit, count, extra] = spec;
  const result = evaluate(model, {
    op: 'create', entity: 'journal-entry', id,
    doc: header(id, kind, date, period, debit, credit, count, extra),
    actorRoles: ['accountant'],
  }, worldOf(docs));
  if (!result.ok) {
    const why = (result.violations || []).map((v) => `${v.reason} (${v.file}:${v.line})`).join('\n    ');
    throw new Error(`posting ${id} was refused:\n    ${why}`);
  }
  for (const ch of result.changes) {
    docs[ch.entity] = docs[ch.entity] || {};
    if (ch.op === 'delete') delete docs[ch.entity][ch.id];
    else docs[ch.entity][ch.id] = { ...ch.after };
  }
  return result;
}

/** The whole month, posted. Returns the world and the per-entry results. */
async function runMonth(periodStatus, specs = POSTED_MONTH) {
  const { evaluate } = await import('../runtime/polism/execute.js');
  const parsed = await realModel();
  const docs = ledgerBase(periodStatus);
  const results = specs.map((s) => post(parsed.model, evaluate, docs, s));
  return { docs, results, model: parsed.model, evaluate };
}

test('POSTED: every entry of the worked month posts through execute.js, legs and all', async () => {
  const { docs, results } = await runMonth();
  assert.equal(results.length, 8, 'eight entries post through the rules');

  const created = Object.keys(docs.posting).filter((id) => !id.startsWith('JE-2026-0001-'));
  assert.equal(created.length, 21, `expected 21 rule-created postings, got ${created.length}`);
  for (const id of created) {
    assert.match(id, /^JE-2026-\d{4}-[a-z0-9-]+$/, `${id} is not <entry>-<label>`);
    const leg = docs.posting[id];
    assert.equal(leg['journal-entry'], id.slice(0, 12),
      `${id} must carry the back-reference §21.3 fills from the declarations`);
    assert.ok(['debit', 'credit'].includes(leg.side));
    assert.ok(Money.isPositive(eur(leg.amount)), `${id} amount must be positive`);
    assert.equal(leg.currency, 'EUR');
    assert.equal(leg.chart, 'skr03');
    assert.ok(leg['ledger-account'], `${id} must name its account document`);
    assert.ok(docs['ledger-account'][leg['ledger-account']], `${id} names an account that does not exist`);
    assert.equal(docs['ledger-account'][leg['ledger-account']]['account-number'], leg['account-number']);
  }

  const sale = ['receivable', 'revenue', 'output-vat'].map((l) => docs.posting[`JE-2026-0002-${l}`]);
  assert.deepEqual(sale.map((x) => x && [x['account-number'], x.side, x.amount]), [
    ['1400', 'debit', '5949.99 EUR'],
    ['8400', 'credit', '4999.99 EUR'],
    ['1776', 'credit', '950.00 EUR'],
  ]);
  assert.equal(sale[2]['tax-base-amount'], '4999.99 EUR');
  assert.equal(sale[2]['vat-kennzahl'], '81');
  assert.equal(sale[1]['vat-role'], 'taxable-turnover');
  assert.equal(sale[0].customer, 'feinkost-weber-gmbh', 'the receivable leg carries the customer');

  const rc = ['acquisition', 'payable', 'self-assessed-vat', 'input-vat']
    .map((l) => docs.posting[`JE-2026-0004-${l}`]);
  assert.deepEqual(rc.map((x) => x && [x['account-number'], x.side, x.amount]), [
    ['3425', 'debit', '12000.00 EUR'],
    ['1600', 'credit', '12000.00 EUR'],
    ['1772', 'credit', '2280.00 EUR'],
    ['1574', 'debit', '2280.00 EUR'],
  ]);
  assert.equal(rc[2]['vat-kennzahl'], '89');
  assert.equal(rc[3]['vat-kennzahl'], '61');

  assert.deepEqual(Object.keys(docs.posting).filter((k) => k.startsWith('JE-2026-0008-')).sort(),
    ['JE-2026-0008-receivable', 'JE-2026-0008-revenue']);
  assert.equal(docs.posting['JE-2026-0008-revenue']['account-number'], '8120');

  const fx = docs.posting['JE-2026-0009-exchange-loss'];
  assert.equal(fx['account-number'], '4840');
  assert.equal(fx.amount, '200.00 EUR');
  assert.equal(fx['exchange-rate'], 'CHF-EUR-2026-07-28-bookkeeping');
  assert.equal(docs.posting['JE-2026-0009-receivable-cleared'].amount, '10500.00 EUR',
    'the receivable clears at the amount it was raised at');

  assert.equal(docs['journal-entry']['JE-2026-0002'].status, 'posted');
  assert.equal(docs['journal-entry']['JE-2026-0002']['posted-by'], 'employee-accountant-1');
});

test('POSTED: the trial balance of the posted month balances exactly', async () => {
  const { docs } = await runMonth();
  const totals = accountTotals(docs, PERIOD);
  const debits = sum([...totals.values()].map((x) => x.debit));
  const credits = sum([...totals.values()].map((x) => x.credit));
  assert.equal(str(debits), '110079.98 EUR');
  assert.equal(str(credits), '110079.98 EUR');
  assert.ok(eq(debits, credits));

  const balance = (n) => {
    const x = totals.get(n) || { debit: ZERO, credit: ZERO };
    return Money.subtract(x.debit, x.credit);
  };
  const expected = {
    '0800': '-50000.00 EUR', 1200: '66249.99 EUR', 1400: '600.00 EUR', 1574: '2280.00 EUR',
    1600: '-12000.00 EUR', 1772: '-2280.00 EUR', 1776: '-950.00 EUR', 1791: '-100.00 EUR',
    3425: '12000.00 EUR', 3960: '-12000.00 EUR', 3980: '11700.00 EUR', 4840: '200.00 EUR',
    4855: '300.00 EUR', 8120: '-10500.00 EUR', 8336: '-500.00 EUR', 8400: '-4999.99 EUR',
  };
  for (const [acct, want] of Object.entries(expected)) assert.equal(str(balance(acct)), want, `account ${acct}`);
  assert.equal(totals.size, Object.keys(expected).length,
    `unexpected accounts moved: ${[...totals.keys()].filter((k) => !(k in expected)).join(', ')}`);

  const all = [...totals.keys()].map(balance);
  assert.equal(str(sum(all.filter(Money.isPositive))), '93329.99 EUR');
  assert.equal(str(Money.negate(sum(all.filter(Money.isNegative)))), '93329.99 EUR');
  assert.equal(str(sum(all)), '0.00 EUR');
});

test('POSTED: the balance sheet and the P&L of the posted month agree on 15,499.99 EUR', async () => {
  const { docs } = await runMonth();
  const totals = accountTotals(docs, PERIOD);
  const acct = (n) => docs['ledger-account'][`skr03-${n}`];
  const net = (n) => {
    const x = totals.get(n) || { debit: ZERO, credit: ZERO };
    return Money.subtract(x.debit, x.credit);
  };
  const group = (type) => sum([...totals.keys()].filter((n) => acct(n)['account-type'] === type).map(net));
  const assets = group('asset');
  const liabilities = group('liability');
  const equity = group('equity');
  const revenue = group('revenue');
  const expense = group('expense');
  assert.equal(str(assets), '80829.99 EUR');
  assert.equal(str(liabilities), '-15330.00 EUR');
  assert.equal(str(equity), '-50000.00 EUR');
  const fromPL = Money.negate(Money.add(revenue, expense));
  const fromBS = Money.add(Money.add(assets, liabilities), equity);
  assert.equal(str(fromPL), '15499.99 EUR');
  assert.equal(str(fromBS), '15499.99 EUR');
  assert.ok(eq(fromPL, fromBS));
});

test('POSTED: the UStVA of the posted month gives KZ 83 = 950.00 EUR', async () => {
  const { docs } = await runMonth();
  const line = (kz, role) => vatLine(docs, PERIOD, kz, role);
  assert.equal(str(line('81', 'taxable-turnover')), '4999.99 EUR');
  assert.equal(str(line('81', 'output-tax')), '950.00 EUR');
  assert.equal(str(line('43', 'exempt-turnover')), '10500.00 EUR');
  assert.equal(str(line('45', 'non-taxable-turnover')), '500.00 EUR');
  assert.equal(str(line('89', 'acquisition-turnover')), '12000.00 EUR');
  assert.equal(str(line('89', 'output-tax')), '2280.00 EUR');
  assert.equal(str(line('61', 'input-tax')), '2280.00 EUR');
  assert.equal(str(line('66', 'input-tax')), '0.00 EUR');
  const output = sum([line('81', 'output-tax'), line('86', 'output-tax'), line('89', 'output-tax'), line('84', 'output-tax')]);
  const input = sum([line('61', 'input-tax'), line('66', 'input-tax'), line('67', 'input-tax')]);
  assert.equal(str(Money.subtract(output, input)), '950.00 EUR');

  const oss = docs.posting['JE-2026-0007-output-vat'];
  assert.equal(oss['account-number'], '1791');
  assert.equal(oss.amount, '100.00 EUR');
  assert.equal(oss['vat-kennzahl'] || '', '');
});

test('POSTED: a wrong header total is refused by the legs the rules produced', async () => {
  const { model, evaluate } = await runMonth();
  const bad = ['JE-2026-0002', 'sales-invoice', '2026-07-05', PERIOD, '5949.99 EUR', '5949.98 EUR', 3,
    { invoice: 'R-2026-0001', 'vat-treatment': 'domestic-standard' }];
  assert.throws(() => post(model, evaluate, ledgerBase(), bad), /credit total agrees with the postings/i,
    'a header that disagrees with the legs the rules produced must be refused');

  const badCount = ['JE-2026-0002', 'sales-invoice', '2026-07-05', PERIOD, '5949.99 EUR', '5949.99 EUR', 2,
    { invoice: 'R-2026-0001', 'vat-treatment': 'domestic-standard' }];
  assert.throws(() => post(model, evaluate, ledgerBase(), badCount), /posting count agrees/i);
});

test('POSTED: period close, then the correction posts in August and July stays byte-identical', async () => {
  const { docs, model, evaluate } = await runMonth();
  const before = JSON.stringify(docs['journal-entry']['JE-2026-0006']);
  const legsBefore = JSON.stringify([docs.posting['JE-2026-0006-write-off'],
    docs.posting['JE-2026-0006-inventory-reduction']]);

  const july = docs['accounting-period'][PERIOD];
  const lock = evaluate(model, {
    op: 'update', entity: 'accounting-period', id: PERIOD, actorRoles: ['controller'],
    doc: {
      ...july, 'trial-balance-agreed': true, 'bank-reconciled': true, 'vat-return-filed': true,
      'locked-by': 'employee-controller-1', 'locked-on': '2026-08-10',
    },
  }, worldOf(docs));
  assert.equal(lock.ok, true,
    `the close was refused: ${(lock.violations || []).map((v) => v.reason).join('; ')}`);
  const locked = lock.changes.find((c) => c.entity === 'accounting-period');
  assert.equal(locked.after.status, 'locked', 'the close rule sets the status');
  assert.equal(locked.after['locked-by'], 'employee-controller-1');
  for (const ch of lock.changes) docs[ch.entity][ch.id] = { ...ch.after };

  const inJuly = [...POSTED_CORRECTION];
  inJuly[2] = '2026-07-31';
  inJuly[3] = PERIOD;
  assert.throws(() => post(model, evaluate, docs, inJuly), /lock|2026-07/i,
    'a July-dated correction must be refused once July is locked');

  post(model, evaluate, docs, POSTED_CORRECTION);
  assert.deepEqual(
    ['inventory-restored', 'write-off-reversed'].map((l) => {
      const x = docs.posting[`JE-2026-0010-${l}`];
      return [x['account-number'], x.side, x.amount];
    }),
    [['3980', 'debit', '50.00 EUR'], ['4855', 'credit', '50.00 EUR']]);
  assert.equal(docs['journal-entry']['JE-2026-0010'].corrects, 'JE-2026-0006');
  assert.match(docs['journal-entry']['JE-2026-0010']['correction-reason'], /250\.00 EUR/);

  assert.equal(JSON.stringify(docs['journal-entry']['JE-2026-0006']), before);
  assert.equal(JSON.stringify([docs.posting['JE-2026-0006-write-off'],
    docs.posting['JE-2026-0006-inventory-reduction']]), legsBefore);

  const writeOff = Object.values(docs.posting).filter((x) => x['account-number'] === '4855');
  assert.equal(str(Money.subtract(
    sum(writeOff.filter((x) => x.side === 'debit').map((x) => eur(x.amount))),
    sum(writeOff.filter((x) => x.side === 'credit').map((x) => eur(x.amount))))), '250.00 EUR');
  const julyTotals = accountTotals(docs, PERIOD);
  assert.equal(str(sum([...julyTotals.values()].map((x) => x.debit))), '110079.98 EUR');
});

test('POSTED: an opening balance and a manual entry still cannot be posted, and fail closed', async () => {
  const { model, evaluate } = await runMonth();
  for (const kind of ['opening-balance', 'manual', 'vat-return']) {
    const spec = [`JE-2026-990${kind.length % 10}`, kind, '2026-07-05', PERIOD, '100.00 EUR', '100.00 EUR', 2, {}];
    assert.throws(() => post(model, evaluate, ledgerBase(), spec),
      /at least two postings|posting count agrees|debits equal credits/i,
      `a "${kind}" entry matches no arm, so it gets no legs and must fail closed`);
  }
});

// ---------------------------------------------------------------------------- what is still owed

// ---------------------------------------------------------------- through the real runtime

/** A World over plain objects, the two methods `execute.js` requires (grammar §13.3). */
function worldOf(docs) {
  return {
    get: (entity, id) => {
      const d = (docs[entity] || {})[String(id)];
      return d ? { ...d, id: String(id) } : null;
    },
    find: (entity, pred) => Object.entries(docs[entity] || {})
      .map(([id, d]) => ({ ...d, id }))
      .filter(pred || (() => true)),
  };
}

/** The real `operating-model/`, parsed by the real parser. */
async function realModel() {
  const { parseOperatingModel } = await import('../runtime/polism/parse.js');
  const files = new Map();
  for (const p of [...MODEL.files, ...MODEL.docFiles]) files.set(relative(REPO, p), readFileSync(p, 'utf8'));
  return parseOperatingModel(files);
}

test('the real parser accepts the whole operating model with no errors at all', async () => {
  const parsed = await realModel();
  const errors = (parsed.errors || []).filter((d) => d.severity === 'error');
  assert.deepEqual(errors.map((d) => `${d.file}:${d.line}: ${d.message.split('\n')[0]}`), [],
    'the shipped operating model must parse, or the ledger is a document rather than a system');
  assert.ok(parsed.model.entities.size >= 36, `only ${parsed.model.entities.size} entities parsed`);

  const warnings = (parsed.errors || []).filter((d) => d.severity === 'warning');
  const mine = warnings.filter((d) => LEDGER_PROCESSES.some((n) => d.file.endsWith(`/${n}.md`))
    || LEDGER_ENTITIES.some((n) => d.file.endsWith(`/${n}.md`)));
  const uncovered = warnings.filter((d) => /nothing says who may/.test(d.message));
  console.log(`\n  runtime/polism/parse.js on operating-model/: 0 errors, ${warnings.length} warnings`
    + `\n    of which authority-coverage warnings: ${uncovered.length} (none on a ledger entity: `
    + `${uncovered.every((d) => !LEDGER_ENTITIES.some((n) => d.file.endsWith(`/${n}.md`)))})`
    + `\n    warnings on ledger files: ${mine.length}\n`);

  // Every ledger entity declares entity-scope authority, so none of them is an uncovered operation.
  for (const e of LEDGER_ENTITIES) {
    assert.ok(!uncovered.some((d) => d.file.endsWith(`/${e}.md`)),
      `${e} still has operations nobody is authorised for`);
  }
});

test('the posting scheme is inside ## Rules, and nothing claims otherwise any more', () => {
  const master = readFileSync(join(OM, 'processes', 'journal-posting.md'), 'utf8');
  const rules = /## Rules\n([\s\S]*?)\n## Notes/.exec(master);
  assert.ok(rules, 'journal-posting.md has no ## Rules section');
  const labelled = [...rules[1].matchAll(/Create posting as "([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.equal(labelled.length, 25, `expected 25 labelled posting creates inside ## Rules, found ${labelled.length}`);
  // Every consequent — a `Create posting as` that opens a line — must be inside ## Rules. A mention
  // in running prose is fine; a fenced block of them in a note is what this guards against.
  const consequentLines = master.split('\n')
    .map((l, i) => ({ l, i })).filter(({ l }) => /^\s*(?:and\s+)?Create posting as "/.test(l));
  const rulesFrom = master.split('\n').findIndex((l) => /^## Rules\s*$/.test(l));
  const notesFrom = master.split('\n').findIndex((l) => /^## Notes\s*$/.test(l));
  for (const { l, i } of consequentLines) {
    assert.ok(i > rulesFrom && i < notesFrom,
      `"${l.trim().slice(0, 40)}" at line ${i + 1} is outside ## Rules`);
  }
  assert.equal(consequentLines.length, 25);

  // grammar §21.4: two creates of one entity with the same label in one arm is a parse error.
  for (const arm of rules[1].split(/\n\s*otherwise\b/)) {
    const inArm = [...arm.matchAll(/Create posting as "([a-z0-9-]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(inArm).size, inArm.length, `duplicate label in one arm: ${inArm.join(', ')}`);
  }

  // The three notes that said the scheme was not executed must be gone, in all three files.
  for (const f of ['journal-posting.md', 'invoice-posting.md', 'supplier-invoice-posting.md']) {
    const text = readFileSync(join(OM, 'processes', f), 'utf8');
    for (const stale of ['not an executed rule', 'is not executed', '§20.9', 'not a rule, because']) {
      assert.ok(!text.includes(stale), `${f} still says "${stale}" — it is no longer true`);
    }
  }
});

test('EXECUTABLE: runtime/polism/execute.js refuses an unbalanced entry, quoting the invariant', async () => {
  const { parseOperatingModel } = await import('../runtime/polism/parse.js');
  const { evaluate } = await import('../runtime/polism/execute.js');
  const parsed = await realModel();
  const model = parsed.model;
  assert.ok(model, 'parseOperatingModel returned no model');
  void parseOperatingModel;

  const base = () => ({
    'chart-of-accounts': { skr03: { ...CHART_DOC } },
    'accounting-period': {
      '2026-07': {
        'period-key': '2026-07', 'fiscal-year': 2026, month: 7, 'from-date': '2026-07-01',
        'to-date': '2026-07-31', chart: 'skr03', status: 'open', 'vat-return-filed': false,
        'trial-balance-agreed': false, 'bank-reconciled': false, 'carried-forward': false,
      },
    },
    'ledger-account': {
      'skr03-1400': { 'account-number': '1400', name: 'Forderungen', chart: 'skr03', 'account-type': 'asset', 'normal-balance': 'debit', 'statement-section': 'balance-sheet', 'vat-role': 'none', 'reconciliation-account-for': 'receivables', 'blocked-for-manual-posting': true, 'account-source': 'published-standard', 'opened-on': '2026-01-01', status: 'active' },
      'skr03-8400': { 'account-number': '8400', name: 'Erlöse 19 % USt', chart: 'skr03', 'account-type': 'revenue', 'normal-balance': 'credit', 'statement-section': 'profit-and-loss', 'vat-role': 'taxable-turnover', 'vat-kennzahl': '81', 'reconciliation-account-for': 'none', 'blocked-for-manual-posting': false, 'account-source': 'published-standard', 'opened-on': '2026-01-01', status: 'active' },
      'skr03-1776': { 'account-number': '1776', name: 'Umsatzsteuer 19 %', chart: 'skr03', 'account-type': 'liability', 'normal-balance': 'credit', 'statement-section': 'balance-sheet', 'vat-role': 'output-tax', 'vat-kennzahl': '81', 'reconciliation-account-for': 'vat', 'blocked-for-manual-posting': true, 'account-source': 'published-standard', 'opened-on': '2026-01-01', status: 'active' },
    },
    'journal-entry': {
      'JE-RT-0001': {
        'entry-number': 'JE-RT-0001', 'entry-date': '2026-07-05', 'document-date': '2026-07-05',
        'accounting-period': '2026-07', chart: 'skr03', currency: 'EUR',
        'debit-amount': '5949.99 EUR', 'credit-amount': '5949.99 EUR', 'posting-count': 3,
        description: 'Sales invoice R-2026-0001', 'source-document-type': 'sales-invoice',
        'source-document-reference': 'R-2026-0001', reversal: false, status: 'posted',
        'entered-by': 'employee-accountant-1', 'posted-by': 'employee-accountant-1', 'posted-at': '2026-07-05',
      },
    },
    posting: {
      'JE-RT-0001-1': posting(1, '1400', 'debit', '5949.99 EUR'),
      'JE-RT-0001-2': posting(2, '8400', 'credit', '4999.99 EUR'),
    },
  });

  function posting(position, account, side, amount) {
    return {
      'journal-entry': 'JE-RT-0001', position, 'account-number': account, chart: 'skr03',
      'ledger-account': `skr03-${account}`, side, amount, currency: 'EUR',
      'posting-date': '2026-07-05', 'accounting-period': '2026-07',
      description: `${account} ${side}`, 'source-document-reference': 'R-2026-0001', 'vat-role': 'none',
    };
  }

  const attempt = (amount) => evaluate(model, {
    op: 'create', entity: 'posting', id: 'JE-RT-0001-3',
    doc: posting(3, '1776', 'credit', amount),
    actorRoles: ['accountant'],
  }, worldOf(base()));

  // 19 % of 4,999.99 is 950.00. Booking 949.99 leaves the entry one cent short.
  const refused = attempt('949.99 EUR');
  assert.equal(refused.ok, false, 'an unbalanced entry must be refused');
  const text = (refused.violations || []).map((x) => `${x.reason || x.message || ''}`).join('\n');
  assert.match(text, /credit total agrees with the postings|debits equal credits/,
    `the refusal must quote the invariant by name. Got:\n${text}`);
  assert.match(text, /information\/journal-entry\.md/,
    'the refusal must name the file that declares the invariant');
  assert.match(text, /JE-RT-0001/, 'the refusal must name the document');

  // The same posting at 950.00 balances the entry and is accepted.
  const accepted = attempt('950.00 EUR');
  assert.equal(accepted.ok, true,
    `a balanced entry must be accepted. Violations:\n${(accepted.violations || []).map((x) => x.reason).join('\n')}`);
  assert.ok(accepted.changes.length >= 1, 'the accepted commit writes the posting');

  INVARIANTS_ARE_EXECUTABLE_IN_THE_RUNTIME.value = true;
  INVARIANTS_ARE_EXECUTABLE_IN_THE_RUNTIME.why =
    'runtime/polism/execute.js refuses an unbalanced entry through the declared invariants, and accepts the balanced one';
});

test('EXECUTABLE: a locked period refuses a posting dated inside it', async () => {
  const { evaluate } = await import('../runtime/polism/execute.js');
  const parsed = await realModel();
  const docs = {
    'chart-of-accounts': { skr03: { ...CHART_DOC } },
    'accounting-period': {
      '2026-07': { 'period-key': '2026-07', 'fiscal-year': 2026, month: 7, 'from-date': '2026-07-01', 'to-date': '2026-07-31', chart: 'skr03', status: 'locked', 'vat-return-filed': true, 'trial-balance-agreed': true, 'bank-reconciled': true, 'carried-forward': true, 'locked-on': '2026-08-10', 'locked-by': 'employee-controller-1' },
      '2026-08': { 'period-key': '2026-08', 'fiscal-year': 2026, month: 8, 'from-date': '2026-08-01', 'to-date': '2026-08-31', chart: 'skr03', status: 'open', 'vat-return-filed': false, 'trial-balance-agreed': false, 'bank-reconciled': false, 'carried-forward': false },
    },
    'ledger-account': { 'skr03-3980': { 'account-number': '3980', name: 'Bestand Waren', chart: 'skr03', 'account-type': 'asset', 'normal-balance': 'debit', 'statement-section': 'balance-sheet', 'vat-role': 'none', 'reconciliation-account-for': 'none', 'blocked-for-manual-posting': true, 'account-source': 'published-standard', 'opened-on': '2026-01-01', status: 'active' } },
    'journal-entry': {},
    posting: {},
  };
  const line = (date, period) => ({
    op: 'create', entity: 'posting', id: `P-${date}`, actorRoles: ['accountant'],
    doc: {
      'journal-entry': 'JE-RT-0009', position: 1, 'account-number': '3980', chart: 'skr03',
      'ledger-account': 'skr03-3980', side: 'debit', amount: '50.00 EUR', currency: 'EUR',
      'posting-date': date, 'accounting-period': period, description: 'correction',
      'source-document-reference': 'SA-2026-0007', 'vat-role': 'none',
    },
  });
  const inJuly = evaluate(parsed.model, line('2026-07-31', '2026-07'), worldOf(docs));
  assert.equal(inJuly.ok, false, 'a posting dated inside a locked period must be refused');
  const why = (inJuly.violations || []).map((x) => x.reason || '').join('\n');
  assert.match(why, /2026-07|locked/i, `the refusal must name the locked period. Got:\n${why}`);

  const inAugust = evaluate(parsed.model, line('2026-08-03', '2026-08'), worldOf(docs));
  const augustWhy = (inAugust.violations || []).map((x) => x.reason || '').join('\n');
  assert.ok(!/locked/i.test(augustWhy),
    `the same correction in the next open period must not be refused for the lock. Got:\n${augustWhy}`);
});


test('EXECUTABLE: line 83 of the VAT return is computed by counters and checked by an invariant', async () => {
  const { evaluate } = await import('../runtime/polism/execute.js');
  const parsed = await realModel();
  const docs = ledgerBase();
  const zero = '0.00 EUR';
  const base = {
    'period-key': PERIOD, 'accounting-period': PERIOD, 'fiscal-year': 2026, chart: 'skr03',
    currency: 'EUR',
    'kz-41-intra-community-supplies': zero, 'kz-43-other-exempt-with-deduction': '10500.00 EUR',
    'kz-45-non-taxable-turnover': '500.00 EUR', 'kz-81-taxable-19-base': '4999.99 EUR',
    'kz-81-taxable-19-tax': '950.00 EUR', 'kz-86-taxable-7-base': zero, 'kz-86-taxable-7-tax': zero,
    'kz-89-acquisitions-19-base': '12000.00 EUR', 'kz-89-acquisitions-19-tax': '2280.00 EUR',
    'kz-84-reverse-charge-tax': zero, 'kz-61-input-vat-on-acquisitions': '2280.00 EUR',
    'kz-66-input-vat-on-invoices': zero, 'kz-67-input-vat-reverse-charge': zero,
    'total-output-tax': '3230.00 EUR', 'total-input-tax': '2280.00 EUR',
    'bases-declared-in-full-euros': true, 'prepared-by': 'employee-accountant-1',
    'prepared-on': '2026-08-08', 'permanent-extension': false, status: 'draft',
    'computed-payable': zero,
  };
  const file = (payable) => evaluate(parsed.model, {
    op: 'create', entity: 'vat-return', id: `${PERIOD}-2026`,
    doc: { ...base, 'kz-83-payable': payable }, actorRoles: ['tax-accountant'],
  }, worldOf(docs));

  // 950.00 + 0 + 2,280.00 + 0 − 2,280.00 − 0 − 0 = 950.00
  const right = file('950.00 EUR');
  assert.equal(right.ok, true,
    `the correct return was refused: ${(right.violations || []).map((v) => v.reason).join('; ')}`);
  const written = right.changes.find((c) => c.entity === 'vat-return').after;
  assert.equal(written['computed-payable'], '950.00 EUR',
    'seven counters, four adding and three subtracting, compose into one sum');

  // One euro out, and the invariant refuses the whole commit.
  const wrong = file('951.00 EUR');
  assert.equal(wrong.ok, false, 'a line 83 that does not follow from the lines must be refused');
  const why = (wrong.violations || []).map((v) => `${v.reason} ${v.file}`).join('\n');
  assert.match(why, /line 83 adds up/, `the refusal must quote the invariant. Got:\n${why}`);
  assert.match(why, /information\/vat-return\.md/);
});

test('EXECUTABLE: a bank statement that does not add up is refused at import', async () => {
  const { evaluate } = await import('../runtime/polism/execute.js');
  const parsed = await realModel();
  const docs = ledgerBase();
  // Two credit lines, 5,949.99 + 10,300.00 = 16,249.99, so the movement invariants hold too.
  const line = (position, amount, date) => ({
    'bank-statement': 'BS-2026-07-014', position, 'value-date': date, 'booking-date': date,
    direction: 'credit', amount, currency: 'EUR', 'match-basis': 'reference-quoted',
    status: 'matched', 'accounting-period': PERIOD,
  });
  docs['bank-statement-line'] = {
    'BS-2026-07-014-1': line(1, '5949.99 EUR', '2026-07-15'),
    'BS-2026-07-014-2': line(2, '10300.00 EUR', '2026-07-28'),
  };
  const statement = (closing) => ({
    'statement-reference': '2026-07-014', 'bank-account-number': '1200',
    'ledger-account-number': '1200', currency: 'EUR', 'from-date': '2026-07-01',
    'to-date': '2026-07-31', 'opening-balance': '50000.00 EUR', 'closing-balance': closing,
    'total-credits': '16249.99 EUR', 'total-debits': '0.00 EUR', 'line-count': 2,
    'accounting-period': PERIOD, 'imported-by': 'employee-treasurer-1', 'imported-on': '2026-08-01',
    'document-hash': 'sha256-placeholder-bank-statement', status: 'imported',
    'computed-closing-balance': '0.00 EUR',
  });
  const load = (closing) => evaluate(parsed.model, {
    op: 'create', entity: 'bank-statement', id: 'BS-2026-07-014',
    doc: statement(closing), actorRoles: ['treasurer'],
  }, worldOf(docs));

  const ok = load('66249.99 EUR');
  assert.equal(ok.ok, true,
    `a statement that adds up was refused: ${(ok.violations || []).map((v) => v.reason).join('; ')}`);
  assert.equal(ok.changes.find((c) => c.entity === 'bank-statement').after['computed-closing-balance'],
    '66249.99 EUR', 'opening plus credits less debits, by three counters');

  const bad = load('66249.98 EUR');
  assert.equal(bad.ok, false, 'a statement one cent out must be refused at import');
  assert.match((bad.violations || []).map((v) => v.reason).join('\n'), /statement adds up/);
});

test('the releaser of a payment run must be a different person from the preparer', () => {
  const text = readFileSync(join(OM, 'processes', 'payment-run.md'), 'utf8');
  const rules = /## Rules\n([\s\S]*?)\n## Notes/.exec(text);
  const arms = rules[1].split(/\n\s*otherwise\b/).filter((a) => /\bwhen\b/.test(a));
  assert.equal(arms.length, 3, `expected three release arms, found ${arms.length}`);
  for (const arm of arms) {
    assert.match(arm, /released-by\.display-name is not prepared-by\.display-name/,
      'every release arm must require the releaser to differ from the preparer');
    assert.match(arm, /payment-run two signatures present/);
    assert.match(arm, /authoris?zed by/, 'every release arm carries its own authority');
  }
  // The reference-to-reference form is refused by the grammar; the one-hop form is what works.
  assert.ok(!/released-by is not prepared-by/.test(rules[1]),
    'comparing two references compares two documents, which = is not defined on (grammar §4.2)');
  assert.match(text.replace(/\s+/g, ' '),
    /two different named people, enforced; two different keys, not yet/,
    'the file must still say what four-eyes here is not');
});

test('counts, and everything still owed', () => {
  const invariants = [...MODEL.entities.values()].reduce((a, e) => a + e.invariants.size, 0);
  const predicates = [...MODEL.entities.values()].reduce((a, e) => a + e.predicates.size, 0);
  const enums = [...MODEL.entities.values()]
    .reduce((a, e) => a + [...e.fields.values()].filter((f) => f.type === 'enum').length, 0);
  const branched = MODEL.rules.filter((r) => (shapeV2(r.raw) || {}).branched).length;
  const perRuleAuth = MODEL.rules.filter((r) => (shapeV2(r.raw) || {}).ruleRoles).length;
  const armAuth = MODEL.rules.reduce((a, r) => a + ((shapeV2(r.raw) || { branches: [] }).branches || [])
    .filter((b) => b.armRoles).length, 0);
  const entityAuth = [...MODEL.entities.values()].filter((e) => e.authority).length;
  const datedIn = [...MODEL.entities.values()].filter((e) => e.datedIn).length;
  const periods = [...MODEL.entities.values()].filter((e) => e.period).length;
  const accounts = CHARTS.skr03.rows.length + CHARTS.skr04.rows.length + CHARTS.international.rows.length;

  console.log(`
  NeoDonkey general ledger — counts
    entities                  ${MODEL.entities.size}   (${LEDGER_ENTITIES.length} of them the ledger's)
    rules                     ${MODEL.rules.length}   (${branched} branched, ${perRuleAuth} rule-scope authority, ${armAuth} arm-scope authority)
    entity-scope authority    ${entityAuth} entities declare "- create/read/update/delete:"
    period declarations       ${periods} "## Period", ${datedIn} "## Dated in"
    invariants                ${invariants}
    predicates                ${predicates}
    enumerated fields         ${enums}
    roles                     ${MODEL.roles.size}
    accounts seeded           ${accounts}   (SKR03 ${CHARTS.skr03.rows.length}, SKR04 ${CHARTS.skr04.rows.length}, international ${CHARTS.international.rows.length})
    statement positions       ${POSITIONS.rows.length}
    model files               ${MODEL.files.length + MODEL.docFiles.length}
    worked month              9 entries, 23 postings
    trial balance             Summen 110,079.98 EUR each side; Salden 93,329.99 EUR each side

  Still owed
    balance invariant executable  ${INVARIANTS_ARE_EXECUTABLE_IN_THE_RUNTIME.value === true ? 'YES' : 'NO'} — ${INVARIANTS_ARE_EXECUTABLE_IN_THE_RUNTIME.why}
    grammar v2 constructs f-model.test.js refuses (v1 limits FD-5 removes):
${V2_CONSTRUCTS_F_MODEL_REFUSES.map(([c, t, f]) => `      ${c}  →  "${t}"  (${f})`).join('\n')}
`);

  assert.ok(MODEL.entities.size >= 36, `only ${MODEL.entities.size} entities`);
  assert.ok(MODEL.rules.length >= 40, `only ${MODEL.rules.length} rules`);
  assert.ok(invariants >= 30, `only ${invariants} invariants`);
  assert.ok(MODEL.roles.size >= 13, `only ${MODEL.roles.size} roles`);
  assert.ok(accounts === 81, `expected 81 seeded accounts, got ${accounts}`);
  assert.equal(INVARIANTS_ARE_EXECUTABLE_IN_THE_RUNTIME.value !== null, true,
    'the runtime probe must have run before this test');
});
