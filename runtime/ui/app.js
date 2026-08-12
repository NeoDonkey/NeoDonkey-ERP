// runtime/ui/app.js — state, routing and the kernel calls. The only file that both touches the
// DOM and talks to the kernel; everything it renders it gets from viewmodel.js.
//
// Routing is `location.hash`, so the back button works and a colleague can be sent a link to a
// document. There is no router library and no history abstraction: three lines of parsing.

import { h, replace, frag } from './render.js';
import {
  detailView, diagnosticsView, formView, historyView, listView, navFor,
  operatingModelFileView, operatingModelTree, overview, parseAt, refusalView,
} from './viewmodel.js';
import { renderForm } from './forms.js';
import {
  renderDetail, renderList, renderLog, renderModelFile, renderModelTree, renderOverview,
  renderRefusal, renderRuntime, renderUpdateBanner,
} from './views.js';
import { operatingModelSources, runtimeWarnings } from './kernel-gaps.js';
import { applyUpdate, checkForUpdate, hashRuntime, origin, VERSION } from './pwa.js';

const PREF = 'neodonkey.ui';

/**
 * @param {{ kernel: object, root: HTMLElement,
 *           workspace: {kind: string, label: string|null},
 *           publicSsh: string|null, starterNote: string|null }} options
 */
