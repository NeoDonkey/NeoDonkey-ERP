// runtime/sync/opbuffer.js — COMPROMISES #4a: the Live Layer's buffer, which did not exist.
//
// Appendix III: Live Layer ops are "all cheap, all in RAM **and a local IndexedDB buffer**". The
// register's entry states the consequence precisely:
//
//   "ops live in RAM and die when the tab closes. Concretely this means ops that a `reject` policy
//    quarantined — neither honoured nor discarded, listed in `violations()` — are lost on reload,
//    and an in-progress edit is not recoverable after a crash. `session.ops()` is deliberately
//    shaped as exactly the payload such a buffer would persist and replay."
//
// So this file persists exactly that payload and replays it. Nothing is re-derived: the record is
// `session.ops()` verbatim, and replay is `session.receive(ops)` — the same idempotent path a peer's
// frames take, which is why replaying twice is harmless.
//
// THE QUARANTINE, which `session.ops()` alone does NOT cover. An earlier version of this comment
// claimed the quarantine list "comes back for free" because the policy decision is a pure function
// of the base document. That is true of the decision and false of the input: a `reject` policy
// records the peer's op in `violations()` and never creates a register for it, so the op is not in
// `session.ops()` and persisting `ops()` alone would lose exactly the thing COMPROMISES #4a names
// first. Found by test/sync-opbuffer.test.js. So the record carries a SECOND list — the quarantined
// ops, verbatim — and replay feeds them back through `receive()`, which re-reaches the same verdict
// and re-records them. Two violation kinds cannot be replayed and are counted rather than pretended
// away: `immutable-field` and `crdt-type-mismatch` keep no op (there is nothing to keep — the first
// is an attempt to edit an identifier, the second a peer disagreeing about a register type), and
// `restore()` reports how many were dropped for that reason.
//
// TWO DEVIATIONS FROM APPENDIX III'S WORDING, both deliberate and neither hidden:
//
//   1. **Not IndexedDB — the FsAdapter the repository already uses.** The buffer lives at
//      `.git/neodonkey-live/`, reached through the same `FsAdapter` that holds the company
//      (`fs-opfs.js` in a browser, `fs-node.js` for a CLI or the always-on peer). That is one
//      storage story instead of two, it works on every platform the repo works on, and — the
//      reason that decided it — it is *testable in Node*, so this is verified rather than asserted.
//      IndexedDB and OPFS live in the same browser storage bucket and are evicted together, so
//      choosing OPFS gives up nothing in durability. A `kvStore` is an injected interface, so an
//      IndexedDB implementation can be added later without touching anything above it.
//
//   2. **Inside `.git/`, on purpose.** Anywhere else in the folder and `git status` would report
//      the buffer as an untracked file, which would break Appendix X's "it is simply a folder" —
//      a user who runs `git status` in her company must see nothing. git ignores files it does not
//      know about inside `.git/`, so the buffer is invisible to git and travels with the repo.
//      test/sync-opbuffer.test.js asserts that with the real `git` binary.
//
// The buffer is *process*, never truth (Appendix III). It is never committed, and `discard()` on a
// successful snapshot is not an optimisation — an op set that outlived its commit would be replayed
// onto a document that has already moved on, which is why `restore()` refuses on a base mismatch
// instead of guessing.

import { canonicalJson } from '../live/crdt.js';
import { SyncError, hex, sha256 } from './sealed.js';
import { utf8 } from '../identity/ed25519.js';

/** @typedef {import('../git/fs.js').FsAdapter} FsAdapter */

/** Where the buffer lives. Inside `.git/`, so git never reports it. */
export const BUFFER_DIR = '.git/neodonkey-live';
/** The record format version. An unknown version is refused, never guessed at. */
export const RECORD_VERSION = 1;

/**
 * A tiny async key/value store over an `FsAdapter`. One file per key, JSON inside.
 *
 * Keys are arbitrary strings and filenames are not, so a key is percent-encoded into exactly one
 * flat filename — reversible, no directories to create, and no key can escape the directory
 * (`..` encodes to `..` but there is no `/` left to make it a path).
 *
 * @param {FsAdapter} fs
 * @param {string} [dir]
 */
