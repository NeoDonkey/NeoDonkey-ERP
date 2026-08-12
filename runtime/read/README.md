# `runtime/read/` — the read path

**Owner:** agent Q. **Binding specifications:** Appendix VI of the manifesto; FD-1 (money),
FD-3 (repo mesh) and gate item 7 (scale is measured, not asserted) in `docs/ROADMAP-V1.md`;
grammar v2 §13.3 (the aggregation contract) in `runtime/polism/grammar.md`.

**Status:** 37 tests in `test/e-read.test.js`, 0 failures. The fifteen v0.1 tests and the seventeen
Wave 1 tests are unchanged in meaning and still pass. **`FD-10` is the section to read: §8.4 (the
ceiling), §8.5 (what the column actually bought), §8.7 (what is blocked, and on whom).**

**Wave 2 (FD-10) in one paragraph, because the honest summary is not the one FD-10 predicted.**
FD-10 ordered three things: a columnar projection, lazy materialisation, and composite indexes.
The **columnar projection is built, tested and on by default — and it buys 1.0–1.35×, not the order
of magnitude FD-10 expected** (§8.5). **Composite indexes are dropped**, measured at ~3–4× on one
query shape rather than the estimated 8×, and not worth a new structure that drift can hide in
(§8.6). **Lazy materialisation is not built**, because it cannot be built inside this directory: it
makes the `Source` contract asynchronous and the callers that would have to change are
`runtime/polism/execute.js` and `runtime/kernel.js` (§8.7). What *did* move the numbers was
per-document memory — the locality diagnosis was right and the remedy that worked was making a
document smaller, not adding a column: **≈415 → ≈310 bytes per document**, every rung of the memory
ladder 15–19 % lighter, the wall moved from 3 M to **4 M documents in a 2 GB heap**, and the Appendix
VI query at a million invoices down from 89.7 ms to **47 ms** with the column making no measurable
difference to it either way.

```
runtime/read/index.js    documents, secondary indexes, the planner, the Index surface
runtime/read/query.js    FD-1 money recognition, and the declarative query language
```

Two files, not six, and that is deliberate: `runtime/ui/shell-files.js` and `service-worker.js`
enumerate the runtime's modules and `test/g-ui.test.js` asserts that list against the real ES module
graph. Both belong to other agents, so the read path grows in place and is sectioned internally
rather than making someone else chase new filenames. `index.js` is `PART 1` storage, `PART 2`
indexes, `PART 3` the planner, `PART 4` the public surface.

Zero dependencies beyond `runtime/money/`, no `node:*`, no `Date.now()`, no `Math.random()`.
Nothing in this directory writes anything, anywhere.

---

## 1. What changed, and why it had to

v0.1 shipped `Map<entity, Map<id, Doc>>` and no secondary indexes at all. Every question that was
not *"which document has this id?"* was a linear scan, so Appendix VI's own example query —
*"all invoices over 10 000 EUR from Q3 2027 for customers in Bavaria"* — took 1.05 ms at 15 000
invoices and grew linearly to a projected ~70 ms at a million. The v0.1 compromise register wrote
that up honestly and called it a platform trade-off. It was not one. Avoiding a three-megabyte
SQLite binary never required scanning linearly; **"fast" and "dependency-free" were both available
and v0.1 shipped one of them.** That is what this directory now fixes.

---

## 2. The one invariant that makes an index safe

> **An index may only ever narrow the candidate set. `query.js` alone decides which rows match, by
> re-applying every predicate to every candidate.**

A candidate set may be a *superset* of the matching documents and must never be a subset.
`candidates()` answers "which rows are worth looking at" and may return `null` for "scan
everything". Nothing in the index decides a match.

This is what makes it safe to add index structures to a system that produces financial reports. If
an index is wrong in the conservative direction the answer is still right, only slower. An index
that could *decide* a match would turn every future operator into a correctness risk.

The property is tested, not assumed: `test/e-read.test.js` runs **4 000 randomised queries** over
randomised documents against both an indexed `Index` and a bare `{all, get}` scan source, and
requires byte-identical results — including identical refusals. More than half of those queries
provably use an index (asserted, so the test cannot go vacuous).

Wave 2 added a **columnar** layout behind the same interface, so the property is now asserted
**three ways**: a further 2 500 randomised queries are compared columnar against boxed *and* both
against the bare scan. Two-way would not have been enough — a bug that moved both indexed paths the
same way would pass a columnar-vs-boxed comparison and still be a wrong report.

It found a real defect on its first run, and not the one it was looking for: see §7.

---

## 3. The index structures, and why these

### Documents: a dense row store plus persistent maps

Documents live in a **dense array** and the indexes hold **row numbers**, not ids. Turning a
candidate into a document is then an array index (~2 ns) instead of a hash lookup in a
million-entry `Map` (~80 ns). Row numbers are never renumbered — a deletion leaves a hole that the
next insert reuses — so no index is ever invalidated by compaction. The cost is that the row array
tracks the *peak* live count, which is bounded and reported by `indexStats().occupancy`.

`update()` must stay pure (the index you hold keeps reporting what it reported) *and* cost the
change set rather than the repo. v0.1 kept the first with `new Map(previous)` per touched entity,
which is O(entity) per change: invisible at 15 000 invoices, ~100 ms of pure Map copying at a
million. `PMap` keeps both: an immutable **base** shared with every previous version plus a small
copied **overlay**, folded in when it outgrows `base/64`. A full build `seal()`s its overlay into
the base, because otherwise the first `update()` copies the whole thing — that one line is worth
**103 ms → 1.8 ms** on a 150 000-invoice incremental update, and the benchmark is the only reason
anybody noticed.

### What a document costs, and the three things that made it cheaper

FD-10 is a memory decision before it is a speed decision, so the per-document cost is tracked as a
number and not as a hope. Wave 1 measured **≈415 bytes per document**, all-in. It is now **≈293**,
and the three changes are worth naming separately because two of them are invisible and one of them
was a defect.

