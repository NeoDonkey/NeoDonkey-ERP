# NeoDonkey v0.1 — Module Contract

**Status:** binding for the MVP. Every module below is owned by exactly one author and
communicates *only* through the signatures in this file. If you need something that is not
here, you do not add it silently — you state it in your final report as a proposed contract
amendment.

## Non-negotiables (derived from the manifesto)

1. **Zero runtime dependencies.** No npm packages. Not one. `package.json` exists only to
   set `"type": "module"`. Anything we need, we write. (Principle 3, taken literally for v0.1.)
2. **Same ES modules run in Node 22+ and in the browser.** No build step, no bundler, no
   transpiler. Import with relative paths and `.js` extensions. Never import `node:*` outside
   of `runtime/git/fs-node.js` and test files.
3. **Browser-standard primitives only:** `crypto.subtle` (Ed25519, SHA-256/512, AES-GCM),
   `CompressionStream`/`DecompressionStream` ('deflate' = zlib), `TextEncoder`/`TextDecoder`,
   `structuredClone`. Nothing else.
4. **Pure functions at module boundaries.** No module reaches into another's internals, no
   shared mutable globals. This is what makes Principle 3's "removable with one click" true:
   a Rust/WASM implementation must be able to replace any module behind its interface.
5. **Determinism.** No `Date.now()` or `Math.random()` inside core logic — time and randomness
   are *injected* (`clock`, `rng` parameters). This is what makes the Dialect pattern's
   "same foreign event → same commit" claim (Appendix V) achievable, and makes tests exact.
6. **Tests are `node --test` only** (`test/*.test.js`, `import { test } from 'node:test'`).
   Zero deps there too.

## Shared vocabulary

```js
/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID  40-char lowercase hex git object id */

/** A NeoDonkey document = the content of one entity instance. Principle 4, format #1. */
/** @typedef {{ id: string, entity: string, [field: string]: unknown }} Doc */

/** A transaction = the commit that created or changed documents. Principle 4, format #2. */
/** @typedef {{ oid: OID, message: string, author: Identity, time: number,
 *              changes: Change[], signature: string|null }} Transaction */

/** @typedef {{ op: 'create'|'update'|'delete', entity: string, id: string,
 *              before: Doc|null, after: Doc|null }} Change */

/** @typedef {{ name: string, email: string }} Identity */
```

Document path convention (single source of truth, used by git/, read/, polism/, ui/):
```
documents/<entity>/<id>.json      e.g. documents/goods-receipt/GR-0001.json
operating-model/<polism-category>/<slug>.md
```

---

## A — `runtime/git/` · The Truth Layer

**Owner: agent A.** Read `/private/tmp/.../spike/spike.mjs` first — it is *proven* code
(`git fsck` clean, `git log --show-signature` reports `G`). Do not regress it; refactor it
into this shape and extend.

### `fs.js` — storage abstraction (the one place the environment leaks in)
```js
/** @typedef {{ read(path:string): Promise<Bytes|null>,
 *              write(path:string, data:Bytes): Promise<void>,
 *              list(path:string): Promise<string[]>,   // names, non-recursive, [] if missing
 *              remove(path:string): Promise<void> }} FsAdapter */
```
Ship two implementations, identical semantics, both tested by the same test body:
- `fs-node.js` → `export function nodeFs(rootDir): FsAdapter` (only file allowed to touch `node:fs`)
- `fs-opfs.js` → `export function opfsFs(dirHandle): FsAdapter` (browser: OPFS or a
  File System Access directory handle — same `FileSystemDirectoryHandle` API for both)

