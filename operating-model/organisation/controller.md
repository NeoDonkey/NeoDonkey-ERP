# Controller

Watches the numbers and the controls. Half analysis — margin, stock value, working capital, the
month-end close — and half being the second signature where one is not enough.

The second half is worth stating plainly, because it is the part that gets quietly dropped when
everybody is busy. The controller is the second approver on a stock write-off at or above 500 EUR. In
each such case the point is not that the controller knows more about the transaction than the person
who prepared it; it is that they are a different person, with a different key, signing a different
commit.

The controller also owns the thresholds. What counts as an acceptable inventory difference, when a
margin is too thin, where the write-off boundary sits — these are numbers, they live in
`information/` and `processes/`, and this role proposes the changes to them.

## Purpose

- Second approval on stock write-offs at or above 500 EUR.
- Own the month-end close: cut-off, stock valuation, open items.
- Chair the weekly margin review and the monthly stock review.
- Own the tolerance and approval thresholds and propose changes to them.
- Maintain the *Verfahrensdokumentation* that explains this operating model to an auditor.

## Notes

### Authorised for
`processes/stock-write-off-approval.md`

### Not authorised for
Initiating the write-off they approve — that is warehouse management or the quality manager. Issuing
invoices or credit notes. Overruling a quality decision.

### Reports to
`managing-director`

### Sees
Everything financial across all locations and channels. Read access to the operating model itself,
because explaining the controls to an auditor means reading the rules.
