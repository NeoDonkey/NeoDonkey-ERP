// runtime/git/pack.js — packfile v2, read and write (FD-2).
//
// Why this file exists: every object v0.1 wrote was loose. At the manifesto's own figure
// of ~5 000 commits/day, ten years is tens of millions of files under .git/objects — slow
// to walk, punishing on any filesystem with per-file overhead, and a "Git is the database"
// claim that describes git in its worst configuration. Git solved this in 2005 with
// packfiles; this is that format, ours, with no dependency.
//
// Pack v2, exactly as git writes it:
//
//   0   "PACK"
//   4   uint32 version = 2
//   8   uint32 object count
//   12  N entries, each: variable-length (type, uncompressed size) header,
//                        then the zlib-deflated object content
//   ..  uint8[20] SHA-1 of every preceding byte of the file
//
// The entry header packs the type into 3 bits and the size into a little-endian-ish
// 7-bits-per-byte varint whose *first* byte only carries 4 size bits. Sizes are handled
// with multiplication rather than `<<`, because a 300 MB blob's size does not survive a
// 32-bit shift and "silently wrong" is the one outcome we never accept.
//
// Deltas: OFS_DELTA (6) and REF_DELTA (7) are *read*. That is not optional — a repo a
// human created with `git clone` is full of them, and a store that cannot read them
// cannot open a real repo. Writing deltas is not implemented in v1.0; see the report and
// COMPROMISES for the measured size cost.
//
// No node:*, no clock, no randomness. Loads in a browser as-is.

import { sha1, hex, sha1Stream } from './sha1.js';
import { deflate } from './zlib.js';
import { concatBytes } from './objects.js';
import { crc32, readPackIndex, writePackIndex } from './pack-index.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID */

const enc = new TextEncoder();

export const PACK_VERSION = 2;
const PACK_SIGNATURE = [0x50, 0x41, 0x43, 0x4b]; // "PACK"
export const PACK_HEADER_BYTES = 12;

/** git's in-pack type numbers. 5 is unused; 6 and 7 are the two delta forms. */
export const TYPE_BY_NUMBER = Object.freeze([null, 'commit', 'tree', 'blob', 'tag', null, 'ofs-delta', 'ref-delta']);
export const NUMBER_BY_TYPE = Object.freeze({ commit: 1, tree: 2, blob: 3, tag: 4 });
const OFS_DELTA = 6;
const REF_DELTA = 7;

/** Deepest delta chain we will follow. git's own default depth is 50. */
const MAX_DELTA_DEPTH = 500;

// ---------------------------------------------------------------------------
// SHA-1 over a stream
// ---------------------------------------------------------------------------

/**
 * An incremental SHA-1, so a pack larger than memory can still be hashed.
 *
 * Honest note: this duplicates the compression function in sha1.js. That file exports
 * only a one-shot `sha1(bytes)`, which for a 2.2 GB pack would need the whole pack in
 * one array *plus* a padded copy of it — 4.4 GB, which fails on ordinary hardware. The
 * clean fix is to make sha1.js expose this incremental core and have `sha1()` call it;
 * that is a change to another agent's file, so it is proposed in the report (P-2) rather
 * than taken. The two implementations are cross-checked against each other in
 * test/p-pack.test.js, so they cannot drift silently.
 */
/**
 * The incremental SHA-1 now lives in `sha1.js` (amendment P-2, applied by the CTO), so this is a
 * thin adapter and the ~35 lines that used to be duplicated here are gone. `sha1OfChunks` below
 * therefore no longer cross-checks two implementations against each other — it checks that the
 * shared one still agrees with `sha1()` over chunk boundaries, which is a weaker but still real
 * property, and the strong check is now against Node's `crypto` in the CTO's verification.
 */
class Sha1Stream {
  constructor() { this._s = sha1Stream(); }

  /** @param {Bytes} bytes */
  update(bytes) { this._s.update(bytes); return this; }

  /** @returns {Bytes} 20 raw bytes */
  digest() { return this._s.digest(); }
}

/** Exposed for the cross-check test against sha1.js. @param {Bytes[]} chunks */
export function sha1OfChunks(chunks) {
  const s = new Sha1Stream();
  for (const c of chunks) s.update(c);
  return s.digest();
}

/**
 * Join many byte arrays. objects.js's `concatBytes(...arrays)` cannot be used for a pack:
 * 100 000 objects means 200 001 chunks, and spreading that many arguments is a
 * "Maximum call stack size exceeded" — found by benchmarking, not by reasoning.
 * @param {Bytes[]} chunks @param {number} [total]
 * @returns {Bytes}
 */
