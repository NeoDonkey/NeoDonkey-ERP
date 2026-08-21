# The behavioural pin compromise #13's closure asked for

**2026-08-21**

Issue #44 listed four conditions for believing compromise #13 was really closed. Three held the
moment #29 landed this morning: the candidate loop is gone from `runtime/ui/fields.js`, every
information entity with a displayable label declares `## Displayed by`, and the register counts
#13 among the twelve closed entries in Part 2. The fourth did not exist yet: a test asserting
that `displayLabel` refuses the conventional fallback — that an entity declaring nothing gets
the id, not its `name` field.

What existed instead was a source guard (`the UI knows exactly one conventional field name`,
`test/g-ui.test.js`), which pins the vocabulary by string search over `fields.js`. That guard
would catch re-adding `'name'` as a literal, but only because the starter model happens to
declare a field literally named `name`; it says nothing about what the display path *does*.
The closure's own verification note called for behaviour, so this adds it:

- `displayLabel({ id, name }, entityWithNoDeclaration)` is `{ text: id, from: 'id' }` — before
  #29 it returned `{ text: name, from: 'name' }`.
- `columnsFor` on the same entity puts declared fields ahead of any name-ish accident — before
  #29 the candidate loop put `name` second.

Checked both ways, per house rule: against `8094a9f` (the parent of the closure commit) the new
test fails with `actual: { text: 'Gate West', from: 'name' }`; on the current runtime it passes.
The suite otherwise reports 694 tests, 690 passing, 2 skipped — the two failures are the
`tmp-debug.mjs` redness already claimed by PR #113, reproduced identically on stashed main.

Closes #44.
