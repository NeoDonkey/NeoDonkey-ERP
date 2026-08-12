// runtime/git/mesh.js — the repo mesh (FD-3).
//
// Appendix III, line 116: "For very large customers, there are multiple repos, linked by
// cross-references — one per legal entity, one per plant. The global company is a mesh of
// repos, not one giant repo. This matches reality: Bosch does not have *one* journal, it
// has hundreds." FD-3 makes that a foundation decision, because a single-repo assumption
// is the kind of thing that cannot be unpicked once a customer has data in the field.
//
// Two pieces, both deliberately small and declarative:
//
//   1. A cross-reference is the text `<repo-id>:<entity>/<id>`, e.g.
//      `koro-de:invoice/INV-2027-0042`. Without the `<repo-id>:` prefix it is local.
//      It is a *string in a document field*, so it survives in `git show`, in a diff, and
//      in an auditor's text editor. That is the whole design: no foreign keys, no join
//      tables, no resolver embedded in the format.
//
//   2. `repos.json` at the root of each repo names its siblings and, per sibling, the
//      public keys allowed to sign there. Reading a sibling's commit means checking its
//      signature against *that repo's* declared keys — a key that may sign in the German
//      entity is not thereby allowed to sign in the French one.
//
// **In scope: reading across repos.** Consolidation opens many repos, reads, and writes
// its own — Appendix III's "consolidation reads many repos and writes its own".
//
// **Explicitly not in scope: distributed transactions across repos.** There is no
// two-phase commit here and v1.0 will not have one. A business event that must be atomic
// belongs in ONE repo and therefore in one commit (Appendix VIII, the simple case).
// Anything spanning entities is modelled as two events with an explicit reference between
// them — which is also what intercompany accounting does on paper, with a document on
// each side. Pretending otherwise would be the dishonest option: cross-repo atomicity
// needs the authoritative-peer machinery of Appendix VIII, and that is not built.
//
// Pure functions only: no I/O, no clock, no randomness. Resolution returns *where to
// look*; the caller does the reading, because only the caller knows which FsAdapter each
// sibling lives behind.

/** @typedef {{repo: string|null, entity: string, id: string}} Ref */

// A repo id and an entity are slugs: lowercase, because they appear in paths and in file
// names on case-insensitive filesystems, where `Invoice` and `invoice` colliding would be
// a data-loss bug. A document id keeps its case (`INV-2027-0042`, `GR-0001`) since that is
// what humans and tax authorities write, but it may not contain a path separator.
const SLUG = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const DOC_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Parse a cross-reference. Returns null — never a guess — for anything that is not one,
 * so a caller can test a field cheaply without exceptions as flow control. Malformed
 * *looking* references (`:invoice/X`, `a:b/`, `a/b/c`) are null too: Principle 6 says an
 * unknown construction is refused, and a half-understood reference is the worst outcome.
 *
 * @param {string} text
 * @returns {Ref|null}
 */
export function parseRef(text) {
  if (typeof text !== 'string' || text === '') return null;
  let repo = null;
  let rest = text;
  const colon = text.indexOf(':');
  if (colon >= 0) {
    repo = text.slice(0, colon);
    rest = text.slice(colon + 1);
    if (!SLUG.test(repo)) return null;
  }
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const entity = rest.slice(0, slash);
  const id = rest.slice(slash + 1);
  if (!SLUG.test(entity)) return null;
  if (!DOC_ID.test(id)) return null;
  if (rest.indexOf('/', slash + 1) >= 0) return null; // one slash exactly
  return { repo, entity, id };
}

/**
 * The inverse. Validates on the way out, so a malformed reference can never be *written*.
 * @param {Ref} ref
 * @returns {string}
 */
export function formatRef(ref) {
  if (!ref || typeof ref !== 'object') throw new Error('formatRef: expected {repo, entity, id}');
  const { repo = null, entity, id } = ref;
  if (repo !== null && repo !== undefined && !SLUG.test(String(repo))) {
    throw new Error(`formatRef: not a repo id: ${JSON.stringify(repo)}`);
  }
  if (!SLUG.test(String(entity))) throw new Error(`formatRef: not an entity name: ${JSON.stringify(entity)}`);
  if (!DOC_ID.test(String(id))) throw new Error(`formatRef: not a document id: ${JSON.stringify(id)}`);
  const local = `${entity}/${id}`;
  return repo === null || repo === undefined ? local : `${repo}:${local}`;
}

/** The one path convention, shared with git/, read/, polism/ and ui/ (see CONTRACT). */
export function documentPath(entity, id) {
  return `documents/${entity}/${id}.json`;
}

