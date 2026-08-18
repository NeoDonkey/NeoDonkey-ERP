ID: ac1b9dcb-1c28-416f-b0c7-8b73a0c3ce8a
Title: NeoDonkey ERP: The Architecture of Structural Sovereignty
Content:
### **Thread 1: The Multi-Million Euro Hostage Crisis (Focus: Data Lock-In & 
Upgrades)**

1/ **An average SAP S/4HANA upgrade costs a mid-market company two to five 
million euros and takes twelve to eighteen months [1].** Why is the price tag so
absurd? Because it's not a technical cost—it's a ransom fee for a format only 
one vendor can read [1]. **Your ERP is hostageware.** 🧵

2/ Every piece of software you run should serve your business, not hold your 
data hostage. Traditional ERP vendors lock your ledger inside proprietary 
databases, enterprise cloud tenants, and artificial subscription schemas [2]. 
The moment you want to leave, you realize you can't [3].

3/ True sovereignty is structural, not contractual [3]. That is why **NeoDonkey 
ERP** has a radical architectural design: **no database, no cloud, no servers, 
and zero vendor lock-in [4].** Your entire enterprise lives inside a single flat
folder on your machine [4, 5]. 

4/ How? **Git is the database [5].** Every invoice, stock change, and business 
transaction is written directly to local files as an atomic, cryptographically 
signed commit [4]. Want to migrate or back up? Your exit path is literally to 
`cd` into your folder and copy it [3, 6]. 

5/ Developers, look at the package config: **there is no `dependencies` field in
`package.json`, and there never will be in the core [7].** It is written purely 
against native browser standards like `crypto.subtle`, `CompressionStream`, and 
`FileSystemDirectoryHandle` [7]. It couples to web standards and nothing else 
[7].

6/ Right now, NeoDonkey is in a publishable **v0.1 state**—we are honest that 
it's not ready for HR data or customer PII yet [8, 9]. But you can try the demo 
in **10 seconds** directly in your browser with zero installs or accounts [5, 
10]. 

7/ **Stop letting vendors own your ledger.** Try the NeoDonkey demo or inspect 
our EUPL-1.2 licensed repository on GitHub to see how we write the data format 
the world already verifies [1, 11]: **[Link]**

---

### **Thread 2: The Myth of the Permissions Table (Focus: Cryptographic 
Security)**

1/ **Traditional ERP security is fundamentally broken.** 99% of enterprise 
systems rely on "access control tables" hosted on a vendor's centralized server 
[2, 12]. If a cloud admin, a rogue employee, or a hacker modifies that table, 
your security is gone. **Your ERP is hostageware.** 🧵

2/ When you run on a vendor's cloud server, you have zero structural authority 
[2]. They can price you up, lock you out, or get subpoenaed—meaning your 
business logic and data are at the mercy of their hosting provider [2]. 

3/ **NeoDonkey ERP** replaces vulnerable database permissions tables with raw 
math [12]. When you log in, your browser instantly generates a non-extractable 
**Ed25519 key pair** [2, 5]. The private half stays on your machine and never 
leaves your browser [5].

4/ Authority is verified mathematically through **cryptographic commit 
signatures**, not a row in a database table [12]. Nobody—not even the NeoDonkey 
creators under a court order—can alter your software or access your ledger 
without your unique signature [13, 14].

5/ To make it even better, we built a **local-first AI copilot that runs 
entirely on your own GPU** using WebGPU [5, 15]. It reads your repository 
local-first and builds interfaces on the fly without ever sending a single API 
request or token to an external server [6, 15].

6/ A zero-server, zero-dependency, open-source ERP designed to grant you 
**complete structural sovereignty [4, 5].** Run it locally, back it up on a USB 
stick, and actually own your company's records [6]. Try the v0.1 runtime in 10 
seconds or check the EUPL-1.2 source [8, 11]: **[Link]**

---

### **Thread 3: The Death of Technical Debt (Focus: Plain-Text Operating 
Models)**

1/ **The average ERP implementation is a multi-year black hole [1].** The moment
your business workflow changes, you must hire consultants to translate standard 
English rules into thousands of lines of proprietary code [16]. **Your ERP is 
hostageware.** 🧵

2/ This translation layer is where technical debt goes to breed [16]. Business 
managers understand the operations but can't read the code, and engineers 
understand the code but don't run the business [16].

3/ **NeoDonkey ERP deletes the translation layer completely [16].** In our 
architecture, **the operating model *is* the software [16].** Your company’s 
processes are written in plain markdown prose—text at the top for humans, and 
normative rules at the bottom for the browser runtime [16, 17].

4/ It looks like this:
```markdown
If Create goods-receipt under condition
  quantity > 0 and order exists
then
  Create goods-receipt-fact and Update stock
```
If a manager wants to require a batch number, they add two words: `with 
batch-number` [16]. **No consultants, no sprints, no releases [16].**

5/ Because the plain-text operating model lives in the same Git folder as your 
data, **every financial transaction is cryptographically linked to the exact 
line of markdown that authorized it [3, 13].** No traditional audit trail can do
that.

6/ Built under the EUPL-1.2 license, NeoDonkey couples strictly to enduring web 
standards [7, 11]. We are currently at **v0.1 (not ready for production, but 
ready to run)** [8]. Stop renting your operating model. Try the demo in your 
browser in 10 seconds flat [5]: **[Link]**

---

📊 I can turn these thread concepts into a **tailored, publication-ready 
report** analyzing the structural vulnerabilities of traditional multi-tenant 
SaaS ERPs versus local-first, git-based architectures to help back up your 
CTO-facing collateral.
