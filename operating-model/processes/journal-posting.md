# Journal posting

Everything that becomes a *Buchungssatz* becomes one here. A sales invoice, a purchase invoice from
Germany or from another member state, a customer payment with or without an exchange difference, a payment
to a supplier, a goods receipt going onto the shelf, a write-off coming off it — ten cases, and one commit
each.

**What the accountant does:** creates a journal entry naming the source document, the period, the chart, the
tax situation and the entry totals. **What the rules do:** every posting line, every account number, every
tax classification, in the same commit. That split is deliberate. Posting is a deliberate act by a named
person with a signature, which is what GoBD's *Zeitgerechtigkeit* and *Nachvollziehbarkeit* mean; but *which
accounts* is not a judgement to be re-made on each invoice, and an ERP whose users choose accounts by hand is
an ERP with an unreliable trial balance.

Two rules, both on `Create journal-entry`, and §8 makes them conditions on one act. The first creates the
legs — `Create posting as "receivable"`, `as "revenue"`, `as "output-vat"` (grammar §21), each filled from the
chart and the tax treatment with `with <field> from <other-field>` (§17). The second carries the obligations:
a sales invoice must be `issued` before it can be posted, a supplier invoice must be `approved`, a correction
must carry a reason. Only the accountant or the tax accountant may do either.

No account number appears in either rule. Receivables, payables, bank, inventory and the rest come from
`information/chart-of-accounts.md`; revenue, VAT and purchase accounts come from
`information/vat-treatment.md`. Move a company from SKR03 to SKR04 and nothing in this file changes. Ask
the tax adviser to route 7 % food revenue elsewhere and one treatment document changes.

**The entry cannot come out unbalanced, and that guarantee is not in this file at all.** It is in
`information/journal-entry.md` under `## Invariants`: the debit postings must sum to the credit postings, each
header total must equal the sum of its own side, there must be at least two postings, and the period must not
be locked. Those are enforced by `runtime/polism/execute.js` on every commit — `test/f2-ledger.test.js` posts
a sales invoice with one cent of VAT missing and watches the commit be refused with the invariant quoted by
name and both totals of the finished set reported.

The legs are staged before any invariant runs (§21.5), so three postings from one arm land in one commit and
the balance is checked once against the finished set — not once per leg, which would refuse the first one
every time.

## Triggered by
An accountant posting a document: an issued invoice, an approved supplier invoice, a payment that arrived
or left, a goods receipt to be valued, or an approved write-off.

## Rules

If Create journal-entry under condition
  entry-number exists and
  posted-by exists and
  chart active and
  accounting-period accepts postings
  authorized by accountant or tax-accountant
