# Proposed Amendment 1 to the Manifesto

**Status:** draft for the author's decision. **Not applied.** The manifesto is the constitution;
the CTO does not edit it. This file is a proposal.

**Raised by:** implementation of v0.1. **Date:** 2026-08-03.

---

## Why an amendment is needed rather than a compromise entry

The manifesto's closing note says that when implementation reality forces a compromise, "the
manifesto stays intact — the compromise is documented separately." That is the right rule for a
principle we fall short of. It is the wrong rule here, because Appendix X does not describe an
ambition we missed. **It describes a mechanism the web platform does not permit.**

Concretely, from Appendix X (lines 316, 328) and Appendix II (line 75):

> "She goes to `neodonkey.eu`, clicks 'Get started', downloads a folder… She double-clicks the
> HTML, her browser opens NeoDonkey."
> "the repo is cloned, an `index.html` in the repo is opened — the browser loads the WASM module
> into its sandbox and executes it."

Three facts, established empirically during the build:

1. **ES module scripts are blocked by CORS from `file://`.** A browser refuses to load
   `runtime/kernel.js` from a double-clicked HTML file. This is not a bug or a Chrome quirk to
   route around; it is the module security model.
2. **OPFS and the File System Access API require a secure context.** So does persistent storage.
   The APIs the architecture depends on for storage are unavailable at `file://`.
3. **WebAuthn requires an origin.** This one matters most: passkeys are the only path to Appendix
   IV's requirement that the private key live in the OS keychain behind Touch ID. `file://` can
   never satisfy Appendix IV — the folder model forecloses the manifesto's own security goal.

There is a second, independent reason, and it came from the founder rather than the code:
**downloading a zip and double-clicking a file is a poor way to start an ERP.** Both objections
point the same direction.

The manifesto's deeper commitments are untouched. "No installer, no admin rights, nothing written
into the OS" (Appendix II line 75) all still hold — a PWA install writes nothing outside the
browser profile and needs no admin rights. "Uninstall means: delete folder" becomes "remove the app
and delete the folder". What changes is only *how the code reaches the machine*.

## The danger this amendment must not introduce

A PWA is served from an origin, and that origin serves executable code onto a machine holding the
user's signing key and their company's books. An auto-updating PWA from `neodonkey.eu` would mean
the data is local but the *executable is rented* — the exact structure Principle 9 exists to
abolish, wearing our own branding. "We promise not to push bad code" is a contract, and Principle 9
says sovereignty must be structural, not contractual.

So the amendment is only sound together with four properties, which v0.1 implements:

1. **Origin-independent.** Every path relative; no build step; no configuration. The same files run
   from `neodonkey.eu`, from `erp.firma.de/neodonkey/`, or from `localhost`. Self-hosting is
   ordinary. Note this falls out of Appendix X already: the €3/month always-on peer a company
   rents can serve the PWA to its own devices.
2. **Signed runtime, user-pinned key.** Each release is a manifest of file hashes signed with
   Ed25519 (SSHSIG, namespace `neodonkey-release`). The key is pinned at first install; a manifest
   signed by any other key is refused. A compromised — or legally compelled — origin cannot push
   code to an existing installation.
3. **Consented updates.** A new version is offered with its version and fingerprint, never applied
   silently. This is Appendix I's promise kept: the accountant runs v2 while the warehouse runs v1.
4. **Data stays where it was.** `showDirectoryPicker()` remains, so the company is still a folder a
   human can `cd` into and run `git log` in.

**Residual risk, to be stated in the manifesto and not only in the code:** first install is trust
on first use. A compromised origin on the very first visit is undetectable by cryptography alone.
Only out-of-band publication of the release fingerprint mitigates it. This belongs in the text
because Appendix I's honesty about broken cryptography sets the standard.

---

## Proposed replacement text

### Appendix X, Day 1 — replace lines 316

> **Day 1 — Sarah installs NeoDonkey.** She goes to `neodonkey.eu` — or to `erp.ihrefirma.de`, or
> to whatever address her IT provider gave her; it is the same application from any of them. Her
> browser offers "Install". One click, and NeoDonkey has its own icon and its own window. From that
> moment it never needs that website again: it runs entirely offline, and would keep running if
> `neodonkey.eu` disappeared tomorrow.
>
> No account, no email verification, no credit card, no admin rights. Nothing is written into the
> operating system.
>
> On first launch it asks two things. Her name — she types *Sarah Weber*. And where her company
> should live — she picks a folder, `sarah-erp/`, on her disk. In the background the client
> generates an Ed25519 key pair: the private key stays in the browser's key store, unexportable and
> bound to this origin, and never leaves the machine; the public key goes into the repo. She is now
> "Sarah Weber" in the NeoDonkey universe, and everything she does from here is signed.
>
> It also shows her something no other business application shows her: the fingerprint of the key
> that signed the software she just installed. She can compare it against the fingerprint published
> in the repository, in the press release, and on paper at any NeoDonkey event. If they match, the
> code running on her laptop is the code that was published — and from now on her installation will
> refuse any update not signed by that same key. She does not have to trust `neodonkey.eu`. She
> checked.

### Appendix II — replace lines 73-75

> **The answer: the code lives in the Git repo, verified, and executed in the browser.**
>
> Concretely: the runtime is a set of modules that live next to the data in the same repo. They are
> delivered as a Progressive Web App — installed once from any origin that hosts them, then run
> from the browser's own cache, offline, forever. No installer, no admin rights, no registry
> entries, no system-tray agent. Nothing is written into the OS.
>
> Delivery from an origin introduces the one dependency this whole document exists to prevent:
> whoever serves the code could change it. So the code is signed, and the signing key is pinned on
> the user's machine at first install. An installation refuses any runtime not signed by the key it
> already trusts. **The origin becomes a postal service rather than an authority** — replaceable,
> self-hostable, and unable to change what it delivers. This is the same move made for the data
> layer: trust signatures, not transport.
>
> The honestly acknowledged limit: the *first* install is trust on first use. A compromised origin
> at that single moment cannot be detected by cryptography. It is detected by publishing the release
> fingerprint where an attacker cannot reach every copy — the repository, print, conferences, other
> people's machines.

### Appendix II, add to the "Why that is powerful beyond portability" list

> - **The vendor cannot reach in.** Not "does not", cannot. An update must be signed by the key the
>   user pinned, or it is refused. There is no channel by which we can silently change what runs on
>   a customer's machine — which means there is no channel a court order, an acquirer, or an
>   attacker who compromises us can use either.

### Principle 2 — suggested clarification, not replacement

Principle 2 says "Serverless. Cloudless." A static host serving signed, self-hostable, verified
code is not a server in the sense the principle rejects: it stores no company data, decides nothing,
and holds no authority. Consider adding the sentence Appendix X already uses about the relay:

> A host that serves signed code the user has pinned is a postal transit station, not a server. It
> sees nothing, decides nothing, and is replaceable by any other host — including one of your own.

---

## What this amendment does not change

Every principle stands. Principle 3's stack is unchanged (the Service Worker is a web standard).
Principle 6 is strengthened, since a signed manifest is one more thing a future version cannot
silently break. Principle 9 is strengthened, because sovereignty moves from "we host nothing" —
which was never quite true, since Appendix X already rents a peer — to "nobody, including us, can
change your software without your key." That is a stronger claim and a checkable one.
