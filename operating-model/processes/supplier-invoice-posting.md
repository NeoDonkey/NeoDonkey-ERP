# Supplier invoice posting

The purchase side. Two cases, and the second one is the one that separates a European ERP from an American
one: a purchase from a supplier in another member state, where we owe the German VAT ourselves.

**Domestic, input tax deductible.** Net 1,000.00 EUR at 19 %:

```
3200  Wareneingang 19 % Vorsteuer                  Soll   1,000.00
1576  Abziehbare Vorsteuer 19 %                    Soll     190.00
   1600  Verbindlichkeiten aus Lief. und Leistungen   Haben  1,190.00
```

**Intra-community acquisition, reverse charge.** A Dutch supplier invoices 12,000.00 EUR with no VAT on it,
because under § 1a UStG the tax is ours to account for:

```
3425  Innergemeinschaftlicher Erwerb 19 %          Soll  12,000.00
1574  Abziehbare Vorsteuer aus i. g. Erwerb 19 %   Soll   2,280.00
   1600  Verbindlichkeiten aus Lief. und Leistungen   Haben 12,000.00
   1772  Umsatzsteuer aus i. g. Erwerb 19 %           Haben  2,280.00
```

Four lines, 14,280.00 on each side, and a net effect on what we pay the *Finanzamt* of zero — 2,280.00
declared in line 89 of the *Umsatzsteuervoranmeldung* and the identical figure deducted in line 61. What must
never happen is netting the two VAT lines out. They are two separate declarations, they appear on two separate
lines of the return, and a system that posts only the difference produces a return that adds up and cannot be
explained to anybody.

## Triggered by
An accountant posting an approved supplier invoice: creating a journal entry that names the invoice, the
period, the chart and the tax situation.

## Notes

### The live rule, quoted

What follows is the two purchase arms of the rule in `processes/journal-posting.md`, **verbatim** —
`test/f2-ledger.test.js` compares this block byte for byte with that file, and posts the Dutch supplier
invoice through `runtime/polism/execute.js`, asserting all four legs and 14,280.00 EUR on each side.

`Create posting as "acquisition"` is grammar §21 and `with amount from supplier-invoice.ledger-net-amount` is
§17. Every account named comes from `information/chart-of-accounts.md` and `information/vat-treatment.md`, so
it is still one edit in one document to change any of them.

```
  otherwise when journal-entry from a supplier invoice and supplier-invoice an eu acquisition then
    Create posting as "acquisition"
      with position 1 with side "debit"
      with account-number from vat-treatment.acquisition-account-number
      with ledger-account from vat-treatment.acquisition-account
      with amount from supplier-invoice.ledger-net-amount
      with posting-date from entry-date
      with vat-kennzahl from vat-treatment.vat-kennzahl-base
      with vat-role from vat-treatment.vat-role-base
      with supplier from supplier-invoice.supplier
    and Create posting as "payable"
      with position 2 with side "credit"
      with account-number from chart.payables-account-number
      with ledger-account from chart.payables-account
      with amount from supplier-invoice.ledger-net-amount
      with posting-date from entry-date
      with vat-role "none"
      with supplier from supplier-invoice.supplier
    and Create posting as "self-assessed-vat"
      with position 3 with side "credit"
      with account-number from vat-treatment.self-assessed-vat-account-number
      with ledger-account from vat-treatment.self-assessed-vat-account
      with amount from supplier-invoice.ledger-vat-amount
      with tax-base-amount from supplier-invoice.ledger-net-amount
      with posting-date from entry-date
      with vat-kennzahl from vat-treatment.vat-kennzahl-tax
      with vat-role "output-tax"
      with vat-rate-percent from vat-treatment.vat-rate-percent
    and Create posting as "input-vat"
      with position 4 with side "debit"
      with account-number from vat-treatment.input-vat-account-number
      with ledger-account from vat-treatment.input-vat-account
      with amount from supplier-invoice.ledger-vat-amount
      with tax-base-amount from supplier-invoice.ledger-net-amount
      with posting-date from entry-date
      with vat-kennzahl "61"
      with vat-role "input-tax"
      with vat-rate-percent from vat-treatment.vat-rate-percent
  otherwise when journal-entry from a supplier invoice and supplier-invoice deductible then
    Create posting as "expense"
      with position 1 with side "debit"
      with account-number from vat-treatment.expense-account-number
      with ledger-account from vat-treatment.expense-account
      with amount from supplier-invoice.ledger-net-amount
      with posting-date from entry-date
      with vat-role "none"
      with supplier from supplier-invoice.supplier
    and Create posting as "input-vat"
      with position 2 with side "debit"
      with account-number from vat-treatment.input-vat-account-number
      with ledger-account from vat-treatment.input-vat-account
      with amount from supplier-invoice.ledger-vat-amount
      with tax-base-amount from supplier-invoice.ledger-net-amount
      with posting-date from entry-date
      with vat-kennzahl "66"
      with vat-role "input-tax"
      with vat-rate-percent from vat-treatment.vat-rate-percent
    and Create posting as "payable"
      with position 3 with side "credit"
      with account-number from chart.payables-account-number
      with ledger-account from chart.payables-account
      with amount from supplier-invoice.posting-total
      with posting-date from entry-date
      with vat-role "none"
      with supplier from supplier-invoice.supplier```

