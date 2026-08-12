# Seed: SKR03 — the accounts this company uses

SKR03 is DATEV's *Prozessgliederung* — accounts grouped by what the business does, which is why the
numbers look arbitrary until you learn them and then never stop making sense. This table is the subset
this company has actually opened: **34 accounts**, one row per `ledger-account` document, against the
SKR03 as published for the 2026 fiscal year.

The underscore in the filename means the runtime skips this file. It is reference data a bookkeeper
reads and checks, and one `ledger-account` document is created per row when the chart is adopted. It is
not executable text and does not pretend to be — POLISM has six categories for a company and none of
them is "reference tables", which is named as a compromise in the report accompanying this work.

Two columns exist to keep this table honest. **source** is `published-standard` where DATEV assigns that
number to that purpose, and `company-defined` where we have taken a free position for a purpose the
standard does not name; every `company-defined` row must be signed off by the tax adviser before the
first DATEV export. **manual** is `blocked-for-manual-posting`: `true` means only rules may post there,
which is the control that stops a reconciliation being made to agree by hand.

## Notes

### The table

| account-number | name | account-type | normal-balance | statement-section | vat-role | vat-kennzahl | vat-rate-percent | reconciliation-account-for | manual | source |
|---|---|---|---|---|---|---|---|---|---|---|
| 0800 | Gezeichnetes Kapital | equity | credit | balance-sheet | none | | | none | true | published-standard |
| 0868 | Gewinnvortrag vor Verwendung | equity | credit | balance-sheet | none | | | none | true | published-standard |
| 9000 | Saldenvorträge Sachkonten | equity | credit | balance-sheet | none | | | none | true | published-standard |
| 1000 | Kasse | asset | debit | balance-sheet | none | | | none | false | published-standard |
| 1200 | Bank | asset | debit | balance-sheet | none | | | bank | true | published-standard |
| 1370 | Verrechnungskonto Zahlungsdienstleister | asset | debit | balance-sheet | none | | | bank | true | company-defined |
| 1400 | Forderungen aus Lieferungen und Leistungen | asset | debit | balance-sheet | none | | | receivables | true | published-standard |
| 1571 | Abziehbare Vorsteuer 7 % | asset | debit | balance-sheet | input-tax | 66 | 7 | vat | true | published-standard |
| 1574 | Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 % | asset | debit | balance-sheet | input-tax | 61 | 19 | vat | true | published-standard |
| 1576 | Abziehbare Vorsteuer 19 % | asset | debit | balance-sheet | input-tax | 66 | 19 | vat | true | published-standard |
| 1577 | Abziehbare Vorsteuer nach § 13b UStG 19 % | asset | debit | balance-sheet | input-tax | 67 | 19 | vat | true | published-standard |
| 3980 | Bestand Waren | asset | debit | balance-sheet | none | | | none | true | published-standard |
| 1600 | Verbindlichkeiten aus Lieferungen und Leistungen | liability | credit | balance-sheet | none | | | payables | true | published-standard |
| 1771 | Umsatzsteuer 7 % | liability | credit | balance-sheet | output-tax | 86 | 7 | vat | true | published-standard |
| 1772 | Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 % | liability | credit | balance-sheet | output-tax | 89 | 19 | vat | true | published-standard |
| 1776 | Umsatzsteuer 19 % | liability | credit | balance-sheet | output-tax | 81 | 19 | vat | true | published-standard |
| 1780 | Umsatzsteuer-Vorauszahlungen | liability | credit | balance-sheet | none | | | vat | true | published-standard |
| 1787 | Umsatzsteuer nach § 13b UStG 19 % | liability | credit | balance-sheet | output-tax | 84 | 19 | vat | true | published-standard |
| 1791 | Umsatzsteuer One-Stop-Shop | liability | credit | balance-sheet | output-tax | | | vat | true | company-defined |
| 8120 | Steuerfreie Umsätze § 4 Nr. 1a UStG | revenue | credit | profit-and-loss | exempt-turnover | 43 | 0 | none | false | published-standard |
| 8125 | Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG | revenue | credit | profit-and-loss | exempt-turnover | 41 | 0 | none | false | published-standard |
| 8300 | Erlöse 7 % USt | revenue | credit | profit-and-loss | taxable-turnover | 86 | 7 | none | false | published-standard |
| 8336 | Erlöse aus im anderen EU-Land steuerpflichtigen Lieferungen | revenue | credit | profit-and-loss | non-taxable-turnover | 45 | 0 | none | false | published-standard |
| 8400 | Erlöse 19 % USt | revenue | credit | profit-and-loss | taxable-turnover | 81 | 19 | none | false | published-standard |
| 2660 | Erträge aus Währungsumrechnung | revenue | credit | profit-and-loss | none | | | none | true | company-defined |
| 3200 | Wareneingang 19 % Vorsteuer | expense | debit | profit-and-loss | none | | 19 | none | false | published-standard |
| 3300 | Wareneingang 7 % Vorsteuer | expense | debit | profit-and-loss | none | | 7 | none | false | published-standard |
| 3425 | Innergemeinschaftlicher Erwerb 19 % Vorsteuer und 19 % Umsatzsteuer | expense | debit | profit-and-loss | acquisition-turnover | 89 | 19 | none | false | published-standard |
| 3800 | Bezugsnebenkosten | expense | debit | profit-and-loss | none | | 19 | none | false | published-standard |
| 3960 | Bestandsveränderungen Waren | expense | credit | profit-and-loss | none | | | none | true | published-standard |
| 4840 | Aufwendungen aus Währungsumrechnung | expense | debit | profit-and-loss | none | | | none | true | company-defined |
| 4855 | Warenverluste und Inventurdifferenzen | expense | debit | profit-and-loss | none | | | none | false | company-defined |
| 4900 | Sonstige betriebliche Aufwendungen | expense | debit | profit-and-loss | none | | | none | false | published-standard |
| 4970 | Nebenkosten des Geldverkehrs | expense | debit | profit-and-loss | none | | | none | false | published-standard |

