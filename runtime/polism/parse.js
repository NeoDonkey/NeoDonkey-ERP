/**
 * runtime/polism/parse.js — the POLISM parser (Principle 11).
 *
 * Turns the structured text of `operating-model/**\/*.md` into a Model that
 * `execute.js` can evaluate deterministically.
 *
 * Normative grammar: ./grammar.md (grammar-version: 2, Part II). If the two disagree, this file is
 * wrong. Version 2 adds exactly what FD-5 authorises — invariants, aggregation, branches,
 * enumerations, three authority scopes, `+field from other-field`, periods — plus exact money
 * (FD-1), and refuses everything else by name. Every version-1 construction keeps its version-1
 * meaning (grammar.md §0), which `test/c-polism.test.js` asserts against the real
 * `operating-model/` and `templates/` trees.
 *
 * Two rules govern every line below:
 *
 *  1. NO BUSINESS SEMANTICS LIVE HERE. This file knows the words `if`, `then`, `and`, `with`,
 *     `not`, `is`, `exists`, `under condition`, `reference to` — and nothing about orders, stock,
 *     delivery, VAT or batches. What "not already fully delivered" means is declared in
 *     `information/order.md`. Hardcoding it here would be rebuilding SAP.
 *
 *  2. NOTHING IS GUESSED (Principle 6). An unknown construction is never ignored and never
 *     interpreted. It produces an `error` diagnostic carrying file, line, the offending text and
 *     what was expected — written for the COO who has to fix her own sentence, not for a
 *     compiler engineer.
 *
 * Zero dependencies. No `node:*` (this module must load in a browser). Pure functions.
 * No `Date.now()`, no `Math.random()`.
 */

import { readMoney, readMoneyLiteral, isCanonicalMoney } from './money.js';

export const GRAMMAR_VERSION = 2;

// ---------------------------------------------------------------------------------------------
// The complete vocabulary of grammar version 1. Everything not in these lists is refused.
// ---------------------------------------------------------------------------------------------

export const CRUD_OPS = ['create', 'read', 'update', 'delete'];
export const CONSEQUENT_VERBS = ['create', 'update', 'delete'];
export const COMPARISON_OPERATORS = ['>', '>=', '<', '<=', '=', '!='];
export const CONDITION_FORMS = [
  '<field> > <value>', '<field> >= <value>', '<field> < <value>', '<field> <= <value>',
  '<field> = <value>', '<field> != <value>', '<field> is <value>', '<field> is not <value>',
  '<field> exists', '<field> not exists', '<subject> <declared predicate>',
  '<subject> not <declared predicate>',
];
export const FIELD_TYPES = [
  'text', 'number', 'money', 'date', 'boolean', 'reference to <entity>',
  'one of <value>, <value>, …',
];
export const SCALAR_TYPES = ['text', 'number', 'money', 'date', 'boolean'];
export const ORDERED_TYPES = ['number', 'money', 'date']; // types that support > >= < <=
export const POLISM_CATEGORIES = [
  'processes', 'organisation', 'locations', 'information', 'suppliers', 'management-system',
];

/** Grammar version 2: the two aggregate functions, and nothing more (grammar.md §13, §20.4). */
export const AGGREGATE_FUNCTIONS = ['sum', 'count'];
/** The four operations an entity-scope `## Authorized by` may name (grammar.md §16.1). */
export const AUTHORITY_OPERATIONS = ['create', 'read', 'update', 'delete'];

/** Sections the runtime reads. `invariants` / `period` / `dated in` are grammar version 2. */
export const RUNTIME_SECTIONS = [
  'rules', 'authorized by', 'fields', 'predicates', 'identified by', 'created on demand',
  'invariants', 'period', 'dated in',
];
/** Sections that are documentation: recognised so they are not errors, then ignored. */
export const PROSE_SECTIONS = [
  'triggered by', 'purpose', 'notes', 'description', 'context', 'owner', 'inputs', 'outputs',
  'measures', 'cadence', 'retention', 'references', 'examples', 'open questions',
];

const KEYWORDS = new Set([
  // grammar version 1
  'if', 'under', 'condition', 'then', 'and', 'or', 'with', 'not', 'is', 'exists',
  // grammar version 2: branches (§14), aggregation (§13), authority (§16), counters (§17),
  // labelled creates (§21)
  'when', 'otherwise', 'sum', 'count', 'of', 'over', 'for', 'this', 'where', 'from',
  'authorized', 'authorised', 'by', 'as',
]);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NUMBER = /^[-+]?\d+(\.\d+)?$/;
/** A three-letter upper-case token can only be a currency code: field names are lower-case slugs. */
const CURRENCY_TOKEN = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Common wrong operators, mapped to the right one. Diagnostics only — never accepted. */
const OPERATOR_MISTAKES = {
  '==': '=', '===': '=', '<>': '!=', '=<': '<=', '=>': '>=', '≥': '>=', '≤': '<=',
  '≠': '!=', '!==': '!=', '~=': null, '+=': null, ':=': '=',
};

// ---------------------------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ severity:'error'|'warning', message:string, file:string, line:number,
 *             text?:string, expected?:string }} Diag
 */

function diag(severity, file, line, message, text, expected) {
  /** @type {Diag} */
  const d = { severity, message, file, line };
  if (text !== undefined) d.text = text;
  if (expected !== undefined) d.expected = expected;
  // The message alone must be complete: a UI that renders only `message` still tells the whole
  // story (file, line, offending text, expectation).
  let full = `${file}:${line}: ${message}`;
  if (text !== undefined && text !== '' && !message.includes(`"${text}"`)) {
    full += `\n  in: ${text}`;
  }
  if (expected !== undefined) full += `\n  expected: ${expected}`;
  d.message = full;
  return d;
}

const err = (file, line, message, text, expected) =>
  diag('error', file, line, message, text, expected);
const warn = (file, line, message, text, expected) =>
  diag('warning', file, line, message, text, expected);

/**
 * Words people reach for that grammar version 1 does not have. Used ONLY to make a refusal
 * helpful — never to accept the word (that would be guessing).
 */
const ALIAS_HINTS = {
  // section names
  'approved by': 'authorized by', 'authorised by': 'authorized by', approvers: 'authorized by',
  'who may': 'authorized by', permissions: 'authorized by', roles: 'authorized by',
  rule: 'rules', logic: 'rules', 'if-then': 'rules', 'business rules': 'rules',
  attributes: 'fields', properties: 'fields', columns: 'fields',
  'business key': 'identified by', identity: 'identified by',
  definitions: 'predicates',
  // field types
  string: 'text', varchar: 'text', char: 'text', str: 'text',
  int: 'number', integer: 'number', float: 'number', decimal: 'number', numeric: 'number',
  double: 'number',
  bool: 'boolean', yesno: 'boolean',
  datetime: 'date', timestamp: 'date',
  currency: 'money', price: 'money',
};

/**
 * "Did you mean …?" for diagnostic text only.
 * This never selects a meaning and never influences whether something parses — the input is
 * already refused by the time this runs (see grammar.md §11.2).
 */
export function suggest(word, candidates) {
  const w = String(word).toLowerCase().trim();
  const alias = ALIAS_HINTS[w];
  if (alias && candidates.some((c) => String(c).toLowerCase() === alias)) return ` Did you mean "${alias}"?`;
  let best = null;
  let bestD = Infinity;
  for (const c of candidates) {
    const d = editDistance(w, String(c).toLowerCase());
    if (d < bestD || (d === bestD && best !== null && String(c) < best)) { bestD = d; best = String(c); }
  }
  const limit = Math.max(1, Math.floor(w.length / 3) + 1);
  return best !== null && bestD <= limit ? ` Did you mean "${best}"?` : '';
}

function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const list = (xs) => xs.map((x) => `"${x}"`).join(', ');

/** English article, so a refusal reads like a sentence a COO wrote. */
export const article = (word) => (/^[aeiou]/i.test(String(word)) ? 'an' : 'a');

// ---------------------------------------------------------------------------------------------
// Tokenizer — words carrying their line, quoted strings kept whole
// ---------------------------------------------------------------------------------------------

/** @typedef {{ raw:string, value:string, quoted:boolean, line:number, col:number }} Token */

/**
 * @param {{n:number, text:string}[]} lines
 * @returns {{ tokens: Token[], errors: Diag[] }}
 */
function tokenize(lines, file) {
  /** @type {Token[]} */ const tokens = [];
  /** @type {Diag[]} */ const errors = [];
  for (const { n, text } of lines) {
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '"' || ch === '“' || ch === '”') {
        let j = i + 1; let buf = '';
        while (j < text.length && !(text[j] === '"' || text[j] === '”' || text[j] === '“')) {
          buf += text[j]; j++;
        }
        const closed = j < text.length;
        if (!closed) {
          errors.push(err(file, n, 'a text value is missing its closing quote.',
            text.slice(i).trim(), 'a value in double quotes, for example: status "delivered"'));
        }
        tokens.push({
          raw: text.slice(i, closed ? j + 1 : text.length),
          value: buf, quoted: true, line: n, col: i + 1,
        });
        i = closed ? j + 1 : text.length;
        continue;
      }
      let j = i;
      while (j < text.length && !/\s/.test(text[j]) && text[j] !== '"') j++;
      const raw = text.slice(i, j);
      tokens.push({ raw, value: trimPunctuation(raw), quoted: false, line: n, col: i + 1 });
      i = j;
    }
  }
  return { tokens, errors };
}

/** Lenient punctuation: `condition,` / `+quantity.` / `stock;` read as intended. */
function trimPunctuation(s) {
  let v = s;
  while (v.length > 1 && (v.endsWith(',') || v.endsWith(';') || v.endsWith(':'))) v = v.slice(0, -1);
  if (v.length > 1 && v.endsWith('.') && !NUMBER.test(v)) v = v.slice(0, -1);
  return v;
}

const kw = (t) => (t && !t.quoted ? t.value.toLowerCase() : null);
const rawOf = (toks) => toks.map((t) => t.raw).join(' ');
const lineOf = (toks) => (toks.length ? toks[0].line : 0);

/** Split a token run on a top-level keyword (there is no nesting in grammar v1). */
function splitOn(tokens, word) {
  const runs = [[]];
  for (const t of tokens) {
    if (kw(t) === word) runs.push([]);
    else runs[runs.length - 1].push(t);
  }
  return runs;
}

function indexOfKeyword(tokens, word, from = 0) {
  for (let i = from; i < tokens.length; i++) if (kw(tokens[i]) === word) return i;
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Value literals
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ type:'text'|'number'|'boolean'|'money', value:string|number|boolean,
 *             raw?:string, amount?:{minor:bigint,currency:string} }} Literal
 *
 * `raw` is the **source text** of a number literal, kept so that a comparison against a money
 * field can be scaled exactly without `Number` ever touching a monetary value (FD-1, §19.2).
 * A `money` literal carries its exact `amount` and never a `value` that could be added to a float.
 */

/** @returns {Literal|null} null = not a literal (caller refuses, demanding quotes) */
function literal(tok) {
  if (!tok) return null;
  if (tok.quoted) {
    // A quoted token that is canonical money is a money literal (grammar.md §19.1, one-token form).
    if (isCanonicalMoney(tok.value)) {
      const r = readMoney(tok.value);
      return { type: 'money', value: tok.value, amount: r.amount };
    }
    return { type: 'text', value: tok.value };
  }
  if (NUMBER.test(tok.value)) return { type: 'number', value: Number(tok.value), raw: tok.value };
  const low = tok.value.toLowerCase();
  if (low === 'true' || low === 'false') return { type: 'boolean', value: low === 'true' };
  return null;
}

/** Does a value start at `i` and span two tokens — the `1000.00 EUR` form of §19.1? */
function isTwoTokenMoney(run, i) {
  const a = run[i];
  const b = run[i + 1];
  return !!a && !a.quoted && NUMBER.test(a.value)
    && !!b && !b.quoted && CURRENCY_TOKEN.test(b.value);
}

/** How many tokens a value occupies at `i`: 2 for `1000.00 EUR`, 1 otherwise. */
const valueSpan = (run, i) => (isTwoTokenMoney(run, i) ? 2 : 1);

/**
 * Read a value that may be one token or the two-token money form.
 * @returns {{literal:Literal, next:number}|{error:string, expected:string, next:number}|null}
 */
function valueAt(run, i, file, errors, text) {
  if (i >= run.length) return null;
  if (isTwoTokenMoney(run, i)) {
    const r = readMoneyLiteral(run[i].value, run[i + 1].value);
    if (!r.ok) {
      errors.push(err(file, run[i].line, `${r.reason}.`, text,
        'an exact amount with its currency, for example: 4999.99 EUR (FD-1 — the number of '
        + 'decimals is the one that currency uses, always)'));
      return null;
    }
    return { literal: { type: 'money', value: r.text, amount: r.amount }, next: i + 2 };
  }
  const lit = literal(run[i]);
  if (!lit) return null;
  return { literal: lit, next: i + 1 };
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

function splitSections(text) {
  const lines = String(text).split(/\r?\n/);
  const sections = [];
  const prose = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const m = /^##[ \t]+(.+?)[ \t]*$/.exec(raw); // level 2 only: `###` does not match
    if (m) {
      const rawName = m[1].replace(/[:\s]+$/, '').trim();
      cur = { rawName, name: rawName.toLowerCase().replace(/\s+/g, ' '), line: i + 1, lines: [] };
      sections.push(cur);
    } else if (cur) {
      cur.lines.push({ n: i + 1, text: raw });
    } else {
      prose.push({ n: i + 1, text: raw });
    }
  }
  return { prose, sections };
}

function titleOf(prose) {
  for (const l of prose) {
    const m = /^#[ \t]+(.+?)[ \t]*$/.exec(l.text);
    if (m) return m[1].trim();
  }
  return null;
}

/** Body lines, blanks dropped, `- ` / `* ` bullets stripped. */
function bullets(section) {
  const out = [];
  for (const l of section.lines) {
    const t = l.text.trim();
    if (!t) continue;
    out.push({ n: l.n, text: t.replace(/^[-*]\s+/, '').trim() });
  }
  return out;
}

function stripComment(s) {
  const m = /\s(?:—|--|#)\s/.exec(s);
  return (m ? s.slice(0, m.index) : s).trim();
}

// ---------------------------------------------------------------------------------------------
// parseRule — syntax only. Field/entity/role/predicate existence is checked later, against the
// whole model, because a single rule cannot know what the company declared.
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ root:string, field:string|null, text:string, line:number }} Path
 * @typedef {({ kind:'compare', op:string, subject:Path, value:Literal }
 *          | { kind:'exists', subject:Path, negated:boolean }
 *          | { kind:'predicate', subject:Path, name:string, negated:boolean }
 *          ) & { text:string, line:number, resolved?:object }} Condition
 * @typedef {{ kind:'set'|'add'|'subtract'|'require', field:string, value?:Literal,
 *             text:string, line:number }} Clause
 * @typedef {{ verb:'create'|'update'|'delete', entity:string, clauses:Clause[],
 *             targeting?:object, text:string, line:number }} Consequent
 * @typedef {{ trigger:{op:string, entity:string}, conditions:Condition[],
 *             consequents:Consequent[], authorizedBy:string[],
 *             source:{file:string, line:number}, text:string }} Rule
 */

/**
 * Parse one `If … then …` rule.
 * @param {string} text
 * @param {{file?:string, line?:number}} [where] absolute position, for diagnostics
 * @returns {{ rule: Rule|null, errors: Diag[] }}
 */
export function parseRule(text, where = {}) {
  const file = where.file || '<rule>';
  const startLine = where.line || 1;
  const lines = String(text).split(/\r?\n/).map((t, i) => ({ n: startLine + i, text: t }));
  const { tokens, errors } = tokenize(lines, file);
  const ruleText = String(text).replace(/\s+$/, '');

  if (tokens.length === 0) {
    errors.push(err(file, startLine, 'empty rule.', ruleText,
      'If <Create|Read|Update|Delete> <entity> under condition … then …'));
    return { rule: null, errors };
  }

  const fail = (line, message, offending, expected) => {
    errors.push(err(file, line, message, offending, expected));
    return { rule: null, errors };
  };

  let i = 0;
  if (kw(tokens[0]) !== 'if') {
    return fail(tokens[0].line, `a rule must start with "If", but this one starts with "${tokens[0].raw}".`,
      firstLine(ruleText),
      'If <Create|Read|Update|Delete> <entity> … then …  — if this line is an explanation rather than '
      + 'a rule, it belongs in a "## Notes" section or in the prose above the first "## " section, '
      + 'because everything inside "## Rules" is enforced (grammar.md §1).');
  }
  i = 1;

  const opTok = tokens[i];
  const op = kw(opTok);
  if (!op || !CRUD_OPS.includes(op)) {
    return fail(opTok ? opTok.line : startLine,
      `"${opTok ? opTok.raw : '(nothing)'}" is not one of the four operations.${opTok ? suggest(opTok.value, CRUD_OPS) : ''}`,
      firstLine(ruleText), `If followed by one of ${list(['Create', 'Read', 'Update', 'Delete'])}`);
  }
  i++;

  const entTok = tokens[i];
  if (!entTok || entTok.quoted || KEYWORDS.has(kw(entTok))) {
    return fail(entTok ? entTok.line : opTok.line,
      `"If ${opTok.raw}" must be followed by an entity name.`, firstLine(ruleText),
      `for example: If ${opTok.raw} goods-receipt … then …`);
  }
  if (!SLUG.test(entTok.value)) {
    return fail(entTok.line, `"${entTok.raw}" is not a valid entity name.`, firstLine(ruleText),
      'a lower-case name like goods-receipt (this is also the folder name under documents/)');
  }
  const entity = entTok.value;
  i++;

  // `under condition` … | `authorized by` … | `then` …
  let condTokens = [];
  const next = kw(tokens[i]);
  if (next === 'under') {
    if (kw(tokens[i + 1]) !== 'condition') {
      return fail(tokens[i].line, `"under" must be followed by "condition".`, rawOf(tokens.slice(i, i + 3)),
        'under condition');
    }
    i += 2;
  } else if (next !== 'then' && !isAuthorizedWord(next)) {
    return fail(tokens[i] ? tokens[i].line : entTok.line,
      `expected "under condition", "authorized by" or "then" after "If ${opTok.raw} ${entity}", found "${tokens[i] ? tokens[i].raw : '(nothing)'}".`,
      ruleText,
      'If <op> <entity> under condition … authorized by <role> then …  ("under condition" and '
      + '"authorized by" may both be left out)');
  }

  const thenIdx = indexOfKeyword(tokens, 'then', i);
  if (thenIdx === -1) {
    return fail(tokens[i] ? tokens[i].line : entTok.line, 'this rule has no "then".', ruleText,
      'every rule reads: If <op> <entity> under condition … then <what must happen>');
  }
  condTokens = tokens.slice(i, thenIdx);
  const consTokens = tokens.slice(thenIdx + 1);

  // Grammar version 2, §16: an inline `authorized by` sits immediately before the `then` it
  // belongs to. Take it off the end of the condition tokens before the conditions are read.
  const ruleAuthority = takeAuthority(condTokens, file, errors, ruleText);
  if (ruleAuthority === false) return { rule: null, errors };

  if (next === 'under' && condTokens.length === 0) {
    return fail(tokens[thenIdx].line, '"under condition" is followed by no condition at all.', ruleText,
      'at least one condition, for example: quantity > 0');
  }
  if (consTokens.length === 0) {
    return fail(tokens[thenIdx].line, '"then" is followed by nothing — the rule says what to check but not what to do.',
      ruleText, `at least one of ${list(['Create <entity>', 'Update <entity> with …', 'Delete <entity>'])}`);
  }

  const conditions = [];
  if (condTokens.length) {
    for (const run of splitOn(condTokens, 'and')) {
      const c = parseCondition(run, file, errors, ruleText, tokens[0].line);
      if (c) conditions.push(c);
    }
  }

  // Grammar version 2, §14: `then when … otherwise …`. Without `when`, this is exactly version 1.
  let consequents = [];
  let branches = null;
  if (kw(consTokens[0]) === 'when') {
    branches = parseBranches(consTokens, file, errors, ruleText, tokens[thenIdx].line);
  } else {
    // An `otherwise` with no `when` in front of it is checked BEFORE the consequents are read:
    // otherwise the first complaint is about a stray word inside a "with" clause, which tells the
    // author nothing about the mistake they actually made.
    const strayOtherwise = consTokens.findIndex((t) => kw(t) === 'otherwise');
    if (strayOtherwise !== -1) {
      errors.push(err(file, consTokens[strayOtherwise].line,
        '"otherwise" only has a meaning after a "when" branch.', ruleText,
        'then when <condition> then <what happens> otherwise <what happens instead> (grammar.md §14)'));
    } else {
      for (const run of splitOn(consTokens, 'and')) {
        const c = parseConsequent(run, file, errors, ruleText, tokens[thenIdx].line);
        if (c) consequents.push(c);
      }
      detectDuplicateCreates(consequents, file, errors, ruleText);
    }
  }

  if (errors.some((e) => e.severity === 'error')) return { rule: null, errors };

  /** @type {Rule} */
  const rule = {
    trigger: { op, entity },
    conditions,
    consequents,
    authorizedBy: [],
    source: { file, line: tokens[0].line },
    text: ruleText,
  };
  if (branches) rule.branches = branches;
  if (ruleAuthority) rule.inlineAuthority = ruleAuthority;
  return { rule, errors };
}

