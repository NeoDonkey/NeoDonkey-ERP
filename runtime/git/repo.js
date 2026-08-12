// runtime/git/repo.js — the Truth Layer's porcelain. Exactly what we need, nothing more.
//
// Appendix III: "Git is the database." This is the write path into it. One commit per
// business event, atomic by nature (Appendix VIII, simple case) — a commit either
// exists in full or does not exist, so the accounting super-GAU of "invoice sent but
// tax not booked" is structurally impossible rather than defended against.
//
// Determinism (non-negotiable #5): nothing here reads a clock. `time` and
// `tzOffsetMinutes` are always injected. Signing is injected too (`sign`), so this
// module knows nothing about Ed25519 or SSHSIG — that is runtime/identity/ (agent B).

import {
  objectStore, encodeTree, decodeTree, encodeCommit, decodeCommit, commitPayload, assertOid,
} from './objects.js';
import { encodeIndex, decodeIndex } from './index-file.js';
import { packedStore } from './store.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID */
/** @typedef {{ name: string, email: string }} Identity */
/** @typedef {import('./fs.js').FsAdapter} FsAdapter */

const enc = new TextEncoder();
const dec = new TextDecoder();

const HEAD_PATH = '.git/HEAD';
const MAIN_REF = 'refs/heads/main';
const INDEX_PATH = '.git/index';

// core.filemode = false is not laziness. OPFS and the File System Access API have no
// concept of a POSIX permission bit, so a repo written by the browser cannot honestly
// promise to track one. Declaring that up front is better than emitting an index that
// real git reports as modified on one platform and clean on another.
// logallrefupdates is left on so that a human running `git` commands in her own company
// folder keeps the reflog safety net for *her* operations. Known gap, stated rather than
// hidden: our setHead() does not write reflog entries, so the reflog covers only what the
// git binary did. The commit DAG, not the reflog, is the truth (Appendix III).
const CONFIG = `[core]
\trepositoryformatversion = 0
\tfilemode = false
\tbare = false
\tlogallrefupdates = true
`;

/**
 * Create an empty repository. `objects/` and `refs/` must exist as *directories* or
 * git's is_git_directory() refuses to recognise the folder at all — which is why
 * FsAdapter needs mkdir (CONTRACT amendment A-1).
 * @param {FsAdapter} fs
 * @returns {Promise<void>}
 */
export async function initRepo(fs) {
  await fs.mkdir('.git/objects/info');
  await fs.mkdir('.git/objects/pack');
  await fs.mkdir('.git/refs/heads');
  await fs.mkdir('.git/refs/tags');
  await fs.write(HEAD_PATH, enc.encode(`ref: ${MAIN_REF}\n`));
  await fs.write('.git/config', enc.encode(CONFIG));
}

/**
 * @param {string} path
 * @returns {string[]} validated path segments
 */
function checkDocumentPath(path) {
  if (typeof path !== 'string' || path === '') throw new Error(`commit: bad path ${JSON.stringify(path)}`);
  const parts = path.split('/');
  for (const p of parts) {
    if (p === '' || p === '.' || p === '..') {
      throw new Error(`commit: illegal path segment in ${JSON.stringify(path)}`);
    }
  }
  if (parts[0] === '.git') throw new Error(`commit: refusing to commit into .git: ${path}`);
  return parts;
}

/**
 * @param {FsAdapter} fs
 * @param {{store?: object, packed?: boolean, repackThreshold?: number,
 *          repackBatch?: number, verifyOids?: boolean}} [opts] FD-2, additive:
 *   `repo(fs)` still means "a repo", it just now reads packfiles as well as loose objects.
 *   `packed: false` restores the pure loose-object store, and `store` injects one (the
 *   crash-injection tests need that). `repackThreshold: 0` disables automatic repacking.
 */
