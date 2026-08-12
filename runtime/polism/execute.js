/**
 * runtime/polism/execute.js — the deterministic rule interpreter (Principle 11, Appendix XII).
 *
 * Given the operating model, one intent (a CRUD operation a person wants to perform) and a read
 * view of the current documents, this returns EITHER the reasons it is refused, OR the complete
 * set of Changes — the intent's own change plus every consequence — to be committed in ONE commit
 * (Appendix VIII).
 *
 * NO LLM. NO HEURISTICS. NO FUZZY MATCHING. Ever, anywhere in this file (Appendix XII, line 494:
 * "execution is deterministic. Just as a SQL interpreter is deterministic without understanding
 * the query"). Every decision this file makes was already decided by `parse.js` from the text the
 * company wrote — targeting plans, field types, predicate meanings. This file only follows them.
 *
 * No `Date.now()`, no `Math.random()`, no `node:*`, zero dependencies, pure function.
 */

/**
 * @typedef {import('./parse.js').Model} Model
 * @typedef {import('./parse.js').Rule} Rule
 * @typedef {{ id:string, entity:string, [field:string]:unknown }} Doc
 * @typedef {{ op:'create'|'read'|'update'|'delete', entity:string, id:string, doc:Doc,
 *             actorRoles:string[] }} Intent
 * @typedef {{ field:string, op:string, value?:unknown, from?:string }} Filter
 * @typedef {{ get(entity:string, id:string): Doc|null,
 *             find(entity:string, pred:(d:Doc)=>boolean): Doc[],
 *             matching?(entity:string, filter:Filter[]): Doc[]|null,
 *             aggregate?(spec:object): {value:string|number}|null }} World
 *   `matching` and `aggregate` are the OPTIONAL grammar-version-2 read-path contract
 *   (grammar.md §13.3). A world implementing neither still works: aggregation falls back to
 *   `find`, which every version-1 world has. That is why the kernel needed no change.
 * @typedef {{ op:'create'|'update'|'delete', entity:string, id:string,
 *             before:Doc|null, after:Doc|null }} Change
 * @typedef {{ rule:Rule|null, reason:string, file:string|null, line:number }} Violation
 * @typedef {{ ok:boolean, violations:Violation[], changes:Change[], appliedRules:Rule[] }} Result
 * @typedef {{ authorization?:'strict'|'permissive' }} Options
 *   `{ authorization: 'strict' }` refuses an entity-operation pair covered by no authority
 *   declaration at all (FD-7, grammar.md §16.2). The kernel owns the switch. Omitting the whole
 *   options object is grammar-version-1 behaviour, exactly.
 */

import {
  readMoney, writeMoney, describeAmount, compareAmounts, addAmounts, negateAmount,
  scaleDecimalFor, ZERO as MONEY_ZERO,
} from './money.js';

const MAX_PREDICATE_DEPTH = 32;

/** English article, so a refusal reads like a sentence a person wrote. */
const article = (word) => (/^[aeiou]/i.test(String(word)) ? 'an' : 'a');

/**
 * @param {Model} model
 * @param {Intent} intent
 * @param {World} world
 * @param {Options} [options] grammar version 2; absent = version-1 behaviour, exactly
 * @returns {Result}
 */
