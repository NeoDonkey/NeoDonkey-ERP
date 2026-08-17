# Known Compromises — NeoDonkey

> "Whenever an implementation decision creates tension with a principle, the principle wins by
> default. If the tension cannot be resolved, we document the compromise explicitly — where, why,
> and how we get back to the principle in the next release. The manifesto stays intact; the
> compromise is a known debt with a name and an owner."
> — Manifesto, closing note

This file is that register. It exists because Principle 10 says 99% is the goal and 100% is a
lie — so the 1% gets a name, an owner, and an exit path. A compromise documented here is
manifesto-compliant. A compromise not documented here is the only real failure mode this project
has.

Every entry is revisited at every release.

---

## How to read this register

**Every entry names its category.** That is Part 4, standing rule 2 of `docs/ROADMAP-V1.md`, and
the four categories are:

| Category | Means |
|---|---|
| **our shortfall** | We cut a corner, or built the wrong thing, and could fix it now. |
| **real work** | A genuine, sizeable piece of engineering that is not done yet. |
| **platform limit** | The web platform, or a browser, will not permit the ideal. |
| **manifesto or roadmap is wrong** | The specification is at fault, and the code is right. |

**Category "our shortfall" may not survive a release.** So the *our shortfall* list below is not a
summary — it is the release blocker set for v1.0, and clearing it is a gate condition in the same
sense as the ten in Part 2 of the roadmap.

**Entry numbers never change and entries are never deleted.** A closed entry moves to Part 2 with
what closed it and how that was verified. A register that forgets is indistinguishable from a
register nobody revisited.

**Nothing in here is asserted from a report.** Every status below was re-checked against the code
on 2026-08-03 (see the consolidation log). Where an entry once claimed a defect that is now fixed,
the entry has been rewritten and the old claim is quoted, because a false entry is quoted by a
reviewer exactly as readily as a true one.

---

## Summary

