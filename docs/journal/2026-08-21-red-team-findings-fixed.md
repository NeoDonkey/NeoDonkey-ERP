# 2026-08-21 — Both red-team findings fixed: loose-object reads re-hash, sealing policy reopens

**Date:** 2026-08-21
**Task:** Fix findings F-1 and F-2 from the internal red team report
(`docs/security-redteam-2026-08-21.md`, gate condition 9)

## What changed and why

The internal red team stopped 21 of its 23 attacks and kept two low-severity findings as
deliberately failing tests. This change fixes both, so the pinning tests in the red-team suite
can go green when it merges.

**F-1 — the loose-object read path now re-hashes what it serves.** `objectStore.read` in
`runtime/git/objects.js` inflated the loose object, checked its header and length, and returned
the bytes — never recomputing the SHA-1 they are stored under. A filesystem-level attacker who
replaced a loose object with a *well-formed* zlib stream of forged content was served the
forgery under the honest oid, silently, until a repack, a sync, or a `git fsck` happened. The
read now recomputes the oid from the inflated bytes and throws a named `hash mismatch` error —
the same check the pack reader has always applied (runtime/git/pack.js verifyOids). The pack
read path is untouched. Repack keeps refusing a forged loose object, now even earlier, because
it reads through the same verified path.

**F-2 — `normalizeSealedTable` exists, so the sealing-policy comparison runs.** `readSettings`
in `runtime/kernel.js` called it; it was defined nowhere, so every `open()` passing a `sealed`
table on an existing workspace died with a `ReferenceError`. The security property held by
accident — the process died before any relaxation could take effect — but the intended refusal
was dead code and a caller passing the *identical* recorded policy crashed too. The function
now produces the canonical form the comparison always meant: it accepts the three shapes
`requiredSealing()` accepts (`['hr']`, `'hr'`, `{groups: ['hr']}`), de-duplicates, and sorts
entity keys and group lists, so the question asked is "the same policy", not "the same JSON
text". An identical policy reopens normally; a narrowed or different one refuses with the
descriptive "The repository decides" error — fail closed on purpose, Appendix VII.

## Verification

- New regression tests in `test/redteam-fixes.test.js` (9 tests): the forged loose object is
  refused by name for blobs and trees; repack still refuses to fold it; packed reads are
  unchanged; identical sealing policy reopens, equivalent shapes reopen, narrowed and widened
  policies refuse descriptively (asserted to *not* be a ReferenceError), and omitting the
  option does not re-litigate the record.
- Full suite green: `node --test "test/*.test.js"` — 708 tests, 706 pass, 2 env-gated skips
  (the current-main baseline plus the 9 new ones, on main a845fdf).
- Cross-check against the red team's own suite (`test/redteam.test.js` from PR #120, run
  locally against this change and removed before push): both FINDING tests — F-1 and F-2 —
  now pass.

## What I did not do

- The red-team suite itself (`test/redteam.test.js`, PR #120) is untouched — it pins required
  behavior and is not mine to edit. One of its *other* tests ("a WELL-FORMED forgery behind an
  honest name — what notices, and what does not") documents the pre-fix behavior in an
  assertion (the loose read serving the forgery); after this fix that assertion is stale and
  the test needs a one-line update in PR #120, since the loose read now refuses too.
- The external audit half of gate condition 9 remains open, exactly as the report states;
  nothing here claims otherwise.
- `docs/NEXT.md`, `docs/COMPROMISES.md`, `docs/GATE.md` and `test/gate-score.test.js` are
  untouched: gate scoring is not this change's call.
