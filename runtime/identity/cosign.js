// runtime/identity/cosign.js — four-eyes as a signature constraint on the commit.
//
// Manifesto line 114: "The four-eyes principle becomes a signature constraint on the commit,
// not workflow code." COMPROMISES #4d is the entry this file exists to close.
//
// Git gives a commit exactly one `gpgsig` header, so a second signature cannot be a second
// header — real git must stay happy with what we write (standing rule 3). The answer the
// manifesto already names: additional signatures are commit *trailers*, inside the signed
// payload of the primary signature.
//
// ---------------------------------------------------------------------------------------------
// THE ORDERING RULE. This is the whole security argument; everything else is plumbing.
// ---------------------------------------------------------------------------------------------
//
// Let P0 be the commit object bytes with no `gpgsig` header and no co-signature trailers:
//
//     P0 = <header lines> LF <message>
//
// Co-signatures are appended, one per line, at the very end of the message, in signing order.
// Write Tk for the k-th trailer line including its terminating LF, and
//
//     Pk = P0 ‖ T1 ‖ … ‖ Tk
//
// Then, for n co-signers:
//
//     co-signature k  signs  P(k-1)      ; it covers every co-signature BEFORE it, never itself
//     primary gpgsig  signs  Pn          ; it covers ALL of them, in order
//
// A staircase. Each signature covers the whole commit — tree, parents, author, committer, time,
// message — plus every signature that came before it. Consequences, which are the point:
//
//   * Strip a co-signature and the primary no longer covers the bytes that remain: refused.
//   * Reorder two co-signatures and the later one's payload prefix changes: refused, and the
//     primary is broken too.
//   * Duplicate one and both the distinctness check and the primary fail.
//   * Add a foreign one, from any key, at any position: the primary does not cover it.
//   * Strip the primary and there is no `gpgsig` at all — real git reports an unsigned commit,
//     and we require a primary signature before we call anything verified.
//
// So neither half can be removed without invalidating the other, which is exactly the property
// "two signatures over one payload" has to have to mean anything to an auditor.
//
// ---------------------------------------------------------------------------------------------
// Namespace: `neodonkey-cosign`, never `git`.
// ---------------------------------------------------------------------------------------------
//
// The same discipline COMPROMISES #15 applies to release signatures. If a co-signature carried
// the `git` namespace it would be a valid *commit* signature over P(k-1) — and P(k-1) is a
// perfectly well-formed commit payload (it is this commit, minus the later trailers). An
// attacker could then present the co-signer's signature as `gpgsig` on a commit the co-signer
// never authored. A distinct namespace makes that replay structurally impossible, because
// SSHSIG binds the namespace inside the signed data.
//
// No `node:*`, no Buffer: this file runs in the browser like everything else in runtime/.

import { verifyPayload, inspectSignature, signPayload } from './sshsig.js';
import { b64encode, b64decode, concatBytes, utf8, fromUtf8 } from './ed25519.js';

/** @typedef {Uint8Array} Bytes */

/** Never 'git'. See the header. */
export const COSIGN_NAMESPACE = 'neodonkey-cosign';

/** The trailer key. A git trailer, so `git log` shows it and `git interpret-trailers` reads it. */
export const COSIGN_TRAILER_KEY = 'NeoDonkey-Cosign';

const TRAILER_PREFIX = `${COSIGN_TRAILER_KEY}: `;
const ARMOR_BEGIN = '-----BEGIN SSH SIGNATURE-----';
const ARMOR_END = '-----END SSH SIGNATURE-----';
const ARMOR_WIDTH = 70;

/** A principal is an email-shaped identifier. It must survive a single-line trailer intact. */
const PRINCIPAL = /^[A-Za-z0-9._%+@-]+$/;

// ---------------------------------------------------------------------------------------------
// armor <-> one line
// ---------------------------------------------------------------------------------------------

/**
 * The armored SSHSIG block is multi-line; a git trailer is one line. So the trailer carries the
 * armor *body* — the same base64 an armored signature contains, unwrapped. Nothing is lost: the
 * BEGIN/END markers are constants, so re-armoring is exact and `ssh-keygen -Y verify` accepts
 * the result (asserted in test/s-integrity.test.js).
 * @param {string} armored
 * @returns {string} base64, single line, no whitespace
 */