const isAuthorizedWord = (w) => w === 'authorized' || w === 'authorised';

/**
 * Take a trailing `authorized by <role> {or <role>}` off a token run, in place.
 * @returns {{roles:string[], line:number}|null|false} null = none present, false = refused
 */
function takeAuthority(toks, file, errors, text) {
  let at = -1;
  for (let k = 0; k < toks.length; k++) {
    if (isAuthorizedWord(kw(toks[k]))) { at = k; break; }
  }
  if (at === -1) return null;
  const line = toks[at].line;
  if (kw(toks[at + 1]) !== 'by') {
    errors.push(err(file, line, `"${toks[at].raw}" must be followed by "by".`, text,
      'authorized by <role> — for example: authorized by managing-director (grammar.md §16)'));
    return false;
  }
  const roleToks = toks.slice(at + 2);
  const roles = [];
  for (const t of roleToks) {
    const v = kw(t);
    if (v === 'or') continue;
    if (v === 'and') {
      errors.push(err(file, t.line,
        '"and" between roles does not exist: it would mean two different people must sign, and one operation carries one actor.',
        text,
        'roles joined by "or" — the actor needs one of them. Two signatures are a constraint on the '
        + 'commit (manifesto line 114), not on one operation; see grammar.md §10.4.'));
      return false;
    }
    if (t.quoted || !SLUG.test(t.value)) {
      errors.push(err(file, t.line, `"${t.raw}" is not a role name.`, text,
        'role names as their file names under organisation/, for example: authorized by managing-director'));
      return false;
    }
    if (!roles.includes(t.value)) roles.push(t.value);
  }
  if (roles.length === 0) {
    errors.push(err(file, line, '"authorized by" names no role at all.', text,
      'at least one role, for example: authorized by managing-director'));
    return false;
  }
  toks.length = at; // the clause is consumed; what remains is the conditions
  return { roles, line };
}

/**
 * `then when <condition> then <what happens> otherwise when … otherwise <what happens instead>`
 * — grammar.md §14. Arms are alternatives in written order; exactly one of them runs.
 *
 * @typedef {{ conditions:Condition[], consequents:Consequent[], isDefault:boolean,
 *             inlineAuthority?:{roles:string[], line:number}, text:string, line:number }} Branch
 * @returns {Branch[]}
 */
function parseBranches(consTokens, file, errors, ruleText, fallbackLine) {
  const arms = splitOn(consTokens, 'otherwise');
  /** @type {Branch[]} */
  const out = [];
  for (let idx = 0; idx < arms.length; idx++) {
    const armToks = arms[idx];
    const armLine = lineOf(armToks) || fallbackLine;
    if (armToks.length === 0) {
      errors.push(err(file, armLine,
        idx === arms.length - 1
          ? '"otherwise" is followed by nothing — say what happens in the remaining case, or leave the "otherwise" out.'
          : 'two "otherwise"s in a row.',
        ruleText,
        'otherwise <what happens instead>, or otherwise when <condition> then <what happens> (grammar.md §14)'));
      continue;
    }
    const isWhen = kw(armToks[0]) === 'when';
    if (!isWhen && idx !== arms.length - 1) {
      errors.push(err(file, armLine,
        `"otherwise ${rawOf(armToks.slice(0, 2))}…" has no "when", so it covers every remaining case — `
        + 'but it is not the last branch, so the branches after it can never run.',
        ruleText,
        'the branch without a "when" is the last one. Write "otherwise when <condition> then …" for '
        + 'a further case (grammar.md §14).'));
      continue;
    }
    let condTokens = [];
    let consToks = armToks;
    if (isWhen) {
      const thenAt = indexOfKeyword(armToks, 'then', 1);
      if (thenAt === -1) {
        errors.push(err(file, armLine,
          `this "when" branch has no "then", so it does not say what happens when its condition holds.`,
          ruleText,
          'when <condition> then <what happens> — the "then" is what separates the condition from '
          + 'the consequence, and it is not guessed (grammar.md §14)'));
        continue;
      }
      condTokens = armToks.slice(1, thenAt);
      consToks = armToks.slice(thenAt + 1);
      if (condTokens.length === 0) {
        errors.push(err(file, armLine, '"when" is followed by no condition at all.', ruleText,
          'when <condition> then <what happens>, for example: when net-amount > 10000.00 EUR then …'));
        continue;
      }
    }
    const armAuthority = isWhen ? takeAuthority(condTokens, file, errors, ruleText) : null;
    if (armAuthority === false) continue;
    if (consToks.length === 0) {
      errors.push(err(file, armLine, 'this branch says what to check but not what to do.', ruleText,
        `at least one of ${list(['Create <entity>', 'Update <entity> with …', 'Delete <entity>'])}`));
      continue;
    }
    const conditions = [];
    if (condTokens.length) {
      for (const run of splitOn(condTokens, 'and')) {
        const c = parseCondition(run, file, errors, ruleText, armLine);
        if (c) conditions.push(c);
      }
    }
    const consequents = [];
    for (const run of splitOn(consToks, 'and')) {
      const c = parseConsequent(run, file, errors, ruleText, armLine);
      if (c) consequents.push(c);
    }
    // Per arm: two arms may each create a "receivable" leg, because only one arm runs (§14.1, §21).
    detectDuplicateCreates(consequents, file, errors, ruleText);
    /** @type {Branch} */
    const branch = {
      conditions, consequents, isDefault: !isWhen,
      text: rawOf(armToks), line: armLine,
    };
    if (armAuthority) branch.inlineAuthority = armAuthority;
    out.push(branch);
  }
  return out;
}

const firstLine = (s) => String(s).split('\n')[0].trim();

/** `quantity` | `order.status` — one hop, per grammar.md §4.1. */
function parsePath(tok, file, errors, context) {
  if (tok.quoted) {
    errors.push(err(file, tok.line, `a condition cannot start with a text value (${tok.raw}).`,
      context, 'a field name, for example: quantity > 0'));
    return null;
  }
  const parts = tok.value.split('.');
  if (parts.length > 2) {
    errors.push(err(file, tok.line,
      `"${tok.value}" goes through ${parts.length - 1} references. Grammar version 1 follows one reference only.`,
      context, 'either <field> or <reference>.<field>, for example: order.status'));
    return null;
  }
  for (const p of parts) {
    if (!SLUG.test(p)) {
      errors.push(err(file, tok.line, `"${tok.raw}" is not a valid field name.`, context,
        'lower-case names like quantity, batch-number, order.status'));
      return null;
    }
  }
  return { root: parts[0], field: parts[1] || null, text: tok.value, line: tok.line };
}

// ---------------------------------------------------------------------------------------------
// Aggregation — grammar version 2, grammar.md §13.
//
// An aggregate is a TERM, not a condition: it stands where a value stands, on either side of a
// comparison. Its `where` takes exactly one bounded condition (§13.1), which is what keeps the
// rule's own `and` unambiguous and makes every aggregate a question an index can answer (§13.3).
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ fn:'sum'|'count', field:string|null, entity:string,
 *             scope:{entity:string}|null,
 *             where:{field:string, op:string, value:Literal|null, negated:boolean,
 *                    text:string, line:number}|null,
 *             text:string, line:number, resolved?:object }} Aggregate
 */

const aggregateShape = (fn) => (fn === 'sum'
  ? 'sum of <field> over <entity> [for this <entity>] [where <field> <operator> <value>]'
  : 'count of <entity> [for this <entity>] [where <field> <operator> <value>]');

/** Does an aggregate start here? Cheap, and the only place the two function names are recognised. */
const startsAggregate = (run, i) =>
  AGGREGATE_FUNCTIONS.includes(kw(run[i])) && kw(run[i + 1]) === 'of';

/**
 * How many tokens the aggregate at `i` occupies. Tolerant: used only to find the top-level
 * comparison operator, so that `sum of x over y where a > 5 = count of z` finds the `=` and not
 * the `>` that belongs to the `where`. Returns -1 when the shape is wrong, and the caller then
 * asks `parseAggregate` for the precise refusal.
 */
function aggregateSpan(run, i) {
  const fn = kw(run[i]);
  if (!AGGREGATE_FUNCTIONS.includes(fn) || kw(run[i + 1]) !== 'of') return -1;
  let j = i + 2;
  const word = (k) => (run[k] && !run[k].quoted ? run[k].value : null);
  if (fn === 'sum') {
    if (!word(j)) return -1;
    j++;
    if (kw(run[j]) !== 'over') return -1;
    j++;
  }
  if (!word(j)) return -1;
  j++;
  if (kw(run[j]) === 'for') {
    if (kw(run[j + 1]) !== 'this' || !word(j + 2)) return -1;
    j += 3;
  }
  if (kw(run[j]) === 'where') {
    j++;
    if (!word(j)) return -1;
    j++;
    if (kw(run[j]) === 'exists') return j + 1;
    if (kw(run[j]) === 'not' && kw(run[j + 1]) === 'exists') return j + 2;
    if (run[j] && !run[j].quoted && COMPARISON_OPERATORS.includes(run[j].value)) {
      j++;
    } else if (kw(run[j]) === 'is') {
      j++;
      if (kw(run[j]) === 'not') j++;
    } else {
      return -1;
    }
    if (j >= run.length) return -1;
    j += valueSpan(run, j);
  }
  return j;
}

/**
 * Every aggregate span in a token run, so the operator scans below never look inside one.
 * @returns {{spans:number[][], malformedAt:number}}
 */
function topLevelSpans(run) {
  const spans = [];
  let i = 0;
  while (i < run.length) {
    if (startsAggregate(run, i)) {
      const end = aggregateSpan(run, i);
      if (end < 0) return { spans, malformedAt: i };
      spans.push([i, end]);
      i = end;
      continue;
    }
    i++;
  }
  return { spans, malformedAt: -1 };
}

const inSpan = (spans, k) => spans.some(([a, b]) => k >= a && k < b);
/** Is `[from, to)` exactly one aggregate span? */
const isWholeSpan = (spans, from, to) => spans.some(([a, b]) => a === from && b === to);

/**
 * Parse the aggregate at `i`. Every refusal names the shape.
 * @returns {{agg:Aggregate, next:number}|null}
 */
function parseAggregate(run, i, file, errors, text) {
  const start = i;
  const fn = kw(run[i]);
  const shape = aggregateShape(fn);
  const line = run[i].line;
  const fail = (l, message, expected) => {
    errors.push(err(file, l || line, message, text, expected || shape));
    return null;
  };
  const name = (k, what) => {
    const t = run[k];
    if (!t || t.quoted || KEYWORDS.has(kw(t))) {
      return fail(t ? t.line : line, `"${fn} of …" is missing ${what}.`);
    }
    if (t.value.includes('.')) {
      return fail(t.line,
        `"${t.value}" follows a reference, and an aggregate names ${what} directly.`,
        `${what} as a plain name — a reference cannot be followed here (grammar.md §13.1)`);
    }
    if (!SLUG.test(t.value)) return fail(t.line, `"${t.raw}" is not a valid name for ${what}.`);
    return t.value;
  };

  if (kw(run[i + 1]) !== 'of') {
    return fail(line, `"${run[i].raw}" must be followed by "of".`);
  }
  i += 2;

  let field = null;
  if (fn === 'sum') {
    field = name(i, 'the field to add up');
    if (field === null) return null;
    i++;
    if (kw(run[i]) !== 'over') {
      return fail(run[i] ? run[i].line : line,
        `"sum of ${field}" must say which kind of document to add it over.`,
        `sum of ${field} over <entity>`);
    }
    i++;
  }
  const entity = name(i, 'the kind of document to count');
  if (entity === null) return null;
  i++;

  let scope = null;
  if (kw(run[i]) === 'for') {
    if (kw(run[i + 1]) !== 'this') {
      return fail(run[i].line, '"for" must be followed by "this <entity>".',
        `for this <entity> — the document this condition is about (grammar.md §13.2)`);
    }
    const e = name(i + 2, 'the kind of document "for this" refers to');
    if (e === null) return null;
    scope = { entity: e };
    i += 3;
  }

  let where = null;
  if (kw(run[i]) === 'where') {
    const whereLine = run[i].line;
    i++;
    const f = run[i];
    if (!f || f.quoted || KEYWORDS.has(kw(f))) {
      return fail(whereLine, '"where" must be followed by a field of the documents being counted.',
        `where <field> <operator> <value> — one condition, on a field of ${entity} (grammar.md §13.1)`);
    }
    if (f.value.includes('.')) {
      return fail(f.line,
        `"where ${f.value}" follows a reference, which an aggregate's "where" cannot do.`,
        `a field of ${entity} itself. An aggregate's "where" is one condition on one direct field, `
        + 'so that it stays a question the index can answer (grammar.md §13.1, §13.3)');
    }
    if (!SLUG.test(f.value)) return fail(f.line, `"${f.raw}" is not a valid field name.`);
    const wf = f.value;
    i++;
    const from = i;
    let op = null;
    let negated = false;
    let value = null;
    /**
     * `where <field> is this` is the sentence an author reaches for instead of `for this <entity>`,
     * so it gets the sentence that works rather than a complaint about the one that does not.
     *
     * Checked at the VALUE POSITION ONLY, and that bound is the whole point. Scanning the rest of
     * the run for the word `this` misreads a legitimate `for this` on the OTHER SIDE of the
     * comparison as a misuse on this side — which broke the one sentence that matters most in the
     * product:
     *
     *     sum of amount over posting for this journal-entry where side is "debit"
     *       = sum of amount over posting for this journal-entry where side is "credit"
     *
     * A where-condition is bounded (§13.1), so its value has exactly one position and there is
     * nothing to search for.
     */
    const thisMisuse = (at) => (kw(run[at]) === 'this'
      ? fail(run[at].line,
        `"where ${wf} is this …" is not how an aggregate refers to the document it is written on.`,
        `"for this <entity>" BEFORE the "where" — it links by the reference and needs no value:\n`
        + `    ${fn === 'sum' ? `sum of ${field} over ${entity}` : `count of ${entity}`} for this ${wf} where <field> is <value>\n`
        + '  (grammar.md §13.2)')
      : undefined);

    // An `and` after the `where` is NOT checked here, and that is deliberate: the rule's own `and`
    // has already split the sentence by the time this runs, so a check here would be unreachable
    // code pretending to guard something. The dangling-total message in `parseCondition` names
    // that cause instead, and it is reachable. (grammar.md §13.1, §20.8)
    if (kw(run[i]) === 'exists') {
      op = 'exists';
      i++;
    } else if (kw(run[i]) === 'not' && kw(run[i + 1]) === 'exists') {
      op = 'exists';
      negated = true;
      i += 2;
    } else if (run[i] && !run[i].quoted && COMPARISON_OPERATORS.includes(run[i].value)) {
      op = run[i].value;
      i++;
      if (thisMisuse(i) !== undefined) return null;
      const n0 = errors.length;
      const v = valueAt(run, i, file, errors, text);
      if (!v) {
        if (errors.length > n0) return null;
        return fail(run[from].line, `"where ${wf} ${op}" is not followed by a value.`,
          `where ${wf} ${op} <value>, with text in double quotes and money as 1000.00 EUR`);
      }
      value = v.literal;
      i = v.next;
    } else if (kw(run[i]) === 'is') {
      i++;
      if (kw(run[i]) === 'not') { negated = true; i++; }
      op = negated ? '!=' : '=';
      if (thisMisuse(i) !== undefined) return null;
      const n1 = errors.length;
      const v = valueAt(run, i, file, errors, text);
      if (!v) {
        if (errors.length > n1) return null;
        return fail(run[from].line, `"where ${wf} is" is not followed by a value.`,
          `where ${wf} is <value>, with text in double quotes`);
      }
      value = v.literal;
      i = v.next;
    } else {
      const rest = rawOf(run.slice(from));
      return fail(run[from] ? run[from].line : whereLine,
        `"${rest || '(nothing)'}" after "where ${wf}" is not one of the forms an aggregate's `
        + '"where" allows.',
        `where ${wf} is <value>  /  where ${wf} > <value>  /  where ${wf} exists  /  where ${wf} not exists`
        + ' — exactly one condition, and it may not be a declared predicate (grammar.md §13.1)');
    }
    where = { field: wf, op, value, negated, text: rawOf(run.slice(from - 1, i)), line: whereLine };
  }

  return {
    agg: {
      fn, field, entity, scope, where,
      text: rawOf(run.slice(start, i)), line,
    },
    next: i,
  };
}

