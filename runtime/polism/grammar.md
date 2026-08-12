# POLISM Grammar

```
grammar-version: 2
status: normative for NeoDonkey v1.0
owner: runtime/polism/ (agent G2, formerly agent C)
implemented-by: runtime/polism/parse.js, runtime/polism/execute.js, runtime/polism/money.js
```

**Reading order.** §0–§11 are grammar version 1 and are still normative: every sentence
below that describes version 1 describes version 2 as well, unchanged. **Part II (§12–§20) is
grammar version 2** — the seven additions FD-5 authorises, plus exact money (FD-1), and nothing
else. Version 2 adds; it redefines nothing (§0). Where a version-1 section is *extended* by
Part II, the version-1 text says so and names the section.

If you are agent F2 modelling the general ledger: **§12 (invariants), §13 (aggregation) and
§18 (periods) are your contract.** §19 is how money behaves. Read those four and nothing else.

This file is the **normative specification** of the structured text in `operating-model/**/*.md`.
If `parse.js` and this file disagree, that is a bug in `parse.js`.

Two promises hold above everything else:

1. **Nothing here is a programming language.** A COO writes and reads these sentences. The
   runtime executes exactly what she wrote — no translation layer, no code generation
   (Principle 11).
2. **Nothing is guessed.** Every construction the parser does not know is *refused, loudly,*
   with file, line, the offending text, and what was expected. There is no fallback, no
   "best effort", no fuzzy match, no LLM anywhere in parsing or execution
   (Principle 6, manifesto line 517: "silent wrong calculation is structurally prevented").

---

## 0. Additive-only evolution rule (normative)

> Grammar extensions **add**. They never replace, never redefine, never remove.
> (Manifesto line 509, Principle 6.)

Concretely, for every future version `n+1`:

* A construction that is valid and has meaning *M* in version `n` has **the same meaning** *M*
  in version `n+1`. Forever. A model written in 2027 executes identically in 2045.
* New versions may only add: new section names, new operators, new consequent forms, new field
  types, new field-type-driven behaviour for *newly declared* types.
* A version-`n` runtime meeting version-`n+1` text does **not** ignore it and does **not** guess
  it. It refuses it with `severity: 'error'` and a message naming the unknown construction.
  A refused model is a stopped system, which is the safe state; a silently half-understood
  model is a wrong system, which is not.
* Therefore: **the grammar version is a property of the runtime, not of the file.** Files carry
  no version marker. Any runtime that understands construction *X* executes *X*; any runtime
  that does not, says so by name. This is what makes both directions of Principle 6 work at
  once.
* Removing a construction requires a new *major* NeoDonkey work (the book analogy, Appendix I),
  never a grammar version.

