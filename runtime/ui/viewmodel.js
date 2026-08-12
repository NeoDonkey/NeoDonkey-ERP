// runtime/ui/viewmodel.js — every screen, as data. Pure functions, no DOM, no kernel calls.
//
// Principle 7 lives here. A view model is computed from three things and nothing else:
//
//     the Model (entity + role declarations, parsed from operating-model/**)
//   + the Index (documents, a view over git)
//   + the current role
//
// There is no branch anywhere below on *which* entity is being shown. That is the property a
// reviewer should check by adding operating-model/information/anything.md and reloading: a
// nav entry, a table, a detail page and a working form appear, with no change here.
//
// Keeping this layer pure is also what makes it testable without a browser — which matters,
// because a browser is the one thing this agent could not run.

import {
  ID_FIELD, allFields, columnsFor, coerceInput, displayLabel, emptyValue,
  formatValue, inputTypeFor, isReference, labelFor,
} from './fields.js';

/** @typedef {import('../polism/parse.js').Model} Model */
/** @typedef {import('../polism/parse.js').EntityDef} EntityDef */
/** @typedef {import('../read/index.js').Index} Index */

const CRUD = ['create', 'update', 'delete'];

/** A human name for an entity: its `# Heading` if it has one, else its slug prettified. */
export function entityTitle(entityDef, name) {
  return entityDef?.title || labelFor(name ?? entityDef?.name);
}

/** Rules triggered by (op, entity). Sorted by file then line, per grammar §8. */
export function rulesFor(model, entity, op = null) {
  const rules = (model?.processes ?? []).filter(
    (r) => r.trigger.entity === entity && (op === null || r.trigger.op === op),
  );
  return rules.sort((a, b) => (a.source.file === b.source.file
    ? a.source.line - b.source.line
    : a.source.file < b.source.file ? -1 : 1));
}

/** The rule declared at exactly this file and line — how a refusal finds its own sentence. */
export function ruleAt(model, file, line) {
  return (model?.processes ?? []).find(
    (r) => r.source.file === file && r.source.line === Number(line),
  ) ?? null;
}

/**
 * May this role trigger this operation on this entity?
 *
 * Faithful to grammar §6 and §8: *every* matching rule's `## Authorized by` must admit the
 * actor, a rule with no `## Authorized by` places no constraint, and an operation no rule
 * matches at all is allowed. This is derived, never configured — there is no permission table
 * in NeoDonkey, only the sentences the company wrote.
 *
 * @returns {{ allowed: boolean, rules: object[], blockedBy: object[], unconstrained: boolean }}
 */
export function permissionFor(model, entity, op, role) {
  const rules = rulesFor(model, entity, op);
  const constraining = rules.filter((r) => (r.authorizedBy ?? []).length > 0);
  const blockedBy = role
    ? constraining.filter((r) => !r.authorizedBy.includes(role))
    : constraining;
  return {
    allowed: blockedBy.length === 0,
    rules,
    blockedBy,
    unconstrained: constraining.length === 0,
  };
}

/** All three operations at once, for one entity. */
export function permissionsFor(model, entity, role) {
  const out = {};
  for (const op of CRUD) out[op] = permissionFor(model, entity, op, role);
  return out;
}

/**
 * The navigation, generated per role. Entities this role may change are separated from
 * entities it may only read, because that distinction is the honest one: grammar §10 limit 11
 * says `Read` rules authorize but do not filter visibility, so we must not pretend that
 * anything is hidden. Nothing is hidden; some things are read-only.
 */
export function navFor(model, role) {
  const entities = [...(model?.entities ?? new Map()).entries()]
    .map(([name, def]) => {
      const permissions = permissionsFor(model, name, role);
      return {
        name,
        title: entityTitle(def, name),
        fieldCount: def.fields?.size ?? 0,
        permissions,
        writable: CRUD.some((op) => permissionFor(model, name, op, role).rules.length > 0
          && permissions[op].allowed),
        governed: CRUD.some((op) => permissionFor(model, name, op, role).rules.length > 0),
      };
    })
    .sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  return {
    role: role ?? null,
    roles: [...(model?.roles ?? new Map()).entries()].map(([name, def]) => ({
      name, title: def.title || labelFor(name),
    })).sort((a, b) => (a.name < b.name ? -1 : 1)),
    work: entities.filter((e) => e.writable),
    reference: entities.filter((e) => !e.writable),
    all: entities,
  };
}