function parseCondition(run, file, errors, ruleText, fallbackLine = 1) {
  const text = rawOf(run);
  const line = lineOf(run) || fallbackLine;
  if (run.length === 0) {
    errors.push(err(file, line, 'an empty condition (two "and"s in a row, or a trailing "and").',
      ruleText, 'one condition between each "and"'));
    return null;
  }

  // `or` is not a condition connective in v1 — say so before anything else, because otherwise the
  // condition merely looks malformed and the author cannot tell why (grammar.md §10.2).
  const orAt = run.findIndex((t) => kw(t) === 'or');
  if (orAt !== -1) {
    errors.push(err(file, run[orAt].line,
      '"or" between conditions does not exist in grammar version 1 (it exists only in "## Authorized by").',
      text, 'write two rules — both apply — or declare a named predicate in the entity file'));
    return null;
  }

  // `sum of` and `count of` exist in grammar version 2 (§13). The aggregate functions that do NOT
  // exist are still named precisely, rather than the sentence merely looking malformed (§20.4).
  const words0 = run.map((t) => (t.quoted ? null : t.value.toLowerCase()));
  for (let k = 0; k + 1 < words0.length; k++) {
    if (['total', 'average', 'number', 'min', 'max', 'first', 'last'].includes(words0[k])
        && words0[k + 1] === 'of') {
      errors.push(err(file, run[k].line,
        `"${words0[k]} of …" is not one of the two ways grammar version 2 reads other documents.`,
        text,
        `"sum of <field> over <entity> …" or "count of <entity> …" (grammar.md §13). `
        + `An average is a ratio of two of those and belongs in a report, not in a rule — §20.4.`));
      return null;
    }
    if ((words0[k] === 'for' && ['each', 'all', 'any'].includes(words0[k + 1]))
        || (words0[k] === 'every' && words0[k + 1] !== undefined && k === 0)) {
      errors.push(err(file, run[k].line,
        `"${words0[k]} ${words0[k + 1]}" — a condition over many documents at once — does not exist in this grammar.`,
        text,
        '"count of <entity> where …" or "sum of <field> over <entity> where …", which say the same '
        + 'thing without a loop (grammar.md §13). There is no iteration in this grammar and there '
        + 'will not be one.'));
      return null;
    }
  }

  // Aggregate spans, so the operator scans below never look inside a `where`.
  const { spans, malformedAt } = topLevelSpans(run);
  if (malformedAt >= 0) {
    parseAggregate(run, malformedAt, file, errors, text);
    return null;
  }

  // Refuse operator-shaped garbage before anything else, so the message names the real problem.
  for (let k = 0; k < run.length; k++) {
    const t = run[k];
    if (t.quoted) continue;
    if (COMPARISON_OPERATORS.includes(t.value)) continue;
    if (/^[^\w\s"'.-]+$/.test(t.value) || Object.prototype.hasOwnProperty.call(OPERATOR_MISTAKES, t.value)) {
      const fix = OPERATOR_MISTAKES[t.value];
      errors.push(err(file, t.line,
        `"${t.value}" is not an operator known to grammar version 1.${fix ? ` Did you mean "${fix}"?` : ''}`,
        text, `one of ${list(COMPARISON_OPERATORS)}, or "exists" / "not exists" / a predicate declared on the entity`));
      return null;
    }
  }

  /**
   * The left of an operator: a single field path, or one whole aggregate (grammar version 2).
   * @returns {{subject:object, agg?:Aggregate}|null}
   */
  const leftOf = (from, to, opText, opLine) => {
    if (isWholeSpan(spans, from, to)) {
      const a = parseAggregate(run, from, file, errors, text);
      if (!a) return null;
      return { subject: { root: null, field: null, text: a.agg.text, line: a.agg.line }, agg: a.agg };
    }
    if (to - from !== 1) {
      errors.push(err(file, opLine,
        to - from === 0 ? `"${opText}" has nothing on its left.`
          : `"${rawOf(run.slice(from, to))}" on the left of "${opText}" must be a single field name.`,
        text, `<field> ${opText} <value>, for example: quantity ${opText} 0`));
      return null;
    }
    const path = parsePath(run[from], file, errors, text);
    return path ? { subject: path } : null;
  };

  /** The right of an operator: a value, another field, or one whole aggregate. */
  const rightOnto = (cond, from, to, opText, opLine) => {
    if (isWholeSpan(spans, from, to)) {
      const a = parseAggregate(run, from, file, errors, text);
      if (!a) return null;
      cond.valueAgg = a.agg;
      return cond;
    }
    if (to - from === 2 && isTwoTokenMoney(run, from)) {
      const v = valueAt(run, from, file, errors, text);
      if (!v) return null;
      cond.value = v.literal;
      return cond;
    }
    if (to - from !== 1) {
      errors.push(err(file, opLine,
        to - from === 0 ? `"${opText}" has nothing on its right.`
          : `"${rawOf(run.slice(from, to))}" on the right of "${opText}" must be a single value or a single field name.`,
        text, `<field> ${opText} <value>, with text in double quotes: status = "delivered"`));
      return null;
    }
    return withRightHandSide(cond, run[from], file, errors, text);
  };

  // 1. comparison
  for (let k = 0; k < run.length; k++) {
    const t = run[k];
    if (t.quoted || !COMPARISON_OPERATORS.includes(t.value) || inSpan(spans, k)) continue;
    const l = leftOf(0, k, t.value, t.line);
    if (!l) return null;
    const cond = { kind: 'compare', op: t.value, subject: l.subject, text, line };
    if (l.agg) cond.subjectAgg = l.agg;
    return rightOnto(cond, k + 1, run.length, t.value, t.line);
  }

  const words = run.map((t, k) => (inSpan(spans, k) ? null : kw(t)));

  // 3. exists / not exists
  if (words.length >= 2 && words[words.length - 1] === 'exists') {
    const negated = words[words.length - 2] === 'not';
    const cut = words.length - (negated ? 2 : 1);
    if (isWholeSpan(spans, 0, cut)) {
      errors.push(err(file, line,
        `"${rawOf(run.slice(0, cut))}" is a total, and a total always has a value, so "exists" says nothing about it.`,
        text, 'compare it, for example: count of order-line for this order > 0'));
      return null;
    }
    const subjectToks = run.slice(0, cut);
    if (subjectToks.length !== 1) {
      errors.push(err(file, line, `"${rawOf(subjectToks)}" before "${negated ? 'not exists' : 'exists'}" must be a single field name.`,
        text, '<field> exists  /  <field> not exists'));
      return null;
    }
    const path = parsePath(subjectToks[0], file, errors, text);
    if (!path) return null;
    return { kind: 'exists', subject: path, negated, text, line };
  }

  // 4. `is` / `is not`  (synonyms of `=` / `!=`)
  const isAt = words.indexOf('is');
  if (isAt !== -1) {
    const negated = words[isAt + 1] === 'not';
    const l = leftOf(0, isAt, 'is', run[isAt].line);
    if (!l) return null;
    const cond = { kind: 'compare', op: negated ? '!=' : '=', subject: l.subject, text, line };
    if (l.agg) cond.subjectAgg = l.agg;
    return rightOnto(cond, isAt + (negated ? 2 : 1), run.length, negated ? 'is not' : 'is', run[isAt].line);
  }

  // 5. named predicate: `<subject> [not] <predicate name>`
  if (run.length >= 2) {
    if (spans.length) {
      // The likeliest cause is an `and` inside a `where`: the rule's own `and` split the sentence
      // in two and this half is the leftover total. Say that, rather than only the symptom.
      const hasWhere = isWholeSpan(spans, 0, run.length) && run.some((t) => kw(t) === 'where');
      errors.push(err(file, line,
        `"${text}" is a total with nothing said about it — a total is a number, not a condition.`,
        text,
        hasWhere
          ? 'if an "and" follows this "where", that is the cause: an aggregate\'s "where" is ONE '
            + 'condition, so the "and" started a new condition of the rule and left this total '
            + 'dangling. "for this <entity>" plus one "where" gives two criteria without an "and" '
            + '(grammar.md §13.1, §20.8).'
          : 'compare it with something, for example: count of order-line for this order > 0, or '
            + 'sum of debit over posting for this journal-entry = sum of credit over posting for this journal-entry'));
      return null;
    }
    const path = parsePath(run[0], file, errors, text);
    if (!path) return null;
    const rest = run.slice(1);
    if (rest.some((t) => t.quoted)) {
      errors.push(err(file, line, `"${text}" mixes a text value into a predicate name.`, text,
        `one of: ${CONDITION_FORMS.slice(0, 8).join(' / ')}`));
      return null;
    }
    return {
      kind: 'predicate', subject: path, name: rest.map((t) => t.value).join(' ').toLowerCase(),
      negated: false, text, line,
    };
  }

  errors.push(err(file, line, `"${text}" is not a condition — it is a single word with nothing said about it.`,
    text, `one of: ${CONDITION_FORMS.join(' / ')}`));
  return null;
}

/**
 * The right-hand side of a comparison is either a value literal or another field
 * (`delivered-quantity >= ordered-quantity`), resolved exactly like the subject. Comparing two
 * fields is the only way a predicate such as "fully delivered" can be written at all.
 */
function withRightHandSide(cond, tok, file, errors, text) {
  const val = literal(tok);
  if (val) { cond.value = val; return cond; }
  const path = parsePath(tok, file, errors, text);
  if (!path) return null;
  cond.valuePath = path;
  return cond;
}

function parseConsequent(run, file, errors, ruleText, fallbackLine = 1) {
  const text = rawOf(run);
  const line = lineOf(run) || fallbackLine;
  if (run.length === 0) {
    errors.push(err(file, line, 'an empty step after "then" (two "and"s in a row, or a trailing "and").',
      ruleText, 'one step between each "and"'));
    return null;
  }
  const verb = kw(run[0]);
  if (!verb || !CONSEQUENT_VERBS.includes(verb)) {
    const extra = verb === 'read'
      ? ' "Read" changes nothing, so it cannot be a consequence.'
      : suggest(run[0].value, ['Create', 'Update', 'Delete']);
    errors.push(err(file, run[0].line,
      `"${run[0].raw}" is not something the runtime can do.${extra}`, text,
      `one of ${list(['Create <entity>', 'Create <entity> with <field> <value>', 'Update <entity> with <field> <value>', 'Update <entity> with +<field>', 'Delete <entity>'])}`));
    return null;
  }
  const entTok = run[1];
  if (!entTok || entTok.quoted || KEYWORDS.has(kw(entTok))) {
    errors.push(err(file, run[0].line, `"${run[0].raw}" must be followed by an entity name.`, text,
      `for example: ${run[0].raw} goods-receipt-fact`));
    return null;
  }
  if (!SLUG.test(entTok.value)) {
    errors.push(err(file, entTok.line, `"${entTok.raw}" is not a valid entity name.`, text,
      'a lower-case name like goods-receipt-fact'));
    return null;
  }

  let rest = run.slice(2);

  // Grammar version 2, §21 (FD-5 item 8): `Create <entity> as "<label>"`. One rule may create
  // several documents of the same entity, because double-entry creates two or more postings from
  // one event — that is what "double" means. The label becomes the id suffix, so the id is
  // readable in the text, deterministic, and visible in `git log`.
  let label = null;
  if (rest.length && kw(rest[0]) === 'as') {
    const labTok = rest[1];
    if (!labTok || KEYWORDS.has(kw(labTok))) {
      errors.push(err(file, rest[0].line, '"as" must be followed by a label in double quotes.', text,
        `${run[0].raw} ${entTok.value} as "receivable" — the label becomes the end of the new `
        + `document's id (grammar.md §21)`));
      return null;
    }
    const value = labTok.value;
    if (!SLUG.test(value)) {
      errors.push(err(file, labTok.line, `"${labTok.raw}" is not a usable label.`, text,
        'lower-case words joined by hyphens, for example: as "receivable" or as "exchange-loss". '
        + 'A label becomes part of a document id, and an id is a path segment (grammar.md §21).'));
      return null;
    }
    if (verb !== 'create') {
      errors.push(err(file, rest[0].line,
        `"as" says which of several NEW documents this is, so it has no meaning for "${run[0].raw}".`,
        text,
        `which document an "${run[0].raw}" changes is decided by the entity declarations, not by a `
        + 'label (grammar.md §5.1). "as" belongs to "Create" only (grammar.md §21).'));
      return null;
    }
    label = value;
    rest = rest.slice(2);
  }

  const clauses = [];
  if (rest.length) {
    if (kw(rest[0]) !== 'with') {
      // `as "<label>"` is the sentence an author reaches for when one rule must create SEVERAL
      // documents of the same kind — the two-to-four postings of a journal entry. It does not
      // exist, it is refused, and it is refused by name with its own entry in the known limits,
      // because a hole that has a name gets closed and a hole that produces a shrug does not.
      const isAs = kw(rest[0]) === 'as';
      errors.push(err(file, rest[0].line,
        `"${rest[0].raw}" is not understood after "${run[0].raw} ${entTok.value}".`, text,
        isAs
          ? `"with", for example: ${run[0].raw} ${entTok.value} with status "delivered".\n`
            + `  Creating SEVERAL "${entTok.value}" documents from one rule does not exist in this `
            + `grammar: every created document takes the triggering document's id (grammar.md §5.2), `
            + 'so two of them would collide. This is grammar.md §20.9 — a named hole with no '
            + 'workaround, not a construction you are writing wrongly.'
          : `"with", for example: ${run[0].raw} ${entTok.value} with status "delivered"`));
      return null;
    }
    for (const clauseToks of splitOn(rest, 'with').slice(1)) {
      const cl = parseClause(clauseToks, file, errors, text, line);
      if (!cl) return null;
      clauses.push(cl);
    }
  }
  if (verb === 'delete' && clauses.length) {
    errors.push(err(file, line, 'a "Delete" step cannot have a "with" part.', text,
      `Delete ${entTok.value}`));
    return null;
  }
  /** @type {Consequent} */
  const cons = { verb, entity: entTok.value, clauses, text, line };
  if (label !== null) cons.label = label;
  return cons;
}

/**
 * Two `Create <entity>` steps in one arm would need the same id, so they collide — grammar.md §21.
 * A **parse** error, not an execution one: the model is wrong however the data comes out.
 *
 * Per ARM, deliberately. Branch arms are alternatives and exactly one of them runs (§14.1), so two
 * arms may each create a `"receivable"` leg; that is the ordinary shape of a ledger rule.
 */
function detectDuplicateCreates(consequents, file, errors, ruleText) {
  const seen = new Map();
  for (const cons of consequents) {
    if (cons.verb !== 'create') continue;
    const key = `${cons.entity}/${cons.label || ''}`;
    const first = seen.get(key);
    if (first) {
      errors.push(err(file, cons.line,
        cons.label
          ? `this rule creates two "${cons.entity}" documents labelled "${cons.label}", and they would need the same id.`
          : `this rule creates two "${cons.entity}" documents with no label, and they would need the same id.`,
        cons.text,
        cons.label
          ? `a different label — the id is the triggering document's id followed by the label, so `
            + `two "${cons.label}" legs are one document (grammar.md §21). The step at line ${first.line} `
            + 'is the other one.'
          : `a label on each of them, for example: ${cons.entity} as "receivable" — otherwise both take `
            + `the triggering document's id (grammar.md §5.2, §21). The step at line ${first.line} is the other one.`));
      continue;
    }
    seen.set(key, cons);
  }
  void ruleText;
}

function parseClause(toks, file, errors, text, fallbackLine = 1) {
  const line = lineOf(toks) || fallbackLine;
  if (toks.length === 0) {
    errors.push(err(file, line, '"with" is followed by nothing.', text,
      `with <field> <value>  /  with <field>  /  with +<field>  /  with -<field>`));
    return null;
  }
  let first = toks[0];
  let sign = null;
  let fieldTok = first;
  let idx = 1;
  if (!first.quoted && (first.value === '+' || first.value === '-')) {
    sign = first.value; fieldTok = toks[1]; idx = 2;
  } else if (!first.quoted && /^[+-]/.test(first.value) && first.value.length > 1) {
    sign = first.value[0];
    fieldTok = { ...first, value: first.value.slice(1), raw: first.raw };
    idx = 1;
  }
  if (!fieldTok || fieldTok.quoted || !SLUG.test(String(fieldTok.value))) {
    errors.push(err(file, line, `"${rawOf(toks)}" is not a field name.`, text,
      'a lower-case field name like quantity or batch-number'));
    return null;
  }
  const field = fieldTok.value;
  const remaining = toks.slice(idx);
  if (sign) {
    const kind = sign === '+' ? 'add' : 'subtract';
    if (remaining.length === 0) {
      // Version 1: the same field name on both sides.
      return { kind, field, text: rawOf(toks), line };
    }
    // Grammar version 2, §17: `+<field> from <other-field>` — name the source field explicitly.
    if (kw(remaining[0]) === 'from') {
      const src = fromSource(remaining, file, errors, text, line, `${sign}${field}`);
      if (!src) return null;
      return { kind, field, from: src, text: rawOf(toks), line };
    }
    errors.push(err(file, line, `a counter step takes no value: "${rawOf(remaining)}" is one word too many.`,
      text,
      `with ${sign}${field}  (adds the ${field} of the triggering document), or `
      + `with ${sign}${field} from <field>  (adds a differently named field of it — grammar.md §17)`));
    return null;
  }
  if (remaining.length === 0) {
    // `with <field>` — the obligation form. This is the manifesto's headline demo (line 475).
    return { kind: 'require', field, text: rawOf(toks), line };
  }
  // Grammar version 2, §17 (FD-5 item 9): `with <field> from <other-field>` — the SET twin of the
  // counter twin. A labelled create (§21) is useless without it: a posting's account number, its
  // amount and its date come from the chart, the invoice and the entry, and none of those is a
  // literal.
  if (kw(remaining[0]) === 'from') {
    const src = fromSource(remaining, file, errors, text, line, field);
    if (!src) return null;
    return { kind: 'copy', field, from: src, text: rawOf(toks), line };
  }
  const before = errors.length;
  const v = valueAt(remaining, 0, file, errors, text);
  if (!v) {
    if (errors.length > before) return null; // valueAt already said exactly what was wrong
    errors.push(err(file, remaining[0].line, `"${remaining[0].raw}" is not a value.`, text,
      `a number, true / false, an amount like 4999.99 EUR, or text in double quotes — with ${field} "${remaining[0].value}"`));
    return null;
  }
  if (v.next !== remaining.length) {
    errors.push(err(file, line, `"${rawOf(remaining.slice(v.next))}" after "${field}" is more than one value.`, text,
      `with ${field} <one value>, with text in double quotes: with ${field} "delivered"`));
    return null;
  }
  return { kind: 'set', field, value: v.literal, text: rawOf(toks), line };
}

/**
 * The right-hand side of a `from` clause: `<field>` or `<reference>.<field>` — one hop, the same
 * resolution §4.1 already uses for a condition subject (grammar.md §17.1).
 *
 * ONE hop, not two. `chart.receivables-account-number` is what a ledger needs; a second hop invites
 * the correlated-path problem already refused in §20.1.
 *
 * @returns {{root:string, field:string|null, text:string, line:number}|null}
 */
function fromSource(remaining, file, errors, text, line, targetLabel) {
  const src = remaining[1];
  const shape = `with ${targetLabel} from <field>  or  with ${targetLabel} from <reference>.<field> `
    + '— for example: with amount from invoice.gross-amount (grammar.md §17.1)';
  if (!src || src.quoted || KEYWORDS.has(kw(src))) {
    errors.push(err(file, line, '"from" must be followed by a field of the triggering document.',
      text, shape));
    return null;
  }
  if (remaining.length > 2) {
    errors.push(err(file, line,
      `"${rawOf(remaining.slice(2))}" after "from ${src.value}" is more than a field name.`,
      text, `with ${targetLabel} from ${src.value}`));
    return null;
  }
  const parts = String(src.value).split('.');
  if (parts.length > 2) {
    errors.push(err(file, src.line,
      `"${src.value}" goes through ${parts.length - 1} references. A "from" follows one reference only.`,
      text,
      'either <field> or <reference>.<field>, for example: from invoice.gross-amount. Two hops would '
      + 'be the correlated-path problem grammar.md §20.1 refuses.'));
    return null;
  }
  for (const p of parts) {
    if (!SLUG.test(p)) {
      errors.push(err(file, src.line, `"${src.raw}" is not a valid field name.`, text, shape));
      return null;
    }
  }
  return { root: parts[0], field: parts[1] || null, text: String(src.value), line: src.line };
}

/**
 * Resolve a `from` source against the trigger's declarations, into steps `execute.js` follows.
 *
 * This is deliberately NOT `resolvePath`. A condition dereferences `order.customer` into the
 * customer *document*; a `from` clause wants the stored **value** — so that
 * `with ledger-account from chart.receivables-account` copies the id, which is exactly what a
 * `reference to ledger-account` field holds.
 *
 * @returns {{steps:object[], type:string, refEntity:string|null, values:string[]|null,
 *            declaredAt:{file:string,line:number}}|null}
 */
function resolveFromSource(from, triggerDef, model, file, errors, consText) {
  const rootField = triggerDef.fields.get(from.root);
  if (!rootField) {
    errors.push(err(file, from.line,
      `"from ${from.text}" reads "${from.root}", which is not a field of "${triggerDef.name}".${suggest(from.root, [...triggerDef.fields.keys()])}`,
      consText,
      triggerDef.fields.size
        ? `one of the fields declared in ${triggerDef.source.file}: ${list([...triggerDef.fields.keys()])}`
        : `a "## Fields" section in ${triggerDef.source.file} declaring "${from.root}"`));
    return null;
  }
  if (!from.field) {
    return {
      steps: [{ step: 'value', field: rootField.name }],
      type: rootField.type,
      refEntity: rootField.refEntity || null,
      values: rootField.values || null,
      declaredAt: rootField.source,
    };
  }
  if (rootField.type !== 'reference') {
    errors.push(err(file, from.line,
      `"${from.root}" is ${describeType(rootField)} on "${triggerDef.name}", so "${from.text}" has no meaning.`,
      consText,
      `either "from ${from.root}" on its own, or a field declared as "reference to …" before the dot `
      + `(declared in ${triggerDef.source.file}:${rootField.source.line})`));
    return null;
  }
  const inner = model.entities.get(rootField.refEntity);
  if (!inner) return null; // the dangling reference is already reported by validate()
  const hop = inner.fields.get(from.field);
  if (!hop) {
    errors.push(err(file, from.line,
      `"from ${from.text}" reads "${from.field}", which is not a field of "${inner.name}".${suggest(from.field, [...inner.fields.keys()])}`,
      consText,
      inner.fields.size
        ? `one of ${list([...inner.fields.keys()])} (declared in ${inner.source.file})`
        : `a "## Fields" section in ${inner.source.file}`));
    return null;
  }
  return {
    steps: [
      { step: 'ref', field: rootField.name, entity: rootField.refEntity },
      { step: 'value', field: hop.name },
    ],
    type: hop.type,
    refEntity: hop.refEntity || null,
    values: hop.values || null,
    declaredAt: hop.source,
  };
}

/**
 * May a value of the source declaration be written into the target declaration? Checked at parse
 * time, from the two declarations, and refused rather than coerced (grammar.md §17.2).
 * @returns {{ok:true}|{ok:false, why:string, expected:string}}
 */
function copyCompatible(src, target) {
  if (src.type === 'reference' || target.type === 'reference') {
    if (src.type !== 'reference' || target.type !== 'reference') {
      return {
        ok: false,
        why: 'one of them points at another document and the other is a plain value',
        expected: 'both declared "reference to <the same entity>", or neither',
      };
    }
    if (src.refEntity !== target.refEntity) {
      return {
        ok: false,
        why: `one points at ${article(src.refEntity)} ${src.refEntity} and the other at ${article(target.refEntity)} ${target.refEntity}`,
        expected: `both "reference to ${target.refEntity}"`,
      };
    }
    return { ok: true };
  }
  if (target.type === 'enum') {
    if (src.type !== 'enum') {
      return {
        ok: false,
        why: `"${src.name || 'the source'}" is ${src.type}, so it could carry any value at all into a closed set`,
        expected: `a field declared "one of …" with the same values, or a literal: with <field> "${(target.values || [])[0] ?? 'value'}"`,
      };
    }
    const stray = (src.values || []).filter((v) => !(target.values || []).includes(v));
    if (stray.length) {
      return {
        ok: false,
        why: `it can be ${list(stray)}, which the target does not allow`,
        expected: `values that are all among ${list(target.values || [])}`,
      };
    }
    return { ok: true };
  }
  if (src.type === 'enum') return target.type === 'text' ? { ok: true } : {
    ok: false,
    why: `an enumeration is text, and the target is ${target.type}`,
    expected: 'a text target, or a source of the same type',
  };
  if (src.type === target.type) return { ok: true };
  // money/number is the one crossing worth naming specifically: an amount of money is not a count
  // (FD-1, §17.2). Checked only against `number`, so money/text still reads as the plain mismatch.
  const moneyNumber = (a, b) => a === 'money' && b === 'number';
  if (moneyNumber(src.type, target.type) || moneyNumber(target.type, src.type)) {
    return {
      ok: false,
      why: 'an amount of money is not a count, and the runtime does not decide which currency a bare number is in',
      expected: 'both money or both number (FD-1)',
    };
  }
  return {
    ok: false,
    why: `one is ${src.type} and the other is ${target.type}`,
    expected: 'two fields of the same type',
  };
}

// ---------------------------------------------------------------------------------------------
// parseOperatingModel
// ---------------------------------------------------------------------------------------------

/**
 * @typedef {{ name:string, type:string, refEntity:string|null, required:boolean,
 *             source:{file:string,line:number} }} FieldDef
 * @typedef {{ name:string, text:string, conditions:Condition[],
 *             source:{file:string,line:number} }} PredicateDef
 * @typedef {{ name:string, title:string|null, fields:Map<string,FieldDef>,
 *             predicates:Map<string,PredicateDef>, identifiedBy:string[]|null,
 *             createdOnDemand:boolean, source:{file:string,line:number} }} EntityDef
 * @typedef {{ name:string, title:string|null, source:{file:string,line:number} }} RoleDef
 * @typedef {{ grammarVersion:number, processes:Rule[], entities:Map<string,EntityDef>,
 *             roles:Map<string,RoleDef>, locations:object[], suppliers:object[],
 *             managementSystem:object[] }} Model
 */

/**
 * Parse a whole operating model.
 * @param {Map<string,string>} files path -> file content
 * @returns {{ model: Model, errors: Diag[] }}
 */
export function parseOperatingModel(files) {
  /** @type {Diag[]} */ const errors = [];
  /** @type {Map<string,EntityDef>} */ const entities = new Map();
  /** @type {Map<string,RoleDef>} */ const roles = new Map();
  const locations = []; const suppliers = []; const managementSystem = [];
  /** @type {Rule[]} */ const processes = [];
  /** Predicate section bodies, parsed after all entities are known. */
  const pendingPredicates = [];
  /** Same for grammar version 2's invariants and period declarations. */
  const pendingInvariants = [];
  const pendingPeriods = [];

  const paths = [...files.keys()].sort(); // deterministic order, independent of Map insertion

  for (const path of paths) {
    const base = path.split('/').pop() || path;
    if (/^_/.test(base) || /^(readme|index)\.md$/i.test(base)) continue; // documentation
    if (!/\.md$/i.test(base)) continue;

    const category = categoryOf(path);
    if (!category) {
      errors.push(err(path, 1, 'this file is not inside one of the six POLISM folders, so the runtime does not know what it describes.',
        path, `a path containing one of ${list(POLISM_CATEGORIES)}`));
      continue;
    }
    const name = base.replace(/\.md$/i, '');
    if (!SLUG.test(name)) {
      errors.push(err(path, 1, `"${base}" is not a valid file name — the file name is the name of the thing it describes.`,
        base, 'lower-case words joined by hyphens, for example goods-receipt-fact.md'));
      continue;
    }

    const { prose, sections } = splitSections(files.get(path));
    const title = titleOf(prose);

    // --- sections: recognise or refuse. Never silently ignore (Principle 6).
    for (const s of sections) {
      if (RUNTIME_SECTIONS.includes(s.name) || PROSE_SECTIONS.includes(s.name)) continue;
      errors.push(err(path, s.line, `unknown section "## ${s.rawName}".${suggest(s.name, [...RUNTIME_SECTIONS, ...PROSE_SECTIONS])}`,
        `## ${s.rawName}`,
        `one of the runtime sections ${list(RUNTIME_SECTIONS)} or a prose section ${list(PROSE_SECTIONS)}. `
        + 'Free prose belongs above the first "## " section, or under a "### " subheading.'));
    }
    const sectionsFor = (n) => sections.filter((s) => s.name === n);
    const only = (n) => {
      const found = sectionsFor(n);
      if (found.length > 1) {
        errors.push(err(path, found[1].line, `"## ${found[1].rawName}" appears twice in this file.`,
          `## ${found[1].rawName}`, 'one section of each kind per file'));
      }
      return found[0] || null;
    };

    // --- entity definitions live in information/ only
    const entityOnly = ['fields', 'predicates', 'identified by', 'created on demand',
      'invariants', 'period', 'dated in'];
    if (category !== 'information') {
      for (const s of sections) {
        if (entityOnly.includes(s.name)) {
          errors.push(err(path, s.line,
            `"## ${s.rawName}" describes a kind of document, so it belongs in an "information/" file.`,
            `## ${s.rawName}`, `operating-model/information/${name}.md`));
        }
      }
    } else {
      const def = {
        name, title,
        fields: new Map(), predicates: new Map(), invariants: new Map(),
        identifiedBy: null, createdOnDemand: false,
        authority: null, period: null, datedIn: [],
        source: { file: path, line: 1 },
      };
      const fieldsSec = only('fields');
      if (fieldsSec) parseFields(fieldsSec, def, path, errors);
      const idSec = only('identified by');
      if (idSec) def.identifiedBy = parseIdentifiedBy(idSec, def, path, errors);
      const codSec = only('created on demand');
      if (codSec) def.createdOnDemand = parseYesNo(codSec, path, errors);
      const predSec = only('predicates');
      if (predSec) pendingPredicates.push({ def, section: predSec, file: path });
      // Grammar version 2. Invariants and periods reference conditions, so like predicates they
      // are parsed after every entity is known.
      const invSec = only('invariants');
      if (invSec) pendingInvariants.push({ def, section: invSec, file: path });
      const perSec = only('period');
      if (perSec) pendingPeriods.push({ def, section: perSec, file: path });
      const datedSec = only('dated in');
      if (datedSec) def.datedIn = parseDatedIn(datedSec, def, path, errors);
      const entAuthSec = only('authorized by');
      if (entAuthSec) {
        const ea = parseEntityAuthority(entAuthSec, path, errors);
        if (ea) def.authority = { byOp: ea.byOp, source: { file: path, line: entAuthSec.line } };
      }
      if (entities.has(name)) {
        errors.push(err(path, 1, `the entity "${name}" is already declared in ${entities.get(name).source.file}.`,
          path, 'one file per entity'));
      } else {
        entities.set(name, def);
      }
    }

    if (category === 'organisation') {
      if (roles.has(name)) {
        errors.push(err(path, 1, `the role "${name}" is already declared in ${roles.get(name).source.file}.`,
          path, 'one file per role'));
      } else {
        roles.set(name, { name, title, source: { file: path, line: 1 } });
      }
    }
    if (category === 'locations') locations.push({ name, title, source: { file: path, line: 1 } });
    if (category === 'suppliers') suppliers.push({ name, title, source: { file: path, line: 1 } });
    if (category === 'management-system') managementSystem.push({ name, title, source: { file: path, line: 1 } });

    // --- `## Authorized by` (file scope: applies to every rule in this file — grammar.md §6)
    let authorizedBy = [];
    const authSec = only('authorized by');
    if (authSec) {
      const perOp = /^[-*]?\s*(create|read|update|delete)\s*:/i;
      const usesOperations = authSec.lines.some((l) => perOp.test(l.text.trim()));
      const hasRules = sections.some((s) => s.name === 'rules');
      if (usesOperations && category !== 'information') {
        errors.push(err(path, authSec.line,
          'authority per operation is a declaration about a kind of document, so it belongs in an "information/" file.',
          `## ${authSec.rawName}`,
          `in ${path}, a plain list of roles that applies to the rules in this file (grammar.md §6). `
          + `Per-operation defaults go in operating-model/information/<entity>.md (grammar.md §16.1).`));
      } else if (!usesOperations) {
        authorizedBy = parseAuthorizedBy(authSec, path, errors);
        if (category === 'information' && !hasRules && authorizedBy.length) {
          // §16.1: a plain role list is version-1 FILE scope, and a file with no rules has none.
          // Words that govern nothing are exactly what an author would assume govern something.
          errors.push(warn(path, authSec.line,
            `"## Authorized by" here names ${list(authorizedBy)}, but this file has no "## Rules", `
            + 'so those roles govern nothing at all.',
            `## ${authSec.rawName}`,
            'to make them the default for every operation on this kind of document, name the '
            + 'operations:\n    ## Authorized by\n    - create: '
            + `${authorizedBy.join(' or ')}\n    - update: ${authorizedBy.join(' or ')}\n`
            + '  A plain list keeps its grammar-version-1 meaning, which is why this is a warning '
            + 'and not a silent change (grammar.md §0, §16.1).'));
        }
      }
    }

    // --- `## Rules`
    const rulesSec = only('rules');
    if (rulesSec) {
      for (const block of ruleBlocks(rulesSec, path, errors)) {
        const { rule, errors: rErrors } = parseRule(block.text, { file: path, line: block.line });
        errors.push(...rErrors);
        if (rule) {
          rule.authorizedBy = authorizedBy.slice();
          rule.authorizedBySource = authSec ? { file: path, line: authSec.line } : null;
          // Grammar version 2, §16: the file scope is remembered separately, so that
          // `resolveAuthority` can pick the most specific scope once every entity is known.
          rule.fileAuthority = authorizedBy.length
            ? { roles: authorizedBy.slice(), source: { file: path, line: authSec.line } }
            : null;
          processes.push(rule);
        }
      }
    }
  }

  // Predicate, invariant and period bodies need every entity to exist first.
  for (const p of pendingPredicates) parsePredicates(p.section, p.def, p.file, errors);
  for (const p of pendingInvariants) parseInvariants(p.section, p.def, p.file, errors);
  for (const p of pendingPeriods) p.def.period = parsePeriod(p.section, p.def, p.file, errors);

  /** @type {Model} */
  const model = {
    grammarVersion: GRAMMAR_VERSION,
    processes, entities, roles, locations, suppliers, managementSystem,
  };

  validate(model, errors);

  // Deterministic diagnostic order: file, line, message.
  errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1
    : a.line - b.line || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0)));

  // Rules run in a deterministic order (grammar.md §8): file path, then line.
  processes.sort((a, b) => (a.source.file < b.source.file ? -1 : a.source.file > b.source.file ? 1
    : a.source.line - b.source.line));

  return { model, errors };
}