* **`notes` instead of `paths` (−136 B/doc).** Wave 1 kept a record per path in the repository —
  `{entity, id, state, reason}` — and for a *readable* document every byte of it is derivable from
  what the index already holds: the path is `docPath(entity, id)`, `state` is `'readable'` exactly
  when the entity store holds that id, and `reason` is always `null`. So `notes` now holds a record
  **only for a path that produced no document**: opaque bytes (Appendix VII's normal condition),
  invalid JSON, and non-document paths. `stats().readable` is the sum of the stores' counts and
  `stats().paths` is that plus `notes.size` — the same two numbers, from the structure that was
  already authoritative for them. What this removes is a *second opinion* about what a path
  contributed, and Wave 1 proved twice over that a second opinion which can disagree with the first
  is a defect waiting for a schedule.
* **Value interning (−15 B/doc, and it was doing nothing).** `JSON.parse` allocates a fresh string
  for every string *value*, and a general ledger is mostly low-cardinality text repeated millions of
  times: `"posting"`, `"EUR"`, `"debit"`, an account number from a chart of four hundred. Replacing
  them with one shared instance is semantically invisible — JavaScript strings are immutable
  primitives compared by value, so no program can observe which instance it holds — and the hard part
  is knowing what *not* to intern, which is decided per field: a field that exceeds 4 096 distinct
  values declines permanently and releases its dictionary, so `id` and `amount` pay a bounded toll
  and step aside. **The defect:** the write was guarded by `got !== v`, which for strings is a *value*
  comparison, so it was never true and nothing was ever interned. `indexStats().interning.hits` read
  `0` at every scale, which is what the benchmark is for. The guard is gone; the write is
  unconditional, because JavaScript offers no way to ask whether two equal strings are the same
  allocation.
* **One sorted path array instead of an array of pairs (peak only, and it moved the wall).**
  `materialize()` used to turn the tree into `[[path, oid], …]` before ingesting. At four million
  paths that is ~240 MB of two-element arrays, live for the whole build, on top of the caller's map
  and the index. It never showed in a post-collection reading and it is exactly what a heap *limit*
  measures: the 4 M run died with "ineffective mark-compacts near heap limit" while its settled size
  was 1.75 GB. A sorted `string[]` plus a lookup costs one pointer per path. **That single change is
  the difference between three and four million documents in a 2 GB heap.**

The remaining cost is the parsed documents themselves, and §8.4 says so plainly: they are the
ceiling, and no layout inside this directory removes them.

### Equality: a hash bucket per value

`Map<encodedKey, row | Set<row>>`. Exact, O(1), and it doubles as the authority for which values
exist. A bucket holds a bare row number when it has one member — the common case for reference
fields and document numbers — and a `Set` beyond that. Two shapes instead of one saves roughly
60 bytes per singleton bucket, which at a million documents is the difference between an index you
can afford and one you cannot.

Keys are **type-tagged**: `n:`, `s:`, `b:`, `m:`. Without the tag, `1` and `"1"` share a bucket, and
an index that conflates them is an index that can be *asked* the wrong question.

### Range: a sorted array of keys, binary-searched — not a B-tree

Stated plainly because it looks like a shortcut and is not. A B-tree earns its complexity when the
structure is paged from disk or updated in place under concurrency. This one is neither: it is a
rebuildable view of an immutable commit, held in RAM, written by one thread. A sorted array of *the
same key strings the equality map already holds* costs one extra pointer per distinct value and no
extra objects at all, which a B-tree's nodes cannot match.

What a sorted array is bad at is insertion, so it is two-level: an immutable `main` plus a small
sorted `pending`, both searched, merged when `pending` outgrows `main/16`. Keys are not removed when
a bucket empties — a key with no rows contributes no candidates, so it is inert — and are swept at
the next merge, where the array is being rebuilt anyway.

If this becomes the bottleneck, the replacement is a B-tree behind the same three methods
(`range`, `countRange`, `add`). It is not the bottleneck; §8 says what is.

### The columnar projection: one dense `Int32Array` of ordinals per index

**FD-10 item 1.** For every built `FieldIndex` there is a `Column`: a dense array with one entry per
row, so a predicate walks 4 bytes per row instead of dereferencing a pointer into a different heap
object. It sits *behind* `FieldIndex` — no caller sees it, and `columnar: false` removes it.

FD-10 prescribed the layout as well as the goal: "a `BigInt64Array` of minor units for money,
integers for dates, numeric ids for references". The goal is served; **the prescribed layout is
wrong, in two ways that are measurements rather than opinions**:

1. **Reading a `BigInt64Array` allocates a `BigInt`.** That is the ~100 ns per row `moneyComparator`
   exists to avoid (§5: 125 ns → 25 ns, "almost all of that difference being the `BigInt`"). A money
   column of minor units would be *slower* than the string comparator it replaced.
2. **It truncates, silently.** `BigInt64Array` assignment wraps modulo 2^64 and does not throw.
   `9223372036854775.807 TND` is exactly 2^63−1 minor units; `92233720368547758.08 EUR` is 2^63, and
   in a `BigInt64Array` it reads back as **−92233720368547758.08**. `99999999999999999.99 EUR` — the
   largest amount in `runtime/money/README.md`'s own table — reads back negative too. A monetary
   index that wraps is FD-1's float defect wearing a different hat, and it is the one thing this
   directory may not do. The test is `the money column is exact at the edge of a 64-bit minor unit`,
   and it asserts the wrap as well as our exactness, so the reason survives the next refactor.

So the column is **dictionary-encoded**, one uniform layout for every type:

```
  ords[row]   → ordinal, or -1 when the row carries no indexable value   (Int32Array, 4 B/row)
  keys[ord]   → the encodeKey string — the equality index's own key set, so nothing is duplicated
  rank[ord]   → position in a globally ordered list, -1 = not yet ranked (conservatively admitted)
  ordered     → every ranked ordinal, ascending, in contiguous per-domain blocks
  blocks      → 'num' | 'str' | 'm:EUR' | 'm:CHF' → {off, len} into `ordered`
```

| field type | what the ordinal points at | how a predicate is answered |
| --- | --- | --- |
| **money** (FD-1 token) | the canonical token, e.g. `m:EUR:499999` | equality: ordinal compare. range: integer interval in rank space, inside that currency's own block — so a EUR range cannot see a CHF row, structurally |
| **date** / any text | `s:2027-08-15` | equality: ordinal compare. range and `starts with`: interval in the `str` block |
| **number** | `n:19` | interval in the `num` block, ordered by numeric value |
| **reference** / id | `s:C-0000017` | equality / `in`: ordinal compare, or a `Uint8Array` bitmask past eight values |
| **boolean** | `b:0` / `b:1` | equality only — booleans have no order index, here or in `SortedKeys` |

Two consequences worth naming. **4 bytes a row, not 8**, and exact at every magnitude because the
dictionary holds the FD-1 token rather than a machine integer. And a range over one domain becomes a
single integer interval `rlo <= rank[ords[row]] < rhi` — two dense loads and two comparisons, no
string compare, no `BigInt`, no pointer chase.

**Why it cannot make an answer wrong.** The column is a different layout of the information the
equality buckets already hold, derived from the same `encodeKey` and ordered by the same comparators
as `SortedKeys`. For any clause `serviceable()` accepts, the rows the column admits are the rows the
bucket plan admits — with one deliberate slackening: an ordinal added since the last ranking pass
(`rank === -1`) is **accepted**, never rejected. Slack in the accepting direction is a larger
candidate set, which `query.js` then filters exactly; slack in the other direction would be a short
report, and there is none. The ranks come from `SortedKeys.main` rather than a second sort, so a
column and a range walk cannot disagree about which value comes first.

The column has two jobs. It **narrows** the candidate set with the predicates the chosen plan did
not drive from — which is index intersection, and §4 declined it in Wave 1 for good reasons that a
column changes: intersecting bucket set *A* with *B* costs `|A| + |B|`, but testing `|A|` dense
4-byte loads costs `|A|` × ~1 ns against `|A|` predicate evaluations on boxed documents at 71–244 ns.
And it **scans**, where Wave 1 gave up: a plan whose estimate covers more than half the entity used
to return `null`, and now walks the column first and only gives up if that failed to narrow.

What it does **not** do is let the pipeline skip a predicate. `ords[row] === ord` is not the query
language's `=` — `encodeKey` maps `1n` and `1` to one ordinal while `1n === 1` is false — so the
column may narrow and may never decide. That is also why it cannot deliver an order of magnitude:
the work it saves is bounded by how much it narrows, and on real ERP predicate selectivities
(`currency = 'EUR'` is 95 % of the rows) that is 1.4×, not 10×. §8.5 has the A/B.

### Money: a partition per currency

`Map<currencyCode, SortedKeys>`, ordered by `BigInt` minor units. A range query in EUR must not walk
USD keys — not as an optimisation, but because FD-1 says the two do not compare.

### Maintained aggregates: money only, and the restriction is load-bearing

`sum of amount over posting where account = X` is O(1) rather than O(rows in that account), because
a general ledger calls it on every posting.

Money **only**. An incrementally maintained `double` sum is not order-independent, so add-then-
subtract would not equal a fresh scan, and the oracle test would be right to fail it. `BigInt` minor
units are exact and order-independent, so the maintained value provably equals the scan. This is
FD-1 paying for itself in performance rather than only in correctness. A field carrying plain
numbers is detected and the aggregate permanently declines, falling back to the ordinary pipeline.

### Which fields are indexed: lazily, the ones that get asked about

The default is **no eager indexes**. An index for `(entity, field)` is built the first time a query
needs it and maintained incrementally thereafter, so index memory is proportional to the questions
actually asked rather than to the model's field count. Pre-building every declared field of every
entity is precisely what makes an in-memory index run out of memory at a million documents (§8).

The model is used where it belongs: `materialize({ model, eagerFromModel: true })` pre-builds
indexes for `reference`, `money`, `date` and `number` fields plus `## Identified by` fields — the
ones a join or a range predicate cannot be planned without. Explicit `indexHints: [{entity, field}]`
and `aggregateHints: [{entity, field, by}]` are also accepted.

Domains, though, are derived from the **values**, not from the declared types, and that is not a
weakening: FD-1 made money a self-describing string precisely so that `"4999.99 EUR"` announces what
it is. Observing is not guessing (Principle 6), it means the index is exact with no model at all —
which matters, because `indexOf(docs)` is used by the live layer and the UI with no model in sight —
and it means a document whose data contradicts its declared type is indexed by what it actually
holds rather than by what it was supposed to hold.

Two caps, so a long-lived session cannot index its way out of memory unnoticed:
`maxFieldIndexes` (96) and `maxAggIndexes` (32). Beyond them the index **declines** and
`indexStats().declined` says so out loud. Below `indexThreshold` documents (256) an entity is not
indexed at all, because scanning 200 documents is already free.

### Ownership: `update()` revokes, and a revoked index heals itself

Secondary indexes are mutable and owned by exactly one index version. `update()` hands ownership to
the version it returns and revokes the source's handle. A revoked index stays **completely
correct** — it lazily rebuilds from its own immutable documents the next time a query wants an
index. That is "the index is a view, never truth" used as an engineering tool: the cheapest way to
keep a stale index honest is to let it throw itself away. Tested directly.

---

## 4. The query planner

> **Serve the candidate set from the single most selective indexed predicate, then let the pipeline
> apply every predicate to every candidate.**

Candidate sources, best first:

1. **Primary key** — `id = x`. One lookup.
2. **Equality / `in`** — hash buckets. The estimate is *exact*: it is the bucket size.
3. **Range** — binary search, then union the buckets. The estimate is
   `keys in range × average bucket size`, which is a genuine estimate and is labelled as one.
   There are no histograms, so a skewed field can be mis-estimated; the consequence is a slower
   plan, never a wrong answer.
4. **Join-driven** — for `where: { 'customer.region': 'Bavaria' }`, look up Bavarian customers in
   the customer index, then collect invoices through the `invoice.customer` index. The only plan
   that can start from a predicate on a document the result rows are not.

And one non-plan: if the best estimate still covers **more than half** the entity, the planner
returns `null` and the pipeline scans. Walking an index to visit 600 000 of a million rows is slower
than walking the million, and pretending otherwise is how "we added indexes" becomes a regression.

`index.explain(q)` names the chosen plan and the candidate count.

**No index intersection**, and that looks like a missing feature, so: intersecting index *A* with
index *B* costs `|A| + |B|`, whereas producing *A* and filtering it with *B*'s predicate — which the
pipeline does anyway, as part of checking the row matches — costs `|A|`. The planner picks the
smaller, so filtering is never worse. Intersection only wins with a **composite** index, which is a
different structure; §8 measures what it would buy.

Two smaller things the planner does: predicates are ordered **cheapest-first**, and the predicate
the candidate set was derived from is evaluated **last**, because it rejects nothing. Both are safe
without argument — the predicates are pure and AND-combined — and together with the money
comparator below they took the Appendix VI query at 150 000 invoices from 13 ms to 2.9 ms.

### Where the planner refuses to help

Every plan must be a superset. Where that cannot be guaranteed, the planner declines and the
pipeline scans. Declining costs a scan; guessing costs a wrong report. The named traps, all tested:

* **A text range over a field that also holds money.** `"4999.99 EUR" > "2027"` is true as text, and
  those rows live in the money domain, not the text domain. A text-range plan would be a *subset* —
  a silently short report. Same for `starts with`.
* **`between [1, 'a']`** mixes domains.
* **`in [x, null]`** also matches missing values, which no bucket holds.
* **A `BigInt` where a `Number` is expected.** `encodeKey` maps `1n` and `1` to one bucket while
  `=` does not (`1n === 1` is `false`). Superset candidates are fine; an *exact count* taken from a
  bucket size would not be, so the counting shortcut declines when a field holds any `BigInt`.
* **A non-canonical money token.** `"29000.00 TND"` is not a dinar amount (FD-1: exactly the
  minor-unit digits, and TND has three). It is therefore text, and the two rules above apply.

---

## 5. Money (FD-1)

`runtime/money/` (agent M) is **the authority**. `query.js` PART 1 is an adapter to it, not a second
implementation: the ISO 4217 scale table is M's `CURRENCIES`, canonical output is
M's `toString(fromMinor(...))`, and an unknown currency code is refused exactly as M refuses it.
There is no `parseFloat`, no `parseInt`, no `toFixed` anywhere in this directory, and no `Number(`
or `Math.` anywhere in the money section — asserted by a grep in the test file, because an assertion
is cheaper to trust than an argument.

Why an adapter rather than calling `money(v)` directly: the read path must answer *"is this
arbitrary field value a monetary token?"* for every string value of every document it indexes, and
M's parser answers by throwing. Throwing is right for arithmetic and wrong for classification —
an exception per non-money string would dominate materialisation. So `parseMoney()` is a
non-throwing recogniser over M's own table, and a **conformance test** runs M's `money()` and this
recogniser over the same token table plus 600 generated tokens and requires them to accept, reject
and decode identically. If they ever diverge, that test fails rather than a report being wrong.

**One of the two has now been deleted rather than pinned.** The CTO added `looksLikeMoney` and
`currencyOfOrNull` to `runtime/money/`, so `looksLikeMoney` **is a re-export** — one name, one
implementation, repository-wide. It also closes a divergence Wave 1 shipped without noticing: the read
path's own `looksLikeMoney` was really a *shape* test and answered `true` for `"5.00 XXX"`, which
`parseMoney` then correctly refuses because `XXX` has no ISO 4217 scale. That shape test survives as
the unexported `hasMoneyShape()`, honestly named, and the conformance test now asserts
`looksLikeMoney(token) === (parseMoney(token) !== null)` on every token it generates.

**The amendment that would let `parseMoney` go the same way**, since the brief asks for it by name:
`runtime/money/` exporting a **non-throwing decoder** — `decodeOrNull(value) → {code, scale, minor} |
null`, or `toMinorOrNull(value) → bigint | null` alongside the code. `currencyOfOrNull` cannot serve
this path, for two reasons that are both measurements rather than preferences: it returns only the
code, where the index needs the exact `BigInt` minor units to build a key; and it is implemented as
`try { toMoney(value) } catch { return null }`, so on the *common* case during materialisation — a
string that is not money — it allocates a `Money` and raises an exception, which is the precise cost
this recogniser exists to avoid. Given `decodeOrNull`, `parseMoney` becomes a re-export too and the
conformance test becomes redundant rather than load-bearing. Until then it stays, pinned.

`moneyComparator` stays regardless, and the CTO's reasoning for that is in the next paragraph: it is
on the inner filter loop, it allocates nothing, and a non-throwing decoder would not change that.

A second, faster path exists for predicates. `moneyComparator(token)` compiles a probe into
`(value) => -1|0|1|NaN` that allocates nothing and constructs no `BigInt`: **~25 ns** against
~125 ns for `compareMoney(parseMoney(v), probe)`, almost all of that difference being the `BigInt`.
An amount filter is the single most common predicate an ERP evaluates, and on a plan that hands back
80 000 candidates the difference is ten milliseconds. It is exact structurally rather than
carefully — within one currency the scale is fixed, so two canonical tokens order by (sign, count of
significant digits, then the digits), and no arithmetic happens at all. It is pinned to
`parseMoney` + `compareMoney` over ~40 hand-picked awkward values and 3 000 generated ones,
including values that are not money at all.

Decisions worth knowing:

| question | answer | why |
| --- | --- | --- |
| `10.00 USD > 5.00 EUR`? | `false`, no throw | The language already refuses to order values of different kinds; two currencies are different kinds. And if it threw, *whether a query threw* would depend on which rows an index visited — the indexed and unindexed paths would stop agreeing. |
| `sum` across currencies? | **refused**, `QueryError` with `.code = 'MIXED_CURRENCY'` | FD-1: mixed currencies do not add. `groupBy: 'currency'` is the way through, and it is the shape a trial balance needs. |
| `"1.50 EUR" = "1.5 EUR"`? | the question does not arise | `1.5 EUR` is not canonical for EUR, so it is not money at all. Within a currency the scale is fixed, so text equality and value equality coincide — which is also why the index key is just `m:<CODE>:<minor>`. |
| money and plain numbers in one field? | **refused**, `.code = 'MIXED_KINDS'` | There is no correct way to add a currency to a bare number. |
| `sum` over an empty set? | the number `0` | v0.1's behaviour, preserved. The query language cannot know the currency of an empty set; grammar §19.3's currency-free zero is polism's to spell, which is why `aggregate()` declines that one case (§6). |
| where does money sort? | between numbers and text | A money field sorted as text puts `"9.00 EUR"` after `"10.00 EUR"`, and an invoice list ordered that way is a wrong report. Across currencies: by code, then by minor units — *some* total order is required for determinism, and this is the only one that does not pretend a rate exists. |

---

## 6. Aggregation — the contract with `runtime/polism/` (grammar v2 §13.3)

Implemented exactly as agent G2 specified it. The `Index` is a `World`:

```js
index.matching(entity, filters)   // Doc[] | null   — filters are {field, op, value}
index.aggregate({ kind, entity, field, fieldType, filter })   // {value} | null
```

Plus the ergonomic form for everything else: `index.sum(entity, field, where)` and
`index.count(entity, where)`.

**The performance contract:**

| shape | cost |
| --- | --- |
| `count of E` | **O(1)** |
| `count of E where f = v` | **O(1)** — a bucket size |
| `count of E`, grouped | **O(groups)** — maintained |
| `sum of <money field> over E where f = v` | **O(1)** — a maintained `BigInt` aggregate |
| `sum of <money field> over E`, grouped by `f` | **O(groups)** — the trial balance |
| everything else, including two filters | **O(candidates of the most selective filter)** |
| — | **never O(E)** unless no filter is indexable and the planner says a scan is cheaper |

`sum of <number field>` is never served by a maintained aggregate, for the exactness reason in §3.

**Two deliberate `null`s**, using §13.3's own "I cannot answer that" escape, because both are better
answered by the caller:

* a **money sum over an empty set** — §13 says the answer is §19.3's currency-free zero, and this
  module has no way to spell that. It declines and lets polism's own arithmetic produce the zero it
  means, rather than returning the number `0` that polism would be right to refuse.
* a **mixed-currency sum** — a correct refusal, not an inability, but `aggregate()` has no channel
  for a refusal. Declining hands the rows back and lets `runtime/money/` raise it, so exactly one
  module in the repository owns that error message.

Every aggregate is checked against a **naive scan as the oracle** over randomised data, per account,
grouped and ungrouped, and after corrections (`add` then `subtract`) — because the whole point of a
maintained value is that it must equal the value nobody maintained.

---

## 7. What the tests are for

`node --test test/e-read.test.js` — 37 tests. The load-bearing ones, in order of how much they
matter:

1. **Indexed and unindexed agree.** 4 000 randomised queries (seeded PRNG, seed `20270815`) over
   1 500 randomised documents, compared against a bare scan source. Byte-identical results and
   byte-identical refusals.
1b. **Columnar and boxed agree, and both agree with the scan.** 2 500 randomised queries (seed
   `20270816`), three engines, byte-identical results and refusals. The plans are sampled so the test
   can report that the column was actually exercised in both of its roles — narrowing and scanning —
   rather than passing vacuously.
1c. **The money column is exact where a `BigInt64Array` wraps.** `9223372036854775.807 TND` is 2^63−1
   minor units and `92233720368547758.08 EUR` is 2^63; the test asserts that a `BigInt64Array` reads
   the second one back as a *negative* amount, and that this index orders, compares, and sums it
   exactly — including a 36-digit amount, in both layouts. The wrap is asserted rather than described
   so that the reason for the layout survives the next refactor.
2. **Rebuild == incremental, including every index structure.** Twelve hand-picked change kinds —
   a field update that moves a document between three index buckets, a group key changing, a
   currency changing (which moves a row between *partitions* of the money index), a new entity, a
   deletion that empties an entity, readable↔opaque, invalid→readable, a mixed-currency aggregate
   appearing and then going away — plus 40 rounds of seeded-random change sets. Every round compares
   documents *and* a canonical dump of every index structure, and asserts `verifyIndexes()` is
   empty. **An index that has drifted from the documents is a wrong report, and in an ERP a wrong
   report is worse than a slow one.**
   The dump is keyed on document **ids**, not row numbers: a fresh build numbers rows by arrival
   while an incremental one reuses freed slots, and two indexes that disagree about numbering while
   agreeing about documents are not drifting. A row pointing at a hole *is* corruption, and is
   surfaced rather than skipped.
2b. **Rebuild == incremental in *both layouts*, across every transition.** The same 30-round seeded
   change chain — deletions, readable↔opaque, readable→invalid, a value moving between buckets, a
   currency moving a row between money partitions — maintained incrementally in a columnar index and
   in a boxed one, with a full rebuild of each as the oracle every round, and the two layouts' answers
   compared to each other as well. A rank left stale by a `SortedKeys` merge shows up here.
3. **Aggregation against a naive scan oracle.**
4. **Money conformance with `runtime/money/`**, and the fast comparator against the exact one.
5. **The planner's refusals** — every trap in §4, each one an assertion that the plan is
   `'full scan'` *and* that both paths still agree.
6. **Determinism, four ways.** Insertion order × layout: columnar and boxed, built in order and
   shuffled, must produce identical rows, identical tie-breaks and identical groups.

`index.verifyIndexes()` is also a product feature, not only a test hook: it rebuilds every live
index from the documents and reports differences. It is the cheapest possible answer to *"how do you
know your cache is right?"* — you rebuild it and look.

### The defect the property test found

Not an index bug. **Summing plain `number` values in a different order gives a different double**,
so a plan change could change a reported total: `839121.0399999999` from one plan and
`839121.04` from the other, for the same documents. Floating-point addition is not associative, and
a report that changes when nothing changed is exactly the defect FD-1 exists to remove.

`sum` over a `number` field is now order-independent by construction, with two exits: if every value
is a safe integer with a safe running total the sum is exact and is used directly (counts, which is
what a `number` field should be under FD-1); otherwise the values are sorted ascending and summed,
which makes the result a pure function of the *multiset* — equal doubles added in any order give the
same double — so every plan agrees, and ascending order is also the numerically better one.

Money never pays for either: `BigInt` addition is associative.

The measured price is in §8: a `groupBy + sum` over a **non-integer float** field went from 0.90 ms
to ~2.4 ms at 15 000 invoices. That regression falls entirely on the data shape FD-1 abolished — a
monetary amount stored as a JS number — and on FD-1-compliant data the same operation is *exact and
faster*: a trial balance over a million postings is 0.35 ms.

---

## 8. The numbers

Measured on the machine this was developed on (Apple Silicon, Node 25.2.1), each scale in its own
process, `--expose-gc` so the memory column is post-collection rather than an upper bound.

**Read the `best` column.** The machine was shared with five other agents building v1.0 in parallel
(load average 9–18 in Wave 1, **12–76 in Wave 2**), so means are inflated by contention by as much as
20×; a best-of-N is far less sensitive to it. Where a Wave 2 number was taken under heavy load it says
so next to the number, and no comparison in this section is drawn between two figures measured at
different times unless the ratio is large enough to survive that. **Memory figures are not affected
by load** — allocation is deterministic — which is why the ceiling in §8.4 is stated with more
confidence than any timing here.

```
ND_SCALE=15000,150000,1000000 NODE_OPTIONS="--expose-gc --max-old-space-size=12288" \
  node --test test/e-read.test.js          # the query ladder; add ND_COLUMNAR=off for the A/B

ND_MEM=1000000,2000000,3000000,4000000 \
  node --expose-gc --max-old-space-size=2048 --test test/e-read.test.js   # the ceiling, in documents
```

### 8.1 The ladder

Each scale is *N* invoices, *N*/8 customers and *N* postings, all with FD-1 money amounts. Query
figures are best-of-20 (best-of-200/500 for the sub-millisecond ones). 15 000 and 150 000 measured
at load average 4.5; the million-document row at load average 9, because a 2.1-million-document run
takes over a minute and the machine never got quieter than that.

**This table is Wave 1's, unchanged, and it is the baseline.** §8.1b has the Wave 2 rows that can be
stated honestly and says which ones cannot.

| | 15 000 inv<br>(31 875 docs) | 150 000 inv<br>(318 750 docs) | 1 000 000 inv<br>(2 125 000 docs) |
| --- | --- | --- | --- |
| `materialize()` | **119 ms** (3.7 µs/doc) | **1.33 s** (4.2 µs/doc) | **41.9 s** (19.7 µs/doc) |
| incremental `update()`, 100 docs | **2.77 ms** | **2.99 ms** | **55 ms** |
| Appendix VI query (join + 4 predicates + sort), FD-1 money | **0.463 ms** | **3.02 ms** | **89.7 ms** |
| the same with a plain-number total (v0.1-comparable) | **0.231 ms** | **2.27 ms** | **54.4 ms** |
| indexed equality lookup (invoices of one customer) | **0.002 ms** | **0.001 ms** | **0.002 ms** |
| range query (`total >= 39 000.00 EUR`) | **0.101 ms** | **1.09 ms** | **18.8 ms** |
| point lookup by id | **0.001 ms** | **0.000 ms** | **0.001 ms** |
| `sum of amount over posting where account = X` | **0.001 ms** | **0.001 ms** | **0.001 ms** |
| trial balance: `groupBy account + sum` over *all* postings | **0.258 ms** | **0.211 ms** | **0.349 ms** |
| `count of` all invoices | **0.000 ms** | **0.000 ms** | **0.000 ms** |
| `sum` of an integer field over all invoices (a scan; no index helps) | 0.413 ms | 5.81 ms | 73 ms |
| heapUsed, documents only | +10 MB (317 B/doc) | +113 MB (372 B/doc) | +738 MB (364 B/doc) |
| heapUsed, 6 field + 1 aggregate index | +4 MB | +44 MB | +259 MB |
| distinct index keys | 32 742 | 314 386 | 1 905 123 |

Three of those rows deserve pointing at, because they are the ones a general ledger lives on:

* `sum of amount over posting where account = X` is **1 µs at every scale**, including a million
  postings. That is a maintained `BigInt` aggregate, and it is the number that decides whether
  double-entry is affordable — FD-4 puts the ledger in the operating model, so a posting rule asks
  this question on every commit.
* the **whole trial balance** — 400 accounts, a million postings, exact to the cent — is
  **0.35 ms**, and it barely moves between 15 000 and 1 000 000 because its cost is the number of
  accounts, not the number of postings.
* `count of` is free, and an **indexed equality lookup does not degrade at all** between 15 000 and
  a million documents. Those are the shapes that were 0.29 ms and a linear scan in v0.1.

**Cold vs warm.** The first execution of a novel query also *builds* the index it needs, and that
number is published too, because "warm" alone would be a half-truth: the Appendix VI query costs
30 ms cold at 15 000 invoices, 352 ms at 150 000 and 4.6 s at a million — one pass over the entity
per field, then O(log n) forever. `materialize({ eagerFromModel: true })` or `indexHints` moves that
cost into materialisation, where it belongs.

### 8.1b Wave 2 against that ladder — the rows that can be stated, and the ones that cannot

**Never report a pass you did not observe.** Wave 2's ladder ran on a machine at load average 12–87
with four other agents in it; the same 15 000-invoice `materialize()` measured 128 ms early in the
session and 17 934 ms late in it, on identical code. Publishing the late run as a Wave 2 timing would
be publishing the load average. So this section separates what the measurements support from what
they do not.

**Memory is not affected by load** — allocation is deterministic — so these rows are stated flatly:

| heapUsed, documents only | 15 000 inv | 150 000 inv | 1 000 000 inv |
| --- | --- | --- | --- |
| Wave 1 | +10 MB (317 B/doc) | +113 MB (372 B/doc) | +738 MB (364 B/doc) |
| **Wave 2** | **+5 MB (176 B/doc)** | **+60 MB (198 B/doc)** | **+370 MB (183 B/doc)** |
| | −44 % | −47 % | −50 % |

Index memory is unchanged at +5/+50/+302 MB for 6 field indexes and 1 aggregate — the column adds
4 bytes per row per index and the dictionary is shared with the equality map, so it does not show at
this resolution.

**Timings that are large enough to survive the noise**, each measured at least twice at load 12–43 and
quoted as the best observed:

| | Wave 1 | Wave 2 | |
| --- | --- | --- | --- |
| Appendix VI query at 1 M invoices, FD-1 money | 89.7 ms | **47.0 ms** | ~1.9× — and §8.5 shows the column is not the cause; the smaller document is |
| the same, plain-number total | 54.4 ms | **40.7 ms** | 1.3× |
| trial balance at 1 M postings | 0.349 ms | **0.321 ms** | unchanged, as expected — it never touches a document |
| `sum of amount over posting where account = X` | 0.001 ms | **0.001 ms** | unchanged |
| point lookup by id | 0.001 ms | **0.001 ms** | unchanged |
| a join query whose real work is 0.09 ms | 6.98 ms | **1.65 ms** | the planner fix in §8.6 |
| the same with an empty candidate set | 5.91 ms | **0.22 ms** | 27× — it was all wasted estimate |

**Rows this session cannot honestly quote:** `materialize()` and `update()` at every scale, and the
cold numbers. They are dominated by contention here (`materialize()` at 15 000 invoices varied 140×
within one session), and the only change that should move them is the interner and the path-list fix,
both of which reduce allocation. **The ladder needs one re-run on a quiet machine before Wave 4's
gate condition 7 is claimed**, and that is a stated to-do rather than a number I am asserting.

### 8.2 Against v0.1, on v0.1's own fixture

COMPROMISES #3's table was measured on a 20 000-document fixture (5 000 customers + 15 000
invoices, **numeric** totals) as a mean of 50 runs. That fixture and its test are still in
`test/e-read.test.js`, unchanged, so this is like-for-like — means against means, with v1.0's best
in brackets:

| operation | v0.1 | v1.0 | |
| --- | --- | --- | --- |
| **Appendix VI's own example query** | **1.05 ms** | **0.30 ms** (best 0.21) | **3.5× faster**, and it no longer grows linearly |
| `count` with one predicate | 0.29 ms | 0.002 ms | **145×** — a bucket size, not a scan |
| point lookup by id | 0.012 ms | 0.002 ms | 6× |
| incremental `update()`, 100 docs | 5.5 ms | 3.6 ms | 1.5× |
| full `materialize()` of 20 000 docs | 61 ms | 61 ms | unchanged |
| `groupBy` + `sum` over 14 625 invoices | 0.90 ms | 1.94 ms | **2.2× slower** — see §7 |

The last row is the honest cost of the float-determinism fix, and it falls on a field FD-1 no longer
permits to exist: a monetary amount stored as a JS number. On FD-1 money the same shape is 0.35 ms
over a million postings.

And the projection that reorganised the roadmap — *"~7 ms at 100k, ~70 ms at 1M"* — is now, on the
same query shape with numeric totals: **2.3 ms at 150 000** and **54 ms at a million**.

### 8.3 What breaks: locality, not algorithms — and what actually fixed it

The Appendix VI query does not scale the way the index says it should, and the reason is not the
index. Measured back-to-back on one machine, invoices plus customers, isolating the filter phase:

