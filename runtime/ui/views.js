// runtime/ui/views.js — the DOM for every screen. One renderer per *kind of* screen
// (list, detail, refusal, operating model, log), never one per entity.
//
// Search this file for a business word and you will not find one. Everything it draws it was
// handed by viewmodel.js, which was handed it by the operating model.

import { h, frag, cite, excerptBlock, badge, commandBlock, pair } from './render.js';

// ---------------------------------------------------------------------------------------------
// overview
// ---------------------------------------------------------------------------------------------

export function renderOverview(vm, { onEntity, onModel, onLog, starterNote = null }) {
  return frag(
    vm.modelErrors.length ? modelErrorPanel(vm.modelErrors, onModel) : null,
    vm.warnings?.length
      ? h.div({ class: 'notice notice-warn' },
        h.strong({ text: `The runtime recorded ${vm.warnings.length} warning`
          + `${vm.warnings.length === 1 ? '' : 's'}` }),
        h.p({ text: 'Nothing is wrong with your data — but these are the moments the system took '
          + 'a slower or safer path than it intended, and you are being told rather than not.' }),
        h.ul({}, vm.warnings.map((w) => h.li({},
          h.code({ class: 'mono', text: w.at ?? '?' }), ' ', w.message,
          w.oid ? frag(' ', badge(w.oid, 'muted')) : null))))
      : null,
    starterNote ? h.div({ class: 'notice' }, h.p({ text: starterNote })) : null,
    h.section({ class: 'stats' },
      stat(String(vm.entityCount), 'kinds of document'),
      stat(String(vm.ruleCount), 'rules in force'),
      stat(String(vm.roleCount), 'roles'),
      stat(String(vm.documentCount), 'documents')),
    h.section({ class: 'card' },
      h.header({ class: 'card-head' },
        h.h2({ text: 'This company' }),
        h.small({ class: 'muted', text: vm.nav.role
          ? `Shown as ${vm.nav.role}. Everything below is generated from the operating model.`
          : 'Everything below is generated from the operating model.' })),
      vm.entities.length === 0
        ? emptyModelState(onModel)
        : h.table({ class: 'grid' },
          h.thead({}, h.tr({},
            h.th({ text: 'Document' }),
            h.th({ text: 'Fields' }),
            h.th({ class: 'num', text: 'Count' }),
            h.th({ text: 'Your role may' }))),
          h.tbody({}, vm.entities.map((e) => h.tr({ class: 'clickable', on: { click: () => onEntity(e.name) } },
            h.td({}, h.strong({ text: e.title }), ' ', h.code({ class: 'slug', text: e.name })),
            h.td({ class: 'muted', text: String(e.fieldCount) }),
            h.td({ class: 'num', text: String(e.count) }),
            h.td({}, opBadges(e.permissions)))))),
    ),
    h.section({ class: 'split' },
      h.div({ class: 'card' },
        h.header({ class: 'card-head' }, h.h2({ text: 'The operating model' })),
        h.p({ text: 'The rules above are not configuration and not code. They are sentences in '
          + 'markdown files in this repository. Change a sentence and the system changes with it.' }),
        h.button({ class: 'primary', type: 'button', text: 'Open the operating model', on: { click: onModel } })),
      h.div({ class: 'card' },
        h.header({ class: 'card-head' }, h.h2({ text: 'The transaction log' })),
        h.p({ text: 'Every fact in this company is a git commit signed with your key. You can '
          + 'verify the whole chain here, or in a terminal with git — we would rather you did both.' }),
        h.button({ class: 'primary', type: 'button', text: 'Open the log', on: { click: onLog } }))),
  );
}

const stat = (value, label) => h.div({ class: 'stat' },
  h.div({ class: 'stat-value', text: value }), h.div({ class: 'stat-label', text: label }));

function opBadges(permissions) {
  const out = [];
  for (const op of ['create', 'update', 'delete']) {
    const p = permissions[op];
    if (!p) continue;
    if (p.rules.length === 0) continue;
    out.push(badge(op, p.allowed ? 'ok' : 'muted'));
  }
  return out.length ? out : h.span({ class: 'muted', text: 'no rules govern this' });
}

function emptyModelState(onModel) {
  return h.div({ class: 'empty' },
    h.p({ text: 'This company has not been described yet, so there is nothing to show.' }),
    h.p({ class: 'muted', text: 'Describe one kind of document — a file with a "## Fields" '
      + 'section — and a table, a detail page and a form for it appear here. No interface code changes.' }),
    h.button({ class: 'primary', type: 'button', text: 'Write the first file', on: { click: onModel } }));
}

