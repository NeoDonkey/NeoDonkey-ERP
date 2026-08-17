// test/compromises-structure.test.js — the register must be structurally consistent.
//
// The register (docs/COMPROMISES.md) is split into Part 1 (open entries) and Part 2 (closed
// entries). The summary table lists which entries are closed. A closed entry whose full section
// sits in Part 1 rather than Part 2 is invisible to anyone who reads Part 2 looking for what
// closed it — the exact failure that issue #31 caught. A closed entry missing from Part 2 means
// the summary points at nothing.
//
// These tests parse the file and assert the structural invariants that would have caught #4a's
// misplacement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const text = readFileSync(new URL('docs/COMPROMISES.md', root), 'utf8');
const lines = text.split('\n');

// Find the boundaries.
const part1Start = lines.findIndex((l) => /^# Part 1 — Open$/.test(l));
const part2Start = lines.findIndex((l) => /^# Part 2 — Closed$/.test(l));
assert.ok(part1Start >= 0, 'COMPROMISES.md has no "# Part 1 — Open" heading');
assert.ok(part2Start > part1Start, 'COMPROMISES.md has no "# Part 2 — Closed" heading after Part 1');

// Parse the summary table's closed list.
// Format: | **closed** | **N** | #1, #4b, ... (Part 2) |
const summaryLine = lines.find((l) => /\*\*closed\*\*/.test(l) && /\(Part 2\)/.test(l));
assert.ok(summaryLine, 'Cannot find the closed-entries summary row');
const closedCell = summaryLine.split('|')[3];  // fourth column
const closedEntries = closedCell
  .replace(/\(Part 2\)/, '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

test('every entry listed as closed has a ## section in Part 2', () => {
  const part2Lines = lines.slice(part2Start);
  const missing = [];
  for (const entry of closedEntries) {
    const re = new RegExp(`^## ${escapeRegex(entry)} —`);
    if (!part2Lines.some((l) => re.test(l))) {
      missing.push(entry);
    }
  }
  assert.deepEqual(missing, [],
    'These entries are listed as closed in the summary but have no ## section in Part 2:\n'
    + missing.map((e) => `  ${e}`).join('\n')
    + '\n\nA closed entry that is not in Part 2 is invisible to anyone who reads the closed '
    + 'section. Move it there and leave a pointer in Part 1 — see #15 rr4 for the pattern.');
});

test('no closed section with body exists in Part 1 (pointers only)', () => {
  const part1Lines = lines.slice(part1Start, part2Start);
  const offenders = [];
  for (let i = 0; i < part1Lines.length; i++) {
    const line = part1Lines[i];
    // Match ### or ## CLOSED headings in Part 1.
    if (/^#{2,3}\s+.*CLOSED/.test(line)) {
      // Collect the body: lines until the next heading or end of Part 1.
      const body = [];
      for (let j = i + 1; j < part1Lines.length; j++) {
        if (/^#{2,4}\s+/.test(part1Lines[j])) break;
        body.push(part1Lines[j]);
      }
      const bodyText = body.join('\n').trim();
      // A pointer stub is just "See Part 2 — Closed." and maybe a blank line.
      const isPointer = /^See Part 2/m.test(bodyText) && bodyText.split('\n').length <= 2;
      if (!isPointer) {
        offenders.push({
          heading: line.trim(),
          line: part1Start + i + 1,
        });
      }
    }
  }
  assert.deepEqual(offenders, [],
    'Closed sections with full body text in Part 1 (should be pointers to Part 2):\n'
    + offenders.map((o) => `  line ${o.line}: ${o.heading}`).join('\n')
    + '\n\nA full closed section in Part 1 is missed by anyone reading Part 2, and its entry in '
    + 'the summary points at Part 2 where it does not exist. Move the body to Part 2 and leave '
    + 'a "See Part 2 — Closed." pointer.');
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
