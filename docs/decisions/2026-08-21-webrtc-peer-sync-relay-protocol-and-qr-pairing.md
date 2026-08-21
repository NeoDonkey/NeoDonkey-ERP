# Decision Record: WebRTC Peer-to-Peer Sync, Zero-Knowledge Relay Protocol, and QR Code Introduction

**Date:** 2026-08-21

## Question
How should NeoDonkey model real-time peer-to-peer workspace synchronization across browser tabs and devices, out-of-band QR code peer pairing, zero-knowledge WebSocket relay signaling, and encrypted channel multiplexing in compliance with `docs/ROADMAP-V1.md` Wave 2 & Gate Condition 4 ("Two real machines sync")?

## Answer

1. **Out-of-Band Peer Introduction via QR Code:**
   - Two peers establish an initial secure association by generating and scanning an out-of-band QR code carrying a high-entropy secret token (`shared-secret`) and a derived blind mailbox identifier (`mailbox-id = SHA-256("neodonkey-mailbox-v1:" + shared-secret)`).
   - No company data, peer identity keys, or business objects are encoded in the QR code payload; the QR payload is ephemeral and serves solely to establish a mutual rendezvous point on the relay.

2. **Zero-Knowledge WebSocket Relay Protocol (`relay.mjs`):**
   - The signaling relay operates as a untrusted blind transport layer.
   - Clients connect to the relay via WebSocket using the path `/mailbox/<mailbox-id>/<role>` (where `<role>` is either `initiator` or `responder`).
   - The relay NEVER inspects, parses, or decodes payload bytes; it forwards raw binary frames strictly between the two paired endpoints attached to the same `mailbox-id`.
   - The relay imposes no custom messaging verbs, stores no long-term peer state, and disconnects any client attempting text frame transmission or unauthorized mailbox path navigation.

3. **End-to-End Encrypted Handshake (PeerLink / HKDF / X25519 / AES-GCM):**
   - Signaling messages (WebRTC SDP offers/answers and ICE candidate trickle frames) transmitted over the relay MUST be sealed end-to-end using Noise-like ephemeral key exchange (X25519) and HKDF SHA-256 key derivation (`runtime/sync/crypto.js`).
   - Every wire frame is authenticated and encrypted using AES-256-GCM (`crypto.subtle.encrypt`), binding direction labels (`initiator->responder` / `responder->initiator`) to prevent frame replay, injection, or reflection attacks.
   - The relay sees only opaque ciphertext frames; compromise or logging of the relay server yields zero plaintext signaling or accounting data.

4. **WebRTC DataChannel Peer Connection Adaptation & Multiplexing:**
   - Once WebRTC signaling completes, peers transition transport from the WebSocket relay to a direct peer-to-peer RTCDataChannel connection (`runtime/sync/webrtc.js`).
   - Channel multiplexing (`runtime/sync/mux.js`) encapsulates logical communication streams (such as signed commit object exchange, head state assertions, and live vector clock sync) over designated channel IDs.
   - Messages arriving prior to channel handler attachment or peer readiness are queued in memory without data loss.

## Source
- **Primary Source (W3C WebRTC 1.0):** W3C WebSockets and WebRTC 1.0 Real-time Communication Between Browsers Specification, §5 (Peer-to-peer connections) & §6 (RTCDataChannel).
- **Primary Source (IETF RFCs):**
  - IETF RFC 8831: *WebRTC Data Channels*.
  - IETF RFC 8832: *WebRTC Data Channel Establishment Protocol (DCEP)*.
  - IETF RFC 7748: *Elliptic Curves for Security (X25519)*.
  - IETF RFC 5869: *HMAC-based Extract-and-Expand Key Derivation Function (HKDF)*.
- **Primary Source (NeoDonkey Architecture):** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 4: "Two real machines sync") & Part 3 (Wave 2).

## Verification Method
- **Unit & Integration Test Verification:** Evaluated by the suite in `test/webrtc-sync.test.js` and `test/relay-security.test.js`:
  1. Asserts QR code mailbox derivation is deterministic and blind (`sha256`).
  2. Asserts WebSocket relay forwards binary frames between initiator and responder without parsing payloads.
  3. Asserts sealed wire frames prevent forgery, replay, and reflection across encrypted sessions.
  4. Asserts WebRTC DataChannel connection adaptation and multiplexed channel message delivery succeed without data loss.

## What Must Land First

Filing the issue specifications below as open GitHub issues (e.g., by a maintainer or a session with GitHub issue creation privileges) MUST land first before implementation can be claimed. An engineering session requires an open GitHub issue number `#N` to claim implementation via `Closes #N` in a draft pull request per AGENTS.md §5. The specifications below define the exact scope, primary sources, constraints, labels, and verification methods for those issues.

## Unblocked Implementable Issue Specifications

### Issue 1: `feat(sync): adapt WebRTC DataChannel transport and QR mailbox session handshake`
- **Title:** Adapt WebRTC DataChannel transport and QR code mailbox session handshake
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 4: "Two real machines sync") and Part 3 (Wave 2: WebRTC Sync & QR Introduction)
- **Primary Source Citation:** W3C WebRTC 1.0 §6 (RTCDataChannel) & IETF RFC 8831 / RFC 8832
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:sync`, `p1`
- **Verification Method:** Integration test in `test/webrtc-channel-adaptation.test.js` sets up two mock RTCPeerConnections, exchanges offer/answer/ICE candidates, and asserts:
  1. DataChannels open with correct reliability settings (`ordered: true`).
  2. Out-of-band QR secret token derives matching `mailbox-id` on both peers.
  3. Messages sent over DataChannel arrive intact with exact payload byte fidelity.
  4. Connection timeouts or channel failures produce descriptive error events rather than hanging promises.

### Issue 2: `feat(sync): implement zero-knowledge WebSocket relay multiplexing and E2EE frame forwarding`
- **Title:** Implement zero-knowledge WebSocket relay multiplexing and end-to-end encrypted frame forwarding
- **Roadmap Line:** `docs/ROADMAP-V1.md` Part 2 (Gate Condition 4: "Two real machines sync") and Part 3 (Wave 2: Relay)
- **Primary Source Citation:** IETF RFC 7748 (X25519), RFC 5869 (HKDF), & W3C WebSocket API
- **Constraints:** Zero dependencies, no build step, `node:*` only in `runtime/git/fs-node.js` and tests, no `Date.now()` or `Math.random()` in core logic, no business vocabulary in `runtime/`, no float in any monetary path.
- **Labels:** `ready`, `area:sync`, `p1`
- **Verification Method:** Integration test in `test/relay-e2ee-multiplex.test.js` boots local `relay.mjs` server, connects initiator and responder clients, and asserts:
  1. Text frames sent to relay trigger immediate client disconnection.
  2. Binary frames forwarded through relay remain encrypted with AES-256-GCM.
  3. Tampered ciphertext frames fail authentication (`unseal`) on the receiving peer.
  4. Channel multiplexer routes distinct logical stream IDs without cross-channel interference.