### `sha1.js`
```js
export function sha1(bytes: Bytes): Bytes        // 20 bytes
export function hex(bytes: Bytes): string
export function unhex(hexStr: string): Bytes
```
### `zlib.js`
```js
export async function deflate(bytes: Bytes): Promise<Bytes>   // zlib wrapper, as git writes
export async function inflate(bytes: Bytes): Promise<Bytes>
```
### `objects.js` — the Merkle-DAG layer
```js
export function objectStore(fs: FsAdapter): {
  write(type: 'blob'|'tree'|'commit'|'tag', content: Bytes): Promise<OID>,
  read(oid: OID): Promise<{ type: string, content: Bytes }>,
  has(oid: OID): Promise<boolean>,
}
export function encodeTree(entries: {mode:'100644'|'40000', name:string, oid:OID}[]): Bytes
export function decodeTree(bytes: Bytes): {mode:string, name:string, oid:OID}[]
export function encodeCommit(c: {tree:OID, parents:OID[], author:Identity, committer?:Identity,
  time:number, tzOffsetMinutes:number, message:string, signature?:string|null}): Bytes
export function decodeCommit(bytes: Bytes): { ...same shape... }
```
Tree entries MUST be sorted the way git sorts them (byte-wise on name, directories compared
as if they had a trailing `/`) or `git fsck` will complain.

### `repo.js` — the porcelain we need, nothing more
```js
export async function initRepo(fs: FsAdapter): Promise<void>   // .git/HEAD, config, refs/
export function repo(fs: FsAdapter): {
  head(): Promise<OID|null>,
  setHead(oid: OID): Promise<void>,                      // updates refs/heads/main
  readTreeAtHead(): Promise<Map<string, OID>>,           // flat path -> blob oid
  /** Build tree objects from a flat path->content map and commit. Atomic: one commit
   *  per business event (Appendix VIII, simple case). `sign` is injected — see B. */
  commit(o: { files: Map<string, Bytes>,                 // FULL desired tree state
              message: string, author: Identity, time: number, tzOffsetMinutes: number,
              sign?: (payload: Bytes) => Promise<string> }): Promise<OID>,
  /** AMENDMENT 1 (CTO): `payload` is the exact signed byte sequence — the commit object
   *  content with the gpgsig header removed, nothing else altered. The kernel verifies the
   *  chain in a browser with no git and no ssh binary; re-encoding a decoded commit is not
   *  good enough, since any whitespace drift silently breaks verification. */
  log(limit?: number): Promise<{oid:OID, message:string, author:Identity, time:number,
                                signature:string|null, parents:OID[], payload:Bytes}[]>,
  readBlob(oid: OID): Promise<Bytes>,
  /** Write the working tree + a valid .git/index so `git status` is clean after our commit.
   *  Without this, a human opening the folder sees every file as deleted. */
  checkout(): Promise<void>,
}
```
`checkout()` must write a real git index (DIRC v2). This is the difference between "we wrote
git objects" and "it is simply a folder, with her company inside" (Appendix X).

**Acceptance:** `test/git.test.js` builds a repo in a temp dir, then shells out to real
`git fsck --strict`, `git status --porcelain` (must be empty), `git log`, `git cat-file`.
Real git is the judge, not our assertions.

---

## B — `runtime/identity/` · Signatures

**Owner: agent B.** The spike's SSHSIG code is proven — reuse it.

### `ed25519.js`
```js
export async function generateIdentity(): Promise<KeyPair>    // WebCrypto Ed25519
export async function exportPublicSsh(kp): Promise<string>    // "ssh-ed25519 AAAA... comment"
export async function exportPrivateJwk(kp): Promise<object>   // for keystore
export async function importPrivateJwk(jwk): Promise<KeyPair>
```
### `sshsig.js` — SSHSIG (the format `git verify-commit` speaks)
```js
export async function signPayload(kp, payload: Bytes, namespace='git'): Promise<string>
export async function verifyPayload(publicSshLine: string, payload: Bytes, armored: string,
                                    namespace='git'): Promise<boolean>
export function allowedSignersLine(email: string, publicSshLine: string): string
```
`verifyPayload` matters as much as signing: a peer must verify *other* peers' commits with no
git binary present (Appendix VIII/X — every peer detects a compromised signature).

### `keystore.js`
```js
export function keystore(backend: 'node'|'browser', fs?: FsAdapter): {
  save(name: string, kp): Promise<void>,
  load(name: string): Promise<KeyPair|null>,
  list(): Promise<string[]>,
}
```
Browser → IndexedDB (non-extractable CryptoKey where possible). Node → a `0600` file under
the workspace. **Honest note for COMPROMISES.md:** the manifesto (Appendix IV) says private
keys live in the *OS keychain*; a browser cannot reach it. Write this up yourself, with the
exit path (WebAuthn/passkey-backed keys, or a native helper), and I will merge it.

