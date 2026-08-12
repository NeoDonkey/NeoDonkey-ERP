# Road to NeoDonkey 1.0

**Owner:** CTO. **Supersedes:** `docs/ROADMAP.md` (kept for its compromise audit, which stands).
**Test this document is written against:** a stranger clones the repo, asks a competent reviewer
*"is this a legitimate ERP for our 500 M€ company?"*, and the answer is yes, with named limits.

---

## The finding that reorganised this roadmap

v0.1's compromise register had 22 entries and missed the three things a reviewer notices first.

**1. It is not an ERP.** There is no double-entry accounting. No chart of accounts, no journal, no
posting, no payment, no bank statement, no trial balance, no period close, no VAT return. What
exists is an execution engine for operating models over a signed Git substrate — genuinely novel,
and not an ERP. "ERP" to a CFO means *the general ledger is the system of record*. Until debits
equal credits inside NeoDonkey, every other claim is a demo.

**2. Money is a floating-point number.** `money` is "a plain number", JSON numbers are IEEE 754
doubles, so 19 % VAT on 4 999.99 evaluates to 949.9981 and `0.1 + 0.2 ≠ 0.3`. This is not a
rounding preference; it is the reason auditors reject software. One grep ends the evaluation.

**3. Git objects are all loose.** At the manifesto's own figure of ~5 000 commits/day, ten years is
tens of millions of files in `.git/objects`. Git solved this with packfiles twenty years ago. Our
"Git is the database" claim currently means "Git in its slowest possible configuration".

None of the three is a compromise anyone chose. They are things nobody looked for, which is worse.
So v1.0 is organised around **foundation first** — the decisions that are expensive to change once
data exists in the field — and every foundation decision is made below, normatively, by me.

---

## Part 1 — Foundation decisions (normative, binding on all agents)

These are settled. Not proposals. An agent that finds one of them wrong reports it and stops; it
does not work around it.

### FD-1 — Money is an exact decimal with its currency, stored as one string token

```json
{ "net-amount": "4999.99 EUR", "vat-amount": "950.00 EUR", "gross-amount": "5949.99 EUR" }
```

*(Corrected after agent M pointed out that the original example wrote `949.99 EUR` — truncation —
while this same decision mandates commercial half-up. 19 % of 4999.99 is exactly 949.9981, and a
German invoice under half-up shows **950.00**. The error is instructive: the wrong value is what you
get by letting a float land where a decision belonged, which is the entire reason for FD-1.)*

* **Canonical form:** optional `-`, digits, `.`, exactly the minor-unit digits ISO 4217 gives that
  currency (EUR 2, JPY 0, TND 3), a single space, the alphabetic code. No thousands separators, no
  `+`, no exponent, no bare `0.5 EUR` where the scale demands `0.50 EUR`.
* **Why a string, not a number:** every JSON parser on earth turns `4999.99` into a double. A
  string round-trips byte-exactly, in 2027 and in 2045 (Principle 6). It is also self-describing:
  an auditor reading raw JSON in `git show` sees the amount *and* the currency, which no
  `{amount, currency}` object improves on and no float can promise.
* **Arithmetic:** internally `BigInt` minor units. **No `Number` ever touches a monetary value**,
  anywhere in the runtime. A single `parseFloat` on a money field is a release blocker.
* **Mixed currencies do not add.** Adding `10.00 EUR` to `10.00 USD` is refused, not converted.
  Conversion is an explicit modelled act carrying its rate and date, because that is what an
  auditor must be able to see.
* **Rounding is declared, never implicit.** The model states the rule (commercial half-up per line,
  or per invoice total) and the runtime applies exactly that. Allocation of a rounded total across
  lines uses largest-remainder so the parts sum to the whole, always.
* `number` remains for counts and quantities. Quantities get their own decimal scale where a
  business needs it (0.001 kg), by the same string mechanism.

### FD-2 — Packed object storage, and Git remains the judge