export function createApp(options) {
  const {
    kernel, root, workspace, publicSsh = null, starterNote = null,
    release = { mode: 'unchecked', version: null, fingerprint: null },
    worker = { supported: false, status: 'unknown' }, persistence = null,
  } = options;

  const prefs = loadPrefs();
  // FD-9. The roles this peer actually HOLDS, from its signed peer record in the repo — not the
  // roles the company has a word for. The selector offers a subset of this and nothing else, so a
  // stored preference naming a role that was never granted (or has been revoked) cannot survive a
  // reload and be sent to perform(), where it would be refused as `roles-not-held`.
  const held = kernel.myRoles ? kernel.myRoles() : { roles: [], recorded: false, at: null };
  const heldRole = (r) => (r !== null && r !== undefined && held.roles.includes(r) ? r : null);
  const state = {
    route: parseRoute(location.hash),
    role: heldRole(prefs.role) ?? held.roles[0] ?? null,
    held,
    locale: prefs.locale ?? (navigator.language || 'de-DE'),
    filter: '',
    refusal: null,       // set when perform() refuses; cleared on navigation
    diagnostics: null,   // set when amendOperatingModel() refuses
    pendingDoc: null,    // the form values that were refused, so nothing is retyped
    verdicts: [],
    verifying: false,
    busy: false,
    sources: operatingModelSources(kernel),
    // PWA state
    worker,
    persistence,
    updateWaiting: false,
    updateDismissed: false,
    checking: false,
    hashes: null,
    hashing: false,
  };

  const shell = buildShell();
  replace(root, shell.node);
  shell.setIdentity(kernel.me, workspace);

  /** Called by boot.js when the service worker reports a waiting version. */
  function updateAvailable(registration) {
    state.worker = { ...state.worker, registration };
    state.updateWaiting = true;
    renderBanner();
  }

  function renderBanner() {
    shell.setBanner(state.updateWaiting && !state.updateDismissed
      ? renderUpdateBanner(VERSION, {
        onApply: () => applyUpdate(state.worker.registration),
        onDismiss: () => { state.updateDismissed = true; renderBanner(); },
      })
      : null);
  }

  // ---- navigation -----------------------------------------------------------------------

  const go = (hash) => {
    if (location.hash === hash) render();
    else location.hash = hash;
  };
  const routes = {
    overview: () => '#/',
    entity: (entity) => `#/e/${encodeURIComponent(entity)}`,
    detail: (entity, id) => `#/e/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`,
    create: (entity) => `#/e/${encodeURIComponent(entity)}/new`,
    edit: (entity, id) => `#/e/${encodeURIComponent(entity)}/${encodeURIComponent(id)}/edit`,
    model: () => '#/model',
    modelFile: (path, line = null) => `#/model/${encodeURIComponent(path)}${line ? `?line=${line}` : ''}`,
    log: () => '#/log',
    runtime: () => '#/runtime',
  };

  addEventListener('hashchange', () => {
    const next = parseRoute(location.hash);
    // Keep half-typed values only while we stay on the same entity's form — a refusal
    // navigates nowhere, so this preserves the retype-nothing property without leaking
    // one entity's values into another's form.
    if (state.pendingDoc && state.pendingDoc.entity !== next.entity) state.pendingDoc = null;
    state.route = next;
    state.refusal = null;
    state.diagnostics = null;
    state.filter = '';
    render();
  });

  const openSource = (at) => {
    if (!at?.file) return;
    go(routes.modelFile(at.file, at.line ?? null));
  };

  // ---- actions --------------------------------------------------------------------------

  /** One business event. Either it is refused with the reason, or it is one signed commit. */
  async function perform(intent, { onCommitted = null } = {}) {
    state.busy = true; render();
    let result;
    try {
      result = await kernel.perform(intent);
    } catch (err) {
      // A throw from the kernel is not a refusal — it is a defect. Show it as one.
      state.busy = false;
      state.refusal = refusalView([{ reason: `The runtime failed: ${err.message}`, at: null }],
        { model: kernel.model, sources: state.sources });
      render();
      return null;
    }
    state.busy = false;
    if (result.rejected) {
      state.refusal = refusalView(result.rejected, { model: kernel.model, sources: state.sources });
      render();
      return null;
    }
    state.refusal = null;
    state.pendingDoc = null;
    state.verdicts = [];
    if (onCommitted) onCommitted(result);
    return result;
  }

  async function saveModelFile(path, text) {
    state.busy = true; state.diagnostics = null; render();
    let result;
    try {
      result = await kernel.amendOperatingModel(path, text, `operating model: ${path}`);
    } catch (err) {
      state.busy = false;
      state.diagnostics = diagnosticsView([{ reason: err.message, at: null }], text);
      render();
      return;
    }
    state.busy = false;
    if (result.rejected) {
      state.diagnostics = diagnosticsView(result.rejected, text);
      render();
      return;
    }
    // The company just changed. Re-read the sources and rebuild everything from the new model.
    state.sources = operatingModelSources(kernel);
    state.verdicts = [];
    render();
  }

  async function verifyChain() {
    state.verifying = true; render();
    try {
      state.verdicts = await kernel.verify();
    } catch (err) {
      state.verdicts = [{ oid: '', signature: 'bad', by: `verification failed: ${err.message}` }];
    }
    state.verifying = false;
    render();
  }

  // ---- render ---------------------------------------------------------------------------

  function render() {
    const model = kernel.model;
    // FD-9: the picker offers only roles this peer holds, and says where they came from.
    shell.setRole(navFor(model, state.role), state.role, (role) => {
      state.role = heldRole(role);
      savePrefs({ ...loadPrefs(), role: state.role });
      render();
    }, state.held, kernel.me);
    shell.setNav(navFor(model, state.role), state.route, {
      onOverview: () => go(routes.overview()),
      onEntity: (e) => go(routes.entity(e)),
      onModel: () => go(routes.model()),
      onLog: () => go(routes.log()),
      onRuntime: () => go(routes.runtime()),
    });
    renderBanner();

    // A refusal replaces the view it came from — it is the most important thing on screen,
    // not a toast in the corner.
    if (state.refusal) {
      shell.setMain(renderRefusal(state.refusal, {
        onOpenSource: openSource,
        onDismiss: () => { state.refusal = null; render(); },
      }));
      return;
    }
    shell.setMain(renderRoute());
  }

  function renderRoute() {
    const model = kernel.model;
    const r = state.route;
    const common = { locale: state.locale, role: state.role, model, index: kernel.query };

    if (r.kind === 'overview') {
      return renderOverview(
        overview({ ...common, modelErrors: kernel.modelErrors, sources: state.sources,
          warnings: runtimeWarnings(kernel) }),
        { onEntity: (e) => go(routes.entity(e)), onModel: () => go(routes.model()),
          onLog: () => go(routes.log()), starterNote },
      );
    }

    if (r.kind === 'list') {
      return renderList(listView({ ...common, entity: r.entity, filter: state.filter }), {
        filter: state.filter,
        onFilter: (v) => { state.filter = v; render(); },
        onOpen: (entity, id) => go(routes.detail(entity, id)),
        onCreate: () => go(routes.create(r.entity)),
        onOpenSource: openSource,
      });
    }

    if (r.kind === 'detail') {
      return renderDetail(detailView({ ...common, entity: r.entity, id: r.id }), {
        onOpen: (entity, id) => go(routes.detail(entity, id)),
        onEdit: () => go(routes.edit(r.entity, r.id)),
        onBack: () => go(routes.entity(r.entity)),
        onOpenSource: openSource,
        onDelete: () => deleteDocument(r.entity, r.id),
      });
    }

    if (r.kind === 'create' || r.kind === 'edit') {
      const form = formView({
        ...common,
        entity: r.entity,
        id: r.kind === 'edit' ? r.id : null,
        doc: state.pendingDoc?.entity === r.entity ? state.pendingDoc : null,
        nextId: r.kind === 'create' ? safeNextId(r.entity) : null,
      });
      if (form.kind === 'unknown-entity') return renderList(form, noopListHandlers());
      return renderForm(form, {
        busy: state.busy,
        onCancel: () => go(r.kind === 'edit' ? routes.detail(r.entity, r.id) : routes.entity(r.entity)),
        onOpenSource: openSource,
        onCreateReferenced: (entity) => go(routes.create(entity)),
        onSubmit: ({ doc, problems }) => {
          if (problems.length) {
            state.pendingDoc = doc;
            state.refusal = refusalView(problems.map((p) => ({
              reason: `${p.label}: ${p.reason}`, at: null,
            })), { model, sources: state.sources });
            render();
            return;
          }
          state.pendingDoc = doc;
          perform({
            op: r.kind === 'create' ? 'create' : 'update',
            entity: r.entity, id: doc.id, doc, actorRoles: state.role ? [state.role] : [],
          }, { onCommitted: () => go(routes.detail(r.entity, doc.id)) });
        },
      });
    }

    if (r.kind === 'model') {
      return renderModelTree(operatingModelTree(state.sources.keys()), {
        modelErrors: kernel.modelErrors.map((e) => ({
          reason: e.message, at: e.file ? `${e.file}:${e.line}` : null,
        })),
        onOpenFile: (path) => go(routes.modelFile(path)),
        onNewFile: newModelFile,
      });
    }

    if (r.kind === 'model-file') {
      const text = state.sources.get(r.path);
      if (text === undefined) {
        return h.section({ class: 'panel' },
          h.h1({ text: `There is no file ${r.path} in this workspace.` }),
          h.button({ class: 'ghost', type: 'button', text: '← Back to the operating model',
            on: { click: () => go(routes.model()) } }));
      }
      return renderModelFile(operatingModelFileView({ model, path: r.path, text }), {
        busy: state.busy,
        diagnostics: state.diagnostics,
        highlight: r.line,
        onBack: () => go(routes.model()),
        onSave: (value) => saveModelFile(r.path, value),
      });
    }

    if (r.kind === 'log') return renderLogRoute();

    if (r.kind === 'runtime') {
      // The hashes are computed once and kept, so switching views does not re-fetch the
      // whole runtime every time.
      if (!state.hashes && !state.hashing) {
        state.hashing = true;
        hashRuntime().then((hashes) => {
          state.hashes = hashes;
          state.hashing = false;
          if (state.route.kind === 'runtime') render();
        }).catch(() => { state.hashing = false; });
      }
      if (!state.hashes) return h.div({ class: 'empty', text: 'Hashing the runtime…' });
      return renderRuntime({
        version: VERSION,
        hashes: state.hashes,
        origin: origin(),
        release,
        worker: state.worker,
        persistence: state.persistence,
        update: { waiting: state.updateWaiting },
      }, {
        busy: state.hashing,
        checking: state.checking,
        onRehash: () => { state.hashes = null; render(); },
        onApplyUpdate: () => applyUpdate(state.worker.registration),
        onCheckUpdate: async () => {
          state.checking = true; render();
          try {
            const res = await checkForUpdate(state.worker.registration);
            if (res.waiting) { state.updateWaiting = true; state.updateDismissed = false; renderBanner(); }
          } catch { /* offline: nothing to report */ }
          state.checking = false;
          render();
        },
      });
    }

    return h.section({ class: 'panel' },
      h.h1({ text: 'That address does not exist.' }),
      h.button({ class: 'ghost', type: 'button', text: '← Overview', on: { click: () => go(routes.overview()) } }));
  }

  /** The log needs async data, so it renders a placeholder and fills in. */
  function renderLogRoute() {
    const host = h.div({}, h.div({ class: 'empty', text: 'Reading the commit chain…' }));
    (async () => {
      const transactions = await kernel.history(200);
      const vm = historyView(transactions, state.verdicts, { locale: state.locale, model: kernel.model });
      replace(host, renderLog(vm, {
        verifying: state.verifying,
        workspaceHint: workspace.kind === 'folder' ? workspace.label : null,
        allowedSigners: publicSsh ? `${kernel.me.email} ${publicSsh}` : null,
        onVerify: verifyChain,
        onOpen: (entity, id) => go(routes.detail(entity, id)),
        onOpenSource: openSource,
      }));
    })().catch((err) => {
      replace(host, h.div({ class: 'notice notice-warn', text: `Could not read the log: ${err.message}` }));
    });
    return host;
  }

  async function deleteDocument(entity, id) {
    const doc = kernel.query.get(entity, id);
    if (!doc) return;
    if (!confirm(`Delete ${entity} ${id}?\n\nThe document is removed from the working tree, but the `
      + 'commit that created it stays in the chain forever. Nothing is ever really erased.')) return;
    await perform({ op: 'delete', entity, id, doc, actorRoles: state.role ? [state.role] : [] },
      { onCommitted: () => go(routes.entity(entity)) });
  }

  function newModelFile() {
    const path = prompt('New operating-model file.\n\n'
      + 'A file in information/ describes a kind of document; in processes/ a set of rules; in '
      + 'organisation/ a role.\n\nPath:', 'operating-model/information/');
    if (!path) return;
    if (!path.startsWith('operating-model/') || !path.endsWith('.md')) {
      alert('The path must start with operating-model/ and end with .md');
      return;
    }
    const slug = path.split('/').pop().replace(/\.md$/, '');
    state.sources = new Map([...state.sources, [path, template(path, slug)]]);
    go(routes.modelFile(path));
  }

  function safeNextId(entity) {
    try { return kernel.nextId(entity); } catch { return ''; }
  }

  render();
  return { render, go, routes, state, updateAvailable };
}