### Reading the reverse-charge branch

Note that the payable is credited with `supplier-invoice.ledger-net-amount` — the net — and not with the
posting total. The Dutch supplier is owed 12,000.00 EUR and not a cent more; the 2,280.00 EUR is owed to the
German tax authority and is not part of the liability to the supplier. Getting that wrong overstates trade
payables by the VAT and makes the accounts-payable ageing disagree with what the supplier thinks.

In the domestic branch the payable **is** credited with `posting-total`, because there the gross amount is what
the supplier is owed. One field, two meanings depending on the treatment, and
`information/supplier-invoice.md` explains why the field is captured rather than derived: POLISM does no
arithmetic, and the journal entry's balance invariants are what make a wrong `posting-total` unpostable.

### Input tax and the § 15 UStG conditions

The domestic branch is guarded by `supplier-invoice deductible`, which is
`input-vat-deductible is true and supplier-vat-identifier exists and vat-rate-percent > 0`. All three. The
third catches the case people trip over: an invoice with no tax shown gives no deduction, so a zero-rate
invoice claiming one is refused by the condition rather than posted.

An invoice where the deduction is genuinely unavailable — entertainment at 30 %, private use, a missing § 14
element — fails that condition and therefore matches no branch, so it gets no postings and the journal entry
is refused by its own invariants. **That is a gap, not a feature:** a non-deductible purchase is a legitimate
transaction that should post gross to the expense account, and this model cannot post it. It needs a third
branch, `otherwise when journal-entry from a supplier invoice`, crediting the payable with the gross and
debiting the expense with the gross. It is not there, and `non-deductible-reason` on the invoice is currently
a field nothing consumes.

### Duplicate invoices

The control is the business key: `information/supplier-invoice.md` is `## Identified by supplier and
supplier-invoice-number`, so entering the same supplier's same number twice collides and the second is
refused rather than filed as a second liability. Not by invoice number alone — two suppliers will eventually
both send an invoice numbered 1001.

The second control is weaker than it should be. A journal entry takes the id of the document it was created
from, so posting the same supplier invoice twice needs two journal entries with two numbers, and nothing
refuses that. `information/journal-entry.md` explains precisely which invariant is missing and why it cannot
yet be written. Double posting of a supplier invoice is one of the two or three things an auditor actively
hunts for, so read that note before relying on this.

### Three-way matching is not enforced

`three way matched` — `purchase-order exists and goods-receipt exists` — is a predicate on the supplier
invoice and it is **not** in the conditions of the posting rule. So an invoice for goods that never arrived
will post. That is the first door accounts-payable fraud walks through, and closing it is one condition added
to the branch guards; it is left out here only because a company that receives invoices before its goods
receipts are captured would find every posting refused, and that decision belongs to the company rather than
to this file. It is named in the report.

## References

`processes/journal-posting.md`, `information/supplier-invoice.md`, `information/journal-entry.md`,
`information/vat-treatment.md`, `processes/payment-run.md`
