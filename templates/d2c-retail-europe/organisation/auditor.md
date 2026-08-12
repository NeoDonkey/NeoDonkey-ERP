# Auditor

External, read-only, and the reason several things in this template look more careful than they
strictly need to.

An auditor's job is to form an opinion about whether the numbers can be relied on, and they do
that by testing controls. In this operating model the controls are readable: they are the
`## Authorized by` sections, the threshold predicates on the entities, and the requirement that
certain acts be two separately signed commits. That is a better starting position than a
classical ERP, where the equivalent evidence is a permissions matrix nobody can reconstruct for
a date three years ago.

The audit-relevant property this role depends on is that nothing is ever silently changed. Every
document has a signed history; a correction is a new document referencing the old one; an issued
invoice is never edited. If any of that stops being true, this role becomes decorative.

## Notes
### Responsibilities

- Test the design and operation of the controls described in `organisation/` and `processes/`.
- Verify that four-eyes decisions were in fact signed by two distinct keys.
- Verify the annual inventory and the stock valuation.
- Verify the completeness of the invoice number sequence.
- Verify that corrections reference what they correct and state a reason.
- Read the *Verfahrensdokumentation* and confirm it matches what the folder actually does.

### Authorized for

Nothing. This role has no write authority anywhere in the operating model and appears in no
`## Authorized by` section. That is not an oversight — an auditor who can change a document
cannot audit it.

### Not authorized for

- Creating, updating or deleting any document.
- Approving anything.

### Reports to

The shareholders, via the audit engagement.

### Sees

Read access to the entire signed history: every document, every commit, every signature, and the
operating model itself in every version it has ever had. This is the one role for which "sees
everything" is correct, and it is also the role that most benefits from the visibility model,
because the history cannot have been curated for them.

Personal data is the exception again: consumer and employee personal data is disclosed on
request for a specific test, not held open by default.
