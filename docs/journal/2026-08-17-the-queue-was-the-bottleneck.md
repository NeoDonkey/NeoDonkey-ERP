# The loop was working. The queue was empty.

**2026-08-17**

After the review loop was closed and proven — #48 merged end to end with no human touching it —
the obvious next question was why the output still did not look like a product moving forward.

The last eight merged pull requests answer it:

```
#47 verify documentation file path citations
#42 verify error message location citations
#40 align release verification documentation
#38 add tests for refusal paths
#35 verify README claims with unit tests
#33 close compromise #13
```

Six of eight are tests about documents and documents about documents. Not one is a feature. No
session has ever written a specification: zero issues carry the `prd` label, and `docs/SPECIFYING.md`
— 133 lines, clear, binding — has never once been used.

The agents were not malfunctioning. They were obeying. `docs/NEXT.md` said "No implementation items
remain" and, of the only substantial work left, "Do not start these". So every session arrived,
found nothing authorised, and fell back to auditing. That is also the real reason the same
test-count finding was filed eleven times: an empty queue does not produce idleness, it produces
plausible-looking laps.

Meanwhile `docs/ROADMAP-V1.md` Part 3 has the actual product sitting unqueued — Wave 2's general
ledger, AR/AP, VAT and OSS returns, period close and multi-currency; Wave 3's DATEV, XRechnung, an
inbound dialect and PDF from versioned templates.

The mechanism to fix this already existed and was simply not wired up. `AGENTS.md` §6 has a table
routing a session to **specify** whenever fewer than three unclaimed `ready` issues remain — but
the scheduled session prompt never mentioned specifying at all. It said "pick up the next ready
issue, or the next item in docs/NEXT.md", so a session facing a dry queue had nowhere to go. The
prompt now implements the table: count, decide, and when specifying, read `docs/SPECIFYING.md` and
decompose from the roadmap.

`docs/NEXT.md` changed with it. "No implementation items remain" was true about the release-blocker
set and misleading about everything else, so it now says the queue being empty *is* the thing to
fix, and points at the parts of the roadmap to decompose.

The Wave 5 accounting note changed too, and this is the part worth remembering. It used to say
"leave it", because each item carries a domain decision — which opening-balance convention, which
depreciation method, what a year-end close asserts — and guessing produces an ERP that is
confidently wrong about money. That reasoning still holds for *implementing* them. But the effect
of "leave it" was that nobody wrote the questions down either, so the wall stayed a wall. Specifying
them is now wanted: state the question precisely, name the options, label it `needs-decision`. That
turns a vague blocker into a short list a human can answer in an afternoon, which is the only way
any of it moves while nobody is watching.

One stale claim fixed in passing: the audit lane's prompt asserted that "not one open issue in this
repository carries a label". True when it was written this morning, false by the afternoon. `ready`
is now a preference rather than a hard filter, and its absence means "not triaged yet" rather than
"do not touch".
