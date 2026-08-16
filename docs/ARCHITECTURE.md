# NeoDonkey v0.1 — Architecture

The manifesto is the constitution. This document is the record of how v0.1 implements it, and
which questions were settled on the way. It is written to be checkable: every decision below
names the principle it serves.

## The bet, and whether it holds

The whole system rests on one claim: **a browser, using nothing but web standards, can write a
real Git repository with cryptographically verifiable commits.** If that is false, Principles 3,
4 and 6 are marketing.

It was the first thing built, before any module was designed. The result:

```
$ git fsck --strict
$ git log --show-signature --format='%G? %GS %s'
G sarah@neodonkey.eu goods-receipt GR-0001 created
```

`G` is git's own verdict: *good signature*. That commit was produced by
`crypto.subtle` (Ed25519), `CompressionStream('deflate')` (zlib, the format git stores),
and a fifty-line SHA-1. No libgit2, no isomorphic-git, no npm install. Real git, an
independent implementation written by other people over twenty years, accepts our output as
its own. That is the strongest available evidence for Principle 6's thirty-year promise: we are
not asking anyone to trust a format we invented, we are writing the format the world already
verifies.

**Consequence for the business case:** this is why there is no migration project. The exit path
from NeoDonkey is `cd` into the folder. A customer's data is never hostage, which is the only
credible form of Principle 9 — sovereignty as structure, not as a clause in a contract.

## Layers

```
                    ┌──────────────────────────────────────────────────┐
  disposable        │  UI (generated per role/task)   AI   MCP   CLI   │   Principle 7
                    └───────────────────────┬──────────────────────────┘
                                            │  one API, no exceptions
                    ┌───────────────────────▼──────────────────────────┐
  the core          │              runtime/kernel.js                   │
                    └───┬──────────┬──────────┬──────────┬─────────────┘
                        │          │          │          │
              ┌─────────▼──┐  ┌────▼─────┐  ┌─▼───────┐ ┌▼──────────────┐
              │  polism/   │  │  live/   │  │ read/   │ │  identity/    │
              │ the company│  │  CRDT    │  │ view    │ │  Ed25519 +    │
              │ as rules   │  │ RAM      │  │ index   │ │  SSHSIG       │
              └─────────┬──┘  └────┬─────┘  └─┬───────┘ └┬──────────────┘
                        │          │          │          │
                    ┌───▼──────────▼──────────▼──────────▼─────────────┐
  truth             │        git/  — signed commits, append-only       │   Principle 4
                    └───────────────────────┬──────────────────────────┘
                    ┌───────────────────────▼──────────────────────────┐
  storage           │  fs.js → node fs  |  OPFS / File System Access   │
                    └──────────────────────────────────────────────────┘
```

Only two files in the entire codebase know which environment they run in: `git/fs-node.js` and
`git/fs-opfs.js`. Everything above them is the same bytes in a browser, in Node, and in
whatever runs code in 2045.

## Decisions

**D1 — Git is the database, written by us.** Not a Git *library*: an implementation of the object
format. ~600 lines for blobs, trees, commits, refs, and the index. The reason is Principle 3's
one-click-removability taken seriously — a dependency you cannot replace in an afternoon is a
dependency that owns you. The format is frozen by twenty years of other people's software, so
writing it ourselves costs us nothing in compatibility and buys us total independence.

**D2 — SSHSIG, not GPG.** Git supports both. SSHSIG is a few hundred bytes of well-specified
binary structure and needs only Ed25519 + SHA-512, both native in WebCrypto. GPG would mean
implementing OpenPGP packet formats in a browser. SSHSIG also verifies with `ssh-keygen -Y
verify`, giving an auditor a second, independent tool that confirms our signatures.

**D3 — Time and randomness are injected, never read.** No `Date.now()`, no `Math.random()` in
core logic. This is not test hygiene, it is Appendix V: dialects claim that the same foreign
event produces the same commit no matter which peer fetched it. That claim is only true if
nothing in the pipeline is ambiently non-deterministic. Determinism is a *product feature* here —
it is what lets several peers poll Shopify at once with no leader election.

**D4 — The rule engine has no business knowledge.** `polism/` knows the *grammar* of rules; it
does not know what an invoice is. What "fully delivered" means is declared on the order entity,
in the operating model, by the company. The moment a business concept leaks into the parser, we
have started rebuilding SAP: a vendor deciding semantics, and consultants translating.

**D5 — The index is a view, and we prove it.** `read/` can always be thrown away and rebuilt from
git. The test suite asserts that an incrementally-updated index equals a from-scratch rebuild.
This is what makes the read path safe to optimize later (SQLite-WASM, Tantivy) without ever
risking the truth.

**D6 — The commit message carries the transaction.** Changes and the rules that produced them are
written as git trailers, inside the signed payload:

