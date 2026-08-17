# Drafting a pull request needs a user token, and the sweeper claimed otherwise

**2026-08-17**

`merge-sweeper` ran for the first time on main and reported that it had converted #29 to a draft.
It had not. The label was applied and the comment was posted, but the pull request was still open,
and the log said why:

```
API call failed: GraphQL: Resource not accessible by integration (convertPullRequestToDraft)
```

`GITHUB_TOKEN` is a GitHub App installation token, and the `convertPullRequestToDraft` mutation is
not available to Apps. Every place this loop parks something was doing that: the sweeper's conflict
rule, its ghost-parking rule, and the round cap in `review`. All three failed silently, because the
call was wrapped in `|| true` — appropriate for something optional, wrong for something the comment
then asserts as fact.

Two things were wrong, and only one of them was the token.

The token part is fixed by trying `AGENT_PAT` first, which is a user token and permitted the
mutation, and falling back to `GITHUB_TOKEN`. But the more useful correction is that **the label,
not the draft, is what stops a pull request.** `review` now skips anything labelled
`review:parked`, and the sweeper already refused to release one. Drafting is a second signal.
Writing it that way round means a failure degrades the signal rather than the safety, and it is
why the messages now report what actually happened instead of what was attempted — a comment
claiming a pull request was drafted when it is still open is worse than no comment, because the
next reader believes it.

The `review:parked` check in the review job is not redundant with its existing draft check. Parking
tries to draft and can fail, so without the label check a parked pull request would be reviewed
again on its next push, spending provider quota to re-derive findings already sitting unanswered in
its own comments.

The same outage exposed a second thing, in the check added earlier the same day. When the listing
query fails, the sweeper now fails the run rather than reporting "swept: 0" and exiting green — and
during the outage that meant a red workflow every twenty minutes for a condition nobody could act
on, which is precisely what `agent-watchdog.yml` warns against: "a workflow that is red for a reason
nobody can act on trains everyone to ignore red."

So the two failures are now told apart, because they need opposite responses. A transient 5xx gets
three attempts and then a warning and a clean exit: the next run is twenty minutes away and every
deadline in the file is measured in hours, so one missed sweep costs nothing. Anything else is the
file being wrong, which persists until someone fixes it, and that still fails the run loudly —
naming which deadlines are going unenforced, since the original bug was a malformed query that
always failed and enforced nothing while looking healthy.

Worth recording separately: GitHub was degraded for much of this afternoon in a way its status page
never showed. `GET /repos/{owner}/{repo}/collaborators/{user}/permission` returned 503 for hours,
which is the endpoint the opencode action gates on, so **the reviewer could not run at all** — two
attempts 52 minutes apart failed identically. The GraphQL API returned 503 as well, and the push
event for the merge commit on main was never delivered, so `test` never ran there. The loop degraded
the way it was designed to: no verdict, a comment on the pull request saying so rather than a silent
pass, and release on `test` alone after the grace period. That is the correct behaviour and it is
still a weaker bar than a review, which is the argument for keeping a second provider configured.

## The gate could not pass anything

Later the same day, #49 came back `VERDICT: CLEAN` and did not merge. Neither did #48. The cause
was one line, and it was a regression introduced by this morning's split:

```
review  CLEAN → enablePullRequestAutoMerge → Resource not accessible by integration
sweeper       → mergePullRequest           → Resource not accessible by integration
```

The deleted `auto-merge.yml` held `contents: write`. When its job was folded into `review` and
`merge-sweeper`, both inherited `contents: read`, and queueing a merge needs write. So from the
moment the review loop went live, **nothing in this repository could merge at all** — which is
precisely the failure the original design refused to risk when it declined to let the reviewer hold
the queue. A gate that cannot pass anything is not strict; it is broken.

It was invisible for the same reason as everything else here: `gh pr merge` was wrapped in
`|| true`, so the sweeper announced "swept: 2 pull request(s) acted on" while merging nothing.

The fix restores the separation `auto-merge.yml` had, and for the reason it gave: "No checkout:
this job never needs the pull request's code, and running untrusted code in a job holding a write
token is how repositories get taken over." Queueing is now its own job with `contents: write` and
no checkout, gated on the review job's verdict output; the review job keeps `contents: read`
because it hands a pull request's contents to a model with tools. Permissions are declared per job
rather than per workflow, so the two cannot drift back together. Both paths now fail loudly and
comment on the pull request when they cannot queue a merge.

#49 also exposed a gap rather than a bug. Its build was red — the suite ran 664 while the documents
said 662, which is the count guard doing exactly its job — and nothing told the session that wrote
it, because the relay only fires on CHANGES_REQUIRED. It would have sat until the seven-day abandon
sweep closed it. A failing build now goes back to the authoring session the same way review findings
do, once per failing commit, with the tail of the failing run attached. A red build is the more
useful of the two messages: it is a fact rather than an opinion, and the output names what to change.
