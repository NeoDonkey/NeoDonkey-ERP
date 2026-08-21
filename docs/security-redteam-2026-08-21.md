# Security Report: Internal Red Team, Gate Condition 9

**Date:** 2026-08-21
**Auditor:** Internal red team (software session), against mirror commit fe1c185
**Status of the gate:** partial. The internal adversarial attempt is done and reported here. The **external security audit by an independent party remains open and is required** before the gate's full wording ("External security audit and red team attempt ...") is met. Nothing in this document is, or claims to be, an external audit.

## Scope

The gate names four attacks. Each was attempted against the real public APIs of the runtime, not against mocks:

1. Forge a commit (`runtime/identity`, `runtime/git`, `kernel.verifyCommit`)
2. Tamper with stored history (`runtime/git` object store; real `git fsck --strict` as foreign judge, per standing rule 3 of AGENTS.md)
3. Bypass the rules (kernel authorization: FD-7 strict default-deny, FD-9 role grounding)
4. Unbalance the ledger (the shipped operating model through `runtime/polism/execute.js`)

Plus the two further claims the contract stakes out: breach the group encryption (`runtime/crypto`, envelope/groups/shred, and the kernel sealing policy) and inject a float into a monetary path (`runtime/money`, FD-1).

Attacker model: Mallory holds a full copy of the repository, can construct arbitrary bytes and call any public API, holds her own enrolment and her own group's key, and may have write access to one machine's workspace folder. She holds no private key of any other peer and is not a member of the HR group. The signed history and the operating model are not hers to edit undetected; that assumption is itself tested below (attacks 2.x).

## Method

Every attack is an executable test in `test/redteam.test.js` (`node --test`, zero dependencies), with a control assertion beside it so a refusal cannot be explained by a broken harness. 23 tests: 21 attacks stopped, 2 findings kept failing on purpose. Weakening a test to make the suite green would hide a hole; that is the one thing a red team must not do, so the two findings fail loudly under their own names.

## Results by attack

### 1. Forged commits: all refused

| Attack | Outcome | Defense (code path) |
|---|---|---|
| Stranger's key signs a commit presented as the founder's | Refused: `primary-signature-invalid` against the recorded key; `unknown-signer` for an unrecorded principal | `runtime/identity/cosign.js` verifyCommitSignatures; the claimed principal is resolved against the signed peer record, as `kernel.verifyCommit` does at runtime/kernel.js |
| Genuine signature re-attached to a mutated commit | Refused: `primary-signature-invalid` | Same path; SSHSIG signs the exact payload bytes |
| Signature replayed from one commit onto the next (same key, new bytes) | Refused: `primary-signature-invalid` | Same path; replay is indistinguishable from forgery, which is the point |
| Signature stripped | Refused: `primary-signature-missing` | Missing is reported as missing, never as "unverifiable, so perhaps fine" |

### 2. Tampered history: one stopped, one partial hole (FINDING F-1)

| Attack | Outcome | Defense |
|---|---|---|
| Flip one byte inside a deflated loose object | Detected: the runtime read throws (the zlib stream no longer inflates); `git fsck --strict` exits non-zero | `runtime/git/objects.js` objectStore.read; real git |
| Replace a loose object with a **well-formed** zlib stream of forged content (invoice x 10,000, same file path) | **Partially successful. See FINDING F-1.** | Repack refuses (`runtime/git/store.js` recomputes hashes from bytes); `git fsck --strict` names the mismatch; a syncing peer verifies pack oids (`runtime/sync/gitsync.js`, verifyOids). But the loose read path itself serves the forged bytes silently. |

**FINDING F-1 (severity: low; kept as a failing test).** `objectStore.read` on a loose object does not re-hash the inflated bytes against the requested oid. A filesystem-level attacker who replaces a loose object with well-formed forged content gets the forgery served under the honest name, with no error, until a repack, a sync, or a `git fsck` happens. Context that tempers severity: the precondition is write access to the workspace folder, which is already inside the trust boundary ("the folder is the company"); real git behaves the same way on read; the pack reader in the same runtime *does* verify every oid by default; and the forgery cannot cross to a peer or into a pack. But this runtime is built to run in a browser with no git binary, and "content-addressed" is the integrity argument the truth layer rests on. Recommendation: re-hash loose object bytes on read and refuse a name/content mismatch, matching the pack path. The failing test pins this required behavior.

### 3. Rule bypass: all refused

| Attack | Outcome | Defense |
|---|---|---|
| Claim a recorded role plus one never recorded (`actorRoles: ['accountant','managing-director']`) | Refused: `roles-not-held`, naming the signed peer record and the rule "a caller narrows its authority, it can never widen it" | kernel.js effectiveActorRoles (FD-9: claimed intersected with recorded) |
| Claim a role that exists nowhere in the company | Refused: `roles-not-held` | Same path |
| Peer whose signed record carries no roles attempts a governed operation | Refused: `roles-not-recorded` ("roles are recorded by the company, never granted by the caller") | Same path, FD-9 default |
| Operation no POLISM rule and no entity default covers | Refused: `not-authorized-by-anything`; the refusal names the file where the missing sentence would live (`operating-model/information/sticky-note.md`) and quotes the missing rule | kernel.js collectRefusals (FD-7 strict default-deny; standing rule 4) |
| Narrow authority to nothing (`actorRoles: []`) on a governed operation | Refused by the rule engine: "no role" | POLISM evaluation through the kernel |

