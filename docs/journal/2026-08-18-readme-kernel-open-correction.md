# README kernel.open() claim corrected

**Closes #20.**

## What changed

Two mentions in `README.md` falsely stated that `kernel.open()` cannot be handed an encryption
key. The register entry #5 (rewritten 2026-08-04) and `test/kernel-crypto.test.js` both confirm
the opposite: `kernel.open({ encryption, vault, sealed })` accepts the key pair and the full
Appendix VII path works through it.

The residual gap is narrower than what the README described: the browser UI, the MCP server and
the demo do not pass an encryption key, and a browser peer has nowhere durable to keep an X25519
pair. Both mentions were rephrased to match.

## What was verified

- `npm test`: 672 tests, 670 pass, 2 skipped, 0 failures. No new test was needed because the
  claim is factual correction against existing evidence, not a behaviour change.
- The corrected text was cross-checked against `docs/COMPROMISES.md` entry #5 (lines 558-593)
  which states the precise residual gap.
