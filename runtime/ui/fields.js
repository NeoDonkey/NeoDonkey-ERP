// runtime/ui/fields.js — field-type logic. Pure functions, no DOM, no kernel.
//
// This file is the whole reason there is no hand-written invoice form anywhere: everything
// a view needs to know about a field is derived here from its *declaration*
// (runtime/polism/grammar.md §2.1: text | number | money | date | boolean |
// reference to <entity>, plus `required`). Add a field to an entity file and every table,
// detail page and form that touches it changes on the next reload, with no code change.
//
// Deliberately contains no business vocabulary. test/g-ui.test.js asserts that mechanically.
//
// Formatting is done by hand rather than with Intl on purpose: `Intl` output varies by ICU
// build, and a number in an accounting system must render identically on every machine
// (CONTRACT non-negotiable #5 in spirit — a report that formats differently per browser is a
// bug an auditor would find). The separator table below is the entire locale story.

/** @typedef {import('../polism/parse.js').FieldDef} FieldDef */
/** @typedef {import('../polism/parse.js').EntityDef} EntityDef */

/** Every scalar type the grammar has. Anything else is unknown and is *shown* as unknown. */
export const SCALAR_TYPES = ['text', 'number', 'money', 'date', 'boolean', 'enum'];

/** `id` is not declared in `## Fields`, but every document has one (CONTRACT: Doc). */
export const ID_FIELD = Object.freeze({
  name: 'id', type: 'text', refEntity: null, required: true, source: null, synthetic: true,
});

/** Group and decimal separators. European mid-market first; `en` is the fallback. */
export const SEPARATORS = {
  de: { group: '.', decimal: ',' },
  at: { group: '.', decimal: ',' },
  ch: { group: "'", decimal: '.' },
  fr: { group: ' ', decimal: ',' },
  it: { group: '.', decimal: ',' },
  nl: { group: '.', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

/** Date order per language. ISO for `en`, because an ambiguous date is worse than an ugly one. */
const DATE_STYLE = {
  de: 'dmy.', at: 'dmy.', ch: 'dmy.', fr: 'dmy/', it: 'dmy/', nl: 'dmy-', en: 'iso',
};

const ACRONYMS = new Set(['id', 'vat', 'ust', 'iban', 'bic', 'eu', 'ean', 'gtin', 'sku', 'url', 'pdf', 'xml', 'oid']);

/** 'de-DE' -> 'de'. Unknown languages fall back to 'en' rather than guessing. */
export function localeKey(locale) {
  const lang = String(locale || 'en').toLowerCase().split(/[-_]/)[0];
  return SEPARATORS[lang] ? lang : 'en';
}

/** True for `reference to <entity>` fields (parse.js sets `type:'reference'` + `refEntity`). */
export function isReference(fieldDef) {
  return Boolean(fieldDef) && (fieldDef.type === 'reference' || Boolean(fieldDef.refEntity));
}

/**
 * A field declaration becomes an input control. This mapping is the entire "generated form"
 * mechanism — item 3 of the brief is this function plus a loop.
 * @param {FieldDef} fieldDef
 */
export function inputTypeFor(fieldDef) {
  if (isReference(fieldDef)) return { control: 'select', refEntity: fieldDef.refEntity };
  switch (fieldDef?.type) {
    case 'number': return { control: 'input', type: 'number', step: 'any', inputmode: 'decimal', align: 'right' };
    // FD-1: a money value is a token like "4999.99 EUR", so the control is text, not
    // number. `type=number` would let the browser coerce, re-round and localise the value
    // before the operating model ever sees it.
    case 'money': return { control: 'input', type: 'text', inputmode: 'decimal',
      placeholder: '0.00 EUR', spellcheck: 'false', align: 'right' };
    // grammar v2 §15: a closed set of values. A select, populated from the declaration, so a
    // typo becomes impossible in the UI as well as refused by the rule engine.
    case 'enum': return { control: 'select', options: [...(fieldDef.values ?? [])] };
    case 'date': return { control: 'input', type: 'date' };
    case 'boolean': return { control: 'checkbox' };
    case 'text': return { control: 'input', type: 'text' };
    default:
      // Principle 6: a type this UI does not know is shown as unknown, never quietly
      // rendered as text. The declaration is visible so the author can see what happened.
      return { control: 'unknown', declared: fieldDef?.type ?? null };
  }
}

/**
 * Fixed-point number formatting with grouped thousands. No Intl, no floats-as-strings
 * surprises: the value is rounded once, then digits are grouped.
 */
export function formatNumber(value, { locale = 'de', decimals = null } = {}) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  const sep = SEPARATORS[localeKey(locale)];
  const fixed = decimals === null ? trimFloat(n) : Math.abs(n).toFixed(decimals);
  const [intPart, fracPart] = (decimals === null ? fixed.replace('-', '') : fixed).split('.');
  let grouped = '';
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) grouped += sep.group;
    grouped += intPart[i];
  }
  const sign = n < 0 ? '−' : ''; // U+2212 MINUS SIGN: a real minus, not a hyphen
  return sign + grouped + (fracPart ? sep.decimal + fracPart : '');
}

