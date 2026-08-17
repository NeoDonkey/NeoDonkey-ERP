# What to pick up next

Read this before starting work. Rewrite it before finishing. It is the first file anyone opens,
so it is the one that has to be true.

**Updated:** 2026-08-17

---

## Where the project stands

v0.1 of the runtime is in the repository and the suite is green: **669 tests, 667 passing, 2
skipped, no failures, about 30 seconds.** `npm test` is a required check, so nothing merges past a
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

**`test/readme-claims.test.js` "README Claim 4" is flaky under load.** It passes on its own, every
time, and fails intermittently — roughly one run in four — when the whole suite runs at
`--test-concurrency=2`. The failure is `readPackIndex: index file is too small (0 bytes)`: the peer
process reads the pack index before it has been written, so it is a race in the fixture's
handshake, not a defect in `runtime/git/pack-index.js`. CI has not hit it yet.

Fix this first. It is the highest-value item in the queue and it is not about correctness — it is
about whether this repository can run unattended at all. `test` is a required check, so a flake
means a pull request fails for a reason no agent can reproduce or act on. Nothing merges, the next
scheduled session opens a second pull request against the same files, and by the time anyone looks
there are two conflicting branches and no explanation. This is the class of failure that stops the
project silently, which is exactly what the review loop was built to prevent.

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

## After that: the queue is empty, and that is the thing to fix

The release-blocker set is closed. That does **not** mean the project is finished — it means
nobody has turned the next part of the roadmap into issues yet, and until someone does, every
session falls back to auditing documentation and re-checking claims. Six of the eight pull
requests merged before 2026-08-17 were tests about documents. That is what an empty queue looks
like from the outside, and it is not progress.

**So specifying is now the highest-value work available**, and `AGENTS.md` §6 routes you to it
automatically whenever fewer than three unclaimed `ready` issues remain. Read
`docs/SPECIFYING.md`, then decompose from `docs/ROADMAP-V1.md`:

- **Part 2** — the ten v1.0 gate conditions. Each is several issues.
- **Part 3, Wave 2 — the claims.** The general ledger, AR/AP, VAT and OSS returns, period close,
  multi-currency. This is the substance of the product and none of it is queued.
- **Part 3, Wave 3 — sellable.** DATEV, XRechnung/EN-16931, one inbound dialect, PDF from
  versioned templates.

Decompose; do not invent. Every issue cites the sentence it came from and says how it will be
verified. Where a regulatory or accounting fact is needed — a VAT rate, a chart-of-accounts
convention, what a year-end close asserts — **research it and cite a primary source**. Do not open
an issue asking for it. See "Decide it yourself" below.

This supersedes the earlier note here that no work remained. It was true about the blocker set and
misleading about everything else.

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
in a new file in `docs/decisions/`, named `YYYY-MM-DD-short-slug.md`: the question, the answer, the source, and what would
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
