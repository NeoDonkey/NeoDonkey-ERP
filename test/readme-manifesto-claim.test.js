// test/readme-manifesto-claim.test.js — the README must describe the manifesto as it is.
//
// README.md's documentation table describes neodonkey-manifesto.md as "The constitution.
// Eleven principles, twelve appendices." Both numbers are countable facts about a file in the
// same tree, and prose counts drift exactly the way suite totals did (#55, #64): add a twelfth
// principle or a thirteenth appendix and the sentence becomes false with nothing to catch it.
// These tests pin the sentence to the document it describes.
//
// Owner: docs/tests lane. Zero dependencies. `node --test test/readme-manifesto-claim.test.js`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const manifesto = readFileSync(new URL('neodonkey-manifesto.md', root), 'utf8');

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function wordToNumber(word) {
  const w = word.toLowerCase();
  if (WORD_NUMBERS[w] !== undefined) return WORD_NUMBERS[w];
  if (/^\d+$/.test(w)) return Number(w);
  return NaN;
}

/** The sentence this file guards. Kept loose enough for digits ("11 principles") too. */
const CLAIM = /([A-Za-z]+)\s+principles?,\s+([A-Za-z]+)\s+appendices/i;

/** The text between a top-level heading and the next one, or null if absent. */
function sectionUnder(text, headingRegex) {
  const start = text.search(headingRegex);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Principles are the bold-numbered paragraphs (**1. … **11. …) of the principles section. */
function actualPrinciples(text) {
  const section = sectionUnder(text, /^## [^\n]*Principles[^\n]*$/m);
  if (section === null) return null;
  const numbered = [...section.matchAll(/^\*\*(\d+)\./gm)].map((m) => Number(m[1]));
  return numbered.length === 0 ? 0 : Math.max(...numbered);
}

/** Appendices are top-level headings of the form "## Appendix …". */
function actualAppendices(text) {
  return [...text.matchAll(/^## Appendix\b/gm)].length;
}

test('the README states how many principles and appendices the manifesto has', () => {
  assert.match(readme, CLAIM,
    'README.md no longer describes neodonkey-manifesto.md by its principle and appendix '
    + 'counts. If that sentence was reworded or removed on purpose, update or retire this '
    + 'test in the same change.');
});

test('the README principle and appendix counts match the manifesto document', () => {
  const claimed = CLAIM.exec(readme);
  const principles = actualPrinciples(manifesto);
  const appendices = actualAppendices(manifesto);

  assert.ok(principles !== null && principles > 0,
    'no numbered bold paragraphs found under a "## … Principles" heading in '
    + 'neodonkey-manifesto.md; the counting rule in this test no longer fits the document.');
  assert.ok(appendices > 0,
    'no "## Appendix" headings found in neodonkey-manifesto.md; the counting rule in this '
    + 'test no longer fits the document.');

  const claimedPrinciples = wordToNumber(claimed[1]);
  const claimedAppendices = wordToNumber(claimed[2]);
  assert.ok(!Number.isNaN(claimedPrinciples),
    `"${claimed[1]}" in README.md is not a count this test can read`);
  assert.ok(!Number.isNaN(claimedAppendices),
    `"${claimed[2]}" in README.md is not a count this test can read`);

  assert.equal(claimedPrinciples, principles,
    `README.md says the manifesto has ${claimed[1].toLowerCase()} principles but `
    + `neodonkey-manifesto.md numbers ${principles}. The constitution grew or shrank: `
    + 'update the README sentence (and the manifesto heading) in the same change.');
  assert.equal(claimedAppendices, appendices,
    `README.md says the manifesto has ${claimed[2].toLowerCase()} appendices but `
    + `neodonkey-manifesto.md carries ${appendices}. Update the README sentence in the `
    + 'same change.');
});
