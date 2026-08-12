# Controller

Watches the numbers and the controls. Half of this role is analysis — margin, stock value,
working capital, the month-end close — and half of it is being the second signature in the
places where one signature is not enough.

That second half is worth stating plainly, because it is the part that tends to get quietly
dropped when everybody is busy. The controller is the second approver on a supplier invoice of
5,000 EUR or more, the second approver on a stock write-off of 500 EUR or more, and one of the
two roles that may release a payment run. In each case the point is not that the controller
knows more about the transaction than the person who prepared it — it is that they are a
different person, with a different key, whose signature is on a different commit.

The controller also owns the tolerances. What counts as an acceptable inventory difference,
what counts as a price variance worth chasing, when a margin is too thin — these are numbers,
they live in the process and price files, and this role proposes the changes to them.

## Notes
### Responsibilities

- Second approval on supplier invoices at or above 5,000 EUR.
- Second approval on stock write-offs at or above 500 EUR.
- Release payment runs, or hand that to the managing director.
- Own the month-end close: cut-off, accruals, stock valuation, open items.
- Chair the weekly margin review and the monthly stock review.
- Own the tolerance thresholds and propose changes to them.
- Prepare the numbers for the annual accounts and the audit.
- Maintain the *Verfahrensdokumentation* that explains this operating model to an auditor.

### Authorized for

- `processes/supplier-invoice-approval.md`
- `processes/stock-write-off-approval.md`
- `processes/payment-run-release.md`
- `processes/inventory-count.md`

### Not authorized for

- Preparing the payment run they release. Preparation is `accountant`.
- Verifying the supplier invoice they approve. Verification is `accountant`.
- Initiating the write-off they approve. Initiation is `warehouse-management` or `quality-manager`.
- Issuing invoices or credit notes.
- Overruling a quality decision.

### Reports to

`managing-director`

### Sees

Everything financial across all locations and channels: invoices, supplier invoices, payments,
margins, stock valuation, discounts, returns. Read access to the operating model itself,
because explaining the controls to an auditor means reading the rules. Not personal HR data
beyond what a posting requires.
