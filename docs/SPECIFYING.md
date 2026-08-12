# Writing a specification

How an issue becomes something someone can implement. Read this before writing one.

The short version: **decompose, source, and say how it will be checked.** Everything below is
those three things in detail.

---

## 1. Decompose — do not invent

The scope of this product is already decided. It is in `neodonkey-manifesto.md`, in
`docs/ROADMAP-V1.md` (Part 2 is the ten v1.0 gate conditions, Part 3 is the waves), in
`docs/READINESS.md` (what publishable, pilot-ready and production each mean) and in
`docs/COMPROMISES.md` (the register of known debt).

Those documents contain months of specified work. Your job is turning one line of them into
issues someone can pick up — not deciding what the product should be.

> Gate condition 6: *"It speaks to the outside world. DATEV export, XRechnung/EN-16931 invoices,
> one inbound dialect, and the same-foreign-event-same-commit property demonstrated across two
> peers."*

That single sentence is a dozen issues. Writing them is real work. Deciding whether DATEV belongs
is not — it is already decided.

**An issue whose subject appears in none of those documents should not exist.** If you believe
something genuinely missing belongs in the product, that is a `needs-decision` issue about the
roadmap, not a specification.

---

## 2. Source everything

### Where the work comes from

Every issue names it, and quotes the sentence: a manifesto principle, a gate condition, a wave, a
register entry, a line in `READINESS.md`. This is a required field on the template. An issue
without a source will not be implemented, because nobody can tell whether it is in scope.

### Where the facts come from

Anything regulatory, accounting or standards-related cites a **primary source**:

| Use | Do not use |
|---|---|
| The regulation itself (EUR-Lex, national gazette) | A blog post summarising it |
| The official specification (EN-16931, DATEV's published format, Peppol BIS) | A vendor's marketing page |
| The tax authority's own documentation (BMF, KSeF, AEAT, Agenzia delle Entrate) | A forum answer |
| A standards body's published schema | A model's recollection |

Give title, publisher, link, and **which part applies** — the article, the section, the field.
"EN-16931 requires it" is not a citation; "EN-16931-1:2017 §6.1, BT-31 (Seller VAT identifier),
mandatory when the seller is VAT-registered" is.

Research is welcome and is often better than recollection. **Unsourced research is not research.**
This project's register states that nothing in it is asserted from a report; that rule applies to
specifications too.

Where sources disagree, or where a jurisdiction's rule has an exception you cannot resolve, write
both readings into the issue and say which you recommend. Do not pick silently.

### Dates matter

Tax and e-invoicing rules have commencement dates and transition periods, and several EU member
states have mandates phasing in. Say **from when** a rule applies and whether an earlier regime
still runs in parallel. A correct rule applied a year early is a defect.

---

## 3. Say how it will be verified

Required, and the field most often written badly.

Not verification: *"The DATEV export works."*

Verification: *"A month with one supplier invoice, one credit note and one part-payment exports
to a DATEV EXTF file whose header matches the published format version, whose booking lines
balance, and which the format's own field-length rules accept. The test asserts the byte content
of the file against a fixture, so a change in the format is a failing test rather than a surprise
at the tax adviser's."*

The difference is that the second one tells the implementer what to build and the reviewer what to
check. If you cannot say how something is verified, the issue is not ready — say so and label it
accordingly.

Every implementation ships with a test that **fails without the change**. A test that passes
before and after proves nothing. Say in the issue what that test is.

---

## 4. Size

One issue is one pull request is one reviewable change. If your specification needs five files,
three subsystems and a migration, it is an epic and should be split — with the parts that unblock
others marked, and dependencies stated as `blocked` with the issue number that blocks them.

Prefer issues that close an existing register entry over issues that add new surface. Closing debt
is progress that can be verified. New surface is progress that has to be maintained.

---

## 5. What you may not decide

If a question is answered by **neither the manifesto nor the roadmap**, it is not yours:

- Where the release-key fingerprint is published
- Whether a market is in scope for v1
- Which of two designs the project adopts, when both satisfy the manifesto
- Anything that changes what the product promises

Open it as `needs-decision`, with the question, the options, what each costs, and a
recommendation. Then stop. Do not implement it, and do not let a later issue quietly assume an
answer.

This category is narrow on purpose. *How* Polish JPK_V7 reporting works is researchable and yours
to establish. *Whether* Poland is in v1 is not.

---

## 6. Before you open it

- The source is quoted, not paraphrased.
- Every regulatory claim has a primary source with the part that applies.
- The verification is a test or a command, not an adjective.
- The constraints that apply are listed, so the implementer does not discover them in review:
  zero dependencies, no build step, no `node:*` outside its two homes, no `Date.now()` or
  `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary
  path.
- The area label matches the directories it will touch, so two changes are less likely to meet in
  the same file.
- There are not already more than twenty open `ready` issues. If there are, do not add another —
  verify the existing ones against the code instead.
