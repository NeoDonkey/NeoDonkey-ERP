// test/journal-hygiene.test.js — the journal must stay conflict-free under parallel sessions.
//
// The convention this guards, and why it is worth a test rather than a sentence in AGENTS.md:
//
// §9 used to say "add an entry at the top of docs/JOURNAL.md under today's date". Three Jules
// sessions run concurrently here and nothing in this repository rebases, so "at the top" meant
// every session edited the same lines of the same file and conflicted with every other one — not
// occasionally, always. Measured 2026-08-17: five of the previous six Jules pull requests touched
// both docs/JOURNAL.md and docs/NEXT.md. #28 and #29 both went CONFLICTING and sat unmergeable for
// two days.
//
// Then it happened to the pull request that fixed it. #47 merged while #43 was open, both touched
// those two files, and #43 became conflicted — at which point GitHub stopped creating any
// `pull_request` workflow runs for it, because it cannot compute a merge commit for a conflicting
// pull request. Zero checks, no review possible, and no error anywhere saying why. A conflict here
// does not just block a merge; it makes a change invisible to the whole loop.
//
// So entries are one file each. A session only ever creates a path no other session is writing.
// A prose convention would drift back within a week of nobody watching; this fails the build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const JOURNAL_DIR = new URL('docs/journal/', root);

/** `2026-08-17-close-the-review-loop.md` — date first so `ls -r` is newest-first. */
const ENTRY = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;

test('every journal entry is its own dated file, named so the directory sorts chronologically', () => {
  assert.ok(existsSync(JOURNAL_DIR),
    'docs/journal/ does not exist. Journal entries live there, one file each — see AGENTS.md §9. '
    + 'If it was deleted, the old single-file convention is back and with it the guaranteed '
    + 'conflict between concurrent sessions.');

  const bad = readdirSync(JOURNAL_DIR).filter((f) => f !== '.gitkeep' && !ENTRY.test(f));
  assert.deepEqual(bad, [],
    'These files in docs/journal/ are not named `YYYY-MM-DD-short-slug.md`:\n'
    + bad.map((f) => `  ${f}`).join('\n')
    + '\n\nThe date must come first so that `ls -r docs/journal/` reads newest-first, which is how '
    + 'anyone catches up on what happened. Lowercase and hyphens only — no spaces, no underscores, '
    + 'no capitals.');
});

test('docs/JOURNAL.md is the frozen archive and says where entries actually go', () => {
  const text = readFileSync(new URL('docs/JOURNAL.md', root), 'utf8');

  assert.match(text, /docs\/journal\//,
    'docs/JOURNAL.md no longer points at docs/journal/. It is the first place anyone looks for the '
    + 'log, so if it does not redirect, the next session appends here and reintroduces the conflict '
    + 'this split exists to remove.');

  // The archive stops at the changeover. A dated heading after it means somebody appended to the
  // old file, which is the exact regression this test is for — and it will have conflicted with
  // whoever else did the same thing.
  const headings = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})$/gm)].map((m) => m[1]);
  const late = headings.filter((d) => d > '2026-08-17');
  assert.deepEqual(late, [],
    `docs/JOURNAL.md has dated entries after the 2026-08-17 changeover: ${late.join(', ')}.\n`
    + 'That file is the archive and is not appended to. Move these into docs/journal/ as one file '
    + 'each — see AGENTS.md §9.');
});

test('AGENTS.md still instructs sessions to create a file rather than append', () => {
  // The test and the instruction have to agree, or agents follow the instruction and fail the
  // build. If §9 is reworded, this assertion is the reminder to reword it compatibly.
  const agents = readFileSync(new URL('AGENTS.md', root), 'utf8');
  assert.match(agents, /docs\/journal\/YYYY-MM-DD-short-slug\.md/,
    'AGENTS.md §9 no longer names the journal entry path that this test enforces. Whichever one is '
    + 'right, they must match: agents read AGENTS.md, and CI runs this file.');
});
