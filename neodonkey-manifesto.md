# NeoDonkey

**A Manifesto for the ERP That Belongs to You. And to Europe.**

*No system is perfect. 99% is the goal — and that is all it takes to no longer structurally need Microsoft, Google, or Amazon.*

*A donkey is not glamorous. It is patient, reliable, carries the load, does not need much, and lives long. This is what we are building.*

---

## About this document

This manifesto is the design constitution for **NeoDonkey**, an operating-model-native ERP built from first principles. It is written to be the foundation for the first MVP, developed together with Claude.

Every design decision must be checkable against these eleven principles. Every appendix elaborates one hard problem and the answer we commit to. When implementation reality forces a compromise, the manifesto stays intact — the compromise is documented separately, explicitly, and revisited at every release.

Read the eleven principles once through. Then read the appendices as needed. The whole thing is short on purpose.

---

## The Eleven Principles

**1. No trade-offs.** Fast *or* secure? Simple *or* powerful? Cheap *or* robust? Classical software wisdom says: pick one. We reject the frame. A conflict between requirements is not a compromise — it is a signal that we have not thought hard enough. We work until every dimension holds, or we do not ship it.

**2. Serverless. Cloudless.** NeoDonkey runs on the machines you already have — distributed across all of them. Storage and compute flow to wherever capacity is, dynamically. Every machine carries what it can; no machine is irreplaceable. No foreign data centers, no rent, no dependency.

**3. A tech stack that fits on a beermat.** Git for the data, WebAssembly for the runtime, the browser as sandbox. Three ingredients, all open, all decades old, all belonging to no one. Foreign libraries are allowed only where they are decisively better than what we could write ourselves — and **every dependency must be removable with one click**. That means: a clean internal interface in front of every foreign piece, a second implementation ready in parallel, and a documented exit path per dependency. Anti-lock-in as engineering practice, not as slogan.

**4. Two file formats. That's it.** An ERP consists of *documents* (invoices, orders, delivery notes, articles, employees, projects) and their *transactions* — created, read, updated, linked, archived. Both live as signed Git commits in the same repo: the document is the content, the transaction is the commit that created or changed it. Radical simplicity in format is the precondition for compatibility in both directions — forever.

**5. Polyglot outward — because integration is the biggest ERP pain point.** Notion, Shopify, Salesforce, retailer EDI, XRechnung — foreign systems are *spoken*, not integrated. Docking is a translation rule, not a project. In both directions. A new foreign system is a new dialect, not a change request.

**6. Compatibility in both directions — forever.** A document written today opens in thirty years. A document written tomorrow opens with today's version. New OS versions read old data; old OS versions understand new data. Update at the push of a button, in any order, without a migration project. Updates add. They never break.

**7. Headless. Period.** AI is *one* interface. MCP is *one* API. UIs are disposable artifacts — generated for this role, this task, this moment. Whatever comes tomorrow docks on without anything being rebuilt.

**8. From freelancer to enterprise — the same system.** 99% perfect for 99% of European companies. One person with a laptop or ten thousand employees across three continents: the same software, the same core, the same principles. No "Enterprise Edition". No compromises.

**9. Sovereignty is structural, not contractual.** A European protocol that pulls the ground out from under the hyperscalers — not a new vendor renting their data centers.

**10. 99% is the goal. 100% is a lie.** A system that admits its imperfection stays honest, maintainable, and yours.

**11. The Operating Model is the ERP.** A company describes itself — Processes, Organisation, Locations, Information, Suppliers, Management System. That description *is* the running system. What the COO reads today, the runtime executes. What she changes in twenty years, changes the system — without a Frankenstein of modules, plugins, and custom scripts, without an army of consultants, without a migration. Zero Tech Debt structurally, because no translator exists between business and tech in which debt could accumulate.

---

## Appendix I — Why Principle 6 changes everything

In the software world, *forward* and *backward* mean opposites: forward compatibility means an old system reads new data. Backward compatibility means a new system reads old data. NeoDonkey demands **both at once**. That sounds academic. It is the point at which the business model of classical enterprise software dissolves.

An average SAP S/4HANA upgrade costs a mid-market company two to five million euros and takes twelve to eighteen months. The upgrade itself is never the reason — it is the custom code, the integrations, the workflows that must be re-tested because the new system no longer understands the old one. Enterprise software has lived off *migration pain* for thirty years. Principle 6 eliminates that pain.

**What that means concretely:**

- **The CTO presses a button.** An enterprise with 100,000 instances rolls out Version 2 — gradually, in any order, without blue/green deployment. Because both versions read and write the same documents and transactions, there is no "green state" that everyone must reach simultaneously. The accountant runs Version 2, the warehouse worker still runs Version 1, they exchange the same facts. It works.

- **Zero-downtime is structural, not orchestrated.** No maintenance window, no freeze, no big-bang weekend. Updates during live operation, one machine at a time, whenever it fits.

- **No relearning.** 99% of classical ERP features are never used (Panorama Consulting measures 10–30% feature usage in SAP/Oracle installations). NeoDonkey structurally has no such ballast: UIs are generated on demand, what you do not use is never generated. A new version brings new capabilities but no new screen to be trained on.

- **Integrations survive.** Because foreign systems are connected as *dialects* (Principle 5), not as hard API couplings, every Shopify, Notion, DATEV connector survives every version jump. A new version adds dialects, never replaces them.

