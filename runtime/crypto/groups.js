// runtime/crypto/groups.js — group semantics: the ~600 lines Appendix VII budgets for.
//
// A group ("HR", "Board", "Berlin plant management") is a symmetric AES-256 secret that a set of
// people hold. Appendix VII's four operations are create, add a member, remove a member, and
// rotate; this file implements all four, plus the one they compose into that a company actually
// runs — **offboarding as a single commit**.
//
// ### The manifest is public, on purpose
//
// `crypto/groups/<id>.json` is a plaintext repo file. Every peer sees that an HR group exists,
// who is in it, and which public keys its wraps are addressed to. Only members can unwrap the
// secret. That is the manifesto's position — "radical transparency as default, targeted
// confidentiality where needed" — applied to access control itself: in NeoDonkey you can read who
// is allowed to read what, which is more than any classical ERP will tell you.
//
// ### Epochs, and why removal without rotation is honest but weak
//
// A group secret is versioned by an integer **epoch**. Removing a member from the manifest stops
// all *future* wraps from including them, and nothing else — they physically hold the repo, so
// they hold the epoch-N wrap addressed to them, from git history, forever. That is not a bug we
// can fix; Appendix VII says so plainly ("cryptographically retroactive erasure exists nowhere").
// What rotation buys is precise and worth stating exactly:
//
//   • a new epoch secret, wrapped only for the remaining members;
//   • documents re-sealed under it, which the former member cannot open;
//   • new *names*: the sealed id of a document is a keyed hash under the epoch's name key, so
//     after rotation the former member cannot even tell which blob is which.
//
// And what it does not buy: everything they already read, they still know. `offboard()` therefore
// returns the writes *and the removals* — re-sealing changes a document's path — so the whole act
// is one atomic commit (Appendix VIII, simple case), automatable, and visible in `git log`.
//
// ### The keyring
//
// A peer's keyring is "which group secrets can I unwrap, and therefore what can I read". It is
// built once from the manifests in the repo plus the peer's own encryption private key, and it is
// what turns Appendix VII's key design into Appendix VI's *personalized index*: `keyring.resolve`
// is handed to `envelope.open`, `reader.js` hands the result to the read path, and a non-member's
// index is built from strictly fewer documents. Not filtered — fewer.

/** @typedef {Uint8Array} Bytes */

import {
  CryptoError, WRAP_ALG, KDF_ALG, SECRET_LEN, DEFAULT_CURVE,
  randomBytes, hkdf, wrapSecret, unwrapSecret, agree, generateGroupSecret,
  generateEncryptionKeyPair, exportEncPublicRaw, importEncPublicRaw,
  memberWrapInfo, deriveNameKey, deriveSubjectNameKey, sealedId, verifyEnrolment,
  jsonBytes, CRYPTO_PATHS,
} from './keys.js';
import { b64encode, b64decode } from '../identity/ed25519.js';
import { seal, open as openEnvelope, unwrapDekRecord, sealedPath } from './envelope.js';

export const GROUP_FORMAT = 'neodonkey-group';
export const GROUP_MANIFEST_VERSION = 1;

const isB64 = (s) => typeof s === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0;

// ---------------------------------------------------------------------------------------------
// member wraps — ephemeral-static ECDH, then HKDF, then AES-KW
// ---------------------------------------------------------------------------------------------

/**
 * Wrap a group epoch secret for one member.
 *
 * Ephemeral-static rather than static-static: a fresh key pair per wrap, so the wrap depends on no
 * long-term secret of the *granter* and a compromised granter key cannot retroactively recover
 * every group key they ever handed out. The ephemeral public key travels in the record; nothing
 * else is needed to unwrap.
 *
 * @param {{secret: Bytes, group: string, epoch: number, curve: string, recipient: Bytes,
 *          random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<object>} a wrap record
 */