Implement packfile v2 (read and write) plus `.idx` v2, and repack when loose objects exceed a
threshold. Interop is non-negotiable: `git verify-pack`, `git fsck --strict`, `git cat-file` and
`git log` must all be happy with what we write.

**Deltas — corrected after agent P pointed out that my original wording was ambiguous in a way
that mattered.** *Reading* `OFS_DELTA` and `REF_DELTA` is **mandatory, not optional**: a repository
a human cloned with `git clone` is mostly deltas, so a store that cannot read one cannot open a
real repo — which would make "Git is the database" false in the only case a customer cares about.
*Writing* deltas is optional in v1.0. Measured cost of not writing them, same object set, ours
versus git's: **12.2× larger** on a corpus of repeatedly-revised documents, **1.53× larger** on
distinct one-off documents. An ERP is mostly the latter.

**Target to prove, on real hardware:** 10 million objects, `git fsck --strict` clean, our own
`log()` and `readTreeAtHead()` within stated bounds. **Plus a pack-count and resident-memory bound**
— also agent P's correction, and a sharper one than my original target. The binding constraint at
that scale is not the pack format but pack *proliferation*: at the default repack threshold, 10 M
objects means ~2,000 packs whose indexes are all held in memory, so the number could be "met" by a
repo that is technically clean and practically unopenable. Geometric repacking (git's
`--geometric`) is the answer. If a number disappoints, publish the number.

### FD-3 — One repo per legal entity, joined by signed cross-references

Appendix III already says a large company is a mesh of repos. A cross-reference is
`<repo-id>:<entity>/<id>`, resolved through a `repos.json` manifest naming each sibling and the
public keys allowed to sign in it. Consolidation reads many repos and writes its own. This is a
foundation decision because a single-repo assumption is unpickable later.

**Two clarifications agent P had to make in code, which belong here in the text instead:**

* `repos.json` carries a **`self`** field naming the repo it sits in. Without it a local reference
  cannot be resolved to an absolute one, and consolidation cannot say which entity a document came
  from. A local reference in a manifest with no `self` is an error, not a guess.
* A sibling entry with **no `keys` array is refused**. Treating it as "anyone may sign there" would
  be v0.1's permissive-default defect wearing a different hat. An explicitly empty `keys: []` means
  "nothing verifies in that repo", which fails closed.

**Distributed transactions across repos are out of scope, and stay out.** A business event that must
be atomic belongs in one repo and therefore in one commit (Appendix VIII, simple case). Anything
spanning legal entities is two documents joined by an explicit reference — which is exactly what
intercompany accounting does on paper, and pretending otherwise would import the hardest problem in
distributed systems to solve a problem accountants already solved.

### FD-4 — The general ledger is modelled, not built in

Double-entry lives in `operating-model/` as entities and rules, like everything else — otherwise
Principle 11 is a slogan and we have a hard-coded finance module with a text file next to it. This
forces the grammar to grow up (FD-5), which is correct: a grammar that cannot express "debits
equal credits" cannot express a company.

### FD-5 — Grammar v2 gains exactly what accounting requires, and nothing else

Additive per §0, so every 2027 model still runs:

1. **Invariants** — `## Invariants` on an entity: conditions that must hold after any change, or
   the commit is refused. This is how debits = credits becomes structural.
2. **Aggregation** — `sum of <field> over <entity> where <condition>`. Required for a trial
   balance, a VAT return, and an order total.
3. **Branches** — `then when <condition> … otherwise …`. Removes the conjunctive-contradiction trap
   and makes threshold authorisation expressible.
4. **Enumerations** — `status: one of draft, posted, cancelled`. A typo becomes a refusal.
5. **Per-rule authority** — `## Authorized by` scoped to a rule, and to an entity+operation as the
   default. Closes the default-allow hole additively.
6. **`with +<field> from <other-field>`** — kills the duplicate-field workaround.
7. **Periods** — a locked period refuses postings dated inside it. Correction is a new entry, never
   a mutation.
