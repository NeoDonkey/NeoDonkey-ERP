// runtime/ui/render.js — the whole "framework". About sixty lines of DOM helpers.
//
// No virtual DOM, no reactivity, no template compiler, no dependencies. Views are rebuilt
// wholesale from a view model, which is fast enough because a view model is a few hundred
// objects and because correctness beats cleverness in a system whose selling point is that a
// human can audit it (Appendix III line 129).
//
// Nothing here touches `document` at module scope, so this file imports cleanly in Node —
// which is how test/g-ui.test.js can prove the UI modules have no top-level side effects.

/**
 * Build an element. `attrs` may contain `class`, `text`, `html` (rejected — see below),
 * `dataset`, `on` (event map), `style`, and any attribute name.
 *
 * There is deliberately no `innerHTML` path anywhere in runtime/ui/. Every string that reaches
 * the DOM goes through `textContent`, so a customer name containing `<script>` is a customer
 * name containing `<script>`. That is not a nicety: the documents rendered here come from
 * other peers over a mesh (Appendix III), so they are untrusted input by construction.
 *
 * @param {string} tag
 * @param {object|null} [attrs]
 * @param {...(Node|string|null|undefined|Array)} children
 */
export function el(tag, attrs = null, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = String(value);
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style') Object.assign(node.style, value);
      else if (key === 'on') for (const [type, fn] of Object.entries(value)) node.addEventListener(type, fn);
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  append(node, children);
  return node;
}

/** Append children, flattening arrays and skipping nullish — so `cond && el(...)` just works. */
export function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child)) : child);
  }
  return parent;
}

/** Replace everything inside `node`. The only mutation pattern this UI uses. */
export function replace(node, ...children) {
  node.textContent = '';
  append(node, children);
  return node;
}

export const frag = (...children) => append(document.createDocumentFragment(), children);

/** Shorthands for the tags this UI actually uses. */
const TAGS = ['div', 'span', 'p', 'a', 'button', 'section', 'header', 'footer', 'nav', 'main',
  'aside', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'form', 'label', 'input', 'select', 'option', 'textarea', 'pre', 'code', 'small', 'strong',
  'em', 'dl', 'dt', 'dd', 'hr', 'details', 'summary', 'fieldset', 'legend'];
// `attrs.nodeType` rather than `attrs instanceof Node`: `Node` is not a global outside a
// browser, and this file must import cleanly in Node so the tests can reach it.
export const h = Object.fromEntries(
  TAGS.map((tag) => [tag, (attrs, ...children) => (
    attrs && typeof attrs === 'object' && typeof attrs.nodeType !== 'number' && !Array.isArray(attrs)
      ? el(tag, attrs, ...children)
      : el(tag, null, attrs, ...children)
  )]),
);

/** A labelled value, the unit a detail page is made of. */
export function pair(label, value, { title = null, mono = false } = {}) {
  return frag(
    h.dt({ text: label }),
    h.dd({ class: mono ? 'mono' : null, title }, value),
  );
}

/** A source citation: file and line, monospaced, the thing a COO can act on. */
export function cite(at, { onOpen = null } = {}) {
  if (!at) return null;
  const text = at.line ? `${at.file}:${at.line}` : at.file;
  if (!onOpen) return h.code({ class: 'cite', text });
  return h.button({
    class: 'cite cite-link', type: 'button', text,
    title: 'open this file in the operating model editor',
    on: { click: () => onOpen(at) },
  });
}

/** A quoted excerpt with real line numbers. */
export function excerptBlock(lines) {
  if (!lines || lines.length === 0) return null;
  return h.pre({ class: 'excerpt' }, lines.map((l) => h.div({
    class: l.highlight ? 'excerpt-line is-quoted' : 'excerpt-line',
  },
  h.span({ class: 'excerpt-no', text: String(l.line) }),
  h.span({ class: 'excerpt-text', text: l.text || ' ' }))));
}

export const badge = (text, kind = null) =>
  h.span({ class: kind ? `badge badge-${kind}` : 'badge', text });

/** Copy-to-clipboard for the terminal commands we invite the user to run. */
export function commandBlock(lines, { note = null } = {}) {
  const text = lines.join('\n');
  return h.div({ class: 'command' },
    h.pre({ class: 'command-text', text }),
    h.div({ class: 'command-actions' },
      h.button({
        class: 'ghost', type: 'button', text: 'Copy',
        on: {
          click: async (e) => {
            try {
              await navigator.clipboard.writeText(text);
              e.target.textContent = 'Copied';
              setTimeout(() => { e.target.textContent = 'Copy'; }, 1200);
            } catch {
              e.target.textContent = 'Select it manually';
            }
          },
        },
      }),
      note ? h.small({ class: 'muted', text: note }) : null));
}
