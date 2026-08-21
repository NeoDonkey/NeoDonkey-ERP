# Journal: GoBD Verfahrensdokumentation lands, gate condition 8 goes green

**Date:** 2026-08-21
**Author:** Daniel Pammé
**Task:** Implement gate condition 8 (docs lane, per the binding decision record of 2026-08-20)

---

## What changed and why

Gate condition 8 asks for one thing: a German auditor's questions have written answers. Yesterday's
decision record (`docs/decisions/2026-08-20-gobd-verfahrensdokumentation-and-auditor-verification.md`)
fixed the structure and the primary sources; today the document itself landed.

`docs/VERFAHRENSDOKUMENTATION.md` follows GoBD § 9.1 (Abs. 151-155): Anwendungsbereich,
Anwendersystem, Internes Kontrollsystem, Datensicherheit/IT-Infrastruktur. The four pillars
(Nachvollziehbarkeit, Unveränderbarkeit, Vollständigkeit, Zeitgerechtigkeit) each get the same
treatment: the requirement with its GoBD paragraph, the mechanism that satisfies it, and the code
and test paths that prove it. The question the roadmap adds, where the signing key lives, gets its
own chapter, because the honest answer has three parts and two of them are uncomfortable.

The limits are written down in the document, not left for the auditor to find: first install is
trust on first use, and no production release key or published fingerprint exists yet
(`docs/COMPROMISES.md`, entry #15, residual risk 7). A Verfahrensdokumentation that hides its own
gaps would fail the audit it exists to pass.

`test/verfahrensdok.test.js` keeps the document honest from now on. It re-parses the file on every
run and fails if the document disappears, if any cited repo path stops existing, if a § 9.1
section name vanishes, or if a pillar loses its primary-source paragraph. Verified both ways: it
passes against the document as written and fails when the document is removed.

## Gate movement

Condition 8 in `test/gate-score.test.js` flips red to green with the document and its test as
evidence; `docs/GATE.md` was regenerated from the score test. Scoreboard: 6 green, 1 partial, 3 red.

## What I did not do

I did not touch `docs/NEXT.md`, `docs/COMPROMISES.md`, `README.md` or the decision record: the
register entry #15 rr7 stays open because the release key is still unpublished, and closing it was
never this change's claim. I also did not create the two issues the decision record defines; this
session implemented directly against the record.