function modelErrorPanel(errors, onModel) {
  return h.section({ class: 'panel panel-refusal' },
    h.header({ class: 'panel-head' },
      h.h2({ text: 'The operating model has errors, so nothing will be executed' }),
      h.p({ text: 'A model that cannot be read completely is never executed halfway. Fix these '
        + 'lines and the system starts again — no migration, no restart.' })),
    h.ul({ class: 'refusal-list' }, errors.map((e) => h.li({},
      h.div({ class: 'refusal-reason', text: e.reason }),
      e.at ? cite(parseCite(e.at)) : null))),
    h.footer({ class: 'panel-foot' },
      h.button({ class: 'primary', type: 'button', text: 'Open the operating model', on: { click: onModel } })));
}

const parseCite = (at) => {
  const m = /^(.*):(\d+)$/.exec(String(at));
  return m ? { file: m[1], line: Number(m[2]) } : { file: String(at), line: null };
};

// ---------------------------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------------------------

export function renderList(vm, { onOpen, onCreate, onFilter, onOpenSource, filter = '' }) {
  if (vm.kind === 'unknown-entity') return renderUnknownEntity(vm);

  const canCreate = vm.permissions.create.allowed;
  return frag(
    h.header({ class: 'view-head' },
      h.div({},
        h.h1({ text: vm.title }),
        h.small({ class: 'muted' },
          `${vm.total} document${vm.total === 1 ? '' : 's'} · `,
          h.code({ class: 'slug', text: vm.entity }),
          vm.hiddenColumns > 0 ? ` · ${vm.hiddenColumns} more field${vm.hiddenColumns === 1 ? '' : 's'} on the detail page` : '')),
      h.div({ class: 'view-actions' },
        h.input({ type: 'search', placeholder: 'Filter…', value: filter,
          on: { input: (e) => onFilter(e.target.value) } }),
        h.button({
          class: canCreate ? 'primary' : 'ghost', type: 'button',
          text: `New ${vm.title.toLowerCase()}`,
          title: canCreate ? null : 'your role may not create this — the form will explain why',
          on: { click: onCreate },
        }))),

    governedBy(vm.rules, onOpenSource),

    vm.rows.length === 0
      ? h.div({ class: 'empty' },
        h.p({ text: vm.total === 0
          ? `No ${vm.entity} documents exist yet.`
          : 'No documents match this filter.' }),
        vm.total === 0 ? h.button({ class: 'primary', type: 'button',
          text: `Create the first one`, on: { click: onCreate } }) : null)
      : h.div({ class: 'table-scroll' },
        h.table({ class: 'grid' },
          h.thead({}, h.tr({}, vm.columns.map((c) => h.th({
            class: c.align === 'right' ? 'num' : null,
            title: `${c.name}: ${c.type}${c.required ? ' required' : ''}`,
          }, c.label, c.required ? h.span({ class: 'req-dot', text: '*' }) : null)))),
          h.tbody({}, vm.rows.map((row) => h.tr({
            class: 'clickable', on: { click: () => onOpen(vm.entity, row.id) },
          }, row.cells.map((cell) => h.td({
            class: [cell.align === 'right' ? 'num' : null,
              cell.kind === 'empty' ? 'muted' : null,
              cell.dangling ? 'dangling' : null].filter(Boolean).join(' ') || null,
            title: cell.title ?? null,
          }, cell.text))))))),
  );
}

function renderUnknownEntity(vm) {
  return h.section({ class: 'panel' },
    h.h1({ text: vm.message }),
    h.p({ text: vm.hint }),
    vm.known.length
      ? h.p({ class: 'muted' }, 'Described so far: ', vm.known.map((k, i) => frag(
        i ? ', ' : '', h.code({ class: 'slug', text: k }))))
      : null);
}

/** Which sentences govern this entity. Always visible, because that is the product. */
function governedBy(rules, onOpenSource) {
  if (!rules || rules.length === 0) return null;
  return h.details({ class: 'governed' },
    h.summary({}, `Governed by ${rules.length} rule${rules.length === 1 ? '' : 's'}`),
    h.ul({ class: 'rule-list' }, rules.map((r) => h.li({},
      h.pre({ class: 'rule-text', text: r.text }),
      h.div({ class: 'rule-meta' },
        cite(r.source, { onOpen: onOpenSource }),
        r.authorizedBy?.length
          ? frag(' ', badge(`authorized by ${r.authorizedBy.join(' or ')}`, 'muted')) : null)))));
}

// ---------------------------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------------------------

