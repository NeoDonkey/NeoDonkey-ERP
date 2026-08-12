// runtime/identity/sshsig.js — SSHSIG, the signature format `git verify-commit` speaks.
//
// Why this file is the root of trust:
//   Appendix IX — "signed Git commits *are* the audit trail". If the signature layer is soft,
//   the regulatory argument collapses.
//   Appendix XI (lost laptop) — "They cannot impersonate Sarah (any peer detects the
//   compromised signature)." That sentence is a claim about THIS function: `verifyPayload`
//   must work in a browser with no git binary, no ssh binary, no server to ask.
//
// Wire format (OpenSSH PROTOCOL.sshsig), signing half proven by the CTO's spike:
//
//   armored  = "-----BEGIN SSH SIGNATURE-----" LF  base64(blob, wrapped at 70)  LF
//              "-----END SSH SIGNATURE-----"
//   blob     = "SSHSIG"                     ; 6 bytes, NOT length-prefixed
//              uint32 version               ; == 1
//              string publickey             ; ssh wire pubkey, string("ssh-ed25519")||string(raw32)
//              string namespace             ; "git" for commit signatures
//              string reserved              ; always empty in practice
//              string hash_algorithm         ; "sha512" (git default) or "sha256"
//              string signature             ; string("ssh-ed25519")||string(raw64)
//   signed   = "SSHSIG" string(namespace) string(reserved="") string(hash_alg) string(H(payload))
//
// Everything here is browser-loadable: no `node:*`, no `Buffer`.

import {
  ED25519_KEYTYPE, ED25519_RAW_SIGNATURE_LEN,
  bytesEqual, concatBytes, sshString, sshUint32, reader, utf8,
  b64encode, b64decode,
  exportPublicRaw, encodePublicWire, parsePublicSsh, importPublicRaw, signRaw, verifyRaw,
} from './ed25519.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {import('./ed25519.js').KeyPair} KeyPair */

const MAGIC = utf8('SSHSIG');          // 6 bytes, no length prefix
const SIG_VERSION = 1;
const DEFAULT_NAMESPACE = 'git';
const DEFAULT_HASH = 'sha512';
const ARMOR_BEGIN = '-----BEGIN SSH SIGNATURE-----';
const ARMOR_END = '-----END SSH SIGNATURE-----';
const ARMOR_WIDTH = 70;

/** The only hash algorithms OpenSSH's sshsig accepts. Anything else is a rejection. */
const HASHES = { sha256: 'SHA-256', sha512: 'SHA-512' };

export const SSHSIG_NAMESPACE_GIT = DEFAULT_NAMESPACE;

// ---------------------------------------------------------------------------
// signing
// ---------------------------------------------------------------------------

/** The exact byte sequence an SSHSIG signature is computed over. */
function signedData(namespace, hashAlg, digest) {
  return concatBytes(
    MAGIC,
    sshString(namespace),
    sshString(new Uint8Array(0)),   // reserved: OpenSSH always writes empty here
    sshString(hashAlg),
    sshString(digest),
  );
}

async function digestOf(hashAlg, payload) {
  const web = HASHES[hashAlg];
  if (!web) throw new Error(`sshsig: unsupported hash algorithm ${JSON.stringify(hashAlg)}`);
  return new Uint8Array(await crypto.subtle.digest(web, payload));
}

/** Wrap a blob in the PEM-ish SSHSIG armor. No trailing newline: the caller (git's `gpgsig`
 *  header) re-indents every line, and a trailing newline would produce a stray " " line. */
function armor(blob) {
  const b64 = b64encode(blob);
  const lines = [];
  for (let i = 0; i < b64.length; i += ARMOR_WIDTH) lines.push(b64.slice(i, i + ARMOR_WIDTH));
  return `${ARMOR_BEGIN}\n${lines.join('\n')}\n${ARMOR_END}`;
}

/**
 * Sign `payload` in SSHSIG form. For a git commit, `payload` is the commit object bytes
 * without the `gpgsig` header, and the result goes into that header.
 *
 * @param {KeyPair} kp
 * @param {Bytes} payload
 * @param {string} [namespace] 'git' for commits, 'file' for `ssh-keygen -Y sign` defaults
 * @param {{ hashAlg?: 'sha256'|'sha512' }} [opts]
 * @returns {Promise<string>} armored signature, no trailing newline
 */