**The one honestly acknowledged exception:** If in ten or twenty years the cryptography itself no longer holds — Ed25519 broken by quantum, SHA-256 collision-vulnerable — one migration step will be needed. It runs automatically on first open and takes seconds, not months. This exception is not a weakness of the principle but the limit of the underlying mathematics. Honesty belongs to the 99% promise.

**Consequence for the business model:** The book analogy holds. Every major version is a standalone work — *NeoDonkey 1* (2027), *NeoDonkey 2* (2030), *NeoDonkey 3* (2033) — bought once, owned forever. Price is tied to the instance, not to users: freelancer, SME, enterprise pay once by size, then unlimited. Whoever does not want Version 2 keeps running Version 1. Whoever wants it rolls out as it suits them. That is the inversion of the SaaS model — and the only model consistent with all ten other principles.

---

## Appendix II — Where the code lives

Classical enterprise software is installed as an OS-native binary (.exe, .dmg, .deb). That creates a hard coupling to the operating system — Windows signatures change, macOS ships a new notarization policy, ARM64 displaces x86-64, and suddenly the installation no longer runs. Exactly the migration hell we are trying to escape would return through the back door.

**The answer: the code lives in the Git repo, executed in the browser.**

Concretely: the runtime is a WebAssembly module that lives next to the data in the same repo. To start, the repo is cloned, an `index.html` in the repo is opened — the browser loads the WASM module into its sandbox and executes it. No installer, no admin rights, no registry entries, no system-tray agent. Nothing is written into the OS. "Uninstall" means: delete folder.

**The stack, bottom up:**

1. **Hardware** (x86-64, ARM64, RISC-V) — rarely changes, browser absorbs transitions.
2. **Operating system** (macOS, Windows, Linux, iOS, Android) — changes yearly, breaks regularly.
3. **Browser engines** (Chrome, Firefox, Safari, Ladybird) — update monthly, rarely break.
4. **Web standards** (WASM, WebCrypto, IndexedDB, WebRTC) — decade-scale stability, additive evolution.
5. **NeoDonkey** (WASM module in the Git repo) — updates monthly, never breaks (Principle 6).

**The critical observation:** NeoDonkey couples only to web standards, nothing below. Everything between hardware and browser engine is someone else's problem. If Apple changes notarization, we do not care. If Windows switches from x86 to ARM, we do not care. If Ubuntu tightens security policy, we do not care. **The only interface we maintain is open standards, owned by no single vendor, only ever extended and never broken.**

**Why that is powerful beyond portability:**

- **Security through sandbox.** The browser locks WASM into the strictest sandbox in software history. Even a hypothetical NeoDonkey vulnerability cannot reach the OS.
- **Update equals file replacement in the repo.** New version? `git pull`. Roll back? `git checkout <version>`. No "installation state" to corrupt.
- **Devices no one thinks of.** iPad in the warehouse, intern's ChromeBook, field-service phone, auditor's Windows 7 laptop — all have a browser. No app-store approval, no "we don't support Linux".
- **Air-gapped ready.** The repo fits on a USB stick. An auditor takes the whole system offline, verifies with Service Worker plus IndexedDB entirely local.

**On the Chrome/Google elephant:** We bet on *standards*, not on Chrome-specific features. WebAssembly, IndexedDB, WebCrypto, WebRTC are native in Firefox and Safari. The Ladybird engine (from the SerenityOS project) is an independent new browser. Should Google ever bend Chrome to Google's advantage, customers switch to Firefox — and nothing in NeoDonkey has to change.

---

## Appendix III — Two layers: Live and Truth

A business system has two fundamentally different time scales. On one, second-by-second collaboration and live views ("what is the current stock?", "this colleague is editing this invoice right now"). On the other, permanent, immutable facts ("Invoice R-2027-0451 was sent on 03.04.2027 at 14:22"). Classical ERPs mix both — with the result that every change is expensive and no change is truly safe.

**NeoDonkey separates cleanly. Two layers, clearly split:**

**Layer 1 — Live Layer (CRDT-based, in the browser):** This is where work happens. Changes are CRDT operations: immediately visible on your own machine, propagated over WebRTC or LAN gossip to other peers, converging by deterministic rules. Millions of such ops per day, all cheap, all in RAM and a local IndexedDB buffer. Git is not touched. This is the "nervous signal" layer from Principle 4 — the live pulse flowing through the company.

**Layer 2 — Truth Layer (Git, append-only, authoritative):** At defined moments, a bundle of Live ops is committed as a signed Git commit. A commit is a snapshot with evidentiary weight: signed, hashed, immutable, GoBD-suitable. It is created when a fact is created: an invoice is sent, month-end runs, a goods receipt is finalized, the necessary consensus is reached.

**What lands in Git is not every change, but every fact.** All 200 CRDT ops the accountant needed to arrive at a finished invoice are irrelevant to eternity — only the final version matters. Live Layer is process; Git Layer is result.

**This resolves the scaling questions in one stroke:**

An enterprise producing 100,000 live ops per hour generates perhaps 5,000 Git commits per day — trivial. A mid-sized D2C shop like KoRo likely lands at ~500 commits/day. Git handles millions of commits per repo without breaking a sweat (Linux kernel: 1.3 million commits, still fluent). Batching is configurable: SMEs commit each invoice immediately, enterprises batch hourly or daily.