export function renderDetail(vm, { onOpen, onEdit, onDelete, onBack, onOpenSource }) {
  if (vm.kind === 'unknown-entity') return renderUnknownEntity(vm);
  if (vm.kind === 'missing-document') {
    return h.section({ class: 'panel' },
      h.h1({ text: vm.message }),
      h.button({ class: 'ghost', type: 'button', text: '← Back', on: { click: onBack } }));
  }

  return frag(
    h.header({ class: 'view-head' },
      h.div({},
        h.h1({ text: vm.label.text || vm.id }),
        h.small({ class: 'muted' },
          h.code({ class: 'slug', text: vm.entity }), ' · ',
          h.code({ class: 'mono', text: vm.id }), ' · ',
          h.code({ class: 'mono', text: `documents/${vm.entity}/${vm.id}.json` }))),
      h.div({ class: 'view-actions' },
        h.button({ class: 'ghost', type: 'button', text: '← Back', on: { click: onBack } }),
        h.button({
          class: vm.permissions.update.allowed ? 'primary' : 'ghost', type: 'button', text: 'Edit',
          title: vm.permissions.update.allowed ? null : 'your role may not change this',
          on: { click: onEdit },
        }),
        vm.permissions.delete.rules.length
          ? h.button({ class: 'ghost danger', type: 'button', text: 'Delete', on: { click: onDelete } })
          : null)),

    h.section({ class: 'card' },
      h.dl({ class: 'fields' }, vm.fields.map((f) => frag(
        h.dt({},
          f.label,
          f.required ? h.span({ class: 'req-dot', text: '*', title: 'required' }) : null,
          h.span({ class: 'dt-type', text: f.type })),
        h.dd({ class: f.kind === 'empty' ? 'muted' : null, title: f.title ?? null },
          f.link
            ? h.button({ class: f.dangling ? 'link dangling' : 'link', type: 'button', text: f.text,
              on: { click: () => onOpen(f.link.entity, f.link.id) } })
            : f.text,
          f.dangling ? badge('missing', 'warn') : null)))),
      vm.undeclared.length
        ? h.div({ class: 'notice notice-warn' },
          h.strong({ text: 'This document carries fields the operating model does not declare' }),
          h.p({ text: 'They are real bytes in git, so they are shown rather than hidden. Either '
            + 'declare them in the entity file, or remove them.' }),
          h.dl({ class: 'fields' }, vm.undeclared.map((f) => pair(f.label, f.text, { mono: true }))))
        : null),

    vm.references.length
      ? h.section({ class: 'card' },
        h.header({ class: 'card-head' }, h.h2({ text: 'Referenced by' }),
          h.small({ class: 'muted', text: 'found through declared reference fields, not a foreign key table' })),
        h.ul({ class: 'ref-list' }, vm.references.map((r) => h.li({},
          h.strong({ text: r.title }), ' ',
          h.small({ class: 'muted', text: `via ${r.via}` }), ' ',
          r.ids.map((id, i) => frag(i ? ', ' : ' ', h.button({
            class: 'link mono', type: 'button', text: id, on: { click: () => onOpen(r.entity, id) },
          })))))))
      : null,

    governedBy(vm.rules, onOpenSource),
  );
}

// ---------------------------------------------------------------------------------------------
// THE REFUSAL — item 4. The most important screen in the product.
// ---------------------------------------------------------------------------------------------

/**
 * An ERP that refuses something owes the person an explanation they can act on. "Error:
 * validation failed" is not one. What this panel shows, for every violation, is:
 *
 *   the business reason ── the sentence from the operating model that produced it, verbatim
 *                       ── the file and the line it lives on
 *                       ── a button that opens that line for editing
 *
 * The user is never told to contact an administrator, because there isn't one: the rule that
 * refused them is a sentence in their own company's description, and they can change it.
 */
