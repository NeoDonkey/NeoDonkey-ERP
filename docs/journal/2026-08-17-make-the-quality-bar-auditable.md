# Make the quality bar auditable, so nobody has to be a bottleneck

**2026-08-17**

The loop landed today keeps work moving and merges only what passes `test` and a review. That is
enough to keep a repository alive. It is not enough to promise a product without compromises,
because three of the things that would erode one leave no trace anybody can find later.

**An unreviewed merge was invisible in hindsight.** When no verdict arrives within the grace
period, `merge-sweeper` releases the pull request on `test` alone — deliberately, so a rate-limited
reviewer cannot stop the project. It commented at the time, and that was all. Over a fortnight of
provider limits that could be a dozen changes that never met the AGENTS.md checks, and no way to
enumerate them afterwards. They are labelled `merged:unreviewed` now, before the merge is queued,
so the question "what got in without a review" is a search rather than an archaeology project.

**An undocumented compromise was nobody's finding.** `AGENTS.md` says plainly that the only real
failure mode this project has is a compromise that is *not* in the register, and nothing checked.
The reviewer's refuse-worthy list now includes a shortcut taken without an entry in
`docs/COMPROMISES.md` — a hardcoded value that belongs in the operating model, a happy path with no
other path, a swallowed error, a "for now". Taking the trade-off is allowed; this project ships
real ones. Not writing it down is the thing that compounds, because the next session cannot see it
and builds on top.

The same edit gave the reviewer an asymmetry it did not have. Refusing good work costs three relay
rounds and a parked pull request — recoverable by a human in a minute. Passing a silent compromise
costs a defect the next session builds on. So: when uncertain about money, authorisation,
signatures, the ledger, or a claim a reader would rely on, refuse. Everywhere else, pass and say
the nit.

**Returning was expensive.** Reconstructing a fortnight from fifty merged pull requests is work,
and the parts most worth knowing do not announce themselves in a commit list. `state-of-the-project`
rewrites one issue daily: what merged without a review first, then what the sessions decided on
their own authority, then what touched the register, then what shipped, what is stuck, and how the
queue looks. It reports and decides nothing. Every section is a query anyone can re-run, which
matters because the numbers come from labels and git history and agents write both.

None of this makes the product good. It makes the difference between a good product and a plausible
one *visible* — which is the only version of "no bottleneck" that is not just "no oversight".
