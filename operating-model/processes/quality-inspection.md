# Quality inspection

The gate between "it is in the building" and "we may sell it". Every batch of a quality-critical
article arrives quarantined and needs a decision from the quality manager before it can be picked.

The inspection is a checklist with a signature, and the checklist is not decoration: sensory,
packaging, label, documents, foreign body, and for anything temperature-controlled the arrival
temperature. The label check is where a mislabelled allergen gets caught, which is the failure in
this business with the worst consequences.

Two conditions on release are easy to skip and both are rules below. A retained sample — without one
a complaint six months later cannot be investigated, and an uninvestigable complaint becomes a
precautionary recall of everything rather than a targeted withdrawal of one batch. And a
quality-trained inspector, because HACCP asks who was competent to decide and an auditor asks for the
training record.

### How the decision travels
The inspection document carries the status it assigns — `released` or `blocked` — and the rules copy
it onto the batch. That is deliberate. Grammar version 1 has no branching: every rule on the same
operation is a hard requirement, so a rule cannot say "if released then … else …". Carrying the
decision as data and copying it is both expressible and, as it happens, clearer — the decision is a
value on a signed document rather than a path through a program.

## Triggered by
A batch sitting in quarantine, or a complaint pointing at a batch already released.

## Rules

If Create quality-inspection under condition
  batch exists and
  inspected-by quality trained and
  sample-retained is true and
  quantity > 0
then
  Update batch with quality-status and
  Update batch with haccp-check-passed

If Create quality-inspection under condition
  label-check is "pass" and
  document-check is "pass" and
  batch traceable
then
  Update batch with shelf-life-status

## Notes

### The first rule
Four conditions, and each one refuses a real mistake. No batch — nothing to decide about. An
inspector without current HACCP training — the decision is not defensible. No retained sample — the
batch cannot be investigated later. Zero quantity — nothing was inspected.

`Update batch with quality-status` copies the decision from the inspection to the batch. The runtime
finds the batch through the declared `batch: reference to batch` field; nothing is guessed.

### The second rule
The label and document checks are non-negotiable, and `batch traceable` — a batch number and a
best-before date on file — is what makes the record usable in a recall. Only then is the shelf-life
classification written, which is what decides whether the batch can go to a retailer or only to
clearance.

### What is not here
Blocking the stock. A blocked batch should take its quantity out of available stock, and that needs
either a branch (blocked versus released) or arithmetic the grammar does not have. Instead the
write-off in `processes/stock-write-off.md` moves the stock, on its own trigger, with its own
approval. Splitting the decision from the posting is not a workaround — it is what an auditor expects
— but the reason it is split *here* is a language limit, and saying so is better than implying it was
all design.

## Authorized by
quality-manager
