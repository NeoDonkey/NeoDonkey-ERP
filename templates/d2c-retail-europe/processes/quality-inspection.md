# Quality inspection

The gate between "it is in the building" and "we may sell it". Every batch of a
quality-critical article arrives quarantined and needs a decision from the quality manager
before it can be picked.

The inspection is a checklist with a signature, and the checklist is not decoration: sensory,
packaging, label, documents, foreign body, and for anything temperature-controlled the
arrival temperature. A label check is where a mislabelled allergen gets caught, which is the
single failure in this business with the worst consequences.

Two conditions on release are easy to skip and both are in the rules. A retained sample —
without one, a complaint six months later cannot be investigated, and an uninvestigable
complaint becomes a precautionary recall. And for imports, the health documentation, because
customs clearance and food clearance are two different things.

## Triggered by
A batch arriving in quarantine, a customer complaint pointing at a batch, or a periodic
re-inspection of long-held stock.

## Rules
If Create quality-inspection under condition
  batch exists and
  quality-inspection all checks passed and
  sample-retained is "yes" and
  decision is "release"
then
  Update batch with quality-status "released" and
  Update stock with +available-quantity

If Create quality-inspection under condition
  decision is "block" and
  block-reason exists
then
  Update batch with quality-status "blocked" and
  Update batch with blocked-reason and
  Update stock with -available-quantity

If Create quality-inspection under condition
  decision is "release-with-restriction" and
  restriction-note exists
then
  Update batch with quality-status "released" and
  Update batch with shelf-life-status "near-expiry"

If Create quality-inspection under condition
  quality-inspection critical deviation
then
  Update batch with quality-status "blocked" and
  Create complaint with severity "critical"

If Create quality-inspection under condition
  decision is "release" and
  goods-receipt exists
then
  Update batch with quality-status "released" and
  Update batch with haccp-check-passed "yes"

## Notes

A restricted release is the usual answer for a batch that is fine but short-dated: sellable
in the webshop, not acceptable to a retailer. Marking it near-expiry is what routes it to
clearance instead of onto a pallet that will be refused at goods-in.

<!-- NEEDS-GRAMMAR: what this rule wants to do is notify the managing director, not create a
     complaint record. The grammar has only CRUD consequents, which is correct — a
     notification is not a change to the world. v0.2 proposal: a `Notify <role>` consequent,
     or better, leave notification out of the grammar entirely and let the read layer
     subscribe to `complaint critical`. The substitute used here creates the complaint record
     that the weekly quality round and the escalation process both read, which is at least a
     durable trace rather than a message somebody may miss. -->

## Authorized by
quality-manager