/** Shared resolver pair, so `formatValue` can follow references without knowing the index. */
function resolvers(model, index) {
  return {
    resolve: (entity, id) => (index ? index.get(entity, id) : null),
    entityDefOf: (entity) => model?.entities?.get(entity) ?? null,
  };
}

/**
 * A list view: columns from the declaration, one row per document, each cell already
 * formatted per its declared type.
 */
export function listView({ model, index, entity, role, locale = 'de', max = 7, filter = '' }) {
  const entityDef = model?.entities?.get(entity) ?? null;
  if (!entityDef) return missingEntity(model, entity);

  const columns = columnsFor(entityDef, { max }).map((def) => ({
    field: def,
    name: def.name,
    label: def.name === 'id' ? 'Id' : labelFor(def.name),
    align: inputTypeFor(def).align ?? null,
    required: Boolean(def.required) && def.name !== 'id',
    type: isReference(def) ? `reference to ${def.refEntity}` : def.type,
  }));

  const ctx = { locale, entityDef, ...resolvers(model, index) };
  const docs = index ? index.all(entity) : [];
  const rows = docs.map((doc) => ({
    id: String(doc.id),
    label: displayLabel(doc, entityDef),
    cells: columns.map((c) => ({
      column: c,
      ...formatValue(c.name === 'id' ? doc.id : doc[c.name], c.field, { ...ctx, doc }),
    })),
  }));

  const needle = String(filter).trim().toLowerCase();
  const visible = needle === ''
    ? rows
    : rows.filter((r) => r.cells.some((c) => c.text.toLowerCase().includes(needle)));

  return {
    kind: 'list',
    entity,
    title: entityTitle(entityDef, entity),
    entityDef,
    columns,
    rows: visible,
    total: rows.length,
    filtered: needle === '' ? null : visible.length,
    permissions: permissionsFor(model, entity, role),
    rules: rulesFor(model, entity),
    hiddenColumns: Math.max(0, (entityDef.fields?.size ?? 0) + 1 - columns.length),
  };
}

/** A detail view: every declared field, in declaration order, plus what governs this entity. */
export function detailView({ model, index, entity, id, role, locale = 'de' }) {
  const entityDef = model?.entities?.get(entity) ?? null;
  if (!entityDef) return missingEntity(model, entity);
  const doc = index ? index.get(entity, id) : null;
  if (!doc) {
    return { kind: 'missing-document', entity, id,
      title: entityTitle(entityDef, entity), entityDef,
      message: `There is no ${entity} with the id "${id}" in this workspace.` };
  }
  const ctx = { locale, entityDef, doc, ...resolvers(model, index) };

  const fields = [ID_FIELD, ...allFields(entityDef)].map((def) => ({
    field: def,
    name: def.name,
    label: def.name === 'id' ? 'Id' : labelFor(def.name),
    required: Boolean(def.required) && def.name !== 'id',
    declaredAt: def.source ?? null,
    type: isReference(def) ? `reference to ${def.refEntity}` : def.type,
    ...formatValue(def.name === 'id' ? doc.id : doc[def.name], def, ctx),
  }));

  // Fields present on the document that the model does not declare. Never dropped silently:
  // they are real bytes in git, and a view that hides them would be lying about the data.
  const declared = new Set(['id', 'entity', ...(entityDef.fields?.keys() ?? [])]);
  const undeclared = Object.keys(doc)
    .filter((k) => !declared.has(k) && !k.startsWith('_'))
    .map((k) => ({ name: k, label: labelFor(k), text: stringify(doc[k]) }));

  return {
    kind: 'detail',
    entity,
    id: String(doc.id),
    title: entityTitle(entityDef, entity),
    label: displayLabel(doc, entityDef),
    entityDef,
    fields,
    undeclared,
    permissions: permissionsFor(model, entity, role),
    rules: rulesFor(model, entity),
    references: incomingReferences(model, index, entity, String(doc.id)),
  };
}

