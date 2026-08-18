# What to pick up next

Read this before starting work. Rewrite it before finishing. It is the first file anyone opens,
so it is the one that has to be true.

**Updated:** 2026-08-18

---

## Where the project stands

v0.1 of the runtime is in the repository and the suite is green: **about 30 seconds, 2
skipped, no failures.** `npm test` is a required check, so nothing merges past a
red build — and since 2026-08-17 nothing merges past a review that asked for changes either. Read
§7 of `AGENTS.md` before you open a pull request: your work is not finished when the pull request
is open, it is finished when a review comes back clean, and the findings reach you as a message in
your own session.

**Publishable, not production** — the two bars are defined in `docs/READINESS.md` and they do not
imply each other. The README says the same thing and must keep saying it.

What is built and tested, and therefore **must not be rebuilt**: the git object layer and packfile
handling, the POLISM parser and executor (grammar v2), the money core with no float in any
monetary path, the double-entry general ledger with the balance as a structural invariant, the
CRDT live layer, sync through a relay including recovery of a company after one process was
destroyed, the indexed read path, and the browser UI. A quick skim of this repository
under-estimates how far along it is. Check `docs/COMPROMISES.md` before concluding something is
missing — most gaps are already named there, with a category and a cost.

---

## The next item

Issue #46 (`test/readme-claims.test.js` "README Claim 4" flakiness under concurrency) is resolved by atomic file writes in `nodeFs.write()` in `runtime/git/fs-node.js`.

Everything in the "our shortfall" category is closed except where `docs/COMPROMISES.md` is wrong
about itself — see the note below. The codebase enforces UI field display derivation through the
`## Displayed by` POLISM grammar section; the headline status claims and the signed release
manifest verification in `README.md` and `docs/ARCHITECTURE.md` are verified in
`test/readme-claims.test.js`; the refusal paths and authority checks in `runtime/polism/` are
verified in `test/c-polism.test.js`; and the file paths cited across `docs/COMPROMISES.md`,
`docs/NEXT.md` and `docs/AUDIT.md` are verified to exist by `test/audit-location-citations.test.js`.

**One of those closures is not real.** Compromise #13 is marked CLOSED, but
`runtime/ui/fields.js` still runs the hardcoded `['name', 'title', 'label', 'description']` loop
and no file in `operating-model/information/` declares `## Displayed by` — so the replacement path
is parsed and never populated. The grammar landed; the adoption did not. Filed as **#44**, and PR
**#29** already contains the work and needs a rebase rather than a rewrite.

---

## Newly Specified Standards & Next Priorities

Decision records have been added to specify key roadmap items for Wave 2 and Wave 3:
1. **DATEV EXTF Format Export (`docs/decisions/2026-08-18-datev-extf-export-structure-and-booking-header-format.md`)**: Formatversion 700 header specification, Windows-1252 encoding, SKR03/SKR04 account mapping, and booking line syntax.
2. **EN 16931 / XRechnung E-Invoicing (`docs/decisions/2026-08-18-en16931-xrechnung-e-invoicing-semantic-data-model.md`)**: Semantic business terms (BT-1 to BT-115), German XRechnung KoSIT 3.0 profile, UBL 2.1 syntax binding, and UStG § 14 mandatory B2B rollout schedule.
3. **GoBD Period Close & Balance Carryforward (`docs/decisions/2026-08-18-gobd-period-close-and-balance-carryforward.md`)**: GoBD period locking (Festschreibung), immutability of posted journal entries, reversing entry mechanisms (Storno), P&L closing into GuV/Equity, and balance sheet opening carryforward (Saldenvortrag).

Future sessions can implement these specifications by building unit-tested exporters and period-close kernel validation rules.

---

## Do not start these

**#15 rr7 — publishing a release key.** The signing machinery is built and tested but ships
unarmed: no production key, no published fingerprint, no `release.json`. This is *not* an
implementation task. It needs a decision about **where the fingerprint is published**, and that
must be somewhere that is not this repository — a fingerprint published only at the origin it is
meant to protect proves nothing. Generating a signing key inside a public repository would be
worse than shipping none, which is exactly why none was shipped. Leave it.

Note also that `.gitignore` currently excludes `release.json`, because that name is also a
workspace artefact. Whoever eventually does arm the release will have to separate those two
meanings first.

**Wave 5 accounting work, as implementation** — opening balances, credit notes, a refund month,
fixed assets, accruals, year-end close. `docs/READINESS.md` lists these and they are real. A first
entry genuinely cannot be posted today, and that is the wall between this and a real company's
first week.

Do not *implement* these from recollection: each rests on a fact that has to be right — which
opening-balance convention, which depreciation method, what the year-end close actually asserts —
and a guess produces an ERP that is confidently wrong about money, which is the worst thing this
product could be.

But that is an argument for **looking it up**, not for stopping. These are facts with
authoritative sources, not preferences awaiting an owner's taste. Research them, cite them,
decide, and record the decision. Specifying and implementing them is wanted.

---

## Decide it yourself

Nobody reads this repository for days at a time, so an issue asking a human to choose is not a
cautious act — it is a stalled one. It blocks the work, and the person it waits for knows less
about Polish VAT than an afternoon of reading does.

**A regulatory, accounting or standards question is yours.** Research it, cite a primary source per
`docs/SPECIFYING.md` §2 — the regulation, the official specification, the tax authority's own
documentation, with the article or field that applies — then decide and write it down as a new file
in `docs/decisions/`, named `YYYY-MM-DD-short-slug.md`: the question, the answer, the source, and what would
have to change for the answer to change. One file per decision, so parallel sessions never collide.

Where sources genuinely disagree, say so in the record, implement the reading you can defend, and
name the other. A documented decision someone can overturn beats a question nobody answers.

**Two things are still not yours.** Scope — *how* Polish VAT reporting works is researchable and
yours to establish, *whether* Poland is in v1 is decided in the manifesto and the roadmap, and if it
is in neither then that is a `needs-decision` issue and you stop. And the release signing key
(#15 rr7), which is refused for a security reason rather than a preference.

Changed 2026-08-17, twice. The file first said "leave it", so nothing moved and nobody even wrote
the questions down. Then it said "ask", which would have produced a fortnight of unanswered issues.
Neither was the owner's bottleneck to be — it is a research problem, and research is what these
sessions are good at.