export async function wrapSecretForMember(o) {
  const { secret, group, epoch, curve, recipient, random } = o;
  if (!Number.isInteger(epoch) || epoch < 1) {
    throw new CryptoError('manifest-epoch-invalid', 'a group epoch is an integer >= 1');
  }
  const eph = await generateEncryptionKeyPair({ curve, extractable: true });
  const publicKey = await importEncPublicRaw(recipient, curve);
  const z = await agree({ privateKey: eph.privateKey, publicKey, curve });
  const salt = randomBytes(SECRET_LEN, random);
  const info = memberWrapInfo(group, epoch);
  const kek = await hkdf(z, salt, info);
  return {
    epoch,
    kex: curve,
    'ephemeral-public-key': b64encode(await exportEncPublicRaw(eph)),
    kdf: KDF_ALG,
    salt: b64encode(salt),
    info,
    alg: WRAP_ALG,
    wrapped: b64encode(await wrapSecret(kek, secret)),
  };
}

/**
 * Unwrap a group epoch secret from one member wrap record.
 *
 * The `info` string is verified against the group and epoch the record claims *before* it is used
 * to derive anything. That single check is what makes a rotation unreplayable: relabel an epoch-1
 * record as epoch 2 and this refuses (`wrap-epoch-mismatch`); leave it labelled 1 and offer it
 * where 2 is expected and the caller never asks for it. Either way the old secret cannot be
 * passed off as the new one.
 *
 * @param {{record: object, group: string, privateKey: CryptoKey}} o @returns {Promise<Bytes>}
 */
export async function unwrapSecretForMember(o) {
  const { record, group, privateKey } = o;
  const expected = memberWrapInfo(group, record.epoch);
  if (record.info !== expected) {
    throw new CryptoError('wrap-epoch-mismatch',
      `a wrap record labelled epoch ${record.epoch} derives its key with `
      + `${JSON.stringify(record.info)} — refusing to derive from a label that lies`);
  }
  if (record.alg !== WRAP_ALG) {
    throw new CryptoError('unknown-wrap-alg', `wrap alg ${JSON.stringify(record.alg)} is unknown`);
  }
  if (record.kdf !== KDF_ALG) {
    throw new CryptoError('unknown-kdf', `wrap kdf ${JSON.stringify(record.kdf)} is unknown`);
  }
  const curve = record.kex ?? DEFAULT_CURVE;
  const publicKey = await importEncPublicRaw(b64decode(record['ephemeral-public-key']), curve);
  const z = await agree({ privateKey, publicKey, curve });
  const kek = await hkdf(z, b64decode(record.salt), expected);
  return unwrapSecret(kek, b64decode(record.wrapped));
}

// ---------------------------------------------------------------------------------------------
// the manifest
// ---------------------------------------------------------------------------------------------

/**
 * Check a group manifest's shape and **every member's key binding**. Throws on the first problem;
 * there is no such thing as a manifest we half-accept, because the half we accepted would be the
 * half that decides who can read salaries.
 * @param {object} m @returns {Promise<object>} the manifest, unchanged
 */
