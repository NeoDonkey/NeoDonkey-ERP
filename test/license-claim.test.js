// test/license-claim.test.js — an EUPL-1.2 claim must be backed by the licence text itself.
//
// Why this exists. README.md says "Licensed under the EUPL-1.2" and advertises
// "Open source | ✅ EUPL-1.2" against Odoo, SAP S/4HANA and Lexware; package.json declares
// `"license": "EUPL-1.2"`. Until 2026-08-21 no file in this repository carried the licence
// text. A reader holding the folder — which is the entire point of this project — could not
// read the terms they were told the software is under, and a fresh clone reported no licence
// at all while the comparison table sold one. The claim was not verifiable by running or
// reading anything, which is the only kind of claim this repository wants to make.
//
// The rule pinned here: while README.md or package.json name EUPL-1.2, a LICENSE file must
// exist at the root and carry the official text of that licence — not a summary of it.
// Source of the text: EUR-Lex CELEX 32017D0863, Commission Implementing Decision (EU) 2017/863
// of 18 May 2017 (Annex), distributed in plain-text form by the European Commission's Joinup
// site; LICENSE is that file unmodified. If either document stops naming EUPL-1.2 this test
// does not demand a LICENSE file — but then it also refuses the claim in the other, so the
// two cannot drift apart silently in either direction.
//
// Owner: audit lane. Zero dependencies. `node --test test/license-claim.test.js`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const readme = readFileSync(new URL('README.md', root), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

/** Collapse whitespace so phrases that wrap across lines can be matched without pinning layout. */
const flat = (s) => s.replace(/\s+/g, ' ');

test('README.md and package.json agree that the licence is EUPL-1.2', () => {
  assert.equal(pkg.license, 'EUPL-1.2', 'package.json must keep declaring EUPL-1.2');
  assert.ok(readme.includes('EUPL-1.2'), 'README.md claims EUPL-1.2');
});

test('the EUPL-1.2 claim is backed by the official licence text in LICENSE', () => {
  // If neither document names a licence any more, there is nothing for LICENSE to back.
  if (pkg.license !== 'EUPL-1.2' && !readme.includes('EUPL-1.2')) {
    assert.fail(
      'Neither package.json nor README.md names EUPL-1.2 any more. Update this test to say '
      + 'what the project is licensed under instead of deleting the assertion.'
    );
  }

  assert.ok(existsSync(new URL('LICENSE', root)),
    'LICENSE does not exist, yet README.md says "Licensed under the EUPL-1.2" and package.json '
    + 'declares `"license": "EUPL-1.2"`. Add the official text '
    + '(EUR-Lex CELEX 32017D0863, Annex) as LICENSE.');

  const text = flat(readFileSync(new URL('LICENSE', root), 'utf8'));

  // Distinctive phrases from the official English text — enough that replacing it with a
  // different licence (or a paraphrase) while keeping the name cannot pass.
  const required = [
    'EUROPEAN UNION PUBLIC LICENCE v. 1.2',
    'EUPL © the European Union 2007, 2016',
    '1. Definitions',
    '5. Obligations of the Licensee',
    'Copyleft clause: If the Licensee distributes or communicates copies of the Original Works',
    '8. Disclaimer of Liability',
    '13. Miscellaneous',
    '15. Applicable Law',
    '‘Compatible Licences’ according to Article 5 EUPL are:',
    'GNU Affero General Public License (AGPL) v. 3',
    'Québec Free and Open-Source Licence — Reciprocity (LiLiQ-R) or Strong Reciprocity (LiLiQ-R+)',
  ];
  const missing = required.filter((phrase) => !text.includes(phrase));
  assert.deepEqual(missing, [],
    'LICENSE exists but does not carry the official EUPL-1.2 text (missing: '
    + missing.join('; ') + '). Restore the unmodified text from EUR-Lex CELEX 32017D0863.');
});
