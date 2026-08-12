// runtime/git/store.js — one object store over loose objects *and* packs (FD-2).
//
// The point of this file is that nothing above it has to know the difference. `repo.js`
// asks for an object; it comes back whether it is a file under .git/objects/ab/cdef… or
// 900 bytes in the middle of a 2 GB packfile. Writes stay loose (cheap, append-only, and
// crash-safe by construction), and when loose objects pass a threshold they are folded
// into a pack.
//
// repack() is the dangerous operation in any object database, so its ordering is deliberate
// and was chosen by *asking real git what it tolerates* rather than by reasoning:
//
//   1. write objects/info/<name>.idx.part — git never looks at it, and it doubles as the
//                                "a repack was in flight" marker
//   2. write <name>.pack       — a pack with no .idx next to it is invisible to git
//                                (verified: `git fsck --strict` is silent about it)
//   3. read both back from disk, verify the pack checksum, and compare every object
//      against the loose copy that still exists — byte for byte
//   4. write <name>.idx        — the pack becomes visible here. This is the only
//                                non-atomic window, and it is the smallest file
//   5. compare the published .idx with the bytes we meant to write
//   6. only once every pack of this repack is published: delete the loose objects (and,
//      with `{all: true}`, the packs the new ones replace — .idx first, then .pack)
//   7. delete <name>.idx.part
//
// A crash before 4 leaves loose objects plus an invisible pack: `git fsck --strict` clean.
// A crash *during* 4 leaves a torn .idx, which real git does reject (`error: index file …
// is too small`, exit 68) — so load() repairs it from the .idx.part marker, which is why
// that marker is written first and deleted last. A crash during 6 leaves both copies of
// some objects, which is harmless. There is no ordering that makes step 4 atomic without
// rename(2); FsAdapter has none, and adding it is proposed as amendment P-3.
//
// No node:*, no clock, no randomness.

import { objectStore } from './objects.js';
import { readPack, writePack } from './pack.js';
import { readPackIndex } from './pack-index.js';
import { sha1, hex, unhex } from './sha1.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID */
/** @typedef {import('./fs.js').FsAdapter} FsAdapter */

const OBJECTS_DIR = '.git/objects';
const PACK_DIR = '.git/objects/pack';
// The in-flight marker lives in objects/info, not objects/pack, for one measured reason:
// a stray file in objects/pack makes `git count-objects -v` report "garbage found", while
// objects/info is a directory git only looks in for `packs` and `alternates` and reports
// nothing about. Same crash-safety, no scary output while a repack is in progress.
const MARKER_DIR = '.git/objects/info';
const markerPath = (base) => `${MARKER_DIR}/${base}.idx.part`;

/** Loose objects tolerated before a repack. git's own gc.auto is 6 700; we sit below it. */
export const DEFAULT_REPACK_THRESHOLD = 5000;
/** Objects per pack. Bounds the memory a repack needs, at the cost of more packs. */
export const DEFAULT_REPACK_BATCH = 25000;

const loosePath = (oid) => `${OBJECTS_DIR}/${oid.slice(0, 2)}/${oid.slice(2)}`;

/**
 * Every pack in `.git/objects/pack`, loaded once and then held.
 *
 * Honest limit: a pack is read into memory whole, because FsAdapter offers `read(path)`
 * and nothing narrower — git mmaps instead. For a 25 000-object pack that is a few MB;
 * for a repo that has grown to gigabytes it is not acceptable, and the exit path is a
 * positional read on FsAdapter (amendment P-3), which `readPack`'s lazy-source form
 * already supports.
 *
 * @param {FsAdapter} fs
 * @param {{verifyOids?: boolean, onRepair?: (note: string) => void}} [opts]
 */
