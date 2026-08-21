# Benchmarks

Measured performance numbers for the v1.0 gate condition 7, "scale is measured, not asserted"
(docs/ROADMAP-V1.md Part 2). Every number below is printed by a test run, not estimated. The
commands are listed so anyone can re-run them; the tests make no timing assertions, so a slow
machine fails nothing.

- **Date:** 2026-08-21
- **Machine:** 2-core/4GB CI-class container, Node v22.14.0
- **Commit:** fe1c185 (a checkout of main; the benchmarks ran on this code)

## Methodology

All benchmarks are `node --test` runs of gated tests. The gates exist so `npm test` stays fast;
each one is enabled by an environment variable:

```
NEODONKEY_BENCH=1 node --test test/p-pack.test.js          # 100 000-object pack benchmark
NEODONKEY_BIG_PACK=1 node --test test/p-pack.test.js       # pack larger than 2 GB (writes ~2.2 GB)
ND_SCALE=15000,150000,1000000 \
  node --expose-gc --test test/e-read.test.js              # read-path scale ladder
ND_MEM=1000000 node --expose-gc --max-old-space-size=2048 \
  --test test/e-read.test.js                               # memory ceiling at 1 M documents
```

Notes on flags, honestly stated:

- The ND_SCALE 1 000 000-invoice rung (2 125 000 documents) did not fit in this container's
  default old-space (~1.5 GB): materialisation died with "JavaScript heap out of memory". The
  numbers below come from a re-run with `--max-old-space-size=2816`. The 15 000 and 150 000 rungs
  ran with the default heap.
- The ND_MEM run used the recipe documented in test/e-read.test.js (`--max-old-space-size=2048`,
  a conservative browser tab).
- Each figure is from a single run on a shared CI-class container. No variance statistics.

## Object store: 100 000 objects, loose vs packed

test/p-pack.test.js, `NEODONKEY_BENCH=1`. 100 000 small JSON documents, mean 111 bytes each,
written through the packed store. Ends with `git fsck --strict` passing on the repacked repo.

| Measurement | Value |
|---|---|
| Loose write | 85 316 ms (853 us/object) |
| Loose on disk | 409 868 KiB in 100 000 files |
| writePack + index | 28 859 ms (289 us/object) |
| Pack bytes / index bytes | 10 935 426 / 2 801 072 |
| Repack (verified) | 162 268 ms into 4 packs |
| Packed on disk | 13 452 KiB in 8 files |
| 10 000 random reads through the pack | 4 415 ms (442 us/read) |
| Disk factor, packed vs loose | 30.5x smaller, 12 500x fewer files |

## The cost of not writing deltas

Same file, ungated test, our pack format (no deltas) next to git's own pack (deltas) for the
same object sets:

| Corpus | git with deltas | ours, no deltas | factor |
|---|---|---|---|
| Eight revisions of 300 documents (2 424 objects) | 115 343 bytes | 1 428 666 bytes | 12.39x |
| 500 distinct documents (504 objects) | 64 882 bytes | 100 307 bytes | 1.55x |

The worst case is versioned documents, which is what delta compression exists for. On distinct
documents, the honest half of the comparison for an ERP's first year, the cost is 1.55x.

## A pack larger than 2 GB: the 64-bit offset path

test/p-pack.test.js, `NEODONKEY_BIG_PACK=1`. 529 incompressible 4 MB objects.

| Measurement | Value |
|---|---|
| Pack written | 2 219 471 903 bytes in 112 757 ms |
| Objects past 2 GiB (64-bit offset table in use) | 17 |
| git verify-pack -v | `.pack: ok`, offsets identical to ours |
| git fsck --strict | exit 0; 529 "dangling blob" notices (the repo has no refs), no errors |

## Read path: materialisation and query at scale

test/e-read.test.js, `ND_SCALE=15000,150000,1000000`, columnar projection on (the default).
Each rung is N invoices + N postings + N/8 customers.

| | 15 000 invoices | 150 000 invoices | 1 000 000 invoices |
|---|---|---|---|
| Documents | 31 875 | 318 750 | 2 125 000 |
| Materialise | 408.5 ms | 3 990.7 ms | 26 092.4 ms |
| per document | 12.82 us | 12.52 us | 12.28 us |
| Incremental update, 100 changed invoices | 3.394 ms | 4.121 ms | 11.8 ms |
| Appendix VI query, cold (index build included) | 104.0 ms | 1 076.8 ms | 8 455.5 ms |
| Appendix VI query, warm (mean / best) | 2.835 / 0.748 ms | 13.7 / 9.143 ms | 135.1 / 109.3 ms |
| Indexed equality lookup, warm best | 0.007 ms | 0.004 ms | 0.005 ms |
| Range query (total >= 39 000.00 EUR), warm best | 0.260 ms | 3.200 ms | 51.7 ms |
| Point lookup by id, warm best | 0.003 ms | 0.001 ms | 0.004 ms |
| Trial balance over all postings, warm best | 0.911 ms | 0.474 ms | 1.325 ms |
| Heap, documents only | 19 MB (126 B/doc) | 129 MB (190 B/doc) | 733 MB (182 B/doc) |
| Heap, with 6 field + 1 aggregate indexes | 23 MB | 179 MB | 1 035 MB |

Appendix VI is the roadmap's own example: a join plus four predicates plus a sort, over FD-1
money strings. Its warm cost grows with the candidate set, not the document count; cold cost
is dominated by building the indexes the query needs, and is printed because "warm" alone
would be a half-truth.

## Read path: the memory ceiling in documents

test/e-read.test.js, `ND_MEM=1000000`, heap limit 2 096 MB (the flag asks for 2048; Node rounds
up). 1 000 000 posting documents, two field indexes, one maintained aggregate:

| Measurement | Value |
|---|---|
| Materialise | 18.4 s |
| Heap, caller's tree map | 148 MB (155 B/path) |
| Heap, index (documents + 2 field + 1 aggregate) | +298 MB (313 B/doc) |
| Heap, all-in | 454 MB |
| Trial balance (400 accounts) | 1.579 ms |
| Sum over one account | 0.008 ms |
| Point lookup by id | 0.005 ms |

At 313 B/doc all-in with columnar projection, the 2 GB browser-tab budget holds on the order of
5 M documents of this shape. FD-10 in docs/ROADMAP-V1.md records the pre-columnar figures this
improves on (415 B/doc, GC-bound at 3 M, out of memory at 4 M).

## What these numbers do not cover

- **10 M objects.** The roadmap's headline figure is 10 M objects; the pack benchmark measured
  100 000. The 2.2 GB pack proves the format past the 32-bit offset boundary, not the 10 M
  object count. A 10 M run needs a machine with more than 4 GB of RAM and was not attempted here.
- **Commit path.** No commit-time benchmark exists; commit cost is not measured.
- **Query against a git-backed source.** The read-path ladders synthesise their repo in memory,
  by design, so the harness is not the thing measured. Materialisation from a real packfile,
  which pays pack reads and inflate per document, is not measured.
- **Browser and OPFS.** All runs are Node on Linux. Nothing above says anything about a browser
  tab beyond the heap budget chosen for the ceiling run.
- **Sync.** Network and CRDT merge cost at scale are not measured.
- **Variance.** Single runs on a shared 2-core container. The suite's own 20 000-document
  benchmark runs on every `npm test` and gives a rough tripwire (full materialise 218.6 ms,
  10.9 us/doc, on this machine), but these are point measurements, not distributions.
