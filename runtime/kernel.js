/**
 * NeoDonkey — the kernel. The headless core (Principle 7).
 *
 * Everything above this file is a disposable artifact: the browser UI, an MCP server,
 * an AI conversation, a CLI. They all call the same functions. There is no "UI logic"
 * anywhere else in the system, because there is nothing here that a UI could hold that
 * this file does not already hold.
 *
 * The flow of a business event, end to end:
 *
 *   intent  ──▶ operating model (deterministic rules, Appendix XII)
 *                     │
 *                     ├── refused ──▶ violations, quoted by file and line. No commit.
 *                     │
 *                     └── allowed ──▶ changes (trigger + all consequents)
 *                                          │
 *                                          ▼
 *                              ONE signed git commit (Appendix VIII: atomic by nature)
 *                                          │
 *                                          ▼
 *                              local index updated (a view, never truth)
 *
 * No dependencies. Runs unchanged in Node 22+ and in a browser.
 */

import { initRepo, repo as openRepo } from './git/repo.js';
import { decodeCommit, decodeTree } from './git/objects.js';
import { parseOperatingModel } from './polism/parse.js';
import { evaluate } from './polism/execute.js';
import { materialize, update as updateIndex, parseDocPath } from './read/index.js';
import { session as liveSession } from './live/session.js';
import { hlc } from './live/hlc.js';
import { signPayload, verifyPayload } from './identity/sshsig.js';
import { exportPublicSsh } from './identity/ed25519.js';
import {
  cosignPayload, cosignTrailer, payloadWithCosignatures, verifyCommitSignatures, matchDistinct,
} from './identity/cosign.js';
import {
  SEQUENCE_ENTITY, collectSeries, periodOf, sequenceId, allocate,
  sequenceTrailer, readSequenceTrailers, auditIssuance, assertAuthoritative,
} from './truth/sequence.js';
// Appendix VII, reached from the front door. Nothing below re-implements a single line of
// `runtime/crypto/` — every one of these names is used exactly as that directory defines it, which
// is the whole reason this file grew by options rather than by a subsystem.
import {
  keyringFromRepo, decryptingReader, documentBytes, DEFAULT_NAME_FIELD,
} from './crypto/reader.js';
import {
  createGroup as mintGroup, addMember, removeMember, rotateGroup as mintEpoch,
  offboard as offboardAndReseal, manifestFile,
} from './crypto/groups.js';
import { seal, sealedPath, isEnvelope, inspect as inspectEnvelope } from './crypto/envelope.js';
import {
  createSubjectKey, subjectRecordFile, storeSubjectKey, loadSubjectKey,
  eraseSubject as destroySubjectKey, SUBJECT_FORMAT,
} from './crypto/shred.js';
import {
  CryptoError, CRYPTO_PATHS, enrolment as mintEnrolment, parseJsonBytes,
} from './crypto/keys.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Where things live in the repo. One convention, shared by every module. */
export const PATHS = {
  doc: (entity, id) => `documents/${entity}/${id}.json`,
  peer: (email) => `peers/${email.replace(/[^a-zA-Z0-9._@-]/g, '_')}.json`,
  operatingModel: 'operating-model/',
  /**
   * The workspace's own settings, written in the genesis commit and never afterwards.
   *
   * FD-7: default-deny is a change of *meaning*, so it cannot be a runtime flag that a caller
   * flips — a 2027 folder must keep behaving like a 2027 folder under a 2029 runtime. The
   * setting therefore belongs to the repository, decided once, signed into genesis, and visible
   * to anyone who opens the folder. A workspace created before this file existed has no file,
   * and its absence means exactly what it meant then: default-allow.
   */
  settings: 'neodonkey.json',
  /**
   * Where Appendix VII's public files live: group manifests, enrolments, subject *records*,
   * erasure records. Re-exported from `runtime/crypto/keys.js` rather than restated, because two
   * tables that can disagree about where a group manifest lives is the defect this project has
   * already shipped three times. Nothing in this table is secret and no wrapped subject key is
   * ever written to any path in it — that is the vault's job, and the vault is not the repo.
   */
  crypto: CRYPTO_PATHS,
};

/**
 * The field a decrypted document carries its plaintext name in, once the decrypting reader has put
 * it back. Re-exported so a UI can render "salary 2027-Q3-anna" for a document whose id on disk is
 * a keyed hash, without importing `runtime/crypto/`.
 */
export const SEALED_NAME = DEFAULT_NAME_FIELD;

/** The settings a workspace records about itself at genesis. */
const SETTINGS_VERSION = 1;

/**
 * The marker that says "this directory is the source checkout, not a company". Its only job is to
 * stop `open()` writing a genesis commit into our own repository. See the guard in `open()`.
 */
const DEV_MARKER = '.neodonkey-dev';

/**
 * Does a workspace already exist here? Answered WITHOUT calling initRepo, so the dev-marker guard
 * can refuse before a single byte of `.git/` is written. Deliberately the same resolution
 * `repo.head()` performs — symbolic ref, then the ref file — and nothing more.
 */
async function existingHead(fs) {
  const raw = await fs.read('.git/HEAD');
  if (!raw) return null;
  const text = dec.decode(raw).trim();
  const oid = text.startsWith('ref: ')
    ? dec.decode((await fs.read(`.git/${text.slice(5).trim()}`)) ?? new Uint8Array()).trim()
    : text;
  return /^[0-9a-f]{40}$/.test(oid) ? oid : null;
}

const json = (value) => enc.encode(JSON.stringify(value, null, 2) + '\n');
const unjson = (bytes) => JSON.parse(dec.decode(bytes));

/**
 * Open a NeoDonkey workspace. Creates it if empty (the genesis commit carries the
 * operating model and the opening peer's public key — from that commit on, the repo
 * knows what the company is and who is allowed to speak for it).
 *
 * @param {{
 *   fs: import('./git/fs.js').FsAdapter,
 *   identity: { name: string, email: string, keyPair: CryptoKeyPair },
 *   seed?: Map<string,string>,        // operating-model files for a fresh workspace
 *   clock?: () => number,            // injected: determinism is a non-negotiable
 *   tzOffsetMinutes?: number,
 *   nodeId?: string,
 *   strictAuthorization?: boolean,   // FD-7. Default TRUE for a new workspace; for an existing
 *                                    // one the repo decides and this option may only agree.
 *   sequences?: object,              // FD-6 series declarations, recorded at genesis
 *   fourEyes?: object,               // signature requirements, keyed "<op> <entity>", at genesis
 *   roles?: string[],                // FD-9. The opening peer's roles, recorded in its signed peer
 *                                    // record in the genesis commit — the ROOT GRANT this company's
 *                                    // whole authority tree hangs from. Omit it and the founder
 *                                    // holds nothing and can perform nothing any rule governs;
 *                                    // that is the correct default and it fails closed.
 *   allowDevWorkspace?: boolean,     // bypass the .neodonkey-dev guard. For testing the guard.
 *   encryption?: {privateKey: CryptoKey, publicKey?: CryptoKey, curve?: string},
 *                                    // Appendix VII. This peer's personal X25519 pair, alongside
 *                                    // (never instead of) its Ed25519 signing pair. Supplying it
 *                                    // turns on TWO things and nothing else: the index is built
 *                                    // through a decrypting reader, so this peer indexes exactly
 *                                    // what it can open; and perform({sealFor}) can write sealed
 *                                    // documents. Omit it and the workspace behaves precisely as
 *                                    // it did before this option existed — a sealed document is
 *                                    // opaque and counted, never guessed at.
 *   sealed?: Record<string, string[]>,
 *                                    // Appendix VII. Which entities this company records as
 *                                    // confidential: `{ salary: ['hr'] }`, recorded at genesis and
 *                                    // signed. A caller may then add groups and may never drop
 *                                    // one, and a workspace that declares an entity confidential
 *                                    // refuses to write one at all without a key pair. Same
 *                                    // reasoning as `fourEyes`: a control a caller can relax by
 *                                    // forgetting an argument is not a control.
 *   vault?: object,                  // the ONE mutable store, from `crypto/shred.js`'s vault().
 *                                    // Needed only for shreddable subject keys (GDPR Art. 17).
 *                                    // It must NOT live inside the repository: an append-only
 *                                    // store cannot hold key material you may have to destroy.
 * }} options
 */
