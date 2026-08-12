// runtime/sync/gitsync.js — the Truth Layer over a PeerLink. "Send me what I lack."
//
// CRDT ops are the Live Layer; commits are the Truth Layer (Appendix III), and a peer that only
// received ops has received the *process* and none of the *result*. Appendix X's promise —
// "Anna still has everything. Herr Klein too. The company continues." — is a promise about commits.
// So this is the other half of sync, and without it "two real machines sync" is not true.
//
// THE EXCHANGE, deliberately not git's wire protocol:
//
//   A → B   refs?                    what do you have?
//   B → A   refs!  {ref: oid}
//   A → B   want [oids] have [oids]  these I lack; from these I already have everything
//   B → A   pack!  + chunks + done   one packfile, its index, and nothing else
//
// Four rounds, no capability negotiation, no side-band, no multi_ack, no shallow. That is the whole
// of it, and it is enough because both sides are NeoDonkey and both sides have `runtime/git/pack.js`.
// Reimplementing git's real protocol would be a week of state machine for a property we do not
// need (talking to GitHub) — and it would be a *second* opinion about what a pack is, which is the
// duplication this project keeps paying for.
//
// WHY THE RECEIVER CAN TRUST THE SENDER'S PACK. It does not have to. Every object is verified
// against the oid it claims — `readPack(..., {verifyOids: true})` recomputes the SHA-1, and
// `store.write()` names the object by its own hash. So a malicious sender cannot substitute a
// document: it would have to find a SHA-1 preimage. What it *can* do is send too little, and that
// is caught explicitly: after ingesting, the closure of every wanted commit is walked and any
// missing object is a named refusal, so a truncated history is never mistaken for a short one.
//
// WHAT THIS DOES NOT DO, and it is a complete sentence rather than a hidden edge: it does not MERGE
// divergent histories. If the peer's head is a descendant of ours we fast-forward; if ours is a
// descendant of theirs we are already ahead; if neither, the objects are fetched (nothing is ever
// lost), the peer's head is recorded as `refs/peers/<key>/main` so `git fsck` stays clean and a
// human can see it, and the result is reported as `diverged`. Merging two ERP histories needs a
// three-way tree merge whose conflict policy is the Live Layer's `compilePolicy` and Appendix
// VIII's authoritative-peer rule — that is COMPROMISES #6/#19 and it is not this file's decision to
// make. See the report: it also needs `repo.commit()` to accept more than one parent.

import { decodeCommit, decodeTree } from '../git/objects.js';
import { writePack, readPack } from '../git/pack.js';
import { b64encode, b64decode, concatBytes } from '../identity/ed25519.js';
import { SyncError } from './sealed.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID */
/** @typedef {import('./sealed.js').PeerLink} PeerLink */

/** The protocol version. A peer speaking another one is refused by name. */
export const GIT_SYNC_VERSION = 1;
/** The ref both peers agree is the company's history. repo.js has exactly this one branch. */
export const MAIN_REF = 'refs/heads/main';
/** Where a peer's head is recorded when histories diverge. */
export const PEER_REF_PREFIX = 'refs/peers';
/**
 * Bytes per chunk of a packfile, before base64. 48 KiB → 64 KiB of text, which fits a WebSocket
 * frame and a reliable DataChannel message on every engine.
 */
export const CHUNK_BYTES = 48 * 1024;
/**
 * A guard, not a limit: a pack is built in memory (writePack's non-sink form), so a peer asking
 * for a ten-million-object history would exhaust the heap. Refusing with a number is honest;
 * dying is not. The exit path is `writePack`'s `sink` plus several packs per fetch.
 */
export const DEFAULT_MAX_OBJECTS = 200_000;

const textEncoder = new TextEncoder();

/**
 * Every object reachable from `roots`, stopping at anything in `stop`.
 *
 * O(objects reached), and it reads each object once. At the scale FD-2 targets this is the part
 * that would need git's commit-graph or a reachability bitmap; the exit path is named rather than
 * pretended away, and `maxObjects` makes the failure a refusal instead of an out-of-memory.
 *
 * @param {{read(oid:OID):Promise<{type:string,content:Bytes}>, has(oid:OID):Promise<boolean>}} store
 * @param {Iterable<OID>} roots
 * @param {Set<OID>} stop
 * @param {{maxObjects?: number, collect?: boolean}} [opts]
 * @returns {Promise<{oids:OID[], objects:{type:string,content:Bytes,oid:OID}[]}>}
 */
