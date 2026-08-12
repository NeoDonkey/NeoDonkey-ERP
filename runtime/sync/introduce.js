// runtime/sync/introduce.js — Appendix X, day 3, as bytes.
//
//   "Sarah clicks 'Add peer', shows a QR code. Herr Klein scans it. Both clients now know each
//    other's public keys and sync addresses."
//
// An introduction an attacker can forge is a peer they can insert, so this is a SIGNED payload,
// not a URL with fields in it. It carries exactly five things and nothing else:
//
//   • the issuer's Ed25519 public key — so the scanner learns who it is talking to;
//   • the repo id (FD-3) — so a peer cannot be introduced into the wrong company's mesh;
//   • the relay address — Appendix X's €3/month postal transit station;
//   • a 32-byte rendezvous secret — the seed of the mailbox id and of the outer key
//     (runtime/sync/sealed.js). The relay never sees it, which is what "the relay sees nothing"
//     reduces to in code;
//   • an issued/expires window, so a photographed QR code is not a permanent back door.
//
// WHAT THIS AUTHENTICATES, AND WHAT IT CANNOT. The signature proves the payload was minted by
// the holder of the key inside it, and that not one byte has been altered. It cannot prove that
// the key belongs to Sarah, because a self-signed introduction is self-signed: an attacker can
// mint a perfectly valid one for their own key. The binding to the person is the QR code being on
// the screen of the person you are standing next to — which is precisely why Appendix X has Herr
// Klein *scan* rather than receive an email. Where the workspace already knows the peer (Anna
// re-adding Sarah after the laptop went into the sea), `expectSigner` pins the key and the
// introduction becomes fully authenticated. That distinction is stated here rather than glossed,
// because it is the one an adversary would go for.
//
// No camera, no rendering: this module produces and consumes the payload. A UI agent renders the
// modules' `text` as a QR code and hands a scan back to `readIntroduction`.
//
// Binary, then base64url, because a QR code's capacity is the constraint. MEASURED, for the repo id
// `sarah-erp` and the relay `wss://relay.neodonkey.eu`: **181 bytes of payload, 254 characters of
// text** (test/sync-introduce.test.js asserts both, so the numbers cannot drift). A version-11
// byte-mode QR at error level M holds 321 bytes, so this is one scan at any size a phone can read
// across a desk. A JSON introduction with the same fields is over 400 bytes before signing and gets
// meaningfully harder to scan.

import {
  b64urlEncode, b64urlDecode, concatBytes, utf8, fromUtf8, bytesEqual,
  exportPublicRaw, exportPublicSsh, encodePublicWire, b64encode,
  importPublicRaw, signRaw, verifyRaw, parsePublicSsh,
} from '../identity/ed25519.js';
import { SyncError, RENDEZVOUS_BYTES, hex, unhex } from './sealed.js';

/** @typedef {Uint8Array} Bytes */

/** `NDI` + version. A payload that does not start with this is not one of ours. */
export const MAGIC = Object.freeze([0x4e, 0x44, 0x49, 0x01]);
export const VERSION = 1;
/** The scheme a QR scanner sees. Required — a bare base64 blob is refused, never guessed at. */
export const URI_PREFIX = 'neodonkey:i/';
export const SIGNATURE_BYTES = 64;
export const PUBLIC_KEY_BYTES = 32;
/** magic 4 + flags 1 + issued 6 + expires 6 + key 32 + rendezvous 32 = 81 before the two strings */
export const FIXED_BYTES = 4 + 1 + 6 + 6 + PUBLIC_KEY_BYTES + RENDEZVOUS_BYTES;
/** Appendix X shows a QR code on a laptop screen; keep the text inside what one scan can hold. */
export const MAX_TEXT_LENGTH = 512;
/** The default validity window: long enough for a coffee, short enough not to be a back door. */
export const DEFAULT_TTL_MS = 15 * 60 * 1000;

const MAX_48BIT = 2 ** 48 - 1;

