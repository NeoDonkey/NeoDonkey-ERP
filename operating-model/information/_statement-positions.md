# Seed: balance sheet and profit and loss positions, SKR03

Seventeen positions — thirteen leaves and four subtotals — enough to draw a *Bilanz* under § 266 HGB and a
*Gewinn- und Verlustrechnung* under § 275 Abs. 2 HGB (*Gesamtkostenverfahren*) from the 34 accounts in
`information/_chart-skr03.md`. One row per `financial-statement-line` document.

German law does the structuring here and that is a gift: § 266 gives the balance sheet's positions and their
order, § 275 gives the P&L, and a *Kapitalgesellschaft* has no discretion about either. So the positions carry
the paragraph they come from, and an auditor can check the mapping against the law rather than against
somebody's naming convention.

Accounts reach a position through an inclusive number range plus an explicit inclusion list for the ones a
range would catch wrongly. Note how narrow the ranges are. Account numbers are compared as **text**, so
`0868` to `9000` would sweep up 1000, 1200 and 8400 on the way — which is why the equity carry-forward
position uses a one-account range and names 9000 explicitly. That sharp edge is written down in
`information/financial-statement-line.md` and it is the kind of thing that produces a balance sheet which is
almost right.

## Notes

### The table

| position-code | caption | statement | section | position | level | parent-position-code | legal-reference | account-range-from | account-range-to | included-accounts | normal-balance | is-subtotal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B | Umlaufvermögen | balance-sheet | assets | 10 | 1 | | § 266 Abs. 2 B HGB | | | | debit | true |
| B-I-3 | Fertige Erzeugnisse und Waren | balance-sheet | assets | 11 | 3 | B | § 266 Abs. 2 B I 3 HGB | 3980 | 3980 | | debit | false |
| B-II-1 | Forderungen aus Lieferungen und Leistungen | balance-sheet | assets | 12 | 3 | B | § 266 Abs. 2 B II 1 HGB | 1400 | 1400 | | debit | false |
| B-II-4 | Sonstige Vermögensgegenstände | balance-sheet | assets | 13 | 3 | B | § 266 Abs. 2 B II 4 HGB | 1571 | 1577 | | debit | false |
| B-IV | Kassenbestand und Bankguthaben | balance-sheet | assets | 14 | 2 | B | § 266 Abs. 2 B IV HGB | 1000 | 1370 | | debit | false |
| A | Eigenkapital | balance-sheet | equity-and-liabilities | 20 | 1 | | § 266 Abs. 3 A HGB | | | | credit | true |
| A-I | Gezeichnetes Kapital | balance-sheet | equity-and-liabilities | 21 | 2 | A | § 266 Abs. 3 A I HGB | 0800 | 0800 | | credit | false |
| A-IV | Gewinnvortrag und Verlustvortrag | balance-sheet | equity-and-liabilities | 22 | 2 | A | § 266 Abs. 3 A IV HGB | 0868 | 0868 | 9000 | credit | false |
| C | Verbindlichkeiten | balance-sheet | equity-and-liabilities | 30 | 1 | | § 266 Abs. 3 C HGB | | | | credit | true |
| C-4 | Verbindlichkeiten aus Lieferungen und Leistungen | balance-sheet | equity-and-liabilities | 31 | 2 | C | § 266 Abs. 3 C 4 HGB | 1600 | 1600 | | credit | false |
| C-8 | Sonstige Verbindlichkeiten, davon aus Steuern | balance-sheet | equity-and-liabilities | 32 | 2 | C | § 266 Abs. 3 C 8 HGB | 1771 | 1791 | | credit | false |
| GuV-1 | Umsatzerlöse | profit-and-loss | revenue | 40 | 1 | | § 275 Abs. 2 Nr. 1 HGB | 8120 | 8400 | | credit | false |
| GuV-2 | Erhöhung oder Verminderung des Bestands an Waren | profit-and-loss | revenue | 41 | 1 | | § 275 Abs. 2 Nr. 2 HGB | 3960 | 3960 | | credit | false |
| GuV-4 | Sonstige betriebliche Erträge | profit-and-loss | revenue | 42 | 1 | | § 275 Abs. 2 Nr. 4 HGB | 2660 | 2660 | | credit | false |
| GuV-5a | Aufwendungen für Waren und bezogene Leistungen | profit-and-loss | expenses | 50 | 2 | | § 275 Abs. 2 Nr. 5a HGB | 3200 | 3425 | 3800 | debit | false |
| GuV-8 | Sonstige betriebliche Aufwendungen | profit-and-loss | expenses | 51 | 1 | | § 275 Abs. 2 Nr. 8 HGB | 4840 | 4970 | | debit | false |
| GuV-E | Jahresüberschuss oder Jahresfehlbetrag | profit-and-loss | result | 90 | 1 | | § 275 Abs. 2 Nr. 17 HGB | | | | credit | true |

### Every account lands in exactly one position, and that is tested

`test/f2-ledger.test.js` walks the 34 SKR03 accounts against this table and asserts that each one is caught
by exactly one leaf position — not two, not none. Nothing in the operating model enforces it: the mapping is
a range in a text field, and `information/financial-statement-line.md` says plainly that a mapping assigning
one account to two positions would not be refused. The test is what catches it in this repository, and a
company editing the ranges in the field would not be caught. That is the weakest link in the ledger model.

### The four subtotals carry no accounts

`B`, `A`, `C` and `GuV-E` are `is-subtotal: true` with no range, because they are sums of their children.
`GuV-E` is the result, which is the difference between the revenue and expense positions and is not a range
over accounts at all — it is arithmetic, which POLISM does not do in conditions, so the result is computed by
whoever draws the statement and checked against the balance sheet the way every accountant checks it: assets
minus liabilities minus opening equity.

### What is missing from § 266

Almost everything a company with premises has: intangible and tangible fixed assets (A I and A II), financial
assets (A III), prepaid expenses, provisions (B), and the equity detail below subscribed capital — capital
reserve, revenue reserves, the result for the year as its own position. Also missing from § 275: personnel
expenses (Nr. 6), depreciation (Nr. 7), the financial result (Nr. 12 to 16) and taxes (Nr. 18). A company that
employs people or owns a forklift needs them.
