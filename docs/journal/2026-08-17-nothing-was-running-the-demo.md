# Nothing was running the demo

**2026-08-17**

`demo/sarah.mjs` describes itself as "the acceptance test for the whole MVP", and it earns the
description. It builds a company from nothing, then hands the folder to software that never met us
and asks what it thinks: `git fsck --strict` clean, real `git` verifying a good signature on all
fourteen commits, real `ssh-keygen` on the allowed-signers file, every posting naming the written
rule that authorised it, and a checkout of the first commit yielding a readable company rather than
a log.

It is run by no workflow, no test and no npm script.

It works today — one second, exit 0. Nothing would have told anyone the day it stopped, and the
commit that broke it would have been weeks behind by the time it was noticed. This is also the one
artefact you would put in front of another person: the thing that demonstrates an ERP with no
server, no vendor and no dependencies actually working, checked by tools with no stake in the
claim. A demo discovered broken is a launch discovered broken.

So `ci.yml` runs it now, blocking, for a second of runner time.

The wider point, which is worth more than the fix: the loop built today is very good at keeping
work moving and has no opinion whatsoever about whether the product works. It gates on the suite
and on a reviewer reading a diff. Both can stay green while the thing a person would actually look
at rots. `docs/ROADMAP-V1.md` Part 2 states ten conditions and opens with "I will not recommend
publication until all ten hold" — which is a precise, machine-checkable definition of ready, and
nothing computes it. Filed as the next two items: score the gate, and let sessions choose work by
which condition it closes.
