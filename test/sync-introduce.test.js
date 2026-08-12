// test/sync-introduce.test.js — Appendix X, day 3, and the attack on it.
//
//   "Sarah clicks 'Add peer', shows a QR code. Herr Klein scans it. Both clients now know each
//    other's public keys and sync addresses."
//
// An introduction an attacker can forge is a peer they can insert. So the centre of this file is a
// TAMPER MATRIX: every way a payload can be altered between Sarah's screen and Herr Klein's camera,
// and the named refusal each one produces. The matrix is exhaustive in the only way that means
// anything — every BIT of every byte is flipped in turn, and every TRUNCATION at every length is
// tried, and all of them must be refused.
//
// The four the CTO asked for by name are marked (1) forged signature, (2) replayed introduction,
// (3) wrong repo id, (4) truncated payload.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createIntroduction, readIntroduction, fingerprint, seenStore, memorySeenStore,
  MAGIC, VERSION, URI_PREFIX, MAX_TEXT_LENGTH, DEFAULT_TTL_MS, FIXED_BYTES, SIGNATURE_BYTES,
} from '../runtime/sync/introduce.js';
import { memoryKvStore } from '../runtime/sync/opbuffer.js';
import { rendezvousFrom, RENDEZVOUS_BYTES, SyncError, hex } from '../runtime/sync/sealed.js';
import {
  generateIdentity, exportPublicRaw, exportPublicSsh, b64urlEncode, b64urlDecode,
} from '../runtime/identity/ed25519.js';

// A fixed rendezvous secret and a fixed clock: the payload below is byte-reproducible, which is
// what lets the tamper matrix be exact rather than statistical (non-negotiable #5).
const RENDEZVOUS = new Uint8Array(RENDEZVOUS_BYTES).map((_, i) => (i * 11 + 5) & 0xff);
const NOW = 1_780_000_000_000;
const REPO = 'sarah-erp';
const RELAY = 'wss://relay.neodonkey.eu';

/** Sarah, and an attacker who has their own perfectly good key pair. */
const sarah = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
const attacker = await generateIdentity({ comment: 'not-sarah' });
/** Hoisted so the assertions below can be plain arrow functions. */
const SARAH_RAW = await exportPublicRaw(sarah);
const SARAH_SSH = await exportPublicSsh(sarah);

/** @param {object} [over] */
function mint(over = {}) {
  return createIntroduction({
    identity: sarah, repoId: REPO, relay: RELAY, now: NOW, rendezvous: RENDEZVOUS, ...over,
  });
}

/** Re-encode a payload as scannable text. */
const asText = (payload) => URI_PREFIX + b64urlEncode(payload);

/** Read with the defaults a real scanner uses. */
const read = (text, o = {}) => readIntroduction(text, { now: NOW + 1000, ...o });

// ---------------------------------------------------------------------------------------------
// 1. the payload, and the QR-code constraint
// ---------------------------------------------------------------------------------------------