export async function verifyGroupManifest(m) {
  if (!m || typeof m !== 'object' || m.format !== GROUP_FORMAT) {
    throw new CryptoError('not-a-group-manifest', 'not a NeoDonkey group manifest');
  }
  if (m.version !== GROUP_MANIFEST_VERSION) {
    throw new CryptoError('unknown-manifest-version',
      `group manifest version ${m.version} is not one this runtime knows `
      + `(it knows ${GROUP_MANIFEST_VERSION})`);
  }
  if (typeof m.id !== 'string' || m.id === '') {
    throw new CryptoError('not-a-group-manifest', 'a group manifest needs an id');
  }
  if (!Number.isInteger(m.epoch) || m.epoch < 1) {
    throw new CryptoError('manifest-epoch-invalid', `group ${m.id} has epoch ${m.epoch}`);
  }
  if (!Array.isArray(m.members)) {
    throw new CryptoError('not-a-group-manifest', `group ${m.id} has no members array`);
  }
  const seen = new Set();
  for (const member of m.members) {
    if (seen.has(member.principal)) {
      throw new CryptoError('duplicate-member',
        `${member.principal} appears twice in group ${m.id}`);
    }
    seen.add(member.principal);
    await verifyEnrolment(enrolmentOf(member));
    if (!Array.isArray(member.wraps) || member.wraps.length === 0) {
      throw new CryptoError('not-a-group-manifest',
        `${member.principal} is listed in group ${m.id} with no wrapped group key, so the entry `
        + 'grants nothing — a member record without a wrap is a mistake, not a permission');
    }
    const epochs = new Set();
    for (const w of member.wraps) {
      if (!Number.isInteger(w.epoch) || w.epoch < 1 || w.epoch > m.epoch) {
        throw new CryptoError('manifest-epoch-invalid',
          `${member.principal} holds a wrap for epoch ${w.epoch} in a group at epoch ${m.epoch}`);
      }
      if (epochs.has(w.epoch)) {
        throw new CryptoError('duplicate-member',
          `${member.principal} has two wraps for epoch ${w.epoch} in group ${m.id}`);
      }
      epochs.add(w.epoch);
      if (!isB64(w.salt) || !isB64(w.wrapped) || !isB64(w['ephemeral-public-key'])) {
        throw new CryptoError('not-a-group-manifest',
          `a wrap for ${member.principal} in group ${m.id} is not base64`);
      }
    }
  }
  return m;
}

/** The enrolment view of a manifest member record — the same four fields, so one verifier serves. */
function enrolmentOf(member) {
  return {
    format: 'neodonkey-enrolment',
    version: 1,
    principal: member.principal,
    'signing-public-key': member['signing-public-key'],
    'enc-curve': member['enc-curve'],
    'enc-public-key': member['enc-public-key'],
    'key-binding': member['key-binding'],
  };
}

/** Serialise a manifest for a commit. @param {object} m @returns {{path: string, bytes: Bytes}} */
export function manifestFile(m) {
  return { path: CRYPTO_PATHS.group(m.id), bytes: jsonBytes(m) };
}

// ---------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------

/**
 * Create a group at epoch 1.
 *
 * @param {{id: string, title?: string, enrolments: object[], secret?: Bytes,
 *          random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<{manifest: object, secret: Bytes, epoch: number, secrets: Map<number, Bytes>}>}
 */
export async function createGroup(o) {
  const { id, title = id, enrolments, random } = o;
  if (typeof id !== 'string' || id === '' || id !== CRYPTO_PATHS.safe(id)) {
    throw new CryptoError('not-a-group-manifest',
      `a group id must be a path-safe name; ${JSON.stringify(id)} is not`);
  }
  if (!Array.isArray(enrolments) || enrolments.length === 0) {
    throw new CryptoError('no-members-left',
      'a group with no members has no purpose and no key holder — refusing to create one');
  }
  const secret = o.secret ?? generateGroupSecret(random);
  const members = [];
  const seen = new Set();
  for (const e of enrolments) {
    const { principal, curve, raw } = await verifyEnrolment(e);
    if (seen.has(principal)) {
      throw new CryptoError('duplicate-member', `${principal} listed twice for group ${id}`);
    }
    seen.add(principal);
    members.push({
      principal,
      'signing-public-key': e['signing-public-key'],
      'enc-curve': curve,
      'enc-public-key': e['enc-public-key'],
      'key-binding': e['key-binding'],
      wraps: [await wrapSecretForMember({
        secret, group: id, epoch: 1, curve, recipient: raw, random,
      })],
    });
  }
  const manifest = {
    format: GROUP_FORMAT,
    version: GROUP_MANIFEST_VERSION,
    id,
    title,
    epoch: 1,
    members,
    rotations: [],
  };
  return { manifest, secret, epoch: 1, secrets: new Map([[1, secret]]) };
}

