# Returns and credit notes

Goods coming back and money going out. In a European webshop a consumer may withdraw from a distance
contract within fourteen days without giving a reason, so returns are a designed process rather than an
exception queue.

Food returns almost never go back into sellable stock. We cannot vouch for how a bag of cashews was
stored on somebody's kitchen counter, so a returned batch is written off and the commercially useful
output of the process is the *reason*.

The credit note is where this meets the books. An issued invoice is never edited; a return produces a
credit note that references the invoice, states a reason, and carries the same VAT treatment as the
original. A credit note with a different treatment from its invoice is one of the few errors that
reliably survives undetected until an audit.

## Triggered by
A customer announcing a return, a retailer refusing a pallet at goods-in, or a complaint settled with a
credit.

## Rules

If Create credit-note under condition
  credit-note references original and
  credit-note justified and
  vat-treatment active
then
  when credit-note needs approval authorized by managing-director then
    Update invoice with status "corrected"
    and Update credit-note with status "issued"
      with approved-by
      with approval-date
  otherwise
    Update invoice with status "corrected"
    and Update credit-note with status "issued"

If Create credit-note under condition
  net-amount > 0 and
  gross-amount > 0
then
  Update credit-note with reason-note and
  Update credit-note with currency

## Notes

### references original
`corrects-invoice exists`. A credit note that does not say which invoice it corrects is not a credit
note, it is a hole in the bookkeeping. The runtime finds the invoice through the declared reference and
marks it `corrected` — so the original stays, the correction stays, and both are visible forever. That
is what an auditor means by *Unveränderbarkeit*, and it is also just how bookkeeping has always worked.

### justified
`reason-code exists and reason-note exists`. The code drives the reporting; the note is for the human
reading it in a year. A goodwill credit whose reason nobody wrote down is indistinguishable from a leak.

### The 100 EUR goodwill boundary, now enforced
Below 100 EUR a customer service agent settles a complaint on their own authority — which is the entire
point of having them. Above it the managing director signs, and names themselves on the document. The
threshold is the predicate `needs approval` (`net-amount > 100`) in `information/credit-note.md`; the
authority is the first arm's `authorized by managing-director`.

This note used to say the boundary could not be enforced, because grammar version 1 had no branching and
`## Authorized by` belonged to the file. Grammar version 2 §14 and §16 closed it: one rule, two arms, and
the arm's authority replaces the file's rather than widening it — so a customer service agent raising a
400 EUR goodwill credit is refused, quoting the arm that decided.

The arm also demands `approved-by` and `approval-date` as obligations, so the approval is part of the
issued record rather than a conversation somebody remembers.

What is still **not** here is two signatures. One role per amount is an authority level; four-eyes is two
distinct keys on one commit, which is a Truth Layer property (manifesto line 114). Adding a field called
`approval-count` and calling it four-eyes would not be honest, and this file does not.

## Authorized by
customer-service-agent or accountant