/**
 * Render a monetary value WITHOUT ever converting it to a JavaScript number (FD-1).
 *
 * This function used to be `Math.abs(n).toFixed(2)` on `Number(value)`, which is the exact defect
 * FD-1 exists to kill: it silently re-rounds a value the operating model already rounded under a
 * declared policy, and for large amounts it loses cents outright. A display bug is not harmless
 * here — a CFO reads the screen, not the JSON.
 *
 * So we format *from the token*: split `"4999.99 EUR"` on its single space, group the integer
 * digits for the locale, and keep the fraction digits **verbatim, exactly as stored**. The scale
 * is already correct because `runtime/money/money.js` guarantees the canonical form, so there is
 * nothing left to decide at render time — which is the point.
 *
 * Legacy values (a bare number from a v0.1 workspace) still render, marked as such, because
 * Principle 6 means a document written yesterday must open today.
 */
export function formatMoney(value, { locale = 'de', doc = null, entityDef = null } = {}) {
  const raw = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?[ ]([A-Z]{3})$/.exec(raw);
  if (m) {
    const [, minus, intPart, fracPart, code] = m;
    const sep = SEPARATORS[localeKey(locale)];
    let grouped = '';
    for (let i = 0; i < intPart.length; i++) {
      if (i > 0 && (intPart.length - i) % 3 === 0) grouped += sep.group;
      grouped += intPart[i];
    }
    const sign = minus ? '−' : ''; // U+2212 MINUS SIGN, not a hyphen
    const digits = fracPart ? sep.decimal + fracPart : '';
    return { text: `${sign}${grouped}${digits} ${code}`, title: raw };
  }

  // A legacy bare number from a v0.1 workspace (grammar §10.7's sibling-`currency` shape).
  // Principle 6 says it must still open, so render it — but only with string arithmetic.
  const hasCurrency = entityDef?.fields?.get('currency')?.type === 'text';
  const code = hasCurrency && !isEmpty(doc?.currency) ? String(doc.currency) : null;
  const legacy = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (legacy && code && CURRENCY_SCALE[code] !== undefined) {
    const [, minus, intPart, fracPart = ''] = legacy;
    const scale = CURRENCY_SCALE[code];
    // Padding `.5` to `.50` is exact — it adds no information and decides nothing. *Truncating*
    // `.567` to `.56` would be a rounding decision, and a display has no business making one, so
    // an over-long fraction is shown verbatim and labelled instead.
    if (fracPart.length <= scale) {
      const sep = SEPARATORS[localeKey(locale)];
      let grouped = '';
      for (let i = 0; i < intPart.length; i++) {
        if (i > 0 && (intPart.length - i) % 3 === 0) grouped += sep.group;
        grouped += intPart[i];
      }
      const padded = fracPart.padEnd(scale, '0');
      const sign = minus ? '−' : '';
      return {
        text: `${sign}${grouped}${padded ? sep.decimal + padded : ''} ${code}`,
        title: `stored as a bare number (${raw}); shown at ${code}'s ${scale}-digit scale. `
          + `Migrate to an exact token like "${intPart}.${padded} ${code}" (FD-1).`,
      };
    }
  }

  return {
    text: code ? `${raw} ${code}` : raw,
    title: `not a canonical money token (expected e.g. "4999.99 EUR" — FD-1); shown verbatim and `
      + `un-rounded, because rounding it here would invent a figure`,
  };
}

