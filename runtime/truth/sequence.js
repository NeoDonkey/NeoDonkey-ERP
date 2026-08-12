// runtime/truth/sequence.js — legally gapless document numbers (FD-6).
//
// GoBD, and its equivalent in every EU member state, requires invoice numbers to be sequential
// and gapless. v0.1 derived a number from `index.all(entity).length` — a count of existing
// documents. That is wrong in three separate ways, and each of them is a finding an auditor
// makes in ten seconds:
//
//   1. Delete document RE-0007 and the next number issued is RE-0007 again. Two invoices, one
//      number, and the second one silently overwrites nothing — it just collides.
//   2. Two peers holding the same 6 documents both issue number 7.
//   3. A number is "issued" by reading, so a refused commit can consume nothing and a successful
//      one can consume the same thing twice. Issuance was not an event at all.
//
// ---------------------------------------------------------------------------------------------
// The design: a sequence is a document, and allocation is part of the consuming commit.
// ---------------------------------------------------------------------------------------------
//
// A sequence lives at `documents/document-number-sequence/<series>-<period>.json`:
//
//     { "entity": "document-number-sequence", "id": "invoice-2027",
//       "series": "invoice", "period": "2027", "pattern": "RE-{period}-{0000}",
//       "next": 42, "last-issued": "RE-2027-0041" }
//
// `allocate()` is a PURE function: it returns the number it would issue and the sequence document
// as it would then look. Nothing is written. The kernel stages that document as one more Change
// in the *same* commit as the document consuming the number. Therefore:
//
//   * A number is never issued without being used — the allocation only exists as a commit, and
//     the commit contains the consuming document too. One commit, atomic by nature (Appendix VIII).
//   * A number is never used without being issued — the consuming document and the bumped
//     sequence are the same commit; you cannot have one without the other.
//   * A refused commit consumes nothing, because a refusal writes nothing anywhere (there is no
//     "reserve then release" step to get wrong, and so no reservation to leak).
//   * A crash between allocation and commit cannot lose a number, because there is no between:
//     allocation is not a state, it is a value computed on the way into a single write.
//
// Gaplessness is also *checkable from the git history without trusting us*: every allocating
// commit carries a `NeoDonkey-Sequence:` trailer inside the signed payload, so
// `git log --format=%B | grep NeoDonkey-Sequence` reconstructs the issuance chain and any gap or
// duplicate is visible to `sort | uniq -d`. `auditIssuance()` below is the same check in code.
//
// ---------------------------------------------------------------------------------------------
// Cross-peer: what is settled and what is not.
// ---------------------------------------------------------------------------------------------
//
// Appendix VIII governs: "for scarce resources (physical stock, **unique invoice numbers**,
// cash-account balances), one peer per resource type is declared the *authoritative* peer." A
// number series is exactly that resource. So the rule is: allocation for a series happens on the
// series' authoritative peer, and other peers accept its ordering.
//
// That rule now exists in code, in two halves that must be read together:
//
//   * `assertAuthoritative()` at the end of this file answers "may this peer issue at all?" — from
//     the ELECTED holder of the current term when an `authorityMember` is passed, and from the
//     static declaration when it is not. It is called on every allocation.
//   * `numberAllocator()` at the end of this file answers "and did a majority agree?" — it proposes
//     the value to the series' electors and issues nothing until a quorum has acked it. Leadership
//     alone is not enough: a peer can believe it leads and be wrong, and only the majority ack
//     makes "number 7 was issued once" a statement about every peer rather than about this one.
//
// What is proven and what is not, exactly: the mechanism is exercised over the loopback `PeerLink`
// (runtime/live/session.js) in `test/atom-numbering.test.js`. It has never run over a real network,
// because the WebRTC transport is still unfinished (COMPROMISES #4). It is not reachable from
// `runtime/kernel.js` yet either — the kernel calls `assertAuthoritative(decl, nodeId)` with two
// arguments, which is byte-for-byte the v1.0 behaviour, and passing an authority member requires
// live peers to attach links to. Both are recorded in COMPROMISES #19.
//
// And one limitation that is not a gap but an answer: an OFFLINE peer cannot issue a legally gapless
// number, so the document queues (`numberingQueue()`). See the long note above `numberingQueue`.
//
// No `node:*`, no dependencies, no clock: the period comes from the consuming document's own
// declared date field, never from `Date.now()` (non-negotiable #5).

/** The entity a sequence document belongs to. One name, used by the kernel and the read index. */
export const SEQUENCE_ENTITY = 'document-number-sequence';

/** The commit trailer that makes the issuance chain auditable in `git log`. */
export const SEQUENCE_TRAILER_KEY = 'NeoDonkey-Sequence';