function categoryOf(path) {
  const segs = path.split('/');
  for (let i = segs.length - 2; i >= 0; i--) if (POLISM_CATEGORIES.includes(segs[i])) return segs[i];
  return null;
}

/**
 * Rules are separated by a blank line, or by a new line starting with `If`.
 *
 * `## Rules` is the one section whose every line the runtime must account for, so a heading or a
 * commentary line here is refused rather than read as prose (grammar.md §1). The refusal names
 * `## Notes` and the offending line is dropped from the block, so one stray heading produces one
 * precise diagnostic instead of wrecking the rule around it.
 */
function ruleBlocks(section, file, errors) {
  const blocks = [];
  let cur = null;
  for (const l of section.lines) {
    const t = l.text.trim();
    if (!t) { cur = null; continue; }
    if (t.startsWith('#')) {
      errors.push(err(file, l.n,
        `"${t}" is a heading inside "## Rules", where only rules may appear.`, t,
        'move the explanation into a "## Notes" section, or into the prose above the first "## " section. '
        + 'Everything inside "## Rules" is enforced, so the runtime must be able to read every line of it (grammar.md §1).'));
      cur = null;
      continue;
    }
    const startsRule = /^if\b/i.test(t) && !/^\s/.test(l.text);
    if (!cur || startsRule) {
      cur = { line: l.n, lines: [l.text] };
      blocks.push(cur);
    } else {
      cur.lines.push(l.text);
    }
  }
  return blocks.map((b) => ({ line: b.line, text: b.lines.join('\n') }));
}

