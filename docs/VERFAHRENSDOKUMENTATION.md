# Verfahrensdokumentation (Procedure Documentation per GoBD § 9.1)

**Status:** Current as of 2026-08-21. This document is re-verified by `test/verfahrensdok.test.js` on every test run; every code path it cites is asserted to exist on disk.
**Binding decision record:** `docs/decisions/2026-08-20-gobd-verfahrensdokumentation-and-auditor-verification.md`
**Gate reference:** `docs/ROADMAP-V1.md` Part 2, Condition 8; scorecard in `docs/GATE.md`.

This is the written answer set for a German tax audit (Betriebsprüfung) of a company whose books run on NeoDonkey. It follows the structure GoBD § 9.1 (Abs. 151-155) prescribes for a Verfahrensdokumentation: Anwendungsbereich, Anwendersystem, Internes Kontrollsystem, and Datensicherheit/IT-Infrastruktur. Every claim names the code or test that proves it, because an auditor's question is not answered by prose; it is answered by something that can be re-run.

## Primary sources

1. GoBD, BMF-Schreiben vom 28.11.2019 (IV A 4 - S 0316/19/10003 :001):
   - § 3.2.1 (Abs. 36-39): Nachvollziehbarkeit und Nachprüfbarkeit.
   - § 3.2.2 (Abs. 40-44): Vollständigkeit.
   - § 3.2.3 (Abs. 45-51): Richtigkeit und zeitgerechte Erfassung.
   - § 3.2.4 (Abs. 58-60): Ordnung und Unveränderbarkeit.
   - § 9.1 (Abs. 151-155): Verfahrensdokumentation, four mandatory sections.
2. Abgabenordnung (AO) §§ 145, 146 (Abs. 4: Unveränderbarkeit der Buchungen), 147 (Aufbewahrungsfrist, 10 Jahre).
3. Handelsgesetzbuch (HGB) §§ 238 (Buchführungspflicht), 239 (Führung der Handelsbücher), 257 (Aufbewahrung).

---

## 1. Anwendungsbereich (Scope) and General System Description

**What the system is.** NeoDonkey is an ERP with no server, no cloud and no runtime dependencies. One legal entity lives in one folder; the folder is a Git repository; every business fact is a signed commit; the software executes in the browser or under Node 22+ from the same unmodified ES modules. One repository per legal entity is a foundation decision (FD-3, see `docs/ROADMAP-V1.md`), which keeps the Bücher und Aufzeichnungen of one entity physically separate from any other.

**Scope of this documentation (Anwendungsbereich).** This Verfahrensdokumentation covers the electronic bookkeeping and record-keeping system within the meaning of AO §§ 145-147 and HGB §§ 238-239 as implemented by:

- the transaction kernel (`runtime/kernel.js`), which turns every business event into a signed, hash-chained Git commit;
- the immutable object store (`runtime/git/store.js`, `runtime/git/pack.js`, `runtime/git/objects.js`);
- the rule engine that decides what may be booked (`runtime/polism/parse.js`, `runtime/polism/execute.js`);
- the operating model in `operating-model/`, where the chart of accounts (SKR03/SKR04), journal entries, accounting periods and number sequences are declared as data, not code;
- the identity, encryption and release-signing layers (`runtime/identity/`, `runtime/crypto/`, `runtime/release/`, `release/sign-release.mjs`).

**What is out of scope.** Hardware, the client's operating system, and the browser vendor are the operator's responsibility (Mitwirkungspflichten). NeoDonkey runs on commodity hardware the operator owns; there is no vendor data centre to describe because there is no data centre.

## 2. Anwendersystem (User System) and Technical Architecture

**Architecture.** The headless runtime is `runtime/kernel.js`. It has zero npm dependencies and no build step; the same modules run in Node 22+ and in the browser. All platform access goes through `crypto.subtle`, `CompressionStream`, `TextEncoder` and `structuredClone`. Time and randomness are injected (`clock`, `rng`), never read from the environment, which is what makes "same event, same commit" testable.

**The recording substrate.** Business events are not rows in a database. Each one becomes a Git commit constructed by `runtime/kernel.js` with the trailer `NeoDonkey-Transaction: v1` plus metadata trailers naming the change, the governing rule and the actor's roles (`NeoDonkey-Change`, `NeoDonkey-Rule`, `NeoDonkey-Actor-Roles`). Commits are stored as SHA-1 hash-chained objects (`runtime/git/objects.js`, `runtime/git/store.js`) and serialised as packfile v2 (`runtime/git/pack.js`). Every commit is signed with an Ed25519 key in SSHSIG format; signing and verification live in `runtime/identity/sshsig.js` and `runtime/identity/ed25519.js`.

