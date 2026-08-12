# Foreign currency settlement

An invoice in Swiss francs, a payment in Swiss francs, and two different exchange rates. The difference between
them is a real gain or loss and it belongs in the profit and loss account with its own name.

FD-1 is the rule this file exists to keep: **mixed currencies do not add, and conversion is an explicit
modelled act carrying its rate and date.** So a rate is a document — `information/exchange-rate.md` — with an
id, a source and a date, not a number a service supplied at posting time and nobody wrote down. Given the
invoice, the payment and the two rate documents, anybody with a calculator can reproduce the figure that hit
the P&L, which is the difference between a ledger you can audit and one you have to trust.

German tax law is narrower than most people expect about *which* rate. § 16 Abs. 6 UStG requires the
*Umsatzsteuer-Umrechnungskurse* published monthly by the Bundesministerium der Finanzen for translating
foreign-currency turnover for VAT purposes — not the rate your bank gave you. So a company can legitimately
need two rates for the same day, and `purpose` on the rate document is what keeps them apart.

## Triggered by
Capturing a published exchange rate; then invoicing or receiving payment in a currency other than the ledger
currency.

## Rules

If Create exchange-rate under condition
  rate exists and
  rate-date exists and
  source-reference exists and
  captured-by exists
  authorized by treasurer or accountant
then
  Update exchange-rate with status "active"
    with source-reference
    with captured-by
    with captured-on

If Update payment under condition
  payment foreign currency and
  exchange-rate exists and
  ledger-amount exists and
  settled-amount exists
then
  Update payment with exchange-rate
    with ledger-amount
    with settled-amount

## Notes

### The worked numbers

An invoice of 10,000.00 CHF issued on 20 July, when one franc bought 1.0500 euros:

```
1400  Forderungen aus Lieferungen und Leistungen   Soll  10,500.00
   8120  Steuerfreie Umsätze § 4 Nr. 1a UStG          Haben 10,500.00
```

The money arrives on 28 July, when one franc buys 1.0300 euros — 10,300.00 EUR:

```
1200  Bank                                         Soll  10,300.00
4840  Aufwendungen aus Währungsumrechnung          Soll     200.00
   1400  Forderungen aus Lief. und Leistungen         Haben 10,500.00
```

The receivable is cleared at **10,500.00**, the amount it was raised at. That is the only figure that leaves the
customer's account at zero. Clearing it at what arrived would leave 200.00 EUR sitting on the customer forever,
which is how an *offene Posten* list fills up with items nobody can explain. The 200.00 is a realised loss and
goes to its own account, where the controller can see how much the company is paying for currency risk.

`processes/journal-posting.md` posts all three lines, from the branch
`otherwise when journal-entry from an incoming payment and payment exchange difference`. The 200.00 comes from
`payment.difference-amount` and the reason from `difference-reason`, which must be `exchange-difference` — if
somebody classified it as `short-payment`, the money would go to a different account, which is correct and is
why the classification is an enumeration rather than a free text field.

### The invariant that is missing

**A foreign-currency posting should be unable to exist without a rate document.** That sentence is conditional
— if `original-amount` is set then `exchange-rate` must exist — and an invariant is a conjunction of conditions
with no implication in it. `information/posting.md` says so at the point where it hurts. The obligation is
therefore carried by the second rule above, which refuses a foreign payment whose rate is missing. That is
enforcement at the point of creation, which is genuinely weaker: a posting written by some future rule that
forgets would not be caught.

### What is not here

No rate feed and no automatic retrieval — a posting whose date has no rate document is refused rather than
translated at the nearest available rate, because nearest-available is the kind of quiet helpfulness that
produces a figure nobody can reproduce. No unrealised revaluation of open foreign-currency balances at the
period end, which § 256a HGB requires for the annual accounts and which this model does not do. No second
ledger in a foreign currency, which a group with a USD reporting requirement will want; the seventh invariant
on `information/journal-entry.md` forbids it by design.

## References

`information/exchange-rate.md`, `information/posting.md`, `information/payment.md`,
`processes/journal-posting.md`, `information/chart-of-accounts.md`