8. **`Create <entity> as "<label>"`** — a labelled create, so one rule may create *several*
   documents of the same entity. Added on 2026-08-03 after agent G2 refused to add it unilaterally
   and ranked it first, and after agent F2 independently wrote the identical syntax.

   **Why this is completing FD-5 rather than extending it.** Double-entry bookkeeping creates two
   or more postings from one event — that is what "double" means. Item 1 of this list mandates
   invariants so that debits equal credits; but an invariant over a set is worthless if the grammar
   cannot create the set. Without a labelled create, every posting inherits the trigger's id and
   the second collides with the first, and they cannot be accumulated one at a time either, because
   the balance invariant fires on each and a single posting never balances. So FD-4's ledger is not
   merely awkward to express — it is **impossible**, and items 1 and 8 are one decision that I
   wrote down as half of itself.

   The form: `Create posting as "receivable"` yields id `<trigger-id>-receivable`. Deterministic,
   no counter, no clock, no randomness; the label is readable in the text and appears in the commit
   trailer, so an auditor sees *which leg* of the entry a document is. Duplicate labels in one rule
   are a parse error.

9. **`with <field> from <other-field>` for non-counters, and one-hop paths on the right-hand side.**
   Added 2026-08-03, immediately after item 8, once agent G2 measured what item 8 actually unblocks:
   **nothing, on its own.** F2's posting scheme needs 134 such clauses, 107 of them one-hop
   (`chart.receivables-account-number`, `invoice.gross-amount`, `vat-treatment.output-vat-account`).
   Account numbers and amounts are neither literals nor same-named fields of the trigger, so no
   construct in the grammar can reach them.

   Needs no new concept: it is the *set* twin of the counter form item 6 already provides, over the
   one-hop resolution §4.1 already performs, type-checked at parse time from the same declarations.

### A note on items 1, 8 and 9 — the same specification error, three times

I specified invariants (item 1) so that debits could equal credits, without a way to *create* the
set the invariant ranges over. Item 8 fixed that, and I specified it without a way to *fill* the
documents it creates. Each time an agent found it, refused to close the gap on its own authority,
and named it — and each time the missing piece was not a feature anyone wanted but the other half
of something I had already decided.

The pattern is worth naming because it will recur: I was specifying **capabilities** while the
grammar needs **complete sentences**. "The ledger balances" is not one decision; it is create the
legs, fill the legs, and check the total, and any two of the three are worth nothing. When I add to
FD-5 again, the test is not "is this construct justified" but "can a rule now be written end to end
by someone who is not me".

Credit where due: both agents were right to stop. A grammar that grows by "we needed it" is ABAP,
and the discipline that produced three refusals is worth more than the three constructs.

**Nothing else.** No loops, no user-defined functions, no expressions beyond the above. The moment
this grammar becomes a programming language we have rebuilt SAP's ABAP and lost.

### FD-6 — Legally gapless document numbers

Invoice numbers must be sequential and gapless (GoBD, and the equivalent everywhere in the EU).
A sequence is a document; allocation happens inside the same atomic commit as the document that
consumes it. Cross-peer, the authoritative-peer rule from Appendix VIII governs. Numbers are never
derived from a count of existing documents — that breaks on deletion and on concurrency, and it is
what v0.1 does today.

### FD-7 — Default-deny, arrived at additively

Per agent C's correction: flipping the default changes the meaning of existing models, which is a
major-version act. So v1.0 ships entity+operation authority declarations, a parser warning for
every uncovered pair, **and a kernel setting that refuses uncovered operations, default on for new
workspaces**. A 2027 folder keeps its meaning; a new company is safe from the first commit.

### FD-10 — The read path must hold a decade, not a year. Columnar projection is v1.0 work.

**Added 2026-08-03 after agent Q measured the ceiling instead of estimating it. Binding.**

Measured, 2 GB heap (a conservative browser tab), documents plus two indexes and one aggregate:
1 M → 546 MB / 5.7 s · 2 M → 1,072 MB / 13.8 s · 3 M → 1,693 MB / **62.5 s, GC-bound** ·
4 M → **out of memory**. **≈415 B/document, stable.** Usefulness degrades well before the wall:
past ~1 M the garbage collector, not the index, sets the pace.

