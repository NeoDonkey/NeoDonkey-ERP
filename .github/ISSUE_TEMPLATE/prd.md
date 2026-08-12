---
name: Specification
about: A piece of work, specified well enough that someone can implement it
title: ''
labels: prd
---

## What

<!-- One paragraph. What exists after this is done that does not exist now. -->

## Where this comes from

<!-- Required. An issue without a source is not implemented.
     Name one: a manifesto principle, a gate condition in docs/ROADMAP-V1.md Part 2,
     a wave in Part 3, an entry in docs/COMPROMISES.md, or a line in docs/READINESS.md.
     Quote the sentence. -->

## Sources

<!-- Required for any regulatory, accounting or standards claim.
     Primary sources only: the regulation, the official specification, the tax
     authority's own documentation. Not a blog, not a forum, not a summary.
     Give title, publisher and a link, and say which part of it applies. -->

## Scope

**In:**

**Out:**

<!-- Say what this deliberately does not cover, so the next issue can pick it up
     instead of the implementer widening this one. -->

## How it will be verified

<!-- Required. What test proves it, what command demonstrates it. A specification
     that cannot be checked produces a change that cannot be reviewed.
     "Nothing in here is asserted from a report" applies here too. -->

## Constraints that apply

<!-- Delete what does not apply; keep what the implementer must not break. -->

- Zero dependencies — no npm package, in any form
- No build step — the same ES modules run in Node 22+ and in a browser
- No `node:*` outside `runtime/git/fs-node.js` and tests
- No `Date.now()` / `Math.random()` in core logic — inject `clock` and `rng`
- No business vocabulary in `runtime/` — it belongs in `operating-model/`, as rules
- No float in any monetary path

## Open questions

<!-- If any question here is answered by neither the manifesto nor the roadmap,
     this issue is `needs-decision` and nobody implements it until a human answers.
     If the questions are merely unresearched, research them and remove this section. -->