Consensus works bilaterally, not globally. The Live Layer converges eventually (as CRDTs do). But the Truth Layer demands signatures before committing: author, approver, sometimes counterparty. The four-eyes principle becomes a signature constraint on the commit, not workflow code.

For very large customers, there are multiple repos, linked by cross-references — one per legal entity, one per plant. The global company is a mesh of repos, not one giant repo. This matches reality: Bosch does not have *one* journal, it has hundreds.

**On our own CRDT implementation:** Automerge and Yjs are excellent research and inspiration. But we keep the option open to write a minimal, ERP-specific CRDT layer ourselves — because Principle 3 says every foreign library must be one-click replaceable. Whether we ship v1 with a bundled Automerge behind an interface, or with our own 1,200-line implementation, is an engineering call at build time — the *architecture* stays the same.

What we concretely need is a narrow set of CRDT types:

- **G-Counter / PN-Counter** for monotonic counters (stock additions, revenue).
- **LWW-Register** (Last-Writer-Wins with Hybrid Logical Clock) for simple fields.
- **OR-Set** (Observed-Remove-Set) for sets.
- **Multi-Value-Register** for fields where conflicts must be made explicit.

**Why that split matters:**

- **Auditability.** The CRDT logic in the NeoDonkey repo is small enough that any auditor, IT security lead, or customer can read and understand it. For a system carrying accounting truth, readability of the core is a feature, not a luxury.
- **ERP-specific conflict semantics.** Our conflict resolution is tailored to business rules: on a released invoice, reject hard; on a draft, notify; on a quantity, OR-Set rule. These rules live in one place, in our language.
- **Format sovereignty.** If a third-party CRDT library breaks its wire format, we are insulated by our own adapter interface. Thanks to Principle 6, our on-disk format is as stable as we make it — forever.

**The mental analogy:** The Live Layer is short-term memory — fast, lossy, constantly overwritten. The Git Layer is long-term memory — consolidated, permanent, selective, cryptographically sealed. The human brain makes this split naturally; sleep is essentially a batching process that commits from the hippocampus to the cortex. An ERP with this split works not artificially, but naturally.

And yes: **Git is the database.** Not Postgres, not MySQL, not MongoDB. Git — with twenty years of hardened Merkle-DAG, native P2P sync, signature support, and radical portability. There is no better append-only, cryptographically verifiable, distributed, open database for business facts. We have simply always thought of it for code only.

---

## Appendix IV — The Vault: credentials and secrets

For every integration with foreign systems we need credentials — API keys, OAuth refresh tokens, X.509 certificates for signed communication, occasionally passwords. For signatures in our own log we need each user's personal Ed25519 key. These secrets need a safe place. But a *central* vault would be the next single point of failure we just abolished.

**Two classes of secrets, two locations:**

*Primary secrets* live only locally in each peer's OS keychain and never leave it:
- The user's personal Ed25519 key (identity and signature)
- The master key for unlocking the vault

*Secondary secrets* live encrypted in the repo, symmetrically encrypted with each authorized peer's master key:
- API keys for foreign systems (Shopify, Salesforce, DATEV)
- OAuth refresh tokens
- Signature certificates for regulator communication

**Why this split:**

- **The vault is versioned.** Credential changes are part of the Git log, with commit context ("Shopify key rotated due to expiry on 03.04.2027").
- **The master key never leaves a peer.** Stealing it requires physical or root access to an authorized machine, not compromising the repo.
- **Rotation is easy.** Re-encrypt the vault file with a new master key; all peers pick up new access rights on next sync.
- **Onboarding.** The master key is handed over locally (physically, via QR code, via encrypted Signal chat); the new peer can then open the vault.
- **Offboarding.** Master key is rotated; the former peer loses access, even if they keep the repo.

**The vault itself is a WASM module (~200 lines).** It knows two operations: `unlock(master_key) -> plaintext_credentials` and `rotate(new_master_key, old_master_key)`. Everything else — storage, load, encrypt, decrypt — runs on standard WebCrypto (AES-GCM, native in the browser).

**Real-world precedent:** SOPS (by Mozilla) and age/agenix (established in the DevOps ecosystem) invented this exact pattern for Git-based secret management and have been running in production for years at companies with far higher security requirements than typical ERPs. NeoDonkey adopts the concept but writes it minimally itself — no library import, just a ~200-line wrapper around WebCrypto.

---

## Appendix V — The Dialect pattern

Principle 5 says: "Foreign systems are spoken, not integrated." The dialect pattern is the concrete implementation.

**Definition:** A dialect is a WASM module in the NeoDonkey repo that speaks exactly one foreign language — Shopify, Salesforce, DATEV, XRechnung, Notion. It lives in `dialects/{name}/` next to the data and has four parts:

1. **The mapping.** How foreign entities map to NeoDonkey entities. Deterministic, declarative, readable.
2. **The reader.** How foreign data is polled or received (webhook, REST, EDI, file).
3. **The writer.** How NeoDonkey entities are pushed back into the foreign system in its native format.
4. **The identity manifest.** Which foreign IDs correspond to which NeoDonkey documents (bidirectional index).

**The strong consequence:** Multiple peers can poll the same foreign system in parallel — because the translation is deterministic and content-addressed, the same foreign event lands as the same NeoDonkey commit regardless of who fetched it. No leader election, no "which peer is the integration owner". Sync deduplicates naturally.

