# Purchase ordering

Buying goods. The purchase order is a promise in both directions: we will take this quantity, they
will deliver it at this price by this date. Everything downstream — the goods receipt check, the
three-way match on the invoice — is a comparison against this document, which is why it has to be
right before it is sent rather than corrected afterwards.

Two gates sit at the front, and both are conditions below. The supplier must be approved, which means
somebody checked their food-safety certification and somebody *else* checked their bank details — a
purchaser who could both create a supplier and pay it is the standard invoice-fraud setup in a
mid-sized company. And the delivery location must actually hold stock, which stops goods being
ordered to an office.

### The 10,000 EUR second signature, honestly
This company requires the managing director to approve a purchase order at or above 10,000 EUR net. The
threshold is the predicate `needs approval` in `information/order.md`; the authority is the first arm's
`authorized by managing-director` in the rule below, and the arm also demands `approved-by` on the
document.

This paragraph used to say the threshold was not enforceable, because grammar version 1 had no branching
and `## Authorized by` belonged to the file. Version 2 §14 and §16 fixed that, and the rule now carries
it: **a purchasing manager cannot raise a 12,000 EUR order at all**, because the arm that matches names
only the managing director and arm authority replaces file authority rather than widening it.

What is still true is the narrower half of the old sentence. This is *one* authority level per amount, not
two signatures: the managing director acting alone can raise a 12,000 EUR order. Genuine four-eyes is two
distinct keys signing one commit, which is a Truth Layer property (manifesto line 114) and not a grammar
one, and `## Authorized by a and b` is still refused for exactly that reason.

## Triggered by
A replenishment need: stock below the reorder point, a campaign, a new listing, or a seasonal buy.

## Rules

If Create order under condition
  supplier approved for ordering and
  delivery-location stock holding and
  currency is "EUR" and
  vat-treatment active
then
  when order needs approval authorized by managing-director then
    Update order with status "draft"
      with requested-delivery-date
      with approved-by
  otherwise
    Update order with status "draft"
      with requested-delivery-date

## Notes

### supplier approved for ordering
`status is "approved" and iban-on-file is true`. Two facts, established by two different people. A
supplier on hold — a lapsed certification, say — cannot be ordered from, and the refusal names the
condition rather than failing silently at goods-in three weeks later.

### The order starts as a draft
Nothing has been sent to anybody yet. The transition to `confirmed` is what makes the order live, and
it is what `order receivable` in `processes/goods-receipt.md` requires before a delivery can be booked
against it. A pallet arriving against a draft order means something went wrong upstream and belongs in
front of a human.

### requested-delivery-date is an obligation
An order without a date we asked for cannot be chased, and a supplier who was never given a date is
never late. One word in the consequent makes it required.

## Authorized by
purchasing-manager or managing-director
