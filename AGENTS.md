# Working on NeoDonkey

Conventions for anyone — or anything — making changes in this repository. Read this before the
first edit. It is short on purpose; the long answers live in `docs/`.

---

## 1. What this repository is

An ERP with no server, no cloud, no vendor and no dependencies. A company lives in a folder, the
folder is a git repository, every business fact is a signed commit, and the software that runs it
executes in the browser from the same folder.

The project answers to three documents, in this order:

| Document | Authority |
|---|---|
| `neodonkey-manifesto.md` | The constitution. Where code and manifesto disagree, the manifesto wins by default. |
| `docs/CONTRACT.md` | The module contract and the non-negotiables. Binding. |
| `docs/ROADMAP-V1.md` | Every foundation decision (FD-n) and why it was taken. Part 2 is the v1.0 gate. |

Two more you will need constantly: `docs/COMPROMISES.md` is the register of known debt — the only
real failure mode this project has is a compromise that is *not* in it. `docs/READINESS.md` says
what "done" means, and why publishable and production are different bars.

**Status: publishable, not production.** Do not add a claim to the README that the code does not
yet support. Every sentence in it is meant to be verifiable by running something.

---

## 2. Non-negotiables

These come from `docs/CONTRACT.md`. Breaking one is not a trade-off to weigh; it is out of scope
for any single change.

1. **Zero runtime dependencies.** No npm packages. Not one, not "just this small one", not a dev
   dependency that creeps into the runtime. `package.json` has no `dependencies` field and CI
   fails if one appears. Anything we need, we write.
2. **No build step.** The same ES modules run unmodified in Node 22+ and in the browser. Relative
   imports, `.js` extensions, no bundler, no transpiler.
3. **`node:*` imports only in `runtime/git/fs-node.js` and in tests.** Everywhere else, the code
   must run in a browser.
4. **Browser-standard primitives only:** `crypto.subtle`, `CompressionStream`, `TextEncoder`,
   `structuredClone`. Nothing else.
5. **Determinism.** No `Date.now()` and no `Math.random()` in core logic — time and randomness are
   injected as `clock` and `rng`. This is what makes "same foreign event → same commit" possible
   and what makes the tests exact.