export async function signPayload(kp, payload, namespace = DEFAULT_NAMESPACE, opts = {}) {
  if (!kp || !kp.privateKey) throw new Error('sshsig: no private key');
  if (!(payload instanceof Uint8Array)) throw new TypeError('sshsig: payload must be bytes');
  if (typeof namespace !== 'string' || namespace === '') throw new Error('sshsig: empty namespace');
  const hashAlg = opts.hashAlg || DEFAULT_HASH;

  const publicWire = encodePublicWire(await exportPublicRaw(kp));
  const digest = await digestOf(hashAlg, payload);
  const raw = await signRaw(kp, signedData(namespace, hashAlg, digest));

  const blob = concatBytes(
    MAGIC,
    sshUint32(SIG_VERSION),
    sshString(publicWire),
    sshString(namespace),
    sshString(new Uint8Array(0)),
    sshString(hashAlg),
    sshString(concatBytes(sshString(ED25519_KEYTYPE), sshString(raw))),
  );
  return armor(blob);
}

// ---------------------------------------------------------------------------
// parsing — strict, total, and it throws internally so that verify can fail closed
// ---------------------------------------------------------------------------

/**
 * Strip the armor and return the raw blob. Rejects: missing/duplicated markers, markers in the
 * wrong order, non-base64 body, anything before BEGIN or after END other than whitespace.
 * @param {string} armored @returns {Bytes}
 */
function deArmor(armored) {
  if (typeof armored !== 'string') throw new TypeError('sshsig: armor is not a string');
  const begin = armored.indexOf(ARMOR_BEGIN);
  if (begin < 0) throw new Error('sshsig: missing BEGIN marker');
  if (armored.indexOf(ARMOR_BEGIN, begin + 1) >= 0) throw new Error('sshsig: duplicate BEGIN marker');
  if (armored.slice(0, begin).trim() !== '') throw new Error('sshsig: junk before BEGIN marker');

  const bodyStart = begin + ARMOR_BEGIN.length;
  const end = armored.indexOf(ARMOR_END, bodyStart);
  if (end < 0) throw new Error('sshsig: missing END marker');
  if (armored.indexOf(ARMOR_END, end + 1) >= 0) throw new Error('sshsig: duplicate END marker');
  if (armored.slice(end + ARMOR_END.length).trim() !== '') throw new Error('sshsig: junk after END marker');

  // Whitespace is the only tolerated noise inside the body, and only here — b64decode itself
  // is strict, so this is the single, explicit place where line wrapping is accepted.
  const body = armored.slice(bodyStart, end).replace(/[\r\n\t ]+/g, '');
  if (body === '') throw new Error('sshsig: empty armor body');
  return b64decode(body);
}

/**
 * Decode an SSHSIG blob into its fields. Throws on any structural defect, including
 * trailing bytes — a signature is either exactly well-formed or it is not a signature.
 * @param {Bytes} blob
 */
function parseBlob(blob) {
  if (blob.length < MAGIC.length) throw new Error('sshsig: blob too short');
  if (!bytesEqual(blob.subarray(0, MAGIC.length), MAGIC)) throw new Error('sshsig: bad magic');

  const r = reader(blob.subarray(MAGIC.length));
  const version = r.uint32();
  if (version !== SIG_VERSION) throw new Error(`sshsig: unsupported version ${version}`);

  const publicWire = new Uint8Array(r.string());
  const namespace = r.text();
  r.string();               // reserved — OpenSSH parses and ignores it; so do we, bit for bit
  const hashAlg = r.text();
  const sigWire = new Uint8Array(r.string());
  r.end();                  // no trailing bytes

  // embedded public key
  const pk = reader(publicWire);
  const keyType = pk.text();
  const keyRaw = new Uint8Array(pk.string());
  pk.end();
  if (keyType !== ED25519_KEYTYPE) throw new Error(`sshsig: unsupported key type ${JSON.stringify(keyType)}`);
  if (keyRaw.length !== 32) throw new Error('sshsig: bad public key length');

  // embedded signature
  const sg = reader(sigWire);
  const sigType = sg.text();
  const sigRaw = new Uint8Array(sg.string());
  sg.end();
  if (sigType !== keyType) throw new Error('sshsig: signature algorithm does not match key type');
  if (sigRaw.length !== ED25519_RAW_SIGNATURE_LEN) throw new Error('sshsig: bad signature length');

  if (!Object.prototype.hasOwnProperty.call(HASHES, hashAlg)) {
    throw new Error(`sshsig: unsupported hash algorithm ${JSON.stringify(hashAlg)}`);
  }
  return { version, publicWire, keyRaw, namespace, hashAlg, sigRaw };
}