**Independent verifiability.** The commit format is stock Git and the signature format is stock SSHSIG, on purpose. `test/s-integrity.test.js` proves both with foreign tooling as the judge: real `git fsck --strict` and `git log --show-signature` accept the repository, and real `ssh-keygen -Y verify` accepts the signatures. An auditor does not have to trust NeoDonkey's own code to check NeoDonkey's books.

**Rule authority.** What may be booked is decided by POLISM rules declared in the operating model, parsed by `runtime/polism/parse.js` and evaluated deterministically by `runtime/polism/execute.js`. The runtime itself contains no business vocabulary; a rule that is not in the model does not exist, and an operation no rule authorises is refused.

## 3. Belegwesen und Buchführungssystem (Document Flow and General Ledger)

**Document flow (Belegwesen).** Invoices, credit notes, orders, goods receipts and payments are documents declared in `operating-model/information/` (e.g. `operating-model/information/invoice.md`, `operating-model/information/journal-entry.md`). Each document lifecycle is a sequence of signed commits; the Beleg stays readable as plain JSON in `git show`, amounts included, so an auditor reading raw history sees the amount and the currency rather than an opaque blob.

**Double-entry general ledger (doppelte Buchführung, HGB § 239).** The general ledger is modelled in POLISM with a structural invariant that total debits equal total credits on every journal entry (`operating-model/information/journal-entry.md`), enforced by `runtime/polism/execute.js` at write time. `test/f2-ledger.test.js` exercises the chart of accounts (SKR03/SKR04), the posting flows, VAT, the trial balance and the period close.

**Gapless numbering (lückenlose fortlaufende Nummerierung).** Document numbers are allocated by `runtime/truth/sequence.js` (foundation decision FD-6), declared per series in `operating-model/information/number-sequence.md`. Numbers start at one, are issued by exactly one authoritative peer, and `auditIssuance` in the same file verifies after the fact that no number was issued twice and no number is missing.

**Period locking (Periodensperrung).** An accounting period is declared in `operating-model/information/accounting-period.md` with the invariant "the period is not locked". Once a period is locked, a posting dated inside it is refused; the correction has to be a new posting in an open period. `test/f2-ledger.test.js` contains the exact test: "a posting into a locked period is refused; the same posting in the next period is accepted".

## 4. Internes Kontrollsystem (Internal Control System, IKS) and Authorization Concept

**Default-deny (Berechtigungskonzept).** Authorisation is strict default-deny (FD-7): an operation that no POLISM rule explicitly authorises is refused, including `delete` on governed entities by an actor with no roles at all. `test/s-integrity.test.js` fires exactly that attack at the real operating model and asserts the refusal. `test/c-polism.test.js` covers rule authority checks.

**Claimed and recorded roles (FD-9).** The actor's claimed roles are intersected with the roles actually recorded for that identity before any rule sees them; the recorded roles travel inside the signed commit as the `NeoDonkey-Actor-Roles` trailer written by `runtime/kernel.js`. `test/roles-fd9.test.js` proves the intersection and its refusals.

**Four-eyes principle (Vier-Augen-Prinzip).** Where a process requires a second signature, `runtime/identity/cosign.js` attaches co-signatures to the same commit payload (namespace `git`), and verification fails unless the required distinct signers are present. Both signatures verify with stock `ssh-keygen -Y verify`.

**Invariant enforcement as control.** The IKS is not a manual on a shelf; the controls execute. Debit-equals-credit, period locking, gapless numbering and default-deny are evaluated on every write by `runtime/polism/execute.js`, and a refusal is itself a committed, signed, inspectable fact.

## 5. Datensicherheit und IT-Infrastruktur (Data Security and IT Infrastructure)

**Infrastructure.** There is no server infrastructure to secure: the company folder sits on the operator's own machines, syncs peer-to-peer or through a relay that never sees plaintext, and runs in the browser or Node. The datacenter chapter of a conventional Verfahrensdokumentation collapses to "the operator's own hardware and OS patching discipline".