/** @param {number} n @param {number} width @returns {Bytes} big-endian */
function uint(n, width) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_48BIT) {
    throw new SyncError(`introduction: ${n} is not a non-negative integer that fits 48 bits`);
  }
  const out = new Uint8Array(width);
  let v = n;
  for (let i = width - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  if (v !== 0) throw new SyncError(`introduction: ${n} does not fit in ${width} bytes`);
  return out;
}

/** @param {Bytes} b @param {number} at @param {number} width */
function readUint(b, at, width) {
  let v = 0;
  for (let i = 0; i < width; i++) v = v * 256 + b[at + i];
  return v;
}

/** A length-prefixed UTF-8 string. 1-byte length for the repo id, 2 for the relay URL. */
function lenString(value, widthBytes, what) {
  if (typeof value !== 'string' || value === '') {
    throw new SyncError(`introduction: ${what} must be a non-empty string`);
  }
  const bytes = utf8(value);
  const max = widthBytes === 1 ? 255 : 65535;
  if (bytes.length > max) {
    throw new SyncError(`introduction: ${what} is ${bytes.length} bytes, the format allows ${max}`);
  }
  return concatBytes(uint(bytes.length, widthBytes), bytes);
}

/**
 * The bytes a signature covers: everything except the signature itself. There is no separate
 * "canonical form" to get wrong — the signed bytes ARE the payload prefix, so a verifier cannot
 * disagree with a signer about what was signed.
 * @param {{ flags:number, issuedAt:number, expiresAt:number, keyRaw:Bytes, rendezvous:Bytes,
 *           repoId:string, relay:string }} f
 */
function body(f) {
  return concatBytes(
    new Uint8Array(MAGIC),
    uint(f.flags, 1),
    uint(f.issuedAt, 6),
    uint(f.expiresAt, 6),
    f.keyRaw,
    f.rendezvous,
    lenString(f.repoId, 1, 'repo id'),
    lenString(f.relay, 2, 'relay address'),
  );
}

/**
 * Mint an introduction.
 *
 * @param {{ identity: {publicKey:CryptoKey, privateKey:CryptoKey},
 *           repoId: string,
 *           relay: string,
 *           now: number,
 *           ttlMs?: number,
 *           rendezvous?: Bytes,
 *           randomBytes?: (n:number) => Bytes }} o
 *   `now` is injected (non-negotiable #5: nothing in runtime/ reads a clock). `rendezvous` may be
 *   supplied so a test can replay a byte-identical introduction; otherwise it comes from
 *   `randomBytes`, which must also be injected — there is no hidden call to
 *   `crypto.getRandomValues` in here.
 * @returns {Promise<{ text:string, payload:Bytes, mailboxSecret:Bytes, fields:object }>}
 */
export async function createIntroduction(o) {
  if (!o || typeof o !== 'object') throw new SyncError('introduction: options are required');
  if (!Number.isInteger(o.now)) throw new SyncError('introduction: now must be an integer (ms)');
  const ttl = o.ttlMs ?? DEFAULT_TTL_MS;
  if (!Number.isInteger(ttl) || ttl <= 0) {
    throw new SyncError('introduction: ttlMs must be a positive integer');
  }
  const rendezvous = o.rendezvous ?? (typeof o.randomBytes === 'function'
    ? o.randomBytes(RENDEZVOUS_BYTES)
    : null);
  if (!(rendezvous instanceof Uint8Array) || rendezvous.length !== RENDEZVOUS_BYTES) {
    throw new SyncError(
      `introduction: needs a ${RENDEZVOUS_BYTES}-byte rendezvous secret, or an injected randomBytes(n)`,
    );
  }
  const keyRaw = await exportPublicRaw(o.identity);
  const fields = {
    flags: 0,
    issuedAt: o.now,
    expiresAt: o.now + ttl,
    keyRaw,
    rendezvous,
    repoId: o.repoId,
    relay: o.relay,
  };
  const signed = body(fields);
  const signature = await signRaw(o.identity, signed);
  const payload = concatBytes(signed, signature);
  const text = URI_PREFIX + b64urlEncode(payload);
  if (text.length > MAX_TEXT_LENGTH) {
    throw new SyncError(
      `introduction: the payload is ${text.length} characters, over the ${MAX_TEXT_LENGTH} a QR `
      + 'code should carry — shorten the relay address or the repo id',
    );
  }
  return {
    text,
    payload,
    mailboxSecret: rendezvous,
    fields: {
      repoId: o.repoId,
      relay: o.relay,
      issuedAt: fields.issuedAt,
      expiresAt: fields.expiresAt,
      signerSsh: await exportPublicSsh(o.identity),
      signerRaw: keyRaw,
      fingerprint: await fingerprint(keyRaw),
    },
  };
}

