// test/checkout-hygiene.test.js — the source checkout must not be a NeoDonkey workspace.
//
// This has now happened twice.
//
//   1. During v0.1's UI work, something opened a workspace at the repository root and wrote a
//      genesis commit plus `article A-0001 created` into our own `.git`. Every source file showed
//      as untracked, HEAD pointed at "Sarah Weber starts a company", and nobody noticed for hours.
//   2. Again on 2026-08-04 at 00:05 — in the window between the `.neodonkey-dev` marker being
//      created and the kernel guard that reads it actually landing. Found days later, by an agent
//      doing something unrelated.
//
// The kernel guard works (test/s-integrity.test.js proves `open()` refuses a directory containing
// `.neodonkey-dev`, before writing anything). But a guard only protects the path that calls it, and
// both incidents were discovered by accident rather than by the suite. So this file closes the
// detection gap instead of the write gap: whatever the cause, the next occurrence fails a test in
// seconds rather than surviving until someone runs `git status` and squints.
//
// Note what this is NOT: it is not a claim that the runtime may never live beside the data.
// Appendix II says it should, and a real customer's folder legitimately holds `runtime/` next to
// `documents/`. This file is about *our development checkout*, identified by the marker no
// customer's folder carries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const at = (p) => new URL(p, root);
const git = (...args) => {
  try {
    return execFileSync('git', args, {
      cwd: new URL('.', root).pathname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return `__git-failed__ ${e.stderr ?? e.message}`;
  }
};

test('the checkout carries the dev marker that makes the kernel refuse it', () => {
  assert.ok(existsSync(at('.neodonkey-dev')),
    '.neodonkey-dev is what stops `open()` turning this checkout into a company. Deleting it does '
    + 'not make the repository tidier; it removes the only thing standing between a test run and '
    + 'our own git history.');
  const text = readFileSync(at('.neodonkey-dev'), 'utf8');
  assert.ok(text.length > 80, 'the marker explains itself to whoever finds it');
});

test('no workspace artifacts have been written into the checkout', () => {
  // These are what a NeoDonkey workspace looks like. Their presence at the repository root means
  // something opened a company here.
  for (const dir of ['documents', 'peers', 'crypto']) {
    assert.equal(existsSync(at(dir)), false,
      `${dir}/ exists at the repository root, which means a workspace was created in the source `
      + 'checkout. Preserve it somewhere outside the tree, delete it here, and find what wrote it — '
      + 'a test using nodeFs on the repo root, or a tool defaulting to cwd.');
  }
  assert.equal(existsSync(at('neodonkey.json')), false,
    'neodonkey.json is a workspace settings file, written once at genesis. At the repository root '
    + 'it means genesis ran here.');
});

test('our git history has not been hijacked by a genesis commit', () => {
  const log = git('log', '--format=%s', '-n', '40');
  if (log.startsWith('__git-failed__')) return;   // no commits yet, or no git: nothing to hijack

  // The kernel's own genesis and transaction messages. If one of these is in *our* history, a
  // workspace was committed into the source repository.
  const fingerprints = [
    /starts a company/i,
    /^NeoDonkey-Genesis:/m,
    /^NeoDonkey-Transaction:/m,
  ];
  for (const re of fingerprints) {
    assert.equal(re.test(log), false,
      `the commit log matches ${re}, which is a NeoDonkey workspace commit rather than a source `
      + `change. History:\n${log.split('\n').slice(0, 8).join('\n')}`);
  }
});

test('.gitignore keeps workspace artifacts out even if one is written', () => {
  const ignore = readFileSync(at('.gitignore'), 'utf8');
  // Belt as well as braces: if something does write a workspace here, it must at least not end up
  // committed by a human running `git add -A`.
  for (const pattern of ['documents/', 'peers/', 'neodonkey.json']) {
    assert.ok(ignore.includes(pattern),
      `.gitignore should list ${pattern} — the second hijack was only visible because git reported `
      + 'the whole tree as untracked, and a partially-ignored workspace would have been quieter.');
  }
});

test('no source file is accidentally binary — a NUL byte hides code from grep and review', () => {
  // Agent ATOM found two runtime files using a literal NUL as a map-key separator. `grep`,
  // `git grep` and most editors then treat the file as binary, so earlier searches over those
  // files silently found nothing — including searches for the very constructs we forbid. A file
  // that cannot be grepped cannot be reviewed, and cannot be checked by our own source guards.
  // Written as an escape, not a literal, or this file would flag itself — which it did on the
  // first run, and is a neat demonstration of why a literal NUL in source is a bad idea.
  const NUL = String.fromCharCode(0);
  const offenders = [];
  const walk = (rel) => {
    for (const e of readdirSync(at(rel), { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = `${rel}${e.name}`;
      if (e.isDirectory()) walk(`${p}/`);
      else if (/\.(js|mjs|md|json|html|css)$/.test(e.name)) {
        if (readFileSync(at(p), 'utf8').includes(NUL)) offenders.push(p);
      }
    }
  };
  for (const dir of ['runtime/', 'test/', 'mcp/', 'demo/', 'release/', 'docs/']) walk(dir);
  assert.deepEqual(offenders, [],
    'these files contain a literal NUL. Use 0x1F as a separator instead — same guarantee, and the '
    + 'file stays greppable by humans and by our own guards.');
});