export function renderRefusal(vm, { onOpenSource, onDismiss, title = 'Refused' }) {
  return h.section({ class: 'panel panel-refusal', role: 'alert' },
    h.header({ class: 'panel-head' },
      h.h2({ text: `${title} — ${vm.count === 1 ? 'one rule' : `${vm.count} rules`} stood in the way` }),
      h.p({ text: 'Nothing was written. This is the operating model refusing, not a malfunction: '
        + 'each line below is a sentence in this company’s own description.' })),

    h.ul({ class: 'refusal-list' }, vm.items.map((item) => h.li({ class: 'refusal-item' },
      h.div({ class: 'refusal-reason', text: item.reason }),
      item.detail.length
        ? h.ul({ class: 'refusal-detail' }, item.detail.map((d) => h.li({ text: d })))
        : null,

      item.sentence
        ? h.div({ class: 'refusal-rule' },
          h.div({ class: 'refusal-rule-head' },
            h.span({ class: 'refusal-rule-label', text: item.verbatim
              ? 'The sentence that refused it, as written:'
              : 'The rule that refused it:' }),
            item.at ? cite(item.at, { onOpen: onOpenSource }) : null),
          item.excerpt
            ? excerptBlock(item.excerpt)
            : h.pre({ class: 'rule-text', text: item.sentence }))
        : item.at
          ? h.div({ class: 'refusal-rule' },
            h.div({ class: 'refusal-rule-head' },
              h.span({ class: 'refusal-rule-label', text: 'Declared here:' }),
              cite(item.at, { onOpen: onOpenSource })),
            item.excerpt ? excerptBlock(item.excerpt) : null)
          : h.p({ class: 'muted', text: 'This refusal comes from a field declaration rather than '
            + 'a rule, so it has no sentence of its own.' }),

      item.authorizedBy?.length
        ? h.div({ class: 'refusal-auth' },
          h.span({ class: 'muted', text: 'Authorized by: ' }),
          item.authorizedBy.map((r, i) => frag(i ? ' or ' : '', badge(r, 'muted'))),
          item.authorizedBySource ? frag(' ', cite(item.authorizedBySource, { onOpen: onOpenSource })) : null)
        : null,

      item.at
        ? h.div({ class: 'refusal-actions' },
          h.button({ class: 'primary', type: 'button',
            text: item.kind === 'rule' ? 'Change this rule' : 'Open this declaration',
            on: { click: () => onOpenSource(item.at) } }))
        : null))),

    h.footer({ class: 'panel-foot' },
      h.button({ class: 'ghost', type: 'button', text: 'Back to the form', on: { click: onDismiss } }),
      h.small({ class: 'muted', text: 'Every refusal in this system names its own file and line. '
        + 'There are no hidden rules.' })));
}

// ---------------------------------------------------------------------------------------------
// the operating model — Principle 11, made touchable
// ---------------------------------------------------------------------------------------------

export function renderModelTree(tree, { onOpenFile, onNewFile, modelErrors = [] }) {
  return frag(
    h.header({ class: 'view-head' },
      h.div({},
        h.h1({ text: 'The operating model' }),
        h.small({ class: 'muted', text: 'This is the software. Editing a sentence here changes '
          + 'what the system does, immediately and for everyone.' })),
      h.div({ class: 'view-actions' },
        h.button({ class: 'primary', type: 'button', text: 'New file', on: { click: onNewFile } }))),
    modelErrors.length
      ? h.div({ class: 'notice notice-warn' },
        h.strong({ text: `${modelErrors.length} error${modelErrors.length === 1 ? '' : 's'} — nothing is being executed` }),
        h.ul({}, modelErrors.map((e) => h.li({},
          h.span({ text: e.reason }), ' ', e.at ? cite(parseCite(e.at)) : null))))
      : null,
    tree.length === 0
      ? h.div({ class: 'empty' }, h.p({ text: 'There are no operating-model files yet.' }))
      : h.div({ class: 'model-tree' }, tree.map((group) => h.section({ class: 'card' },
        h.header({ class: 'card-head' },
          h.h2({ text: group.title }),
          h.small({ class: 'muted', text: `${group.files.length} file${group.files.length === 1 ? '' : 's'}` })),
        h.ul({ class: 'file-list' }, group.files.map((f) => h.li({},
          h.button({ class: 'link', type: 'button', text: f.title,
            on: { click: () => onOpenFile(f.path) } }),
          ' ', h.code({ class: 'slug', text: f.path }))))))),
  );
}

/**
 * View and edit one file. The editor is a `<textarea>` — deliberately, because the thing being
 * edited is prose with some structure in it, not source code, and a syntax-highlighting editor
 * would quietly reframe it as programming (Principle 11 says it is not).
 */
