# Payment run

Releasing money. This is the most dangerous act in the company and the file is short because there is nothing
clever to say about it: one person prepares, a different person releases, and both signatures are over the same
payload.

The threshold matters and it is on the **largest single payment**, not on the total. A run of two hundred
payments totalling 40,000 EUR is routine; one payment of 40,000 EUR is not. Putting the threshold on the total
is what makes splitting an unusual payment across a routine-looking run work, and it is the oldest trick in
accounts payable.

`payload-hash` is what makes two signatures worth having. If a payment can be added between the first signature
and the second, four-eyes is theatre. The hash covers the payment list and the total, both signatures are over
the hash, and a run whose contents changed needs both signatures again.

## Triggered by
The treasurer preparing a run from approved supplier invoices; then a second person releasing it.

## Rules

If Update payment-run under condition
  payment-run prepared and
  payload-hash exists and
  accounting-period accepts postings
  authorized by treasurer
then
  when payment-run very large and released-by exists and payment-run two signatures present and released-by.display-name is not prepared-by.display-name authorized by managing-director then
    Update payment-run with status "released"
      with released-by
      with released-at
  otherwise when payment-run large and released-by exists and payment-run two signatures present and released-by.display-name is not prepared-by.display-name authorized by controller or managing-director then
    Update payment-run with status "released"
      with released-by
      with released-at
  otherwise when released-by exists and payment-run two signatures present and released-by.display-name is not prepared-by.display-name authorized by treasurer or controller then
    Update payment-run with status "released"
      with released-by
      with released-at
  otherwise
    Update payment-run with status "awaiting-release"

## Notes

### What four-eyes here is, and what it is not

Every release arm requires four things: `released-by` named on the document, the payload hash present,
`signature-count >= 2`, and — the one added last —
**`released-by.display-name is not prepared-by.display-name`**. So the person who releases a payment run
cannot be the person who prepared it. That is enforced, by name, and a refusal quotes the arm.

Getting there took a detour worth recording. `released-by is not prepared-by` is refused: both are
`reference to employee`, and comparing two references compares two whole documents, which `=` is not defined
on (grammar §4.2). Comparing one hop down — `released-by.display-name` against `prepared-by.display-name` —
compares two values and is ordinary version-1 grammar. So the control was reachable the whole time and this
file said it was not.

What is **still** missing is the cryptographic half. `signature-count >= 2` is a counter, and two increments
of a field are not two keys. A releaser who can also write `prepared-by` can satisfy the distinctness
condition with a name. The real control is two distinct Ed25519 signatures over one commit — manifesto line
114 — and it is a Truth Layer property, not a grammar one. So the honest reading of this rule is: **two
different named people, enforced; two different keys, not yet.** That is materially stronger than role
separation and materially weaker than four-eyes, and it is a gate-item-3 dependency.

### The three thresholds, and who may release each

`very large` is above 50,000 EUR on a single payment; `large` is above 10,000 EUR; the third arm is
everything else. Each arm carries its own `authorized by` (grammar §16, arm scope), so the authority is a
property of the amount:

- **above 50,000 EUR on one payment** — the managing director releases it, nobody else;
- **above 10,000 EUR** — the controller or the managing director;
- **below that** — the treasurer or the controller;
- **not releasable yet** — the default arm sets `awaiting-release` under the rule's own authority, the
  treasurer, so the person who prepared it can record that it is ready without being able to send it.

The most specific scope wins and only it, which means the treasurer is *not* authorised for the 10,000 EUR
arm. That is the point. It also means a business wanting the treasurer to release up to 50,000 EUR edits one
arm rather than a permissions table.

### The final `otherwise`

A run that does not satisfy any release branch is set to `awaiting-release` rather than refused. That is the
right failure: the run stays visible, with its payments and its total, waiting for the second person. Refusing
the update would leave the treasurer with no way to record that the run is ready. Nothing leaves the company
in that state, because `released` is the only status `processes/journal-posting.md` will post payments from.

### What is not here

No SEPA pain.001 file, no bank connectivity, no payment recall, and — most importantly — **no control on
changing a supplier's bank details**, which is the door invoice-redirection fraud actually walks through. That
control belongs on the supplier master record, needs its own two signatures, and is not built. An auditor will
ask about it.

## References

`information/payment-run.md`, `information/payment.md`, `information/supplier-invoice.md`,
`organisation/treasurer.md`, `processes/journal-posting.md`