Anything listed in [§10 Known limits](#10-known-limits--the-missing-1) is **not** in version 1
and **is refused by version 1**. It is listed so that the missing 1% has a name
(Principle 10) — not so that anyone can rely on it early.

---

## 1. File structure

```ebnf
polism-file   = prose-block? , { section } ;
prose-block   = { any-line }                  (* everything before the first "## " heading *)
section       = "## " , section-name , NEWLINE , { body-line } ;
```

* Only **level-2** headings (`## `) open a section. `#`, `###`, `####` … are prose and are
  ignored by the runtime — that is the escape hatch for arbitrary human structure.
* **Exception, and it is the one place this file is strict about layout: inside `## Rules`, only
  rules may appear.** No headings of any level, no commentary lines, no bullets — a `### `
  heading there is an error, not prose. `## Rules` is the one section whose every line the runtime
  must account for; a line it cannot read there is a rule it might be failing to enforce, and
  Principle 6 does not allow that to pass quietly. Explanation of an individual rule goes in
  `## Notes` (or above the first `## ` section), which is also where it reads best — the prose
  block at the top of the file is what the COO actually reads.
* Section names are matched case-insensitively; a trailing `:` is allowed.
* Files named `README.md`, `index.md`, or beginning with `_` are documentation and are skipped
  entirely.

### 1.1 Section names known to version 1

| Section | Kind | Meaning |
|---|---|---|
| `## Rules` | **runtime** | If-Then rules (§3). Allowed in any file. |
| `## Authorized by` | **runtime** | Roles allowed to trigger the rules in this file (§6). In an `information/` file it is the entity-scope default of grammar version 2 (§16.1). |
| `## Fields` | **runtime** | Field declarations of an entity (§2.1). `information/` only. |
| `## Predicates` | **runtime** | Named predicates of an entity (§2.2). `information/` only. |
| `## Identified by` | **runtime** | Business key of an entity (§2.3). `information/` only. |
| `## Created on demand` | **runtime** | `yes` / `no` (§2.4). `information/` only. |
| `## Invariants` | **runtime** | *Grammar version 2.* Conditions that must hold after any change (§12). `information/` only. |
| `## Period` | **runtime** | *Grammar version 2.* This entity is a period: from, to, locked when (§18). `information/` only. |
| `## Dated in` | **runtime** | *Grammar version 2.* `<date-field> in <period-entity>` (§18). `information/` only. |
| `## Triggered by` | prose | The human explanation of when this process runs. **Deliberately not executable** — the machine trigger is the `If <op> <entity>` line. |
| `## Purpose`, `## Notes`, `## Description`, `## Context`, `## Owner`, `## Inputs`, `## Outputs`, `## Measures`, `## Cadence`, `## Retention`, `## References`, `## Examples`, `## Open questions` | prose | Ignored by the runtime, read by humans. |

Any other `## ` heading is an **error**, not prose:

```
operating-model/processes/goods-receipt.md:14: unknown section "## Approved by".
  Did you mean "## Authorized by"?
  Prose belongs above the first "## " section, or under a "### " subheading.
  Known sections: Rules, Authorized by, Fields, Predicates, Identified by,
  Created on demand, Triggered by, Purpose, Notes, ...
```

This strictness is deliberate: the parser cannot tell `## Rules for returns` (a section full of
obligations someone expects to be enforced) from `## Remarks` (prose). Guessing is the one thing
Principle 6 forbids, so the unknown heading is refused. See §11 for the tension this creates.

### 1.2 POLISM category and naming

A file's category is the **last** path segment matching one of
`processes`, `organisation`, `locations`, `information`, `suppliers`, `management-system`.
(Last, so `templates/d2c-retail-europe/processes/x.md` works identically to
`operating-model/processes/x.md`.) A file in no category folder is an error.

* `information/<entity>.md` **declares the entity** `<entity>`.
* `organisation/<role>.md` **declares the role** `<role>`.
* File basenames must be lower-case slugs: `[a-z0-9]+(-[a-z0-9]+)*`. The slug *is* the name —
  there is no separate id. `information/goods-receipt-fact.md` ⇒ entity `goods-receipt-fact`
  ⇒ documents at `documents/goods-receipt-fact/<id>.json`.

---

## 2. Entity definitions (`information/*.md`)

Business semantics live **here**, never in the parser. `parse.js` contains no knowledge of
orders, stock, or delivery. If it did, we would have rebuilt SAP.

### 2.1 `## Fields`

```ebnf
field-decl = ["-" | "*"] , field-name , ":" , field-type , [ "required" ] , [ comment ] ;
field-type = "text" | "number" | "money" | "date" | "boolean"
           | "reference to " , entity-name
           | "one of " , enum-value , { ("," | " or ") , enum-value } ;   (* v2, §15 *)
comment    = ( " — " | " -- " | " # " ) , { any-char } ;
```

```
## Fields
- quantity: number required
- batch-number: text
- received-on: date
- order: reference to order
- order-line: reference to order-line
- article: reference to article
- location: reference to location
```

* `required` ⇒ a document of this entity that is created or updated without a non-empty value
  for this field is refused, quoting this line.
* `reference to <entity>` ⇒ the field holds the **id** of a document of `<entity>`. This is the
  only reference mechanism in version 1, and it is what makes consequent targeting declarative
  (§5.1) rather than guessed.
* An unknown field type is refused with the list of known types.
* Field names are slugs (`[a-z0-9]+(-[a-z0-9]+)*`).
* Type rules (enforced statically where possible, at execution otherwise):
  * `>`, `>=`, `<`, `<=` are defined for `number`, `money`, `date` only. Using them on `text`
    or `boolean` is refused *at parse time*.
  * `date` values are ISO-8601 strings (`YYYY-MM-DD`, optionally `THH:MM…`) and compare
    lexicographically, which for ISO-8601 is chronological.
  * `money` is a plain number in version 1 (see §10). **In grammar version 2 it is an exact
    decimal with its currency — `"4999.99 EUR"` — and never a float: §19.**
  * `+field` / `-field` counters require `number` or `money`. (Version 2 adds
    `+field from other-field`: §17.)
  * `one of …` (version 2, §15) is an enumeration: `is` / `is not` only, and a value outside the
    declared list is refused in the model text *and* in the data.

### 2.2 `## Predicates`

A named predicate is an English phrase with a declared meaning, written in the same condition
grammar. This is how `order not already fully delivered` gets its meaning *from the operating
model*.

```ebnf
predicate-decl = ["-" | "*"] , predicate-name , ":" , condition-list ;
predicate-name = word , { " " , word } ;          (* must not contain the word "and" *)
```

```
## Predicates
- fully delivered: delivered-quantity >= ordered-quantity
- already fully delivered: fully delivered
- closed: status is "closed"
```

* Conditions in a predicate body are evaluated **against a document of this entity** (the
  implicit subject). A bare `<predicate-name>` in a body references another predicate of the
  same entity (`already fully delivered: fully delivered`).
* Predicate bodies are joined by `and` only (§4).
* Predicate names must not contain the word `and`, because `and` is the condition separator.
* A body line without an operator is ambiguous — `customer blocked` could be a sibling predicate
  named "customer blocked", or the predicate "blocked" of the referenced `customer`. The rule:
  **a sibling predicate declared on this entity wins; otherwise it is read as subject + predicate.**
  Resolved after the whole model is known, so the outcome never depends on file or line order.
* Predicate → predicate cycles are detected at parse time and refused with the full cycle path.
  Evaluation additionally refuses at nesting depth > 32 (defensive; unreachable if parse passed).

### 2.3 `## Identified by`

The business key: which fields identify *one* document of this entity. Used by consequent
targeting (§5.1, mechanism **key**).

```
## Identified by
article and location
```

(Also accepted as one bullet per field.) Zero, one, or many fields; `## Identified by` is
optional, but an entity that is the target of an `Update`/`Delete` consequent must be reachable
by *some* declared mechanism or the rule is refused at parse time.

### 2.4 `## Created on demand`

```
## Created on demand
yes
```

Default `no`. Answers the question "`+field` on a document that does not exist yet" — see §5.3.
The answer is **declared by the business**, not decided by the runtime.

---

## 3. Rules (`## Rules`, any file)

```ebnf
rule          = "If" , crud-op , entity-name ,
                [ "under condition" , condition-list ] ,
                "then" , consequent-list ;
crud-op       = "Create" | "Read" | "Update" | "Delete" ;   (* case-insensitive *)
condition-list   = condition , { "and" , condition } ;
consequent-list  = consequent , { "and" , consequent } ;
```

* Layout is free: line breaks and indentation are insignificant. Both the multi-line form of the
  manifesto and the single-line form (`... order exists, then Update stock with +quantity`) parse
  to the identical AST. A `,` or `;` directly before a keyword is ignored; so is a trailing `.`.
* Inside `## Rules`, a new rule starts at a line beginning with `If`, or after a blank line.
  Nothing else may appear there (§1): a heading or a commentary line is refused with a message
  pointing at `## Notes`. Rules stay unannotated on purpose — the section is a list of
  obligations, and everything in it is enforced.
* Keywords (`if`, `under`, `condition`, `then`, `and`, `or`, `with`, `not`, `is`, `exists`) are
  case-insensitive and **never** part of a quoted value.
* Missing `then` ⇒ error. `then` without consequents ⇒ error. `under condition` with no
  condition ⇒ error. A rule with no `under condition` clause is legal (it always applies).

---

## 4. Conditions — the complete list for version 1

`and` is the only connective. Every operator below is exhaustive; **anything else is refused.**

> *Grammar version 2 extends this section in one way only:* either side of a comparison may be an
> **aggregate** (`sum of … over …`, `count of …`) instead of a field or a value — §13. No new
> operator, no new connective.

| Form | Meaning |
|---|---|
| `<subject> > <value>` | numeric / date greater than |
| `<subject> >= <value>` | greater or equal |
| `<subject> < <value>` | less than |
| `<subject> <= <value>` | less or equal |
| `<subject> = <value>` | equal (synonym of `is`) |
| `<subject> != <value>` | not equal (synonym of `is not`) |
| `<subject> is <value>` | equal |
| `<subject> is not <value>` | not equal |
| `<subject> exists` | the referenced document exists / the field has a non-empty value |
| `<subject> not exists` | negation of `exists` |
| `<subject> <predicate-name>` | the named predicate declared on the subject's entity (§2.2) |
| `<subject> not <predicate-name>` | negation of a named predicate |

### 4.1 Subjects (paths)

```ebnf
subject = root , [ "." , field-name ] ;
root    = field-name | entity-name ;         (* entity-name = the context entity itself *)
```

Resolution of `root`, in this order (first match wins, deterministic, documented):

1. a **declared field** of the context entity — if its type is `reference to E`, the root
   resolves to *the referenced document of E*; otherwise to the field's scalar value;
2. the **context entity's own name** — resolves to the context document itself
   (`goods-receipt already checked`);
3. otherwise: error, listing the declared fields of the context entity.

The context entity is the **trigger entity** inside a rule, and the **owning entity** inside a
predicate body.

`root.field` is **one hop only**: `order.status` = the `status` of the document referenced by the
trigger's `order` field. `order.customer.country` is refused (§10).

### 4.2 The right-hand side: a value, or another field

| Right-hand side | Example |
|---|---|
| text literal | `status is "delivered"` (double quotes required) |
| number literal | `quantity > 0`, `weight <= 12.5`, `balance != -3` |
| boolean literal | `blocked is true` |
| **another field** | `delivered-quantity >= ordered-quantity`, `received-on > order.ordered-on` |

A bare unquoted word is read as a **field name**, resolved exactly like the subject (§4.1) — this
is the only way a predicate such as `fully delivered` can be written at all. Text values therefore
*must* be quoted: `status delivered` would mean "compare with the field `delivered`", so the
parser demands `status "delivered"` and refuses an undeclared field name loudly.

Types must agree, checked at parse time: number/money with number/money, `date` with `date`,
`text` with `text`, `boolean` with `boolean`. `>` `>=` `<` `<=` need both sides ordered
(§2.1). Comparing a field with a whole document is refused.

### 4.5 When a condition cannot be evaluated at all

If the subject cannot be reached — the reference is empty, or the referenced document does not
exist — the condition is **not satisfied**, including its negated form. `order not already fully
delivered` on a goods receipt whose order does not exist is a refusal, not a pass: there is no
truth value to compute, and passing would be a silent wrong calculation. The message says which
document was missing, so the author sees the real cause rather than a confusing predicate failure.

### 4.3 `exists` semantics

`exists` is defined by the *declared type* of the subject, not by inspection:

* subject is a `reference to E` field ⇒ true iff the field holds an id **and**
  `world.get(E, id)` returns a document;
* subject is a scalar field ⇒ true iff the value is present and not `null`, `undefined`, or `""`;
* subject is `root.field` ⇒ the referenced document must exist *and* its field must be non-empty.

### 4.4 Named predicates and `not`

For `<subject> not already fully delivered` the parser resolves the predicate name against the
subject entity's `## Predicates` in this order:

1. the **full** text (`not already fully delivered`) as a declared name — used verbatim,
   `negated: false`;
2. else, if the text starts with `not `, the **remainder** (`already fully delivered`) as a
   declared name — used with `negated: true`;
3. else error, listing every predicate declared on that entity and the file that declares them.

Exact match before negation, so a business that literally declares `not already fully delivered`
keeps its own meaning. The parser knows the word `not`; it never knows what "delivered" means.

---

## 5. Consequents — the complete list for version 1

```ebnf
consequent  = verb , entity-name , { with-clause } ;
verb        = "Create" | "Update" | "Delete" ;      (* case-insensitive *)
with-clause = "with" , ( field-name , value        (* set        *)
                       | field-name                (* obligation *)
                       | ("+" | "-") , field-name  (* counter    *)
                       ) ;
```

> *Grammar version 2 extends this section in two ways:* a counter may name its source field
> (`+delivered-quantity from quantity`, §17), and the consequents of a rule may be arranged into
> branches (§14). Nothing here is redefined, and an aggregate may **not** appear in a consequent
> (§20.2).

| Form | Meaning |
|---|---|
| `Create <entity>` | create one document of `<entity>` (§5.2) |
| `Create <entity> with <field> <value>` | …and set `<field>` to the literal |
| `Create <entity> with <field>` | **obligation**: `<field>` must be present on the trigger document, and is copied. This is the manifesto's headline demo (line 475). |
| `Update <entity> with <field> <value>` | set a field on the target document (§5.1) |
| `Update <entity> with <field>` | obligation: copy `<field>` from the trigger, refusing if absent |
| `Update <entity> with +<field>` | counter: `target.field += trigger.field` — **same field name on both sides** (§10.13) |
| `Update <entity> with -<field>` | counter: `target.field -= trigger.field` |
| `Delete <entity>` | delete the target document |

Several `with` clauses may follow one verb: `Create invoice with status "draft" with currency "EUR"`.
`Read` is not a consequent verb — reading changes nothing, so it would produce no Change.
Unknown verbs (`Archive`, `Post`, `Send`, `Notify`) are refused with the list of the three.

### 5.1 Consequent targeting — *which* document?

`Update stock with +quantity`: which stock document? **Never guessed.** The mechanism is chosen
**at parse time** from the entity declarations and stored on the AST, so `execute.js` only
follows a plan it did not invent. First match wins:

| # | Mechanism | Condition | Target |
|---|---|---|---|
| 0 | `self` | consequent entity == trigger entity | the trigger document itself |
| 1 | `reference` | the trigger entity declares **exactly one** field of type `reference to <target>` | the document that field points to |
| 2 | `key` | the target entity has `## Identified by f1 … fn` and **every** `fi` is also a declared field of the trigger entity | the unique document of the target entity where each `fi` equals the trigger's `fi` |
| — | refused | none of the above | parse error telling the author exactly what to declare |

The parse error is written for a COO:

```
operating-model/processes/goods-receipt.md:8: cannot determine which "stock" document
  "Update stock with +quantity" should change.
  Declare "## Identified by" in operating-model/information/stock.md with fields that
  goods-receipt also has, or add a "stock: reference to stock" field to goods-receipt.
```

Two references to the same target entity are **ambiguous** and refused at parse time (v1 has no
syntax to pick one — see §10). A **key** match that finds more than one document is refused at
execution time as an ambiguous target, listing the matching ids: that is a data problem, and
guessing one of them would be a silent wrong calculation.

### 5.2 `Create` consequents: id and contents

* **Id** is the trigger document's id. `Create goods-receipt GR-0001` ⇒ the
  `goods-receipt-fact` gets id `GR-0001`. Deterministic and traceable — no counter, no clock,
  no random (contract non-negotiable #5). If that id is already taken, the rule is refused
  rather than overwriting.
* **Contents** = every field **declared on both** the trigger entity and the target entity
  (copied, in the target's declaration order), then the `with` clauses in written order.
  Declaration-driven, not name-guessing: if the two entity files agree that both have a
  `quantity: number`, that is the model's statement that it is the same quantity. A type
  mismatch on a shared name (`number` vs `text`) is refused at parse time.
* `Create <trigger-entity>` inside a rule triggered by that same entity is refused at parse time
  (it would collide with the trigger's own id).
* Required fields of the target that end up empty ⇒ refusal quoting the field declaration.

This is exactly why the headline demo needs **one word**: `batch-number` is already copied
because both entities declare it; adding `with batch-number` adds the *obligation* that it be
present. Nothing else in the system changes.

### 5.3 `+field` on a document that does not exist yet

Declared by the business, in `information/<entity>.md`:

* `## Created on demand: yes` ⇒ a counter consequent whose target is missing produces a
  **`create`** Change: the `## Identified by` fields copied from the trigger, all other declared
  `number`/`money` fields starting at `0`, then the counter applied. This is the honest answer
  for `stock`: the first pallet of a new article at a new warehouse must not be refused because
  no stock row exists yet.
  The new document's **id is derived from the business key** (`cashew-1kg-berlin-main`), so the
  same key always yields the same id — no counter, no clock, no randomness — and the next goods
  receipt for that pair finds the same document. An entity created on demand through a
  **reference** (mechanism 1) takes the id the reference names.
  This applies only when *every* clause of that consequent is a counter (`+field` / `-field`).
* `## Created on demand: no` (**default**) ⇒ refusal:

```
No "stock" document exists for article "cashew-1kg" at location "berlin-main".
  Rule: operating-model/processes/goods-receipt.md:8 — "Update stock with +quantity"
  Either create the stock document first, or write "## Created on demand: yes" in
  operating-model/information/stock.md.
```

A **non-counter** `Update` (`with <field> <value>`) against a missing document is *always* a
refusal, never a create: setting one field of a document nobody has created is not a meaningful
business act; creating it is what a `Create` rule is for.

### 5.4 Folding: one Change per document

All consequents of all matching rules are folded so that **each document appears at most once**
in `changes`. Two rules both adding `+quantity` add twice (arithmetic composes). Two rules
setting the same field to *different* literals is a **conflict** and is refused, quoting both
rules — there is no last-writer-wins in the Truth Layer.

A consequent whose result equals the document's current state still appears in `changes` (the
rule fired; the git layer produces an empty diff). We do not filter it out, because filtering
would hide a rule from the audit trail.

---

## 6. `## Authorized by`

```ebnf
authorized-by = role-name , { ( "or" | "," | NEWLINE ) , role-name } ;
```

```
## Authorized by
warehouse-clerk or warehouse-management
```

* Every name must be a declared role (`organisation/<role>.md`), else parse error with the list
  of declared roles.
* Semantics: the actor must hold **at least one** of the named roles. Applies to **every** rule
  in the file. A file without `## Authorized by` places no role constraint.
* An actor lacking the role is refused **even when every condition holds** — authorization is a
  rule constraint, not workflow code (manifesto lines 114, 471).
* *Grammar version 2 adds three more scopes around this one — arm, rule and entity — and the most
  specific one that exists wins (§16). The file scope described here is unchanged: a version-1
  process file behaves exactly as it did.*
* **`and` is refused** in version 1 with a pointed message: genuine four-eyes needs *two
  different signers on one commit*, and the version-1 `Intent` carries a single actor. See §10.

---

## 7. Cascading: consequents do **not** trigger rules (decision, version 1)

A consequent never triggers another rule. Rules fire only on the intent the user performed.

Why:

* **Predictability for the author.** A COO must be able to read one file and know what her
  change does. Depth-*n* fan-out is exactly the Frankenstein that Principle 11 abolishes.
* **Atomicity has a natural boundary.** Appendix VIII: one business event ⇒ one commit. With
  cascading, one warehouse scan could rewrite a thousand documents, and a violation at depth 4
  would reject an event whose author cannot see why.
* **Determinism is cheap here and expensive there.** Without cascading, `changes` is a pure
  function of (model, intent, world). With it, the result depends on the order in which
  intermediate states are staged — and cycles become possible.

But "no cascade" must not be *silent* (Principle 6). Therefore `parse.js` performs a static
check: if any consequent's verb+entity matches another rule's trigger, it emits a
`severity: 'warning'` diagnostic naming both files and lines:

```
operating-model/processes/goods-receipt.md:8: consequent "Update order-line with status
  "delivered"" matches the trigger of the rule at operating-model/processes/order-close.md:4.
  Consequents do not trigger rules in grammar version 1, so that rule will not fire.
  Move its conditions into this rule, or wait for the opt-in cascade of a later version.
```

**Exit path** (additive, later version): an explicit opt-in per rule, e.g.
`then ... and then apply rules for order-line`, with a declared maximum depth and parse-time
cycle detection over the trigger/consequent graph. Opt-in, bounded, and visible in the text —
never implicit.

---

## 8. Two rules on the same operation

**Both apply. All of them apply.** The order is:

1. by **file path**, byte-wise ascending;
2. then by **line number** of the rule, ascending.

Conditions of *all* matching rules must hold. **Every** violation is reported, not just the
first — a COO fixing a rejected goods receipt should see everything that is wrong in one pass.
Consequents are collected rule by rule in that order, and within a rule in written order, then
folded per §5.4. `changes[0]` is always the trigger's own change (absent for `Read`).

All matching rules are **conditions on the same act**, never alternative branches. `## Authorized
by` is a property of the file, so two files governing one operation with different roles make it
unperformable rather than conditional. This is the most consequential limit of version 1 —
see §10.14, which `parse.js` also warns about wherever it can detect it.

An operation that **no** rule matches is allowed and produces only the trigger's change: an
operating model is not obliged to govern every entity. (Declared-ness is still enforced: an
operation on an entity with no `information/<entity>.md` is refused, as are missing `required`
fields.) **Rule coverage is therefore an authorization boundary**: an entity no rule governs can be
created, changed and deleted by an actor with no role at all. That is deliberate for v0.1 — a model
is written incrementally and a default-refuse kernel could not be bootstrapped — but it means
"ungoverned" and "unrestricted" are the same thing here, which is not what an author reading their
own model would assume. The fix belongs in v0.2 and is additive: `## Authorized by` on an
*entity* file as the fallback when no process rule covers an operation, and a runtime that refuses
when neither exists.

> **That fix shipped in grammar version 2** — §16.1 (entity-scope `## Authorized by`), §16.2 (a
> coverage warning for every uncovered entity-operation pair, and
> `evaluate(…, { authorization: 'strict' })` which refuses them). The default is still permissive,
> because changing it would change the meaning of an existing model, which FD-7 reserves for a
> major version. What changed is that it is now visible and switchable rather than silent.

---

## 9. Worked example — goods receipt, end to end

`operating-model/information/goods-receipt.md`

```
# Goods Receipt (document)

What the warehouse captures when a pallet arrives.

## Fields
- quantity: number required
- batch-number: text
- article: reference to article
- location: reference to location
- order: reference to order
- order-line: reference to order-line
```

`operating-model/information/stock.md`

```
# Stock

How much of one article lies at one location.

## Fields
- article: reference to article
- location: reference to location
- quantity: number

## Identified by
article and location

## Created on demand
yes
```

`operating-model/information/order.md`

```
# Order

## Fields
- ordered-quantity: number
- delivered-quantity: number
- status: text

## Predicates
- fully delivered: delivered-quantity >= ordered-quantity
- already fully delivered: fully delivered
```

`operating-model/processes/goods-receipt.md` — verbatim from Appendix XII:

```
# Goods Receipt

The goods receipt is executed when a delivery arrives at the warehouse.
It checks whether the delivery matches the order and updates stock
plus order status.

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

Intent: `create goods-receipt GR-0001` = `{quantity: 12, article: "cashew-1kg",
location: "berlin-main", order: "PO-77", order-line: "PO-77-1", batch-number: "L-2027-04"}`,
actor roles `["warehouse-clerk"]`. World: order `PO-77` (ordered 100, delivered 0),
stock for (`cashew-1kg`, `berlin-main`) at quantity 40, order-line `PO-77-1` open.

`evaluate` returns `ok: true` and exactly four Changes, in this order:

| # | op | document | how it was decided |
|---|---|---|---|
| 0 | create | `goods-receipt/GR-0001` | the trigger itself |
| 1 | create | `goods-receipt-fact/GR-0001` | §5.2 — id from trigger, shared declared fields copied |
| 2 | update | `stock/<the (cashew-1kg, berlin-main) row>` | §5.1 mechanism **key** via `## Identified by`; quantity 40 → 52 |
| 3 | update | `order-line/PO-77-1` | §5.1 mechanism **reference** via `order-line: reference to order-line`; status → `"delivered"` |

All four land in **one** commit (Appendix VIII). Change the last word of the process file to
`Create goods-receipt-fact with batch-number` and a goods receipt without a batch number is
refused from that commit onward, with no other change anywhere in the system.

Refusals for the same rule:

* `quantity: 0` ⇒ `ok: false`, violation quoting `quantity > 0`.
* `order: "PO-999"` (not in the world) ⇒ violation quoting `order exists`.
* `PO-77` already delivered 100 of 100 ⇒ violation quoting `order not already fully delivered`,
  naming the predicate's declaration in `information/order.md`.
* actor roles `["accountant"]` ⇒ violation quoting `## Authorized by`, even though every
  condition holds.

---

## 10. Known limits — the missing 1%

Version 1 refuses every construction below. They are named here because Principle 10 says a
system that admits its imperfection stays honest — and because agent F will hit some of them.

> **This table is the version-1 record and is kept as written.** Grammar version 2 resolved #1,
> #9, #10 (invariants only), #13, #14 and the money half of #7. Which are resolved, which are not,
> and what version 2's own limits are: **§20**. Nothing below has been quietly edited to look
> better in hindsight.

> **The most consequential one is #14, not #1.** Every other entry on this list is a sentence the
> author cannot write, and the parser says so. #14 is different: the sentences *do* parse, the
> model reads correct, and the control is silently dead. Threshold approvals — 10,000 € order
> sign-off, 5,000 € invoice, 500 € write-off, 100 € goodwill — are exactly the shape it defeats,
> so v0.1 documents those controls without enforcing them. Read #14 before #1.
>
> Ranked order of what to add next, on the evidence of one real 54-file model:
> **#14 (per-rule `## Authorized by`) → #9 (enumerations) → #13 (cross-name counters) →
> #1 (aggregation).**

| # | Missing | Consequence for authors | Exit path |
|---|---|---|---|
| 1 | **Aggregation.** No `sum of`, `count of`, `for each`. "Fully delivered" cannot be computed by summing an order's lines. | Model it as a maintained field (`delivered-quantity` on the order, kept current by a counter consequent) instead of a derived one. | Additive condition forms `count of <entity> where <condition> <op> <value>` and `sum of <field> over <entity> where …`. Needs `World.find`, which already exists. |
| 2 | **Disjunction in conditions.** No `or` between conditions (only in `## Authorized by`). | Write two rules; both apply independently (§8). | Additive `or` with explicit precedence, or a named predicate holding the disjunction. |
| 3 | **Multi-hop paths.** `order.customer.country` refused; one hop only. | Denormalise the field, or declare a predicate on the intermediate entity. | Additive n-hop resolution; the reference graph already carries the types. |
| 4 | **True four-eyes.** `## Authorized by a and b` refused. Version 1 checks one actor's roles. | Express approval as a document + a rule (`If Update purchase-order under condition approved-by exists …`). | Manifesto line 114 is explicit: four-eyes is a *signature constraint on the commit*. It belongs to the Truth Layer (module A/B) plus a `signers` field on the Intent, not to a single-actor evaluation. |
| 5 | **Disambiguating two references to the same entity.** | Rename one field or split the entity. | Additive `Update <entity> referenced by <field> with …`. |
| 6 | **Cascading.** §7. | Put the consequences in one rule. | Opt-in, depth-bounded (§7). |
| 7 | **Currency, VAT, units.** `money` is a bare number; no currency on a value, no unit on a quantity, no reverse-charge arithmetic. | Declare `currency: text` next to the amount and constrain it with a rule. | Additive field types `money in <field>` / `quantity in <unit-field>`, with refusal on mixed-currency arithmetic. |
| 8 | **Date arithmetic.** `best-before < today + 30 days` refused; no `today`. | Compare against a field. | Additive, and it must take an *injected* clock (contract non-negotiable #5) — no `Date.now()` in the runtime. |
| 9 | **Enumerations.** `status: text` accepts any string; a typo'd `"delivrd"` is not caught. | — | Additive `status: one of "open", "delivered"`. Cheap, high value; likely the first version-2 addition. |
| 10 | **Cross-entity invariants** ("the sum of all stock equals the sum of all receipts") and **scheduled rules** (`## Cadence` is prose; nothing fires monthly). | Management-system files document them for humans only. | A `## Invariants` section checked on every commit; a `management-system` trigger form on an injected clock. |
| 11 | **Read rules** are parsed and evaluated (conditions + authorization) but a `Read` produces no Change, so visibility filtering is *not* implemented by this module. | Use it for authorization checks only. | Appendix VII (encryption-based visibility) is the real answer. |
| 12 | **Deletion semantics.** `Delete` writes a Change with `after: null`; no cascade to referencing documents, no dangling-reference check. | Delete deliberately. | Additive `## Referenced by` / `on delete refuse`. |
| 14 | **Authority levels on one operation cannot be expressed — and the failure is silent.** `## Authorized by` belongs to the *file*, and §8 makes every rule on the same trigger conjunctive. So "a clerk may raise an order, above 10,000 € only the managing director" written as two files is not two branches: it is one operation nobody can perform, because whoever satisfies one rule's roles violates the other's. Nothing refuses to parse. The model reads correct and the threshold control is inert. Every value threshold in a real model has this shape. | Keep authority levels that share roles in **one** file, so one `## Authorized by` covers them (`clerk or director`, with the condition distinguishing the case) — this enforces the *condition* but not the *authority split*. Otherwise the control is documentation only, and must be labelled as such. `parse.js` emits a **warning** naming both rules, by file and line, in the two cases where the contradiction is provable: (a) two rules on one operation authorising roles with nothing in common, and (b) two rules on one operation whose conditions cannot both hold — the threshold shape (`amount <= 10000` here, `amount > 10000` there). A single rule that contradicts itself is warned about too. So the dead operation is never a silent surprise; it is named when the repo is opened. | **Ranked.** (1) **Per-rule `## Authorized by`** — smallest change, largest payoff: authority becomes a property of the rule, so different conditions carry different authority and the conjunction stops being a contradiction. Additive: a file-level section stays the default for rules that do not carry their own. (2) **Opt-in branching**, `then when <condition> … otherwise …`, which makes the alternative explicit in the text instead of implying it across files. (3) **`or` between conditions** (#2), which helps least here: it widens one rule's conditions but still cannot give the branches different authority. Note that (1) only reaches *role* separation; two *different people* signing remains #4, in the Truth Layer. |
| 13 | **Counters across different field names.** `with +quantity` always takes the trigger's field of the *same* name, so "add the receipt's `quantity` to the order's `delivered-quantity`" cannot be written. This bites hard, because limit 1 recommends maintained totals — and maintaining them needs exactly this. | Name the fields alike (`delivered-quantity` on both the receipt and the order), which is also clearer for a reader. | Additive: `Update order with +delivered-quantity from quantity`. This is the single most likely version-2 addition after enumerations. |

---

## 11. Tensions with the manifesto (honest register)

1. **Strict unknown sections vs. "write down your company as you would describe it"**
   (line 526). Refusing `## Approved by` is friction for an author who meant prose. We keep
   strictness because Principle 6 outranks convenience, and we soften it with a wide prose
   whitelist, `###` subheadings, free prose above the first section, and a "did you mean"
   suggestion in the message. *Exit path:* a one-line escape hatch (`## Notes: Approved by`) or
   an explicitly marked prose section in a later version.
2. **"Did you mean" is string similarity.** It appears **only** in diagnostic text for
   already-refused input; it never selects a meaning, never influences acceptance, and does not
   exist in the execution path (Appendix XII line 494 holds: no heuristics where decisions are
   made).
3. **Shared-field copying on `Create`** (§5.2) is a convention, and a convention is a small
   amount of hidden semantics. It is mitigated by being driven entirely by the two entity
   declarations (both files must declare the field), by refusing type mismatches loudly, and by
   being the only way the manifesto's "one word changed" demo can be true. *Exit path:* an
   explicit `## Copied from` mapping if the convention ever surprises anyone.
4. **`## Triggered by` is prose.** The manifesto shows it as a section in the executable file,
   but its content ("Arrival of a delivery at the location") is not a machine trigger. We keep
   it human, and the `If <op> <entity>` line is the truth. Anything else would require the
   parser to interpret free prose — an LLM in the execution chain, forbidden by line 494.

---
---

# Part II — grammar version 2

```
authorised-by: FD-5 (grammar v2 gains exactly what accounting requires, and nothing else)
              FD-1 (money is an exact decimal with its currency)
              FD-7 (default-deny, arrived at additively)
```

Version 2 exists for one reason: FD-4 rules that the general ledger is **modelled, not built
in**. A grammar that cannot say *debits equal credits* cannot describe a company, so the grammar
grows — by exactly seven constructions and one type discipline, and then stops.

**What version 2 does NOT add, and will refuse:** loops, user-defined functions, arithmetic
expressions, `if` inside a condition, string concatenation, sorting, `for each`, `average of`,
variables, imports, a second connective (`or` between conditions is still §10.2), aggregation
inside a consequent, and cross-scope references inside an aggregation's `where`. The moment this
grammar can compute an arbitrary expression we have rebuilt ABAP and lost the whole argument.
Every one of those is refused by name, with file, line, offending text and expectation.

### The additive-only promise, restated as a test

`test/c-polism.test.js` parses the real `operating-model/` and `templates/` trees and asserts
that every rule, entity, predicate, targeting plan and authority set is **byte-identical** to
what version 1 produced, and that the goods-receipt intent yields byte-identical `changes`.
A version-1 model executes identically under version 2. That is not a claim; it is test
`v1 compatibility — the real operating-model and templates trees parse to the same behaviour`.

---

## 12. `## Invariants` — conditions that must hold *after* the change

```ebnf
invariant-decl = ["-" | "*"] , invariant-name , ":" , condition-list ;
invariant-name = word , { " " , word } ;        (* must not contain the word "and" *)
```

`## Invariants` is declared on an entity, in `information/<entity>.md`, and nowhere else.

```
## Invariants
- debits equal credits: sum of debit over posting for this journal-entry = sum of credit over posting for this journal-entry
- has at least one posting: count of posting for this journal-entry > 0
```

Conditions use the full condition grammar of §4, evaluated against **a document of this
entity**, exactly like a predicate body (§2.2) — plus aggregation (§13), which is what makes
"as a set" expressible at all.

### 12.1 Scope: per commit, over what the commit touches or implicates (decision)

FD-5 left the scope open. It is **per commit**, and this is the only answer double-entry admits:
a journal entry's postings balance *as a set*, and the set is only complete inside the one atomic
commit that writes it (Appendix VIII: one business event ⇒ one commit).

Concretely, after every consequent has been applied and folded (§5.4), and before any change is
written:

1. A **staged world** is formed: the world as the read path sees it, with every staged change
   applied on top. Aggregations and conditions inside invariants read *that* world. So three
   postings created in one commit are all visible to the journal entry's invariant, and a
   posting created by a *consequent* is visible too — which is why an invariant violated by a
   consequent is caught (test: `an invariant violated by a consequent is caught`).
2. The set of **implicated documents** is computed from the staged changes:
   * a staged change to a document of `E` implicates that document, if `E` declares invariants;
   * a staged change to a document of `A` implicates the document of `E` named by its
     `for this E` reference field (§13.2), for every entity `E` whose invariants aggregate over
     `A`. Both the `before` and the `after` value of that reference field implicate, so moving a
     posting from one journal entry to another checks **both** entries.
   * The implication graph is read off the parsed invariants. It is never guessed, and it is
     computed at parse time, not at execution time.
3. Every invariant of every implicated document is evaluated against the staged world. A failure
   refuses the whole commit, quoting the invariant by name, text, file and line, and naming the
   document and the two values that did not match.
4. A document that the commit did not touch and did not implicate is **not** re-validated.

Why not the alternatives:

* **Per document** cannot express double-entry at all. No single posting balances.
* **Per entity set, on every commit** — re-checking every journal entry ever written — is
  unbounded work per commit (a ten-year ledger is millions of entries), and worse, it would
  refuse *your* commit because of a violation someone else introduced last March. An invariant
  is a **guard on change**, not a global consistency sweep. A sweep is a separate, offline,
  read-only audit — it belongs to the read path, not to the commit path.
* **Per document set named by the rule** would put the scope in the process file, where a second
  process could forget it. On the entity, it holds for every rule, forever, including rules
  written in 2031 by someone who never read the ledger design. That is what "structural" means.

### 12.2 Ordering and determinism

Implicated documents are visited in `entity`-then-`id` byte order; invariants within an entity in
declaration order. Every violated invariant is reported, not just the first (§8's rule, applied
here too). The result is identical on every peer.

### 12.3 What an invariant may not do

* It may not reference the intent, the actor, the operation, or any other document except through
  its own fields (one hop, §4.1) and through aggregation (§13).
* It may not have a consequent. An invariant refuses; it never repairs. Repair is a rule.
* An entity may not declare an invariant that aggregates over itself with `for this` (that would
  need a self-reference field and means nothing); this is refused at parse time.

---

## 13. Aggregation — `sum of` and `count of`

```ebnf
aggregate = "sum of "   , field-name  , " over " , entity-name , [ scope ] , [ filter ]
          | "count of " , entity-name , [ scope ] , [ filter ] ;
scope     = "for this " , entity-name ;
filter    = "where " , field-name , ( operator , value | "exists" | "not exists" ) ;
```

An aggregate is a **term**, not a condition: it stands where a value stands, on either side of a
comparison (§4), in a rule condition, in a predicate body, or in an invariant.

```
count of order-line for this order > 0
sum of net-amount over order-line for this order >= 1000.00 EUR
sum of debit over posting where account is "1200" = sum of credit over posting where account is "1200"
count of posting for this journal-entry where account exists > 1
```

* `sum of <field>` requires `<field>` to be declared `number` or `money` on the aggregated
  entity. Any other type is refused, naming the declaration. The aggregate's type **is** the
  field's type, so a money sum is money and only compares with money (§19).
* `count of` is always `number`.
* Empty set: `count of` is `0`; `sum of` a number field is `0`; `sum of` a money field is the
  **currency-free zero** (§19.3). Never `NaN`, never `null`, never a refusal. A trial balance
  over an account with no postings is zero, which is the correct accounting answer.
* Aggregation is not permitted in a consequent. `Update order with net-amount from sum of …` is
  refused: a maintained total written by a counter (§5, §17) and a derived total read by an
  aggregate are different designs, and mixing them silently would give two answers to one
  question. Named, refused, exit path recorded in §20.

### 13.1 `where` — exactly one condition, on a direct field, and why

FD-5 writes `where <condition>`, singular, and version 2 takes that literally: **one condition, on
a declared scalar field of the aggregated entity, compared with a literal — or `exists` /
`not exists`.** Nothing else. Not a list, not a named predicate, not a one-hop path, not a
field-to-field comparison.

That is a narrow rule and it is not narrow by accident. Three things fall out of it:

1. **It is unambiguous.** `and` is the condition separator of §3, so a `where` list would make
   `sum of a over b where c is "1" and quantity > 0` genuinely undecidable: the second condition
   could belong to the aggregate or to the rule, and there is no reading a parser may prefer
   without guessing (Principle 6). A bounded `where` ends after its value, always, so the rule's
   own `and` still means what it has always meant.
2. **It is fully index-answerable.** Every `where` compiles into one `Filter` and `for this`
   compiles into another (§13.3), so an aggregate is *never* a predicate the engine has to run
   over rows the index handed back. There is no residual and no hidden scan.
3. **Two criteria are still expressible**, because `for this <entity>` and `where` compose:
   `sum of debit over posting for this journal-entry where cancelled is false`. Between them they
   cover the trial balance, the VAT return, the order total and the journal-entry balance — the
   four things FD-5 asked for.

`for this` and `where` compose on **both sides** of one comparison, which is how the balance
invariant is written in one line:

```
- balanced: sum of amount over posting for this journal-entry where side is "debit"
          = sum of amount over posting for this journal-entry where side is "credit"
```

That sentence is the reason §12 and §13 exist, and it is pinned by a regression test: an earlier
`parse.js` scanned the rest of the condition for the word `this` and misread the legitimate
`for this` on the *right* as a misuse on the left, so the one-line form did not parse. A
where-condition is bounded (§13.1), so its value has exactly one position and there is nothing to
search for.

A `where` condition **cannot** see the document the aggregate is written on; `for this` is the only
link, and it links by reference. `sum of amount over posting where posted-on <= period-end` (with
`period-end` on the outer document) is refused at parse time, naming both entities. That is §20.1,
and it is deliberate: the alternative is correlated subqueries, and that is a programming language.
More than one criterion beyond `for this` is §20.8.

### 13.2 `for this <entity>` — the one link to the outer document

`for this journal-entry` restricts the aggregate to documents of the aggregated entity whose
reference to `journal-entry` points at **the document this condition is being evaluated on**.

* The aggregated entity must declare **exactly one** field of type `reference to <entity>`.
  Zero is refused ("add a `journal-entry: reference to journal-entry` field to `posting`");
  more than one is refused, listing them (the §5.1/§10.5 ambiguity, same rule, same message).
* The context entity of the condition must **be** `<entity>`. `for this order` inside an
  invariant on `journal-entry` is refused, naming both.
* Resolved at parse time into `{ step: 'scope', field }`. `execute.js` follows the plan; it never
  searches for a linking field.

Why a keyword and not the obvious `where journal-entry is journal-entry`: inside the `where`
scope, `journal-entry` resolves to *posting's own field* by §4.1 rule 1 — on both sides. That
sentence would silently be `x is x`, always true, which is a silent wrong calculation and
Principle 6's exact prohibition. `for this` cannot be misread.

### 13.3 The performance contract with the read path (decision)

FD-5 does not say how an aggregate is computed, and this is the entry most likely to hurt. The
contract is: **polism asks a question the index can answer; polism never scans on the index's
behalf, and polism always does the arithmetic itself.**

`World` gains two **optional** methods. A world that implements neither still works — that is
why version 1's two-method `World` (`get`, `find`) is unchanged and the kernel needs no edit.

```js
/** @typedef {{ field:string, op:'='|'!='|'>'|'>='|'<'|'<=', value:unknown }} Filter */

/** Optional. Documents of `entity` matching every Filter, or null = "I cannot answer that".
 *  Same shape as the `where` of runtime/read/query.js, so an index can use its own indexes. */
World.matching?(entity: string, filter: Filter[]): Doc[] | null

/** Optional. The aggregate itself, when the index can compute it without materialising rows.
 *  `spec.fieldType` is 'number' | 'money'. A money answer MUST be a canonical money string
 *  (FD-1); polism re-validates it and refuses a non-canonical answer rather than trusting it.
 *  Return null for "I cannot answer that" — including for money, if the index will not do
 *  exact decimal arithmetic. */
World.aggregate?(spec: { kind:'sum'|'count', entity:string, field:string|null,
                         fieldType:string|null, filter: Filter[] }): { value: string|number } | null
```

Resolution order, per aggregate, per evaluation: `aggregate()` → `matching()` → `find()`.

* **Every** part of an aggregate compiles into a `Filter` at parse time: the `where` condition
  (§13.1 is narrow precisely so that this is true) and the `for this E` link. So the common case
  `sum of debit over posting for this journal-entry` is one indexed equality lookup, and there is
  no residual predicate anywhere — nothing polism has to re-filter over rows the index returned.
* An aggregate with **no** `Filter` at all — no `for this`, no `where` — reads every document of
  that entity on every evaluation. `sum of debit over posting` is the whole ledger. That is worth
  knowing before it is worth measuring, so `parse.js` emits a **warning** naming the aggregate and
  the entity. It is a warning and not an error: a trial-balance total legitimately wants the lot.
* Candidates are sorted by `id`, byte ascending, before summing. BigInt addition is
  order-independent, but the sort makes the number path, the diagnostics and any future partial
  result identical on every peer regardless of the order the index hands rows back in.

`sum` is always computed by polism, from the field values, with §19's exact arithmetic — even
when it comes back through `matching()`. `World.aggregate()` is the one place an index may do the
addition, and its money answer is re-validated against FD-1's canonical form before it is used.

---

## 14. Branches — `then when … otherwise …`

```ebnf
consequent-block = consequent-list                            (* version 1, unchanged *)
                 | branch , { "otherwise" , branch } , [ "otherwise" , consequent-list ] ;
branch           = "when" , condition-list , [ authorized-clause ] , "then" , consequent-list ;
```

```
If Create purchase-order under condition
  net-amount > 0 and
  supplier exists
then
  when net-amount > 10000.00 EUR authorized by managing-director then
    Create purchase-order-approval with status "required"
  otherwise when net-amount > 1000.00 EUR authorized by purchasing-manager then
    Update supplier with +net-amount
  otherwise
    Update supplier with +net-amount
```

This is what closes §10.14 — the most consequential limit of version 1, where the sentences
parsed, the model read correct, and the threshold control was silently dead. It is now one rule,
one operation, three authority levels, and it works.

* `otherwise when` is not a third construction: it is `otherwise` followed by another `when`
  branch, i.e. the same two words nesting to the right. Two thresholds is the ordinary business
  case (5 000 € / 10 000 €), so refusing the second one would have been a limit invented for the
  parser's convenience.
* An arm without `when` is the **default arm** and must be last. An arm after it is refused.
* `then` inside an arm is required, not optional — it is what separates the arm's conditions from
  the arm's consequents, and guessing that boundary is not available to us.
* `## Authorized by` at file level, and an inline `authorized by` on the rule, still apply to the
  whole rule. An arm's inline `authorized by` overrides both, for that arm only (§16).

### 14.1 Evaluation order (decision)

**Written order. The first arm whose every condition holds wins. Exactly one arm runs.**

* Order is the order in the file, top to bottom. Not by specificity, not by number of conditions,
  not by anything the runtime infers. The author's reading order is the execution order — that is
  the whole point of a text a COO can audit.
* Arms are alternatives, so their conditions are **not** conjoined with each other. The
  satisfiability detector of §10.14 therefore compares conditions *within* the rule's
  `under condition` list and *within* one arm, never across arms — otherwise version 2 would warn
  about exactly the shape it just made legal.
* A condition inside an arm that cannot be evaluated (§4.5, a missing referenced document) does
  not silently fall through to the next arm: the arm does not match and *the reason is recorded*.
  If no arm matches, every arm's reason is reported.
* **No arm matches and there is no default arm** ⇒ the rule contributes no consequents, and the
  operation proceeds (the trigger's own change, plus other rules). It is *not* a refusal: the
  author wrote no `otherwise`, so the author asked for nothing, and inventing a refusal would be
  the runtime deciding a business question. But it must not be silent either, so `parse.js` emits
  a **warning** on any branch set without a default arm, naming the cases that fall through.
* An arm that can never be reached — its own conditions contradict each other, or an earlier arm's
  conditions are implied by its own (the classic mistake of ordering thresholds ascending, so the
  higher one never fires) — is a **warning** naming both arms by line. Only provable
  unreachability is reported, by the same conservative candidate-point method as §10.14, so there
  are no false alarms.

---

## 15. Enumerations — `one of`

```ebnf
field-type = ... | "one of " , enum-value , { ("," | " or ") , enum-value } ;
enum-value = slug | quoted-text ;
```

```
## Fields
- status: one of draft, posted, cancelled required
- vat-treatment: one of "standard", "reverse-charge", "oss", "exempt"
```

* The declared type is `enum`; its value set is the declared list, in declaration order.
* Comparison: only `is` / `is not` / `=` / `!=`. `>` and friends are refused — an enumeration is
  a set, not a scale, and `"draft" < "posted"` is alphabetical nonsense masquerading as workflow.
* **In the model text:** a literal compared with, or set on, an enum field must be one of the
  declared values, or it is refused *at parse time*, listing the values and naming the file that
  declares them. `status is "delivrd"` never reaches production.
* **In the data:** a `create` or `update` whose value for the field is not a declared value is
  refused at execution, quoting the declaration. So a foreign dialect (Appendix V) cannot inject
  `"delivrd"` either.
* An enum compares with a `text` field (same family), so a v1 model that declared
  `status: text` and later tightens it to `one of …` keeps every condition it had.
* Duplicate values in one declaration are refused. An empty list is refused.
* **Adding a value to an enum is additive** and changes nothing about existing values or rules
  (test: `adding a value to an enumeration is additive`). Removing one is not additive: it turns
  documents already written into refusals. The grammar cannot stop a business from doing that,
  but §0 means the grammar never does it to them.

---

## 16. Authority in three scopes, most specific wins (FD-7)

Version 1 had one scope: `## Authorized by` as a property of the **file**, applying to every rule
in it. That is kept, unchanged, forever. Version 2 adds two more.

```ebnf
authorized-clause = "authorized by" , role-name , { ("or" | ",") , role-name } ;
```

| Scope | Written as | Applies to |
|---|---|---|
| **arm** | `when … authorized by managing-director then …` (§14) | that one branch arm |
| **rule** | `If Create x … authorized by purchasing-manager then …` | that one rule |
| **file** | `## Authorized by` in the process file (version 1) | every rule in the file |
| **entity** | `## Authorized by` in `information/<entity>.md` | every operation on that entity that no rule covers |

The inline clause sits **immediately before the `then`** it belongs to — on a rule, after the
conditions; on an arm, after the arm's conditions. One position, always the same, so there is
nothing to remember. `authorised by` (British spelling) is accepted; so is `or` or `,` between
roles. `and` is still refused, still with §10.4's message: two signatures are a constraint on the
commit, not on one operation.

**Resolution: the most specific scope that exists wins, and only it.** arm → rule → file →
entity. Not the union (which would widen authority by accident), not the intersection (which
would produce §10.14's dead operation again). An arm that names `managing-director` means the
managing director, even though the file says `purchasing-manager` — that is the entire purpose.
Resolution happens at parse time and is stored on the AST as
`{ roles, scope: 'arm'|'rule'|'file'|'entity', source: {file, line} }`, so a refusal always
quotes the declaration that actually decided.

### 16.1 Entity scope, per operation

```
## Authorized by
- create: warehouse-clerk or warehouse-management
- update: warehouse-management
- delete: managing-director
- read: warehouse-clerk or warehouse-management or accountant
```

**Entity scope requires the `- <operation>: <roles>` form, and §0 is the reason.** A plain role
list in an `information/` file is *already valid version-1 text* — it is the file-scope
declaration of §6, and in a file with no `## Rules` it governs nothing. `operating-model/
information/stock-adjustment.md` contains exactly that today. Giving those words a new meaning
would change the behaviour of an existing model, which §0 forbids and FD-7 reserves for a major
version. So the new capability arrives in **new syntax**, which no version-1 model can contain:

* `- create: …` / `- read: …` / `- update: …` / `- delete: …` bullets ⇒ entity-scope authority for
  those operations. An operation not named has no entity-scope authority and falls through to
  "uncovered", below.
* a plain role list ⇒ version-1 file scope, unchanged. If the file has no `## Rules`, `parse.js`
  emits a **warning** saying so and naming the bullet form, because words that govern nothing are
  exactly what an author would assume govern something.
* The two forms may not be mixed in one section, so precedence inside one file is never a question.

Entity scope is **enforced whenever it is declared**, in every mode, strict or not: a declaration
that did nothing until someone turned on a flag would be a lie.

### 16.2 Coverage: the warning, and strict mode

> "Ask what happens when nothing applies." — Part 4, standing rule 4. The worst v0.1 defect was
> a permissive default that 213 tests never questioned.

An **uncovered** entity-operation pair is one where no rule that matches it has any effective
authority *and* the entity declares none. In version 1 that means anyone, with no role at all,
may perform it (§8, last paragraph). Version 2 does not change that default — flipping it would
change the meaning of existing models, which is a major-version act (FD-7, and agent C's
correction that produced it). Version 2 makes it **visible** and **switchable**:

* `parse.js` emits one `warning` per entity listing every uncovered operation, pointing at the
  entity's own file and naming both fixes (a rule with authority, or `## Authorized by` in the
  entity file). Coverage is therefore visible when the repository is opened, not when it is
  audited.
* `evaluate(model, intent, world, { authorization: 'strict' })` **refuses** an uncovered
  operation, whoever attempts it, naming the pair and the two fixes. The kernel owns this switch
  and FD-7 says it is default-on for new workspaces. Grammar version 2 does not decide when the
  kernel turns it on; it guarantees that turning it on cannot change the meaning of anything that
  *is* covered.

`{ authorization: 'strict' }` is passed in an **options** object that version 1 callers do not
pass at all. `evaluate(model, intent, world)` behaves exactly as it did in version 1.

---

## 17. `with <field> from <other-field>` — filling a field from another field

```
authorised-by: FD-5 item 6 (the counter form) and FD-5 item 9 (the set form, added 2026-08-03)
```

```ebnf
with-clause = "with" , ( field-name , value                          (* set a literal *)
                       | field-name                                  (* obligation *)
                       | field-name , "from" , source                 (* set from a field — item 9 *)
                       | ("+" | "-") , field-name , [ "from" , source ]  (* counter — item 6 *)
                       ) ;
source      = field-name | reference-field , "." , field-name ;       (* one hop, §17.1 *)
```

```
Update order   with +delivered-quantity from quantity
Update account with +balance           from debit
Create posting as "receivable" with account-number from chart.receivables-account-number
                               with ledger-account from chart.receivables-account
                               with amount         from invoice.gross-amount
                               with posting-date   from entry-date
```

Two forms, one word. `+field from x` **adds**; `field from x` **sets**. They share one parser and one
resolver, so a hop that works in the counter works in the set form and there is no asymmetry to
remember.

### 17.0 Why the set form is part of FD-5 rather than an extension of it

FD-5 items 1, 8 and 9 are **one sentence**: create the legs, fill the legs, check the total. Any two
of the three are worth nothing.

* Item 1 (invariants, §12) makes "debits equal credits" structural — but an invariant over a set is
  worthless if the grammar cannot create the set.
* Item 8 (labelled creates, §21) creates the set — but a leg with no account number, no amount and
  no date is not a posting.
* Item 9 fills it. A posting's account number comes from the chart of accounts, its amount from the
  invoice, its date from the entry. **None of those is a literal**, `with <field> <value>` cannot
  reach them, and the obligation form `with <field>` only copies a same-named field off the trigger.

So the set form closes the sentence. It adds no concept: `from` already existed for counters (item
6) and one-hop resolution already existed for conditions (§4.1). It is the smaller half of a
capability the grammar already had.

### 17.1 One hop, and exactly one

The source is `<field>` of the triggering document, or `<reference>.<field>` — the same resolution
§4.1 uses for a condition subject, and the same limit.

* A second hop (`invoice.customer.name`) is refused, naming §20.1. One hop is what a ledger needs;
  two is the correlated-path problem this grammar has already declined twice.
* A hop through a field that is not a `reference to …` is refused, naming what it is instead.
* **A `from` reads the stored VALUE, not the dereferenced document.** This matters and it is the one
  place §17 differs from §4.1: a *condition* on `chart.receivables-account` talks about the ledger
  account document, while `with ledger-account from chart.receivables-account` copies **the id** —
  which is exactly what a `reference to ledger-account` field holds. Both readings are useful and
  they are not the same reading, so they get different resolvers rather than one that guesses.
* Resolved at parse time into steps `execute.js` follows blindly. It never walks a path it worked
  out itself.

### 17.2 The type rule, checked from the declarations

A `from` whose types do not agree is a **parse error** naming *both* declarations by file and line —
the two lines that disagree, not the sentence that noticed.

| Source | Target | |
|---|---|---|
| same scalar type | same scalar type | allowed |
| `reference to E` | `reference to E` | allowed — the id is copied |
| `reference to E` | `reference to F` | refused, naming both entities |
| a reference | a plain value, or the reverse | refused: one points at another document and the other does not |
| `one of a, b` | `one of a, b, c` | allowed — every value the source can hold is a value the target allows |
| `one of a, b` | `one of b, c` | refused, listing the values that would not be allowed |
| `one of …` | `text` | allowed — an enumeration is text |
| `text` | `one of …` | **refused**: text could carry any value at all into a closed set, which is exactly what §15 exists to prevent |
| `money` | `number`, or the reverse | refused: an amount of money is not a count, and the runtime does not decide which currency a bare number is in (FD-1) |

### 17.3 At execution

* A **missing referenced document** is a refusal naming it. The model asserted a relationship that
  is not there; writing nothing would be a silent wrong calculation.
* An **empty value** at the far end writes nothing, and `required` is what refuses — which produces
  a better message (`"account-number" must be filled in on every posting`) than this clause could.
* Money into money uses §19's exact arithmetic. Nothing here touches a float.
* This is what removes the duplicate-field workaround of §10.13: `goods-receipt-fact` no longer
  needs a field named `delivered-quantity` whose only purpose was to let a counter reach `order`.

## 18. Periods — a locked period refuses a posting dated inside it

Two one-line declarations, one on each side. Both are `key: value` bullets, like every other
section.

On the period entity — `information/accounting-period.md`:

```
## Fields
- starts-on: date required
- ends-on: date required
- status: one of open, locked required

## Period
- from: starts-on
- to: ends-on
- locked when: status is "locked"
```

On the dated entity — `information/posting.md`:

```
## Fields
- posting-date: date required

## Dated in
- posting-date in accounting-period
```

Semantics, enforced by `execute.js` on every staged change before anything is written:

* For each staged `create`, `update` or `delete` of a document of an entity declaring
  `## Dated in`, take the value of the named date field. For an `update` take **both** the old
  and the new value, so moving a document out of a locked period is refused exactly as writing
  one into it is. For a `delete`, take the stored value.
* Find every document of the named period entity whose `from` ≤ date ≤ `to` (inclusive, ISO-8601
  lexicographic = chronological, §2.1). Evaluate its `locked when` condition — an ordinary §4
  condition list on the period entity, so a business defines "locked" however it wants
  (`status is "locked"`, or `closed-on exists`, or a predicate).
* If any matching period is locked, the **whole commit** is refused, naming the document, the
  date, the period document by id, and both declarations by file and line. Periods are examined
  in `id` byte order and the first locked one is reported, so the message is identical on every
  peer.
* A date in **no** period is allowed. Refusing it would make the first posting of a new company
  impossible and would be the runtime deciding a business question; a business that wants every
  posting inside a declared period writes `count of accounting-period …` as an invariant.
* Overlapping periods are not an error. If any of them is locked, the posting is refused — the
  strict reading, and the only one that cannot be gamed by declaring a second period.

**Correction is a new entry, never a mutation** falls out of this rather than being bolted on:
the original document is dated in the locked period, so nothing can change it and nothing can
delete it. The correcting entry carries a date inside an open period and is an ordinary create.
The original stays byte-identical, which is what GoBD Unveränderbarkeit means and what an auditor
will check.

### 18.1 Why a period is an entity, and not a declaration (decision)

FD-5 leaves this open; FD-4 settles it. If a period were a line in a configuration file, then
closing a month would be a file edit: no authority, no signature, no audit trail, no `git log`
entry naming who closed 2027-03 and when, and no way for a rule to say who may reopen it. All
four of those are exactly what an auditor asks about a period close, and all four come free the
moment a period is an ordinary document: `## Authorized by` governs who may lock it (§16), the
commit is signed, the trail is the repository, and reopening is a visible `update`.

It also keeps the grammar honest. A built-in period concept would be finance semantics inside the
parser — the one thing §2 and FD-4 forbid. `parse.js` knows the words `from`, `to`, `locked
when`, `in`, and nothing about months, fiscal years, or the German commercial code.

### 18.2 No clock, and none needed

Periods need a date; the date is a **field of the document being written**, so nothing in this
section reads a clock. There is no `Date.now()`, no injected `now`, and no dependence on when
the commit happens to be made — the same document produces the same refusal in 2027 and in 2045.
Comparing against *today* (`best-before < today + 30 days`) remains §10.8, unimplemented, and if
it ever lands the clock is injected, never read.

---

## 19. Money is exact, or it is refused (FD-1)

> One `parseFloat` on a monetary value is a release blocker. — FD-1

In version 1, `money` was "a plain number" (§2.1, §10.7). That was the second of the three
findings that reorganised the roadmap: JSON numbers are IEEE 754 doubles, so 19 % VAT on 4 999.99
evaluated to 949.9981. Version 2 gives `money` its own arithmetic.

* **Stored form**: one string token, `"4999.99 EUR"` — optional `-`, digits, `.`, exactly the
  minor-unit digits ISO 4217 gives that currency, a single space, the alphabetic code. FD-1's
  canonical form, byte-exact in `git show`, self-describing to an auditor.
* **Internally**: `BigInt` minor units, in `runtime/polism/money.js`. No `Number`, no
  `parseFloat`, no `Math`, no float ever touches a monetary value, in the parser or the
  interpreter. Comparisons, counters (`+field`), `from` counters and `sum of` all go through it.
* **Mixed currencies do not add and do not compare.** `10.00 EUR` against `10.00 USD` is a
  refusal naming both currencies and both documents, never a conversion. Conversion is a modelled
  act carrying its rate and date, because that is what an auditor must be able to see.
* A money value that is not in canonical form is refused where it is read, quoting the value and
  the field declaration — not coerced, not rounded, not repaired.

### 19.1 Money literals in the model text

```
net-amount > 1000.00 EUR
Create invoice with vat-amount "0.00 EUR"
```

Two tokens (`1000.00 EUR`) or one quoted token (`"1000.00 EUR"`); both mean the same thing and
canonical form is checked at parse time, naming the required number of decimals for that
currency. `1000 EUR` is refused where EUR demands two decimals — a refusal at parse time is worth
more than a rounding rule at run time.

### 19.2 A bare number against a money field keeps its version-1 meaning

§0 is absolute: a construction that was valid in version 1 means the same thing in version 2.
Real version-1 models contain `payable-amount > 0`, `net-amount > 0`, `value > 0`. Those are
valid version-1 conditions and they keep working.

* A bare number literal compared with a `money` field compares against the **magnitude** of the
  value, in the value's own currency, exactly — the literal is scaled to the value's minor units
  using its source text, never `Number`.
* Zero is currency-free, so `> 0`, `>= 0`, `= 0`, `!= 0` are exactly right and get no comment.
* A **non-zero** bare number against a money field earns a `warning`: it names no currency, so it
  compares the same against 1 000 EUR and 1 000 JPY. The warning says how to write it
  (`1000.00 EUR`). It is a warning and not an error because §0 does not permit it to be an error.

### 19.3 Zero is the only currency-free money value

`sum of` over an empty set has no currency to report. It is the currency-free zero, and that
makes `sum` a total function:

* currency-free zero **equals** any currency's zero, and orders against any currency's amount by
  magnitude. So an account with no postings has a zero balance in every currency at once, which
  is the accounting answer.
* adding a currency-free zero to `100.00 EUR` gives `100.00 EUR` — it adopts the currency rather
  than refusing, because nothing about zero contradicts EUR.
* It is never *written* to a document: a `+field` counter that starts from nothing writes the
  canonical zero of the currency it is adding, and if there is nothing to add it writes nothing.

### 19.4 Where the arithmetic lives

**All arithmetic is agent M's `runtime/money/`.** There is exactly one exact-decimal
implementation in this runtime and `runtime/polism/money.js` is not it — it imports it.
The seam adds only the two things the *grammar* needs and a general money module correctly
declines to decide:

1. **Diagnostics instead of exceptions.** polism never throws; an unreadable amount becomes a
   refusal quoting the field declaration (Principle 6). `runtime/money/` throws `MoneyError`,
   which is right for its callers and wrong for a parser.
2. **The currency-free zero** (§19.3). `runtime/money/`'s `sum([])` refuses to guess a currency,
   which is correct. But the grammar needs `sum of` to be a *total* function, so the zero that
   belongs to every currency at once is defined here, in the grammar's layer, where it is the
   grammar's decision and can be read next to the sentence it serves.

---

## 20. Known limits of version 2

§10 stands, minus what version 2 resolved. Resolved: **#1** (aggregation, §13), **#9**
(enumerations, §15), **#10** (invariants and cross-entity conditions, §12 — scheduled rules are
*not* resolved), **#13** (cross-name counters, §17), **#14** (authority levels on one operation,
§14 + §16), and the money half of **#7** (§19; units on a quantity are not resolved). Still open,
unchanged: #2 `or`, #3 multi-hop paths, #4 true four-eyes (a Truth-Layer signature constraint,
not a grammar one), #5 disambiguating two references, #6 cascading, #8 date arithmetic, #11
visibility filtering, #12 deletion semantics.

New to version 2:

| # | Missing | Consequence for authors | Exit path |
|---|---|---|---|
| 20.1 | **Correlated aggregation.** A `where` cannot see the document the aggregate is written on; `for this <entity>` is the only link, and it links by reference only. "Sum the postings dated before *this* entry's date" cannot be written. | Denormalise the outer value onto the aggregated entity (postings already carry their own date), or express the restriction as a literal. | Additive `where <field> is this <field>` — one more form of the same `this`, resolved at parse time. It is deliberately not in version 2: it is the doorway to a subquery language, and it should not be opened for one convenience. |
| 20.2 | **No aggregation in a consequent.** `Update order with net-amount from sum of order-line …` is refused. | Maintain the total with a counter (§17), or read the aggregate in a condition and let the report derive it. | Additive, and it needs an answer to "when is the total recomputed" first — which is the cascade question (§7), not an arithmetic one. |
| 20.3 | **Invariants are not swept.** A document nobody touches is never re-validated, so an invariant introduced *after* data exists does not refuse the data that already violates it. | Run the sweep as a report on the read path; it is a query, and it is a legitimate one. | An offline `verify` over the whole index, in the read path, reported and never silently repaired. It belongs there and not in the commit path (§12.1). |
| 20.4 | **`sum of` and `count of` only.** No `average`, `min`, `max`, `first`, `last`, or `sum of` an expression. | An average is a ratio of two aggregates, which a report computes; the grammar does not need it to describe a company. | Additive per aggregate function, one at a time, each with a reason. `average` in particular needs a rounding declaration (FD-1) before it can mean anything exact. |
| 20.5 | **A branch arm cannot fall through on purpose.** Exactly one arm runs; there is no `and also`, and there is no place to put consequents that should happen whichever arm fires. | Repeat the shared consequents in every arm, or write a second rule on the same trigger — both rules apply (§8), and the second one carries the unconditional part. | Additive: a consequent list before the first `when`, running unconditionally. Small and safe, and the ledger does not need it, so version 2 does not have it. |
| 20.6 | **Enum values are not shared.** Two entities with the same status vocabulary declare it twice, and nothing checks that they agree. | Declare it twice; a mismatch is visible in the two files. | Additive `status: one of <named set>` with the set declared once — but that is a new kind of declaration, and version 2 does not add kinds of declarations for tidiness. |
| 20.8 | **One `where` condition per aggregate** (§13.1), on a direct field, compared with a literal. No `and`, no predicate, no one-hop path. | `for this <entity>` plus one `where` is two criteria, which covers the trial balance, the VAT return, the order total and the journal-entry balance. Beyond that, denormalise: put the criterion on the aggregated entity as its own field. | Additive, and it needs a *terminator word* first so that `and` stays unambiguous (§13.1 reason 1). Something like `where … , then` would work and reads badly; a declared predicate on the aggregated entity reads well and needs the index contract to admit a residual. Neither is worth doing for the ledger, so neither is in version 2. |
| 20.7 | **A period governs one date field per entity per period kind.** A document with a service date and an invoice date needs two `## Dated in` bullets, and they are independent. | Write both bullets. | Nothing needed; this is a limit only in the sense that it is not clever. |

---

## 21. `Create <entity> as "<label>"` — several documents of one entity from one rule

```
authorised-by: FD-5 item 8, added 2026-08-03
```

```ebnf
consequent = "Create" , entity-name , [ "as" , label ] , { with-clause } ;
label      = '"' , slug , '"' ;        (* the same slug rule as a file basename *)
```

```
If Create journal-entry under condition entry-number exists then
  Create posting as "receivable" with side "debit"  with account-number from chart and
  Create posting as "revenue"    with side "credit" with account-number from vat-treatment and
  Create posting as "output-vat" with side "credit" with account-number from vat-treatment
```

### 21.1 Why this belongs to FD-5 rather than extending it

Double-entry bookkeeping creates two or more postings from one event — that is what *double*
means. §12 mandates invariants so that debits equal credits, but **an invariant over a set is
worthless if the grammar cannot create the set.** Without a label every created document takes the
trigger's id (§5.2) and the second collides with the first; and the postings cannot be accumulated
one at a time either, because §12.1 checks the entry's invariant on every posting that implicates
it and a single posting never balances. FD-4's ledger was therefore not awkward to express but
*impossible*, and FD-5 items 1 and 8 are one decision.

This is the whole of it. It adds no concept: no counter, no expression, no iteration. `Create` was
always "make one document, with an id derived from the trigger"; the label says *which* one.

### 21.2 The id

`Create posting as "receivable"` on a trigger with id `JE-0042` produces `posting/JE-0042-receivable`.

* **Deterministic**: a pure function of the trigger's id and the text the company wrote. No
  counter, no clock, no randomness (contract non-negotiable #5), so two peers handed the same
  event produce byte-identical ids.
* **Readable in `git log`.** The kernel writes one `NeoDonkey-Change:` trailer per change,
  carrying the id, so the trailer reads `create posting JE-0042-receivable`. That is a real audit
  property: *"posting JE-0042-receivable"* tells a Wirtschaftsprüfer which leg of the entry a
  document is, and *"posting JE-0042-2"* does not.
* The label is a **lower-case slug**, the same rule as a file basename (§1.2), because an id is a
  path segment (`documents/posting/JE-0042-receivable.json`) and must stay one. `as "Receivable
  Leg"` and `as "receivable/1"` are refused.
* An unlabelled `Create` keeps version 1's meaning exactly: the trigger's id, unchanged.

### 21.3 A label makes a child, and a child says whose child it is

A field of the target declared `reference to <trigger entity>` is set to the trigger's id.

This is not a convenience. `sum of debit over posting for this journal-entry` finds the set through
that reference (§13.2); if the legs did not carry it, the aggregate would sum over **nothing**, the
balance invariant would pass, and an unbalanced entry would commit. That is precisely the silent
wrong calculation Principle 6 exists to prevent, so the link is structural.

* Declaration-driven, exactly like §5.1 mechanism 1 — the parser reads the two entity files and
  never guesses a field name. Resolved at parse time and stored on the AST.
* **Exactly one** such field must exist. Two is the §10.5 ambiguity and is refused at parse time,
  listing both. Zero is fine: an entity that does not name its parent simply does not get a link.
* It is set before the `with` clauses, so a rule that states the reference itself still wins.
* **Only on a labelled create**, for two reasons. An unlabelled create takes the trigger's own id,
  so a back-reference would be a document pointing at its own id, which means nothing. And filling
  it there would change what an existing version-1 model does, which §0 forbids.

### 21.4 Duplicate labels are a parse error

Two `Create <entity>` steps in one arm with the same label — or both with no label — would need the
same id. That is refused **at parse time**, naming both lines: the model is wrong however the data
turns out, and a refusal when the repository is opened is worth more than one when the first
journal entry is posted.

**Per arm, deliberately.** Branch arms are alternatives and exactly one of them runs (§14.1), so
two arms may each create a `"receivable"` leg — which is the ordinary shape of a ledger rule, where
a sales entry and a purchase entry both have a receivable. A collision *inside* one arm is the
error case.

### 21.5 Timing, unchanged

Every leg is staged before any invariant runs, so §12.1 holds as written: all postings from one
rule land in the one commit, and the balance is checked **once** against the staged world — not
once per posting. An unbalanced set therefore produces one violation naming both totals of the
finished set, rather than a complaint about the first leg.

### 21.6 What this does not become

`as` names one new document. It is not a loop, not a list comprehension, and not a variable: the
number of documents a rule creates is the number of `Create` steps written in it, countable by
eye. `Create posting as "receivable" for each line` does not exist and is refused. If a business
needs one posting per order line, that is one rule per line triggered by the line — which is what
the existing grammar already says, and what §7 keeps predictable.
