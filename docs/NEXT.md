# What to pick up next

Read this before starting work. Rewrite it before finishing. It is the first file anyone opens,
so it is the one that has to be true.

**Updated:** 2026-08-12

---

## Where the project stands

v0.1 of the runtime is in the repository and the suite is green: **642 tests, 640 passing, 2
skipped, no failures, about 30 seconds.** `npm test` is a required check, so nothing merges past a
red build.

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

**Close `COMPROMISES.md` #13.**

*The gap:* `runtime/ui/fields.js` knows four business field names by convention (`name`, `title`, `label`, `description`). Business vocabulary inside the runtime is what Principles 7 and 11 forbid.

*Why it is next:* It is a direct violation of our strict architectural boundaries. The exit path is additive and cheap: a `## Displayed by` grammar section, then one UI change.

*Done when:* Display names are moved out of the runtime and into the operating model where they belong, supported by a parser extension.

---

## After that, in order

The release blocker set — category **our shortfall** in `docs/COMPROMISES.md`. By standing rule 2,
none of these may be in v1.0.

1. **#21** — `intent.actorRoles` is a claim the caller makes about itself, so
   `perform({actorRoles:['managing-director']})` from any script is a managing director.
   `runtime/polism/execute.js:62` still takes the claim verbatim. This is the only one of the seven
   that is genuine engineering, and FD-9 in `docs/ROADMAP-V1.md` has already decided the fix:
   roles are the intersection of what is claimed and what the repository records. A kernel edit
   plus three callers (`mcp/server.mjs`, `runtime/ui/`, `demo/sarah.mjs`). Take this one when the
   easier four are done, not first.

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