then
  when journal-entry from a sales invoice and invoice zero rated then
    Create posting as "receivable"
      with position 1 with side "debit"
      with account-number from chart.receivables-account-number
      with ledger-account from chart.receivables-account
      with amount from invoice.gross-amount
      with posting-date from entry-date
      with vat-role "none"
      with customer from invoice.customer
    and Create posting as "revenue"
      with position 2 with side "credit"
      with account-number from vat-treatment.revenue-account-number
      with ledger-account from vat-treatment.revenue-account
      with amount from invoice.net-amount
      with posting-date from entry-date
      with vat-kennzahl from vat-treatment.vat-kennzahl-base
      with vat-role from vat-treatment.vat-role-base
      with customer from invoice.customer
  otherwise when journal-entry from a sales invoice then
    Create posting as "receivable"
      with position 1 with side "debit"
      with account-number from chart.receivables-account-number
      with ledger-account from chart.receivables-account
      with amount from invoice.gross-amount
      with posting-date from entry-date
      with vat-role "none"
      with customer from invoice.customer
    and Create posting as "revenue"
      with position 2 with side "credit"
      with account-number from vat-treatment.revenue-account-number
      with ledger-account from vat-treatment.revenue-account
      with amount from invoice.net-amount
      with posting-date from entry-date
      with vat-kennzahl from vat-treatment.vat-kennzahl-base
      with vat-role from vat-treatment.vat-role-base
      with customer from invoice.customer
    and Create posting as "output-vat"
      with position 3 with side "credit"
      with account-number from vat-treatment.output-vat-account-number
      with ledger-account from vat-treatment.output-vat-account
      with amount from invoice.vat-amount
      with tax-base-amount from invoice.net-amount
      with posting-date from entry-date
      with vat-kennzahl from vat-treatment.vat-kennzahl-tax
      with vat-role "output-tax"
      with vat-rate-percent from vat-treatment.vat-rate-percent
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
      with supplier from supplier-invoice.supplier
  otherwise when journal-entry from an incoming payment and payment exchange difference then
    Create posting as "bank"
      with position 1 with side "debit"
      with account-number from chart.bank-account-number
      with ledger-account from chart.bank-account
      with amount from payment.ledger-amount
      with posting-date from entry-date
      with vat-role "none"
    and Create posting as "exchange-loss"
      with position 2 with side "debit"
      with account-number from chart.fx-loss-account-number
      with ledger-account from chart.fx-loss-account
      with amount from payment.difference-amount
      with posting-date from entry-date
      with vat-role "none"
      with exchange-rate from payment.exchange-rate
    and Create posting as "receivable-cleared"
      with position 3 with side "credit"
      with account-number from chart.receivables-account-number
      with ledger-account from chart.receivables-account
      with amount from payment.settled-amount
      with posting-date from entry-date
      with vat-role "none"
      with customer from payment.customer
  otherwise when journal-entry from an incoming payment then
    Create posting as "bank"
      with position 1 with side "debit"
      with account-number from chart.bank-account-number
      with ledger-account from chart.bank-account
      with amount from payment.ledger-amount
      with posting-date from entry-date
      with vat-role "none"
    and Create posting as "receivable-cleared"
      with position 2 with side "credit"
      with account-number from chart.receivables-account-number
      with ledger-account from chart.receivables-account
      with amount from payment.settled-amount
      with posting-date from entry-date
      with vat-role "none"
      with customer from payment.customer
  otherwise when journal-entry from an outgoing payment then
    Create posting as "payable-cleared"
      with position 1 with side "debit"
      with account-number from chart.payables-account-number
      with ledger-account from chart.payables-account
      with amount from payment.settled-amount
      with posting-date from entry-date
      with vat-role "none"
      with supplier from payment.supplier
    and Create posting as "bank"
      with position 2 with side "credit"
      with account-number from chart.bank-account-number
      with ledger-account from chart.bank-account
      with amount from payment.ledger-amount
      with posting-date from entry-date
      with vat-role "none"
  otherwise when journal-entry from a goods receipt then
    Create posting as "inventory"
      with position 1 with side "debit"
      with account-number from chart.inventory-account-number
      with ledger-account from chart.inventory-account
      with amount from debit-amount
      with posting-date from entry-date
      with vat-role "none"
      with article from goods-receipt.article
    and Create posting as "inventory-change"
      with position 2 with side "credit"
      with account-number from chart.inventory-change-account-number
      with ledger-account from chart.inventory-change-account
      with amount from credit-amount
      with posting-date from entry-date
      with vat-role "none"
      with article from goods-receipt.article
  otherwise when journal-entry from a stock adjustment and stock-adjustment decrease then
    Create posting as "write-off"
      with position 1 with side "debit"
      with account-number from chart.write-off-account-number
      with ledger-account from chart.write-off-account
      with amount from stock-adjustment.value
      with posting-date from entry-date
      with vat-role "none"
      with article from stock-adjustment.article
    and Create posting as "inventory-reduction"
      with position 2 with side "credit"
      with account-number from chart.inventory-account-number
      with ledger-account from chart.inventory-account
      with amount from stock-adjustment.value
      with posting-date from entry-date
      with vat-role "none"
      with article from stock-adjustment.article
  otherwise when journal-entry from a stock adjustment then
    Create posting as "inventory-restored"
      with position 1 with side "debit"
      with account-number from chart.inventory-account-number
      with ledger-account from chart.inventory-account
      with amount from stock-adjustment.value
      with posting-date from entry-date
      with vat-role "none"
      with article from stock-adjustment.article
    and Create posting as "write-off-reversed"
      with position 2 with side "credit"
      with account-number from chart.write-off-account-number
      with ledger-account from chart.write-off-account
      with amount from stock-adjustment.value
      with posting-date from entry-date
      with vat-role "none"
      with article from stock-adjustment.article

