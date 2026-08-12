// runtime/ui/kernel-gaps.js — the things the UI needs that runtime/kernel.js does not offer.
//
// This file exists so that every reach around the kernel's public surface is in ONE place with a
// name, rather than smeared through the views. Each entry is a bug report with an implementation
// attached, and should disappear when the kernel gains the API it is missing. Nothing else in
// runtime/ui/ touches `_internals` — test/g-ui.test.js enforces that.
//
// The kernel is not mine to edit (CONTRACT: "Never edit another agent's files or
// runtime/kernel.js"), so these are reported rather than fixed at the source.
//
// FIXED WHILE THIS UI WAS BEING WRITTEN, recorded because it shaped the code and because it is
// the most serious thing found: `perform()` used to leave the index stale after every write.
// `refreshIndex()` passed `changed` as an array of bare path strings to
// `read/index.js#update()`, which expects `[path, key]` pairs — `toEntries()` turned each string
// into `[undefined, null]`, so the committed document was never ingested, and nothing threw, so
// the `catch`-and-rebuild fallback never fired. Measured effect: create a customer, then
// `kernel.query.entities()` is `[]`; and since `world()` reads the same index, the *rule engine*
// was blind to anything written in the same session, so `order exists` failed and the
// goods-receipt reference process could not complete. The kernel now passes `[path, path]` and
// records any fallback in `kernel.warnings` instead of swallowing it. Verified fixed: the full
// goods-receipt chain, including the created-on-demand stock row, now runs with no help from
// this file. Keep the lesson: an index that silently fails to update is indistinguishable from
// a rule engine that is wrong.

/**
 * GAP 1 — there is no way to READ an operating-model file.
 *
 * `kernel.amendOperatingModel(path, text, message)` writes one, and `kernel.model` exposes the
 * parsed result, but nothing returns the *text* and nothing lists the paths. Requirement 5 of
 * the UI brief — browse `operating-model/**`, view a file, edit it — is therefore not
 * implementable through the public surface at all. `mcp/server.mjs` has the identical problem
 * and solves it the identical way (`read_operating_model_file` reads `k._internals.files`), so
 * this is the established workaround rather than something invented here.
 *
 * Needed: `kernel.operatingModel(): Map<path, string>`, or `readOperatingModel(path)` plus
 * `listOperatingModel()`.
 */
export function operatingModelSources(kernel) {
  const dec = new TextDecoder();
  const out = new Map();
  const files = kernel?._internals?.files;
  if (!files) return out;
  for (const [path, bytes] of files) {
    if (path.startsWith('operating-model/') && path.endsWith('.md')) out.set(path, dec.decode(bytes));
  }
  return new Map([...out.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * GAP 2 — parse *warnings* never reach a caller, and there are twenty of them.
 *
 * `kernel.modelErrors` is `parsed.errors.filter(e => e.severity === 'error')`. The warnings are
 * dropped inside `loadModel()` and are not recoverable. (`kernel.warnings`, added later, is a
 * different thing: runtime problems such as an index rebuild, not diagnostics about the text.)
 *
 * This is not hypothetical. The operating model this repo ships parses with 0 errors and **20
 * warnings**, and every one of them is the diagnostic grammar §7 promises to emit: "this
 * consequent matches the trigger of the rule at <file>:<line>, and consequents do not cascade in
 * grammar version 1, so that rule will not fire." That is precisely the class of thing an author
 * must see — a rule she wrote that will never run — and there is no way for this UI to show it.
 *
 * A deliberate non-decision (no cascading) plus an undeliverable warning adds up to a silent
 * one, which is the exact failure Principle 6 exists to prevent. It is the most consequential
 * gap remaining.
 *
 * There is no workaround that does not re-parse the model, and re-parsing would mean importing
 * runtime/polism/ into the UI — which the brief forbids and which would be the wrong fix anyway
 * (two parses can disagree). So this is reported and left visibly undone.
 *
 * Needed: `kernel.modelWarnings`, or `kernel.diagnostics` carrying both severities.
 */
export const MODEL_WARNINGS_UNAVAILABLE =
  'Parse warnings cannot be shown: kernel.loadModel() keeps only severity "error". The shipped '
  + 'operating model currently has 20 warnings — grammar §7 non-cascade notices, each naming a '
  + 'rule that will never fire. See runtime/ui/kernel-gaps.js GAP 2.';

/**
 * GAP 3 — a refusal does not carry the author's own sentence.
 *
 * `perform()` maps each violation through `quoteRule(rule)`, which *reconstructs* a normalised
 * sentence from the AST ("If create goods-receipt under condition quantity > 0 and …"). The
 * verbatim text the author typed is right there on `rule.text` — CONTRACT amendment 18 added it
 * for exactly this purpose — and is discarded. It also drops the executor's own
 * `Violation.file` / `.line` in favour of `rule.source`, so a violation with no rule behind it
 * (a missing required field, say) arrives with `at: null` and loses its position entirely, even
 * though the executor knew it.
 *
 * Workaround: `refusalView()` looks the rule up in `kernel.model.processes` by the `file:line`
 * in `at`, then quotes the file itself. That is what lets the refusal screen show the real line,
 * with the author's own capitalisation and line breaks, and it is why `refusalView()` has to be
 * handed the model and the sources.
 *
 * Needed: pass `rule.text` through, and keep the violation's own `file`/`line`.
 */
export function refusalNeedsModelLookup() {
  return true;
}

/**
 * Runtime warnings the kernel *does* now expose. Surfacing them is not optional: a fallback that
 * nobody sees is the same as a fallback that did not happen, and the index bug above is exactly
 * what that costs.
 */
export function runtimeWarnings(kernel) {
  return (kernel?.warnings ?? []).map((w) => ({
    at: w.at ?? null,
    message: w.message ?? String(w),
    oid: w.oid ? String(w.oid).slice(0, 8) : null,
  }));
}
