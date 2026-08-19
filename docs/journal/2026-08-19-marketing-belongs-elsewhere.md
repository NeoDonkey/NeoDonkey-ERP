# Marketing belongs in the other repository

**2026-08-19**

Eight files under `marketing/` — launch strategies for HN, Reddit, LinkedIn and X, a buyer persona,
a landing-page hero and a blog draft — were pushed directly to `main` on 2026-08-18, bypassing the
pull request loop. Removed at the owner's request: that work continues in a separate repository.

Two reasons it does not belong here, beyond the owner's preference.

This repository is public and it is the product. Its own standard is that every sentence in the
README should be verifiable by running something, and `docs/GATE.md` scores the ten conditions that
decide whether it may be published at all. Launch copy sitting in the same tree invites a reader to
treat a claim and a promise as the same kind of statement, which is precisely the confusion
condition 10 exists to prevent.

The second reason is about the agents. Sessions choose work by reading the repository, and a
`marketing/` directory is an inviting, unguarded surface: no tests, no register, no gate condition,
plenty of scope to look productive. An agent polishing a landing page while believing it is
advancing the product is a failure mode this loop would not have caught, because everything it
checks would have stayed green.

`.gitignore` now excludes the path, so a future push does not quietly restore it.

**What this does not do.** The files are gone from `main`, not from history — they remain in every
clone and in anything that indexed the repository between 2026-08-18 and today. If any of it was
genuinely not meant to be public, removing it from the tip is not enough and the owner should say
so; the fix would be a history rewrite and a force push, with every open branch rebased afterwards.
Recorded here rather than assumed either way.
