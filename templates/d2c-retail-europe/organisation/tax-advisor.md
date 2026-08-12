# Tax advisor

External. The *Steuerberater* who files the VAT returns, prepares the annual accounts and is
the company's defence when the tax office asks a question.

This role is in the operating model rather than outside it for a specific reason. In a
classical setup the adviser receives an export, works in their own system, and their knowledge
lives in their office. Here they are a peer: they hold the repository, they see the documents
they are entitled to see, and their review is a signed commit like anybody else's. Appendix X
calls this "docking the accountant" — one QR code, and the adviser is part of the mesh without
anything being uploaded anywhere.

They have no authority to change a business document. They review, they comment, they file.
The DATEV export exists because their software speaks DATEV, not because the export is the
record of truth — the record of truth is the signed history, and the export is a dialect
(Principle 5).

## Notes
### Responsibilities

- File the VAT return, the EC sales list and the OSS return.
- Review the VAT treatment applied to sales and purchases, and flag what looks wrong.
- Prepare the annual accounts.
- Advise on the OSS threshold and on when a foreign local registration becomes necessary.
- Review the *Verfahrensdokumentation* for GoBD.

### Authorized for

- `processes/vat-return-preparation.md`

### Not authorized for

- Issuing, changing or cancelling any business document.
- Approving payments, invoices or write-offs.
- Anything operational.

### Reports to

Nobody. External adviser, engaged by the `managing-director`.

### Sees

All invoices, credit notes, supplier invoices, payments, VAT registrations and treatments,
inventory counts, and the operating model itself. Not customer or employee personal data beyond
what appears on an invoice — which for consumers means the invoice-relevant fields only, under
the retention basis and nothing wider.
