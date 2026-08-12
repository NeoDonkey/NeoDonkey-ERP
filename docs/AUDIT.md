# Audit lane

The backlog and findings register for lane B. Read it before starting, rewrite it before
finishing. `docs/NEXT.md` is the other lane and is not edited from here.

**Updated:** 2026-08-12

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

**Verify the README's headline claims, one at a time, by executing them.**

The README makes four claims in its status block about what is closed since v0.1. Each is
falsifiable and none has a test asserting it stays true:

1. *"operations no rule governs are now refused"* — an actor with no roles can do nothing the
   model does not grant.
2. *"a caller's roles are the intersection of what it claims and what the repository records, so
   `actorRoles` is no longer a self-declaration"* — note that `docs/COMPROMISES.md` #21 says the
   opposite, and that `runtime/polism/execute.js:62` still reads `intent.actorRoles` verbatim.
   **These cannot both be true.** Establish which it is and record the evidence. Do not edit the
   register; report it.
3. *"the general ledger posts double-entry with the balance as a structural invariant"*.
4. *"two processes have converged through a relay and recovered a company after one was
   destroyed"*.

Start with #2. It is the one where two of our own documents contradict each other, which makes it
the most likely to be wrong somewhere — and it sits directly on gate condition 3.

*Done when:* the claim is either demonstrated by a test that fails without the behaviour, or
recorded here as not holding, with the evidence.

---

## After that

- **Refusal paths without tests.** Every rule that refuses something is a guard, and a guard with
  no test is one accidental edit from being gone. Find the refusals in `runtime/polism/` and the
  authority checks that no test currently exercises.
- **Error messages that cite a location.** Several refusals quote a file, a line and an
  expectation. Nothing asserts those references are still accurate, so they can drift silently
  into lies that read like precision.
- **The skipped tests.** The suite reports 641 tests with 2 skipped. Find out what they are, why
  they are skipped, and whether the reason still holds.

---

## Findings

Newest first. A finding stays here until lane A closes it, then it is marked closed with the
commit that did so.

*None yet — this lane starts with the run after 2026-08-12.*
