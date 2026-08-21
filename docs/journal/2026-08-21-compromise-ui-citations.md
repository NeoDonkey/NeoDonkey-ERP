# 2026-08-21 — The `_compromise-ui.md` citations, and a guard for cited documents

## Job taken

Nothing unclaimed in scope was left in the queue: #20 → PR #73, #34 → PR #88, #44 → PR #29,
#82/#83 claimed by the DATEV/XRechnung PRs, #84 unclaimed but asks for `runtime/export` behaviour
(out of this lane), #59 is a generated report. Per the lane rules this session fell through to
verification, aimed at gate condition 10 (PARTIAL): "line-by-line audit of manifesto and website
claims against implementation behaviour".

## What was checked

Every repo-local path citation in the shipped site surface: `index.html`,
`manifest.webmanifest`, `service-worker.js`, `serve.mjs`, `relay.mjs`, and all of
`runtime/ui/*.js`. Resource references in `index.html` (icon, stylesheet, manifest, boot module)
all exist; g-ui.test.js already proves the manifest parses and serve.mjs serves the shell with
correct MIME types.

## What was found

**`docs/_compromise-ui.md` has never existed**, and nine shipped files cite it ten times —
`index.html` (twice, including the file:// boot-failure screen), `serve.mjs` (twice),
`runtime/ui/boot.js`, `storage.js`, `forms.js`, `shell-files.js`, `viewmodel.js`, and
`test/g-ui.test.js`. `git log --all --follow` shows no commit ever contained the file; the
citations date from the initial runtime commit. A reader standing in front of the blank-page
error screen, following the pointer to "the full measurement", hits a dead end.

The content itself exists: register entry #8 in `docs/COMPROMISES.md` holds the measurement table
and the four precise findings. Only the pointer is broken.

## What was done

1. **Created `docs/_compromise-ui.md`** — the document the comments have promised since the first
   commit. It collects what each citing file leans on (the file:// measurement summary,
   capability-detection-by-round-trip, the two form decisions), names register entries #8/#10 as
   authoritative, and deliberately does not duplicate the register's table.
2. **Added `test/site-citations.test.js`** (3 tests): every `docs/` path cited by the shell and UI
   modules must exist; the launcher scripts index.html names must be in the folder; serve.mjs must
   contain no write-capable fs call ("only ever reads files" is now asserted, not rhetoric).
   Illustrative examples (`operating-model/information/anything.md`) and embedded starter-model
   keys are out of scope on purpose. The citation test fails before the document exists and passes
   after — verified both ways.

## Deliberately not done

- Repointing the citations inside `runtime/*.js` comments at `docs/COMPROMISES.md #8` instead of
  creating the document — that edit belongs to the runtime owners; creating the referent makes all
  ten citations true without touching `runtime/`. If they prefer repointing, the guard test holds
  either way.
- serve.mjs's "about a hundred lines" (140 today, comments included) was judged rhetorical and
  not pursued; the register says ~110. Noted here rather than filed.
