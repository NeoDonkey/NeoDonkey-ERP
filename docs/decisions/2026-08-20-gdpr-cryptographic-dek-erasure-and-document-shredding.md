# Decision Record: GDPR Cryptographic DEK Erasure and Document Shredding under GoBD Constraints

**Date:** 2026-08-20

## Question
How does NeoDonkey reconcile GDPR Article 17 ("Right to be forgotten" / right to erasure) requirements with GoBD (§ 3.2.1 Unveränderbarkeit) tax compliance immutability requirements when processing sensitive business and personal data stored as signed Git commits?

## Answer

1. **Reconciling Immutability and Erasure via Cryptographic Erasure (Crypto-Shredding):**
   - Git commits and underlying objects in NeoDonkey are cryptographically signed, immutable DAG nodes. Re-writing Git history to purge personal data breaks commit signatures, alters Git object hashes, and violates GoBD immutability requirements (§ 3.2.1).
   - NeoDonkey enforces privacy-by-design by encrypting sensitive document payloads (e.g. employee records, customer PII, salary details) with a document- or subject-specific Data Encryption Key (DEK).
   - On a valid GDPR Article 17 erasure request, NeoDonkey executes **crypto-shredding**: destroying all wrapped copies of the subject's DEK held in key vaults across authorised peer stores and publishing a signed key-tombstone event (`shred-dek`).
   - The encrypted payload blob remains in the Git repository as un-decryptable random ciphertext. The GoBD audit trail, commit timestamps, hashes, and structural ledger balance remain intact and mathematically verifiable, while the personal data payload becomes permanently inaccessible and cryptographically unrecoverable.

2. **DEK Vault Management and Shredding Mechanics:**
   - DEKs (32-byte AES-256 keys) are stored wrapped under Group Encryption Keys (KEKs / epoch secrets) inside the peer key vault (`.neodonkey/vault/deks/`).
   - A shredding transaction creates a `shred-dek` payload recording the target `dek-id`, the `subject-id`, the `erasure-reason` (e.g. "GDPR Art. 17 request"), and the operator signature.
   - Upon processing a valid `shred-dek` event, kernel cryptographic runtime (`runtime/crypto/shred.js` / `runtime/crypto/envelope.js`):
     1. Overwrites the DEK bytes in memory and key storage with zeroes (`0x00` buffer sweep).
     2. Deletes the DEK wrap record from the local vault.
     3. Registers the `dek-id` in a tombstone index preventing re-import or re-wrapping of the key.
     4. Broadcasts the tombstone event to peer sync channels so all nodes purge the DEK.

3. **GoBD Compliance and Retention Exceptions (Art. 17(3)(b)):**
   - Under GDPR Article 17(3)(b), the right to erasure does not apply to the extent that processing is necessary for compliance with a legal obligation under EU or Member State law (such as the 6- or 10-year retention periods under German HGB § 257 and AO § 147).
   - Non-accounting PII (e.g., job applicant notes, marketing leads, unfulfilled quotes) must be fully crypto-shredded immediately upon request.
   - For accounting documents subject to statutory retention, mandatory structured metadata (invoice number, date, tax amount, total gross) remains in the ledger, while non-essential sensitive attachments or candidate fields encrypted under the DEK are shredded upon expiration of retention or upon request where permitted.

## Source
- **Primary Source (GDPR):** Regulation (EU) 2016/679 (General Data Protection Regulation), Article 17 ("Right to erasure ('right to be forgotten')"), Article 17(3)(b) (Legal obligation exception), Article 25 (Data protection by design and by default), Article 32(1)(a) (Pseudonymisation and encryption).
- **EDPB Guidance:** European Data Protection Board (EDPB) Guidelines 05/2020 on consent under Regulation 2016/679 and Opinion 05/2014 on Anonymisation Techniques (recognising key destruction as irreversible anonymisation/erasure when residual risk of key recovery is negligible).
- **Primary Source (GoBD):** German Federal Ministry of Finance (BMF) Circular on GoBD (2019-11-28, BMF IV A 4 - S 0316/19/10003 :001), § 3.2.1 (Unveränderbarkeit) and § 9 (Aufbewahrung).

## Verification Method
- **Unit Test Verification:** `test/gdpr-crypto-shredding.test.js` encrypts a sensitive document payload with a fresh DEK, verifies successful decryption, executes `shredDek(dekId)`, asserts DEK removal from key vault, and confirms that subsequent unwrap attempts fail with `ErrDekShredded` while `git fsck --strict` and commit DAG integrity remain 100% valid.

## What Must Land First

This decision record settles a structural cryptographic question for Gate Condition 5 and Wave 2, and unblocks implementation once prerequisites land. Per AGENTS.md §5, the following items must land first before implementation of these specifications can be claimed:

1. **Filing GitHub Issues:** The issue specifications below must be filed as open GitHub issues (with issue numbers `#N`) so engineering sessions can claim implementation via `Closes #N`.
2. **Group Encryption Key Management & Envelope Cryptography:** Foundational group key management (epoch secret derivation, KEK wrap/unwrap in `runtime/crypto/envelope.js`, and peer vault DEK storage) must land first to provide the envelope encryption layer that this shredding protocol targets.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(crypto): implement DEK key destruction, zeroing, and tombstoning in runtime/crypto/shred.js`
- **Title:** Implement subject DEK key destruction, zero-sweep, and tombstone registration in runtime crypto
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 5: Cryptographic DEK destruction for GDPR erasure) & Part 3 (Wave 2)
- **Primary Source Citation:** Regulation (EU) 2016/679 (GDPR) Article 17 & Article 32(1)(a); EDPB Opinion 05/2014
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:crypto`, `p1`
- **Verification Method:** Unit test in `test/crypto-shred.test.js` creates an encrypted document with `encryptEnvelope`, invokes `shredDek(dekId)` in `runtime/crypto/shred.js`, verifies zero-fill of key memory, asserts `dekTombstones.has(dekId) === true`, and asserts that `decryptEnvelope` throws `ErrDekShredded`.

### Issue 2: `feat(kernel): process signed shred-dek transactions and update vault tombstone records`
- **Title:** Process signed shred-dek transactions in kernel and enforce DEK key deletion across vault replicas
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 5: Cryptographic DEK destruction) & Part 3 (Wave 2)
- **Primary Source Citation:** Regulation (EU) 2016/679 (GDPR) Article 17; GoBD § 3.2.1
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:runtime`, `p1`
- **Verification Method:** Unit test in `test/kernel-shred-transaction.test.js` submits a signed `shred-dek` transaction to `kernel.perform()`, asserts that the transaction commits to Git history without altering prior object hashes, and verifies that the target DEK is removed from `kernel.vault`.
