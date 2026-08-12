# Invoice posting

Turning an issued invoice into the two or three lines that make it real in the books. This is the page to
read if you want to satisfy yourself that NeoDonkey does bookkeeping and not something that resembles it.

The whole of it, for a domestic sale at 19 %:

```
1400  Forderungen aus Lieferungen und Leistungen   Soll   5,949.99
   8400  Erlöse 19 % USt                              Haben  4,999.99
   1776  Umsatzsteuer 19 %                            Haben    950.00
```

Debit the customer with what they owe including tax, credit revenue with the net, credit the *Finanzamt*
with the tax we have collected on its behalf. Three lines, and the sum on the left equals the sum on the
right — which the runtime does not merely check here, it refuses to commit otherwise, because
`information/journal-entry.md` states it as an invariant on the document rather than as a step in a
process.

## Triggered by
An accountant posting an issued invoice: creating a journal entry that names the invoice, the period, the
chart and the tax situation.

## Notes

### The live rule, quoted

What follows is the two sales arms of the rule in `processes/journal-posting.md`, **verbatim** —
`test/f2-ledger.test.js` compares this block byte for byte with that file, so the two cannot drift apart, and
it posts this very invoice through `runtime/polism/execute.js` and checks the three legs that come out.

`Create posting as "receivable"` is grammar §21: one labelled create per leg, id `<entry>-receivable`, and the
leg's `journal-entry` reference filled from the declarations so the balance invariant can find the set.
`with amount from invoice.gross-amount` is §17: one hop, checked against both field declarations at parse
time. Every account it names comes from `information/chart-of-accounts.md` and
`information/vat-treatment.md`, so nothing here changes when the chart does.

```
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
      with vat-rate-percent from vat-treatment.vat-rate-percent```

### Read it line by line

`then when journal-entry from a sales invoice and invoice zero rated` — the first branch is the exempt case:
an intra-community supply to an EU business, or an export. There is no VAT line at all, because there is no
VAT. Two postings, and the invoice's gross amount equals its net amount.

`otherwise when journal-entry from a sales invoice` — everything else. Three postings: the receivable at
gross, revenue at net, output tax at the VAT amount, with the net carried on the tax line as
`tax-base-amount` so that the *Umsatzsteuervoranmeldung* can report a base and a tax that belong together.

No account number appears anywhere in it. `chart.receivables-account-number` is 1400 in SKR03 and 1200 in
SKR04; `vat-treatment.revenue-account-number` is 8400 for a domestic sale at 19 %, 8300 at 7 %, 8125 for an
intra-community supply, 8120 for an export, 8336 for a One-Stop-Shop distance sale. Those are five
different journal entries produced by the same eighteen lines of text, and the difference between them lives
in `information/vat-treatment.md`, which is where a tax adviser would look for it.

### The 950.00, and why money is a string

Nineteen percent of 4,999.99 EUR is 949.9981. The chart declares `rounding-rule: per-document` and
`rounding-mode: half-up`, so the VAT on this invoice is 950.00 EUR — *kaufmännische Rundung*, once, on the
invoice total. In IEEE 754 double arithmetic the same calculation produces 949.9981000000001, and
`0.1 + 0.2` is not `0.3`. That is why FD-1 makes every amount an exact decimal string with its currency and
why no `Number` touches a monetary value anywhere in the runtime. It is also the fastest way to fail a
software audit, which is the practical reason it was fixed before the ledger was built.

### What this rule does not check, and where that is said

Three obligations on an issued invoice are real, are conditional, and are **not** enforced by this rule:

- **Reverse charge.** A zero-rated supply to an EU business needs the buyer's VAT identification number on
  the face of the invoice, the exemption wording (*Steuerschuldnerschaft des Leistungsempfängers*), and zero
  VAT — all three together. The predicate `reverse charge properly stated` on the invoice is that sentence.
- **Proof of transport.** A zero-rated intra-community supply needs a *Gelangensbestätigung* or it is
  re-assessed at 19 % years later. The predicate is `transport proven`.
- **XRechnung.** A public-sector invoice needs a Leitweg-ID and a stored XML. The predicate is
  `xrechnung complete`.

`processes/invoice-issuance.md` already said all three, in the same words, before there was a ledger. They
remain what they were: predicates a person checks at the month-end close. The branch above will post a
zero-rated supply with no *Gelangensbestätigung* on file, and the exposure is real. It is written here so
that nobody reads this page and believes otherwise.

### The invoice is not edited

No consequent touches the invoice. It keeps the status `issued` that `processes/invoice-issuance.md` gave
it, and whether it has been posted is answered by looking for a journal entry that names it. That is not
fastidiousness: an issued invoice is in the customer's hands, and a system that can quietly change one has
no answer to "is this the invoice you sent me".

### Where the guarantee actually lives

Not in the block above, and that matters more here than anywhere else in the ledger.
`information/journal-entry.md` holds seven invariants, and three of them are the ones that decide this page:
each header total must equal the sum of the postings on its side, and the two header totals must be equal.
Therefore the postings balance. A commit that breaks any of the three does not happen, and the refusal quotes
the invariant by name, the file it is declared in, the entry, and the two figures that did not match.

That is enforced by `runtime/polism/execute.js` today, and `test/f2-ledger.test.js` proves it by posting this
very invoice with 949.99 EUR of VAT instead of 950.00 and watching the commit be refused. The posting scheme
above says *which accounts*; the invariants say *whether it may be written at all*. Only the second is a
guarantee, and it is the one that is running.

## References

`processes/journal-posting.md`, `processes/invoice-issuance.md`, `information/journal-entry.md`,
`information/posting.md`, `information/vat-treatment.md`, `information/chart-of-accounts.md`
