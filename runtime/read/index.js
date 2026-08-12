/**
 * runtime/read/index.js — the Read Path (manifesto Appendix VI).
 *
 * The governing idea: **the index is a view, not truth.** It is always rebuildable from git,
 * it is never the authority, and corrupting it is harmless — you throw it away and rebuild.
 * Nothing in here writes anything anywhere.
 *
 * Four properties this file exists to guarantee:
 *
 *  1. *Rebuild == incremental.* `materialize()` over a whole tree and `update()` over the
 *     changed paths of the same tree produce indistinguishable indexes — now including every
 *     secondary index structure. Appendix VI line 204 promises "full materialization ... can take
 *     minutes. After that, incremental"; that promise is only safe if the two paths cannot drift
 *     apart. An index that has drifted from the documents is a **wrong report**, and in an ERP a
 *     wrong report is worse than a slow one. `test/e-read.test.js` tests it after every kind of
 *     change, including ones that move a document from one index bucket to another.
 *
 *  2. *Opaque bytes are a normal condition, not an error.* Appendix VII: every peer holds the
 *     full repo, but only the parts it has keys for are readable. A blob that does not decrypt,
 *     is not UTF-8, or is not JSON is **skipped and counted** — never fatal. The result is
 *     Appendix VII's "elegant side effect": a personalized index built only from what this peer
 *     can decrypt. The intern's index has no `salary` entity at all, so Principle 7's MCP
 *     interface cannot query it — structurally, not by permission check.
 *
 *  3. *An index may narrow, never decide.* Every secondary index answers "which rows are worth
 *     looking at" and the query pipeline in `query.js` alone answers "which rows match", by
 *     re-applying every predicate to every candidate. A candidate set may therefore be a superset
 *     and must never be a subset. This is why adding indexes did not add a class of wrong answers.
 *
 *  4. *Money is exact.* FD-1: a monetary value is the token `"4999.99 EUR"`, indexed, compared and
 *     summed as `BigInt` minor units, never as a float, and mixed currencies refuse to add.
 *
 * Decryption is *not* implemented here and must not be. It is injected: `readBlob` is whatever
 * the caller hands us. A decrypting reader returns plaintext for what the peer can open, and
 * opaque bytes (or throws) for what it cannot. That keeps this module free of key handling,
 * and free of any dependency on `runtime/git/` or `runtime/identity/`.
 *
 * Constraints honoured: zero dependencies, no `node:*`, no `Date.now()`, no `Math.random()`.
 *
 * The file is long because the PWA shell list (`runtime/ui/shell-files.js`) and
 * `service-worker.js` enumerate the runtime's modules and are asserted against the real ES module
 * graph by `test/g-ui.test.js` — both are owned by other agents, so the read path grows in place
 * rather than adding files another agent would have to chase. It is sectioned instead:
 *
 *   PART 1  document storage — persistent maps and the dense row store
 *   PART 2  secondary indexes — equality buckets, sorted ranges, maintained aggregates
 *   PART 3  the query planner
 *   PART 4  materialize / update / indexOf, and the Index surface
 *
 * @typedef {Uint8Array} Bytes
 * @typedef {string} OID
 * @typedef {{ id: string, entity: string, [field: string]: unknown }} Doc
 * @typedef {import('./query.js').Query} Query
 */

import {
  select as runSelect,
  compile as compileQuery,
  compareStrings,
  compareValues,
  QueryError,
  parseMoney,
  moneyKey,
  keyToMoney,
  compareMoneyKeys,
  formatMoney,
  refusal,
  mixedKindsMessage,
} from './query.js';

export { QueryError };

const DOC_PREFIX = 'documents/';
const DOC_SUFFIX = '.json';

/** `fatal: true` so undecryptable bytes fail here rather than becoming replacement chars. */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** Internals live off the public object, so no other module can reach into them. */
const INTERNALS = new WeakMap();

/** How many blobs to read concurrently. Reads are I/O bound (OPFS / node fs). */
const READ_WINDOW = 128;

/**
 * `documents/<entity>/<id>.json` → `{entity, id}`; anything else → null (not a document).
 * The path is authoritative for identity — this is the single source of truth the contract
 * names, shared by git/, read/, polism/ and ui/.
 */
export function parseDocPath(path) {
  if (typeof path !== 'string') return null;
  if (!path.startsWith(DOC_PREFIX) || !path.endsWith(DOC_SUFFIX)) return null;
  const middle = path.slice(DOC_PREFIX.length, path.length - DOC_SUFFIX.length);
  const slash = middle.indexOf('/');
  if (slash <= 0) return null;
  const entity = middle.slice(0, slash);
  const id = middle.slice(slash + 1);
  if (id.length === 0 || id.includes('/')) return null;
  return { entity, id };
}

/** The inverse, so `indexOf(docs)` and `materialize()` share one representation. */
export function docPath(entity, id) {
  return `${DOC_PREFIX}${entity}/${id}${DOC_SUFFIX}`;
}

// ===========================================================================
// PART 1 — document storage
//
// Two promises have to hold at the same time:
//
//  1. **`update()` is pure.** The index you already hold keeps reporting exactly what it reported
//     before. A report being printed while a commit lands must not shift under it.
//  2. **`update()` costs the change set, not the repo.** v0.1 kept promise 1 with
//     `new Map(previous)` per touched entity — O(entity) per change. At 15 000 invoices nobody
//     notices; at 1 000 000 it is ~150 ms of Map copying before a single blob is read, which turns
//     "incremental" back into "rebuild".
//
// `PMap` is how both hold at once: an immutable **base** shared with every previous version, plus a
// small copied **overlay** of writes and tombstones. A version costs O(overlay). When the overlay
// grows past a fraction of the base it is folded in — O(n) once, amortised O(1) per change.
//
// `EntityStore` adds the other half: documents live in a **dense array** and the secondary indexes
// store *row numbers*, not ids. Turning a candidate into a document is then an array index (~2 ns)
// instead of a hash lookup in a million-entry Map (~80 ns). On a 100 000-candidate query that is
// the difference between milliseconds and microseconds of pure addressing, and it is why the row
// array is copied outright (a pointer memcpy) rather than overlaid — an overlay check in the hot
// filter loop would hand the whole advantage back.
// ===========================================================================

/** Overlay is folded into the base once it exceeds `base >> 6`, floored at this. */
const MIN_OVERLAY = 512;

const TOMB = Symbol('deleted');

/**
 * A persistent map: `get`/`has`/`size`/iteration, plus `derive()` for a cheap next version.
 * Not a general-purpose data structure — exactly what `paths` and `id → row` need.
 */
class PMap {
  constructor(base = new Map(), over = null, live = base.size) {
    this.base = base;
    this.over = over;
    this.live = live;
  }

  /** A new version sharing this one's base. O(overlay), not O(base). */
  derive() {
    return new PMap(this.base, this.over === null ? new Map() : new Map(this.over), this.live);
  }

  get(k) {
    if (this.over !== null) {
      const v = this.over.get(k);
      if (v !== undefined) return v === TOMB ? undefined : v;
      if (this.over.has(k)) return undefined;
    }
    return this.base.get(k);
  }

  has(k) {
    if (this.over !== null && this.over.has(k)) return this.over.get(k) !== TOMB;
    return this.base.has(k);
  }

  /** Mutates *this* version. Only ever called on a version under construction. */
  set(k, v) {
    if (v === undefined) throw new TypeError('PMap cannot store undefined');
    if (!this.has(k)) this.live++;
    if (this.over === null) this.over = new Map();
    this.over.set(k, v);
    return this;
  }

  delete(k) {
    if (!this.has(k)) return false;
    this.live--;
    if (this.over === null) this.over = new Map();
    if (this.base.has(k)) this.over.set(k, TOMB);
    else this.over.delete(k);
    return true;
  }

  get size() {
    return this.live;
  }

  /**
   * Fold the overlay into the base unconditionally. Called at the end of a *full* build, where
   * every entry is in the overlay by construction: without this, the first `update()` would copy
   * the whole overlay — 320 000 entries, ~100 ms at the 150 000-invoice scale — and "incremental"
   * would silently mean "rebuild". Found by the benchmark, which is what the benchmark is for.
   */
  seal() {
    if (this.over === null || this.over.size === 0) {
      this.over = null;
      return this;
    }
    const merged = this.base.size === 0 ? new Map() : new Map(this.base);
    for (const [k, v] of this.over) {
      if (v === TOMB) merged.delete(k);
      else merged.set(k, v);
    }
    this.base = merged;
    this.over = null;
    return this;
  }

  /**
   * Fold the overlay into a fresh base once it has grown large. Called at the end of `update()`,
   * so the cost lands on the writer and never on a reader.
   */
  compact() {
    if (this.over === null) return this;
    const share = this.base.size >> 6;
    const limit = MIN_OVERLAY > share ? MIN_OVERLAY : share;
    if (this.over.size <= limit) return this;
    const merged = new Map(this.base);
    for (const [k, v] of this.over) {
      if (v === TOMB) merged.delete(k);
      else merged.set(k, v);
    }
    this.base = merged;
    this.over = null;
    return this;
  }

  *entries() {
    if (this.over === null) {
      yield* this.base.entries();
      return;
    }
    for (const [k, v] of this.base) {
      if (this.over.has(k)) continue;
      yield [k, v];
    }
    for (const [k, v] of this.over) {
      if (v !== TOMB) yield [k, v];
    }
  }

  *keys() {
    for (const [k] of this.entries()) yield k;
  }

  *values() {
    for (const [, v] of this.entries()) yield v;
  }
}

/**
 * One entity's documents, dense.
 *
 * `rows[r]` is a document or `null` (a hole left by a deletion, reused by the next insert). Row
 * numbers are **stable for the life of a document**: they are never renumbered, so no secondary
 * index ever has to be rebuilt because of compaction. The cost is that `rows.length` tracks the
 * *peak* live count rather than the current one; that is bounded, measured, and stated in
 * README.md rather than hidden.
 */
class EntityStore {
  constructor() {
    this.rows = [];
    this.ids = new PMap();
    this.free = [];
    this.count = 0;
  }

  derive() {
    const s = new EntityStore();
    s.rows = this.rows.slice();
    s.ids = this.ids.derive();
    s.free = this.free.slice();
    s.count = this.count;
    return s;
  }

  rowOf(id) {
    const r = this.ids.get(id);
    return r === undefined ? -1 : r;
  }

  get(id) {
    const r = this.ids.get(id);
    return r === undefined ? null : this.rows[r];
  }

  /** @returns {{row:number, prev:Doc|null}} the row written, and what used to be there. */
  put(doc) {
    const existing = this.ids.get(doc.id);
    if (existing !== undefined) {
      const prev = this.rows[existing];
      this.rows[existing] = doc;
      return { row: existing, prev };
    }
    const row = this.free.length > 0 ? this.free.pop() : this.rows.length;
    this.rows[row] = doc;
    this.ids.set(doc.id, row);
    this.count++;
    return { row, prev: null };
  }

  /** @returns {{row:number, prev:Doc}|null} */
  remove(id) {
    const row = this.ids.get(id);
    if (row === undefined) return null;
    const prev = this.rows[row];
    this.rows[row] = null;
    this.ids.delete(id);
    this.free.push(row);
    this.count--;
    return { row, prev };
  }

  compact() {
    this.ids.compact();
    return this;
  }

  seal() {
    this.ids.seal();
    return this;
  }

  /** Every live document, in row order. The scan path's base when order does not matter. */
  liveDocs() {
    const out = [];
    const rows = this.rows;
    for (let r = 0; r < rows.length; r++) {
      const d = rows[r];
      if (d !== null && d !== undefined) out.push(d);
    }
    return out;
  }

  /** How dense the row array actually is — the honest number behind "holes are never renumbered". */
  occupancy() {
    return { slots: this.rows.length, live: this.count, holes: this.free.length };
  }
}

// ===========================================================================
// PART 2 — secondary indexes
//
// This section is the answer to v0.1's real defect: there were none, so every question that was
// not "which document has this id?" was a linear scan, and Appendix VI's own example query grew
// linearly to ~70 ms at a million invoices.
//
// **Equality — a hash bucket per value.** `Map<encodedKey, row | Set<row>>`. Exact, O(1), and it
// doubles as the authority for which values exist. A bucket holds a bare row number when it has one
// member (the common case for reference fields and document numbers) and a `Set` beyond that; two
// shapes instead of one saves roughly 60 bytes per singleton bucket, which at a million documents
// is the difference between an index you can afford and one you cannot.
//
// **Range — a sorted array of the keys, binary-searched.** Not a B-tree, and the reason is worth
// stating rather than assuming: a B-tree earns its complexity when the structure is paged from disk
// or updated in place under concurrency, and this one is neither — it is a rebuildable view of an
// immutable commit, held in RAM, written by one thread. A sorted array of *the same key strings the
// equality map already holds* costs one extra pointer per distinct value and no extra objects at
// all, which a B-tree's nodes cannot match. What a sorted array is bad at is insertion, so it is
// two-level: an immutable `main` plus a small sorted `pending`, both searched, merged when
// `pending` outgrows its share. That is the standard trade and README.md measures it.
//
// **Money gets a partition per currency.** A range query in EUR must not walk USD keys — not as an
// optimisation, but because FD-1 says the two do not compare. Order inside a partition is by
// `BigInt` minor units.
//
// **Maintained aggregates, for money only.** `sum of amount over posting where account = X` is
// O(1) rather than O(rows in that account), because a general ledger calls it on every posting.
// Money only, and that restriction is load-bearing: an incrementally maintained `double` sum is not
// order-independent, so add-then-subtract would not equal a fresh scan and the oracle test in
// `test/e-read.test.js` would be right to fail it. `BigInt` minor units are exact and
// order-independent, so the maintained value provably equals the scan. FD-1 paying for itself in
// performance, not only in correctness.
//
// **Ownership.** Secondary indexes are mutable and owned by exactly one index version. `update()`
// hands ownership to the version it returns and revokes the source's handle. A revoked index stays
// completely correct — it lazily rebuilds from its own immutable documents the next time a query
// wants an index. That is "the index is a view, never truth" used as an engineering tool: the
// cheapest way to keep a stale index honest is to let it throw itself away.
// ===========================================================================