// ---------------------------------------------------------------------------------------------
// add a member — Appendix VII's onboarding
// ---------------------------------------------------------------------------------------------

/**
 * Add a member. The caller must hold the group secrets it wants to grant: you cannot give away a
 * key you do not have, and this function will not pretend otherwise.
 *
 * `grant` decides how much history the newcomer gets:
 *   • `'all'` (default) — every epoch the caller can supply. Appendix VII's "from then on they can
 *     read" reads most naturally as "they can read the group's documents", and documents sealed
 *     under an earlier epoch that nobody re-sealed are the group's documents.
 *   • `'current'` — only the current epoch. Choose this when an epoch boundary is meant to be a
 *     confidentiality boundary (a new CFO who should not see the previous board's papers).
 *
 * @param {{manifest: object, secrets: Map<number, Bytes>, enrolment: object,
 *          grant?: 'all'|'current', random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<object>} a new manifest; the input is not mutated
 */
export async function addMember(o) {
  const { manifest, secrets, enrolment: e, grant = 'all', random } = o;
  await verifyGroupManifest(manifest);
  const { principal, curve, raw } = await verifyEnrolment(e);
  if (manifest.members.some((m) => m.principal === principal)) {
    throw new CryptoError('member-exists', `${principal} is already a member of ${manifest.id}`);
  }
  const epochs = grant === 'current'
    ? [manifest.epoch]
    : [...secrets.keys()].filter((n) => n <= manifest.epoch).sort((a, b) => a - b);
  if (!epochs.includes(manifest.epoch)) {
    throw new CryptoError('not-a-member',
      `adding ${principal} to ${manifest.id} needs the current epoch (${manifest.epoch}) secret; `
      + `the caller holds ${[...secrets.keys()].join(', ') || 'none'}`);
  }
  const wraps = [];
  for (const epoch of epochs) {
    wraps.push(await wrapSecretForMember({
      secret: secrets.get(epoch), group: manifest.id, epoch, curve, recipient: raw, random,
    }));
  }
  return {
    ...manifest,
    members: [...manifest.members, {
      principal,
      'signing-public-key': e['signing-public-key'],
      'enc-curve': curve,
      'enc-public-key': e['enc-public-key'],
      'key-binding': e['key-binding'],
      wraps,
    }].sort((a, b) => (a.principal < b.principal ? -1 : a.principal > b.principal ? 1 : 0)),
  };
}

// ---------------------------------------------------------------------------------------------
// remove, rotate, offboard
// ---------------------------------------------------------------------------------------------

/**
 * Remove a member from the manifest and nothing else. Kept as its own function because it is a
 * distinct, weaker act than offboarding and a caller should have to say which one it means.
 * @param {{manifest: object, principal: string}} o @returns {Promise<object>} a new manifest
 */
export async function removeMember(o) {
  const { manifest, principal } = o;
  await verifyGroupManifest(manifest);
  if (!manifest.members.some((m) => m.principal === principal)) {
    throw new CryptoError('member-unknown', `${principal} is not a member of ${manifest.id}`);
  }
  const members = manifest.members.filter((m) => m.principal !== principal);
  if (members.length === 0) {
    throw new CryptoError('no-members-left',
      `removing ${principal} would leave group ${manifest.id} with no key holder, which destroys `
      + 'every document sealed for it. Add a member first, or shred deliberately.');
  }
  return { ...manifest, members };
}

/**
 * Mint a new epoch. The new secret is wrapped for every current member; existing wraps stay, so a
 * continuing member keeps access to anything still sealed under an older epoch.
 * @param {{manifest: object, secret?: Bytes, because?: string, removed?: string[],
 *          random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<{manifest: object, secret: Bytes, epoch: number}>}
 */