function parseFields(section, def, file, errors) {
  for (const b of bullets(section)) {
    const m = /^([^:]+):\s*(.+)$/.exec(b.text);
    if (!m) {
      errors.push(err(file, b.n, `"${b.text}" is not a field declaration.`, b.text,
        `- <field>: <${SCALAR_TYPES.join('|')}> [required]  or  - <field>: reference to <entity>`));
      continue;
    }
    const fname = m[1].trim();
    if (!SLUG.test(fname)) {
      errors.push(err(file, b.n, `"${fname}" is not a valid field name.`, b.text,
        'lower-case words joined by hyphens, for example batch-number'));
      continue;
    }
    let typeText = stripComment(m[2]);
    let required = false;
    const req = /\s+(required|mandatory)$/i.exec(typeText);
    if (req) { required = req[1].toLowerCase() === 'required'; typeText = typeText.slice(0, req.index).trim(); if (req[1].toLowerCase() === 'mandatory') required = true; }
    const refM = /^reference\s+to\s+(\S+)$/i.exec(typeText);
    const enumM = /^one\s+of\s+(.+)$/i.exec(typeText);
    let type; let refEntity = null; let values = null;
    if (enumM) {
      // Grammar version 2, §15: an enumeration. A typo becomes a refusal, in the model text and
      // in the data. Cheapest correctness win in the system.
      type = 'enum';
      values = [];
      for (const part of enumM[1].split(/\s*,\s*|\s+or\s+/i)) {
        const raw = part.trim();
        if (!raw) continue;
        const quoted = /^["“](.*)["”]$/.exec(raw);
        const value = quoted ? quoted[1] : trimPunctuation(raw);
        if (value === '') continue;
        if (!quoted && !SLUG.test(value)) {
          errors.push(err(file, b.n, `"${raw}" is not a usable value for "${fname}".`, b.text,
            'lower-case values like draft, posted, cancelled — or any text in double quotes, '
            + 'for example: one of "reverse-charge", "oss"'));
          values = null;
          break;
        }
        if (values.includes(value)) {
          errors.push(err(file, b.n, `"${value}" is listed twice among the values of "${fname}".`,
            b.text, 'each value once'));
          values = null;
          break;
        }
        values.push(value);
      }
      if (values === null) continue;
      if (values.length === 0) {
        errors.push(err(file, b.n, `"${fname}: one of" lists no values at all.`, b.text,
          'at least one value, for example: one of draft, posted, cancelled'));
        continue;
      }
    } else if (refM) {
      type = 'reference';
      refEntity = trimPunctuation(refM[1]);
      if (!SLUG.test(refEntity)) {
        errors.push(err(file, b.n, `"${refEntity}" is not a valid entity name.`, b.text,
          'reference to <entity>, for example: reference to order'));
        continue;
      }
    } else if (SCALAR_TYPES.includes(typeText.toLowerCase())) {
      type = typeText.toLowerCase();
    } else {
      errors.push(err(file, b.n, `"${typeText}" is not a field type known to grammar version 1.${suggest(typeText, SCALAR_TYPES)}`,
        b.text, `one of ${list(FIELD_TYPES)}`));
      continue;
    }
    if (def.fields.has(fname)) {
      errors.push(err(file, b.n, `the field "${fname}" is declared twice.`, b.text, 'one line per field'));
      continue;
    }
    /** @type {FieldDef} */
    const fd = { name: fname, type, refEntity, required, source: { file, line: b.n } };
    if (values) fd.values = values;
    def.fields.set(fname, fd);
  }
}

function parseIdentifiedBy(section, def, file, errors) {
  const found = [];
  for (const b of bullets(section)) {
    for (const part of b.text.split(/\s+and\s+|,\s*/i)) {
      const nm = trimPunctuation(part.trim());
      if (!nm) continue;
      if (!SLUG.test(nm)) {
        errors.push(err(file, b.n, `"${nm}" is not a valid field name.`, b.text,
          'field names of this entity, for example: article and location'));
        continue;
      }
      found.push({ name: nm, line: b.n, text: b.text });
    }
  }
  for (const f of found) {
    if (!def.fields.has(f.name)) {
      errors.push(err(file, f.line,
        `"## Identified by" names "${f.name}", which is not a field of "${def.name}".${suggest(f.name, [...def.fields.keys()])}`,
        f.text, def.fields.size
          ? `one of the declared fields ${list([...def.fields.keys()])}`
          : `a "## Fields" section declaring "${f.name}" first`));
    }
  }
  return found.map((f) => f.name);
}

function parseYesNo(section, file, errors) {
  const b = bullets(section);
  const v = b.length ? b[0].text.toLowerCase() : '';
  if (v === 'yes' || v === 'true') return true;
  if (v === 'no' || v === 'false') return false;
  errors.push(err(file, b.length ? b[0].n : section.line, `"${b.length ? b[0].text : '(nothing)'}" is not an answer to "## Created on demand".`,
    b.length ? b[0].text : '', '"yes" or "no"'));
  return false;
}

function parsePredicates(section, def, file, errors) {
  for (const b of bullets(section)) {
    const m = /^([^:]+):\s*(.+)$/.exec(b.text);
    if (!m) {
      errors.push(err(file, b.n, `"${b.text}" is not a predicate declaration.`, b.text,
        '- <name in plain words>: <condition> [and <condition>] — for example: - fully delivered: delivered-quantity >= ordered-quantity'));
      continue;
    }
    const pname = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/^[a-z0-9][a-z0-9 -]*$/.test(pname)) {
      errors.push(err(file, b.n, `"${m[1].trim()}" is not a usable predicate name.`, b.text,
        'plain lower-case words, for example: already fully delivered'));
      continue;
    }
    if (/\band\b/.test(pname)) {
      errors.push(err(file, b.n, `the predicate name "${pname}" contains the word "and", which grammar version 1 uses to separate conditions.`,
        b.text, 'a predicate name without the word "and"'));
      continue;
    }
    const { tokens, errors: tErrors } = tokenize([{ n: b.n, text: m[2] }], file);
    errors.push(...tErrors);
    const conditions = [];
    let bad = false;
    for (const run of splitOn(tokens, 'and')) {
      const c = parsePredicateCondition(run, file, errors, b.text, def);
      if (!c) { bad = true; continue; }
      conditions.push(c);
    }
    if (bad) continue;
    if (def.predicates.has(pname)) {
      errors.push(err(file, b.n, `the predicate "${pname}" is declared twice.`, b.text, 'one line per predicate'));
      continue;
    }
    def.predicates.set(pname, { name: pname, text: m[2].trim(), conditions, source: { file, line: b.n } });
  }
}

const PATH_TOKEN = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)?$/;

/**
 * Inside a predicate body the subject may be left out — it is a document of the entity that owns
 * the predicate — so `already fully delivered: fully delivered` references a sibling predicate.
 * That makes a run without an operator ambiguous: `customer blocked` could be the sibling
 * predicate "customer blocked", or the predicate "blocked" of the referenced customer.
 * Both readings are recorded here and the choice is made in `validate()`, once every predicate of
 * every entity is known: **a declared sibling predicate wins; otherwise it is read as
 * subject + predicate.** Order-independent, deterministic, documented in grammar.md §2.2.
 */
function parsePredicateCondition(run, file, errors, text, def) {
  const hasOperator = run.some((t) => !t.quoted && COMPARISON_OPERATORS.includes(t.value));
  const hasIs = run.some((t) => !t.quoted && kw(t) === 'is');
  const endsExists = run.length > 0 && kw(run[run.length - 1]) === 'exists';
  const anyQuoted = run.some((t) => t.quoted);

  if (run.length >= 1 && !hasOperator && !hasIs && !endsExists && !anyQuoted) {
    const cond = {
      kind: 'predicate',
      subject: { root: def.name, field: null, text: def.name, line: run[0].line },
      name: run.map((t) => t.value).join(' ').toLowerCase(),
      negated: false, text: rawOf(run), line: run[0].line, selfRef: true,
    };
    if (run.length >= 2 && PATH_TOKEN.test(run[0].value) && !KEYWORDS.has(kw(run[0]))) {
      const parts = run[0].value.split('.');
      cond._alt = {
        subject: { root: parts[0], field: parts[1] || null, text: run[0].value, line: run[0].line },
        name: run.slice(1).map((t) => t.value).join(' ').toLowerCase(),
      };
    }
    return cond;
  }
  return parseCondition(run, file, errors, text);
}

/** Resolve the ambiguity described above, once the whole model is known. */
function disambiguateSelfPredicate(c, def) {
  if (!c._alt) { delete c._alt; return; }
  const declared = def.predicates.has(c.name)
    || (c.name.startsWith('not ') && def.predicates.has(c.name.slice(4).trim()));
  if (!declared) {
    c.subject = c._alt.subject;
    c.name = c._alt.name;
    c.selfRef = false;
  }
  delete c._alt;
}

/**
 * `## Invariants` — grammar version 2, §12. Conditions that must hold after any change, or the
 * commit is refused. Bodies use the same grammar and the same implicit subject as a predicate.
 */
function parseInvariants(section, def, file, errors) {
  for (const b of bullets(section)) {
    const m = /^([^:]+):\s*(.+)$/.exec(b.text);
    if (!m) {
      errors.push(err(file, b.n, `"${b.text}" is not an invariant.`, b.text,
        '- <name in plain words>: <condition> — for example: '
        + '- debits equal credits: sum of debit over posting for this journal-entry = '
        + 'sum of credit over posting for this journal-entry'));
      continue;
    }
    const iname = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    if (!/^[a-z0-9][a-z0-9 -]*$/.test(iname)) {
      errors.push(err(file, b.n, `"${m[1].trim()}" is not a usable name for an invariant.`, b.text,
        'plain lower-case words, for example: debits equal credits'));
      continue;
    }
    if (/\band\b/.test(iname)) {
      errors.push(err(file, b.n,
        `the invariant name "${iname}" contains the word "and", which separates conditions.`,
        b.text, 'a name without the word "and"'));
      continue;
    }
    if (def.invariants.has(iname)) {
      errors.push(err(file, b.n, `the invariant "${iname}" is declared twice.`, b.text, 'one line per invariant'));
      continue;
    }
    const { tokens, errors: tErrors } = tokenize([{ n: b.n, text: m[2] }], file);
    errors.push(...tErrors);
    const conditions = [];
    let bad = false;
    for (const run of splitOn(tokens, 'and')) {
      const c = parsePredicateCondition(run, file, errors, b.text, def);
      if (!c) { bad = true; continue; }
      conditions.push(c);
    }
    if (bad || conditions.length === 0) continue;
    def.invariants.set(iname, {
      name: iname, text: m[2].trim(), conditions, source: { file, line: b.n },
    });
  }
}

/**
 * `## Period` — grammar version 2, §18. This entity's documents are periods: a date range and
 * what "locked" means for them. The parser knows the words; it knows nothing about months.
 */
function parsePeriod(section, def, file, errors) {
  const shape = '## Period with exactly three lines:\n'
    + '    - from: <date field>\n    - to: <date field>\n    - locked when: <condition>';
  const got = new Map();
  for (const b of bullets(section)) {
    const m = /^([^:]+):\s*(.+)$/.exec(b.text);
    if (!m) {
      errors.push(err(file, b.n, `"${b.text}" is not part of a period declaration.`, b.text, shape));
      continue;
    }
    const key = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    if (!['from', 'to', 'locked when'].includes(key)) {
      errors.push(err(file, b.n, `"${m[1].trim()}" is not part of a period declaration.${suggest(key, ['from', 'to', 'locked when'])}`,
        b.text, shape));
      continue;
    }
    if (got.has(key)) {
      errors.push(err(file, b.n, `"${key}" is declared twice in "## Period".`, b.text, shape));
      continue;
    }
    got.set(key, { value: m[2].trim(), line: b.n, text: b.text });
  }
  for (const key of ['from', 'to', 'locked when']) {
    if (!got.has(key)) {
      errors.push(err(file, section.line, `"## Period" does not say "${key}".`, `## ${section.rawName}`, shape));
      return null;
    }
  }
  const fromName = trimPunctuation(got.get('from').value);
  const toName = trimPunctuation(got.get('to').value);
  for (const [key, name] of [['from', fromName], ['to', toName]]) {
    if (!SLUG.test(name)) {
      errors.push(err(file, got.get(key).line, `"${name}" is not a valid field name.`, got.get(key).text,
        `a date field of "${def.name}", for example: - ${key}: ${key === 'from' ? 'starts-on' : 'ends-on'}`));
      return null;
    }
  }
  const lw = got.get('locked when');
  const { tokens, errors: tErrors } = tokenize([{ n: lw.line, text: lw.value }], file);
  errors.push(...tErrors);
  const lockedWhen = [];
  for (const run of splitOn(tokens, 'and')) {
    const c = parsePredicateCondition(run, file, errors, lw.text, def);
    if (c) lockedWhen.push(c);
  }
  if (lockedWhen.length === 0) {
    errors.push(err(file, lw.line, '"locked when" says no condition at all.', lw.text,
      'a condition on this period, for example: - locked when: status is "locked"'));
    return null;
  }
  return {
    from: fromName, to: toName, lockedWhen, lockedWhenText: lw.value,
    source: { file, line: section.line },
  };
}

/**
 * `## Dated in` — grammar version 2, §18. `<date field> in <period entity>`: a document of this
 * entity dated inside a locked period of that entity cannot be created, changed or deleted.
 */
function parseDatedIn(section, def, file, errors) {
  const out = [];
  const shape = '- <date field> in <period entity>, for example: - posting-date in accounting-period';
  for (const b of bullets(section)) {
    const m = /^(\S+)\s+in\s+(\S+)$/i.exec(b.text);
    if (!m) {
      errors.push(err(file, b.n, `"${b.text}" is not a "dated in" declaration.`, b.text, shape));
      continue;
    }
    const field = trimPunctuation(m[1]);
    const entity = trimPunctuation(m[2]);
    if (!SLUG.test(field) || !SLUG.test(entity)) {
      errors.push(err(file, b.n, `"${b.text}" names something that is not a plain field or document name.`,
        b.text, shape));
      continue;
    }
    if (out.some((d) => d.field === field && d.entity === entity)) {
      errors.push(err(file, b.n, `"${b.text}" is declared twice.`, b.text, 'one line per period kind'));
      continue;
    }
    out.push({ field, entity, source: { file, line: b.n } });
  }
  return out;
}

/**
 * `## Authorized by` with per-operation bullets — grammar version 2, §16.1, entity scope.
 * A plain role list is version-1 file scope and is left exactly as it was: giving those words a
 * new meaning would change the behaviour of a model that already exists (§0).
 * @returns {{byOp:Map<string,{roles:string[],line:number}>}|null} null = not the per-operation form
 */
function parseEntityAuthority(section, file, errors) {
  const bs = bullets(section);
  const isOpLine = (t) => /^(create|read|update|delete)\s*:/i.test(t);
  const opLines = bs.filter((b) => isOpLine(b.text));
  if (opLines.length === 0) return null;
  if (opLines.length !== bs.length) {
    const stray = bs.find((b) => !isOpLine(b.text));
    errors.push(err(file, stray.n,
      `"## Authorized by" here names operations, so every line must name one — "${stray.text}" does not.`,
      stray.text,
      `either every line as "- <create|read|update|delete>: <roles>", or a plain list of roles. `
      + 'The two forms are not mixed, so what governs what is never a question (grammar.md §16.1).'));
    return { byOp: new Map() };
  }
  const byOp = new Map();
  for (const b of bs) {
    const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(b.text);
    const op = m[1].toLowerCase();
    if (byOp.has(op)) {
      errors.push(err(file, b.n, `"${op}" is named twice in "## Authorized by".`, b.text,
        'one line per operation'));
      continue;
    }
    const roles = [];
    for (const t of tokenize([{ n: b.n, text: m[2] }], file).tokens) {
      const v = kw(t);
      if (v === 'or') continue;
      if (v === 'and') {
        errors.push(err(file, b.n,
          '"and" in "## Authorized by" does not exist: it would mean two different people must sign, and a single operation carries a single actor.',
          b.text,
          'roles joined by "or". Two signatures are a constraint on the commit (manifesto line 114), '
          + 'not on one operation; see grammar.md §10.4.'));
        continue;
      }
      if (t.quoted || !SLUG.test(t.value)) {
        errors.push(err(file, b.n, `"${t.raw}" is not a role name.`, b.text,
          `- ${op}: <role> or <role>, naming roles by their file names under organisation/`));
        continue;
      }
      if (!roles.includes(t.value)) roles.push(t.value);
    }
    if (roles.length === 0) {
      errors.push(err(file, b.n, `"- ${op}:" names no role at all.`, b.text,
        `- ${op}: <role>, for example: - ${op}: warehouse-management`));
      continue;
    }
    byOp.set(op, { roles, line: b.n });
  }
  return { byOp };
}

