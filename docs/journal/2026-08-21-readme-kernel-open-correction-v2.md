# README kernel.open() claim corrected (second attempt)

**Closes #20. Supersedes #73.**

## What changed

Two mentions in `README.md` falsely stated that `kernel.open()` cannot be handed an encryption
key. Register entry #5 (rewritten 2026-08-04) and `test/kernel-crypto.test.js` both confirm the
opposite: `kernel.open({ encryption, vault, sealed })` accepts the key pair and the full
Appendix VII path works through it.

The residual gap is narrower than what the README described: the browser UI, the MCP server and
the demo do not pass an encryption key, and a browser peer has nowhere durable to keep an X25519
pair. Both mentions were rephrased to match.

PR #73 carried this correction but went stale:conflicting while parked. This change re-applies
the same correction onto current main, verbatim in substance.

## What was verified

- Factual correction against existing evidence (`test/kernel-crypto.test.js`, register #5); no
  behaviour change, so no new test. Suite run on the branch before publish.
