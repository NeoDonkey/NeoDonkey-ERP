# Decision Record: German GoBD Verfahrensdokumentation & Auditor Compliance Mapping

**Date:** 2026-08-20
**Author:** Daniel Pammé
**Status:** Approved / Binding
**Roadmap Reference:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 8), Wave 3 (`Verfahrensdokumentation`)

---

## Context and Question

German tax law (Abgabenordnung §§ 145–147) and the principles for proper management and storage of books, records and documents in electronic form (GoBD) require every tax-paying entity utilizing electronic accounting systems to maintain a comprehensive **Verfahrensdokumentation** (procedure documentation).

Gate Condition 8 in `docs/ROADMAP-V1.md` Part 2 states:
> *"A German auditor's questions have written answers. Verfahrensdokumentation cross-referenced to code, covering Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit, and where the signing key lives."*

`docs/GATE.md` marks Condition 8 as **RED** with missing item:
> *"Verfahrensdokumentation document cross-referenced to code locations."*

The core question is: How does NeoDonkey demonstrate compliance with GoBD requirements and AO §§ 145–147 to a German tax auditor (Betriebsprüfer) through a structured, maintainable `docs/VERFAHRENSDOKUMENTATION.md` that directly cross-references GoBD principles to executable runtime implementation files?

---

## Why This Decision Is Needed

Traditional ERP vendor compliance relies on third-party certification or opaque black-box audit trails. NeoDonkey operates on an entirely serverless, zero-dependency signed Git substrate where a company lives in a plain folder.

German tax auditors require written answers detailing four foundational GoBD principles (Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit) and system architecture. Without a formally structured `Verfahrensdokumentation` with verified line-level code citations:
1. German companies using NeoDonkey cannot satisfy GoBD § 9.1 during a tax audit (*Betriebsprüfung*).
2. The claims in `neodonkey-manifesto.md` Track 2 remain unverified.
3. Gate Condition 8 cannot transition from RED to GREEN.

---

## Primary Sources

1. **GoBD (Grundsätze zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff):**
   - BMF-Schreiben vom 28.11.2019 (IV A 4 - S 0316/19/10003 :001).
   - **§ 3.2.1 (Abs. 36–39):** *Nachvollziehbarkeit und Nachprüfbarkeit* (Traceability and Auditability). The processing of business transactions must be verifiable from origination to financial reporting.
   - **§ 3.2.2 (Abs. 40–44):** *Vollständigkeit* (Completeness). Every taxable transaction must be recorded completely and without omissions.
   - **§ 3.2.3 (Abs. 45–51):** *Richtigkeit und Zeitgerechte Erfassung* (Correctness and Timeliness). Postings must be recorded chronologically and promptly.
   - **§ 3.2.4 (Abs. 58–60):** *Ordnung und Unveränderbarkeit* (Systematic Order and Immutability). Bookings cannot be altered, overwritten, or deleted without leaving an immutable audit trail.
   - **§ 9.1 (Abs. 151–155):** *Verfahrensdokumentation*. Detailed breakdown required across 4 mandatory sections: *Anwendungsbereich*, *Anwendersystem*, *Interne Kontrollsystem (IKS)*, and *Datensicherheit/IT-Infrastruktur*.

2. **Abgabenordnung (AO):**
   - **§ 145 AO:** General requirements for accounting and record keeping.
   - **§ 146 AO:** Ordnungsvorschriften für die Buchführung. Abs. 4: Immutability of bookings.
   - **§ 147 AO:** Ordnungsvorschriften für die Aufbewahrung von Unterlagen (10-year statutory retention period for accounting records).

3. **Handelsgesetzbuch (HGB):**
   - **§ 238 HGB:** Buchführungspflicht.
   - **§ 239 HGB:** Führung der Handelsbücher.
   - **§ 257 HGB:** Aufbewahrung von Unterlagen und Aufbewahrungsfristen.

---

## Decision and Technical Specification

### 1. Mapping GoBD Pillars to NeoDonkey Code Paths

NeoDonkey satisfies the four GoBD pillars through core runtime primitives:

1. **Nachvollziehbarkeit & Nachprüfbarkeit (Traceability & Auditability):**
   - *GoBD § 3.2.1 / AO § 145:* Every business event produces a signed Git commit (`NeoDonkey-Transaction: v1`).
   - *Code cross-references:*
     - `runtime/kernel.js`: Constructs signed commit payloads with transactional metadata (`NeoDonkey-Change`, `NeoDonkey-Rule`, `NeoDonkey-Actor-Roles`).
     - `runtime/identity/sshsig.js`: Cryptographic Ed25519 signature verification.
     - `runtime/polism/execute.js`: Evaluates domain business rules deterministically.

2. **Unveränderbarkeit (Immutability):**
   - *GoBD § 3.2.4 / AO § 146 Abs. 4:* Changes are append-only Git DAG commits. Modifications generate new correcting entries rather than mutating past state.
   - *Code cross-references:*
     - `runtime/git/store.js` & `runtime/git/pack.js`: Immutable SHA-256 hash-chained object storage and packfile v2 serialization.
     - Period Locking: Locked accounting periods refuse retroactive postings.