export function packSet(fs, opts = {}) {
  /** @type {{name: string, reader: ReturnType<typeof readPack>}[]} */
  let packs = [];
  /** @type {Promise<void>|null} */
  let loading = null;

  /** @param {string} note */
  const note = (note_) => { if (opts.onRepair) opts.onRepair(note_); };

  async function load() {
    /** @type {typeof packs} */
    const found = [];
    const names = await fs.list(PACK_DIR);
    const bases = new Set();
    for (const name of names) {
      if (name.endsWith('.pack')) bases.add(name.slice(0, -5));
      else if (name.endsWith('.idx')) bases.add(name.slice(0, -4));
    }
    for (const base of [...bases].sort()) {
      const packBytes = await fs.read(`${PACK_DIR}/${base}.pack`);
      if (!packBytes) {
        // An index with no pack. Real git ignores this quietly, and so do we: the objects
        // it describes are either loose or genuinely gone, and both cases are the caller's
        // problem to notice, not ours to guess at.
        continue;
      }
      let idxBytes = await fs.read(`${PACK_DIR}/${base}.idx`);
      let broken = null;
      if (idxBytes) {
        try { readPackIndex(idxBytes); } catch (err) { broken = err; idxBytes = null; }
      }
      if (!idxBytes) {
        // Either a repack was interrupted mid-publish (step 4 above) or between steps 2
        // and 4. The .idx.part marker is what tells those apart from genuine bit rot: it
        // exists only while a repack is in flight, which is exactly the window in which
        // every object involved is still on disk loose. So with the marker present it is
        // always safe to repair or to ignore; without it, a corrupt index is real damage
        // and gets refused by name.
        const part = await fs.read(markerPath(base));
        if (!part) {
          if (broken) {
            throw new Error(
              `packSet: ${PACK_DIR}/${base}.idx is corrupt and there is no ${base}.idx.part to `
              + `repair it from: ${broken.message}`,
            );
          }
          continue; // pack with no index and no marker: invisible, exactly as git treats it
        }
        let repaired = null;
        try {
          const parsed = readPackIndex(part);
          const trailer = hex(packBytes.subarray(packBytes.length - 20));
          if (parsed.packChecksum() === trailer) repaired = part;
        } catch { /* the marker itself was half-written; fall through */ }
        if (!repaired) {
          // The pack was interrupted before it was complete. It is invisible to git
          // (no .idx) and its objects are still loose; leave it for repack() to clear.
          note(`ignoring ${base}.pack: an interrupted repack, objects are still loose`);
          continue;
        }
        await fs.write(`${PACK_DIR}/${base}.idx`, repaired);
        idxBytes = repaired;
        note(`repaired ${base}.idx from ${base}.idx.part (an interrupted repack)`);
      }
      found.push({
        name: base,
        reader: readPack(packBytes, idxBytes, { verifyOids: opts.verifyOids !== false }),
      });
    }
    packs = found;
  }

  const ensure = () => (loading ??= load());

  return {
    /** Re-read the pack directory. Called after a repack publishes a new pack. */
    async reload() { loading = load(); await loading; },

    /** @param {OID} oid @returns {Promise<boolean>} */
    async has(oid) {
      await ensure();
      for (const p of packs) if (await p.reader.has(oid)) return true;
      return false;
    },

    /** @param {OID} oid @returns {Promise<{type:string, content:Bytes}|null>} */
    async read(oid) {
      await ensure();
      for (const p of packs) {
        const got = await p.reader.tryRead(oid);
        if (got) return got;
      }
      return null;
    },

    /** @returns {Promise<OID[]>} every oid in every pack (duplicates across packs kept once) */
    async oids() {
      await ensure();
      const out = new Set();
      for (const p of packs) for (const oid of p.reader.oids()) out.add(oid);
      return [...out];
    },

    /** @returns {Promise<{name:string, objects:number}[]>} */
    async list() {
      await ensure();
      return packs.map((p) => ({ name: p.name, objects: p.reader.count() }));
    },

    /** @returns {Promise<boolean>} recomputes every pack's SHA-1; throws on mismatch */
    async verify() {
      await ensure();
      for (const p of packs) await p.reader.verifyChecksum();
      return true;
    },
  };
}

