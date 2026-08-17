# Retry a flaky build once, and only believe the second answer

**2026-08-17**

`test` is a required check and the suite has a known flake — #46, where the relay drops frames for
a peer that is not currently in its mailbox and a sync test fails roughly one run in eight under
load. It reached CI three times today alone, on #43, #50 and #50 again.

The rate is the problem, not the failure. At six to twelve pull requests a day, one or two go red
for a reason no agent can reproduce, and each needs a human to press re-run. Nothing in this
repository presses buttons, so every one of them would sit through the twelve-hour park and the
seven-day abandon sweep. Two weeks unattended and the queue is a graveyard of correct work that
failed once.

So `merge-sweeper` now re-runs a failed `test` exactly once and only believes the second answer. A
real failure fails twice and reaches its author a sweep later; a one-in-eight flake becomes
one-in-sixty-four, which survives a fortnight.

Bounded at one attempt on purpose. A retry loop would hide a genuinely broken build forever, which
is a worse failure than the one being mitigated. The marker comment records each retry on the pull
request, so a pattern of them is evidence rather than noise — if a branch needs two attempts every
time, that is a real defect wearing a flake's clothing and the comments will say so.

This is mitigation and not a fix. #46 stays open with the diagnosis: the relay holds nothing by
design, the sync layer above it assumes delivery, and the honest repair is catch-up on reconnect
in `runtime/sync/` — git already knows how to compute what is missing between two heads.
