# Goodwill approval

A credit note with no goods coming back. Somebody was disappointed and we are making it right.

Up to 100 EUR a customer service agent decides alone, which is the whole point of having them.
Above that the managing director signs, because a goodwill credit is pure margin given away and
at some size that stops being a service decision.

The reason this is a separate file rather than a condition is the same as everywhere else in this
folder: `## Authorized by` applies per file, so a different authorisation is a different file. The
side effect is that the company's complete list of second-signature decisions is the list of files
in `processes/` with a senior role on that line.

## Triggered by
A goodwill credit above 100 EUR being proposed to settle a complaint.

## Rules
If Update credit-note under condition
  credit-note needs approval and
  credit-note approved
then
  Update credit-note with status "issued"

If Create credit-note under condition
  credit-note needs approval
then
  Update credit-note with status "draft" and
  Update credit-note with reason-note

## Notes

There is no rule anywhere in this folder that issues a goodwill credit above 100 EUR without
`approved-by`. The reason note is an obligation, not a courtesy: a goodwill credit whose reason
nobody wrote down is indistinguishable from a leak.

## Authorized by
managing-director