/**
 * The commit trailer that records WHICH MAJORITY stood behind an issuance (Appendix VIII).
 *
 * Added in Wave 2, when the cross-peer half of FD-6 landed. The single-peer trailer above proves
 * *what* was issued; this one proves *that no second peer could have issued it*, because it names
 * the term and the electors whose acks the issuer held. Both are inside the signed payload, so
 * `git log --format=%B | grep NeoDonkey-Sequence` reconstructs the whole story and neither line
 * can be edited after the fact without breaking the commit signature.
 */
export const SEQUENCE_QUORUM_TRAILER_KEY = 'NeoDonkey-Sequence-Quorum';

/** How a series resets. Declared, never inferred. */
const RESETS = new Set(['never', 'year']);

/**
 * @typedef {{ series:string, entity:string, pattern:string, reset:'never'|'year',
 *             dateField:string|null, start:number, authoritativePeer:string|null,
 *             source:string }} SeriesDeclaration
 * @typedef {{ id:string, entity:string, series:string, period:string, pattern:string,
 *             next:number, 'last-issued':string|null }} SequenceDoc
 */

// ---------------------------------------------------------------------------------------------
// declarations
// ---------------------------------------------------------------------------------------------

/**
 * Normalise one series declaration, refusing anything we would otherwise have to guess about.
 *
 * `pattern` is a literal with two kinds of placeholder:
 *   `{period}`  the reset period — "2027" for a yearly series, "" for `reset: never`
 *   `{0000}`    the counter, zero-padded to the number of zeros written
 * so `RE-{period}-{0000}` yields `RE-2027-0001` — FD-6's own example, spelled by the model
 * rather than by this file.
 *
 * @param {string} series
 * @param {object} raw
 * @param {string} source where the declaration came from, for diagnostics
 * @returns {{ declaration:SeriesDeclaration|null, errors:string[] }}
 */
export function normalizeSeries(series, raw, source) {
  const errors = [];
  const fail = (m) => { errors.push(`${source}: ${m}`); };

  if (typeof series !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(series)) {
    fail(`${JSON.stringify(series)} is not a usable series name (lower-case words joined by hyphens).`);
  }
  const entity = raw.entity ?? raw.for ?? null;
  if (typeof entity !== 'string' || entity === '') {
    fail(`series "${series}" does not say which kind of document it numbers ("entity": "invoice").`);
  }
  const pattern = raw.pattern;
  if (typeof pattern !== 'string' || pattern === '') {
    fail(`series "${series}" has no "pattern" (for example "RE-{period}-{0000}").`);
  } else {
    const counters = pattern.match(/\{0+\}/g) || [];
    if (counters.length !== 1) {
      fail(`the pattern ${JSON.stringify(pattern)} must contain exactly one counter placeholder `
        + 'like {0000}; it has ' + counters.length + '.');
    }
    const unknown = pattern.replace(/\{0+\}/g, '').match(/\{[^}]*\}/g) || [];
    for (const u of unknown) {
      if (u !== '{period}') {
        fail(`the pattern ${JSON.stringify(pattern)} contains ${u}, which this runtime does not `
          + 'know. Known placeholders: {period} and a counter such as {0000}.');
      }
    }
  }
  const reset = raw.reset ?? 'never';
  if (!RESETS.has(reset)) {
    fail(`series "${series}" resets "${reset}", which is not one of ${[...RESETS].join(', ')}.`);
  }
  const dateField = raw['date-field'] ?? raw.dateField ?? null;
  if (reset === 'year' && (typeof dateField !== 'string' || dateField === '')) {
    fail(`series "${series}" resets every year, so it must name the date field the year comes `
      + 'from ("date-field": "invoice-date"). Taking it from the system clock would make the same '
      + 'business event produce different numbers on two peers.');
  }
  if (reset === 'never' && typeof pattern === 'string' && pattern.includes('{period}')) {
    fail(`series "${series}" never resets, so {period} in its pattern would always be empty. `
      + 'Either give it "reset": "year" or drop {period} from the pattern.');
  }
  const start = raw.start ?? 1;
  if (!Number.isInteger(start) || start < 1) {
    fail(`series "${series}" starts at ${JSON.stringify(start)}; a gapless sequence starts at a `
      + 'positive whole number, and 1 unless a predecessor system forces otherwise.');
  }
  if (errors.length) return { declaration: null, errors };
  return {
    declaration: {
      series, entity, pattern, reset, dateField, start,
      authoritativePeer: raw['authoritative-peer'] ?? raw.authoritativePeer ?? null,
      source,
    },
    errors,
  };
}

/**
 * Read every series declaration a workspace has, from the model first and the recorded workspace
 * settings second.
 *
 * The model is the intended home (FD-6: "declared in the model rather than hardcoded"). Grammar
 * v1 has no section for it and `parse.js` refuses unknown sections, so v1.0 also accepts the
 * declarations from the workspace's own settings document — data in the repo, signed into the
 * genesis commit, not a constant in the runtime. Both shapes are read here so that the day the
 * grammar grows a `## Numbered by` section, nothing above this function changes.
 *
 * @param {{ entities?:Map<string,object>, sequences?:object }|null} model
 * @param {object|null} settings
 * @returns {{ series:Map<string,SeriesDeclaration>, errors:string[] }}
 */
