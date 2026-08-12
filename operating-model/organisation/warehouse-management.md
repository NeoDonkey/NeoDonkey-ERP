# Warehouse management

Runs the site. Accountable for stock being where the system says it is, for the annual inventory being
defensible, and for the clerks having been trained on what they handle.

This role holds the authority the clerk does not: correcting a posted goods receipt, initiating a
write-off, blocking a location, running the shelf-life sweep. It is also the role that gets woken up
when a truck arrives at 06:00 with paperwork that does not match.

Where its authority ends is money. A write-off at or above 500 EUR needs the controller as well. The
reason is old and simple: the person accountable for the physical stock should not be the only person
who can make a difference to it disappear.

## Purpose

- Own the stock accuracy of the site.
- Correct posted goods receipts by issuing a correcting fact with a stated reason.
- Initiate stock write-offs and route them for approval where the value requires it.
- Run the daily shelf-life sweep and act on near-expiry stock before it expires.
- Maintain warehouse zones, including the quarantine area.
- Ensure clerks handling open food are HACCP-trained and the training is current.

## Notes

### Authorised for
`processes/goods-receipt.md`, `processes/picking-and-shipping.md`,
`processes/shelf-life-sweep.md`, `processes/stock-write-off.md`

### Not authorised for
Approving their own write-off at or above 500 EUR — that needs the controller. Releasing a batch from
quarantine — that is the quality manager, and nobody else. Anything touching a supplier invoice, a
price or a discount.

### Reports to
`managing-director`

### Sees
Everything about stock, batches, goods receipts and adjustments at their sites, plus purchase orders
so they know what is coming. Stock valuation, because they are accountable for it. Customer prices and
margins, no.
