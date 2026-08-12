// runtime/ui/forms.js — one form renderer. There is no second one, and no per-entity one.
//
// Every input on screen comes from a `## Fields` line. The control type comes from the
// declared type (fields.js `inputTypeFor`), a `reference to <entity>` becomes a picker filled
// from the index, and `required` is shown with the file and line that declares it.
//
// Two deliberate decisions, both explained in docs/_compromise-ui.md:
//
//  1. The form does NOT set the HTML `required` attribute. A missing required field is
//     submitted, refused by the operating model, and shown as the company's own sentence with
//     its file and line. Letting the browser say "Please fill out this field" would replace the
//     best explanation in the product with the worst one.
//  2. Nothing is written on keystroke. `kernel.edit()`/`finalize()` (the Live Layer) exist, but
//     a form that commits per keystroke would put 200 CRDT ops where one fact belongs.

import { h, frag, cite, badge } from './render.js';
import { collectForm } from './viewmodel.js';

/**
 * @param {ReturnType<import('./viewmodel.js').formView>} form
 * @param {{ onSubmit: (result: {doc: object, problems: object[]}) => void,
 *           onCancel: () => void, onOpenSource?: (at: object) => void,
 *           onCreateReferenced?: (entity: string) => void,
 *           busy?: boolean }} handlers
 */
export function renderForm(form, handlers) {
  const { onSubmit, onCancel, onOpenSource = null, onCreateReferenced = null } = handlers;
  const controls = new Map();

  const idInput = h.input({
    type: 'text', id: 'field-id', name: 'id', value: form.id,
    class: 'mono', autocomplete: 'off', spellcheck: 'false',
    readonly: !form.idEditable,
  });

  const body = h.div({ class: 'form-grid' },
    // `id` is not declared in `## Fields`, but every document has one (CONTRACT: Doc).
    field({
      label: 'Id',
      hint: form.idEditable
        ? 'The document’s name in git: documents/' + form.entity + '/<id>.json'
        : 'The id of a document never changes.',
      required: true,
      control: idInput,
      typeLabel: 'text',
    }),
    form.fields.map((f) => {
      const control = buildControl(f, form);
      controls.set(f.name, control);
      return field({
        label: f.label,
        required: f.required,
        declaredAt: f.declaredAt,
        typeLabel: f.type,
        problem: f.problem,
        hint: referenceHint(f, onCreateReferenced),
        control,
        onOpenSource,
      });
    }),
  );

  const read = () => {
    const values = { id: idInput.value };
    for (const [name, control] of controls) {
      values[name] = control.type === 'checkbox' ? control.checked : control.value;
    }
    return collectForm(form, values);
  };

  const formEl = h.form({
    class: 'card',
    // novalidate is the point of decision 1 above, stated in the markup.
    novalidate: true,
    on: {
      submit: (e) => { e.preventDefault(); onSubmit(read()); },
    },
  },
  h.header({ class: 'card-head' },
    h.h2({ text: form.mode === 'create' ? `New ${form.title.toLowerCase()}` : `Edit ${form.title.toLowerCase()}` }),
    h.small({ class: 'muted', text: form.mode === 'create'
      ? 'Every field below is a line in the operating model. Nothing here is hand-written.'
      : `Editing ${form.entity} ${form.id}.` })),
  authorizationNotice(form, onOpenSource),
  body,
  h.footer({ class: 'form-actions' },
    h.button({ type: 'submit', class: 'primary', text: form.mode === 'create' ? 'Create' : 'Save',
      disabled: handlers.busy === true }),
    h.button({ type: 'button', class: 'ghost', text: 'Cancel', on: { click: onCancel } }),
    h.small({ class: 'muted', text: 'One business event becomes one signed commit.' })));

  return formEl;
}

/** The `## Authorized by` situation, before the user wastes their time filling the form in. */
function authorizationNotice(form, onOpenSource) {
  const p = form.permission;
  if (!p || p.allowed) return null;
  return h.div({ class: 'notice notice-warn' },
    h.strong({ text: `Your role may not ${form.mode === 'create' ? 'create' : 'change'} a ${form.entity}.` }),
    h.p({ text: 'You can fill this in, but the operating model will refuse it — authorization is '
      + 'a rule, not a hidden button. These lines decide:' }),
    h.ul({}, p.blockedBy.map((r) => h.li({},
      h.code({ class: 'rule-inline', text: `## Authorized by ${r.authorizedBy.join(' or ')}` }),
      ' ',
      cite(r.authorizedBySource ?? r.source, { onOpen: onOpenSource })))));
}

/** One labelled control. */
function field({ label, control, required = false, declaredAt = null, typeLabel = null,
  hint = null, problem = null, onOpenSource = null }) {
  return h.div({ class: problem ? 'form-field has-problem' : 'form-field' },
    h.label({ for: control.id || null },
      h.span({ class: 'form-label', text: label }),
      required ? h.span({ class: 'req', text: 'required', title: declaredAt
        ? `declared required in ${declaredAt.file}:${declaredAt.line}` : 'required' }) : null,
      typeLabel ? h.span({ class: 'form-type', text: typeLabel }) : null),
    control,
    hint ? h.small({ class: 'muted form-hint' }, hint) : null,
    problem ? h.small({ class: 'form-problem' }, problem) : null,
    declaredAt && onOpenSource
      ? h.small({ class: 'form-source' }, cite(declaredAt, { onOpen: onOpenSource })) : null);
}

/** The declared type decides the control. This function is the entire "form generator". */
function buildControl(f, form) {
  const id = `field-${f.name}`;
  const c = f.control;

  if (c.control === 'select') {
    const select = h.select({ id, name: f.name, disabled: f.problem ? true : null });
    select.appendChild(h.option({ value: '', text: f.emptyOption ?? '— none —' }));
    for (const opt of f.options ?? []) {
      select.appendChild(h.option({ value: opt.value, text: opt.label }));
    }
    select.value = f.value === undefined || f.value === null ? '' : String(f.value);
    // A reference whose target has been deleted must not silently blank the field.
    if (select.value === '' && f.value) {
      select.appendChild(h.option({ value: String(f.value), text: `${f.value} (missing)` }));
      select.value = String(f.value);
    }
    return select;
  }

  if (c.control === 'checkbox') {
    return h.input({ type: 'checkbox', id, name: f.name, checked: f.value === true });
  }

  if (c.control === 'unknown') {
    return h.input({ type: 'text', id, name: f.name, value: String(f.value ?? ''), disabled: true });
  }

  return h.input({
    type: c.type, id, name: f.name,
    step: c.step ?? null,
    inputmode: c.inputmode ?? null,
    class: c.align === 'right' ? 'align-right' : null,
    value: f.value === undefined || f.value === null ? '' : String(f.value),
    autocomplete: 'off',
  });
}

/** For a reference picker with nothing to pick, say what to do about it. */
function referenceHint(f, onCreateReferenced) {
  if (f.control.control !== 'select' || !f.targetEmpty) return null;
  return frag(
    `No ${f.targetEntity} documents exist yet. `,
    onCreateReferenced
      ? h.button({ class: 'link', type: 'button', text: `Create a ${f.targetEntity} first`,
        on: { click: () => onCreateReferenced(f.targetEntity) } })
      : null,
  );
}