export async function open(options) {
  const {
    fs,
    identity,
    seed = null,
    clock = () => Date.now(),
    tzOffsetMinutes = 0,
    nodeId = identity.email,
  } = options;

  const me = { name: identity.name, email: identity.email };
  const keyPair = identity.keyPair;
  const sign = (payload) => signPayload(keyPair, payload, 'git');
  const now = () => Math.floor(clock() / 1000);
  const sharedClock = hlc(nodeId, clock);

  // A workspace must never be created inside the NeoDonkey source checkout. It happened once
  // during v0.1 development: a genesis commit landed on top of our own history and every source
  // file showed as untracked. The guard is an explicit marker file and nothing else — no "does
  // this look like a source tree" heuristic, because Appendix II deliberately allows the runtime
  // to live next to the data in the same repo, so a workspace root holding `runtime/` is
  // legitimate for a real customer. Genesis only: opening an existing workspace is untouched.
  if (options.allowDevWorkspace !== true && await fs.read(DEV_MARKER)) {
    if (!await existingHead(fs)) {
      throw new Error(
        `refusing to create a NeoDonkey workspace here: this directory contains ${DEV_MARKER}, `
        + 'which marks it as the NeoDonkey source checkout rather than a company.\n'
        + '  A workspace written into the source tree hijacks its git repository.\n'
        + '  Use a temp directory (tests), OPFS or a folder the user picked (browser), or an '
        + 'explicit path (mcp/server.mjs, demo/sarah.mjs).\n'
        + '  Pass allowDevWorkspace: true only to test this guard itself.');
    }
  }

  await initRepo(fs);
  const repo = openRepo(fs);

  /** Full working state of the repo as path -> bytes. The commit unit is the whole tree. */
  let files = new Map();
  let head = await repo.head();

  /** @type {object} the workspace's recorded settings; frozen once read. */
  let settings;

  if (head) {
    for (const [path, oid] of await repo.readTreeAtHead()) {
      files.set(path, await repo.readBlob(oid));
    }
    settings = readSettings(files, options);

    // The setting is read from HEAD, because a company must be able to change it — but only as a
    // visible, signed act, never by quietly editing a file. So a workspace that once recorded a
    // setting is checked against its own genesis commit, and a *weakening* (strict → permissive)
    // is refused. Strengthening is allowed, and recorded as a warning.
    //
    // The genesis walk costs a full log traversal, so it only runs in the one case that could hide
    // the attack: a settings file that says permissive. A strict workspace and a pre-strict
    // workspace with no file at all both skip it.
    if (settings.neodonkey >= SETTINGS_VERSION && !settings.authorization.strict) {
      const genesis = (await repo.log(Infinity)).at(-1);
      if (genesis && /^NeoDonkey-Authorization: strict$/m.test(genesis.message)) {
        throw new Error(
          `${PATHS.settings} says authorization.strict = false, but this workspace's genesis commit `
          + `(${genesis.oid}) records "NeoDonkey-Authorization: strict".\n`
          + '  The setting decides what every rule in the model means, so weakening it is refused '
          + 'rather than honoured. Whoever changed it did so in a signed commit — find it with '
          + `\`git log -p -- ${PATHS.settings}\` — and revert it, or start a new workspace.`);
      }
    }
  } else {
    // Genesis. Appendix X, day 1: she types her name, a key pair is generated, and she
    // exists in the NeoDonkey universe. Everything she does from now on is signed.
    const publicSsh = await exportPublicSsh(keyPair, me.email);
    files.set(PATHS.peer(me.email), json({
      name: me.name, email: me.email, publicKeySsh: publicSsh, joinedAt: now(),
      ...(options.roles ? { roles: [...options.roles] } : {}),
    }));
    settings = Object.freeze({
      neodonkey: SETTINGS_VERSION,
      authorization: { strict: options.strictAuthorization !== false },
      sequences: options.sequences ? { ...options.sequences } : {},
      fourEyes: options.fourEyes ? { ...options.fourEyes } : {},
      sealed: options.sealed ? { ...options.sealed } : {},
    });
    files.set(PATHS.settings, json(settings));
    if (seed) {
      for (const [path, text] of seed) files.set(path, enc.encode(text));
    }
    head = await repo.commit({
      files, message: genesisMessage(me, settings, options.roles), author: me,
      time: now(), tzOffsetMinutes, sign,
    });
    await repo.checkout();
  }

  // ---- the operating model: the company as text, parsed into executable rules
  let model, modelErrors, modelWarnings;
  const loadModel = () => {
    const sources = new Map();
    for (const [path, bytes] of files) {
      if (path.startsWith(PATHS.operatingModel) && path.endsWith('.md')) {
        sources.set(path, dec.decode(bytes));
      }
    }
    const parsed = parseOperatingModel(sources);
    model = parsed.model;
    modelErrors = parsed.errors.filter((e) => e.severity === 'error');
    // A warning nobody can read is the same as no warning. The shipped model has 20 of them,
    // each saying "this rule will never fire" — which is exactly the kind of thing a COO must
    // be able to see, so they are part of the public surface, not a parser detail.
    modelWarnings = parsed.errors.filter((e) => e.severity !== 'error');
    series = null;   // the model may declare number series; recompute lazily
    return parsed;
  };

  // ---- the read path: a view, always rebuildable from git
  const warnings = [];

  // ---- FD-6: the number series this workspace knows about, from the model then the settings.
  /** @type {Map<string, import('./truth/sequence.js').SeriesDeclaration>|null} */
  let series = null;
  const seriesMap = () => {
    if (!series) {
      const got = collectSeries(model, settings);
      series = got.series;
      for (const message of got.errors) {
        if (!warnings.some((w) => w.message === message)) {
          warnings.push({ at: 'sequences', message });
        }
      }
    }
    return series;
  };
  const seriesFor = (entity) => {
    for (const decl of seriesMap().values()) if (decl.entity === entity) return decl;
    return null;
  };

  // -------------------------------------------------------------------------------------------
  // Appendix VII — the front door.
  //
  // COMPROMISES #5, narrowed by agent CRYPTO to exactly this: `runtime/crypto/` was finished and
  // proven, and `kernel.open()` hard-coded `readBlob: (oid) => repo.readBlob(oid)` so nothing in it
  // was reachable from the product. Encryption worked at the layer and not through the front door,
  // which is the fourth time this project has built a capability with no way in.
  //
  // Two substitutions close it, and they are deliberately the *only* two:
  //
  //   READING   the index's `readBlob` is wrapped by `decryptingReader`. That is the entire
  //             mechanism. The read path was built so decryption is not a parameter of it
  //             ("Decryption is not implemented here and must not be. It is injected"), so a peer
  //             indexes what it can open and — because the read path only ever creates an entity
  //             bucket for a document it could *read* — the entity bucket for what it cannot open
  //             is never created. Absent, not filtered.
  //
  //   WRITING   `perform({sealFor})` seals what the commit writes. Declarative: the caller names
  //             groups, never keys, epochs or paths. Auditable: the sealing lands in a
  //             `NeoDonkey-Sealed:` trailer inside the signed payload, and is independently
  //             readable from the blob's own public header (`inspectSealed()`), so "which groups
  //             could open this document" is answerable in 2057 by someone who does not trust us.
  //             And it is not forgettable: `neodonkey.json`'s `sealed` table, signed into genesis,
  //             records which entities are confidential, so a caller can widen that and never
  //             narrow it (`requiredSealing()`). A control you defeat by leaving out an argument
  //             would be the fifth half-capability in this project, not the first.
  //
  // Everything else here is group administration — create, add, remove, rotate, offboard, erase —
  // each as one signed commit, because access control that is not in `git log` is not auditable.
  // Every one of them delegates to `runtime/crypto/groups.js` or `shred.js`; this file contains no
  // cryptography and must never contain any.
  // -------------------------------------------------------------------------------------------

  const encryption = options.encryption ?? null;
  const theVault = options.vault ?? null;

  /** @type {object|null} what this peer can unwrap, rebuilt whenever a manifest changes. */
  let keyring = null;
  /** @type {ReturnType<typeof decryptingReader>|null} the reader the last full build went through. */
  let sealedReads = null;
  /** The commit that build read, which is NOT `index.stats().builtFrom` once an update has run. */
  let sealedReadsAt = null;

  /**
   * (Re)build the keyring from the manifests in `files`.
   *
   * A manifest that cannot be parsed **refuses**, and the refusal is propagated rather than
   * softened, because agent CRYPTO's reasoning is the load-bearing part: *"skipping it would
   * silently downgrade this peer to a non-member"* — and a peer that silently believes it is not in
   * the HR group builds an index with no salaries in it and reports no problem at all. A workspace
   * that will not open is a loud, fixable state; a workspace that opens with less in it than it
   * should have is neither.
   */
  async function rebuildKeyring() {
    if (!encryption) { keyring = null; return null; }
    try {
      keyring = await keyringFromRepo({
        files, principal: me.email, encryption, ...(theVault ? { vault: theVault } : {}),
      });
    } catch (e) {
      if (!(e instanceof CryptoError)) throw e;
      throw new Error(
        `this workspace's encryption groups cannot be read, so it will not open: ${e.message}\n`
        + '  A group manifest that cannot be parsed is refused rather than skipped: skipping it '
        + 'would silently downgrade this peer to a non-member, and an index that is quietly missing '
        + 'every salary reports no problem at all.\n'
        + `  The file is in the history — \`git log -p -- ${CRYPTO_PATHS.group('')}\` — so repair it `
        + 'there rather than working around it.');
    }
    return keyring;
  }

  await rebuildKeyring();

  loadModel();
  let index = await buildIndex(head);

  /**
   * Plaintext for documents this peer sealed in the commit it is currently writing, keyed by the
   * sealed path. The incremental index update reads through it, so a member's own index carries the
   * document it just wrote instead of the envelope bytes now on disk.
   *
   * This is not a cache and never survives a commit: it is cleared as soon as the update that
   * consumes it is done. Decrypting bytes we encrypted a microsecond ago would be the same work
   * twice with a second chance to disagree.
   */
  const stagedPlain = new Map();

  async function buildIndex(builtFrom) {
    // The one substitution. `keyring === null` reproduces v0.1 byte for byte.
    const plainReader = async (oid) => await repo.readBlob(oid);
    sealedReads = keyring
      ? decryptingReader({ readBlob: plainReader, keyring, nameField: SEALED_NAME })
      : null;
    const at = builtFrom ?? await repo.head();
    sealedReadsAt = at;
    return materialize({
      readTree: async () => await repo.readTreeAtHead(),
      readBlob: sealedReads ?? plainReader,
      builtFrom: at,
    });
  }

  /** What the rule engine is allowed to see. Backed by the index, never by the UI. */
  const world = () => ({
    get: (entity, id) => index.get(entity, id),
    find: (entity, pred) => index.where(entity, pred),
  });

  // -------------------------------------------------------------------------------------------
  // One writer at a time. Every commit reads HEAD, the index and the number sequences, then
  // writes all three; two overlapping perform() calls would interleave those reads and issue the
  // same document number twice. This is not a lock in the database sense — it is the statement
  // that a peer produces one commit per business event, serially (Appendix VIII, simple case).
  // -------------------------------------------------------------------------------------------
  let queue = Promise.resolve();
  const serialized = (work) => {
    const run = queue.then(work, work);
    // Keep the chain alive whatever `work` does, without swallowing the caller's result.
    queue = run.then(() => undefined, () => undefined);
    return run;
  };

  // -------------------------------------------------------------------------------------------
  // FD-7 — the kernel side of default-deny.
  //
  // COMPROMISES #4c-bis, verified against the real 28-rule model: an actor with NO ROLES could
  // create, update and delete any entity no rule happens to mention. The hole is not in any
  // module; it is in the *default*, which is why 213 tests never asked about it (standing rule 4:
  // ask what happens when nothing applies).
  //
  // Coverage is the boundary. An (entity, operation) pair is governed if a rule triggers on it,
  // or if the entity declares a default authority for that operation. In a strict workspace,
  // anything else is refused by name — the entity, the operation, and the file to edit.
  // -------------------------------------------------------------------------------------------

  /**
   * Read an entity-level authority declaration. Grammar v2 (agent G2) is growing
   * `## Authorized by` scoped per operation on an entity file; the shape is read tolerantly here
   * so the kernel gains the enforcement the moment the parser gains the section, and neither
   * agent has to edit the other's file. Tracks `runtime/polism/grammar.md` §6.
   *
   * @returns {{covered:boolean, roles:string[]|null, at:string|null}}
   */
  function entityAuthority(def, op) {
    if (!def) return { covered: false, roles: null, at: null };
    let at = def.source ? `${def.source.file}:${def.source.line}` : null;
    // grammar.md §16.1 as agent G2 landed it: `def.authority = { byOp, source }`. The older and
    // looser shapes are kept because the coverage boundary must not depend on which day this file
    // and grammar.md were last read.
    const candidates = [
      def.authority && def.authority.byOp,
      def.operationAuthority,
      def.authority,
      def.authorizedBy,
    ];
    if (def.authority && def.authority.source) {
      at = `${def.authority.source.file}:${def.authority.source.line}`;
    }
    // grammar v2's per-operation value is `{ roles, line }`; older sketches used a bare list.
    // One reader for both, so the coverage boundary never depends on which it is.
    const rolesOfEntry = (entry) => {
      if (!entry) return null;
      if (Array.isArray(entry)) return [...entry];
      if (Array.isArray(entry.roles)) return [...entry.roles];
      return null;
    };
    const lineOfEntry = (entry) => (entry && Number.isInteger(entry.line) ? entry.line : null);

    for (const raw of candidates) {
      if (!raw) continue;
      const entry = raw instanceof Map
        ? (raw.has(op) ? raw.get(op) : raw.get('*'))
        : (Array.isArray(raw) ? raw
          : (Object.prototype.hasOwnProperty.call(raw, op) ? raw[op] : raw['*']));
      const roles = rolesOfEntry(entry);
      if (!roles) continue;
      const line = lineOfEntry(entry);
      const where = line !== null && def.authority && def.authority.source
        ? `${def.authority.source.file}:${line}` : at;
      return { covered: true, roles, at: where };
    }
    return { covered: false, roles: null, at };
  }

  /** Does any rule in the model speak about this operation on this entity? */
  const rulesFor = (entity, op) =>
    model.processes.filter((r) => r.trigger.op === op && r.trigger.entity === entity);

  /**
   * Does this rule carry authority *anywhere* — resolved scope (grammar v2: arm, rule, file), or
   * the version-1 file list?
   *
   * grammar.md §16.2 defines an uncovered pair as one where "no rule that matches it has any
   * effective authority and the entity declares none", so a matching rule with no `## Authorized
   * by` at all does NOT cover the operation. That is the stricter and the correct reading: a rule
   * that says what must happen but never says who may do it has not authorized anybody.
   */
  function ruleHasAuthority(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 4) return false;
    if (Array.isArray(node.authorizedBy) && node.authorizedBy.length) return true;
    if (node.authority) {
      if (Array.isArray(node.authority.roles) && node.authority.roles.length) return true;
      if (Array.isArray(node.authority) && node.authority.length) return true;
    }
    if (node.fileAuthority && Array.isArray(node.fileAuthority.roles)
        && node.fileAuthority.roles.length) return true;
    for (const key of ['arms', 'branches', 'consequents']) {
      const list = node[key];
      if (Array.isArray(list) && list.some((n) => ruleHasAuthority(n, depth + 1))) return true;
    }
    return false;
  }

  /**
   * The coverage verdict for one (entity, operation) pair, whatever the setting says. Exposed on
   * the kernel so a UI can show a company where its own authorization boundary runs.
   */
  function coverage(entity, op) {
    const byRule = rulesFor(entity, op).filter(ruleHasAuthority);
    if (byRule.length) {
      return {
        covered: true, by: 'rule', roles: null,
        at: `${byRule[0].source.file}:${byRule[0].source.line}`,
      };
    }
    const def = model.entities.get(entity);
    const ent = entityAuthority(def, op);
    if (ent.covered) return { covered: true, by: 'entity', roles: ent.roles, at: ent.at };
    return {
      covered: false, by: null, roles: null,
      at: def && def.source ? def.source.file : `operating-model/information/${entity}.md`,
    };
  }

  /**
   * The refusal FD-7 asks for: loud, and naming the file to edit. Returns null when the
   * operation is permitted.
   */
  function checkAuthorization(entity, op, actorRoles, grounded = null) {
    // Only the INTENT is checked, never the consequents a rule produces. A consequent is
    // authorized by the rule that demanded it — the company's own sentence said this must happen
    // — so requiring it to be separately covered would make every rule with a consequence
    // unusable and teach authors to write ceremony instead of meaning (Principle 11).
    //
    // `Read` is deliberately out of scope in v1.0. `Read` rules authorize but do not filter
    // visibility (COMPROMISES #4f), and the read index hands documents to the UI without going
    // through perform() at all — so refusing an ungoverned read here would be theatre while the
    // document stayed readable. Named rather than quietly skipped.
    if (op === 'read') return null;

    const c = coverage(entity, op);
    if (!c.covered) {
      if (!settings.authorization.strict) return null;
      return {
        reason: `nothing in this company's operating model says who may ${op} ${article(entity)} `
          + `${entity}, so nobody may.\n`
          + `  This workspace runs with strict authorization (neodonkey.json: `
          + `authorization.strict = true), which means an operation no rule and no entity default `
          + `governs is refused rather than allowed.\n`
          + `  To permit it, say so in the company's own words — add a rule under "## Rules", or `
          + `an entity default:\n`
          + `    ${c.at}\n`
          + `    ## Authorized by\n`
          + `    - ${op}: <role>\n`,
        at: c.at, entity, operation: op, code: 'not-authorized-by-anything',
      };
    }
    // FD-9's stated consequence, said out loud at the one place a person will read it: a peer with
    // no recorded roles can perform nothing that any rule governs. Refused HERE rather than left
    // to the rule engine, because the rule engine can only say "someone with no role may not do
    // this" — true, unhelpful, and it names the rule when the thing to fix is the peer record.
    if (grounded && grounded.recorded === false) {
      return {
        reason: `${op} ${article(entity)} ${entity} is governed by this company's operating model, `
          + `and ${PATHS.peer(me.email)} records no roles for ${me.email} — so they may not do it.\n`
          + `  ${c.at} decides who may`
          + `${c.by === 'entity' && c.roles && c.roles.length ? `: ${c.roles.join(' or ')}` : ''}.\n`
          + '  This is not a lost permission; it is a permission that was never granted. Until FD-9 '
          + 'a caller could simply assert a role and be believed, so a workspace could run for '
          + 'months without anyone recording who holds what.\n'
          + grantHint(me.email),
        at: c.at, entity, operation: op, code: 'roles-not-recorded', principal: me.email,
      };
    }
    // A rule-level authority is enforced by the rule engine. An entity-level default has no rule
    // to enforce it, so the kernel does — otherwise declaring one would weaken the model.
    if (c.by === 'entity' && c.roles && c.roles.length
        && !c.roles.some((r) => actorRoles.includes(r))) {
      return {
        reason: `${actorRoles.length ? `someone whose role is ${actorRoles.map((r) => `"${r}"`).join(' / ')}` : 'someone with no role'} `
          + `may not ${op} ${article(entity)} ${entity}.\n`
          + `  ${c.at} says:\n    ## Authorized by\n    - ${op}: ${c.roles.join(' or ')}`
          // FD-9: say where the acting roles came from, so the reader knows whether to fix the
          // call (a narrower claim than they hold) or the grant (a role nobody recorded).
          + (grounded
            ? `\n  ${me.email} acts with ${actorRoles.length ? actorRoles.map((r) => `"${r}"`).join(', ') : 'no role'}`
              + `${grounded.claimed === null ? ' (every role recorded for them)' : ' (their own claim, narrowed to what the repository records)'}`
              + `, from ${PATHS.peer(me.email)}.`
            : ''),
        at: c.at, entity, operation: op, code: 'not-authorized-by-entity-default',
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Four-eyes — the signature side. Manifesto line 114, COMPROMISES #4d.
  // -------------------------------------------------------------------------------------------

  /** The public key this repository holds for a principal, or null. Truth, not assertion. */
  function peerKey(principal) {
    const bytes = files.get(PATHS.peer(principal));
    if (!bytes) return null;
    try { return unjson(bytes).publicKeySsh ?? null; } catch { return null; }
  }

  /** The roles this repository records for a principal, if it records any. */
  function peerRoles(principal) {
    const bytes = files.get(PATHS.peer(principal));
    if (!bytes) return null;
    try {
      const rec = unjson(bytes);
      return Array.isArray(rec.roles) ? rec.roles : null;
    } catch { return null; }
  }

  // -------------------------------------------------------------------------------------------
  // FD-9 — a caller's roles are the INTERSECTION of what it claims and what the repo records.
  //
  // Before this, `intent.actorRoles` was a claim the caller made about itself: the kernel
  // enforced it faithfully and then trusted it completely, so `perform({actorRoles:
  // ['managing-director']})` from any script, any MCP client, any browser tab *was* a managing
  // director (COMPROMISES #21). Signature requirements were already repo-backed; ordinary rule
  // authorisation was not. Two mechanisms, two trust levels, one of them decorative.
  //
  // Roles now come from the acting peer's signed peer record. The caller may NARROW — a managing
  // director deliberately acting as a warehouse clerk is legitimate, and it is how a careful
  // operator tests a rule — and may never WIDEN. Intersection, never replacement: replacement
  // would let an empty claim mean "all my roles", which silently widens authority in exactly the
  // dangerous direction.
  //
  // Three things this file does NOT do, deliberately:
  //   - it does not fall back to the claim when the record is silent. FD-9: "a peer with no
  //     recorded roles can perform nothing that any rule governs, which is the correct default
  //     and will look like a regression to anyone who was relying on the claim." Fail closed.
  //   - it does not change what any rule MEANS. FD-7 needed a repo-recorded setting because
  //     flipping default-allow changes the meaning of a 2027 folder. FD-9 changes only whose word
  //     counts for *identity*, which is a property of the runtime and not of the folder — so it
  //     is unconditional, and gating it on a file the caller's own workspace controls would be
  //     absurd for a fix whose whole point is that self-assertion is worthless.
  //   - it does not reach into `runtime/polism/`. `evaluate()` keeps its version-1 contract and
  //     is simply handed a grounded role set instead of a claimed one.
  // -------------------------------------------------------------------------------------------

  /** How a company grants a role. Quoted by every refusal a missing grant caused. */
  const grantHint = (principal) =>
    `  Roles are granted by recording them on the peer, in a signed commit:\n`
    + `      kernel.grantRoles(${JSON.stringify(principal)}, ['<role>'])\n`
    + `      kernel.addPeer({ name, email: ${JSON.stringify(principal)}, publicKeySsh, `
    + `roles: ['<role>'] })\n`
    + `  The grant lands in ${PATHS.peer(principal)} and is visible in \`git log\`. A peer whose\n`
    + `  record carries no roles holds no authority at all — that is FD-9, and it fails closed on\n`
    + `  purpose, because a role a caller merely claims is not a control.`;

  /**
   * What the repository records about one principal's authority.
   *
   * Four distinguishable states, because each needs its own refusal and because collapsing any
   * two of them is how "fail closed" quietly becomes "fail open":
   *   - `present: false`      no peer record at all — nobody has introduced this peer
   *   - `unreadable: true`    a record we cannot parse — never read as "therefore unrestricted"
   *   - `recorded: false`     a record with no `roles` array — holds nothing (FD-9's default)
   *   - `recorded: true`      a record that grants exactly these roles
   */
  function recordedRoles(principal) {
    const bytes = files.get(PATHS.peer(principal));
    if (!bytes) return { roles: [], recorded: false, present: false, unreadable: false };
    let rec;
    try { rec = unjson(bytes); } catch {
      return { roles: [], recorded: false, present: true, unreadable: true };
    }
    if (!Array.isArray(rec.roles)) {
      return { roles: [], recorded: false, present: true, unreadable: false };
    }
    const roles = [...new Set(rec.roles.filter((r) => typeof r === 'string' && r !== ''))];
    return { roles, recorded: true, present: true, unreadable: false };
  }

  /**
   * FD-9 in one function. Returns either `{ roles, held, claimed, recorded }` or `{ refusal }`.
   *
   * **Refuse, do not intersect silently, when the claim exceeds the record.** Four reasons, and
   * the fourth is a precedent in this same file:
   *
   *  1. A silent intersection makes two very different situations indistinguishable. A typo
   *     (`accountants` for `accountant`) and an attacker probing for `managing-director` both come
   *     back as "the rule refused you" — a diagnostic that names the *rule* when the actual cause
   *     is the *claim*. Principle 6 says a refusal names the real cause, in the caller's terms.
   *  2. It is unstable under model change. A superset claim succeeds while no rule happens to need
   *     the excess role and starts failing, with an unrelated message, the day one does. The blast
   *     radius of the bug becomes a function of when you look.
   *  3. It costs nothing legitimate. Every legitimate narrowing is *by definition* a subset, so
   *     refusing a non-subset removes no capability whatsoever — it only removes the ability to be
   *     sloppy about which authority you are exercising.
   *  4. `readSettings()` below already decided this exact question the same way: a caller whose
   *     `strictAuthorization` contradicts the record is refused rather than quietly overruled,
   *     because "a silent disagreement about a security setting is the exact class of defect
   *     #4c-bis was." A claim of authority is a security setting.
   *
   * And the meaning of the claim itself, which is where "intersection, never replacement" bites:
   *   - `actorRoles` OMITTED = no claim at all ⇒ act with everything the repo records for me.
   *     Safe by construction: it can never exceed the record.
   *   - `actorRoles: []` = a deliberate claim to no role ⇒ act with no role. This is narrowing to
   *     nothing, which is the *safe* direction, and it is why the empty array must not be read as
   *     "all of them" (FD-9 names that specific mistake).
   */
  function groundRoles(intent) {
    const held = recordedRoles(me.email);
    if (!held.present) {
      return { refusal: {
        reason: `this workspace holds no peer record for ${me.email} (${PATHS.peer(me.email)}), so `
          + 'it records no authority for them and they may perform nothing that any rule governs.\n'
          + '  A peer nobody has introduced is not a peer with unlimited rights; it is a peer with '
          + 'none. Reading the company is unaffected.\n'
          + grantHint(me.email),
        code: 'peer-record-missing', principal: me.email, at: PATHS.peer(me.email),
      } };
    }
    if (held.unreadable) {
      return { refusal: {
        reason: `${PATHS.peer(me.email)} is not readable JSON, so this workspace cannot say which `
          + `roles ${me.email} holds.\n`
          + '  An unreadable peer record means NO authority, never full authority. Repair the file '
          + '(it is in the git history: `git log -p -- '
          + `${PATHS.peer(me.email)}\`) rather than working around it.`,
        code: 'peer-record-unreadable', principal: me.email, at: PATHS.peer(me.email),
      } };
    }

    const claimed = Array.isArray(intent.actorRoles)
      ? [...new Set(intent.actorRoles.map((r) => String(r)).filter((r) => r !== ''))]
      : null;

    if (claimed === null) {
      // No claim made. Act as this peer, with exactly what the repository grants it.
      return { roles: [...held.roles], held: held.roles, claimed: null, recorded: held.recorded };
    }

    const excess = claimed.filter((r) => !held.roles.includes(r));
    if (excess.length) {
      return { refusal: {
        reason: `${me.email} asked to act as `
          + `${excess.map((r) => `"${r}"`).join(' / ')}, and `
          + `${PATHS.peer(me.email)} does not record that role for them.\n`
          + `  Recorded: ${held.roles.length ? held.roles.map((r) => `"${r}"`).join(', ') : 'no roles at all'}. `
          + `Claimed: ${claimed.map((r) => `"${r}"`).join(', ')}.\n`
          + '  A caller may narrow its authority (claim a subset, which is how you test a rule as '
          + 'somebody else) but never widen it. The claim is refused rather than quietly reduced, '
          + 'because a caller asking for authority it does not hold is either a bug or an attack, '
          + 'and both deserve to be visible.\n'
          + grantHint(me.email),
        code: 'roles-not-held', principal: me.email, at: PATHS.peer(me.email),
        claimed, recorded: held.roles, notHeld: excess,
      } };
    }
    return { roles: claimed, held: held.roles, claimed, recorded: held.recorded };
  }

  // -------------------------------------------------------------------------------------------
  // FD-9, the historical half. "Did the author actually hold the roles the rule required at the
  // time?" is the question an audit trail either answers or is weaker than we have been implying.
  //
  // It is answerable, from two independent sources that must agree:
  //   (1) the `NeoDonkey-Actor-Roles` trailer, inside the payload the author's own signature
  //       covers — so it cannot be edited after the fact without breaking the signature;
  //   (2) `peers/<author>.json` **as it stood in that commit's own tree**, which is the record the
  //       kernel actually grounded against at the time.
  // Neither alone is enough: (1) is what we claim, (2) is what the company recorded, and an audit
  // that cannot cross-check them is taking our word for it.
  // -------------------------------------------------------------------------------------------

  /**
   * `peers/` as it stood in one commit's tree: email → recorded roles (or null where the record
   * carries none). Cached on the `peers` SUBTREE oid rather than the root tree, because the root
   * changes on every commit while `peers/` changes only when somebody is added or granted — so a
   * 1 000-commit history costs about one object read per commit, not a full tree walk each time.
   */
  const peersAtCache = new Map();
  async function peersAtCommit(oid) {
    const { type, content } = await repo.store.read(oid);
    if (type !== 'commit') throw new Error(`peersAtCommit: ${oid} is a ${type}, not a commit`);
    const rootOid = decodeCommit(content).tree;
    const root = await repo.store.read(rootOid);
    const entry = decodeTree(root.content).find((e) => e.name === 'peers');
    if (!entry) return new Map();
    if (peersAtCache.has(entry.oid)) return peersAtCache.get(entry.oid);
    const out = new Map();
    const sub = await repo.store.read(entry.oid);
    for (const e of decodeTree(sub.content)) {
      if (!e.name.endsWith('.json')) continue;
      let rec;
      try { rec = unjson(await repo.readBlob(e.oid)); } catch { continue; }
      if (typeof rec.email !== 'string') continue;
      out.set(rec.email, Array.isArray(rec.roles) ? [...rec.roles] : null);
    }
    peersAtCache.set(entry.oid, out);
    return out;
  }

  /** The `NeoDonkey-Actor-Roles` trailer of a commit message; null when there is none. */
  function actorRolesTrailer(message) {
    const m = /^NeoDonkey-Actor-Roles:[ \t]*(.*)$/m.exec(String(message ?? ''));
    if (!m) return null;
    const value = m[1].trim();
    if (value === '' || value === '(none)') return [];
    return value.split(/\s+/);
  }

  /**
   * The authority question for one commit, answered from the repo and nothing else.
   *
   * `agree` is the one an auditor cares about: were the roles this commit says its author acted
   * with a subset of the roles the company had recorded for them at that moment? `null` means the
   * question does not apply — a commit written before FD-9 carries no trailer, and saying "no"
   * about it would be a false accusation while saying "yes" would be a false assurance.
   */
  async function authorityAtCommit(commit) {
    const claimed = actorRolesTrailer(commit.message);
    let recorded = null;
    let problem = null;
    try {
      recorded = (await peersAtCommit(commit.oid)).get(commit.author.email) ?? null;
    } catch (e) { problem = e.message; }
    const agree = claimed === null || recorded === null
      ? null
      : claimed.every((r) => recorded.includes(r));
    return {
      actor: commit.author.email,
      actedWith: claimed,          // from the signed payload; null = commit predates FD-9
      recordedAtCommit: recorded,  // from peers/<author>.json in this commit's own tree
      agree,
      ...(problem ? { problem } : {}),
    };
  }

  /**
   * Normalise `intent.signers`.
   *
   * Shape: `[{ principal, roles?, keyPair? }]`, in co-signing order. The entry for this peer is
   * the PRIMARY signature (the `gpgsig` header) and needs no key pair — the kernel already holds
   * it. Every other entry must carry a key pair, because a co-signature is a signature: we do
   * not accept an assertion that someone approved.
   *
   * Omitting `signers` entirely reproduces v0.1 exactly: one signer, this peer, its roles taken
   * from `intent.actorRoles`. Additive, so every existing caller is untouched.
   *
   * FD-9: `groundedRoles` is what `groundRoles()` returned for THIS peer — claimed ∩ recorded,
   * already checked. It is passed in rather than re-derived so that there is one grounding in the
   * kernel and not two that can disagree.
   */
  async function normalizeSigners(intent, groundedRoles = null) {
    const actorRoles = groundedRoles ?? (Array.isArray(intent.actorRoles) ? intent.actorRoles : []);
    const declared = Array.isArray(intent.signers) && intent.signers.length
      ? intent.signers
      : [{ principal: me.email, roles: actorRoles }];

    /** @type {{principal:string, roles:string[], keyPair:object|null, isPrimary:boolean}[]} */
    const signers = [];
    const problems = [];
    let sawPrimary = false;

    for (const raw of declared) {
      const principal = typeof raw === 'string' ? raw : raw && raw.principal;
      if (typeof principal !== 'string' || principal === '') {
        problems.push({ reason: 'a signer without a principal cannot be a signer.' });
        continue;
      }
      const isPrimary = principal === me.email;
      if (isPrimary) {
        if (sawPrimary) {
          problems.push({
            reason: `${principal} is listed twice among the signers. Four eyes means two people; `
              + 'the same principal signing twice is one person signing twice.',
            code: 'duplicate-signer',
          });
          continue;
        }
        sawPrimary = true;
      }
      const kp = isPrimary ? keyPair : (raw && raw.keyPair) || null;
      if (!isPrimary && !kp) {
        problems.push({
          reason: `${principal} is required to co-sign this commit, but no signing key was `
            + 'offered for them. A co-signature is a signature — an assertion that somebody '
            + 'approved is what four-eyes exists to replace.',
          code: 'cosigner-cannot-sign',
        });
        continue;
      }
      const recorded = peerRoles(principal);
      signers.push({
        principal,
        // The repository's own record wins over anything a caller says, always. FD-9 closes the
        // last hole here too: where the repo records no roles, a co-signer's claimed roles used to
        // be carried at the same trust level `actorRoles` had, and are now simply nothing. They
        // could never satisfy a role-based requirement anyway — `checkRequirement` refuses
        // `roles-not-recorded` first — so keeping them only made the report look stronger than it
        // was. The primary's roles are already grounded by `groundRoles()`.
        roles: isPrimary ? actorRoles : (recorded ?? []),
        rolesRecorded: Array.isArray(recorded),
        keyPair: kp,
        isPrimary,
      });
    }

    // The primary signature is this peer's, always: it is the peer that writes the commit.
    if (!sawPrimary) {
      const recorded = peerRoles(me.email);
      signers.push({
        principal: me.email, roles: recorded ?? actorRoles,
        rolesRecorded: Array.isArray(recorded), keyPair, isPrimary: true,
      });
    }

    // Duplicate principals among co-signers.
    const seen = new Set();
    for (const s of signers) {
      if (seen.has(s.principal)) {
        problems.push({
          reason: `${s.principal} is listed twice among the signers. Two signatures from one `
            + 'principal are one pair of eyes.',
          code: 'duplicate-signer',
        });
      }
      seen.add(s.principal);
    }

    // Every signer's key must be the key this repository already knows for them, and it must
    // differ from every other signer's. Checked BEFORE anything is written, so a bad set of
    // signers is a refusal and never a commit we then have to explain afterwards.
    //
    // Only done when somebody other than this peer is signing. Two reasons, both deliberate:
    // a single-signer commit is exactly what v0.1 wrote and must keep working byte for byte
    // (this is the ONLY path the UI, the MCP server and the demo use), and a peer record holding
    // a superseded key is a key-rotation problem, not a reason to refuse to record a fact — it is
    // reported by `verify()` as `bad`, which is where a signature verdict belongs.
    if (signers.some((s) => !s.isPrimary)) {
      const byKey = new Map();
      for (const s of signers) {
        let line;
        try { line = await exportPublicSsh(s.keyPair, s.principal); } catch {
          problems.push({
            reason: `the key offered for ${s.principal} is not a usable Ed25519 key pair.`,
            code: 'cosigner-cannot-sign',
          });
          continue;
        }
        const wire = line.split(/\s+/).slice(0, 2).join(' ');
        const known = peerKey(s.principal);
        if (!known) {
          problems.push({
            reason: `this repository holds no public key for ${s.principal} `
              + `(${PATHS.peer(s.principal)}), so a signature from them cannot be checked by `
              + 'anyone who opens this folder. Add the peer before asking them to sign.',
            code: 'unknown-signer',
          });
        } else if (known.split(/\s+/).slice(0, 2).join(' ') !== wire) {
          problems.push({
            reason: `the key offered for ${s.principal} is not the key `
              + `${PATHS.peer(s.principal)} records for them.`,
            code: 'wrong-key',
          });
        }
        const already = byKey.get(wire);
        if (already) {
          problems.push({
            reason: `${s.principal} and ${already} would sign with the same key. One key is one `
              + 'pair of eyes, whatever name it signs under.',
            code: 'same-key-twice',
          });
        }
        byKey.set(wire, s.principal);
      }
    }

    return { signers, problems };
  }

  /**
   * What does this operation require in the way of signatures?
   *
   * Three sources, most authoritative first. (1) and (2) are grammar v2 shapes — the model is
   * where this belongs (Principle 11), and `## Authorized by a and b`, refused at parse time in
   * v0.1 precisely so it could never mean `or` (COMPROMISES #4d), becomes an acceptance the
   * moment the parser emits it. (3) is the workspace's recorded settings, which is how v1.0 can
   * enforce four-eyes before the grammar can express it: data in the repo, signed into genesis,
   * not a constant in the runtime and not a parameter a caller can relax.
   */
  function signatureRequirement(entity, op) {
    for (const rule of rulesFor(entity, op)) {
      const req = rule.signatureRequirement || rule.requiredSignatures || null;
      if (req) {
        return {
          roles: req.roles ?? req.allOf ?? [],
          minSigners: req.minSigners ?? req.distinct ?? undefined,
          separateFrom: req.separateFrom ?? req['separate-from'] ?? null,
          at: `${rule.source.file}:${rule.source.line}`,
        };
      }
      if (Array.isArray(rule.authorizedByAll) && rule.authorizedByAll.length > 1) {
        return {
          roles: [...rule.authorizedByAll], minSigners: undefined, separateFrom: null,
          at: `${(rule.authorizedBySource || rule.source).file}:${(rule.authorizedBySource || rule.source).line}`,
        };
      }
    }
    const table = settings.fourEyes || {};
    const raw = table[`${op} ${entity}`] ?? table[entity] ?? null;
    if (!raw) return null;
    return {
      roles: raw.roles ?? [],
      minSigners: raw.minSigners ?? raw['min-signers'] ?? undefined,
      separateFrom: raw.separateFrom ?? raw['separate-from'] ?? null,
      at: PATHS.settings,
    };
  }

  /**
   * Check the requirement against the signers we are about to use, before writing anything.
   * The same predicate the verifier applies to a finished commit — deliberately, so that what we
   * refuse to write is exactly what we would refuse to accept.
   */
  function checkRequirement(requirement, signers, doc) {
    if (!requirement) return [];
    const principals = signers.map((s) => s.principal);
    const rolesOf = (p) => (signers.find((s) => s.principal === p) || { roles: [] }).roles;
    const problems = [];
    const min = requirement.minSigners ?? Math.max(2, (requirement.roles || []).length);
    if (principals.length < min) {
      problems.push({
        reason: `this operation requires ${min} distinct signatures and has `
          + `${principals.length} (${principals.join(', ')}).\n`
          + `  Required by ${requirement.at}. Four eyes is two signatures over one commit, not `
          + 'one person clicking twice.',
        code: 'missing-required-signer',
      });
    }
    if ((requirement.roles || []).length) {
      // A role that only the caller claims is not a control. Where a signature requirement is
      // expressed in roles, every signer's roles must be a fact in the repository — otherwise the
      // client asking to be constrained would also be choosing the constraint, which is the shape
      // of every authorization bug there is.
      for (const s of signers) {
        if (s.rolesRecorded) continue;
        problems.push({
          reason: `this operation requires ${requirement.roles.join(' and ')} to sign, but `
            + `${PATHS.peer(s.principal)} records no roles for ${s.principal}. A role the caller `
            + 'merely claims cannot satisfy a signature requirement — record the roles on the peer '
            + '(addPeer({ …, roles: […] })) so the requirement is checked against the repository.\n'
            + `  Required by ${requirement.at}.`,
          code: 'roles-not-recorded',
        });
      }
      const candidates = requirement.roles.map((role) => principals.filter((p) => rolesOf(p).includes(role)));
      if (!matchDistinct(candidates)) {
        problems.push({
          reason: `this operation must be signed for by ${requirement.roles.join(' and ')}, and by `
            + `different people. Present: ${principals.map((p) => `${p} [${rolesOf(p).join(', ') || 'no role'}]`).join('; ')}.\n`
            + `  Required by ${requirement.at}.`,
          code: 'missing-required-role',
        });
      }
    }
    if (requirement.separateFrom && doc) {
      const raised = doc[requirement.separateFrom];
      if (raised && principals.includes(String(raised))) {
        problems.push({
          reason: `${raised} is named as the ${requirement.separateFrom} of this document and may `
            + 'not also sign it — that is what separation of duties means.\n'
            + `  Required by ${requirement.at}.`,
          code: 'separation-of-duties',
        });
      }
    }
    return problems;
  }

  // -------------------------------------------------------------------------------------------
  // FD-6 — allocation, inside the consuming commit.
  // -------------------------------------------------------------------------------------------

  // -------------------------------------------------------------------------------------------
  // FD-9 — who may grant a role.
  //
  // Granting authority is now an authority-bearing act, so it cannot be left ungoverned; and it
  // cannot be governed by a role name hard-coded here, because a business role inside the runtime
  // is exactly what Principles 7 and 11 forbid (COMPROMISES #13 is a live entry about four such
  // names in the UI). So the answer is built from three rules, most specific first, and none of
  // them contains a word from any company's vocabulary:
  //
  //   1. **If the company's own model governs it, the model decides.** An operating model that
  //      declares authority for `create peer` / `update peer` — a rule, or `## Authorized by` in
  //      `information/peer.md` — is enforced here exactly as it would be by perform(). No shipped
  //      model declares a `peer` entity, so this is additive and inert until a company opts in;
  //      the moment one does, its declaration outranks both rules below. This is the escape hatch
  //      that keeps the default from being a policy we imposed.
  //
  //   2. **Otherwise the founder may grant.** The author of the genesis commit created the
  //      company: `open({ roles })` records their own roles in that first commit, signed, and it is
  //      the root of trust everything else in the repo hangs from. Granting them a bootstrap
  //      exemption hands them no power they do not already have — in a fresh workspace they hold
  //      the only signing key, so they can write any peer record they like and no other peer exists
  //      to notice. Pretending otherwise would be ceremony. It is also the only recovery path for a
  //      workspace created before FD-9, whose peers hold no recorded roles at all; without it such
  //      a workspace would be permanently unable to grant itself out of the hole, which is
  //      fail-closed to the point of being broken.
  //
  //   3. **Otherwise, nobody may grant what they do not themselves hold.** No privilege
  //      escalation, the plainest form of the rule, and it needs no vocabulary at all.
  //
  // What this deliberately does NOT do: nothing here requires two signatures to grant a role. A
  // company that wants four-eyes on granting gets it through rule 1 — `fourEyes: { 'update peer':
  // {...} }` in its settings, or the grammar once it can express it — and not from a constant here.
  // Named rather than quietly skipped.
  // -------------------------------------------------------------------------------------------

  /** The email of the peer that wrote the genesis commit. Computed once; genesis never moves. */
  let genesisAuthorCache;
  async function genesisAuthor() {
    if (genesisAuthorCache === undefined) {
      const first = (await repo.log(Infinity)).at(-1);
      genesisAuthorCache = first ? first.author.email : null;
    }
    return genesisAuthorCache;
  }

  /**
   * May this peer record these roles on that peer? Returns a refusal, or null.
   * Granting NO roles (`addPeer` without `roles`) grants no authority and needs none.
   */
  async function mayGrant(targetEmail, roles) {
    if (!roles || roles.length === 0) return null;

    const held = recordedRoles(me.email);
    if (held.unreadable) {
      return {
        reason: `${PATHS.peer(me.email)} is not readable JSON, so this workspace cannot say which `
          + `roles ${me.email} holds — and a peer whose own authority cannot be read may not grant `
          + 'authority to anybody. An unreadable record means none, never all.',
        code: 'peer-record-unreadable', at: PATHS.peer(me.email),
      };
    }

    // 1. The company's own model, if it has anything to say. Asked of the runtime, not re-derived.
    const op = files.has(PATHS.peer(targetEmail)) ? 'update' : 'create';
    const c = coverage('peer', op);
    if (c.covered) {
      const refusal = checkAuthorization('peer', op, held.roles,
        { recorded: held.recorded, claimed: null, held: held.roles });
      if (refusal) return { ...refusal, code: `grant-${refusal.code}` };
      return null;
    }

    // 2. The founder.
    if (me.email === await genesisAuthor()) return null;

    // 3. No escalation.
    const excess = roles.filter((r) => !held.roles.includes(r));
    if (!excess.length) return null;
    return {
      reason: `${me.email} may not grant ${excess.map((r) => `"${r}"`).join(' / ')} to `
        + `${targetEmail}: ${PATHS.peer(me.email)} does not record that role for them either.\n`
        + `  ${me.email} holds ${held.roles.length ? held.roles.map((r) => `"${r}"`).join(', ') : 'no roles at all'}, `
        + 'and nobody may grant authority they do not themselves hold.\n'
        + '  Two ways forward, and they are different decisions. Either someone who does hold it '
        + 'grants it — the founder always may, and the grant is a signed commit anyone can find '
        + 'with `git log -- peers/` — or the company says in its own words who may grant, by '
        + 'declaring authority for peers:\n'
        + '    operating-model/information/peer.md\n'
        + '    ## Authorized by\n'
        + '    - create: <role>\n'
        + '    - update: <role>\n'
        + '  A declaration there outranks everything above, which is the point of it.',
      code: 'may-not-grant', at: PATHS.peer(me.email),
      granter: me.email, target: targetEmail, notHeld: excess,
    };
  }

  /**
   * The commit subject for a peer write. It names the roles, because "peer X added" in `git log`
   * is not an audit trail of a grant of authority — the roles are the substance of the act.
   */
  function peerMessage(peer, roles, previous) {
    const before = Array.isArray(previous?.roles) ? previous.roles : null;
    const list = (r) => (r && r.length ? r.join(', ') : 'no roles');
    const head = previous
      ? (before === null || before.join(' ') !== (roles ?? []).join(' ')
        ? `roles for ${peer.name} <${peer.email}>: ${list(roles)}`
        : `peer ${peer.name} <${peer.email}> updated`)
      : `peer ${peer.name} <${peer.email}> added with ${list(roles)}`;
    const lines = [head, '', 'NeoDonkey-Transaction: v1', `NeoDonkey-Peer: ${peer.email}`];
    // The grant, and the grant's own authority, both inside the signed payload. An auditor asking
    // "who gave this person that power, and could they?" reads one commit and gets both answers.
    lines.push(`NeoDonkey-Peer-Roles: ${roles && roles.length ? roles.join(' ') : '(none)'}`);
    if (before !== null && (roles ?? []).join(' ') !== before.join(' ')) {
      lines.push(`NeoDonkey-Peer-Roles-Before: ${before.length ? before.join(' ') : '(none)'}`);
    }
    const mine = recordedRoles(me.email);
    lines.push(`NeoDonkey-Actor-Roles: ${mine.roles.length ? mine.roles.join(' ') : '(none)'}`);
    return lines.join('\n') + '\n';
  }

  /**
   * Allocate a document number for this intent, if it wants one. PURE with respect to the repo:
   * it returns the number and a Change for the sequence document, which the caller stages into
   * the same commit as the document consuming it. Nothing is written here, so a refusal later
   * consumes nothing and there is no window in which a number exists but is unused.
   */
  function allocateFor(intent, op) {
    const wants = intent.numberFrom || intent.id === undefined || intent.id === null || intent.id === '';
    if (!wants) return { allocation: null, problems: [] };
    if (op !== 'create') {
      return { allocation: null, problems: [{
        reason: `a document number is issued when a document is created, not when it is ${op}d.`,
        code: 'sequence-not-on-create',
      }] };
    }
    const decl = intent.numberFrom ? seriesMap().get(intent.numberFrom) : seriesFor(intent.entity);
    if (!decl) {
      return { allocation: null, problems: [{
        reason: intent.numberFrom
          ? `there is no number series called "${intent.numberFrom}" in this workspace.`
          : `this ${intent.entity} was created without an id, but no number series numbers `
            + `${intent.entity} documents — so there is nothing to take a number from. Either `
            + `give the document an id, or declare a series for ${intent.entity}.`,
        code: 'no-such-series',
      }] };
    }
    const refusal = assertAuthoritative(decl, nodeId);
    if (refusal) return { allocation: null, problems: [{ reason: refusal, code: 'not-authoritative-peer' }] };

    const { period, error } = periodOf(decl, intent.doc || {});
    if (error) return { allocation: null, problems: [{ reason: error, code: 'sequence-period-unknown' }] };

    const current = index.get(SEQUENCE_ENTITY, sequenceId(decl.series, period));
    let got;
    try {
      got = allocate({ declaration: decl, period, current });
    } catch (e) {
      return { allocation: null, problems: [{ reason: e.message, code: 'sequence-refused' }] };
    }
    return { allocation: { ...got, declaration: decl, period }, problems: [] };
  }

  // -------------------------------------------------------------------------------------------
  // Appendix VII, part 1 — reading and writing sealed documents
  // -------------------------------------------------------------------------------------------

  /** The refusal for every encryption act in a workspace that was opened without a key pair. */
  const noEncryption = (what) => ({
    reason: `${what} needs this peer's encryption key pair, and this workspace was opened without `
      + 'one.\n'
      + '  Pass it to open(): `encryption: { privateKey, publicKey, curve }` — a personal X25519 '
      + 'pair, alongside and never instead of the Ed25519 signing pair.\n'
      + '  Until then a sealed document is opaque and counted, never guessed at, which is the '
      + 'correct behaviour for a peer that holds no key rather than a degraded one.',
    code: 'encryption-not-configured', at: 'kernel.open({ encryption })',
  });

  /** The refusal for every act that needs the one mutable store. */
  const noVault = (what) => ({
    reason: `${what} needs the vault, and this workspace was opened without one.\n`
      + '  Pass it to open(): `vault: vault(nodeFs(someDirectoryOutsideTheRepo))` from '
      + '`runtime/crypto/shred.js`.\n'
      + '  It must not live inside the repository. An append-only store cannot hold key material '
      + 'you may one day have to destroy: a wrapped subject key committed to git is recoverable '
      + 'with `git cat-file` after the deletion commit forever, and removing it by rewriting '
      + 'history invalidates every signature from the rewrite point onward — the exact GoBD '
      + 'property the design exists to preserve.',
    code: 'vault-required', at: 'kernel.open({ vault })',
  });

  /** The refusal for an act on a group this repository has no manifest for. */
  const unknownGroup = (id) => ({
    reason: `this workspace has no encryption group called ${JSON.stringify(id)}.\n`
      + `  It knows: ${groupIds().join(', ') || 'none at all'}.\n`
      + '  Group manifests are public repo files under crypto/groups/ — every peer can see that a '
      + 'group exists and who is in it, and only members can unwrap its key. Create one with '
      + 'kernel.createGroup({ id, members }).',
    code: 'unknown-group', at: CRYPTO_PATHS.group(id),
  });

  /**
   * One group manifest as it stands in HEAD, parsed and not re-verified.
   *
   * Not re-verified on purpose: `keyringFromRepo()` verified every manifest in this workspace —
   * shape, epochs, and every member's key binding — when the keyring was built, and it refused
   * rather than skipped. Verifying again here would be a second opinion that can disagree with the
   * first, which is the defect shape this project has shipped twice. The three functions that
   * *change* a manifest (`addMember`, `removeMember`, `rotateGroup`) verify it themselves.
   */
  function groupManifest(id) {
    const bytes = files.get(CRYPTO_PATHS.group(id));
    if (!bytes) return null;
    try { return parseJsonBytes(bytes); } catch { return null; }
  }

  // The two directory prefixes below are DERIVED from `CRYPTO_PATHS` rather than written out, so
  // that moving a group manifest cannot leave this file scanning the old place.
  const GROUPS_AT = CRYPTO_PATHS.group('').slice(0, -'.json'.length);
  const SUBJECTS_AT = CRYPTO_PATHS.subject('').slice(0, -'.json'.length);

  /** Every group id this repository has a manifest for. Public information, no key needed. */
  const groupIds = () => [...files.keys()]
    .filter((p) => p.startsWith(GROUPS_AT) && p.endsWith('.json'))
    .map((p) => p.slice(GROUPS_AT.length, -'.json'.length)).sort();

  /** The epoch secrets this peer holds for one group, in the shape `groups.js` asks for. */
  function secretsForGroup(id) {
    const out = new Map();
    if (!keyring) return out;
    for (const k of keyring.epochs()) {
      if (!k.startsWith(`${id}@`)) continue;
      const epoch = Number(k.slice(id.length + 1));
      const secret = keyring.secretFor(id, epoch);
      if (secret) out.set(epoch, secret);
    }
    return out;
  }

  /** One enrolment record out of the repo — a peer's published encryption key. */
  function enrolmentOf(principal) {
    const bytes = files.get(CRYPTO_PATHS.enrolment(principal));
    if (!bytes) return null;
    try { return parseJsonBytes(bytes); } catch { return null; }
  }

  /**
   * **The entities this company records as confidential, and for which groups.**
   *
   * `sealFor` on its own would be a flag a caller has to remember, and a confidentiality control you
   * can defeat by forgetting is not a control — it is the exact shape of half-capability this wave
   * exists to stop shipping. So "salary documents are sealed for HR" is recorded in the workspace,
   * signed into genesis, and read from there:
   *
   *     neodonkey.json  { "sealed": { "salary": ["hr"], "customer": ["hr"] } }
   *
   * The reasoning is `signatureRequirement()`'s, word for word — *"data in the repo, signed into
   * genesis, not a constant in the runtime and not a parameter a caller can relax"* — and it is how
   * v1.0 can enforce this before the grammar can express it. The exit path is the same too: the day
   * `## Sealed for` exists in `runtime/polism/grammar.md`, an entity's own file outranks this table,
   * and the company's sentences say it instead of its settings.
   *
   * A caller may **add** groups and may add a subject key; it may never drop a declared group. And a
   * workspace that declares an entity confidential refuses to write one at all without an encryption
   * key pair, which is what makes the guarantee hold for `mcp/server.mjs` and a browser tab as much
   * as for a test.
   *
   * @returns {string[]|null} the group ids this entity must be sealed for, or null
   */
  function requiredSealing(entity) {
    const raw = (settings.sealed ?? {})[entity];
    if (raw === undefined || raw === null) return null;
    const ids = (Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : (raw.groups ?? [])))
      .filter((g) => typeof g === 'string' && g !== '');
    if (!ids.length) {
      const message = `${PATHS.settings} lists ${JSON.stringify(entity)} under "sealed" but names no `
        + 'group, so it says a document must be confidential without saying who may read it. It is '
        + 'ignored, and that is worth knowing about: a declaration nobody can satisfy is not a '
        + 'control.';
      if (!warnings.some((w) => w.message === message)) warnings.push({ at: 'sealed', message });
      return null;
    }
    return [...new Set(ids)];
  }

  /**
   * Turn `sealFor` into a resolved sealing plan, or into refusals. No side effects: this runs
   * before the rules do, so `sealFor: ['no-such-group']` is refused without evaluating anything and
   * without touching the vault.
   *
   * Three accepted shapes, and they are the same declaration at three levels of detail:
   *   `['hr']`                                    seal for the HR group
   *   `{groups: ['hr', 'board']}`                 seal for both; HR names it (first wins)
   *   `{groups: ['hr'], subject: 'customer/C-1042'}`
   *                                               seal under a shreddable subject key that HR may
   *                                               unwrap. This is the GDPR case: the envelope
   *                                               carries no wrapped key at all, and that absence
   *                                               is the erasability.
   */
  function planSealing(sealFor) {
    const spec = Array.isArray(sealFor) ? { groups: sealFor } : (sealFor || {});
    const ids = Array.isArray(spec.groups) ? spec.groups.map((g) => String(g)) : null;
    const subject = spec.subject === undefined || spec.subject === null
      ? null : String(spec.subject);
    if (!ids || ids.length === 0) {
      return { problems: [{
        reason: 'sealFor must name at least one group: `sealFor: ["hr"]`, or '
          + '`sealFor: {groups: ["hr"], subject: "customer/C-1042"}`.\n'
          + '  A document sealed for nobody is a document nobody — including its author — can ever '
          + 'read again, so there is no useful reading of an empty group list.',
        code: 'unknown-group',
      }] };
    }
    if (!keyring) return { problems: [noEncryption(`sealing ${ids.join(', ')} documents`)] };
    if (subject !== null && !theVault) return { problems: [noVault(`sealing PII for ${subject}`)] };

    const problems = [];
    const groups = [];
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) {
        problems.push({
          reason: `sealFor lists group ${JSON.stringify(id)} twice. One group is one wrap; a `
            + 'duplicate is a bug, and guessing which of the two was meant is how a document ends '
            + 'up sealed for a group nobody intended.',
          code: 'duplicate-group',
        });
        continue;
      }
      seen.add(id);
      const manifest = groupManifest(id);
      if (!manifest) {
        problems.push({
          reason: `this workspace has no encryption group called ${JSON.stringify(id)}.\n`
            + `  It knows: ${groupIds().join(', ') || 'none at all'}.\n`
            + `  Create it as a signed commit: kernel.createGroup({ id: ${JSON.stringify(id)}, `
            + 'members: [\'someone@example.com\', ...] }).',
          code: 'unknown-group', at: CRYPTO_PATHS.group(id),
        });
        continue;
      }
      // The CURRENT epoch, from the manifest — never the newest epoch this peer happens to hold.
      // Those differ in exactly one situation and it is the dangerous one: a peer that was removed
      // from the group still holds every older epoch secret, and sealing under one of those would
      // hand the new document straight back to the person who was removed.
      const epoch = manifest.epoch;
      const secret = keyring.secretFor(id, epoch);
      if (!secret) {
        problems.push({
          reason: `${me.email} holds no key for the current epoch of group ${id} (epoch ${epoch}), `
            + 'so they cannot seal a document for it.\n'
            + `  They hold: ${keyring.epochs().join(', ') || 'no group secrets at all'}.\n`
            + '  Either they are not a member, or they were removed and still hold older epochs — '
            + 'and sealing under an older epoch would hand the document to whoever was removed, '
            + 'which is why this is a refusal and not a fallback.',
          code: 'not-a-member', at: CRYPTO_PATHS.group(id),
        });
        continue;
      }
      groups.push({ id, epoch, secret });
    }
    if (problems.length) return { problems };
    return { plan: { groups, subject }, problems: [] };
  }

  /**
   * The subject record this repository holds for a data subject, if any. One key per subject is the
   * point: two documents about the same person share one key, so one erasure covers both.
   */
  function subjectRecordFor(subject) {
    for (const [path, bytes] of files) {
      if (!path.startsWith(SUBJECTS_AT) || !path.endsWith('.json')) continue;
      let rec;
      try { rec = parseJsonBytes(bytes); } catch { continue; }
      if (rec && rec.format === SUBJECT_FORMAT && rec.subject === subject) return { path, rec };
    }
    return null;
  }

  /**
   * Find or mint the subject key for one data subject, staging whatever the repo must record.
   *
   * The wrapped key goes to the vault BEFORE the commit, deliberately. If the commit then fails,
   * the vault holds a key that protects nothing — harmless. The reverse order would commit a
   * document whose key was never stored, which is silent, permanent data loss.
   */
  async function subjectKeyFor(subject, groups) {
    const existing = subjectRecordFor(subject);
    if (existing) {
      if (existing.rec.state === 'erased') {
        return { problems: [{
          reason: `the subject key for ${subject} was erased (GDPR Art. 17), so nothing further may `
            + 'be sealed under it.\n'
            + `  ${existing.path} records the erasure and `
            + `${CRYPTO_PATHS.erasure(existing.rec['key-id'])} records who asked and why.\n`
            + '  Re-minting a key for an erased subject would quietly resurrect a data subject the '
            + 'company has told a regulator it forgot. If this is genuinely a new relationship, it '
            + 'is a new subject reference.',
          code: 'subject-already-erased', at: existing.path,
        }] };
      }
      // A subject key's wraps are fixed when it is minted: they live in the vault, which is not the
      // repo, so widening them is a vault write and not part of this commit. A call that asks for a
      // group the existing key was not wrapped for is therefore refused rather than silently given
      // less access than it asked for — the second document about one person must not be readable by
      // a different set of people than the first.
      const wrappedFor = existing.rec.groups ?? [];
      const asked = groups.map((g) => `${g.id}@${g.epoch}`);
      const missing = asked.filter((g) => !wrappedFor.includes(g));
      if (missing.length) {
        return { problems: [{
          reason: `the subject key for ${subject} is wrapped for ${wrappedFor.join(', ') || 'nothing'}, `
            + `and this call asks to seal for ${asked.join(', ')} — ${missing.join(', ')} could not `
            + 'open it.\n'
            + '  One data subject has one key, deliberately: that is what makes one erasure cover '
            + 'every document about them. Its wraps are fixed when it is minted, because they live in '
            + 'the vault rather than in this commit.\n'
            + `  Seal this document for exactly ${wrappedFor.join(', ')}, or seal it for the wider `
            + 'set WITHOUT a subject reference and accept that it is then not separately erasable.',
          code: 'unknown-group', at: existing.path,
        }] };
      }
      let key;
      try {
        key = await loadSubjectKey({ vault: theVault, keyId: existing.rec['key-id'], keyring });
      } catch (e) {
        if (!(e instanceof CryptoError)) throw e;
        return { problems: [{ reason: e.message, code: e.reason, at: existing.path }] };
      }
      return { keyId: existing.rec['key-id'], key, staged: new Map(), problems: [] };
    }
    const minted = await createSubjectKey({ subject, groups });
    await storeSubjectKey(theVault, minted.wrap);          // the vault, and only the vault
    const rf = subjectRecordFile(minted.record);
    return {
      keyId: minted.keyId, key: minted.key,
      staged: new Map([[rf.path, rf.bytes]]),              // public: no key material
      problems: [],
    };
  }

  /**
   * Seal every document this commit writes, and say so in a way a stranger can check.
   *
   * **Every** document, not only the one the intent named: a commit is one business event, and a
   * rule that derives a second document from a confidential first one derives confidential data.
   * Sealing the trigger and leaving the consequent in the clear would be decorative encryption of
   * exactly the kind this whole exercise exists to avoid.
   *
   * One deliberate exception, and it is not a hole: the FD-6 sequence document. It records which
   * numbers a series has issued, it contains no business content, and every peer must be able to
   * read it or the series stops being gapless for anybody who is not in the group. Named here
   * rather than quietly skipped.
   */
  async function sealChanges(all, plan) {
    /** @type {{path: string, bytes: Uint8Array}[]} */
    const writes = [];
    const removals = [];
    const staged = [];
    const trailers = [];
    const names = [];
    let extraFiles = new Map();

    let subjectKey = null;
    if (plan.subject !== null) {
      const got = await subjectKeyFor(plan.subject, plan.groups);
      if (got.problems.length) return { problems: got.problems };
      subjectKey = got;
      extraFiles = got.staged;
    }

    for (const change of all) {
      if (change.entity === SEQUENCE_ENTITY || change.op === 'delete') {
        staged.push(change);
        continue;
      }
      const after = change.after ?? {};
      // The plaintext name. For a create it is the id the caller gave (or the number FD-6 issued);
      // for an update it comes back out of the field the decrypting reader put it in, because by
      // then the caller is holding a document whose `id` is a keyed hash and whose name is not.
      const name = typeof after[SEALED_NAME] === 'string' && after[SEALED_NAME] !== ''
        ? after[SEALED_NAME] : String(change.id);
      const doc = { ...after };
      delete doc[SEALED_NAME];        // re-added on open; two copies of one fact can disagree
      let sealed;
      try {
        sealed = subjectKey
          ? await seal({
            entity: change.entity, name, doc,
            key: { kind: 'subject', keyId: subjectKey.keyId, key: subjectKey.key },
          })
          : await seal({
            entity: change.entity, name, doc, key: { kind: 'dek', groups: plan.groups },
          });
      } catch (e) {
        if (!(e instanceof CryptoError)) throw e;
        return { problems: [{ reason: e.message, code: e.reason, entity: change.entity }] };
      }
      const path = sealedPath(sealed);
      const wasAt = PATHS.doc(change.entity, change.id);
      writes.push({ path, bytes: sealed.bytes });
      // A rotation changes the name key, so re-sealing moves the document. Git records that as a
      // rename; leaving the old path behind would be the plaintext-and-ciphertext-both-present
      // failure that makes encryption decorative.
      if (change.op !== 'create' && wasAt !== path) removals.push(wasAt);
      staged.push({ ...change, id: sealed.id });
      names.push(name);
      trailers.push(`NeoDonkey-Sealed: ${change.entity} ${sealed.id} ${
        subjectKey ? `subject:${subjectKey.keyId}`
          : plan.groups.map((g) => `${g.id}@${g.epoch}`).join(',')}`);
      // What the index must see: the plaintext, exactly as the decrypting reader would have
      // produced it from these bytes. Same function, so a member's own document cannot look
      // different depending on whether they wrote it or read it back.
      stagedPlain.set(path, documentBytes({
        entity: change.entity, id: sealed.id, name, doc,
      }, SEALED_NAME));
    }
    return { writes, removals, staged, trailers, names, extraFiles, problems: [] };
  }

  // -------------------------------------------------------------------------------------------
  // Appendix VII, part 2 — group administration, as signed commits
  //
  // Who may administer an encryption group? The same three-rule answer FD-9 gave for who may grant
  // a role (see `mayGrant`), because it is the same question — this is access control — and it is
  // answered without a single word from any company's vocabulary:
  //
  //   1. **If the company's own model governs it, the model decides.** A model that declares
  //      authority for `create` / `update` / `delete` on an `encryption-group` entity is enforced
  //      here exactly as `perform()` would enforce it. No shipped model declares one, so this is
  //      additive and inert until a company opts in.
  //
  //   2. **Otherwise, only a member of the group may administer it.** Not a policy we imposed — a
  //      structural fact stated out loud. You cannot add a member without the group secret to hand
  //      them, and a non-member holds none; you cannot re-seal a document you cannot open. The
  //      refusal exists so the failure is a sentence instead of `not-a-member` from three frames
  //      down.
  //
  //   3. **And a group is created only with its creator inside it.** Also structural: the epoch
  //      secret is recoverable from the manifest only by a member, so a creator who leaves
  //      themselves out has minted a group they can never add to, rotate, or seal for — and has
  //      handed a key to other people while keeping nothing. Refused rather than allowed to become
  //      a support call.
  //
  // There is deliberately **no founder exemption** here, unlike `mayGrant`. A founder who is not in
  // the group holds no key, so an exemption would grant them nothing at all and would only make the
  // refusal they then hit less honest than the one above.
  // -------------------------------------------------------------------------------------------

  /** The entity name a company uses to govern its own encryption groups, if it chooses to. */
  const GROUP_ENTITY = 'encryption-group';

  function mayAdministerGroup(op, groupId, manifest) {
    const c = coverage(GROUP_ENTITY, op);
    if (c.covered) {
      const held = recordedRoles(me.email);
      const refusal = checkAuthorization(GROUP_ENTITY, op, held.roles,
        { recorded: held.recorded, claimed: null, held: held.roles });
      if (refusal) return { ...refusal, code: `group-${refusal.code}` };
    }
    if (manifest && !manifest.members.some((m) => m.principal === me.email)) {
      return {
        reason: `${me.email} is not a member of encryption group ${groupId}, so they may not `
          + `${op} it.\n`
          + `  Members: ${manifest.members.map((m) => m.principal).join(', ')} — `
          + `${CRYPTO_PATHS.group(groupId)}, which is a public repo file precisely so that "who may `
          + 'read what" is itself readable.\n'
          + '  This is not a permission we chose to withhold: administering a group means handing '
          + 'out its epoch secret or re-sealing its documents, and a non-member holds neither.',
        code: 'not-a-member', at: CRYPTO_PATHS.group(groupId), principal: me.email,
      };
    }
    return null;
  }

  /**
   * Commit whatever is currently in `files` as one signed administrative commit, then rebuild the
   * keyring and the index from the repository.
   *
   * A full rebuild, not an incremental update: every act that reaches this function changes who can
   * read what, and three of them (rotate, offboard, erase) change which documents are readable and
   * where they live. They happen a handful of times in a company's life, so paying a
   * materialization for a guaranteed-correct view is the trade this project should always make.
   */
  async function commitAdministration(message) {
    const oid = await repo.commit({
      files, message, author: me, time: now(), tzOffsetMinutes, sign,
    });
    await repo.checkout();
    await rebuildKeyring();
    index = await buildIndex(oid);
    return oid;
  }

  /** An ISO instant from the INJECTED clock. Determinism is a non-negotiable, including here. */
  const nowIso = () => new Date(clock()).toISOString();

  /**
   * Every sealed document in HEAD, with what its own public header says about it. Keyless: this
   * works for a peer that can open none of them, which is what makes re-wrapping and offboarding
   * possible for somebody who is not in the group being changed.
   */
  function sealedInventory() {
    const out = [];
    for (const [path, bytes] of files) {
      if (parseDocPath(path) === null || !isEnvelope(bytes)) continue;
      try { out.push({ path, bytes, ...inspectEnvelope(bytes) }); } catch { /* not ours */ }
    }
    return out;
  }

  /**
   * The commit subject and trailers for one administrative act on a group.
   *
   * The subject names the act, the group and the people, because "manifest updated" in `git log` is
   * not an audit trail of a change to who may read salaries — the membership is the substance.
   * Everything here is already public in `crypto/groups/<id>.json`; no key material and no
   * confidential name goes anywhere near a commit message.
   */
  function groupMessage(head, manifest, extra = []) {
    const mine = recordedRoles(me.email);
    return [
      head, '',
      'NeoDonkey-Transaction: v1',
      `NeoDonkey-Group: ${manifest.id}`,
      `NeoDonkey-Group-Epoch: ${manifest.epoch}`,
      `NeoDonkey-Group-Members: ${manifest.members.map((m) => m.principal).sort().join(' ')}`,
      ...extra,
      `NeoDonkey-Actor-Roles: ${mine.roles.length ? mine.roles.join(' ') : '(none)'}`,
    ].join('\n') + '\n';
  }

  /** Turn a `CryptoError` from `runtime/crypto/` into the refusal shape every caller already reads. */
  const asRefusal = (e, at = null) => {
    if (!(e instanceof CryptoError)) throw e;
    return { reason: e.message, code: e.reason, ...(at ? { at } : {}) };
  };

  const kernel = {
    me,
    get query() { return index; },
    get model() { return model; },
    get modelErrors() { return modelErrors; },
    get modelWarnings() { return modelWarnings; },

    /**
     * Run a business event through the operating model. Either it is refused with the
     * broken rule quoted, or every resulting change lands in one signed commit.
     *
     * **`intent.sealFor` — Appendix VII, the write side.** Declarative: the caller names groups and
     * never keys, epochs, DEKs or paths.
     *
     *   sealFor: ['hr']                                     seal for the HR group
     *   sealFor: {groups: ['hr', 'board']}                   both; the first group names the file
     *   sealFor: {groups: ['hr'], subject: 'customer/C-1042'}
     *                                                        a shreddable subject key (GDPR Art. 17)
     *
     * What that changes, precisely:
     *   • the document is written ONLY at `documents/<entity>/<sealed-id>.json`, where the sealed id
     *     is a keyed hash of its name. The plaintext path is never written, never staged and never
     *     checked out — if both existed the encryption would be decorative;
     *   • `changes[].id` in the result is the sealed id, because that is where the document is. The
     *     business name comes back as the `sealed-name` field for anyone who can decrypt it, and
     *     `kernel.findSealed({entity, name, group})` looks it up by name;
     *   • every document the event wrote is sealed, trigger and consequents alike, because a rule
     *     that derives a second document from a confidential first one derives confidential data.
     *     The one exception is FD-6's sequence document, which carries no business content and must
     *     stay readable or the series stops being gapless for non-members;
     *   • the sealing is recorded as a `NeoDonkey-Sealed:` trailer inside the signed payload, and
     *     independently in the blob's own public header (`inspectSealed()`).
     *
     * A workspace opened without `encryption` refuses `sealFor` rather than writing plaintext.
     */
    async perform(intent) {
      return serialized(() => performOne(intent));
    },

    /**
     * Where this company's authorization boundary runs, for one pair or for all of them.
     * COMPROMISES #4c-bis's real defect was that nothing told anybody where the boundary was.
     */
    authorityOf(entity, op) { return coverage(entity, op); },
    uncoveredOperations() {
      const out = [];
      for (const entity of model.entities.keys()) {
        for (const op of ['create', 'update', 'delete']) {
          if (!coverage(entity, op).covered) out.push({ entity, operation: op });
        }
      }
      return out;
    },

    /** The workspace's own recorded settings. Read-only: changing them is a major-version act. */
    get settings() { return settings; },
    get strictAuthorization() { return settings.authorization.strict === true; },

    /** FD-6. The number series this workspace knows, and the state of each sequence. */
    numberSeries() { return new Map(seriesMap()); },
    sequenceState(seriesName) {
      const decl = seriesMap().get(seriesName);
      if (!decl) return null;
      return index.all(SEQUENCE_ENTITY).filter((d) => d.series === seriesName);
    },

    /**
     * The gaplessness audit, computed from the commit history rather than from the sequence
     * documents — a sequence document saying `next: 1000` proves nothing about what was issued.
     * This is the check a Betriebsprüfer actually asks for (GoBD Vollständigkeit).
     */
    async auditNumbering(limit = Infinity) {
      const issuances = [];
      for (const c of await repo.log(limit)) issuances.push(...readSequenceTrailers(c.message));
      // history is newest-first; issuance order is oldest-first
      issuances.reverse();
      const startOf = (name) => (seriesMap().get(name)?.start ?? 1);
      return { ...auditIssuance(issuances, startOf), issuances };
    },

    /**
     * Live Layer (Appendix III). Nothing here touches git until finalize().
     * All sessions on this peer share one logical clock, so ops minted in the same tab are
     * totally ordered without coordination.
     */
    edit(entity, id, { policy } = {}) {
      const doc = index.get(entity, id);
      if (!doc) throw new Error(`cannot edit unknown document ${entity}/${id}`);
      return liveSession(doc, nodeId, sharedClock, policy ? { policy } : undefined);
    },

    /**
     * Live → Truth. The 200 intermediate ops are irrelevant to eternity; the fact is not.
     *
     * Two gates, in this order. First the live layer must be able to produce a single value
     * per field — a fact cannot have two values, so `snapshot()` refuses while a conflict is
     * open. Then the operating model must accept the result: live editing is deliberately
     * unvalidated, so this is the only place the rules stand between a CRDT and the truth.
     */
    // FD-9: `actorRoles` defaults to UNDEFINED, not `[]`. Omitting it is not a claim to no role;
    // it means "act as me", and perform() grounds that in the peer record. Defaulting to `[]` would
    // have narrowed every caller who omits it down to no authority at all.
    async finalize(session, { message, actorRoles } = {}) {
      const open = session.conflicts();
      if (open.length) {
        return { rejected: open.map((c) => ({
          reason: `unresolved conflict on field "${c.field}" — decide before this becomes a fact`,
          values: c.values,
        })) };
      }
      let doc;
      try {
        doc = session.snapshot();
      } catch (e) {
        // PolicyError: a peer wrote to a field this document's state forbids, or two peers
        // hold the same field as different CRDT types. Refused, never guessed at.
        return { rejected: [{ reason: e.message, fields: e.fields ?? null }] };
      }
      const quarantined = session.violations?.() ?? [];
      return await kernel.perform({
        op: 'update', entity: doc.entity, id: doc.id, doc, message,
        ...(actorRoles === undefined ? {} : { actorRoles }),
        _quarantined: quarantined.length ? quarantined : undefined,
      });
    },

    async history(limit = 50) {
      const entries = await repo.log(limit);
      return entries.map((c) => ({
        oid: c.oid,
        message: c.message,
        author: c.author,
        time: c.time,
        signature: c.signature,
        changes: parseTrailers(c.message),
        // Additive: an empty array for every commit written before Appendix VII reached the front
        // door, and for every commit that sealed nothing.
        sealed: parseSealedTrailers(c.message),
      }));
    },

    /**
     * Verify the chain with our own code — no git binary, no ssh binary, in a browser.
     * Appendix XI: any peer detects a compromised signature.
     */
    async verify(limit = 200) {
      const out = [];
      for (const commit of await repo.log(limit)) {
        // FD-9: the authority question is answered for EVERY commit, including unsigned and
        // unknown-signer ones. "Whose roles were these?" is exactly the question you want answered
        // about a commit you already distrust.
        const authority = await authorityAtCommit(commit);
        if (!commit.signature) {
          out.push({
            oid: commit.oid, signature: 'none', by: commit.author.email, signatures: [], authority,
          });
          continue;
        }
        const peerBytes = files.get(PATHS.peer(commit.author.email));
        if (!peerBytes) {
          out.push({
            oid: commit.oid, signature: 'unknown-signer', by: commit.author.email, signatures: [],
            authority,
          });
          continue;
        }
        const ok = await verifyPayload(
          unjson(peerBytes).publicKeySsh, commit.payload, commit.signature, 'git',
        );
        // Every signature on the commit, independently: who signed, in what order, and whether
        // each one verifies. A commit with no co-signature reports exactly one entry, so this is
        // additive for every caller that only reads `signature`.
        const report = await verifyCommitSignatures({
          payload: commit.payload,
          primarySignature: commit.signature,
          primaryPrincipal: commit.author.email,
          resolveKey: peerKey,
        });
        out.push({
          oid: commit.oid,
          signature: ok && report.ok ? 'good' : 'bad',
          by: commit.author.email,
          signatures: report.signatures,
          cosigners: report.cosigners,
          problems: report.problems,
          authority,
        });
      }
      return out;
    },

    /**
     * Verify one commit's whole signature set, with a requirement if the caller has one. This is
     * the function an auditor's tool calls: it answers "who signed this, in what order, and is
     * every signature that had to be here here?" — not merely "is the signature good".
     */
    async verifyCommit(oid, { requirement = null, document = null } = {}) {
      const target = (await repo.log(Infinity)).find((c) => c.oid === oid);
      if (!target) return null;
      return verifyCommitSignatures({
        payload: target.payload,
        primarySignature: target.signature,
        primaryPrincipal: target.author.email,
        resolveKey: peerKey,
        requirement: requirement
          ? { ...requirement, rolesOf: (p) => peerRoles(p) ?? [] }
          : null,
        document,
      });
    },

    /** The index is a view. Throwing it away must always be safe. */
    async reindex() {
      index = await buildIndex();
      return index;
    },

    /** Non-fatal problems worth surfacing rather than swallowing. */
    get warnings() { return warnings; },

    /**
     * Read the company's own description. Every path under operating-model/, and the text of
     * one file verbatim — prose included, because the prose is written for the human who is
     * about to edit it and must survive the round trip.
     */
    operatingModelFiles() {
      return [...files.keys()]
        .filter((p) => p.startsWith(PATHS.operatingModel) && p.endsWith('.md')).sort();
    },

    readOperatingModelFile(path) {
      const bytes = files.get(path);
      if (!bytes || !path.startsWith(PATHS.operatingModel)) return null;
      return dec.decode(bytes);
    },

    /** Change the company by changing its description. Principle 11, the whole point. */
    async amendOperatingModel(path, text, message) {
      if (!path.startsWith(PATHS.operatingModel)) {
        throw new Error(`operating model files live under ${PATHS.operatingModel}`);
      }
      const previous = files.get(path);
      files.set(path, enc.encode(text));
      const parsed = loadModel();
      const errors = parsed.errors.filter((e) => e.severity === 'error');
      if (errors.length) {
        // Refuse loudly, restore, stay running. The COO gets a sentence they can fix.
        if (previous === undefined) files.delete(path); else files.set(path, previous);
        loadModel();
        return { rejected: errors.map((e) => ({
          reason: e.message, at: `${e.file}:${e.line}`,
        })) };
      }
      const oid = await repo.commit({
        files, message: message ?? `operating model: ${path}`, author: me,
        time: now(), tzOffsetMinutes, sign,
      });
      await repo.checkout();
      index = await buildIndex(oid);
      return { oid, changes: [] };
    },

    /**
     * A new peer's public key enters the repo (Appendix X, day 3 and day 10). `roles` is
     * additive and matters for four-eyes: a role a co-signer holds should be a fact in the
     * repository, not a claim a caller makes at signing time.
     *
     * FD-9 makes this the way authority is GRANTED, so granting is now itself governed. See
     * `mayGrant()` for who may, and why that answer is what it is.
     */
    async addPeer(peer) {
      return serialized(async () => {
        const roles = Array.isArray(peer.roles)
          ? [...new Set(peer.roles.filter((r) => typeof r === 'string' && r !== ''))] : null;
        const refusal = await mayGrant(peer.email, roles);
        if (refusal) return { rejected: [refusal] };
        const existing = files.get(PATHS.peer(peer.email));
        let previous = null;
        if (existing) { try { previous = unjson(existing); } catch { previous = null; } }
        files.set(PATHS.peer(peer.email), json({
          name: peer.name, email: peer.email,
          publicKeySsh: peer.publicKeySsh ?? previous?.publicKeySsh,
          joinedAt: previous?.joinedAt ?? now(),
          ...(roles ? { roles } : {}),
        }));
        const oid = await repo.commit({
          files, message: peerMessage(peer, roles, previous), author: me,
          time: now(), tzOffsetMinutes, sign,
        });
        await repo.checkout();
        return { oid, roles: roles ?? [] };
      });
    },

    /**
     * Grant (or replace) the roles a peer holds. The same signed act as `addPeer({roles})` — this
     * is the readable name for it, and it keeps the peer's key and joinedAt untouched so that
     * granting authority cannot accidentally rotate a key.
     *
     * Replacement rather than addition, deliberately: "these are the roles this person holds" is a
     * statement a company can check against its org chart, whereas an accumulating list is a thing
     * nobody ever reads and nobody ever revokes. Revocation is `grantRoles(email, [])`, and it is
     * the same signed, visible act as the grant.
     */
    async grantRoles(email, roles, { message } = {}) {
      return serialized(async () => {
        const bytes = files.get(PATHS.peer(email));
        if (!bytes) {
          return { rejected: [{
            reason: `this workspace holds no peer record for ${email} (${PATHS.peer(email)}), so `
              + 'there is nobody to grant a role to. Introduce the peer first with addPeer({ name, '
              + 'email, publicKeySsh, roles }) — a role is granted to a key, not to an email.',
            code: 'no-such-peer', at: PATHS.peer(email),
          }] };
        }
        let previous;
        try { previous = unjson(bytes); } catch {
          return { rejected: [{
            reason: `${PATHS.peer(email)} is not readable JSON, so this workspace cannot say what `
              + 'it would be changing. Repair it (`git log -p -- ' + `${PATHS.peer(email)}\`) first.`,
            code: 'peer-record-unreadable', at: PATHS.peer(email),
          }] };
        }
        const wanted = [...new Set((roles ?? []).filter((r) => typeof r === 'string' && r !== ''))];
        const refusal = await mayGrant(email, wanted);
        if (refusal) return { rejected: [refusal] };
        files.set(PATHS.peer(email), json({ ...previous, roles: wanted }));
        const oid = await repo.commit({
          files,
          message: message ?? peerMessage(
            { name: previous.name ?? email, email }, wanted, previous),
          author: me, time: now(), tzOffsetMinutes, sign,
        });
        await repo.checkout();
        return { oid, roles: wanted };
      });
    },

    /**
     * What this workspace records about the acting peer's authority, and where it came from.
     * The UI's role selector is built from this: it may offer only roles the peer actually holds,
     * and it must be able to say why the list is what it is.
     */
    myRoles() { return kernel.rolesOf(me.email); },
    rolesOf(principal) {
      const r = recordedRoles(principal);
      return {
        principal, roles: [...r.roles], recorded: r.recorded,
        present: r.present, unreadable: r.unreadable, at: PATHS.peer(principal),
      };
    },

    /** Every peer this repository knows, with the roles it records for each. */
    peers() {
      const out = [];
      for (const [path, bytes] of files) {
        if (!path.startsWith('peers/') || !path.endsWith('.json')) continue;
        let rec;
        try { rec = unjson(bytes); } catch {
          out.push({ email: null, name: null, roles: [], recorded: false, unreadable: true, at: path });
          continue;
        }
        out.push({
          email: rec.email ?? null, name: rec.name ?? null,
          roles: Array.isArray(rec.roles) ? [...rec.roles] : [],
          recorded: Array.isArray(rec.roles), unreadable: false, at: path,
        });
      }
      return out.sort((a, b) => String(a.email).localeCompare(String(b.email)));
    },

    /**
     * FD-9's historical question, for one commit: who wrote it, which roles the commit says they
     * acted with, which roles the company recorded for them at that moment, and whether the two
     * agree. Answered from the repository alone — no index, no cache, no trust in this process.
     */
    async authorityAt(oid) {
      const target = (await repo.log(Infinity)).find((c) => c.oid === oid);
      if (!target) return null;
      return { oid, ...(await authorityAtCommit(target)) };
    },

    // -----------------------------------------------------------------------------------------
    // Appendix VII — the public surface. Every one of these is a signed commit except the three
    // that only read. None of them contains cryptography: they compose `runtime/crypto/`.
    // -----------------------------------------------------------------------------------------

    /**
     * What this peer can read, and what it cannot — the honest picture Appendix VII's whole claim
     * rests on. Appendix VII's promise is only as good as a user's ability to see "412 readable, 37
     * opaque" instead of quietly seeing less.
     *
     * `reads` is the accounting of the **last full index build**: `plain` never needed a key,
     * `opened` was decrypted, `opaque` could not be, and `byReason` says why each refusal happened
     * — "opaque because I am not in that group" and "opaque because the wrap was tampered with" are
     * never quietly the same event. For the composition of the index *right now*, including
     * documents written since that build, `query.stats()` is authoritative and is derived from the
     * index itself rather than from a counter that could drift.
     */
    encryptionStatus() {
      if (!keyring) {
        return {
          enabled: false, principal: me.email, vault: theVault !== null,
          groups: [], knownGroups: groupIds(), epochs: [], keyringProblems: [],
          reads: null, problems: [],
          note: 'this workspace was opened without an `encryption` key pair: sealed documents are '
            + 'opaque and counted, never guessed at, and perform({sealFor}) is refused.',
        };
      }
      return {
        enabled: true,
        principal: keyring.principal,
        vault: theVault !== null,
        groups: keyring.groups(),
        knownGroups: keyring.knownGroups(),
        epochs: keyring.epochs(),
        keyringProblems: keyring.problems(),
        // `builtFrom` is the commit THIS ACCOUNTING covers, which is deliberately not
        // `query.stats().builtFrom`: an incremental update advances the index without reading a
        // single blob through the reader, and reporting the newer commit here would make a stale
        // tally look current. Two numbers that can disagree get two names.
        reads: sealedReads ? { ...sealedReads.stats(), builtFrom: sealedReadsAt } : null,
        problems: sealedReads ? sealedReads.problems() : [],
      };
    },

    /**
     * Publish this peer's encryption public key, bound to its own signing key by an SSHSIG that
     * `ssh-keygen -Y verify` accepts. Appendix VII's onboarding step 1, as a signed commit.
     *
     * Until a person has done this, nobody can add them to a group: a group admin who invented an
     * encryption key "for Anna" would be able to read everything wrapped for Anna, and the binding
     * is what makes the claim Anna's own rather than the writer's.
     */
    async enrol({ message } = {}) {
      return serialized(async () => {
        if (!encryption) return { rejected: [noEncryption('enrolling an encryption key')] };
        if (!encryption.publicKey) {
          return { rejected: [{
            reason: 'enrolling publishes this peer\'s encryption PUBLIC key, and open() was given '
              + 'only a private key.\n'
              + '  Pass the whole pair: `encryption: { privateKey, publicKey, curve }`. A private '
              + 'key alone is enough to READ what others sealed for you, which is why open() '
              + 'accepts it, and not enough to tell anybody who you are.',
            code: 'bad-public-key', at: 'kernel.open({ encryption })',
          }] };
        }
        let record;
        try {
          record = await mintEnrolment({
            signing: keyPair, encryption, principal: me.email,
          });
        } catch (e) { return { rejected: [asRefusal(e)] }; }
        const path = CRYPTO_PATHS.enrolment(me.email);
        const existing = enrolmentOf(me.email);
        if (existing && existing['enc-public-key'] === record['enc-public-key']
            && existing['signing-public-key'] === record['signing-public-key']) {
          // An empty commit would say a key was published when nothing changed.
          return { oid: null, unchanged: true, enrolment: existing };
        }
        files.set(path, json(record));
        const oid = await commitAdministration(message ?? [
          `${me.name} publishes an encryption key`, '',
          'NeoDonkey-Transaction: v1',
          `NeoDonkey-Enrolment: ${me.email}`,
          `NeoDonkey-Enc-Curve: ${record['enc-curve']}`,
        ].join('\n') + '\n');
        return { oid, unchanged: false, enrolment: record };
      });
    },

    /**
     * Which entities this workspace records as confidential, and for which groups. Read from
     * `neodonkey.json`, signed into genesis, and not something a caller can relax — see
     * `requiredSealing()` for why that is the whole point rather than an inconvenience.
     */
    sealingPolicy() {
      const out = {};
      for (const entity of Object.keys(settings.sealed ?? {})) {
        const req = requiredSealing(entity);
        if (req) out[entity] = req;
      }
      return out;
    },

    /** Every encryption group this repository knows, and who is in it. Public, no key required. */
    encryptionGroups() {
      const out = [];
      for (const id of groupIds()) {
        const m = groupManifest(id);
        if (!m) {
          out.push({ id, unreadable: true, at: CRYPTO_PATHS.group(id) });
          continue;
        }
        out.push({
          id: m.id, title: m.title ?? m.id, epoch: m.epoch,
          members: (m.members ?? []).map((x) => x.principal).sort(),
          rotations: m.rotations ?? [],
          member: keyring ? keyring.groups().includes(m.id) : false,
          unreadable: false, at: CRYPTO_PATHS.group(id),
        });
      }
      return out;
    },

    /**
     * Create an encryption group at epoch 1, as one signed commit. `members` are principals whose
     * enrolment records this repository already holds, and **this peer must be one of them** — see
     * the block comment above `mayAdministerGroup` for why that is structural rather than policy.
     */
    async createGroup({ id, title, members, message } = {}) {
      return serialized(async () => {
        if (!keyring) return { rejected: [noEncryption('creating an encryption group')] };
        const list = [...new Set((members ?? []).map((p) => String(p)))];
        if (!list.includes(me.email)) {
          return { rejected: [{
            reason: `${me.email} is creating group ${JSON.stringify(id)} and is not in its member `
              + 'list, so they would be handing out a key they then could not use.\n'
              + '  The epoch secret exists in the manifest only as a wrap addressed to each member; '
              + 'a creator who is not a member cannot recover it once this call returns, and could '
              + 'never add a member, rotate the group, or seal a document for it.\n'
              + `  Add ${me.email} to members, or ask a member of the intended group to create it.`,
            code: 'not-a-member',
          }] };
        }
        if (groupManifest(id)) {
          return { rejected: [{
            reason: `this workspace already has an encryption group called ${JSON.stringify(id)} `
              + `(${CRYPTO_PATHS.group(id)}, at epoch ${groupManifest(id).epoch}).\n`
              + '  Creating it again would replace its key and orphan every document sealed for it. '
              + 'To change who is in it, use addGroupMember / offboard; to mint a new key, '
              + 'rotateGroup.',
            code: 'member-exists', at: CRYPTO_PATHS.group(id),
          }] };
        }
        const refusal = mayAdministerGroup('create', id, null);
        if (refusal) return { rejected: [refusal] };
        const enrolments = [];
        for (const principal of list) {
          const e = enrolmentOf(principal);
          if (!e) {
            return { rejected: [{
              reason: `this workspace holds no encryption key for ${principal} `
                + `(${CRYPTO_PATHS.enrolment(principal)}), so nothing can be encrypted to them.\n`
                + '  They publish it themselves — `kernel.enrol()` on their own peer, which signs '
                + 'the key with their signing key and commits it. Nobody else can do it for them: a '
                + 'key somebody else generated "for" them is a key somebody else can read with.',
              code: 'member-unknown', at: CRYPTO_PATHS.enrolment(principal),
            }] };
          }
          enrolments.push(e);
        }
        let created;
        try {
          created = await mintGroup({ id, title: title ?? id, enrolments });
        } catch (e) { return { rejected: [asRefusal(e, CRYPTO_PATHS.group(id))] }; }
        const file = manifestFile(created.manifest);
        files.set(file.path, file.bytes);
        const oid = await commitAdministration(message ?? groupMessage(
          `encryption group ${created.manifest.id} created with `
          + `${list.slice().sort().join(', ')}`, created.manifest));
        return { oid, group: created.manifest.id, epoch: created.epoch, members: list.sort() };
      });
    },

    /**
     * Add a member. `grant` decides how much history the newcomer gets: `'all'` (default) every
     * epoch this peer can supply, `'current'` only the current one — choose that where an epoch
     * boundary is meant to be a confidentiality boundary.
     */
    async addGroupMember(groupId, principal, { grant = 'all', message } = {}) {
      return serialized(async () => {
        if (!keyring) return { rejected: [noEncryption('adding a group member')] };
        const manifest = groupManifest(groupId);
        if (!manifest) return { rejected: [unknownGroup(groupId)] };
        const refusal = mayAdministerGroup('update', groupId, manifest);
        if (refusal) return { rejected: [refusal] };
        const e = enrolmentOf(principal);
        if (!e) {
          return { rejected: [{
            reason: `this workspace holds no encryption key for ${principal} `
              + `(${CRYPTO_PATHS.enrolment(principal)}). They publish it themselves with `
              + '`kernel.enrol()`; a key somebody else generated for them is a key somebody else '
              + 'can read with.',
            code: 'member-unknown', at: CRYPTO_PATHS.enrolment(principal),
          }] };
        }
        let next;
        try {
          next = await addMember({
            manifest, secrets: secretsForGroup(groupId), enrolment: e, grant,
          });
        } catch (err) { return { rejected: [asRefusal(err, CRYPTO_PATHS.group(groupId))] }; }
        const file = manifestFile(next);
        files.set(file.path, file.bytes);
        const oid = await commitAdministration(message ?? groupMessage(
          `${principal} added to encryption group ${groupId}`, next,
          [`NeoDonkey-Group-Added: ${principal}`, `NeoDonkey-Group-Grant: ${grant}`]));
        return { oid, group: groupId, epoch: next.epoch, added: principal, grant };
      });
    },

    /**
     * Remove a member from the manifest and nothing else — the weaker act, kept separate because a
     * caller should have to say which one it means. All *future* wraps stop including them; every
     * epoch secret they already hold, they still hold, because they physically have the repository.
     * `offboard()` is the act that also rotates and re-seals.
     */
    async removeGroupMember(groupId, principal, { message } = {}) {
      return serialized(async () => {
        if (!keyring) return { rejected: [noEncryption('removing a group member')] };
        const manifest = groupManifest(groupId);
        if (!manifest) return { rejected: [unknownGroup(groupId)] };
        const refusal = mayAdministerGroup('update', groupId, manifest);
        if (refusal) return { rejected: [refusal] };
        let next;
        try {
          next = await removeMember({ manifest, principal });
        } catch (err) { return { rejected: [asRefusal(err, CRYPTO_PATHS.group(groupId))] }; }
        const file = manifestFile(next);
        files.set(file.path, file.bytes);
        const oid = await commitAdministration(message ?? groupMessage(
          `${principal} removed from encryption group ${groupId} (no rotation)`, next,
          [`NeoDonkey-Group-Removed: ${principal}`]));
        return {
          oid, group: groupId, epoch: next.epoch, removed: principal,
          limitation:
            `${principal} still physically holds the repository and every epoch secret already `
            + 'wrapped for them. Removing them from the manifest stops all future wraps and nothing '
            + 'else. Use offboard() to rotate the key and re-seal the group\'s documents.',
        };
      });
    },

    /**
     * Mint a new epoch. The new secret is wrapped for every current member; existing wraps stay, so
     * a continuing member keeps access to whatever is still sealed under an older epoch. Documents
     * are NOT moved: rotation on its own changes what happens next, not what already happened.
     */
    async rotateGroup(groupId, { because = 'rotation', message } = {}) {
      return serialized(async () => {
        if (!keyring) return { rejected: [noEncryption('rotating a group key')] };
        const manifest = groupManifest(groupId);
        if (!manifest) return { rejected: [unknownGroup(groupId)] };
        const refusal = mayAdministerGroup('update', groupId, manifest);
        if (refusal) return { rejected: [refusal] };
        let rotated;
        try {
          rotated = await mintEpoch({ manifest, because });
        } catch (err) { return { rejected: [asRefusal(err, CRYPTO_PATHS.group(groupId))] }; }
        const file = manifestFile(rotated.manifest);
        files.set(file.path, file.bytes);
        const oid = await commitAdministration(message ?? groupMessage(
          `encryption group ${groupId} rotated to epoch ${rotated.epoch} (${because})`,
          rotated.manifest, [`NeoDonkey-Group-Rotation: ${because}`]));
        return { oid, group: groupId, epoch: rotated.epoch, because };
      });
    },

    /**
     * **Offboarding, as one commit.** Remove the person, mint a new epoch for everyone else, and
     * re-seal every document this group holds under it — so the former member cannot open anything
     * from now on and cannot even tell which blob is which, because the sealed filename is a keyed
     * hash under the epoch's name key.
     *
     * Subject-keyed documents (the GDPR case) are deliberately left alone: their content key lives
     * in the vault, wrapped for the group, and re-sealing them under a DEK would remove the one
     * property they exist for — that destroying one key erases one person's data. They stay
     * readable to whoever holds the vault, which is what `limitation` says out loud.
     */
    async offboard(groupId, principal, { message } = {}) {
      return serialized(async () => {
        if (!keyring) return { rejected: [noEncryption('offboarding a group member')] };
        const manifest = groupManifest(groupId);
        if (!manifest) return { rejected: [unknownGroup(groupId)] };
        const refusal = mayAdministerGroup('update', groupId, manifest);
        if (refusal) return { rejected: [refusal] };
        const documents = sealedInventory()
          .filter((d) => d.subject === null
            && d.groups.some((g) => g.startsWith(`${groupId}@`)))
          .map((d) => ({ path: d.path, bytes: d.bytes }));
        let result;
        try {
          result = await offboardAndReseal({
            manifest, secrets: secretsForGroup(groupId), principal, documents,
            resolve: keyring.resolve,
          });
        } catch (err) { return { rejected: [asRefusal(err, CRYPTO_PATHS.group(groupId))] }; }
        for (const path of result.removals) files.delete(path);
        for (const [path, bytes] of result.writes) files.set(path, bytes);
        const oid = await commitAdministration(message ?? groupMessage(
          `${principal} offboarded from encryption group ${groupId}: rotated to epoch `
          + `${result.epoch}, ${result.resealed} document(s) re-sealed`,
          result.manifest, [
            `NeoDonkey-Group-Removed: ${principal}`,
            `NeoDonkey-Group-Rotation: member-removed`,
            `NeoDonkey-Group-Resealed: ${result.resealed}`,
          ]));
        return {
          oid, group: groupId, epoch: result.epoch, offboarded: principal,
          resealed: result.resealed,
          moved: result.removals.slice().sort(),
          // Carried through from `groups.js` rather than paraphrased, so a UI cannot show a
          // reassuring "offboarded" without the sentence that makes it honest.
          limitation: result.limitation,
        };
      });
    },

    /** The subject keys this repository records, live and erased. Pseudonymous by contract. */
    subjects() {
      const out = [];
      for (const [path, bytes] of files) {
        if (!path.startsWith(SUBJECTS_AT) || !path.endsWith('.json')) continue;
        let rec;
        try { rec = parseJsonBytes(bytes); } catch {
          out.push({ at: path, unreadable: true });
          continue;
        }
        out.push({
          keyId: rec['key-id'], subject: rec.subject, state: rec.state,
          groups: rec.groups ?? [], at: path, unreadable: false,
        });
      }
      return out.sort((a, b) => String(a.subject).localeCompare(String(b.subject)));
    },

    /**
     * Honour an erasure request (GDPR Art. 17) by destroying one data subject's content key, as one
     * signed, dated commit.
     *
     * Nothing is deleted from the books. The blobs stay, byte-identical, with the hashes the commit
     * chain recorded (GoBD Unveränderbarkeit, Vollständigkeit, Nachvollziehbarkeit) — and they are
     * noise forever. The two files this writes are the audit trail a Betriebsprüfer reads: which
     * subject, who asked, on what basis, and which documents became unreadable.
     *
     * **This erases on THIS peer.** The vault is per peer, so an erasure is complete only when every
     * peer has run it; the commit is what carries the order across the mesh, and honouring it is
     * `runtime/sync/`'s business, not this function's.
     */
    async eraseSubject({ subject, reason, requestedBy, at, message } = {}) {
      return serialized(async () => {
        if (!keyring) return { rejected: [noEncryption('erasing a subject key')] };
        if (!theVault) return { rejected: [noVault('erasing a subject key')] };
        const found = subjectRecordFor(subject);
        if (!found) {
          return { rejected: [{
            reason: `this workspace records no subject key for ${JSON.stringify(subject)}, so there `
              + 'is nothing to destroy.\n'
              + `  It records: ${kernel.subjects().map((s) => s.subject).join(', ') || 'none'}.\n`
              + '  A missing key is never reported as an honoured erasure request: saying "erased" '
              + 'about a key this peer was simply never given would be a lie to a regulator.',
            code: 'subject-key-missing',
          }] };
        }
        // Who may erase: a member of a group the key is wrapped for. You may not destroy key
        // material you could not have opened — that is the plainest form of the rule, and it needs
        // no word from any company's vocabulary. A company that wants to say more declares
        // authority for `delete encryption-group` in its own model, which outranks this.
        const govern = mayAdministerGroup('delete', null, null);
        if (govern) return { rejected: [govern] };
        const held = keyring.epochs();
        if (!(found.rec.groups ?? []).some((g) => held.includes(g))) {
          return { rejected: [{
            reason: `${me.email} holds no key for any group the subject key of `
              + `${JSON.stringify(subject)} is wrapped for, so they may not destroy it.\n`
              + `  It is wrapped for: ${(found.rec.groups ?? []).join(', ') || 'nothing'}. `
              + `${me.email} holds: ${held.join(', ') || 'no group secrets at all'}.\n`
              + '  Destroying key material you could never have opened is not an erasure you can '
              + 'attest to; ask a member of an authorised group to honour the request.',
            code: 'not-a-member', at: found.path,
          }] };
        }
        const keyId = found.rec['key-id'];
        const documents = sealedInventory()
          .filter((d) => d.subject === keyId).map((d) => d.path).sort();
        let result;
        try {
          result = await destroySubjectKey({
            vault: theVault, record: found.rec, reason, at: at ?? nowIso(),
            requestedBy: requestedBy ?? me.email, documents, keyrings: [keyring],
          });
        } catch (e) { return { rejected: [asRefusal(e, found.path)] }; }
        for (const [path, bytes] of result.files) files.set(path, bytes);
        const oid = await commitAdministration(message ?? [
          `GDPR erasure: subject key for ${subject} destroyed`, '',
          'NeoDonkey-Transaction: v1',
          `NeoDonkey-Erasure: ${keyId}`,
          `NeoDonkey-Erasure-Subject: ${subject}`,
          `NeoDonkey-Erasure-Requested-By: ${result.erasure['requested-by']}`,
          `NeoDonkey-Erasure-At: ${result.erasure.at}`,
          `NeoDonkey-Erasure-Documents: ${documents.length}`,
          `NeoDonkey-Actor-Roles: ${recordedRoles(me.email).roles.join(' ') || '(none)'}`,
        ].join('\n') + '\n');
        return {
          oid, subject, keyId, destroyed: result.destroyed, documents,
          keyringsCleared: result.keyringsCleared,
          note: result.erasure.note,
        };
      });
    },

    /**
     * What a peer holding NO key can still learn about one sealed document: which groups could open
     * it (or which subject key), the algorithm, the size, the format version. Appendix VII's honest
     * statement of metadata leakage, as a function, so a UI can show it and an auditor can check the
     * `NeoDonkey-Sealed:` trailer against the blob rather than taking the trailer's word.
     */
    inspectSealed(entity, id) {
      const bytes = files.get(PATHS.doc(entity, id));
      if (!bytes || !isEnvelope(bytes)) return null;
      try { return inspectEnvelope(bytes); } catch { return null; }
    },

    /**
     * Where a sealed document lives, given its business name. Without this a member could decrypt a
     * document and never find it, which is a half-capability of exactly the kind this wave exists to
     * stop shipping: the id on disk is a keyed hash, so only a key holder can compute it.
     */
    async sealedPathFor({ entity, name, group, epoch } = {}) {
      if (!keyring) return null;
      return keyring.pathFor({ entity, name, group, ...(epoch ? { epoch } : {}) });
    },

    /** The same lookup, answered from the index: seal a document by name, find it by name. */
    async findSealed({ entity, name, group, epoch } = {}) {
      const path = await kernel.sealedPathFor({ entity, name, group, epoch });
      if (path === null) return null;
      const parsed = parseDocPath(path);
      return parsed ? (index.get(parsed.entity, parsed.id) ?? null) : null;
    },

    /**
     * Next id for an entity.
     *
     * FD-6: this is NOT how a legally numbered document gets its number. It counts existing
     * documents, which breaks on deletion and on two peers, and it is what v0.1 did for
     * everything. It survives for entities whose ids carry no legal meaning (a goods receipt, a
     * stock adjustment) and refuses outright for any entity a number series governs, naming the
     * series — so a caller cannot get a fake invoice number out of the kernel by accident.
     */
    nextId(entity, prefix) {
      const decl = seriesFor(entity);
      if (decl) {
        throw new Error(
          `${entity} numbers come from the "${decl.series}" series (declared in ${decl.source}), `
          + 'which must be gapless (GoBD). Create the document with no id and the number is '
          + 'issued inside the same commit — nextId() counts documents and would produce a gap '
          + 'the first time one is deleted.');
      }
      const p = prefix ?? entity.split('-').map((w) => w[0].toUpperCase()).join('');
      const existing = index.all(entity).length;
      return `${p}-${String(existing + 1).padStart(4, '0')}`;
    },

    _internals: { repo, files, get settings() { return settings; } },
  };

  // -------------------------------------------------------------------------------------------
  // perform(), in full. Order matters and every step is a gate:
  //   1. the model must be readable at all
  //   2. FD-7: the operation must be governed by something
  //   3. FD-6: the sequence entity is written by the allocator, never by hand
  //   4. the signers must be real, distinct, and known to this repository
  //   5. four-eyes: the requirement must be satisfiable by those signers
  //   6. the rules must accept the event
  //   7. FD-6: a number is allocated as part of the same commit, or not at all
  //   8. one commit, n+1 signatures over one payload
  // -------------------------------------------------------------------------------------------
  async function performOne(intent) {
    if (modelErrors.length) {
      // Principle 6: a model we cannot fully read is never half-executed.
      return { rejected: modelErrors.map((e) => ({
        reason: `operating model has errors and will not be executed: ${e.message}`,
        at: `${e.file}:${e.line}`,
      })) };
    }
    const op = String(intent.op || '').toLowerCase();

    if (intent.entity === SEQUENCE_ENTITY) {
      return { rejected: [{
        reason: `${SEQUENCE_ENTITY} documents record which numbers have been issued. They are `
          + 'written by the allocator inside the commit that consumes a number, and by nothing '
          + 'else — a hand-written sequence is a hand-written invoice number.',
        code: 'sequence-is-not-writable',
      }] };
    }

    // FD-9, and it is the FIRST gate after the model itself, before authorization, before signers
    // and before any number is allocated. Everything downstream — the kernel's own coverage check,
    // the rule engine, the signature requirement — is handed grounded roles and never sees the
    // claim, so there is exactly one place in the system where a caller's assertion about itself
    // is turned into a fact, and this is it.
    const grounded = groundRoles(intent);
    if (grounded.refusal) return { rejected: [grounded.refusal] };
    const actorRoles = grounded.roles;

    const authRefusal = checkAuthorization(intent.entity, op, actorRoles, grounded);
    if (authRefusal) return { rejected: [authRefusal] };

    const { signers, problems: signerProblems } = await normalizeSigners(intent, actorRoles);
    if (signerProblems.length) return { rejected: signerProblems };

    const requirement = signatureRequirement(intent.entity, op);
    const reqProblems = checkRequirement(requirement, signers, intent.doc || null);
    if (reqProblems.length) return { rejected: reqProblems };

    const { allocation, problems: allocProblems } = allocateFor(intent, op);
    if (allocProblems.length) return { rejected: allocProblems };

    // Appendix VII. Resolved here — before the rules run and before anything is written — so that
    // `sealFor: ['no-such-group']` is a cheap refusal with no side effect, and so a workspace with
    // no `encryption` option refuses to *pretend* rather than silently writing plaintext.
    const declared = requiredSealing(intent.entity);
    let sealFor = intent.sealFor;
    if (declared) {
      if (sealFor === undefined || sealFor === null) {
        sealFor = declared;          // the company already said it; the caller need not repeat it
      } else {
        // The caller may widen (add a group, add a subject key) and never narrow. A repo-recorded
        // confidentiality requirement that a call argument can drop is not a requirement.
        const spec = Array.isArray(sealFor) ? { groups: sealFor } : (sealFor || {});
        const asked = Array.isArray(spec.groups) ? spec.groups.map(String) : [];
        const dropped = declared.filter((g) => !asked.includes(g));
        if (dropped.length) {
          return { rejected: [{
            reason: `${PATHS.settings} records that every ${intent.entity} in this company is sealed `
              + `for ${declared.join(', ')}, and this call asked to seal it for `
              + `${asked.join(', ') || 'nothing'} — dropping ${dropped.join(', ')}.\n`
              + '  A caller may add groups and may add a subject key; it may never drop a group the '
              + 'workspace itself recorded. Otherwise the confidentiality of a salary would be '
              + 'decided by whichever script happened to write it.\n'
              + `  The setting is in the genesis commit and signed — \`git log -1 --format=%B `
              + `$(git rev-list --max-parents=0 HEAD)\` shows it as NeoDonkey-Sealed-Entities.`,
            code: 'sealing-narrowed', at: PATHS.settings, entity: intent.entity, dropped,
          }] };
        }
      }
    }

    let sealing = null;
    if (sealFor !== undefined && sealFor !== null) {
      const planned = planSealing(sealFor);
      if (planned.problems.length) {
        return { rejected: planned.problems.map((p) => (declared && p.code === 'encryption-not-configured'
          ? { ...p, at: PATHS.settings, reason:
            `${PATHS.settings} records that every ${intent.entity} in this company is sealed for `
            + `${declared.join(', ')}, so this workspace will not write one in the clear.\n  ${p.reason}` }
          : p)) };
      }
      sealing = planned.plan;
    }

    // FD-9: the rule engine is handed the GROUNDED roles. `evaluate()` keeps its version-1
    // contract — it still reads `intent.actorRoles` — and simply never sees a claim again.
    const effective = { ...intent, actorRoles, ...(allocation ? { id: allocation.number } : {}) };
    // grammar.md §16.2: "The kernel owns this switch." So the kernel hands the executor the same
    // setting it just enforced itself. Both layers refusing the same thing is deliberate: this is
    // the defect COMPROMISES #4c-bis calls the worst in v0.1, the executor's own refusal quotes
    // the model, and a version-1 executor that ignores a fourth argument still gets refused above.
    const result = evaluate(model, effective, world(), {
      authorization: settings.authorization.strict ? 'strict' : 'permissive',
    });
    if (!result.ok) {
      // Nothing is written, and therefore nothing is consumed: the allocation above was a value,
      // never a state. The next attempt gets the same number.
      return { rejected: result.violations.map(describeViolation) };
    }

    // A rule may create a document of an entity the workspace records as confidential even when the
    // trigger is not one — "if a goods receipt arrives then create a payroll adjustment". The plan
    // above was derived from the TRIGGER, so this is the one place that could still write a declared
    // entity in the clear. It refuses rather than silently over-sealing the whole event: seals the
    // caller did not ask for are as surprising as plaintext the caller did not intend, and only one
    // of the two is recoverable.
    const have = sealing ? sealing.groups.map((g) => g.id) : [];
    for (const change of result.changes) {
      if (change.entity === SEQUENCE_ENTITY) continue;
      const req = requiredSealing(change.entity);
      if (!req) continue;
      const missing = req.filter((g) => !have.includes(g));
      if (!missing.length) continue;
      return { rejected: [{
        reason: `this event also writes ${article(change.entity)} ${change.entity} (${change.id}), `
          + `and ${PATHS.settings} records that every ${change.entity} is sealed for `
          + `${req.join(', ')} — ${missing.join(', ')} is not covered by this call.\n`
          + '  A rule that derives a confidential document from an ordinary event is exactly the '
          + 'case where a per-call flag would have written plaintext, so it is refused instead of '
          + 'guessed at.\n'
          + `  Perform it with \`sealFor: [${[...new Set([...have, ...req])].map((g) => JSON.stringify(g)).join(', ')}]\`, `
          + 'which seals every document this event writes — a commit is one business event and its '
          + 'consequents carry the same data.',
        code: 'consequent-must-be-sealed', at: PATHS.settings,
        entity: change.entity, id: change.id, requires: req,
      }] };
    }

    return await commitChanges(result.changes, effective, result.appliedRules ?? [], {
      signers, allocation, sealing,
    });
  }

  /**
   * Apply changes to the tree and seal them as ONE signed commit — with n co-signatures inside
   * the payload the primary signature covers. See runtime/identity/cosign.js for the ordering
   * rule; this function is the only place it is applied.
   */
  async function commitChanges(changes, intent, appliedRules, {
    signers = null, allocation = null, sealing = null,
  } = {}) {
    const all = [...changes];
    if (allocation) {
      // The allocation is one more Change in the same commit. This single line is FD-6: the
      // number and the document that uses it are the same atomic write, or neither happens.
      all.push({
        op: allocation.op, entity: SEQUENCE_ENTITY, id: allocation.sequenceAfter.id,
        before: allocation.sequenceBefore, after: allocation.sequenceAfter,
      });
    }

    // ---- Appendix VII. Sealing happens BEFORE anything is written, and it replaces the write:
    // the plaintext path is never set, never staged, never committed and never checked out. If both
    // paths existed, the encryption would be decorative.
    let sealTrailers = [];
    let moved = [];
    let staged = all;
    // Cleared here as well as in `refreshIndex`'s `finally`, so that a commit which throws between
    // the two — the co-signature self-check does throw, deliberately and loudly — cannot leave one
    // event's plaintext visible to the next one's index update.
    stagedPlain.clear();
    if (sealing) {
      const s = await sealChanges(all, sealing);
      if (s.problems.length) return { rejected: s.problems };
      // The commit subject is public. It must not name a document whose whole point is that its
      // name is a keyed hash — except for a name FD-6 has already published in this same commit's
      // sequence trailer, where GoBD Vollständigkeit requires the number to be visible and refusing
      // here would be theatre.
      const published = new Set(allocation ? [String(allocation.number)] : []);
      const leaked = s.names.filter((n) => !published.has(n)
        && typeof intent.message === 'string' && intent.message.includes(n));
      if (leaked.length) {
        return { rejected: [{
          reason: `the commit message would name ${leaked.map((n) => JSON.stringify(n)).join(', ')}, `
            + 'and this document is being sealed so that its name is not in the clear.\n'
            + '  A commit message is a public repo file: every peer reads it with `git log`, member '
            + 'or not. Writing the plaintext name there would undo the keyed filename the seal just '
            + 'produced, which is the one part of Appendix VII a reviewer would test first.\n'
            + '  Say what happened without naming it — "salary sealed for hr" — or leave `message` '
            + 'out and the kernel writes a subject that names the sealed id instead.',
          code: 'sealed-name-in-message',
        }] };
      }
      staged = s.staged;
      sealTrailers = s.trailers;
      moved = s.removals;
      for (const path of s.removals) files.delete(path);
      for (const [path, bytes] of s.extraFiles) files.set(path, bytes);
      for (const w of s.writes) files.set(w.path, w.bytes);
    }

    for (const change of staged) {
      const path = PATHS.doc(change.entity, change.id);
      if (change.op === 'delete') files.delete(path);
      else if (!sealing || change.entity === SEQUENCE_ENTITY) files.set(path, json(change.after));
    }
    const extra = [...sealTrailers];
    if (allocation) {
      extra.push(sequenceTrailer(
        allocation.declaration, allocation.period, allocation.value, intent.entity, intent.id,
      ));
    }
    // The trigger's id, as it now is on disk. For a sealed document that is the keyed hash, so the
    // default commit subject and every `NeoDonkey-Change:` trailer name the sealed id and not the
    // name — the same id `perform()` returns, so a caller can find what it just wrote.
    const stagedChanges = staged.slice(0, changes.length);
    const triggerAt = changes.findIndex(
      (c) => c.entity === intent.entity && String(c.id) === String(intent.id));
    const stagedIntent = sealing && triggerAt !== -1
      ? { ...intent, id: stagedChanges[triggerAt].id } : intent;
    const message = buildMessage(stagedIntent, stagedChanges, appliedRules, extra);

    const cosigners = (signers || []).filter((s) => !s.isPrimary);
    const oid = await repo.commit({
      files, message, author: me, time: now(), tzOffsetMinutes,
      sign: cosigners.length ? multiSign(cosigners) : sign,
    });

    if (cosigners.length) {
      // Self-check against our own verifier, on the bytes that are now in the DAG. Everything it
      // could complain about was checked before a byte was written, so a failure here is a bug in
      // us — and it is loud, because the alternative is a commit that looks dual-controlled and
      // is not (COMPROMISES #4d's exact failure mode). History is not rewritten; the commit stays
      // where an auditor can look at it.
      const report = await verifySignaturesOf(oid);
      if (!report.ok) {
        throw new Error(`kernel: wrote a commit whose signatures do not verify (${oid}): `
          + report.problems.map((p) => p.code).join(', '));
      }
    }

    await repo.checkout();
    index = await refreshIndex(staged, oid, moved);
    return {
      oid, changes: stagedChanges,
      ...(allocation ? { number: allocation.number, series: allocation.declaration.series } : {}),
      ...(cosigners.length ? { cosigners: cosigners.map((c) => c.principal) } : {}),
      // What was sealed, for what, as the signed commit records it. Returned rather than left to be
      // rediscovered, because a caller that has just sealed a document needs the sealed id to find
      // it again, and a caller that has not asked for sealing sees no new field at all.
      ...(sealing ? { sealed: sealTrailers.map(parseSealedTrailer).filter(Boolean) } : {}),
    };
  }

  /**
   * The staircase, as a `sign` callback. `content` is P0 — the commit bytes with no gpgsig and no
   * co-signature trailers. Co-signature k covers P(k-1); the primary covers Pn.
   */
  function multiSign(cosigners) {
    return async (content) => {
      const lines = [];
      let payload = content;
      for (const c of cosigners) {
        const armored = await cosignPayload(c.keyPair, payload);
        lines.push(cosignTrailer(c.principal, armored));
        payload = payloadWithCosignatures(content, lines);
      }
      const signature = await sign(payload);
      const split = indexOfBlankLine(content);
      const baseMessage = dec.decode(content.subarray(split));
      return { signature, message: baseMessage + lines.map((l) => `${l}\n`).join('') };
    };
  }

  /** Verify one commit's full signature set with our own code. */
  async function verifySignaturesOf(oid) {
    const [commit] = await repo.log(1);
    const target = commit && commit.oid === oid
      ? commit
      : (await repo.log(Infinity)).find((c) => c.oid === oid);
    if (!target) return { ok: false, problems: [{ code: 'no-such-commit', message: `no commit ${oid}` }], signatures: [] };
    return verifyCommitSignatures({
      payload: target.payload,
      primarySignature: target.signature,
      primaryPrincipal: target.author.email,
      resolveKey: peerKey,
    });
  }

  /**
   * Update the view after a commit. `changed` is a list of [path, key] pairs and the reader is
   * called with the key — here the path itself, since we already hold the bytes in memory.
   *
   * A view that cannot update incrementally is simply rebuilt (that is what "the index is a
   * view, not truth" buys us). But the fallback is *recorded*, never silent: a swallowed
   * exception here once hid a real bug for an hour, where documents were committed correctly
   * and then invisible to the next rule check.
   */
  async function refreshIndex(changes, oid, moved = []) {
    const changed = [], removed = [...moved];
    for (const c of changes) {
      const path = PATHS.doc(c.entity, c.id);
      if (c.op === 'delete') removed.push(path); else changed.push([path, path]);
    }
    try {
      return await updateIndex(index, {
        changed, removed,
        // `stagedPlain` first: for a document this commit sealed, `files` holds the envelope and we
        // already hold the plaintext. Empty in every workspace opened without `encryption`, so this
        // is the same lookup it always was.
        readBlob: async (key) => stagedPlain.get(key) ?? files.get(key) ?? null,
        builtFrom: oid,
      });
    } catch (e) {
      warnings.push({ at: 'refreshIndex', message: e.message, oid });
      return await buildIndex(oid);
    } finally {
      // Never a cache. The plaintext of a sealed document lives in the index and in the envelope,
      // and one microsecond longer than that in this map would be a third copy nobody audits.
      stagedPlain.clear();
    }
  }

  return kernel;
}

