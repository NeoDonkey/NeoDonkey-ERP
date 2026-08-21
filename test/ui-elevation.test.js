// test/ui-elevation.test.js - the keyboard state machine and the token layer, pinned.
//
// Two things the 2026-08-21 UI elevation added that are testable without a browser:
//
//   1. keys.js, the pure keyboard-navigation state machine behind roving tabindex in tables
//      (arrows move, Enter opens, Escape leaves). Views apply its answers to the DOM; the
//      decisions themselves are tested here.
//   2. tokens.css, the single file every visual decision lives in. Not a snapshot of the CSS,
//      just the invariants that keep the design system a system: the tokens exist, the accent
//      is the one accent, no webfonts sneak in, motion has a single off switch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { isActivate, isEscape, moveCursor } from '../runtime/ui/keys.js';

const REPO = new URL('../', import.meta.url);
const repoPath = (rel) => fileURLToPath(new URL(rel, REPO));

// ---------------------------------------------------------------------------------------------
// 1. the keyboard state machine
// ---------------------------------------------------------------------------------------------

test('arrow keys move the cursor one row, clamped at both ends', () => {
  assert.equal(moveCursor('ArrowDown', 0, 5), 1);
  assert.equal(moveCursor('ArrowUp', 3, 5), 2);
  // a ledger is a document, not a carousel: no wraparound at the edges
  assert.equal(moveCursor('ArrowUp', 0, 5), 0);
  assert.equal(moveCursor('ArrowDown', 4, 5), 4);
  // left and right move too, so the same handler serves any linear control
  assert.equal(moveCursor('ArrowRight', 1, 5), 2);
  assert.equal(moveCursor('ArrowLeft', 1, 5), 0);
});

test('Home and End jump, Page keys leap, everything else is not ours', () => {
  assert.equal(moveCursor('Home', 7, 40), 0);
  assert.equal(moveCursor('End', 0, 40), 39);
  assert.equal(moveCursor('PageDown', 0, 40), 10);
  assert.equal(moveCursor('PageUp', 5, 40), 0);
  assert.equal(moveCursor('PageDown', 35, 40), 39);

  // keys the view must leave alone: typing in a filter, Tab for focus, letters
  assert.equal(moveCursor('Tab', 2, 5), null);
  assert.equal(moveCursor('a', 2, 5), null);
  assert.equal(moveCursor('Enter', 2, 5), null);
  // a degenerate table answers nothing rather than throwing
  assert.equal(moveCursor('ArrowDown', 0, 0), null);
  assert.equal(moveCursor('ArrowDown', Number.NaN, 3), 1, 'a lost cursor restarts at the top');
});

test('Enter activates and Escape leaves; Space keeps its native meaning', () => {
  assert.equal(isActivate('Enter'), true);
  assert.equal(isActivate(' '), false, 'Space scrolls a table; it must not open a row');
  assert.equal(isActivate('ArrowDown'), false);
  assert.equal(isEscape('Escape'), true);
  assert.equal(isEscape('Esc'), false, 'the DOM key value is the full word');
});

// ---------------------------------------------------------------------------------------------
// 2. the token layer
// ---------------------------------------------------------------------------------------------

const REQUIRED_TOKENS = [
  // the one accent and its readable forms
  '--accent', '--accent-ink', '--accent-text',
  // paper, ink, rules
  '--paper', '--paper-1', '--paper-2', '--paper-3', '--ink', '--ink-2', '--ink-3',
  '--rule', '--rule-2',
  // semantics
  '--warn', '--warn-bg', '--bad', '--bad-bg', '--ok', '--ok-bg',
  // the spacing scale, all eight steps
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8',
  // the type scale
  '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl',
  // radii, elevation, motion
  '--radius-sm', '--radius', '--radius-lg', '--shadow-1', '--shadow-2',
  '--dur-fast', '--dur', '--dur-slow', '--ease',
  // system font stacks only
  '--mono', '--sans',
];

test('tokens.css declares the whole vocabulary, with the one accent', async () => {
  const css = await readFile(repoPath('runtime/ui/tokens.css'), 'utf8');
  for (const token of REQUIRED_TOKENS) {
    assert.ok(css.includes(`${token}:`), `tokens.css does not declare ${token}`);
  }
  // The accent is #3DD8F5, and it is declared exactly once: everywhere else references the var.
  const declarations = [...css.matchAll(/--accent:\s*([^;]+);/g)];
  assert.equal(declarations.length, 1, 'the accent is declared once');
  assert.equal(declarations[0][1].trim().toLowerCase(), '#3dd8f5');
});

test('dark is the default theme, and light is the media-query exception', async () => {
  const css = await readFile(repoPath('runtime/ui/tokens.css'), 'utf8');
  assert.match(css, /:root\s*{[^}]*color-scheme:\s*dark/, 'the default :root is dark');
  assert.match(css, /prefers-color-scheme:\s*light/, 'light is opt-in via the OS');
});

test('motion has a single off switch: durations are tokens, zeroed under reduced motion', async () => {
  const css = await readFile(repoPath('runtime/ui/tokens.css'), 'utf8');
  const reduced = /prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n}/.exec(css);
  assert.ok(reduced, 'tokens.css has no prefers-reduced-motion block');
  for (const dur of ['--dur-fast', '--dur', '--dur-slow']) {
    assert.match(reduced[1], new RegExp(`${dur}:\\s*1ms`), `${dur} is not zeroed for reduced motion`);
  }
  // ...and the base values are inside the 120-200ms house range
  for (const [token, ms] of [['--dur-fast', 120], ['--dur', 160], ['--dur-slow', 200]]) {
    const m = new RegExp(`${token}:\\s*(\\d+)ms`).exec(css);
    assert.ok(m, `${token} is not a millisecond duration`);
    assert.equal(Number(m[1]), ms);
    assert.ok(Number(m[1]) >= 120 && Number(m[1]) <= 200, `${token} is outside 120-200ms`);
  }
});

test('style.css spends tokens, not literals: no hex colors, no px spacing, no important keyword', async () => {
  const css = await readFile(repoPath('runtime/ui/style.css'), 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(stripped), false,
    'style.css declares a literal color; colors live in tokens.css');
  assert.equal(/\x21important/.test(stripped), false,
    'specificity is won by cascade order, not by force');
  assert.equal(/@font-face|https?:\/\//.test(stripped), false,
    'no webfonts and no network references, ever');
});

test('no UI module listens to scroll; reveal-on-scroll is not how this product moves', async () => {
  for (const name of await readdir(repoPath('runtime/ui'))) {
    if (name.endsWith('.js') === false) continue;
    const src = await readFile(repoPath(`runtime/ui/${name}`), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.equal(/addEventListener\(\s*['"]scroll/.test(code), false,
      `runtime/ui/${name} installs a scroll listener`);
    assert.equal(/\sonscroll\s*=/.test(code), false, `runtime/ui/${name} assigns onscroll`);
  }
});

test('index.html loads the tokens before the components that spend them', async () => {
  const html = await readFile(repoPath('index.html'), 'utf8');
  const tokens = html.indexOf('runtime/ui/tokens.css');
  const style = html.indexOf('runtime/ui/style.css');
  assert.ok(tokens > 0, 'index.html does not load tokens.css');
  assert.ok(style > tokens, 'tokens.css must load before style.css, or the vars resolve late');
});