**Adding a new foreign system is a pull request against the dialects folder.** No core change, no version bump, no vendor negotiation. The community can maintain dialects — a supplier who wants to speak with NeoDonkey users publishes their own dialect. Marketplace as ecosystem, not as gatekeeper.

---

## Appendix VI — The Read Path

The Truth Layer (Git) is optimized for write correctness, not query speed. "Show me all invoices over 10,000 EUR from Q3 2027 for customers in Bavaria" against raw Git commits would be miserable. We need a read path.

**The answer: a locally materialized index, personalized per peer.**

Each peer builds a local SQLite or DuckDB index from the parts of the repo it can decrypt (see Appendix VII). The index is a *view*, not truth — it can always be rebuilt from Git. Rebuilding takes minutes even for large repos and happens transparently in the background.

**Why SQLite/DuckDB in WASM and not a homegrown solution:** These are the most audited, most portable, most reliable embedded databases in existence. Both compile cleanly to WASM. Both are Public Domain / MIT — no vendor, no lock-in, no dependency risk in the sense that matters. Behind our internal query interface either can be swapped for the other, or for a custom implementation, in one click (Principle 3).

**What this delivers:**

- Sub-millisecond SQL against the entire company history.
- Personalized per peer: the intern sees only her permitted entities in her index (Appendix VII).
- Rebuildable from Git at any moment — no state to corrupt.
- Works offline.

**Honest limits:**

- Full materialization after a fresh clone can take minutes. After that, incremental.
- Pure full-text search over hundreds of millions of documents may eventually need a dedicated search index (Tantivy in WASM), not SQLite FTS5.

**For AI as interface (Principle 7):** SQL queries against the local index via MCP. Sub-millisecond round-trip because both sides are local. No RAG against a cloud vector DB — direct access with full context and full history.

---

## Appendix VII — Visibility and encryption

In a P2P system every peer has the full repo. But the intern must not see the salary list, the warehouse worker must not see board minutes, the subsidiary must not see the sister company's numbers. The bytes physically exist on every laptop — hiding in the UI is not real control. A central access server would break Principle 2.

The answer is not a new concept but the established pattern from end-to-end-encryption tools (Signal, Cryptomator, age, CryptPad), applied to ERP data: **encryption at rest with group-based keys.**

**Core principle:** Sensitive documents live as encrypted blobs in the repo. Every peer has the bytes; only authorized peers have the key to read them.

### The key design

Three key levels, all with native WebCrypto primitives:

1. **Personal key pairs.** Each person has an Ed25519 pair (already present for signatures) plus a Curve25519 pair for encryption. Private keys live in the OS keychain and never leave the peer.

2. **Group keys.** A group ("HR", "Board", "Berlin plant management") is a symmetric AES-256 key. For each member it is wrapped with their public key (ECDH derivation + AES wrap). The group manifest lives in the repo — every peer sees which groups exist, but only members can unwrap their group key.

3. **Document Encryption Keys (DEK).** Every encrypted document gets a fresh random DEK. The DEK is wrapped for each authorized group with that group's key and stored in the document header.

### Operational flow

On create: client generates a fresh DEK → encrypts content with DEK (AES-GCM) → wraps DEK for each authorized group → writes encrypted blob plus wrap header as a Git commit.

On read: peer checks which groups it belongs to → unwraps the respective group key → attempts to unwrap the DEK → on success decrypts content and materializes into local index; on failure the bytes remain opaque.

**The elegant side effect:** Every peer has a personalized index, built from what it can decrypt. The intern cannot execute `SELECT * FROM salaries` because the table does not exist in her index. Not "she is not allowed" (which could be circumvented) but "she does not physically hold the data in readable form" — structurally stronger than any role-based access control.

### Onboarding and offboarding

**Onboarding:** New employee generates a key pair locally, public key committed to the person manifest, an existing group member wraps the relevant group key for them. From then on they can read.

**Offboarding:** Public key removed from group manifest (commit). All *future* group-key wraps no longer include them. Optionally the existing group key is rotated and sensitive existing documents re-encrypted — a larger but automatable commit.

**Honest communication:** The former employee physically retains the repo. What they saw before leaving, they still know. That is the reality of every system — cryptographically retroactive erasure exists nowhere.

### Metadata leakage

The filename `Salaries_Q3_2027.enc` is itself information. Two mitigations:

- **Encrypted filenames.** The plaintext name lives in the encrypted content header; the repo only shows the content-hash ID.
- **Bucket structure.** Sensitive document classes are bundled — instead of many named files there is one large `hr_bucket.enc` whose inner structure is visible only to the authorized.

What cannot be hidden: the existence of an HR bucket, its approximate size, its change frequency. Traffic-analysis leakage is the honest residual problem of every system — practically irrelevant for an ERP.

### GDPR deletion as cryptographic shredding

"Right to be forgotten" for a customer: all documents with their PII are held encrypted with a customer-specific DEK. On deletion request, this DEK is destroyed. The blobs remain (for GoBD chain traceability), but they are noise forever. **The most elegant known resolution of the GoBD-vs-GDPR conflict** — the two requirements appear irreconcilable, but they are not, if deletion is understood as a cryptographic concept.

### Impact on the beermat stack

