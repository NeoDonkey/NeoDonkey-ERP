// runtime/identity/ed25519.js — Ed25519 identity on browser-standard primitives only.
//
// Manifesto: Principle 4 (transactions are signed commits), Appendix IX (the signature IS
// the audit trail), Appendix X ("All her actions from now on are signed with this key").
//
// Zero dependencies. No `node:*`, no `Buffer`, no `btoa`/`atob` (their binary-string contract
// is a foot-gun on real bytes). Everything below runs unchanged in Node 22+ and in a browser.

/** @typedef {Uint8Array} Bytes */
/** @typedef {{ publicKey: CryptoKey, privateKey: CryptoKey, comment?: string }} KeyPair */

const ALG = { name: 'Ed25519' };
const KEYTYPE = 'ssh-ed25519';
const RAW_PUBLIC_LEN = 32;
const RAW_SIGNATURE_LEN = 64;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

export const ED25519_KEYTYPE = KEYTYPE;
export const ED25519_RAW_PUBLIC_LEN = RAW_PUBLIC_LEN;
export const ED25519_RAW_SIGNATURE_LEN = RAW_SIGNATURE_LEN;

// ---------------------------------------------------------------------------
// bytes
// ---------------------------------------------------------------------------

/** Concatenate byte arrays. @param {...Bytes} parts @returns {Bytes} */
export function concatBytes(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Constant-time-ish byte equality (length-independent short circuit is fine: lengths are public). */
export function bytesEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** @param {string} s @returns {Bytes} */
export function utf8(s) { return textEncoder.encode(s); }
/** @param {Bytes} b @returns {string} */
export function fromUtf8(b) { return textDecoder.decode(b); }

// ---------------------------------------------------------------------------
// base64 (standard alphabet, strict decode) — our own, because `atob` speaks
// binary strings and silently accepts whitespace/garbage in some engines.
// ---------------------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_REVERSE = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < 64; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

/** @param {Bytes} bytes @returns {string} */
export function b64encode(bytes) {
  let out = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_ALPHABET[(v >> 18) & 63] + B64_ALPHABET[(v >> 12) & 63]
         + B64_ALPHABET[(v >> 6) & 63] + B64_ALPHABET[v & 63];
  }
  const rest = n - i;
  if (rest === 1) {
    const v = bytes[i] << 16;
    out += B64_ALPHABET[(v >> 18) & 63] + B64_ALPHABET[(v >> 12) & 63] + '==';
  } else if (rest === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64_ALPHABET[(v >> 18) & 63] + B64_ALPHABET[(v >> 12) & 63]
         + B64_ALPHABET[(v >> 6) & 63] + '=';
  }
  return out;
}

/**
 * Strict base64 decode. Throws on anything that is not canonical base64:
 * bad length, bad character, padding anywhere but the final quad, whitespace.
 * Callers that accept wrapped armor must strip whitespace themselves — that way
 * whitespace tolerance is an explicit decision at exactly one place.
 * @param {string} s @returns {Bytes}
 */
