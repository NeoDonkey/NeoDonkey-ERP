// test/verfahrensdok.test.js — the GoBD Verfahrensdokumentation exists, cites only real code,
// and covers what gate condition 8 says it must cover.
//
// docs/VERFAHRENSDOKUMENTATION.md is the written answer set for a German tax audit
// (Betriebsprüfung). An answer that cites a file which does not exist is worse than no answer:
// it tells the auditor the document drifted from the code. So this test treats the document as
// a citation graph and re-verifies it on every run. It fails if the document is missing, if any
// cited repo path is missing, or if a required section, pillar term or primary-source paragraph
// disappears.
//
// Style follows test/audit-location-citations.test.js. Zero dependencies; Node native runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/VERFAHRENSDOKUMENTATION.md';

/** Repo-relative paths the document is allowed to cite (same shape as audit-location-citations). */
const PATH_RE = /\b(?:runtime|operating-model|templates|test|docs|demo|release|mcp)\/[a-zA-Z0-9_./-]+\.(?:js|mjs|json|md)\b/g;

/** The four GoBD § 9.1 mandatory sections, by the names the document must use. */
const SECTIONS_9_1 = ['Anwendungsbereich', 'Anwendersystem', 'Internes Kontrollsystem', 'Datensicherheit'];

/** The four GoBD pillars, each with at least one primary-source paragraph that must be cited
 * inside that pillar's own section of the document (GoBD BMF-Schreiben 28.11.2019). */
const PILLARS = [
  { term: 'Nachvollziehbarkeit', paragraph: '3.2.1' },
  { term: 'Unveränderbarkeit', paragraph: '3.2.4' },
  { term: 'Vollständigkeit', paragraph: '3.2.2' },
  { term: 'Zeitgerechtigkeit', paragraph: '3.2.3' },
];

function readDoc() {
  const abs = join(REPO, DOC);
  assert.ok(existsSync(abs),
    `${DOC} is missing. Gate condition 8 requires it; see `
    + 'docs/decisions/2026-08-20-gobd-verfahrensdokumentation-and-auditor-verification.md.');
  return readFileSync(abs, 'utf8');
}

test('the Verfahrensdokumentation exists and is non-trivial', () => {
  const text = readDoc();
  assert.ok(text.length > 4000,
    `${DOC} is only ${text.length} characters; a GoBD § 9.1 document with four pillar mappings `
    + 'cannot be that short. Restoring a stub is not restoring the document.');
});

test('every repo-relative code/test path cited in the Verfahrensdokumentation exists on disk', () => {
  const text = readDoc();
  const cited = [...new Set(text.match(PATH_RE) ?? [])];
  assert.ok(cited.length >= 15,
    `expected at least 15 distinct code/test citations in ${DOC}, found ${cited.length}. `
    + 'A Verfahrensdokumentation without line-level code cross-references does not answer the '
    + 'auditor, it describes marketing.');

  const missing = cited.filter((p) => !existsSync(join(REPO, p)));
  assert.deepEqual(missing, [],
    `${DOC} cites paths that do not exist on disk:\n`
    + missing.map((p) => `  ${p}`).join('\n')
    + '\nFix the citation or restore the file; an auditor following a dead citation concludes the '
    + 'document is unmaintained.');
});

test('the document covers the four GoBD § 9.1 mandatory sections by name', () => {
  const text = readDoc();
  for (const section of SECTIONS_9_1) {
    assert.ok(text.includes(section),
      `${DOC} does not name "${section}". GoBD § 9.1 (Abs. 151-155) makes this section mandatory; `
      + 'an auditor checks for it by name.');
  }
});

test('the document covers the four GoBD pillars, each with its primary-source paragraph', () => {
  const text = readDoc();
  const lines = text.split('\n');

  for (const { term, paragraph } of PILLARS) {
    const headingIdx = lines.findIndex((l) => /^#{2,4}\s/.test(l) && l.includes(term));
    assert.ok(headingIdx !== -1,
      `${DOC} has no heading naming the pillar "${term}". Gate condition 8 requires all four: `
      + 'Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit.');

    // The pillar's own section: from its heading to the next heading of the same or higher level.
    const level = headingIdx !== -1 ? (lines[headingIdx].match(/^#+/)?.[0].length ?? 3) : 3;
    let end = lines.length;
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const m = /^(#+)\s/.exec(lines[i]);
      if (m && m[1].length <= level) { end = i; break; }
    }
    const section = lines.slice(headingIdx, end).join('\n');

    assert.ok(section.includes(paragraph),
      `The "${term}" section of ${DOC} does not cite GoBD § ${paragraph}. Every pillar must cite `
      + 'at least one primary-source paragraph (GoBD BMF-Schreiben 28.11.2019), per the binding '
      + 'decision record docs/decisions/2026-08-20-gobd-verfahrensdokumentation-and-auditor-verification.md.');
  }
});

test('the document answers where the signing key lives, and names its honest limits', () => {
  const text = readDoc();

  // Gate condition 8 explicitly includes "where the signing key lives".
  assert.ok(text.includes('Where the Signing Key Lives'),
    `${DOC} must contain a section answering where the signing key lives (gate condition 8).`);
  assert.ok(text.includes('runtime/identity/keystore.js'),
    `${DOC} must cite runtime/identity/keystore.js for business identity key storage.`);

  // Trust-on-first-use and the unpublished release key must be stated, not implied, and the
  // register entry must be cited by path.
  assert.ok(/trust on first use/i.test(text),
    `${DOC} must state plainly that first install is trust on first use.`);
  assert.ok(text.includes('docs/COMPROMISES.md'),
    `${DOC} must cite docs/COMPROMISES.md for the open release-key residual risk (entry #15 rr7).`);
});