If Create journal-entry under condition
  entry-date exists and
  document-date exists and
  description exists
  authorized by accountant or tax-accountant
then
  when journal-entry from a sales invoice and invoice issued then
    Update journal-entry with status "posted"
      with posted-by
      with posted-at
      with source-document-reference
  otherwise when journal-entry from a supplier invoice and supplier-invoice approved then
    Update journal-entry with status "posted"
      with posted-by
      with posted-at
      with source-document-reference
  otherwise when journal-entry a correction and correction-reason exists then
    Update journal-entry with status "posted"
      with corrects
      with correction-reason
      with posted-by
      with posted-at
  otherwise
    Update journal-entry with status "posted"
      with posted-by
      with posted-at
      with source-document-reference

## Notes

### The ten cases, as a bookkeeper would write them

Account numbers below are SKR03, because that is what the seed chart in this repository activates. On SKR04
the same rule produces 1200/3300/1800/1140 and so on, from the same text.

**A sales invoice, 19 % domestic.** Net 4,999.99 EUR, VAT 950.00 EUR, gross 5,949.99 EUR.

```
1400  Forderungen aus Lieferungen und Leistungen   Soll   5,949.99
   8400  Erlöse 19 % USt                              Haben  4,999.99
   1776  Umsatzsteuer 19 %                            Haben    950.00
```

Note the 950.00. Nineteen percent of 4,999.99 is 949.9981, and the *kaufmännische Rundung* declared on the
chart (`per-document`, `half-up`) makes it 950.00. That is the whole reason FD-1 exists: in IEEE 754
arithmetic this figure is 949.9981000000001, and an ERP that stores it as a double has already lost.

**A sales invoice, zero rated** — an intra-community supply to an EU business, or an export. Two postings,
no VAT line, and the revenue account comes from the treatment: 8125 for the intra-community supply,
8120 for the export. The exemption obligations — the buyer's VAT identification number, the exemption
wording, the *Gelangensbestätigung* — are predicates on the invoice and are **not** enforced here; see
`processes/invoice-issuance.md`, which says so in the same words.

**A supplier invoice, domestic, input tax deductible.** Net 1,000.00 EUR, 19 % VAT 190.00 EUR.

```
3200  Wareneingang 19 % Vorsteuer                  Soll   1,000.00
1576  Abziehbare Vorsteuer 19 %                    Soll     190.00
   1600  Verbindlichkeiten aus Lief. und Leistungen   Haben  1,190.00
```

**A supplier invoice from another member state, reverse charge** — the case worth reading twice. A Dutch
supplier invoices 12,000.00 EUR with no VAT, because under § 1a UStG we owe the German tax ourselves.

```
3425  Innergemeinschaftlicher Erwerb 19 %          Soll  12,000.00
1574  Abziehbare Vorsteuer aus i. g. Erwerb 19 %   Soll   2,280.00
   1600  Verbindlichkeiten aus Lief. und Leistungen   Haben 12,000.00
   1772  Umsatzsteuer aus i. g. Erwerb 19 %           Haben  2,280.00
```

Four lines, 14,280.00 on each side, and a net effect on the VAT payable of zero — 2,280.00 declared in
line 89 and the same figure deducted in line 61. What must **not** happen is netting the two VAT lines out.
They are separate declarations to the *Finanzamt* and separate lines on the return, and a system that posts
only the difference produces a return that adds up and cannot be explained.

**A customer payment.** `1200 Bank` Soll, `1400 Forderungen` Haben, both 5,949.99. Nothing to decide.

**A customer payment with an exchange difference.** The CHF invoice was translated at the rate on its
invoice date; the money arrived translated at the rate on its value date; the difference is a realised loss.

```
1200  Bank                                         Soll  10,300.00
4840  Aufwendungen aus Währungsumrechnung          Soll     200.00
   1400  Forderungen aus Lief. und Leistungen         Haben 10,500.00
```

The receivable is cleared at the amount it was raised at — 10,500.00 — which is the only figure that leaves
the customer's account at zero. Clearing it at what arrived would leave 200.00 EUR sitting on the customer
forever, and that is how *offene Posten* lists fill up with rubbish. See
`processes/foreign-currency-settlement.md` for the rate documents.