// ---------------------------------------------------------------------------------------------
// the shell: header, role picker, nav
// ---------------------------------------------------------------------------------------------

function buildShell() {
  const roleSelect = h.select({ class: 'role-select', 'aria-label': 'Act as role' });
  // FD-9: where the offered roles came from. On screen, not in a tooltip only.
  const roleProvenance = h.small({ class: 'muted role-provenance' });
  const identity = h.div({ class: 'identity' });
  const navList = h.nav({ class: 'sidenav' });
  const main = h.main({ class: 'main', id: 'main' });
  const banner = h.div({ class: 'bannerslot' });

  const node = frag(
    h.header({ class: 'topbar' },
      h.div({ class: 'brand' },
        h.span({ class: 'brand-mark', text: 'ND' }),
        h.span({ class: 'brand-name', text: 'NeoDonkey' }),
        h.span({ class: 'brand-version muted', text: `v${VERSION}` })),
      h.div({ class: 'topbar-right' },
        h.label({ class: 'role-field' },
          h.span({ class: 'muted', text: 'Acting as' }), roleSelect, roleProvenance),
        identity)),
    banner,
    h.div({ class: 'layout' }, navList, main),
  );

  let roleWired = false;
  let roleShape = null;
  return {
    node,
    /**
     * FD-9 — the picker offers what this peer HOLDS, not what the company has a word for.
     *
     * Before this it listed every role in the operating model, and picking one made you that role:
     * the browser tab was asserting its own authority and the kernel believed it (COMPROMISES #21).
     * Now the list is the peer's recorded roles, and the provenance is on screen rather than
     * implied — because "acting as managing-director" is a very different sentence depending on
     * whether a company recorded that or a select element offered it.
     *
     * `held` is `kernel.myRoles()`. When it is empty the picker says so, names the file, and says
     * what would fix it; it does not fall back to the full list, which would put the defect back.
     */
    setRole(nav, role, onChange, held = { roles: [], recorded: false, at: null }, me = null) {
      const offered = nav.roles.filter((r) => held.roles.includes(r.name));
      // Roles the repository records that this company's model no longer declares. Shown rather
      // than dropped: a grant nobody can see is how authority rots.
      const unknown = held.roles.filter((n) => !nav.roles.some((r) => r.name === n));
      const shape = `${offered.map((r) => r.name).join(',')}|${unknown.join(',')}`;
      if (roleShape !== shape) {
        roleShape = shape;
        replace(roleSelect,
          h.option({ value: '', text: offered.length || unknown.length ? '— no role —' : '— none granted —' }),
          offered.map((r) => h.option({ value: r.name, text: r.title })),
          unknown.map((n) => h.option({ value: n, text: `${n} (not in the model)` })));
      }
      roleSelect.disabled = offered.length === 0 && unknown.length === 0;
      roleSelect.value = role ?? '';
      const where = held.at ?? 'this workspace';
      roleSelect.title = held.roles.length
        ? `${me ? me.email : 'this peer'} holds ${held.roles.join(', ')}, recorded in ${where} `
          + '(a signed commit). You may act as any one of them and as nothing else.'
        : `${me ? me.email : 'this peer'} holds no roles: ${where} records none, so anything this `
          + 'company\'s rules govern will be refused. Roles are granted in a signed commit.';
      replace(roleProvenance, held.roles.length
        ? h.span({ text: `from ${where}` })
        : h.span({ class: 'warn', text: `no roles granted in ${where}` }));
      if (!roleWired) {
        roleWired = true;
        roleSelect.addEventListener('change', () => onChange(roleSelect.value || null));
      }
    },
    setIdentity(me, workspace) {
      replace(identity,
        h.div({ class: 'identity-name', text: me.name }),
        h.div({ class: 'identity-where muted', text: workspace.kind === 'folder'
          ? `folder: ${workspace.label}` : 'browser storage (OPFS)' }));
    },
    setBanner(content) { replace(banner, content); },
    setNav(nav, route, handlers) {
      const active = (kind, entity) => route.kind === kind
        && (entity === undefined || route.entity === entity);
      replace(navList,
        h.button({ class: active('overview') ? 'navitem is-active' : 'navitem',
          type: 'button', text: 'Overview', on: { click: handlers.onOverview } }),
        section('Your work', nav.work, handlers, route),
        section('Reference', nav.reference, handlers, route),
        h.div({ class: 'navgroup' },
          h.div({ class: 'navgroup-title', text: 'The company itself' }),
          h.button({ class: active('model') || active('model-file') ? 'navitem is-active' : 'navitem',
            type: 'button', text: 'Operating model', on: { click: handlers.onModel } }),
          h.button({ class: active('log') ? 'navitem is-active' : 'navitem',
            type: 'button', text: 'Transaction log', on: { click: handlers.onLog } }),
          h.button({ class: active('runtime') ? 'navitem is-active' : 'navitem',
            type: 'button', text: 'This runtime', on: { click: handlers.onRuntime } })));
    },
    setMain(content) { replace(main, content); },
  };
}

