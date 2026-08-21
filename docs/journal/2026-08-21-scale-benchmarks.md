# Scale benchmarks run and published; gate 7 goes green

2026-08-21, lane B (audit/chores). Gate condition 7: "scale is measured, not asserted".

## What was done

The benchmarks already existed as env-gated tests (test/p-pack.test.js, test/e-read.test.js);
what was missing was anyone running them and writing the numbers down. Ran all four on a
2-core/4GB CI-class container, Node v22.14.0, and published the results in docs/BENCHMARKS.md:

- `NEODONKEY_BENCH=1 node --test test/p-pack.test.js`: 100 000 objects, loose vs packed.
  Loose write 85.3 s, writePack+index 28.9 s, verified repack 162.3 s, packed 30.5x smaller
  on disk, 10 000 random reads through the pack at 442 us/read, `git fsck --strict` clean.
- `NEODONKEY_BIG_PACK=1`: a real 2.2 GB pack (529 objects, 112.8 s to write), 17 objects past
  2 GiB through the 64-bit offset table, `git verify-pack` and `git fsck --strict` both clean.
- `ND_SCALE=15000,150000,1000000`: the read-path ladder to 2 125 000 documents. Materialise
  holds at ~12.3-12.8 us/doc across the ladder; trial balance over 1 M postings 1.325 ms warm.
- `ND_MEM=1000000`: 1 M documents in 454 MB all-in with columnar projection (313 B/doc),
  against the 2 GB heap FD-10 uses as the browser-tab budget.

Two honest wrinkles, both recorded in the doc: the 1 M scale rung needed
`--max-old-space-size=2816` on this container (the default ~1.5 GB old-space OOMed during
materialisation), and the 10 M object headline figure from the roadmap was not run because it
does not fit in 4 GB of RAM. The doc has a "what these numbers do not cover" section.

## What changed

- `docs/BENCHMARKS.md` (new): date, machine class, methodology, results tables, coverage gaps.
- `test/gate-score.test.js`: condition 7 red to green, evidence docs/BENCHMARKS.md plus the
  two test files that print the numbers; `docs/GATE.md` regenerated. Score is now 7 green,
  1 partial, 2 red.
- No existing test touched; no threshold changed.

## Not done

- 10 M object pack run (needs a bigger machine).
- Commit-path and git-backed materialisation benchmarks do not exist yet; both are named as
  gaps in docs/BENCHMARKS.md rather than smoothed over.