/**
 * Commit messages carry the transaction as git trailers: readable by a human in
 * `git log`, parseable by a machine, and part of the signed payload — which is exactly
 * what GoBD Nachvollziehbarkeit asks for (Appendix IX).
 */
function buildMessage(intent, changes, appliedRules, extraTrailers = []) {
  const head = intent.message ??
    `${intent.entity} ${intent.id} ${intent.op === 'create' ? 'created' : intent.op + 'd'}`;
  const lines = [head, '', 'NeoDonkey-Transaction: v1'];
  // FD-9: the roles the author ACTUALLY held when this commit was written, inside the signed
  // payload. This is what makes the historical question — "did the author hold the roles the rule
  // required at the time?" — answerable from `git log` alone, by somebody who does not trust our
  // code. The actor is the commit's own author header (the primary signature is always this
  // peer's), so it is not repeated here: two copies of one fact can disagree, and the git header
  // is the one foreign tooling reads.
  //
  // `(none)` rather than an absent trailer, so that "held no roles" and "written before FD-9" stay
  // distinguishable forever; a missing trailer means the latter and nothing else.
  lines.push(`NeoDonkey-Actor-Roles: ${
    Array.isArray(intent.actorRoles) && intent.actorRoles.length
      ? [...intent.actorRoles].join(' ')
      : '(none)'}`);
  for (const c of changes) lines.push(`NeoDonkey-Change: ${c.op} ${c.entity} ${c.id}`);
  for (const r of appliedRules) {
    if (r?.source) lines.push(`NeoDonkey-Rule: ${r.source.file}:${r.source.line}`);
  }
  // FD-6: the issuance of a document number is part of the signed payload, so the gaplessness of
  // a series is checkable from `git log` alone, by someone who does not trust our code.
  for (const t of extraTrailers) lines.push(t);
  return lines.join('\n') + '\n';
}

