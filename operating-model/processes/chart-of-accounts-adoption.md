# Chart of accounts adoption

Choosing SKR03, SKR04 or the international chart, and creating the accounts. It happens once, and the reason it
is a written process rather than a setup wizard is that it is nearly impossible to undo: two years of postings
later, every report, every comparative figure and the tax adviser's whole mapping hang off the numbers chosen
here.

Adoption has two steps in two commits. First the chart document, naming its standard, its ledger currency, its
declared rounding rule and the eleven well-known account numbers the posting rules reach for. Then the account
documents themselves, one per row of the seed table in `information/_chart-skr03.md`,
`information/_chart-skr04.md` or `information/_chart-international.md`, after which the chart's account
*references* are filled in and it can be made active.

Exactly one chart is active. The others stay, retired, because an eight-year-old posting must still be able to
say which chart its account numbers came from — 1200 is the bank in SKR03 and trade receivables in SKR04.

## Triggered by
Setting up the books, once. Or opening a second set for a subsidiary that files under local GAAP.

## Rules

If Create chart-of-accounts under condition
  ledger-currency exists and
  rounding-mode exists and
  rounding-rule exists and
  adopted-on exists
  authorized by controller or tax-accountant
then
  Update chart-of-accounts with status "retired"
    with adopted-on
    with ledger-currency
    with rounding-mode

If Create ledger-account under condition
  chart exists and
  account-number exists and
  account-type exists and
  normal-balance exists and
  statement-section exists and
  vat-role exists and
  opened-on exists
then
  Update ledger-account with status "active"
    with opened-on
    with account-number
    with normal-balance

## Notes

### A new chart is created retired

`Update chart-of-accounts with status "retired"` on creation, deliberately. A chart with no accounts cannot
post anything useful, and a chart that is active the moment it is created is a chart somebody will post to
before its accounts exist and its references are filled in. Activating it is a separate, later act — which
this model does **not** have a rule for, because a rule on `Update chart-of-accounts` would conjoin with
nothing yet but would need per-branch authority to distinguish activation from an ordinary edit. Today
activation is a signed commit by the controller with no rule governing it, which is a real hole and is named as
one.

### The obligations on an account

Six required properties, and each one is an obligation clause as well as a condition: the account type, which
side increases it, which statement it appears in, and what the VAT return does with it. An account created
without them would be an account the trial balance cannot present and the VAT return cannot classify — and it
would fail silently, as a missing figure rather than an error. So it is refused at creation, quoting the field.

### Why `blocked-for-manual-posting` is not in the conditions

It is `required` on `information/ledger-account.md`, so it must be present, but no rule checks *which* accounts
carry it. That is a judgement made once when the chart is seeded: the receivables and payables control
accounts, every VAT account, the bank, inventory and *Bestandsveränderungen*. Getting it wrong is not caught
here, and an account that should be rule-maintained and is not is an account somebody can post to by hand to
make a reconciliation agree. An auditor should check the list rather than trust it, and
`test/f2-ledger.test.js` checks it against the seed tables.

### What is not here

No chart switch — that is a migration with the tax adviser in the room, and a one-click version of it would be
the most destructive button in the system. No account renumbering. No DATEV chart import, which is how a real
company would populate 1,400 accounts and which is an inbound dialect. No validation that the seed tables match
the current DATEV release, which they must be diffed against before the first export because DATEV renumbers
between years.

## References

`information/chart-of-accounts.md`, `information/ledger-account.md`, `information/_chart-skr03.md`,
`information/_chart-skr04.md`, `information/_chart-international.md`, `processes/journal-posting.md`