| invoices | candidates | `candidates()` | filter phase | per candidate | end-to-end |
| --- | --- | --- | --- | --- | --- |
| 150 000 | 12 501 | 0.07 ms | 0.89 ms | **71 ns** | 2.26 ms |
| 300 000 | 24 999 | — | 1.97 ms | **79 ns** | 7.88 ms |
| 500 000 | 41 491 | — | 3.61 ms | **87 ns** | 19.3 ms |
| 1 000 000 | 83 086 | 0.66 ms | 20.3 ms | **244 ns** | 51.4 ms |

Two separate things are visible, and both are worth naming.

**The filter's cost per candidate is flat to 500 000 and then triples.** Identical code, identical
predicates. The candidates are scattered across a heap of hundreds of thousands of separate JS
objects; once the candidate working set (~30 MB at a million) clearly exceeds the last-level cache,
every predicate evaluation pays a cache miss. No better index fixes this, because the index is
already handing back the right rows.

**End-to-end grows faster than the candidate count throughout** — 6.6× the candidates costs 23× the
time. The filter accounts for part of it; the rest is the join's random lookups into a customer store
that is growing at the same rate, plus one allocation per surviving row. Neither is algorithmic. At
this scale the read path is bound by **memory locality**.

Wave 1 named the exit path as **columnar projection** and predicted the next order of magnitude
there. **The diagnosis was right and the prescription was wrong**, and both halves are now measured.