export function base64FromArmor(armored) {
  if (typeof armored !== 'string') throw new TypeError('cosign: armor is not a string');
  const begin = armored.indexOf(ARMOR_BEGIN);
  const end = armored.indexOf(ARMOR_END);
  if (begin < 0 || end < begin) throw new Error('cosign: not an armored SSH signature');
  const body = armored.slice(begin + ARMOR_BEGIN.length, end).replace(/[\r\n\t ]+/g, '');
  if (body === '') throw new Error('cosign: empty armor body');
  return body;
}

/**
 * The inverse. Wrapping is at 70 columns, byte-identical to what `ssh-keygen -Y sign` writes,
 * because an auditor must be able to paste it straight into `ssh-keygen -Y verify`.
 * @param {string} b64
 * @returns {string} armored block, no trailing newline
 */
export function armorFromBase64(b64) {
  if (typeof b64 !== 'string' || b64 === '') throw new Error('cosign: empty signature body');
  const lines = [];
  for (let i = 0; i < b64.length; i += ARMOR_WIDTH) lines.push(b64.slice(i, i + ARMOR_WIDTH));
  return `${ARMOR_BEGIN}\n${lines.join('\n')}\n${ARMOR_END}`;
}

/**
 * One trailer line, no terminating newline.
 * @param {string} principal
 * @param {string} armoredOrBase64
 */
