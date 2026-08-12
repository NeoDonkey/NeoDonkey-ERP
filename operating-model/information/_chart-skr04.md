# Seed: SKR04 — the same 34 accounts, in balance-sheet order

SKR04 is DATEV's *Abschlussgliederung*: the numbers follow the order of the annual accounts, so assets
come first, then equity and liabilities, then revenue, then expenses. Newer German companies are usually
set up on it, older ones on SKR03, and the reason a company keeps the one it has is that the tax
adviser's reports, the *Bilanz* mappings and eight years of comparative figures all hang off it.

This is the same **34 accounts** as `_chart-skr03.md`, renumbered. It is here so that the claim "SKR03 and
SKR04 are both supported" can be checked rather than believed, and so that a company on SKR04 does not
have to translate the examples in the process files in its head. Only one chart is `active`.

The columns mean what they mean in the SKR03 seed. `source` is `published-standard` where DATEV assigns
that number to that purpose and `company-defined` where we have taken a free position; the
`company-defined` rows must be confirmed with the tax adviser before the first export, and the whole
table must be diffed against the DATEV release for the fiscal year, because DATEV renumbers.

## Notes

### The table

| account-number | name | account-type | normal-balance | statement-section | vat-role | vat-kennzahl | vat-rate-percent | reconciliation-account-for | manual | source |
|---|---|---|---|---|---|---|---|---|---|---|
| 1140 | Waren | asset | debit | balance-sheet | none | | | none | true | published-standard |
| 1200 | Forderungen aus Lieferungen und Leistungen | asset | debit | balance-sheet | none | | | receivables | true | published-standard |
| 1401 | Abziehbare Vorsteuer 7 % | asset | debit | balance-sheet | input-tax | 66 | 7 | vat | true | published-standard |
| 1404 | Abziehbare Vorsteuer aus innergemeinschaftlichem Erwerb 19 % | asset | debit | balance-sheet | input-tax | 61 | 19 | vat | true | published-standard |
| 1406 | Abziehbare Vorsteuer 19 % | asset | debit | balance-sheet | input-tax | 66 | 19 | vat | true | published-standard |
| 1407 | Abziehbare Vorsteuer nach § 13b UStG 19 % | asset | debit | balance-sheet | input-tax | 67 | 19 | vat | true | published-standard |
| 1600 | Kasse | asset | debit | balance-sheet | none | | | none | false | published-standard |
| 1800 | Bank | asset | debit | balance-sheet | none | | | bank | true | published-standard |
| 1815 | Verrechnungskonto Zahlungsdienstleister | asset | debit | balance-sheet | none | | | bank | true | company-defined |
| 2900 | Gezeichnetes Kapital | equity | credit | balance-sheet | none | | | none | true | published-standard |
| 2970 | Gewinnvortrag vor Verwendung | equity | credit | balance-sheet | none | | | none | true | published-standard |
| 9000 | Saldenvorträge Sachkonten | equity | credit | balance-sheet | none | | | none | true | published-standard |
| 3300 | Verbindlichkeiten aus Lieferungen und Leistungen | liability | credit | balance-sheet | none | | | payables | true | published-standard |
| 3801 | Umsatzsteuer 7 % | liability | credit | balance-sheet | output-tax | 86 | 7 | vat | true | published-standard |
| 3804 | Umsatzsteuer aus innergemeinschaftlichem Erwerb 19 % | liability | credit | balance-sheet | output-tax | 89 | 19 | vat | true | published-standard |
| 3806 | Umsatzsteuer 19 % | liability | credit | balance-sheet | output-tax | 81 | 19 | vat | true | published-standard |
| 3820 | Umsatzsteuer-Vorauszahlungen | liability | credit | balance-sheet | none | | | vat | true | published-standard |
| 3837 | Umsatzsteuer nach § 13b UStG 19 % | liability | credit | balance-sheet | output-tax | 84 | 19 | vat | true | published-standard |
| 3840 | Umsatzsteuer One-Stop-Shop | liability | credit | balance-sheet | output-tax | | | vat | true | company-defined |
| 4120 | Steuerfreie Umsätze § 4 Nr. 1a UStG | revenue | credit | profit-and-loss | exempt-turnover | 43 | 0 | none | false | published-standard |
| 4125 | Steuerfreie innergemeinschaftliche Lieferungen § 4 Nr. 1b UStG | revenue | credit | profit-and-loss | exempt-turnover | 41 | 0 | none | false | published-standard |
| 4300 | Erlöse 7 % USt | revenue | credit | profit-and-loss | taxable-turnover | 86 | 7 | none | false | published-standard |
| 4336 | Erlöse aus im anderen EU-Land steuerpflichtigen Lieferungen | revenue | credit | profit-and-loss | non-taxable-turnover | 45 | 0 | none | false | published-standard |
| 4400 | Erlöse 19 % USt | revenue | credit | profit-and-loss | taxable-turnover | 81 | 19 | none | false | published-standard |
| 4840 | Erträge aus Währungsumrechnung | revenue | credit | profit-and-loss | none | | | none | true | company-defined |
| 5200 | Wareneingang 19 % Vorsteuer | expense | debit | profit-and-loss | none | | 19 | none | false | published-standard |
| 5300 | Wareneingang 7 % Vorsteuer | expense | debit | profit-and-loss | none | | 7 | none | false | published-standard |
| 5425 | Innergemeinschaftlicher Erwerb 19 % Vorsteuer und 19 % Umsatzsteuer | expense | debit | profit-and-loss | acquisition-turnover | 89 | 19 | none | false | published-standard |
| 5800 | Bezugsnebenkosten | expense | debit | profit-and-loss | none | | 19 | none | false | published-standard |
| 5880 | Bestandsveränderungen Waren | expense | credit | profit-and-loss | none | | | none | true | published-standard |
| 6300 | Sonstige betriebliche Aufwendungen | expense | debit | profit-and-loss | none | | | none | false | published-standard |
| 6795 | Warenverluste und Inventurdifferenzen | expense | debit | profit-and-loss | none | | | none | false | company-defined |
| 6855 | Nebenkosten des Geldverkehrs | expense | debit | profit-and-loss | none | | | none | false | published-standard |
| 6880 | Aufwendungen aus Währungsumrechnung | expense | debit | profit-and-loss | none | | | none | true | company-defined |

### The mapping, for anyone migrating

| SKR03 | SKR04 | Account |
|---|---|---|
| 1200 | 1800 | Bank |
| 1400 | 1200 | Forderungen aus Lieferungen und Leistungen |
| 1600 | 3300 | Verbindlichkeiten aus Lieferungen und Leistungen |
| 3980 | 1140 | Warenbestand |
| 1776 | 3806 | Umsatzsteuer 19 % |
| 1576 | 1406 | Abziehbare Vorsteuer 19 % |
| 8400 | 4400 | Erlöse 19 % USt |
| 3425 | 5425 | Innergemeinschaftlicher Erwerb 19 % |

The two numbers that catch people are 1200 and 1400. In SKR03, 1200 is the bank; in SKR04 it is trade
receivables. A ledger that stores an account number without the chart it belongs to cannot tell those
apart, which is why `ledger-account` is `## Identified by chart and account-number` and never by number alone.

### The five company-defined rows

1815 for the payment service provider clearing account, 3840 for the One-Stop-Shop VAT liability, and
4840/6880 for the currency translation pair. 6795 for shrinkage is a fifth: SKR04, like SKR03, does not
prescribe an account for inventory differences.

### What is not here

Payroll, fixed assets and depreciation, accruals and deferrals, provisions, loans and interest, private
accounts, and every VAT rate other than 19 %, 7 % and zero.
