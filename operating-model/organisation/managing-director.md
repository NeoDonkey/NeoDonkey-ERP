# Managing director

The *Geschäftsführer*. Legally responsible for the company's bookkeeping, its tax filings and the
safety of the food it sells, whether or not they personally touched any of it. That legal position is
why this role appears as the second signature above the highest thresholds.

What is worth noticing is where this role's authority *stops*. The managing director cannot release a
quarantined batch — only the quality manager can. They cannot edit an issued invoice, because nobody
can. These are not limits imposed by somebody else; they are limits the company wrote down, in files
the managing director can change, with the change itself recorded as a signed commit. That is the
difference between a control and a promise.

## Purpose

- Approve purchase orders at or above 10,000 EUR net.
- Approve discounts above ten percent and goodwill credits above 100 EUR.
- Decide on a product withdrawal, together with the quality manager.
- Own the operating model: approve changes to processes, roles and thresholds.
- Chair the quarterly supplier review.

## Notes

### Authorised for
`processes/purchase-order-approval.md`, `processes/discount-approval.md`,
`processes/goodwill-approval.md`

### Not authorised for
Releasing or unblocking a batch. That authority sits with the quality manager and nowhere else.
Changing an issued invoice or a posted goods-receipt-fact.

### Reports to
The shareholders. Nobody in this folder.

### Where two signatures are required

| Decision | Threshold | Prepares | Second signature |
| --- | --- | --- | --- |
| Purchase order | ≥ 10,000 EUR net | `purchasing-manager` | `managing-director` |
| Stock write-off | ≥ 500 EUR | `warehouse-management` or `quality-manager` | `controller` |
| Discount | > 10 % | `customer-service-agent` or `category-manager` | `managing-director` |
| Goodwill credit | > 100 EUR | `customer-service-agent` | `managing-director` |

Each of these is modelled as an *approval document plus a rule* — the second party's approval must be
recorded before the state advances — because grammar version 1 checks a single actor and refuses
`## Authorized by a and b`. That is an approximation of four-eyes, not four-eyes. Genuine four-eyes is
a signature constraint on the commit (manifesto line 114) and belongs to the Truth Layer. It is listed
as an open item rather than presented as done.

### Sees
Everything, with one exception worth stating: personal data of employees and consumers is not visible
by default even to this role. "The boss can see everything" is not a lawful basis under the GDPR, and
an auditor will ask.