/** Documents elsewhere that point at this one, found through declared reference fields. */
export function incomingReferences(model, index, entity, id) {
  const out = [];
  for (const [otherName, otherDef] of model?.entities ?? new Map()) {
    for (const def of otherDef.fields?.values() ?? []) {
      if (!isReference(def) || def.refEntity !== entity) continue;
      const hits = index ? index.where(otherName, (d) => String(d[def.name] ?? '') === id) : [];
      if (hits.length) {
        out.push({ entity: otherName, title: entityTitle(otherDef, otherName),
          via: def.name, ids: hits.map((d) => String(d.id)) });
      }
    }
  }
  return out;
}

/**
 * A create or edit form, generated from `## Fields`.
 *
 * Note what this does NOT do: it does not decide whether the values are acceptable. Required
 * fields are marked and carry the file and line that declares them, but the form will happily
 * submit without one — because the refusal that comes back quotes the company's own sentence,
 * and that refusal is a better teacher than a browser tooltip. See docs/_compromise-ui.md.
 */
export function formView({ model, index, entity, id = null, role, doc = null, nextId = null }) {
  const entityDef = model?.entities?.get(entity) ?? null;
  if (!entityDef) return missingEntity(model, entity);
  const mode = id === null ? 'create' : 'edit';
  const existing = mode === 'edit' ? (index ? index.get(entity, id) : null) : null;
  const source = doc ?? existing ?? {};

  const fields = allFields(entityDef).map((def) => {
    const control = inputTypeFor(def);
    const raw = source[def.name];
    const field = {
      name: def.name,
      label: labelFor(def.name),
      field: def,
      control,
      required: Boolean(def.required),
      declaredAt: def.source ?? null,
      type: isReference(def) ? `reference to ${def.refEntity}` : def.type,
      value: raw === undefined || raw === null ? emptyValue(def) : raw,
      options: null,
      problem: null,
    };
    // grammar v2 §15: an enumeration is also a select, but its options come from the declared
    // value set, not from documents. Branch on what the field *is*, never on the control it got —
    // conflating the two made an enum look up `entities.get(null)` and report that `status` points
    // at an entity called "null".
    if (control.control === 'select' && def.type === 'enum') {
      field.options = (control.options ?? []).map((v) => ({ value: String(v), label: String(v) }));
      const current = field.value;
      if (current !== '' && current !== null && current !== undefined
          && !control.options?.includes(String(current))) {
        // Shown, not hidden: the document predates the enumeration or an older runtime wrote it.
        field.problem = `"${def.name}" holds "${current}", which is not one of the declared `
          + `values (${(control.options ?? []).join(', ')}).`;
      }
    } else if (control.control === 'select') {
      const targetDef = model.entities.get(def.refEntity) ?? null;
      if (!targetDef) {
        // Principle 6 again: the model points at an entity it never described. Say so.
        field.problem = `"${def.name}" points at "${def.refEntity}", but no `
          + `operating-model/information/${def.refEntity}.md describes it.`;
        field.options = [];
      } else {
        const docs = index ? index.all(def.refEntity) : [];
        field.options = docs.map((d) => {
          const label = displayLabel(d, targetDef);
          return { value: String(d.id), label: label.text === String(d.id)
            ? String(d.id) : `${label.text} — ${d.id}` };
        });
        field.emptyOption = def.required ? '— choose —' : '— none —';
        field.targetEntity = def.refEntity;
        field.targetEmpty = docs.length === 0;
      }
    }
    if (control.control === 'unknown') {
      field.problem = `field type ${JSON.stringify(control.declared)} is not one this runtime `
        + 'knows, so there is no input for it (grammar version 1).';
    }
    return field;
  });

  const permissions = permissionsFor(model, entity, role);
  return {
    kind: 'form',
    mode,
    entity,
    title: entityTitle(entityDef, entity),
    entityDef,
    id: mode === 'edit' ? String(id) : (nextId ?? ''),
    idEditable: mode === 'create',
    fields,
    permissions,
    permission: permissions[mode === 'create' ? 'create' : 'update'],
    rules: rulesFor(model, entity, mode === 'create' ? 'create' : 'update'),
    missing: mode === 'edit' && !existing,
  };
}