export function collectSeries(model, settings) {
  /** @type {Map<string,SeriesDeclaration>} */
  const series = new Map();
  const errors = [];

  const take = (name, raw, source) => {
    const { declaration, errors: errs } = normalizeSeries(name, raw, source);
    errors.push(...errs);
    if (!declaration) return;
    if (series.has(name)) {
      errors.push(`${source}: the series "${name}" is already declared in ${series.get(name).source}.`);
      return;
    }
    series.set(name, declaration);
  };

  // 1. from the model: an entity declaring its own numbering (grammar v2 and later).
  if (model && model.entities instanceof Map) {
    for (const [entityName, def] of model.entities) {
      const raw = def && (def.numbering ?? def.numberedBy ?? def['numbered by']);
      if (!raw) continue;
      take(raw.series ?? entityName, { entity: entityName, ...raw },
        `${def.source ? def.source.file : `operating-model/information/${entityName}.md`}`);
    }
  }
  // 2. from the model as a whole, if a future grammar puts them there.
  if (model && model.sequences && typeof model.sequences === 'object') {
    for (const [name, raw] of Object.entries(model.sequences)) take(name, raw, 'operating-model');
  }
  // 3. from the workspace settings document (v1.0's interim home; see the note above).
  if (settings && settings.sequences && typeof settings.sequences === 'object') {
    for (const [name, raw] of Object.entries(settings.sequences)) take(name, raw, 'neodonkey.json');
  }
  return { series, errors };
}

// ---------------------------------------------------------------------------------------------
// allocation
// ---------------------------------------------------------------------------------------------

/**
 * Which period does this document fall in? Derived from the document's own declared date field,
 * so the same business event yields the same number on every peer, forever.
 * @param {SeriesDeclaration} decl
 * @param {object} doc
 * @returns {{ period:string|null, error:string|null }}
 */
export function periodOf(decl, doc) {
  if (decl.reset === 'never') return { period: '', error: null };
  const value = doc ? doc[decl.dateField] : undefined;
  if (value === undefined || value === null || value === '') {
    return {
      period: null,
      error: `this ${decl.entity} has no ${decl.dateField}, and the "${decl.series}" number series `
        + `resets every year — so there is no way to know which year's sequence it belongs to. `
        + `Fill in ${decl.dateField} (declared in ${decl.source}).`,
    };
  }
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(value));
  if (!m) {
    return {
      period: null,
      error: `${decl.dateField} is ${JSON.stringify(String(value))}, which is not a date of the `
        + 'form YYYY-MM-DD, so the year of the number series cannot be read from it.',
    };
  }
  return { period: m[1], error: null };
}

/** The id of the sequence document for a series and period. Deterministic, no clock, no counter. */
export function sequenceId(series, period) {
  return period === '' ? series : `${series}-${period}`;
}

/**
 * Render a number.
 * @param {SeriesDeclaration} decl @param {string} period @param {number} value
 */
export function formatNumber(decl, period, value) {
  return decl.pattern.replace(/\{0+\}/g, (m) => {
    const width = m.length - 2;
    const s = String(value);
    return s.length >= width ? s : '0'.repeat(width - s.length) + s;
  }).replace(/\{period\}/g, period);
}

/**
 * The pure allocation step. Nothing is written; the caller stages `sequenceAfter` into the same
 * commit as the document that consumes `number`.
 *
 * @param {{ declaration:SeriesDeclaration, period:string, current:SequenceDoc|null }} o
 * @returns {{ number:string, value:number, sequenceBefore:SequenceDoc|null,
 *             sequenceAfter:SequenceDoc, op:'create'|'update' }}
 */
export function allocate(o) {
  const { declaration: decl, period, current } = o;
  const id = sequenceId(decl.series, period);

  if (current && current.next !== undefined && !Number.isInteger(current.next)) {
    throw new Error(`sequence ${id} has a non-integer "next" (${JSON.stringify(current.next)}); `
      + 'refusing to guess the next document number.');
  }
  if (current && current.pattern !== undefined && current.pattern !== decl.pattern) {
    // Changing the shape of an existing series mid-stream produces numbers an auditor cannot
    // order. Refuse rather than renumber.
    throw new Error(`the "${decl.series}" series has already issued numbers shaped `
      + `"${current.pattern}" and the model now says "${decl.pattern}". A number series cannot `
      + 'change shape once it has issued a number — start a new series instead.');
  }

  const value = current ? current.next : decl.start;
  const number = formatNumber(decl, period, value);
  const after = {
    id, entity: SEQUENCE_ENTITY,
    series: decl.series,
    period,
    pattern: decl.pattern,
    next: value + 1,
    'last-issued': number,
  };
  return {
    number, value,
    sequenceBefore: current ? { ...current } : null,
    sequenceAfter: after,
    op: current ? 'update' : 'create',
  };
}