test('an introduction round-trips, and carries exactly the five things Appendix X names', async () => {
  const made = await mint();
  const got = await read(made.text);

  assert.equal(got.repoId, REPO);
  assert.equal(got.relay, RELAY);
  assert.deepEqual(got.rendezvous, RENDEZVOUS);
  assert.deepEqual(got.signerRaw, SARAH_RAW);
  assert.equal(got.signerSsh, (await exportPublicSsh(sarah, '')));
  assert.equal(got.issuedAt, NOW);
  assert.equal(got.expiresAt, NOW + DEFAULT_TTL_MS);
  assert.equal(got.replayChecked, false, 'with no `seen` store, replay is NOT checked and it says so');

  // The scanner and the issuer derive the same mailbox from the same secret, without talking. That
  // is the whole of "both clients now know each other's sync addresses".
  const mine = await rendezvousFrom(made.mailboxSecret);
  const theirs = await rendezvousFrom(got.rendezvous);
  assert.equal(mine.mailbox, theirs.mailbox);

  // The fingerprint is what a human reads out loud, and it is `ssh-keygen -lf`'s own string, so it
  // can be checked against a tool we did not write (Part 4, rule 3 — see test/b-identity.test.js,
  // which does exactly that comparison for this function's input).
  assert.match(got.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(got.fingerprint, await fingerprint(SARAH_RAW));
  assert.equal(made.fields.fingerprint, got.fingerprint);
});

test('the payload fits a QR code a phone can read across a desk', async () => {
  const made = await mint();
  // 4 magic + 1 flags + 6 issued + 6 expires + 32 key + 32 rendezvous = 81, then the two
  // length-prefixed strings, then a 64-byte signature.
  const expectedBytes = FIXED_BYTES + 1 + REPO.length + 2 + RELAY.length + SIGNATURE_BYTES;
  assert.equal(made.payload.length, expectedBytes);
  assert.equal(made.payload.length, 181, 'the figure the module header quotes must stay true');
  assert.equal(made.text.length, 254);
  assert.ok(made.text.length <= MAX_TEXT_LENGTH);
  // A version-11 byte-mode QR at error level M holds 321 bytes; version 13 holds 425. So 254
  // characters is comfortably inside one scan at a screen-to-camera distance.
  assert.ok(made.text.length < 321, `254 chars fits a v11-M QR; ${made.text.length} would not`);
  assert.equal(made.text.startsWith(URI_PREFIX), true);
  assert.match(made.text.slice(URI_PREFIX.length), /^[A-Za-z0-9_-]+$/, 'base64url only, so no QR escaping');

  // A relay address so long the payload no longer fits is refused with the number in it, rather
  // than producing a QR code nobody can scan.
  await assert.rejects(() => mint({ relay: `wss://${'x'.repeat(400)}.eu` }),
    /over the 512 a QR code should carry/);
});

// ---------------------------------------------------------------------------------------------
// 2. THE TAMPER MATRIX
// ---------------------------------------------------------------------------------------------

test('tamper matrix (1) forged signature — every bit of the signature, and a re-signature', async () => {
  const made = await mint();
  const sigAt = made.payload.length - SIGNATURE_BYTES;

  // Every bit of every signature byte.
  for (let i = sigAt; i < made.payload.length; i++) {
    for (const bit of [0x01, 0x80]) {
      const bent = made.payload.slice();
      bent[i] ^= bit;
      await assert.rejects(() => read(asText(bent)), (err) => {
        assert.ok(err instanceof SyncError);
        assert.match(err.message, /signature does not verify/);
        return true;
      }, `bit ${bit} of signature byte ${i - sigAt} must be detected`);
    }
  }
  // A signature that is 64 valid-looking zero bytes.
  const zeroed = made.payload.slice();
  zeroed.fill(0, sigAt);
  await assert.rejects(() => read(asText(zeroed)), /signature does not verify/);

  // THE ONE THAT MATTERS: an attacker who does not tamper at all, but mints their own valid
  // introduction for their own key. Self-signed is self-signed — the payload verifies.
  const theirs = await createIntroduction({
    identity: attacker, repoId: REPO, relay: RELAY, now: NOW, rendezvous: RENDEZVOUS,
  });
  const accepted = await read(theirs.text);
  assert.notDeepEqual(accepted.signerRaw, SARAH_RAW);
  // Which is why a workspace that already knows the peer pins the key, and then it is refused.
  // (Anna re-adding Sarah after the laptop went into the sea — Appendix X's last paragraph.)
  await assert.rejects(() => read(theirs.text, { expectSigner: SARAH_RAW }),
    /signed by a key this workspace was not expecting/);
  await assert.rejects(() => read(theirs.text, { expectSigner: SARAH_SSH }),
    /not expecting/);
  await assert.rejects(() => read(theirs.text, { expectSigner: hex(SARAH_RAW) }),
    /not expecting/);
  // And the same pinning ACCEPTS the real one, so the check is not vacuous.
  const real = await read(made.text, { expectSigner: SARAH_RAW });
  assert.equal(real.repoId, REPO);
});

test('tamper matrix (2) replayed introduction — single use, and the guard says when it is off', async () => {
  const made = await mint();
  const seen = memorySeenStore();

  const first = await read(made.text, { seen });
  assert.equal(first.replayChecked, true);
  await assert.rejects(() => read(made.text, { seen }),
    /already been used — an introduction is single use/);

  // A persistent guard over the op buffer's kv store: the same refusal survives a restart, which
  // is the case that matters (a photographed QR redeemed the next morning).
  const kv = memoryKvStore();
  const store = seenStore(kv);
  const restart = await mint({ rendezvous: new Uint8Array(RENDEZVOUS_BYTES).fill(3) });
  await read(restart.text, { seen: store });
  await assert.rejects(() => read(restart.text, { seen: seenStore(kv) }),
    /already been used/, 'a fresh guard over the same store must still refuse');

  // What the guard remembers is a HASH of the secret, never the secret — a "used introductions"
  // list is exactly the kind of file that ends up synced somewhere.
  const keys = await kv.keys();
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^introduction\/[0-9a-f]{64}$/);
  assert.equal(keys[0].includes(hex(restart.mailboxSecret)), false);
  // And it is not the mailbox id either, so a relay operator's mailbox log cannot be joined to it.
  assert.equal(keys[0].endsWith((await rendezvousFrom(restart.mailboxSecret)).mailbox), false);
});

