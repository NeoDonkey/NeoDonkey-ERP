# Decision Record: Scale & Performance Benchmarking Methodology, Columnar Projection Indexing, and Packfile Geometric Repacking

**Status:** DECIDED
**Date:** 2026-08-20
**Roadmap Reference:** `docs/ROADMAP-V1.md` Part 1 (FD-2, FD-10), Part 2 (Gate Condition 7)
**Authors:** Daniel Pammé (@danielfrommunich) / Jules Session

---

## Source

Primary authoritative specifications and roadmap requirements governing scale and performance bounds:

1. **`docs/ROADMAP-V1.md` Part 1 FD-2 (Packed Object Storage & Geometric Repacking):**
   > *"Implement packfile v2 (read and write) plus .idx v2, and repack when loose objects exceed a threshold... Target to prove, on real hardware: 10 million objects, `git fsck --strict` clean, our own `log()` and `readTreeAtHead()` within stated bounds. Plus a pack-count and resident-memory bound... Geometric repacking (git's `--geometric`) is the answer."*

2. **`docs/ROADMAP-V1.md` Part 1 FD-10 (Read Path & Columnar Projection Indexing):**
   > *"The read path must hold a decade, not a year. Columnar projection is v1.0 work... Required for v1.0, in this order: 1. Columnar projection. A dense typed array per index — `BigInt64Array` of minor units for money, integers for dates — so a filter walks one compact array instead of chasing pointers... 2. Lazy materialisation. Hold indexed values plus the path; fetch documents from git on demand... 3. Composite indexes where measurement justifies them."*

3. **`docs/ROADMAP-V1.md` Part 2 Gate Condition 7 (Scale is Measured, Not Asserted):**
   > *"Condition 7 — Scale is measured, not asserted [RED]. Published performance benchmarks for 10 M objects, 1 M documents materialisation, query, commit, and git fsck."*

4. **Git Packfile v2 & Index v2 Specification:**
   - Git open-source specification: `Documentation/technical/pack-format.txt` (Git SCM).
   - Specifies packfile v2 byte header (`PACK` magic, version 2), object entries (compressed zlib/deflate, `OFS_DELTA`, `REF_DELTA`), and `.idx` v2 fan-out table (256 4-byte network byte order offsets, SHA-1 table, CRC-32 table, offset tables).

5. **ECMA-262 ECMAScript Language Specification § 23.2 TypedArray Objects:**
   - Standard Web & Node.js API specification for contiguous binary memory structures (`BigInt64Array`, `Int32Array`).
   - Guarantees cache-local memory layout (8 B per BigInt minor unit, 4 B per Epoch timestamp integer) without per-document JavaScript object overhead (~400 B/doc).

---

## Context & Decision

NeoDonkey's core promise is that a company lives inside a Git repository without cloud, server, or vendor lock-in. To support a 500 M€ enterprise over a ten-year operational lifecycle, the system must handle 3–5 million documents per year and over 10 million Git objects without exceeding browser tab memory constraints (~2 GB heap) or degrading query performance due to garbage collection pressure.

### Key Architecture Decisions

1. **Columnar Typed Array Projection Indexing:**
   - Move from JS object-per-document pointer graphs to dense TypedArray structures (`BigInt64Array` for monetary values in minor units, `Int32Array` for Unix epoch timestamps/dates) within `runtime/read/index.js` and `runtime/read/query.js`.
   - Filter operations walk compact TypedArrays sequentially in memory before materializing full JS document objects.
   - Per-document memory footprint on indexed fields is reduced from ~415 B down to ~12 B.

2. **Lazy Document Materialization:**
   - Index lookup returns document path references (`pack` offset or Git loose object path) rather than deserializing full JSON document payloads.
   - Full document parsing and POLISM entity materialization occur asynchronously on demand only for matching result sets (`where()`, `get()`).

3. **Geometric Packfile Repacking:**
   - Implement geometric repacking (`--geometric 2`) in `runtime/git/pack.js` to limit packfile proliferation.
   - When loose objects or small packfiles accumulate, repacking merges smaller packs into geometrically larger packs ($2^0, 2^1, 2^2, \dots$), keeping total pack count bounded under geometric thresholds.

---

## Unblocked Issue Specifications

This decision record has no unlanded technical prerequisites and directly defines two unblocked `ready` issue specifications below for implementation once filed as GitHub issues:

### Issue Specification 1: Columnar Projection Typed Arrays & Lazy Materialization

- **Title:** `feat(index): implement columnar projection typed arrays and lazy document materialization`
- **Roadmap Source:** `docs/ROADMAP-V1.md` Part 1 FD-10 & Part 2 Gate Condition 7
- **Decision Record:** `docs/decisions/2026-08-20-scale-benchmarks-and-columnar-index-materialization.md`
- **Labels:** `area:runtime`, `p1`, `ready`
- **Description:**
  Implement dense columnar typed array indexing (`BigInt64Array` for minor monetary units, `Int32Array` for date timestamps) within `runtime/read/index.js` and `runtime/read/query.js` to perform lazy document materialization.
- **Verification Criteria:**
  `npm test` executes `test/columnar-index.test.js`, asserting:
  1. Index initialization over 100,000 synthetic records uses contiguous `BigInt64Array` buffer allocation with <2 MB memory footprint.
  2. Sequential filter walks execute with 0 object pointer dereferences over index buffers before document materialization.
  3. Lazy materialization fetches document content from Git object store on demand for matching keys only.
  4. Zero floating-point operations occur across monetary indexed paths.
- **Non-Negotiable Constraints:**
  Zero runtime dependencies, no build step, ES module browser compatibility, `node:*` imports strictly in `runtime/git/fs-node.js` and tests, BigInt minor units for monetary values.

### Issue Specification 2: 10M Object Packfile & 1M Document Scale Benchmark Suite

- **Title:** `test(benchmark): 10M object packfile geometric repacking and 1M document index query benchmark suite`
- **Roadmap Source:** `docs/ROADMAP-V1.md` Part 1 FD-2, FD-10 & Part 2 Gate Condition 7
- **Decision Record:** `docs/decisions/2026-08-20-scale-benchmarks-and-columnar-index-materialization.md`
- **Labels:** `area:tests`, `p1`, `ready`
- **Description:**
  Create an automated scale benchmarking test suite `test/benchmark-scale.test.js` executed via Node's native test runner (`node --test`) to measure system performance against Gate Condition 7 targets: Git object packfile integrity and document read path materialization/query performance.
- **Verification Criteria:**
  `node --test test/benchmark-scale.test.js` executes micro-benchmarks with scaled sampling (10,000 synthetic objects by default during standard test runs to complete within <5 s, scaling to 10M via `BENCHMARK_SCALE=1` environment variable), verifies `git fsck --strict` cleanliness, asserts geometric repacking bounds (<50 pack files), and asserts zero memory leaks across GC cycles.
- **Non-Negotiable Constraints:**
  Zero third-party test dependencies, runs under Node's native test runner (`node --test`), default standard test execution completes in under 5 seconds without memory spikes or CI timeouts, deterministic metrics reporting.
