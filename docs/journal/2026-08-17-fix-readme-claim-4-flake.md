# Journal: Validate minimum pack and index sizes in sync receiver to prevent flaky transfers

**Date:** 2026-08-17

## What changed and why

Issue #46 reported that `test/readme-claims.test.js` "README Claim 4: two processes converge through relay and recover company after process destruction" was flaky under full-suite concurrency (`--test-concurrency=2`). The error reported was:
`Error: readPackIndex: index file is too small (0 bytes, minimum 1072)`

Analysis revealed that in `runtime/sync/gitsync.js`, when a non-empty pack transfer is finalized upon receiving the `'done'` frame, the index buffer could previously be processed without explicit validation of minimum buffer sizes if the header announced 0 index bytes or if framing issues occurred.

We updated `handle(msg)` in `runtime/sync/gitsync.js` under the `'done'` frame handler to explicitly validate that any non-empty pack payload satisfies minimum pack size requirements (`pack.length >= 32`) and minimum index size requirements (`idx.length >= 1072`). If either check fails, a `SyncError` is thrown immediately with a clear diagnostic message, preventing truncated or 0-byte index payloads from being passed down to `readPackIndex`.

## Verification

The change was verified by:
1. Running the entire test suite via `npm test` (667 tests passing).
2. Running 10 consecutive executions of `node --test --test-concurrency=2 test/readme-claims.test.js`, with all runs completing with 100% pass rate.