/**
 * Turn the values of a generated form back into an Intent's `doc`.
 * @param {ReturnType<formView>} form
 * @param {Record<string, unknown>} values  name -> raw control value
 */
export function collectForm(form, values) {
  const doc = { entity: form.entity, id: String(values.id ?? form.id ?? '').trim() };
  const problems = [];
  for (const f of form.fields) {
    if (f.control.control === 'unknown') continue;
    const decoded = coerceInput(values[f.name], f.field);
    if (!decoded.ok) { problems.push({ field: f.name, label: f.label, reason: decoded.reason }); continue; }
    if (decoded.absent) continue; // absent, so the model gets to refuse it if it is required
    doc[f.name] = decoded.value;
  }
  if (doc.id === '') problems.push({ field: 'id', label: 'Id', reason: 'an id is required to name the document' });
  return { doc, problems };
}

/**
 * THE REFUSAL VIEW — item 4, and the screen the product is actually about.
 *
 * `kernel.perform()` hands back `{rejected: [{reason, rule, at}]}`. `reason` is the business
 * sentence, `at` is "file:line". What it does *not* hand back is the author's own text: the
 * kernel's `quoteRule()` reconstructs a normalised sentence ("If create goods-receipt under
 * condition …") instead of passing `rule.text` through. So we look the rule up in the model by
 * its source position and quote the file verbatim, with line numbers. A COO reads the words
 * she typed, on the line she typed them, not a pretty-printed AST.
 *
 * @param {{reason: string, rule?: string|null, at?: string|null}[]} rejected
 * @param {{ model: Model, sources?: Map<string,string> }} ctx
 */
export function refusalView(rejected, { model, sources = null } = {}) {
  const items = (rejected ?? []).map((v) => {
    const at = parseAt(v.at);
    const rule = at ? ruleAt(model, at.file, at.line) : null;
    // The executor already appends the rule and its position to `reason`, which reads well in
    // a terminal but duplicates what we are about to show properly. Keep the first sentence.
    const headline = String(v.reason ?? '').split('\n')[0].trim();
    const detail = String(v.reason ?? '').split('\n').slice(1)
      .map((l) => l.trim()).filter(Boolean);

    return {
      reason: headline,
      detail,
      at,
      // verbatim beats reconstructed; the kernel's normalised string is the fallback
      sentence: rule?.text ?? v.rule ?? null,
      verbatim: Boolean(rule?.text),
      authorizedBy: rule?.authorizedBy ?? [],
      authorizedBySource: rule?.authorizedBySource ?? null,
      excerpt: at && sources ? excerpt(sources.get(at.file), at.line, countLines(rule?.text)) : null,
      // Structural, never sniffed from the message text.
      kind: rule ? 'rule' : at ? 'declaration' : 'no-source',
    };
  });
  return {
    kind: 'refusal',
    count: items.length,
    items,
    // Every distinct file a COO might want to open, in the order they were refused in.
    files: [...new Set(items.map((i) => i.at?.file).filter(Boolean))],
  };
}

/** "operating-model/processes/goods-receipt.md:12" -> {file, line} */
export function parseAt(at) {
  if (typeof at !== 'string' || at === '') return null;
  const m = /^(.*):(\d+)$/.exec(at);
  if (!m) return { file: at, line: null };
  return { file: m[1], line: Number(m[2]) };
}

const countLines = (text) => (text ? String(text).split('\n').length : 1);

/**
 * The lines of the file that were quoted, with real line numbers, plus a little context.
 * This is what makes "your own rule, on this line" literal rather than a slogan.
 */