export function evaluate(model, intent, world, options = {}) {
  /** @type {Violation[]} */
  const violations = [];
  const op = String(intent.op || '').toLowerCase();
  const actorRoles = Array.isArray(intent.actorRoles) ? intent.actorRoles : [];
  const strict = options && options.authorization === 'strict';

  if (!['create', 'read', 'update', 'delete'].includes(op)) {
    return refuse(violations, null, `"${intent.op}" is not one of the four operations (Create, Read, Update, Delete).`);
  }

  // 1. The entity must be something the company has described. An operation on an undescribed
  //    kind of document is refused, not silently allowed (Principle 6).
  const entityDef = model.entities.get(intent.entity);
  if (!entityDef) {
    return refuse(violations, null,
      `"${intent.entity}" is not a kind of document this company has described.\n`
      + `  Describe it in operating-model/information/${intent.entity}.md before creating one.`);
  }

  // 2. The trigger document: before / after.
  const current = world.get(intent.entity, intent.id) || null;
  let before = null;
  let after = null;
  if (op === 'create') {
    if (current) {
      violations.push(v(null, `${article(intent.entity)} ${intent.entity} with the id "${intent.id}" already exists.`,
        entityDef.source.file, entityDef.source.line));
    }
    after = docFrom(intent.entity, intent.id, intent.doc);
  } else {
    if (!current) {
      violations.push(v(null, `there is no ${intent.entity} with the id "${intent.id}", so it cannot be ${op}d.`,
        entityDef.source.file, entityDef.source.line));
    }
    before = current ? deepClone(current) : null;
    if (op === 'update') {
      after = current ? docFrom(intent.entity, intent.id, { ...current, ...(intent.doc || {}) }) : null;
    } else if (op === 'delete') {
      after = null;
    } else {
      after = before; // read
    }
  }
  if (violations.length) return { ok: false, violations, changes: [], appliedRules: [] };

  /** The document the rules talk about: the intended result for create/update, the current one otherwise. */
  const subject = op === 'delete' || op === 'read' ? before : after;

  // 3. Fields declared `required` must be filled in (the declaration is in the operating model).
  if (op === 'create' || op === 'update') {
    for (const [, f] of entityDef.fields) {
      if (f.required && isEmpty(subject[f.name])) {
        violations.push(v(null,
          `"${f.name}" must be filled in on every ${intent.entity}.\n`
          + `  declared in ${f.source.file}:${f.source.line}: ${f.name} is required`,
          f.source.file, f.source.line));
      }
    }
  }

  // 4. Which rules speak about this operation? All of them apply; the order is file, then line
  //    (grammar.md §8) and `model.processes` is already sorted that way by the parser.
  const matching = model.processes.filter(
    (r) => r.trigger.op === op && r.trigger.entity === intent.entity,
  );

  // 4b. Enumerations (grammar version 2, §15). A value outside the declared list is refused in
  //     the data exactly as it is refused in the model text, so a foreign dialect cannot inject
  //     "delivrd" either.
  if (op === 'create' || op === 'update') {
    checkEnums(entityDef, subject, intent.entity, intent.id, violations);
    checkMoneyFields(entityDef, subject, intent.entity, intent.id, violations);
  }
  if (violations.length) return { ok: false, violations, changes: [], appliedRules: [] };

  // 4c. Default-deny, when the kernel asks for it (FD-7, grammar.md §16.2). Nothing uncovered is
  //     permitted; and this can never change the meaning of anything that IS covered.
  if (strict) {
    const uncovered = !matching.some(ruleCovers)
      && !(entityDef.authority && entityDef.authority.byOp.has(op));
    if (uncovered) {
      return refuse(violations, null,
        `nothing says who may ${verbPast(op)} ${article(intent.entity)} ${intent.entity}, and this `
        + 'workspace refuses what no one is authorised to do.\n'
        + `  Declare it in ${entityDef.source.file}:\n    ## Authorized by\n    - ${op}: <role>\n`
        + `  or write "authorized by <role>" on a rule that governs "${capitalize(op)} ${intent.entity}".`);
    }
  }

  // 4d. Entity-scope authority, when NO rule governs this operation (grammar.md §16.1).
  //     A rule that governs it already carries the entity default as its own authority (the
  //     parser composed the scopes), so this is the case the scopes cannot reach: an operation the
  //     process files say nothing about. Without this, `- delete: controller` in an entity file
  //     would be a declaration that did nothing — which is the version-0.1 defect, restated.
  const entityEntry = entityDef.authority ? entityDef.authority.byOp.get(op) : undefined;
  if (matching.length === 0 && entityEntry) {
    if (!entityEntry.roles.some((r) => actorRoles.includes(r))) {
      const at = { file: entityDef.authority.source.file, line: entityEntry.line };
      return refuse(violations, null,
        `${describeActor(actorRoles)} may not ${verbPast(op)} ${article(intent.entity)} ${intent.entity}.\n`
        + `  ${at.file}:${at.line} says:\n    ## Authorized by\n    - ${op}: ${entityEntry.roles.join(' or ')}`);
    }
  }

  // 5. Authorization, then conditions. Every failure is reported, not just the first, so that one
  //    rejection tells the whole story.
  const applicable = [];
  /** Which branch arm each applicable rule chose (grammar version 2, §14). */
  const chosenBranch = new Map();
  for (const rule of matching) {
    let blocked = false;
    // Grammar version 2: when a branch arm carries its own authority, the arm is not known until
    // the conditions have run, so the check moves after them. When no arm does, this is version 1,
    // in version 1's order.
    const armsCarryAuthority = (rule.branches || []).some((b) => b.inlineAuthority);
    const authorizationViolation = (roles, at) => v(rule,
      `${describeActor(actorRoles)} may not ${verbPast(op)} ${article(intent.entity)} ${intent.entity}.\n`
      + `  ${at.file}:${at.line} says:\n    ## Authorized by\n    ${roles.join(' or ')}`
      + `\n  ${quoteRule(rule)}`,
      at.file, at.line);

    if (!armsCarryAuthority
        && rule.authorizedBy.length && !rule.authorizedBy.some((r) => actorRoles.includes(r))) {
      violations.push(authorizationViolation(rule.authorizedBy, rule.authorizedBySource || rule.source));
      blocked = true;
    }
    for (const cond of rule.conditions) {
      const r = evalCondition(cond, subject, intent.entity, model, world, 0);
      if (!r.ok) {
        violations.push(v(rule,
          `the condition "${cond.text}" is not met: ${r.detail}\n  ${quoteRule(rule)}`,
          cond.source ? cond.source.file : rule.source.file, cond.line || rule.source.line));
        blocked = true;
      }
    }

    if (rule.branches && rule.branches.length && !blocked) {
      // §14.1: written order, first arm whose every condition holds, exactly one arm.
      let chosen = null;
      for (const branch of rule.branches) {
        if (branch.isDefault) { chosen = branch; break; }
        let holds = true;
        for (const cond of branch.conditions) {
          if (!evalCondition(cond, subject, intent.entity, model, world, 0).ok) { holds = false; break; }
        }
        if (holds) { chosen = branch; break; }
      }
      if (chosen) {
        chosenBranch.set(rule, chosen);
        const roles = chosen.authorizedBy || [];
        if (roles.length && !roles.some((r) => actorRoles.includes(r))) {
          violations.push(authorizationViolation(roles, chosen.authority.source));
          blocked = true;
        }
      } else if (rule.authorizedBy.length && !rule.authorizedBy.some((r) => actorRoles.includes(r))) {
        // No arm ran, but the rule still governs this operation.
        violations.push(authorizationViolation(rule.authorizedBy, rule.authorizedBySource || rule.source));
        blocked = true;
      }
    }
    if (!blocked) applicable.push(rule);
  }
  if (violations.length) return { ok: false, violations, changes: [], appliedRules: [] };

  // 6. The trigger's own change is always the first one.
  /** @type {Map<string, Change>} */
  const staged = new Map();
  const key = (e, i) => `${e}/${i}`;
  if (op !== 'read') {
    staged.set(key(intent.entity, intent.id), {
      op: op === 'update' ? 'update' : op,
      entity: intent.entity,
      id: intent.id,
      before,
      after: after ? deepClone(after) : null,
    });
  }

  // 7. Consequences.
  //    `setBy` remembers which rule set which field, so that two rules disagreeing about the same
  //    field is a refusal rather than a last-writer-wins. It is bookkeeping, never part of a Change.
  const ctx = { model, world, staged, key, subject, intent, violations, setBy: new Map() };
  for (const rule of applicable) {
    const branch = chosenBranch.get(rule);
    const list = branch ? branch.consequents : rule.consequents;
    for (const cons of list) applyConsequent(cons, rule, ctx);
  }
  if (violations.length) return { ok: false, violations, changes: [], appliedRules: [] };

  // 8. Every required field must still hold on every document we are about to write, every
  //    enumeration must still hold a declared value, and every money field must still be exact.
  for (const change of staged.values()) {
    if (!change.after) continue;
    const def = model.entities.get(change.entity);
    if (!def) continue;
    for (const [, f] of def.fields) {
      if (f.required && isEmpty(change.after[f.name])) {
        violations.push(v(null,
          `"${f.name}" must be filled in on every ${change.entity}, but ${change.entity} "${change.id}" would have none.\n`
          + `  declared in ${f.source.file}:${f.source.line}: ${f.name} is required`,
          f.source.file, f.source.line));
      }
    }
    checkEnums(def, change.after, change.entity, change.id, violations);
    checkMoneyFields(def, change.after, change.entity, change.id, violations);
  }
  if (violations.length) return { ok: false, violations, changes: [], appliedRules: [] };

  // 9. Periods (grammar version 2, §18). A document dated inside a locked period cannot be
  //    created, changed or deleted — which is what makes "correction is a new entry, never a
  //    mutation" fall out rather than be bolted on. No clock is read: the date is a field.
  checkPeriods(model, world, staged, violations);
  if (violations.length) return { ok: false, violations, changes: [], appliedRules: [] };

  // 10. Invariants (grammar version 2, §12). Evaluated over the STAGED world — the world with
  //     every change in this commit already applied — so a journal entry's postings balance as a
  //     set, and an invariant broken by a consequent is caught.
  checkInvariants(model, world, staged, violations);
  if (violations.length) return { ok: false, violations, changes: [], appliedRules: [] };

  return { ok: true, violations: [], changes: [...staged.values()], appliedRules: applicable };
}

const capitalize = (s) => String(s)[0].toUpperCase() + String(s).slice(1);

