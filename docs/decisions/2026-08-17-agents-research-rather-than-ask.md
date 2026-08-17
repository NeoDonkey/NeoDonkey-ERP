# A regulatory question is researched, not escalated

**2026-08-17**

## The question

When a session needs a fact it does not have — a VAT rate, a chart-of-accounts convention, which
fields EN-16931 makes mandatory — does it stop and ask the repository owner, or find out?

## The answer

It finds out. It cites a primary source, decides, and records the decision here.

## Why

This repository runs unattended for days to weeks. An issue labelled `needs-decision` is not a
cautious act in that setting; it is a stalled one. It blocks the work until someone returns, and
the person it waits for is not the best-placed party anyway: an afternoon of reading EUR-Lex, a
tax authority's own documentation or a published standard beats one person's recollection, and
the sessions doing the work can read all of it today.

The owner said it plainly on 2026-08-17: *"Nothing needs my decision. Jules + web search knows
100x more than me about VAT rules or regulatory. I don't want to be a bottleneck."*

That is also what this repository already believed. `docs/SPECIFYING.md` §2 says research is
welcome and is often better than recollection, and requires a primary source with the article or
field that applies. `AGENTS.md` §6 already drew the line in the right place: *how* Polish VAT
reporting works is researchable; *whether* Poland is in v1 is not. What went wrong on 2026-08-17
was that guidance added earlier the same day widened `needs-decision` to cover VAT rates, charts
of accounts and period-close policy — all of which are researchable — and would have produced a
fortnight of unanswered issues.

## What this does not change

**Scope.** Whether a market, a format or a feature belongs in v1 is decided in the manifesto and
the roadmap. A question answered by neither is still `needs-decision`, and it should be rare.

**The release signing key** (`COMPROMISES.md` #15 rr7). Refused for a security reason, not a
preference: a production key generated inside a public repository is worse than no key.

**The standard of evidence.** Deciding for yourself is not permission to guess. A decision without
a primary source is worse than the question it replaced, because it looks settled. Unsourced
research is not research.

## What would have to change for this to be wrong

If decisions recorded here turn out to be systematically wrong on review — sources misread,
jurisdictions confused, standards cited at the wrong version — then the bottleneck was load-bearing
and this reverts. The records in this directory are the evidence for that judgement, which is why
each one names its source and its expiry condition rather than only its conclusion.