/**
 * The commit trailer for an allocation. Inside the signed payload, so the issuance chain is as
 * tamper-evident as the documents themselves.
 * @param {SeriesDeclaration} decl @param {string} period @param {number} value
 * @param {string} entity @param {string} id
 */
export function sequenceTrailer(decl, period, value, entity, id) {
  return `${SEQUENCE_TRAILER_KEY}: ${decl.series} ${period === '' ? '-' : period} ${value} ${entity}/${id}`;
}

/** Read the trailers back out of a commit message. @returns {{series:string,period:string,value:number,entity:string,id:string}[]} */
export function readSequenceTrailers(message) {
  const out = [];
  for (const line of String(message).split('\n')) {
    if (!line.startsWith(`${SEQUENCE_TRAILER_KEY}: `)) continue;
    const [series, period, value, target] = line.slice(SEQUENCE_TRAILER_KEY.length + 2).split(' ');
    const slash = (target || '').indexOf('/');
    out.push({
      series,
      period: period === '-' ? '' : period,
      value: Number(value),
      entity: slash < 0 ? target : target.slice(0, slash),
      id: slash < 0 ? '' : target.slice(slash + 1),
    });
  }
  return out;
}

/**
 * The quorum trailer for an allocation: the term it was issued in and the electors that acked it.
 * @param {SeriesDeclaration} decl @param {string} period @param {number} value
 * @param {{term:number, leader:string, acks:{voter:string}[]}} evidence
 */
export function sequenceQuorumTrailer(decl, period, value, evidence) {
  const voters = [...new Set((evidence.acks || []).map((a) => a.voter))].sort().join(',');
  return `${SEQUENCE_QUORUM_TRAILER_KEY}: ${decl.series} ${period === '' ? '-' : period} ${value} `
    + `term=${evidence.term} by=${evidence.leader} acks=${voters}`;
}

/** Read the quorum trailers back out of a commit message. */
export function readSequenceQuorumTrailers(message) {
  const out = [];
  for (const line of String(message).split('\n')) {
    if (!line.startsWith(`${SEQUENCE_QUORUM_TRAILER_KEY}: `)) continue;
    const [series, period, value, term, by, acks] =
      line.slice(SEQUENCE_QUORUM_TRAILER_KEY.length + 2).split(' ');
    out.push({
      series,
      period: period === '-' ? '' : period,
      value: Number(value),
      term: Number(String(term || 'term=0').slice(5)),
      leader: String(by || 'by=').slice(3),
      acks: String(acks || 'acks=').slice(5).split(',').filter((v) => v !== ''),
    });
  }
  return out;
}

/** The resource key an authority declaration uses for a number series (see authority.js). */
export function seriesResourceKey(series) {
  return `sequence:${series}`;
}

/** The numbering unit inside that resource: one running counter per reset period. */
export function numberingUnit(series, period) {
  return `${series}/${period === '' ? '-' : period}`;
}

/**
 * The audit: is the issuance chain gapless, and did any number get issued twice?
 *
 * Deliberately computed from the *commit history*, not from the sequence document — a sequence
 * document that says `next: 1000` proves nothing on its own. This is the check a Betriebsprüfer
 * actually wants, and it runs against bytes we signed but did not get to choose after the fact.
 *
 * `retired` closes the one hole cross-peer numbering cannot close by arithmetic. If the issuing
 * peer dies between the majority acking value N and the commit that consumes it reaching any other
 * peer, no successor can tell "N was never committed" from "N was committed on a disk that has not
 * synced yet". Reissuing N risks two invoices with one number; retiring N leaves a gap. FD-6 and a
 * Betriebsprüfer both prefer the gap, provided it is *documented* — so the successor commits a
 * signed retirement record (a storno, see reservation.js) and passes those values here. A retired
 * number is an accounted-for gap, not a defect. An UNdocumented gap still is one.
 *
 * @param {{series:string,period:string,value:number,entity:string,id:string}[]} issuances
 * @param {((series:string)=>number)|number} [startOf] where each series is declared to start
 * @param {Iterable<string|{series:string,period:string,value:number}>} [retired]
 * @returns {{ ok:boolean, problems:string[], retired:string[],
 *             perSeries:Map<string,{count:number,min:number,max:number}> }}
 */