/**
 * The short string a human compares out of band ("read me the last six characters"). SHA-256 of
 * the OpenSSH public key wire blob, base64 — exactly what `ssh-keygen -lf` prints, so it can be
 * checked against a tool we did not write.
 * @param {Bytes} keyRaw @returns {Promise<string>}
 */
export async function fingerprint(keyRaw) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encodePublicWire(keyRaw)));
  return `SHA256:${b64encode(digest).replace(/=+$/, '')}`;
}

/**
 * Read and verify an introduction. Every refusal is by name, and none of them is a guess.
 *
 * @param {string} text the scanned string
 * @param {{ now: number,
 *           expectRepo?: string,
 *           expectSigner?: Bytes|string|null,
 *           seen?: { has(id:string): boolean|Promise<boolean>, add(id:string): void|Promise<void> },
 *           clockSkewMs?: number }} o
 *   `seen` is the replay guard: an introduction is single use, and a stateless verifier cannot
 *   know that, so the store is injected. A missing `seen` means replay is NOT checked, and this
 *   function says so in its return value rather than pretending.
 * @returns {Promise<{ repoId:string, relay:string, rendezvous:Bytes, signerRaw:Bytes,
 *                     signerSsh:string, fingerprint:string, issuedAt:number, expiresAt:number,
 *                     rendezvousId:string, replayChecked:boolean }>}
 */
