// test/site-citations.test.js — the site and its shell must not cite what does not exist.
//
// Why this exists. Between 2026-08-04 and 2026-08-21, nine shipped files cited
// `docs/_compromise-ui.md` — a document that had never been committed. The references sat in
// index.html's boot-failure screen, in serve.mjs's header, and in five runtime/ui modules: read
// by exactly the person standing in front of a blank page, looking for the write-up they were
// promised. Nothing failed loudly, because a comment is not an import and no loader checks it.
//
// So the rule here mirrors test/wired.test.js, applied to prose instead of modules: a path a
// shipped file names as a document is either real, or the build is red. Illustrative examples
// ("add operating-model/information/anything.md and reload") are out of scope on purpose — this
// guard judges `docs/` references, which are always pointers, never examples.
//
// Owner: audit lane. Zero dependencies. `node --test test/site-citations.test.js`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = (p) => new URL(`../${p}`, import.meta.url);

/** The shipped surfaces whose prose a stranded reader actually sees. */
const SHELL_FILES = [
  'index.html',
  'manifest.webmanifest',
  'service-worker.js',
  'serve.mjs',
  'relay.mjs',
];

function uiModules() {
  return readdirSync(repo('runtime/ui'))
    .filter((n) => n.endsWith('.js'))
    .map((n) => `runtime/ui/${n}`);
}

/**
 * Every `docs/…` reference in a file, punctuation-trimmed. Only `docs/` is judged: a docs path
 * in prose is a pointer by nature, whereas `operating-model/…` strings in these files are often
 * illustrative examples or embedded starter-model keys, which this test must not police.
 */
function docCitations(relFile) {
  const text = readFileSync(repo(relFile), 'utf8');
  const found = new Set();
  for (const m of text.matchAll(/docs\/[A-Za-z0-9_.\-/]+/g)) {
    let p = m[0];
    while (/[.\-]$/.test(p)) p = p.slice(0, -1);
    if (p !== 'docs/') found.add(p);
  }
  return [...found];
}

test('every docs/ path cited by the shell and the UI modules exists on disk', () => {
  const missing = [];
  for (const file of [...SHELL_FILES, ...uiModules()]) {
    for (const p of docCitations(file)) {
      if (!existsSync(repo(p))) missing.push(`${file} -> ${p}`);
    }
  }
  assert.deepEqual(missing, [],
    'shipped files cite documents that do not exist. A reader following them hits a dead end. ' +
    'Create the document, or repoint the citation — but do not leave a promise the repo breaks.');
});

test('the launcher scripts index.html names are really in the folder', () => {
  // index.html's file:// screen tells a stranded user to double-click these. If one is renamed,
  // the error page's instructions become the second dead end of their day.
  const named = ['Start NeoDonkey.command', 'Start NeoDonkey.bat', 'start-neodonkey.sh', 'serve.mjs'];
  const html = readFileSync(repo('index.html'), 'utf8');
  const absent = named.filter((f) => !html.includes(f));
  assert.deepEqual(absent, [], 'index.html no longer names these launchers; update this test');

  const missing = named.filter((f) => !existsSync(repo(f)));
  assert.deepEqual(missing, [], 'index.html sends users to files that are not in the repository');
});

test('serve.mjs only ever reads files, as its own header claims', () => {
  const src = readFileSync(repo('serve.mjs'), 'utf8');
  assert.match(src, /from 'node:http'/, 'serve.mjs must be the node:http origin it claims to be');
  assert.match(src, /createReadStream/, 'serving is reading');
  assert.doesNotMatch(src,
    /\b(writeFile|writeFileSync|createWriteStream|appendFile|unlink|rmdir|rm\(|truncate|chmod|rename|copyFile|mkdtemp)\b/,
    'serve.mjs claims to have "no opinion" and only read files — a write call would make that false');
});
