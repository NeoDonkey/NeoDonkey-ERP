// test/documented-counts.test.js — the suite size this repository claims must be one number.
//
// The most-reported and least-fixed defect in this project's history. Between 2026-08-13 and
// 2026-08-17 the audit lane found it, verified it by execution, and filed it eleven times:
// issues #13, #15, #16, #18, #19, #21, #24, #25, #37, #39 and #41. Every report was correct.
// None of them landed, so each run rediscovered it and the number drifted further:
//
//     README.md said 641          AGENTS.md said 641        the PR template said 641
//     docs/NEXT.md said 658       docs/AUDIT.md said 658    the audit workflow said 641
//     the suite actually ran      661
//
// Three separate wrong answers and one right one, in a repository whose stated rule is that a
// claim a document makes must be checked against the code rather than believed.
//
// Why it drifted at all: `test/*.test.js` is a glob, so adding a file changes the total, and
// nothing anywhere compared the total to the prose. A stray instrumented duplicate of
// checkout-hygiene.test.js — `test/_probe.test.js`, five of those 661 — was being counted as
// real coverage the whole time.
//
// The check is split in two, because neither half can do the other's job:
//
//   - This file compares the documents with each other. It is static, runs in milliseconds,
//     and catches the common case: someone updates one document and forgets the rest.
//   - `.github/workflows/ci.yml` compares the documented number with the number the suite
//     actually ran. Only CI can do that — a test cannot know the total of the run it is part
//     of without recursing into it.
//
// Adding a test therefore fails CI until the documents are corrected. That is the intent, and
// it is cheaper than it sounds: the failure message names every file to edit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);

// Files that state the *current* size of the suite. Every one of these is read by somebody
// deciding whether their run was complete, so all of them have to say the same thing.
//
// Deliberately absent: docs/JOURNAL.md and docs/COMPROMISES.md. Those record what was true on
// a given date — "all 642 tests passing, 2026-08-12" is a dated observation, not a live claim,
// and rewriting history to match today's total would destroy the only evidence those entries
// carry. If you are tempted to add them here, you are about to falsify a record.
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

test('every document that states the suite size states the same size', () => {
  const claims = CLAIMANTS.flatMap((file) => claimsIn(file).map((c) => ({ ...c, file })));

  assert.ok(claims.length > 0,
    'No file in CLAIMANTS states a suite size any more. Either the claims were removed — in '
    + 'which case delete this test, because a guard over nothing gives false confidence — or '
    + 'the phrasing changed and the CLAIM pattern no longer matches it.');

  const counts = [...new Set(claims.map((c) => c.count))];
  assert.equal(counts.length, 1,
    'The documents disagree about how many tests this suite has:\n'
    + claims.map((c) => `  ${c.file}:${c.line} says ${c.count}`).join('\n')
    + '\n\nRun `node --test --test-concurrency=2 "test/*.test.js"` and set every line above to '
    + 'the number it reports. This drift was reported eleven times before it was fixed; the '
    + 'cost of it is that nobody can tell a partial run from a complete one.');
});

test('the documented suite size is not a stale number left over from a deletion', () => {
  // A weaker but independent check: the number must be at least the number of test files,
  // since each contributes at least one test. Catches the specific failure of deleting test
  // files and leaving the total alone, which is how 637/638 got into issue #16.
  const files = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  assert.match(files, /test\/\*\.test\.js/,
    'ci.yml no longer runs the suite by glob, so the reasoning behind this guard — that adding '
    + 'a file silently changes the total — may no longer hold. Re-read both halves of the check.');

  const [{ count }] = claimsIn('README.md');
  assert.ok(count >= 100 && count < 10000,
    `README.md claims ${count} tests, which is not a plausible size for this suite. `
    + 'A digit was probably lost or gained in an edit.');
});
