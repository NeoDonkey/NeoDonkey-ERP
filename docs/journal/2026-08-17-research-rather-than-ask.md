# The owner is not the bottleneck, and never should have been

**2026-08-17**

Earlier today `docs/NEXT.md` and the session prompt were changed to route domain questions — VAT
rates, chart-of-accounts conventions, period-close policy — into `needs-decision` issues for a
human to answer. That was wrong, and it was wrong in the same direction as the thing it replaced.

The file first said "leave it", so the Wave 5 wall stayed a wall and nobody even wrote the questions
down. Then it said "ask", which in a repository nobody reads for a fortnight produces a queue of
unanswered issues and a project that has stopped for a different reason. Both versions treated a
researchable fact as though it were somebody's taste.

It is not. A VAT rate has a gazette. A chart of accounts has a published convention. EN-16931 has a
numbered field list. `docs/SPECIFYING.md` §2 has said so all along — research is welcome, is often
better than recollection, and must cite a primary source with the article or field that applies —
and `AGENTS.md` §6 already drew the line in exactly the right place: *how* Polish VAT reporting
works is researchable and yours to establish; *whether* Poland is in v1 is not. Today's change had
quietly moved that line.

So sessions research, cite, decide, and record the decision in `docs/decisions/` — one file per
decision, same shape and for the same reason as journal entries, because three sessions run at once
and nothing rebases. A record names the question, the answer, the source, and what would have to
change for the answer to change; `test/journal-hygiene.test.js` enforces the naming and that each
record explains itself rather than only concluding.

Two things stay outside. Scope, which the manifesto and roadmap decide, and where a genuine gap is
still a `needs-decision` issue — rare, and about whether rather than how. And the release signing
key, refused for a security reason rather than a preference.

The standard of evidence goes up, not down. Deciding without asking is not permission to guess: a
decision recorded without a primary source is worse than the question it replaced, because it looks
settled. If the records in `docs/decisions/` later turn out to be systematically wrong, then the
bottleneck was load-bearing after all and this reverts — which is why each record carries its source
and its expiry condition, and not just its conclusion.
