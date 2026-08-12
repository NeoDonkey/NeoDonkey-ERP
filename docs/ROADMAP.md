# Roadmap to v1.0 — the version we publish

**Written by:** CTO. **Date:** 2026-08-03. **Status:** proposed.

The brief: a version I would put on a public GitHub repository and let us market as a
revolutionary ERP. That is a higher bar than "it works", because publishing means inviting
strangers to attack it and to check every sentence we wrote.

This document starts with an honest audit, because Principle 1 says a conflict between
requirements is not a compromise — it is a signal that we have not thought hard enough. Some of
our 22 compromises are the platform refusing. Some are us not thinking hard enough. Those are
different things and have been filed under the same heading, which flattered us.

---

## Part 1 — The audit: which compromises are ours?

### A. Our shortfall. No platform limit, no principle in conflict. Just not done.

**A1 — The read path does a linear scan.** This is the clearest case and it is embarrassing. We
justified an in-memory index with "SQLite is a dependency", which is true — and then wrote an
implementation with *no secondary indexes at all*, so every query except an id lookup scans every
document. Appendix VI's own example query takes 1.05 ms at 15k invoices and 70 ms at 1M. But
"avoid a 3 MB binary" never required "scan linearly": a `Map<field, Map<value, Set<id>>>` over the
fields the entity declares is perhaps 150 lines of the same zero-dependency JavaScript. We had
"fast **or** dependency-free" available as "fast **and** dependency-free" and did not take it.
That is Principle 1 violated in the most literal way, by us, in the module whose speed we then
described as an honest limitation. **Fix it, and the manifesto's sub-millisecond claim becomes
true instead of amended.**

**A2 — Ungoverned operations are permitted.** Nobody asked "what happens when no rule matches?"
A role-less actor can delete a warehouse. This is a thinking failure, not a trade-off.