**Encryption at rest.** Sensitive documents are sealed with group keys: AES-256 group secrets managed in `runtime/crypto/groups.js`, a self-describing, versioned on-disk envelope in `runtime/crypto/envelope.js` (format designed so a blob written in 2027 is openable in 2057 with no registry lookup), key handling in `runtime/crypto/keys.js`, and reader-side enforcement in `test/crypto-reader.test.js`.

**GDPR erasure without breaking the audit trail.** Erasure under GDPR Art. 17 is cryptographic shredding: the customer-specific DEK is destroyed, the ciphertext blobs remain as permanent noise, and the GoBD hash chain stays fully verifiable. Implemented in `runtime/crypto/shred.js`, proven in `test/crypto-shred.test.js`.

**Retention (Aufbewahrung, AO § 147, HGB § 257, 10 Jahre).** The retention medium is the Git DAG itself: every record ever booked remains in the object store, packfiles in `runtime/git/pack.js` are the archival serialisation, and nothing in the write path deletes or rewrites history. Deletion is not a code path that exists; shredding a DEK is the only erasure primitive, and it preserves the chain.

**Release integrity.** The runtime verifies its own code: `release/sign-release.mjs` hashes every shipped file and signs a release manifest, `runtime/release/manifest.js` verifies that manifest in the browser against the key pinned at first install by `runtime/release/pin.js` (namespace `neodonkey-release`, so a release signature can never be replayed as a commit signature). `test/h-release.test.js` and `test/readme-claims.test.js` cover the verification behaviour, and stock `ssh-keygen -Y verify` accepts the release signatures as a second, independent implementation.

---

## 6. The Four GoBD Pillars, Mapped to Code

### 6.1 Nachvollziehbarkeit und Nachprüfbarkeit (traceability and auditability)

**Requirement.** GoBD § 3.2.1 (Abs. 36-39), with AO § 145: the processing of every business transaction must be verifiable from its origination (Entstehung) through to the financial statements, by an expert third party within a reasonable time.

**How NeoDonkey satisfies it.** Every business event is a signed Git commit carrying structured trailers (`NeoDonkey-Transaction: v1`, `NeoDonkey-Change`, `NeoDonkey-Rule`, `NeoDonkey-Actor-Roles`) written by `runtime/kernel.js`. The rule that authorised the event is named in the commit and evaluated deterministically by `runtime/polism/execute.js` from the model parsed by `runtime/polism/parse.js`, so "why is this here" has a mechanical answer: the commit names the rule, the rule is text in `operating-model/`, and replaying the DAG reproduces every reported figure.

**Proof.** `test/s-integrity.test.js` verifies real commits with real `git log --show-signature` and real `ssh-keygen -Y verify`; `runtime/identity/sshsig.js` is the signature implementation. Traceability does not depend on NeoDonkey agreeing with itself.

### 6.2 Unveränderbarkeit (immutability)

**Requirement.** GoBD § 3.2.4 (Abs. 58-60), with AO § 146 Abs. 4: a booking may not be altered, overwritten or deleted without leaving an immutable trace; changes must remain recognisable as changes.

**How NeoDonkey satisfies it.** The store is append-only. Objects are content-addressed and hash-chained (`runtime/git/objects.js`, `runtime/git/store.js`); every commit names its parent, so altering any historical byte changes every downstream hash and invalidates every downstream signature (`runtime/identity/sshsig.js`). Corrections are new correcting entries (Stornobuchung as a new commit), never edits. Period locking adds the procedural half: a posting dated inside a locked period is refused outright, per the invariant in `operating-model/information/accounting-period.md`.

**Proof.** `test/f2-ledger.test.js`: "a posting into a locked period is refused; the same posting in the next period is accepted". `test/s-integrity.test.js` proves the hash chain and signatures hold under stock `git fsck --strict`.

### 6.3 Vollständigkeit (completeness)

**Requirement.** GoBD § 3.2.2 (Abs. 40-44), with AO § 146 Abs. 1: every taxable transaction must be recorded completely and without omissions (lückenlos).

**How NeoDonkey satisfies it.** Completeness is enforced at the two places omissions actually happen. First, document numbers are legally gapless: `runtime/truth/sequence.js` (FD-6) allocates each number once, and `auditIssuance` in the same file proves after the fact that the issuance chain has no gaps and no duplicates; the series themselves are declared in `operating-model/information/number-sequence.md`. Second, no half-finished booking can exist: the double-entry invariant in `operating-model/information/journal-entry.md` is evaluated by `runtime/polism/execute.js` on every write, so an unbalanced journal entry is a refusal, not a record. Every reported state is a fold over the whole commit graph; there is no side table a transaction could hide in.