export function auditIssuance(issuances, startOf = 1, retired = []) {
  const firstOf = typeof startOf === 'function' ? startOf : () => startOf;
  /** Retired numbers, as `<series> <period> <value>`. */
  const retiredKeys = new Set();
  for (const r of retired || []) {
    retiredKeys.add(typeof r === 'string' ? r : `${r.series} ${r.period} ${r.value}`);
  }
  /** @type {Map<string, number[]>} */
  const buckets = new Map();
  for (const i of issuances) {
    const key = `${i.series}${i.period}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i.value);
  }
  const problems = [];
  const perSeries = new Map();
  for (const [key, values] of buckets) {
    const [series, period] = key.split('');
    const label = period === '' ? series : `${series} ${period}`;
    values.sort((a, b) => a - b);
    perSeries.set(label, { count: values.length, min: values[0], max: values[values.length - 1] });
    const isRetired = (v) => retiredKeys.has(`${series} ${period} ${v}`);
    const start = firstOf(series);
    if (values[0] !== start) {
      // A retired first number is a documented gap at the head, not a defect.
      const missing = [];
      for (let v = start; v < values[0]; v++) if (!isRetired(v)) missing.push(v);
      if (missing.length) {
        problems.push(`${label} starts at ${values[0]}, not at ${start}.`);
      }
    }
    for (let i = 1; i < values.length; i++) {
      if (values[i] === values[i - 1]) {
        problems.push(`${label} issued number ${values[i]} twice.`);
      } else if (values[i] !== values[i - 1] + 1) {
        const missing = [];
        for (let v = values[i - 1] + 1; v < values[i]; v++) if (!isRetired(v)) missing.push(v);
        if (missing.length) {
          problems.push(`${label} jumps from ${values[i - 1]} to ${values[i]} — `
            + `${missing.length} number(s) missing and not accounted for (${missing.join(', ')}).`);
        }
      }
    }
  }
  return { ok: problems.length === 0, problems, retired: [...retiredKeys].sort(), perSeries };
}

/**
 * Appendix VIII's authoritative-peer rule.
 *
 * ---------------------------------------------------------------------------------------------
 * What changed in Wave 2, and what did not
 * ---------------------------------------------------------------------------------------------
 *
 * v1.0-Wave-1 shipped this as a static check with no election behind it, and said so: "two peers
 * that both believe they are authoritative will both issue number 7 while disconnected, and the
 * collision is detectable afterwards but not preventable" (COMPROMISES #19).
 *
 * The third argument is what closes that. Pass the `authorityMember` for this workspace (see
 * runtime/truth/authority.js) and the check becomes:
 *
 *   * is an authority declared for `sequence:<series>` at all? If yes, the *elected holder of the
 *     current term* decides — not a name frozen in a settings file — so a peer that was
 *     authoritative yesterday and has been deposed refuses today;
 *   * do the static declaration and the elected authority disagree? Then refuse both, because two
 *     declarations of one authority is the one split-brain no protocol can resolve;
 *   * is the holder unknown (an election in progress, a fresh partition)? Refuse. An ambiguous
 *     authority is a refusal, never an optimistic guess — a delay costs a minute, a duplicate
 *     invoice number costs an audit.
 *
 * WITHOUT the third argument the behaviour is byte-for-byte what it was, because the kernel calls
 * this with two arguments and 46 integrity tests depend on that. Wiring the third argument in is
 * one line in `runtime/kernel.js` and is reported as such rather than done here (that file belongs
 * to another agent).
 *
 * Note what this function does NOT do: it does not check that a *majority* stands behind the
 * issuance. Leadership alone is not enough — a peer can believe it leads and be wrong. See
 * `numberAllocator()` below, which is the path that actually issues a number.
 *
 * @param {SeriesDeclaration} decl
 * @param {string} thisPeer
 * @param {{ keys():string[], isLeader(key:string):boolean, leaderOf(key:string):string|null,
 *           term(key:string):number, declaration(key:string):object }} [authority]
 * @returns {string|null} a refusal, or null
 */
export function assertAuthoritative(decl, thisPeer, authority = null) {
  const key = seriesResourceKey(decl.series);
  const declared = authority && authority.keys().includes(key)
    ? authority.declaration(key) : null;

  if (declared) {
    // Two declarations of one authority. Refuse both rather than pick one.
    if (decl.authoritativePeer && decl.authoritativePeer !== declared.peer) {
      return `"${decl.series}" has two conflicting declarations of who issues its numbers: `
        + `${decl.source} says ${decl.authoritativePeer}, ${declared.source} says ${declared.peer}. `
        + 'Appendix VIII gives a scarce resource exactly one authoritative peer, so this peer '
        + 'issues nothing until the company says which of the two it meant.';
    }
    const holder = authority.leaderOf(key);
    if (holder === null) {
      return `nobody currently holds the authority to issue "${decl.series}" numbers `
        + `(declared: ${declared.peer}, electors: ${declared.electors.join(', ')}). An election is `
        + 'in progress or this peer is cut off from the majority. A document number issued while '
        + 'the authority is ambiguous is a number two peers may both believe they own, so this '
        + 'peer refuses and the request waits.';
    }
    if (!authority.isLeader(key)) {
      return `numbers in the "${decl.series}" series are issued by ${holder} (term `
        + `${authority.term(key)}), not by ${thisPeer}. A gapless sequence has exactly one issuer `
        + `per series (Appendix VIII: one authoritative peer per scarce resource).\n`
        + `  ${thisPeer} may still record the business event — the document waits in the numbering `
        + `queue until ${holder} issues its number, or until this peer wins an election among `
        + `${declared.electors.join(', ')}.`;
    }
    return null;
  }

  if (!decl.authoritativePeer) return null;
  if (decl.authoritativePeer === thisPeer) return null;
  return `numbers in the "${decl.series}" series are issued by ${decl.authoritativePeer}, not by `
    + `${thisPeer}. A gapless sequence has exactly one issuer per series (Appendix VIII: one `
    + 'authoritative peer per scarce resource), so this peer refuses to issue one rather than '
    + 'create a number two peers both believe they own.';
}

// ---------------------------------------------------------------------------------------------
// cross-peer issuance (COMPROMISES #19)
// ---------------------------------------------------------------------------------------------
//
// The tension, stated plainly rather than engineered around:
//
//   * Strict gaplessness needs COORDINATION. "Number 7 was issued exactly once" is a statement
//     about every peer at once, and no peer can make it alone.
//   * Offline operation needs INDEPENDENCE. Principle 2: a peer keeps working with no network.
//
// Both cannot hold for the same document at the same moment, and the honest resolution is not a
// clever protocol — it is an admission:
//
//   **An offline peer cannot issue a legally gapless invoice number. It records the business event
//   and the document waits in a queue until the authority for that series can be reached, or until
//   this peer wins an election among the declared electors.**
//
// That is a real limitation and it is the correct one. The alternative — issue optimistically and
// reconcile later — puts two invoices with number 7 in front of a Betriebsprüfer, and no amount of
// subsequent renumbering makes that undone, because the first copy is already at the customer.
//
// Everything else a peer does stays offline-capable. Only the numbering waits, and it waits
// visibly: `numberingQueue()` is the queue, its `reason` is the sentence a user sees, and
// `resume()` drains it in order once this peer may issue again.
//
// The other half of the promise — that a number is never issued twice — is enforced by
// `authorityMember`'s monotonic rule: a value is proposed to the electors and a MAJORITY has to ack
// it before the consuming commit is written. Two disjoint majorities of one fixed elector set do
// not exist, so two peers cannot both have number 7 acked. `highestWatermark()` is how a fresh
// authority learns the floor it must start above.

/**
 * The queue of business events waiting for a document number.
 *
 * FIFO on purpose: a gapless sequence must issue in the order the queue was joined, or the numbers
 * and the events they belong to tell two different stories about what happened first.
 *
 * `ref` identifies the waiting business event (`invoice/INV-2027-0001`, a draft id — whatever the
 * caller uses). Joining twice with the same ref does not queue twice, so a retry is safe.
 *
 * An entry remembers the `value` and `proposal` id of an attempt that failed, and that is not an
 * optimisation — it is what stops a retry from burning a number. A peer that proposed 7 to electors
 * it could not reach does not know whether they acked; if the retry asked for 8 instead, every
 * failed attempt would leave a documented gap behind it. Re-proposing the SAME value under the SAME
 * id is idempotent for an elector that already acked it and new for one that did not.
 */
export function numberingQueue() {
  /** @type {{ref:string, period:string, reason:string, consumer:object|null, attempts:number,
   *           value:number|null, proposal:string|null}[]} */
  const items = [];
  const find = (ref) => items.findIndex((i) => i.ref === ref);
  return {
    size: () => items.length,
    items: () => items.map((i) => ({ ...i })),
    head: () => (items.length ? { ...items[0] } : null),
    positionOf: (ref) => find(ref) + 1,
    /**
     * @param {{ref:string, period:string, reason:string, consumer?:object|null,
     *           value?:number|null, proposal?:string|null}} entry
     */
    enqueue(entry) {
      if (typeof entry.ref !== 'string' || entry.ref === '') {
        throw new Error('numberingQueue: a waiting document needs a ref, or it cannot be resumed.');
      }
      const at = find(entry.ref);
      if (at >= 0) {
        items[at].reason = entry.reason;
        items[at].attempts += 1;
        // Never forget a value that has been out with the electors; only ever learn one.
        if (Number.isInteger(entry.value)) {
          items[at].value = entry.value;
          items[at].proposal = entry.proposal ?? items[at].proposal;
        }
        return { ...items[at], position: at + 1, queued: false };
      }
      items.push({
        ref: entry.ref, period: entry.period, reason: entry.reason,
        consumer: entry.consumer ?? null, attempts: 1,
        value: Number.isInteger(entry.value) ? entry.value : null,
        proposal: entry.proposal ?? null,
      });
      return { ...items[items.length - 1], position: items.length, queued: true };
    },
    remove(ref) {
      const at = find(ref);
      if (at < 0) return false;
      items.splice(at, 1);
      return true;
    },
  };
}

/**
 * The floor a peer must start issuing above.
 *
 * Two sources, and the higher one wins: this peer's own sequence document, and the highest value
 * any majority has ever acknowledged as issued (`authorityMember.highestWatermark`). A successor
 * whose repository has not yet received the commits the old authority wrote would otherwise restart
 * inside numbers that are already on invoices.
 *
 * When the floor is raised, the values in between are numbers a majority acked whose consuming
 * commits this peer has not seen. They can never be reissued, so they are gaps — and a gap is
 * acceptable to FD-6 and to a Betriebsprüfer only if it is *documented*. `retire` is that list, for
 * the caller to commit as retirement records and pass to `auditIssuance()`.
 *
 * @param {SeriesDeclaration} decl
 * @param {SequenceDoc|null} current
 * @param {number|null} watermark
 * @returns {{next:number, raisedFrom:number|null, retire:number[]}}
 */
export function issuanceFloor(decl, current, watermark) {
  const fromDoc = current && Number.isInteger(current.next) ? current.next : decl.start;
  if (!Number.isInteger(watermark) || watermark + 1 <= fromDoc) {
    return { next: fromDoc, raisedFrom: null, retire: [] };
  }
  const retire = [];
  for (let v = fromDoc; v <= watermark; v++) retire.push(v);
  return { next: watermark + 1, raisedFrom: fromDoc, retire };
}

/**
 * Issuing a document number across peers: the queue, the majority, and the trailers.
 *
 * Two phases, deliberately, and neither of them is a promise:
 *
 *   `request()` → `{state:'queued'}`   this peer may not issue, or something is ahead of it in the
 *                                      queue. The document waits. This is the offline answer.
 *                → `{state:'proposed'}` the value is out with the electors. Nothing is issued yet.
 *   `settle()`  → `{state:'issued'}`   a majority acked it. The caller now writes ONE commit
 *                                      containing the consuming document, the bumped sequence
 *                                      document and both trailers.
 *                → `{state:'queued'}`   no majority. Nothing was issued and the document waits.
 *
 * A promise would have to either block forever under a partition or invent a timeout; a verdict
 * that says "no majority yet, so no" is the same discipline `authorityMember` uses throughout.
 *
 * @param {{ declaration:SeriesDeclaration, peer:string,
 *           authority?:{ keys():string[], isLeader(key:string):boolean,
 *                        leaderOf(key:string):string|null, term(key:string):number,
 *                        declaration(key:string):object, highestWatermark(key:string,unit:string):number|null,
 *                        watermarkOf?(key:string,unit:string):{value:number,claim:string}|null,
 *                        propose(key:string, proposal:object):{verdict():object} }|null,
 *           queue?:ReturnType<typeof numberingQueue> }} o
 */
export function numberAllocator(o) {
  const decl = o.declaration;
  const peer = o.peer;
  const authority = o.authority ?? null;
  const key = seriesResourceKey(decl.series);
  const queue = o.queue ?? numberingQueue();
  /** one issuance in flight per period; a second would allocate the same value twice */
  const inflight = new Map();

  const wait = (ref, period, reason, consumer, attempt = null) => {
    const q = queue.enqueue({
      ref, period, reason, consumer,
      value: attempt ? attempt.value : null,
      proposal: attempt ? attempt.proposal : null,
    });
    return {
      state: 'queued', number: null, value: null, reason,
      position: q.position, queueSize: queue.size(),
    };
  };

  /**
   * @param {{ ref:string, period:string, current:object|null, stamp:object,
   *           consumer?:{entity:string, id:string}|null }} r
   */
  function request(r) {
    const period = r.period;
    const refusal = assertAuthoritative(decl, peer, authority);
    if (refusal) return wait(r.ref, period, refusal, r.consumer ?? null);

    const pending = inflight.get(period);
    if (pending && pending.ref !== r.ref) {
      return wait(r.ref, period, `${pending.ref} is already having number ${pending.value} of the `
        + `"${decl.series}" series confirmed by the electors of "${key}". A gapless sequence has one `
        + 'issuance in flight at a time, so this document waits its turn.', r.consumer ?? null);
    }
    const head = queue.head();
    if (head && head.ref !== r.ref) {
      return wait(r.ref, period, `${queue.size()} document(s) have been waiting longer for a `
        + `"${decl.series}" number, starting with ${head.ref}. A gapless sequence issues in the `
        + 'order the queue was joined, so this document takes its place behind them.',
      r.consumer ?? null);
    }

    const unit = numberingUnit(decl.series, period);
    const known = authority && authority.watermarkOf ? authority.watermarkOf(key, unit) : null;
    const watermark = known ? known.value
      : (authority ? authority.highestWatermark(key, unit) : null);
    const floor = issuanceFloor(decl, r.current, watermark);

    // A previous attempt for THIS document may already have gone out to the electors. Re-propose
    // exactly that value under exactly that id (see `numberingQueue`) when either the floor has not
    // moved past it, or the thing that moved the floor IS that same attempt — a leader acks its own
    // proposal as it makes it, so its own unconfirmed value must not push it on to the next number.
    // Only a value a DIFFERENT issuance put on record burns the sticky one, and the floor has
    // already listed that for retirement.
    const waiting = queue.items().find((i) => i.ref === r.ref);
    const sticky = waiting && Number.isInteger(waiting.value)
      && (waiting.value >= floor.next || (known && known.claim === waiting.proposal))
      ? waiting : null;
    const next = sticky ? sticky.value : floor.next;
    // The floor's retirement list was computed as if every value below it were lost. When the value
    // we are re-proposing is one of them, it is not lost — we are about to issue it — so it comes
    // off the list. Anything BELOW it was put on record by some other issuance and stays.
    const retire = sticky ? floor.retire.filter((v) => v < sticky.value) : floor.retire;
    const raisedFrom = retire.length ? floor.raisedFrom : null;

    const base = r.current
      ? { ...r.current, next }
      : { id: sequenceId(decl.series, period), entity: SEQUENCE_ENTITY, series: decl.series,
        period, pattern: decl.pattern, next, 'last-issued': null };
    const allocation = allocate({ declaration: decl, period, current: base });
    // `allocate` was handed a synthetic `current` when the floor was raised, so keep the REAL
    // predecessor in the result — a caller staging a document must not be told it is updating one
    // that does not exist.
    allocation.sequenceBefore = r.current ? { ...r.current } : null;
    allocation.op = r.current ? 'update' : 'create';

    if (!authority) {
      // No authority declared for this series at all. Single-peer issuance, exactly as v1.0 shipped
      // it, and `assertAuthoritative` above has already refused the case where one IS declared and
      // this peer is not it.
      return {
        state: 'issued', ...allocation, retire, raisedFrom,
        evidence: null, trailers: trailersFor(period, allocation.value, r.consumer, null),
        reason: null,
      };
    }
    const proposal = {
      id: sticky ? sticky.proposal
        : `${decl.series}/${period === '' ? '-' : period}#${allocation.value}`,
      unit,
      watermark: allocation.value,
      by: peer,
      stamp: r.stamp,
    };
    const round = authority.propose(key, proposal);
    const state = {
      state: 'proposed', ref: r.ref, period, round, proposal,
      consumer: r.consumer ?? null, ...allocation, retire, raisedFrom, reason: null,
    };
    inflight.set(period, { ref: r.ref, value: allocation.value });
    return state;
  }

  /**
   * Read the electors' verdict on a proposed number.
   * @param {ReturnType<typeof request>} pending the object `request()` returned
   */
  function settle(pending) {
    if (pending.state !== 'proposed') return pending;
    const v = pending.round.verdict();
    inflight.delete(pending.period);
    if (!v.granted) {
      return wait(pending.ref, pending.period,
        `number ${pending.value} of the "${decl.series}" series was not confirmed by a majority of `
        + `the electors of "${key}": ${v.reason} Nothing was issued and nothing was written; the `
        + 'document keeps its place in the queue and will ask for the same number again.',
        pending.consumer, { value: pending.value, proposal: pending.proposal.id });
    }
    queue.remove(pending.ref);
    const evidence = { term: v.term, leader: peer, acks: v.acks, quorum: v.quorum,
      signedAcks: v.signedAcks, unsignedAcks: v.unsignedAcks };
    return {
      state: 'issued', number: pending.number, value: pending.value,
      sequenceBefore: pending.sequenceBefore, sequenceAfter: pending.sequenceAfter,
      op: pending.op, retire: pending.retire, raisedFrom: pending.raisedFrom,
      evidence, trailers: trailersFor(pending.period, pending.value, pending.consumer, evidence),
      reason: null,
    };
  }

  const trailersFor = (period, value, consumer, evidence) => {
    const out = [sequenceTrailer(decl, period, value,
      consumer ? consumer.entity : decl.entity, consumer ? consumer.id : '-')];
    if (evidence) out.push(sequenceQuorumTrailer(decl, period, value, evidence));
    return out;
  };

  return {
    key,
    series: decl.series,
    queue,
    request,
    settle,
    /**
     * Try the document that has waited longest. Null when nothing is waiting. This is what runs
     * after this peer wins an election, or after the authority comes back: the queue drains in
     * order, and the first refusal stops the drain so the order is never broken.
     * @param {{current:object|null, stamp:object}} r
     */
    resume(r) {
      const head = queue.head();
      if (!head) return null;
      return request({
        ref: head.ref, period: head.period, current: r.current, stamp: r.stamp,
        consumer: head.consumer,
      });
    },
  };
}