### 4. Ledger unbalance: all refused

Attacks run against the shipped operating model parsed by the real parser, evaluated by `runtime/polism/execute.js`, with Mallory as a fully authorized accountant.

| Attack | Outcome | Defense |
|---|---|---|
| Post a journal entry one cent out of balance (5,949.99 debits vs 5,949.98 credits) | Refused; the violation quotes the invariant by name ("debits equal credits"), names `information/journal-entry.md`, and names the journal entry that would break | The debits=credits invariant in the shipped operating model, executed by execute.js |
| Backdate a balanced posting into a locked period | Refused, naming the locked period 2026-07 | Period-lock rules in the same model |
| Inject a float as the posting amount (`950.0` as a Number, and `950.0000001`) | Refused: "not an exact amount"; the float never reaches the invariant arithmetic | FD-1 boundary check in execute.js / runtime/polism/money.js |
| String token with hidden precision (`950.001 EUR` in a 2-decimal currency) | Refused: "not an exact amount" | Same boundary |

### 5. Group encryption breach: all refused

| Attack | Outcome | Defense |
|---|---|---|
| Non-member opens a sealed salary directly | Refused: `not-a-member`; she cannot even compute the document's path (keyed hash under a key she does not hold), so a dictionary of business names confirms nothing | `runtime/crypto/groups.js` keyring.open / pathFor |
| Transplant the attacker's own wrap header (which her key *can* unwrap) onto the victim ciphertext | Refused: `content-mac-failed`; the whole header is AES-GCM additional authenticated data | `runtime/crypto/envelope.js` frame/AAD |
| Harvest the sealed blob for plaintext patterns | Nothing: no content string and no business name appears in any byte of the blob | AES-256-GCM over canonical JSON; keyed-hashed name. (By design, the entity name and group id stay visible in the header so non-members can rotate keys; that boundary is documented in envelope.js, not accidental.) |
| Read a GDPR-shredded document after erasure, as a legitimate group member, as a stranger holding a copy of the post-erasure vault, and by interrogating the vault directly | All refused: `subject-key-destroyed`; `verifyErasure` proves `unrecoverable`; the retained ciphertext (GoBD keeps the bytes) carries no PII | `runtime/crypto/shred.js` eraseSubject: key destruction plus tombstone. Documented honest limit: a vault copy taken *before* the erasure still opens the document; no cryptographic erasure is retroactive over copies already made. |
| Downgrade: write a declared-confidential entity in the clear by omitting the encryption key | Refused: `encryption-not-configured`; nothing is written | kernel.js sealing policy enforcement |
| Narrow the sealing per call (`sealFor` drops a group the company recorded) | Refused: `sealing-narrowed` | kernel.js planSealing: the caller may widen, never narrow |

### 6. Sealing policy at open: one defect found (FINDING F-2)

**FINDING F-2 (severity: low; kept as a failing test).** `readSettings` in `runtime/kernel.js` (line ~3002) calls `normalizeSealedTable`, a function defined nowhere. Any `open()` that passes a `sealed` table on an existing workspace crashes with a `ReferenceError`, including an open passing the *identical* policy the repository records. Consequences:

- The security property holds by accident: an attempt to relax the recorded policy throws (fails closed), because the process dies before the comparison runs. No confidentiality is lost.
- But the intended descriptive refusal is dead code, the comparison never actually executes, and every caller that passes the documented option on an existing workspace crashes. A security control whose check is unreachable code is a defect even when it fails shut.

Recommendation: define (or import) `normalizeSealedTable` so the intended comparison runs: identical policy opens normally, a relaxed one refuses with the descriptive message. The failing test asserts exactly that.

### 7. Money path float injection: all refused

`money(4.99)`, `toMoney(4.99)`, `fromMinor(499.0)`, `add(token, 0.1)`, `multiply(token, 1.19)`, `Number(money)`, `money + money`, and the smuggled tokens `1e3 EUR`, `4.999 EUR`, `NaN EUR`, `Infinity EUR` all throw a named `MoneyError` (`not-a-string`, `not-a-bigint`, `numeric-coercion`, and friends). Honest paths verified beside them. This matches gate condition 2's claim, now adversarially tested rather than only constructively.

## What was NOT done

- **No external audit.** An external, independent security audit cannot be procured by a software session and was not. It remains the open half of gate condition 9 and is required before the gate can go green.
- No network-level attacks (sync relay, WebRTC) were attempted; the attacker model was a caller of the runtime plus local disk access.
- No side-channel, timing, or dependency-supply-chain analysis; zero runtime dependencies limits that surface but does not eliminate it (Node.js itself, the platform crypto primitives).
- No denial-of-service or resource-exhaustion testing (packfile scale is gate 7, still red).

## Summary

21 of 23 adversarial tests pass: every attack was refused or detected. Two findings, both severity low, are kept as failing tests in `test/redteam.test.js` under FINDING names: F-1 (loose-object reads do not re-hash; mitigated by repack refusal, sync-time verification, and `git fsck`) and F-2 (`normalizeSealedTable` ReferenceError makes the sealing-policy comparison unreachable). Neither permitted a forged commit, a rule bypass, an unbalanced ledger, or a plaintext breach. Gate condition 9 moves red to partial; green requires the external audit.
