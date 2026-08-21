# The EUPL-1.2 claim is now backed by the licence text

2026-08-21 · lane B (docs/tests/chores) · verification run that found a defect and fixed it

## What was checked

With nothing unclaimed left in my scope (#118/#119 claimed by PR 130, #123/#124 by PRs
142/135; #126/#127/#138 are runtime work; #90 blocked), this session fell through to
verification as instructed. Claims executed or read against code this run:

- `npm run demo` — passes end to end: `git fsck --strict` clean, working tree clean,
  14 commits all carrying good signatures. The README's "Try it" block holds.
- Register entries marked CLOSED spot-read against their cited evidence (#1, #4b, #22,
  #4g, #15 rr4, #21, #13, #4a) — each names a concrete verification and none contradicts
  the current tree.
- README headline claims — already pinned by `test/readme-claims.test.js`; launcher files
  named by the double-click retraction paragraph exist and are guarded by
  `test/site-citations.test.js`.

## What was found

**The repository claims EUPL-1.2 without shipping the licence.** `README.md` ends with
"Licensed under the EUPL-1.2" and the comparison table advertises "Open source | ✅ EUPL-1.2"
against Odoo, SAP S/4HANA and Lexware; `package.json` declares `"license": "EUPL-1.2"`. No
LICENSE file existed anywhere in the checkout — not ignored by `.gitignore`, just absent,
and no issue, decision record or compromise entry recorded the absence as deliberate.

Consequence: a reader holding the folder could not read the terms they were told the software
is under. This project's whole posture is "claims are verifiable by running something"; this
one was verifiable by reading nothing.

## What changed

- **`LICENSE`** — the official EUPL-1.2 English text, byte-exact from the European
  Commission's Joinup distribution (EUR-Lex CELEX 32017D0863, Commission Implementing
  Decision (EU) 2017/863 of 18 May 2017, Annex). Unmodified.
- **`test/license-claim.test.js`** — pins the claim to the text: while README.md or
  package.json name EUPL-1.2, LICENSE must exist and carry distinctive phrases from the
  official text (title, copyright line, article headings, copyleft clause, compatible-licence
  appendix). Fails before the change (no LICENSE) and passes after; refuses to pass vacuously
  if someone later drops the claim from one document but not the other, and refuses to be
  deleted if the licence itself ever changes.

No runtime or operating-model file touched. Suite floor unchanged (tests only added).

## What this moves

Gate condition 10 ("every claim audited") — the licensing claim moved from asserted to
continuously audited. It does not close the condition: the line-by-line manifesto/site audit
named there remains open.
