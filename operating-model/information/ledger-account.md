# Ledger account

One account in one chart. A number, a name, a type, and the tax properties without which a VAT return
cannot be computed. There are about 1,400 accounts in a full SKR03; this company has created the ones
its own transactions touch, which is how a real set of books works — an unused account is clutter, and a
missing one is refused loudly the first time a rule reaches for it.

Two properties do the work that most ERPs bury in code. `normal-balance` says which side increases the
account, so a trial balance can be presented the way an accountant reads it without the runtime knowing
what "asset" means. `vat-kennzahl` is the line of the German *Umsatzsteuervoranmeldung* that this
account feeds — 81 for turnover at 19 %, 89 for intra-community acquisitions, 66 for deductible input
tax. The VAT return is then an aggregation over postings grouped by that field, and not a nest of
special cases. When the legislator renumbers a line, one account document changes.

`blocked-for-manual-posting` is the control an auditor asks about within the first ten minutes. VAT
accounts, the receivables control account and the payables control account are maintained by rules from
invoices and payments. A bookkeeper who can post to them by hand can make a reconciliation agree
without the underlying facts agreeing, and then no one can tell which of the two is wrong.

## Fields
- account-number: text required — The account number, as the accountant dials it. Text, not a number: 0800 is not 800.
- name: text required — The German or English caption, as it appears in the chart.
- chart: reference to chart-of-accounts required — Which chart this number belongs to.
- account-type: one of asset, liability, equity, revenue, expense required — Where it lands.
- normal-balance: one of debit, credit required — Which side increases it.
- statement-section: one of balance-sheet, profit-and-loss required — Which statement it appears in.
- statement-line: reference to financial-statement-line — The § 266 HGB position it rolls into.
- vat-kennzahl: text — The UStVA line this account feeds. Empty for accounts with no tax character.
- vat-role: one of none, output-tax, input-tax, taxable-turnover, exempt-turnover, non-taxable-turnover, acquisition-turnover required — What the VAT return does with it.
- vat-rate-percent: number — The rate the account carries. Zero for exempt and reverse-charge accounts.
- datev-tax-key: text — The DATEV Steuerschlüssel (BU-Schlüssel) for the export.
- reconciliation-account-for: one of none, receivables, payables, bank, vat required — Whether it is a control account with a subledger behind it.
- blocked-for-manual-posting: boolean required — True where only rules may post.
- account-source: one of published-standard, company-defined required — Whether DATEV prescribes this number for this purpose.
- opened-on: date required — When the account was created.
- status: one of active, retired required — A retired account keeps its history.

## Identified by
chart and account-number

## Created on demand
no

## Predicates
- active: status is "active"
- retired: status is "retired"
- postable by hand: blocked-for-manual-posting is false
- rule maintained: blocked-for-manual-posting is true
- balance sheet account: statement-section is "balance-sheet"
- income statement account: statement-section is "profit-and-loss"
- debit account: normal-balance is "debit"
- credit account: normal-balance is "credit"
- output tax account: vat-role is "output-tax"
- input tax account: vat-role is "input-tax"
- taxable turnover account: vat-role is "taxable-turnover"
- exempt turnover account: vat-role is "exempt-turnover"
- acquisition account: vat-role is "acquisition-turnover"
- feeds the vat return: vat-kennzahl exists
- receivables control: reconciliation-account-for is "receivables"
- payables control: reconciliation-account-for is "payables"
- bank account: reconciliation-account-for is "bank"
- confirmed against datev: account-source is "published-standard"
- needs adviser confirmation: account-source is "company-defined"

## Authorized by
- create: controller or tax-accountant
- read: auditor or controller or tax-accountant or accountant or treasurer
- update: controller or tax-accountant
- delete: managing-director

## Notes

### Who may do what

`## Authorized by` in an `information/` file is **entity-scope authority** (grammar §16.1): it governs every
operation on this entity that no process rule covers. It uses the `- <operation>: <roles>` bullet form,
which no grammar-version-1 model can contain, so nothing that existed before changes meaning.

Without it, an operation no rule covers is open to an actor with no role at all — version 1's permissive
default, and the defect Part 4's standing rule 4 was written about. `delete` is the managing director
everywhere in the ledger, and it should almost never be used: a ledger document is corrected by a new
document, never removed. `read` is wide, including the auditor, because an audit needs the whole ledger and
reading changes nothing.

### Why `account-number` is text
Because 0800 is *Gezeichnetes Kapital* and 800 is nothing. Leading zeros are part of German account
numbers, and a numeric type loses them on the first round-trip. This is the same reasoning FD-1 applies
to money: the canonical written form is the value.

### account-source, and the honest limit of this chart
`published-standard` means DATEV's published SKR03 or SKR04 assigns that number to that purpose.
`company-defined` means the number is a free position we have taken for a purpose the standard does not
name, and it must be confirmed with the tax adviser before the first DATEV export. There are five such
accounts in the SKR03 seed and five in SKR04 — shrinkage, the OSS output-tax liability, the payment
service provider clearing account, and the pair for currency translation. They are marked in the chart
tables, and marked here, because a table of account numbers that does not distinguish "the standard says
so" from "we chose this" is a table an auditor cannot use.

DATEV also renumbers between annual releases. A chart is therefore adopted for a *year* and the account
documents carry `opened-on`; the correct check before go-live is a diff against the current DATEV list,
which is a person's job with a printout, not a rule's job.

### vat-role and vat-kennzahl together
`vat-kennzahl` is the line number; `vat-role` is what to do with it. The distinction matters because
line 81 wants the *net turnover* (a base) while line 66 wants the *tax* itself. Without `vat-role` the
VAT return would have to know that 81 means base and 66 means tax — which is exactly the business
knowledge that must not live in the runtime. With it, `processes/vat-return.md` sums bases from
turnover accounts and tax from tax accounts, and knows nothing about German tax law.

### blocked-for-manual-posting
True on 1400/1600 (SKR03 receivables and payables), on every VAT account, and on the bank account. It is
not a permission on a person; it is a property of the account, so it holds for the managing director
too. The intended path to those accounts is an invoice, a payment or a VAT return — documents that carry
their own evidence. A correction still works: it is a correcting journal entry against the *subledger*
document, which reaches the control account through the same rules.

### The accounts this model actually covers
The seeds hold **34 SKR03 accounts, 34 SKR04 accounts and 13 international accounts**. That is the
subset the flows in `processes/` touch, plus equity and opening balances so that a balance sheet closes.
What is deliberately absent: payroll (SKR03 4100 ff. and the corresponding social-security clearing
accounts), fixed assets and depreciation (0xxx and 4830 ff.), accruals and deferrals, provisions,
loans and interest, private accounts for a sole trader, and every VAT rate other than 19 % and 7 %
plus zero. A company that runs payroll or owns machines needs those accounts and the rules that feed
them, and neither is here. Saying so is cheaper than letting somebody discover it in month two.

## Retention

**10 years** under GoBD and § 147 AO, from the end of the year in which the last posting on the account
was made. A retired account is kept forever in practice, because a posting that names an account whose
document has vanished cannot explain itself.

## References

`information/chart-of-accounts.md`, `information/_chart-skr03.md`, `information/_chart-skr04.md`,
`information/_chart-international.md`, `information/posting.md`, `processes/vat-return.md`,
`processes/trial-balance.md`