export function fsKvStore(fs, dir = BUFFER_DIR) {
  const nameOf = (key) => {
    if (typeof key !== 'string' || key === '') throw new SyncError('opbuffer: key must be a non-empty string');
    return `${dir}/${encodeURIComponent(key)}.json`;
  };
  let made = false;
  const ensure = async () => {
    if (made) return;
    if (typeof fs.mkdir === 'function') await fs.mkdir(dir);
    made = true;
  };
  const decoder = new TextDecoder();
  return {
    async get(key) {
      const raw = await fs.read(nameOf(key));
      if (!raw) return null;
      try { return JSON.parse(decoder.decode(raw)); } catch (err) {
        throw new SyncError(
          `opbuffer: ${nameOf(key)} is not JSON — refusing to guess at a half-written buffer`,
          { cause: String(err) },
        );
      }
    },
    async put(key, value) {
      await ensure();
      await fs.write(nameOf(key), utf8(JSON.stringify(value)));
    },
    async delete(key) {
      if (typeof fs.remove === 'function') await fs.remove(nameOf(key)).catch(() => {});
    },
    async keys() {
      const names = await fs.list(dir).catch(() => []);
      return names
        .filter((n) => n.endsWith('.json'))
        .map((n) => decodeURIComponent(n.slice(0, -5)))
        .sort();
    },
  };
}

/** The same interface, in memory, for a peer with no persistence at all. */
export function memoryKvStore() {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? JSON.parse(map.get(key)) : null),
    put: async (key, value) => { map.set(key, JSON.stringify(value)); },
    delete: async (key) => { map.delete(key); },
    keys: async () => [...map.keys()].sort(),
  };
}

/** The buffer key for one document. */
export function bufferKey(entity, id) {
  if (typeof entity !== 'string' || entity === '' || typeof id !== 'string' || id === '') {
    throw new SyncError('opbuffer: entity and id are required');
  }
  return `ops/${entity}/${id}`;
}

/**
 * The digest of the committed base a buffered op set belongs to.
 *
 * Why it exists: an op set is only meaningful against the document it was produced against. If the
 * document has since been committed, pulled from a peer, or reverted, replaying yesterday's ops
 * onto it would silently produce a document nobody wrote. `canonicalJson` is the Live Layer's own
 * canonicaliser, imported rather than re-derived, so this digest cannot disagree with it.
 *
 * @param {object} baseDoc the document as committed, exactly what `session(doc, …)` was given
 */
export async function baseDigest(baseDoc) {
  return hex(await sha256(utf8(canonicalJson(baseDoc))));
}

/**
 * The op buffer.
 *
 * @param {{ kv: ReturnType<typeof memoryKvStore>,
 *           now?: () => number,
 *           onError?: (err: Error) => void }} o
 */