**Why this is a gate blocker rather than a note.** A 500 M€ company's invoices, lines and postings
are 3–5 M documents *for one year*. A decade is far past the wall. The whole document exists to
answer "is this a legitimate ERP for our 500 M€ company", and "it holds a year" is a no.

Also measured, and it changes the diagnosis: query cost at scale is bound by **memory locality**,
not by algorithms. Per-candidate filter cost runs 71 ns at 150 k documents → 244 ns at 1 M, because
candidates are scattered across hundreds of thousands of separate JS objects and every predicate
pays a cache miss once the working set leaves L3. The query plan is right; the data layout is wrong.

**Required for v1.0, in this order:**

1. **Columnar projection.** A dense typed array per index — `BigInt64Array` of minor units for money,
   integers for dates — so a filter walks one compact array instead of chasing pointers. Bounded,
   behind the existing `FieldIndex` interface, no dependency, and it *reduces* per-document memory
   (8 bytes versus ~60 boxed).
2. **Lazy materialisation.** Hold indexed values plus the path; fetch documents from git on demand.
   This *removes* the ceiling rather than raising it. The cost is real and must be stated: `all()`
   and `where(pred)` stop being cheap, and the source contract becomes asynchronous.
3. **Composite indexes** where measurement justifies them — Q measured ~8× on the Appendix VI shape
   at 1 M from a `(reference, date)` index.

**Note the reversal.** COMPROMISES #3 argued SQLite-WASM was the exit path for *speed*. After
indexing, speed is largely solved (trial balance over 1 M postings: **0.349 ms**). What is not
solved is **memory**. So if SQLite-WASM returns, it returns as a storage argument — the opposite of
what we originally wrote, and worth saying out loud, because it means we would have adopted a
dependency for the wrong reason.

### FD-9 — A caller's roles are the intersection of what it claims and what the repo records

**Added after agent S escalated it rather than deciding it. Binding.**

Today `intent.actorRoles` is a **claim the caller makes about itself**. The kernel enforces it
faithfully — and then trusts it completely. So `perform({actorRoles: ['managing-director']})` from
any script, any MCP client, any browser tab, is a managing director. Signature requirements are
already repo-backed (a peer's roles are recorded in its signed peer record, and a missing `roles`
array is refused as `roles-not-recorded`), but ordinary rule authorisation is not. Two mechanisms,
two trust levels, one of them decorative.

**The decision: roles are `claimed ∩ recorded`.** The caller may narrow its authority — a
managing director acting deliberately as a warehouse clerk is a legitimate and useful thing to do,
and it is how a careful operator tests a rule. The caller may never widen it. Intersection, never
replacement: replacement would let an empty claim mean "all my roles", which silently widens
authority in exactly the direction that hurts.

Consequences, stated because they are the reason S did not do this unilaterally:

* `addPeer({roles})` becomes mandatory in practice — a peer with no recorded roles can perform
  nothing that any rule governs, which is the correct default and will look like a regression to
  anyone who was relying on the claim.
* `mcp/server.mjs`, `runtime/ui/**` and `demo/sarah.mjs` all currently pass role arrays they do not
  hold. Each must instead act as its operator's peer identity.
* A single-operator workspace is unaffected in feel: the owner's peer record carries their roles,
  and everything they claim is a subset of it.

**Category: our shortfall.** By Part 4 rule 2 it therefore may not survive a release — it lands in
Wave 2, alongside the encryption work that has the same shape (authority proven cryptographically
rather than asserted).

### FD-8 — JavaScript, consciously, and Principle 3 is amended to say so

Decision made, not deferred. The runtime stays plain ES modules. The reasoning, for the record:

* Appendix III line 129 demands the accounting core be *readable by any auditor*. A `.wasm` blob
  cannot be read; a reproducible build script only moves the trust, it does not remove it.
* Our zero-dependency position already delivers what Principle 3 actually wants — nothing we
  cannot replace, nothing we did not write, no vendor anywhere.
