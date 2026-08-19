# A push revokes the approval, or the gate only ever held once

**2026-08-19**

#71 merged with refused findings, and then the loop said in writing that it could not have.

```
10:30:13  review round 1 → VERDICT: CLEAN        → queue enabled auto-merge
          (a new commit is pushed)
10:35:00  test green on the new commit
10:35:03  MERGED, on `test` alone
10:35:55  review round 2 → CHANGES_REQUIRED
10:36:03  "Nothing merges until a round comes back VERDICT: CLEAN"
```

GitHub's auto-merge, once enabled, survives every subsequent push and fires the moment the
**required** checks pass. `review` is deliberately not required — making it required would let a
dead provider deadlock the queue, which this repository decided against on 2026-08-17 — so `test`
alone is what auto-merge waits for. The gate therefore held for the first round and was bypassed by
every round after it. Every multi-round pull request has been merging on its first clean verdict
since the loop was built.

The second review was right, too. It found that all three decision records in #71 duplicated the
ones in #62 and #63 — the duplicate-record rule added the day before, working exactly as intended,
sixty seconds too late to matter.

Each push now withdraws the standing approval, and only a clean verdict on that commit puts it
back. `merge-sweeper` clears auto-merge from anything carrying `review:changes-requested` as well,
because the withdrawal job and `test` run in parallel and a very fast suite could still beat it.

Worth naming what this was: not a failure of the reviewer, the relay, the sweeper or the agents.
Every one of those did its job. The approval simply outlived the thing it was granted for, which is
the same shape as the four failures on 2026-08-17 — something that could not tell a state that had
expired from one that still held.
