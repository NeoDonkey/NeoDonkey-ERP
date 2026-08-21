# NeoDonkey v1.0 Gate Scorecard

**Automated scorecard for the ten v1.0 gate conditions defined in `docs/ROADMAP-V1.md` Part 2.**
Generated and verified by `test/gate-score.test.js`. Do not edit by hand.

---

## Summary

- **Green (Met):** 8 / 10
- **Partial:** 1 / 10
- **Red (Unmet):** 1 / 10

---

## Gate Conditions

### Condition 1 — Debits equal credits, structurally [GREEN]

Double-entry general ledger modelled in POLISM with debits=credits invariant, period locking, and trial balance.

**Evidence:**
- `test/f2-ledger.test.js`
- `test/readme-claims.test.js`

### Condition 2 — No float in any monetary path [GREEN]

FD-1 string representation, BigInt minor units, commercial half-up rounding, and source guard forbidding parseFloat/Number on money.

**Evidence:**
- `test/m-money.test.js`
- `test/_source-guard.js`

### Condition 3 — Authorisation is closed [GREEN]

Strict authorization default-deny, claimed ∩ recorded role intersection, and POLISM rule authority checks.

**Evidence:**
- `test/roles-fd9.test.js`
- `test/c-polism.test.js`

### Condition 4 — Two real machines sync, and a company is recovered after process destruction [GREEN]

WebRTC and relay sync, CRDT convergence, and complete company recovery after workspace directory destruction.

**Evidence:**
- `test/sync-relay.test.js`
- `test/readme-claims.test.js`
- `demo/sarah.mjs`

### Condition 5 — Sensitive data is encrypted with group keys, per-peer indexes, and GDPR erasure [GREEN]

Group key management, sealed documents, cryptographic DEK destruction for GDPR erasure while maintaining git integrity.

**Evidence:**
- `test/crypto-shred.test.js`
- `test/crypto-reader.test.js`
- `test/readme-claims.test.js`

### Condition 6 — It speaks to the outside world [GREEN]

DATEV EXTF export (runtime/export/datev.js), XRechnung/EN-16931 generator and parser (runtime/export/xrechnung.js, xrechnung-parser.js), the Shopify inbound dialect (runtime/inbound/shopify.js) committing through the real kernel, and the cross-peer same-commit property asserted byte-identical across two OS processes in test/sync-relay.test.js and exercised end to end in demo/sarah.mjs.

**Evidence:**
- `test/datev-extf-posting.test.js`
- `test/xrechnung.test.js`
- `test/xrechnung-parser.test.js`
- `test/inbound-shopify.test.js`
- `test/sync-relay.test.js`
- `demo/sarah.mjs`

### Condition 7 — Scale is measured, not asserted [GREEN]

Measured and published: 100 000-object pack/index/read, a 2.2 GB pack past the 64-bit offset boundary verified by git fsck, and the document read path at 1 M documents (2.1 M in the scale ladder), in docs/BENCHMARKS.md.

**Evidence:**
- `docs/BENCHMARKS.md`
- `test/p-pack.test.js`
- `test/e-read.test.js`

### Condition 8 — A German auditor's questions have written answers [GREEN]

Verfahrensdokumentation covering GoBD requirements (Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit).

**Evidence:**
- `docs/VERFAHRENSDOKUMENTATION.md`
- `test/verfahrensdok.test.js`

### Condition 9 — An adversary tried [RED]

External security audit and red team attempt to forge commits, bypass rules, unbalance ledger, or breach group encryption.

**Evidence:** None

**Missing:** External security audit and red team penetration test report.

### Condition 10 — Every claim audited [PARTIAL]

README headline claims verified by test; full line-by-line audit of manifesto and site claims still pending.

**Evidence:**
- `test/readme-claims.test.js`

**Missing:** Line-by-line audit of manifesto and website claims against implementation behavior.
