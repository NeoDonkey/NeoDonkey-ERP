---
type: Reference
title: System Architecture
description: Core technical design principles, layers, and tech stack details of NeoDonkey-ERP.
status: stable
generated: { by: human:danielfrommunich, at: 2026-03-01T12:00:00Z }
verified: { by: human:danielfrommunich, at: 2026-03-01T12:00:00Z }
---

# NeoDonkey-ERP System Architecture

This document provides a technical overview of the NeoDonkey architecture, written to orient autonomous agents quickly.

---

## 1. The Beermat Tech Stack

We utilize only three core ingredients—all open, decades old, and belonging to no one:
1.  **Git:** Used directly as the distributed, append-only, cryptographically verifiable database for all authoritative business facts.
2.  **WebAssembly (WASM):** Used as the high-performance, OS-independent runtime execution environment.
3.  **The Browser Sandbox:** Used as the execution context and UI renderer, eliminating custom OS-level installation or configuration.

---

## 2. The Two-Layer Architecture

To reconcile instant, real-time collaboration with permanent, auditable business records, NeoDonkey splits state into two cleanly separated layers:

### Layer 1: The Live Layer
*   **Purpose:** Handles fast, second-by-second collaboration (e.g., co-editing a draft invoice, updating stock counts).
*   **Tech:** CRDT-based operational logs residing entirely in the browser's memory and buffered locally in IndexedDB.
*   **Sync:** Propagated directly over WebRTC or local LAN gossip protocol.
*   **Git Impact:** Completely bypasses Git. Operations are cheap, transient, and do not create Git noise.

### Layer 2: The Truth Layer
*   **Purpose:** Stores permanent, legally binding, and cryptographically signed business facts (e.g., finalizing an invoice, closing a month, completing a shipment).
*   **Tech:** Signed Git commits.
*   **Execution:** Batched or triggered on demand. When an event is finalized, the Live Layer state is snapshotted, signed with the user's private Ed25519 key, and committed.

---

## 3. Storage Format: Two File Formats

All ERP data lives as text in the repository:
1.  **Documents:** Structured data representing entity definitions (JSON or YAML files describing articles, invoices, customers, employees).
2.  **Transactions:** Git commits themselves representing the ledger of creation, modification, linkage, or archiving.

---

## 4. The Read Path (SQLite/DuckDB in WASM)

While Git is optimized for absolute write-correctness, it is inefficient for complex multi-dimensional queries.
*   We use **SQLite or DuckDB compiled to WASM** as local materialized view indexes.
*   Each peer's local index is continuously and incrementally populated by parsing the decrypted Git transaction log.
*   The SQLite/DuckDB index is a *view*—it can be entirely deleted and rebuilt from Git at any moment.