**Proof.** `test/f2-ledger.test.js` for the balance invariant and posting flows; `test/s-integrity.test.js` for gapless issuance under the real 28-rule operating model.

### 6.4 Zeitgerechtigkeit (timeliness)

**Requirement.** GoBD § 3.2.3 (Abs. 45-51): postings must be recorded chronologically and promptly (zeitgerecht), in the order they occurred.

**How NeoDonkey satisfies it.** Two mechanisms, one local and one distributed. Locally, `runtime/kernel.js` never reads the wall clock: commit timestamps come from an injected `clock`, so recording order is explicit and deterministic rather than whatever the machine happens to say. Across peers, `runtime/live/hlc.js` implements a Hybrid Logical Clock, because a wall clock is not monotonic (laptops sleep, NTP corrects backwards) and an ERP that loses a stock movement to a three-second clock jump is broken in a way nobody notices until inventory day. HLC ordering gives cross-peer operations a total, monotone causal order; the parent-chained commit DAG then fixes that order permanently.

**Proof.** Determinism from injected clocks is what makes the whole suite exact; `runtime/kernel.js` documents the injection, and `test/s-integrity.test.js` plus the sync tests exercise ordering across peers.

---

## 7. Where the Signing Key Lives

An auditor asks this question verbatim. The honest answer has three parts.

**Business identity keys (the keys that sign commits).** `runtime/identity/keystore.js`, and the file's own header says what it is: a deliberately two-headed approximation of "the user's personal Ed25519 key lives in the OS keychain". In the browser backend, the private key is a non-extractable CryptoKey in IndexedDB, persisted by structured clone; script that reads the record gets a signing handle, not key material. In the Node backend, the key is a JWK file under the workspace via the injected filesystem adapter; that is key material as bytes on disk, and it is a real, documented weakening. Co-signing keys for the four-eyes principle follow the same storage, with signature composition in `runtime/identity/cosign.js`.

**The release signing key (the key that signs the software itself).** `release/sign-release.mjs` signs the release manifest; `runtime/release/pin.js` pins the release public key at first install; `runtime/release/manifest.js` verifies every subsequent load against the pinned key. **No production release key and no published fingerprint exist yet.** That is an open, named residual risk: `docs/COMPROMISES.md`, entry #15, residual risk 7 (the signed-runtime machinery ships unarmed). Generating a production key inside a public repository is refused for security reasons; where the fingerprint gets published is an open decision, not a task to complete unilaterally.

**What never happens.** Key material is never committed to this repository; the convention is absolute (no `.jwk`, `.pem`, `.key`, no `.env`), enforced by ignore rules and treated as a backstop rather than permission. Private keys for business identities never leave the operator's own machines, because there is no server for them to leave to.

## 8. Honest Limits (Ehrliche Grenzen)

A Verfahrensdokumentation that omits its own limits is marketing. These are the limits, each with its register entry or code location:

1. **First install is trust on first use.** The release key is pinned when the software first loads (`runtime/release/pin.js`); a compromised origin on day one can pin its own key. After one honest install, an origin that is compromised, bought or simply wrong cannot change the code on that machine. This is the standing subject of `docs/COMPROMISES.md` entry #15.
2. **No published release key yet.** The verification machinery is built and tested; the production keypair and published fingerprint are not. See `docs/COMPROMISES.md`, entry #15, residual risk 7. Until it ships, the release-signature chain protects updates after first install but is not yet anchored to an independently published identity.
3. **Node key storage is bytes on disk.** The browser backend keeps private keys non-extractable; the Node backend stores a JWK file under the workspace (`runtime/identity/keystore.js`). Operators running the Node backend must protect the workspace directory with OS-level access control.
4. **An offline peer cannot issue a legally gapless number.** `runtime/truth/sequence.js` says so in its own header: gapless issuance needs the authoritative peer; a number reserved while offline is either reissued or retired, and `auditIssuance` makes either visible.
5. **This document describes tested behaviour, and can be re-tested.** Nothing here is asserted from a report. `node --test "test/*.test.js"` re-checks every claim, and `test/verfahrensdok.test.js` fails the suite if any code path cited above stops existing.

---

*Written for the Betriebsprüfer who asks "wo steht das?" The answer, for every sentence above, is a path.*
