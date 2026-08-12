# Warehouse management

Runs the site. Responsible for stock being where the system says it is, for the annual
inventory being defensible, and for the clerks having been trained on what they are doing.

This role holds the authority the clerk does not: correcting a posted goods receipt,
initiating a write-off, deciding a warehouse location is blocked, signing off a cycle count.
It is also the role that gets woken up when a truck arrives at 06:00 with paperwork that does
not match.

Where warehouse management's own authority ends is money. A write-off above 500 EUR needs the
controller as well, an inventory difference above tolerance needs an explanation somebody else
reads, and nothing here touches a supplier invoice. The reason is simple and old: the person
responsible for the physical stock should not be the only person who can make a difference
disappear.

## Notes
### Responsibilities

- Own the stock accuracy of the site.
- Correct posted goods receipts, with a stated reason, by issuing a correcting fact.
- Initiate stock write-offs and route them for approval where the value requires it.
- Plan and run the annual inventory and the cycle count programme.
- Maintain warehouse locations, including the quarantine cage.
- Keep the shelf-life sweep running and act on near-expiry stock before it expires.
- Ensure clerks handling open food are HACCP-trained and the training is current.

### Authorized for

- `processes/goods-receipt.md`
- `processes/goods-receipt-correction.md`
- `processes/picking-and-shipping.md`
- `processes/shelf-life-sweep.md`
- `processes/stock-write-off.md`
- `processes/inventory-count.md`

### Not authorized for

- Approving their own write-off above 500 EUR — that needs `controller` as the second approver.
- Releasing a batch from quarantine — that is `quality-manager`.
- Verifying, approving or paying a supplier invoice.
- Changing prices or granting discounts.

### Reports to

`managing-director`

### Sees

Everything about stock, batches, goods receipts, deliveries and adjustments at their sites,
plus purchase orders so they know what is coming. Stock valuation, yes — they are accountable
for it. Customer prices and margins, no.
