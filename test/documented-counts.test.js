// test/documented-counts.test.js — the suite size must not be hardcoded in documentation.
//
// Replaces exact test-count matching across multiple documents with a single floor file
// (test/suite-floor.txt). This prevents concurrent test-adding PRs from conflicting while
// maintaining a strict guard against accidental test deletions or broken test runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);

// Files that used to state exact test suite numbers in prose.
// None of these should state an exact hardcoded test count any longer.
const CLAIMANTS = [
  'README.md',
  'AGENTS.md',
  'docs/NEXT.md',
  'docs/AUDIT.md',
  '.github/pull_request_template.md',
  '.github/workflows/opencode-audit.yml',
];

// "641 tests", "658 tests with 2 skipped", "— 661 tests, about 30 seconds". Three digits at
// least, so version numbers and line counts do not register as suite sizes.
const CLAIM = /\b(\d{3,5})\s+tests\b/g;

/** Every suite-size claim in a file, as {count, line}. */
function claimsIn(file) {
  const text = readFileSync(new URL(file, root), 'utf8');
  const found = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CLAIM)) found.push({ count: Number(m[1]), line: i + 1 });
  });
  return found;
}

test('no document states a hardcoded exact suite size in prose', () => {
  const claims = CLAIMANTS.flatMap((file) => claimsIn(file).map((c) => ({ ...c, file })));

  assert.equal(claims.length, 0,
    'Hardcoded test suite totals were found in documentation files:\n'
    + claims.map((c) => `  ${c.file}:${c.line} says ${c.count}`).join('\n')
    + '\n\nExact test suite totals in prose cause PR merge conflicts whenever tests are added. '
    + 'Remove the hardcoded test count from prose and rely on test/suite-floor.txt instead.');
});

test('test/suite-floor.txt exists and contains a valid integer floor', () => {
  const floorUrl = new URL('suite-floor.txt', import.meta.url);
  assert.ok(existsSync(floorUrl), 'test/suite-floor.txt must exist');

  const text = readFileSync(floorUrl, 'utf8').trim();
  const floor = Number(text);

  assert.ok(Number.isInteger(floor), 'test/suite-floor.txt must contain a valid integer');
  assert.ok(floor >= 100 && floor <= 10000, `suite floor ${floor} is out of plausible bounds (100..10000)`);
});
