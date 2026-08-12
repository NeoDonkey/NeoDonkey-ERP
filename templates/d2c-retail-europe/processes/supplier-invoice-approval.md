# Supplier invoice approval

The second signature on an incoming invoice at or above 5,000 EUR gross.

The person who verified the invoice may not be the second approver. That is enforced in the strongest
way available: approval is a separate commit, signed with a separate key, and `approval-count >= 2`
means two commits from two keys. There is no field somebody could type a second name into.

This is the control an auditor tests first, and it is worth being precise about why the NeoDonkey
version is stronger than the usual one. In a classical ERP, four-eyes means two user records in an
approval table, and whether those users were really two people — rather than one person with a
colleague's password — is unknowable after the fact. Here the evidence is a cryptographic signature
that is still checkable in eight years by anybody holding the repository, with no working system
required.

## Triggered by
A checked supplier invoice at or above 5,000 EUR gross.

## Rules
If Update supplier-invoice under condition
  supplier-invoice needs second approval and
  supplier-invoice independently approved and
  supplier-invoice legally valid
then
  Update supplier-invoice with approval-status "approved" and
  Update supplier-invoice with status "approved"

If Update supplier-invoice under condition
  supplier-invoice needs second approval and
  second-approved-by exists
then
  Update supplier-invoice with +approval-count

If Update supplier-invoice under condition
  approval-status is "rejected"
then
  Update supplier-invoice with rejection-reason and
  Update supplier-invoice with status "disputed"

## Authorized by
controller or managing-director
