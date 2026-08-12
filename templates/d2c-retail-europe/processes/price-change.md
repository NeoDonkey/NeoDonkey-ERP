# Price change

Changing what something costs. Straightforward except in one respect: a price below the
article's minimum margin is a strategic decision rather than a pricing decision, and it needs
the managing director rather than the category manager.

Prices are never overwritten. A new price record supersedes the old one, with a valid-from
date, and the old one stays. That is not fussiness — an invoice from eighteen months ago has to
be explainable, and "the price was different then" is only an answer if the old price is still
there.

The margin numbers on a price record come from the stock valuation, so they move when purchase
costs move. A price that was healthy in March can be loss-making in September without anybody
touching it, which is exactly what the weekly margin review is for.

## Triggered by
A cost change, a competitive move, a campaign, or the weekly margin review finding a price
below its minimum.

## Rules
If Create price under condition
  article exists and
  net-price-eur > 0 and
  valid-from exists
then
  Update price with status "active" and
  Update price with minimum-margin-percent and
  Update price with status "superseded"

If Update price under condition
  price healthy margin and
  status is "draft"
then
  Update price with status "active"

If Update price under condition
  price below minimum margin
then
  Update price with status "draft"

If Update price under condition
  price loss making
then
  Update price with margin-status "loss-making"

## Notes

The price stays in draft. There is no rule in this file that activates a price below the
minimum margin, and that is the enforcement — not a warning, not a flag, simply the absence of
a permitted path. `processes/discount-approval.md` and the managing director's authority are
where the exception is granted.

## Authorized by
category-manager or managing-director