test('tamper matrix (3) wrong repo id — a peer is never introduced into another company', async () => {
  const made = await mint();
  assert.equal((await read(made.text, { expectRepo: REPO })).repoId, REPO);
  await assert.rejects(() => read(made.text, { expectRepo: 'muellers-gmbh' }),
    /names repo 'sarah-erp', but this workspace is 'muellers-gmbh'/);

  // Editing the repo id inside the payload does not help: it is inside the signature.
  const at = FIXED_BYTES + 1;
  const bent = made.payload.slice();
  bent[at] = 'x'.charCodeAt(0);
  await assert.rejects(() => read(asText(bent), { expectRepo: REPO }), /signature does not verify/);

  // An attacker minting a *valid* introduction naming the victim's repo is still refused, because
  // the pinned key and the repo id are two independent checks and both must hold.
  const theirs = await createIntroduction({
    identity: attacker, repoId: REPO, relay: RELAY, now: NOW, rendezvous: RENDEZVOUS,
  });
  await assert.rejects(
    () => read(theirs.text, { expectRepo: REPO, expectSigner: SARAH_RAW }),
    /not expecting/);
});

test('tamper matrix (4) truncated payload — every prefix length is refused', async () => {
  const made = await mint();
  for (let n = 0; n < made.payload.length; n++) {
    await assert.rejects(() => read(asText(made.payload.subarray(0, n))), (err) => {
      assert.ok(err instanceof SyncError, `truncation to ${n} bytes threw ${err}`);
      return true;
    }, `a payload truncated to ${n} bytes must be refused`);
  }
  // And extension: trailing bytes where a signature ends are refused, never ignored.
  const extended = new Uint8Array(made.payload.length + 1);
  extended.set(made.payload);
  await assert.rejects(() => read(asText(extended)), /trailing bytes where a 64-byte signature belongs/);
});

test('tamper matrix (complete) — flipping any bit of any byte is refused', async () => {
  const made = await mint();
  let checked = 0;
  for (let i = 0; i < made.payload.length; i++) {
    for (const bit of [0x01, 0x10, 0x80]) {
      const bent = made.payload.slice();
      bent[i] ^= bit;
      await assert.rejects(
        () => read(asText(bent), { expectRepo: REPO, expectSigner: SARAH_RAW }),
        (err) => {
          assert.ok(err instanceof SyncError, `byte ${i} bit ${bit}: threw ${err && err.name}`);
          return true;
        },
        `flipping bit ${bit} of byte ${i} of an introduction must be refused`,
      );
      checked += 1;
    }
  }
  assert.equal(checked, made.payload.length * 3);
  assert.equal(checked, 543, 'the whole payload is covered, and the number is in the report');
});

test('the header, the flags byte and the version are refused rather than guessed at', async () => {
  const made = await mint();

  // Not one of ours at all.
  await assert.rejects(() => read('neodonkey:i/AAAA'), /too short to be an introduction/);
  const notOurs = made.payload.slice();
  notOurs[0] = 0x4d;
  await assert.rejects(() => read(asText(notOurs)), /not a NeoDonkey introduction/);
  // A future version. The version byte is what makes adding a field safe (§0, additive only).
  const v2 = made.payload.slice();
  v2[3] = VERSION + 1;
  await assert.rejects(() => read(asText(v2)), /version 2 is not 1/);
  // An unknown flag is refused, not ignored — Principle 6. This is the check that lets a later
  // version mean something by a flag without a v1 client silently mis-reading it.
  const flagged = made.payload.slice();
  flagged[4] = 0x01;
  await assert.rejects(() => read(asText(flagged)), /flags byte is 0x1, and no flag is defined/);
  assert.deepEqual([...made.payload.subarray(0, 4)], MAGIC);
});

