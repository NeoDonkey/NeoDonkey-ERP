# Managing director

The *Geschäftsführer*. Legally responsible for the company's bookkeeping, its tax filings and
the safety of the food it sells, whether or not they personally touched any of it. That legal
position is why this role appears as the second signature above the highest thresholds and as
the escalation point for anything that could become a recall.

What is worth noticing is where this role's authority *stops*. The managing director cannot
release a quarantined batch — only the quality manager can. They cannot edit an issued
invoice, because nobody can. They cannot approve a purchase order they placed themselves.
These are not limits imposed on them by somebody else; they are limits the company has written
down, in a file the managing director can change, with the change itself recorded as a signed
commit. That is the difference between a control and a promise.

## Notes
### Responsibilities

- Approve purchase orders at or above 10,000 EUR net.
- Approve discounts above ten percent and goodwill credits above 100 EUR.
- Approve prices below the article's minimum margin.
- Release payment runs, alternately with the controller.
- Decide on a public recall, together with the quality manager.
- Decide on notifying the food safety authority.
- Own the operating model: approve changes to `processes/`, `organisation/` and the thresholds.
- Chair the annual operating-model review and the quarterly supplier review.

### Authorized for

- `processes/purchase-order-approval.md`
- `processes/discount-approval.md`
- `processes/goodwill-approval.md`
- `processes/supplier-invoice-approval.md`
- `processes/payment-run-release.md`
- `processes/quality-escalation.md`
- `processes/price-change.md`

### Not authorized for

- Releasing or unblocking a batch. That authority sits with `quality-manager` and nowhere else.
- Changing an issued invoice or a posted goods-receipt-fact.
- Approving a purchase order they created themselves — a second director or the controller signs.
- Being both preparer and releaser of a payment run.

### Reports to

The shareholders. Nobody in this folder.

### Sees

Everything, with one exception worth stating: personal data of employees and consumers is not
visible by default even to this role. Access to it is a separate visibility group with a
separate reason, because "the boss can see everything" is not a lawful basis under the GDPR
and an auditor will ask.

### Four-eyes summary

The places in this template where two signatures are required, and who the pair is:

| Decision | Threshold | Prepares | Second signature |
| --- | --- | --- | --- |
| Purchase order | ≥ 10,000 EUR net | `purchasing-manager` | `managing-director` |
| Supplier invoice | ≥ 5,000 EUR gross | `accountant` | `controller` or `managing-director` |
| Payment run | any | `accountant` | `controller` or `managing-director` |
| Stock write-off | ≥ 500 EUR | `warehouse-management` or `quality-manager` | `controller` |
| Discount | > 10 % | `customer-service-agent` or `category-manager` | `managing-director` |
| Goodwill credit | > 100 EUR | `customer-service-agent` | `managing-director` |
| Annual inventory | any | `warehouse-management` | `controller` |
| Price below minimum margin | any | `category-manager` | `managing-director` |

Each pair is enforced as two separately signed commits, not as two rows in a table. That is
the whole argument for Appendix IX: the control is cryptographic, so it is stronger than the
one it replaces.