**A3 — Four-eyes.** The manifesto states the design in one sentence (line 114: "a signature
constraint on the commit"). We filed it as a limitation instead of building it. A commit carrying
two signatures over one payload is a day's work on machinery that already exists and is tested.
Deferring the control a European auditor asks about *first* was not a considered trade-off.

**A4 — Threshold authorisation.** Every approval limit in our own operating model — 10,000 €
orders, 5,000 € invoices — is written down and unenforceable, because rules on one trigger are
conjunctive and authority is per file rather than per rule. Found by an agent writing content, not
by design review. Per-rule `## Authorized by` is additive and small.

**A5 — No enumerations.** `status: text` accepts `"delivrd"` and silently does nothing. In an ERP.
This is the cheapest correctness win available and it is not in the grammar because we did not
think about typos.

**A6 — The release key is unarmed.** Refusing to commit a development key was right. Not
generating a real key and publishing its fingerprint means our headline sovereignty feature is
inert, and COMPROMISES #8 still governs in practice. Half-finished, not deferred.

**A7 — Master data has no promotion path.** Articles are created `draft` and nothing makes them
active. A content gap that only surfaced because a demo tried to use the system.

**A8 — No Live-Layer persistence.** Appendix III specifies an IndexedDB buffer. We have the exact
payload shape ready and did not write the twenty lines that persist it. An in-progress edit dies
with the tab.

**A9 — iOS icons are SVG, so they do not render.** Two PNGs.

### B. Real work, correctly sequenced, but the claims depend on it

Not laziness — genuinely large. But we cannot market these as features while they are absent.

**B1 — There is no peer sync.** This is the gap that matters most. The CRDTs converge and are
proven over 430 seeded property cases, but the transport is a loopback in one process. So:
Principle 2's "distributed across all the machines you have" is not demonstrated, Appendix X's
three-peer mesh does not exist, cross-peer atomicity (Appendix VIII) is meaningless, and the
answer to "what if her laptop falls into the sea" is *nothing*. **Publishing a peer-to-peer ERP
with no peer-to-peer would be the one thing that could fairly be called dishonest.**

**B2 — No encryption groups.** Appendix VII is one of the strongest ideas we have — GDPR erasure
as cryptographic shredding, resolving the GoBD conflict — and it does not exist. We currently must
tell people not to put HR data or customer PII in an ERP. The manifesto costs it at ~600 lines.

**B3 — No dialects, no DATEV.** Principle 5 says integration is the biggest ERP pain point, and we
speak to nothing. Appendix IX calls the DATEV bridge "week one". For a German market it is the
cheapest credibility we can buy, and the read path already holds everything it needs.

### C. Genuine platform limits. Document, do not pretend.

**C1 — Private keys cannot reach the OS keychain from a browser.** Real. But the passkey path is
*also* real and we have not built it, so this entry is currently half B and half C. Splitting the
difference honestly: the limit is genuine, our mitigation is incomplete.

**C2 — `showDirectoryPicker` does not exist in Safari or Firefox.** Real, measured, not ours.
"It is simply a folder" is Chromium-only and must be said that way.

**C3 — Trust on first install.** No cryptography fixes it. Only out-of-band fingerprint
publication, which is a process we must actually run.

**C4 — A browser will not execute modules from `file://`.** Real. Resolved by the PWA.

### D. The manifesto is wrong, and should be amended rather than "compromised"

Filing these as compromises quietly implies we failed to meet a good standard. In fact the
standard is mis-stated, and the constitution should be corrected — which the closing note permits,
since a manifesto that cannot be corrected is a religion.

- **D1 — "Sub-millisecond"** becomes true once A1 lands, for the queries that matter. State the
  shape honestly: indexed predicates are microseconds, full scans are linear.
- **D2 — "The runtime is perhaps 500 lines."** It is 1,638, almost all of it the diagnostics that
  make Principle 6 real. The estimate was wrong; the code is not.
- **D3 — Appendix X's double-click.** Draft already written (`MANIFESTO-AMENDMENT-1.md`).
- **D4 — Principle 3's "WebAssembly for the runtime".** Here I have to be careful, because our
  justification for shipping JavaScript is partly self-serving. "No build step" applies to the
  *user*, not to us — we could commit a `.wasm` next to a reproducible build script, which is what
  serious projects do. So the honest position is: the tension is *inside* the manifesto, between
  Principle 3's WASM and Appendix III's demand that an auditor be able to read our core. I
  recommend amending Principle 3 to name the browser sandbox and web standards as the requirement,
  keeping the auditable JavaScript core, and using WASM only for hot paths (SHA-1, inflate) with
  reproducible builds. What I will not do is keep calling it a compromise while privately knowing
  a build step would have solved it.

### Scorecard

| | count | verdict |
|---|---|---|
| Our shortfall (A) | 9 | fix before publishing; most are small |
| Real work the claims depend on (B) | 3 | at least B1 and B2 before publishing |
| Genuine platform limits (C) | 4 | document precisely; C1 needs our half done |
| Manifesto should change (D) | 4 | amend the constitution, do not "compromise" |

**About half of what we called compromises were us not thinking hard enough.** That is the useful
finding, and it is exactly what Principle 1 predicts happens when you let "compromise" become an
acceptable word.

---

## Part 2 — The publication gate

Seven conditions. I will not recommend publishing until all seven hold, and I would rather move
the date than the gate.

1. **No hole a competent reviewer finds in an hour.** A2, A3, A4, A6 closed; an external
   adversarial review passed.
2. **Every claim checked.** A line-by-line audit of README, manifesto and website against
   behaviour. Anything not yet true is marked *not yet*, in the same typeface as the promises.
3. **Two real machines sync.** B1 working laptop-to-laptop, and a documented recovery of a company
   from a second peer after the first is destroyed.
4. **Sensitive data has somewhere to live.** B2, so we can stop saying "no HR data".
5. **It speaks to one foreign system.** B3: DATEV export plus one dialect, proving Principle 5 is
   a pattern and not a paragraph.
6. **A German buyer's first question has an answer.** A Verfahrensdokumentation draft
   (Appendix IX Track 2) cross-referenced to the code.
7. **Someone outside the team ran it.** At least three people who did not build it install it from
   the published instructions and get to a booked goods receipt without our help.

Not on the gate, deliberately: the UI being beautiful. You are right that it does not matter yet,
and the strongest marketing asset we have is not a screenshot — it is a terminal:
`git log --show-signature` on a real company, with `G` on every line. That is the thing no
competitor can show. One caveat I owe you: a public repo aimed at marketing will be judged on
first impression, so I would spend two days making the UI *plain and confident* rather than
pretty. Not a milestone, a chore.

---

## Part 3 — Milestones

Each milestone is a parallel wave of agents against a written contract, the way v0.1 was built —
that worked, and the reason it worked is that every serious finding came from one thing checking
another, never from an author reviewing themselves.

### M1 — "It is not our fault any more" (the whole of A)

Everything in section A. Nine items, all small to medium, maximum parallelism.

| stream | work |
|---|---|
| Authorisation | per-rule `## Authorized by`; entity-level defaults; coverage warnings for every uncovered entity-operation pair; **two-signature commits** for four-eyes; thresholds enforceable (A2, A3, A4) |
| Grammar | enumerations; `or` between conditions; `with +<field> from <other>`; branch form for the partial-delivery case (A5, and #4i) |
| Read path | secondary indexes on declared fields; re-benchmark; make D1 true (A1) |
| Release | generate the real key, publish the fingerprint out of band, cut v0.1.0, arm the pin (A6) |
| Model | promotion processes; four-eyes on the flows that need it; PNG icons (A7, A9) |
| Live | IndexedDB op buffer (A8) |
| Manifesto | amendments D1–D4 for your approval |

**Done when:** an actor with no roles can do nothing; a payment run requires two signatures;
Appendix VI's query is microseconds; a mistyped status is refused; `release.json` is signed by a
key whose fingerprint is published in three places.

### M2 — "The claims are true" (B1, B2)

The two that decide whether we may use the words we want to use.

| stream | work |
|---|---|
| Sync | WebRTC data channels behind the existing three-method `PeerLink` seam; a relay that sees nothing; QR-code peer introduction (Appendix X); LAN discovery if it is cheap |
| Atomicity | reservation events with TTL, authoritative peer per scarce resource, Raft-like re-election (Appendix VIII's complex case) |
| Encryption | group keys, DEKs, wrap/unwrap on WebCrypto; per-peer index built only from what it can decrypt; **GDPR shredding**; offboarding with key rotation |
| Recovery | the "laptop in the sea" drill, as an automated test and a documented procedure |

**Done when:** three peers on three machines converge; one is destroyed and the company survives;
an intern's index physically lacks the salary table; a customer's DEK is destroyed and the blobs
are noise while the GoBD chain stays intact.

### M3 — "Sellable in Europe" (B3, gate items 5–6)

| stream | work |
|---|---|
| Dialects | DATEV export; XRechnung/EN-16931 output from the invoice entity; one inbound dialect (Shopify) proving the deterministic same-event-same-commit property across peers |
| Documents | PDF rendering from versioned templates, with the byte-identical-regeneration property Appendix XI claims |
| Regulatory | Verfahrensdokumentation draft; the honest signing-key answer from COMPROMISES #2 written for an auditor rather than an engineer |
| Onboarding | template selection in the UI, so a new company starts from `d2c-retail-europe` in one click |

### M4 — "Publish"

| stream | work |
|---|---|
| Adversarial | external security review; a red-team agent whose only instruction is to forge a commit, bypass a rule, or push unsigned code |
| Claim audit | every sentence in README and manifesto against behaviour; *not yet* labels applied |
| Strangers | three people outside the team install and book a goods receipt unaided |
| Chore | UI made plain and confident |
| Launch | the repo, the fingerprint, the Verfahrensdokumentation, and a demo video that is mostly a terminal |

---

## Part 4 — What I am watching for

Three failure modes I expect, named now so they are harder to rationalise later.

**"Compromise" as an anaesthetic.** Writing a beautiful, honest compromise entry *feels* like
engineering integrity, and it is — right up to the point where it substitutes for the fix. Half of
ours were fixable. From here on, an entry in COMPROMISES.md must state which of the four
categories above it belongs to, and category A is not permitted to survive a release.

**Confusing "tested" with "true".** v0.1 has 213 passing tests and shipped a hole that let a
role-less actor delete a warehouse, because no test asked what happens when nothing applies. The
lesson is not "write more tests"; it is that only adversarial and end-to-end checks find defects of
composition. M4's red team is not a formality.

**Marketing ahead of the code.** The moment we say "peer-to-peer" in public, B1 must exist. The
moment we say "GDPR-compliant erasure", B2 must exist. I would rather delay a launch than earn the
one criticism that would be fatal to a sovereignty pitch: that we were the ones being economical
with the truth.