**What fixed it: a smaller document.** The same query, same fixture, same machine — 89.7 ms at a
million invoices in Wave 1, **47 ms** now, with the column making no measurable difference either way
(§8.5). The change that did it is the three memory items in §3: a document went from ~364 to ~183
bytes, so the candidate working set halved and the cache misses halved with it. Locality was the
problem; the remedy that worked was carrying less, not indexing differently.

**Why the column could not deliver an order of magnitude, in one sentence.** *An index may only
narrow; it may never decide* — so `query.js` re-applies every predicate to every candidate no matter
what the column already tested, and the column's win is therefore capped by how much it narrows. On
this fixture the narrowable predicates are `currency = 'EUR'` (95 % of rows) and `total > 10 000`
(75 %), so 83 086 candidates become 59 207: a 1.4× smaller input to work that was never the whole
cost. The 8×-selective conjunctions where a column *does* pay are in the A/B table, and they pay
1.3×, not 10×.

That is not an argument for dropping the invariant. A column that decided matches would make every
future operator a correctness risk, and 1.35× is not worth that.

### 8.4 The memory ceiling, remeasured — the wall moved from 3 M to 4 M documents

Same fixture as Wave 1, so the numbers are comparable: N documents of one entity, two field indexes
and one maintained aggregate, `heapUsed` after a forced collection, in a **2 GB** heap — a
conservative browser tab. It is now a test rather than a script, which is the only way a ceiling stays
true:

```
ND_MEM=1000000,2000000,3000000,4000000 \
  node --expose-gc --max-old-space-size=2048 --test test/e-read.test.js
```

| documents | heapUsed, all-in | Wave 1 | | of which the caller's tree map | B/doc, index only | `materialize()` |
| --- | --- | --- | --- | --- | --- | --- |
| 1 000 000 | **451 MB** | 546 MB | −17 % | 146 MB (153 B/path) | **314 B** | 9.8 s |
| 2 000 000 | **917 MB** | 1 072 MB | −14 % | 287 MB (150 B/path) | **328 B** | 18.0 s |
| 3 000 000 | **1 375 MB** | 1 693 MB | −19 % | 457 MB (160 B/path) | **319 B** | 186.6 s |
| 4 000 000 | **1 748 MB** | **out of memory** | — | 571 MB (150 B/path) | **307 B** | 394.7 s |
| 5 000 000 | **out of memory** | out of memory | — | ~750 MB | — | — |
| 10 000 000 | *not attempted to completion* | — | — | ~1 500 MB | — | — |

*`materialize()` in this table is not a like-for-like against Wave 1's column: these runs were taken
at load average 12–43 with four other agents building Wave 2, and the same 3 M build measured 20.0 s
on the same code when the machine was quieter — against Wave 1's 62.5 s, which its own table calls
GC-bound. The memory column is not affected by load, and it is the column this section is about.*

*The 10 M row says "not attempted to completion" and means it: the run was started in a 12 GB heap and
was killed after twenty minutes with the machine at load average 78–102, having ingested a fraction of
the tree. Reporting a number from it would have been reporting the load average, and reporting nothing
would have hidden that the attempt was made. The row that answers the target is the 5 M one.*

> **The ceiling is ~4 million documents in a 2 GB heap and 5 million is the wall — one million more
> than Wave 1, on the same fixture, and 3 million is no longer GC-bound. ≈310 bytes per document for
> documents plus two indexes plus an aggregate, against Wave 1's ≈415.**

Three things this table says that Wave 1's did not.

**The caller's tree map is a third of the ceiling.** `readTree()` hands over a
`Map<path, oid>`, and that map costs **150 bytes per path** — 571 MB at four million documents, before
a single document is indexed. Wave 1's "≈415 B/doc, all-in ... including the tree map the caller
holds" cannot have included it: its own baseline was ~131 MB at a million paths, which *is* the tree
map, measured before the first reading. So the honest comparison is index-against-index — 415 → 310 —
and the tree map is a separate, larger-than-expected line item that this table now reports on its own.
It is also removable: see the contract note at the end of this section.

**The wall moved because of *peak* memory, not settled memory.** The 4 M run under Wave 1's code died
with "ineffective mark-compacts near heap limit" while its settled size was 1.75 GB — comfortably
inside 2 GB. What killed it was `toEntries()` allocating one two-element array per path, ~240 MB live
for the whole build. §3 has the fix. A post-collection number cannot see a peak, which is worth
remembering the next time a ladder looks safe.