No new foreign library. WebCrypto natively provides AES-GCM (content encryption), ECDH with Curve25519 (key wrapping), HKDF (key derivation), AES-KW (wrap operations). What we write ourselves: a ~600-line module for group semantics. Signal Protocol as conceptual template but massively reduced — we need no X3DH handshake, no Double Ratchet.

### The overarching point

Most ERP data is not sensitive. Orders, invoices, delivery notes, stock, article master data, project status — in most companies all employees may see these. The opacity of classical ERPs is a bug, not a feature.

Sensitive: HR data, board papers, M&A preparation, cross-entity consolidation, GDPR-relevant customer PII — perhaps 5–15% of data volume. **NeoDonkey therefore does not encrypt everything, only the sensitive classes. Radical transparency as default, targeted confidentiality where needed.**

---

## Appendix VIII — Atomicity: all-or-nothing in the mesh

Atomicity is the guarantee that related operations either all happen or none. A sale typically changes six documents atomically: order, stock, invoice, receivables, tax account, customer history. Without atomicity you get the accounting super-GAU — invoice sent, but tax not booked.

**Two cases, two answer layers.**

### The simple case: atomicity on one peer

A single peer produces one Git commit per business event. The commit is atomic by nature — it succeeds fully or not at all. All CRUD operations from a "then" clause of a rule (see Appendix XII) go into the same commit. This solves 95% of business events out of the box.

### The complex case: atomicity across peers

When two peers want to reserve the same physical stock at the same moment — Berlin sells 5 units of the last 5 pieces, Munich sells 3 simultaneously — the naive answer would be a central lock server. That breaks Principle 2.

**Our answer: reservation events with TTL.**

A peer intending to change a scarce resource writes a *reservation event* into their Git commit first: "I am claiming units 001-005 of article X until 14:22". Other peers see this on next sync. If a second peer tried to claim the same units in the meantime, both reservation events land — but only the one with the earlier logical timestamp is valid. The later reservation is automatically voided via a follow-up storno event when the conflict is detected.

**The trick:** For scarce resources (physical stock, unique invoice numbers, cash-account balances), one peer per resource is declared the *authoritative* peer. Not authoritative for everything, just for this one resource type. The authoritative peer publishes the reservation confirmations; other peers accept its ordering. This is not a central server but a distributed responsibility — the plant's warehouse peer is authoritative for that plant's stock, the finance peer for the finance journal.

**Fallback:** If the authoritative peer is offline longer than a threshold, a democratic re-election happens among the remaining peers (Raft-like, but small). The system continues; latency for scarce-resource decisions rises briefly.

---

## Appendix IX — The auditor of 2028: regulatory legitimacy

An ERP that no auditor accepts is a toy. GoBD in Germany, IDW PS 880, SOX in the US, e-invoicing mandates across the EU — regulatory acceptance is the price of playing in this market at all. NeoDonkey must be defensible before a Wirtschaftsprüfer.

**Four-track strategy:**

**Track 1 — The DATEV Bridge (MVP).** In the first version, NeoDonkey exports to DATEV in the formats accountants already trust. The auditor's world stays intact; they see familiar files. Behind the export lies NeoDonkey's own signed, immutable log — but the auditor never needs to reach into it. This buys us three years of adoption before we need to argue the deeper case.

**Track 2 — Verfahrensdokumentation (Procedure Documentation).** GoBD does not prescribe technology; it prescribes principles (Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit). A well-written Verfahrensdokumentation, cross-referenced to the NeoDonkey manifesto and appendices, makes the case that signed Git commits *are* the audit trail — more rigorous than any traditional ERP audit trail. Argument by analogy: Bitcoin has been legally accepted as record-keeping in multiple jurisdictions; a signed Git DAG is stronger.

**Track 3 — IDW PS 880 Testat.** A formal software attestation from a mid-tier auditor (~€50–100k, six-month process). This produces a document that says "this system's mechanisms are suitable for GoBD-compliant bookkeeping." Not required by law, but the currency of trust in the DACH market. Similar attestations for other jurisdictions follow the same pattern.

**Track 4 — EIDAS 2.0 as legal binding layer.** From 2027 onward the EU's eIDAS 2.0 framework and the European Digital Identity Wallet establish qualified electronic signatures at citizen level. NeoDonkey's signature layer plugs into this — every commit signed with an eIDAS-qualified signature has *legal* binding force, not just cryptographic. This is a structural advantage no US-based ERP can match, because eIDAS is European by construction.

**Timeline honesty:** Track 1 is week one. Track 2 is month three. Track 3 is year one to two. Track 4 depends on regulatory rollout, realistically 2027–2029. NeoDonkey does not need all four to launch, but it needs a credible path to all four to be enterprise-serious.

---

## Appendix X — Sarah's first weekend (User Story)

To show what NeoDonkey feels like in practice, here is the flow of a solo freelancer coming aboard.

**Day 1 — Sarah installs NeoDonkey.** She goes to `neodonkey.eu`, clicks "Get started", downloads a folder. No account, no email verification, no credit card. In the folder: `index.html`, `runtime.wasm`, empty directories `documents/`, `schema/`, `keys/`. She double-clicks the HTML, her browser opens NeoDonkey. On first launch it asks her name — she types *Sarah Weber*. In the background, the client generates an Ed25519 key pair: private key into the OS keychain (never leaves the machine), public key into the repo. She is now "Sarah Weber" in the NeoDonkey universe. All her actions from now on are signed with this key.