export function cosignTrailer(principal, armoredOrBase64) {
  if (typeof principal !== 'string' || !PRINCIPAL.test(principal)) {
    throw new Error(`cosign: ${JSON.stringify(principal)} is not a usable principal `
      + '(letters, digits and . _ % + @ - only, no spaces)');
  }
  const b64 = armoredOrBase64.includes(ARMOR_BEGIN)
    ? base64FromArmor(armoredOrBase64) : armoredOrBase64.replace(/[\r\n\t ]+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('cosign: signature body is not base64');
  return `${TRAILER_PREFIX}${principal} ${b64}`;
}

// ---------------------------------------------------------------------------------------------
// signing
// ---------------------------------------------------------------------------------------------

/**
 * Co-sign a payload. `payload` must be P(k-1) as defined in the header — the caller (the kernel)
 * owns that arithmetic, because only it knows the commit bytes.
 * @param {import('./ed25519.js').KeyPair} keyPair
 * @param {Bytes} payload
 * @returns {Promise<string>} armored signature
 */
export function cosignPayload(keyPair, payload) {
  return signPayload(keyPair, payload, COSIGN_NAMESPACE);
}

/**
 * P0 ‖ T1 ‖ … ‖ Tk. The one place the staircase is built, used by both the signer and the
 * verifier so they cannot drift apart.
 * @param {Bytes} basePayload P0
 * @param {string[]} trailerLines without terminating newlines
 * @returns {Bytes}
 */
export function payloadWithCosignatures(basePayload, trailerLines) {
  if (!(basePayload instanceof Uint8Array)) throw new TypeError('cosign: payload must be bytes');
  if (trailerLines.length === 0) return basePayload;
  return concatBytes(basePayload, utf8(trailerLines.map((l) => `${l}\n`).join('')));
}

// ---------------------------------------------------------------------------------------------
// reading the trailer block out of the SIGNED bytes
// ---------------------------------------------------------------------------------------------

/**
 * Split a commit payload into its header block and its message. The payload is what
 * `commitPayload()` returns: header lines, a blank line, then the message.
 * @param {Bytes} payload
 * @returns {{ headerLength:number, message:string }}
 */
function splitPayload(payload) {
  for (let i = 0; i + 1 < payload.length; i++) {
    if (payload[i] === 0x0a && payload[i + 1] === 0x0a) {
      return { headerLength: i + 2, message: fromUtf8(payload.subarray(i + 2)) };
    }
  }
  throw new Error('cosign: commit payload has no header/message separator');
}

/**
 * Read the co-signature trailers, **from the signed bytes only**.
 *
 * Strict by construction (Principle 6), and every strictness here is a tamper case:
 *   * the trailers must be the LAST lines of the message, contiguous, one per line. A
 *     `NeoDonkey-Cosign:` line anywhere else is refused rather than counted, because the
 *     staircase arithmetic is defined by position and a floating trailer has no position.
 *   * the message must end with exactly one LF, as git guarantees.
 *   * principal and base64 are validated before any crypto runs.
 *
 * Anything that is not inside the payload — most importantly a line smuggled into the `gpgsig`
 * header value — is invisible here by design: we only ever count what the primary signature
 * actually covers.
 *
 * @param {Bytes} payload
 * @returns {{ trailers:{principal:string, base64:string, line:string}[],
 *             problems:{code:string, message:string}[], basePayload:Bytes }}
 */
export function readCosignTrailers(payload) {
  const { headerLength, message } = splitPayload(payload);
  /** @type {{code:string,message:string}[]} */
  const problems = [];

  // Lines of the message. A git message always ends with LF, so the last element is ''.
  const lines = message.split('\n');
  const hasFinalNewline = lines[lines.length - 1] === '';
  if (hasFinalNewline) lines.pop();

  // Walk backwards over the contiguous run of trailers at the end.
  let firstTrailer = lines.length;
  while (firstTrailer > 0 && lines[firstTrailer - 1].startsWith(TRAILER_PREFIX)) firstTrailer--;

  // Any trailer OUTSIDE that run is a positional forgery, not a signature.
  for (let i = 0; i < firstTrailer; i++) {
    if (lines[i].startsWith(TRAILER_PREFIX)) {
      problems.push({
        code: 'cosign-trailer-out-of-place',
        message: `a ${COSIGN_TRAILER_KEY} line appears at line ${i + 1} of the commit message, `
          + 'but co-signatures are only valid as the last lines of the message — their order is '
          + 'what each signature covers, so a floating trailer has no meaning and is refused.',
      });
    }
  }

  /** @type {{principal:string, base64:string, line:string}[]} */
  const trailers = [];
  for (let i = firstTrailer; i < lines.length; i++) {
    const line = lines[i];
    const rest = line.slice(TRAILER_PREFIX.length);
    const sp = rest.indexOf(' ');
    if (sp < 0) {
      problems.push({
        code: 'cosign-trailer-malformed',
        message: `${COSIGN_TRAILER_KEY} on message line ${i + 1} has no signature after the `
          + `principal. Expected "${TRAILER_PREFIX}<principal> <base64>".`,
      });
      continue;
    }
    const principal = rest.slice(0, sp);
    const base64 = rest.slice(sp + 1);
    if (!PRINCIPAL.test(principal)) {
      problems.push({
        code: 'cosign-trailer-malformed',
        message: `${JSON.stringify(principal)} is not a usable principal on message line ${i + 1}.`,
      });
      continue;
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      problems.push({
        code: 'cosign-trailer-malformed',
        message: `the signature on message line ${i + 1} is not base64.`,
      });
      continue;
    }
    trailers.push({ principal, base64, line });
  }

  // P0: the payload with the whole trailer run removed, byte-exactly.
  let consumed = 0;
  for (let i = firstTrailer; i < lines.length; i++) consumed += utf8(`${lines[i]}\n`).length;
  const keptMessage = payload.subarray(headerLength, payload.length - consumed);
  const basePayload = concatBytes(payload.subarray(0, headerLength), keptMessage);

  return { trailers, problems, basePayload };
}

// ---------------------------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------------------------

/**
 * `SHA256:` + unpadded base64 of SHA-256 over the public key wire blob — byte-identical to
 * `ssh-keygen -lf`, so a human can compare what we print with what OpenSSH prints.
 * @param {string} publicSshLine
 */
async function fingerprint(publicSshLine) {
  const wire = b64decode(publicSshLine.trim().split(/\s+/)[1] || '');
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', wire));
  return `SHA256:${b64encode(d).replace(/=+$/, '')}`;
}

function keyRawOf(armored) {
  const info = inspectSignature(armored);
  return info ? info.keyRaw : null;
}

/**
 * Verify every signature on a commit, independently, and report who signed in what order.
 *
 * This never throws and never returns a bare boolean: `ok` is the verdict, `signatures` is the
 * evidence, and `problems` carries a distinct code per defect so a refusal can name what
 * happened rather than saying "invalid".
 *
 * @param {{
 *   payload: Bytes,                             // commitPayload(commit object bytes)
 *   primarySignature: string|null,              // the gpgsig value
 *   primaryPrincipal: string,                   // the committer, per git's own convention
 *   resolveKey: (principal:string) => string|null|undefined,   // -> `ssh-ed25519 AAAA…`
 *   requirement?: Requirement|null,
 *   document?: object|null,                     // for separation-of-duties checks
 * }} o
 * @returns {Promise<Report>}
 *
 * @typedef {{ roles?:string[], minSigners?:number, separateFrom?:string|null,
 *             rolesOf?:(principal:string)=>string[] }} Requirement
 * @typedef {{ ok:boolean, signatures:Signature[], problems:{code:string,message:string}[],
 *             cosigners:string[], primary:string }} Report
 * @typedef {{ order:number, role:'cosignature'|'primary', principal:string,
 *             status:'good'|'bad'|'unknown-signer'|'malformed'|'wrong-namespace',
 *             fingerprint:string|null, covers:number }} Signature
 */
export async function verifyCommitSignatures(o) {
  /** @type {{code:string,message:string}[]} */
  const problems = [];
  /** @type {Signature[]} */
  const signatures = [];

  const { trailers, problems: readProblems, basePayload } = (() => {
    try {
      return readCosignTrailers(o.payload);
    } catch (e) {
      return { trailers: [], problems: [{ code: 'commit-payload-malformed', message: e.message }], basePayload: o.payload };
    }
  })();
  problems.push(...readProblems);

  const n = trailers.length;

  // ---- distinctness, before any crypto. Two increments of a counter are not two signers, and
  //      neither are two signatures from one key wearing two names.
  const seenPrincipal = new Set();
  for (const t of trailers) {
    if (seenPrincipal.has(t.principal)) {
      problems.push({
        code: 'duplicate-cosigner',
        message: `${t.principal} appears twice among the co-signatures. Four eyes means two `
          + 'people; the same principal signing twice is one person signing twice.',
      });
    }
    seenPrincipal.add(t.principal);
  }

  /** @type {Map<string,string>} raw key hex -> principal */
  const byKey = new Map();
  const rawHex = (raw) => [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');

  // ---- each co-signature, against the payload it is defined to cover: P(k-1).
  for (let k = 1; k <= n; k++) {
    const t = trailers[k - 1];
    const armored = armorFromBase64(t.base64);
    const covers = k - 1;
    const expectedPayload = payloadWithCosignatures(
      basePayload, trailers.slice(0, covers).map((x) => x.line),
    );
    const info = inspectSignature(armored);
    const key = o.resolveKey(t.principal) ?? null;

    /** @type {Signature} */
    const entry = {
      order: k, role: 'cosignature', principal: t.principal,
      status: 'bad', fingerprint: null, covers,
    };

    if (!info) {
      entry.status = 'malformed';
      problems.push({
        code: 'cosign-trailer-malformed',
        message: `the co-signature from ${t.principal} (position ${k}) is not a parseable SSH signature.`,
      });
    } else if (info.namespace !== COSIGN_NAMESPACE) {
      entry.status = 'wrong-namespace';
      problems.push({
        code: 'cosignature-wrong-namespace',
        message: `the co-signature from ${t.principal} (position ${k}) carries the namespace `
          + `"${info.namespace}", not "${COSIGN_NAMESPACE}". A signature made for another purpose `
          + 'is not a co-signature — that is what the namespace is for.',
      });
    } else if (!key) {
      entry.status = 'unknown-signer';
      problems.push({
        code: 'unknown-cosigner',
        message: `${t.principal} co-signed at position ${k}, but this repository holds no public `
          + `key for that principal (peers/${t.principal}.json). An unknown signer is not a signer.`,
      });
    } else {
      entry.fingerprint = await fingerprint(key);
      const ok = await verifyPayload(key, expectedPayload, armored, COSIGN_NAMESPACE);
      entry.status = ok ? 'good' : 'bad';
      if (!ok) {
        problems.push({
          code: 'cosignature-invalid',
          message: `the co-signature from ${t.principal} at position ${k} does not verify against `
            + `the commit as it stands with the ${covers} co-signature(s) before it. It was made `
            + 'over different bytes, or the trailer block has been reordered.',
        });
      }
      const raw = info.keyRaw;
      const hexKey = rawHex(raw);
      const already = byKey.get(hexKey);
      if (already && already !== t.principal) {
        problems.push({
          code: 'same-key-twice',
          message: `${t.principal} and ${already} co-signed with the same key. One key is one `
            + 'pair of eyes, whatever name it signs under.',
        });
      } else if (already === t.principal) {
        // already reported as duplicate-cosigner
      }
      byKey.set(hexKey, t.principal);
    }
    signatures.push(entry);
  }

  // ---- the primary signature, over Pn: the whole commit including every co-signature.
  /** @type {Signature} */
  const primary = {
    order: n + 1, role: 'primary', principal: o.primaryPrincipal,
    status: 'bad', fingerprint: null, covers: n,
  };
  if (!o.primarySignature) {
    primary.status = 'malformed';
    problems.push({
      code: 'primary-signature-missing',
      message: 'this commit carries no gpgsig header, so nobody has signed the co-signatures '
        + 'into it. A co-signature alone is not a signed commit.',
    });
  } else {
    const key = o.resolveKey(o.primaryPrincipal) ?? null;
    if (!key) {
      primary.status = 'unknown-signer';
      problems.push({
        code: 'unknown-signer',
        message: `the commit is signed as ${o.primaryPrincipal}, for whom this repository holds `
          + 'no public key.',
      });
    } else {
      primary.fingerprint = await fingerprint(key);
      const ok = await verifyPayload(key, o.payload, o.primarySignature, 'git');
      primary.status = ok ? 'good' : 'bad';
      if (!ok) {
        problems.push({
          code: n > 0 ? 'trailer-block-altered' : 'primary-signature-invalid',
          message: n > 0
            ? `the commit signature by ${o.primaryPrincipal} does not cover these bytes. The `
              + 'primary signature is made over the commit INCLUDING every co-signature trailer, '
              + 'in order — so a co-signature that has been removed, added, duplicated or '
              + 'reordered breaks it. That is deliberate: neither half can be stripped without '
              + 'invalidating the other.'
            : `the commit signature by ${o.primaryPrincipal} does not verify.`,
        });
      }
      const raw = keyRawOf(o.primarySignature);
      if (raw) {
        const already = byKey.get(rawHex(raw));
        if (already) {
          problems.push({
            code: 'primary-also-cosigned',
            message: `the key that signed this commit also co-signed it as ${already}. The same `
              + 'key cannot satisfy both halves of four-eyes.',
          });
        }
      }
    }
  }
  signatures.push(primary);

  // ---- the requirement: is every signature that had to be here, here?
  const cosigners = trailers.map((t) => t.principal);
  const req = o.requirement;
  if (req) {
    const goodSigners = signatures.filter((s) => s.status === 'good').map((s) => s.principal);
    const distinct = [...new Set(goodSigners)];

    const minSigners = req.minSigners ?? (req.roles ? req.roles.length : 2);
    if (distinct.length < minSigners) {
      problems.push({
        code: 'missing-required-signer',
        message: `this operation requires ${minSigners} distinct signatures and carries `
          + `${distinct.length} (${distinct.join(', ') || 'none'}).`,
      });
    }

    // Each required role must be covered by a DIFFERENT principal. Greedy is not enough when
    // one person holds both roles, so this is a real (tiny) bipartite matching.
    if (req.roles && req.roles.length && req.rolesOf) {
      const candidates = req.roles.map((role) => distinct.filter((p) => req.rolesOf(p).includes(role)));
      const assign = matchDistinct(candidates);
      if (!assign) {
        problems.push({
          code: 'missing-required-role',
          message: `this operation requires ${req.roles.join(' and ')} to be signed for by `
            + `different people. The signatures present (${distinct.map((p) => `${p} [${req.rolesOf(p).join(', ') || 'no role'}]`).join('; ') || 'none'}) `
            + 'cannot cover those roles with one distinct person each.',
        });
      }
    }

    if (req.separateFrom) {
      const raised = o.document ? o.document[req.separateFrom] : null;
      if (raised && distinct.includes(String(raised))) {
        problems.push({
          code: 'separation-of-duties',
          message: `${raised} is named as the ${req.separateFrom} of this document and may not `
            + 'also sign it. Separation of duties is the point of the requirement.',
        });
      }
    }
  }

  return {
    ok: problems.length === 0 && signatures.every((s) => s.status === 'good'),
    signatures, problems, cosigners, primary: o.primaryPrincipal,
  };
}

/**
 * Can each list pick a distinct element? Roles are few (two, in every real four-eyes rule), so
 * exhaustive backtracking is both correct and instant. Written out rather than approximated
 * because "one person holding both roles satisfies both" is precisely the bug we are killing.
 * @param {string[][]} candidates
 * @returns {string[]|null}
 */
export function matchDistinct(candidates, at = 0, used = new Set(), picked = []) {
  if (at === candidates.length) return picked.slice();
  for (const c of candidates[at]) {
    if (used.has(c)) continue;
    used.add(c); picked.push(c);
    const got = matchDistinct(candidates, at + 1, used, picked);
    if (got) return got;
    used.delete(c); picked.pop();
  }
  return null;
}