**Acceptance:** round-trip sign→verify in our own code, AND a signature we produce verifies
with the system `ssh-keygen -Y verify`. Cross-check against foreign tooling or it doesn't count.

---

## C — `runtime/polism/` · The Operating Model runtime (Principle 11)

**Owner: agent C.** This is the heart of the product. Appendix XII is your spec.

Parse the *structured text* of `operating-model/**/*.md` — prose on top (ignored by the
runtime, read by humans), `## Rules` below. The grammar is deliberately NOT code:

```
If Create goods-receipt under condition
  quantity > 0 and
  order exists and
  order not already fully delivered
then
  Create goods-receipt-fact and
  Update stock with +quantity and
  Update order-line with status "delivered"
```

### `parse.js`
```js
export function parseOperatingModel(files: Map<string,string>): { model: Model, errors: Diag[] }
export function parseRule(text: string): { rule: Rule|null, errors: Diag[] }

/** @typedef {{ trigger: {op:'create'|'read'|'update'|'delete', entity:string},
 *              conditions: Condition[], consequents: Consequent[],
 *              authorizedBy: string[], source: {file:string, line:number} }} Rule */
/** @typedef {{ processes: Rule[], entities: Map<string,EntityDef>, roles: Map<string,RoleDef>,
 *              locations: [], suppliers: [], managementSystem: [] }} Model */
/** @typedef {{ severity:'error'|'warning', message:string, file:string, line:number }} Diag */
```
**Principle 6 is your hardest constraint:** an unknown rule construction is *never silently
ignored*. It is refused, loudly, with file+line. "Silent wrong calculation is structurally
prevented." A v0.2 grammar extension must still parse in v0.1 — or be rejected as unknown,
never guessed at.

### `execute.js`
```js
/** Deterministic. No LLM, ever, in this file (Appendix XII). */
export function evaluate(model: Model, intent: Intent, world: World): Result
/** @typedef {{ op:'create'|'update'|'delete', entity:string, id:string, doc:Doc,
 *              actorRoles:string[] }} Intent */
/** @typedef {{ get(entity:string, id:string): Doc|null,
 *              find(entity:string, pred:(d:Doc)=>boolean): Doc[] }} World */
/** @typedef {{ ok:boolean, violations:{rule:Rule, reason:string}[],
 *              changes:Change[] }} Result */   // changes = trigger + all consequents, atomic
```
`ok:false` → the kernel rejects the commit with the broken rule quoted, by file and line.
`ok:true` → every change in `changes` lands in ONE commit (Appendix VIII).

Condition operators for v0.1 (refuse anything else): `>`, `>=`, `<`, `<=`, `=`, `!=`,
`exists`, `not exists`, `is`, `is not`, and the documented English predicates
`not already fully delivered`-style forms *declared in the entity definition* — do not
hardcode business semantics into the parser. Consequent forms: `Create <entity>`,
`Create <entity> with <field> <value>`, `Update <entity> with <field> <value>`,
`Update <entity> with +<field>` / `-<field>` (counter), `Delete <entity>`.

Write `runtime/polism/grammar.md` — the normative grammar, versioned, additive-only.

**Acceptance:** the goods-receipt example from Appendix XII, verbatim, parses and executes.
Adding the words `with batch-number` to the consequent must make a goods receipt lacking a
batch number fail — that exact demo is in the manifesto (line 475) and must work.

---

## D — `runtime/live/` · The Live Layer (Appendix III)

**Owner: agent D.** CRDTs in RAM, converging without a server.

### `hlc.js`
```js
export function hlc(nodeId: string, clock: () => number): {
  now(): Stamp, observe(remote: Stamp): void, compare(a,b): number }
/** @typedef {{ wall:number, counter:number, node:string }} Stamp */
```
### `crdt.js` — exactly the four types the manifesto names (lines 122-125). No more.
```js
export function lwwRegister(stamp) / pnCounter() / orSet() / mvRegister()
// each: { apply(op): void, value(): any, ops(): Op[], merge(otherOps: Op[]): void }
```
Merge MUST be commutative, associative, idempotent — prove it in tests with randomized op
orderings (seeded, deterministic rng: no `Math.random()`).