**Day 2 — First invoice.** Sarah says to Claude in the interface: "Create an invoice to Müller GmbH for €1,500 for consulting in November." Claude creates two documents: a customer document for "Müller GmbH", and an invoice. Sarah sees both in a generated view, clicks "Release", done. In the background: the documents are saved as files in the `documents/` folder, a Git commit with Sarah's signature is produced, the local SQLite index materializes the invoice.

**Day 3 — Docking the accountant.** Sarah's accountant Herr Klein installs NeoDonkey on his machine, generates his own key pair. Sarah clicks "Add peer", shows a QR code. Herr Klein scans it. Both clients now know each other's public keys and sync addresses. From now on the two laptops sync automatically every few seconds — directly over LAN when in the same network, otherwise over a small relay (community server or Hetzner peer for €3/month). **The relay sees nothing, decides nothing, stores nothing** — it only forwards encrypted bytes, replaceable like any postal transit station.

**Day 10 — Anna joins.** Sarah hires Anna. Invitation QR code, Anna scans, generates her key pair locally, clones Sarah's repo (one minute). Three-peer mesh: Sarah, Herr Klein, Anna. All three have *the entire repo locally*. All three can work, online or offline.

**If Sarah's laptop falls into the sea.** Anna still has everything. Herr Klein too. The company continues. Sarah buys a new laptop, clones Anna's repo, generates a new key pair (the old one gone with the laptop), Anna re-adds her to the groups. Sarah is reconnected. No backups, no restore procedure — the other peers *are* the backup.

**For 99% availability even with only one peer online:** They rent a small always-on peer at Hetzner or OVH. It decides nothing, knows nothing the three laptops don't know. Replaceable. *Not a server in the classical sense* — a fourth peer that just happens to never be carried in a backpack.

**Everyday life.** Sarah opens her laptop, works, closes it. In the background a sync attempted every 30 seconds. She never clicks "Save", never clicks "Sync". She can look into her `sarah-erp/` folder at any time, `git log` to see her company's commit history. She can `git checkout` back to an old state (to see how her numbers looked in March). She can copy the folder onto a USB stick and open it again in five years. **It is simply a folder. With her company inside.**

---

## Appendix XI — Practical everyday questions

Three questions that arise on practical reflection — and where the answers show how NeoDonkey really works in operation.

### PDF export of an invoice

The PDF does not exist until it is needed. And when it is needed, it appears in milliseconds.

The invoice in the repo is structured data (JSON), not a PDF — that is Principle 4 in action. On click "PDF", the runtime takes the invoice data, combines it with a PDF template from `schema/templates/invoice.pdf.template` (which lives in the repo, editable, versioned), renders in the browser to PDF. The browser can do that natively (`window.print()` produces PDFs) or a ~500-line WASM library produces them more precisely. The PDF lands in the downloads folder. **It is not saved to the repo** because it can be reconstructed at any time — byte-identical from the Git state at that moment.

A legally strong side effect: If the accountant wants to see the November 2027 invoice five years later, they regenerate it from the Git state of November 2027. Byte-identical PDF, because both data and template are versioned. That is legally stronger than today's "the PDF is somewhere in the archive" setups.

**For legal immutability:** Optionally, the hash of the final PDF is written as a metadata field into the invoice document, plus the template version. That lets one prove: "This byte sequence *is* the PDF that was sent." No need to store the PDF itself.

### Parallel editing on the same delivery note

Here the two-layer architecture (Appendix III) becomes visible.

Two peers open the same delivery note `LS-2027-0033`. Both see the same starting state (both on the same Git HEAD). As soon as one starts typing, the document switches from "in Git" to "in Live Layer" — it becomes a CRDT object in the browser's RAM.

Peer A changes the delivery date from "12.11." to "15.11." → CRDT op `set(deliveryDate, "15.11.")` → immediate transmission to Peer B via WebRTC → at Peer B the new date appears ~200 ms after the keystroke, with a marker "changed by A". Conversely, Peer B types a comment into the `notes` field → CRDT op flies to A → A sees the comment appear.

**95% case: different fields = no conflict.** Both changes are valid, both persist.

**5% case: both edit the same field simultaneously.** Multi-Value-Register conflict in CRDT design. The field briefly has two parallel values. In both clients an explicit conflict UI appears: "A: 15.11., B: 16.11. — which do you keep?" One clicks, the other sees the decision. No silent data loss, no last-writer-wins.

**From Live state to Git commit:** As soon as one clicks "Finalize" or "Send", the current CRDT state is snapshotted into a signed Git commit. From the commit onward the delivery note is "frozen" and part of the truth — until someone reopens it and the next round of live editing begins.

Feels to both like a Google Doc. Except there is no Google.

### Lost laptop — what happens, what protects

The honest answer is in two layers: what NeoDonkey can do, and what the OS does.

**Honestly acknowledged:** Whoever physically has the laptop has the bytes on the disk. We cannot remotely erase those bytes. That is true for SAP, Salesforce, Google Workspace too — all "Remote Wipe" features require the device to be online and the client to receive the erase command. No system in the world can undo bytes that have already been copied.

**What NeoDonkey really protects:**

