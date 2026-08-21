// test/readme-datev-claim.test.js — the README may promise flowing DATEV bookings only when
// the exporter can emit booking lines.
//
// README.md used to claim NeoDonkey "already ships DATEV EXTF v700 serialization — your
// bookings flow straight to your tax advisor's system", while runtime/export/datev.js (issue
// #81) emits only the two-line EXTF v700 header: 26 fixed attributes plus the Buchungsstapel
// column names. No module in runtime/export/ can produce a booking line until #82 lands.
// These tests gate the prose on the capability: the strong claim is forbidden while no
// booking-line serializer exists, and allowed again the moment one does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');

// A booking-line serializer exists if any module in runtime/export/ exports a function whose
// name speaks of booking lines (Buchungsstapel postings). The header serializer does not count.
function bookingLineSerializerExists() {
  const dir = new URL('runtime/export/', root);
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.js')) continue;
    const source = readFileSync(new URL(entry, dir), 'utf8');
    for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
      if (/booking|posting|buchung/i.test(m[1])) return true;
    }
  }
  return false;
}

test('README claims DATEV bookings flow only when a booking-line serializer exists', () => {
  if (bookingLineSerializerExists()) return; // #82 landed: the strong claim is allowed again

  assert.ok(!/bookings flow straight/.test(readme),
    'README.md promises "your bookings flow straight to your tax advisor\'s system" but no module '
    + 'in runtime/export/ can emit a DATEV booking line (#82). Qualify the claim until one lands.');

  assert.ok(!/\*\*DATEV EXTF v700\*\*\s*\|\s*✅/.test(readme),
    'README.md\'s comparison table marks DATEV EXTF v700 as built in, but only the two-line '
    + 'header is serialized (#81); posting lines are still open (#82).');
});

test('README names what the DATEV exporter actually ships today', () => {
  const datevBlock = readme.split(/\n{2,}/).find((b) => /EXTF/.test(b));
  assert.ok(datevBlock, 'a README paragraph about DATEV EXTF must exist');

  assert.match(datevBlock, /header/i,
    'the DATEV paragraph must name what is actually shipped (the EXTF v700 header), '
    + 'not imply that complete serialization exists');
});

// The same sentence once read "with 9 passing tests" while the DATEV test files held ten.
// A hardcoded sub-suite count drifts on every DATEV test added, and prose counts are exactly
// what #55/#64 removed from documentation because they make every test-adding PR conflict
// with every other. documented-counts.test.js cannot see this case by design — its regex
// requires three digits so version numbers do not register — so the DATEV claim file guards
// its own sentence.
test('README does not hardcode a DATEV test count', () => {
  const m = readme.match(/\b\d+\s+passing\s+tests\b/);
  assert.equal(m, null,
    'README.md states "' + (m ? m[0] : '') + '" as a literal. A sub-suite count in prose drifts '
    + 'every time a DATEV test is added (it said 9 while the files hold 10) and causes the '
    + 'merge conflicts that removed suite totals from prose (#55, #64). Point at '
    + 'test/datev-*.test.js instead of counting it.');
});

// If the booking-line serializer ever leaves runtime/export/, the README may not keep saying
// the serializer ships "booking lines" — the same gate the strong-claim test applies to the
// older wording, extended to the current one.
test('README claims booking lines only while a booking-line serializer exists', () => {
  if (bookingLineSerializerExists()) return;

  assert.ok(!/full header,\s*\n?\s*booking lines/.test(readme),
    'README.md says the DATEV serializer ships "the full header, booking lines" but no module '
    + 'in runtime/export/ emits a booking line any more. Qualify or drop the claim.');
});
