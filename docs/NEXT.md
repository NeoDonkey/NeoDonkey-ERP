# What to pick up next

Read this before starting work. Rewrite it before finishing. It is the first file anyone opens,
so it is the one that has to be true.

**Updated:** 2026-08-20

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

## Newly Specified Standards & Unblocked Implementable Issues

Decision records in `docs/decisions/` have been updated with concrete, `ready` implementable issue definitions for Wave 2 and Wave 3:
1. **DATEV EXTF Format Export (`docs/decisions/2026-08-18-datev-extf-export-structure-and-booking-header-format.md`)**:
   - `feat(datev): serialize EXTF v700 header and column metadata lines` (#81, `area:runtime`, `p1`, `ready`)
   - `feat(datev): serialize EXTF v700 posting lines from SKR03/SKR04 ledger entries` (#82, `area:runtime`, `p1`, `ready`)
2. **EN 16931 / XRechnung E-Invoicing (`docs/decisions/2026-08-18-en16931-xrechnung-e-invoicing-semantic-data-model.md`)**:
   - `feat(xrechnung): generate EN-16931 UBL 2.1 XML invoices from domain invoice objects` (#83, `area:runtime`, `p1`, `ready`)
   - `feat(xrechnung): parse and validate EN-16931 UBL 2.1 XML invoices against mandatory BT terms` (#84, `area:runtime`, `p1`, `ready`)
3. **GoBD Period Close & Balance Carryforward (`docs/decisions/2026-08-18-gobd-period-close-and-balance-carryforward.md`)**:
   - `feat(ledger): enforce GoBD period locking (Festschreibung) and posting immutability in kernel` (`area:runtime`, `p1`, `ready`)
   - `feat(ledger): generate year-end P&L closing and balance carryforward (Saldenvortrag) entries` (`area:runtime`, `p1`, `ready`)
4. **Inbound Dialect - Shopify E-Commerce Orders (`docs/decisions/2026-08-19-inbound-dialect-shopify-order-mapping-and-idempotency.md`)**:
   - `feat(inbound): parse and convert Shopify REST/GraphQL JSON orders into domain sales-invoice documents with strict monetary parsing` (`area:runtime`, `p1`, `ready`)
   - `feat(inbound): enforce idempotency and source-reference tracking for inbound dialect orders` (`area:runtime`, `p1`, `ready`)
5. **Multi-Currency Accounting & Realized FX (`docs/decisions/2026-08-17-multi-currency-accounting-and-realized-exchange-gains-losses.md`)**:
   - `feat(currency): FX rate table and spot conversion with BigInt rational math` (`area:runtime`, `p1`, `ready`)
   - `feat(ledger): post realized foreign exchange gains/losses on payment settlement` (`area:runtime`, `p1`, `ready`)
6. **PDF Invoice Rendering (`docs/decisions/2026-08-17-pdf-invoice-rendering-from-versioned-templates.md`)**:
   - `feat(pdf): deterministic HTML/SVG/CSS template renderer for sales invoices` (`area:runtime`, `p1`, `ready`)
7. **EU One-Stop Shop (OSS) VAT (`docs/decisions/2026-08-17-oss-one-stop-shop-eu-vat-schema-and-thresholds.md`)**:
   - `feat(vat): enforce EU cross-border B2C €10,000 OSS threshold aggregation and destination rate switching` (`area:runtime`, `p1`, `ready`)
   - `feat(vat): aggregate quarterly Union OSS VAT return data grouped by EU member state` (`area:runtime`, `p1`, `ready`)
8. **GoBD Verfahrensdokumentation & Code Cross-References (`docs/decisions/2026-08-20-gobd-verfahrensdokumentation-and-auditor-verification.md`)**:
   - `docs(gobd): write Verfahrensdokumentation cross-referencing GoBD requirements to runtime code paths` (`area:docs`, `p1`, `ready`)
   - `test(gobd): add automated Verfahrensdokumentation link and code-reference integrity test` (`area:tests`, `p1`, `ready`)
9. **Scale Benchmarks & Columnar Projection Indexing (`docs/decisions/2026-08-20-scale-benchmarks-and-columnar-index-materialization.md`)**:
   - `feat(index): implement columnar projection typed arrays and lazy document materialization` (`area:runtime`, `p1`, `ready`)
   - `test(benchmark): 10M object packfile geometric repacking and 1M document index query benchmark suite` (`area:tests`, `p1`, `ready`)

Filed open issues (#81, #82, #83, #84) can be claimed immediately by engineering sessions. Additional defined issue specifications above will be claimable as soon as filed as open GitHub issues.

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