*First line — encryption at rest.* Sarah's private key lives in the OS keychain (macOS Keychain / Windows Credential Manager), protected by login password and possibly Touch ID. With Full Disk Encryption (FileVault/BitLocker, standard since ~2015), the repo bytes on disk are readable only with the password. **For 95% of thefts, that ends it** — the laptop is sold, wiped, data gone.

*Second line — revocation in the mesh.* As soon as Sarah reports the loss, another peer makes a "revocation commit": Sarah's public key is removed from all group manifests. Group keys are rotated (new key generated, wrapped for remaining members, not for Sarah's old key). Sensitive existing documents are re-encrypted with the new group key. **Result: whatever Sarah's old laptop still receives on sync (if the thief brings it online), they cannot decrypt.** The old key is dead. Sarah gets a new laptop, new key pair, is re-added by Anna to the new groups — cleanly separated from the compromised old state.

*Third line — hardware keys.* For companies with a serious threat model: YubiKey or similar (~€30). The private key does not live in the OS keychain but on the physical stick. Without the YubiKey, the thief cannot sign anything even with the password. The old YubiKey is marked compromised; the new laptop gets a new one.

*Fourth line for enterprise:* Standard MDM (Jamf, Intune, Kandji) can remote wipe — OS feature, independent of NeoDonkey but complementary.

**The honest core:** The thief can at most see what Sarah had up to the loss. Nothing new. They cannot impersonate Sarah (any peer detects the compromised signature). They cannot damage the company. **In practice this is structurally no worse than classical cloud systems, often better** — because there, a thief who obtains a password can log into the cloud and potentially reach *current* data, not just an old snapshot.

---

## Appendix XII — The Operating Model as executable text

Principle 11 is the biggest break with the enterprise software tradition, because it inverts the foundational assumption: that business description and software execution are two different things that must be translated between. All classical ERPs — SAP, Oracle, Microsoft Dynamics, Salesforce — are built on this separation. Their entire value creation lies in the translation industry bridging the gap. NeoDonkey makes the gap vanish.

### Why translation is the real source of Tech Debt

Tech Debt does not accumulate because developers are lazy or processes badly designed. It accumulates in the translation chain: Business Change → Requirements Document → User Story → Ticket → Code Change → Release. Each stage loses information, gathers misunderstanding, leaves residue no one ever cleans up. After five years you get the Frankenstein of modules, plugins, add-ons, workflows, and custom scripts that every ERP operator eventually fears.

If the operating model and the system are the same file, the translation chain does not exist. There are no requirements docs, because the requirements *are* the code. There are no user stories, because the user writes their own model directly. There are no tickets, because the change *is* the deployment. **Zero Tech Debt is not a matter of discipline but of architecture.** Remove the translation machine, and no place remains where debt could accumulate.

### The POLISM canvas as starting point

POLISM is an established business framework that COOs and operations leads have used for years (from the Operating Model Canvas by Andrew Campbell, Ashridge). It describes companies in six categories:

- **Processes** — the actions the company performs
- **Organisation** — the roles and responsibilities
- **Locations** — the physical and virtual sites
- **Information** — the data flowing through the company
- **Suppliers** — the external partners
- **Management System** — the leadership and steering rhythms

These six categories will be the same in 2045 as they are today, because they hang on the nature of the company, not on a technology era. **POLISM is timeless in a way no feature convention could ever be.**

### The minimal ontology

From a systems-thinking perspective, everything that happens in a company reduces to two building blocks:

- **Entities** — the nouns: customer, article, invoice, order, goods receipt, employee, location, role.
- **If-Then rules** over entities — the grammar of change: *If [CRUD operation on entity] under [condition], then [CRUD operation on entity].*

CRUD is the complete grammar of change because there are only four ways the world structurally changes: something is Created, Read, Updated, or Deleted. All business processes are chains of CRUD operations with conditions between them.

Example: *If Create goods-receipt under condition quantity > 0 and order exists, then Update stock with +quantity and Update order line with status "delivered".*

That is not a programming language, and not JSON. It is structured text — the intermediate language deliberately *not* looking like code so it does not pull toward code thinking, yet deterministic enough for a runtime to execute.

### What the Operating Model folder looks like

The company has an `operating-model/` folder in the repo, structured by POLISM:

```
operating-model/
├── processes/
│   ├── goods-receipt.md
│   ├── invoice-issuance.md
│   └── discount-posting.md
├── organisation/
│   ├── warehouse-clerk.md
│   ├── accountant.md
│   └── managing-director.md
├── locations/
│   ├── berlin-main-warehouse.md
│   └── munich-office.md
├── information/
│   ├── goods-receipt-fact.md
│   ├── invoice.md
│   └── stock.md
├── suppliers/
│   └── supplier-cashew-nuts.md
└── management-system/
    └── monthly-stock-review.md
```

Every file is a page of text. Prose at top (what is this? what for?), If-Then rules below (what happens when?). Human-readable. Runtime-executable. Versioned like everything else.

### Goods receipt concretely

The file `processes/goods-receipt.md`:

```
# Goods Receipt

The goods receipt is executed when a delivery arrives at the warehouse.
It checks whether the delivery matches the order and updates stock
plus order status.

## Triggered by
Arrival of a delivery at the location with reference to an order.

## Rules
If Create goods-receipt under condition
  quantity > 0 and
  order exists and
  order not already fully delivered
then
  Create goods-receipt-fact and
  Update stock with +quantity and
  Update order-line with status "delivered"

## Authorized by
warehouse-clerk or warehouse-management
```

