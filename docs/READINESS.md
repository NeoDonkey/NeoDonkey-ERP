# Readiness — what "done" and "production" actually mean

**Owner:** CTO. **Written:** 2026-08-04, in answer to a direct question I should have answered
before writing the roadmap: *at what point would you put this into a real company?*

## The distinction I let stand, and should not have

`docs/ROADMAP-V1.md` calls its ten conditions "the v1.0 gate". Reading it back, it is a
**publication gate** — the bar for putting the repository in public and letting strangers attack it
without being embarrassed. I never said it was a *production* gate, and I never said it wasn't.
That silence is the kind of ambiguity that ends with someone running a company's books on software
that was never claimed to be ready for it.

They are different bars, and neither implies the other:

| bar | question it answers | reached at |
|---|---|---|
| **Publishable** | Does this survive a hostile reviewer, and is every claim we make true? | end of Wave 4 = **v1.0** |
| **Pilot-ready** | Could one willing company keep its real books here, alongside their old system? | Wave 6 |
| **Production** | Could a company run on this as their only system of record? | Wave 7+, and only with an attestation |

**v1.0 is publishable. v1.0 is not production.** Both statements go in the README.

---

## Tier 0 — Publishable (end of Wave 4) = v1.0's Definition of Done

The ten gate conditions in `ROADMAP-V1.md` Part 2 are the DoD. In one sentence: *a competent
reviewer, given the repository and an hour, concludes this is real engineering with a credible path
and no hidden defects — and every sentence we published is true.*

What that explicitly does **not** claim: that anyone should use it for their accounts.

---

## Tier 1 — Pilot-ready (Wave 6): one company, dual-running, with us in the room

The threshold: **a company can lose nothing by trying it.** That means their old system keeps
running in parallel for two to three closes, and every number NeoDonkey produces is reconciled
against it. This is how real ERP go-lives work, and anyone who tells you otherwise has not done one.

Beyond v1.0, this needs:

**Wave 5 — accounting completeness.** The general ledger posts, but a real company's first week
would hit walls the ledger does not have doors for. From agent F2's own list, and this list is the
most valuable document produced in Wave 1:

- **Opening balances.** A new company's *first* entry cannot be posted. Disqualifying on day one.
- **Supplier credit notes** — refused today by a `> 0` guard.
- **A refund month** — a company buying stock ahead of a season files a negative VAT return and
  cannot represent one.
- **Year-end close** and the *Stornoliste*.
- **Fixed assets and depreciation**, **accruals and deferrals**, **provisions** — omitted
  deliberately, and a balance sheet without them is not a balance sheet.
- **Three-way matching** — an invoice for goods that never arrived will post.
- **Supplier bank-detail change control** — the door invoice-redirection fraud actually uses.
- **VAT returns derived rather than captured.** Thirteen figures are recomputed in a test and not
  refused by the model; a wrong return is not currently caught.

**Wave 6 — pilot hardening.** Migration *in* from their existing system (this is most of the work
and it is not glamorous), a rehearsed recovery drill, reconciliation tooling for the dual run,
`Verfahrensdokumentation` signed off by *their* Steuerberater, and a named human on support.

**Also required before this tier, from the existing register:** peer sync working between real
machines (or the pilot has no backup), encryption groups (or they may not put payroll in it),
four-eyes operable across two desks, and roles that are `claimed ∩ recorded` rather than asserted.

---

## Tier 2 — Production (Wave 7+): sole system of record

Everything above, plus: **payroll** or a clean interface to a payroll provider, **multi-entity
consolidation**, the full § 266/§ 275 HGB balance sheet, **FD-10's columnar read path** (a 500 M€
company is 3–5 M documents *per year* and today's ceiling is 3 M), ten years of history in one
repository proven at scale, and an **IDW PS 880 attestation** — six months and €50–100k per
Appendix IX, and the currency of trust in the DACH market.

**A 500 M€ company must not be the first customer.** Not because the software could not eventually
serve them, but because nobody's first ERP customer should be that size, and offering it would be
the strongest possible signal that we do not know what we are doing.

---

## Honest timing

At Wave 1's pace and with this team, Waves 2–4 are the near term and v1.0 is genuinely close.
Tier 1 is a different order of work — Wave 5 is not a sprint, it is *bookkeeping*, and the only way
to get it right is with an accountant reviewing every rule. Tier 2 is gated on a real pilot
producing real closes, which is calendar time no amount of parallelism compresses: you cannot
month-end faster than a month.

I will not put a date on Tier 1 until Wave 2 has run, because Wave 1 taught me that my estimates of
this codebase were wrong in both directions — packfiles and the ledger were larger than I thought,
and two grammar requests evaporated entirely on contact with the working system.