export function b64decode(s) {
  if (typeof s !== 'string') throw new TypeError('base64: not a string');
  const len = s.length;
  if (len === 0) return new Uint8Array(0);
  if (len % 4 !== 0) throw new Error('base64: length is not a multiple of 4');
  let pad = 0;
  if (s.charCodeAt(len - 1) === 61 /* = */) pad = s.charCodeAt(len - 2) === 61 ? 2 : 1;
  const out = new Uint8Array((len / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const last = i + 4 === len;
    const q = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) {
      const code = s.charCodeAt(i + j);
      if (code === 61) {
        // '=' is legal only as the last one or two chars of the last quad.
        if (!last || j < 2 || (j === 2 && s.charCodeAt(i + 3) !== 61)) {
          throw new Error('base64: misplaced padding');
        }
        q[j] = 0;
        continue;
      }
      const v = B64_REVERSE[code];
      if (v < 0) throw new Error('base64: invalid character');
      q[j] = v;
    }
    const v = (q[0] << 18) | (q[1] << 12) | (q[2] << 6) | q[3];
    if (o < out.length) out[o++] = (v >> 16) & 0xff;
    if (o < out.length) out[o++] = (v >> 8) & 0xff;
    if (o < out.length) out[o++] = v & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SSH wire format (RFC 4251 §5): uint32 length prefix + payload
// ---------------------------------------------------------------------------

/** Encode one SSH `string` (length-prefixed blob). @param {Bytes|string} value @returns {Bytes} */
export function sshString(value) {
  const bytes = typeof value === 'string' ? utf8(value) : value;
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

/** Encode a uint32. @param {number} n @returns {Bytes} */
export function sshUint32(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0);
  return out;
}

/**
 * A cursor over SSH wire bytes. Every read is bounds-checked and throws on
 * truncation, so a malformed blob can never be read as a short-but-valid one.
 * @param {Bytes} bytes
 */
export function reader(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('wire: not bytes');
  let at = 0;
  return {
    /** @param {number} n @returns {Bytes} */
    bytes(n) {
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('wire: bad length');
      if (at + n > bytes.length) throw new Error('wire: truncated');
      const out = bytes.subarray(at, at + n);
      at += n;
      return out;
    },
    /** @returns {number} */
    uint32() {
      if (at + 4 > bytes.length) throw new Error('wire: truncated uint32');
      const v = (bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3]) >>> 0;
      at += 4;
      return v;
    },
    /** @returns {Bytes} */
    string() {
      const n = this.uint32();
      if (at + n > bytes.length) throw new Error('wire: truncated string');
      const out = bytes.subarray(at, at + n);
      at += n;
      return out;
    },
    /** @returns {string} */
    text() { return fromUtf8(this.string()); },
    get remaining() { return bytes.length - at; },
    /** Assert the whole blob was consumed — trailing bytes are a rejection, not a shrug. */
    end() { if (at !== bytes.length) throw new Error('wire: trailing bytes'); },
  };
}

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

/**
 * Generate a fresh NeoDonkey identity key (Appendix X, day 1: "the client generates an
 * Ed25519 key pair").
 *
 * @param {{ comment?: string, extractable?: boolean }} [opts]
 *   `extractable: false` produces a private key whose bytes WebCrypto will never hand back
 *   to JS. Use that for the browser keystore (IndexedDB stores the CryptoKey itself).
 *   The default is `true` because the node keystore must serialise a JWK to a file.
 * @returns {Promise<KeyPair>}
 */
export async function generateIdentity(opts = {}) {
  const { comment = '', extractable = true } = opts;
  const kp = await crypto.subtle.generateKey(ALG, extractable, ['sign', 'verify']);
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, comment };
}

/** Raw 32-byte public key. @param {KeyPair|CryptoKey} kpOrKey @returns {Promise<Bytes>} */
export async function exportPublicRaw(kpOrKey) {
  const key = kpOrKey && 'publicKey' in kpOrKey ? kpOrKey.publicKey : kpOrKey;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  if (raw.length !== RAW_PUBLIC_LEN) throw new Error('ed25519: unexpected public key length');
  return raw;
}

/**
 * The OpenSSH public key wire blob: string("ssh-ed25519") || string(raw32).
 * This is the payload that gets base64'd into an `.pub` line and embedded in an SSHSIG.
 * @param {Bytes} raw @returns {Bytes}
 */
export function encodePublicWire(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== RAW_PUBLIC_LEN) {
    throw new Error('ed25519: raw public key must be 32 bytes');
  }
  return concatBytes(sshString(KEYTYPE), sshString(raw));
}

/**
 * Byte-identical to what `ssh-keygen -y -f <key>` prints (without the trailing newline):
 * `ssh-ed25519 <base64(wire)>` and, when the key carries one, ` <comment>`.
 * @param {KeyPair} kp
 * @param {string} [comment] overrides `kp.comment`
 * @returns {Promise<string>}
 */
export async function exportPublicSsh(kp, comment) {
  const raw = await exportPublicRaw(kp);
  const c = comment !== undefined ? comment : (kp && kp.comment) || '';
  const line = `${KEYTYPE} ${b64encode(encodePublicWire(raw))}`;
  return c ? `${line} ${c}` : line;
}

/**
 * Parse an OpenSSH public key line — `ssh-ed25519 AAAA... [comment]`. This is the same wire
 * format the SSHSIG blob embeds, so `sshsig.js` reuses it for the signer's key.
 * Throws on anything malformed; never guesses.
 * @param {string} line
 * @returns {{ type: string, raw: Bytes, wire: Bytes, comment: string }}
 */