### `session.js` — a document being edited live
```js
export function session(doc: Doc, nodeId: string, clock): {
  set(field: string, value: unknown): Op[],       // LWW, or MV on concurrent conflict
  add(field, value) / remove(field, value): Op[], // OR-Set
  inc(field, delta): Op[],                        // PN-Counter
  receive(ops: Op[]): void,
  conflicts(): {field: string, values: {value:unknown, by:string}[]}[],
  resolve(field, value): Op[],
  snapshot(): Doc,       // → this is what gets committed to git
}
```
The 5% case from Appendix XI: same field, concurrent → `conflicts()` reports both values, no
silent last-writer-wins, no data loss. Test it explicitly.

Also `session.js`: `export function transport()` — a *loopback* peer transport for v0.1
(two sessions in one process exchanging ops) behind the interface WebRTC will implement later.
Prove convergence; don't build WebRTC yet.

---

## E — `runtime/read/` · The Read Path (Appendix VI)

**Owner: agent E.** The index is a **view, not truth** — always rebuildable from git.

```js
export function materialize(o: { readTree: () => Promise<Map<string,OID>>,
                                 readBlob: (oid:OID) => Promise<Bytes> }): Promise<Index>
export function indexOf(docs: Doc[]): Index
/** @typedef {{ all(entity:string): Doc[], get(entity:string,id:string): Doc|null,
 *              where(entity:string, pred:(d:Doc)=>boolean): Doc[],
 *              select(q: Query): Doc[],           // tiny declarative query, see below
 *              stats(): {entities:Record<string,number>, builtFrom:OID|null} }} Index */
/** @typedef {{ from:string, where?:Record<string,unknown|{op:string,value:unknown}>,
 *              orderBy?:string, desc?:boolean, limit?:number,
 *              sum?:string, count?:boolean, groupBy?:string }} Query */
```
Note for your report: the manifesto specifies SQLite/DuckDB in WASM. Shipping either would
violate non-negotiable #1 for v0.1 (and neither compiles without a toolchain here). Build the
in-memory index behind this interface — it is exactly the "internal query interface" Principle 3
demands, so SQLite-WASM drops in later with no caller changes. Write that up for COMPROMISES.md.

Must answer Appendix VI's own example: "all invoices over 10,000 EUR from Q3 2027 for
customers in Bavaria" — via `select()`, joining through the customer document. Test it.

---

## F — `operating-model/` + `templates/` · The company as text

**Owner: agent F.** You write *content*, not code — but content that must parse under C's
grammar (`runtime/polism/grammar.md`; coordinate by reading that file, and if the grammar
cannot express something you need, report it rather than inventing syntax).

Deliver a **`templates/d2c-retail-europe/`** POLISM folder — this is the template KoRo-shaped
companies would pick (Appendix XII "Templates as accelerators"): 20-30 entities, 40-60 rules,
10-15 roles, all six POLISM categories populated, prose that a COO reads in an afternoon.
Then `operating-model/` = the instance our demo runs on, seeded from that template, with
**goods-receipt as the reference process implemented end to end** exactly as Appendix XII
specifies it.

Entity definitions (`information/*.md`) declare fields, types, and the named predicates that
rules refer to (e.g. what "not already fully delivered" *means* for an order) — so business
semantics live in the operating model, never in the parser.

European reality, please: EUR, VAT/USt with reverse-charge, XRechnung fields on invoices,
GoBD retention notes, DACH/FR/IT/NL locations, batch/best-before on food articles.

---

## G — `runtime/ui/` · Generated views (Principle 7)

**Owner: agent G, wave 2** — after the kernel exists. Do not start before I hand you
`runtime/kernel.js`. UIs are *disposable artifacts*: generated from entity definitions + role,
never hand-written per entity. No framework, no CDN, no build.

---

## Kernel (mine)

```js
// runtime/kernel.js — the headless core. Every UI, every MCP server, every AI calls THIS.
export async function open(o: {fs, identity, model?, clock?, nodeId?}): Promise<Kernel>
/** @typedef {{
 *   me: Identity,
 *   query: Index,
 *   perform(intent: Intent): Promise<{oid:OID, changes:Change[]} | {rejected:Violation[]}>,
 *   edit(entity:string, id:string): Session,        // live layer
 *   finalize(session): Promise<{oid:OID}>,          // live -> truth
 *   history(limit?): Promise<Transaction[]>,
 *   verify(): Promise<{oid:OID, signature:'good'|'bad'|'none', by:string}[]>,
 *   reindex(): Promise<Index>,
 * }} Kernel */
```