export async function readIntroduction(text, o) {
  if (!o || !Number.isInteger(o.now)) {
    throw new SyncError('introduction: readIntroduction needs an injected now (ms)');
  }
  if (typeof text !== 'string' || text === '') {
    throw new SyncError('introduction: nothing was scanned');
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith(URI_PREFIX)) {
    throw new SyncError(
      `introduction: text does not start with '${URI_PREFIX}' — refusing to guess at what was scanned`,
    );
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new SyncError(`introduction: ${trimmed.length} characters is more than a QR code carries`);
  }
  const b64 = trimmed.slice(URI_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(b64)) {
    throw new SyncError('introduction: payload is not base64url');
  }
  let payload;
  try { payload = b64urlDecode(b64); } catch { throw new SyncError('introduction: payload is not base64url'); }

  if (payload.length < FIXED_BYTES + 2 + 1 + SIGNATURE_BYTES) {
    throw new SyncError(
      `introduction: payload is ${payload.length} bytes, too short to be an introduction (truncated)`,
    );
  }
  for (let i = 0; i < MAGIC.length - 1; i++) {
    if (payload[i] !== MAGIC[i]) throw new SyncError('introduction: not a NeoDonkey introduction');
  }
  if (payload[3] !== VERSION) {
    throw new SyncError(`introduction: version ${payload[3]} is not ${VERSION}`);
  }
  const flags = payload[4];
  if (flags !== 0) {
    // §0 and Principle 6: an unknown flag is refused, never ignored. A future version that means
    // something by it will bump the version byte, and this refusal is what makes that safe.
    throw new SyncError(`introduction: flags byte is 0x${flags.toString(16)}, and no flag is defined`);
  }
  const issuedAt = readUint(payload, 5, 6);
  const expiresAt = readUint(payload, 11, 6);
  const signerRaw = payload.slice(17, 17 + PUBLIC_KEY_BYTES);
  const rendezvous = payload.slice(49, 49 + RENDEZVOUS_BYTES);

  let at = FIXED_BYTES;
  const repoLen = payload[at];
  at += 1;
  if (at + repoLen > payload.length) throw new SyncError('introduction: repo id runs past the payload (truncated)');
  const repoId = fromUtf8(payload.subarray(at, at + repoLen));
  at += repoLen;
  if (at + 2 > payload.length) throw new SyncError('introduction: relay length runs past the payload (truncated)');
  const relayLen = readUint(payload, at, 2);
  at += 2;
  if (at + relayLen > payload.length) throw new SyncError('introduction: relay address runs past the payload (truncated)');
  const relay = fromUtf8(payload.subarray(at, at + relayLen));
  at += relayLen;

  if (payload.length !== at + SIGNATURE_BYTES) {
    throw new SyncError(
      `introduction: ${payload.length - at} trailing bytes where a ${SIGNATURE_BYTES}-byte `
      + 'signature belongs — refusing rather than ignoring what we do not understand',
    );
  }
  const signature = payload.subarray(at);
  const signed = payload.subarray(0, at);

  if (repoId === '') throw new SyncError('introduction: repo id is empty');
  if (relay === '') throw new SyncError('introduction: relay address is empty');

  // Signature first: nothing below this line may act on an unverified field.
  const ok = await verifyRaw(await importPublicRaw(signerRaw), signature, signed);
  if (!ok) {
    throw new SyncError('introduction: signature does not verify — this is not the payload that was signed');
  }

  if (o.expectSigner) {
    const expected = typeof o.expectSigner === 'string'
      ? (o.expectSigner.startsWith('ssh-') ? parsePublicSsh(o.expectSigner).raw : unhex(o.expectSigner))
      : o.expectSigner;
    if (!bytesEqual(signerRaw, expected)) {
      throw new SyncError(
        'introduction: signed by a key this workspace was not expecting'
        + ` (got ${await fingerprint(signerRaw)})`,
      );
    }
  }
  if (o.expectRepo !== undefined && o.expectRepo !== null && repoId !== o.expectRepo) {
    throw new SyncError(
      `introduction: names repo '${repoId}', but this workspace is '${o.expectRepo}'`
      + ' — a peer is never introduced into a company it did not ask for',
    );
  }
  const skew = o.clockSkewMs ?? 0;
  if (expiresAt <= issuedAt) throw new SyncError('introduction: expires at or before it was issued');
  if (o.now + skew < issuedAt) {
    throw new SyncError(`introduction: issued at ${issuedAt}, which is in the future`);
  }
  if (o.now - skew > expiresAt) {
    throw new SyncError(`introduction: expired at ${expiresAt} (now ${o.now})`);
  }

  // The rendezvous id is what a replay guard remembers. It is a HASH of the secret, never the
  // secret: a "used introductions" list is exactly the kind of file that gets synced somewhere.
  const rendezvousId = hex(new Uint8Array(
    await crypto.subtle.digest('SHA-256', concatBytes(utf8('neodonkey-introduction-id-v1'), rendezvous)),
  ));
  let replayChecked = false;
  if (o.seen) {
    if (await o.seen.has(rendezvousId)) {
      throw new SyncError(
        'introduction: this introduction has already been used — an introduction is single use, '
        + 'so a photographed QR code cannot be redeemed twice',
      );
    }
    await o.seen.add(rendezvousId);
    replayChecked = true;
  }

  return {
    repoId,
    relay,
    rendezvous,
    signerRaw,
    signerSsh: `ssh-ed25519 ${b64encode(encodePublicWire(signerRaw))}`,
    fingerprint: await fingerprint(signerRaw),
    issuedAt,
    expiresAt,
    rendezvousId,
    replayChecked,
  };
}

/**
 * A replay guard over any async key/value store (runtime/sync/opbuffer.js's `fsKvStore` is one).
 * @param {{get(k:string):Promise<unknown>, put(k:string,v:unknown):Promise<void>}} kv
 * @param {string} [prefix]
 */
export function seenStore(kv, prefix = 'introduction/') {
  return {
    async has(id) { return (await kv.get(prefix + id)) !== null; },
    async add(id) { await kv.put(prefix + id, { used: true }); },
  };
}

/** An in-memory replay guard, for a session that has no persistence yet. */
export function memorySeenStore() {
  const set = new Set();
  return { has: (id) => set.has(id), add: (id) => { set.add(id); } };
}