function section(title, entities, handlers, route) {
  if (!entities.length) return null;
  return h.div({ class: 'navgroup' },
    h.div({ class: 'navgroup-title', text: title }),
    entities.map((e) => h.button({
      class: route.entity === e.name ? 'navitem is-active' : 'navitem',
      type: 'button', title: `${e.fieldCount} fields`,
      on: { click: () => handlers.onEntity(e.name) },
    }, e.title)));
}

// ---------------------------------------------------------------------------------------------
// routing + prefs
// ---------------------------------------------------------------------------------------------

/** `#/e/invoice/INV-1/edit` -> {kind:'edit', entity:'invoice', id:'INV-1'} */
export function parseRoute(hash) {
  const [pathPart, queryPart] = String(hash ?? '').replace(/^#/, '').split('?');
  const query = new URLSearchParams(queryPart ?? '');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { kind: 'overview' };
  if (parts[0] === 'model') {
    if (parts.length === 1) return { kind: 'model' };
    const line = Number(query.get('line'));
    return { kind: 'model-file', path: parts.slice(1).join('/'),
      line: Number.isFinite(line) && line > 0 ? line : null };
  }
  if (parts[0] === 'log') return { kind: 'log' };
  if (parts[0] === 'runtime') return { kind: 'runtime' };
  if (parts[0] === 'e' && parts.length >= 2) {
    const entity = parts[1];
    if (parts.length === 2) return { kind: 'list', entity };
    if (parts[2] === 'new') return { kind: 'create', entity };
    if (parts.length === 4 && parts[3] === 'edit') return { kind: 'edit', entity, id: parts[2] };
    return { kind: 'detail', entity, id: parts[2] };
  }
  return { kind: 'unknown' };
}

// `firstRole(kernel)` used to pick the alphabetically first role the MODEL declared as the default
// "acting as". Removed by FD-9 rather than fixed: the default is now the first role this peer
// actually holds (`kernel.myRoles()`), and a helper whose whole job was to pick an ungranted role
// out of the company's vocabulary has nothing left to do.

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF) ?? '{}') ?? {}; } catch { return {}; }
}
function savePrefs(value) {
  try { localStorage.setItem(PREF, JSON.stringify(value)); } catch { /* private mode */ }
}

const noopListHandlers = () => ({
  onOpen: () => {}, onCreate: () => {}, onFilter: () => {}, onOpenSource: () => {},
});

/** A starting point for a new file, in the shape the grammar expects. */
function template(path, slug) {
  if (path.includes('/information/')) {
    return `# ${slug}\n\nDescribe in your own words what this kind of document is, and when it `
      + `exists.\n\n## Fields\n- name: text required\n`;
  }
  if (path.includes('/processes/')) {
    return `# ${slug}\n\nDescribe when this process runs and what it is for.\n\n`
      + '## Triggered by\nA human sentence. The machine trigger is the "If" line below.\n\n'
      + '## Rules\nIf Create something under condition\n  field > 0\nthen\n  Update something with status "done"\n';
  }
  if (path.includes('/organisation/')) {
    return `# ${slug}\n\nWhat this role is responsible for, and what it may decide.\n`;
  }
  return `# ${slug}\n\n`;
}