export function repo(fs, opts = {}) {
  const store = opts.store
    ?? (opts.packed === false ? objectStore(fs) : packedStore(fs, opts));

  /** Resolve HEAD -> oid. Symbolic refs only; we never detach HEAD. */
  async function head() {
    const raw = await fs.read(HEAD_PATH);
    if (!raw) return null;
    const text = dec.decode(raw).trim();
    if (text.startsWith('ref: ')) {
      const refRaw = await fs.read(`.git/${text.slice(5).trim()}`);
      if (!refRaw) return null;
      const oid = dec.decode(refRaw).trim();
      if (oid === '') return null;
      assertOid(oid);
      return oid;
    }
    assertOid(text);
    return text;
  }

  /** @param {OID} oid */
  async function setHead(oid) {
    assertOid(oid);
    await fs.write(`.git/${MAIN_REF}`, enc.encode(`${oid}\n`));
  }

  /** Walk a tree object into a flat path -> blob oid map. */
  async function readTree(treeOid, prefix = '', into = new Map()) {
    const { type, content } = await store.read(treeOid);
    if (type !== 'tree') throw new Error(`readTree: ${treeOid} is a ${type}, not a tree`);
    for (const e of decodeTree(content)) {
      const path = prefix === '' ? e.name : `${prefix}/${e.name}`;
      if (e.mode === '40000' || e.mode === '040000') {
        await readTree(e.oid, path, into);
      } else if (e.mode === '100644' || e.mode === '100755') {
        into.set(path, e.oid);
      } else {
        // Principle 6: never silently ignore something we do not understand.
        throw new Error(`readTree: unsupported tree entry mode ${e.mode} at ${path}`);
      }
    }
    return into;
  }

  /** @returns {Promise<Map<string, OID>>} */
  async function readTreeAtHead() {
    const oid = await head();
    if (!oid) return new Map();
    const { type, content } = await store.read(oid);
    if (type !== 'commit') throw new Error(`readTreeAtHead: HEAD is a ${type}, not a commit`);
    return readTree(decodeCommit(content).tree);
  }

  /** @param {OID} oid @returns {Promise<Bytes>} */
  async function readBlob(oid) {
    const { type, content } = await store.read(oid);
    if (type !== 'blob') throw new Error(`readBlob: ${oid} is a ${type}, not a blob`);
    return content;
  }

  /**
   * Turn a flat path -> content map into nested tree objects.
   *
   * Two phases on purpose. Phase 1 is pure and validates everything; phase 2 does the
   * I/O. Nothing is written until the whole input is known to be good, so a rejected
   * commit leaves the object store byte-for-byte untouched — no half-written blobs for
   * `git fsck` to report as dangling. "Atomic by nature" (Appendix VIII) has to mean
   * that failure leaves no trace either, not just that success is all-or-nothing.
   *
   * @param {Map<string, Bytes>} files
   * @returns {Promise<OID>} root tree oid
   */
  async function writeTreeFromFiles(files) {
    // --- phase 1: build and validate, no I/O ---
    const root = { dirs: new Map(), files: new Map() };
    for (const [path, content] of files) {
      if (!(content instanceof Uint8Array)) {
        throw new Error(`commit: content for ${path} must be a Uint8Array, got ${typeof content}`);
      }
      const parts = checkDocumentPath(path);
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        let sub = node.dirs.get(parts[i]);
        if (!sub) { sub = { dirs: new Map(), files: new Map() }; node.dirs.set(parts[i], sub); }
        node = sub;
      }
      node.files.set(parts[parts.length - 1], content);
    }

    // A name cannot be both a file and a directory in the same tree. Checked here, after
    // the whole map is in, so the verdict does not depend on Map iteration order.
    const validate = (node, prefix) => {
      for (const name of node.files.keys()) {
        if (node.dirs.has(name)) {
          throw new Error(`commit: ${prefix}${name} is both a file and a directory`);
        }
      }
      // encodeTree is the authority on names, modes and sorting; let it object now,
      // while a placeholder oid stands in for the real one.
      const placeholder = '0'.repeat(40);
      encodeTree([
        ...[...node.files.keys()].map((name) => ({ mode: '100644', name, oid: placeholder })),
        ...[...node.dirs.keys()].map((name) => ({ mode: '40000', name, oid: placeholder })),
      ]);
      for (const [name, sub] of node.dirs) validate(sub, `${prefix}${name}/`);
    };
    validate(root, '');

    // --- phase 2: write ---
    const writeNode = async (node) => {
      const entries = [];
      for (const [name, content] of node.files) {
        entries.push({ mode: '100644', name, oid: await store.write('blob', content) });
      }
      for (const [name, sub] of node.dirs) {
        entries.push({ mode: '40000', name, oid: await writeNode(sub) });
      }
      // encodeTree does the git-specific sorting.
      return store.write('tree', encodeTree(entries));
    };
    return writeNode(root);
  }

  /**
   * One business event -> one commit. `files` is the FULL desired tree state, not a
   * diff: the caller describes the world it wants, we produce the smallest commit that
   * makes it so. That is what keeps this atomic without any transaction machinery.
   *
   * `sign` may return either the armored signature (the ordinary case) or
   * `{signature, message}`. The second form exists for four-eyes: a co-signature is a commit
   * trailer that has to be *inside* the payload the primary signature covers, and the payload
   * cannot be built before the tree oid is known — which only this function knows. The returned
   * message must START WITH the message passed in, so a signer can append trailers and can
   * never rewrite what a human wrote. Enforced below, not merely documented.
   *
   * @param {{files: Map<string, Bytes>, message: string, author: Identity,
   *          time: number, tzOffsetMinutes: number,
   *          committer?: Identity,
   *          sign?: (payload: Bytes) => Promise<string
   *                 | {signature: string, message?: string}>}} o
   * @returns {Promise<OID>}
   */
  async function commit(o) {
    if (!(o.files instanceof Map)) throw new Error('commit: files must be a Map<string, Uint8Array>');
    if (typeof o.message !== 'string' || o.message === '') throw new Error('commit: message is required');
    const parent = await head();
    const tree = await writeTreeFromFiles(o.files);

    const base = {
      tree,
      parents: parent ? [parent] : [],
      author: o.author,
      committer: o.committer ?? o.author,
      time: o.time,
      tzOffsetMinutes: o.tzOffsetMinutes,
      // git's own convention: a commit message ends with exactly one newline.
      message: o.message.endsWith('\n') ? o.message : `${o.message}\n`,
    };

    let content = encodeCommit({ ...base, signature: null });
    if (o.sign) {
      const result = await o.sign(content); // signed over the unsigned commit bytes
      const signature = typeof result === 'string' ? result : result && result.signature;
      if (typeof signature !== 'string' || signature === '') {
        throw new Error('commit: sign() must return a non-empty armored signature');
      }
      if (result && typeof result === 'object' && result.message !== undefined) {
        if (typeof result.message !== 'string' || !result.message.startsWith(base.message)) {
          throw new Error('commit: sign() may only APPEND to the commit message '
            + '(trailers), never rewrite it');
        }
        base.message = result.message;
      }
      content = encodeCommit({ ...base, signature });
    }
    const oid = await store.write('commit', content);
    await setHead(oid);
    // FD-2: fold loose objects into a pack once they pass the threshold. This runs after
    // the commit is complete and HEAD points at it, so an interrupted repack cannot cost
    // us the commit — and repack() itself never deletes a loose object before a pack
    // containing it has been read back and compared. Costs no I/O until the threshold is
    // in sight (see store.js maybeRepack).
    if (store.maybeRepack) await store.maybeRepack();
    return oid;
  }

  /**
   * @param {number} [limit]
   * @returns {Promise<{oid:OID, message:string, author:Identity, time:number,
   *                    signature:string|null, parents:OID[], payload:Bytes}[]>}
   */
  async function log(limit = Infinity) {
    const out = [];
    let oid = await head();
    while (oid && out.length < limit) {
      const { type, content } = await store.read(oid);
      if (type !== 'commit') throw new Error(`log: ${oid} is a ${type}, not a commit`);
      const c = decodeCommit(content);
      out.push({
        oid,
        message: c.message,
        author: c.author,
        time: c.time,
        signature: c.signature,
        parents: c.parents,
        // The exact bytes that were signed, recovered from the object itself rather
        // than re-encoded — so a peer with no git and no ssh binary can verify the
        // whole chain (Appendix XI). CONTRACT amendment A-3.
        payload: commitPayload(content),
      });
      oid = c.parents[0] ?? null;
    }
    return out;
  }

  /** Paths currently recorded in .git/index, or [] if there is no index yet. */
  async function indexPaths() {
    const raw = await fs.read(INDEX_PATH);
    if (!raw) return [];
    return decodeIndex(raw).entries.map((e) => e.path);
  }

  /**
   * Materialise HEAD into the working tree AND write a matching .git/index.
   *
   * The index is the point. Without it a human who opens the folder sees her entire
   * company reported as deleted. With it, `git status --porcelain` prints nothing and
   * Appendix X's "it is simply a folder, with her company inside" is literally true.
   * @returns {Promise<void>}
   */
  async function checkout() {
    const tree = await readTreeAtHead();
    const stale = (await indexPaths()).filter((p) => !tree.has(p));

    const entries = [];
    for (const [path, oid] of tree) {
      const content = await readBlob(oid);
      await fs.write(path, content);
      entries.push({ path, oid, size: content.length, mode: 0o100644 });
    }
    // Files the previous commit had and this one does not. Empty directories left
    // behind are fine: git does not track them and does not report them.
    for (const path of stale) await fs.remove(path);

    await fs.write(INDEX_PATH, encodeIndex(entries));
  }

  // `store`, `repack` and `stats` are additive (FD-2). Every name the CONTRACT lists keeps
  // its exact signature; five other modules and 213 tests depend on that.
  return {
    head, setHead, readTree, readTreeAtHead, commit, log, readBlob, checkout, indexPaths,
    store,
    repack: (o) => (store.repack ? store.repack(o) : Promise.resolve({ packs: [], objects: 0 })),
    stats: () => (store.stats ? store.stats() : Promise.resolve({ loose: 0, packed: 0, packs: [] })),
  };
}
