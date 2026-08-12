# Weekly quality round

Twenty minutes, every Thursday, chaired by the quality manager. The shortest meeting in this folder and the
one that must never be cancelled.

It exists because food quality signals arrive as a trickle of individually unremarkable events — one
complaint about texture, one carton that arrived damp, one supplier's certificate of analysis that came
late. Any of them alone is noise. Three of them about the same supplier in the same month is a pattern, and
patterns are what this meeting is for.

The round also walks the physical quarantine area. A batch that has been quarantined for three weeks
because nobody got round to inspecting it is stock we own, cannot sell, and are paying to store.

## Cadence

Weekly, Thursday. Chaired by the quality manager, with warehouse management and a customer service
representative. Twenty minutes, plus a walk through quarantine.

## Measures

- Batches in `quarantined` and how long each has been there.
- Batches in `blocked`, with the reason, and what will happen to them.
- Quality inspections in the week: released, restricted, blocked.
- Complaints by category, with `foreign-body`, `labelling` and `allergen` listed individually and by name.
- Complaints where `authority-notification-required` is set and `authority-notified-date` is not — the one
  line on this list with a legal clock on it.
- Returns with `return-type: quality-complaint`, and whether the batch was identified.
- CCP deviations from `information/quality-inspection.md`.
- HACCP training expiring within ninety days.

## Owner

`quality-manager`, reporting directly to `managing-director`.

## Notes

### The escalation does not wait for this meeting
An allergen or foreign-body complaint goes to the quality manager on creation —
`processes/customer-complaint.md` — and a decision on notifying the authority is taken in hours, not on
Thursday. Under EU 178/2002 a food business that has reason to believe its product is unsafe must inform
the competent authority *without delay*, and "without delay" is not a service-level target.

This meeting is where the *pattern* is seen. The individual incident is handled the day it arrives.

### Quarantine ageing is a commercial number too
Every day a batch sits unreleased is a day of shelf life spent. A batch quarantined for three weeks may
arrive in `near-expiry` by the time it is released, which turns a full-price pallet into a clearance
pallet. The weekly margin review sees the consequence; this meeting sees the cause.

### No rules here
See `management-system/monthly-stock-review.md`.

## References

`information/batch.md`, `information/quality-inspection.md`, `information/complaint.md`,
`processes/quality-inspection.md`, `processes/quality-escalation.md`,
`processes/customer-complaint.md`
