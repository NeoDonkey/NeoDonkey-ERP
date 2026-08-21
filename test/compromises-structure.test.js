// test/compromises-structure.test.js — the register must be structurally consistent.
//
// The register (docs/COMPROMISES.md) is split into Part 1 (open entries) and Part 2 (closed
// entries). The summary table lists which entries are closed. A closed entry whose full section
// sits in Part 1 rather than Part 2 is invisible to anyone who reads Part 2 looking for what
// closed it — the exact failure that issue #31 caught. A closed entry missing from Part 2 means
// the summary points at nothing.
//
// These tests parse the file and assert the structural invariants that would have caught #4a's
// misplacement. The register-hygiene checks (headline counts, entry coverage, no duplicates)
// were added from issue #34; the closed-cell-count check additionally guards the defect found
// in review of #88 itself — a summary row whose count cell disagreed with its own list.

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
const closedCountCell = summaryLine.split('|')[2]; // third column: the count
const closedCell = summaryLine.split('|')[3];      // fourth column: the entry list
const closedCellCount = Number(closedCountCell.replace(/\*\*/g, '').match(/(\d+)/)[1]);
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

// --- Register hygiene (from issue #34) ---

// Parse the summary headline: "23 open entries. 12 closed."
const headlineLine = lines.findIndex((l) => /\*\*\d+ open entries\.\s*\d+ closed\.\*\*/.test(l));
assert.ok(headlineLine >= 0, 'Cannot find the summary headline with open/closed counts');
const headlineMatch = lines[headlineLine].match(/\*\*(\d+) open entries\.\s*(\d+) closed\.\*\*/);
assert.ok(headlineMatch, 'Summary headline does not match expected format');
const headlineOpen = Number(headlineMatch[1]);
const headlineClosed = Number(headlineMatch[2]);

// Find the summary table rows (between headline and the next non-table line).
// The summary table header contains "Category", "Open", and "Entries".
const headerIdx = lines.findIndex((l) => /^\|.*Category.*Open.*Entries/.test(l));
assert.ok(headerIdx >= 0, 'Cannot find the summary table header row');
let tableEnd = headerIdx + 1;
while (tableEnd < lines.length && /^\|/.test(lines[tableEnd])) {
  tableEnd++;
}
const summaryTableLines = lines.slice(headerIdx + 1, tableEnd); // skip header row

// Separate open-category rows from the closed row.
// Open rows: | category | count | entries |
// Closed row: | **closed** | **N** | #1, #4b, ... (Part 2) |
const openCategoryRows = summaryTableLines.filter((l) => !/\*\*closed\*\*/.test(l)
  && !/^\|\s*-{2,}/.test(l) && !/^\|\s*Category/.test(l));

// Parse each open category's count and entry list.
const openEntries = [];
for (const row of openCategoryRows) {
  const cell = row.split('|')[3]; // fourth column (entries)
  if (!cell) continue;
  const ids = cell.split(',').map((s) => s.trim()).filter(Boolean);
  for (const id of ids) {
    // Skip residual risk notes like "#15 residual risk 7" — sub-entries of #15.
    if (id.startsWith('#') && !id.includes('residual')) openEntries.push(id);
    if (id.startsWith('FD-')) openEntries.push(id);
  }
}

// Extract Part 1 ## entry IDs (not ### sub-entries like #4a or #4c which are under ## #4).
// Captures everything between "## " and " —" to handle multi-word IDs like "#15 rr4".
const p1Lines = lines.slice(part1Start, part2Start);
const part1Entries = [];
for (const line of p1Lines) {
  const m = line.match(/^## (.+?) —/);
  if (m) part1Entries.push(m[1]);
}

// Extract Part 2 ## entry IDs.
const p2Lines = lines.slice(part2Start);
const part2Entries = [];
for (const line of p2Lines) {
  const m = line.match(/^## (.+?) —/);
  if (m) part2Entries.push(m[1]);
}

test('headline open count matches the sum of open category counts', () => {
  const tableSum = openCategoryRows.reduce((acc, row) => {
    // The count is the second column. It may be bold: **0** or plain: 13.
    const cell = row.split('|')[2];
    if (!cell) return acc;
    const num = cell.replace(/\*\*/g, '').match(/(\d+)/);
    return acc + (num ? Number(num[1]) : 0);
  }, 0);
  assert.equal(tableSum, headlineOpen,
    `Summary table open categories sum to ${tableSum} but headline says ${headlineOpen}`);
});

test('headline closed count matches the summary closed entry list', () => {
  assert.equal(closedEntries.length, headlineClosed,
    `Summary closed list has ${closedEntries.length} entries but headline says ${headlineClosed}`);
});

test('summary closed cell count matches the listed closed IDs', () => {
  // The headline check above compares the list against the headline; this one compares the
  // closed row against itself. A row that says **11** while listing 12 IDs passes both of
  // those checks whenever the headline agrees with the cell — that exact defect shipped in
  // the first version of these guards (#88), so it gets its own assertion.
  assert.equal(closedEntries.length, closedCellCount,
    `Summary closed row lists ${closedEntries.length} entries but its count cell says `
    + `${closedCellCount}. The cell, the list, and the headline must all agree.`);
});

test('every Part 2 entry is listed in the summary closed list', () => {
  const missing = [];
  for (const entry of part2Entries) {
    if (!closedEntries.includes(entry)) missing.push(entry);
  }
  assert.deepEqual(missing, [],
    'These entries have a ## section in Part 2 but are not in the summary closed list:\n'
    + missing.map((e) => `  ${e}`).join('\n')
    + '\n\nEvery closed entry must appear in the summary. Either add it to the closed list '
    + 'or move it to Part 1 if it is not actually closed.');
});

test('no entry appears in both Part 1 and Part 2 as a real section', () => {
  const dupes = part1Entries.filter((e) => part2Entries.includes(e));
  assert.deepEqual(dupes, [],
    'These entries appear in both Part 1 and Part 2:\n'
    + dupes.map((e) => `  ${e}`).join('\n')
    + '\n\nA closed entry should not have a real section in Part 1. Remove the Part 1 section '
    + 'and keep only the full entry in Part 2.');
});

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
