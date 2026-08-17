// test/known-flaky.test.js — the quarantine list must stay small, justified and temporary.
//
// `test/known-flaky.txt` lets CI pass when the only failing tests are named in it. That is a
// real compromise and it buys something real: `test` is a required check, so a test failing one
// run in eight blocks every pull request in the queue for a reason no agent can reproduce, and
// nothing in this repository presses re-run. #29 was stopped by exactly that on 2026-08-17 —
// correct work, clean review, failed on the #46 relay flake.
//
// The danger is obvious. A list like this decays into the place failures go to be forgotten, and
// then the suite is decorative. So the list is bounded by tests rather than by good intentions:
// every entry names an open issue, and there are at most three. Removing an entry is always fine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const RAW = readFileSync(new URL('test/known-flaky.txt', root), 'utf8');

/** The patterns CI actually matches against — comments and blanks removed. */
const entries = RAW.split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

const MAX = 3;

test('the quarantine list stays small enough to be temporary', () => {
  assert.ok(entries.length <= MAX,
    `test/known-flaky.txt has ${entries.length} entries; the limit is ${MAX}.\n`
    + entries.map((e) => `  ${e}`).join('\n')
    + '\n\nA fourth flake is not a fourth line here — it is a suite worth stopping for. Fix one '
    + 'before quarantining another, or the suite stops meaning anything and CI becomes a '
    + 'formality that agents learn to route around.');
});

test('every quarantined test names the open issue that will remove it', () => {
  // The exit path is what separates a recorded compromise from a swept-under-the-rug one.
  // AGENTS.md: the only real failure mode this project has is a compromise that is not written
  // down. A pattern with no issue behind it is exactly that.
  assert.match(RAW, /#\d+/,
    'test/known-flaky.txt names no issue. Every quarantined test must cite the open issue that '
    + 'explains why it is flaky and what would close it — otherwise nobody knows whether it is '
    + 'still needed, and it stays for ever by default.');

  if (entries.length > 0) {
    assert.match(RAW, /docs\/COMPROMISES\.md/,
      'test/known-flaky.txt does not point at docs/COMPROMISES.md. Quarantining a test is a '
      + 'compromise and belongs in the register with a category, a cost and an exit path.');
  }
});

test('the quarantine cannot silently match every test', () => {
  // A short or empty pattern would forgive an entire red suite. `""` matches everything;
  // so does a single character in practice. This is the assertion that stops a well-meant
  // "just for tonight" edit from disabling the whole gate.
  for (const e of entries) {
    assert.ok(e.length >= 8,
      `The quarantine pattern ${JSON.stringify(e)} is ${e.length} characters. CI matches these `
      + 'as substrings against failing test names, so a short pattern can forgive unrelated '
      + 'failures — and a very short one forgives all of them. Name the test.');
  }
});
