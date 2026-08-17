# What to pick up next

Read this before starting work. Rewrite it before finishing. It is the first file anyone opens,
so it is the one that has to be true.

**Updated:** 2026-08-17

---

## Where the project stands

v0.1 of the runtime is in the repository and the suite is green: **662 tests, 660 passing, 2
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
verified. Where something genuinely needs a human's decision rather than an implementation — a
VAT rate, a chart-of-accounts choice, a period-close policy — open it `needs-decision` and move
on. Do not guess, and do not implement around it.

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

Do not *implement* these blind: each carries a domain decision — which opening-balance convention,
which depreciation method, what the year-end close actually asserts — and guessing produces an ERP
that is confidently wrong about money, which is the worst thing this product could be.

But **specifying them is allowed and wanted.** Read the sources, write the issue, and where the
decision is genuinely a human's, open it `needs-decision` with the question stated precisely and
the options named. That converts a vague wall into a short list somebody can answer in an
afternoon, which is the only way this ever gets unblocked while nobody is watching. Changed
2026-08-17: the old wording said "leave it", and the effect was that nobody wrote the questions
down either.

---

## Open questions for a human

Nothing outstanding right now. When an item turns out to need a decision rather than an
implementation, open a `needs-decision` issue with the question and the options — do not choose an
answer, and do not silently skip it. List it here too if it blocks a whole area.