export function excerpt(text, line, span = 1, context = 1) {
  if (typeof text !== 'string' || !Number.isFinite(line)) return null;
  const lines = text.split('\n');
  const from = Math.max(1, line - context);
  const to = Math.min(lines.length, line + span - 1 + context);
  const out = [];
  for (let n = from; n <= to; n++) {
    out.push({ line: n, text: lines[n - 1] ?? '', highlight: n >= line && n < line + span });
  }
  return out;
}

/**
 * The transaction log. `kernel.history()` parses only the `NeoDonkey-Change` trailers, but the
 * commit message also carries `NeoDonkey-Rule: file:line` — the rule that caused the commit,
 * inside the signed payload. We parse it here so the log can answer "why did this happen".
 */
export function historyView(transactions, verdicts = [], { locale = 'de', model = null } = {}) {
  const byOid = new Map((verdicts ?? []).map((v) => [v.oid, v]));
  const entries = (transactions ?? []).map((t) => {
    const trailers = parseTrailers(t.message);
    return {
      oid: t.oid,
      short: String(t.oid).slice(0, 8),
      subject: String(t.message ?? '').split('\n')[0],
      body: String(t.message ?? '').split('\n').slice(1)
        .filter((l) => !/^NeoDonkey-[A-Za-z]+:/.test(l)).join('\n').trim(),
      author: t.author,
      time: t.time,
      when: formatTimestamp(t.time, locale),
      signature: byOid.get(t.oid)?.signature ?? (t.signature ? 'unverified' : 'none'),
      signedBy: byOid.get(t.oid)?.by ?? t.author?.email ?? null,
      changes: t.changes ?? trailers.changes,
      rules: trailers.rules.map((at) => {
        const p = parseAt(at);
        const rule = p && model ? ruleAt(model, p.file, p.line) : null;
        return { at: p, sentence: rule?.text ?? null };
      }),
      genesis: trailers.genesis,
    };
  });
  // Tally every verdict the kernel can return, including the ones that are neither good nor
  // bad ('unknown-signer' means we hold no public key for the author — not a forgery, but not
  // a verification either, and collapsing the two would be exactly the wrong simplification).
  const counts = { good: 0, bad: 0, none: 0, unverified: 0, 'unknown-signer': 0 };
  for (const e of entries) {
    counts[e.signature] = (counts[e.signature] ?? 0) + 1;
  }
  return { kind: 'log', entries, counts, total: entries.length,
    allGood: entries.length > 0 && entries.every((e) => e.signature === 'good') };
}

/** Git trailers are the machine-readable half of a commit message (kernel.buildMessage). */
export function parseTrailers(message) {
  const changes = []; const rules = []; let genesis = false;
  for (const line of String(message ?? '').split('\n')) {
    if (line.startsWith('NeoDonkey-Change: ')) {
      const [op, entity, id] = line.slice('NeoDonkey-Change: '.length).trim().split(/\s+/);
      changes.push({ op, entity, id });
    } else if (line.startsWith('NeoDonkey-Rule: ')) {
      rules.push(line.slice('NeoDonkey-Rule: '.length).trim());
    } else if (line.startsWith('NeoDonkey-Genesis: ')) {
      genesis = line.slice('NeoDonkey-Genesis: '.length).trim() === 'true';
    }
  }
  return { changes, rules, genesis };
}

