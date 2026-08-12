# Article activation

Promoting an article from `draft` to `active`, which is the moment it may be sold. It is a separate act from
creating it, by a separate rule, and the reason is the one thing in this folder that could actually hurt
somebody: EU Regulation 1169/2011 requires a complete allergen declaration, and a mislabelled allergen is the
worst outcome this business has.

`processes/article-onboarding.md` creates the article as a `draft` and says plainly that filling in the
allergen declaration and the nutrition table is real work that happens afterwards. This file is the gate at
the end of that work. It refuses activation until the article is `sellable` — the predicate in
`information/article.md`, which is `status is "active" and allergen-declaration exists and nutrition-table
exists`, read here for its two data conditions.

Discontinuation is the other transition and it is not a deletion. Ten years of invoice lines point at every
article, and an invoice that cannot explain what it sold is not an invoice.

## Triggered by
The allergen declaration and the nutrition table being complete, and the category manager deciding the
article may be sold. Or, later, a delisting.

## Rules

If Update article under condition
  allergen-declaration exists and
  nutrition-table exists and
  vat-category exists
then
  when gtin exists authorized by category-manager then
    Update article with status "active"
      with allergen-declaration
      with nutrition-table
      with gtin
  otherwise
    Update article with status "active"
      with allergen-declaration
      with nutrition-table

## Notes

### Why activation is a rule and creation is not

Before this file, nothing in `processes/` set an article `active`. So the sales gate `article sellable` in
`processes/b2c-sales-order.md` could never be satisfied by anything the operating model did — a person had to
edit the document, outside any rule and therefore outside any authority declaration. That is the hole this
file closes, and it is worth naming: a control that can only be satisfied by going around the rules is not a
control.

### The two arms

An article that will be listed by a grocery chain needs a GTIN as well, because a retailer's goods-in scans
it and a pallet without one is refused at somebody else's gate. So the first arm matches on `gtin exists` and
demands it as an obligation; an article sold only through the webshop does not have one, and the default arm
activates without it. Both arms are the category manager's act.

The arm deliberately does **not** test the predicate `listable at retail`, even though that reads better.
That predicate is `status is "active" and gtin exists and allergen-declaration exists`, and its first clause
is only true *after* activation — so an arm guarded by it could never fire, and the GTIN obligation would be
silently dead. That is the shape of grammar limit 14's old failure appearing in a new place: the sentence
parses, the model reads correct, and the control does nothing. Worth writing down, because the readable
predicate was the first thing this rule tried.

### `Update article` and every other reason to update one

Every rule on one operation is a hard requirement (§8), so the conditions above hold for *any* update to an
article, not only for activation. That is deliberate here — an article whose allergen declaration has been
emptied should not be updatable at all — but it is a real constraint: correcting a typo in an article's name
requires the allergen declaration and the nutrition table to be present. For a food business that is the
right answer. For a business where it is not, this rule needs an arm rather than a bare condition list.

### Discontinuation is not here

Setting `discontinued` needs a second authority — a delisting has commercial consequences a category manager
should not carry alone — and the two arms of this rule already spend the authority this act has. It is the
next thing to add, and it is not here rather than being here badly.

## Authorized by
category-manager