/** English article, so a refusal reads like a sentence a person wrote. Mirrors execute.js. */
const article = (word) => (/^[aeiou]/i.test(String(word)) ? 'an' : 'a');

/** Index of the first byte after the header block's terminating blank line. */
function indexOfBlankLine(bytes) {
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x0a && bytes[i + 1] === 0x0a) return i + 2;
  }
  throw new Error('kernel: commit bytes have no header/message separator');
}

/**
 * The workspace's recorded settings, for a repo that already exists.
 *
 * FD-7's constraint in one function: **the repository decides.** A workspace written before
 * `neodonkey.json` existed has none, and its absence means what silence meant then — ungoverned
 * operations were permitted. Reading it as strict would change the meaning of a 2027 folder,
 * which is a major-version act and not something an option may do. A caller that passes
 * `strictAuthorization` contradicting the record is refused rather than quietly overruled: a
 * silent disagreement about a security setting is the exact class of defect #4c-bis was.
 */
function readSettings(files, options) {
  const bytes = files.get(PATHS.settings);
  let recorded = null;
  if (bytes) {
    try {
      recorded = JSON.parse(dec.decode(bytes));
    } catch (e) {
      throw new Error(`${PATHS.settings} is not readable JSON (${e.message}). It records how this `
        + 'workspace authorizes operations, so it is not something to guess at.');
    }
  }
  const strict = recorded && recorded.authorization
    ? recorded.authorization.strict === true
    : false;   // a pre-strict workspace keeps its meaning, forever
  if (options.strictAuthorization !== undefined && options.strictAuthorization !== strict) {
    throw new Error(
      `this workspace records authorization.strict = ${strict} in ${PATHS.settings}`
      + `${recorded ? '' : ' (by having no such file — it predates the setting)'}, and open() was `
      + `called with strictAuthorization: ${options.strictAuthorization}. The repository decides: `
      + 'changing it would change what every rule in it means, which is a major-version act, not '
      + 'an option.');
  }
  // Appendix VII, and the same rule for the same reason. Which entities are confidential is a
  // security setting the REPOSITORY decides; a caller that passes a different table is refused
  // rather than quietly overruled, because the dangerous direction is silent: a script that passes
  // `sealed: {salary: ['hr']}` against a workspace recording nothing would believe every salary it
  // writes is protected, and every one of them would be plaintext.
  if (options.sealed !== undefined) {
    const want = normalizeSealedTable(options.sealed);
    const has = normalizeSealedTable(recorded?.sealed ?? {});
    if (JSON.stringify(want) !== JSON.stringify(has)) {
      throw new Error(
        `this workspace records "sealed": ${JSON.stringify(has)} in ${PATHS.settings}`
        + `${recorded ? '' : ' (by having no such file — it predates the setting)'}, and open() was `
        + `called with sealed: ${JSON.stringify(want)}. The repository decides which of its own `
        + 'entities are confidential: the setting is written once, into the signed genesis commit, '
        + 'and visible to anyone who opens the folder.\n'
        + '  Passing it here and being silently overruled is the failure mode this refusal exists '
        + 'for — a caller would believe its salaries were sealed while every one of them was '
        + 'plaintext. Start a new workspace, or drop the option and read '
        + '`kernel.sealingPolicy()` instead.');
    }
  }
  return Object.freeze({
    neodonkey: recorded?.neodonkey ?? 0,
    authorization: Object.freeze({ strict }),
    sequences: Object.freeze({ ...(recorded?.sequences ?? {}) }),
    fourEyes: Object.freeze({ ...(recorded?.fourEyes ?? {}) }),
    // Appendix VII. Which entities this workspace records as confidential, and for which groups.
    // Same reasoning as `fourEyes`, and it is the reason this is a repo file rather than a call
    // option: "salary documents are sealed for HR" is a fact about the *company*, so a caller must
    // not be able to relax it by forgetting to pass something. See `requiredSealing()`.
    sealed: Object.freeze({ ...(recorded?.sealed ?? {}) }),
  });
}

