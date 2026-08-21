# Compromise #13, actually closed this time

**2026-08-17**

`runtime/ui/fields.js` no longer contains `['name', 'title', 'label', 'description']`. The twelve
files in `operating-model/information/`, the eight `d2c-retail-europe` templates and
`runtime/ui/starter-model.js` each declare `## Displayed by`, and the runtime reads that instead.
`currency` remains, as grammar §10.7's own documented workaround for money carrying no currency.

The work is from #29, opened 2026-08-15 by a Jules session and correct on the day it was written.
It then sat for two days, was drafted by `merge-sweeper` as `stale:conflicting`, and nothing
rebased it — while #44 was filed asking for the same work to be done, because the register said
compromise #13 was already closed and the code said otherwise. Rebased and landed rather than
rewritten: reproducing verified work because a branch went stale is the most expensive way to
spend a session.

What makes this closure different from the last one is a test that could not have passed before.
`test/g-ui.test.js` pinned the runtime's conventional vocabulary at five names and now pins it at
one — `'the UI knows exactly one conventional field name, and no more'`, `CONVENTIONAL =
['currency']`. Checked both ways before landing: against `main`'s `fields.js` it fails, against
this it passes. `displayLabel` returns `from: 'displayedBy'` where it used to return `from: 'name'`.

The register entry has been rewritten to say all of this, including that it claimed closure for two
days while the compromise was still in the code. `docs/COMPROMISES.md` being wrong about itself is
the one failure this project calls real, so the entry now records the false closure alongside the
true one rather than quietly becoming correct.

The process lesson is worth more than the change. Good work went stale because the loop had no way
to rebase it, and a duplicate was nearly built on top. Branch updating now happens automatically
(#54), which removes the mechanism that stranded it — but nothing yet notices that an open pull
request already contains the work an issue is asking for, and that is what came closest to wasting
a session here.