export function parsePublicSsh(line) {
  if (typeof line !== 'string') throw new TypeError('ssh public key: not a string');
  const trimmed = line.trim();
  if (trimmed === '') throw new Error('ssh public key: empty');
  const sp = trimmed.indexOf(' ');
  if (sp < 0) throw new Error('ssh public key: missing base64 field');
  const type = trimmed.slice(0, sp);
  if (type !== KEYTYPE) throw new Error(`ssh public key: unsupported type ${JSON.stringify(type)}`);
  let rest = trimmed.slice(sp + 1).replace(/^\s+/, '');
  const sp2 = rest.search(/\s/);
  const b64 = sp2 < 0 ? rest : rest.slice(0, sp2);
  const comment = sp2 < 0 ? '' : rest.slice(sp2 + 1).trim();
  const wire = b64decode(b64);
  const r = reader(wire);
  const innerType = r.text();
  const raw = r.string();
  r.end();
  if (innerType !== type) throw new Error('ssh public key: type/blob mismatch');
  if (raw.length !== RAW_PUBLIC_LEN) throw new Error('ssh public key: bad key length');
  return { type, raw: new Uint8Array(raw), wire, comment };
}

/** Import a raw 32-byte Ed25519 public key for verification. @param {Bytes} raw */
export async function importPublicRaw(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== RAW_PUBLIC_LEN) {
    throw new Error('ed25519: raw public key must be 32 bytes');
  }
  return crypto.subtle.importKey('raw', raw, ALG, true, ['verify']);
}

/** Import from an OpenSSH public key line. @param {string} line */
export async function importPublicSsh(line) {
  const { raw } = parsePublicSsh(line);
  return importPublicRaw(raw);
}

/**
 * Export the private key as a JWK (`{kty:'OKP', crv:'Ed25519', d, x}`) for the keystore.
 * Throws if the key was generated non-extractable — that is the point of non-extractable.
 * @param {KeyPair} kp @returns {Promise<object>}
 */
export async function exportPrivateJwk(kp) {
  if (!kp || !kp.privateKey) throw new Error('ed25519: no private key');
  if (!kp.privateKey.extractable) {
    throw new Error('ed25519: private key is non-extractable (by design) — cannot export JWK');
  }
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  if (kp.comment) jwk.kid = kp.comment;
  return jwk;
}

/**
 * Re-import a JWK private key and derive the matching public key from its `x` coordinate.
 * @param {object} jwk @returns {Promise<KeyPair>}
 */
export async function importPrivateJwk(jwk) {
  if (!jwk || typeof jwk !== 'object') throw new TypeError('ed25519: jwk must be an object');
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') throw new Error('ed25519: not an Ed25519 OKP jwk');
  if (typeof jwk.d !== 'string' || typeof jwk.x !== 'string') throw new Error('ed25519: jwk missing d/x');
  const privateKey = await crypto.subtle.importKey(
    'jwk', { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: jwk.x }, ALG, true, ['sign'],
  );
  const publicKey = await importPublicRaw(b64urlDecode(jwk.x));
  return { publicKey, privateKey, comment: typeof jwk.kid === 'string' ? jwk.kid : '' };
}

/** base64url → bytes (JWK fields use it, unpadded). @param {string} s @returns {Bytes} */
export function b64urlDecode(s) {
  if (typeof s !== 'string') throw new TypeError('base64url: not a string');
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 === 0 ? '' : '='.repeat(4 - (std.length % 4));
  return b64decode(std + pad);
}

/** bytes → base64url (unpadded). @param {Bytes} b @returns {string} */
export function b64urlEncode(b) {
  return b64encode(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Raw 64-byte Ed25519 signature over `payload`. @param {KeyPair} kp @param {Bytes} payload */
export async function signRaw(kp, payload) {
  const sig = new Uint8Array(await crypto.subtle.sign(ALG, kp.privateKey, payload));
  if (sig.length !== RAW_SIGNATURE_LEN) throw new Error('ed25519: unexpected signature length');
  return sig;
}

/** @param {CryptoKey} publicKey @param {Bytes} signature @param {Bytes} payload */
export async function verifyRaw(publicKey, signature, payload) {
  if (!(signature instanceof Uint8Array) || signature.length !== RAW_SIGNATURE_LEN) return false;
  return crypto.subtle.verify(ALG, publicKey, signature, payload);
}

// ---------------------------------------------------------------------------
// OpenSSH private key file — deliberately NOT implemented. See report/COMPROMISES.
// `openssh-key-v1` requires bcrypt_pbkdf + a private AES-256-CTR path for encrypted keys;
// writing an *unencrypted* one is cheap but shipping a helper that drops an unencrypted
// private key on disk is the opposite of Appendix IV. `exportPrivateJwk` + keystore is the
// supported path; interop with the ssh CLI is achieved via the *public* key + SSHSIG only.
