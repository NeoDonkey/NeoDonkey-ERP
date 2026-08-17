# Close the review loop, and stop the lanes failing silently

**2026-08-17**

Until today every review this repository produced was written to a pull request that had already
merged. `auto-merge` queued on `opened`, `test` was the only required check and takes about a
minute, and the review takes three. On #42 the pull request merged at 04:51:45 and the review —
correctly reporting that a document claimed 658 tests where the suite ran 661 — arrived at
04:53:49. Every review ever written by that workflow landed too late to matter.

Commenting harder would not have fixed it. Jules states on every pull request it opens that it will
"only act on instructions from the user who triggered this task", and the reviewer comments as
`github-actions`, so a GitHub comment is a channel Jules is required to ignore. The findings now go
through the Jules API — `sessions/{id}:sendMessage`, addressed by the session id in the pull request
body — so the reviewer talks to the session that wrote the code. It pushes to the same branch, which
re-runs the review. Three rounds, then the pull request is parked for a human.

A clean verdict is now what enables auto-merge, which means the reviewer holds the queue. The
previous design deliberately refused to allow that, on the grounds that a reviewer able to block the
queue unattended is worse than no reviewer. That reasoning still holds, and is why
`merge-sweeper.yml` exists: no verdict within 45 minutes and the pull request is released on `test`
alone. The gate can slow the queue and cannot deadlock it. `auto-merge.yml` is deleted; its job is
split between the two files.

`lane-doctor.yml` is new, and exists because of what the last five days cost. The audit lane's token
could open issues but not push a branch, so it could verify a fix and never land one. It reported
this the only way it could, by opening #14 and #17, and nothing was listening. It then re-discovered
and re-filed the same test-count drift eleven times — #13, #15, #16, #18, #19, #21, #24, #25, #37,
#39, #41 — every report correct, none of them landable. Meanwhile its provider probe began returning
`000000` instead of a status code and silently disabled itself, with no fallback key set to notice.
The doctor now tests each credential by using it, daily, and keeps one self-closing issue open while
anything is broken.

The drift fix those eleven issues were asking for landed too. `test/_probe.test.js` was
`checkout-hygiene.test.js` with `console.log` lines injected, and the `test/*.test.js` glob counted
it as real coverage; `test/cp-run.mjs` was the same thing done to `c-polism.test.js`, saved under an
extension the glob never ran. Both deleted. The count is guarded in two halves now:
`test/documented-counts.test.js` proves the documents agree with each other, and a step in `ci.yml`
proves they agree with the suite as actually run. Only CI can do the second — a test cannot count the
run it is part of.

Three faults were found by running things rather than reading them, which is worth recording because
each had been invisible:

- The sweeper's own listing query. `gh pr list --json commits` over 100 pull requests exceeds
  GitHub's GraphQL node limit and the whole query fails — but the redirect still creates the file,
  the file is empty, the loop runs zero times, and the job reports "swept: 0" and exits green. Every
  deadline in the file would have gone unenforced while the badge stayed green.
- The OpenRouter fallback named `deepseek/deepseek-v4-flash:free`, which does not exist. It answered
  404. Nobody had seen it because the key was unset, so the branch had never run: an untested
  fallback and an absent one look identical from outside.
- The reviewer ate its own review. It tried to commit, hit a checkout with no git identity, and
  posted git's "Author identity unknown" as its review.

Finally, the journal moved. See `docs/JOURNAL.md` for why: entries are one file each now, because
"add an entry at the top" made every parallel session conflict with every other one.