**A payment to a supplier.** `1600 Verbindlichkeiten` Soll, `1200 Bank` Haben. The dangerous part is not the
posting; it is the release, and that is `processes/payment-run.md`.

**A goods receipt.** `3980 Bestand Waren` Soll, `3960 Bestandsveränderungen Waren` Haben. The purchase was
already charged to *Wareneingang* by the supplier invoice; this entry capitalises what is still on the
shelf, which is how German merchandise accounting keeps the profit right without touching it twice.

**A write-off.** `4855 Warenverluste und Inventurdifferenzen` Soll, `3980 Bestand Waren` Haben, at the value
on the stock adjustment. The *authority* for a write-off is not here — it is in
`processes/stock-write-off-approval.md`, which is where the 500 EUR and 5,000 EUR thresholds live.

**A correction to a write-off** — the tenth branch, and the reason there are two stock-adjustment arms. An
adjustment whose `direction` is `increase` posts the same two accounts with the sides swapped: `3980 Bestand
Waren` Soll, `4855 Warenverluste` Haben. That is how a write-off booked at 300.00 EUR that should have been
250.00 EUR is put right — a **new** entry for 50.00 EUR in the next open period, carrying `corrects` and
`correction-reason`, while the original entry stays exactly as it was committed. Never an edit. See
`processes/journal-correction.md` for the discipline and its limits.

### Why one rule and not ten files

Because grammar version 2, like version 1, makes every rule on the same operation a **hard requirement**:
two rules on `Create journal-entry`, one conditioned on a sales invoice and one on a supplier invoice, would
conjoin into a contradiction and refuse every entry. That was limit 14 in `runtime/polism/grammar.md`, and
branches (§14) are what close it. So ten cases are ten arms of one rule rather than ten files.

The cost is that this is the longest rule in the model and a reader has to scroll. The T-accounts below are
the mitigation: each case has one a bookkeeper can check in ten seconds. `processes/invoice-posting.md` and
`processes/supplier-invoice-posting.md` exist for readers who only care about one side, and they quote the
relevant arms verbatim rather than restating them — `test/f2-ledger.test.js` compares the quotations byte for
byte with this file, so they cannot drift.

### What happens when nothing applies

The rule's last arm is an `otherwise`, so every journal entry gets the same minimum: a status of `posted`,
the person who posted it, and the date. An entry whose `source-document-type` is one no arm names — a VAT
payment, an opening balance, a manual reclassification — is therefore not refused by this rule, and it should
not be: grammar §14.1 is explicit that an unmatched branch set contributes nothing rather than inventing a
refusal, because refusing would be the runtime deciding a business question.

What *does* refuse an incomplete entry is the invariants on `information/journal-entry.md`: at least two
postings, the declared count equal to the postings that exist, the debit postings summing to the credit
postings, and each header total equal to the sum of its side. So an entry whose source-document type no arm
names gets no postings and **is** refused — not by this rule inventing a business decision, but by the
document being unable to satisfy what a journal entry is. An opening balance and a manual reclassification
are exactly that case, and they are the two things this ledger still cannot post; see the report.

### The rule does not touch the source document

No consequent updates the invoice, the supplier invoice or the payment. An issued invoice is never edited —
`information/invoice.md` says so and this file keeps that promise — so "has this invoice been posted?" is
answered by looking for a journal entry that names it, not by a flag. Because a `Create` consequent takes
the trigger's id, and one journal entry is one id, posting the same source document twice would need two
entries with two numbers; the control against that is in `information/journal-entry.md` and it is
incomplete. Read the note there before relying on it.

### `authorized by accountant or tax-accountant`

Per-rule authority, which grammar version 1 did not have. It matters here because the same trigger carries
nine cases: a file-level `## Authorized by` would give the write-off branch and the payment branch the same
authority, and the thresholds that make a write-off safe live on a different act with a different
authorisation. The write-off's own authority is in `processes/stock-write-off-approval.md`.

## References

`information/journal-entry.md`, `information/posting.md`, `information/chart-of-accounts.md`,
`information/vat-treatment.md`, `processes/invoice-posting.md`,
`processes/foreign-currency-settlement.md`, `processes/stock-write-off-approval.md`,
`processes/period-close.md`
