# NeoDonkey Marketing Strategy: Reddit

## Target Subreddits

### Primary (High Relevance)
- r/selfhosted — "I built an ERP that runs entirely in your browser, no server needed"
- r/homelab — "Headless ERP that runs locally, zero cloud dependency"
- r/opensource — "NeoDonkey: EUPL-1.2 licensed headless ERP"
- r/programming — "Git is the database: how we built an ERP with zero dependencies"
- r/webdev — "A headless ERP built with vanilla ES modules and Web Crypto API"

### Secondary (Audience Match)
- r/sysadmin — "Replacing SAP with a git repository"
- r/smallbusiness — "The hidden costs of ERP and how to avoid them"
- r/europe — "Digital sovereignty: an ERP that belongs to Europeans"
- r/Entrepreneur — "Why I built an ERP to compete with SAP"
- r/datahoarder — "Your company's data in a folder you control"

### Tertiary (Occasional)
- r/rust, r/golang, r/python — "Why we chose vanilla JS for an ERP"
- r/antiwork (careful) — "Your ERP vendor is extracting rent from your company"
- r/technology — "Headless ERP: the next wave of enterprise software"

---

## Post Templates

### r/selfhosted
**Title:** "NeoDonkey — A headless ERP that runs entirely in your browser. No server, no cloud, no Docker container. Just a git repository."

**Body:**
```
I've been building NeoDonkey, a headless ERP that takes "self-hosted" to the 
extreme: there is no server to host.

- The runtime is your browser (vanilla ES modules, zero dependencies)
- The database is a git repository in your browser's Origin Private File System
- Login generates Ed25519 keys locally — never uploaded
- Every business transaction is a cryptographically signed commit
- EUPL-1.2 licensed

Demo: https://neodonkey.github.io/ (no signup, works offline after first load)
Source: https://github.com/NeoDonkey/NeoDonkey-ERP

We're at v0.1, so it's not production-ready for sensitive data yet. But the 
architecture is designed to scale. Would love feedback from the self-hosting 
community on the approach.
```

### r/programming
**Title:** "We built an ERP with zero npm dependencies. Here's why."

**Body:**
```
NeoDonkey is a headless ERP built entirely with vanilla ES modules. No React, 
no Vue, no build step, no node_modules.

Instead, we built against web standards:
- Web Crypto API for Ed25519 key generation and signing
- Origin Private File System for persistent storage
- CompressionStream for git packfile compression
- FileSystemDirectoryHandle for file access

The result: software that couples to web standards and nothing else. When 
browsers update, we get faster for free. When a framework dies, we don't care.

GitHub: https://github.com/NeoDonkey/NeoDonkey-ERP

Curious what r/programming thinks of the zero-dependency constraint as an 
architectural choice. Too extreme? Or the only way to build software that lasts?
```

### r/opensource
**Title:** "NeoDonkey: A headless ERP under EUPL-1.2 — because software sovereignty matters"

**Body:**
```
We chose EUPL-1.2 (European Union Public License) for NeoDonkey because it's 
legally compatible with GPL, explicitly covers network use, and — crucially — 
it's European.

In an era where:
- US cloud vendors can terminate accounts arbitrarily
- Data residency requirements are tightening (GDPR, EU AI Act)
- Companies are realizing they've lost control of their own data

...we wanted a license that reflects our values: software that belongs to its 
users, not its vendors.

NeoDonkey is a headless ERP with no server, no cloud, and no vendor lock-in. 
Your company lives in a git repository in your browser.

Source: https://github.com/NeoDonkey/NeoDonkey-ERP
License: https://github.com/NeoDonkey/NeoDonkey-ERP/blob/main/LICENSE

Would love to hear from the open source community about license choices for 
infrastructure software. Why did you choose your license?
```

---

## Engagement Rules

### DO
- Read subreddit rules before posting
- Engage genuinely in comments (not just promotional)
- Share technical details and answer questions thoroughly
- Acknowledge limitations honestly (v0.1 status)
- Cross-reference relevant discussions

### DON'T
- Spam multiple subreddits simultaneously
- Use clickbait titles that don't deliver
- Ignore critical comments — engage constructively
- Post without participating in the community first
- Use alt accounts to upvote

---

## Comment Response Templates

**"This is just a spreadsheet with extra steps"**
> "Fair critique! The difference is auditability and structure. Every transaction is a signed git commit, so you have a cryptographically verifiable history. Plus, the operating model (business rules) lives in the same repo as the data, so you can trace any number back to the exact rule that generated it. Try the demo and let me know if it feels spreadsheet-y."

**"How do multiple users work?"**
> "Great question. Right now it's single-user, but the git architecture makes multi-user straightforward: each user has their own branch, changes are merged. We're exploring WebRTC for real-time sync and git remotes for centralized coordination. It's early days, and we'd love technical contributors on this problem."

**"What about backups?"**
> "Since it's a git repo, backups are trivial: git push to any remote (GitHub, GitLab, your own server), copy to USB, rsync to NAS. The entire system — data, history, and code — fits in a folder. Compare to traditional ERP where extracting your data costs €40K."

---

## Success Metrics
- Upvotes and comments per post
- GitHub stars from Reddit referral (track via UTM or GitHub traffic)
- Website visits from Reddit
- Quality of feedback (bug reports, feature requests)
- Community members joining Discord/forum

---

*Created: 2026-08-18*  
*Status: Ready for execution*