**The ledger's own shapes do not degrade at all.** At four million postings the trial balance over 400
accounts is **2.2 ms**, `sum of amount over posting where account = X` is **0.003 ms**, and a point
lookup is **0.002 ms** — the sub-millisecond band, at four times the gate's target, because those
answers come from maintained structures that never touch a document.

**What sets the ceiling now, in one sentence:** the parsed documents themselves. At ~310 B/doc the
index is ~80 % documents and ~20 % index structures, and no layout available inside this directory
removes a parsed JS object. That is why FD-10 item 2 exists and why §8.7 is the section that matters.

For context, the roadmap's 500 M€ company: 3–5 M documents *per year*. Four million holds a year, a
decade needs 30–50 M, and **the honest answer to FD-10's 10 M target is: not reached, and not
reachable this way.** The measurement that says so is the 5 M row — `Ineffective mark-compacts near
heap limit` in a 2 GB heap — and the size of the gap is arithmetic on a figure measured four times:
10 M documents at 307 B/doc is **≈3.1 GB for the index alone**, plus ~1.5 GB for the tree map as the
contract stands. Nothing that keeps a parsed JS object per document fits that in a browser tab, and
the only item on FD-10's list that removes the object rather than shrinking it is item 2 (§8.7).

**Contract note, additive and unclaimed.** `materialize({ readTree })` accepts a `Map`, and now also
any iterable of `[path, oid]` pairs — `sortedPathList()` no longer builds pair arrays either way. A
`readTree` that *yielded* pairs instead of materialising a map would remove the 150 B/path line item
entirely (two parallel arrays cost 16 B/path), which is ~550 MB at four million documents and the
difference between four and six million in the same heap. The read path can consume that today; what
does not exist is a streaming `readTreeAtHead()` in `runtime/git/`, and that file is not mine. Named
rather than half-built.

### 8.5 The columnar projection, A/B — the number FD-10 asked for, and it is 1.1×

Both indexes built in **one process** from one fixture, measurements **alternated**, best of 15. That
methodology is not fussiness: the machine was shared with four other agents building Wave 2 (load
average 12–43 throughout), so two separate processes would have measured the load average, and a
mean would have measured it twice.

The table itself came from a two-index-one-process harness, because that is the only way to alternate.
`ND_COLUMNAR=off` on the ladder reproduces the *same comparison across two processes*, which is
weaker for exactly the reason above and is offered because it needs no harness: a `ND_SCALE=1000000`
pair with and without it agreed with this table to within the noise (48.3 ms boxed against 47.0 ms
columnar for the Appendix VI query).

| query, 1 000 000 invoices + 125 000 customers | columnar | boxed | | candidates col/boxed |
| --- | --- | --- | --- | --- |
| Appendix VI (join + 4 predicates + sort), FD-1 money | **49.8 ms** | 55.0 ms | 1.10× | 59 207 / 83 086 |
| the same with a plain-number total | 52.6 ms | **47.3 ms** | **0.90×** | 59 207 / 83 086 |
| 2 predicates, 25 % selective (Wave 1 returned "scan") | 44.4 ms | 43.9 ms | 0.99× | 78 953 / 83 086 |
| 3 predicates over one entity | **32.9 ms** | 37.1 ms | 1.13× | 39 562 / 83 086 |
| 3 predicates, genuinely selective (CHF + Q3 + amount) | **4.10 ms** | 5.40 ms | 1.32× | 1 021 / 12 457 |
| the same as a `count` | **3.72 ms** | 5.04 ms | 1.35× | 1 021 / 12 457 |
| 2 equality predicates, neither selective | 7.15 ms | **6.71 ms** | 0.94× | 49 908 / 49 908 |
| range query (`total >= 39 000.00 EUR`) | 22.4 ms | 23.6 ms | 1.05× | 23 676 / 23 676 |
| trial balance (maintained aggregate — no candidates at all) | 0.255 ms | 0.251 ms | 0.98× | — |

**Read that honestly: 1.0–1.35× where it helps, 0.90–0.94× where it does not.** It costs 4 bytes per
row per built index — 32 MB at four million documents with two indexes, 2.7 % of the footprint — and
it never loses more than ~10 %. So it stays, on by default, with `columnar: false` for a caller that
is memory-bound rather than latency-bound. It is **not** the order of magnitude FD-10 expected, and
the reason is structural rather than a tuning failure: §8.3.

Two things in the table deserve pointing at.

* The **0.90× row is the honest cost of a pass that does not pay**: `currency = 'EUR'` is 95 % of the
  rows and `totalNum > 10000` is 75 %, so the column walks 83 086 rows to eliminate 24 000 and the
  pipeline then re-checks the survivors anyway. A selectivity threshold would turn those losses into
  ties; it is not in, because a threshold is a tuning parameter that needs its own measurement at
  every scale and 10 % is not worth a knob.
* The **1.32× row is the best case, and it is a 12× smaller candidate set.** That is the ceiling on
  what a column can do here, and it is the clearest possible statement of why the invariant costs
  what it costs.

### 8.6 Composite indexes: dropped, measured

FD-10 item 3, estimated in Wave 1 at ~8× for a `(reference, date)` index on the Appendix VI shape.
**Measured at ~3–4×, on one query shape, and dropped.** The measurement, at a million invoices:

| the full Appendix VI query, date window narrowed | candidates | rows | best of 15 |
| --- | --- | --- | --- |
| a quarter (the real query) | 59 207 | 7 558 | 141.9 ms |
| a month | 19 646 | 2 526 | 69.5 ms |
| ten days | 7 137 | 938 | 40.2 ms |
| one day | 655 | 83 | 33.4 ms |

*(These four were taken at load average 21–40 and are inflated roughly 3× against §8.1's numbers. The
ratios between them are what the argument uses.)*

A `(customer, date)` composite would produce ~10 400 candidates instead of 59 207 for this query —
the 15 864 Bavarian customers, each binary-searched for the date window — which lands between the
"month" and "ten days" rows, so **~3–4×, not 8×**. Wave 1's 8× came from comparing candidate counts;
the curve shows candidate count is not the whole cost, because the surviving rows still pay a join,
a sort and an allocation each.

Against that: a second key type, a second place drift can hide, a `dump()`/`verifyIndexes()` shape
for a two-level key, planner recognition of an (equality-via-join, range) pair, and a maintenance
path for every transition the drift tests already cover once. In a wave whose actual blocker is
memory, that is the wrong purchase — and FD-10 says so itself: *"Build it if the measurement holds;
drop it and say so if it does not."* It does not hold. Said.

**What the measurement did find, and it was free.** The join-driven planner computed its *exact*
estimate — two index lookups per peer, 15 864 peers, ~63 000 map lookups — **before knowing whether
it could win**, so every query with a join paid it and threw it away. Measured at a million invoices:
a join query whose real work was 0.09 ms spent **5.9 ms** deciding not to take that route. It now
takes the cheap bound `peers × average bucket` first and only walks exactly when the cheap bound says
it could still win. Same plans, same answers; the fixed cost went **5.9 ms → 0.22 ms**, and the
selective join query went 6.98 ms → 1.65 ms. A pessimistic bound costs a slower plan and never a
wrong answer, which is the trade §4 already makes for range estimates.

### 8.7 Lazy materialisation: not built, and why the decision is not mine

FD-10 item 2 — "hold indexed values plus the path; fetch documents from git on demand" — is the item
that **removes** the ceiling rather than raising it, and it is the only one of the three that would
reach 10 M documents. It is not built, and the reason is a contract, not an estimate.