3. **Vollständigkeit & Richtigkeit (Completeness & Correctness):**
   - *GoBD § 3.2.2 & § 3.2.3 / AO § 146 Abs. 1:* Gapless document numbering and structural debit=credit balance invariants.
   - *Code cross-references:*
     - `runtime/truth/sequence.js`: Legally gapless document sequence allocation (`FD-6`).
     - General Ledger POLISM Invariants: Double-entry GL rules enforce total debits equal total credits.

4. **Zeitgerechtigkeit (Timeliness):**
   - *GoBD § 3.2.3 (Abs. 45-51):* Monotonic timestamps and injected clock execution.
   - *Code cross-references:*
     - `runtime/kernel.js`: Uses injected `clock` for deterministic commit timestamping.
     - `runtime/live/hlc.js`: Hybrid Logical Clock ordering cross-peer operations.

### 2. Required Structure of `docs/VERFAHRENSDOKUMENTATION.md`

`docs/VERFAHRENSDOKUMENTATION.md` must follow GoBD § 9.1 (Abs. 151–155) and contain five explicit chapters:
1. **Chapter 1: Anwendungsbereich & Allgemeine Systembeschreibung (Scope & System Overview)**
   - Operating model scope, single repo per legal entity (`FD-3`), no cloud, no server.
2. **Chapter 2: Anwendersystem & Technische Architektur (User System & Technical Architecture)**
   - Headless runtime (`runtime/kernel.js`), zero dependencies, ES modules, browser/Node compatibility.
   - Immutable DAG substrate (`runtime/git/`), SSHSIG signature verification (`runtime/identity/sshsig.js`).
3. **Chapter 3: Belegwesen & Buchführungssystem (Document Flow & General Ledger)**
   - Domain invoice lifecycle, double-entry general ledger (`FD-4`), gapless sequence numbers (`FD-6`), POLISM rule invariants (`runtime/polism/parse.js`, `runtime/polism/execute.js`).
4. **Chapter 4: Internes Kontrollsystem IKS & Berechtigungskonzept (Internal Control System & Authorization)**
   - Strict default-deny authorization (`FD-7`), claimed ∩ recorded role intersection (`FD-9`), four-eyes signature requirements (`runtime/identity/cosign.js`).
5. **Chapter 5: Datensicherheit, Verschlüsselung & Aufbewahrung (Data Security, Encryption & Retention)**
   - Envelope encryption & group key management (`runtime/crypto/groups.js`, `runtime/crypto/envelope.js`), GDPR Art. 17 cryptographic DEK shredding (`runtime/crypto/shred.js`), 10-year GoBD / § 147 AO retention compliance.

### 3. Automated Verification via `test/gate-score.test.js`

To transition Gate Condition 8 to **GREEN**, `docs/VERFAHRENSDOKUMENTATION.md` must exist and be added as evidence to Condition 8 in `test/gate-score.test.js`. An automated test will assert that all referenced code paths in `docs/VERFAHRENSDOKUMENTATION.md` exist on disk.

---

## What Must Land First

Filing the issue specifications defined below as open GitHub issues MUST land first before implementation can be claimed via `Closes #N`.

---

## Unblocked Implementable Issues

The following two `ready` issues are defined and unblocked by this decision record:

### Issue 1: Write GoBD Verfahrensdokumentation cross-referencing code locations
- **Title:** `docs(gobd): write Verfahrensdokumentation cross-referencing GoBD requirements to runtime code paths`
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 8), Wave 3.
- **Area:** `area:docs`
- **Priority:** `p1`
- **Label:** `ready`
- **Description:** Create `docs/VERFAHRENSDOKUMENTATION.md` structured according to GoBD § 9.1 (Abs. 151–155) across the 5 mandatory chapters. Cross-reference GoBD principles (Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit) directly to runtime source files (`runtime/kernel.js`, `runtime/git/store.js`, `runtime/identity/sshsig.js`, `runtime/truth/sequence.js`, `runtime/polism/execute.js`).
- **Constraints:** Zero dependencies, strict primary source citations, valid markdown file paths.
- **Verification:** `docs/VERFAHRENSDOKUMENTATION.md` exists and contains all 5 required GoBD chapters and verified code path citations.

### Issue 2: Add automated Verfahrensdokumentation code path link and gate score test
- **Title:** `test(gobd): add automated Verfahrensdokumentation link and code-reference integrity test`
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 8), `test/gate-score.test.js`.
- **Area:** `area:tests`
- **Priority:** `p1`
- **Label:** `ready`
- **Description:**
  1. Add `test/verfahrensdokumentation.test.js` to parse `docs/VERFAHRENSDOKUMENTATION.md` and assert every referenced file path exists in the repository.
  2. Update `test/gate-score.test.js` to mark Gate Condition 8 as `green` with evidence `docs/VERFAHRENSDOKUMENTATION.md` and `test/verfahrensdokumentation.test.js`.
  3. Regenerate `docs/GATE.md` via `npm test`.
- **Constraints:** Node native test runner (`node:test`), zero external dependencies.
- **Verification:** `node --test test/verfahrensdokumentation.test.js` passes, and `npm test` updates `docs/GATE.md` marking Gate Condition 8 as GREEN.

---

## What Would Have to Change for This Answer to Change

1. A revision in German tax legislation (AO or GoBD) modifying the mandatory chapters of a Verfahrensdokumentation or record retention periods.
2. Changes to NeoDonkey core architecture (e.g. altering the signed Git substrate or POLISM execution model).