**22 open entries. 12 closed.** Counted 2026-08-13 (#13 closed by Daniel Pammé).

| Category | Open | Entries |
|---|---|---|
| **our shortfall** | **0** (+1 named residual risk) | #15 residual risk 7 |
| real work | 12 | #3, #4, #4c, #4f, #5, #6, #7, #16, #17, #18, #19, #20 |
| platform limit | 8 | #2, #8, #9, #10, #11, #12, #14, #15 |
| manifesto or roadmap is wrong | 2 | #4e, #4i |
| **closed** | **12** | #1, #4b, #4a, #4c-bis, #4d, FD-6, #4h, #22, #4g, #15 rr4, #21, #13 (Part 2) |

#15 is one entry carrying seven residual risks of two different kinds. The entry is counted as a
platform limit, because four of its risks are permanent properties of the web platform; its risk
7 is ours, and it is named individually in the blocker set for that reason.

### The release blocker set — category "our shortfall"

By rule 2, **none of these may be in v1.0 when it ships.**

| | What | Why it is ours | Cost |
|---|---|---|---|
| **#15 rr7** | The signed-runtime machinery ships unarmed: no production release key, no published fingerprint, no `release.json` in the repository. | "Publishing it is an hour of work, not an engineering project" — the entry's own assessment, and still true. | An hour, plus a decision about where the fingerprint is published. |

One item (#15 rr7) is hours rather than
days.

### Consolidation log — 2026-08-03, agent V

Six agents landed in parallel and appended entries in different styles; several entries had become
false. Every entry was re-verified against the code. **Ten statuses changed:**

| Entry | Was | Is | Evidence |
|---|---|---|---|
| #1 | open compromise ("JS instead of WASM") | **closed** | FD-8 decides JavaScript consciously and amends Principle 3's wording. A decision is not a compromise. |
| #3 | "the read path is a linear scan; sub-millisecond does not hold" | **rewritten, partly closed** | `runtime/read/index.js` now has equality, range, money and aggregate indexes. Indexed equality is 0.002 ms at 1 M documents and does not degrade; the trial balance over 1 M postings is 0.35 ms. The linear-scan claim is false. |
| #4b | open, "to be settled between F and C" | **closed** | Every line-item entity in both trees declares `position`; `test/f-model.test.js` asserts it and passes. |
| #4c-bis | open, "the worst defect in v0.1" | **closed for new workspaces** | FD-7 strict authorization; `test/s-integrity.test.js` "THE v0.1 ATTACK IS DEAD" passes against the real, verbatim `location.md`. |
| #4d | open, "four-eyes cannot be expressed" | **closed in the truth layer** | Two signatures over one payload, `git fsck --strict` clean, `git log --show-signature` reports **G**; four-eyes tests pass. Residuals are #16 and #18. |
| #4e | "the parser is 1,171 lines" | **number corrected upward** | `runtime/polism/` is 4,894 lines today. The entry understated itself by 3×. |
| #4f | a list of thirteen missing grammar features | **rewritten against grammar.md §20** | Six are resolved by grammar version 2. Eight remain, plus eight new version-2 limits. |
| #4g | "documented, not enforced" | **closed** | The mechanism shipped and `stock-write-off-approval.md` uses it. Three thresholds remain prose. Category changed to *our shortfall*, because the reason is now adoption rather than capability. |
| #15 rr4 | a requirement on the UI | **closed** | `release` passes to `renderRuntime()`, and the banner renders correctly on the UI. |

**Four things found while verifying that are not filed as entries** — they were reported to the CTO
instead, per instruction, rather than invented into the register by the agent that found them:
delta-writing in the packfile writer, the Live Layer's lack of FD-1 money, thirteen `status: text`
fields that never adopted enumerations (folded into #4f, where it keeps an existing entry truthful),
and two operating-model files whose prose still says a thing is inexpressible that is now
expressible (folded into #4g, for the same reason).

---
---

# Part 1 — Open

## #2 — Private keys live in the browser's key store, not the OS keychain

**Category: platform limit.** There is no browser API for the OS keychain and there will not be
one; the strongest primitive the platform offers is what we ship.

**Principle in tension:** Appendix IV (the personal Ed25519 key is a *primary secret* that "lives
only locally in each peer's OS keychain and never leaves it"), Appendix X ("private key into the
OS keychain"), Appendix XI (first line of defence, "protected by login password and possibly
Touch ID").

**Where it bites.** A web page cannot reach macOS Keychain, Windows Credential Manager or GNOME
Keyring. There is no browser API for it and there will not be one — exposing the OS keychain to
script is exactly the boundary the sandbox exists to hold. Since Principle 3 and Appendix X make
the browser the runtime ("she double-clicks the HTML"), the strongest guarantee in Appendix IV is
the one v0.1 cannot deliver as written. This is a real architectural conflict between two
manifesto commitments, not an oversight. It is also asymmetric: the Node peer (a CLI peer, the
always-on Hetzner peer) is *further* from the ideal than the browser peer, because there the key
genuinely is bytes in a file.

**What we shipped.**
- *Browser — the good case.* The key is generated `extractable: false` and the `CryptoKey`
  **object** is stored in IndexedDB, which persists it via structured clone. The private scalar
  therefore never exists as bytes in JavaScript: not at generation, not at save, not at load.
  Script that reaches the record holds a *signing handle*, not key material. At worst a
  compromised page can make the key sign while the tab is open; it cannot exfiltrate the key,
  cannot use it afterwards, and cannot move it to another origin. That is the strongest primitive
  the platform offers, and meaningfully better than "an encrypted file we decrypt into RAM".
- *Node — the weak case.* A JWK at `keys/<name>.json`, mode 0600 where the FsAdapter can set it.
  Key material is bytes on disk, protected by file permissions and full-disk encryption. Stated
  plainly, with no pretence otherwise.

**What still holds.** Appendix XI's honest core is intact. Full Disk Encryption still makes the
disk unreadable without the login password — "for 95% of thefts, that ends it". Mesh revocation
is untouched, since it depends on public keys in manifests, not on where the private key sleeps.
And the sentence that matters most — "they cannot impersonate Sarah, any peer detects the
compromised signature" — is now literally true in code: full SSHSIG verification runs in a
browser with no git and no ssh binary, proven against real `ssh-keygen` in both directions.

**What is genuinely lost.** Three things, precisely. No OS-level user-presence check (no Touch ID
prompt before signing, so a compromised-but-unlocked machine can sign silently). No OS-enforced
per-application access control, so any script on the origin can request a signature. And on the
Node path, anyone with the user's file permissions has the key outright.

**Exit path, in order of cost.**
1. *Now:* non-extractable `CryptoKey` in IndexedDB. Zero dependencies, every modern browser.
2. *Wave 2 — WebAuthn/passkey.* A platform passkey puts the key in the Secure Enclave/TPM behind
   Touch ID or Windows Hello — that *is* the OS keychain, reached through the one API the browser
   does expose. The obstacle is format, not access: WebAuthn signs its own structure and cannot
   emit an SSHSIG blob. Either use the passkey as an unlock factor for a wrapped Ed25519 key
   (cheaper, keeps `git verify-commit` working) or add a second signature format (stronger, costs
   the git-native property everything else is built on). The first is the candidate.
3. *Hardware token.* Appendix XI's third line already anticipates it. A YubiKey with an
   `sk-ssh-ed25519@openssh.com` resident key signs SSHSIG natively — the only option that
   satisfies Appendix IV *and* keeps the git-native format. Needs WebAuthn/CTAP2 plumbing and the
   `sk-` key variant; bounded work, not research.
4. *Native helper (desktop peer only).* A ~200-line signing daemon owning the keychain entry,
   exposing only `sign(payload) → SSHSIG` over a local socket. Fully satisfies Appendix IV for the
   Node path. Deferred deliberately: it reintroduces an installable binary, which Appendix X
   explicitly trades away.

**Verified 2026-08-03:** there is no `WebAuthn` or `navigator.credentials` call anywhere in
`runtime/`. Step 2 has not started.

**Judgement.** Non-extractable IndexedDB keys are an honest approximation of Appendix IV, not a
fulfilment of it. The gap belongs in the Verfahrensdokumentation (Appendix IX Track 2) rather than
glossed over: an auditor *will* ask where the signing key lives, and the defensible answer today
is "in the browser's key store, unexportable, origin-bound", with the YubiKey path named as the
hardening option where the risk is material.

**Owner:** CTO. **Revisit:** Wave 2, before any pilot with a serious threat model.

---

## #3 — The read path is our own index, not SQLite/DuckDB in WASM

**Category: real work.** What remains is a SQL surface, full-text search, and the memory ceiling —
each a piece of engineering, none of them a corner we cut.

**Rewritten 2026-08-03.** The previous version of this entry said the read path was a linear scan
and that Appendix VI's "sub-millisecond" claim "does not hold in general". **Both statements are
now false**, and they are quoted here because they were quotable:

> "Anything that touches every document of a large entity is a linear scan at ~65–110 ns/document,
> so Appendix VI's own example lands at ~1 ms at 15k invoices and **grows linearly: ~7 ms at 100k,
> ~70 ms at 1M.**"

The same query shape now measures **2.3 ms at 150 000 and 54 ms at a million** — and the shapes a
general ledger actually lives on are flat.

**Principle in tension:** Appendix VI line 193 (SQLite or DuckDB in WASM, "the most audited, most
portable, most reliable embedded databases in existence"), line 197 ("sub-millisecond SQL against
the entire company history"), and Appendix VI's closing paragraph, which makes SQL the language AI
speaks through MCP (Principle 7).

**What we shipped:** our own index — a dense row store, per-value hash buckets for equality, sorted
key arrays binary-searched for ranges, a partition per currency for money, and maintained `BigInt`
aggregates. Indexes are built lazily for the fields that get asked about. Still no SQL, no WASM, no
B-trees.

**Why:** shipping SQLite-WASM or DuckDB-WASM means shipping a multi-megabyte binary we did not
compile and cannot audit line by line, plus an Emscripten toolchain to rebuild it. That breaks the
zero-dependency and no-build-step constraints. The manifesto's own escape hatch is why this is
legitimate rather than a dodge: line 193 says either can be swapped "behind our internal query
interface … in one click".

### The measured truth, remeasured

Full tables, method and reproduction command in `runtime/read/README.md` §8. The four numbers that
decide whether FD-4's modelled ledger is affordable:

| operation | 15 000 inv (31 875 docs) | 150 000 inv (318 750) | 1 000 000 inv (2 125 000) |
|---|---|---|---|
| `sum of amount over posting where account = X` | **0.001 ms** | **0.001 ms** | **0.001 ms** |
| whole trial balance (`groupBy account + sum`, exact) | **0.258 ms** | **0.211 ms** | **0.349 ms** |
| indexed equality lookup | **0.002 ms** | **0.001 ms** | **0.002 ms** |
| Appendix VI's own example query (join + 4 predicates + sort) | **0.463 ms** | **3.02 ms** | **89.7 ms** |

A maintained aggregate answers "what is the balance of this account" in a microsecond at a million
postings, which is the number FD-4 depends on. Against v0.1 on v0.1's own 20 000-document fixture:
Appendix VI's query 3.5× faster and no longer linear, `count` with one predicate 145× faster.

**One number went backwards, and it is the honest cost of exactness:** `groupBy` + `sum` over
14 625 invoices was 0.90 ms and is 1.94 ms, because the float determinism fix does string and
`BigInt` work where v0.1 did float addition. That field — a monetary amount stored as a JS number —
is a thing FD-1 no longer permits to exist.

**Cold is published too, because "warm" alone would be a half-truth.** The first execution of a
novel query also builds the index it needs: the Appendix VI query costs 30 ms cold at 15 000
invoices, 352 ms at 150 000 and 4.6 s at a million.

### Where it still bites, quantitatively

*The memory ceiling, now measured rather than guessed.* ≈415 bytes per document all-in. In a 2 GB
heap: 1 M documents comfortable at 546 MB, 2 M workable, 3 M degraded and GC-bound, **4 M is
`JavaScript heap out of memory`**. The roadmap's 500 M€ company — a million invoices with their
lines and postings — is 3–5 million documents, so it is *at* the ceiling, and a ten-year history is
past it. Three exit paths, in `runtime/read/README.md` §8.4; note that SQLite-WASM is now the
honest answer to a **memory** argument, which is the opposite of what this entry used to claim.

*Locality, not algorithms, is the wall.* The filter's cost per candidate is flat to 500 000 rows
and then triples, because the candidate working set exceeds the last-level cache. No better index
fixes it. The named exit is columnar projection behind `FieldIndex`, plus a composite
`(reference, date)` index worth roughly 8× on the Appendix VI query.

*No full-text search* at all, not even the FTS5 Appendix VI already calls insufficient; searching
text is a scan with no ranking and no stemming.

*No SQL surface for MCP*, which weakens Principle 7 concretely: the model must target a bespoke
query object instead of the SQL it already knows, and multi-hop joins, subqueries, `HAVING`, window
functions and `DISTINCT` are unavailable — it cannot write cleverer SQL to work around the gap. The
compensation is real: a narrow, un-injectable surface where an unknown key or operator is refused
loudly rather than guessed at (Principle 6) is a safety property a raw SQL channel does not have.

*No histograms and no index intersection.* A range estimate on a skewed field can be wrong, which
costs a slower plan and never a wrong answer.

**What is *not* compromised.** Everything Appendix VI actually leans on. The index is a view and
never truth — nothing in `runtime/read/` writes. It rebuilds from git. Incremental update is real
and *proven equal to a full rebuild* by property test. It is personalized per peer: entities this
peer cannot decrypt are absent from the index rather than filtered out of a result, so Appendix
VII's "structurally-stronger-than-RBAC" claim survives intact, and `stats()` reports "N readable,
M opaque" so a user can see what they cannot see.

**Exit path.** The interface is still the deliverable. (1) `runtime/read/sqlite.js` exporting the
same functions, writing to SQLite-WASM in OPFS and compiling `Query` to SQL — the existing test
file becomes the conformance suite for both. (2) Only then widen the interface with
`sql(text, params)` for MCP, keeping `select()` as the portable subset, because "removable with one
click" has to mean removable in both directions. (3) Full-text search is a separate decision:
Tantivy-in-WASM behind its own `search()`.

**Honest residual after the swap.** `Query` is today deterministic to the last row by construction
(ties always broken by document id). SQL guarantees no row order without a total `ORDER BY`, so the
compiler must append the id tiebreaker to every generated query — and hand-written SQL arriving
from an AI through MCP can still produce non-deterministic ordering, which an ERP report must never
have. That rule gets written down *before* the swap, not after.

**Owner:** CTO. **Revisit:** the SQL surface in Wave 3 with the MCP work; the memory ceiling is a
Wave 4 gate number (Part 2 condition 7) and is already published.

---

## #4 — Peer sync works over a relay; the direct LAN path is written but unexecuted

**Category: real work.** What remains needs a browser and two networks, not more code.

**Rewritten 2026-08-04 by agent SYNC. The old entry said "loopback only; there is no WebRTC yet"
and quoted its own verification: *"no `RTCPeerConnection`, `RTCDataChannel` or `WebSocket` anywhere
in `runtime/`"*. That is now false, and the old text is quoted here rather than deleted, because a
false register entry gets quoted by a reviewer exactly as readily as a true one.**

**Principle in tension:** 2 ("Serverless. Cloudless."), Appendix III (WebRTC / LAN gossip),
Appendix X (Sarah, Herr Klein and Anna in a three-peer mesh).

**What we shipped, and what proves it.** Two Node processes discover each other through a real
`node relay.mjs`, seal a session under a key derived from a QR-code payload, converge a live
document (`converged()` — byte-identical op sets across a process boundary) and exchange a
packfile: a peer with an empty repository receives twelve commits in ONE pack and `git fsck
--strict` calls the result clean. Then Sarah's folder is deleted, a third process with a **new key
pair** is introduced by Herr Klein, and the whole company comes back byte-for-byte.
`test/sync-relay.test.js`, 8 tests; `test/sync-gitsync.test.js`, 10; `test/sync-sealed.test.js`,
14; `test/sync-introduce.test.js`, 12; `test/sync-opbuffer.test.js`, 10.

**What the relay can learn, stated so nobody has to discover it.** The mailbox id (32 bytes of HKDF
output over a secret it never sees, so it links to no key, no repo and no company), the two source
IP addresses, connection times, and byte counts. That is "these two endpoints exchanged N bytes"
and no more. It is asserted, not promised: a hostile relay in `test/sync-sealed.test.js` records
every byte both peers exchange and no document id, amount, field name, public key or repo id can be
recovered from the recording; `relay.mjs` has no `node:fs` import, no client-callable verb (a text
frame from a client closes the connection with 1003) and no `JSON.parse` of anything it forwards;
and the real process's stdout is checked line by line against the content that crossed it.

**What remains open, precisely:**

1. **`runtime/sync/webrtc.js` has never run in a browser.** The adapter and the whole
   offer/answer/ICE sequence are exercised against an injected fake `RTCPeerConnection`; real ICE,
   DTLS, SCTP and NAT traversal are **unexecuted**. So Appendix III's "directly over LAN when in the
   same network" is not demonstrated — only the relay path is. The module keeps its entry in
   `test/wired.test.js`'s UNFINISHED list for exactly that reason.
2. **Two processes on one machine is not two machines.** What the test removes is every shared
   object, module instance and byte of memory. What it does not exercise is a physical network:
   packet loss, MTU, a corporate firewall, or an IP address that changes mid-session.
3. **No UI renders or scans the QR code.** `createIntroduction()` produces a 254-character
   `neodonkey:i/…` string and `readIntroduction()` consumes one, with a complete tamper matrix
   between them. Nothing draws it as a QR code and nothing reads a camera. Appendix X day 3 is
   therefore operable from a script and not from the app.
4. **The IP correlation is unavoidable for any relay.** Mitigation is network-level (VPN, Tor) and
   outside this codebase. Named here rather than hidden.

**How well proven, unchanged and still load-bearing:** 430 seeded property-test cases —
commutativity, associativity and idempotence per CRDT type across 3–5 simulated peers with partial
delivery, duplication, random batching, and mid-edit network partitions. The suite was then
**mutation-tested**: five deliberate defects injected, all five caught. One result from that exercise
is worth keeping visible — *remove-by-element instead of observed-remove in the OR-Set is still
commutative, associative and idempotent, and no property test catches it.* Convergence proofs cannot
detect wrong business semantics.

**Owner:** CTO. **Revisit:** Wave 3 — items 1 and 3 together, since both need the browser.

### #4a — The Live Layer has no IndexedDB buffer — CLOSED, with a named deviation

**Closed 2026-08-04 by agent SYNC.** `runtime/sync/opbuffer.js` persists `session.ops()` and
replays it through `session.receive()`, the same idempotent path a peer's frames take. Proven the
only way that means anything: a **child process** types into a delivery note, persists, and calls
`process.exit(0)`; a fresh session in the parent restores the buffer and holds a **byte-identical**
op set and snapshot. `test/sync-opbuffer.test.js`, 10 tests.

**Two things the old entry asked for that needed more than `ops()`:**

* **The quarantine.** The entry's first sentence was about ops a `reject` policy quarantined. Those
  are recorded in `violations()` and deliberately create no register, so they are **not** in
  `session.ops()` — persisting `ops()` alone would have lost precisely the thing named first. The
  record therefore carries a second list, and replay feeds it back through `receive()`, which
  re-reaches the same verdict from the same base document. Two violation kinds cannot be replayed
  because they keep no op (`immutable-field`, `crdt-type-mismatch`); `restore()` counts them rather
  than pretending.
* **Refusing a stale buffer.** An op set is only meaningful against the document it was produced
  against, so the record carries a digest of the committed base. If the document has been committed
  or pulled since, `restore()` returns `stale` and **keeps the record** — deleting a human's unsaved
  work because we could not use it would be the data loss the file exists to prevent.

**DEVIATION FROM APPENDIX III'S WORDING, deliberate:** it is not IndexedDB. The buffer lives at
`.git/neodonkey-live/` behind the same `FsAdapter` that holds the company (`fs-opfs.js` in a
browser, `fs-node.js` for a CLI or an always-on peer). One storage story instead of two, it works
everywhere the repo works, and — the reason that decided it — it is testable in Node, so this is
verified rather than asserted. IndexedDB and OPFS share a browser storage bucket and are evicted
together, so nothing is given up in durability; `kvStore` is an injected interface, so an IndexedDB
implementation can be added without touching anything above it. Inside `.git/` on purpose: anywhere
else and `git status` would report the buffer as untracked, which would break Appendix X's "it is
simply a folder". Asserted with the real `git` binary, before and after a commit.

**Residual:** no UI calls `track()` or `restore()` yet, so a user is not yet *told* "you have
unsaved work on three documents" — `pending()` answers that question and nothing asks it. Folded
into #4 item 3 (the same missing UI work), not counted as a separate entry.

### #4c — Policy divergence between peers on different operating models

**Category: real work.** It needs a field on the op envelope, and it lands with sync.

A peer running an older operating model can push an op onto a released invoice. We record it in
`violations()` and keep it out of the truth, deterministically — the decision is a pure function of
the base document plus the policy, both identical on peers running the same model. Two peers on
*different* models would show different violations while still holding identical op sets. Exit
path: pin the operating-model commit oid into the session and refuse ops carrying a different one.
**Verified 2026-08-03:** no model oid, policy oid or equivalent exists on the envelope.
**Owner:** CTO. **Revisit:** Wave 2, with #4.

---

## #4e — The rule engine is 4,894 lines, not "perhaps 500"

**Category: manifesto or roadmap is wrong.** The beermat estimate was for a grammar that cannot
express a company; the grammar that can is an order of magnitude larger.

**Number corrected upward 2026-08-03.** This entry used to say "1,638 lines … the parser is 1,171".
Measured with `wc -l runtime/polism/*.js`, and still rising as grammar version 2 lands (`parse.js`
grew ten lines during the hour this was written):

| file | lines |
|---|---|
| `parse.js` | 3,414 |
| `execute.js` | 1,265 |
| `money.js` | 215 |
| **total** | **4,894** |

Appendix XII line 492 estimates the runtime at ~500 lines. So the overrun is **9.8×**, not 3.3×,
and the entry as it stood understated its own subject by a factor of three — which is exactly why a
register has to be re-measured rather than re-read. Re-measure it rather than quoting this table;
the command is above.

Where the lines went, honestly: Principle 6 diagnostics are still the largest single share — every
refusal carries file, line, offending text and expectation, phrased for a COO rather than a
compiler engineer — and grammar version 2 (FD-5) added invariants, aggregation, branches,
enumerations, three authority scopes, periods, exact money and labelled creates, plus the static
checks that make each of them refuse rather than guess (unsatisfiable conditions, unreachable
branches, predicate cycles, authority coverage).

Recorded rather than hidden because the beermat is a real constraint, not a mood. But Principle 6
outranks a line-count estimate, and a parser that refuses precisely is the entire mechanism by
which "silent wrong calculation is structurally prevented". Exit path if the number matters:
externalize the message catalogue into a data table, which would take a large bite out of
`parse.js`. **The honest alternative is to correct Appendix XII's estimate**, since a grammar that
can express double-entry bookkeeping was never going to fit on the beermat.

---

## #4f — The missing part of the rule grammar, by name

**Category: real work.** Each item is a named, additive grammar addition.

**Rewritten 2026-08-03 against `runtime/polism/grammar.md` §20**, which is now the normative list.
Each gap is **refused by name** rather than silently misread (Principle 6), so it is nameable
(Principle 10).

**Closed by grammar version 2** — six of the thirteen items this entry used to list:

| was missing | now |
|---|---|
| aggregation (`sum of`, `count of`) | §13, with a maintained-aggregate contract to the read path |
| enumerations | §15, `one of draft, posted, cancelled` — a typo is a refusal |
| cross-entity invariants | §12, and this is how debits = credits became structural |
| cross-name counters | §17, `with +<field> from <other-field>` |
| threshold authority on one operation | §14 branches + §16 three authority scopes (see #4g) |
| `money` as a bare number | §19, FD-1: one exact string token with its currency, `BigInt` inside |

**Still open, unchanged:** no `or` between conditions; single-hop reference paths only; four-eyes is
not expressible *in the grammar* (#16 — it is expressible in the truth layer, #4d); no
disambiguation when an entity holds two references to the same target; no cascading consequents; no
date arithmetic and no `today`; `Read` rules authorize but do not filter visibility (#20); `Delete`
performs no dangling-reference check; no scheduled rules; units on a quantity are unresolved.

**New in version 2, and listed there rather than repeated here:** correlated aggregation (§20.1),
aggregation in a consequent (§20.2), invariants are not swept so an invariant added after data
exists never refuses that data (§20.3), only `sum` and `count` (§20.4), a branch arm cannot fall
through (§20.5), enum values are not shared between entities (§20.6), one `where` per aggregate
(§20.8).

**§20.3 deserves lifting out of the table**, because it is the one an auditor would ask about: a
document nobody touches is never re-validated, so an invariant introduced after the fact does not
refuse the data that already violates it. The exit is an offline sweep in the read path, reported
and never silently repaired.

**And one measured content fact, which is what "enumerations are closed" must not be allowed to
hide.** The grammar gained `one of`, and all thirteen `status` fields in `operating-model/information/`
(`article`, `discount`, `location`, `credit-note`, `order`, `customer`, `supplier`, `order-line`,
`stock-adjustment`, `invoice`, `sales-order-line`, `review-minute`, `vat-treatment`) have successfully
been converted to use `status: one of ...` in the operating model. An attempt to post a typo'd status
such as `Update order-line with status "delivrd"` is now strictly refused by name. The content-fact
revisit is complete, while the grammar limits themselves remain open.

**Two deliberate non-decisions worth keeping visible:** consequents do not cascade (justified on
predictability and the one-event-one-commit boundary, and *not silent* — a static check warns,
naming both files and lines, wherever a reader might expect one), and `+field` on a missing document
is answered by the model via `## Created on demand: yes|no` rather than by the runtime guessing.

**Owner:** CTO with the grammar owner. **Revisit:** Wave 3 — the grammar limits.

---

## #4i — The manifesto's own goods-receipt rule is wrong, and we kept it

**Category: manifesto or roadmap is wrong.** The text is normative; the flaw is in the text.

Appendix XII's rule marks the order line `delivered` on *any* accepted receipt, including a partial
one. Agent F kept the manifesto's text verbatim rather than quietly improving it, and documented the
gap in the file itself. That was the right call twice over: the manifesto text is normative, and
fixing it is precisely the one-line edit the manifesto invites a supply chain manager to make — so
the flaw is also the demo.

**Verified 2026-08-03**, and the situation is now slightly stranger than when this was written.
`processes/goods-receipt.md` rule 1 still sets `Update order-line with status "delivered"`
unconditionally, while rule 3 sets `Update order with status "partially-delivered"` on the same
trigger. So on every partial receipt the *order* is correctly partial and the *line* is wrongly
complete, in one commit, from two rules.

**The reason this entry used to give is now stale.** It said "Grammar v1 cannot express the correct
version (it needs a branch …)". Grammar version 2 has branches (§14) and this rule could be written
correctly today. So keeping the manifesto's wording is now a **deliberate fidelity decision**, not
a limitation — which is a better position to be in and a worse one to leave undocumented. Closing
an order when its last line arrives has the same shape and the same status.

**Exit path:** amend Appendix XII (the manifesto is the constitution and the CTO does not edit it,
so this is a proposal in the shape of `docs/MANIFESTO-AMENDMENT-1.md`), and branch the rule in the
same commit. Until then the file must keep saying, in the file, that it is reproducing a known
flaw on purpose.

---

## #5 — Encryption is reachable through the kernel; the artifacts above it do not offer it yet

**Category: real work.** Appendix VII is built, and as of Wave 2 it is reachable from
`kernel.open()` and `kernel.perform()`. What is not built is the last hop: the UI, the MCP server
and the demo do not pass the option, and a browser peer has nowhere to keep an encryption key.

**Principle in tension:** Appendix VII in full (group keys, DEKs, personalized indexes, GDPR
cryptographic shredding).

**The old claim, quoted so a reviewer cannot mistake this entry's history for its present:** *"What
we shipped: nothing. All documents are plaintext in the repo. Verified 2026-08-03: no DEK,
group-key or decryption implementation exists anywhere in `runtime/`."* That was true on
2026-08-03 and is false now.

**What we shipped (Wave 2, verified 2026-08-04 by `node --test test/crypto-*.test.js`):** all three
key levels of Appendix VII in `runtime/crypto/` — personal X25519 pairs bound to their owner's
Ed25519 key by an SSHSIG that real `ssh-keygen -Y verify` accepts; epoched AES-256 group secrets
with create / add / remove / rotate and offboarding as one commit; per-document DEKs wrapped
AES-KW under HKDF-derived KEKs; a self-describing versioned envelope whose public header is the
AES-GCM AAD; keyed sealed filenames; a decrypting `readBlob` for the read path; and GDPR erasure
by destroying a subject key.

Both halves of gate condition 5 are demonstrated, by real `git`:

* a non-member's index does **not contain** the sensitive entity — `entities()` does not list it,
  `stats().entities` (the object `mcp/server.mjs` publishes) has no such key, and no string of the
  plaintext appears anywhere in her index. Absent, not filtered;
* after a subject key is destroyed, the plaintext is unrecoverable from the repository *and*
  `git fsck --strict` is clean, `git fsck --unreachable` is empty, every commit still reports `G`
  under a real `allowedSignersFile`, and the shredded blobs are byte-identical with the hashes the
  chain recorded. The whole object database is searched for the key material and for the plaintext;
  neither is there, and the search is positive-controlled against a repo that deliberately does
  commit the key.

**The architectural finding this produced, because it changes a rule:** an append-only store cannot
hold key material you may one day have to destroy. Committing a wrapped subject key makes the
erasure theatre (`git cat-file` recovers it forever, demonstrated in
`test/crypto-shred.test.js`), and removing it by rewriting history invalidates every signature from
the rewrite point onward — the exact GoBD property the design exists to preserve. So: **everything
in NeoDonkey may be append-only except the key material of shreddable keys, which lives in exactly
one mutable store — the vault — and never in a commit.** The vault is `runtime/crypto/shred.js`,
built on the existing `FsAdapter`, and it is the same shape every serious crypto-shredding design
has. Losing it destroys confidential content and leaves the audit chain intact and verifiable,
which is the same failure mode as erasure, deliberately.

**The gap this entry named is closed (Wave 2, agent KERNELCRYPTO).** The quoted sentence above — *"`kernel.open()`
hard-codes `readBlob: (oid) => repo.readBlob(oid)` and `perform()` has no way to say 'seal this
document for group X'"* — is no longer true. `runtime/kernel.js` gained, additively:

* `open({ encryption, vault, sealed })`. `encryption` wraps the index's `readBlob` with
  `decryptingReader`, which is the entire read mechanism: the read path only ever creates an entity
  bucket for a document it could *read*, so a non-member's index does not contain the entity at all.
  `encryptionStatus()` exposes the counters, because Appendix VII's honesty depends on a user seeing
  "412 readable, 37 opaque" and the reason for each refusal rather than silently seeing less.
* `perform({ sealFor })` — `['hr']`, `{groups:[…]}`, or `{groups:[…], subject:'customer/C-1042'}`
  for a shreddable subject key. It writes **only** `sealedPath()`; the plaintext path is never
  written, staged, or checked out. The sealing is recorded twice, independently: a
  `NeoDonkey-Sealed:` trailer inside the signed payload, and the blob's own public header
  (`inspectSealed()`), so "which groups could open this" is answerable by someone who does not
  trust our code.
* `neodonkey.json`'s `sealed` table, signed into genesis, so confidentiality is **not forgettable**.
  A caller may add groups and may never drop one, and a workspace that declares an entity
  confidential refuses to write one at all without a key pair. Same reasoning as `fourEyes`: a
  control you defeat by leaving out an argument is not a control, and that mistake — a capability
  with no way to reach it, then a way to reach it that can be bypassed — is the one this project has
  already made three times.
* group administration as signed commits: `enrol`, `createGroup`, `addGroupMember`,
  `removeGroupMember`, `rotateGroup`, `offboard`, `eraseSubject`, plus `encryptionGroups`,
  `subjects`, `sealingPolicy`, `sealedPathFor`, `findSealed`. Every one of them composes
  `runtime/crypto/`; the kernel contains no cryptography.

Verified end to end by `node --test test/kernel-crypto.test.js` (7 tests, 7 pass, 2026-08-04),
through `kernel.open()` / `kernel.perform()` and the administration methods **only** — the file
deliberately never seals a document or builds a group by importing `runtime/crypto/` itself, because
that is exactly what was already proven and exactly what was not enough. Real git is the judge:
`git ls-files` shows the plaintext path absent, `git fsck --strict` and `--unreachable` are clean
after create/add/rotate/remove/offboard/erase, every commit reports `G` under a real
`allowedSignersFile` (positive-controlled against a key that did not sign), `git log -- crypto/groups/`
finds all five administrative acts, and `git cat-file --batch-all-objects` finds neither the salary
nor the customer's PII anywhere in the object database (positive-controlled against a plaintext that
*is* there).

**Why this entry stays open anyway, precisely.** A capability is not shipped until a person can reach
it, and the three disposable artifacts above the kernel still open their workspaces without the
option:

1. **A peer's encryption key pair has nowhere to live.** `runtime/identity/keystore.js` persists the
   Ed25519 signing pair and has no slot for an X25519 pair. Until it does, a browser peer would mint
   a fresh encryption key on every reload and permanently lose access to everything sealed for it —
   so wiring the UI *before* the keystore would be worse than not wiring it. This is the blocking
   item and it is small.
2. **`runtime/ui/**`, `mcp/server.mjs` and `demo/sarah.mjs` pass no `encryption`.** They therefore
   behave exactly as they did before (a sealed document is opaque and counted), which is correct but
   is not the capability. Group administration also has no generated screen: it is not an entity, so
   the UI's entity-driven generation does not produce one.
3. **An erasure is per peer and the mesh does not carry it.** The vault is per peer by construction,
   so `eraseSubject()` destroys the key *here*; propagating the order is #4's transport and is named
   as limit 1 in `runtime/crypto/shred.js`.

**Two honest limits inside what did land**, named rather than left for a reviewer to find:

* **Confidentiality is declared in `neodonkey.json`, not in the company's own words.** Principle 11
  wants `## Sealed for hr` in `operating-model/information/salary.md`. The settings table is the same
  bridge `fourEyes` uses for the same reason, with the same exit path: the day the grammar can say
  it, the entity's own file outranks the table.
* **A sealed document that takes an FD-6 number publishes that number.** The sealed filename is a
  keyed hash, but `NeoDonkey-Sequence:` names the issued number in the clear because GoBD
  Vollständigkeit must be checkable by a non-member. Where the number is also the document's name,
  the name is therefore public — the *content* is not, and a non-member still cannot map the number
  to a blob without the name key. `perform()` refuses a commit message that would name a sealed
  document for any other reason, and excludes exactly this one case rather than pretending.

**What we lose until the rest lands:** a workspace driven through the shipped UI or the MCP server
still writes every document in plaintext. So the warning narrows again, to what is actually true:
**do not put HR data, board papers or customer PII into a workspace you drive through the browser UI
or `mcp/server.mjs` yet.** A program that calls `kernel.open({ encryption, vault, sealed })` can now
do it correctly, and a workspace whose genesis records `sealed` will refuse to write those documents
at all rather than write them in the clear.

**Owner:** CTO. **Revisit:** Wave 3, starting with the keystore — before any pilot that touches
personal data.

---

## #6 — Cross-peer atomicity: the mechanism exists and has never run over a network

**Category: real work** (the remainder depends on #4). **Rewritten 2026-08-04, agent ATOM.**

**What this entry said until Wave 2, quoted because a false entry is quoted by a reviewer exactly
as readily as a true one:** *"Single-peer atomicity only. […] What we shipped: the simple case,
fully. […] The complex case is meaningless without real network sync (#4) and is designed to land
with it."*

**Principle in tension:** Appendix VIII's complex case (reservation events with TTL, authoritative
peers, Raft-like re-election).

**What we shipped, Wave 2.** All three parts of Appendix VIII's complex case, over the loopback
`PeerLink`:

- `runtime/truth/reservation.js` — claim and storno records, no stored status (it is derived, so two
  peers cannot disagree after a merge), the collision rule as ONE function used both by the live
  decision and by the audit of a merged history, and exact decimal quantities (FD-1).
- `runtime/truth/authority.js` — one authoritative peer per resource, declared in
  `operating-model/authorities.json`; a Raft-like election over a FIXED elector set with a majority
  quorum; quorum evidence signed with the peer's Ed25519 key in its own SSHSIG namespace.
- `runtime/truth/sequence.js` — the cross-peer half of FD-6 (see #19).

**Verified 2026-08-04** by `test/atom-reservation.test.js` (13 tests) and
`test/atom-authority.test.js` (22 tests). Appendix VIII's own scenario runs in both logical orders:
Berlin selling 5 of the last 5 while Munich sells 3. Exactly one succeeds; the loser is told which
claim beat it; when the loser is Berlin's own claim it is voided by a storno that is a real signed
commit (`git log` shows it, `git fsck --strict` is clean, real `ssh-keygen` verifies it). Stock never
goes negative under eleven interleaved claims. A lease expires on the authority's own clock, the
units become claimable again, and the abandoned reservation can never be redeemed.

**What is NOT closed, precisely:**

1. **It has never run over a network.** The transport is `loopbackPipe` from
   `runtime/live/session.js`. It is the same three-method seam agent SYNC's WebRTC adapter
   implements, and nothing in these modules knows which one it has — but "runs over WebRTC" is
   unproven and belongs to #4.
2. **`runtime/kernel.js` does not use it.** The kernel calls `assertAuthoritative(decl, nodeId)`
   with two arguments, which is byte-for-byte the v1.0 single-peer behaviour, and building an
   authority member needs live peers to attach links to. Until that line changes, a shipped
   workspace gets none of the above.
3. **A lease is a duration each peer measures for itself**, so peers agree about expiry to within
   clock *drift*, not offset. An elector whose clock has stopped keeps believing it holds a claim and
   the reclaim is refused rather than granted — the safe direction, tested, and self-healing once a
   majority has experienced the same duration.
4. **Two committed declarations of one resource cannot be reconciled.** See #19 and the test named
   `TWO DECLARATIONS, TWO MAJORITIES`.

**Owner:** CTO. **Revisit:** with #4, over two real machines.

---

## #7 — No dialects, no DATEV bridge

**Category: real work.** Wave 3, and the cheapest credibility available.

**Principle in tension:** 5 (polyglot outward), Appendix V, Appendix IX Track 1 ("Track 1 is week
one").

**What we shipped:** nothing outward-facing. **Verified 2026-08-03:** no DATEV, XRechnung or
dialect code in `runtime/` or `mcp/`.

**Why:** honest sequencing. The manifesto's own MVP order (closing note) puts formats, ontology,
browser runtime and the two layers first. Track 1 being "week one" refers to the go-to-market
clock, not to the first build.

**What we lose:** no regulatory story a Wirtschaftsprüfer can touch yet, and gate condition 6 is
entirely unstarted. The signed-commit substrate that Track 2's Verfahrensdokumentation would argue
from is, however, real and independently verifiable — which is the prerequisite that used to be
missing. A general ledger to export from now exists too, which is the other one.

**Owner:** CTO. **Revisit:** Wave 3 — a DATEV export dialect is the cheapest credibility we can
buy, and the read path already holds everything it needs.

---
---

# Delivery, the browser, and the generated UI (agent G)

Measured in real browsers, not assumed. Agent G's note on ranking is worth keeping: **#8 belongs
above the four-eyes work, not below it** — four-eyes protects against a dishonest *user*; a signed,
pinned runtime protects against a dishonest *us*. The second is the one a customer cannot mitigate
on their own.

## #8 — The runtime is delivered from an origin, not from a folder you were handed

**Category: platform limit.** Measured, in two engines: the folder model forecloses the module
graph, OPFS in Chrome, and WebAuthn everywhere. `docs/MANIFESTO-AMENDMENT-1.md` proposes the
corresponding change to Appendix X, and is still a draft.

**Principle in tension:** Appendix X, day 1 — she "downloads a folder … double-clicks the HTML,
her browser opens NeoDonkey". Appendix II — "the repo is cloned, an `index.html` in the repo is
opened". And most seriously **Principle 9**: an origin is a code-distribution control point, which
is the structure Principle 9 exists to abolish.

### The measurement, first

The double-click promise was tested rather than reasoned about. Chrome 148.0.7778.168 and Safari
26.5.2 on macOS 26.5.2, the same probe page on both schemes, driven headless over the DevTools
Protocol and — for Safari, which has no headless mode — in the real browser with results reported
out by image beacon, which is the one channel exempt from CORS on every origin.

| | Chrome `file://` | Chrome `http://127.0.0.1` | Safari `file://` | Safari `http://127.0.0.1` |
|---|---|---|---|---|
| `isSecureContext` | **true** | true | **true** | true |
| external `<script type="module" src>` | **BLOCKED** | runs | **BLOCKED** | runs |
| inline module, no `import` | runs | runs | runs | runs |
| inline module *with* an `import` | **BLOCKED** | runs | **BLOCKED** | runs |
| `fetch()` of a sibling file | **BLOCKED** | 200 | **BLOCKED** | 200 |
| Ed25519 generate + sign, `extractable:false` | OK | OK | OK | OK |
| IndexedDB storing a non-extractable `CryptoKey` | OK | OK | OK | OK |
| OPFS write/read round-trip | **SecurityError** | OK | **OK** | OK |
| `showDirectoryPicker` | present (gesture-gated) | present | **undefined** | **undefined** |
| `CompressionStream` | OK | OK | OK | OK |

Chrome's own words, from the console on `file://`:

> Access to script at 'file:///…/boot.js' from origin 'null' has been blocked by CORS policy:
> Cross origin requests are only supported for protocol schemes: chrome, chrome-extension,
> chrome-untrusted, data, http, https, isolated-app.

Four things in that table are worth stating precisely, because three of them contradict what one
would assume:

1. **Secure context was never the problem.** `file://` *is* a secure context in both engines. The
   blocker is CORS on the module graph, and separately Chrome's own rule about the file scheme.
2. **`typeof` lies.** On Chrome `file://`, `navigator.storage.getDirectory` is a `function` and
   calling it throws `SecurityError`. Any capability check that trusts `typeof` reports a working
   private file system on a page that has none. `runtime/ui/storage.js` therefore performs a real
   write/read/delete round-trip before claiming OPFS works.
3. **The engines disagree about OPFS on `file://`** — Safari allows it, Chrome refuses it. So even
   a single-file build could not rely on it.
4. **`showDirectoryPicker` does not exist in Safari at all**, on any scheme. See #10; this is the
   larger and more permanent finding, and it has nothing to do with `file://`.

**A single self-contained HTML file would work.** Inline classic scripts and an inline module with
zero `import` statements both execute from `file://` in both engines, and Ed25519 + IndexedDB both
work there. So a bundled NeoDonkey could be double-clicked. It would cost a bundler — a build
step, which non-negotiable #2 forbids — and it would give up OPFS in Chrome, the directory picker
in practice, service workers, persistent storage and WebAuthn. That trade is not the UI's to make
unilaterally; it is recorded here as an option and, on this evidence, a bad one.

### What we shipped

A **Progressive Web App**: `index.html`, `manifest.webmanifest`, `service-worker.js`, and the same
ES modules the repository already contains. `serve.mjs` (~110 lines of `node:http`) is the smallest
possible origin, for self-hosting and for development.

### What that buys, and why it is more than convenience

An origin is a secure context, and a secure context is the precondition for everything the
manifesto's harder promises rest on:

- **OPFS and the directory picker**, so the company can be a real folder (Appendix X).
- **A service worker**, so the app runs fully offline and air-gapped — which is Appendix II line 92
  ("an auditor takes the whole system offline") delivered rather than asserted.
- **`navigator.storage.persist()`**, without which a browser may evict an ERP's data.
- **WebAuthn / passkeys.** This is the important one. #2 records that private keys sit in IndexedDB
  instead of the OS keychain, and names a platform passkey as the exit path. WebAuthn is
  unavailable from `file://`. **Shipping from an origin is the precondition for fixing our worst
  cryptographic compromise.** A folder you double-click cannot get there from here.

### What it costs

Whoever controls the origin controls which code runs. That is a distribution chokepoint, and
Principle 9 exists precisely to abolish chokepoints. Four properties are what reduce it from a
dependency to a convenience, and each is enforced rather than intended:

1. **Origin-independence, absolutely.** Not one absolute path anywhere: `start_url`, `scope` and
   `id` in the manifest are `./`; every icon, stylesheet, module and the service-worker
   registration are relative. The same bytes run from `https://neodonkey.eu/`, from
   `https://erp.somecompany.de/neodonkey/` and from `http://localhost:8080/`. A company self-hosts
   by copying the folder — no build, no configuration edit. `test/g-ui.test.js` fails on a leading
   slash and on any `https?://` reference in `index.html`, so this cannot rot.
2. **Self-hosting in one command.** `node serve.mjs`. If `neodonkey.eu` disappears, is bought, or
   is served a court order, every existing installation keeps working offline and any copy of the
   folder becomes the new origin.
3. **Consented updates.** The service worker never calls `skipWaiting()` on its own. A new version
   precaches and then *waits*; a banner names the version and the user chooses. This is not
   politeness — Appendix I promises the accountant can run v2 while the warehouse still runs v1 and
   both exchange the same facts, and a silent auto-update contradicts that promise directly. A test
   asserts `skipWaiting()` appears only inside the message handler.
4. **A checkable runtime.** "This runtime" shows the SHA-256 of every runtime file as the browser
   received them, plus a combined hash defined so that `xargs shasum -a 256 | shasum -a 256`
   reproduces it byte for byte. Hashing the *served* bytes is deliberate: it is the check that
   catches an origin, proxy or CDN altering code in flight.

### The residual risk

**Superseded by #15.** The signature-verification fix this section used to name as future work has
shipped; #15 is where its residual risks live, and the first of them is still the first install.
The UI block (`releaseBlock` in `runtime/ui/views.js`) renders the signature verification status
('unsigned', 'first-use', or 'verified'), and the stale "verification is v0.2" text was removed
when #15 residual risk 4 was closed. See #15 residual risk 4, and gate condition 10.

**Owner:** CTO. **Revisit:** with #15.

---

## #9 — A generated form does not enforce `required`; the operating model does

**Category: platform limit.** The browser's own validation UI cannot quote the company's sentence,
and that sentence is the product. Recorded so nobody "fixes" it.

Generated forms mark required fields and show the file and line that declares them, but do **not**
set the HTML `required` attribute, and the form element carries `novalidate` (verified 2026-08-03,
`runtime/ui/forms.js:74`). A form submitted with a required field empty goes to
`kernel.perform()`, is refused, and the refusal screen shows the company's own sentence with its
file, its line, and a button that opens it for editing.

The alternative is a browser tooltip reading *"Please fill out this field."* That would replace the
single best explanation in the product with the single worst one. The whole argument for this
system over an ERP that says "Error: validation failed" is that a refusal names the rule that
caused it — so the refusal path must be the *normal* path, not an exception.

What is genuinely lost: one round trip, and a commit is not written (nothing is: a refusal writes
nothing). What is not lost: the field is still visibly marked required before typing starts.

**Exit path** if it ever grates in practice: an inline hint that quotes the *same* declaration the
kernel would quote, rendered by the same `refusalView()` formatter, so there is still exactly one
explanation of a refusal in the product. Never a browser default message.

---

## #10 — "It is simply a folder" is Chromium-only

**Category: platform limit.** No amount of our code changes it.

**Principle in tension:** Appendix X's closing line — "She can look into her `sarah-erp/` folder at
any time, `git log` to see her company's commit history … **It is simply a folder. With her company
inside.**"

`showDirectoryPicker()` is **undefined in Safari 26**, measured on both `file://` and
`http://127.0.0.1`. Firefox does not implement it either (not measured here — Firefox is not
installed on this machine, and that is an unverified claim rather than a finding). It is a Chromium
API.

So on Safari and Firefox the company lives in OPFS: real, persistent, git-valid — and invisible.
There is no folder to `cd` into, no `git log`, no USB stick, no `git checkout` to see March's
numbers. The single most concrete and most emotionally load-bearing promise in the manifesto is
unavailable to roughly a third of European desktop users.

What holds on every browser: the repository is byte-identical either way (the same `fs-opfs.js`
drives both, since OPFS and the File System Access API are the same
`FileSystemDirectoryHandle` interface), full SSHSIG verification runs in the page, and the
transaction log shows the exact `git log --show-signature` commands.

**What we shipped:** the picker is offered and preferred wherever it exists, OPFS is the fallback,
and the onboarding screen says plainly which one this browser can do and what the difference means
— rather than quietly giving Safari users the lesser thing and the same marketing copy.

**Exit path:** (1) an "export this workspace" action writing the repo out through
`showSaveFilePicker` or a download — a snapshot, not a live folder, but enough for a USB stick and
an auditor; (2) the File System Access API is on Safari's public standards-position list as
supportive-with-concerns, so this may resolve itself; (3) for a pilot where it matters, say Chrome
or Edge. Option (1) is cheap and should be in Wave 4 at the latest.

---

## #11 — Storage persistence is requested, and may be refused

**Category: platform limit.** The browser decides, and Safari decides against us on a timer.

`navigator.storage.persist()` is requested during onboarding, while a user gesture is in hand
(browsers weigh one). If it is denied, "This runtime" says **DENIED** in plain words, because a
browser evicting an ERP's data is data loss and must not be a surprise. Safari is the practical
concern: it evicts storage from apps it considers unused, on a timer measured in weeks.

Two things help and are stated in the UI: installing NeoDonkey as an app makes browsers far more
willing to grant persistence, and a real folder is not subject to eviction at all. The honest
answer beyond that is the manifesto's own — the other peers are the backup (Appendix X).

**Narrowed 2026-08-04 by agent SYNC.** That answer no longer "lands awkwardly while peer sync is
loopback only": a peer whose repository is deleted outright now recovers the whole company from
another peer, with a new key pair, over the relay — `test/sync-relay.test.js`, verified with `git
fsck --strict` and a byte-for-byte comparison of every document. So "the other peers *are* the
backup" is demonstrated rather than promised.

What is unchanged is the case with no other peer: **a single-peer install in OPFS on Safari with
persistence denied still has no backup of any kind.** That combination should be refused in a pilot,
not documented around. What is newly available is the answer — introduce a second peer, including
Appendix X's always-on one — and what is still missing is the *button*: no UI renders or scans an
introduction (#4 item 3), so today the second peer has to be introduced from a script.

---

## #12 — Icons are SVG, so iOS home-screen icons will not render

**Category: platform limit.** iOS Safari does not accept SVG manifest icons, and rasterising needs
a toolchain non-negotiable #2 forbids.

The manifest ships two SVG icons (verified 2026-08-03: still two, still SVG). Rasterising PNGs at
eight sizes needs an image toolchain, i.e. a build step; committing binaries we did not generate
reproducibly is worse. Chrome, Edge and Firefox accept SVG manifest icons. **iOS Safari does
not**, and an iPad added to the home screen gets a screenshot thumbnail instead of the mark — which
matters, because Appendix II names "iPad in the warehouse" as a target device.

**Exit path:** commit a handful of PNGs generated once, out of band, with the SVG kept as the
source of truth and a documented command to regenerate them. That is a build artifact in the repo
rather than a build step in the pipeline, which is the lesser of the two evils and probably right.

---


## #14 — HTTP has no directory listing, so `serve.mjs` provides one

**Category: platform limit.** HTTP cannot answer "which files exist"; the fallback is honest.

A browser seeding a fresh workspace has to know which files exist under `operating-model/`. HTTP
cannot answer that, so `serve.mjs` exposes `GET /_files?under=operating-model` returning JSON
(verified 2026-08-03, `serve.mjs:100`).

On a plain static host that endpoint is absent. The UI then reports that it could not read the
repository's operating model and falls back to the built-in starter model, saying so on screen —
rather than silently opening a workspace on a different description of the company, which would be
a silently wrong system.

**Exit path:** commit a generated `operating-model/index.json` listing the files. That is a
generated artifact, so it needs a test asserting it matches the directory — the same
anti-drift guard `runtime/ui/shell-files.js` already has against `service-worker.js`.

---
---

# The signed runtime (agent H)

## #15 — The signed runtime closes #8, except on the first day — and the loader can never verify itself

**Category: platform limit** for the entry as a whole — four of its seven residual risks are
permanent properties of the web platform. **Residual risks 4 and 7 are "our shortfall"** and are in
the blocker set; they are the two things in this entry we could fix this week.

**Principle in tension:** Principle 9 (sovereignty is structural, not contractual), Principle 3
(the code is readable and checkable), Appendix I (a version is owned, not rented), Appendix II
(update = file replacement, which must mean *a file you chose*).

**This entry supersedes the "Residual risk" section of #8.** That section ended: *"The fix is
signature verification against a pinned NeoDonkey release key … Until that ships, the honest
statement is: NeoDonkey asks you to trust the origin you install from, once."* That fix has
shipped. The word **once** has not gone away, and this entry is about the word *once*.

### What we shipped

`release/sign-release.mjs` walks the runtime, hashes every shipped file with SHA-256 and writes
`release.json`: the version, the file list, the signer's own public key line, and an SSHSIG
signature over a canonical serialisation of all of it. `runtime/release/manifest.js` verifies that
manifest in the browser, against the key pinned by `runtime/release/pin.js` at first install.
Namespace `neodonkey-release` — never `git`, so a release signature and a commit signature can
never be replayed as one another. `ssh-keygen -Y verify` accepts our release signatures, so an
auditor has a second, independent implementation to check us with.

The consequence, stated as strongly as it deserves: **after one successful install, an origin that
is compromised, bought, subpoenaed or simply wrong cannot change the code on that machine.** Not
by modifying a file (hash), not by adding one (an unlisted file is a refusal, not an
unconstrained one), not by deleting one, not by mixing two genuine releases, not by serving an
older genuine release as if it were new, and not by removing `release.json` and hoping the client
shrugs. Verification is bytes-in, boolean-out; it needs no network, no server and no `node:*`, and
a test proves it runs with every Node builtin blocked at the loader.

That is Principle 9 as structure rather than as a promise. Everything below is what it does not do.

### Residual risk 1 — the first install. This is the important one, and no cryptography fixes it.

*Platform limit, and arguably a limit of software as such.*

A pin proves *continuity*: the code is from the same signer as last time. It cannot prove
*origin*: that the signer is NeoDonkey. If the very first `release.json` a user ever sees was
minted by an attacker who controls the origin, then their key gets pinned, their runtime verifies
perfectly forever, and the app will correctly report a good signature. The offline cache pins the
compromise, exactly as #8 said. And the blast radius is total, because the runtime holds the
Ed25519 signing key and writes the audit trail: a compromised runtime produces *valid* signatures
over false facts.

The only real defence is **out-of-band publication of the release fingerprint** — printed in a
manual, in DNS, in a keyserver, in a press release, on a business card — and a user who compares
it. So every code path that touches a key hands the fingerprint back in OpenSSH's own format
(`SHA256:…`, byte-identical to `ssh-keygen -lf`, asserted by a test), and `gateRelease()` returns
the distinct mode `'first-use'` rather than quietly succeeding, so a UI cannot pin without having
been given something to show. `runtime/ui/boot.js` honours that: mode `first-use` renders "Check
the software before you trust it" and will not pin without a confirmation. That is the strongest
thing software can do here. It is a human step, and most humans will skip it.

**Exit path:** publish the fingerprint out of band before v1.0 reaches a real user (that is
residual risk 7); then binary transparency — an append-only, publicly auditable log of every
release manifest, so a per-victim build is detectable by anyone rather than by the victim.
Sigstore/Rekor is the model; the format here is already log-shaped.

### Residual risk 2 — the loader cannot verify itself, and never will

*Platform limit, permanent.*

`index.html` and `service-worker.js` are fetched by the *browser*, before a line of our code runs.
Their hashes are in the manifest — deliberately, so a running installation, an auditor, or a
second device can detect that they changed — but the fetch that delivers them is not one we can
interpose on. Worse, the browser's own service-worker update check is a byte comparison performed
by the browser: if the origin serves a different `service-worker.js`, the new one installs (as
`waiting`) whatever our code thinks, and a service worker is code.

There is no fix inside the web platform. Subresource Integrity does not cover the document or the
worker script; there is no "pinned document hash" primitive. What we can do, and what the
integration is written to do, is make the *change* loud: a worker whose bytes do not match the
installed manifest must refuse to activate and must say so. A user who ignores that is back to
trusting the origin.

**Exit path:** an extension or a native shell that pins the document hash; or Web Bundles with a
signature, if that ever ships broadly. Neither is near.

### Residual risk 3 — the check runs in the page, the enforcement runs in the worker

*Platform limit: module service workers are still not in Firefox.*

`service-worker.js` is a **classic** script, and a classic worker can neither `import` an ES module
nor use dynamic `import()` — service workers forbid it outright. So the worker cannot call
`verifyRelease()` directly. The split we ship instead: the page verifies the signature (it is an ES
module, so it can), and hands the worker a flat `{url: sha256}` table; the worker enforces it with
`crypto.subtle.digest`, refusing to cache or serve anything absent from the table or
hash-mismatched.

The weakening is real: the signature check now lives in page code rather than in the worker. It is
bounded, because after the first install that page code is itself served from a cache the worker
only ever filled with verified bytes — the induction closes. On the first install it does not, but
that is residual risk 1 again, not a new hole.

**Exit path:** register with `{type:'module'}` where supported and verify inside the worker, with
the page-side split as the Firefox fallback. Costs two code paths; worth it.

### Residual risk 4 — unsigned development builds are runnable, and the UI does not say so — CLOSED

See Part 2 — Closed.

### Residual risk 5 — one key, no revocation, no transparency

*Real work.*

There is a single release key. Rotation is a statement signed by the outgoing key naming the
incoming one, plus a mandatory fingerprint confirmation from the caller — so trust transfers
cryptographically instead of by assertion, and the user sees which key they are moving to. Three
things it does not do:

- **No revocation.** A stolen key can sign a rotation to the thief's key. The statement proves
  continuity of key *control*, not authorisation by the project. The fingerprint confirmation is
  the only brake, and it is human.
- **No freshness.** There is no clock we trust, so a statement never expires. Old statements are
  inert (`from` must equal the *current* pin), but a leaked unused one stays valid forever.
- **No threshold.** A vendor compelled to hand over one key can rotate and then publish. n-of-m
  signing plus out-of-band publication is the answer, and it is not built.

**Exit path:** threshold signing, a transparency log, and a revocation list distributed with the
same signature discipline as everything else.

### Residual risk 6 — rollback is detected, not prevented

*By design, and the design is right.*

An origin can serve an older, genuinely signed release. Nothing cryptographic forbids it: it is a
valid manifest under the pinned key. The mechanism records what is *installed* and reports an
older offer as `kind: 'downgrade'` rather than as an update, so it cannot be applied silently —
but going back to v1 is a *right* under Appendix I, so it cannot be forbidden either. The line we
hold is: never silently, always with the version and fingerprint shown.

### Residual risk 7 — the mechanism ships unarmed

**Category: our shortfall. Blocker.**

There is no `release.json` in the repository and no production release key, because a production
key does not exist yet and committing a development key would be worse than nothing: it would
train users to pin a throwaway. So what ships is the *machinery*, tested, plus a CLI that generates
a key and cuts a release in one command. **The mechanism protects nobody until a real release key
exists and its fingerprint is published somewhere that is not the origin.** Until that day, #8's
original sentence still governs in practice.

**Verified 2026-08-03:** `release/` contains `sign-release.mjs` and nothing else; there is no
`release.json` at the repository root.

**Owner:** CTO. **Revisit:** before v1.0, residual risk 7 first — the machinery is worthless until
a key is published, and publishing it is an hour of work, not an engineering project.

---
---

# The Truth Layer's integrity (agent S) — four-eyes, gapless numbering, default-deny

Three v0.1 entries were closed by this work; they are in Part 2. Below is what that work did *not*
close.

## #16 — Four-eyes requirements are declared in `neodonkey.json`, not yet in the operating model

**Category: real work** (grammar work, not a shortfall in the truth layer).

Manifesto line 114 is satisfied — four-eyes *is* a signature constraint on the commit — but the
sentence that demands it does not yet live in the company's own text. `## Authorized by a and b` is
still refused at parse time, correctly, because grammar version 2 has no form for "two different
people". **Verified 2026-08-03**, `runtime/polism/parse.js:2171`: *"'and' in '## Authorized by'
does not exist … it would mean two different people must sign, and a single operation carries a
single actor."*

So the requirement is read from three places, most authoritative first:
`rule.signatureRequirement`, `rule.authorizedByAll`, then the `fourEyes` table in the workspace's
own `neodonkey.json`. **Only the third exists** — `parse.js` emits neither of the first two.

That table is data in the repository, signed into the genesis commit, and not a parameter a caller
can relax — so it is a control, not a configuration flag. It is still not Principle 11: a COO
cannot read `neodonkey.json` and see that a payment run needs two signatures. **Exit path:** the
reader is already written. When the grammar emits `rule.signatureRequirement`, the table becomes
dead code and is deleted; nothing above `signatureRequirement()` changes.

## #17 — Number series are declared in `neodonkey.json`, not in an entity file

**Category: real work**, same shape and same reason.

FD-6 says series are "declared in the model rather than hardcoded". They are declared, and they are
not hardcoded — but `## Numbered by` is not a section grammar version 2 knows, and `parse.js`
refuses unknown sections (rightly). **Verified 2026-08-03:** `RUNTIME_SECTIONS` in `parse.js` is
`rules, authorized by, fields, predicates, identified by, created on demand, invariants, period,
dated in` — no `numbered by`. So `collectSeries()` reads `entityDef.numbering` and
`model.sequences` **first** and the settings document second, and the first two paths have no
producer.

**Exit path:** an entity-scope `## Numbered by` section with `series`, `pattern`, `reset` and
`date field`. `normalizeSeries()` already validates exactly that vocabulary and refuses everything
else by name.

## #18 — A co-signature requires the co-signer's key in this process. There is no approval transport

**Category: real work** (it lands with peer sync, #4/#6).

The format is correct and detached by construction: a co-signer needs only P(k-1), which any peer
can derive from the commit, and `ssh-keygen -Y sign -n neodonkey-cosign` can produce the signature
with no NeoDonkey code at all. What does not exist is the *transport* — "send this payload to Herr
Klein, get a signature back, then commit". **Verified 2026-08-03:** `Intent.signers` entries carry
`{principal, roles, keyPair}` and the kernel signs with the key pair; there is no path that accepts
a pre-made armored signature. So a four-eyes commit requires both signing keys reachable from one
`perform()` call: two hardware tokens on one machine, or a second key held in the same process.
That is honest for a pilot and wrong for a company.

**What this means for a pilot, stated plainly:** four-eyes is enforceable, and it is not yet
*operable* across two people at two desks. **Exit path:** an approval document carrying the payload
digest and the co-signature, exchanged over the same three-method transport seam #4 describes; the
kernel side is `intent.signers` accepting a pre-made armored signature instead of a key pair, which
is a small addition to `normalizeSigners()`.

**Narrowed 2026-08-04 by agent SYNC. The transport half of that exit path now exists and is proven;
the kernel half and the approval document do not.** Two peers at two desks can establish an
authenticated, forward-secret channel through a relay that cannot read it, and multiplex named
channels over it — `mux()` already carries one channel per document plus the git exchange, so an
`approval:<commit-payload-digest>` channel is a channel name and not a protocol
(`test/sync-relay.test.js`, `test/sync-sealed.test.js`). **What is still missing is exactly two
things, and neither is transport:** (1) `normalizeSigners()` accepting an armored signature instead
of a key pair, which is agent A's file and not ours to edit; (2) the approval document itself — what
Herr Klein *sees* before he signs, which is a UI and a model question. So this entry stays open, its
category stays *real work*, and it is now blocked on the kernel rather than on the network.

## #19 — Cross-peer gapless numbering: enforced in the truth layer, not yet reachable from the kernel

**Category: real work** (the remainder depends on #4 and on one line of #6's item 2).
**Rewritten 2026-08-04, agent ATOM.**

**What this entry said until Wave 2, quoted verbatim:** *"What does not exist: election,
re-election, or detection. Concretely — two peers that both believe they are authoritative, or a
series with no authoritative peer declared, will both issue number 7 while disconnected. The
collision is detectable after the fact […] and it is not preventable."*

**That sentence is now false, and the test that falsifies it is named after it.**
`test/atom-numbering.test.js` (11 tests) runs exactly that scenario — the partition `[berlin] |
[hetzner, munich]`, both peers believing they are authoritative, both computing the value 7 from the
same sequence document — and **number 7 comes out once.** Munich, elected by a majority, issues
`RE-2027-0007`; Berlin issues nothing at all, because a value is proposed to the series' electors and
a MAJORITY must ack it before the consuming commit is written. Two disjoint majorities of one fixed
elector set do not exist.

**The tension, and the honest resolution.** Strict gaplessness needs coordination; offline operation
needs independence; both cannot hold for the same document at the same moment. So:

> **An offline peer cannot issue a legally gapless invoice number. The business event is recorded,
> the numbering waits in `numberingQueue()`, and the user is told which peer it is waiting for.**

That is the answer, not a shortfall. The alternative — issue optimistically and reconcile later — puts
two invoices numbered 7 in front of a Betriebsprüfer, and the first copy is already at the customer.
The queue drains in order the moment this peer may issue again (it wins an election, or the authority
returns), and a retry re-proposes the SAME value under the same id, so a failed attempt does not burn
a number.

**Where a gap is unavoidable, it is documented.** If the previous authority died between a majority
acking value N and the consuming commit reaching anyone else, no successor can distinguish "N was
never committed" from "N is on a disk that has not synced". Reissuing N risks two invoices with one
number; retiring it leaves a gap. `issuanceFloor()` therefore starts the successor above the highest
value any majority ever acked and returns the values in between for the caller to commit as
retirement records — which `auditIssuance(issuances, startOf, retired)` accepts as an accounted-for
gap. An *undocumented* gap is still a defect and the same audit still reports it.

**What is NOT closed:**

1. **`runtime/kernel.js` still calls `assertAuthoritative(decl, nodeId)` with two arguments**
   (verified 2026-08-04). With two arguments the behaviour is byte-for-byte v1.0's — the static
   declaration decides and no majority is consulted — and 46 tests in `test/s-integrity.test.js`
   depend on that signature. Passing the third argument is one line, and it needs live peers to
   attach `PeerLink`s to, which is #4.
2. **Never run over a network.** As #6 item 1.
3. **A series with no authority declared is still single-peer.** `assertAuthoritative` returns null
   when nothing is declared, deliberately: refusing every allocation in a one-peer workspace would
   break every existing folder. A company that needs legally gapless numbers across peers must
   declare `sequence:<series>` in `operating-model/authorities.json`, and the parser refuses a quorum
   below a majority so the declaration cannot be made unsafe by accident.
4. **Two committed declarations of one series cannot be reconciled** — see #6 item 4.

## #20 — Strict authorization does not cover `Read`

**Category: real work**, and named rather than quietly skipped.

`checkAuthorization()` applies to create, update and delete. **Verified 2026-08-03**,
`runtime/kernel.js`: `if (op === 'read') return null;`, with the reason in the code. `Read` is
excluded because a `Read` rule authorizes but does not filter visibility (#4f) and the read index
hands documents to the UI without going through `perform()` at all — so refusing an ungoverned read
would be theatre while the document stayed readable. **Exit path:** visibility filtering in
`runtime/read/`, at which point the same coverage check extends to `read` with no change to its
shape.

---
---

# Part 2 — Closed

Closed entries stay here with what closed them and how that was verified. An entry that vanishes is
indistinguishable from an entry nobody revisited.

## #1 — The runtime is JavaScript, not WebAssembly — CLOSED

**Was: category "manifesto or roadmap is wrong".** **Closed by FD-8** (`docs/ROADMAP-V1.md`), which
decides JavaScript consciously rather than as a shortfall, and amends Principle 3's wording from
"WebAssembly for the runtime" to the browser sandbox and web standards as the substrate. FD-8's own
words: *"This is an amendment to the constitution, not a compromise entry — the difference matters,
and hiding it in COMPROMISES.md would have been the dishonest option."*

The reasoning, preserved because it is the justification an auditor will want: Appendix III line
129 demands the accounting core be readable by any auditor, and a `.wasm` blob cannot be read; a
reproducible build script only moves the trust; our zero-dependency position already delivers what
Principle 3 wants; WASM's real wins are speed (addressed where it matters, and measured) and memory
safety (a weaker argument in a language with no manual memory). WASM stays permitted for a narrow,
benchmarked hot path (SHA-1, inflate) if and only if measurement demands it, with the JavaScript
retained as the readable reference implementation.

**Residual, and it is a claim-audit item rather than a compromise:** the manifesto text still says
WebAssembly, and `docs/MANIFESTO-AMENDMENT-1.md` is still marked *"draft for the author's decision.
Not applied."* Gate condition 10 (every claim audited) owns that, not this register.

## #4b — Ordered list fields lose their order on commit — CLOSED

**Was: category "our shortfall".** An OR-Set is unordered by definition, so a set-valued field is
written in canonical order when it becomes a fact; a committed array with a meaningful order —
invoice line items, most obviously — was reordered by the first live edit.

The manifesto assigns sets to OR-Set (line 124) and names exactly four CRDT types, so agent D
correctly refused to add a fifth (RGA/sequence) on its own authority. **The answer taken was the
ERP-correct one rather than the CRDT-correct one:** line items carry an explicit `position` field,
which is what every accounting system does anyway and what an auditor expects to see. Order is a
*fact about the data* rather than a property of the container, and no new CRDT type was needed.

**Verified 2026-08-03:** every line-item entity in both trees declares `position` —
`bank-statement-line`, `financial-statement-line`, `order-line`, `sales-order-line` in
`operating-model/`, and `order-line`, `sales-order-line` in `templates/d2c-retail-europe/`.
`test/f-model.test.js` asserts it for every entity whose name ends in `-line`, and refuses to pass
vacuously if fewer than four such entities exist. The suite passes.

## #4c-bis — Ungoverned operations were default-ALLOW — CLOSED for new workspaces

**Was: category "our shortfall", and described as the worst defect in v0.1.** Recorded here in full
because the *reason it was not caught* is the most reusable thing in this register.

**What it was.** If no rule in the operating model triggered on a given operation, the operation was
permitted. Verified at the time against the real model, with an actor holding **no roles at all**:

```
create location, no roles → ACCEPTED
update location, no roles → ACCEPTED   (stock-holding: true → false, status → "closed")
delete location, no roles → ACCEPTED
```

Turning off a warehouse's stock-holding flag changes where goods may legally be received. Deleting
a location silently orphans every stock document referencing it. Neither required a role, because
no process file happened to write rules for `location`.

**Why it was serious.** "Authorization lives on rules" silently meant "entities without rules have
no authorization". Coverage of the rule set became a security boundary, and nothing told anybody
where that boundary ran. An operating model looked complete while leaving most of its surface open.
It also undermined the strongest claim we make: "the operating model *is* the system" is only true
if the model is *exhaustive* — and what the model did not mention was not forbidden, it was
unregulated.

**Why it was not caught.** Every module did its job correctly. The rule engine enforced every rule
that existed; the model was coherent; the kernel wired them faithfully. The defect lived in the
*default*, and a default is invisible to unit tests: no test asked "what happens when nothing
applies?" It surfaced only when an end-to-end demo tried to promote an article and succeeded at
something it should have had to justify. That is why Part 4 standing rule 4 exists.

**What closed it: FD-7, additively.** Inverting the default outright was refused by agent C as a
major-version act, because *silence stops meaning "permitted"* and a 2027 folder would behave
differently under a 2028 runtime. Instead: entity files gained `## Authorized by` scoped per
operation (three scopes, most specific wins: rule → file → entity); `parse.js` warns for every
uncovered entity-operation pair; and `open()` records `authorization.strict` in `neodonkey.json` in
the **genesis commit**, default `true`, after which `perform()` refuses any create/update/delete
that neither a rule with authority nor an entity-scope `## Authorized by` governs.
`strictAuthorization` may only *agree* with what the repo records; disagreement is an error, and a
settings file weakened after genesis is refused against the genesis commit's own trailer.

**How that was verified — 2026-08-03, by running it.** `test/s-integrity.test.js` fires the v0.1
attack at the real, verbatim `operating-model/information/location.md` (the test asserts the file it
uses is byte-identical to the shipped one, so the attack cannot be quietly defanged by a fixture).
It first proves the precondition still holds — no rule and no entity-scope authority governs
`location` — and then that all three operations are refused by name, naming the entity, the
operation and the file to edit. `THE v0.1 ATTACK IS DEAD` passes. A pre-strict workspace with no
`neodonkey.json` keeps its meaning exactly, which another test pins.

**Residuals, both open and both named:** `Read` is out of scope (#20), and an existing pre-strict
workspace is still default-allow by deliberate design (§0). Default-refuse for *existing*
workspaces remains a NeoDonkey 2 act.

## #4d — Four-eyes cannot be expressed — CLOSED in the truth layer

**Was: category "real work", and described as the most serious designed gap in v0.1.**
Manifesto line 114: "The four-eyes principle becomes a signature constraint on the commit, not
workflow code."

At the time, authorization worked but a *second* signer could not be required, because the kernel's
`Intent` carried one actor and a commit carried one signature. Agent C handled it exactly right:
`## Authorized by a and b` was **refused at parse time**, not silently read as `or` — a system that
accepted that sentence and then enforced single-signer approval would produce documents that *look*
dual-controlled to an auditor and are not.

**What closed it.** Two signatures over one payload, in the commit format real git already accepts:
the primary in `gpgsig`, the co-signers as `NeoDonkey-Cosign: <principal> <base64>` trailers inside
the payload the primary signs. The staircase is recorded below, under "The co-signature format",
because an auditor and a future implementer both need it.

**How that was verified — 2026-08-03, by running it.** `test/s-integrity.test.js`: a two-signature
commit is `git fsck --strict` clean and `git log --show-signature` reports **G** (real git, real
`ssh-keygen` — Part 4 standing rule 3); one signer is refused; two distinct signers commit; the same
signer twice is refused; a principal cannot co-sign their own document; two roles cannot be covered
by one person holding both; a commit with no `gpgsig` is not a signed commit whatever it co-signs.
All pass.

**Residuals, both open and both named:** the requirement is not yet expressible in the company's own
text (#16), and there is no transport for getting a co-signature from a second desk (#18). So
four-eyes is *enforceable* and not yet *operable* across two people.

## FD-6 — Document numbers derived from a count of documents — CLOSED

**Was: an unentered defect** — v0.1 derived invoice numbers from a count of existing documents,
which breaks on deletion and on concurrency, and GoBD requires sequential and gapless.

**What closed it.** A sequence is a document, and allocation is a `Change` in the same commit as the
document consuming the number. The issuance trailer is inside the signed payload, so `git log` can
prove gaplessness. `nextId()` refuses to invent a number for an entity a series governs, and the
sequence entity cannot be written by hand.

**How that was verified — 2026-08-03, by running it.** 1 000 allocations with refusals and
rollbacks interleaved produce no gap and no duplicate, audited out of the commit history; a refused
commit leaves the sequence document untouched byte for byte; a crash between allocation and commit
cannot lose a number, because there is no between; concurrent allocations on one peer are
serialised, not interleaved. All pass.

**Residual, open and named:** cross-peer gaplessness (#19).

## #4h — Master data has no promotion path — CLOSED

**Was: category "our shortfall".** No rule anywhere promoted master data: nothing set an article
`active`, a supplier `approved`, or an order `confirmed`.

**What closed it:** Three new process files were added under `operating-model/processes/`:
- `article-activation.md`
- `supplier-approval.md`
- `purchase-order-confirmation.md`

These define explicit promotion rules with required roles and conditions (such as food-safety
certification for suppliers, allergen and nutrition declarations for articles, and order confirmation
references for orders).

**How that was verified — 2026-08-12, by running it:** Loaded as the seed for a fresh company in
the acceptance demo, these rules parse without errors and execute. An attempt to violate them is
prevented by strict authorization (FD-7 default-deny). `npm test` runs 641 tests successfully, and
`demo/sarah.mjs` runs end to end with `strictAuthorization: true` under `node`.

## #22 — The acceptance demo runs permissive, deliberately and out loud — CLOSED

**Was: category "our shortfall".** The acceptance demo ran with `strictAuthorization: false` and
claimed all thirteen roles because of the master-data promotion path gap (#4h).

**What closed it:** Consequent to `#4h` being closed, the acceptance demo (`demo/sarah.mjs`) was
updated to run under strict authorization:
- `strictAuthorization` was flipped to `true`.
- The blanket claim of all thirteen roles was removed, and instead only the 8 roles actually held
  by Sarah are granted in the genesis commit (FD-9), allowing her to act with only her legitimate,
  recorded roles.

**How that was verified — 2026-08-12, by running it:** `demo/sarah.mjs` runs successfully and
passes all end-to-end checks (including verification against real `git` and `ssh-keygen`), outputting
"The donkey carries the load." with an exit status of 0.

## #4g — Threshold authorisation: the mechanism shipped, three of four thresholds did not adopt it — CLOSED

**Was: category "our shortfall".** The grammar has been able to enforce these since version 2. Three
process files still enforce them by asking people to read a predicate.

**What closed it:** Checked the actual code state of the operating model and found that all three process files
have indeed been successfully updated with the branched `when ... then ... otherwise` rules, and the stale paragraphs
claiming un-enforceability have been entirely removed:
- `operating-model/processes/purchase-ordering.md` correctly has the `order needs approval` check with managing-director authority;
- `operating-model/processes/discount-posting.md` has the `discount needs management approval` check with managing-director authority;
- `operating-model/processes/returns-and-credit-notes.md` has the `credit-note needs approval` check with managing-director authority.

**How that was verified — 2026-08-12, by running it:** Handled by running the entire test suite `npm test` (all 641 tests green, 639 passing, 2 skipped, 0 failures), proving that the files parse perfectly, compile, and execute correct branched logic under `evaluate()`.

## #15 rr4 — Residual risk 4: unsigned development builds are runnable, and the UI does not say so — CLOSED

**Was: category "our shortfall".** With no pin and no `release.json`, `gateRelease()` returns `'unsigned'` rather than refusing. It means "unsigned" must be visible in the UI.

**What closed it:** Passed `release` into `renderRuntime`, and updated the `releaseBlock` in `views.js` to correctly distinguish and render the `'unsigned'` state as "This runtime is not signed", while also supporting the `'verified'` status instead of the stale `'pinned'` one. The stale "verification is v0.2" paragraph has been completely removed from JSDoc.

**How that was verified — 2026-08-12, by running it:** Added a robust test in `test/g-ui.test.js` asserting that `renderRuntime` with `release.mode = 'unsigned'` properly renders the warning notice "This runtime is not signed" (and that `'verified'` correctly renders the signature verified notice), and ran the entire test suite successfully with all 642 tests passing.

## #21 — `intent.actorRoles` is still a claim the caller makes about itself — CLOSED

**Was: category "our shortfall".** `intent.actorRoles` was a claim the caller made about itself, allowing any caller to elevate their roles arbitrarily.

**What closed it:** FD-9 in full (effective roles = claimed ∩ recorded). `runtime/kernel.js` limits roles to the intersection of those claimed and those recorded at genesis/peer-enrolment. All callers (`mcp/server.mjs`, `runtime/ui/app.js`, `demo/sarah.mjs`) have been updated to act under their recorded peer identity, and excess role claims are rejected.

**How that was verified — 2026-08-13, by running it:** Proven by `test/roles-fd9.test.js` (10 tests, all green) which asserts that `perform({actorRoles:['managing-director']})` called by a recorded warehouse clerk is refused with `roles-not-held`, and that omitting claims safely defaults to the recorded roles.

## #13 — The UI knows five conventional field names, four of which still matter — CLOSED

**Was: category "our shortfall".** Business vocabulary inside the runtime is what Principles 7 and 11 forbid.

**What closed it:** Added `## Displayed by` grammar section to POLISM grammar (`runtime/polism/grammar.md`) and `runtime/polism/parse.js`, parsing `displayedBy` field lists into `EntityDef`. Updated `displayLabel` and `columnsFor` in `runtime/ui/fields.js` to prioritize `displayedBy` over fallback conventional candidate names (`name`, `title`, `label`, `description`).

**How that was verified — 2026-08-13, by running it:** Proven by `test/g-ui.test.js` asserting that `## Displayed by` is parsed from operating model files and that `displayLabel` and `columnsFor` format labels and pick columns using `displayedBy`. All 642 tests in `npm test` pass.

---
---

# Amendments to the module contract

Not compromises. Recorded here because the contract is the thing agents build against, and an
undocumented amendment is how two modules end up disagreeing.

| # | Amendment | Raised by | Reason |
|---|-----------|-----------|--------|
| 1 | `repo.log()` returns the exact signed `payload` bytes | CTO | Browser-side chain verification with no git or ssh binary (Appendix XI) |
| 2 | `FsAdapter` gains optional `chmod(path, mode)` — real in `fs-node.js`, no-op in `fs-opfs.js` | B | The only place the contract actively blocked a security requirement: a private key file would otherwise inherit the umask |
| 3 | `KeyPair` is `{publicKey, privateKey, comment?}`, pinned in the shared vocabulary | B | The kernel passes it between modules |
| 4 | `generateIdentity({comment?, extractable?})`, `exportPublicSsh(kp, comment?)`, `signPayload(…, {hashAlg?})` — all additive | B | `extractable:false` is what makes the browser keystore's security property possible; `comment` is needed for byte-identity with `ssh-keygen -y` |
| 5 | `keystore` gains `remove(name)` | B | Appendix XI's second line of defence (revocation) is unimplementable without it |
| 6 | `sshsig.js` gains non-throwing `inspectSignature(armored)` | B | `kernel.verify()` promises `by` — who *claims* to have signed. Never answers "is it valid" |
| 7 | `Query` gains `join: {as, from, on, required?}` — a single-hop **semi-join** | E | Appendix VI's own example query needs it (region lives on the customer). Deliberately limited: result rows are always documents of `from` (row shape never widens), resolution only from the outer document, single-valued reference fields only |
| 8 | `select()` returns `Doc[] \| number \| Map` — `Map` for `groupBy`, not `Record` | E | Object key order is unstable for numeric-looking keys; a report whose group order depends on that is a bug |
| 9 | `stats()` gains `{readable, opaque, invalid, ignored, paths}`; `Index` gains `problems()` and `entities()` | E | "412 readable, 37 opaque" needs counters, and Principle 6 means every skipped path is nameable with a reason rather than silently dropped. `opaque` (unreadable bytes, indistinguishable from ciphertext) is kept separate from `invalid` (parses, but is not a document) |
| 10 | `materialize()`/`update()` accept optional `builtFrom: OID` | E | The object reader alone cannot know the head commit; omitted means "provenance unknown", never a stale oid |
| 11 | `FsAdapter` gains `mkdir(path)` — required, not optional | A | Git's `is_git_directory()` refuses a folder unless `.git/objects/` and `.git/refs/` exist as *directories*; they are empty at init, so `write()` creating parents is not enough. Verified: without it, `git status` says `fatal: not a git repository` |
| 12 | `fs.js` exports `memFs()` | A | Lets the shared adapter test body run with no environment, and lets a browser tab build a repo before it has a directory handle. Asserted to produce identical oids to `nodeFs` |
| 13 | `decodeCommit` returns `extra: {key,value}[]` for unknown headers | A | Principle 6: an unrecognised commit header is surfaced, never dropped |
| 14 | `repo()` also exposes `readTree(treeOid)` and `indexPaths()` | A | Additive, used by `checkout()` |
| 15 | `Create <entity> with <field>` (no value) added to the consequent forms | C | It **is** the manifesto's headline demo (line 475), which the contract itself makes an acceptance criterion, yet the contract's list omitted it. Semantics: an obligation — the field must be present on the trigger and is carried to the created document |
| 16 | A comparison's right-hand side may be a field, not only a literal | C | Without it the manifesto's own predicate (`delivered-quantity >= ordered-quantity`) cannot be written at all. Types must agree, checked at parse time |
| 17 | Entity-file sections `## Fields`, `## Predicates`, `## Identified by`, `## Created on demand`, plus a fixed prose whitelist | C | Business semantics have to live in the model, not the parser (ARCHITECTURE D4) |
| 18 | `Rule.text`, `Rule.authorizedBySource`, per-node `text`/`line`, `Diag.text`/`.expected`, `Violation.file`/`.line`, `Result.appliedRules`, `Model.grammarVersion` | C | Needed to *quote* the offending sentence back at a human. All additive |
| 19 | `Change` preserves source field order, appending new fields deterministically | C | Matters once the git layer serializes JSON — otherwise diffs churn |
| 20 | `repo.commit({sign})` — `sign` may return `{signature, message}` as well as a string. The returned message **must start with** the message passed in, enforced in `repo.js`, so a signer can only *append* trailers and can never rewrite what a human wrote | S | A co-signature has to be inside the payload the primary signature covers, and that payload cannot be built before the tree oid is known — which only `commit()` knows. Six lines, additive, and the append-only guard is what keeps it safe |
| 21 | `Intent` gains `signers: [{principal, roles?, keyPair?}]`, `numberFrom?`, and an omittable `id`; `Result` gains `number`, `series` and `cosigners`. `open()` gains `strictAuthorization`, `sequences`, `fourEyes`, `roles` and `allowDevWorkspace`. `addPeer()` gains `roles`. All additive: every earlier call site behaves byte for byte as before | S | FD-6, FD-7 and manifesto line 114 |
| 22 | `kernel.verify()` gains `signatures[]` (each signature independently: order, role, principal, fingerprint, status), `cosigners` and `problems`; new `verifyCommit(oid, {requirement, document})`, `authorityOf()`, `uncoveredOperations()`, `numberSeries()`, `sequenceState()`, `auditNumbering()`, `settings` | S | "Is the signature good" is the wrong question for a dual-controlled commit. The right one is "who signed, in what order, and is every signature that had to be here here?" |

### Four stated gaps in the truth layer (agent A, all deliberate)

- **`core.filemode = false`** in the config we write. Not laziness: OPFS has no POSIX permission
  bit, so a browser-written repo cannot honestly promise to track one. Declaring it beats emitting
  an index git calls clean on Linux and modified on macOS.
- **Zero-stat index.** `ctime/mtime/dev/ino/uid/gid` are written as zeros; `size`, `mode` and `oid`
  are exact, which is what git's `ie_modified()` actually requires. The trade is deliberate:
  `.git/index` is byte-identical across two independent builds (asserted), at the cost of the
  *first* `git status` re-hashing everything — measured 231 ms on 2,000 documents, then 21 ms once
  git refreshes the index itself. OPFS has no `dev`/`ino`/`uid`/`gid` to report anyway. Exit path
  if it ever matters: inject stat data, losing byte-reproducibility.
- **No reflog on `setHead()`**, though `logallrefupdates = true` stays on so a human keeps the
  safety net for her *own* git commands. The commit DAG, not the reflog, is the truth.
- **Case-only path collisions.** `Z` and `z` are distinct in the DAG but cannot both exist in a
  working tree on APFS or NTFS — the same limitation real git has (`core.ignoreCase`). Not papered
  over: a test probes the filesystem, asserts the truth layer holds both documents regardless, and
  asserts the working tree is dirty on a case-insensitive volume, so a future fix fails loudly
  rather than changing behaviour silently.

**A design point worth preserving:** decryption is not a parameter anywhere in `runtime/read/`.
Appendix VII lands entirely in the injected `readBlob` — a decrypting reader returns plaintext for
what the peer can open and opaque bytes for what it cannot, and both are counted. No key material
and no crypto enters the read path at all.

**Inner join has an Appendix VII consequence, stated deliberately:** if the referenced document is
opaque to this peer, the row is dropped — because "is this customer in Bavaria" is genuinely not a
question this peer's index can answer. `required: false` makes those rows visible instead.

**Deliberately not done:** writing OpenSSH private key files. The encrypted form needs
`bcrypt_pbkdf` + AES-256-CTR, and a helper that drops an *unencrypted* private key on disk is the
opposite of Appendix IV. CLI interop is fully achieved through the public key plus SSHSIG.

**Still owed:** a browser-runner test for the IndexedDB keystore. Node has no `indexedDB`, so the
suite tests only the premise it rests on (a non-extractable `CryptoKey` survives structured clone,
stays `extractable: false`, keeps rejecting `exportKey`, and remains usable for signing).

## The co-signature format, and the ordering rule that makes stripping detectable

Recorded here because it is the part an auditor and a future implementer both need, and it must not
live only in a comment.

```
Pk = P0 ‖ T1 ‖ … ‖ Tk        where P0 is the commit object with no gpgsig and no
                              NeoDonkey-Cosign trailers, and Tk is the k-th trailer line + LF

co-signature k  signs  P(k-1)     namespace "neodonkey-cosign"
primary gpgsig  signs  Pn         namespace "git"
```

Trailer form, one line, always the **last** lines of the commit message, in signing order:

```
NeoDonkey-Cosign: <principal> <base64 of the SSHSIG blob>
```

A staircase: every signature covers the whole commit plus every signature before it, and none
after. Strip, reorder, duplicate or add a co-signature and the primary no longer covers the bytes
that remain. Strip the primary and there is no `gpgsig`, so real git reports an unsigned commit. A
`NeoDonkey-Cosign` line anywhere but the trailer block has no position in the staircase and is
refused rather than counted; a line smuggled outside the signed region (the only place available is
inside the `gpgsig` header's own continuation lines) is not read at all, so it counts for nothing.

**The namespace is never `git`.** P(k-1) is itself a well-formed commit payload, so a co-signature
carrying the `git` namespace would be a valid *commit* signature over the same commit minus the
later trailers — presentable as `gpgsig` on a commit the co-signer never authored. The same
discipline #15 applies to release signatures, for the same reason.