/** Fold `pending` into `main` once it exceeds `main / 16`, floored at 64. */
const PENDING_MIN = 64;
const PENDING_SHIFT = 4;

/**
 * Encode a field value into an index key, or `null` when the value is not indexable.
 *
 * The type tag is not decoration: without it `1` and `"1"` share a bucket, and an index that
 * conflates them is an index that can be *asked* the wrong question. Money is recognised by its
 * own canonical shape — precisely what FD-1 bought by making money a self-describing string, and
 * it means money is indexed exactly without the index needing the model at all.
 */
function encodeKey(v) {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'string': {
      const m = parseMoney(v);
      return m === null ? `s:${v}` : moneyKey(m);
    }
    case 'number':
      return v === v ? `n:${v}` : null; // NaN is not a value; it compares false everywhere
    case 'bigint':
      return `n:${v}`;
    case 'boolean':
      return v ? 'b:1' : 'b:0';
    default:
      return null; // objects and arrays are matched by `contains`, which no index serves
  }
}

/** Which sorted domain a key belongs to. `null` for booleans — equality only, no order. */
function domainOf(key) {
  const t = key.charCodeAt(0);
  if (t === 110) return 'num'; // n
  if (t === 115) return 'str'; // s
  if (t === 109) return 'money'; // m
  return null;
}

