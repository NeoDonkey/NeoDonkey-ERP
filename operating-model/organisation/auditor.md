# Auditor

Reads everything and changes nothing. An external *Wirtschaftsprüfer* or *Betriebsprüfer*, or an internal
reviewer doing the same work, given a role of their own so that "the auditor has access" is a statement with
a definition behind it.

This is the only role in the model whose authority is entirely read. It exists because of what an audit
actually needs, which is more than a login: the repository, the operating model that governed it at the time,
and the ability to re-perform a calculation without asking anybody to run a report. Under Principle 4 the
documents and the signed commits *are* the audit trail, so an auditor with a clone of the repository and a
copy of `git` can verify the chain without NeoDonkey running at all — which is a stronger position than any
conventional ERP puts them in, and the reason this role is cheap to grant.

What it must never gain is a write. An auditor who can post is an auditor whose opinion is worth less, and a
model that quietly lets them is a model that has misunderstood what independence is for.

## Purpose

- Verify that the journal is complete and gapless, from the sequences and the entry numbers.
- Re-perform the trial balance, the VAT returns and the statements from the postings.
- Verify the signature chain on the commits, with foreign tooling, independently of NeoDonkey.
- Read the operating model as it stood in the period under audit, and satisfy themselves that the rules
  described the controls that were actually enforced.
- Ask for the *Verfahrensdokumentation* and check it against the code it cross-references.

## Notes

### Authorised for
Read only. No rule in this model names this role in a `## Authorized by` for a create, update or delete, and
none should. Grammar version 1 parses and authorises `Read` rules but a read produces no change, so the
authority here is a statement of intent enforced by the absence of write authority everywhere else.

### Not authorised for
Anything that writes. Including a correcting entry, including a reclassification the auditor is certain
about — those are proposed to the tax accountant and posted by them, with the auditor's request on the
document as the reason.

### Reports to
Nobody in this company. That is the point of the role.

### Sees
Every document, every commit, the whole operating model and its history. Encrypted visibility groups are the
exception and they are a negotiation: personal data behind a customer record is disclosed under a lawful basis
for the audit, not by default, and the DEK-based scheme in Appendix VII is what makes selective disclosure
possible without handing over the whole repository unencrypted.