### Why 3960 is an expense account with a credit normal balance

*Bestandsveränderungen Waren* is the German answer to "how does merchandise get onto the balance sheet
without touching the profit twice". The supplier invoice charges the purchase to *Wareneingang* (3200,
3300 or 3425) in the profit and loss account. The goods receipt then debits 3980 *Bestand Waren* and
credits 3960, which cancels that charge to the extent the goods are still on the shelf. Its natural side
is therefore credit even though it sits in the *Materialaufwand* group. It is `manual: true` because
nothing but the goods-receipt and write-off rules has any business touching it.

### The five company-defined rows

- **1370 Verrechnungskonto Zahlungsdienstleister** — the clearing account for card and wallet
  settlements from the webshop. SKR03 has no prescribed position; every DATEV setup invents one.
- **1791 Umsatzsteuer One-Stop-Shop** — the liability for VAT owed to other member states through OSS.
  It is not German VAT and must not sit on 1776, or the *Umsatzsteuervoranmeldung* is wrong.
- **2660 Erträge aus Währungsumrechnung** and **4840 Aufwendungen aus Währungsumrechnung** — the pair
  that receives the exchange difference between invoicing and payment. Some advisers put these in the
  financial result instead; that is a one-row change here.
- **4855 Warenverluste und Inventurdifferenzen** — shrinkage. SKR03 does not prescribe an account for
  it. A tax adviser may prefer to route normal shrinkage through 3960 and reserve an expense account for
  abnormal loss only. That is a legitimate difference of opinion and it is settled in this table, not in
  code.

### What is not here

No payroll, no fixed assets and no depreciation, no accruals or deferrals, no provisions, no loans or
interest, no private accounts, and no VAT rate other than 19 %, 7 % and zero. Those accounts and the
rules that feed them are absent from this model, not merely unpopulated.
