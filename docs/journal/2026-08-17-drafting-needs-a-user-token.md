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

Worth recording separately: GitHub was degraded for much of this afternoon in a way its status page
never showed. `GET /repos/{owner}/{repo}/collaborators/{user}/permission` returned 503 for hours,
which is the endpoint the opencode action gates on, so **the reviewer could not run at all** — two
attempts 52 minutes apart failed identically. The GraphQL API returned 503 as well, and the push
event for the merge commit on main was never delivered, so `test` never ran there. The loop degraded
the way it was designed to: no verdict, a comment on the pull request saying so rather than a silent
pass, and release on `test` alone after the grace period. That is the correct behaviour and it is
still a weaker bar than a review, which is the argument for keeping a second provider configured.
