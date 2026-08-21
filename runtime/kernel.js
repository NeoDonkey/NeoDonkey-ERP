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