/**
 * Read a `repos.json` manifest.
 *
 * ```json
 * {
 *   "version": 1,
 *   "self": "koro-de",
 *   "repos": [
 *     { "id": "koro-de", "name": "KoRo Handels GmbH", "country": "DE",
 *       "keys": ["ssh-ed25519 AAAA… sarah@koro.de"] },
 *     { "id": "koro-fr", "name": "KoRo France SAS", "country": "FR",
 *       "location": "../koro-fr", "keys": ["ssh-ed25519 AAAA… luc@koro.fr"] }
 *   ]
 * }
 * ```
 *
 * Strict on purpose. An unknown `version` is refused rather than read optimistically; a
 * repo with no `keys` array is refused, because the alternative is a manifest that
 * silently means "anyone may sign in that entity" — precisely the permissive default that
 * was v0.1's worst defect (Part 4, rule 4). An *empty* keys array is allowed and means
 * what it says: nothing in that repo verifies. That fails closed.
 *
 * `location` is an opaque hint for the caller ("where is this sibling") — a relative
 * directory, an OPFS name, a URL. This module never dereferences it, so it cannot become
 * a way to make the manifest execute something.
 *
 * @param {object|string} json the parsed manifest, or its JSON text
 * @returns {{ repos(): object[], self(): string|null, keysFor(repoId: string): string[],
 *             has(repoId: string): boolean, resolve(ref: string|Ref): object }}
 */
export function meshManifest(json) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('meshManifest: repos.json must be a JSON object');
  }
  if (doc.version !== 1) {
    throw new Error(`meshManifest: unsupported repos.json version ${JSON.stringify(doc.version)} (this runtime reads 1)`);
  }
  if (!Array.isArray(doc.repos)) throw new Error('meshManifest: repos.json needs a "repos" array');

  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const entry of doc.repos) {
    if (!entry || typeof entry !== 'object') throw new Error('meshManifest: every repos[] entry must be an object');
    const id = entry.id;
    if (typeof id !== 'string' || !SLUG.test(id)) {
      throw new Error(`meshManifest: not a usable repo id: ${JSON.stringify(id)}`);
    }
    if (byId.has(id)) throw new Error(`meshManifest: repo ${id} is declared twice`);
    if (!Array.isArray(entry.keys)) {
      throw new Error(
        `meshManifest: repo ${id} has no "keys" array. A sibling with no declared signers `
        + 'would mean "any key may sign there", which is refused; use [] to say "none".',
      );
    }
    for (const key of entry.keys) {
      if (typeof key !== 'string' || !/^ssh-[a-z0-9-]+ [A-Za-z0-9+/=]+/.test(key)) {
        throw new Error(`meshManifest: repo ${id} lists something that is not an OpenSSH public key line: ${JSON.stringify(key)}`);
      }
    }
    byId.set(id, Object.freeze({
      id,
      name: typeof entry.name === 'string' ? entry.name : id,
      country: typeof entry.country === 'string' ? entry.country : null,
      location: typeof entry.location === 'string' ? entry.location : null,
      keys: Object.freeze([...entry.keys]),
      // Anything else the manifest carries is passed through untouched rather than
      // dropped, so a v1.1 field survives a v1.0 read (Principle 6, additive direction).
      extra: Object.freeze(
        Object.fromEntries(
          Object.entries(entry).filter(([k]) => !['id', 'name', 'country', 'location', 'keys'].includes(k)),
        ),
      ),
    }));
  }

  const self = typeof doc.self === 'string' ? doc.self : null;
  if (self !== null && !byId.has(self)) {
    throw new Error(`meshManifest: "self" names ${self}, which is not in repos[]`);
  }

  return {
    repos: () => [...byId.values()],
    self: () => self,
    has: (repoId) => byId.has(repoId),

    /**
     * The keys allowed to sign in `repoId`. Throws for an unknown repo: returning [] would
     * be indistinguishable from "declared, with no signers", and a verifier must be able
     * to tell "I do not know this entity" from "this entity trusts nobody".
     * @param {string} repoId @returns {string[]}
     */
    keysFor(repoId) {
      const entry = byId.get(repoId);
      if (!entry) throw new Error(`meshManifest: no repo ${JSON.stringify(repoId)} in this mesh`);
      return [...entry.keys];
    },

    /**
     * Where a cross-reference points. Reading is the caller's job — this returns the
     * sibling's manifest entry, the document path inside it, and whether that is us.
     * @param {string|Ref} ref
     * @returns {{repo: object, entity: string, id: string, path: string, local: boolean, ref: string}}
     */
    resolve(ref) {
      const parsed = typeof ref === 'string' ? parseRef(ref) : (ref && parseRef(formatRef(ref)));
      if (!parsed) throw new Error(`meshManifest.resolve: not a cross-reference: ${JSON.stringify(ref)}`);
      const targetId = parsed.repo ?? self;
      if (targetId === null) {
        throw new Error(
          `meshManifest.resolve: ${formatRef(parsed)} is a local reference, but this repos.json `
          + 'does not say which repo is "self"',
        );
      }
      const entry = byId.get(targetId);
      if (!entry) {
        throw new Error(`meshManifest.resolve: ${formatRef(parsed)} points at repo ${targetId}, which is not in this mesh`);
      }
      return {
        repo: entry,
        entity: parsed.entity,
        id: parsed.id,
        path: documentPath(parsed.entity, parsed.id),
        local: targetId === self,
        ref: formatRef({ repo: targetId, entity: parsed.entity, id: parsed.id }),
      };
    },
  };
}
