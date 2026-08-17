# Replace six-place hardcoded test count claims with test/suite-floor.txt

Closes #55.

## What changed

Previously, `README.md`, `AGENTS.md`, `docs/NEXT.md`, `docs/AUDIT.md`, `.github/pull_request_template.md`, and `.github/workflows/opencode-audit.yml` all had to state the exact test count matching `npm test`. Adding or removing a single test required updating all six files, causing PR merge conflicts between concurrent sessions adding tests.

We replaced this six-way prose coupling with a single floor file `test/suite-floor.txt` containing an integer (e.g. `660`).

- `.github/workflows/ci.yml` now asserts that the number of tests executed meets or exceeds the integer floor in `test/suite-floor.txt`.
- `test/documented-counts.test.js` enforces that no hardcoded test suite totals exist in the prose claimant documents and asserts that `test/suite-floor.txt` exists with a valid integer floor.
- Removed hardcoded test count numbers from `README.md`, `AGENTS.md`, `docs/NEXT.md`, `docs/AUDIT.md`, `.github/pull_request_template.md`, and `.github/workflows/opencode-audit.yml`.

## How verified

- Ran `node --test test/documented-counts.test.js` (passed 2/2 tests).
- Verified that adding a hardcoded test total to `README.md` causes `test/documented-counts.test.js` to fail loudly as expected.
- Verified that `test/suite-floor.txt` is present and valid.