function parseAuthorizedBy(section, file, errors) {
  const out = [];
  for (const b of bullets(section)) {
    const tokens = tokenize([{ n: b.n, text: b.text }], file).tokens;
    for (const t of tokens) {
      const v = kw(t);
      if (v === 'or') continue;
      if (v === 'and') {
        errors.push(err(file, b.n,
          '"and" in "## Authorized by" does not exist in grammar version 1: it would mean two different people must sign, and a single operation carries a single actor.',
          b.text,
          'roles joined by "or" — the actor needs one of them. Two signatures are a constraint on the commit (manifesto line 114), not on one operation; see grammar.md §10.4.'));
        continue;
      }
      if (t.quoted || !SLUG.test(t.value)) {
        errors.push(err(file, b.n, `"${t.raw}" is not a role name.`, b.text,
          'role names as their file names under organisation/, for example: warehouse-clerk or warehouse-management'));
        continue;
      }
      if (!out.includes(t.value)) out.push(t.value);
    }
  }
  if (out.length === 0) {
    errors.push(err(file, section.line, '"## Authorized by" names no role at all.', `## ${section.rawName}`,
      'at least one role, for example: warehouse-clerk or warehouse-management'));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validation against the whole model. Everything resolvable statically is resolved statically,
// so that execute.js only follows plans it did not invent.
// ---------------------------------------------------------------------------------------------

function validate(model, errors) {
  for (const [, def] of model.entities) {
    for (const [, f] of def.fields) {
      if (f.type === 'reference' && !model.entities.has(f.refEntity)) {
        errors.push(err(f.source.file, f.source.line,
          `"${f.name}" points at "${f.refEntity}", but no such kind of document is declared.${suggest(f.refEntity, [...model.entities.keys()])}`,
          `${f.name}: reference to ${f.refEntity}`,
          `a file operating-model/information/${f.refEntity}.md describing it`));
      }
    }
    for (const [, p] of def.predicates) {
      for (const c of p.conditions) {
        if (c.kind === 'predicate') disambiguateSelfPredicate(c, def);
        resolveCondition(c, def.name, model, p.source.file, errors,
          `predicate "${p.name}" in ${p.source.file}:${p.source.line}`);
      }
    }
    // Grammar version 2, §12: invariant bodies read exactly like predicate bodies.
    for (const [, inv] of def.invariants) {
      for (const c of inv.conditions) {
        if (c.kind === 'predicate') disambiguateSelfPredicate(c, def);
        resolveCondition(c, def.name, model, inv.source.file, errors,
          `invariant "${inv.name}" in ${inv.source.file}:${inv.source.line}`);
      }
    }
    detectPredicateCycles(def, model, errors);
  }

  resolvePeriods(model, errors);
  buildInvariantWatch(model, errors);

  for (const rule of model.processes) {
    const file = rule.source.file;
    const trigger = model.entities.get(rule.trigger.entity);
    if (!trigger) {
      errors.push(err(file, rule.source.line,
        `this rule is about "${rule.trigger.entity}", but no such kind of document is declared.${suggest(rule.trigger.entity, [...model.entities.keys()])}`,
        firstLine(rule.text),
        `a file operating-model/information/${rule.trigger.entity}.md declaring its fields`));
      continue;
    }
    for (const c of rule.conditions) {
      resolveCondition(c, rule.trigger.entity, model, file, errors,
        `rule at ${file}:${rule.source.line}`);
    }
    for (const cons of rule.consequents) resolveConsequent(cons, rule, model, file, errors);
    // Grammar version 2, §14: a branch arm's conditions and consequents, in written order.
    for (const branch of rule.branches || []) {
      for (const c of branch.conditions) {
        resolveCondition(c, rule.trigger.entity, model, file, errors,
          `rule at ${file}:${rule.source.line}`);
      }
      for (const cons of branch.consequents) resolveConsequent(cons, rule, model, file, errors);
    }
  }

  resolveAuthority(model, errors);
  detectCascades(model, errors);
  detectContradictoryAuthorization(model, errors);
  detectUnsatisfiableConditions(model, errors);
  detectUnreachableBranches(model, errors);
  reportAuthorityCoverage(model, errors);
}

// ---------------------------------------------------------------------------------------------
// Grammar version 2 — periods (§18)
// ---------------------------------------------------------------------------------------------

function resolvePeriods(model, errors) {
  for (const [, def] of model.entities) {
    if (def.period) {
      // "locked when" is an ordinary condition list on this entity, and it must be resolved like
      // any other or `execute.js` cannot evaluate it — and a period that cannot be evaluated is a
      // period that never locks, which is the worst possible failure mode for this feature.
      for (const c of def.period.lockedWhen) {
        if (c.kind === 'predicate') disambiguateSelfPredicate(c, def);
        resolveCondition(c, def.name, model, def.period.source.file, errors,
          `"locked when" in ${def.period.source.file}:${def.period.source.line}`);
      }
      for (const key of ['from', 'to']) {
        const f = def.fields.get(def.period[key]);
        if (!f) {
          errors.push(err(def.period.source.file, def.period.source.line,
            `"## Period" names "${def.period[key]}" as its "${key}", which is not a field of "${def.name}".${suggest(def.period[key], [...def.fields.keys()])}`,
            `- ${key}: ${def.period[key]}`,
            def.fields.size
              ? `one of the declared fields ${list([...def.fields.keys()])}`
              : `a "## Fields" section declaring "${def.period[key]}: date"`));
        } else if (f.type !== 'date') {
          errors.push(err(f.source.file, f.source.line,
            `"## Period" uses "${f.name}" as its "${key}", so it must be a date, but it is declared as ${describeType(f)}.`,
            `${f.name}: ${f.type}`, `${f.name}: date`));
        }
      }
    }
    for (const d of def.datedIn) {
      const f = def.fields.get(d.field);
      if (!f) {
        errors.push(err(d.source.file, d.source.line,
          `"## Dated in" names "${d.field}", which is not a field of "${def.name}".${suggest(d.field, [...def.fields.keys()])}`,
          `${d.field} in ${d.entity}`,
          def.fields.size
            ? `one of the declared fields ${list([...def.fields.keys()])}`
            : `a "## Fields" section declaring "${d.field}: date"`));
      } else if (f.type !== 'date') {
        errors.push(err(d.source.file, d.source.line,
          `"${d.field}" decides which period a ${def.name} falls in, so it must be a date, but it is declared as ${describeType(f)}.`,
          `${d.field} in ${d.entity}`, `${d.field}: date in ${f.source.file}`));
      }
      const other = model.entities.get(d.entity);
      if (!other) {
        errors.push(err(d.source.file, d.source.line,
          `"## Dated in" names "${d.entity}", but no such kind of document is declared.${suggest(d.entity, [...model.entities.keys()])}`,
          `${d.field} in ${d.entity}`,
          `a file operating-model/information/${d.entity}.md with a "## Period" section`));
      } else if (!other.period) {
        errors.push(err(d.source.file, d.source.line,
          `"${d.entity}" is not a period: ${other.source.file} has no "## Period" section, so nothing says when one is locked.`,
          `${d.field} in ${d.entity}`,
          `in ${other.source.file}:\n    ## Period\n    - from: <date field>\n    - to: <date field>\n`
          + '    - locked when: <condition>  (grammar.md §18)'));
      }
    }
  }
}

/**
 * The implication graph of §12.1: which entity's invariants must be re-checked when a document of
 * some *other* entity changes. Read off the parsed invariants at parse time, never guessed at
 * execution time.
 *
 * `model.invariantWatch: Map<aggregatedEntity, [{ owner, linkField }]>`
 */
function buildInvariantWatch(model, errors) {
  /** @type {Map<string, {owner:string, linkField:string}[]>} */
  const watch = new Map();
  const add = (entity, entry) => {
    if (!watch.has(entity)) watch.set(entity, []);
    const list0 = watch.get(entity);
    if (!list0.some((e) => e.owner === entry.owner && e.linkField === entry.linkField)) list0.push(entry);
  };
  for (const [, def] of model.entities) {
    for (const [, inv] of def.invariants) {
      for (const c of inv.conditions) {
        for (const agg of [c.subjectAgg, c.valueAgg]) {
          if (!agg || !agg.resolved) continue;
          if (agg.resolved.linkField) add(agg.entity, { owner: def.name, linkField: agg.resolved.linkField });
        }
      }
    }
  }
  for (const [, entries] of watch) entries.sort((a, b) => (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
  model.invariantWatch = watch;
  void errors;
}

/**
 * The other half of §10.14, and the one an author is most likely to walk into: two rules on the
 * same trigger whose conditions cannot both hold. Because §8 conjoins them, "under 10,000 € do
 * this, above 10,000 € do that" written as two rules refuses EVERY instance. It parses, it reads
 * correct, and the process is dead.
 *
 * Only provable emptiness is reported, so there are no false alarms: two constraints on one field
 * have at most two breakpoints, and the candidate set below (each breakpoint, just below it, just
 * above it, and the midpoint) is sufficient to decide satisfiability for the v1 operators.
 */
function detectUnsatisfiableConditions(model, errors) {
  const groups = new Map();
  for (const r of model.processes) {
    const k = `${r.trigger.op}:${r.trigger.entity}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [, rules] of groups) {
    for (const r of rules) {
      const clash = firstImpossiblePair(r.conditions, r.conditions);
      if (clash) {
        errors.push(warn(r.source.file, clash.a.line,
          `this rule can never be satisfied: "${clash.a.text}" and "${clash.b.text}" cannot both be true, `
          + `so no ${r.trigger.entity} will ever pass it.`,
          clash.a.text, 'conditions that can hold at the same time — all conditions of a rule are required together'));
      }
    }
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i];
        const b = rules[j];
        const clash = firstImpossiblePair(a.conditions, b.conditions);
        if (!clash) continue;
        const op = a.trigger.op[0].toUpperCase() + a.trigger.op.slice(1);
        errors.push(warn(a.source.file, a.source.line,
          `this rule and the rule at ${b.source.file}:${b.source.line} both apply to "${op} ${a.trigger.entity}", `
          + `but "${clash.a.text}" here and "${clash.b.text}" there cannot both be true. Every rule that matches an `
          + `operation must be satisfied (they are conditions on one act, not alternatives), so every `
          + `"${op} ${a.trigger.entity}" will be refused.`,
          firstLine(a.text),
          'grammar version 1 has no branching. If these are two cases of one process, they cannot both be rules '
          + 'on the same trigger — see grammar.md §10.14 for the ranked exit paths.'));
      }
    }
  }
}

function firstImpossiblePair(as, bs) {
  for (const a of as) {
    for (const b of bs) {
      if (a === b) continue;
      if (!a.subject || !b.subject || a.subject.text !== b.subject.text) continue;
      if (provablyDisjoint(a, b)) return { a, b };
    }
  }
  return null;
}

/** Conservative: `true` only when the two conditions can demonstrably never hold together. */
function provablyDisjoint(a, b) {
  if (a.kind === 'exists' && b.kind === 'exists') return a.negated !== b.negated;
  // a field that must be absent cannot also have a value to compare
  if (a.kind === 'exists' && a.negated && b.kind === 'compare') return true;
  if (b.kind === 'exists' && b.negated && a.kind === 'compare') return true;
  if (a.kind === 'predicate' && b.kind === 'predicate') {
    return a.name === b.name && a.negated !== b.negated;
  }
  if (a.kind !== 'compare' || b.kind !== 'compare') return false;
  if (!a.value || !b.value) return false;          // field-to-field: not decidable here
  if (a.value.type !== b.value.type) return false; // a type error, reported elsewhere
  const va = a.value.value;
  const vb = b.value.value;
  let candidates;
  if (a.value.type === 'number') {
    candidates = [va - 1, va, va + 1, vb - 1, vb, vb + 1, (va + vb) / 2];
  } else if (a.value.type === 'boolean') {
    candidates = [true, false];
  } else if (a.value.type === 'money') {
    // Exact, in BigInt minor units. Money must NOT fall through to the string candidates below:
    // "10000.00 EUR" sorts before "1000.00 EUR" lexicographically, which would invent
    // contradictions in exactly the threshold rules this detector exists for (FD-1).
    if (!a.value.amount || !b.value.amount) return false;
    if (a.value.amount.currency !== b.value.amount.currency) return false;
    const ma = a.value.amount.minor;
    const mb = b.value.amount.minor;
    const points = [ma - 1n, ma, ma + 1n, mb - 1n, mb, mb + 1n];
    return !points.some((x) => satisfiesCompare(x, a.op, ma) && satisfiesCompare(x, b.op, mb));
  } else {
    // text and ISO dates: both values, the string immediately after each (which for equal-length
    // ISO dates lies strictly between them), and one value below and above everything
    candidates = [va, vb, va + '\u0001', vb + '\u0001', '', '\uffff'];
  }
  return !candidates.some((x) => satisfiesCompare(x, a.op, va) && satisfiesCompare(x, b.op, vb));
}

function satisfiesCompare(x, op, v) {
  switch (op) {
    case '=': return x === v;
    case '!=': return x !== v;
    case '>': return x > v;
    case '>=': return x >= v;
    case '<': return x < v;
    case '<=': return x <= v;
    default: return true;
  }
}

/**
 * Every rule matching an operation must be satisfied (§8), and `## Authorized by` is a property of
 * the FILE, not of the rule. So two files that mean "under 10,000 € a clerk may do it, above that
 * only the managing director" do not produce two branches — they produce an operation that nobody
 * can perform, because whoever satisfies one rule's roles violates the other's.
 *
 * That is a latent, silent hole: the model reads correct and the operation is simply dead. It is
 * statically detectable, so it is stated out loud here. See grammar.md §10.14 for the exit paths.
 */
function detectContradictoryAuthorization(model, errors) {
  const groups = new Map();
  for (const r of model.processes) {
    const k = `${r.trigger.op}:${r.trigger.entity}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [, rules] of groups) {
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i];
        const b = rules[j];
        if (!a.authorizedBy.length || !b.authorizedBy.length) continue;
        // Grammar version 2: branches ARE the fix for this, so a rule whose arms carry their own
        // authority is not the trap — warning about it would be a false alarm (§14, §16).
        if ((a.branches || []).some((x) => x.inlineAuthority)) continue;
        if ((b.branches || []).some((x) => x.inlineAuthority)) continue;
        // one file, one "## Authorized by": rules from the same file can never contradict —
        // unless one of them now carries its own inline authority (grammar version 2, §16).
        if (a.source.file === b.source.file && !a.inlineAuthority && !b.inlineAuthority) continue;
        if (a.authorizedBy.some((role) => b.authorizedBy.includes(role))) continue;
        const op = a.trigger.op[0].toUpperCase() + a.trigger.op.slice(1);
        errors.push(warn(a.source.file, a.source.line,
          `this rule and the rule at ${b.source.file}:${b.source.line} both apply to "${op} ${a.trigger.entity}", `
          + `but they authorise roles with nothing in common (${list(a.authorizedBy)} versus ${list(b.authorizedBy)}). `
          + `Every rule that matches an operation must be satisfied, so no one can satisfy both and every `
          + `"${op} ${a.trigger.entity}" will be refused, whoever attempts it.`,
          firstLine(a.text),
          'in grammar version 1, all rules on one operation are conditions on the same act, not alternative '
          + 'branches. Put the different authority levels in one file if they share roles, or keep them as '
          + 'documentation until "## Authorized by" can be written per rule (grammar.md §10.14).'));
      }
    }
  }
}

/**
 * Statically resolve a path into a list of steps `execute.js` follows blindly.
 * @returns {{steps:object[], target:{kind:'doc'|'scalar', entity?:string, type?:string, field?:string}}|null}
 */
function resolvePath(path, ctxEntityName, model, file, errors, context, conditionText) {
  const ctx = model.entities.get(ctxEntityName);
  if (!ctx) return null;
  const steps = [{ step: 'self', entity: ctxEntityName }];
  let cursorEntity = ctxEntityName;
  let target = { kind: 'doc', entity: ctxEntityName };

  const rootField = ctx.fields.get(path.root);
  if (rootField) {
    if (rootField.type === 'reference') {
      steps.push({ step: 'ref', field: rootField.name, entity: rootField.refEntity });
      cursorEntity = rootField.refEntity;
      target = { kind: 'doc', entity: rootField.refEntity };
    } else {
      steps.push({ step: 'field', field: rootField.name, type: rootField.type });
      target = { kind: 'scalar', type: rootField.type, entity: ctxEntityName, field: rootField.name };
    }
  } else if (path.root === ctxEntityName) {
    // the context document itself
  } else {
    errors.push(err(file, path.line,
      `"${path.root}" is not a field of "${ctxEntityName}".${suggest(path.root, [...ctx.fields.keys(), ctxEntityName])}`,
      conditionText,
      ctx.fields.size
        ? `one of the fields declared in ${ctx.source.file}: ${list([...ctx.fields.keys()])}`
        : `a "## Fields" section in ${ctx.source.file} declaring "${path.root}"`));
    return null;
  }

  if (path.field) {
    if (target.kind === 'scalar') {
      errors.push(err(file, path.line,
        `"${path.root}" is a ${target.type}, so "${path.root}.${path.field}" has no meaning.`,
        conditionText,
        `either "${path.root}" on its own, or a field declared as "reference to …" before the dot`));
      return null;
    }
    const inner = model.entities.get(cursorEntity);
    if (!inner) return null;
    const f = inner.fields.get(path.field);
    if (!f) {
      errors.push(err(file, path.line,
        `"${path.field}" is not a field of "${cursorEntity}".${suggest(path.field, [...inner.fields.keys()])}`,
        conditionText,
        inner.fields.size
          ? `one of ${list([...inner.fields.keys()])} (declared in ${inner.source.file})`
          : `a "## Fields" section in ${inner.source.file}`));
      return null;
    }
    if (f.type === 'reference') {
      steps.push({ step: 'ref', field: f.name, entity: f.refEntity });
      target = { kind: 'doc', entity: f.refEntity };
    } else {
      steps.push({ step: 'field', field: f.name, type: f.type });
      target = { kind: 'scalar', type: f.type, entity: cursorEntity, field: f.name };
    }
  }
  return { steps, target };
}

/**
 * Does a literal fit a declared field? One place, so the parser, the enum check and the
 * aggregate's `where` all agree about what may be compared with what.
 * @returns {{ok:true, warning?:string}|{ok:false, message:string, expected:string}}
 */
function literalFits(f, v, subjectText, model, file) {
  const t = f.type;
  // A quoted string that happens to be canonical money is money only where money is wanted;
  // everywhere else it is the text it looks like.
  const asText = v.type === 'money' ? { type: 'text', value: v.value } : v;
  if (t === 'number') {
    return v.type === 'number' ? { ok: true }
      : { ok: false, message: `it is compared with ${describeLiteral(v)}`, expected: 'a number, for example: 0' };
  }
  if (t === 'money') {
    if (v.type === 'money') return { ok: true };
    if (v.type === 'number') {
      // Grammar version 1 models say `payable-amount > 0`, and §0 means that keeps working. A
      // NON-zero bare number names no currency, so it is a warning — never a silent conversion.
      const isZeroLiteral = /^-?0(\.0+)?$/.test(String(v.raw !== undefined ? v.raw : v.value));
      return isZeroLiteral ? { ok: true } : {
        ok: true,
        warning: `"${subjectText}" is money, and ${v.raw !== undefined ? v.raw : v.value} names no `
          + 'currency, so this compares the same against 1000 EUR and 1000 JPY. It is exact and it '
          + `keeps its grammar-version-1 meaning (§19.2), but write it as "${v.raw !== undefined ? v.raw : v.value}.00 EUR" `
          + 'to say which money you mean.',
      };
    }
    return { ok: false, message: `it is compared with ${describeLiteral(v)}`, expected: 'an amount with its currency, for example: 4999.99 EUR' };
  }
  if (t === 'boolean') {
    return v.type === 'boolean' ? { ok: true }
      : { ok: false, message: `it is compared with ${describeLiteral(v)}`, expected: 'true or false' };
  }
  if (t === 'date') {
    return asText.type === 'text' && ISO_DATE.test(String(asText.value)) ? { ok: true }
      : { ok: false, message: `it is compared with ${describeLiteral(v)}`, expected: 'a date in double quotes, for example: "2027-04-03"' };
  }
  if (t === 'enum') {
    if (asText.type !== 'text') {
      return { ok: false, message: `it is compared with ${describeLiteral(v)}`, expected: `one of ${list(f.values)}, in double quotes` };
    }
    if (!f.values.includes(String(asText.value))) {
      return {
        ok: false,
        message: `"${asText.value}" is not one of the values it can have.${suggest(String(asText.value), f.values)}`,
        expected: `one of ${list(f.values)}, declared in ${f.source.file}:${f.source.line} as `
          + `"${f.name}: one of ${f.values.join(', ')}"`,
      };
    }
    return { ok: true };
  }
  void model; void file;
  return asText.type === 'text' ? { ok: true }
    : { ok: false, message: `it is compared with ${describeLiteral(v)}`, expected: 'text in double quotes, for example: "delivered"' };
}

// ---------------------------------------------------------------------------------------------
// Grammar version 2 — aggregation (§13). Resolved statically into a question the index can
// answer; `execute.js` only asks it.
// ---------------------------------------------------------------------------------------------

/**
 * @returns {{type:string}|null} the aggregate's value type, or null when it was refused
 */
function resolveAggregate(agg, ctxEntityName, model, file, errors, context) {
  const shape = aggregateShape(agg.fn);
  const fail = (message, expected) => {
    errors.push(err(file, agg.line, message, agg.text, expected || shape));
    return null;
  };
  const target = model.entities.get(agg.entity);
  if (!target) {
    return fail(
      `"${agg.fn} of … ${agg.fn === 'sum' ? 'over ' : ''}${agg.entity}" counts "${agg.entity}", but no such kind of document is declared.${suggest(agg.entity, [...model.entities.keys()])}`,
      `a file operating-model/information/${agg.entity}.md declaring its fields`);
  }

  let valueType = 'number';
  if (agg.fn === 'sum') {
    const f = target.fields.get(agg.field);
    if (!f) {
      return fail(
        `"${agg.field}" is not a field of "${agg.entity}".${suggest(agg.field, [...target.fields.keys()])}`,
        target.fields.size
          ? `one of ${list([...target.fields.keys()])} (declared in ${target.source.file})`
          : `a "## Fields" section in ${target.source.file} declaring "${agg.field}"`);
    }
    if (f.type !== 'number' && f.type !== 'money') {
      return fail(
        `"${agg.field}" is ${describeType(f)} on "${agg.entity}", so it cannot be added up.`,
        `a number or money field, declared in ${target.source.file}:${f.source.line}`);
    }
    valueType = f.type;
  }

  const filters = [];
  let linkField = null;
  if (agg.scope) {
    if (agg.scope.entity !== ctxEntityName) {
      return fail(
        `"for this ${agg.scope.entity}" means the ${agg.scope.entity} this condition is about, but `
        + `this condition is about ${article(ctxEntityName)} ${ctxEntityName}.`,
        `for this ${ctxEntityName} — or leave "for this" out and add a "where" (grammar.md §13.2)`);
    }
    if (agg.entity === ctxEntityName) {
      return fail(
        `"for this ${agg.scope.entity}" would ask a ${agg.entity} to point at itself.`,
        'an aggregate over a different kind of document — a set of one is not a set (grammar.md §12.3)');
    }
    const refs = [...target.fields.values()]
      .filter((f) => f.type === 'reference' && f.refEntity === agg.scope.entity);
    if (refs.length === 0) {
      return fail(
        `"for this ${agg.scope.entity}" needs "${agg.entity}" to say which ${agg.scope.entity} it belongs to, and it does not.`,
        `a field "${agg.scope.entity}: reference to ${agg.scope.entity}" in ${target.source.file}`);
    }
    if (refs.length > 1) {
      return fail(
        `"${agg.entity}" has ${refs.length} references to "${agg.scope.entity}" (${list(refs.map((r) => r.name))}), so it is not clear which one links them.`,
        `one reference. Rename or merge the fields in ${target.source.file} (grammar.md §13.2, §10.5)`);
    }
    linkField = refs[0].name;
    filters.push({ field: linkField, op: '=', from: 'context-id' });
  }

  if (agg.where) {
    const wf = target.fields.get(agg.where.field);
    if (!wf) {
      return fail(
        `"where ${agg.where.field}" names a field "${agg.entity}" does not have.${suggest(agg.where.field, [...target.fields.keys()])}`,
        target.fields.size
          ? `one of ${list([...target.fields.keys()])} (declared in ${target.source.file})`
          : `a "## Fields" section in ${target.source.file}`);
    }
    if (agg.where.op !== 'exists') {
      if (['>', '>=', '<', '<='].includes(agg.where.op) && !ORDERED_TYPES.includes(wf.type)) {
        return fail(
          `"${agg.where.op}" has no meaning for "${agg.where.field}", which is declared as ${describeType(wf)}.`,
          `"${agg.where.op}" for ${list(ORDERED_TYPES)} fields; for ${wf.type} use "is" / "is not"`);
      }
      if (wf.type === 'reference') {
        if (agg.where.value.type !== 'text' && agg.where.value.type !== 'money') {
          return fail(
            `"${agg.where.field}" points at ${article(wf.refEntity)} ${wf.refEntity}, so it is compared with an id.`,
            `an id in double quotes, for example: where ${agg.where.field} is "JE-0001"`);
        }
      } else {
        const fit = literalFits(wf, agg.where.value, agg.where.field, model, file);
        if (!fit.ok) {
          return fail(
            `"${agg.where.field}" is declared as ${describeType(wf)} in ${wf.source.file}, but ${fit.message}`,
            fit.expected);
        }
        if (fit.warning) errors.push(warn(file, agg.line, fit.warning, agg.text));
      }
    }
    filters.push({
      field: wf.name,
      op: agg.where.op === 'exists' ? (agg.where.negated ? 'not exists' : 'exists') : agg.where.op,
      value: agg.where.op === 'exists' ? null : agg.where.value,
    });
  }

  agg.resolved = {
    entity: agg.entity, field: agg.field, fieldType: valueType, linkField, filters,
  };

  if (filters.length === 0) {
    // §13.3: no filter means every document of that entity, on every evaluation. Worth knowing
    // before it is worth measuring.
    errors.push(warn(file, agg.line,
      `"${agg.text}" reads every ${agg.entity} there is, every time this is checked, because it `
      + 'names no "for this" and no "where".',
      agg.text,
      `if it should only cover part of them, add "for this <entity>" or "where <field> is <value>" `
      + '— either becomes a question the index answers directly (grammar.md §13.3). A total over '
      + 'everything is a legitimate thing to want, which is why this is a warning.'));
  }
  void context;
  return { type: valueType };
}

function resolveCondition(c, ctxEntityName, model, file, errors, context) {
  // Grammar version 2, §13: the subject may be an aggregate instead of a path.
  if (c.subjectAgg) {
    const left = resolveAggregate(c.subjectAgg, ctxEntityName, model, file, errors, context);
    if (!left) return;
    c.resolved = { steps: null, target: { kind: 'scalar', type: left.type, aggregate: true } };
    if (c.kind !== 'compare') return;
    if (c.valueAgg) {
      const right = resolveAggregate(c.valueAgg, ctxEntityName, model, file, errors, context);
      if (!right) return;
      if (family(left.type) !== family(right.type)) {
        errors.push(err(file, c.line,
          `"${c.subjectAgg.text}" adds up ${left.type} and "${c.valueAgg.text}" adds up ${right.type}, so comparing them has no defined meaning.`,
          c.text, 'two totals of the same kind — both numbers, or both money'));
      }
      return;
    }
    if (c.valuePath) {
      const rv = resolvePath(c.valuePath, ctxEntityName, model, file, errors, context, c.text);
      if (!rv) return;
      c.resolvedValue = { steps: rv.steps, target: rv.target };
      if (rv.target.kind !== 'scalar' || family(rv.target.type) !== family(left.type)) {
        errors.push(err(file, c.line,
          `"${c.subjectAgg.text}" adds up ${left.type}, and "${c.valuePath.text}" is `
          + `${rv.target.kind === 'scalar' ? rv.target.type : `a whole ${rv.target.entity} document`}, `
          + 'so comparing them has no defined meaning.',
          c.text, `a ${left.type} field, or another total of ${left.type}`));
      }
      return;
    }
    const pseudo = { name: c.subject.text, type: left.type, source: { file, line: c.line } };
    const fit = literalFits(pseudo, c.value, c.subject.text, model, file);
    if (!fit.ok) {
      errors.push(err(file, c.line,
        `"${c.subject.text}" adds up ${left.type}, but ${fit.message}`, c.text, fit.expected));
    } else if (fit.warning) {
      errors.push(warn(file, c.line, fit.warning, c.text));
    }
    return;
  }

  const r = resolvePath(c.subject, ctxEntityName, model, file, errors, context, c.text);
  if (!r) return;
  c.resolved = { steps: r.steps, target: r.target };

  if (c.kind === 'compare') {
    // Grammar version 2, §13: an aggregate on the right-hand side.
    if (c.valueAgg) {
      if (r.target.kind !== 'scalar') {
        errors.push(err(file, c.line,
          `"${c.subject.text}" is a whole ${r.target.entity} document, not a single value, so it cannot be compared with a total.`,
          c.text, `a field of it, for example: ${c.subject.text}.<field>`));
        return;
      }
      const right = resolveAggregate(c.valueAgg, ctxEntityName, model, file, errors, context);
      if (!right) return;
      if (family(r.target.type) !== family(right.type)) {
        errors.push(err(file, c.line,
          `"${c.subject.text}" is ${r.target.type} and "${c.valueAgg.text}" adds up ${right.type}, so comparing them has no defined meaning.`,
          c.text, `a ${right.type} field`));
      }
      if (['>', '>=', '<', '<='].includes(c.op) && !ORDERED_TYPES.includes(r.target.type)) {
        errors.push(err(file, c.line,
          `"${c.op}" has no meaning for "${c.subject.text}", which is declared as ${r.target.type}.`,
          c.text, `"${c.op}" for ${list(ORDERED_TYPES)} fields`));
      }
      return;
    }
    if (r.target.kind !== 'scalar') {
      errors.push(err(file, c.line,
        `"${c.subject.text}" is a whole ${r.target.entity} document, not a single value, so it cannot be compared with "${c.op}".`,
        c.text,
        `a field of it, for example: ${c.subject.text}.<field> ${c.op} …  — or "${c.subject.text} exists", or a predicate declared in operating-model/information/${r.target.entity}.md`));
      return;
    }
    const t = r.target.type;
    const ownerDef = r.target.entity ? model.entities.get(r.target.entity) : null;
    const declared = ownerDef && r.target.field ? ownerDef.fields.get(r.target.field) : null;
    if (['>', '>=', '<', '<='].includes(c.op) && !ORDERED_TYPES.includes(t)) {
      errors.push(err(file, c.line,
        `"${c.op}" has no meaning for "${c.subject.text}", which is declared as ${typeWords(declared, t)}.`,
        c.text,
        `"${c.op}" for ${list(ORDERED_TYPES)} fields; for ${typeWords(declared, t)} use "is" / "is not"`
        + (t === 'enum' ? ' — an enumeration is a set, not a scale' : '')));
      return;
    }
    if (c.valuePath) {
      // field-to-field comparison: resolve the right side in the same context
      const rv = resolvePath(c.valuePath, ctxEntityName, model, file, errors, context, c.text);
      if (!rv) return;
      c.resolvedValue = { steps: rv.steps, target: rv.target };
      if (rv.target.kind !== 'scalar') {
        errors.push(err(file, c.line,
          `"${c.valuePath.text}" is a whole ${rv.target.entity} document, not a single value, so "${c.subject.text}" cannot be compared with it.`,
          c.text, `a field of it, for example: ${c.valuePath.text}.<field>`));
        return;
      }
      if (family(t) !== family(rv.target.type)) {
        errors.push(err(file, c.line,
          `"${c.subject.text}" is ${t} and "${c.valuePath.text}" is ${rv.target.type}, so comparing them has no defined meaning.`,
          c.text, 'two fields of the same kind of type (both numbers, both dates, both text)'));
      }
      return;
    }
    const v = c.value;
    const owner = r.target.entity ? model.entities.get(r.target.entity) : null;
    const fdef = owner && r.target.field ? owner.fields.get(r.target.field) : null;
    const fit = literalFits(fdef || { name: c.subject.text, type: t, values: [], source: { file, line: c.line } },
      v, c.subject.text, model, file);
    if (!fit.ok) {
      errors.push(err(file, c.line,
        `"${c.subject.text}" is declared as ${typeWords(fdef, t)} in ${owner ? owner.source.file : file}, but ${fit.message}`,
        c.text, fit.expected));
    } else if (fit.warning) {
      errors.push(warn(file, c.line, fit.warning, c.text));
    }
    return;
  }

  if (c.kind === 'exists') return; // defined for both documents and scalars (grammar.md §4.3)

  // named predicate
  if (r.target.kind !== 'scalar') {
    const owner = model.entities.get(r.target.entity);
    if (!owner) return;
    const exact = owner.predicates.get(c.name);
    if (exact) { c.resolvedPredicate = { entity: owner.name, name: c.name }; return; }
    if (c.name.startsWith('not ')) {
      const inner = c.name.slice(4).trim();
      if (owner.predicates.has(inner)) {
        c.name = inner; c.negated = true;
        c.resolvedPredicate = { entity: owner.name, name: inner };
        return;
      }
    }
    const known = [...owner.predicates.keys()];
    errors.push(err(file, c.line,
      `"${c.name}" is not something declared about ${article(owner.name)} ${owner.name}.${suggest(c.name.replace(/^not /, ''), known)}`,
      c.text,
      known.length
        ? `one of the predicates declared in ${owner.source.file}: ${list(known)} (optionally with "not" in front)`
        : `a "## Predicates" section in ${owner.source.file} saying what "${c.name.replace(/^not /, '')}" means, for example:\n    ## Predicates\n    - ${c.name.replace(/^not /, '')}: <condition>`));
    return;
  }
  errors.push(err(file, c.line,
    `"${c.text}" is not understood: "${c.subject.text}" is a single ${r.target.type} value, and "${c.name}" is neither an operator nor a predicate.`,
    c.text, `one of: ${CONDITION_FORMS.join(' / ')}`));
}

/** Type families decide what may be compared with what. */
function family(t) {
  return t === 'number' || t === 'money' ? 'number' : t;
}

function describeLiteral(v) {
  if (v.type === 'text') return `the text "${v.value}"`;
  if (v.type === 'number') return `the number ${v.raw !== undefined ? v.raw : v.value}`;
  if (v.type === 'money') return `the amount ${v.value}`;
  return `${v.value}`;
}

function detectPredicateCycles(def, model, errors) {
  const visit = (name, trail) => {
    const p = def.predicates.get(name);
    if (!p) return;
    for (const c of p.conditions) {
      if (c.kind !== 'predicate' || !c.resolvedPredicate) continue;
      if (c.resolvedPredicate.entity !== def.name) continue;
      const nxt = c.resolvedPredicate.name;
      if (trail.includes(nxt)) {
        errors.push(err(p.source.file, p.source.line,
          `the predicate "${name}" is defined in terms of itself: ${[...trail, nxt].join(' → ')}.`,
          p.text, 'a predicate that eventually reaches fields, not another predicate that comes back here'));
        return;
      }
      visit(nxt, [...trail, nxt]);
    }
  };
  for (const [name] of def.predicates) visit(name, [name]);
}

/**
 * Decide, at parse time, WHICH document a consequent changes (grammar.md §5.1) and store the
 * plan on the AST. `execute.js` never guesses a target.
 */
function resolveConsequent(cons, rule, model, file, errors) {
  const triggerName = rule.trigger.entity;
  const trigger = model.entities.get(triggerName);
  const target = model.entities.get(cons.entity);
  if (!target) {
    errors.push(err(file, cons.line,
      `this rule wants to ${cons.verb} a "${cons.entity}", but no such kind of document is declared.${suggest(cons.entity, [...model.entities.keys()])}`,
      cons.text,
      `a file operating-model/information/${cons.entity}.md declaring its fields`));
    return;
  }

  if (cons.verb === 'create') {
    if (cons.entity === triggerName && !cons.label) {
      errors.push(err(file, cons.line,
        `a rule triggered by "${triggerName}" cannot also create a "${triggerName}": both would need the same id.`,
        cons.text,
        `a different kind of document, for example ${triggerName}-fact — or a label, which gives the `
        + `new one its own id: Create ${triggerName} as "reversal" (grammar.md §21)`));
      return;
    }
    // Grammar version 2, §21: a label gives the new document the id `<trigger-id>-<label>`, so
    // several documents of one entity no longer collide. Version 1's shape is kept byte-identical
    // when there is no label, because that is what the AST assertions of version 1 pin.
    cons.targeting = cons.label ? { kind: 'self-id', label: cons.label } : { kind: 'self-id' };

    // A labelled create makes CHILDREN of the trigger, and a child must say whose child it is or
    // the set it belongs to cannot be found — `sum of amount over posting for this journal-entry`
    // would silently aggregate over nothing, which is the "silent wrong calculation" Principle 6
    // exists to prevent. So a field of the target declared `reference to <trigger entity>` is set
    // to the trigger's id. Declaration-driven, exactly like §5.1 mechanism 1 — never name-guessed.
    //
    // Only on a LABELLED create, for two reasons. An unlabelled create takes the trigger's own id,
    // so a back-reference would be a document pointing at its own id; and filling it there would
    // change what an existing version-1 model does, which §0 forbids.
    if (cons.label) {
      const backRefs = [...target.fields.values()]
        .filter((f) => f.type === 'reference' && f.refEntity === triggerName);
      if (backRefs.length > 1) {
        errors.push(err(file, cons.line,
          `"${cons.entity}" has ${backRefs.length} references to "${triggerName}" (${list(backRefs.map((f) => f.name))}), `
          + `so it is not clear which one should say that this ${cons.entity} belongs to this ${triggerName}.`,
          cons.text,
          `one reference to "${triggerName}" in ${target.source.file}. Rename or merge the others `
          + '(grammar.md §21, §10.5).'));
        return;
      }
      if (backRefs.length === 1) cons.backReference = backRefs[0].name;
    }
    // shared declared fields are copied (grammar.md §5.2) — types must agree
    const copied = [];
    for (const [fname, tf] of target.fields) {
      const sf = trigger.fields.get(fname);
      if (!sf) continue;
      const sameType = sf.type === tf.type && (sf.type !== 'reference' || sf.refEntity === tf.refEntity);
      if (!sameType) {
        errors.push(err(file, cons.line,
          `"${fname}" is ${describeType(sf)} on ${triggerName} but ${describeType(tf)} on ${cons.entity}, so the runtime cannot carry it over.`,
          cons.text,
          `the same type in ${trigger.source.file}:${sf.source.line} and ${target.source.file}:${tf.source.line}`));
        continue;
      }
      copied.push(fname);
    }
    cons.copiedFields = copied;
  } else {
    if (cons.entity === triggerName) {
      cons.targeting = { kind: 'self' };
    } else {
      const refs = [...trigger.fields.values()].filter((f) => f.type === 'reference' && f.refEntity === cons.entity);
      if (refs.length === 1) {
        cons.targeting = { kind: 'reference', field: refs[0].name };
      } else if (refs.length > 1) {
        errors.push(err(file, cons.line,
          `"${triggerName}" has ${refs.length} references to "${cons.entity}" (${list(refs.map((r) => r.name))}), so it is not clear which one this step means.`,
          cons.text,
          `grammar version 1 has no way to pick one. Rename or merge the fields in ${trigger.source.file}, or split the rule. See grammar.md §10.5.`));
        return;
      } else if (target.identifiedBy && target.identifiedBy.length
                 && target.identifiedBy.every((f) => trigger.fields.has(f))) {
        cons.targeting = { kind: 'key', fields: target.identifiedBy.slice() };
      } else {
        const missing = (target.identifiedBy || []).filter((f) => !trigger.fields.has(f));
        errors.push(err(file, cons.line,
          `it is not determined which "${cons.entity}" document "${cons.text}" should change.`,
          cons.text,
          missing.length
            ? `"${cons.entity}" is identified by ${list(target.identifiedBy)}, but "${triggerName}" has no ${list(missing)}. Add ${list(missing)} to ${trigger.source.file}, or add "${cons.entity}: reference to ${cons.entity}".`
            : `either a "## Identified by" section in ${target.source.file} naming fields that "${triggerName}" also has, or a field "${cons.entity}: reference to ${cons.entity}" in ${trigger.source.file}`));
        return;
      }
    }
  }

  // clause fields must be declared on the right side
  for (const cl of cons.clauses) {
    const tf = target.fields.get(cl.field);
    if (!tf) {
      errors.push(err(file, cl.line,
        `"${cl.field}" is not a field of "${cons.entity}".${suggest(cl.field, [...target.fields.keys()])}`,
        cons.text,
        target.fields.size
          ? `one of ${list([...target.fields.keys()])} (declared in ${target.source.file})`
          : `a "## Fields" section in ${target.source.file} declaring "${cl.field}"`));
      continue;
    }
    if (cl.kind === 'set') {
      const fit = literalFits(tf, cl.value, cl.field, model, file);
      if (!fit.ok) {
        errors.push(err(file, cl.line,
          `"${cl.field}" is declared as ${describeType(tf)} on ${cons.entity}, but ${fit.message.replace(/^it is compared with/, 'it is set to')}`,
          cons.text, fit.expected));
      } else if (fit.warning) {
        errors.push(warn(file, cl.line, fit.warning, cons.text));
      }
    }
    // Grammar version 2, §17 (FD-5 item 9): copy a value across from a differently named field,
    // optionally one hop away. Checked here, from the two declarations, so `execute.js` only
    // follows a plan it did not invent.
    if (cl.kind === 'copy') {
      const src = resolveFromSource(cl.from, trigger, model, file, errors, cons.text);
      if (!src) continue;
      cl.resolvedFrom = { steps: src.steps, type: src.type, refEntity: src.refEntity };
      const fit = copyCompatible(
        { type: src.type, refEntity: src.refEntity, values: src.values, name: cl.from.text },
        tf,
      );
      if (!fit.ok) {
        errors.push(err(file, cl.line,
          `"with ${cl.field} from ${cl.from.text}" cannot carry the value across: ${fit.why}.`,
          cons.text,
          `${fit.expected} — "${cl.from.text}" is declared at ${src.declaredAt.file}:${src.declaredAt.line} `
          + `and "${cl.field}" at ${tf.source.file}:${tf.source.line}`));
      }
      continue;
    }
    if (cl.kind === 'add' || cl.kind === 'subtract') {
      const sign = cl.kind === 'add' ? '+' : '-';
      // Grammar version 2, §17: `+<field> from <other-field>` names the source explicitly.
      const srcName = cl.from ? cl.from.text : cl.field;
      if (tf.type !== 'number' && tf.type !== 'money') {
        errors.push(err(file, cl.line,
          `"${cl.field}" is declared as ${describeType(tf)} on ${cons.entity}, so it cannot be counted up or down.`,
          cons.text, `a number or money field, declared in ${target.source.file}`));
      }
      // A counter's source may be one hop away too (§17.1), resolved by the same function, so the
      // two halves of `from` cannot drift apart.
      let sf = null;
      if (cl.from) {
        const src = resolveFromSource(cl.from, trigger, model, file, errors, cons.text);
        if (!src) continue;
        cl.resolvedFrom = { steps: src.steps, type: src.type, refEntity: src.refEntity };
        sf = { type: src.type, refEntity: src.refEntity, source: src.declaredAt };
      } else {
        sf = trigger.fields.get(cl.field) || null;
      }
      if (!sf) {
        errors.push(err(file, cl.line,
          `"with ${sign}${cl.field}" takes the ${cl.field} of the triggering ${triggerName}, but "${triggerName}" has no field "${cl.field}".${suggest(cl.field, [...trigger.fields.keys()])}`,
          cons.text, `a field "${cl.field}: number" in ${trigger.source.file}`));
      } else if (sf.type !== 'number' && sf.type !== 'money') {
        errors.push(err(file, cl.line,
          `"${srcName}" is ${describeType(sf)} on ${triggerName}, so there is no amount to add.`,
          cons.text, `"${srcName}: number" in ${trigger.source.file}`));
      } else if ((sf.type === 'money') !== (tf.type === 'money')) {
        // An amount of money is not a count, and the runtime will not decide which currency a
        // bare count is in (grammar.md §17, FD-1).
        errors.push(err(file, cl.line,
          `"${srcName}" is ${describeType(sf)} on ${triggerName} and "${cl.field}" is ${describeType(tf)} on ${cons.entity}, so counting one into the other has no defined meaning.`,
          cons.text,
          `both money or both number. An amount of money is not a count, and the runtime does not `
          + `decide which currency a bare number is in (${trigger.source.file}:${sf.source.line}, `
          + `${target.source.file}:${tf.source.line})`));
      }
    }
    if (cl.kind === 'require') {
      const sf = trigger.fields.get(cl.field);
      if (!sf) {
        errors.push(err(file, cl.line,
          `"with ${cl.field}" means the ${cl.field} of the triggering ${triggerName} must be captured, but "${triggerName}" has no field "${cl.field}".${suggest(cl.field, [...trigger.fields.keys()])}`,
          cons.text, `a field "${cl.field}: <type>" in ${trigger.source.file}`));
      } else {
        const sameType = sf.type === tf.type && (sf.type !== 'reference' || sf.refEntity === tf.refEntity);
        if (!sameType) {
          errors.push(err(file, cl.line,
            `"${cl.field}" is ${describeType(sf)} on ${triggerName} but ${describeType(tf)} on ${cons.entity}.`,
            cons.text, `the same type in ${trigger.source.file} and ${target.source.file}`));
        }
      }
    }
  }
}

function describeType(f) {
  if (f.type === 'reference') return `a reference to ${f.refEntity}`;
  if (f.type === 'enum') return `one of ${list(f.values)}`;
  return `a ${f.type}`;
}
/** The type as it reads in "… is declared as X in <file>". Keeps version-1 wording for scalars. */
function typeWords(f, fallback) {
  if (!f) return fallback;
  if (f.type === 'reference') return `a reference to ${f.refEntity}`;
  if (f.type === 'enum') return `one of ${list(f.values)}`;
  return f.type;
}

// ---------------------------------------------------------------------------------------------
// Grammar version 2 — authority in three scopes (§16), coverage (§16.2), branches (§14)
// ---------------------------------------------------------------------------------------------

/** Every consequent of a rule, branches included, in written order. */
function allConsequents(rule) {
  const out = [...rule.consequents];
  for (const b of rule.branches || []) out.push(...b.consequents);
  return out;
}

/**
 * Most specific scope wins, and only it: arm → rule → file → entity (grammar.md §16).
 * Not the union, which would widen authority by accident; not the intersection, which would
 * recreate §10.14's dead operation.
 */
function resolveAuthority(model, errors) {
  const checkRoles = (roles, at, quoted, what) => {
    for (const roleName of roles) {
      if (model.roles.has(roleName)) continue;
      errors.push(err(at.file, at.line,
        `${quoted} names the role "${roleName}", but no such role is declared.${suggest(roleName, [...model.roles.keys()])}`,
        roleName,
        `a file operating-model/organisation/${roleName}.md describing the role`
        + (model.roles.size ? `. Declared roles: ${list([...model.roles.keys()])}` : '')));
      void what;
    }
  };

  // Entity scope is declared once per entity, so it is checked once per entity.
  for (const [, def] of model.entities) {
    if (!def.authority) continue;
    for (const [op, entry] of def.authority.byOp) {
      checkRoles(entry.roles, { file: def.authority.source.file, line: entry.line },
        `"## Authorized by" (- ${op}:)`, 'entity');
    }
  }

  for (const rule of model.processes) {
    const entity = model.entities.get(rule.trigger.entity);
    const entityEntry = entity && entity.authority
      ? entity.authority.byOp.get(rule.trigger.op) : undefined;

    if (rule.fileAuthority) {
      checkRoles(rule.fileAuthority.roles, rule.fileAuthority.source, '"## Authorized by"', 'file');
    }
    if (rule.inlineAuthority) {
      checkRoles(rule.inlineAuthority.roles, { file: rule.source.file, line: rule.inlineAuthority.line },
        '"authorized by"', 'rule');
    }

    /** @returns {{roles:string[], scope:string, source:{file:string,line:number}}|null} */
    const compose = (inline, inlineScope) => {
      if (inline) {
        return {
          roles: inline.roles.slice(),
          scope: inlineScope,
          source: { file: rule.source.file, line: inline.line },
        };
      }
      if (rule.fileAuthority) {
        return { roles: rule.fileAuthority.roles.slice(), scope: 'file', source: rule.fileAuthority.source };
      }
      if (entityEntry) {
        return {
          roles: entityEntry.roles.slice(),
          scope: 'entity',
          source: { file: entity.authority.source.file, line: entityEntry.line },
        };
      }
      return null;
    };

    rule.authority = compose(rule.inlineAuthority || null, 'rule');
    rule.authorizedBy = rule.authority ? rule.authority.roles.slice() : [];
    rule.authorizedBySource = rule.authority ? rule.authority.source : null;

    for (const branch of rule.branches || []) {
      if (branch.inlineAuthority) {
        checkRoles(branch.inlineAuthority.roles,
          { file: rule.source.file, line: branch.inlineAuthority.line }, '"authorized by"', 'arm');
      }
      branch.authority = branch.inlineAuthority
        ? {
          roles: branch.inlineAuthority.roles.slice(),
          scope: 'arm',
          source: { file: rule.source.file, line: branch.inlineAuthority.line },
        }
        : rule.authority;
      branch.authorizedBy = branch.authority ? branch.authority.roles.slice() : [];
    }
  }
}

/** Does this rule carry authority for every path through it? (grammar.md §16.2) */
function ruleCoversAuthority(rule) {
  if (rule.authority) return true;
  if (rule.branches && rule.branches.length) {
    return rule.branches.every((b) => b.authority);
  }
  return false;
}

/**
 * "Ask what happens when nothing applies." (Part 4, standing rule 4.)
 *
 * An entity-operation pair covered by no authority at all may be performed by an actor with no
 * role — grammar version 1's default (§8), which version 2 keeps because changing it would change
 * the meaning of existing models (FD-7). What version 2 changes is that it is now *visible* here,
 * and refusable through `evaluate(…, { authorization: 'strict' })`.
 *
 * One warning per entity, listing its uncovered operations, so 20 entities produce 20 lines and
 * not 80.
 */
function reportAuthorityCoverage(model, errors) {
  const covered = new Set();
  for (const rule of model.processes) {
    if (ruleCoversAuthority(rule)) covered.add(`${rule.trigger.op}:${rule.trigger.entity}`);
  }
  for (const [name, def] of model.entities) {
    const open = AUTHORITY_OPERATIONS.filter((op) => {
      if (covered.has(`${op}:${name}`)) return false;
      if (def.authority && def.authority.byOp.has(op)) return false;
      return true;
    });
    if (open.length === 0) continue;
    const capital = (op) => op[0].toUpperCase() + op.slice(1);
    errors.push(warn(def.source.file, def.source.line,
      `nothing says who may ${open.map((o) => `${o} ${article(name)} ${name}`).join(', ')} — `
      + `${open.length === 1 ? 'that operation is' : 'those operations are'} open to an actor with no role at all.`,
      `information/${name}.md`,
      'either a rule carrying "authorized by", or a default for this kind of document:\n'
      + `    ## Authorized by\n${open.map((o) => `    - ${o}: <role>`).join('\n')}\n`
      + `  Until one of those exists, ${open.map(capital).join(' / ')} ${open.length === 1 ? 'is' : 'are'} `
      + 'permitted by default — grammar version 1 behaviour, kept on purpose (FD-7, grammar.md §16.2). '
      + 'A kernel running with { authorization: "strict" } refuses it instead.'));
  }
}

/**
 * Branch arms are alternatives in written order, and the first one that holds wins (§14.1). Two
 * ways an author loses a case without noticing, both statically provable, both reported:
 *  - an arm that can never be reached, because it contradicts itself or because an earlier arm
 *    already covers everything it covers (thresholds written ascending instead of descending);
 *  - no default arm, so some cases quietly do nothing.
 */
function detectUnreachableBranches(model, errors) {
  for (const rule of model.processes) {
    const branches = rule.branches;
    if (!branches || branches.length === 0) continue;

    for (const b of branches) {
      const clash = firstImpossiblePair(b.conditions, b.conditions);
      if (clash) {
        errors.push(warn(rule.source.file, clash.a.line,
          `this branch can never run: "${clash.a.text}" and "${clash.b.text}" cannot both be true.`,
          clash.a.text,
          'conditions that can hold at the same time — every condition of one branch is required together'));
      }
    }

    for (let j = 1; j < branches.length; j++) {
      const later = branches[j];
      if (later.conditions.length !== 1) continue;
      for (let i = 0; i < j; i++) {
        const earlier = branches[i];
        if (earlier.isDefault || earlier.conditions.length !== 1) continue;
        if (!provablyImplies(later.conditions[0], earlier.conditions[0])) continue;
        errors.push(warn(rule.source.file, later.line,
          `this branch can never run: everything that satisfies "${later.conditions[0].text}" also `
          + `satisfies "${earlier.conditions[0].text}" in the branch at line ${earlier.line}, and the `
          + 'first branch that holds is the one that runs.',
          later.text,
          'put the narrower case first. Branches are read in the order they are written, top to '
          + 'bottom, which is what lets a reader audit them (grammar.md §14.1).'));
        break;
      }
    }

    if (!branches.some((b) => b.isDefault)) {
      const conds = branches.map((b) => b.conditions.map((c) => c.text).join(' and ')).filter(Boolean);
      errors.push(warn(rule.source.file, rule.source.line,
        `this rule has no "otherwise" branch, so nothing at all happens to ${article(rule.trigger.entity)} `
        + `${rule.trigger.entity} that satisfies none of ${conds.map((c) => `"${c}"`).join(' / ')}.`,
        firstLine(rule.text),
        'if that is intended, it is intended — the operation still goes through and other rules still '
        + 'apply. If it is not, add "otherwise <what happens instead>". Nothing is invented for the '
        + 'case you did not write (grammar.md §14.1).'));
    }
  }
}

/**
 * Conservative implication over the version-1 comparison operators: does every value that
 * satisfies `a` also satisfy `b`? Used only to name an unreachable branch, so a `false` costs
 * nothing and a wrong `true` would be a false alarm — hence "provably".
 */
function provablyImplies(a, b) {
  if (a.kind === 'exists' && b.kind === 'exists') {
    return a.subject && b.subject && a.subject.text === b.subject.text && a.negated === b.negated;
  }
  if (a.kind === 'predicate' && b.kind === 'predicate') {
    return a.subject && b.subject && a.subject.text === b.subject.text
      && a.name === b.name && a.negated === b.negated;
  }
  if (a.kind !== 'compare' || b.kind !== 'compare') return false;
  if (!a.subject || !b.subject || a.subject.text !== b.subject.text) return false;
  if (!a.value || !b.value) return false;
  if (a.value.type !== b.value.type) return false;
  const va = a.value.value;
  const vb = b.value.value;
  let candidates;
  if (a.value.type === 'number') {
    candidates = [va - 1, va, va + 1, vb - 1, vb, vb + 1, (va + vb) / 2];
  } else if (a.value.type === 'boolean') {
    candidates = [true, false];
  } else if (a.value.type === 'money') {
    // The threshold shape, and therefore the one that matters most (§14.1). Exact, in BigInt minor
    // units, and only when the two amounts are in the same currency — comparing across currencies
    // is not something this grammar does anywhere (FD-1).
    if (!a.value.amount || !b.value.amount) return false;
    if (a.value.amount.currency !== b.value.amount.currency) return false;
    const ma = a.value.amount.minor;
    const mb = b.value.amount.minor;
    const points = [ma - 1n, ma, ma + 1n, mb - 1n, mb, mb + 1n];
    let sat = false;
    for (const x of points) {
      if (!satisfiesCompare(x, a.op, ma)) continue;
      sat = true;
      if (!satisfiesCompare(x, b.op, mb)) return false;
    }
    return sat;
  } else {
    candidates = [va, vb, `${va}`, `${vb}`, '', '￿'];
  }
  // `a` implies `b` if no candidate satisfies `a` while failing `b` — and `a` is satisfiable.
  let satisfiable = false;
  for (const x of candidates) {
    const inA = satisfiesCompare(x, a.op, va);
    if (!inA) continue;
    satisfiable = true;
    if (!satisfiesCompare(x, b.op, vb)) return false;
  }
  return satisfiable;
}

/**
 * Consequents do not trigger rules (grammar.md §7). That decision must not be silent, so every
 * place where a reader might expect a cascade is reported as a warning naming both rules.
 */
function detectCascades(model, errors) {
  const triggers = new Map();
  for (const r of model.processes) {
    const key = `${r.trigger.op}:${r.trigger.entity}`;
    if (!triggers.has(key)) triggers.set(key, []);
    triggers.get(key).push(r);
  }
  for (const r of model.processes) {
    for (const cons of allConsequents(r)) {
      const found = triggers.get(`${cons.verb}:${cons.entity}`);
      if (!found) continue;
      for (const other of found) {
        const same = other === r;
        errors.push(warn(r.source.file, cons.line,
          `"${cons.text}" matches the trigger of the rule at ${other.source.file}:${other.source.line}${same ? ' (this very rule)' : ''}, but consequences do not trigger further rules in grammar version 1 — that rule will not run.`,
          cons.text,
          'if those consequences must also happen, write them into this rule. See grammar.md §7.'));
      }
    }
  }
}
