# Journal Entry: Specify Scale Benchmarks, Columnar Projection Indexing, and Geometric Repacking

**Date:** 2026-08-20
**Author:** Daniel Pammé (@danielfrommunich) / Jules Session
**Job Selected:** SPECIFY

---

## Job Selection Rationale

Checked the queue state per AGENTS.md §6:
- Count of unclaimed `ready` open issues was < 3 (0–1 unclaimed issues).
- Per AGENTS.md §6 routing rules, fewer than 3 unclaimed `ready` open issues triggers a **SPECIFY** task to replenish the engineering pipeline.

---

## Research & Specification Summary

Specified performance benchmarking methodology and columnar projection read-path architecture serving **Gate Condition 7** ("Scale is measured, not asserted") and Foundation Decisions **FD-2** (Geometric Repacking) and **FD-10** (Columnar Typed Array Projection & Lazy Materialization).

### Primary Sources Cited
1. `docs/ROADMAP-V1.md` Part 1 FD-2 (Packed Object Storage & Geometric Repacking bounds)
2. `docs/ROADMAP-V1.md` Part 1 FD-10 (Read Path Columnar Projection Indexing & Lazy Materialization)
3. `docs/ROADMAP-V1.md` Part 2 Gate Condition 7 (10M Objects & 1M Documents Benchmarks)
4. Git Packfile v2 & Index v2 Specification (`Documentation/technical/pack-format.txt`)
5. ECMA-262 ECMAScript Language Specification § 23.2 TypedArray Objects (`BigInt64Array`, `Int32Array`)

---

## Deliverables Created

1. **Decision Record:** `docs/decisions/2026-08-20-scale-benchmarks-and-columnar-index-materialization.md`
   - Defines architecture and memory limits for Git objects and document read-path queries using contiguous TypedArrays (`BigInt64Array`, `Int32Array`).
   - Includes non-circular technical prerequisites section under `## What Must Land First`.
   - Decomposes into two concrete, `ready` issue specifications with explicit non-negotiable constraints and deterministic metrics.

2. **Unblocked Issue Specifications:**
   - `feat(index): implement columnar projection typed arrays and lazy document materialization` (`area:runtime`, `p1`, `ready`)
   - `test(benchmark): 10M object packfile geometric repacking and 1M document index query benchmark suite` (`area:tests`, `p1`, `ready`)

3. **Planning File Update:** Updated `docs/NEXT.md` under "Newly Specified Standards & Unblocked Implementable Issues".

---

## Verification

- `npm test`: Executed full Node native test suite (680 tests, 678 pass, 2 skipped, 0 fail).
- Hygiene tests verified journal entry and decision record structure and citations.