/**
 * Minor-unit digits per ISO 4217, for rendering legacy bare numbers only.
 *
 * Deliberately a small local table rather than an import of `runtime/money/money.js`: this is the
 * display path, it needs nothing but a digit count, and the UI's import surface is kept narrow on
 * purpose (test/g-ui.test.js enforces it). Every *arithmetic* path goes through the money module.
 * A currency absent from this table falls through to verbatim rendering, which is the safe answer.
 */
const CURRENCY_SCALE = {
  EUR: 2, CHF: 2, GBP: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2, CZK: 2, HUF: 2,
  RON: 2, BGN: 2, USD: 2, ISK: 0, TRY: 2, JPY: 0, TND: 3, HRK: 2,
};

/** Enough decimals to be exact, without trailing zero noise. */
function trimFloat(n) {
  const s = Math.abs(n).toString();
  return s.includes('e') ? Math.abs(n).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : s;
}

/**
 * ISO-8601 in, human date out. Anything that is not ISO-shaped is returned untouched —
 * guessing a date format is exactly the silent wrong calculation Principle 6 forbids.
 */
export function formatDate(value, { locale = 'de' } = {}) {
  const raw = String(value ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw);
  if (!m) return raw;
  const [, y, mo, d, hh, mm] = m;
  const style = DATE_STYLE[localeKey(locale)] ?? 'iso';
  const date = style === 'iso' ? `${y}-${mo}-${d}` : `${d}${style[3]}${mo}${style[3]}${y}`;
  return hh ? `${date} ${hh}:${mm}` : date;
}

/** Is this value absent for display purposes? (grammar §4.3 `exists` semantics) */
export function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

/**
 * The human handle for one document — used wherever a `reference to <entity>` must be shown
 * as something other than an opaque id. Derived, in this order:
 *   1. a declared `text` field named name/title/label/description;
 *   2. the entity's `## Identified by` fields, joined;
 *   3. the id.
 * @param {object|null} doc
 * @param {EntityDef|null} entityDef
 * @returns {{ text: string, id: string|null, from: 'name'|'key'|'id'|'missing' }}
 */
export function displayLabel(doc, entityDef) {
  if (!doc) return { text: '', id: null, from: 'missing' };
  const id = doc.id === undefined ? null : String(doc.id);
  const fields = entityDef?.fields;
  if (fields) {
    for (const candidate of ['name', 'title', 'label', 'description']) {
      const def = fields.get(candidate);
      if (def && def.type === 'text' && !isEmpty(doc[candidate])) {
        return { text: String(doc[candidate]), id, from: 'name' };
      }
    }
    const key = entityDef.identifiedBy;
    if (Array.isArray(key) && key.length > 0) {
      const parts = key.map((f) => (isEmpty(doc[f]) ? '?' : String(doc[f])));
      if (parts.some((p) => p !== '?')) return { text: parts.join(' · '), id, from: 'key' };
    }
  }
  return { text: id ?? '', id, from: 'id' };
}

/**
 * One cell. Returns structure, never HTML — the DOM layer decides what a `link` looks like,
 * so the same view model drives a table, a detail page, or an export.
 *
 * @param {unknown} value
 * @param {FieldDef} fieldDef
 * @param {{ locale?: string, doc?: object, entityDef?: EntityDef|null,
 *           resolve?: (entity: string, id: string) => object|null,
 *           entityDefOf?: (entity: string) => EntityDef|null }} [ctx]
 * @returns {{ text: string, kind: string, align?: 'right', link?: {entity: string, id: string},
 *            dangling?: boolean, title?: string }}
 */