* WASM's real wins are speed and memory safety. Speed we address where it matters (FD-2, indexes)
  and can measure. Memory safety is a weaker argument in a language with no manual memory.
* Therefore Principle 3's wording changes from "WebAssembly for the runtime" to the browser sandbox
  and web standards as the substrate. **This is an amendment to the constitution, not a
  compromise entry** — the difference matters, and hiding it in COMPROMISES.md would have been the
  dishonest option.

WASM stays permitted for a narrow, benchmarked hot path (SHA-1, inflate) if and only if measurement
demands it, with the JavaScript retained as the readable reference implementation.

---

## Part 2 — The v1.0 gate

Ten conditions. I will not recommend publication until all ten hold. Any one of them failing is
what turns a clone-and-review into "no".

1. **Debits equal credits, structurally.** A trial balance that balances, from a general ledger
   modelled in POLISM, with a period close and a correcting entry that leaves the original intact.
2. **No float in any monetary path.** Asserted by a test that greps the runtime, and by
   property tests over VAT, allocation and rounding.
3. **Authorisation is closed.** Nothing uncovered is permitted; four-eyes is two signatures over
   one payload; thresholds are enforced by rules, not prose.
4. **Two real machines sync**, and a company is recovered after one is destroyed.
5. **Sensitive data is encrypted** with group keys, per-peer indexes, and GDPR erasure by
   destroying a DEK while the GoBD chain stays verifiable.
6. **It speaks to the outside world.** DATEV export, XRechnung/EN-16931 invoices, one inbound
   dialect, and the same-foreign-event-same-commit property demonstrated across two peers.
7. **Scale is measured, not asserted.** 10 M objects, 1 M documents, published numbers for
   materialisation, query, commit and `git fsck`. Honest if unflattering.
8. **A German auditor's questions have written answers.** Verfahrensdokumentation cross-referenced
   to code, covering Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit,
   and where the signing key lives.
9. **An adversary tried.** External review plus a red team whose only brief is: forge a commit,
   bypass a rule, unbalance the ledger, push unsigned code, read another group's data.
10. **Every claim audited.** README, manifesto and site checked line by line against behaviour;
    anything not yet true labelled *not yet*, in the same typeface as the promises.

---

## Part 3 — Waves

Built the way v0.1 was: parallel agents against a written contract, because every serious v0.1
finding came from one thing checking another and none from an author reviewing themselves.

**Wave 1 — Foundation.** Money core (FD-1) · packfiles and repo mesh (FD-2, FD-3) · grammar v2
(FD-5) · authorisation, four-eyes and gapless numbering (FD-6, FD-7) · scalable indexed read path ·
the double-entry finance model design (FD-4).

**Wave 2 — The claims.** General ledger, AR/AP, VAT/OSS returns, period close, multi-currency ·
encryption groups and GDPR shredding · WebRTC sync, relay, QR introduction, cross-peer atomicity.

**Wave 3 — Sellable.** DATEV, XRechnung, Shopify dialect · PDF from versioned templates ·
consolidation across entities · Verfahrensdokumentation · template onboarding.

**Wave 4 — Publish.** Red team · scale benchmark · claim audit · three strangers install it
unaided · a plain, confident UI · then the repo, the release fingerprint, and a demo that is mostly
a terminal.

---

## Part 4 — Standing rules for every agent, for the rest of this project

1. **Foundation decisions above are binding.** Disagree by reporting, not by working around.
2. **A compromise entry must name its category** (our shortfall / real work / platform limit /
   manifesto is wrong). **Category "our shortfall" may not survive a release.** This rule exists
   because v0.1 proved that writing an eloquent compromise feels like integrity while substituting
   for the fix.
3. **Foreign tooling is the judge.** Real `git`, real `ssh-keygen`, real browsers. Our code
   agreeing with itself is not evidence.
4. **Ask what happens when nothing applies.** The worst v0.1 defect was a permissive default that
   213 tests never questioned.
5. **Never report a pass you did not observe.**
