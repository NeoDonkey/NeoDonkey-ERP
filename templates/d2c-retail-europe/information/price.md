# Price

What one article costs one kind of customer in one country at one time. Four dimensions,
which is why price does not live on the article.

The webshop price in Germany, the webshop price in France, and the pallet price to a German
grocery chain are three different numbers for the same bag of cashews, and all three are
correct. For weight-priced articles there is a fifth wrinkle: the price is per kilogram and
the invoice follows the weight actually shipped.

Prices are also the input to the weekly margin review. A price record carries the current
cost alongside it so that margin is a subtraction rather than a project.

## Fields
- id: text required — PRC-ART-10442-DE-webshop.
- article: reference to article required
- channel: text required — webshop, retail, marketplace.
- country: text required — ISO code, or EU for a single European price.
- customer: reference to customer — Set only for negotiated retail prices.
- pricing-basis: text required — piece or weight. Must match the article.
- net-price-eur: number required — Per selling unit, or per kilogram for weight pricing.
- gross-price-eur: number — Shown in the webshop, VAT included.
- vat-rate-percent: number required — The rate used to derive the gross price.
- current-cost-per-unit-eur: number required — Moving average from stock valuation.
- contribution-margin-eur: number required — Net price minus current cost.
- contribution-margin-percent: number required — The number the weekly review reads.
- valid-from: date required
- valid-to: date — Empty means currently valid.
- minimum-margin-percent: number required — Below this the price needs approval.
- margin-status: text required — ok, below-minimum, loss-making. Derived, see below.
- status: text required — draft, active, superseded.

## Identified by
article and channel and country

## Created on demand
no

## Predicates
- active: status is "active"
- weight based: pricing-basis is "weight"
- below minimum margin: margin-status is "below-minimum"
- healthy margin: margin-status is "ok"
- loss making: contribution-margin-eur < 0
- negotiated: customer exists
- retail price: channel is "retail"

## References
- `article` → `article`
- `customer` → `customer`

## Retention
Prices behind issued invoices are part of the invoice trail: **10 years** under GoBD.
Superseded prices are kept so that an old invoice line can be explained.

## Notes
### loss making
Selling below cost is sometimes a deliberate decision — a hero product, a clearance batch —
and sometimes an accident that has been running for months. Naming it makes the difference
between the two a conversation rather than a discovery.

### Derived fields

- `margin-status` — text, required — `ok`, `below-minimum`, `loss-making`. Recomputed by
  `management-system/weekly-margin-review.md` whenever cost or price changes. It exists
  because the grammar cannot compare `contribution-margin-percent` against
  `minimum-margin-percent` directly, and pushing the comparison into a derived field keeps
  the rules readable and the semantics in this file.

### Used by

`processes/b2c-sales-order.md`, `processes/b2b-retail-order.md`,
`processes/invoice-issuance.md`, `processes/price-change.md`,
`management-system/weekly-margin-review.md`
