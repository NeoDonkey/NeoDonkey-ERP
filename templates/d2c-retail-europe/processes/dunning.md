# Dunning

Asking for money that is late. Only relevant to the retail channel, because consumers pay before
their parcel is packed.

Under German law a *Mahnung* is not required before default interest can be charged when a payment
date was agreed — but sending one is what actually gets paid, and a documented escalation is what a
court asks for later. So the process is three steps, and the third one stops shipping, which is the
only step that reliably works.

The honest limitation is in the rules below and it is the same one that appears three other times in
this template: the language cannot say "the due date has passed", because it has no notion of today.
Overdueness is therefore a status maintained by a daily sweep, and everything downstream reads the
status.

## Triggered by
The daily overdue sweep finding an issued invoice past its due date.

## Rules
If Update invoice under condition
  invoice overdue and
  invoice issued
then
  Update invoice with status "dunned" and
  Update customer with status "on-hold"

If Update customer under condition
  customer business and
  status is "active"
then
  Update customer with status "on-hold" and
  Update customer with payment-terms-days

If Update customer under condition
  customer creditworthy and
  open-balance-eur = 0
then
  Update customer with status "active" and
  Update customer with status "on-hold"

## Notes

<!-- NEEDS-GRAMMAR: `invoice overdue` should read `payment-due-date < today and status is not
     "paid"`. There is no current-date symbol in the grammar, deliberately — a rule that read the
     clock would not be deterministic. So `overdue` is a status set by the daily sweep and the rule
     reads the status. Same v0.2 proposal as `processes/shelf-life-sweep.md`: a `today` symbol
     supplied by the injected clock, evaluated once per evaluation so determinism holds. -->

Putting a customer on hold is the step that gets attention. It is also the step nobody wants to take,
which is why it is a rule rather than a judgement call — and why the threshold is the controller's to
set rather than the accountant's to feel.

## Authorized by
accountant