function parseTrailers(message) {
  return message.split('\n')
    .filter((l) => l.startsWith('NeoDonkey-Change: '))
    .map((l) => {
      const [op, entity, id] = l.slice('NeoDonkey-Change: '.length).split(' ');
      return { op, entity, id };
    });
}

/**
 * `NeoDonkey-Sealed: <entity> <sealed-id> hr@1,board@2` (or `… subject:<key-id>`) → an object.
 *
 * This trailer is Appendix VII's audit answer to "which groups could open this document", and it is
 * inside the payload the author's signature covers, so it cannot be edited after the fact. It is
 * deliberately not the ONLY answer: the same fact is in the blob's own public header, readable with
 * `envelope.inspect()` by a peer holding no key at all (`kernel.inspectSealed()`). Two independent
 * sources, and a test that they agree, is what makes this checkable by somebody who does not trust
 * our code.
 */
export function parseSealedTrailer(line) {
  const m = /^NeoDonkey-Sealed:[ \t]*(\S+)[ \t]+(\S+)[ \t]+(\S+)[ \t]*$/.exec(String(line ?? ''));
  if (!m) return null;
  const [, entity, id, by] = m;
  return by.startsWith('subject:')
    ? { entity, id, groups: [], subject: by.slice('subject:'.length) }
    : { entity, id, groups: by.split(',').filter((s) => s !== ''), subject: null };
}

