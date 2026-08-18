# Atomic File Writes in `nodeFs` to Fix Flaky Pack Index Reads (#46)

**Date:** 2026-08-17

## What Changed

Updated `runtime/git/fs-node.js` so that `write(path, data)` performs atomic writes by writing to a unique temporary file (`${target}.tmp.${process.pid}.${rand}`) in the target directory and renaming it to the target destination. If an error occurs during write or rename, the temporary file is removed in a `catch` block before rethrowing.

Added unit test coverage in `test/a-git.test.js` asserting that `nodeFs` writes atomically, overwrites existing files correctly, and cleans up temporary files on failure.

Updated `docs/NEXT.md` to remove the flaky test note for issue #46, as the queue item is now resolved.

## Why

In `test/readme-claims.test.js`, running the full test suite under concurrency (`--test-concurrency=2`) intermittently failed with:
`Error: readPackIndex: index file is too small (0 bytes, minimum 1072)`.

This race occurred because non-atomic `writeFile` calls created or truncated destination `.idx` files before flushing contents, leaving a brief window where concurrent readers observed 0-byte `.idx` files. Making `nodeFs.write()` atomic eliminates this race window entirely.

## Verification

1. `npm test` passed cleanly with 0 failures across all 670 tests.
2. Executed 10 consecutive full-suite runs of `node --test --test-concurrency=2 test/readme-claims.test.js` with 0 failures.
3. Added `test/a-git.test.js` test for `fs-node.js` atomic write and cleanup behavior.