6. **No business vocabulary inside the runtime.** Field names, entity names and thresholds belong
   in `operating-model/`, expressed as rules. A business word hard-coded in `runtime/` is a defect
   (see entry #13).
7. **Tests are `node --test` only**, in `test/*.test.js`, with zero dependencies there too.

---

## 3. Two things that must never happen

- **Never commit key material.** No `.jwk`, `.pem`, `.key`, no release signing key, no `.env`.
  `.gitignore` blocks these, and that is a backstop, not permission to be careless. This repository
  is public. Do not generate a production signing key here — where the release fingerprint gets
  published is an open decision, not a task to complete unilaterally (`COMPROMISES.md` #15 rr7).
- **Never create a NeoDonkey workspace in this checkout.** `documents/`, `peers/` or
  `neodonkey.json` appearing at the root means a workspace has hijacked our own git history. This
  has happened twice, and both times it went unnoticed for days. The `.neodonkey-dev` marker and
  the kernel guard prevent the write; `test/checkout-hygiene.test.js` catches it if they fail. Use
  a temp directory, OPFS, or an explicit path.

---

## 4. Two lanes

Work here runs in two lanes that deliberately do not overlap. More than one change in flight
against the same files produces conflicts and duplicated work, not more progress. Know which lane
you are in before you edit anything.

| Lane | Planning file | Does | Edits |
|---|---|---|---|
| **A — build** | `docs/NEXT.md` | Implements entries from the release blocker set | `operating-model/`, `runtime/`, `demo/`, `docs/COMPROMISES.md`, `docs/JOURNAL.md` |
| **B — audit** | `docs/AUDIT.md` | Verifies that what we claim is true, and writes the tests that keep it true | `test/`, `docs/AUDIT.md` |

Lane B never edits the register, the build backlog or the journal. It records findings in
`docs/AUDIT.md`; lane A folds them in and acts on them. That makes the two a pipeline rather than
a collision. Lane A does not write to `docs/AUDIT.md`.

If you were given no lane, you are in lane A.

---

## 5. Choosing what to work on

**Issues are the queue.** More than one change is usually in flight, so a planning file cannot say
"do this next" — two readers would take the same item and build it twice. Issues can be claimed;
a Markdown file cannot.

### First: decide which job this session does

Nobody assigns you a role. Look at the queue and take the one the repository needs:

```bash
gh issue list --state open --label ready       # how much specified work is waiting
gh pr list --state open                        # how much is already in flight
```

| What you find | Do this |
|---|---|
| Fewer than 3 `ready` issues unclaimed | **Specify.** The queue is running dry and implementing the last item leaves the next session with nothing. |
| 3 to 20 unclaimed | **Implement.** There is work; adding more specification is not what is short. |
| More than 20 `ready` | **Implement**, and do not specify at all — the backlog is already a pile. |
| Queue full but everything claimed by open pull requests | **Verify.** Check an existing issue's claims against the code, or improve test coverage. |

Judgement beats the table where they disagree — a queue of twenty issues that are all vague is
worse than five that are precise, and specifying is then the useful work. Say in your pull request
which job you took and why.

### If you implement (engineer)

1. List open issues labelled `ready`. Ignore `needs-decision` and `blocked` entirely.
2. List open pull requests and note which issue numbers they reference. **An issue already
   referenced by an open pull request is taken.** Skip it.
3. Take the highest-priority remaining one — `p1` before `p2` before `p3`. Where several are
   equal, prefer one whose `area:` label differs from the areas the open pull requests touch, so
   two changes are less likely to meet in the same file.
4. **Open a draft pull request immediately, before doing the work**, with `Closes #N` in the body.
   That is how you claim the issue: the next session sees it and moves on. A branch with no pull
   request claims nothing.
5. Do the work. Mark the pull request ready for review when the suite is green.

If there is no `ready` issue, do not invent one. Improve test coverage, or correct documentation
that has drifted from the code, and say in the pull request that the queue was empty.

### If you specify (planning)

**Read `docs/SPECIFYING.md` first.** It is the long form of this section: how to decompose the
roadmap, what counts as a primary source, how to write a verification that means something, and
what you may not decide. In short:

1. **Decompose; do not invent.** Scope is already decided in the manifesto, `docs/ROADMAP-V1.md`,
   `docs/READINESS.md` and `docs/COMPROMISES.md`. Turning "DATEV export" into implementable issues
   is your work; deciding whether it belongs is not.
2. Every issue **cites its source** and quotes the sentence. An issue without one will not be
   implemented, because nobody can tell whether it is in scope.
3. Every regulatory or accounting claim **cites a primary source** — the regulation, the official
   specification, the tax authority's own documentation, with the article or field that applies.
   Research is welcome and is usually better than recollection; unsourced research is not research.
4. State how the issue will be **verified**: the test that fails without the change, or the command
   that demonstrates it. Not an adjective.
5. Give it an `area:` label matching the directories it will touch, and a priority.

### What you may not decide

If something is answered by **neither the manifesto nor the roadmap** — where the release
fingerprint is published, whether a market is in scope for v1, which of two designs the project
adopts — open an issue labelled `needs-decision` stating the question, the options and a
recommendation, and stop. Do not answer it, and do not implement it.

This is rare on purpose. *How* Polish VAT reporting works is researchable and yours to establish.
*Whether* Poland is in v1 is not.

**One item per change.** A pull request closing one issue cleanly is worth more than one touching
five things. Do not refactor broadly, do not restructure directories, and do not rewrite
subsystems that already have passing tests — this codebase is further along than a quick read
suggests, and the parser, ledger, live layer and sync path are built and tested.

---

## 6. Verifying

```bash
npm test          # 641 tests, about 30 seconds. Must be green before opening a PR.
npm run demo      # the acceptance demo, end to end
npm run ui        # then open http://localhost:8080
```

A change is not done because it looks right. It is done when the suite proves it, and new
behaviour arrives with a test that fails without it. `docs/COMPROMISES.md` is explicit that
nothing in it is asserted from a report — status is re-checked against the code.

---

## 7. Autonomous Scheduled Sessions & Execution

This repository is designed for **100% autonomous background execution** via Google Jules scheduled sessions.

- **Zero Human-in-the-Loop:** During scheduled sessions, there is no human available to respond to messages or approve routine plans. Work through implementation and specification tasks autonomously without pausing for feedback.
- **Respecting Architectural Scope (§5):** Autonomous execution applies to specified items in the queue and `docs/NEXT.md`. If a task requires an architectural or scope decision not answered by the manifesto or roadmap, obey §5 ("What you may not decide"): open an issue labelled `needs-decision` describing the question, options, and recommendation, and stop cleanly. Do not invent unauthorized decisions.
- **Autonomous Implementation:** For specified items, independently implement the solution, verify with `npm test`, update `docs/NEXT.md` and `docs/JOURNAL.md`, and complete the work.
- **Auto-Publish Pull Requests:** When implementation is complete and verified, publish/submit the pull request marked as **ready for review** (non-draft). Do not leave PRs in draft or pending state.
- **Auto-Merge:** Once published as ready for review, `.github/workflows/auto-merge.yml` automatically queues and merges the PR once CI checks pass.

---

## 8. Commits and pull requests

Commits in this repository are authored under one identity. Configure it locally before
committing:

```bash
git config --local user.name  "Daniel Pammé"
git config --local user.email "226692358+danielfrommunich@users.noreply.github.com"
```

- Work on a branch named for the change: `feat/opening-balances`, `fix/vat-rounding`,
  `docs/readiness-tiers`.
- Commit messages in the imperative mood, describing what changes and why:
  `Enforce approval thresholds as rules rather than prose`. No filler, no restating the diff, no
  boilerplate sign-offs.
- Open one pull request against `main` and fill in the template honestly — including what you did
  *not* finish.
- Ensure the pull request is marked **ready for review** (not draft) when work is verified, so auto-merge can process it without human intervention.
- CI must be green. The merge is automatic once it is; nothing merges on a red build.

---

## 9. Before you finish

Leave the repository so the next change can start without archaeology:

- **`docs/NEXT.md`** — rewrite it: what was done, what remains, what is blocked, and the single
  most useful thing to pick up next. This file is read first, so it is the one that matters.
- **`docs/JOURNAL.md`** — add an entry at the top under today's date (`YYYY-MM-DD`), a few lines
  on what changed.
- **`docs/COMPROMISES.md`** — if an entry was closed, move it and record how that was *verified*.
  If a new compromise was introduced, add it with a category, an owner and an exit path. An
  undocumented compromise is the one thing this project treats as a real failure.
