# NeoDonkey Marketing Strategy: Hacker News Launch

## Launch Post Strategy

### Primary Launch: "Show HN"
**Title:** "Show HN: NeoDonkey – A headless ERP that runs in your browser, no server needed"

**Body:**
```
NeoDonkey is a headless ERP with no server, no cloud, and no vendor. Your 
company lives in a git repository in your browser. Every business fact is a 
cryptographically signed commit.

Key differences from traditional ERP:
- Zero dependencies in the core (vanilla ES modules, no framework)
- Git IS the database (not backed by git — git is the system of record)
- Ed25519 key pairs generated locally, never uploaded
- Plain markdown operating models (business rules as readable text)
- EUPL-1.2 licensed, runs entirely client-side

Try it: https://neodonkey.github.io/ (10-second demo, no signup)
Source: https://github.com/NeoDonkey/NeoDonkey-ERP

We're at v0.1 — honest about limits. Not ready for HR data or PII yet, but 
ready to run. Looking for technical feedback and contributions.
```

### Secondary Launch: "Ask HN"
**Title:** "Ask HN: Why does every ERP eventually become hostageware?"

**Body:**
```
I've been thinking about this after watching a friend's company get quoted 
€180K just for a SAP migration assessment.

Every major ERP seems to follow the same pattern:
1. Sell you an "integrated solution"
2. Lock your data in proprietary formats
3. Force expensive upgrades every few years
4. Charge you to access your own data

We're building an alternative (NeoDonkey — headless, git-based, browser-native),
but I'm curious: why is this the default? Is it technical, economic, or 
structural? What would it take to actually change?
```

---

## Timing Strategy

### Best Days/Times for HN
- **Tuesday or Wednesday, 8:00-10:00 AM PST** (peak HN traffic)
- Avoid: Monday (catch-up day), Friday (weekend lull), weekends
- Post during US morning for maximum visibility

### Launch Sequence
1. **T-7 days:** Submit "Ask HN" to gauge interest and collect feedback
2. **T-3 days:** Engage heavily in comments, refine messaging
3. **T-0:** Submit "Show HN" with refined pitch
4. **T+1 day:** Continue engagement, reply to every comment
5. **T+3 days:** Follow-up post if initial performs well

---

## Comment Engagement Strategy

### Common HN Objections & Responses

**"This is just a toy, not a real ERP"**
> "You're right that v0.1 is limited. We're explicit about that. But the architecture — git as database, cryptographic signatures, zero dependencies — is designed to scale. We'd rather start small and correct than promise everything and deliver SAP complexity. What specific functionality would you need to consider this for a real use case?"

**"How is this different from Odoo/ERPNext?"**
> "Great question. Odoo and ERPNext are excellent open-source ERPs, but they still require servers, databases, and ongoing maintenance. NeoDonkey removes even that layer — the runtime is your browser, the database is git, and there's nothing to host or scale. Think of it as 'serverless open-source ERP.'"

**"Browser-based ERP is insecure"**
> "Counter-intuitive, but local-first can be *more* secure than cloud. Your data never leaves your machine unless you choose to sync it. Login uses non-extractable Ed25519 keys — no passwords to steal, no central database to breach. Compare to cloud ERP where a single compromised admin account exposes everything."

**"What about collaboration? Multiple users?"**
> "Git solves this elegantly. Multiple users, multiple branches, merge conflicts resolved through the same workflows developers use daily. We're working on real-time sync via WebRTC and optional git remotes. Would love technical feedback on this approach."

**"This will never replace SAP for enterprises"**
> "Agreed — and we're not trying to. NeoDonkey targets SMEs (50-500 employees) who are paying €30K-€200K/year for ERP they don't fully control. For a 500-person manufacturer, the choice isn't 'SAP or NeoDonkey' — it's '€2M SAP upgrade or €0 NeoDonkey that handles 80% of needs.'"

---

## Post-Launch Content

### Week 1: Technical Deep Dives
- "How we implemented git in the browser using OPFS"
- "Why Ed25519 signatures replace access control tables"
- "The zero-dependency constraint: how we built an ERP with no npm packages"

### Week 2: Architecture Explained
- "Git as a database: benefits and trade-offs"
- "Local-first AI: running a quantized model on WebGPU"
- "The markdown operating model: business rules as readable text"

### Week 3: Comparisons & Use Cases
- "NeoDonkey vs. SAP Business One: a TCO analysis"
- "Migrating from Excel to git-based ERP: a 20-person company's story"
- "Why we chose EUPL-1.2 over MIT or GPL"

---

## Success Metrics
- Upvotes on launch post (target: 100+ for front page)
- Comments (target: 50+ engaged comments)
- GitHub stars from HN referral (track via GitHub traffic)
- Website visits from HN (check referrers)
- Sign-ups/demo opens (if we add analytics)

---

## HN Bio/Profile
- Set up HN profile with NeoDonkey link
- Participate in relevant discussions before launch (build karma)
- Follow tags: ERP, SaaS, open source, local-first, git

---

*Created: 2026-08-18*  
*Status: Ready for launch sequence*