/** Does this rule carry authority for every path through it? (grammar.md §16.2) */
function ruleCovers(rule) {
  if (rule.authorizedBy && rule.authorizedBy.length) return true;
  if (rule.branches && rule.branches.length) {
    return rule.branches.every((b) => b.authorizedBy && b.authorizedBy.length);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Enumerations and money in the data (grammar.md §15, §19)
// ---------------------------------------------------------------------------------------------

function checkEnums(def, doc, entity, id, violations) {
  if (!doc) return;
  for (const [, f] of def.fields) {
    if (f.type !== 'enum') continue;
    const value = doc[f.name];
    if (isEmpty(value)) continue;
    if (f.values.includes(String(value))) continue;
    violations.push(v(null,
      `"${f.name}" on ${entity} "${id}" is ${fmt(value)}, which is not one of the values a ${entity} may have.\n`
      + `  declared in ${f.source.file}:${f.source.line}: ${f.name}: one of ${f.values.join(', ')}`,
      f.source.file, f.source.line));
  }
}

/**
 * A money field holds FD-1's canonical token and nothing else. A JSON number here is the exact
 * defect that made 19 % VAT on 4 999.99 evaluate to 949.9981, so it is refused where it is read
 * rather than coerced, rounded or repaired.
 */
function checkMoneyFields(def, doc, entity, id, violations) {
  if (!doc) return;
  for (const [, f] of def.fields) {
    if (f.type !== 'money') continue;
    const value = doc[f.name];
    if (isEmpty(value)) continue;
    const r = readMoney(value);
    if (r.ok) continue;
    violations.push(v(null,
      `"${f.name}" on ${entity} "${id}" is not an exact amount: ${r.reason}.\n`
      + `  declared in ${f.source.file}:${f.source.line}: ${f.name}: money\n`
      + `  ${r.expected}`,
      f.source.file, f.source.line));
  }
}

// ---------------------------------------------------------------------------------------------
// Violations
// ---------------------------------------------------------------------------------------------

function v(rule, reason, file, line) {
  return { rule: rule || null, reason, file: file || (rule ? rule.source.file : null), line: line || (rule ? rule.source.line : 0) };
}

function refuse(violations, rule, reason) {
  violations.push(v(rule, reason, rule ? rule.source.file : null, rule ? rule.source.line : 0));
  return { ok: false, violations, changes: [], appliedRules: [] };
}

/** The rule, quoted, by file and line — so a rejection is always traceable to the sentence. */
function quoteRule(rule) {
  const body = rule.text.split('\n').map((l) => `    ${l.trim()}`).join('\n');
  return `refused by the rule in ${rule.source.file}:${rule.source.line}:\n${body}`;
}

function describeActor(roles) {
  if (!roles.length) return 'someone with no role';
  return `someone whose role is ${roles.map((r) => `"${r}"`).join(' / ')}`;
}
const verbPast = (op) => (op === 'create' ? 'create' : op === 'read' ? 'read' : op === 'update' ? 'change' : 'delete');

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

function docFrom(entity, id, fields) {
  const out = { id: String(id), entity };
  for (const k of Object.keys(fields || {})) {
    if (k === 'id' || k === 'entity') continue;
    out[k] = deepClone(fields[k]);
  }
  return out;
}

function deepClone(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(deepClone);
  const out = {};
  for (const k of Object.keys(x)) out[k] = deepClone(x[k]);
  return out;
}

const isEmpty = (x) => x === undefined || x === null || x === '';

function sameValue(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' || typeof b === 'object') return false;
  return String(a) === String(b);
}

function fmt(x) {
  if (x === undefined || x === null) return 'nothing';
  if (typeof x === 'string') return `"${x}"`;
  return String(x);
}

// ---------------------------------------------------------------------------------------------
// Paths — following the steps `parse.js` computed from the entity declarations
// ---------------------------------------------------------------------------------------------

/**
 * @returns {{kind:'doc', doc:Doc, entity:string, id:string|null}
 *          | {kind:'scalar', value:unknown, type:string, field:string, ownerEntity:string, ownerId:string|null}
 *          | {kind:'missing', detail:string}}
 */
function follow(steps, doc, world) {
  let cur = { kind: 'doc', doc, entity: steps[0].entity, id: doc ? String(doc.id) : null };
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (cur.kind !== 'doc' || !cur.doc) return { kind: 'missing', detail: 'the document it refers to is not there' };
    if (s.step === 'ref') {
      const id = cur.doc[s.field];
      if (isEmpty(id)) return { kind: 'missing', detail: `no ${s.field} is filled in on the ${cur.entity}` };
      const d = world.get(s.entity, String(id));
      if (!d) return { kind: 'missing', detail: `there is no ${s.entity} with the id ${fmt(String(id))}` };
      cur = { kind: 'doc', doc: d, entity: s.entity, id: String(id) };
    } else {
      const value = cur.doc[s.field];
      if (isEmpty(value)) return { kind: 'missing', detail: `${s.field} is not filled in on ${cur.entity} ${fmt(cur.id)}` };
      cur = { kind: 'scalar', value, type: s.type, field: s.field, ownerEntity: cur.entity, ownerId: cur.id };
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------------------------
// The staged world (grammar.md §12.1) — the world with every change of THIS commit applied.
//
// Invariants and periods read this, not the index: a journal entry's postings balance as a set,
// and the set is only complete inside the one atomic commit that writes it. The index knows
// nothing about staged changes, so `aggregate()` is deliberately not offered here — but
// `matching()` still is, so an index-backed world narrows the base set and only the few staged
// documents are overlaid on top.
// ---------------------------------------------------------------------------------------------

function stagedWorld(world, staged) {
  const byEntity = new Map();
  for (const c of staged.values()) {
    if (!byEntity.has(c.entity)) byEntity.set(c.entity, new Map());
    byEntity.get(c.entity).set(String(c.id), c);
  }
  const overlay = (entity, base) => {
    const staged0 = byEntity.get(entity);
    const out = [];
    for (const d of base) {
      const c = staged0 && staged0.get(String(d.id));
      if (c) continue; // replaced or deleted below
      out.push(d);
    }
    if (staged0) for (const c of staged0.values()) if (c.after) out.push(c.after);
    return out.sort(byIdAscending);
  };
  return {
    get(entity, id) {
      const staged0 = byEntity.get(entity);
      const c = staged0 && staged0.get(String(id));
      if (c) return c.after;
      return world.get(entity, id);
    },
    find(entity, pred) {
      return overlay(entity, world.find(entity, () => true) || []).filter(pred);
    },
    matching(entity, filter) {
      let base = null;
      if (typeof world.matching === 'function') base = world.matching(entity, filter);
      if (base === null || base === undefined) base = world.find(entity, () => true) || [];
      return overlay(entity, base).filter((d) => filter.every((f) => matchFilter(d, f)));
    },
  };
}

const byIdAscending = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

// ---------------------------------------------------------------------------------------------
// Aggregation (grammar.md §13). polism asks a question the index can answer; polism always does
// the arithmetic itself, exactly (FD-1).
// ---------------------------------------------------------------------------------------------

/** The value a resolved filter compares against, with the context document's id filled in. */
function filtersFor(agg, doc) {
  return agg.resolved.filters.map((f) => {
    if (f.from === 'context-id') {
      return { field: f.field, op: '=', value: doc ? String(doc.id) : null, fieldType: 'text' };
    }
    if (f.op === 'exists' || f.op === 'not exists') {
      return { field: f.field, op: f.op, fieldType: f.fieldType };
    }
    return { field: f.field, op: f.op, value: f.value.value, fieldType: f.fieldType };
  });
}

/** Apply one declarative Filter to a document. Exact for money; never a float. */
function matchFilter(d, f) {
  const actual = d[f.field];
  if (f.op === 'exists') return !isEmpty(actual);
  if (f.op === 'not exists') return isEmpty(actual);
  if (f.op === '=' || f.op === '!=') {
    const eq = sameValue(actual, f.value);
    return f.op === '=' ? eq : !eq;
  }
  if (f.fieldType === 'money') {
    const a = readMoney(actual);
    const b = readMoney(f.value);
    if (!a.ok || !b.ok) return false;
    const c = compareAmounts(a.amount, b.amount);
    if (!c.ok) return false;
    return f.op === '>' ? c.cmp > 0 : f.op === '>=' ? c.cmp >= 0 : f.op === '<' ? c.cmp < 0 : c.cmp <= 0;
  }
  if (isEmpty(actual)) return false;
  return f.op === '>' ? actual > f.value : f.op === '>=' ? actual >= f.value
    : f.op === '<' ? actual < f.value : actual <= f.value;
}

/**
 * Evaluate an aggregate.
 * @returns {{ok:true, type:string, value:unknown, count:number}|{ok:false, detail:string}}
 */
function evalAggregate(agg, doc, world) {
  const res = agg.resolved;
  if (!res) return { ok: false, detail: `the runtime does not know how to work out "${agg.text}" — the model did not parse cleanly` };
  const filter = filtersFor(agg, doc);
  if (filter.some((f) => f.op === '=' && f.value === null)) {
    return { ok: false, detail: `there is no document to work "${agg.text}" out for` };
  }

  // §13.3, fast path: the index may answer the aggregate itself. A money answer is re-validated
  // against FD-1's canonical form before it is used — never trusted.
  if (typeof world.aggregate === 'function') {
    const got = world.aggregate({
      kind: agg.fn, entity: res.entity, field: res.field, fieldType: res.fieldType, filter,
    });
    if (got !== null && got !== undefined && got.value !== undefined) {
      if (agg.fn === 'count') {
        if (!Number.isInteger(got.value) || got.value < 0) {
          return { ok: false, detail: `the read path answered "${agg.text}" with ${fmt(got.value)}, which is not a count` };
        }
        return { ok: true, type: 'number', value: got.value, count: got.value };
      }
      if (res.fieldType === 'money') {
        const r = readMoney(got.value);
        if (!r.ok) {
          return { ok: false, detail: `the read path answered "${agg.text}" with ${fmt(got.value)}, which is not an exact amount: ${r.reason}` };
        }
        return { ok: true, type: 'money', value: r.amount, count: -1 };
      }
      if (typeof got.value !== 'number' || !Number.isFinite(got.value)) {
        return { ok: false, detail: `the read path answered "${agg.text}" with ${fmt(got.value)}, which is not a number` };
      }
      return { ok: true, type: 'number', value: got.value, count: -1 };
    }
  }

  let docs = null;
  if (typeof world.matching === 'function') docs = world.matching(res.entity, filter);
  if (docs === null || docs === undefined) {
    docs = world.find(res.entity, (d) => filter.every((f) => matchFilter(d, f))) || [];
  } else {
    // Belt and braces: the world may legitimately over-return, and the answer must not depend on
    // how completely it narrowed.
    docs = docs.filter((d) => filter.every((f) => matchFilter(d, f)));
  }
  // Deterministic on every peer, whatever order the index hands rows back in (§13.3).
  docs = docs.slice().sort(byIdAscending);

  if (agg.fn === 'count') return { ok: true, type: 'number', value: docs.length, count: docs.length };

  if (res.fieldType === 'money') {
    let total = MONEY_ZERO;
    let firstCurrency = null;
    let firstId = null;
    for (const d of docs) {
      const raw = d[res.field];
      if (isEmpty(raw)) continue;
      const r = readMoney(raw);
      if (!r.ok) {
        return { ok: false, detail: `${res.entity} "${d.id}" has ${res.field} ${fmt(raw)}, which is not an exact amount: ${r.reason}` };
      }
      const sum = addAmounts(total, r.amount);
      if (!sum.ok) {
        return {
          ok: false,
          detail: `"${agg.text}" cannot be worked out: ${res.entity} "${firstId}" is in ${firstCurrency} `
            + `and ${res.entity} "${d.id}" is in ${r.amount.currency}. ${sum.reason}`,
        };
      }
      if (firstCurrency === null) { firstCurrency = r.amount.currency; firstId = String(d.id); }
      total = sum.amount;
    }
    // An empty set is the currency-free zero, never NaN and never a refusal (§19.3).
    return { ok: true, type: 'money', value: total, count: docs.length };
  }

  let total = 0;
  for (const d of docs) {
    const value = d[res.field];
    if (isEmpty(value)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, detail: `${res.entity} "${d.id}" has ${res.field} ${fmt(value)}, which is not a number` };
    }
    total += value;
  }
  return { ok: true, type: 'number', value: total, count: docs.length };
}

/** How a total reads in a refusal. */
function fmtAggregate(a) {
  if (a.type === 'money') return describeAmount(a.value);
  return String(a.value);
}

// ---------------------------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------------------------

/** @returns {{ok:boolean, detail:string}} */
function evalCondition(cond, doc, ctxEntity, model, world, depth) {
  // Grammar version 2, §13: the subject may be a total instead of a field.
  if (cond.subjectAgg) {
    const left = evalAggregate(cond.subjectAgg, doc, world);
    if (!left.ok) return { ok: false, detail: left.detail };
    return compareSides(cond, left.type, left.value, cond.subject.text, doc, model, world);
  }
  if (!cond.resolved) {
    // Unreachable for a model that parsed without errors. Refuse rather than guess.
    return { ok: false, detail: `the runtime does not know how to read "${cond.subject ? cond.subject.text : cond.text}" — the model did not parse cleanly` };
  }
  const r = follow(cond.resolved.steps, doc, world);

  if (cond.kind === 'exists') {
    const present = r.kind !== 'missing';
    if (cond.negated) {
      return present
        ? { ok: false, detail: `${cond.subject.text} does exist${r.kind === 'doc' && r.id ? ` (${r.entity} ${fmt(r.id)})` : ''}` }
        : { ok: true, detail: `${cond.subject.text} does not exist` };
    }
    return present
      ? { ok: true, detail: `${cond.subject.text} exists` }
      : { ok: false, detail: r.detail };
  }

  if (cond.kind === 'compare') {
    if (r.kind === 'missing') return { ok: false, detail: r.detail };
    if (r.kind !== 'scalar') return { ok: false, detail: `${cond.subject.text} is a whole document, not a single value` };
    return compareSides(cond, r.type, r.value, cond.subject.text, doc, model, world);
  }

  // named predicate — its meaning is declared in the entity file, never known here
  if (r.kind === 'missing') return { ok: false, detail: `"${cond.name}" cannot be checked: ${r.detail}` };
  if (r.kind !== 'doc' || !r.doc) return { ok: false, detail: `"${cond.name}" cannot be checked on ${cond.subject.text}` };
  const owner = model.entities.get(r.entity);
  const pred = owner && owner.predicates.get(cond.name);
  if (!pred) {
    return { ok: false, detail: `"${cond.name}" is not declared for ${r.entity} — the model did not parse cleanly` };
  }
  const res = evalPredicate(pred, r, model, world, depth + 1);
  if (cond.negated) {
    return res.ok
      ? { ok: false, detail: `${r.entity} ${fmt(r.id)} is ${cond.name} (${pred.source.file}:${pred.source.line} — "${pred.name}: ${pred.text}"; ${res.detail})` }
      : { ok: true, detail: `${r.entity} ${fmt(r.id)} is not ${cond.name}` };
  }
  return res.ok
    ? { ok: true, detail: `${r.entity} ${fmt(r.id)} is ${cond.name} (${res.detail})` }
    : { ok: false, detail: `${r.entity} ${fmt(r.id)} is not ${cond.name} (${pred.source.file}:${pred.source.line} — "${pred.name}: ${pred.text}"; ${res.detail})` };
}

/**
 * The one comparison. Both sides may be a field, a literal, or a total (grammar.md §13); a money
 * side goes through exact arithmetic and never through a float (FD-1, §19).
 *
 * The wording of every version-1 message is preserved exactly, which is what makes the
 * version-1 regression assertions in test/c-polism.test.js still meaningful.
 */
function compareSides(cond, leftType, leftValue, subjectText, doc, model, world) {
  // ---- the right-hand side: a total, another field, or a literal (grammar.md §4.2, §13)
  let expected;
  let expectedText;
  let rightType = null;
  if (cond.valueAgg) {
    const right = evalAggregate(cond.valueAgg, doc, world);
    if (!right.ok) return { ok: false, detail: right.detail };
    expected = right.value;
    rightType = right.type;
    expectedText = `${cond.valueAgg.text} (${fmtAggregate(right)})`;
  } else if (cond.valuePath) {
    if (!cond.resolvedValue) return { ok: false, detail: `the runtime does not know how to read "${cond.valuePath.text}" — the model did not parse cleanly` };
    const rr = follow(cond.resolvedValue.steps, doc, world);
    if (rr.kind === 'missing') return { ok: false, detail: rr.detail };
    if (rr.kind !== 'scalar') return { ok: false, detail: `${cond.valuePath.text} is a whole document, not a single value` };
    expected = rr.value;
    rightType = rr.type;
    expectedText = `${cond.valuePath.text} (${fmt(expected)})`;
  } else {
    expected = cond.value.type === 'money' ? cond.value.amount : cond.value.value;
    rightType = cond.value.type === 'money' ? 'money' : null;
    expectedText = cond.value.type === 'money' ? `"${cond.value.value}"` : fmt(expected);
  }

  // ---- money: exact, currency-aware, and refused rather than converted (FD-1)
  if (leftType === 'money' || rightType === 'money') {
    const left = toAmount(leftValue, leftType, subjectText);
    if (!left.ok) return { ok: false, detail: left.detail };
    const right = toAmount(expected, rightType, expectedText, left.amount.currency, cond.value);
    if (!right.ok) return { ok: false, detail: right.detail };
    const shown = describeAmount(left.amount);
    const c = compareAmounts(left.amount, right.amount);
    if (!c.ok) {
      return { ok: false, detail: `${subjectText} is ${shown}, and it cannot be compared with ${expectedText}: ${c.reason}` };
    }
    const ok = cond.op === '=' ? c.cmp === 0 : cond.op === '!=' ? c.cmp !== 0
      : cond.op === '>' ? c.cmp > 0 : cond.op === '>=' ? c.cmp >= 0
        : cond.op === '<' ? c.cmp < 0 : c.cmp <= 0;
    return {
      ok,
      detail: ok ? `${subjectText} is ${shown}`
        : `${subjectText} is ${shown}, not ${opWords(cond.op)} ${expectedText}`,
    };
  }

  const actual = leftValue;
  if (cond.op === '=' || cond.op === '!=') {
    const eq = sameValue(actual, expected);
    const ok = cond.op === '=' ? eq : !eq;
    return {
      ok,
      detail: ok
        ? `${subjectText} is ${fmt(actual)}`
        : `${subjectText} is ${fmt(actual)}, not ${opWords(cond.op)} ${expectedText}`,
    };
  }
  // ordered comparison: the declared type decides how (grammar.md §2.1)
  if (leftType === 'number') {
    if (typeof actual !== 'number' || !Number.isFinite(actual)) {
      return { ok: false, detail: `${subjectText} is ${fmt(actual)}, which is not a number (it is declared as ${leftType})` };
    }
    if (typeof expected !== 'number' || !Number.isFinite(expected)) {
      return { ok: false, detail: `${expectedText} is not a number, so ${subjectText} cannot be compared with it` };
    }
    const ok = compareNumbers(actual, cond.op, expected);
    return { ok, detail: `${subjectText} is ${fmt(actual)}${ok ? '' : `, not ${opWords(cond.op)} ${expectedText}`}` };
  }
  // date: ISO-8601 strings compare lexicographically = chronologically
  const a = String(actual);
  const b = String(expected);
  const ok = cond.op === '>' ? a > b : cond.op === '>=' ? a >= b : cond.op === '<' ? a < b : a <= b;
  return { ok, detail: `${subjectText} is ${fmt(actual)}${ok ? '' : `, not ${opWords(cond.op)} ${expectedText}`}` };
}

const isAmount = (x) => x !== null && typeof x === 'object' && typeof x.minor === 'bigint';

/**
 * Turn one side of a comparison into an exact Amount.
 *
 * A bare number against money keeps its grammar-version-1 meaning (§19.2): it is scaled from its
 * SOURCE TEXT to the other side's currency, so `payable-amount > 0` still works and no `Number`
 * ever participates in the arithmetic.
 */
function toAmount(value, type, text, currencyHint, literalNode) {
  if (isAmount(value)) return { ok: true, amount: value };
  if (typeof value === 'string') {
    const r = readMoney(value);
    if (r.ok) return { ok: true, amount: r.amount };
    return { ok: false, detail: `${text} is ${fmt(value)}, which is not an exact amount: ${r.reason}` };
  }
  if (typeof value === 'number') {
    const raw = literalNode && literalNode.raw !== undefined ? literalNode.raw : String(value);
    if (!currencyHint) {
      // The other side is the currency-free zero (§19.3), so only the sign can matter — and the
      // sign is read off the text, exactly.
      const sign = /^-/.test(raw) ? -1 : /^-?0*(\.0*)?$/.test(raw) ? 0 : 1;
      return { ok: true, amount: { minor: BigInt(sign), currency: null } };
    }
    const s = scaleDecimalFor(raw, currencyHint);
    if (!s.ok) return { ok: false, detail: `${text} cannot be compared exactly: ${s.reason}` };
    return { ok: true, amount: { minor: s.minor, currency: currencyHint } };
  }
  void type;
  return { ok: false, detail: `${text} is ${fmt(value)}, which is not an amount of money` };
}

function evalPredicate(pred, docRef, model, world, depth) {
  if (depth > MAX_PREDICATE_DEPTH) {
    return { ok: false, detail: `"${pred.name}" is defined through more than ${MAX_PREDICATE_DEPTH} other predicates` };
  }
  const details = [];
  for (const c of pred.conditions) {
    const r = evalCondition(c, docRef.doc, docRef.entity, model, world, depth);
    if (!r.ok) return { ok: false, detail: r.detail };
    details.push(r.detail);
  }
  return { ok: true, detail: details.join(' and ') };
}

function compareNumbers(a, op, b) {
  return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : a <= b;
}

function opWords(op) {
  return { '>': 'greater than', '>=': 'at least', '<': 'less than', '<=': 'at most', '=': 'equal to', '!=': 'different from' }[op] || op;
}

// ---------------------------------------------------------------------------------------------
// Consequences
// ---------------------------------------------------------------------------------------------

function applyConsequent(cons, rule, ctx) {
  const { model, world, staged, key, subject, intent, violations } = ctx;
  const targetDef = model.entities.get(cons.entity);
  if (!targetDef) {
    violations.push(v(rule, `"${cons.entity}" is not a kind of document this company has described.\n  ${quoteRule(rule)}`,
      rule.source.file, cons.line));
    return;
  }

  // --- obligations first: `with <field>` means the triggering document must carry it.
  for (const cl of cons.clauses) {
    if (cl.kind !== 'require') continue;
    if (isEmpty(subject[cl.field])) {
      violations.push(v(rule,
        `"${cl.field}" was not captured on this ${intent.entity}, but the rule requires it: "${cons.text}".\n  ${quoteRule(rule)}`,
        rule.source.file, cl.line));
    }
  }
  if (violations.length) return;

  if (cons.verb === 'create') {
    // Grammar version 2, §21: a label makes the id `<trigger-id>-<label>`, so one rule can create
    // the two-to-four postings of a journal entry. No counter, no clock, no randomness — the id is
    // a pure function of the trigger and the text the company wrote, and it reads in `git log` as
    // "posting JE-0042-receivable", which tells an auditor which leg of the entry it is.
    const id = cons.label ? `${String(intent.id)}-${cons.label}` : String(intent.id);
    const k = key(cons.entity, id);
    if (staged.has(k) || world.get(cons.entity, id)) {
      violations.push(v(rule,
        `${article(cons.entity)} ${cons.entity} with the id "${id}" already exists, so "${cons.text}" cannot happen.\n  ${quoteRule(rule)}`,
        rule.source.file, cons.line));
      return;
    }
    const doc = { id, entity: cons.entity };
    for (const fname of cons.copiedFields || []) {
      if (!isEmpty(subject[fname])) doc[fname] = deepClone(subject[fname]);
    }
    // The child says whose child it is (§21). Set before the `with` clauses, so a rule that wants
    // to say it explicitly still wins — the plan came from parse.js, the value from the intent.
    if (cons.backReference) doc[cons.backReference] = String(intent.id);
    const change = { op: 'create', entity: cons.entity, id, before: null, after: doc };
    staged.set(k, change);
    applyClauses(cons, rule, change, ctx);
    return;
  }

  // --- Update / Delete: which document? The plan comes from parse.js (grammar.md §5.1).
  const found = resolveTarget(cons, rule, ctx, targetDef);
  if (!found) return; // a violation was recorded, or the target was created on demand

  if (cons.verb === 'delete') {
    if (found.change.op === 'create') {
      violations.push(v(rule,
        `${cons.entity} "${found.change.id}" is created and deleted by the same event, which cannot both be true.\n  ${quoteRule(rule)}`,
        rule.source.file, cons.line));
      return;
    }
    found.change.after = null;
    found.change.op = 'delete';
    return;
  }
  if (found.change.op === 'delete') {
    violations.push(v(rule,
      `${cons.entity} "${found.change.id}" is deleted and changed by the same event, which cannot both be true.\n  ${quoteRule(rule)}`,
      rule.source.file, cons.line));
    return;
  }
  applyClauses(cons, rule, found.change, ctx);
}

/**
 * Read a `from` source (grammar.md §17.1): the trigger's own field, or one hop through a reference.
 *
 * Deliberately reads the stored VALUE, not the dereferenced document — so
 * `with ledger-account from chart.receivables-account` copies the id, which is what a
 * `reference to ledger-account` field holds.
 *
 * @returns {{ok:true, value:unknown}|{ok:false, detail:string}}
 */
function readFrom(resolved, subject, world) {
  let cursor = subject;
  for (let i = 0; i < resolved.steps.length; i++) {
    const s = resolved.steps[i];
    if (s.step === 'ref') {
      const id = cursor[s.field];
      if (isEmpty(id)) return { ok: false, detail: `no ${s.field} is filled in on it` };
      const doc = world.get(s.entity, String(id));
      if (!doc) return { ok: false, detail: `there is no ${s.entity} with the id ${fmt(String(id))}` };
      cursor = doc;
      continue;
    }
    return { ok: true, value: cursor[s.field] };
  }
  return { ok: false, detail: 'the runtime does not know how to read it — the model did not parse cleanly' };
}

function applyClauses(cons, rule, change, ctx) {
  const { subject, intent, violations, setBy } = ctx;
  for (const cl of cons.clauses) {
    const doc = change.after;
    if (!doc) continue;
    if (cl.kind === 'set') {
      const marker = `${change.entity}/${change.id}/${cl.field}`;
      const prev = setBy.get(marker);
      if (prev && !sameValue(prev.value, cl.value.value)) {
        violations.push(v(rule,
          `two rules disagree about ${cons.entity} "${change.id}": ${prev.rule.source.file}:${prev.rule.source.line} sets ${cl.field} to ${fmt(prev.value)}, `
          + `${rule.source.file}:${rule.source.line} sets it to ${fmt(cl.value.value)}. The runtime does not pick one.\n  ${quoteRule(rule)}`,
          rule.source.file, cl.line));
        continue;
      }
      doc[cl.field] = cl.value.value;
      setBy.set(marker, { value: cl.value.value, rule });
    } else if (cl.kind === 'require') {
      // already checked; carry the captured value over to the target document
      if (!isEmpty(subject[cl.field])) doc[cl.field] = deepClone(subject[cl.field]);
    } else if (cl.kind === 'copy') {
      // Grammar version 2, §17 (FD-5 item 9). The plan came from parse.js; this follows it.
      const got = readFrom(cl.resolvedFrom, subject, ctx.world);
      if (!got.ok) {
        violations.push(v(rule,
          `"with ${cl.field} from ${cl.from.text}" cannot be done: ${got.detail}.\n  ${quoteRule(rule)}`,
          rule.source.file, cl.line));
        continue;
      }
      // An EMPTY source writes nothing, rather than writing an empty value: if the target is
      // declared `required`, the required-field check refuses the commit and names the field, which
      // is a better message than "it is empty" from here. A MISSING referenced document is
      // different and is refused above — the model asserted a relationship that is not there.
      if (!isEmpty(got.value)) doc[cl.field] = deepClone(got.value);
    } else {
      // Grammar version 2, §17: `+<field> from <other-field>` names the source field explicitly,
      // and it may be one hop away — resolved by parse.js, followed blindly here.
      const srcField = cl.from ? cl.from.text : cl.field;
      let delta;
      if (cl.resolvedFrom) {
        const got = readFrom(cl.resolvedFrom, subject, ctx.world);
        if (!got.ok) {
          violations.push(v(rule,
            `"${cons.text}" reads ${srcField} of this ${intent.entity}, but ${got.detail}.\n  ${quoteRule(rule)}`,
            rule.source.file, cl.line));
          continue;
        }
        delta = got.value;
      } else {
        delta = subject[srcField];
      }
      const targetDef = ctx.model.entities.get(change.entity);
      const tf = targetDef ? targetDef.fields.get(cl.field) : null;

      if (tf && tf.type === 'money') {
        // FD-1: exact, and mixed currencies are refused rather than converted.
        const d = readMoney(delta);
        if (!d.ok) {
          violations.push(v(rule,
            `"${cons.text}" adds the ${srcField} of this ${intent.entity} to ${cons.entity} "${change.id}", but its ${srcField} is ${fmt(delta)}, which is not an exact amount: ${d.reason}.\n  ${quoteRule(rule)}`,
            rule.source.file, cl.line));
          continue;
        }
        const base = doc[cl.field];
        let start = { minor: 0n, currency: d.amount.currency };
        if (!isEmpty(base)) {
          const b = readMoney(base);
          if (!b.ok) {
            violations.push(v(rule,
              `${cons.entity} "${change.id}" has ${cl.field} ${fmt(base)}, which is not an exact amount, so it cannot be counted up: ${b.reason}.\n  ${quoteRule(rule)}`,
              rule.source.file, cl.line));
            continue;
          }
          start = b.amount;
        }
        const applied = addAmounts(start, cl.kind === 'add' ? d.amount : negateAmount(d.amount));
        if (!applied.ok) {
          violations.push(v(rule,
            `"${cons.text}" cannot be done: ${cons.entity} "${change.id}" has ${cl.field} ${describeAmount(start)} `
            + `and this ${intent.entity} has ${srcField} ${describeAmount(d.amount)}. ${applied.reason}\n  ${quoteRule(rule)}`,
            rule.source.file, cl.line));
          continue;
        }
        doc[cl.field] = writeMoney(applied.amount);
        continue;
      }

      if (typeof delta !== 'number' || !Number.isFinite(delta)) {
        violations.push(v(rule,
          `"${cons.text}" adds the ${srcField} of this ${intent.entity} to ${cons.entity} "${change.id}", but its ${srcField} is ${fmt(delta)}, which is not a number.\n  ${quoteRule(rule)}`,
          rule.source.file, cl.line));
        continue;
      }
      const base = doc[cl.field];
      if (!isEmpty(base) && typeof base !== 'number') {
        violations.push(v(rule,
          `${cons.entity} "${change.id}" has ${cl.field} ${fmt(base)}, which is not a number, so it cannot be counted up.\n  ${quoteRule(rule)}`,
          rule.source.file, cl.line));
        continue;
      }
      const start = typeof base === 'number' ? base : 0;
      doc[cl.field] = cl.kind === 'add' ? start + delta : start - delta;
    }
  }
}

/**
 * @returns {{change:Change}|null}
 */
function resolveTarget(cons, rule, ctx, targetDef) {
  const { model, world, staged, key, subject, intent, violations } = ctx;
  const plan = cons.targeting;
  if (!plan) {
    violations.push(v(rule,
      `it is not determined which ${cons.entity} "${cons.text}" should change — the model did not parse cleanly.\n  ${quoteRule(rule)}`,
      rule.source.file, cons.line));
    return null;
  }

  const stageExisting = (entity, id) => {
    const k = key(entity, id);
    if (staged.has(k)) return { change: staged.get(k) };
    const doc = world.get(entity, String(id));
    if (!doc) return null;
    const change = {
      op: 'update', entity, id: String(id), before: deepClone(doc), after: deepClone(doc),
    };
    staged.set(k, change);
    return { change };
  };

  if (plan.kind === 'self') {
    const got = stageExisting(intent.entity, intent.id);
    if (got) return got;
    violations.push(v(rule, `there is no ${intent.entity} with the id "${intent.id}" to change.\n  ${quoteRule(rule)}`,
      rule.source.file, cons.line));
    return null;
  }

  if (plan.kind === 'reference') {
    const id = subject[plan.field];
    if (isEmpty(id)) {
      violations.push(v(rule,
        `"${cons.text}" needs to know which ${cons.entity}, but no ${plan.field} is filled in on this ${intent.entity}.\n  ${quoteRule(rule)}`,
        rule.source.file, cons.line));
      return null;
    }
    const got = stageExisting(cons.entity, String(id));
    if (got) return got;
    return createOnDemandOrRefuse(cons, rule, ctx, targetDef, { id: String(id), keyValues: null });
  }

  // plan.kind === 'key' — the business key declared in `## Identified by`
  const keyValues = {};
  for (const f of plan.fields) {
    if (isEmpty(subject[f])) {
      violations.push(v(rule,
        `"${cons.text}" finds the right ${cons.entity} by its ${plan.fields.join(' and ')}, but no ${f} is filled in on this ${intent.entity}.\n  ${quoteRule(rule)}`,
        rule.source.file, cons.line));
      return null;
    }
    keyValues[f] = subject[f];
  }
  const matchesKey = (d) => plan.fields.every((f) => sameValue(d[f], keyValues[f]));

  // documents already staged in this same commit count too (two rules, one target)
  for (const change of staged.values()) {
    if (change.entity === cons.entity && change.after && matchesKey(change.after)) return { change };
  }
  const found = (world.find(cons.entity, matchesKey) || []).slice()
    .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  if (found.length > 1) {
    violations.push(v(rule,
      `there are ${found.length} ${cons.entity} documents for ${plan.fields.map((f) => `${f} ${fmt(keyValues[f])}`).join(' and ')} `
      + `(${found.map((d) => `"${d.id}"`).join(', ')}). "${cons.entity}" is identified by ${plan.fields.join(' and ')} `
      + `(${targetDef.source.file}), so this is a data problem — the runtime does not pick one.\n  ${quoteRule(rule)}`,
      rule.source.file, cons.line));
    return null;
  }
  if (found.length === 1) return stageExisting(cons.entity, String(found[0].id));
  return createOnDemandOrRefuse(cons, rule, ctx, targetDef, { id: null, keyValues });
}

/** grammar.md §5.3 — `+field` on a document that does not exist yet. Declared, never decided here. */
function createOnDemandOrRefuse(cons, rule, ctx, targetDef, where) {
  const { staged, key, subject, intent, violations } = ctx;
  const describeWhich = where.keyValues
    ? Object.keys(where.keyValues).map((f) => `${f} ${fmt(where.keyValues[f])}`).join(' and ')
    : `the id ${fmt(where.id)}`;
  const onlyCounters = cons.clauses.length > 0 && cons.clauses.every((c) => c.kind === 'add' || c.kind === 'subtract');

  if (!targetDef.createdOnDemand || !onlyCounters) {
    violations.push(v(rule,
      `there is no ${cons.entity} for ${describeWhich}, so "${cons.text}" has nothing to change.\n`
      + (onlyCounters
        ? `  Either create the ${cons.entity} first, or write "## Created on demand" / "yes" in ${targetDef.source.file}.\n`
        : `  A step that sets a field cannot create the document; that is what a "Create ${cons.entity}" rule is for.\n`)
      + `  ${quoteRule(rule)}`,
      rule.source.file, cons.line));
    return null;
  }

  // Build the new document from the declared business key. Its id is derived from the key, so the
  // same key always yields the same id — deterministic, no counter, no clock, no randomness.
  let id;
  let keyValues = where.keyValues;
  if (!keyValues) {
    id = String(where.id);
    keyValues = {};
  } else {
    const parts = Object.keys(keyValues).map((f) => String(keyValues[f]).replace(/[^A-Za-z0-9._-]+/g, '-'));
    id = parts.join('-');
    if (!id) {
      violations.push(v(rule,
        `${cons.entity} cannot be created on demand because its "## Identified by" fields are empty on this ${intent.entity}.\n  ${quoteRule(rule)}`,
        rule.source.file, cons.line));
      return null;
    }
  }
  const doc = { id, entity: cons.entity };
  for (const f of Object.keys(keyValues)) doc[f] = deepClone(keyValues[f]);
  // Every other declared number starts at zero, so a counter has something to count from.
  // A MONEY field starts empty, not at 0: a bare 0 is a float with no currency, and FD-1 does not
  // allow the runtime to decide which currency a new row is in. The counter fills it with the
  // currency of the amount it adds, which is the only currency anyone declared.
  for (const [fname, f] of targetDef.fields) {
    if (doc[fname] !== undefined) continue;
    if (f.type === 'number') doc[fname] = 0;
  }
  void subject;
  const change = { op: 'create', entity: cons.entity, id, before: null, after: doc };
  staged.set(key(cons.entity, id), change);
  return { change };
}

// ---------------------------------------------------------------------------------------------
// Periods (grammar.md §18)
//
// A document dated inside a locked period cannot be created, changed OR deleted. That is what
// makes "correction is a new entry, never a mutation" fall out of the model rather than be bolted
// on: the original is dated in the closed month, so nothing can touch it, and the correcting entry
// is an ordinary create dated in an open one.
//
// No clock is read (§18.2). The date is a field of the document being written, so the same
// document produces the same refusal in 2027 and in 2045.
// ---------------------------------------------------------------------------------------------

function checkPeriods(model, world, staged, violations) {
  let sw = null;
  const changes = [...staged.values()].sort(
    (a, b) => (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : byIdAscending(a, b)),
  );
  for (const change of changes) {
    const def = model.entities.get(change.entity);
    if (!def || !def.datedIn || def.datedIn.length === 0) continue;
    for (const dated of def.datedIn) {
      const periodDef = model.entities.get(dated.entity);
      if (!periodDef || !periodDef.period) continue;
      const p = periodDef.period;

      // An update is checked against BOTH dates, so moving a document out of a locked period is
      // refused exactly as writing one into it is.
      const dates = [];
      for (const side of [change.before, change.after]) {
        if (side && !isEmpty(side[dated.field])) {
          const d = String(side[dated.field]);
          if (!dates.includes(d)) dates.push(d);
        }
      }
      dates.sort();
      if (dates.length === 0) continue;
      if (sw === null) sw = stagedWorld(world, staged);

      for (const date of dates) {
        const candidates = (sw.find(dated.entity, (docu) => !isEmpty(docu[p.from]) && !isEmpty(docu[p.to])
          && String(docu[p.from]) <= date && date <= String(docu[p.to])) || []).slice().sort(byIdAscending);
        for (const period of candidates) {
          let locked = true;
          const why = [];
          for (const c of p.lockedWhen) {
            // FAIL CLOSED. A "locked when" the runtime cannot evaluate must not read as "open":
            // a period lock that silently stops locking is exactly the defect an auditor finds.
            if (!c.resolved && !c.subjectAgg) {
              why.push(`"${c.text}" cannot be worked out, so this period is treated as locked`);
              continue;
            }
            const r = evalCondition(c, period, dated.entity, model, sw, 0);
            if (!r.ok) { locked = false; break; }
            why.push(r.detail);
          }
          if (!locked) continue;
          const act = change.op === 'create' ? 'be created' : change.op === 'delete' ? 'be deleted' : 'be changed';
          violations.push(v(null,
            `${change.entity} "${change.id}" is dated ${fmt(date)}, which falls in ${dated.entity} `
            + `"${period.id}", and that period is locked — so it cannot ${act}.\n`
            + `  ${periodDef.period.source.file}:${periodDef.period.source.line} says:\n`
            + `    ## Period\n    - from: ${p.from}\n    - to: ${p.to}\n    - locked when: ${p.lockedWhenText}\n`
            + `  and it holds: ${why.join(' and ')}\n`
            + `  ${dated.source.file}:${dated.source.line} says:\n    ## Dated in\n    - ${dated.field} in ${dated.entity}\n`
            + '  A closed period is corrected by a NEW entry dated in an open one, never by changing '
            + 'this one. That is what makes the original still readable in ten years.',
            dated.source.file, dated.source.line));
          break; // one locked period is enough, and it is the same one on every peer
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Invariants (grammar.md §12)
//
// Scope: PER COMMIT, over the documents this commit touches or implicates — the only scope
// double-entry admits, because a journal entry's postings balance as a SET and the set is only
// complete inside the one atomic commit that writes it (§12.1).
//
// The implication graph (`model.invariantWatch`) is read off the parsed invariants at parse time.
// This function follows it; it never searches for a relationship.
// ---------------------------------------------------------------------------------------------

function checkInvariants(model, world, staged, violations) {
  const watch = model.invariantWatch || new Map();
  let any = false;
  for (const change of staged.values()) {
    const def = model.entities.get(change.entity);
    if ((def && def.invariants && def.invariants.size) || watch.has(change.entity)) { any = true; break; }
  }
  if (!any) return;

  const sw = stagedWorld(world, staged);
  /** @type {Map<string,{entity:string,id:string}>} */
  const implicated = new Map();
  const add = (entity, id) => {
    if (isEmpty(id)) return;
    implicated.set(`${entity}/${String(id)}`, { entity, id: String(id) });
  };
  for (const change of staged.values()) {
    const def = model.entities.get(change.entity);
    if (def && def.invariants && def.invariants.size) add(change.entity, change.id);
    // A change to a posting implicates the journal entry it belongs to — on BOTH sides, so moving
    // one between entries checks the entry it left and the entry it joined.
    for (const w of watch.get(change.entity) || []) {
      for (const side of [change.before, change.after]) {
        if (side) add(w.owner, side[w.linkField]);
      }
    }
  }

  for (const k of [...implicated.keys()].sort()) {
    const { entity, id } = implicated.get(k);
    const def = model.entities.get(entity);
    if (!def || !def.invariants || def.invariants.size === 0) continue;
    const docu = sw.get(entity, id);
    // Deleted in this very commit: there is no document left for anything to hold of.
    if (!docu) continue;
    for (const [, inv] of def.invariants) {
      for (const c of inv.conditions) {
        const r = evalCondition(c, docu, entity, model, sw, 0);
        if (r.ok) continue;
        violations.push(v(null,
          `${entity} "${id}" would not be ${inv.name}: ${r.detail}\n`
          + `  ${inv.source.file}:${inv.source.line} says:\n    ## Invariants\n    - ${inv.name}: ${inv.text}\n`
          + '  An invariant holds after every change or the change does not happen. Nothing in this '
          + 'commit is written.',
          inv.source.file, inv.source.line));
      }
    }
  }
}