export async function rotateGroup(o) {
  const { manifest, because = 'rotation', removed = [], random } = o;
  await verifyGroupManifest(manifest);
  const epoch = manifest.epoch + 1;
  const secret = o.secret ?? generateGroupSecret(random);
  const members = [];
  for (const m of manifest.members) {
    const raw = b64decode(m['enc-public-key']);
    members.push({
      ...m,
      wraps: [...m.wraps, await wrapSecretForMember({
        secret, group: manifest.id, epoch, curve: m['enc-curve'], recipient: raw, random,
      })],
    });
  }
  return {
    manifest: {
      ...manifest,
      epoch,
      members,
      rotations: [...(manifest.rotations ?? []), {
        'to-epoch': epoch, because, removed: [...removed],
      }],
    },
    secret,
    epoch,
  };
}

/**
 * Re-seal one document under a new set of groups. Returns the write **and the removal**, because
 * a document's path is a keyed hash of its name under the naming group's epoch name key, so
 * re-sealing under a new epoch moves it. Git records that as a rename; the old blob stays in
 * history, which is what GoBD wants and what makes the former member's copy useless rather than
 * absent.
 *
 * @param {{bytes: Bytes, path?: string, resolve: Function,
 *          groups: {id: string, epoch: number, secret: Bytes}[],
 *          random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<{write: {path: string, bytes: Bytes}, removal: string|null,
 *                    entity: string, name: string, moved: boolean}>}
 */
export async function reseal(o) {
  const opened = await openEnvelope(o.bytes, { resolve: o.resolve, path: o.path });
  const fresh = await seal({
    entity: opened.entity,
    name: opened.name,
    doc: opened.doc,
    key: { kind: 'dek', groups: o.groups },
    random: o.random,
  });
  const path = sealedPath(fresh);
  const oldPath = o.path ?? sealedPath(opened);
  return {
    write: { path, bytes: fresh.bytes },
    removal: path === oldPath ? null : oldPath,
    entity: opened.entity,
    name: opened.name,
    moved: path !== oldPath,
  };
}

/**
 * **Offboarding, as one commit.** Appendix VII: "public key removed from group manifest (commit).
 * All future group-key wraps no longer include them. Optionally the existing group key is rotated
 * and sensitive existing documents re-encrypted — a larger but automatable commit." This is that
 * commit, automated, and the rotation is not optional here: a caller who wants the weaker act
 * calls `removeMember` and says so.
 *
 * @param {{manifest: object, secrets: Map<number, Bytes>, principal: string,
 *          documents?: {path: string, bytes: Bytes}[], resolve?: Function,
 *          random?: (b: Bytes) => Bytes}} o
 * @returns {Promise<{manifest: object, secret: Bytes, epoch: number,
 *                    writes: Map<string, Bytes>, removals: string[], resealed: number,
 *                    limitation: string}>}
 */
export async function offboard(o) {
  const { manifest, secrets, principal, documents = [], resolve, random } = o;
  const without = await removeMember({ manifest, principal });
  const rotated = await rotateGroup({
    manifest: without, because: 'member-removed', removed: [principal], random,
  });
  const groups = [{ id: rotated.manifest.id, epoch: rotated.epoch, secret: rotated.secret }];
  const writes = new Map();
  const removals = [];
  if (documents.length > 0 && typeof resolve !== 'function') {
    throw new CryptoError('no-key-for-envelope',
      'offboard() was given documents to re-seal but no way to open them; pass the outgoing '
      + "keyring's resolve()");
  }
  for (const d of documents) {
    const r = await reseal({ bytes: d.bytes, path: d.path, resolve, groups, random });
    writes.set(r.write.path, r.write.bytes);
    if (r.removal !== null) removals.push(r.removal);
  }
  const file = manifestFile(rotated.manifest);
  writes.set(file.path, file.bytes);
  return {
    manifest: rotated.manifest,
    secret: rotated.secret,
    epoch: rotated.epoch,
    writes,
    removals,
    resealed: documents.length,
    // Carried in the return value, not only in a comment, so a UI cannot show a reassuring
    // "offboarded" without the sentence that makes it honest.
    limitation:
      `${principal} still physically holds the repository. Everything they could read before this `
      + 'commit, they still know; what they cannot do is read anything sealed from now on, or tell '
      + 'which blob is which. Cryptographically retroactive erasure exists nowhere.',
  };
}