The Supply Chain Manager reads this, understands it, changes it. To introduce a batch number, they add one word: `Create goods-receipt-fact *with batch-number*`. The runtime understands this as a new obligation, checks from the next goods receipt onward whether a batch number was captured, generates the corresponding UI view.

No programming. No feature request. No consultant. One word changed, system adapted.

### Templates as accelerators

A new customer does not start with an empty folder. They pick a template — "D2C retail Europe", "Manufacturing DACH", "Consulting agency", "B2B wholesale". They get a pre-filled `operating-model/` folder with 20–30 entities, 40–60 rules, 10–15 roles. Twenty pages of prose read in one afternoon. They strike through what doesn't fit, add what's missing. The moment they click "apply", their NeoDonkey is no longer an empty system — it is the business they described.

Templates are themselves POLISM folders. The community maintains, improves, specializes them. A "organic-food-D2C" template is a fork of "D2C retail Europe" with added batch and HACCP rules. That is a pull request in an open community, not a feature catalog from a vendor.

### The runtime as rule interpreter

The technical implementation is minimal because it uses the existing stack:

- A WASM module parses the If-Then rules when the repo is opened.
- On every CRUD operation (every Git commit), a pre-commit hook checks whether all relevant rules are satisfied. Not satisfied? Commit rejected with a clear message about which rule was broken.
- Satisfied? The consequent CRUD operations from the "then" clause execute in the same atomic commit (see Appendix VIII).
- The runtime itself is perhaps 500 lines — a parser plus an executor. Consistent with the beermat stack.

**No LLM in the execution chain.** LLM helps with writing and understanding rules (autocompletion, explanation, suggestions), but execution is deterministic. Just as a SQL interpreter is deterministic without "understanding" the query.

### What happens to consultants

Consultants do not vanish — they change profession. Today they translate between business and software. Tomorrow they advise *on the operating model itself*: should goods receipt look like this? Which approval levels make sense? How do we structure roles in the warehouse?

That is business consulting, not IT translation. A much smaller, higher-value consultant population. They speak the same language as the client and document their work as legible changes to the operating model — not as 200-page requirements documents no one reads.

### The 20-year promise

An operating model written today in POLISM language is still readable and executable in 2045 because:

- POLISM does not change. Processes, roles, locations, information, suppliers, management are timeless categories.
- The ontology (entities + If-Then-CRUD rules) does not change. CRUD is mathematical completeness.
- The runtime may change. If WebAssembly does not exist in 2045, there is a new parser. The `operating-model/` folder stays the same.
- Grammar extensions add, never replace. New rule constructions are additive — old rules continue to run.

And because everything lives in Git, there is no "migration": the 2027 folder is simply opened in 2045 and runs.

### Alignment with the other principles

- **Principle 4** (two file formats) stays: entities are documents, CRUD operations are transactions. The Operating Model is the grammar between them, not a third format.
- **Principle 3** (beermat stack) stays: a 500-line rule parser is minimal and replaceable.
- **Principle 6** (compatibility both directions) becomes stronger: unknown rule constructions are not silently ignored but explicitly refused. "Silent wrong calculation" is structurally prevented.
- **Principle 7** (headless, AI as interface) becomes more organic: AI generates views and suggests rule changes. Execution is deterministic — no LLM caprice in the decision chain.
- **Principle 5** (polyglot outward) stays: a dialect for Shopify or DATEV is a rule collection describing how foreign entities map to NeoDonkey entities.
- **Principle 8** (freelancer to enterprise) becomes trivial: Sarah uses a "Freelancer" template, KoRo uses "D2C retail Europe", Bosch uses "Manufacturing DACH". Same language, different model size.

### The overarching point

With Principle 11, NeoDonkey is no longer an ERP — it is a **runtime for operating models**. A company is text; the runtime executes the text. That is as close to what the Unix philosophy meant with "everything is a file" for operating systems, but for companies.

And it is so simple that the question "how do you explain it" becomes almost trivial: *Write down your company as you would describe it. That is your ERP.*

---

## Closing note for the MVP build

This manifesto is the constitution. It is deliberately more ambitious than the first version of the software will be. That is the point — a manifesto that is easy to meet is not a manifesto.

For the first MVP with Claude, we hold the following order:

1. **The two file formats** (Appendix III / Principle 4) come first. If documents and transactions do not live cleanly in Git as signed commits, nothing else works.
2. **The minimal ontology** (Appendix XII / Principle 11) comes second. Entities and If-Then-CRUD rules must be readable, writable, and executable end-to-end for one process (goods receipt is the reference).
3. **The browser-as-runtime** (Appendix II / Principle 3) comes third. The whole thing must open from `index.html` with no installer, no admin rights, no OS coupling.
4. **The two layers** (Appendix III / Principle 4) come fourth. Live layer as CRDT in RAM, truth layer as signed Git commits.
5. **Everything else** (encryption, dialects, atomicity across peers, PDF export, templates, regulatory legitimacy) is v1.1 and beyond.

Whenever an implementation decision creates tension with a principle, the principle wins by default. If the tension cannot be resolved, we document the compromise explicitly — where, why, and how we get back to the principle in the next release. The manifesto stays intact; the compromise is a known debt with a name and an owner.

The donkey carries the load. Patient, reliable, long-lived. That is what we build.