export function renderModelFile(vm, { onSave, onBack, busy = false, diagnostics = null, highlight = null }) {
  const editor = h.textarea({
    class: 'editor mono', spellcheck: 'false', rows: Math.max(20, Math.min(50, vm.lines + 4)),
  });
  editor.value = vm.text;

  // When we arrived here from a refusal, put the cursor on the line that refused.
  if (highlight && Number.isFinite(highlight)) {
    const before = vm.text.split('\n').slice(0, highlight - 1).join('\n').length;
    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(before, before);
      editor.scrollTop = Math.max(0, (highlight - 6) * 20);
    });
  }

  return frag(
    h.header({ class: 'view-head' },
      h.div({},
        h.h1({ text: vm.name ? labelOf(vm.name) : vm.path }),
        h.small({ class: 'muted' }, h.code({ class: 'mono', text: vm.path }))),
      h.div({ class: 'view-actions' },
        h.button({ class: 'ghost', type: 'button', text: '← Back', on: { click: onBack } }),
        h.button({ class: 'primary', type: 'button', text: busy ? 'Saving…' : 'Save',
          disabled: busy, on: { click: () => onSave(editor.value) } }))),

    diagnostics ? renderDiagnostics(diagnostics) : null,

    h.div({ class: 'split split-editor' },
      h.section({ class: 'card' },
        h.header({ class: 'card-head' }, h.h2({ text: 'The text' }),
          h.small({ class: 'muted', text: 'Prose is for people. The "##" sections are executed.' })),
        editor,
        h.small({ class: 'muted', text: 'Saving writes one signed commit. If the text does not '
          + 'parse, nothing is written and the diagnostics appear above.' })),

      h.section({ class: 'card' },
        h.header({ class: 'card-head' }, h.h2({ text: 'What the runtime reads from it' }),
          h.small({ class: 'muted', text: 'Reload after saving to see this change.' })),
        modelFileSummary(vm))),
  );
}

