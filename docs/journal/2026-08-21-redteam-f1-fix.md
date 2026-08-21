# 2026-08-21 — Red-team finding F-1 fixed

## What

Fix for finding F-1 of the 2026-08-21 red-team report
(`docs/security-redteam-2026-08-21.md`, PR #120), plus regression tests that fail on the
un-patched tree and pass on this one.

Files: `runtime/git/objects.js` (the fix), `test/security-fixes-2026-08-21.test.js` (2 tests).

Finding F-2 (`readSettings` calling a `normalizeSealedTable` that did not exist) is fixed
separately: issue #139 carries the exact patch and its regression tests. The split is a
transport artifact of this change set, not a coupling decision — the two findings are
independent, and F-1 is the one with a silent-corruption blast radius, so it goes first.

## F-1: the loose-object store did not re-hash on read

`objectStore.read` inflated the bytes at `.git/objects/ab/cdef...`, checked the
`"<type> <length>\0"` header and the body length, and returned the object. It never checked
that the bytes actually hash to the requested oid. The header check proves the bytes are
self-consistent; it says nothing about whether they are the bytes the name promises. A hostile
sync peer with write access, or a plain disk error, could place a well-formed forgery at an
object's path and have it served as the real thing — silently, because every check passed.

The read path now re-hashes the inflated frame and refuses on mismatch with a named integrity
error. One SHA-1 per loose read is the price of the content-addressed promise.

The regression test forges exactly the dangerous case: a self-consistent zlib frame whose
header and length are valid, placed at an existing object's path. Pre-fix, `read` returned the
forged body. Post-fix, it throws `hash mismatch`. A second test confirms the honest path is
untouched, including the empty blob and a 100 kB body.

Scope note: packed objects are covered separately — a pack is verified as a whole when it is
published (`git fsck --strict` over the result, see store.js), and `readPack`'s
`verifyOids: false` refers to per-object re-hashing inside an already-verified pack. The gap
was specific to loose reads.

## Verification

- Pre-fix pin: on un-patched main, the forgery test fails (the forged body is served) and the
  honest-path test passes by construction — it describes behaviour the fix must not change.
- Full suite on this tree (`node --test --test-concurrency=2 "test/*.test.js"`, Node 22):
  749 tests, 747 pass, 0 fail, 2 skipped (the two pre-existing env-gated skips). Baseline main
  measured the same day: 747 tests, 745 pass, 0 fail, 2 skipped.
- `node demo/sarah.mjs` runs clean.

## Performance note

The loose-read re-hash adds one SHA-1 per loose object read. The read-path numbers in
`docs/BENCHMARKS.md` were measured before this change; packed reads dominate at scale and are
unchanged, but the next benchmark refresh should note the delta honestly.

## What this does NOT do

PR #120 (the red-team suite and report, gate 9 → partial) is deliberately separate: its two
pinning tests assert the vulnerabilities exist and fail until the fixes land. Merge order is
this PR and the F-2 follow-up first, then #120 rebased onto the result, at which point its
pinning tests are updated to assert the fixes hold. Gate files are untouched here for the same
reason.