// ---------------------------------------------------------------------------------------------
// the keyring
// ---------------------------------------------------------------------------------------------

/**
 * What this peer can unwrap.
 *
 * @param {{principal: string, encryption: {privateKey: CryptoKey, curve?: string},
 *          manifests: object[]}} o `manifests` is every group manifest in the repo — including
 *   the groups this peer is *not* in, because knowing a group exists is public and because
 *   telling "a group I am not in" apart from "a group that does not exist" is the difference
 *   between two refusal reasons a reviewer will ask about.
 * @returns {Promise<object>} a keyring
 */
export async function keyring(o) {
  const { principal, encryption, manifests } = o;
  if (typeof principal !== 'string' || principal === '') {
    throw new CryptoError('member-unknown', 'a keyring needs the principal it belongs to');
  }
  /** @type {Map<string, Bytes>} `<group>@<epoch>` -> secret */
  const secrets = new Map();
  /** @type {Map<string, Bytes>} `<group>@<epoch>` -> name key, derived once */
  const nameKeys = new Map();
  const known = new Set();
  const memberOf = new Set();
  /** @type {{group: string, epoch: number, reason: string, message: string}[]} */
  const problems = [];
  /** @type {null | ((keyId: string) => Promise<Bytes>)} */
  let subjectSource = null;
  const subjectCache = new Map();

  for (const m of manifests ?? []) {
    await verifyGroupManifest(m);
    known.add(m.id);
    const me = m.members.find((x) => x.principal === principal);
    if (!me) continue;
    if (!encryption || !encryption.privateKey) continue;
    memberOf.add(m.id);
    for (const w of me.wraps) {
      try {
        secrets.set(`${m.id}@${w.epoch}`,
          await unwrapSecretForMember({ record: w, group: m.id, privateKey: encryption.privateKey }));
      } catch (e) {
        // A wrap that will not unwrap is *not* fatal to the keyring: another epoch may still
        // work, and a member whose key was rotated should degrade rather than break. It is
        // recorded, and a UI that hides it is lying.
        problems.push({
          group: m.id, epoch: w.epoch, reason: e.reason ?? 'wrap-mac-failed', message: e.message,
        });
      }
    }
  }

  const secretFor = (group, epoch) => secrets.get(`${group}@${epoch}`) ?? null;

  const nameKeyFor = async (group, epoch) => {
    const k = `${group}@${epoch}`;
    if (nameKeys.has(k)) return nameKeys.get(k);
    const secret = secretFor(group, epoch);
    if (secret === null) return null;
    const nk = await deriveNameKey(secret, group, epoch);
    nameKeys.set(k, nk);
    return nk;
  };

  /**
   * The resolver `envelope.open` needs. Tries every wrap the envelope offers, in order, and
   * fails closed with the most specific reason it saw — a tampered wrap must not be reported as
   * "not a member", and a group that does not exist must not be reported as either.
   */
  const resolve = async (keyRecord, header) => {
    if (keyRecord.kind === 'subject') {
      if (subjectSource === null) {
        throw new CryptoError('vault-required',
          `this envelope's content key is subject key ${keyRecord['key-id']}, which lives in the `
          + 'vault; this keyring has no vault attached');
      }
      const id = keyRecord['key-id'];
      let key = subjectCache.get(id);
      if (key === undefined) {
        key = await subjectSource(id);
        subjectCache.set(id, key);
      }
      return { key, nameKey: await deriveSubjectNameKey(key, id), via: `subject:${id}` };
    }

    const namedBy = header['named-by'];
    const nameKey = namedBy && namedBy.group !== undefined
      ? await nameKeyFor(namedBy.group, namedBy.epoch)
      : null;

    /** @type {CryptoError|null} */
    let worst = null;
    const rank = {
      'wrap-mac-failed': 5, 'wrap-epoch-mismatch': 4, 'unknown-wrap-alg': 4, 'unknown-kdf': 4,
      'unknown-group': 3, 'not-a-member': 2,
    };
    const note = (err) => {
      if (worst === null || (rank[err.reason] ?? 1) > (rank[worst.reason] ?? 1)) worst = err;
    };

    for (const w of keyRecord.wraps) {
      if (!known.has(w.group)) {
        note(new CryptoError('unknown-group',
          `this envelope is wrapped for group ${JSON.stringify(w.group)}, and no such group `
          + 'manifest exists in this repository'));
        continue;
      }
      const secret = secretFor(w.group, w.epoch);
      if (secret === null) {
        note(new CryptoError('not-a-member',
          `this envelope is wrapped for ${w.group}@${w.epoch}; ${principal} holds no secret for it`));
        continue;
      }
      try {
        const dek = await unwrapDekRecord(w, secret);
        return { key: dek, nameKey: nameKey ?? undefined, via: `${w.group}@${w.epoch}` };
      } catch (e) {
        note(e);
      }
    }
    throw worst ?? new CryptoError('no-key-for-envelope', 'no wrap in this envelope is openable');
  };

  return {
    principal,
    /** Group ids this peer holds at least one epoch secret for. Sorted. */
    groups: () => [...memberOf].sort(),
    /** Every group manifest this peer has seen, member or not. Sorted. */
    knownGroups: () => [...known].sort(),
    /** `<group>@<epoch>` keys this peer holds. Sorted. The honest inventory. */
    epochs: () => [...secrets.keys()].sort(),
    secretFor,
    nameKeyFor,
    resolve,
    problems: () => problems.map((p) => ({ ...p })),
    /**
     * Compute where a document *would* live, so a member can look one up by its business name.
     * Without this, encrypted filenames would mean a member can decrypt a document but cannot
     * find it — a capability nobody can use end to end.
     * @param {{entity: string, name: string, group: string, epoch?: number}} q
     * @returns {Promise<string|null>} the `documents/…` path, or null if not a member
     */
    async pathFor(q) {
      const epoch = q.epoch ?? Math.max(0, ...[...secrets.keys()]
        .filter((k) => k.startsWith(`${q.group}@`))
        .map((k) => Number(k.slice(q.group.length + 1))));
      const nk = await nameKeyFor(q.group, epoch);
      if (nk === null) return null;
      return sealedPath({
        entity: q.entity,
        id: await sealedId({ nameKey: nk, entity: q.entity, name: q.name }),
      });
    },
    /** Open one envelope. @param {Bytes} bytes @param {string} [path] */
    open(bytes, path) { return openEnvelope(bytes, { resolve, path }); },
    /**
     * Register the vault-backed source of subject keys. Called by `shred.js`, which owns the
     * vault format; the keyring only needs "given a key id, get me the bytes or throw".
     * @param {(keyId: string) => Promise<Bytes>} fn
     */
    provideSubjectKeys(fn) { subjectSource = fn; },
    /**
     * Drop a subject key from memory. **Erasure is not complete until this happens**: a destroyed
     * vault file with the key still cached in a running process is not erased, it is merely
     * unsaved. `shred.js` calls it; the tests assert it.
     * @param {string} keyId
     */
    forget(keyId) { subjectCache.delete(keyId); },
    /** Everything currently cached, for a test that wants to prove the cache is empty. */
    cachedSubjectKeys: () => [...subjectCache.keys()],
  };
}
