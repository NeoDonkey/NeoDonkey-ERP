# Seed: a minimal international chart — thirteen accounts

Not every entity in a European group keeps German books. A Dutch B.V. or an Italian S.r.l. files under
its own local GAAP, its accountant has never heard of SKR04, and forcing it onto a German
*Kontenrahmen* so that the software is happy is exactly the tail-wagging-the-dog that makes people hate
ERP systems.

So there is a third chart: **13 accounts**, four digits, English captions, the smallest set that can
carry the flows in `processes/` and still close a balance sheet. It is not a published standard and does
not claim to be — every number is `company-defined` in the sense that matters, and the whole chart is
expected to be replaced by whatever the local accountant asks for. Its purpose here is to prove that the
ledger machinery is not German-only: the posting rules name accounts by number and read their properties
from `ledger-account`, so a different chart is a different set of documents and no code at all.

VAT is modelled with one recoverable and one payable account, because a local registration outside
Germany usually needs no more than that at this scale. A country with split rates or a reverse-charge
regime of its own needs more accounts, and that is a chart change, not a release.

## Notes

### The table

| account-number | name | account-type | normal-balance | statement-section | vat-role | vat-kennzahl | vat-rate-percent | reconciliation-account-for | manual | source |
|---|---|---|---|---|---|---|---|---|---|---|
| 1010 | Cash and bank | asset | debit | balance-sheet | none | | | bank | true | company-defined |
| 1100 | Trade receivables | asset | debit | balance-sheet | none | | | receivables | true | company-defined |
| 1200 | Inventory — merchandise | asset | debit | balance-sheet | none | | | none | true | company-defined |
| 1300 | VAT recoverable | asset | debit | balance-sheet | input-tax | | | vat | true | company-defined |
| 2100 | Trade payables | liability | credit | balance-sheet | none | | | payables | true | company-defined |
| 2300 | VAT payable | liability | credit | balance-sheet | output-tax | | | vat | true | company-defined |
| 3000 | Share capital | equity | credit | balance-sheet | none | | | none | true | company-defined |
| 3100 | Retained earnings | equity | credit | balance-sheet | none | | | none | true | company-defined |
| 4000 | Revenue — goods | revenue | credit | profit-and-loss | taxable-turnover | | | none | false | company-defined |
| 4900 | Foreign exchange gains | revenue | credit | profit-and-loss | none | | | none | true | company-defined |
| 5000 | Cost of goods sold | expense | debit | profit-and-loss | none | | | none | false | company-defined |
| 5500 | Inventory write-offs | expense | debit | profit-and-loss | none | | | none | false | company-defined |
| 6900 | Foreign exchange losses | expense | debit | profit-and-loss | none | | | none | true | company-defined |

### Why no vat-kennzahl

`vat-kennzahl` is the line number of a *German* VAT return. Outside Germany the field is empty and
`processes/vat-return.md` does not apply — a Dutch entity files a Dutch return, which is a different
document with different lines and is not modelled here. `vat-role` is still populated, because "this
account holds tax I owe" and "this account holds tax I can reclaim" are true everywhere, and the trial
balance and the balance sheet need them.

### What a local accountant will immediately want added

Cost of sales split by product group, a separate account for freight in and freight out, payroll and its
social-security clearing accounts, fixed assets with accumulated depreciation, and prepayments. This
chart has none of them. It is a starting point for a small selling entity, not a chart for a company
with staff and premises.
