# Specify WebRTC Peer Sync, Zero-Knowledge Relay Protocol, and QR Code Introduction

**Date:** 2026-08-21

## What changed and why

1. **Selected Job:** `SPECIFY` per `AGENTS.md` §5 & §6.
   - Checked queue status: 2 unclaimed `ready` open issues (#84, #44) were present in the backlog (< 3 unclaimed ready issues), routing this session to SPECIFY per `AGENTS.md` §6.

2. **Claimed Topic & Created Decision Record:**
   - Topic: WebRTC Peer Sync, Zero-Knowledge Relay Protocol, and QR Code Introduction under Wave 2 / Gate Condition 4 ("Two real machines sync").
   - Added decision record `docs/decisions/2026-08-21-webrtc-peer-sync-relay-protocol-and-qr-pairing.md`.
   - Cites primary specifications: W3C WebSockets and WebRTC 1.0 §5 & §6, IETF RFC 8831 (WebRTC Data Channels), RFC 8832 (DCEP), RFC 7748 (X25519), and RFC 5869 (HKDF).
   - Establishes rules for blind QR code mailbox derivation, zero-knowledge WebSocket relay message forwarding, Noise/HKDF/X25519/AES-GCM end-to-end encrypted session establishment, and DataChannel stream multiplexing.
   - Includes a `## What Must Land First` section clarifying that filing the issue specifications as open GitHub issues MUST land first before implementation can be claimed via `Closes #N`.

3. **Decomposed Implementable Issues:**
   - Issue 1: `feat(sync): adapt WebRTC DataChannel transport and QR mailbox session handshake`
   - Issue 2: `feat(sync): implement zero-knowledge WebSocket relay multiplexing and E2EE frame forwarding`

4. **Plan Stability:**
   - Left `docs/NEXT.md` unchanged as the roadmap plan was unchanged, avoiding merge conflicts with concurrent sessions per `AGENTS.md` §9.

## Verification

- `read_file` verification confirmed exact structure, section headers matching `/##\s+(Why|Source)/i`, primary citations, constraints, and verification steps.
- Running `npm test` verified that all 682 tests in the suite pass cleanly with zero failures.