/** Every sealing one commit message records. */
function parseSealedTrailers(message) {
  return String(message ?? '').split('\n').map(parseSealedTrailer).filter((s) => s !== null);
}

/**
 * Turn a rule violation into something a person can act on.
 *
 * The author's own sentence is preferred over anything we could reconstruct — `rule.text` is the
 * text they actually wrote, with their capitalisation and line breaks. Showing a normalised
 * paraphrase instead would quietly teach the reader that the system speaks a different language
 * than the one in their file, which is the whole thing we are trying not to do.
 */
function describeViolation(v) {
  const source = v.file ? { file: v.file, line: v.line } : v.rule?.source;
  return {
    reason: v.reason,
    rule: v.rule?.text ?? (v.rule ? quoteRule(v.rule) : null),
    file: source?.file ?? null,
    line: source?.line ?? null,
    at: source ? `${source.file}:${source.line}` : null,
  };
}

/** Fallback only, for a violation carrying a rule that has no source text. */
function quoteRule(rule) {
  const conds = rule.conditions?.map((c) => c.text ?? JSON.stringify(c)).join(' and ') ?? '';
  const cons = rule.consequents?.map((c) => c.text ?? JSON.stringify(c)).join(' and ') ?? '';
  return `If ${rule.trigger.op} ${rule.trigger.entity}` +
    (conds ? ` under condition ${conds}` : '') + (cons ? ` then ${cons}` : '');
}