export async function reachable(store, roots, stop = new Set(), opts = {}) {
  const max = opts.maxObjects ?? DEFAULT_MAX_OBJECTS;
  const collect = opts.collect !== false;
  const seen = new Set();
  /** @type {OID[]} */
  const oids = [];
  /** @type {{type:string,content:Bytes,oid:OID}[]} */
  const objects = [];
  const stack = [...roots];
  while (stack.length > 0) {
    const oid = /** @type {OID} */ (stack.pop());
    if (seen.has(oid) || stop.has(oid)) continue;
    seen.add(oid);
    if (!(await store.has(oid))) {
      throw new SyncError(`git sync: object ${oid} is reachable but not present in this repository`, { oid });
    }
    const { type, content } = await store.read(oid);
    oids.push(oid);
    if (collect) objects.push({ oid, type, content });
    if (oids.length > max) {
      throw new SyncError(
        `git sync: this exchange would move more than ${max} objects, which is built in memory. `
        + 'Refusing rather than exhausting the heap; fetch in stages or raise maxObjects knowingly.',
      );
    }
    if (type === 'commit') {
      const c = decodeCommit(content);
      stack.push(c.tree);
      for (const parent of c.parents) stack.push(parent);
    } else if (type === 'tree') {
      for (const entry of decodeTree(content)) stack.push(entry.oid);
    }
    // A blob has no children. A tag would, but repo.js never writes one.
  }
  return { oids, objects };
}

/**
 * Is `ancestor` an ancestor of `descendant` (or the same commit)?
 * @param {{read(oid:OID):Promise<{type:string,content:Bytes}>, has(oid:OID):Promise<boolean>}} store
 * @param {OID} ancestor @param {OID} descendant
 */
export async function isAncestor(store, ancestor, descendant) {
  if (ancestor === descendant) return true;
  const seen = new Set();
  const stack = [descendant];
  while (stack.length > 0) {
    const oid = /** @type {OID} */ (stack.pop());
    if (seen.has(oid)) continue;
    seen.add(oid);
    if (!(await store.has(oid))) continue; // a history we do not hold in full: not provable, so no
    const { type, content } = await store.read(oid);
    if (type !== 'commit') continue;
    const c = decodeCommit(content);
    for (const parent of c.parents) {
      if (parent === ancestor) return true;
      stack.push(parent);
    }
  }
  return false;
}

/** The commits this repo can offer as "I already have everything under here". */
export async function haveList(repo, limit = 256) {
  const head = await repo.head();
  if (!head) return [];
  const log = await repo.log(limit);
  return log.map((c) => c.oid);
}

/**
 * One peer's git exchange over one `PeerLink`.
 *
 * Both roles run on the same link at once: a peer serves whatever the other asks for and can ask
 * in return. The message types are unambiguous per direction (`refs?`/`want` are questions,
 * `refs!`/`pack!`/`chunk`/`done`/`nothing`/`no` are answers), so no turn-taking is needed and a
 * peer never has to wait for its turn to answer.
 *
 * @param {{ link: PeerLink,
 *           repo: any,
 *           fs?: any,
 *           peerId?: string,
 *           maxObjects?: number,
 *           onError?: (err: Error) => void,
 *           onProgress?: (note: {phase:string} & Record<string, unknown>) => void }} o
 */
