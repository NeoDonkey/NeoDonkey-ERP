# 2026-08-21 — Red-team findings F-1 and F-2 fixed

## What

Fixes for the two findings of the 2026-08-21 red-team report
(`docs/security-redteam-2026-08-21.md`, PR #120), plus regression tests that fail on the
un-patched tree and pass on this one.

Files: `runtime/git/objects.js` (F-1), `runtime/kernel.js` (F-2),
`test/security-fixes-2026-08-21.test.js` (4 tests).

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

## F-2: `normalizeSealedTable` did not exist

`readSettings` called `normalizeSealedTable(options.sealed)` twice to compare the caller's
`sealed` table against the one the workspace records. The function was never defined, so
reopening a sealed workspace with the `sealed` option died with a bare
`ReferenceError: normalizeSealedTable is not defined` — instead of either agreeing with the
record or refusing with the repository-decides message the design intends.

The function now exists next to `readSettings`: entity keys sorted, each group list sorted, so
tables that mean the same thing compare equal regardless of written order. Semantic validation
stays where it was, in `requiredSealing()` at write time.

Regression tests prove all three directions: same meaning in another order agrees (the call
that previously crashed), a table that adds an entity the repository never recorded is refused,
and a caller passing `sealed` against a workspace that recorded nothing is refused — the
silent-plaintext direction the comment in `readSettings` describes.

## Verification

- The new tests fail on un-patched main: 3 of 4 (the fourth, "honest read path", passes by
  construction — it describes behaviour the fix must not change).
- Full suite on this tree (`node --test --test-concurrency=2 "test/*.test.js"`, Node 22):
  737 tests, 735 pass, 0 fail, 2 skipped (the two pre-existing env-gated skips). Baseline main
  before this change: 733 tests, 731 pass, 0 fail, 2 skipped.

## Performance note

The loose-read re-hash adds one SHA-1 per loose object read. The read-path numbers in
`docs/BENCHMARKS.md` were measured before this change; packed reads dominate at scale and are
unchanged, but the next benchmark refresh should note the delta honestly.

## What this does NOT do

PR #120 (the red-team suite and report, gate 9 → partial) is deliberately separate: its two
pinning tests assert the vulnerabilities exist and fail until this fix lands. Merge order is
this PR first, then #120 rebased onto the result, at which point its pinning tests are updated
to assert the fixes hold.