/**
 * Non-throwing introspection of an armored signature — for audit UIs and the kernel's
 * `verify()` report ("signed by whom?"). Returns `null` if the armor is not parseable.
 * NOTE: this says nothing about validity. Only `verifyPayload` does.
 * @param {string} armored
 * @returns {{ version:number, namespace:string, hashAlg:string, keyRaw:Bytes,
 *             publicSshLine:string }|null}
 */
export function inspectSignature(armored) {
  try {
    const p = parseBlob(deArmor(armored));
    return {
      version: p.version,
      namespace: p.namespace,
      hashAlg: p.hashAlg,
      keyRaw: p.keyRaw,
      publicSshLine: `${ED25519_KEYTYPE} ${b64encode(p.publicWire)}`,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

/**
 * Verify an SSHSIG signature against an expected signer. No git, no ssh binary, no network —
 * this is what lets any peer in the mesh judge any commit (Appendix XI).
 *
 * Fails closed: every defect — malformed armor, bad base64, truncated fields, unknown
 * version, unknown hash algorithm, namespace mismatch, key mismatch, bad signature —
 * returns `false`. It never throws, so no caller can accidentally coerce an exception
 * into a truthy "verified".
 *
 * @param {string} publicSshLine the expected signer's key, `ssh-ed25519 AAAA... [comment]`
 * @param {Bytes} payload the exact bytes that were signed
 * @param {string} armored the `-----BEGIN SSH SIGNATURE-----` block
 * @param {string} [namespace] must match the namespace inside the signature ('git' for commits)
 * @returns {Promise<boolean>}
 */
export async function verifyPayload(publicSshLine, payload, armored, namespace = DEFAULT_NAMESPACE) {
  try {
    if (!(payload instanceof Uint8Array)) return false;
    if (typeof namespace !== 'string' || namespace === '') return false;

    const expected = parsePublicSsh(publicSshLine);
    const sig = parseBlob(deArmor(armored));

    // 1. the signature must claim the namespace the caller is asking about, byte for byte.
    if (sig.namespace !== namespace) return false;

    // 2. the key embedded in the signature must be the key we expect. Without this check the
    //    signature only proves "somebody signed this", which is worth nothing.
    if (!bytesEqual(sig.keyRaw, expected.raw)) return false;

    // 3. re-hash the payload with the algorithm named *inside* the signature (it is covered by
    //    the signature, so it cannot be downgraded), and rebuild the signed blob.
    const digest = await digestOf(sig.hashAlg, payload);
    const toVerify = signedData(sig.namespace, sig.hashAlg, digest);

    const key = await importPublicRaw(expected.raw);
    return await verifyRaw(key, sig.sigRaw, toVerify) === true;
  } catch {
    return false;   // fail closed. Always.
  }
}

// ---------------------------------------------------------------------------
// allowed_signers
// ---------------------------------------------------------------------------

/**
 * One line of an OpenSSH `allowed_signers` file, as consumed by
 * `ssh-keygen -Y verify -f allowed_signers -I <email> -n git` and by
 * `git config gpg.ssh.allowedSignersFile`.
 *
 * The key's trailing comment is dropped: in this file the trailing field is not a comment,
 * so leaving it in is a needless interop risk.
 *
 * @param {string} email principal (git matches this against the committer identity)
 * @param {string} publicSshLine
 * @param {string} [namespace]
 * @returns {string} no trailing newline
 */
export function allowedSignersLine(email, publicSshLine, namespace = DEFAULT_NAMESPACE) {
  if (typeof email !== 'string' || email.trim() === '') throw new Error('allowed_signers: empty principal');
  if (/[\s",]/.test(email.trim())) throw new Error('allowed_signers: principal must not contain whitespace, quotes or commas');
  if (typeof namespace !== 'string' || !/^[A-Za-z0-9._@-]+$/.test(namespace)) {
    throw new Error('allowed_signers: bad namespace');
  }
  const { type, wire } = parsePublicSsh(publicSshLine);
  return `${email.trim()} namespaces="${namespace}" ${type} ${b64encode(wire)}`;
}
