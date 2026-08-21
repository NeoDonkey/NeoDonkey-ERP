# 2026-08-21 Fix normalizeSealedTable in readSettings

## What changed

Defined `normalizeSealedTable` in `runtime/kernel.js` to canonicalize `sealed` configuration tables (sorting entity keys and group lists). This fixes finding F-2 from the 2026-08-21 security red-team report (`docs/security-redteam-2026-08-21.md`).

Previously, `readSettings` in `runtime/kernel.js` attempted to call `normalizeSealedTable(...)`, but the function was undefined, causing `open()` on a sealed workspace with a `sealed` option to throw `ReferenceError: normalizeSealedTable is not defined`.

Added unit tests in `test/security-fixes-2026-08-21.test.js` verifying that reopening a workspace with equivalent sealed tables in different key/group order succeeds, while refusing tables that disagree with recorded settings.

Closes #139.
