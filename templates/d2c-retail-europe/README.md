# Template — D2C Retail Europe

This is a starting point, not a finished company. It describes a business that sells
better-for-you food to consumers online and to grocery retailers on pallets, from a
warehouse in Germany, into the DACH countries plus France, Italy and the Netherlands.
Roughly sixty percent of revenue comes from the webshop, forty percent from retail.

If that sounds like your company, you can read this folder in an afternoon, strike out
what does not fit, and add what is missing. When you apply it, your NeoDonkey stops
being an empty system and becomes the business you just described.

## What is in here

Six folders, one per POLISM category. POLISM is the Operating Model Canvas vocabulary
that operations people have used for years: Processes, Organisation, Locations,
Information, Suppliers, Management System.

- **`processes/`** — what the company does. 32 processes and 132 rules, from buying nuts
  to issuing an XRechnung. Each one is a page: prose explaining the intent, then the
  rules the runtime enforces.
- **`organisation/`** — who may do what. 13 roles with explicit authorisation
  boundaries, including the places where a European auditor expects two people rather
  than one.
- **`locations/`** — where it happens. 8 sites: a German warehouse and head office,
  fulfilment partners in the Netherlands, France and Italy, offices in Austria and
  Switzerland, and the webshop itself, because a virtual sales channel is a location too.
- **`information/`** — the nouns. 31 entity definitions with their fields, their types,
  and — most importantly — the **named predicates** that the rules refer to. When a rule
  says "order not already fully delivered", the meaning of *fully delivered* is written
  down on the order, not hidden inside the software.
- **`suppliers/`** — 6 outside partners: two food suppliers, a packaging printer, a
  parcel carrier, a pallet forwarder, a payment service provider. Every name in this
  template is invented.
- **`management-system/`** — 6 steering rhythms. The monthly stock review, the weekly
  margin review, the quarterly supplier review, the month-end close, the weekly quality
  round, and the annual review of this very folder.

## What a company should change first

In this order. The first three take an hour and matter more than everything else.

1. **`locations/`** — delete the sites you do not have, add the ones you do. Everything
   about VAT, customs and stock hangs off this.
2. **`organisation/`** — the role names are generic. Rename them to the job titles your
   people actually have, and check every `## Authorized by` line in `processes/` still
   names a role that exists. The validator will tell you if it does not.
3. **`information/vat-treatment.md`** and **`information/vat-registration.md`** — your
   VAT registrations, your OSS threshold status, your reverse-charge policy. These two
   files decide what lands on every invoice you ever issue.
4. **`information/article.md`** — the food-specific fields. If you do not sell food,
   delete best-before date, batch obligation, allergens and weight-based pricing, and
   most of `processes/quality-inspection.md` goes with them.
5. **`processes/`** — read all fifteen, delete the ones you do not run. A process you do
   not run is worse than a missing one, because the runtime will enforce it.
6. **`management-system/`** — set the rhythms you will genuinely hold. An unheld review
   in this folder is a lie about your company.

Everything else can wait until you have run a real month.

## How to read a file

Every file has the same shape. Prose at the top, for people. Structured sections below,
for the runtime. Nothing in the prose is executed; nothing in the structured sections is
decoration.

```
# Goods Receipt

The goods receipt is executed when a delivery arrives at the warehouse.

## Triggered by
Arrival of a delivery at the location with reference to an order.

## Rules
If Create goods-receipt under condition
  quantity > 0 and
  order exists and
  order not already fully delivered
then
  Create goods-receipt-fact and
  Update stock with +quantity and
  Update order-line with status "delivered"

## Authorized by
warehouse-clerk or warehouse-management
```

That is the whole language. A rule is one sentence: *if this change happens, and these
things are true, then these changes follow.* You can read it out loud to a colleague.

## The rule grammar, in one page

`runtime/polism/grammar.md` is the normative specification and wins over anything here.
This is the working summary.

**Triggers.** `If Create <entity>`, `If Read <entity>`, `If Update <entity>`,
`If Delete <entity>`, optionally followed by `under condition`.

**Conditions**, joined by `and` — and only `and`:

- comparisons — `quantity > 0`, `discount-percent <= 10`, and a **field** on the right too:
  `open-balance-eur > credit-limit-eur`
- existence — `order exists`, `batch-number not exists`
- equality on values — `currency is "EUR"`, `channel is not "webshop"` (text must be quoted)
- **named predicates** — `order not already fully delivered`, `batch expired`. These are the
  important ones. A predicate is declared under `## Predicates` on the entity it belongs to,
  and its meaning is written there in the same condition vocabulary. The runtime does not
  know what "fully delivered" means and must never guess: it looks the phrase up on the order.

**Consequents**, joined by `and`:

- `Create <entity>` — id taken from the triggering document; fields declared on *both*
  entities are copied
- `Create <entity> with <field> <value>` — and also set this
- `Create <entity> with <field>` — **obligation**: the field must be present on the trigger.
  This is the manifesto's one-word demo.
- `Update <entity> with <field> <value>` / `with <field>` / `with +<field>` / `with -<field>`
- `Delete <entity>`

A counter takes its delta from the trigger's field of the **same name**. There is no
`+delivered-quantity from quantity` in version 1, so fields that add together must be named
alike — see `information/goods-receipt.md`.

**Entity declarations** need `## Fields` (types are `text`, `number`, `money`, `date`,
`boolean`, `reference to <entity>`, optionally `required`), `## Predicates`,
`## Identified by` (the business key, used to find an update target), and
`## Created on demand` (`yes` only where a missing document should be created, as on `stock`).

**Authorisation.** `## Authorized by` names roles joined by `or`, and applies to every rule in
the file. `and` is **refused** — see the limits below.

**Sections.** An unrecognised `##` heading is a hard error, not prose. Prose goes above the
first `##`, under a `###` subheading, or in `## Notes`, `## References`, `## Retention`,
`## Cadence`, `## Measures`, `## Owner`, `## Purpose`, `## Context`, `## Examples`. Inside
`## Rules` there is no room for commentary at all — only rule blocks.

## What the language cannot do, and where that shows

Every one of these has a `NEEDS-GRAMMAR` comment at the place it bites, with the in-grammar
substitute next to it. Search for the word to find them all.

1. **No conditional consequents, and therefore no threshold-based authorisation.** Every rule
   on the same operation is a hard requirement — all conditions must hold together. So
   "if reverse charge then also require the exemption wording" cannot be written, and two files
   on `Create discount`, one for ≤ 10 % and one for > 10 %, would conjoin into a contradiction
   and refuse every discount. The ten percent boundary, the 5,000 EUR invoice approval and the
   10,000 EUR order approval in this template are **documented controls, not enforced rules**.
   This is the largest gap. See `processes/discount-posting.md`.
2. **No four-eyes.** `## Authorized by a and b` is refused. Genuine four-eyes is two signers on
   one commit — a Truth Layer property (manifesto line 114). An `approval-count` field is a
   counter, not two signatures, and this template says so where it uses one.
3. **No `today` and no date arithmetic.** Deliberately: a rule reading the clock would not be
   reproducible. Shelf-life status and overdueness are derived fields set by named sweeps.
   See `processes/shelf-life-sweep.md`.
4. **No aggregation.** Running totals are maintained as they happen, which is what an
   accountant does anyway.
5. **One-hop paths only.** `order.status` yes; `order.customer.country` no.
6. **No explicit counter delta.** Hence the same-name field rule above.

## Two conventions worth knowing

**Where semantics live.** Business meaning belongs in `information/`, never in the runtime. If
you want to know why a goods receipt was refused, the answer is a sentence in an entity file,
not a stack trace. This is the single rule that keeps the system from turning back into the
thing you left.

**Which record a consequent touches.** Never guessed. The runtime picks the target at parse
time: the trigger document itself, or the single declared `reference to <target>` field, or the
target's `## Identified by` fields where the trigger declares all of them. If none of those
applies, the rule is refused at parse time with a message telling you what to declare. That is
why every entity declares its references and its business key.

## Derived from

This template implements Appendix XII of the NeoDonkey manifesto. `processes/goods-receipt.md`
is the manifesto's own example, extended with the batch-number obligation that Appendix XII
uses to show what changing one word does.