function compareNumKeys(a, b) {
  // A key is `n:<String(v)>`; `Number()` of that round-trips a double exactly. Never money.
  const x = Number(a.slice(2));
  const y = Number(b.slice(2));
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Read a dotted field path off a document. Mirrors `query.js`'s reader for non-alias refs. */
function compilePath(ref) {
  const parts = ref.split('.');
  if (parts.length === 1) {
    const k = parts[0];
    return (doc) => doc[k];
  }
  return (doc) => {
    let cur = doc;
    for (let i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  };
}

/** An immutable `main` plus a small sorted `pending`, both binary-searched. */
class SortedKeys {
  /** @param {(a:string,b:string)=>number} cmp */
  constructor(cmp) {
    this.cmp = cmp;
    this.main = [];
    this.pending = [];
  }

  /** Bulk load, used when an index is built in one pass. */
  load(keys) {
    this.main = keys.slice().sort(this.cmp);
    this.pending = [];
    return this;
  }

  add(key) {
    const cmp = this.cmp;
    const p = this.pending;
    let lo = 0;
    let hi = p.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(p[mid], key) < 0) lo = mid + 1;
      else hi = mid;
    }
    if (lo < p.length && p[lo] === key) return; // already pending
    p.splice(lo, 0, key);
  }

  /**
   * Keys are never removed when a bucket empties — a key with no rows contributes no candidates,
   * so it is inert, and paying O(n) to splice it out of `main` would be paying for nothing. They
   * are swept here, where the array is being rebuilt anyway.
   * @param {(k:string)=>boolean} isLive
   * @returns {boolean} whether `main` was rewritten — the column's ranks are derived from it.
   */
  maybeMerge(isLive) {
    const share = this.main.length >> PENDING_SHIFT;
    const limit = PENDING_MIN > share ? PENDING_MIN : share;
    if (this.pending.length <= limit) return false;
    this.main = this.dump(isLive);
    this.pending = [];
    return true;
  }

  get size() {
    return this.main.length + this.pending.length;
  }

  /** First position in `arr` whose key is `>= probe` (or `> probe` when `strict`). */
  static bound(arr, cmp, probe, strict) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const c = cmp(arr[mid], probe);
      if (c < 0 || (strict && c === 0)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Every key with `lo <?= key <?= hi`. `lo`/`hi` may be null for an open end. */
  range(lo, loInc, hi, hiInc) {
    const out = [];
    for (const arr of [this.main, this.pending]) {
      const from = lo === null ? 0 : SortedKeys.bound(arr, this.cmp, lo, !loInc);
      const to = hi === null ? arr.length : SortedKeys.bound(arr, this.cmp, hi, hiInc);
      for (let i = from; i < to; i++) out.push(arr[i]);
    }
    return out;
  }

  /** How many keys fall in the range, without materialising them. For the planner's estimate. */
  countRange(lo, loInc, hi, hiInc) {
    let n = 0;
    for (const arr of [this.main, this.pending]) {
      const from = lo === null ? 0 : SortedKeys.bound(arr, this.cmp, lo, !loInc);
      const to = hi === null ? arr.length : SortedKeys.bound(arr, this.cmp, hi, hiInc);
      n += to - from;
    }
    return n;
  }

  /** Canonical content — live keys only, in order, de-duplicated. Used by the drift test. */
  dump(isLive) {
    const seen = new Set();
    const out = [];
    for (const arr of [this.main, this.pending]) {
      for (const k of arr) {
        if (isLive(k) && !seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
    return out.sort(this.cmp);
  }
}

/**
 * The columnar projection of one `FieldIndex` — **FD-10 item 1**, and the fix for the locality
 * measurement in README.md §8.3 (per-candidate filter cost 71 ns at 150 k documents → 244 ns at
 * 1 M, because every predicate chased a pointer into a different heap object).
 *
 * ## The layout, and why it is not `BigInt64Array`
 *
 * FD-10 prescribes "a `BigInt64Array` of minor units for money, integers for dates". The *goal* is
 * right and this class serves it; the *layout* is wrong, in two ways I measured rather than argued:
 *
 *  1. **Reading a `BigInt64Array` allocates a `BigInt`.** That is precisely the ~100 ns per row that
 *     `moneyComparator` was written to avoid (README.md §5: 125 ns → 25 ns, "almost all of that
 *     difference being the `BigInt`"). A money column of minor units would be *slower* than the
 *     string comparator it replaced. §8.5 has the number.
 *  2. **It truncates.** `BigInt64Array` assignment wraps modulo 2^64 **silently** — it does not
 *     throw. EUR minor units exceed 2^63−1 above ≈ 92 quadrillion euro, and above
 *     `Number.MAX_SAFE_INTEGER` a great deal earlier. A monetary index that wraps is the float
 *     defect of FD-1 wearing a different hat, and it is the one thing this directory may not do.
 *
 * So the column is **dictionary-encoded**: an `Int32Array` of *ordinals* into the field's own
 * distinct-value dictionary — which is the equality index's key set, so nothing is duplicated and
 * nothing is re-derived. 4 bytes per row rather than 8, exact at every magnitude because the
 * dictionary holds the canonical FD-1 token, and one uniform layout for money, dates, references,
 * numbers and text instead of four.
 *
 * ```
 *   ords[row]   → ordinal, or -1 when the row carries no indexable value
 *   keys[ord]   → the encodeKey string (on the FieldIndex; the dictionary and the eq index are one)
 *   rank[ord]   → the ordinal's position in a globally-ordered list, or -1 for "not yet ranked"
 *   ordered     → every ranked ordinal, ascending, grouped into contiguous per-domain blocks
 *   blocks      → domain key ('num' | 'str' | 'm:EUR') → {off, len} into `ordered`
 * ```
 *
 * Because the blocks are contiguous and disjoint, a range predicate over one domain is a single
 * **integer interval** in rank space: `rlo <= rank[ords[row]] < rhi`. Two dense loads and two
 * comparisons, no string compare, no `BigInt`, no pointer chase. The domain check is implied by the
 * interval, which is why a EUR range cannot see a CHF row.
 *
 * ## Why this cannot make an answer wrong
 *
 * The column is a **different layout of the same information the equality buckets hold**, derived
 * from the same `encodeKey` and ordered by the same comparators as `SortedKeys`. So for any clause
 * `serviceable()` accepts, the set of rows the column admits is the set the bucket plan admits —
 * with one deliberate slackening: an ordinal added since the last ranking (`rank === -1`) is
 * **accepted**, never rejected. Slack in the accepting direction is a larger candidate set, which
 * the pipeline in `query.js` then filters exactly. Slack in the other direction would be a short
 * report, and there is none: every path that could not prove a superset returns "accept".
 */
class Column {
  constructor() {
    /** row → ordinal, -1 = no indexable value. Dense, sequential, 4 bytes a row. */
    this.ords = EMPTY_I32;
    /** ordinal → global rank, -1 = unranked (accepted conservatively). */
    this.rank = EMPTY_I32;
    /** every ranked ordinal, ascending within contiguous per-domain blocks. */
    this.ordered = EMPTY_I32;
    /** @type {Map<string, {off:number, len:number}>} */
    this.blocks = new Map();
  }

  /** Size the row array for a one-pass build. */
  reset(slots) {
    this.ords = new Int32Array(slots < 16 ? 16 : slots).fill(-1);
  }

  growRows(need) {
    const have = this.ords.length;
    let cap = have === 0 ? 64 : have * 2;
    if (cap < need) cap = need;
    const next = new Int32Array(cap).fill(-1);
    next.set(this.ords);
    this.ords = next;
  }

  set(row, ord) {
    if (row >= this.ords.length) this.growRows(row + 1);
    this.ords[row] = ord;
  }

  /** A new dictionary entry is unranked until the next ranking pass. */
  growDict(n) {
    if (n <= this.rank.length) return;
    let cap = this.rank.length === 0 ? 64 : this.rank.length * 2;
    if (cap < n) cap = n;
    const next = new Int32Array(cap).fill(-1);
    next.set(this.rank);
    this.rank = next;
  }

  setRanks(ordered, blocks, dictSize) {
    const rank = new Int32Array(dictSize < 16 ? 16 : dictSize).fill(-1);
    const arr = Int32Array.from(ordered);
    for (let i = 0; i < arr.length; i++) rank[arr[i]] = i;
    this.rank = rank;
    this.ordered = arr;
    this.blocks = blocks;
  }

  /** How many dictionary entries have no rank yet — the slack, reported by `indexStats()`. */
  unranked(dictSize) {
    return dictSize - this.ordered.length;
  }

  /**
   * A predicate over one row, for an equality / `in` clause. Exact: an ordinal either is or is not
   * the row's ordinal, and a row with no indexable value can never satisfy an indexable clause
   * (`undefined === v` is false, `isComparable(undefined, …)` is false, `starts with` needs a
   * string, and `serviceable()` already declined `in [.., null]`).
   */
  testKeys(ordList) {
    const ords = this.ords;
    const cap = ords.length;
    const n = ordList.length;
    // A row the column does not cover cannot be narrowed, so it is admitted. This can only ever
    // happen if a row were added without notifying this index; it is a guard, not a path.
    if (n === 0) return (row) => row >= cap;
    if (n === 1) {
      const a = ordList[0];
      return (row) => (row >= cap ? true : ords[row] === a);
    }
    if (n === 2) {
      const a = ordList[0];
      const b = ordList[1];
      return (row) => {
        if (row >= cap) return true;
        const o = ords[row];
        return o === a || o === b;
      };
    }
    if (n <= 8) {
      const s = Int32Array.from(ordList);
      return (row) => {
        if (row >= cap) return true;
        const o = ords[row];
        if (o < 0) return false;
        for (let i = 0; i < n; i++) if (s[i] === o) return true;
        return false;
      };
    }
    let max = 0;
    for (const o of ordList) if (o > max) max = o;
    const mask = new Uint8Array(max + 1);
    for (const o of ordList) mask[o] = 1;
    return (row) => {
      if (row >= cap) return true;
      const o = ords[row];
      return o >= 0 && o <= max && mask[o] === 1;
    };
  }

  /** A predicate over one row, for a range clause already reduced to a rank interval. */
  testRange(rlo, rhi) {
    const ords = this.ords;
    const rank = this.rank;
    const cap = ords.length;
    return (row) => {
      if (row >= cap) return true;
      const o = ords[row];
      if (o < 0) return false;
      const r = rank[o];
      if (!(r >= 0)) return true; // unranked, or beyond the rank array: cannot narrow
      return r >= rlo && r < rhi;
    };
  }

  /**
   * Reduce a `serviceable()` range to `[rlo, rhi)` in rank space, using the *same* comparator the
   * sorted domain uses. Returns an empty interval when the domain has nothing ranked, which rejects
   * every ranked row and admits every unranked one — still a superset.
   */
  rangeBounds(domKey, s, cmp, keys) {
    const b = this.blocks.get(domKey);
    if (b === undefined) return { rlo: 0, rhi: 0 };
    const ordered = this.ordered;
    const off = b.off;
    const len = b.len;
    const bound = (probe, strict) => {
      let lo = 0;
      let hi = len;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const c = cmp(keys[ordered[off + mid]], probe);
        if (c < 0 || (strict && c === 0)) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const rlo = s.lo === null ? 0 : bound(s.lo, !s.loInc);
    const rhi = s.hi === null ? len : bound(s.hi, s.hiInc);
    return { rlo: off + rlo, rhi: off + (rhi < rlo ? rlo : rhi) };
  }
}

const EMPTY_I32 = new Int32Array(0);

/** Which comparator orders a domain. One table, shared by `SortedKeys` and by the column. */
function comparatorFor(domain) {
  if (domain === 'num') return compareNumKeys;
  if (domain === 'money') return compareMoneyKeys;
  return compareStrings;
}

function domainKeyOf(domain, code) {
  return domain === 'money' ? `m:${code}` : domain;
}

/**
 * One (entity, field-path) pair: a dictionary of distinct values, a posting list per value, the
 * sorted domains that occur, and the columnar projection above.
 *
 * The dictionary and the equality index are the same structure: `eq` maps an `encodeKey` string to
 * an **ordinal**, `keys[ord]` maps back, and `buckets[ord]` holds the rows. That is a change from
 * Wave 1, where `eq` mapped a key straight to `row | Set<row>`; the ordinal is what lets a dense
 * column exist without a second copy of every distinct value. `buckets[ord] === undefined` means
 * the value is no longer carried by any row — a dictionary entry is never removed, because an
 * ordinal is a promise to the column that must not be broken.
 */
class FieldIndex {
  constructor(entity, ref, columnar = true) {
    this.entity = entity;
    this.ref = ref;
    this.read = compilePath(ref);
    /** @type {Map<string, number>} encodeKey → ordinal. The dictionary *and* the equality index. */
    this.eq = new Map();
    /** @type {string[]} ordinal → encodeKey. */
    this.keys = [];
    /** @type {(number|Set<number>|undefined)[]} ordinal → row | rows | nothing. */
    this.buckets = [];
    /** Distinct values currently carried by at least one row. Not `eq.size` — that counts history. */
    this.nLive = 0;
    /** @type {SortedKeys|null} */
    this.num = null;
    /** @type {SortedKeys|null} */
    this.str = null;
    /** @type {Map<string, SortedKeys>|null} */
    this.money = null;
    /** @type {Column|null} */
    this.col = columnar ? new Column() : null;
    this.covered = 0; // rows carrying an indexable value
    this.missing = 0; // rows where the field is absent, null, NaN, or an object
    /**
     * `encodeKey` maps the number 1 and the BigInt 1n to one bucket, while `=` in the query
     * language does not (`1n === 1` is false). Superset candidates are fine; an *exact* count
     * taken from a bucket size would not be. So the presence of BigInts is tracked, and the
     * counting shortcut declines when there are any.
     */
    this.bigints = 0;
  }

  /** The ordinal for a key, appending a dictionary entry if this is the first sighting. */
  intern(key) {
    let o = this.eq.get(key);
    if (o === undefined) {
      o = this.keys.length;
      this.keys.push(key);
      this.eq.set(key, o);
      this.buckets.push(undefined);
      if (this.col !== null) this.col.growDict(o + 1);
    }
    return o;
  }

  addRow(row, doc) {
    const v = this.read(doc);
    const key = encodeKey(v);
    if (key === null) {
      this.missing++;
      if (this.col !== null) this.col.set(row, -1);
      return;
    }
    if (typeof v === 'bigint') this.bigints++;
    this.covered++;
    const o = this.intern(key);
    const b = this.buckets[o];
    if (b === undefined) {
      this.buckets[o] = row;
      this.nLive++;
      this.trackKey(key);
    } else if (typeof b === 'number') {
      if (b !== row) this.buckets[o] = new Set([b, row]);
    } else {
      b.add(row);
    }
    if (this.col !== null) this.col.set(row, o);
  }

  removeRow(row, doc) {
    const v = this.read(doc);
    const key = encodeKey(v);
    if (this.col !== null) this.col.set(row, -1);
    if (key === null) {
      this.missing--;
      return;
    }
    if (typeof v === 'bigint') this.bigints--;
    this.covered--;
    const o = this.eq.get(key);
    if (o === undefined) return;
    const b = this.buckets[o];
    if (b === undefined) return;
    if (typeof b === 'number') {
      if (b === row) {
        this.buckets[o] = undefined;
        this.nLive--;
      }
    } else {
      b.delete(row);
      if (b.size === 1) this.buckets[o] = b.values().next().value;
      else if (b.size === 0) {
        this.buckets[o] = undefined;
        this.nLive--;
      }
    }
  }

  trackKey(key) {
    const d = domainOf(key);
    if (d === 'num') {
      if (this.num === null) this.num = new SortedKeys(compareNumKeys);
      this.num.add(key);
    } else if (d === 'str') {
      if (this.str === null) this.str = new SortedKeys(compareStrings);
      this.str.add(key);
    } else if (d === 'money') {
      if (this.money === null) this.money = new Map();
      const code = keyToMoney(key).code;
      let sk = this.money.get(code);
      if (sk === undefined) {
        sk = new SortedKeys(compareMoneyKeys);
        this.money.set(code, sk);
      }
      sk.add(key);
    }
  }

  /** One pass over the entity. Bulk-sorts the domains rather than inserting key by key. */
  build(store) {
    const rows = store.rows;
    const slots = rows.length;
    const col = this.col;
    if (col !== null) col.reset(slots);
    const num = [];
    const str = [];
    const money = new Map();
    for (let r = 0; r < slots; r++) {
      const doc = rows[r];
      if (doc === null || doc === undefined) continue;
      const v = this.read(doc);
      const key = encodeKey(v);
      if (key === null) {
        this.missing++;
        continue;
      }
      if (typeof v === 'bigint') this.bigints++;
      this.covered++;
      let o = this.eq.get(key);
      if (o === undefined) {
        o = this.keys.length;
        this.keys.push(key);
        this.eq.set(key, o);
        this.buckets.push(r);
        this.nLive++;
        const d = domainOf(key);
        if (d === 'num') num.push(key);
        else if (d === 'str') str.push(key);
        else if (d === 'money') {
          const code = keyToMoney(key).code;
          let a = money.get(code);
          if (a === undefined) money.set(code, (a = []));
          a.push(key);
        }
      } else {
        const b = this.buckets[o];
        if (typeof b === 'number') this.buckets[o] = new Set([b, r]);
        else b.add(r);
      }
      if (col !== null) col.ords[r] = o;
    }
    if (num.length > 0) this.num = new SortedKeys(compareNumKeys).load(num);
    if (str.length > 0) this.str = new SortedKeys(compareStrings).load(str);
    if (money.size > 0) {
      this.money = new Map();
      for (const [code, keys] of money) {
        this.money.set(code, new SortedKeys(compareMoneyKeys).load(keys));
      }
    }
    this.rebuildRanks();
    return this;
  }

  /**
   * Give every distinct value a rank, in the *same* order `SortedKeys` already holds it in.
   *
   * The order is read off `SortedKeys.main` rather than sorted again — one source of truth for
   * "which value comes first", so a column and a range walk cannot disagree about ordering, and the
   * O(n log n) sort is paid exactly once (inside `load()` / `maybeMerge()`) rather than twice.
   *
   * Keys sitting in a `SortedKeys.pending` are deliberately left unranked. They are conservatively
   * *admitted* by every range test, which is a slightly larger candidate set and never a smaller
   * one; the next merge ranks them. Bounded by `pending`'s own threshold (main/16).
   */
  rebuildRanks() {
    const col = this.col;
    if (col === null) return;
    const ordered = [];
    const blocks = new Map();
    const push = (domKey, sk) => {
      if (sk === null || sk === undefined) return;
      const off = ordered.length;
      const main = sk.main;
      for (let i = 0; i < main.length; i++) {
        const o = this.eq.get(main[i]);
        if (o !== undefined) ordered.push(o);
      }
      if (ordered.length > off) blocks.set(domKey, { off, len: ordered.length - off });
    };
    push('num', this.num);
    if (this.money !== null) {
      for (const code of [...this.money.keys()].sort(compareStrings)) {
        push(`m:${code}`, this.money.get(code));
      }
    }
    push('str', this.str);
    col.setRanks(ordered, blocks, this.keys.length);
  }

  /** Is this key carried by at least one live row? Not "was it ever seen". */
  isLiveKey(k) {
    const o = this.eq.get(k);
    return o !== undefined && this.buckets[o] !== undefined;
  }

  sweep() {
    const isLive = (k) => this.isLiveKey(k);
    let merged = false;
    if (this.num !== null) merged = this.num.maybeMerge(isLive) || merged;
    if (this.str !== null) merged = this.str.maybeMerge(isLive) || merged;
    if (this.money !== null) {
      for (const [code, sk] of [...this.money]) {
        merged = sk.maybeMerge(isLive) || merged;
        if (sk.size === 0) {
          this.money.delete(code);
          merged = true;
        }
      }
      if (this.money.size === 0) {
        this.money = null;
        merged = true;
      }
    }
    // A merge rewrote `main`, so every rank moved. Re-derive them from the new order; this is the
    // only place ranks change after a build, and it is already an O(n) pass.
    if (merged) this.rebuildRanks();
  }

  bucketSize(key) {
    const o = this.eq.get(key);
    if (o === undefined) return 0;
    const b = this.buckets[o];
    if (b === undefined) return 0;
    return typeof b === 'number' ? 1 : b.size;
  }

  /** Rows for one key, appended to `out`. */
  collect(key, out) {
    const o = this.eq.get(key);
    if (o === undefined) return;
    const b = this.buckets[o];
    if (b === undefined) return;
    if (typeof b === 'number') out.push(b);
    else for (const r of b) out.push(r);
  }

  /** Average rows per distinct key — the only estimate a range needs, and it is called one. */
  avgBucket() {
    return this.nLive === 0 ? 0 : this.covered / this.nLive;
  }

  sortedFor(domain, code) {
    if (domain === 'num') return this.num;
    if (domain === 'str') return this.str;
    if (domain === 'money') return this.money === null ? null : this.money.get(code) ?? null;
    return null;
  }

  /**
   * A columnar row test for a clause `serviceable()` has already approved, or `null` when this index
   * has no column. Set-identical to the bucket plan for the same clause, except that unranked values
   * are admitted (see `Column`).
   */
  columnTestFor(s) {
    const col = this.col;
    if (col === null) return null;
    if (s.kind === 'keys') {
      const ords = [];
      for (const k of s.keys) {
        const o = this.eq.get(k);
        if (o !== undefined && this.buckets[o] !== undefined) ords.push(o);
      }
      return col.testKeys(ords);
    }
    const { rlo, rhi } = col.rangeBounds(
      domainKeyOf(s.domain, s.code),
      s,
      comparatorFor(s.domain),
      this.keys,
    );
    return col.testRange(rlo, rhi);
  }

  /**
   * Canonical content: every live key with the **document ids** in its bucket, ordered.
   *
   * Ids, not row numbers. Row numbers are an implementation detail — a fresh build numbers rows by
   * arrival, while an incrementally maintained index reuses the slots deletions freed — and two
   * indexes that disagree about numbering while agreeing about documents are not drifting. What
   * must never differ is *which documents are in which bucket*, and that is what this dumps. A row
   * pointing at a hole is real corruption, so it is surfaced rather than skipped.
   */
  dump(store) {
    const isLive = (k) => this.isLiveKey(k);
    const keys = [...this.eq.keys()].filter(isLive).sort(compareStrings);
    const idOf = (r) => {
      const d = store === undefined || store === null ? undefined : store.rows[r];
      return d === null || d === undefined ? `!dangling-row-${r}` : String(d.id);
    };
    return {
      ref: this.ref,
      covered: this.covered,
      missing: this.missing,
      bigints: this.bigints,
      buckets: keys.map((k) => {
        const b = this.buckets[this.eq.get(k)];
        const rows = typeof b === 'number' ? [b] : [...b];
        return [k, rows.map(idOf).sort(compareStrings)];
      }),
      // A domain (or a currency partition) whose every key has died is *inert*: `range()` finds
      // nothing live and `collect()` on a dead key adds no rows. It is therefore canonically the
      // same as not having the domain at all, and it dumps that way — otherwise this test would
      // fail on a difference that cannot affect any answer. `sweep()` reclaims the space.
      num: nonEmpty(this.num, isLive),
      str: nonEmpty(this.str, isLive),
      money:
        this.money === null
          ? null
          : nullIfEmpty(
              [...this.money.keys()]
                .sort(compareStrings)
                .map((c) => [c, this.money.get(c).dump(isLive)])
                .filter(([, keys]) => keys.length > 0),
            ),
      /**
       * The columnar projection, as *which value each document carries* — keyed on document id, so
       * it is comparable between a fresh build and an incrementally maintained index even though the
       * two number their rows and their ordinals differently.
       *
       * Ordinals and ranks are deliberately **not** dumped. An ordinal is arrival order and a rank
       * is a merge artefact: a fresh build has nothing unranked while an incremental one may, and
       * neither can change an answer, because an unranked value is admitted and the pipeline decides.
       * What *must* never differ is the value under each id, and that is what this is. The property
       * that the two admit the same rows is asserted directly in `test/e-read.test.js` instead of
       * being inferred from a structural comparison.
       */
      column: this.col === null ? null : this.dumpColumn(store),
    };
  }

  dumpColumn(store) {
    if (store === undefined || store === null) return null;
    const rows = store.rows;
    const ords = this.col.ords;
    const out = [];
    for (let r = 0; r < rows.length; r++) {
      const d = rows[r];
      if (d === null || d === undefined) continue;
      const o = r < ords.length ? ords[r] : -2;
      out.push([String(d.id), o < 0 ? (o === -2 ? '!uncovered' : null) : this.keys[o]]);
    }
    return out.sort((a, b) => compareStrings(a[0], b[0]));
  }

  /** Rough live-object count, for the memory report. Not a byte figure — see README.md. */
  weight() {
    let sets = 0;
    for (const b of this.buckets) if (b !== undefined && typeof b !== 'number') sets++;
    return {
      keys: this.nLive,
      dictionary: this.keys.length,
      sets,
      columnRows: this.col === null ? 0 : this.col.ords.length,
      unranked: this.col === null ? 0 : this.col.unranked(this.keys.length),
      sortedKeys:
        (this.num === null ? 0 : this.num.size) +
        (this.str === null ? 0 : this.str.size) +
        (this.money === null ? 0 : [...this.money.values()].reduce((a, s) => a + s.size, 0)),
    };
  }
}

/**
 * One exact accumulator per currency, so a group that goes mixed can refuse instead of lying.
 *
 * `BigInt` minor units at the currency's fixed scale, so `add` then `subtract` in any order returns
 * exactly what a fresh scan returns. That order-independence is the entire reason a maintained
 * aggregate is allowed to exist here, and the reason it is offered for money and not for `number`.
 */
class Accum {
  constructor() {
    /** @type {Map<string,{minor:bigint, n:number}>} */
    this.byCode = new Map();
    this.nonMoney = 0;
  }

  apply(value, sign) {
    const m = parseMoney(value);
    if (m === null) {
      if (typeof value === 'number' && value === value) this.nonMoney += sign;
      else if (typeof value === 'bigint') this.nonMoney += sign;
      return;
    }
    let a = this.byCode.get(m.code);
    if (a === undefined) {
      a = { minor: 0n, n: 0 };
      this.byCode.set(m.code, a);
    }
    a.minor += BigInt(sign) * m.minor;
    a.n += sign;
    if (a.n === 0 && a.minor === 0n) this.byCode.delete(m.code);
  }

  get empty() {
    return this.byCode.size === 0 && this.nonMoney === 0;
  }

  /**
   * The canonical token, or a thrown refusal. Rendered at the currency's declared scale so that a
   * maintained value and a freshly scanned one are the same string, always.
   * @returns {string|null} null when nothing monetary was ever added
   */
  value() {
    if (this.nonMoney > 0 && this.byCode.size > 0) {
      const e = new Error('the field holds both monetary values and plain numbers');
      e.code = 'MIXED_KINDS';
      throw e;
    }
    if (this.byCode.size > 1) {
      const codes = [...this.byCode.keys()].sort(compareStrings);
      const e = new Error(
        `cannot add ${codes.join(' to ')} — mixed currencies do not add (FD-1). ` +
          'Group by currency, or model an explicit conversion carrying its rate and date.',
      );
      e.code = 'MIXED_CURRENCY';
      e.currencies = codes;
      throw e;
    }
    if (this.byCode.size === 0) return null;
    const code = this.byCode.keys().next().value;
    return formatMoney({ code, minor: this.byCode.get(code).minor });
  }
}

/**
 * A maintained `sum of <field> over <entity> [group by <by>]`, or a maintained group count when
 * `field` is null. This is the structure a general ledger asks on every posting.
 */
class AggIndex {
  /** @param {string} entity @param {string|null} field @param {string|null} by */
  constructor(entity, field, by) {
    this.entity = entity;
    this.field = field;
    this.by = by;
    this.readField = field === null ? null : compilePath(field);
    this.readBy = by === null ? null : compilePath(by);
    /**
     * `members` counts documents that belong to the group *whether or not they carry a value* —
     * because scanning a group whose documents all lack the field returns `0`, not "no such group",
     * and a maintained aggregate that disagreed with the scan there would be a wrong report. `raw`
     * is the group key as the documents spell it, so the Map this returns has the keys a scan
     * would produce.
     * @type {Map<string, {acc: Accum, members: number, raw: unknown}>}
     */
    this.groups = new Map();
    /** Documents whose group key is missing or non-primitive — a scan groups them, this cannot. */
    this.missingKeys = 0;
    /** Two spellings of one key (`1.5 XTS` / `1.50 XTS`) — the fast path steps aside. */
    this.ambiguousKeys = false;
    /** A BigInt group key, which `encodeKey` conflates with the equal Number. Steps aside. */
    this.bigintKeys = 0;
    /** A plain number in a field summed with BigInt — steps aside, permanently. */
    this.nonMoneySeen = false;
  }

  /** Money (or pure counting) only: an incrementally maintained `double` is not exact. */
  get usable() {
    return !this.nonMoneySeen && this.bigintKeys === 0;
  }

  /** Additionally required before a `groupBy` may be answered from here. */
  get groupable() {
    return this.usable && !this.ambiguousKeys && this.missingKeys === 0;
  }

  apply(doc, sign) {
    const rawKey = this.by === null ? '' : this.readBy(doc);
    const gk = this.by === null ? '' : encodeKey(rawKey);
    if (gk === null) {
      this.missingKeys += sign;
      return;
    }
    if (typeof rawKey === 'bigint') this.bigintKeys += sign;
    let g = this.groups.get(gk);
    if (g === undefined) {
      if (sign < 0) return;
      g = { acc: new Accum(), members: 0, raw: rawKey };
      this.groups.set(gk, g);
    } else if (sign > 0) {
      if (g.members === 0) g.raw = rawKey;
      else if (g.raw !== rawKey) this.ambiguousKeys = true;
    }
    g.members += sign;
    if (this.readField !== null) {
      const v = this.readField(doc);
      if (v !== null && v !== undefined) {
        if ((typeof v === 'number' && v === v) || typeof v === 'bigint') this.nonMoneySeen = true;
        g.acc.apply(v, sign);
      }
    }
    if (g.members <= 0 && g.acc.empty) this.groups.delete(gk);
  }

  addRow(_row, doc) {
    this.apply(doc, 1);
  }

  removeRow(_row, doc) {
    this.apply(doc, -1);
  }

  build(store) {
    const rows = store.rows;
    for (let r = 0; r < rows.length; r++) {
      const doc = rows[r];
      if (doc !== null && doc !== undefined) this.apply(doc, 1);
    }
    return this;
  }

  /**
   * The group's sum as a scan would report it: a canonical money token, or `0` when the group
   * exists but nothing in it carried a value. `undefined` means there is no such group.
   * @throws on mixed currencies — FD-1's refusal, not a failure of this index.
   */
  groupValue(groupKey) {
    const g = this.groups.get(groupKey);
    if (g === undefined) return undefined;
    const v = g.acc.value();
    return v === null ? 0 : v;
  }

  groupCount(groupKey) {
    const g = this.groups.get(groupKey);
    return g === undefined ? 0 : g.members;
  }

  /** Every group as `[rawKey, value]`, unordered; the caller sorts. */
  allSums() {
    const out = [];
    for (const g of this.groups.values()) {
      const v = g.acc.value();
      out.push([g.raw, v === null ? 0 : v]);
    }
    return out;
  }

  allCounts() {
    const out = [];
    for (const g of this.groups.values()) out.push([g.raw, g.members]);
    return out;
  }

  dump() {
    const keys = [...this.groups.keys()].sort(compareStrings);
    return {
      field: this.field,
      by: this.by,
      usable: this.usable,
      groupable: this.groupable,
      missingKeys: this.missingKeys,
      groups: keys.map((k) => {
        const g = this.groups.get(k);
        let v;
        try {
          v = g.acc.value();
        } catch (e) {
          v = `!${e.code}`;
        }
        return [k, g.members, v];
      }),
    };
  }
}

// ===========================================================================
// PART 3 — the query planner
//
// ## The rule, in one sentence
//
// **Serve the candidate set from the single most selective indexed predicate, then let the pipeline
// apply every predicate to every candidate.**
//
// There is deliberately no attempt to intersect two indexes, and that looks like a missing feature,
// so: intersecting index *A* with index *B* costs `|A| + |B|`, whereas producing *A* and then
// filtering it with *B*'s predicate — which the pipeline does anyway, for free, as part of checking
// the row matches — costs `|A|`. The planner picks the smaller of the two, so filtering is never
// worse and usually better. Intersection only wins with a *composite* index, which is a different
// structure and is named in README.md as the measured next step rather than half-built here.
//
// ## The four candidate sources, best first
//
// 1. **Primary key** — `id = x`. One lookup. Handled in `query.js`.
// 2. **Equality / `in`** — hash buckets. The estimate is *exact*: it is the bucket size.
// 3. **Range** — binary search, then union the buckets. The estimate is
//    `keys in range × average bucket size`, which is a genuine estimate and is labelled as one.
//    There are no histograms, so a skewed field can be mis-estimated; the consequence is a slower
//    plan, never a wrong answer.
// 4. **Join-driven** — for `where: { 'customer.region': 'Bavaria' }`, look up Bavarian customers in
//    the customer index, then collect invoices through the `invoice.customer` index. The only plan
//    that can start from a predicate on a document the result rows are not.
//
// And one non-plan: if the best estimate still covers more than half the entity, the planner
// returns `null` and the pipeline scans. Walking an index to visit 600 000 of a million rows is
// slower than walking the million, and pretending otherwise is how "we added indexes" becomes a
// regression.
//
// ## Safety
//
// Every function here may only return a **superset** of the matching rows. Where that cannot be
// guaranteed — a lexicographic comparison against a field that also holds FD-1 money tokens, where
// `"4999.99 EUR" > "2027"` is true as text but the money keys do not live in the text domain — the
// planner declines the predicate. Declining costs a scan; guessing costs a wrong report.
// ===========================================================================

/** Below this many documents an index is not worth building; the scan is already fast. */
export const DEFAULT_INDEX_THRESHOLD = 256;

/** If the best plan still returns this share of the entity, scanning is cheaper. */
const SCAN_RATIO = 0.5;

/** A join-driven plan with more peers than this is not worth the fan-out loop. */
const MAX_JOIN_FANOUT = 50000;

/**
 * Separator for the composite keys `Secondary` uses (`entity` + field, `entity` + field + groupBy).
 *
 * `U+0000` and not a space, because an entity or a field path may legitimately contain a space and a
 * space separator would make `'a b' + ' ' + 'c'` and `'a' + ' ' + 'b c'` the same key — two different
 * indexes sharing one slot, which is a wrong report waiting for a model that names a field
 * `"order date"`. Written as an **escape** rather than as a literal control character in the source,
 * because a raw NUL byte in a `.js` file makes `grep`, `ripgrep` and `grep -I` treat this file as
 * *binary* and silently skip it — and gate condition 2 is "no float in any monetary path, asserted by
 * a test that greps the runtime". A file a reviewer's grep cannot read is not auditable, whatever the
 * test says.
 */
const KEY_SEP = '\u0000';

/** Default caps, so a long-lived session cannot index its way out of memory unnoticed. */
const DEFAULT_MAX_FIELD_INDEXES = 96;
const DEFAULT_MAX_AGG_INDEXES = 32;

/** The smallest string greater than every string starting with `p`, or null for "no end". */
function prefixUpper(p) {
  for (let i = p.length - 1; i >= 0; i--) {
    const c = p.charCodeAt(i);
    if (c < 0xffff) return p.slice(0, i) + String.fromCharCode(c + 1);
  }
  return null; // p is all U+FFFF: nothing sorts above it
}

/**
 * Can this clause be served from a single-field index without risking a subset?
 * @returns {{kind:'keys', keys:string[]} | {kind:'range', ...} | null}
 */
function serviceable(fi, cl) {
  const op = cl.op;
  if (op === '=') {
    const key = encodeKey(cl.value);
    return key === null ? null : { kind: 'keys', keys: [key] };
  }
  if (op === 'in') {
    const keys = [];
    for (const v of cl.value) {
      const k = encodeKey(v);
      if (k === null) return null; // `in [..., null]` also matches missing values — scan it
      keys.push(k);
    }
    return { kind: 'keys', keys: [...new Set(keys)] };
  }
  if (op === 'starts with') {
    if (typeof cl.value !== 'string') return null;
    // A money-valued document is keyed under `m:`, but as *text* it can still start with the
    // prefix, so the text domain would be a subset. Decline.
    if (fi.money !== null) return null;
    const hi = prefixUpper(cl.value);
    return {
      kind: 'range',
      domain: 'str',
      code: null,
      lo: `s:${cl.value}`,
      loInc: true,
      hi: hi === null ? null : `s:${hi}`,
      hiInc: false,
    };
  }
  const bounds = op === 'between' ? [cl.value[0], cl.value[1]] : [cl.value];
  const keys = bounds.map(encodeKey);
  if (keys.some((k) => k === null)) return null;
  const domains = keys.map(domainOf);
  if (domains.some((d) => d === null)) return null; // booleans have no order index
  if (domains[0] !== domains[domains.length - 1]) return null; // `between [1, 'a']` — scan it
  const domain = domains[0];
  // The one genuinely dangerous combination: comparing a field lexicographically when some of its
  // documents hold money. Those rows are not in the text domain, and a subset is a short report.
  if (domain === 'str' && fi.money !== null) return null;
  const code = domain === 'money' ? keyToMoney(keys[0]).code : null;
  if (domain === 'money' && keys.length === 2 && keyToMoney(keys[1]).code !== code) return null;

  if (op === 'between') {
    return { kind: 'range', domain, code, lo: keys[0], loInc: true, hi: keys[1], hiInc: true };
  }
  if (op === '>') return { kind: 'range', domain, code, lo: keys[0], loInc: false, hi: null, hiInc: false };
  if (op === '>=') return { kind: 'range', domain, code, lo: keys[0], loInc: true, hi: null, hiInc: false };
  if (op === '<') return { kind: 'range', domain, code, lo: null, loInc: false, hi: keys[0], hiInc: false };
  if (op === '<=') return { kind: 'range', domain, code, lo: null, loInc: false, hi: keys[0], hiInc: true };
  return null;
}

function estimateAndProduce(fi, s) {
  if (s.kind === 'keys') {
    let est = 0;
    for (const k of s.keys) est += fi.bucketSize(k);
    return {
      est,
      exact: true,
      produce: () => {
        const rows = [];
        for (const k of s.keys) fi.collect(k, rows);
        return rows;
      },
    };
  }
  const sorted = fi.sortedFor(s.domain, s.code);
  if (sorted === null) return { est: 0, exact: true, produce: () => [] };
  const nKeys = sorted.countRange(s.lo, s.loInc, s.hi, s.hiInc);
  const est = Math.ceil(nKeys * fi.avgBucket());
  return {
    est,
    exact: false,
    produce: () => {
      const rows = [];
      for (const k of sorted.range(s.lo, s.loInc, s.hi, s.hiInc)) fi.collect(k, rows);
      return rows;
    },
  };
}

// ===========================================================================
// PART 4 — materialize / update / indexOf, and the Index surface
// ===========================================================================

/**
 * Classify one blob. Never throws.
 * @returns {{state:'readable', doc:Doc} | {state:'opaque'|'invalid', reason:string}}
 */
function classify(bytes, entity, id) {
  if (bytes === null || bytes === undefined) {
    return { state: 'opaque', reason: 'blob not available' };
  }
  let text;
  try {
    text = typeof bytes === 'string' ? bytes : UTF8.decode(bytes);
  } catch {
    return { state: 'opaque', reason: 'not valid UTF-8 (encrypted or binary)' };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { state: 'opaque', reason: 'not valid JSON (encrypted or corrupt)' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { state: 'invalid', reason: 'JSON is not a document object' };
  }
  if (raw.entity !== undefined && raw.entity !== entity) {
    return { state: 'invalid', reason: `entity "${raw.entity}" contradicts its path` };
  }
  if (raw.id !== undefined && String(raw.id) !== id) {
    return { state: 'invalid', reason: `id "${raw.id}" contradicts its path` };
  }
  const doc = raw.entity === entity && raw.id === id ? raw : { ...raw, entity, id };
  return { state: 'readable', doc };
}

// ---------------------------------------------------------------------------
// Value interning — the second half of the memory work, and the cheapest of it
//
// `JSON.parse` allocates a fresh string for every string *value* it decodes. A general ledger is
// mostly low-cardinality text repeated millions of times: `"posting"`, `"EUR"`, `"debit"`, an
// account number from a chart of four hundred. At the 1 M-document scale those four fields are
// ~110 of the ~200 bytes a parsed posting occupies, and every copy is byte-identical to the last.
//
// Replacing them with one shared instance is **semantically invisible**: JavaScript strings are
// immutable primitives and `===` compares by value, so no program can observe which instance it
// holds. That is the whole safety argument, and it is a proof rather than a test.
//
// The hard part is not interning, it is knowing *what not to intern*. A dictionary fed every value
// would fill with document ids and monetary amounts — unique by construction — and never reach the
// repeated ones. So the decision is made **per field**: a field accumulates a dictionary until it
// exceeds `INTERN_MAX_DISTINCT` distinct values, at which point it declines permanently and its
// dictionary is released. `id` and `amount` therefore pay a bounded toll and then step aside, while
// `entity`, `currency` and `side` are interned for the life of the index.
//
// It can only ever be *ineffective*, never wrong, and `indexStats().interning` reports which it was.
// ---------------------------------------------------------------------------

/** A field with more distinct values than this is not worth a dictionary. */
const INTERN_MAX_DISTINCT = 4096;
/** Total dictionary entries across every entity and field. Bounds the interner at ~2–3 MB. */
const INTERN_BUDGET = 1 << 16;
/** A long value is unlikely to repeat and costs more to hash than it can save. */
const INTERN_MAX_LEN = 64;

class Interner {
  constructor() {
    /** @type {Map<string, Map<string, Map<string,string>|false>>} entity → field → dictionary */
    this.byEntity = new Map();
    this.size = 0;
    this.hits = 0;
    this.declinedFields = 0;
  }

  /**
   * Canonicalise the short top-level string values of one freshly parsed document, in place.
   *
   * Only ever called on an object this module has just built from bytes, never on a document a
   * caller handed us — `indexOf()` receives objects its caller still owns, and mutating those would
   * be a side effect this directory does not get to have.
   *
   * Nested objects are deliberately left alone: each one is its own allocation, which interning
   * cannot fix, and one level of recursion for a rare shape is not worth the per-document branch.
   */
  apply(entity, doc) {
    let fields = this.byEntity.get(entity);
    if (fields === undefined) {
      fields = new Map();
      this.byEntity.set(entity, fields);
    }
    const names = Object.keys(doc);
    for (let i = 0; i < names.length; i++) {
      const k = names[i];
      const v = doc[k];
      if (typeof v !== 'string' || v.length === 0 || v.length > INTERN_MAX_LEN) continue;
      let m = fields.get(k);
      if (m === false) continue;
      if (m === undefined) {
        if (this.size >= INTERN_BUDGET) continue;
        m = new Map();
        fields.set(k, m);
      }
      const got = m.get(v);
      if (got !== undefined) {
        // Assigned **unconditionally**, and that is the whole mechanism: `got !== v` is a *value*
        // comparison for strings, so JavaScript offers no way to ask whether two equal strings are
        // the same allocation. Guarding the write on it — which this code did until the benchmark
        // reported `hits: 0` at every scale — makes the interner a pure cost: it pays a Map lookup
        // per field per document, holds a dictionary, and never replaces anything. The write is
        // semantically invisible either way (strings are immutable primitives compared by value),
        // so the only honest form is to always hand the document the dictionary's instance.
        doc[k] = got;
        this.hits++;
        continue;
      }
      if (m.size >= INTERN_MAX_DISTINCT || this.size >= INTERN_BUDGET) {
        // High-cardinality: give the budget back and stop paying a lookup per document for it.
        this.size -= m.size;
        fields.set(k, false);
        this.declinedFields++;
        continue;
      }
      m.set(v, v);
      this.size++;
    }
  }

  report() {
    let fields = 0;
    for (const byField of this.byEntity.values()) {
      for (const m of byField.values()) if (m !== false) fields++;
    }
    return { interned: this.size, fields, declinedFields: this.declinedFields, hits: this.hits };
  }
}

/**
 * `indexOf()`'s documents belong to its caller. Interning them would mean writing to an object this
 * module was merely shown, which nothing in this directory is allowed to do — README.md's first
 * sentence is that nothing here writes anything anywhere, and a caller's object is somewhere.
 */
const NO_INTERN = {
  apply() {},
  report() {
    return { interned: 0, fields: 0, declinedFields: 0, hits: 0 };
  },
};

/**
 * A whole tree as **one sorted array of paths plus a lookup**, never as an array of pairs.
 *
 * This looks like a micro-optimisation and is the difference between three and four million
 * documents in a 2 GB heap. The previous form collected the tree into `[[path, oid], …]` first —
 * at four million paths that is ~240 MB of two-element arrays, live for the whole of
 * `streamIngest()`, on top of the caller's map and the index being built. It is invisible in a
 * post-collection memory reading and it is exactly what a peak-memory limit measures: the 4 M run
 * died with "ineffective mark-compacts near heap limit" while its *settled* size was 1.75 GB.
 *
 * A sorted `string[]` costs one pointer per path and nothing else. A `Map` — what
 * `runtime/git/`'s `readTreeAtHead()` returns — is answered without copying a single value; any other
 * iterable of pairs, including a generator, goes through two parallel arrays and a permutation.
 */
function sortedPathList(tree) {
  if (tree instanceof Map) {
    const paths = new Array(tree.size);
    let i = 0;
    for (const k of tree.keys()) paths[i++] = k;
    paths.sort(compareStrings);
    return { paths, oidOf: (p) => tree.get(p) ?? null };
  }
  // Any other iterable of `[path, oid]` pairs — including a generator, so a caller *can* stream a
  // tree instead of materialising a map of it. Two parallel arrays and a permutation, again with no
  // pair array of our own: the pairs the iterable yields are the caller's and are released as we go.
  const paths = [];
  const oids = [];
  for (const e of iteratePairs(tree)) {
    paths.push(e[0]);
    oids.push(e[1]);
  }
  const order = new Array(paths.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  order.sort((a, b) => compareStrings(paths[a], paths[b]));
  const sorted = new Array(order.length);
  for (let i = 0; i < order.length; i++) sorted[i] = paths[order[i]];
  return { paths: sorted, oidOf: (_p, i) => oids[order[i]] };
}

/** `[path, oid]` pairs out of whatever shape a caller handed us. Yields; never collects. */
function* iteratePairs(x) {
  if (x === undefined || x === null) return;
  if (Array.isArray(x)) {
    for (const e of x) yield Array.isArray(e) ? e : [e.path, e.oid ?? null];
    return;
  }
  if (typeof x[Symbol.iterator] === 'function') {
    for (const e of x) yield Array.isArray(e) ? e : [e.path, e.oid ?? null];
    return;
  }
  for (const k of Object.keys(x)) yield [k, x[k]];
}

function normalizeOptions(o) {
  const threshold = o.indexThreshold === undefined ? DEFAULT_INDEX_THRESHOLD : o.indexThreshold;
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new TypeError('indexThreshold must be a non-negative integer');
  }
  return {
    threshold,
    maxFields: o.maxFieldIndexes ?? DEFAULT_MAX_FIELD_INDEXES,
    maxAggs: o.maxAggIndexes ?? DEFAULT_MAX_AGG_INDEXES,
    /**
     * The columnar projection (FD-10 item 1). On by default. `columnar: false` exists so the
     * benchmark can measure the boxed path back-to-back on one machine — a claim about a layout is
     * worth what its A/B measurement is worth — and as an escape hatch if a caller is memory-bound
     * rather than latency-bound: a column costs 4 bytes a row per index.
     */
    columnar: o.columnar !== false,
    hints: normalizeHints(o.indexHints, o.model, o.eagerFromModel === true),
    aggHints: Array.isArray(o.aggregateHints) ? o.aggregateHints.slice() : [],
  };
}

/**
 * Index hints. `{ entity, field }` pairs, plus — when `eagerFromModel` is set — everything the
 * model says is worth indexing: reference fields (a join cannot be planned without them), and
 * `money` / `date` / `number` fields (the only ones a range predicate can address).
 *
 * Eager building from the model is **opt-in**, not the default, and that is a considered choice
 * rather than laziness: pre-building every declared field of every entity is what makes an
 * in-memory index run out of memory at a million documents (README.md has the measurement). The
 * default is to build an index the first time a query needs one and keep it maintained thereafter,
 * so index memory is proportional to the questions actually asked.
 */
function normalizeHints(hints, model, eager) {
  const out = [];
  const seen = new Set();
  const add = (entity, field) => {
    const k = `${entity}${KEY_SEP}${field}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ entity, field });
  };
  if (Array.isArray(hints)) {
    for (const h of hints) {
      if (h === null || typeof h !== 'object' || typeof h.entity !== 'string' || typeof h.field !== 'string') {
        throw new TypeError('indexHints entries must be { entity, field }');
      }
      add(h.entity, h.field);
    }
  } else if (hints !== undefined && hints !== null) {
    throw new TypeError('indexHints must be an array of { entity, field }');
  }
  if (eager && model !== undefined && model !== null && model.entities instanceof Map) {
    for (const [entity, def] of model.entities) {
      if (!(def.fields instanceof Map)) continue;
      for (const [field, fd] of def.fields) {
        if (fd.type === 'reference' || fd.type === 'money' || fd.type === 'date' || fd.type === 'number') {
          add(entity, field);
        }
      }
      if (Array.isArray(def.identifiedBy)) for (const f of def.identifiedBy) add(entity, f);
    }
  }
  return out;
}

/**
 * The secondary indexes of one index version. Mutable, singly owned, revoked by `update()`.
 */
class Secondary {
  constructor(opts) {
    this.opts = opts;
    /** @type {Map<string, FieldIndex|false>} */
    this.fields = new Map();
    /** @type {Map<string, AggIndex|false>} */
    this.aggs = new Map();
    /** entity → the maintainers that have to see every change. */
    this.perEntity = new Map();
    this.builtFields = 0;
    this.builtAggs = 0;
  }

  maintainers(entity) {
    let m = this.perEntity.get(entity);
    if (m === undefined) {
      m = [];
      this.perEntity.set(entity, m);
    }
    return m;
  }

  register(entity, ix) {
    this.maintainers(entity).push(ix);
  }

  /** Everything this entity had is dropped when the entity itself disappears from the index. */
  forget(entity) {
    this.perEntity.delete(entity);
    for (const k of [...this.fields.keys()]) {
      if (k.startsWith(`${entity}${KEY_SEP}`)) {
        if (this.fields.get(k) !== false) this.builtFields--;
        this.fields.delete(k);
      }
    }
    for (const k of [...this.aggs.keys()]) {
      if (k.startsWith(`${entity}${KEY_SEP}`)) {
        if (this.aggs.get(k) !== false) this.builtAggs--;
        this.aggs.delete(k);
      }
    }
  }

  /** @returns {FieldIndex|null} */
  field(entity, ref, store) {
    const key = `${entity}${KEY_SEP}${ref}`;
    const have = this.fields.get(key);
    if (have !== undefined) return have === false ? null : have;
    if (store === null || store.count < this.opts.threshold) return null;
    if (this.builtFields >= this.opts.maxFields) {
      this.fields.set(key, false); // capped: scan from here on, loudly reported by indexStats()
      return null;
    }
    const fi = new FieldIndex(entity, ref, this.opts.columnar).build(store);
    this.fields.set(key, fi);
    this.builtFields++;
    this.register(entity, fi);
    return fi;
  }

  /** @returns {AggIndex|null} */
  agg(entity, field, by, store) {
    const key = `${entity}${KEY_SEP}${field ?? ''}${KEY_SEP}${by ?? ''}`;
    const have = this.aggs.get(key);
    if (have !== undefined) return have === false ? null : have;
    if (store === null || store.count < this.opts.threshold) return null;
    if (this.builtAggs >= this.opts.maxAggs) {
      this.aggs.set(key, false);
      return null;
    }
    const ix = new AggIndex(entity, field, by).build(store);
    if (!ix.usable) {
      // A plain-number field: a maintained double is not order-independent, so this must never
      // answer a query. Remembered as a refusal so it is not rebuilt on the next call.
      this.aggs.set(key, false);
      return null;
    }
    this.aggs.set(key, ix);
    this.builtAggs++;
    this.register(entity, ix);
    return ix;
  }

  sweep() {
    for (const fi of this.fields.values()) if (fi !== false) fi.sweep();
  }
}

/**
 * Build the whole index from a git tree. Appendix VI's "full materialization".
 *
 * `readTree()` may return a `Map<path, oid>` — what `runtime/git/`'s `readTreeAtHead()` returns
 * today — or **any iterable of `[path, oid]` pairs, including a generator**. The second form is
 * accepted because the map is measurably part of the memory ceiling: 150 bytes per path, 571 MB at
 * four million documents, before a single document is indexed (README.md §8.4). A `readTree` that
 * *yields* pairs costs 16 bytes per path here instead, and nothing in this module holds the pairs.
 * Additive: every existing caller keeps working unchanged.
 *
 * @param {{ readTree: () => Promise<Map<string,OID>|Iterable<[string,OID]>>,
 *           readBlob: (oid: OID) => Promise<Bytes>,
 *           builtFrom?: OID|null,
 *           model?: object,
 *           eagerFromModel?: boolean,
 *           indexHints?: {entity:string, field:string}[],
 *           aggregateHints?: {entity:string, field?:string, by?:string}[],
 *           indexThreshold?: number,
 *           maxFieldIndexes?: number, maxAggIndexes?: number }} o
 * @returns {Promise<Index>}
 */
export async function materialize(o) {
  if (o === null || typeof o !== 'object') {
    throw new TypeError('materialize() needs { readTree, readBlob }');
  }
  const { readTree, readBlob, builtFrom = null } = o;
  if (typeof readTree !== 'function' || typeof readBlob !== 'function') {
    throw new TypeError('materialize() needs { readTree, readBlob } as functions');
  }
  const opts = normalizeOptions(o);
  const { paths, oidOf } = sortedPathList(await readTree());

  const st = newState(new Map(), new PMap(), new Secondary(opts), false, new Interner());
  await streamIngest(st, paths, oidOf, readBlob);
  pruneEmpty(st);
  seal(st);
  applyHints(st, opts);
  return makeIndex(st.entities, st.notes, builtFrom, opts, st.sec, st.interner);
}

function readOne(readBlob, path, oid) {
  if (parseDocPath(path) === null) return null; // don't read what we won't index
  try {
    return Promise.resolve(readBlob(oid, path)).then(
      (v) => v,
      (e) => (e instanceof Error ? e : new Error(String(e))),
    );
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Read and ingest in windows, so at most `READ_WINDOW` blobs are alive at once.
 *
 * v0.1 read *every* blob into one array and then ingested. At twenty thousand documents that is
 * invisible; at two million it holds two million byte arrays — several hundred megabytes of
 * plaintext that has already been parsed — alongside the index being built, and the garbage
 * collector spends the whole materialisation on it. The fix is not clever, it is just necessary at
 * scale, and the only reason it is here is that the benchmark went looking.
 */
async function streamIngest(st, paths, oidOf, readBlob) {
  for (let i = 0; i < paths.length; i += READ_WINDOW) {
    const end = Math.min(i + READ_WINDOW, paths.length);
    const pending = [];
    for (let k = i; k < end; k++) pending.push(readOne(readBlob, paths[k], oidOf(paths[k], k)));
    const got = await Promise.all(pending);
    for (let k = 0; k < got.length; k++) ingest(st, paths[i + k], got[k]);
  }
}

/**
 * The mutable state a build or an update works through. `maintain` says whether secondary indexes
 * must be kept current document by document (an update) or will be built in one pass afterwards
 * (a materialization). It is the only difference between the two paths, which is exactly why they
 * cannot produce different indexes.
 */
function newState(entities, notes, sec, maintain, interner) {
  return { entities, notes, sec, maintain, interner, touched: new Set() };
}

/**
 * ## Why `notes` and not `paths` — the largest single memory win in this module
 *
 * Wave 1 kept one record per path in the repository: `{entity, id, state, reason}` under a
 * `documents/<entity>/<id>.json` key. Measured on the 1 M-document ladder, that map was **≈136 of
 * the 415 bytes a document cost** — a third of the ceiling — and for a *readable* document every
 * byte of it is derivable from data the index already holds:
 *
 *  * the path is `docPath(entity, id)`, and `parseDocPath` is its exact inverse;
 *  * `state` is `'readable'` precisely when the entity store holds that id;
 *  * `reason` is `null`, always.
 *
 * So `notes` holds a record **only for a path that produced no document**: opaque bytes (Appendix
 * VII's normal condition), invalid JSON, and non-document paths. `stats().readable` is the sum of the
 * stores' counts and `stats().paths` is that plus `notes.size` — the same two numbers, from the
 * structure that was already authoritative for them.
 *
 * The one thing this removes is a *second* opinion about what a path contributed, and Wave 1 proved
 * twice over (COMPROMISES #3's residuals, the kernel's coverage check) that a second opinion which
 * can disagree with the first is a defect waiting for a schedule. There is now exactly one.
 */

function storeFor(st, entity) {
  let s = st.entities.get(entity);
  if (s === undefined) {
    s = new EntityStore();
    st.entities.set(entity, s);
    st.touched.add(entity);
    return s;
  }
  if (st.maintain && !st.touched.has(entity)) {
    st.touched.add(entity);
    s = s.derive();
    st.entities.set(entity, s);
  }
  return s;
}

function putDoc(st, entity, id, doc) {
  const store = storeFor(st, entity);
  const { row, prev } = store.put(doc);
  if (st.maintain) {
    const ms = st.sec.perEntity.get(entity);
    if (ms !== undefined) {
      if (prev !== null && prev !== undefined) for (const ix of ms) ix.removeRow(row, prev);
      for (const ix of ms) ix.addRow(row, doc);
    }
  }
}

function removeDoc(st, entity, id) {
  const existing = st.entities.get(entity);
  if (existing === undefined) return;
  if (existing.rowOf(id) < 0) return; // nothing here: do not derive a store to learn that
  const store = storeFor(st, entity);
  const gone = store.remove(id);
  if (gone === null) return;
  if (st.maintain) {
    const ms = st.sec.perEntity.get(entity);
    if (ms !== undefined) for (const ix of ms) ix.removeRow(gone.row, gone.prev);
  }
}

/**
 * One place where a path's contribution to the index is decided, used by both `materialize()`
 * and `update()`. That shared code path is *why* rebuild and incremental cannot drift.
 */
function ingest(st, path, bytesOrError) {
  const target = parseDocPath(path);

  if (target === null) {
    // Not a document — operating-model/*.md, manifests, keys. Tracked, not indexed, so a
    // fresh rebuild and an incremental update report the same `ignored` count. `parseDocPath` is a
    // pure function of the string, so a path is a document path or is not, once and for all: this
    // branch can never be undoing a document.
    st.notes.set(path, IGNORED);
    return;
  }

  // Whatever this path contributed before (matters only for `update()`): a document if the entity
  // store holds that id, otherwise a note. The store is asked rather than a parallel record, which
  // is the whole reason a readable document costs no path bookkeeping at all — see `notes`.
  removeDoc(st, target.entity, target.id);

  const result =
    bytesOrError instanceof Error
      ? { state: 'opaque', reason: `read failed: ${bytesOrError.message}` }
      : classify(bytesOrError, target.entity, target.id);

  if (result.state === 'readable') {
    st.notes.delete(path);
    st.interner.apply(target.entity, result.doc);
    putDoc(st, target.entity, target.id, result.doc);
  } else {
    st.notes.set(path, { state: result.state, reason: result.reason });
  }
}

/**
 * One shared record for every non-document path in the repository. There is nothing per-path to say
 * about `README.md` beyond "not a document", so there is no reason to allocate an object per path
 * to say it.
 */
const IGNORED = Object.freeze({ state: 'ignored', reason: 'not a document path' });

/**
 * Everything a full build put in an overlay belongs in the base, so the next `update()` derives
 * from it for free. Only ever called after `materialize()` / `indexOf()`, never inside `update()` —
 * there the amortised threshold in `compact()` is the right rule.
 */
function seal(st) {
  st.notes.seal();
  for (const store of st.entities.values()) store.seal();
}

/** An entity nobody can read a single document of is absent, not empty (Appendix VII). */
function pruneEmpty(st) {
  for (const [entity, s] of [...st.entities]) {
    if (s.count === 0) {
      st.entities.delete(entity);
      st.sec.forget(entity);
    }
  }
}

function applyHints(st, opts) {
  for (const h of opts.hints) {
    const store = st.entities.get(h.entity);
    if (store !== undefined) st.sec.field(h.entity, h.field, store);
  }
  for (const h of opts.aggHints) {
    const store = st.entities.get(h.entity);
    if (store !== undefined) st.sec.agg(h.entity, h.field ?? null, h.by ?? null, store);
  }
}

/**
 * Incremental update — Appendix VI line 204's "after that, incremental".
 *
 * Pure with respect to documents: `index` keeps reporting what it reported. Its *secondary
 * indexes* are handed to the returned version and revoked here; the old index rebuilds them from
 * its own documents if it is queried again, so it stays correct and merely slower. That is the
 * whole point of an index being a view.
 *
 * @param {Index} index                        the previous index
 * @param {{ changed?: Map<string,OID>|Iterable<[string,OID]>,
 *           removed?: string[],
 *           readBlob: (oid: OID) => Promise<Bytes>,
 *           builtFrom?: OID|null }} o
 * @returns {Promise<Index>}
 */
export async function update(index, o) {
  const prev = INTERNALS.get(index);
  if (prev === undefined) throw new TypeError('update() needs an index from this module');
  if (o === null || typeof o !== 'object') {
    throw new TypeError('update() needs { changed, removed, readBlob }');
  }
  const { changed, removed = [], readBlob, builtFrom = null } = o;
  const changedList = sortedPathList(changed);
  if (changedList.paths.length > 0 && typeof readBlob !== 'function') {
    throw new TypeError('update() needs readBlob to read changed paths');
  }

  const opts = prev.opts;
  const sec = prev.takeSecondary() ?? new Secondary(opts);
  // An index built by `indexOf()` has no interner because its documents were the caller's. The ones
  // `update()` parses from bytes are ours, so it starts one.
  const interner = prev.interner === NO_INTERN ? new Interner() : prev.interner;
  const st = newState(new Map(prev.entities), prev.notes.derive(), sec, true, interner);

  for (const path of removed) {
    // Removing what we never had is a no-op, not an error: both halves below are no-ops on an
    // unknown path, so no membership test is needed.
    const target = parseDocPath(path);
    if (target !== null) removeDoc(st, target.entity, target.id);
    st.notes.delete(path);
  }

  await streamIngest(st, changedList.paths, changedList.oidOf, readBlob);

  pruneEmpty(st);
  applyHints(st, opts);
  st.notes.compact();
  for (const entity of st.touched) {
    const s = st.entities.get(entity);
    if (s !== undefined) s.compact();
  }
  sec.sweep();
  return makeIndex(st.entities, st.notes, builtFrom, opts, sec, st.interner);
}

/**
 * Build an index straight from documents — for tests, for the live layer's snapshots, and for
 * anything that already holds parsed docs. Same internal shape as `materialize()`.
 * @param {Doc[]} docs
 * @param {object} [o] the same index options `materialize()` takes
 * @returns {Index}
 */
export function indexOf(docs, o = {}) {
  if (!Array.isArray(docs)) throw new TypeError('indexOf() needs an array of documents');
  const opts = normalizeOptions(o);
  const st = newState(new Map(), new PMap(), new Secondary(opts), false, NO_INTERN);
  for (const doc of docs) {
    if (doc === null || typeof doc !== 'object') throw new TypeError('indexOf(): not a document');
    const entity = doc.entity;
    const id = doc.id === undefined || doc.id === null ? undefined : String(doc.id);
    if (typeof entity !== 'string' || entity.length === 0 || id === undefined || id.length === 0) {
      throw new TypeError('indexOf(): every document needs a non-empty `entity` and `id`');
    }
    putDoc(st, entity, id, doc);
  }
  pruneEmpty(st);
  seal(st);
  applyHints(st, opts);
  return makeIndex(st.entities, st.notes, null, opts, st.sec, st.interner);
}

/**
 * @typedef {{ all(entity: string): readonly Doc[],
 *             get(entity: string, id: string): Doc|null,
 *             where(entity: string, pred: (d: Doc) => boolean): Doc[],
 *             select(q: Query): Doc[]|number|string|Map<unknown, number|string|Doc[]>,
 *             sum(entity: string, field: string, where?: object): number|string,
 *             count(entity: string, where?: object): number,
 *             explain(q: Query): {plan: string, candidates?: number},
 *             ensureIndex(entity: string, field: string): boolean,
 *             entities(): string[],
 *             stats(): {entities: Record<string, number>, builtFrom: OID|null,
 *                       readable: number, opaque: number, invalid: number,
 *                       ignored: number, paths: number},
 *             indexStats(): object,
 *             verifyIndexes(): {index: string, problem: string}[],
 *             problems(): {path: string, state: string, reason: string}[] }} Index
 */
function makeIndex(entities, notes, builtFrom, opts, secondary, interner) {
  /** Sorted-by-id snapshots, computed once. Safe to cache: an index is immutable. */
  const sorted = new Map();
  const EMPTY = Object.freeze([]);
  let sec = secondary;

  /** A revoked handle rebuilds itself — the index is a view, so this is always safe. */
  const secOf = () => {
    if (sec === null) sec = new Secondary(opts);
    return sec;
  };
  const storeOf = (entity) => entities.get(entity) ?? null;
  const ensureField = (entity, ref) => secOf().field(entity, ref, storeOf(entity));
  const ensureAgg = (entity, field, by) => secOf().agg(entity, field, by, storeOf(entity));

  const idx = {
    /**
     * All documents of an entity, id-ascending — a total order, so *every* downstream result
     * is deterministic even with no `orderBy`. Frozen: the index is a view, and a caller
     * mutating it would be corrupting a cache. Empty array for an entity this peer cannot
     * read a single document of (Appendix VII), never a throw.
     *
     * At a million documents the first call sorts a million id strings. That cost is real, it is
     * measured in README.md, and it is why the query pipeline asks for `scan()` whenever the
     * answer cannot depend on row order.
     */
    all(entity) {
      let arr = sorted.get(entity);
      if (arr !== undefined) return arr;
      const store = entities.get(entity);
      if (store === undefined) return EMPTY;
      const docs = store.liveDocs();
      docs.sort((a, b) => compareStrings(String(a.id), String(b.id)));
      arr = Object.freeze(docs);
      sorted.set(entity, arr);
      return arr;
    },

    /** Every document of an entity in arbitrary (row) order. Cheaper than `all()` by a sort. */
    scan(entity) {
      const store = entities.get(entity);
      return store === undefined ? EMPTY : store.liveDocs();
    },

    get(entity, id) {
      const store = entities.get(entity);
      if (store === undefined) return null;
      return store.get(String(id));
    },

    where(entity, pred) {
      if (typeof pred !== 'function') throw new TypeError('where() needs a predicate');
      return idx.all(entity).filter(pred);
    },

    select(q) {
      return runSelect(idx, q);
    },

    /**
     * `sum of <field> over <entity> where <condition>` — the grammar v2 form (FD-5 #2), as the
     * rule engine calls it. Exact for money, index-backed, and equal to a scan by construction.
     */
    sum(entity, field, where, extra) {
      return runSelect(idx, { from: entity, sum: field, ...(where ? { where } : {}), ...extra });
    },

    /** `count of <entity> where <condition>`. O(1) for a single equality predicate. */
    count(entity, where, extra) {
      return runSelect(idx, { from: entity, count: true, ...(where ? { where } : {}), ...extra });
    },

    /**
     * `World.matching()` — grammar v2 §13.3, the contract agreed with agent G2.
     *
     * Documents of `entity` matching every `Filter` (`{field, op, value}`), or `null` for "I cannot
     * answer that". This index can always answer, so it never returns `null`; the escape exists for
     * a `World` that is not an index.
     *
     * The filters are exactly `query.js`'s `where` shape on purpose, so an aggregate compiles into
     * a plan rather than into rows the rule engine then has to sift. §13's rule that a `where` is a
     * single condition on a direct scalar field is what makes that true with no residual.
     */
    matching(entity, filters) {
      return runSelect(idx, { from: entity, where: filtersToWhere(filters) });
    },

    /**
     * `World.aggregate()` — grammar v2 §13.3. `sum of <field> over <entity> where …` and
     * `count of <entity> where …`, answered by the index.
     *
     * Cost, stated as a contract rather than a hope (README.md §Aggregation has the measurements):
     *
     *   * `count of E` — O(1).
     *   * `count of E where f = v` — O(1), from a bucket size.
     *   * `sum of <money field> over E where f = v` — O(1) from a maintained BigInt aggregate, which
     *     is what a general ledger calls on every posting.
     *   * anything else — O(candidates of the most selective filter). Never O(E).
     *
     * Two deliberate `null`s, because §13.3 says `null` means "ask me differently" and both of these
     * are better answered by the caller:
     *
     *   * a **money** sum over an empty set. §13's answer is the currency-free zero of §19.3, and
     *     this module has no way to spell that — the query language returns the number `0`, which
     *     polism would be right to refuse. So it declines and lets polism's own arithmetic produce
     *     the zero it means.
     *   * a **mixed-currency** sum. That is a correct refusal, not an inability, but `aggregate()`
     *     has no channel for a refusal. Declining hands the rows back and lets `runtime/money/`
     *     raise it, so exactly one module in the repository owns that error message.
     */
    aggregate(spec) {
      if (spec === null || typeof spec !== 'object') return null;
      const { kind, entity, field, fieldType, filter } = spec;
      if (kind !== 'sum' && kind !== 'count') return null;
      if (typeof entity !== 'string' || entity.length === 0) return null;
      let where;
      try {
        where = filtersToWhere(filter);
      } catch {
        return null; // a filter shape this index does not understand: ask differently
      }
      if (kind === 'count') {
        return { value: runSelect(idx, { from: entity, count: true, where }) };
      }
      if (typeof field !== 'string' || field.length === 0) return null;
      let value;
      try {
        value = runSelect(idx, { from: entity, sum: field, where });
      } catch (e) {
        if (e instanceof QueryError) return null;
        throw e;
      }
      if (fieldType === 'money' && typeof value !== 'string') return null;
      return { value };
    },

    /** Which plan the query would use, and how many candidates it would look at. */
    explain(q) {
      const c = compileQuery(idx, q);
      const pk = c.plain.find((cl) => cl.ref === 'id' && cl.op === '=');
      if (pk !== undefined) return { plan: 'primary key', candidates: 1 };
      const got = idx.candidates(q.from, {
        plain: c.plain.filter((cl) => INDEXABLE_OPS.has(cl.op)),
        viaJoin: c.overJoin
          .filter((cl) => INDEXABLE_OPS.has(cl.op))
          .map((cl) => ({ clause: cl, join: c.joins.find((j) => j.as === cl.alias) }))
          .filter((s) => s.join !== undefined),
      });
      if (got === null) return { plan: 'full scan', candidates: idx.scan(q.from).length };
      return { plan: got.plan, candidates: got.docs.length };
    },

    /** Build (and thereafter maintain) an index on this field. `false` if it was declined. */
    ensureIndex(entity, field) {
      return ensureField(entity, field) !== null;
    },

    /**
     * The planner. Returns a **superset** of the matching rows, or `null` for "scan". See PART 3.
     * Part of the `Source` contract in `query.js`, not a public API for callers.
     */
    candidates(entity, specs) {
      const store = storeOf(entity);
      if (store === null) return { docs: [], plan: 'entity not present in this index' };
      const n = store.count;
      if (n < opts.threshold) return null;

      let best = null;
      /**
       * Every plain clause a single-field index can serve as a superset, kept so that the ones the
       * chosen plan did *not* drive from can narrow it columnar-wise. This is index intersection —
       * which README.md §4 declined in Wave 1, correctly, for the structures Wave 1 had: intersecting
       * bucket set *A* with bucket set *B* costs `|A| + |B|`, so filtering *A* by *B*'s predicate was
       * never worse. A column changes that arithmetic completely: the intersection costs `|A|` dense
       * array loads at ~1 ns, against `|A|` predicate evaluations on boxed documents at 71–244 ns.
       * The Wave 1 argument is superseded by a measurement, not by a change of mind.
       */
      const served = [];
      for (const cl of specs.plain) {
        if (cl.ref === 'id') {
          if (cl.op !== 'in') continue;
          const rows = [];
          for (const v of cl.value) {
            const r = store.rowOf(String(v));
            if (r >= 0) rows.push(r);
          }
          const cand = {
            est: rows.length,
            plan: `id in (${cl.value.length} values)`,
            ref: 'id',
            produce: () => rows,
          };
          if (best === null || cand.est < best.est) best = cand;
          continue;
        }
        const fi = ensureField(entity, cl.ref);
        if (fi === null) continue;
        const s = serviceable(fi, cl);
        if (s === null) continue;
        const ep = estimateAndProduce(fi, s);
        const cand = {
          est: ep.est,
          plan: `${entity}.${cl.ref} ${cl.op} (${ep.exact ? 'exact' : 'est'} ${ep.est} of ${n})`,
          ref: cl.ref,
          produce: ep.produce,
        };
        served.push({ ref: cl.ref, fi, s, est: ep.est });
        if (best === null || cand.est < best.est) best = cand;
      }
      for (const spec of specs.viaJoin) {
        const cand = planViaJoin(entity, n, spec, best === null ? Infinity : best.est);
        if (cand !== null && (best === null || cand.est < best.est)) best = cand;
      }

      if (best === null) return null;

      let rows;
      let plan;
      if (best.est >= n * SCAN_RATIO) {
        // Wave 1 returned `null` here and the pipeline walked every document: "walking an index to
        // visit 600 000 of a million rows is slower than walking the million." That is still true of
        // an index *walk*. It is not true of a **column**: narrowing a million rows costs a million
        // sequential 4-byte loads, and only if that fails to narrow do we give up. So a bad estimate
        // — a skewed field, no histograms — now costs a columnar pass rather than a wrong plan.
        const scanned = columnarScan(store, served, n);
        if (scanned === null) return null;
        rows = scanned.rows;
        plan = scanned.plan;
      } else {
        rows = best.produce();
        plan = best.plan;
        const narrowed = columnarNarrow(rows, served, best.ref);
        if (narrowed !== null) {
          plan = `${plan} ∩ columnar ${narrowed.refs} → ${narrowed.rows.length}`;
          rows = narrowed.rows;
        }
      }

      const arr = store.rows;
      const docs = new Array(rows.length);
      let k = 0;
      for (let i = 0; i < rows.length; i++) {
        const d = arr[rows[i]];
        if (d !== null && d !== undefined) docs[k++] = d;
      }
      docs.length = k;
      // `servedRef` tells `query.js` which predicate this set already satisfies. It is a hint for
      // *ordering* the filter, never a licence to skip it — see `orderClauses()`.
      return { docs, plan, servedRef: best.ref ?? null };
    },

    /**
     * The aggregation contract, answered without touching a row. `null` means "not this shape" and
     * the ordinary pipeline runs instead — a near-miss is never approximated. See README.md
     * §Aggregation for the exact set of shapes and what each costs.
     */
    fastAggregate(shape) {
      const store = storeOf(shape.entity);
      if (store === null) return null;
      if (store.count < opts.threshold) return null;
      const w = shape.where;
      if (w.length > 1) return null;
      const eq = w.length === 1 ? w[0] : null;
      if (eq !== null && (eq.op !== '=' || eq.joined || eq.ref === 'id')) return null;

      // ---- count ----------------------------------------------------------
      if (shape.count) {
        if (shape.groupBy === undefined) {
          if (eq === null) return { value: store.count };
          const fi = ensureField(shape.entity, eq.ref);
          if (fi === null || fi.bigints !== 0) return null;
          const key = encodeKey(eq.value);
          if (key === null) return null;
          return { value: fi.bucketSize(key) };
        }
        if (eq !== null) return null;
        const ix = ensureAgg(shape.entity, null, shape.groupBy);
        if (ix === null || !ix.groupable) return null;
        return { value: sortedGroupMap(ix.allCounts()) };
      }

      // ---- sum ------------------------------------------------------------
      if (shape.sum === undefined) return null;
      if (shape.sum.includes('.')) return null; // nested paths: correct but not worth a structure
      if (shape.groupBy !== undefined) {
        if (eq !== null || shape.groupBy.includes('.')) return null;
        const ix = ensureAgg(shape.entity, shape.sum, shape.groupBy);
        if (ix === null || !ix.groupable) return null;
        return { value: sortedGroupMap(wrapSumErrors(() => ix.allSums(), shape.sum)) };
      }
      if (eq === null) {
        const ix = ensureAgg(shape.entity, shape.sum, null);
        if (ix === null || !ix.usable) return null;
        const v = wrapSumErrors(() => ix.groupValue(''), shape.sum);
        return { value: v === undefined ? 0 : v };
      }
      if (eq.ref.includes('.')) return null;
      const ix = ensureAgg(shape.entity, shape.sum, eq.ref);
      if (ix === null || !ix.usable || ix.bigintKeys !== 0) return null;
      const key = encodeKey(eq.value);
      if (key === null) return null;
      const v = wrapSumErrors(() => ix.groupValue(key), shape.sum);
      return { value: v === undefined ? 0 : v };
    },

    /** Which entities this peer actually holds in readable form. Sorted. */
    entities() {
      return [...entities.keys()].sort(compareStrings);
    },

    /**
     * "412 documents readable, 37 opaque" — the honest picture of a personalized index.
     * `opaque` is not an error count. It is the visible shadow of Appendix VII.
     *
     * Deliberately carries **nothing about secondary indexes**: `stats()` describes the documents,
     * and two indexes over the same documents must compare equal whether or not one of them has
     * happened to build a bucket map. `indexStats()` is where the machinery reports on itself.
     */
    stats() {
      const byEntity = {};
      let readable = 0;
      for (const entity of idx.entities()) {
        const c = entities.get(entity).count;
        byEntity[entity] = c;
        readable += c;
      }
      let opaque = 0;
      let invalid = 0;
      let ignored = 0;
      for (const rec of notes.values()) {
        if (rec.state === 'opaque') opaque++;
        else if (rec.state === 'invalid') invalid++;
        else ignored++;
      }
      return {
        entities: byEntity,
        builtFrom,
        readable,
        opaque,
        invalid,
        ignored,
        paths: readable + notes.size,
      };
    },

    /** What the index machinery currently costs and covers. For the benchmark and for a UI. */
    indexStats() {
      const s = secOf();
      const fields = [];
      let keys = 0;
      let sets = 0;
      let sortedKeys = 0;
      let declined = 0;
      for (const [k, fi] of s.fields) {
        const [entity, ref] = k.split(KEY_SEP);
        if (fi === false) {
          declined++;
          fields.push({ entity, ref, built: false });
          continue;
        }
        const w = fi.weight();
        keys += w.keys;
        sets += w.sets;
        sortedKeys += w.sortedKeys;
        fields.push({ entity, ref, built: true, ...w, covered: fi.covered, missing: fi.missing });
      }
      const aggs = [];
      for (const [k, ix] of s.aggs) {
        const [entity, field, by] = k.split(KEY_SEP);
        aggs.push(
          ix === false
            ? { entity, field, by, built: false }
            : { entity, field, by, built: true, groups: ix.groups.size, usable: ix.usable },
        );
      }
      const occupancy = {};
      for (const [entity, store] of entities) occupancy[entity] = store.occupancy();
      return {
        threshold: opts.threshold,
        fieldIndexes: s.builtFields,
        aggIndexes: s.builtAggs,
        declined,
        distinctKeys: keys,
        bucketSets: sets,
        sortedKeys,
        fields: fields.sort((a, b) => compareStrings(`${a.entity}.${a.ref}`, `${b.entity}.${b.ref}`)),
        aggs,
        occupancy,
        columnar: opts.columnar,
        interning: interner.report(),
        revoked: secondary === null,
      };
    },

    /**
     * Rebuild every built index from the documents and compare. Empty array means no drift.
     *
     * This is the check an ERP should be able to run on demand: an index that has drifted from the
     * documents produces a wrong report, and a wrong report is worse than a slow one. It is also
     * the cheapest possible answer to "how do you know your cache is right?" — you rebuild it and
     * look.
     */
    verifyIndexes() {
      const problems = [];
      const s = secOf();
      for (const [k, fi] of s.fields) {
        if (fi === false) continue;
        const [entity, ref] = k.split(KEY_SEP);
        const store = storeOf(entity);
        if (store === null) {
          problems.push({ index: `${entity}.${ref}`, problem: 'index exists for an absent entity' });
          continue;
        }
        const fresh = new FieldIndex(entity, ref, opts.columnar).build(store);
        const a = JSON.stringify(fi.dump(store));
        const b = JSON.stringify(fresh.dump(store));
        if (a !== b) problems.push({ index: `${entity}.${ref}`, problem: 'differs from a fresh build' });
      }
      for (const [k, ix] of s.aggs) {
        if (ix === false) continue;
        const [entity, field, by] = k.split(KEY_SEP);
        const store = storeOf(entity);
        if (store === null) {
          problems.push({ index: `sum(${entity}.${field}) by ${by}`, problem: 'absent entity' });
          continue;
        }
        const fresh = new AggIndex(entity, field === '' ? null : field, by === '' ? null : by).build(store);
        if (JSON.stringify(ix.dump()) !== JSON.stringify(fresh.dump())) {
          problems.push({ index: `sum(${entity}.${field}) by ${by}`, problem: 'differs from a fresh build' });
        }
      }
      return problems;
    },

    /** Canonical, comparable content of every built index. The rebuild-equals-incremental oracle. */
    dumpIndexes() {
      const s = secOf();
      const out = { fields: [], aggs: [] };
      for (const k of [...s.fields.keys()].sort(compareStrings)) {
        const fi = s.fields.get(k);
        out.fields.push([
          k.replace(' ', '.'),
          fi === false ? 'declined' : fi.dump(storeOf(fi.entity)),
        ]);
      }
      for (const k of [...s.aggs.keys()].sort(compareStrings)) {
        const ix = s.aggs.get(k);
        out.aggs.push([k.split(KEY_SEP).join('/'), ix === false ? 'declined' : ix.dump()]);
      }
      return out;
    },

    /** Every path we could not turn into a document, with why. Loud, per Principle 6. */
    problems() {
      const out = [];
      for (const [path, rec] of notes.entries()) {
        if (rec.state === 'opaque' || rec.state === 'invalid') {
          out.push({ path, state: rec.state, reason: rec.reason });
        }
      }
      return out.sort((a, b) => compareStrings(a.path, b.path));
    },
  };

  /**
   * `where: { 'customer.region': 'Bavaria' }` — find the peers, then walk back through the
   * reference index. The estimate is exact (a sum of bucket sizes), which matters: this plan
   * competes with a range plan whose estimate is not, and an exact number should win a tie.
   *
   * `ceiling` is the best estimate any other plan has already produced, and it is what stops the
   * exactness above from being paid for by every query that does not use this plan. Computing the
   * exact estimate means two index lookups per *peer* — 15 864 Bavarian customers is ~63 000 map
   * lookups, measured at **5.9 ms at a million invoices, paid even when the plan loses**: a join
   * query whose real work was 0.09 ms spent 6 ms deciding not to take this route. So the cheap
   * upper bound `peers × average bucket` is taken first, and the exact walk happens only when the
   * cheap bound says this plan could still win. A bound that is too pessimistic costs a slower
   * plan and never a wrong answer — the same trade §4 already makes for range estimates.
   */
  function planViaJoin(entity, n, { clause, join }, ceiling) {
    if (clause.op !== '=' && clause.op !== 'in') return null;
    if (clause.peerRef === null || clause.peerRef.includes('.')) return null;
    const peerStore = storeOf(join.from);
    if (peerStore === null) return null;
    const peerFi = ensureField(join.from, clause.peerRef);
    if (peerFi === null) return null;
    const s = serviceable(peerFi, clause);
    if (s === null || s.kind !== 'keys') return null;

    const peerRows = [];
    for (const k of s.keys) peerFi.collect(k, peerRows);
    if (peerRows.length === 0) {
      return { est: 0, plan: `${join.from}.${clause.peerRef} → no peers`, produce: () => [] };
    }
    if (peerRows.length > MAX_JOIN_FANOUT) return null;

    const outerFi = ensureField(entity, join.on);
    if (outerFi === null) return null;

    // The cheap bound. `avgBucket()` is one division, and every reference field in an ERP has
    // roughly uniform fan-out, so this is close; where it is not, it is only a plan choice.
    if (Math.ceil(peerRows.length * outerFi.avgBucket()) >= ceiling) return null;

    const keys = [];
    let est = 0;
    for (const pr of peerRows) {
      const peer = peerStore.rows[pr];
      if (peer === null || peer === undefined) continue;
      const id = String(peer.id);
      const sk = `s:${id}`;
      if (outerFi.isLiveKey(sk)) {
        keys.push(sk);
        est += outerFi.bucketSize(sk);
      }
      // A reference stored as a number resolves through `String(ref)` in the pipeline, so the
      // index has to look under both spellings or it would be a subset.
      const nk = `n:${id}`;
      if (outerFi.isLiveKey(nk)) {
        keys.push(nk);
        est += outerFi.bucketSize(nk);
      }
    }
    return {
      est,
      plan:
        `${join.from}.${clause.peerRef} ${clause.op} → ${entity}.${join.on} ` +
        `(${peerRows.length} peers, exact ${est} of ${n})`,
      produce: () => {
        const rows = [];
        for (const k of keys) outerFi.collect(k, rows);
        return rows;
      },
    };
  }

  INTERNALS.set(idx, {
    entities,
    notes,
    builtFrom,
    opts,
    interner,
    takeSecondary: () => {
      const s = sec;
      sec = null;
      return s;
    },
  });
  return idx;
}

/**
 * Below this many candidates the columnar pass is not worth its setup, and the pipeline's own filter
 * over a handful of documents is already free.
 */
const COLUMN_NARROW_MIN = 64;

/**
 * Build the columnar row tests for every serviced clause except the one the plan was driven from.
 *
 * The driving clause is excluded because it rejects nothing: every row in the set satisfies it by
 * construction, exactly the reason `orderClauses()` evaluates it last. Tests are ordered by the
 * clause's own estimate so the most selective one short-circuits first.
 *
 * @returns {{tests:((row:number)=>boolean)[], refs:string}|null}
 */
function columnTests(served, excludeRef) {
  const picked = [];
  for (const sv of served) {
    if (sv.ref === excludeRef) continue;
    const t = sv.fi.columnTestFor(sv.s);
    if (t !== null) picked.push({ t, est: sv.est, ref: sv.ref });
  }
  if (picked.length === 0) return null;
  picked.sort((a, b) => (a.est !== b.est ? a.est - b.est : compareStrings(a.ref, b.ref)));
  return { tests: picked.map((p) => p.t), refs: `(${picked.map((p) => p.ref).join(', ')})` };
}

/** Narrow a candidate row list through the columns of the predicates the plan did not serve. */
function columnarNarrow(rows, served, excludeRef) {
  if (rows.length < COLUMN_NARROW_MIN) return null;
  const built = columnTests(served, excludeRef);
  if (built === null) return null;
  const tests = built.tests;
  const m = tests.length;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let ok = true;
    for (let k = 0; k < m; k++) {
      if (!tests[k](r)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(r);
  }
  return { rows: out, refs: built.refs };
}

/**
 * The plan of last resort before a full document scan: walk the whole column and keep the rows that
 * survive every columnar test. Returns `null` — meaning "the pipeline should scan" — when no clause
 * has a column, or when narrowing did not actually narrow, in which case `query.js` takes its own
 * cheaper path (`all()` is cached and already id-sorted).
 */
function columnarScan(store, served, n) {
  const built = columnTests(served, null);
  if (built === null) return null;
  const tests = built.tests;
  const m = tests.length;
  const slots = store.rows.length;
  const rows = [];
  for (let r = 0; r < slots; r++) {
    let ok = true;
    for (let k = 0; k < m; k++) {
      if (!tests[k](r)) {
        ok = false;
        break;
      }
    }
    if (ok) rows.push(r);
  }
  if (rows.length >= n * SCAN_RATIO) return null;
  return { rows, plan: `columnar scan ${built.refs} (${rows.length} of ${n})` };
}

/** An order domain with no live keys left is canonically the same as no domain at all. */
function nonEmpty(sk, isLive) {
  if (sk === null) return null;
  const keys = sk.dump(isLive);
  return keys.length === 0 ? null : keys;
}

function nullIfEmpty(arr) {
  return arr.length === 0 ? null : arr;
}

/**
 * grammar v2 §13.3's `Filter[]` → `query.js`'s `where`. One shape, two spellings, converted in one
 * place. `exists` / `not exists` come from §13's filter production even though the typedef lists
 * only the comparison operators.
 */
function filtersToWhere(filters) {
  if (filters === undefined || filters === null) return undefined;
  if (!Array.isArray(filters)) throw new TypeError('filter must be an array of {field, op, value}');
  const where = {};
  for (const f of filters) {
    if (f === null || typeof f !== 'object' || typeof f.field !== 'string') {
      throw new TypeError('each filter needs a string `field`');
    }
    const op = f.op === undefined ? '=' : f.op;
    if (op === 'exists') where[f.field] = { op: 'exists', value: f.value === false ? false : true };
    else if (op === 'not exists') where[f.field] = { op: 'exists', value: false };
    else where[f.field] = { op, value: f.value };
  }
  return where;
}

/** Operators a secondary index can produce candidates for. Mirrors `query.js`. */
const INDEXABLE_OPS = new Set(['=', 'in', '>', '>=', '<', '<=', 'between', 'starts with']);

/** Group keys in the same total order the scan path uses. */
function sortedGroupMap(pairs) {
  pairs.sort((a, b) => compareValues(a[0], b[0]));
  return new Map(pairs);
}

/**
 * A maintained aggregate refuses for exactly FD-1's reasons; say so in the query language, with the
 * same `.code` the scanning path uses so a caller cannot tell which plan ran.
 */
function wrapSumErrors(fn, label) {
  try {
    return fn();
  } catch (e) {
    if (e.code === 'MIXED_CURRENCY') {
      throw refusal(
        e.code,
        `sum of "${label}": ${e.message} Add \`groupBy: "currency"\` (or the currency field).`,
      );
    }
    if (e.code === 'MIXED_KINDS') throw refusal(e.code, mixedKindsMessage(label));
    throw e;
  }
}