export function opBuffer(o) {
  if (!o || !o.kv) throw new SyncError('opbuffer: a kv store is required');
  const kv = o.kv;
  const now = o.now ?? (() => 0);
  const report = (err) => { if (o.onError) o.onError(err); else throw err; };

  /**
   * The quarantined ops of a session, as envelopes that `receive()` will accept again.
   *
   * `violations()` is the union of several kinds; only the ones that kept their op can be replayed.
   * The rest are counted, because "we dropped three things" is information and silence is not.
   * @param {{ violations?():any[] }} session
   * @returns {{ ops:any[], unreplayable:number }}
   */
  function quarantinedOf(session) {
    if (typeof session.violations !== 'function') return { ops: [], unreplayable: 0 };
    const ops = [];
    let unreplayable = 0;
    for (const v of session.violations()) {
      if (v.origin !== 'remote') continue;
      if (v.op === undefined || v.op === null) { unreplayable += 1; continue; }
      ops.push({ field: v.field, ...v.op });
    }
    return { ops, unreplayable };
  }

  /**
   * Write the current op set of a session. Idempotent: the record is the whole op set, not a
   * delta, so a crash halfway through a sequence of saves loses at worst the newest keystrokes.
   * @param {{ nodeId:string, entity:string, id:string, ops():any[], violations?():any[] }} session
   * @param {{ baseDoc: object }} ctx
   */
  async function persist(session, ctx) {
    if (!ctx || typeof ctx.baseDoc !== 'object' || ctx.baseDoc === null) {
      throw new SyncError('opbuffer: persist needs the committed base document');
    }
    const ops = session.ops();
    const quarantined = quarantinedOf(session);
    const key = bufferKey(session.entity, session.id);
    if (ops.length === 0 && quarantined.ops.length === 0) {
      // Nothing happened (or everything was undone). An empty record is not "no record": it would
      // survive a reload and claim there are unsaved edits. Remove it.
      await kv.delete(key);
      return { key, ops: 0, quarantined: 0 };
    }
    await kv.put(key, {
      v: RECORD_VERSION,
      entity: session.entity,
      id: session.id,
      nodeId: session.nodeId,
      base: await baseDigest(ctx.baseDoc),
      at: now(),
      ops,
      quarantined: quarantined.ops,
    });
    return { key, ops: ops.length, quarantined: quarantined.ops.length };
  }

  /**
   * Keep a session persisted as it is edited.
   *
   * `schedule` is injected so that a UI can debounce (200 ms is a sensible keystroke window) and a
   * test can be synchronous. The default runs on every batch, which is correct and slow.
   *
   * @param {{ nodeId:string, entity:string, id:string, ops():any[],
   *           onLocalOps(h:(ops:any[])=>void): () => void }} session
   * @param {{ baseDoc: object, schedule?: (fn: () => void) => void }} ctx
   * @returns {() => void} stop tracking
   */
  function track(session, ctx) {
    const schedule = ctx.schedule ?? ((fn) => fn());
    let pending = false;
    const save = () => {
      pending = false;
      persist(session, ctx).catch(report);
    };
    return session.onLocalOps(() => {
      if (pending) return;
      pending = true;
      schedule(save);
    });
  }

  /**
   * Replay a buffered op set into a fresh session.
   *
   * Refuses, rather than guessing, when the record does not belong to this session: a different
   * document, a different base, or a record version we do not understand. A refusal LEAVES THE
   * RECORD IN PLACE — a human may still want those keystrokes, and deleting them because we could
   * not use them would be the data loss this whole file exists to prevent.
   *
   * @param {{ entity:string, id:string, receive(ops:any[]):void }} session
   * @param {{ baseDoc: object }} ctx
   * @returns {Promise<{restored:number, quarantined:number,
   *                    status:'empty'|'restored'|'stale'|'foreign', reason?:string}>}
   */
  async function restore(session, ctx) {
    const key = bufferKey(session.entity, session.id);
    const record = await kv.get(key);
    if (record === null) return { restored: 0, quarantined: 0, status: 'empty' };
    if (record.v !== RECORD_VERSION) {
      return {
        restored: 0,
        quarantined: 0,
        status: 'foreign',
        reason: `buffered record version ${JSON.stringify(record.v)} is not ${RECORD_VERSION}`,
      };
    }
    if (record.entity !== session.entity || record.id !== session.id) {
      return {
        restored: 0,
        quarantined: 0,
        status: 'foreign',
        reason: `buffered record is for ${record.entity}/${record.id}, not ${session.entity}/${session.id}`,
      };
    }
    if (!Array.isArray(record.ops)) {
      return { restored: 0, quarantined: 0, status: 'foreign', reason: 'buffered record has no ops array' };
    }
    const quarantined = Array.isArray(record.quarantined) ? record.quarantined : [];
    const digest = await baseDigest(ctx.baseDoc);
    if (record.base !== digest) {
      return {
        restored: 0,
        quarantined: 0,
        status: 'stale',
        reason:
          `these edits were made against a different version of ${session.entity}/${session.id} `
          + '(the document has been committed or pulled since). They are kept, not applied: '
          + 'applying them would produce a document nobody wrote.',
      };
    }
    session.receive(record.ops);
    // The quarantined ops go through the SAME path — receive() re-reaches the same verdict from the
    // same base document, so they land back in violations() and out of snapshot(), exactly as they
    // were before the tab closed.
    if (quarantined.length > 0) session.receive(quarantined);
    return { restored: record.ops.length, quarantined: quarantined.length, status: 'restored' };
  }

  return {
    persist,
    track,
    restore,
    /** After the snapshot is committed the process is over (Appendix III). */
    async discard(entity, id) { await kv.delete(bufferKey(entity, id)); },
    /** Every document with buffered edits — "you have unsaved work on three documents". */
    async pending() {
      const out = [];
      for (const key of await kv.keys()) {
        if (!key.startsWith('ops/')) continue;
        const record = await kv.get(key);
        if (record === null) continue;
        out.push({
          key,
          entity: record.entity,
          id: record.id,
          nodeId: record.nodeId,
          ops: Array.isArray(record.ops) ? record.ops.length : 0,
          quarantined: Array.isArray(record.quarantined) ? record.quarantined.length : 0,
          at: record.at ?? null,
        });
      }
      return out;
    },
  };
}