/**
 * The object store the rest of the runtime uses: loose objects and packs behind one
 * interface, plus repacking.
 *
 * `write`, `read` and `has` are exactly `objectStore`'s, so this is a drop-in replacement
 * (that is the whole design constraint — five modules and 213 tests call the old shape).
 *
 * @param {FsAdapter} fs
 * @param {{repackThreshold?: number, repackBatch?: number, verifyOids?: boolean,
 *          onRepair?: (note: string) => void}} [opts]
 */
export function packedStore(fs, opts = {}) {
  const threshold = opts.repackThreshold ?? DEFAULT_REPACK_THRESHOLD;
  const batchSize = opts.repackBatch ?? DEFAULT_REPACK_BATCH;
  const packs = packSet(fs, opts);
  const store = objectStore(fs, { packs });
  const looseOnly = objectStore(fs);

  let scanned = false;
  let looseCount = 0;
  let writesSinceCount = 0;

  /** Every loose object id currently on disk. @returns {Promise<OID[]>} */
  async function looseOids() {
    /** @type {OID[]} */
    const out = [];
    for (const dir of await fs.list(OBJECTS_DIR)) {
      if (!/^[0-9a-f]{2}$/.test(dir)) continue; // 'info', 'pack', and anything else
      for (const name of await fs.list(`${OBJECTS_DIR}/${dir}`)) {
        if (/^[0-9a-f]{38}$/.test(name)) out.push(dir + name);
      }
    }
    return out;
  }

  /**
   * Pack name git would use: the SHA-1 of the sorted raw oids. Built into one buffer
   * rather than with `concatBytes(...)`, because 25 000 spread arguments overflows the
   * call stack (see the note in pack.js `join`).
   */
  function packName(oids) {
    const sorted = [...oids].sort();
    const raw = new Uint8Array(sorted.length * 20);
    for (let i = 0; i < sorted.length; i++) raw.set(unhex(sorted[i]), i * 20);
    return `pack-${hex(sha1(raw))}`;
  }

  /**
   * Read the pack and index back from disk and prove they hold the objects, byte for
   * byte, against the copies that have not been deleted yet — the loose files, or (when
   * coalescing) the packs this one is replacing.
   * @param {string} name @param {OID[]} group
   * @param {(oid: OID) => Promise<{type:string, content:Bytes}>} readSource
   */
  async function verifyFromDisk(name, group, readSource) {
    const packBytes = await fs.read(`${PACK_DIR}/${name}.pack`);
    const idxBytes = await fs.read(`${PACK_DIR}/${name}.idx`) ?? await fs.read(markerPath(name));
    if (!packBytes || !idxBytes) throw new Error(`repack: ${name} did not survive being written`);
    // verifyOids is off because the check below is strictly stronger: every object is
    // compared byte for byte against a copy whose *name is its hash*.
    const reader = readPack(packBytes, idxBytes, { verifyOids: false, cacheBytes: 1 << 20 });
    await reader.verifyChecksum();
    if (reader.count() !== group.length) {
      throw new Error(`repack: ${name} holds ${reader.count()} objects, expected ${group.length}`);
    }
    for (const oid of group) {
      const packed = await reader.read(oid);
      const source = await readSource(oid);
      if (packed.type !== source.type || packed.content.length !== source.content.length) {
        throw new Error(`repack: ${oid} differs between the new pack and its existing copy (type or length)`);
      }
      for (let i = 0; i < source.content.length; i++) {
        if (packed.content[i] !== source.content[i]) {
          throw new Error(`repack: ${oid} differs between the new pack and its existing copy at byte ${i}`);
        }
      }
    }
    return true;
  }

  async function pruneEmptyFanoutDirs() {
    for (const dir of await fs.list(OBJECTS_DIR)) {
      if (!/^[0-9a-f]{2}$/.test(dir)) continue;
      if ((await fs.list(`${OBJECTS_DIR}/${dir}`)).length === 0) {
        await fs.remove(`${OBJECTS_DIR}/${dir}`);
      }
    }
  }

  /**
   * Clear the wreckage of an interrupted repack: a `.idx.part` marker whose `.idx` never
   * landed, and the invisible `.pack` beside it. Safe because a repack deletes loose
   * objects only after the index is published and verified, so anything still marked
   * in-flight is a pure duplicate of objects that are on disk loose right now.
   *
   * Assumes a single writer per repo — which the whole design assumes (one peer, one
   * process, Appendix VIII's authoritative peer per resource).
   */
  async function cleanupInterrupted() {
    for (const name of await fs.list(MARKER_DIR)) {
      if (!name.endsWith('.idx.part')) continue;
      const base = name.slice(0, -('.idx.part'.length));
      const published = await fs.read(`${PACK_DIR}/${base}.idx`);
      let ok = false;
      if (published) {
        try { readPackIndex(published); ok = true; } catch { ok = false; }
      }
      if (ok) {
        await fs.remove(`${MARKER_DIR}/${name}`); // step 7 of an earlier repack, unfinished
      } else {
        await fs.remove(`${MARKER_DIR}/${name}`);
        await fs.remove(`${PACK_DIR}/${base}.idx`);
        await fs.remove(`${PACK_DIR}/${base}.pack`);
      }
    }
  }

  /**
   * Fold objects into packs. Safe by ordering (see the top of this file): a copy of an
   * object is deleted only after a pack containing it has been read back from disk and
   * compared, byte for byte, against that copy.
   *
   * `{ all: true }` also folds in the objects of the packs already present and then removes
   * those packs — git's `repack -ad`. Without it, each repack adds one pack, so a repo that
   * has grown to 10 M objects at the default threshold holds ~2 000 packs. That is legal
   * git and every command still works, but `packSet` holds them all in memory, so periodic
   * coalescing is maintenance a large installation has to run. Automatic geometric
   * repacking (git's `--geometric`) is not implemented; see the report.
   *
   * @param {{batch?: number, all?: boolean}} [o]
   * @returns {Promise<{packs: string[], objects: number, removed: string[]}>}
   */
  async function repack(o = {}) {
    await cleanupInterrupted();
    const coalesce = o.all === true;
    const loose = await looseOids();

    // A snapshot of the packs as they are *now*. Verification must never read the pack it
    // is verifying, so the source reader gets its own packSet, loaded before anything new
    // is written.
    const existing = await packs.list();
    const source = coalesce ? packSet(fs, { ...opts, verifyOids: false }) : null;
    if (source) await source.list();
    const fromPacks = coalesce ? await source.oids() : [];

    const all = coalesce ? [...new Set([...loose, ...fromPacks])] : loose;
    if (all.length === 0) return { packs: [], objects: 0, removed: [] };

    // Loose first, then the packs as they were before this repack started. In the common
    // case (no coalescing) this is exactly the loose reader, so no object is read twice.
    const readSource = source === null ? ((oid) => looseOnly.read(oid)) : async (oid) => {
      if (await fs.read(loosePath(oid))) return looseOnly.read(oid);
      const packed = await source.read(oid);
      if (!packed) throw new Error(`repack: ${oid} disappeared while repacking`);
      return packed;
    };

    const size = o.batch ?? batchSize;
    const alreadyOnDisk = new Set(existing.map((p) => p.name));
    /** @type {string[]} */
    const written = [];
    /** @type {Set<string>} */
    const keep = new Set();

    // Phase 1: write and verify every new pack. Nothing is deleted in this phase, so an
    // interruption anywhere in it leaves a complete repo with some duplicated objects.
    for (let start = 0; start < all.length; start += size) {
      const group = all.slice(start, start + size);
      /** @type {{type:string, content:Bytes}[]} */
      const objects = [];
      for (const oid of group) objects.push(await readSource(oid));
      const { pack, idx, oids: packedOids } = await writePack(objects);
      const name = packName(packedOids);
      if (alreadyOnDisk.has(name)) {
        // The pack name is the SHA-1 of its sorted object ids, so a name that already
        // exists means a pack with exactly these objects is already on disk. Rewriting it
        // in place would briefly leave a live .idx describing different bytes; keeping it
        // is both safe and correct.
        keep.add(name);
        continue;
      }
      await fs.write(markerPath(name), idx);                 // 1 — marker, invisible to git
      await fs.write(`${PACK_DIR}/${name}.pack`, pack);      // 2 — invisible without an .idx
      await verifyFromDisk(name, group, readSource);         // 3 — before anything is deleted
      await fs.write(`${PACK_DIR}/${name}.idx`, idx);        // 4 — the pack goes live here
      // 5 — the pack itself was already read back and compared in step 3, so all that can
      // still be wrong is the index that was just published. Compare it byte for byte with
      // what we meant to write; re-reading every object a second time would cost a third of
      // the repack for no additional information.
      const published = await fs.read(`${PACK_DIR}/${name}.idx`);
      if (!published || published.length !== idx.length) {
        throw new Error(`repack: ${name}.idx did not survive being written`);
      }
      for (let i = 0; i < idx.length; i++) {
        if (published[i] !== idx[i]) throw new Error(`repack: ${name}.idx differs from what was written, at byte ${i}`);
      }
      written.push(name);
      keep.add(name);
    }
    await packs.reload();

    // Phase 2: now, and only now, the redundant copies go.
    for (const oid of loose) await fs.remove(loosePath(oid));  // 6
    /** @type {string[]} */
    const removed = [];
    if (coalesce) {
      for (const old of existing) {
        if (keep.has(old.name)) continue;
        // The .idx first: that is what makes a pack visible to git, so the moment it is
        // gone the .pack is inert even if the next call never happens.
        await fs.remove(`${PACK_DIR}/${old.name}.idx`);
        await fs.remove(`${PACK_DIR}/${old.name}.pack`);
        await fs.remove(`${PACK_DIR}/${old.name}.rev`);   // git writes these; ours are stale
        removed.push(old.name);
      }
      await packs.reload();
    }
    for (const name of written) await fs.remove(markerPath(name));  // 7
    await pruneEmptyFanoutDirs();
    looseCount = 0;
    writesSinceCount = 0;
    scanned = true;
    return { packs: written, objects: all.length, removed };
  }

  /**
   * Repack if loose objects have passed the threshold. Called after each commit. The
   * loose count is scanned once per store instance and then tracked, so the common case
   * costs no I/O at all.
   * @returns {Promise<{packs:string[], objects:number}|null>}
   */
  async function maybeRepack() {
    if (!(threshold > 0)) return null;
    if (!scanned) {
      looseCount = (await looseOids()).length;
      writesSinceCount = 0;
      scanned = true;
    } else if (writesSinceCount > 0) {
      // May over-count when the same object was written twice; the next repack re-scans,
      // so the error can only ever cause an earlier repack, never a missed one.
      looseCount += writesSinceCount;
      writesSinceCount = 0;
    }
    if (looseCount < threshold) return null;
    return repack();
  }

  return {
    /** @param {'blob'|'tree'|'commit'|'tag'} type @param {Bytes} content @returns {Promise<OID>} */
    async write(type, content) {
      const oid = await store.write(type, content);
      writesSinceCount++;
      return oid;
    },
    /** @param {OID} oid @returns {Promise<{type:string, content:Bytes}>} */
    read: (oid) => store.read(oid),
    /** @param {OID} oid @returns {Promise<boolean>} */
    has: (oid) => store.has(oid),

    repack,
    maybeRepack,
    looseOids,
    cleanupInterrupted,
    packs,

    /** @returns {Promise<{loose:number, packed:number, packs:{name:string,objects:number}[]}>} */
    async stats() {
      const loose = (await looseOids()).length;
      const list = await packs.list();
      return { loose, packed: list.reduce((n, p) => n + p.objects, 0), packs: list };
    },
  };
}