```
goods-receipt GR-0001 created

NeoDonkey-Transaction: v1
NeoDonkey-Change: create goods-receipt GR-0001
NeoDonkey-Change: update stock ST-CASHEW-BERLIN
NeoDonkey-Rule: operating-model/processes/goods-receipt.md:12
```

A human reads it in `git log`. A machine parses it. An auditor gets Nachvollziehbarkeit
(Appendix IX) — not just *what* changed, but *which written rule* caused it, signed. No
traditional ERP audit trail links a posting to the sentence that authorized it.

**D7 — Rules run on finalize, not only on create.** Live editing is free and unvalidated; the
moment a fact is sealed, it passes the operating model. Otherwise the CRDT layer would be a hole
through which unvalidated state reaches the truth layer.

**D8 — v0.1 ships JavaScript, not WebAssembly.** See COMPROMISES.md #1. The module boundaries are
pure functions precisely so this is a swap, not a rewrite.

**D9 — The conflict policy is data, never code.** ERP-specific conflict semantics (Appendix III
line 130: reject on a released invoice, notify on a draft, merge on a quantity) are expressed as
plain JSON with three verbs, validated by a compiler that refuses unknown keys by name. No
closures anywhere. The reason is Principle 11: this policy must eventually come *out of the
operating model*, and an operating model cannot hand the runtime a function. Two separations make
it safe for a non-programmer to write — the *method* picks the CRDT mechanic (`set`/`add`/`inc`),
the *policy* only picks what happens on collision, so no policy can turn a counter into a set; and
`when` is matched against the committed base document, never against live edits, so two peers
cannot resolve different rules mid-edit and diverge. Deterministic policy resolution with zero
coordination — Principle 2 applied to policy.

**D10 — A fact cannot have two values.** `snapshot()` refuses to produce a document while a
conflict is open, and the kernel surfaces that refusal the same way it surfaces a broken rule.
Silently picking a winner at the moment a value becomes permanent is precisely the data loss
Appendix XI rules out, at the one moment it would be irreversible.

**D11 — Delivery is a Progressive Web App, and the origin must never become an authority.**

Appendix X describes downloading a folder and double-clicking `index.html`. That is not
buildable: ES module scripts are blocked by CORS from `file://`, and OPFS, persistent storage and
WebAuthn all require a secure context. The manifesto describes something the web platform does not
permit. It is also, independently, poor product — nobody starts an ERP by unzipping an archive.

So the runtime is delivered as a PWA. Appendix II line 92 already anticipated the machinery
("verifies with Service Worker plus IndexedDB entirely local").

This introduces the single most dangerous dependency in the whole system: **an origin that serves
code onto a machine holding the user's signing keys and their company's books.** An
auto-updating PWA from `neodonkey.eu` would mean the data is local but the executable is rented —
the exact structure Principle 9 exists to abolish, with better rhetoric. "We promise not to push
bad code" is a contract, and Principle 9 says sovereignty must be structural.

Four properties make the PWA acceptable. It is not acceptable without all four:

1. **Origin-independent.** Every path relative, no build step, no config edit. The app runs from
   `neodonkey.eu`, from `erp.firma.de/neodonkey/`, or from `localhost` unchanged. Self-hosting is
   the normal case. This falls out of Appendix X for free: the €3/month always-on peer a company
   already rents can serve the PWA to its own devices.
2. **Signed runtime, user-pinned key.** Each release is a signed tag over the file hashes; the
   Service Worker refuses code that does not verify against the key pinned at first install. A
   compromised — or compelled — origin then cannot push malicious code. This is the same move
   already made for data: trust signatures, not transport. The machinery exists and is tested.
3. **Consented updates, never silent.** Appendix I's promise is that the accountant runs v2 while
   the warehouse runs v1 and they exchange the same facts. Silent auto-update contradicts it.
4. **Code delivery changes; data location does not.** `showDirectoryPicker()` stays, so the company
   remains a folder a human can `git log` in.

**What the PWA actively buys us:** a stable secure origin is the *precondition* for
WebAuthn/passkeys, which is the exit path for COMPROMISES #2 — signing keys in the Secure Enclave
behind Touch ID, which is what Appendix IV actually demands and `file://` can never deliver. Our
worst cryptographic compromise is unfixable without this change.

**Residual risk, stated plainly:** first install is trust-on-first-use. Until out-of-band release
key verification or pinning occurs, a compromised origin on day one is undetectable.

## What v0.1 deliberately does not do

Encryption groups (Appendix VII), WebRTC peer sync (Appendix III), dialects (Appendix V),
cross-peer reservation atomicity (Appendix VIII's complex case), PDF rendering (Appendix XI),
DATEV export (Appendix IX Track 1). All are designed for in the seams — `fs.js` for storage,
`transport()` for sync, the query interface for the read path — and none are pretended to exist.

The manifesto says 99% is the goal and 100% is a lie. The register of what is missing and where
it bites is in COMPROMISES.md, and it is meant to be read, not filed.
