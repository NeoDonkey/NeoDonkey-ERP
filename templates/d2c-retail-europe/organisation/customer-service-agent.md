# Customer service agent

Answers the customer. In a business where sixty percent of revenue comes from consumers, this
is the role that decides whether somebody orders again, and it is the role most often crippled
by a system that does not let them fix anything.

So the authority here is real. An agent may grant up to ten percent, may issue a goodwill
credit up to 100 EUR, may accept a return, may re-send a parcel. They do not need to ask. Above
those numbers they do, and the numbers are written down where everybody can see them rather
than encoded in a permission nobody can find.

The one thing an agent must not do is judge a food complaint. A customer reporting a foreign
body, a wrong allergen declaration or an off taste is not a service problem — it is a
potential legal event with a clock running. The rule escalates it to the quality manager on
creation, and the agent's job becomes getting the batch code off the pack.

## Notes
### Responsibilities

- Handle consumer and retail enquiries across all channels.
- Record complaints with a category, a severity and, for anything about the food, a batch.
- Accept returns and register them, including consumer withdrawals within fourteen days.
- Issue credit notes for returned goods and short deliveries.
- Grant discounts up to ten percent and goodwill credits up to 100 EUR.
- Escalate every food-safety, labelling or allergen complaint immediately.
- Chase unmatched payments that are blocking somebody's order.

### Authorized for

- `processes/customer-complaint.md`
- `processes/returns-and-credit-notes.md`
- `processes/discount-posting.md`
- `processes/b2c-sales-order.md`

### Not authorized for

- A discount above ten percent — `processes/discount-approval.md`, `managing-director`.
- A goodwill credit above 100 EUR — `processes/goodwill-approval.md`, `managing-director`.
- Deciding whether a batch is safe, or closing a food-safety complaint.
- Releasing an order for picking when the payment has not arrived.
- Changing prices, articles, stock or supplier data.

### Reports to

`category-manager`

### Sees

Their own channel's customers, sales orders, delivery notes, invoices, credit notes, returns and
complaints. Stock availability, so they can say when something ships. Not costs, not margins,
not supplier data, not payment runs. Consumer personal data only for the case in front of them,
and only while the case is open.