const labelOf = (slug) => String(slug).split('-')
  .map((w, i) => (i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

function modelFileSummary(vm) {
  const empty = vm.fields.length === 0 && vm.rules.length === 0
    && vm.predicates.length === 0 && !vm.roleDef;
  if (empty) {
    return h.div({ class: 'empty' },
      h.p({ text: 'The runtime reads nothing executable from this file — it is prose only.' }),
      h.p({ class: 'muted', text: 'That is a valid file. Prose is half the point of an '
        + 'operating model; only the "##" sections below are executed.' }));
  }
  return frag(
    vm.roleDef ? h.p({}, 'This file declares the role ', h.code({ class: 'slug', text: vm.name }), '.') : null,
    vm.fields.length
      ? frag(h.h3({ text: 'Fields' }),
        h.table({ class: 'grid compact' },
          h.thead({}, h.tr({}, h.th({ text: 'Field' }), h.th({ text: 'Type' }),
            h.th({ text: '' }), h.th({ class: 'num', text: 'Line' }))),
          h.tbody({}, vm.fields.map((f) => h.tr({},
            h.td({}, h.code({ class: 'slug', text: f.name })),
            h.td({ class: 'muted', text: f.type }),
            h.td({}, f.required ? badge('required', 'warn') : null),
            h.td({ class: 'num muted', text: String(f.line ?? '') }))))))
      : null,
    vm.predicates.length
      ? frag(h.h3({ text: 'Predicates' }),
        h.dl({ class: 'fields' }, vm.predicates.map((p) => frag(
          h.dt({ text: p.name }), h.dd({ class: 'mono', text: p.text })))))
      : null,
    vm.identifiedBy?.length
      ? frag(h.h3({ text: 'Identified by' }),
        h.p({}, vm.identifiedBy.map((f, i) => frag(i ? ' and ' : '', h.code({ class: 'slug', text: f })))),
        vm.createdOnDemand
          ? h.small({ class: 'muted', text: 'Created on demand: a counter rule may bring one of '
            + 'these into existence.' }) : null)
      : null,
    vm.rules.length
      ? frag(h.h3({ text: `Rules (${vm.rules.length})` }),
        h.ul({ class: 'rule-list' }, vm.rules.map((r) => h.li({},
          h.pre({ class: 'rule-text', text: r.text }),
          h.div({ class: 'rule-meta' },
            badge(`line ${r.line}`, 'muted'),
            r.authorizedBy.length ? frag(' ', badge(`authorized by ${r.authorizedBy.join(' or ')}`, 'muted')) : null)))))
      : null,
  );
}

/** A parse error, shown against the text that caused it. */
export function renderDiagnostics(vm) {
  return h.section({ class: 'panel panel-refusal' },
    h.header({ class: 'panel-head' },
      h.h2({ text: vm.items.length === 1
        ? 'That text was not saved — one line could not be read'
        : `That text was not saved — ${vm.items.length} lines could not be read` }),
      h.p({ text: 'The previous version is still running. Nothing was half-applied.' })),
    h.ul({ class: 'refusal-list' }, vm.items.map((item) => h.li({ class: 'refusal-item' },
      h.div({ class: 'refusal-reason', text: item.reason }),
      item.detail.length ? h.ul({ class: 'refusal-detail' }, item.detail.map((d) => h.li({ text: d }))) : null,
      item.at ? h.div({ class: 'refusal-rule-head' }, cite(item.at)) : null,
      item.excerpt ? excerptBlock(item.excerpt) : null))));
}

// ---------------------------------------------------------------------------------------------
// the transaction log
// ---------------------------------------------------------------------------------------------

export function renderLog(vm, { onVerify, onOpen, onOpenSource, verifying = false,
  workspaceHint = null, allowedSigners = null }) {
  return frag(
    h.header({ class: 'view-head' },
      h.div({},
        h.h1({ text: 'Transaction log' }),
        h.small({ class: 'muted', text: `${vm.total} commit${vm.total === 1 ? '' : 's'}. `
          + 'Each one is a business event, signed with your key.' })),
      h.div({ class: 'view-actions' },
        h.button({ class: 'primary', type: 'button',
          text: verifying ? 'Verifying…' : 'Verify the whole chain',
          disabled: verifying, on: { click: onVerify } }))),

    vm.counts.good || vm.counts.bad || vm.counts.none
      ? h.div({ class: vm.counts.bad ? 'notice notice-warn' : 'notice notice-ok' },
        h.strong({ text: vm.counts.bad
          ? `${vm.counts.bad} signature${vm.counts.bad === 1 ? '' : 's'} did not verify`
          : `${vm.counts.good} of ${vm.total} commits verify against the public key in this repo` }),
        h.p({ text: vm.counts.bad
          ? 'A bad signature means the commit was altered after it was signed. Any peer detects this.'
          : 'Verified by this runtime’s own SSHSIG code — no git binary, no ssh binary, in the browser.' }),
        vm.counts.none ? h.p({ class: 'muted', text: `${vm.counts.none} unsigned.` }) : null,
        vm.counts['unknown-signer']
          ? h.p({ class: 'muted', text: `${vm.counts['unknown-signer']} signed by a peer whose `
            + 'public key is not in this repo — neither verified nor forged.' }) : null)
      : null,

    // Inviting independent verification is the point. If the user only ever trusts our
    // green tick, the claim is worth nothing.
    h.section({ class: 'card' },
      h.header({ class: 'card-head' },
        h.h2({ text: 'Do not take our word for it' }),
        h.small({ class: 'muted', text: 'The same check, with tools we did not write.' })),
      workspaceHint
        ? h.p({}, 'Your workspace is the folder ', h.code({ class: 'mono', text: workspaceHint }), '.')
        : h.p({ class: 'muted', text: 'This workspace lives in the browser’s private storage '
          + '(OPFS), so there is no folder to open in a terminal. Choose a real folder on first '
          + 'run — or on any machine where you can — and these commands work verbatim.' }),
      commandBlock([
        ...(allowedSigners ? [
          '# tell git which key is allowed to sign for you (once)',
          `printf '%s\\n' ${shellQuote(allowedSigners)} > .git/allowed_signers`,
          'git config gpg.ssh.allowedSignersFile .git/allowed_signers',
          '',
        ] : []),
        '# then, in your workspace folder:',
        'git log --show-signature',
        'git verify-commit HEAD',
        'git fsck --strict',
      ], { note: 'A “Good "git" signature” line per commit is what you are looking for.' })),

    h.div({ class: 'table-scroll' }, h.table({ class: 'grid' },
      h.thead({}, h.tr({},
        h.th({ text: 'Commit' }),
        h.th({ text: 'Signature' }),
        h.th({ text: 'What happened' }),
        h.th({ text: 'Because of' }),
        h.th({ text: 'When' }))),
      h.tbody({}, vm.entries.map((e) => h.tr({},
        h.td({}, h.code({ class: 'mono', text: e.short }),
          e.genesis ? frag(' ', badge('genesis', 'muted')) : null),
        h.td({}, signatureBadge(e.signature),
          h.div({}, h.small({ class: 'muted', text: e.signedBy ?? '' }))),
        h.td({},
          h.div({ text: e.subject }),
          e.changes.length
            ? h.ul({ class: 'change-list' }, e.changes.map((c) => h.li({},
              badge(c.op, c.op === 'delete' ? 'warn' : 'muted'), ' ',
              h.button({ class: 'link mono', type: 'button', text: `${c.entity}/${c.id}`,
                on: { click: () => onOpen(c.entity, c.id) } }))))
            : null),
        h.td({}, e.rules.length
          ? e.rules.map((r) => h.div({},
            cite(r.at, { onOpen: onOpenSource }),
            r.sentence ? h.pre({ class: 'rule-text tiny', text: r.sentence }) : null))
          : h.span({ class: 'muted', text: '—' })),
        h.td({ class: 'muted mono', text: e.when })))))),
  );
}

function signatureBadge(signature) {
  const kind = signature === 'good' ? 'ok' : signature === 'bad' ? 'bad' : 'muted';
  const label = signature === 'good' ? 'good' : signature === 'bad' ? 'BAD' : signature;
  return badge(label, kind);
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------------------------------------
// this runtime — where the code came from, and whether it is the code you think it is
// ---------------------------------------------------------------------------------------------

/**
 * The runtime is now delivered from an origin rather than a folder, which puts whoever controls
 * that origin in a position to serve different code. This screen exists so that position is
 * *checkable*: the hashes below are taken over the bytes the browser actually received, and the
 * command reproduces them with `shasum`. Signature verification against a pinned release key is
 * v0.2 — until then the first install is trust-on-first-use, and this screen says so.
 */
/**
 * The release gate's verdict, shown plainly — including when there is nothing to show.
 *
 * This block exists because COMPROMISES #15 promised an "unsigned" banner and the code captured the
 * verdict without ever rendering it: the register was describing a screen nobody had built. An
 * honest compromise entry that documents a mitigation which does not exist is worse than no entry,
 * because a reviewer reads it as a mitigation that does.
 */
function releaseBlock(release) {
  const mode = release?.mode ?? 'unchecked';

  if (mode === 'unsigned') {
    return h.div({ class: 'notice notice-warn' },
      h.strong({ text: 'This runtime is not signed' }),
      h.p({ text: 'No release manifest was served, so nothing here was checked against a signing '
        + 'key and nothing pins what a future update may replace it with. The hashes below still '
        + 'let you compare this code against the repository by hand — but the origin that served '
        + 'it is being trusted, which is exactly the dependency a signed release removes.' }),
      h.p({ class: 'muted', text: 'Expected for a development build served from localhost. Not '
        + 'acceptable for a company that keeps its books here.' }));
  }

  if (mode === 'first-use' || mode === 'pinned') {
    return h.div({ class: 'notice notice-ok' },
      h.strong({ text: mode === 'first-use'
        ? 'Signing key pinned on this machine'
        : 'Signature verified against the key pinned on this machine' }),
      h.dl({ class: 'fields' },
        h.dt({ text: 'Release' }), h.dd({ class: 'mono', text: release.version ?? 'unknown' }),
        h.dt({ text: 'Signing key' }), h.dd({ class: 'mono', text: release.fingerprint ?? 'unknown' })),
      h.p({ text: 'An update not signed by this key will be refused — including one served by us. '
        + 'Compare the fingerprint against the one published outside this website: in the '
        + 'repository, in the release notes, and on paper.' }));
  }

  return h.div({ class: 'notice notice-warn' },
    h.strong({ text: 'The runtime signature was not checked' }),
    h.p({ text: `The release gate reported "${mode}", which means this page cannot say whether the `
      + 'code it is running was the code that was published. Treat the hashes below as a record to '
      + 'compare by hand, not as a verification.' }));
}

export function renderRuntime(vm, { onRehash, onCheckUpdate, onApplyUpdate, busy = false,
  checking = false }) {
  const { hashes, origin: org, worker, persistence, update } = vm;

  return frag(
    h.header({ class: 'view-head' },
      h.div({},
        h.h1({ text: 'This runtime' }),
        h.small({ class: 'muted', text: `Version ${vm.version}. The code that is executing right `
          + 'now, and how to check that it is the code in the repository.' })),
      h.div({ class: 'view-actions' },
        h.button({ class: 'ghost', type: 'button', text: checking ? 'Checking…' : 'Check for updates',
          disabled: checking, on: { click: onCheckUpdate } }),
        h.button({ class: 'ghost', type: 'button', text: busy ? 'Hashing…' : 'Re-hash',
          disabled: busy, on: { click: onRehash } }))),

    update?.waiting
      ? h.div({ class: 'notice' },
        h.strong({ text: `A new version of NeoDonkey is ready to install.` }),
        h.p({ text: 'The version you are running now keeps running until you choose. Nothing '
          + 'updates itself — two peers on different versions exchange the same facts.' }),
        h.button({ class: 'primary', type: 'button', text: 'Install and reload',
          on: { click: onApplyUpdate } }))
      : null,

    h.section({ class: 'card' },
      h.header({ class: 'card-head' },
        h.h2({ text: 'Where this code came from' }),
        h.small({ class: 'muted', text: 'An origin is a distribution point. Yours can be your own.' })),
      h.dl({ class: 'fields' },
        pair('Version', vm.version),
        pair('Served from', org.origin, { mono: true }),
        pair('App base', org.base, { mono: true }),
        pair('Secure context', org.secureContext ? 'yes' : 'no — OPFS and passkeys are unavailable'),
        pair('Installed as an app', org.standalone ? 'yes (standalone window)' : 'no (browser tab)'),
        pair('Offline cache', worker.supported
          ? (worker.status === 'controlling'
            ? `ready — ${org.shellFiles} files cached, works with no network`
            : `service worker ${worker.status}`)
          : `not available — ${worker.note ?? worker.error ?? 'unsupported'}`),
        pair('Persistent storage', persistenceText(persistence))),
      persistence && persistence.supported && !persistence.persisted
        ? h.div({ class: 'notice notice-warn' },
          h.strong({ text: 'This browser may delete your workspace to reclaim space' }),
          h.p({ text: 'The browser declined to mark this storage as persistent. Safari in '
            + 'particular evicts data from apps it thinks are unused. For an ERP that is data '
            + 'loss, so it should not be a surprise.' }),
          h.p({ text: 'Two things fix it properly: install NeoDonkey as an app (browsers grant '
            + 'persistence far more readily to installed apps), or keep your company in a real '
            + 'folder instead of browser storage. And in the end the honest answer is the '
            + 'manifesto’s: the other peers are the backup.' }))
        : null),

    h.section({ class: 'card' },
      h.header({ class: 'card-head' },
        h.h2({ text: 'Do not take our word for it' }),
        h.small({ class: 'muted', text: 'These hashes are over the bytes this browser received — '
          + 'so they also catch a server that changes the code on the way to you.' })),

      hashes.combined
        ? h.div({},
          h.p({}, h.strong({ text: 'Combined hash of all ' }),
            h.strong({ text: String(hashes.files.length) }),
            h.strong({ text: ' runtime files' })),
          h.pre({ class: 'command-text', text: hashes.combined }),
          commandBlock(hashes.command,
            { note: 'Same number, computed by tools we did not write.' }))
        : h.div({ class: 'notice notice-warn' },
          h.strong({ text: 'Some runtime files could not be read, so there is no combined hash' }),
          h.ul({}, hashes.failed.map((f) => h.li({},
            h.code({ class: 'mono', text: f.path }), ' — ', f.reason)))),

      releaseBlock(vm.release),

      h.div({ class: 'notice notice-warn' },
        h.strong({ text: 'What a hash does not prove' }),
        h.p({ text: 'A hash tells you the code has not changed since you last looked. It cannot '
          + 'tell you the code was right the first time. If the origin you installed from was '
          + 'compromised on day one, every hash here would match a compromised runtime and you '
          + 'could not tell. That is what the signature above is for — and why the first install '
          + 'is the one moment cryptography cannot protect.' })),

      h.details({},
        h.summary({ text: `Every file (${hashes.files.length}, ${formatBytes(hashes.totalBytes)})` }),
        h.div({ class: 'table-scroll' }, h.table({ class: 'grid compact' },
          h.thead({}, h.tr({},
            h.th({ text: 'File' }), h.th({ class: 'num', text: 'Bytes' }), h.th({ text: 'SHA-256' }))),
          h.tbody({}, hashes.files.map((f) => h.tr({},
            h.td({}, h.code({ class: 'mono', text: f.path })),
            h.td({ class: 'num muted', text: String(f.bytes) }),
            h.td({}, h.code({ class: 'mono', text: f.sha256 })))))))))
  );
}

function persistenceText(p) {
  if (!p) return 'not checked';
  if (!p.supported) return 'this browser does not offer it';
  const size = p.estimate?.usage !== undefined
    ? ` · using ${formatBytes(p.estimate.usage)} of ${formatBytes(p.estimate.quota)}` : '';
  return (p.persisted ? 'granted — the browser will not evict your workspace' : 'DENIED') + size;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The update banner. Unobtrusive, never automatic. */
export function renderUpdateBanner(version, { onApply, onDismiss }) {
  return h.div({ class: 'updatebar', role: 'status' },
    h.span({}, h.strong({ text: `NeoDonkey ${version} is available.` }),
      ' The version you are running keeps running until you install it.'),
    h.span({ class: 'updatebar-actions' },
      h.button({ class: 'primary', type: 'button', text: 'Install and reload', on: { click: onApply } }),
      h.button({ class: 'ghost', type: 'button', text: 'Later', on: { click: onDismiss } })));
}
