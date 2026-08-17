# Audit lane

The backlog and findings register for lane B. Read it before starting, rewrite it before
finishing. `docs/NEXT.md` is the other lane and is not edited from here.

**Updated:** 2026-08-13

---

## What this lane is for

Gate condition 10 in `docs/ROADMAP-V1.md`: *"Every claim audited. README, manifesto and site
checked line by line against behaviour; anything not yet true labelled not yet, in the same
typeface as the promises."* And condition 9: *"An adversary tried."*

Neither is a feature. Both are the difference between a project that says it works and one that
has been checked. This lane does that checking, and turns each check into a test so it stays
checked.

It exists for a concrete reason. On 2026-08-12 two entries in `docs/COMPROMISES.md` — #4h and
#22 — were still listed as open blockers long after the work closing them had landed. The
register said `operating-model/processes/` held 27 files and none promoted master data; it held
30, and `article-activation.md` had been doing exactly that. Nothing caught it, because nothing
was looking. That is this lane's job.

---

## Scope

| | |
|---|---|
| **May edit** | `test/`, `docs/AUDIT.md` |
| **Must not edit** | `docs/COMPROMISES.md`, `docs/NEXT.md`, `docs/JOURNAL.md`, `operating-model/`, `runtime/`, `demo/`, `.github/` |

A defect found outside this lane is **recorded here, not fixed here** — with file, line and the
evidence that shows it. Lane A folds it into the register and acts on it. Two agents editing one
file is how you get conflicts instead of progress.

---

## The next item

**The skipped tests.** The suite reports 658 tests with 2 skipped (benchmark/stress tests requiring `NEODONKEY_BENCH=1` / `NEODONKEY_BIG_PACK=1`).

---

## After that

No open items in the immediate audit queue.

---

## Findings

Newest first. A finding stays here until lane A closes it, then it is marked closed with the
commit that did so.

- **Verified error message location citations (2026-08-13):** Unit tests were added in `test/audit-location-citations.test.js` continuously asserting that all AST source locations for entities, fields, predicates, invariants, processes, and authorities across `operating-model/` and `templates/` point to existing files and valid 1-based line bounds containing valid content. Verified that parser diagnostics, execution refusal objects, and embedded `file.md:line` citations in error details point to valid files and line numbers.

- **Verified POLISM refusal paths and authority checks (2026-08-13):** Comprehensive unit tests were added to `test/c-polism.test.js` exercising previously untested refusal paths in `runtime/polism/execute.js` and `runtime/polism/parse.js`, including invalid operation strings, entity-scope authority refusals when no process rule governs the operation (`matching.length === 0`), staged change validation failures in step 8 of `evaluate()` (missing required fields, invalid enum values, or non-exact money strings), predicate recursion depth limits (> 32), same-event create/delete and delete/change conflicts, self-targeting update refusals, create-on-demand key missing refusals, whole-document comparison diagnostics, missing referenced document `from` path copy/add refusals, and non-number/non-money counter refusals.

- **Verified README headline claims (2026-08-13):** All four headline claims in the `README.md` status block were verified and are now continuously asserted by unit tests in `test/readme-claims.test.js`:
  1. *Operations no rule governs are refused:* Verified in strict authorization mode (`strictAuthorization: true`), ungoverned operations are refused with `not-authorized-by-anything`.
  2. *Caller's roles grounding:* Verified that `actorRoles` is grounded by `kernel.js` (`groundRoles()`, `effective = claimed ∩ recorded`), preventing self-declared role escalation. Note on previous item #2: `docs/COMPROMISES.md #21` was closed on 2026-08-13. `runtime/polism/execute.js` reads `intent.actorRoles` from the `effective` intent passed by `kernel.js`, which has already grounded the roles against the repository peer record (`peers/<email>.json`).
  3. *General ledger double-entry balance invariant:* Verified that `evaluate()` and `kernel.perform()` refuse unbalanced journal entries, citing the `debits equal credits` invariant.
  4. *Relay convergence and company recovery:* Verified that two Node processes converge CRDT and git state over `relay.mjs`, and after destroying one workspace repository, a fresh peer recovers the whole company byte-for-byte with clean `git fsck --strict`.
