# NeoDonkey

**The ERP that belongs to you. And to Europe.**

Write down your company as you would describe it. That is your ERP.

---

## What this is

An ERP with no server, no cloud, no vendor, and no dependencies. Your company lives in a folder.
The folder is a Git repository. Every business fact in it is a cryptographically signed commit.
The software that runs it lives in the same folder and executes in your browser.

There is nothing to install. There is nothing to migrate. There is nothing to cancel.

Built against [the manifesto](neodonkey-manifesto.md), which is the constitution this code
answers to — and against [docs/ROADMAP-V1.md](docs/ROADMAP-V1.md), which records every foundation
decision and why.

> ## ⚠ Status: publishable, **not** production
>
> These are two different bars and we say which one we are at. See
> [docs/READINESS.md](docs/READINESS.md) for the three tiers and
> [docs/COMPROMISES.md](docs/COMPROMISES.md) for every open item with an owner.
>
> **Closed since v0.1**, each verified rather than asserted: operations no rule governs are now
> refused (an actor with no roles can do nothing the model does not grant); a caller's roles are the
> intersection of what it claims and what the repository records, so `actorRoles` is no longer a
> self-declaration; the general ledger posts double-entry with the balance as a structural
> invariant; and two processes have converged through a relay and recovered a company after one was
> destroyed.
>
> **Still open, and each is a reason not to run a company here yet:**
>
> 1. **No release key is published** (#15). The signing and pinning machinery is built and tested,
>    but there is no `release.json` and no published fingerprint — deliberately, because shipping a
>    development key would train people to pin a throwaway. Until a real key exists *and its
>    fingerprint is published somewhere that is not the origin*, the origin is trusted in practice.
> 2. **Encryption is proven at the layer, not yet through the front door** (#5). Group keys, DEKs
>    and GDPR erasure by cryptographic shredding all work and are tested against real `git fsck` —
>    but `kernel.open()` cannot yet be handed an encryption key, so a company using the ordinary API
>    cannot reach them. **Until that lands: no HR data and no customer PII.**
> 3. **A first entry cannot be posted.** There are no opening balances, no supplier credit notes, no
>    refund month, no fixed assets or depreciation, no accruals. That is bookkeeping work, not
>    architecture, and it is what stands between this and a real company's first week.
> 4. **No browser has run the WebRTC path**, and nothing renders or scans the QR code that
>    introduces a peer (#4). Peer sync is proven between two processes, which is not two machines.

## Try it

```bash
node demo/sarah.mjs            # Appendix X: Sarah's first weekend, end to end
npm test                       # the full suite — 664 tests, about 30 seconds
npm run ui                     # then open http://localhost:8080
```

The demo builds a company, books a goods receipt through the company's own written rules, has
the company refuse an invalid one, changes the business by editing a sentence — and then hands
the folder to **real `git` and real `ssh-keygen`** and asks them what they think.

Their answer is the whole point:

```
git fsck --strict          → clean
git status --porcelain     → empty      (it is simply a folder)
git log --show-signature   → G          (good signature, on every commit)
```

`G` is git's own verdict. Software written by other people over twenty years, which has never
heard of us, accepts our commits as genuine and verifies our signatures. We did not ask anyone to
trust a format we invented. **We write the format the world already verifies.**

## Why that matters more than any feature

An average SAP S/4HANA upgrade costs a mid-market company two to five million euros and takes
twelve to eighteen months. That cost is not technical — it is the price of a format only one
vendor can read.

NeoDonkey's exit path is `cd` into the folder. Your data is never hostage. That is the only
honest form of sovereignty: structural, not contractual.

## How it works

```
your-company/
├── index.html              ← the app shell. served, not double-clicked (see below)
├── runtime/                ← the software, readable, in the repo, next to the data
├── operating-model/        ← your company, as text. this IS the program.
│   ├── processes/          ← goods-receipt.md, invoice-issuance.md …
│   ├── organisation/       ← the roles and who may authorize what
│   ├── locations/  information/  suppliers/  management-system/
├── documents/              ← the facts: articles, orders, invoices, stock
└── .git/                   ← the truth: signed, append-only, yours
```

**The operating model is the software.** A process is a page of text — prose at the top for
humans, rules below for the runtime:

```
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

A supply chain manager who wants batch tracking adds two words — `with batch-number` — and from
the next delivery on, the system requires one. No ticket, no sprint, no consultant, no release.
There is no translation layer between the business and the software, which is why there is no
place for technical debt to accumulate.

When a rule refuses something, it says which sentence refused it, by file and line. When a
posting is made, the commit records the rule that authorized it — inside the signed payload. No
traditional ERP audit trail can link a booking to the written sentence that caused it.

## Nobody can change your software without your key

The runtime is delivered as an installable web app, from any origin — `neodonkey.eu`, your own
`erp.firma.de`, or the always-on peer you already rent. Every path is relative and there is no
build step, so self-hosting is a file copy.

That would normally hand the host enormous power: it serves executable code onto a machine holding
your signing key and your books. So the code is signed, and **the signing key is pinned on your
machine at first install.** Afterwards your installation refuses any runtime not signed by that
key — including one served by us, and including one served by us under a court order. The origin
becomes a postal service rather than an authority.

You can check a release with OpenSSH alone, no NeoDonkey involved:

```bash
ssh-keygen -Y verify -f allowed_signers -I release@neodonkey.eu \
           -n neodonkey-release -s release.sig < release.canonical
# → Good "neodonkey-release" signature
```

Updates are offered, never applied. Appendix I's promise is that the accountant runs version 2
while the warehouse still runs version 1 and both exchange the same facts — so an update that
installs itself is a bug, not a convenience.

**The honest limit:** the *first* install is trust on first use. No cryptography fixes that; only
publishing the fingerprint where an attacker cannot reach every copy does. The app shows you the
fingerprint and asks, rather than pinning silently and calling it security.

## The stack, on a beermat

**Git** for the data. **The browser** for the runtime. **Web standards** for everything else.

Zero dependencies. Not "few" — zero. There is no `dependencies` field in `package.json` and there
never will be one in the core. Everything is written against `crypto.subtle`,
`CompressionStream`, `TextEncoder` and `FileSystemDirectoryHandle`: standards owned by nobody,
stable for decades, only ever extended.

We couple to web standards and to nothing below them. If Apple changes notarization, if Windows
moves to ARM, if a Linux distribution tightens its policies — none of it reaches us.

## What v0.1 does not do

Read [docs/COMPROMISES.md](docs/COMPROMISES.md). It is not an appendix, it is a commitment.

Briefly: encryption exists and is proven but is not reachable from `kernel.open()` yet, so **no HR
data and no customer PII**; a company's opening balance cannot be posted; no browser has run the
WebRTC path and nothing renders the peer-introduction QR code; no DATEV export and no dialects; and
the runtime is JavaScript rather than WebAssembly — a decision, recorded as FD-8, not an omission.
Each entry names the principle it bends, why, what is lost, who owns it, and the exit path.

One claim we had to retract: **you cannot double-click `index.html`.** A browser refuses to load ES
modules from a `file://` URL, and OPFS, persistent storage and WebAuthn all need a secure context.
Appendix X described something the web platform does not permit. So the runtime is delivered as an
installable web app instead, from any origin including your own — and `Start NeoDonkey.command`
(or `.bat`, or `start-neodonkey.sh`) is one double-click for running the source you are holding.

99% is the goal. 100% is a lie. A system that admits its imperfection stays honest,
maintainable, and yours.

## Documentation

| | |
|---|---|
| [neodonkey-manifesto.md](neodonkey-manifesto.md) | The constitution. Eleven principles, twelve appendices. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How v0.1 implements it, and the decisions made on the way. |
| [docs/COMPROMISES.md](docs/COMPROMISES.md) | Every place reality bent a principle. With owners. |
| [docs/CONTRACT.md](docs/CONTRACT.md) | Module interfaces — the seams that make dependencies removable. |
| [runtime/polism/grammar.md](runtime/polism/grammar.md) | The normative rule grammar. Additive-only, forever. |

---

*A donkey is not glamorous. It is patient, reliable, carries the load, does not need much, and
lives long. This is what we are building.*

Licensed under the EUPL-1.2.
