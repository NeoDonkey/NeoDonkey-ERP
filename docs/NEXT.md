# What to pick up next

Read this before starting work. Rewrite it before finishing. It is the first file anyone opens,
so it is the one that has to be true.

**Updated:** 2026-08-17

---

## Where the project stands

v0.1 of the runtime is in the repository and the suite is green: **664 tests, 662 passing, 2
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

## After that, in order

No implementation items remain in the "our shortfall" release blocker set. Further work falls under non-implementation decisions (e.g. #15 rr7) or Wave 2+ / Wave 5 roadmap items.

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

**Wave 5 accounting work** — opening balances, credit notes, a refund month, fixed assets,
accruals, year-end close. `docs/READINESS.md` lists these and they are real, but each needs a
domain decision rather than an implementation. A first entry genuinely cannot be posted today, and
that is the wall between this and a real company's first week. It is not a good solo task.

---

## Open questions for a human

Nothing outstanding. When an item turns out to need a decision rather than an implementation,
write the question here instead of choosing an answer.