export function formatValue(value, fieldDef, ctx = {}) {
  const { locale = 'de', doc = null, entityDef = null, resolve = null, entityDefOf = null } = ctx;

  if (isReference(fieldDef)) {
    if (isEmpty(value)) return { text: '—', kind: 'empty' };
    const id = String(value);
    const target = resolve ? resolve(fieldDef.refEntity, id) : null;
    if (!target) {
      // A reference to something that is not there. Shown as such: grammar §4.5 treats an
      // unreachable reference as a refusal, so hiding it in a view would be dishonest.
      return { text: id, kind: 'reference', dangling: true, link: { entity: fieldDef.refEntity, id },
        title: `no ${fieldDef.refEntity} with the id "${id}" exists in this workspace` };
    }
    const label = displayLabel(target, entityDefOf ? entityDefOf(fieldDef.refEntity) : null);
    return { text: label.text || id, kind: 'reference', link: { entity: fieldDef.refEntity, id },
      title: label.text && label.text !== id ? id : undefined };
  }

  if (isEmpty(value)) return { text: '—', kind: 'empty' };

  switch (fieldDef?.type) {
    case 'money':
      return { ...formatMoney(value, { locale, doc, entityDef }), kind: 'money', align: 'right' };
    case 'enum': {
      const allowed = fieldDef.values ?? [];
      const known = allowed.includes(String(value));
      // A stored value outside the declared set is shown, not hidden: it means the document
      // predates the enumeration (Principle 6) or was written by an older runtime. Saying so
      // is the point — silently rendering it as ordinary text is how "delivrd" survived.
      return { text: String(value), kind: 'enum',
        title: known ? undefined : `not one of the declared values (${allowed.join(', ')})`,
        unexpected: !known };
    }
    case 'number':
      return { text: formatNumber(value, { locale }), kind: 'number', align: 'right' };
    case 'date':
      return { text: formatDate(value, { locale }), kind: 'date', title: String(value) };
    case 'boolean':
      return { text: value === true ? 'yes' : value === false ? 'no' : String(value), kind: 'boolean' };
    case 'text':
      return { text: String(value), kind: 'text' };
    default:
      return { text: String(value), kind: 'unknown',
        title: `field type ${JSON.stringify(fieldDef?.type ?? null)} is not one of ${SCALAR_TYPES.join(', ')}` };
  }
}

/**
 * Which columns a list view shows, derived from the declaration in a fixed, documented order
 * so that two people looking at the same entity see the same table:
 *   id, then a name-ish text field, then `## Identified by` fields, then required fields,
 *   then the rest in declaration order — capped, because a 40-column table helps nobody.
 * @param {EntityDef} entityDef
 * @param {{ max?: number }} [opts]
 * @returns {FieldDef[]}
 */
export function columnsFor(entityDef, { max = 7 } = {}) {
  const out = [ID_FIELD];
  if (!entityDef?.fields) return out;
  const declared = [...entityDef.fields.values()];
  const taken = new Set(['id']);
  const push = (def) => {
    if (!def || taken.has(def.name)) return;
    taken.add(def.name);
    out.push(def);
  };
  for (const candidate of ['name', 'title', 'label']) {
    const def = entityDef.fields.get(candidate);
    if (def?.type === 'text') { push(def); break; }
  }
  for (const f of entityDef.identifiedBy ?? []) push(entityDef.fields.get(f));
  for (const def of declared) if (def.required) push(def);
  for (const def of declared) push(def);
  return out.slice(0, Math.max(1, max));
}

/** Every declared field, in declaration order — what a detail page and a form show. */
export function allFields(entityDef) {
  return entityDef?.fields ? [...entityDef.fields.values()] : [];
}

/** 'net-amount' -> 'Net amount'; 'vat-id' -> 'VAT ID'. Typography only, never semantics. */
export function labelFor(name) {
  const words = String(name ?? '').split(/[-_]/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((w, i) => (ACRONYMS.has(w.toLowerCase())
      ? w.toUpperCase()
      : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Decode one form control back into a document value.
 *
 * This is decoding, not validation. Whether a value is *acceptable* is the operating model's
 * question, never this file's — so an empty optional field becomes `undefined` (absent) and
 * the kernel gets to refuse a missing required field with the declaration quoted. The one
 * thing we do reject here is a number field that does not hold a number, because there is no
 * value to send at all.
 *
 * @returns {{ ok: true, value: unknown, absent?: boolean } | { ok: false, reason: string }}
 */
export function coerceInput(raw, fieldDef) {
  if (fieldDef?.type === 'boolean') return { ok: true, value: raw === true || raw === 'true' };
  const text = raw === null || raw === undefined ? '' : String(raw).trim();
  if (text === '') return { ok: true, value: undefined, absent: true };
  if (fieldDef?.type === 'number' || fieldDef?.type === 'money') {
    // Accept a comma as the decimal separator, because a German keyboard produces one.
    const n = Number(text.replace(',', '.'));
    if (!Number.isFinite(n)) return { ok: false, reason: `"${text}" is not a number` };
    return { ok: true, value: n };
  }
  return { ok: true, value: text };
}

/** The value a fresh form starts with, per declared type. */
export function emptyValue(fieldDef) {
  return fieldDef?.type === 'boolean' ? false : '';
}