function genesisMessage(me, settings, roles) {
  return [
    `${me.name} starts a company`,
    '',
    'This is the genesis commit of a NeoDonkey workspace.',
    'From here on, every fact in this company is a signed commit in this repo.',
    'It is simply a folder. With the company inside.',
    '',
    'NeoDonkey-Transaction: v1',
    'NeoDonkey-Genesis: true',
    // In the genesis commit, and therefore signed: what this workspace does when nothing applies.
    `NeoDonkey-Authorization: ${settings.authorization.strict ? 'strict' : 'permissive'}`,
    // Appendix VII, and in genesis for the same reason: which entities this company records as
    // confidential is a security setting, so it is signed once and visible to anyone who opens the
    // folder, rather than being a flag a caller passes and can forget.
    `NeoDonkey-Sealed-Entities: ${
      Object.keys(settings.sealed ?? {}).sort().join(' ') || '(none)'}`,
    // FD-9: the ROOT GRANT. Every other role in this company is traceable back to this line, and
    // it is in the first commit, signed by the person it grants to, where an auditor looks first.
    // A founder who granted themselves nothing can perform nothing — that is not a bug, it is the
    // fail-closed default said out loud in the one commit nobody can miss.
    `NeoDonkey-Founder-Roles: ${roles && roles.length ? [...roles].join(' ') : '(none)'}`,
  ].join('\n') + '\n';
}