### Amendment — Appendix VII through the kernel (Wave 2, agent KERNELCRYPTO)

Additive. Every name above keeps its exact signature; a workspace opened without the new options
behaves byte for byte as it did (`test/kernel-crypto.test.js` asserts identical HEADs).

```js
export async function open(o: {
  …,
  encryption?: {privateKey: CryptoKey, publicKey?: CryptoKey, curve?: string},
  vault?: Vault,                       // runtime/crypto/shred.js — the ONE mutable store
  sealed?: Record<string, string[]>,   // genesis-signed: which entities are confidential
}): Promise<Kernel>

// perform() gains one option, and returns one extra field only when it is used:
perform(intent: Intent & {
  sealFor?: string[] | {groups: string[], subject?: string},
}): Promise<{oid, changes, sealed?: {entity, id, groups: string[], subject: string|null}[]}
          | {rejected: Violation[]}>

// `changes[].id` of a sealed document is its SEALED id — that is where the document is.
// The business name comes back as the `SEALED_NAME` field for a peer that can decrypt it.
export const SEALED_NAME: string                      // 'sealed-name'
export function parseSealedTrailer(line: string): {entity, id, groups, subject} | null
PATHS.crypto                                          // = CRYPTO_PATHS, not a second copy

/** @typedef {{ …,
 *   encryptionStatus(): {enabled, principal, vault, groups, knownGroups, epochs,
 *                        keyringProblems, reads: {plain, opened, opaque, byReason, builtFrom}|null,
 *                        problems},
 *   sealingPolicy(): Record<string, string[]>,
 *   encryptionGroups(): {id, title, epoch, members, rotations, member, at}[],
 *   subjects(): {keyId, subject, state, groups, at}[],
 *   enrol(o?): Promise<{oid, unchanged, enrolment} | {rejected}>,
 *   createGroup(o: {id, title?, members, message?}): Promise<{oid, group, epoch, members} | {rejected}>,
 *   addGroupMember(group, principal, o?): Promise<{oid, …} | {rejected}>,
 *   removeGroupMember(group, principal, o?): Promise<{oid, …, limitation} | {rejected}>,
 *   rotateGroup(group, o?): Promise<{oid, group, epoch, because} | {rejected}>,
 *   offboard(group, principal, o?): Promise<{oid, epoch, resealed, moved, limitation} | {rejected}>,
 *   eraseSubject(o: {subject, reason, requestedBy?, at?}): Promise<{oid, keyId, destroyed, documents,
 *                                                                  note} | {rejected}>,
 *   inspectSealed(entity, id): {entity, id, groups, subject, contentAlg, size, version} | null,
 *   sealedPathFor(o: {entity, name, group, epoch?}): Promise<string|null>,
 *   findSealed(o: {entity, name, group, epoch?}): Promise<Doc|null>,
 *   history(limit?): Promise<(Transaction & {sealed: SealedTrailer[]})[]>,   // additive field
 * }} Kernel */
```

Two facts a caller must know rather than discover:

* **`settings.sealed` cannot be relaxed by a call.** A caller may add groups and may never drop one;
  a workspace that declares an entity confidential refuses to write one without `encryption`.
* **A group manifest that cannot be parsed refuses to open the workspace** when `encryption` is
  supplied. Skipping it would silently downgrade the peer to a non-member, and an index quietly
  missing every salary reports no problem at all.

## Reporting rules for every agent

- Work only inside your own directory. Never edit another agent's files or `runtime/kernel.js`.
- `test/<letter>-*.test.js` is yours; run `node --test test/` before reporting.
- Final report, short and factual: what you built, the exact test command and its real result,
  every contract amendment you need, and every manifesto tension you hit (which principle,
  where, why, and the exit path). Do not paper over a compromise — an honestly documented
  compromise is manifesto-compliant; a hidden one is the only real failure.