Fetching a document from git is asynchronous. The read path's `Source` contract is
`all(entity)`, `get(entity, id)`, `scan(entity)` — all synchronous, and `query.js`'s entire pipeline
is a synchronous loop over them. Making them asynchronous does not stop at this directory:

* **`runtime/polism/execute.js` — `evaluate(model, intent, world, options)` is a synchronous pure
  function**, and the whole rule engine is built on that. It reads documents through `world.get()` in
  at least six places (`follow()`, `stagedWorld()`, `evalAggregate()`, `applyConsequent()`,
  `readFrom()`, `resolveTarget()`), all synchronous helpers called from synchronous code. An async
  document read makes `evaluate()` async, which makes every one of those helpers async.
* **`runtime/kernel.js`** builds the world it hands to `evaluate()` (`get: (entity, id) => index.get(…)`,
  `find: (entity, pred) => index.where(…)`), and calls `evaluate()` from inside `performOne()`. It also
  reads documents synchronously in the FD-6 sequence allocator and in the entity-count guard. The
  kernel's own callers are already `async`, so the *await* is free there; what is not free is that
  `evaluate()`'s version-1 contract — which `kernel.js` twice states in comments that it is preserving
  — would change.
* **`runtime/ui/viewmodel.js`** renders from `index.all()`, `index.get()` and `index.where()` inside
  synchronous view builders.

So the honest position, and the reason this section exists instead of a half-built lazy mode:
**lazy materialisation is a change to the rule engine's contract, and two of the three files it
lands in belong to other agents this wave.** ROLES owns `runtime/kernel.js`; polism's grammar
contract is not mine to version. Shipping an async `Source` that no caller can adopt would be the
third instance of the specification error Part 1 of the roadmap names — a capability without the
sentence around it.

**What it would cost and what it would buy, so the decision can be taken on numbers.** Per document
the index would keep an id, a row slot and 4 bytes per column, and *not* the parsed object: from
§8.4's ≈293 B/doc to an estimated ~70–90 B/doc, which puts 10 M documents inside a 2 GB heap with
room for the git object cache. What it costs is that `all()` and `where(pred)` stop being cheap —
they become a fetch per document — and that every predicate the index cannot serve becomes I/O
rather than a cache miss. A ledger's hot shapes (`sum … where account = X`, the trial balance, an
indexed equality lookup, a point lookup) are unaffected, because they are answered from maintained
structures that already never touch a document.

Nothing in §8.7 is a reason to distrust the numbers above. It is the reason to publish them.

---

## 9. Still not done

* **No full-text search.** Searching text is a scan with no ranking and no stemming. Unchanged from
  v0.1, and a separate decision (Appendix VI itself says FTS5 would be insufficient).
* **No SQL surface for MCP.** Principle 7's model targets a query object rather than the SQL it
  already knows: no multi-hop joins, no subqueries, no `HAVING`, no window functions, no `DISTINCT`.
  The compensation is real — a narrow, un-injectable surface where an unknown key or operator is
  refused loudly rather than guessed at is a safety property a raw SQL channel does not have.
* **No composite indexes** — dropped on measurement, §8.6, and the estimate that justified them is
  now known to have been 2× optimistic. **No histograms** (§4 — a range estimate on a skewed field
  can be wrong, which costs a slower plan and never a wrong answer).
* **No lazy materialisation** (§8.7), which means **the ceiling is still a ceiling**: ~4 M documents
  in a 2 GB heap, and a 500 M€ company is 3–5 M documents *per year*. This is the one item on this
  list that a reviewer should read as a blocker rather than as a limit, and it is blocked on a
  contract decision rather than on work inside this directory.
* **Index intersection is now real but only columnar** (§8.5). Two *bucket* sets are still never
  intersected, for the arithmetic in §4; the intersection happens over dense columns instead.
* **The join is the next measured hot spot, and it is not the index.** At a million invoices the
  Appendix VI query spends more time resolving the join and building result rows than it spends on
  candidates and predicates together: adding the join and its predicate to an otherwise identical
  59 207-candidate query costs ~1.6 µs per candidate, which is one `get()` through the peer store
  plus one alias object plus one row wrapper per surviving row. Two allocations per row and a hash
  lookup per row are all removable — the peers could live in a parallel array addressed by alias
  index rather than in a per-row object — and none of it needs a new structure. Named, measured,
  and not done, because it is a rewrite of `query.js`'s row representation and this wave's blocker
  was memory.
* **`all(entity)` sorts every id on first use.** A million-document entity pays a million-string
  sort once per index version. The query pipeline avoids it — `scan()` is used whenever the answer
  cannot depend on row order — but a caller reaching for `all()` at that scale should know.
* **Row holes are never reclaimed.** `rows.length` tracks the peak live count, not the current one,
  because renumbering would invalidate every index. Reported by `indexStats().occupancy`; the
  remedy is to rebuild, which is free by construction.

---

## 10. Contract changes, and the ones that are only named

Every change to what a caller sees, in one place, because a directory that quietly widens its own
interface is how a repository stops being reviewable.

**Changed, additively — no caller has to do anything.**

| what | where | why |
| --- | --- | --- |
| `materialize({ columnar })` and `indexOf(docs, { columnar })`, default `true` | §3 | The columnar projection. `false` measures the boxed path back-to-back on one machine, and is the right setting for a caller that is memory-bound rather than latency-bound. |
| `readTree()` may return **any iterable of `[path, oid]` pairs**, not only a `Map` | §8.4 | The map is 150 B/path and 571 MB at four million documents. A generator costs 16 B/path. Nothing else changes; a `Map` is still an iterable of pairs. |
| `indexStats()` gains `columnar`, `interning`, and per-field `columnRows` / `unranked` | §3 | A structure whose cost is not reported is a structure nobody will notice growing. `interning.hits` is what exposed the interner defect. |
| `looksLikeMoney` **is now `runtime/money/`'s function**, re-exported | §5 | One name, one meaning, repository-wide. The old one was a shape test that answered `true` for `"5.00 XXX"`. |

**Behaviour that changed inside an unchanged interface** — worth stating because "no API change"
is not the same as "no change":

* A plan whose estimate covers more than half the entity used to fall straight through to a document
  scan; it now walks the column first and falls through only if that failed to narrow. Same answers,
  a different `explain()` string (`columnar scan …`).
* `explain()` reports `∩ columnar (…) → n` when the candidate set was narrowed columnar-wise.
* The join-driven planner takes a cheap estimate first and declines early where it cannot win, so a
  plan it would have lost anyway is no longer computed exactly. Same plans chosen; §8.6.

**Named and *not* done, because each needs a file this directory does not own.**

1. **An asynchronous `Source`, for lazy materialisation.** The only route to 10 M documents. It makes
   `evaluate()` in `runtime/polism/execute.js` async and therefore changes the rule engine's
   version-1 contract; `runtime/kernel.js` builds the world it hands over. §8.7 has the full caller
   inventory. **This is the decision that decides whether FD-10's target is reachable, and it is not
   mine to take.**
2. **A streaming `readTreeAtHead()`** in `runtime/git/`. The read path can already consume one; ~550 MB
   at four million documents, and the difference between four and six million in a 2 GB heap.
3. **`decodeOrNull(value) → {code, scale, minor} | null` in `runtime/money/`.** Then `parseMoney`
   becomes a re-export like `looksLikeMoney` did, and this directory holds no monetary parsing at all.
   `currencyOfOrNull` cannot serve it: it returns no minor units and it uses an exception on the
   reject path, which is the common case when classifying every string of every document. §5.
