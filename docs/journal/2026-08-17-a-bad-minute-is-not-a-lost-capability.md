# A bad minute is not a lost capability

**2026-08-17**

`lane-doctor` opened #52 — "an autonomous lane has lost a capability" — on the strength of a 503
from GitHub's comment endpoint and a 500 from the Jules API. Both were transient. Sixty seconds
later the same probes returned 201 and 200.

The check was right that something failed and wrong about what it meant. A 5xx or a dead socket is
the service having a bad minute; a 401, 403 or 404 is a capability that has actually been taken
away. They need opposite responses — wait, versus go and fix the token — and reporting them
identically is how a daily check earns a reputation for crying wolf. That matters more than usual
here, because the repository's own rule is that a workflow red for a reason nobody can act on
trains everyone to ignore red, and this check is designed to keep one issue open until a human
acts on it.

Over a fortnight unattended, with GitHub as unreliable as it was today, the old behaviour would
have left a permanent alarming issue that meant nothing — and buried a real credential failure
inside it.

So a 5xx now reports **could not test** and does not count as broken. Only a definite refusal does.
The bar is deliberately conservative: an inconclusive check is never treated as a pass in the other
direction either, so a genuinely revoked token still shows up the first time it is refused.

## The same lesson, a third time

Within the hour it turned up twice more, in the two places that actually merge things. GitHub
returned 503 on `gh pr merge` for #49 — first from the `queue` job, then from `merge-sweeper`
twenty minutes later — while its status page reported all systems operational.

Neither was wrong to fail. Both were wrong to go red about it. The sweeper runs every twenty
minutes and would have queued that pull request the moment GitHub recovered, so the cost of a
transient failure is twenty minutes and nothing else; the cost of going red is a badge that has
been alarming for hours by the time anyone looks, about a condition nobody can act on.

So both now retry three times, and treat a 5xx as a warning rather than an error. A real refusal —
a permission the token does not have, a branch protection rule unmet — still fails loudly, because
that one does need somebody.

Three times in one day is a pattern worth naming: **the failure mode of this whole loop is not
doing the wrong thing, it is being unable to tell "not now" from "not ever".** The listing query,
the capability checks and the merge calls each learned it separately. Anything added here later
should be written knowing it.