function join(chunks, total) {
  let length = total;
  if (length === undefined) {
    length = 0;
    for (const c of chunks) length += c.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ---------------------------------------------------------------------------
// zlib, with an unknown compressed length
// ---------------------------------------------------------------------------

/**
 * Inflate exactly `expectedSize` bytes out of `bytes`, ignoring whatever follows the end
 * of the deflate stream.
 *
 * zlib.js's `inflate()` cannot be used here: it drains the stream to completion, and a
 * pack entry's compressed length is not recorded anywhere, so the slice we hand it is
 * "this entry, and possibly a byte or two of the next". Node and browsers both reject
 * that with "Trailing junk found after the end of the compressed stream". Reading exactly
 * as many bytes as the entry header promised, then cancelling, is both correct and how we
 * detect a lying header: too few bytes or too many are each an error.
 *
 * @param {Bytes} bytes
 * @param {number} expectedSize
 * @returns {Promise<Bytes>}
 */
async function inflateExact(bytes, expectedSize) {
  const stream = new DecompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // Fire-and-forget: any write error surfaces on the readable side, which we do read.
  // When we cancel early the write is abandoned on purpose, hence the swallow.
  const feeding = (async () => {
    try { await writer.write(bytes); await writer.close(); } catch { /* see above */ }
  })();
  const out = new Uint8Array(expectedSize);
  let at = 0;
  try {
    for (;;) {
      if (at === expectedSize) { await reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.length > expectedSize) {
        throw new Error(
          `pack: object inflates to more than the ${expectedSize} bytes its header declares`,
        );
      }
      out.set(value, at);
      at += value.length;
    }
  } finally {
    await feeding;
  }
  if (at !== expectedSize) {
    throw new Error(`pack: object inflated to ${at} bytes, header declares ${expectedSize}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// entry framing
// ---------------------------------------------------------------------------

/**
 * @param {number} typeNumber 1..7
 * @param {number} size uncompressed size
 * @returns {Bytes}
 */
export function encodeEntryHeader(typeNumber, size) {
  if (!Number.isInteger(typeNumber) || typeNumber < 1 || typeNumber > 7) {
    throw new Error(`pack: bad in-pack type number ${typeNumber}`);
  }
  if (!Number.isSafeInteger(size) || size < 0) throw new Error(`pack: bad object size ${size}`);
  /** @type {number[]} */
  const out = [];
  let byte = (typeNumber << 4) | (size % 16);
  let rest = Math.floor(size / 16);
  while (rest > 0) {
    out.push(byte | 0x80);
    byte = rest % 128;
    rest = Math.floor(rest / 128);
  }
  out.push(byte);
  return new Uint8Array(out);
}

/**
 * The inverse of encodeEntryHeader. Exported because the sizes that matter here are the
 * ones no test repo can contain — a 4 GB blob's size must survive the varint, and the only
 * way to check that is to encode and decode it directly.
 * @param {Bytes} buf @param {number} at
 * @returns {{typeNumber:number, size:number, at:number}}
 */
export function decodeEntryHeader(buf, at) {
  if (at >= buf.length) throw new Error('pack: entry header runs past the end of the pack');
  let byte = buf[at++];
  const typeNumber = (byte >> 4) & 7;
  let size = byte & 15;
  let scale = 16;
  while (byte & 0x80) {
    if (at >= buf.length) throw new Error('pack: entry size varint runs past the end of the pack');
    byte = buf[at++];
    size += (byte & 0x7f) * scale;
    scale *= 128;
    if (!Number.isSafeInteger(size)) throw new Error('pack: entry declares a size beyond 2^53');
  }
  return { typeNumber, size, at };
}

/**
 * The OFS_DELTA base distance: a big-endian varint with an unusual "+1 per continuation"
 * bias, so that every distance has exactly one encoding.
 * @param {Bytes} buf @param {number} at
 * @returns {{distance:number, at:number}}
 */
function decodeOffsetDistance(buf, at) {
  if (at >= buf.length) throw new Error('pack: OFS_DELTA distance runs past the end of the pack');
  let byte = buf[at++];
  let distance = byte & 0x7f;
  while (byte & 0x80) {
    if (at >= buf.length) throw new Error('pack: OFS_DELTA distance runs past the end of the pack');
    byte = buf[at++];
    distance = (distance + 1) * 128 + (byte & 0x7f);
    if (!Number.isSafeInteger(distance)) throw new Error('pack: OFS_DELTA distance beyond 2^53');
  }
  return { distance, at };
}

/** The bytes git hashes to get an object id: "<type> <length>\0<content>". */
function looseHeader(type, size) {
  return enc.encode(`${type} ${size}\0`);
}

/** @param {string} type @param {Bytes} content @returns {OID} */
export function oidOf(type, content) {
  return hex(sha1(concatBytes(looseHeader(type, content.length), content)));
}

// ---------------------------------------------------------------------------
// delta application
// ---------------------------------------------------------------------------

/**
 * Apply a git delta to its base. Format: source size varint, target size varint, then
 * instructions — high bit set means "copy a run from the base", clear means "insert the
 * next N literal bytes".
 *
 * Every bound is checked. A delta that copies past the end of its base, or produces a
 * different number of bytes than it promised, is a corrupt pack, and this is exactly
 * where a lax reader would hand back a plausible-looking wrong object.
 *
 * @param {Bytes} base @param {Bytes} delta @returns {Bytes}
 */
export function applyDelta(base, delta) {
  let at = 0;
  const varint = () => {
    let shift = 1;
    let value = 0;
    let byte;
    do {
      if (at >= delta.length) throw new Error('pack: delta header is truncated');
      byte = delta[at++];
      value += (byte & 0x7f) * shift;
      shift *= 128;
    } while (byte & 0x80);
    return value;
  };
  const sourceSize = varint();
  const targetSize = varint();
  if (sourceSize !== base.length) {
    throw new Error(`pack: delta expects a ${sourceSize}-byte base, got ${base.length}`);
  }
  const out = new Uint8Array(targetSize);
  let write = 0;
  while (at < delta.length) {
    const op = delta[at++];
    if (op & 0x80) {
      let copyAt = 0;
      let copySize = 0;
      if (op & 0x01) copyAt += delta[at++];
      if (op & 0x02) copyAt += delta[at++] * 256;
      if (op & 0x04) copyAt += delta[at++] * 65536;
      if (op & 0x08) copyAt += delta[at++] * 16777216;
      if (op & 0x10) copySize += delta[at++];
      if (op & 0x20) copySize += delta[at++] * 256;
      if (op & 0x40) copySize += delta[at++] * 65536;
      if (copySize === 0) copySize = 0x10000; // git's documented special case
      if (at > delta.length) throw new Error('pack: delta copy instruction is truncated');
      if (copyAt + copySize > base.length) {
        throw new Error(`pack: delta copies bytes ${copyAt}..${copyAt + copySize} from a ${base.length}-byte base`);
      }
      if (write + copySize > targetSize) throw new Error('pack: delta writes past its declared target size');
      out.set(base.subarray(copyAt, copyAt + copySize), write);
      write += copySize;
    } else {
      if (op === 0) throw new Error('pack: delta opcode 0 is reserved');
      if (at + op > delta.length) throw new Error('pack: delta insert instruction is truncated');
      if (write + op > targetSize) throw new Error('pack: delta writes past its declared target size');
      out.set(delta.subarray(at, at + op), write);
      write += op;
      at += op;
    }
  }
  if (write !== targetSize) {
    throw new Error(`pack: delta produced ${write} bytes, declared ${targetSize}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/**
 * Write a packfile and its index.
 *
 * `objects` entries are `{type, content}`, or `{type, read()}` for content that should not
 * all be resident at once. Object ids must be distinct: a pack index cannot hold an oid
 * twice, so a duplicate is refused rather than quietly dropped (the header's object count
 * is already committed by then, and a pack whose count lies is a corrupt pack).
 *
 * `opts.sink(chunk)` streams the pack out instead of returning it, so a pack larger than
 * available memory is still writable — the ">2 GB and therefore 64-bit offsets" case.
 *
 * @param {{type:string, content?:Bytes, read?:() => Promise<Bytes>}[]} objects
 * @param {{sink?: (chunk: Bytes) => void|Promise<void>, level?: undefined}} [opts]
 * @returns {Promise<{pack: Bytes|null, idx: Bytes, oids: OID[], packChecksum: string,
 *                    packBytes: number, entries: {oid:OID, offset:number, crc32:number}[]}>}
 */
export async function writePack(objects, opts = {}) {
  if (!Array.isArray(objects)) throw new Error('writePack: objects must be an array');
  const sink = opts.sink ?? null;
  if (sink !== null && typeof sink !== 'function') throw new Error('writePack: opts.sink must be a function');

  /** @type {Bytes[]|null} */
  const chunks = sink ? null : [];
  const hasher = new Sha1Stream();
  let at = 0;

  /** @param {Bytes} chunk */
  const emit = async (chunk) => {
    hasher.update(chunk);
    at += chunk.length;
    if (sink) await sink(chunk);
    else chunks.push(chunk);
  };

  const header = new Uint8Array(PACK_HEADER_BYTES);
  header.set(PACK_SIGNATURE, 0);
  new DataView(header.buffer).setUint32(4, PACK_VERSION);
  new DataView(header.buffer).setUint32(8, objects.length);
  await emit(header);

  /** @type {{oid:OID, offset:number, crc32:number}[]} */
  const entries = [];
  /** @type {Set<OID>} */
  const seen = new Set();
  for (const object of objects) {
    const typeNumber = NUMBER_BY_TYPE[object && object.type];
    if (!typeNumber) {
      throw new Error(`writePack: unknown object type ${JSON.stringify(object && object.type)} (blob, tree, commit, tag)`);
    }
    const content = object.content ?? (object.read ? await object.read() : null);
    if (!(content instanceof Uint8Array)) {
      throw new Error(`writePack: object content must be a Uint8Array (${object.type})`);
    }
    const oid = oidOf(object.type, content);
    if (seen.has(oid)) {
      throw new Error(`writePack: duplicate object ${oid} — deduplicate before packing`);
    }
    seen.add(oid);

    const offset = at;
    const entryHeader = encodeEntryHeader(typeNumber, content.length);
    const compressed = await deflate(content);
    entries.push({ oid, offset, crc32: crc32(compressed, crc32(entryHeader)) });
    await emit(entryHeader);
    await emit(compressed);
  }

  const checksum = hasher.digest();
  await emit(checksum);

  const idx = await writePackIndex(entries, checksum);
  return {
    pack: chunks ? join(chunks, at) : null,
    idx,
    oids: entries.map((e) => e.oid),
    packChecksum: hex(checksum),
    packBytes: at,
    entries,
  };
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * Accept either a Uint8Array or a lazy source `{length, slice(start,end)}`, so a 2 GB
 * pack on disk does not have to be resident to be read. FsAdapter has no positional
 * read (see the report, amendment P-3), so store.js currently uses the array form; the
 * lazy form exists because the 64-bit offset path cannot be tested honestly without it.
 * @param {Bytes|{length:number, slice:(s:number,e:number)=>Bytes|Promise<Bytes>}} pack
 */
function byteSource(pack) {
  if (pack instanceof Uint8Array) {
    return { length: pack.length, slice: async (s, e) => pack.subarray(s, e) };
  }
  if (pack && typeof pack.length === 'number' && typeof pack.slice === 'function') {
    return {
      length: pack.length,
      slice: async (s, e) => {
        const got = await pack.slice(s, e);
        if (!(got instanceof Uint8Array) || got.length !== e - s) {
          throw new Error(`readPack: source returned ${got && got.length} bytes for [${s},${e})`);
        }
        return got;
      },
    };
  }
  throw new Error('readPack: pack must be a Uint8Array or {length, slice(start,end)}');
}

/**
 * Random access into a packfile, using its index.
 *
 * Validation on open: the "PACK" signature, version 2, an object count that agrees with
 * the index, and — the cheap check that catches most real accidents — the pack's trailing
 * SHA-1 against the one the index records. A pack paired with someone else's index, or
 * truncated, or with a rewritten trailer, all fail here rather than later and quietly.
 *
 * Validation per object read: the CRC32 the index records for the packed entry, and the
 * SHA-1 of the reconstructed object against the oid asked for. That second check is what
 * makes a corrupt or maliciously-edited pack a loud error instead of a wrong invoice.
 *
 * @param {Bytes|{length:number, slice:Function}} pack
 * @param {Bytes} idxBytes
 * @param {{verifyOids?: boolean, cacheBytes?: number, verifyIndexChecksum?: boolean}} [opts]
 */
export function readPack(pack, idxBytes, opts = {}) {
  const src = byteSource(pack);
  const idx = readPackIndex(idxBytes, { verifyChecksum: opts.verifyIndexChecksum !== false });
  const verifyOids = opts.verifyOids !== false;
  const cacheLimit = opts.cacheBytes ?? 32 * 1024 * 1024;

  /** @type {Map<OID, {type:string, content:Bytes}>} */
  const cache = new Map();
  let cacheBytes = 0;

  /** @type {Float64Array|null} sorted object offsets, so an entry's extent is known */
  let sortedOffsets = null;
  /** @type {Map<number, number>|null} offset -> index in the .idx */
  let byOffset = null;
  let dataEnd = 0;
  /** @type {Promise<void>|null} */
  let opened = null;

  async function open() {
    const count = idx.count();
    if (src.length < PACK_HEADER_BYTES + 20) {
      throw new Error(`readPack: pack is only ${src.length} bytes, too small to be a pack`);
    }
    const head = await src.slice(0, PACK_HEADER_BYTES);
    for (let i = 0; i < 4; i++) {
      if (head[i] !== PACK_SIGNATURE[i]) throw new Error('readPack: missing "PACK" signature');
    }
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const version = dv.getUint32(4);
    if (version !== PACK_VERSION) throw new Error(`readPack: unsupported pack version ${version}`);
    const declared = dv.getUint32(8);
    if (declared !== count) {
      throw new Error(`readPack: pack declares ${declared} objects, its index has ${count}`);
    }

    dataEnd = src.length - 20;
    const trailer = await src.slice(dataEnd, src.length);
    if (hex(trailer) !== idx.packChecksum()) {
      throw new Error(
        `readPack: pack trailer ${hex(trailer)} does not match the ${idx.packChecksum()} its index `
        + 'records — the pack is truncated, corrupt, or not the one this index describes',
      );
    }

    sortedOffsets = new Float64Array(count);
    byOffset = new Map();
    for (let i = 0; i < count; i++) {
      const offset = idx.offsetAt(i);
      if (offset < PACK_HEADER_BYTES || offset >= dataEnd) {
        throw new Error(`readPack: index puts ${idx.oidAt(i)} at offset ${offset}, outside the pack's data`);
      }
      if (byOffset.has(offset)) throw new Error(`readPack: two objects share offset ${offset}`);
      byOffset.set(offset, i);
      sortedOffsets[i] = offset;
    }
    sortedOffsets.sort();
  }

  const ensureOpen = () => (opened ??= open());

  /** The end of the entry that starts at `offset`: the next entry, or the trailer. */
  function extentEnd(offset) {
    let lo = 0;
    let hi = sortedOffsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedOffsets[mid] <= offset) lo = mid + 1; else hi = mid;
    }
    return lo < sortedOffsets.length ? sortedOffsets[lo] : dataEnd;
  }

  /** @param {OID} oid @param {{type:string, content:Bytes}} object */
  function remember(oid, object) {
    if (object.content.length > cacheLimit) return;
    cache.set(oid, object);
    cacheBytes += object.content.length;
    // Insertion-ordered eviction. A delta chain is walked base-first, so the entries most
    // likely to be reused are also the most recently inserted; dropping the oldest is the
    // right bias and costs nothing to implement.
    while (cacheBytes > cacheLimit) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cacheBytes -= cache.get(oldest.value).content.length;
      cache.delete(oldest.value);
    }
  }

  /**
   * Read the entry at `offset`, following delta chains to a real object.
   * @param {number} offset @param {number} depth
   * @returns {Promise<{type:string, content:Bytes}>}
   */
  async function objectAt(offset, depth = 0) {
    if (depth > MAX_DELTA_DEPTH) {
      throw new Error(`readPack: delta chain deeper than ${MAX_DELTA_DEPTH} at offset ${offset} (a cycle?)`);
    }
    const i = byOffset.get(offset);
    if (i === undefined) {
      throw new Error(`readPack: offset ${offset} has no entry in the index (a delta base outside the index?)`);
    }
    const oid = idx.oidAt(i);
    const hit = cache.get(oid);
    if (hit) return hit;

    const end = extentEnd(offset);
    const buf = await src.slice(offset, end);
    const want = idx.crc32At(i);
    const got = crc32(buf);
    if (got !== want) {
      throw new Error(
        `readPack: CRC32 mismatch for ${oid} at offset ${offset}: index says `
        + `${want.toString(16)}, packed bytes hash to ${got.toString(16)}`,
      );
    }

    const parsed = decodeEntryHeader(buf, 0);
    let cursor = parsed.at;
    /** @type {{type:string, content:Bytes}} */
    let object;
    if (parsed.typeNumber === OFS_DELTA) {
      const { distance, at: after } = decodeOffsetDistance(buf, cursor);
      cursor = after;
      const baseOffset = offset - distance;
      if (distance <= 0 || baseOffset < PACK_HEADER_BYTES) {
        throw new Error(`readPack: OFS_DELTA at ${offset} points at offset ${baseOffset}`);
      }
      const base = await objectAt(baseOffset, depth + 1);
      const delta = await inflateExact(buf.subarray(cursor), parsed.size);
      object = { type: base.type, content: applyDelta(base.content, delta) };
    } else if (parsed.typeNumber === REF_DELTA) {
      if (cursor + 20 > buf.length) throw new Error(`readPack: REF_DELTA at ${offset} is truncated`);
      const baseOid = hex(buf.subarray(cursor, cursor + 20));
      cursor += 20;
      const baseIndex = idx.indexOf(baseOid);
      if (baseIndex < 0) {
        // A thin pack (as sent over the wire) can reference a base it does not contain.
        // We never write those, and reading one requires the rest of the object store,
        // so it is refused by name rather than half-supported.
        throw new Error(
          `readPack: REF_DELTA base ${baseOid} is not in this pack (thin packs are not supported)`,
        );
      }
      const base = await objectAt(idx.offsetAt(baseIndex), depth + 1);
      const delta = await inflateExact(buf.subarray(cursor), parsed.size);
      object = { type: base.type, content: applyDelta(base.content, delta) };
    } else {
      const type = TYPE_BY_NUMBER[parsed.typeNumber];
      if (!type) throw new Error(`readPack: unknown in-pack type ${parsed.typeNumber} at offset ${offset}`);
      object = { type, content: await inflateExact(buf.subarray(cursor), parsed.size) };
    }

    if (verifyOids) {
      const actual = oidOf(object.type, object.content);
      if (actual !== oid) {
        throw new Error(
          `readPack: object at offset ${offset} is indexed as ${oid} but hashes to ${actual}`,
        );
      }
    }
    remember(oid, object);
    return object;
  }

  return {
    /** @param {OID} oid @returns {Promise<boolean>} */
    async has(oid) {
      await ensureOpen();
      return idx.indexOf(oid) >= 0;
    },

    /** @param {OID} oid @returns {Promise<{type:string, content:Bytes}>} */
    async read(oid) {
      await ensureOpen();
      const i = idx.indexOf(oid);
      if (i < 0) throw new Error(`readPack: ${oid} is not in this pack`);
      return objectAt(idx.offsetAt(i));
    },

    /** @param {OID} oid @returns {Promise<{type:string, content:Bytes}|null>} */
    async tryRead(oid) {
      await ensureOpen();
      const i = idx.indexOf(oid);
      if (i < 0) return null;
      return objectAt(idx.offsetAt(i));
    },

    /** @returns {OID[]} */
    oids() { return idx.oids(); },

    /** @returns {number} */
    count() { return idx.count(); },

    /** @param {OID} oid @returns {Promise<number>} byte offset in the pack */
    async offsetOf(oid) {
      await ensureOpen();
      const i = idx.indexOf(oid);
      if (i < 0) throw new Error(`readPack: ${oid} is not in this pack`);
      return idx.offsetAt(i);
    },

    /** Force the structural checks now instead of on first read. */
    async open() { await ensureOpen(); return true; },

    /**
     * Recompute the pack's SHA-1 over every byte. The open-time check compares the
     * recorded trailer with the index, which is O(1); this is the O(size) proof that the
     * bytes in between are the bytes that were hashed. Called by store.repack() before it
     * deletes anything, and by the tests.
     * @returns {Promise<boolean>}
     */
    async verifyChecksum() {
      await ensureOpen();
      const hasher = new Sha1Stream();
      const step = 1 << 22;
      for (let s = 0; s < src.length - 20; s += step) {
        hasher.update(await src.slice(s, Math.min(s + step, src.length - 20)));
      }
      const computed = hex(hasher.digest());
      if (computed !== idx.packChecksum()) {
        throw new Error(
          `readPack: pack content hashes to ${computed}, its trailer and index say ${idx.packChecksum()}`,
        );
      }
      return true;
    },

    /** Everything in the pack, read and verified. Used by repack()'s read-back proof. */
    async readAll() {
      await ensureOpen();
      /** @type {Map<OID, {type:string, content:Bytes}>} */
      const out = new Map();
      for (let i = 0; i < idx.count(); i++) {
        const oid = idx.oidAt(i);
        out.set(oid, await objectAt(idx.offsetAt(i)));
      }
      return out;
    },

    index: idx,
    packChecksum: () => idx.packChecksum(),
  };
}