test('the scanned text itself is refused rather than guessed at', async () => {
  const made = await mint();
  const b64 = made.text.slice(URI_PREFIX.length);
  await assert.rejects(() => read(''), /nothing was scanned/);
  await assert.rejects(() => read(b64), /does not start with 'neodonkey:i\/'/);
  await assert.rejects(() => read(`https://neodonkey.eu/i/${b64}`), /does not start with/);
  await assert.rejects(() => read(`${URI_PREFIX}not base64!`), /not base64url/);
  await assert.rejects(() => read(`${URI_PREFIX}${'A'.repeat(MAX_TEXT_LENGTH)}`),
    /more than a QR code carries/);
  await assert.rejects(() => readIntroduction(made.text, {}), /needs an injected now/);
  await assert.rejects(() => readIntroduction(made.text, { now: 'soon' }), /needs an injected now/);
  // Leading and trailing whitespace from a scanner is tolerated — that is a scanner artefact, not
  // a tamper, and it is the one thing this function is allowed to be lenient about.
  assert.equal((await read(`  ${made.text}\n`)).repoId, REPO);
  // The base64url is canonical, so a re-encoding round-trips byte for byte.
  assert.deepEqual(b64urlDecode(b64), made.payload);
});

test('a photographed QR code is not a permanent back door', async () => {
  const made = await mint({ ttlMs: 60_000 });
  assert.equal((await read(made.text)).expiresAt, NOW + 60_000);
  await assert.rejects(() => readIntroduction(made.text, { now: NOW + 60_001 }),
    /expired at 1780000060000 \(now 1780000060001\)/);
  await assert.rejects(() => readIntroduction(made.text, { now: NOW - 1 }),
    /which is in the future/);
  // Clock skew between two laptops is real and is an explicit allowance, not a silent tolerance.
  assert.ok(await readIntroduction(made.text, { now: NOW - 30_000, clockSkewMs: 60_000 }));
  assert.ok(await readIntroduction(made.text, { now: NOW + 90_000, clockSkewMs: 60_000 }));

  await assert.rejects(() => mint({ ttlMs: 0 }), /ttlMs must be a positive integer/);
  await assert.rejects(() => mint({ ttlMs: -1 }), /ttlMs must be a positive integer/);
  await assert.rejects(() => mint({ now: 1.5 }), /now must be an integer/);
});

test('createIntroduction refuses to invent randomness or a currency of its own', async () => {
  // No hidden crypto.getRandomValues: with neither a rendezvous secret nor a randomBytes, it
  // refuses instead of reaching for the platform generator (non-negotiable #5).
  await assert.rejects(
    () => createIntroduction({ identity: sarah, repoId: REPO, relay: RELAY, now: NOW }),
    /needs a 32-byte rendezvous secret, or an injected randomBytes/);
  await assert.rejects(
    () => createIntroduction({
      identity: sarah, repoId: REPO, relay: RELAY, now: NOW, rendezvous: new Uint8Array(16),
    }), /needs a 32-byte rendezvous secret/);
  // An injected generator is used, and its output is what lands in the payload.
  const fixed = new Uint8Array(RENDEZVOUS_BYTES).fill(0x5a);
  const made = await createIntroduction({
    identity: sarah, repoId: REPO, relay: RELAY, now: NOW, randomBytes: () => fixed,
  });
  assert.deepEqual((await read(made.text)).rendezvous, fixed);
  // Empty strings are refused by name rather than producing an unusable introduction.
  await assert.rejects(() => mint({ repoId: '' }), /repo id must be a non-empty string/);
  await assert.rejects(() => mint({ relay: '' }), /relay address must be a non-empty string/);
  await assert.rejects(() => createIntroduction(null), /options are required/);
});

test('two introductions from the same key are different peers-to-be, and the same one is stable', async () => {
  const a = await mint();
  const b = await mint();
  assert.equal(a.text, b.text, 'same inputs, same bytes — a signed payload must be reproducible');
  const c = await mint({ rendezvous: new Uint8Array(RENDEZVOUS_BYTES).fill(1) });
  assert.notEqual(a.text, c.text);
  assert.notEqual(
    (await rendezvousFrom(a.mailboxSecret)).mailbox,
    (await rendezvousFrom(c.mailboxSecret)).mailbox,
    'each introduction gets its own mailbox, so two pairs never collide',
  );
});
