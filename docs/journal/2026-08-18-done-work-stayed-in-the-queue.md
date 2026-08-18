# Done work stayed in the queue, and three sessions specified the same thing

**2026-08-18**

The team shipped overnight and two silent faults showed up in what it shipped. Neither was in the
code; both were in how the loop is wired, and both would have compounded over a week.

## Merged pull requests did not close their issues

#64 said "Closes #55" and merged. #68 said "Closes #57" and merged. GitHub recorded both links —
`closingIssuesReferences` shows them — and both issues were still open the next morning, with no
`closed` event and no error anywhere.

The cause is a permission. GitHub closes a linked issue on merge only if the token performing the
merge could have closed it directly, and the `queue` job in `opencode-review.yml` held
`contents: write` and `pull-requests: write` and nothing else. It merged, the link was recorded,
the close was declined in silence.

The cost is not tidiness. A closed issue is how the queue tells the next session that work is
finished. #46, #55 and #57 all had merged fixes and all still read as available, and #44 had
already nearly caused #29's work to be built twice for the same reason. `issues: write` added.

## Specifying had no claim, so three sessions took the same roadmap lines

Implementing is claimed by a draft pull request that says "Closes #N" — that mechanism has worked
since it was written. Specifying had nothing equivalent, and when the queue ran dry three
concurrent sessions all routed to SPECIFY and all reached for the same part of Wave 2: DATEV EXTF
in #62 and #63, EN-16931 in both, period close in both, and OSS in #63 after #66 had already
merged a record for it.

Two decision records about German VAT that disagree are worse than one, because nothing says which
is binding and the product implements whichever was read last. This is the same collision the
journal split fixed for entries, arriving through a door nobody had shut.

Sessions now claim a topic the same way they claim an issue: list the open pull requests and
`docs/decisions/`, pick something nobody has in flight, and open a draft pull request titled with
the topics before researching anything. The reviewer refuses a record duplicating an existing one
unless it says explicitly that it supersedes it.

## Worth saying plainly

The overnight work was good. The atomic-write fix in #67 is a better diagnosis of the #46 flake
than the one this repository had from me: a reader observing a partially written file explains a
0-byte pack index far more directly than the relay theory did, and `nodeFs.write` now writes to a
temporary name and renames. `docs/GATE.md` scores the ten v1.0 conditions at five green, one
partial, four red — and the four reds are the right four. Nobody flattered anything.