export function gitPeer(o) {
  if (!o || !o.link || !o.repo) throw new SyncError('git sync: gitPeer needs a link and a repo');
  const link = o.link;
  const repo = o.repo;
  const store = repo.store;
  const progress = o.onProgress ?? (() => {});
  const report = (err) => { if (o.onError) o.onError(err); else throw err; };

  let nonce = 0;
  /** @type {Map<number, {resolve:(v:any)=>void, reject:(e:Error)=>void, kind:string}>} */
  const waiting = new Map();
  /** nonce -> {pack:Uint8Array[], idx:Uint8Array[], header} @type {Map<number, any>} */
  const incoming = new Map();

  const send = (msg) => link.send(JSON.stringify(msg));

  link.onFrame((frame) => {
    let msg;
    try { msg = JSON.parse(frame); } catch {
      report(new SyncError('git sync: frame is not JSON'));
      return;
    }
    handle(msg).catch(report);
  });

  /** @param {any} msg */
  async function handle(msg) {
    if (msg === null || typeof msg !== 'object') {
      throw new SyncError('git sync: message must be an object');
    }
    switch (msg.t) {
      // ---- questions we answer -------------------------------------------------------
      case 'refs?': {
        if (msg.v !== undefined && msg.v !== GIT_SYNC_VERSION) {
          send({ t: 'no', n: msg.n, why: `git sync version ${msg.v} — this peer speaks ${GIT_SYNC_VERSION}` });
          return;
        }
        const head = await repo.head();
        send({ t: 'refs!', n: msg.n, v: GIT_SYNC_VERSION, refs: head ? { [MAIN_REF]: head } : {} });
        return;
      }
      case 'want': {
        await serveWant(msg);
        return;
      }
      // ---- answers to our questions --------------------------------------------------
      case 'refs!': {
        settle(msg.n, 'refs', msg);
        return;
      }
      case 'nothing': {
        settle(msg.n, 'pack', { empty: true });
        return;
      }
      case 'no': {
        const entry = waiting.get(msg.n);
        if (entry) { waiting.delete(msg.n); entry.reject(new SyncError(`git sync: peer refused — ${msg.why}`)); }
        return;
      }
      case 'pack!': {
        incoming.set(msg.n, { header: msg, pack: [], idx: [] });
        return;
      }
      case 'chunk': {
        const buf = incoming.get(msg.n);
        if (buf === undefined) throw new SyncError('git sync: a chunk arrived for no pack');
        if (msg.part !== 'pack' && msg.part !== 'idx') {
          throw new SyncError(`git sync: chunk part ${JSON.stringify(msg.part)} is neither pack nor idx`);
        }
        buf[msg.part].push(b64decode(msg.b64));
        return;
      }
      case 'done': {
        const buf = incoming.get(msg.n);
        if (buf === undefined) throw new SyncError('git sync: done arrived for no pack');
        incoming.delete(msg.n);
        settle(msg.n, 'pack', {
          empty: false,
          header: buf.header,
          pack: concatBytes(...buf.pack),
          idx: concatBytes(...buf.idx),
        });
        return;
      }
      default:
        // Principle 6: an unknown verb is named, never ignored.
        throw new SyncError(`git sync: unknown message type ${JSON.stringify(msg.t)}`);
    }
  }

  function settle(n, kind, value) {
    const entry = waiting.get(n);
    if (entry === undefined) return; // a late answer to a question we gave up on
    if (entry.kind !== kind) {
      waiting.delete(n);
      entry.reject(new SyncError(`git sync: expected a ${entry.kind} answer, got a ${kind} one`));
      return;
    }
    waiting.delete(n);
    entry.resolve(value);
  }

  /** @param {string} kind @param {(n:number)=>void} ask */
  function ask(kind, sendAsk) {
    const n = ++nonce;
    return new Promise((resolve, reject) => {
      waiting.set(n, { resolve, reject, kind });
      try { sendAsk(n); } catch (err) { waiting.delete(n); reject(err); }
    });
  }

  /** Build and stream the pack the peer asked for. */
  async function serveWant(msg) {
    try {
      const want = Array.isArray(msg.want) ? msg.want : [];
      const have = Array.isArray(msg.have) ? msg.have : [];
      const mine = [];
      for (const oid of want) if (await store.has(oid)) mine.push(oid);
      if (mine.length === 0) { send({ t: 'nothing', n: msg.n }); return; }

      // The stop set is the full closure of what the peer says it already has. Anything under a
      // commit the peer holds, it holds — that is what a commit id means.
      const stop = new Set();
      for (const oid of have) {
        if (!(await store.has(oid))) continue;
        const { oids } = await reachable(store, [oid], stop, {
          collect: false, maxObjects: o.maxObjects ?? DEFAULT_MAX_OBJECTS,
        });
        for (const seen of oids) stop.add(seen);
      }

      const { objects } = await reachable(store, mine, stop, {
        maxObjects: o.maxObjects ?? DEFAULT_MAX_OBJECTS,
      });
      if (objects.length === 0) { send({ t: 'nothing', n: msg.n }); return; }

      const written = await writePack(objects.map((x) => ({ type: x.type, content: x.content })));
      progress({ phase: 'serving', objects: objects.length, packBytes: written.pack.length });
      const chunks = Math.ceil(written.pack.length / CHUNK_BYTES)
        + Math.ceil(written.idx.length / CHUNK_BYTES);
      send({
        t: 'pack!',
        n: msg.n,
        objects: objects.length,
        packBytes: written.pack.length,
        idxBytes: written.idx.length,
        chunks,
      });
      let i = 0;
      for (const [part, bytes] of [['pack', written.pack], ['idx', written.idx]]) {
        for (let at = 0; at < bytes.length; at += CHUNK_BYTES) {
          send({ t: 'chunk', n: msg.n, i: i++, part, b64: b64encode(bytes.subarray(at, at + CHUNK_BYTES)) });
        }
      }
      send({ t: 'done', n: msg.n });
    } catch (err) {
      send({ t: 'no', n: msg.n, why: String(err && err.message ? err.message : err) });
      report(/** @type {Error} */ (err));
    }
  }

  /**
   * Fetch whatever this repo lacks from the peer, then update the ref.
   *
   * @returns {Promise<{status:'up-to-date'|'fast-forward'|'ahead'|'diverged'|'received',
   *                    objects:number, packBytes:number, peerHead:string|null,
   *                    head:string|null, refs:Record<string,string>}>}
   */
  async function fetch() {
    const answer = await ask('refs', (n) => send({ t: 'refs?', n, v: GIT_SYNC_VERSION }));
    const refs = (answer && answer.refs && typeof answer.refs === 'object') ? answer.refs : {};
    const peerHead = typeof refs[MAIN_REF] === 'string' ? refs[MAIN_REF] : null;
    const before = await repo.head();
    if (peerHead === null) {
      return { status: 'up-to-date', objects: 0, packBytes: 0, peerHead: null, head: before, refs };
    }
    if (await store.has(peerHead)) {
      // We already hold their head. Either we are the same, or we are ahead of them.
      const status = peerHead === before ? 'up-to-date' : 'ahead';
      return { status, objects: 0, packBytes: 0, peerHead, head: before, refs };
    }

    const have = await haveList(repo);
    progress({ phase: 'fetching', want: peerHead, have: have.length });
    const got = await ask('pack', (n) => send({ t: 'want', n, want: [peerHead], have }));
    if (got.empty) {
      return { status: 'up-to-date', objects: 0, packBytes: 0, peerHead, head: before, refs };
    }

    const objects = await ingestPack(got.pack, got.idx, [peerHead]);
    const status = await updateRef(peerHead, before);
    const after = await repo.head();
    progress({ phase: 'fetched', objects, status });
    return {
      status,
      objects,
      packBytes: got.pack.length,
      peerHead,
      head: after,
      refs,
    };
  }

  /**
   * Verify a received pack and write its objects into this repository.
   *
   * Verification is by content, in three layers, and each of them is somebody else's code:
   * `readPackIndex` validates the index structurally, `readPack` checks the pack's trailing SHA-1
   * against the one the index records, and every object read is CRC32-checked and its SHA-1
   * recomputed against the oid asked for. Then `store.write()` names each object by its own hash
   * again. A sender cannot make us store a document under a name that is not its digest.
   *
   * @param {Bytes} pack @param {Bytes} idx @param {OID[]} wanted
   * @returns {Promise<number>} objects newly written
   */
  async function ingestPack(pack, idx, wanted) {
    const reader = readPack(pack, idx, { verifyOids: true, cacheBytes: 1 << 20 });
    await reader.verifyChecksum();
    let written = 0;
    for (const oid of reader.oids()) {
      if (await store.has(oid)) continue;
      const { type, content } = await reader.read(oid);
      const back = await store.write(type, content);
      if (back !== oid) {
        // Cannot happen unless the store disagrees with the pack about hashing, in which case
        // stopping is the only safe answer.
        throw new SyncError(`git sync: ${oid} was stored as ${back}`);
      }
      written += 1;
    }
    // Completeness. A sender that sends too little is the interesting attack, and this is the
    // check that catches it: the whole closure of every wanted commit must now be present.
    for (const oid of wanted) {
      await reachable(store, [oid], new Set(), { collect: false, maxObjects: o.maxObjects ?? DEFAULT_MAX_OBJECTS });
    }
    if (repo.store.maybeRepack) await repo.store.maybeRepack();
    return written;
  }

  /**
   * Move `refs/heads/main` if and only if it is a fast-forward. Otherwise record the peer's head
   * under `refs/peers/<peer>/main` and say `diverged`.
   */
  async function updateRef(peerHead, before) {
    if (before === null) {
      await repo.setHead(peerHead);
      return 'received';
    }
    if (await isAncestor(store, before, peerHead)) {
      await repo.setHead(peerHead);
      return 'fast-forward';
    }
    if (await isAncestor(store, peerHead, before)) return 'ahead';
    await recordPeerHead(peerHead);
    return 'diverged';
  }

  /**
   * A ref for the peer's head, so the fetched commits are reachable.
   *
   * Not cosmetic: without a ref those objects are dangling, and `git fsck` reports every one of
   * them. With it, a diverged fetch leaves a repository that real git calls clean, and a human can
   * run `git log refs/peers/<key>/main` to see exactly what the other machine has.
   */
  async function recordPeerHead(oid) {
    if (!o.fs) return;
    const name = (o.peerId ?? link.id ?? 'peer').replace(/[^0-9a-zA-Z._-]/g, '_');
    await o.fs.write(
      `.git/${PEER_REF_PREFIX}/${name}/main`, textEncoder.encode(`${oid}\n`),
    );
  }

  return {
    fetch,
    /** Exposed for tests and for a UI that wants to show "the peer is 12 commits ahead". */
    ingestPack,
    close() { link.close(); },
  };
}
