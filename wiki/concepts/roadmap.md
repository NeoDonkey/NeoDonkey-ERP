---
type: Reference
title: Project Roadmap
description: Long-term roadmap, milestones, and outstanding backlog items for NeoDonkey-ERP MVP.
status: stable
generated: { by: human:danielfrommunich, at: 2026-03-01T12:00:00Z }
verified: { by: human:danielfrommunich, at: 2026-03-01T12:00:00Z }
---

# NeoDonkey-ERP Project Roadmap

This roadmap tracks our outstanding MVP milestones and future features as specified by the **NeoDonkey Manifesto**. AI agents on scheduled sessions should tackle these in order unless specific handover instructions override them.

---

## Outstanding MVP Milestones

### Phase 1: Two File Formats & Git Storage Layer
*   **Goal:** Implement the physical storage foundation (Manifesto Principle 4 & Appendix III).
*   **Subtasks:**
    - [ ] Define the exact file structure and JSON formats for *documents* (invoices, orders, delivery notes, products, employees) and *transactions*.
    - [ ] Create a validator script or library to enforce document and transaction schemas.
    - [ ] Build a Git commits helper/wrapper that automates signing and committing transactions as Merkle DAG nodes.

### Phase 2: The Browser-as-Runtime Skeleton
*   **Goal:** Establish the OS-independent runtime running inside the browser sandbox (Manifesto Principle 3 & Appendix II).
*   **Subtasks:**
    - [ ] Create a foundational `index.html` loading a mock/placeholder WebAssembly or TypeScript-based sandboxed engine.
    - [ ] Provide basic routing and state-management that operates strictly offline-first.

### Phase 3: The Live Layer & CRDT Sync
*   **Goal:** Implement fast, real-time collaboration that bypasses Git write overhead for in-progress work (Manifesto Appendix III).
*   **Subtasks:**
    - [ ] Define the local IndexedDB schema for caching the Live Layer operations.
    - [ ] Implement/prototype our custom narrow-set CRDT primitives:
        *   G-Counter / PN-Counter for stock quantities.
        *   LWW-Register (Last-Writer-Wins with Hybrid Logical Clock) for document fields.
        *   OR-Set (Observed-Remove-Set) for arrays.
        *   Multi-Value-Register for explicit conflict handling in the UI.

### Phase 4: The POLISM Minimal Operating Model Parser
*   **Goal:** Execute the operating model description directly as running code (Manifesto Principle 11 & Appendix XII).
*   **Subtasks:**
    - [ ] Implement a lightweight parser that reads the If-Then rules written in plain-text inside `operating-model/` folders.
    - [ ] Build a rule validation and execution engine (~500 lines) that intercepts commits to check preconditions before allowing a write.
    - [ ] Seede sample POLISM configurations for a "Goods Receipt" process.

### Phase 5: The Read Path View Materializer
*   **Goal:** Make Git data searchable and queryable in sub-milliseconds (Manifesto Appendix VI).
*   **Subtasks:**
    - [ ] Configure SQLite or DuckDB compiled to WebAssembly.
    - [ ] Create a sync daemon that reads the Git commit transaction log and incrementally populates local SQL tables.
    - [ ] Implement basic SQL query interfaces via an MCP (Model Context Protocol) server.

---

## Future Capabilities (V1.1+)
*   **The Vault (Secrets & Encryption):** End-to-end encrypted repositories with group-based keys using native WebCrypto (AES-GCM, ECDH Curve25519) (Appendix IV & VII).
*   **The Dialect Pattern:** Dynamic, translation-based integration rules for Shopify, DATEV, and Salesforce as individual WASM files (Appendix V).
*   **Qualified Signatures:** eIDAS 2.0 EU citizen wallet integration (Appendix IX).