/** Unix seconds -> a date a European reads, without Intl. */
export function formatTimestamp(seconds, locale = 'de') {
  if (!Number.isFinite(seconds)) return '';
  const d = new Date(seconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const iso = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  const key = String(locale || 'de').toLowerCase().split(/[-_]/)[0];
  const human = key === 'en' ? iso
    : `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return `${human} ${time} UTC`;
}

/** The operating model as a browsable tree, grouped by POLISM category. */
export function operatingModelTree(paths) {
  const groups = new Map();
  for (const path of [...(paths ?? [])].sort()) {
    const parts = String(path).split('/');
    const category = parts.length >= 3 ? parts[1] : '(root)';
    const name = parts[parts.length - 1].replace(/\.md$/i, '');
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ path, name, title: labelFor(name) });
  }
  return [...groups.entries()]
    .map(([category, files]) => ({ category, title: labelFor(category), files }))
    .sort((a, b) => (a.category < b.category ? -1 : 1));
}

/**
 * What one operating-model file contributes to the running system: the prose a human reads,
 * and the declarations the runtime executes. Shown side by side, because that identity *is*
 * Principle 11.
 */
export function operatingModelFileView({ model, path, text }) {
  const name = String(path).split('/').pop().replace(/\.md$/i, '');
  // The *folder* decides what a file declares, not the file name (grammar §1.2). A process file
  // may share its slug with the entity it governs — operating-model/processes/pallet-audit.md
  // next to operating-model/information/pallet-audit.md is the normal case, not an odd one — and
  // matching on the name alone would show the entity's fields on the process page.
  const segments = String(path).split('/');
  const category = segments.length >= 3 ? segments[segments.length - 2] : null;
  const entityDef = category === 'information' ? model?.entities?.get(name) ?? null : null;
  const roleDef = category === 'organisation' ? model?.roles?.get(name) ?? null : null;
  const rules = (model?.processes ?? []).filter((r) => r.source.file === path);
  return {
    kind: 'model-file',
    path,
    name,
    category,
    text: text ?? '',
    lines: String(text ?? '').split('\n').length,
    entityDef,
    roleDef,
    fields: entityDef ? allFields(entityDef).map((def) => ({
      name: def.name, label: labelFor(def.name), required: def.required,
      type: isReference(def) ? `reference to ${def.refEntity}` : def.type, line: def.source?.line ?? null,
    })) : [],
    predicates: entityDef ? [...(entityDef.predicates?.values() ?? [])].map((p) => ({
      name: p.name, text: p.text, line: p.source?.line ?? null,
    })) : [],
    identifiedBy: entityDef?.identifiedBy ?? null,
    createdOnDemand: entityDef?.createdOnDemand ?? null,
    rules: rules.map((r) => ({
      text: r.text, line: r.source.line, trigger: r.trigger, authorizedBy: r.authorizedBy ?? [],
      consequents: (r.consequents ?? []).map((c) => c.text),
      conditions: (r.conditions ?? []).map((c) => c.text),
    })),
  };
}

/** Parse diagnostics (from `amendOperatingModel`) shown against the text the author just wrote. */
export function diagnosticsView(rejected, text) {
  return {
    kind: 'diagnostics',
    items: (rejected ?? []).map((r) => {
      const at = parseAt(r.at);
      return {
        reason: String(r.reason ?? '').split('\n')[0],
        detail: String(r.reason ?? '').split('\n').slice(1).map((l) => l.trim()).filter(Boolean),
        at,
        excerpt: at?.line ? excerpt(text, at.line, 1, 2) : null,
      };
    }),
  };
}

/** An overview of the whole workspace: what this company is, in numbers. */
export function overview({ model, index, role, modelErrors = [], sources = null, warnings = [] }) {
  const stats = index ? index.stats() : { entities: {}, readable: 0, opaque: 0, invalid: 0 };
  const nav = navFor(model, role);
  return {
    kind: 'overview',
    entities: nav.all.map((e) => ({ ...e, count: stats.entities?.[e.name] ?? 0 })),
    roleCount: model?.roles?.size ?? 0,
    entityCount: model?.entities?.size ?? 0,
    ruleCount: model?.processes?.length ?? 0,
    fileCount: sources ? sources.size : null,
    documentCount: stats.readable ?? 0,
    modelErrors: (modelErrors ?? []).map((e) => ({
      reason: e.message ?? String(e.reason ?? ''), at: e.file ? `${e.file}:${e.line}` : null,
    })),
    // Runtime problems the kernel recorded rather than swallowed. Shown, because a fallback
    // nobody sees is the same as a fallback that did not happen.
    warnings: warnings ?? [],
    nav,
  };
}

function missingEntity(model, entity) {
  return {
    kind: 'unknown-entity',
    entity,
    message: `"${entity}" is not a kind of document this company has described.`,
    hint: `Create operating-model/information/${entity}.md with a "## Fields" section and it `
      + 'will appear here — no interface code has to change.',
    known: [...(model?.entities?.keys() ?? [])].sort(),
  };
}

const stringify = (v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
