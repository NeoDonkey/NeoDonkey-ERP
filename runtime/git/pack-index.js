// runtime/git/pack-index.js — the `.idx` v2 side of packed object storage (FD-2).
//
// A packfile is useless without a random-access index: `.git/objects/pack/pack-X.idx`
// is what turns "somewhere in a 2 GB file" into two array lookups and a binary search.
// The format is git's, unchanged since 2007, and it is the reason "Git is the database"
// can mean a database rather than a directory with ten million files in it.
//
// Layout (all integers big-endian, exactly as git writes them):
//
//   0    "\xfftOc"                     magic, chosen because it cannot be a v1 fanout
//   4    uint32 version = 2
//   8    uint32[256] fanout            cumulative count of oids with first byte <= i
//   ...  uint8[20][N]  oids            ascending byte order
//   ...  uint32[N]     crc32           of the packed entry (header + deflated bytes)
//   ...  uint32[N]     offsets         MSB set -> index into the 64-bit table below
//   ...  uint64[M]     large offsets   only present when the pack exceeds 2 GB
//   ...  uint8[20]     pack checksum   the trailing SHA-1 of the .pack it describes
//   ...  uint8[20]     index checksum  SHA-1 of everything above
//
// The 64-bit table is not optional here. A 500 M€ company's repo passes 2 GB, and a
// 32-bit truncation at that point does not fail loudly — it points at the wrong byte
// and hands back a different object. That is data loss, so it is implemented and tested.
//
// Nothing in this file reads a clock, allocates randomness, or touches an FsAdapter.

import { sha1, hex, unhex } from './sha1.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID */

export const IDX_VERSION = 2;

/** "\xfftOc" — git's own magic for a v2 index. */
export const IDX_MAGIC = Object.freeze([0xff, 0x74, 0x4f, 0x63]);

const HEADER_BYTES = 8;
const FANOUT_BYTES = 256 * 4;
const TRAILER_BYTES = 40; // pack checksum + index checksum
const BASE_BYTES = HEADER_BYTES + FANOUT_BYTES + TRAILER_BYTES;

/** Offsets at or above this need the 64-bit table; git's own boundary. */
export const LARGE_OFFSET = 0x80000000;

// ---------------------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------------------

// zlib's polynomial (0xedb88320, the reflected form of 0x04c11db7), which is what git
// stores per object. Written out here rather than imported from anywhere: twenty lines
// is cheaper than a dependency, and Principle 3 is not a slogan.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Bytes} bytes
 * @param {number} [seed] a previous crc32 result, for chunked input
 * @returns {number} unsigned 32-bit
 */
export function crc32(bytes, seed = 0) {
  let c = (~seed) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/** @param {unknown} oid */
function assertOidHex(oid) {
  if (typeof oid !== 'string' || !/^[0-9a-f]{40}$/.test(oid)) {
    throw new Error(`pack-index: not a git object id: ${String(oid)}`);
  }
}

/** @param {string|Bytes} checksum @returns {Bytes} */
function asChecksum(checksum) {
  if (checksum instanceof Uint8Array) {
    if (checksum.length !== 20) throw new Error(`pack-index: pack checksum must be 20 bytes, got ${checksum.length}`);
    return checksum;
  }
  if (typeof checksum === 'string' && /^[0-9a-f]{40}$/.test(checksum)) return unhex(checksum);
  throw new Error(
    'pack-index: writePackIndex needs the .pack file\'s trailing SHA-1 as its second argument '
    + '(40-char hex or 20 bytes). An index that records the wrong pack checksum is one real git '
    + 'refuses to open, so this is not defaulted.',
  );
}

/**
 * Write a v2 pack index.
 *
 * The CONTRACT sketch for this function was `writePackIndex(entries)`, which cannot be
 * honoured literally: the index has to record the checksum of the pack it describes, and
 * that value does not exist inside `entries`. Rather than write a zero there and produce
 * an index real git rejects, the pack checksum is a required second argument. Reported as
 * amendment P-1.
 *
 * @param {{oid: OID, offset: number, crc32: number}[]} entries in any order
 * @param {string|Bytes} packChecksum the .pack's trailing SHA-1
 * @returns {Promise<Bytes>}
 */
export async function writePackIndex(entries, packChecksum) {
  if (!Array.isArray(entries)) throw new Error('writePackIndex: entries must be an array');
  const packSum = asChecksum(packChecksum);

  const list = entries.map((e) => {
    assertOidHex(e && e.oid);
    if (!Number.isInteger(e.offset) || e.offset < 0 || !Number.isSafeInteger(e.offset)) {
      throw new Error(`writePackIndex: offset for ${e.oid} must be a non-negative safe integer, got ${e.offset}`);
    }
    if (!Number.isInteger(e.crc32) || e.crc32 < 0 || e.crc32 > 0xffffffff) {
      throw new Error(`writePackIndex: crc32 for ${e.oid} must be a uint32, got ${e.crc32}`);
    }
    return { oid: e.oid, offset: e.offset, crc32: e.crc32 };
  });

  // Lowercase hex compares byte-identically to the raw oids, so a plain string sort is
  // git's sort. Cheaper than sorting 20-byte arrays, and provably the same order.
  list.sort((a, b) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0));
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].oid === list[i].oid) {
      throw new Error(`writePackIndex: duplicate oid ${list[i].oid} — a pack index cannot hold an object twice`);
    }
  }
  const seenOffsets = new Set();
  for (const e of list) {
    if (seenOffsets.has(e.offset)) {
      throw new Error(`writePackIndex: two objects claim pack offset ${e.offset}`);
    }
    seenOffsets.add(e.offset);
  }

  const n = list.length;
  /** @type {number[]} */
  const largeOffsets = [];
  for (const e of list) {
    if (e.offset >= LARGE_OFFSET) {
      e.large = largeOffsets.length;
      largeOffsets.push(e.offset);
    }
  }
  if (largeOffsets.length >= LARGE_OFFSET) {
    throw new Error('writePackIndex: more large offsets than the format can address');
  }

  const total = BASE_BYTES + n * 28 + largeOffsets.length * 8;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(IDX_MAGIC, 0);
  dv.setUint32(4, IDX_VERSION);

  // Fanout: how many oids have a first byte <= i. `git` uses it to skip straight to the
  // right slice before binary searching, which is why lookup is O(log 256ish) in practice.
  let at = HEADER_BYTES;
  {
    let cursor = 0;
    for (let b = 0; b < 256; b++) {
      while (cursor < n && Number.parseInt(list[cursor].oid.slice(0, 2), 16) === b) cursor++;
      dv.setUint32(at + b * 4, cursor);
    }
    if (cursor !== n) throw new Error('writePackIndex: internal fanout mismatch');
  }
  at += FANOUT_BYTES;

  for (const e of list) { out.set(unhex(e.oid), at); at += 20; }
  for (const e of list) { dv.setUint32(at, e.crc32); at += 4; }
  for (const e of list) {
    dv.setUint32(at, e.large === undefined ? e.offset : (LARGE_OFFSET | e.large) >>> 0);
    at += 4;
  }
  for (const offset of largeOffsets) { dv.setBigUint64(at, BigInt(offset)); at += 8; }

  out.set(packSum, at); at += 20;
  out.set(sha1(out.subarray(0, at)), at);
  return out;
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * Parse and *validate* a v2 pack index. Every structural claim the file makes is checked
 * here — magic, version, size arithmetic, monotone oids, the SHA-1 trailer — because a
 * silently-wrong index is indistinguishable from a silently-wrong database.
 *
 * @param {Bytes} idxBytes
 * @param {{verifyChecksum?: boolean}} [opts] verifyChecksum defaults to true; turn it off
 *   only when the caller has already validated these exact bytes.
 * @returns {{ lookup(oid: OID): {offset:number, crc32:number}|null, oids(): OID[],
 *             count(): number, indexOf(oid: OID): number, oidAt(i:number): OID,
 *             offsetAt(i:number): number, crc32At(i:number): number,
 *             packChecksum(): string, indexChecksum(): string, largeOffsetCount(): number }}
 */
export function readPackIndex(idxBytes, opts = {}) {
  if (!(idxBytes instanceof Uint8Array)) throw new Error('readPackIndex: idxBytes must be a Uint8Array');
  if (idxBytes.length < BASE_BYTES) {
    throw new Error(`readPackIndex: index file is too small (${idxBytes.length} bytes, minimum ${BASE_BYTES})`);
  }
  for (let i = 0; i < 4; i++) {
    if (idxBytes[i] !== IDX_MAGIC[i]) {
      throw new Error('readPackIndex: not a v2 pack index (bad magic; v1 indexes are not supported)');
    }
  }
  const dv = new DataView(idxBytes.buffer, idxBytes.byteOffset, idxBytes.byteLength);
  const version = dv.getUint32(4);
  if (version !== IDX_VERSION) throw new Error(`readPackIndex: unsupported index version ${version}`);

  const fanoutAt = HEADER_BYTES;
  let previous = 0;
  for (let b = 0; b < 256; b++) {
    const v = dv.getUint32(fanoutAt + b * 4);
    if (v < previous) throw new Error(`readPackIndex: fanout is not monotonic at byte ${b}`);
    previous = v;
  }
  const count = previous;

  const oidsAt = fanoutAt + FANOUT_BYTES;
  const crcAt = oidsAt + count * 20;
  const offsetsAt = crcAt + count * 4;
  const largeAt = offsetsAt + count * 4;
  if (idxBytes.length < largeAt + TRAILER_BYTES) {
    throw new Error(
      `readPackIndex: index file is truncated: ${count} objects need at least `
      + `${largeAt + TRAILER_BYTES} bytes, file has ${idxBytes.length}`,
    );
  }
  const largeBytes = idxBytes.length - TRAILER_BYTES - largeAt;
  if (largeBytes % 8 !== 0) {
    throw new Error(`readPackIndex: 64-bit offset table is not a whole number of entries (${largeBytes} bytes)`);
  }
  const largeCount = largeBytes / 8;

  if (opts.verifyChecksum !== false) {
    const want = hex(idxBytes.subarray(idxBytes.length - 20));
    const got = hex(sha1(idxBytes.subarray(0, idxBytes.length - 20)));
    if (want !== got) {
      throw new Error(`readPackIndex: index checksum mismatch (records ${want}, content hashes to ${got})`);
    }
  }

  const oidAt = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`readPackIndex: object index ${i} out of range`);
    return hex(idxBytes.subarray(oidsAt + i * 20, oidsAt + i * 20 + 20));
  };
  const crc32At = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`readPackIndex: object index ${i} out of range`);
    return dv.getUint32(crcAt + i * 4);
  };
  const offsetAt = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error(`readPackIndex: object index ${i} out of range`);
    const raw = dv.getUint32(offsetsAt + i * 4);
    if ((raw & LARGE_OFFSET) === 0) return raw;
    const slot = raw & 0x7fffffff;
    if (slot >= largeCount) {
      throw new Error(
        `readPackIndex: object ${oidAt(i)} points at 64-bit offset slot ${slot}, `
        + `but the table has ${largeCount} entries`,
      );
    }
    const big = dv.getBigUint64(largeAt + slot * 8);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      // 9 petabytes. Refused rather than silently rounded — a JS number would lose bits.
      throw new Error(`readPackIndex: 64-bit offset ${big} exceeds Number.MAX_SAFE_INTEGER`);
    }
    return Number(big);
  };

  // Monotone oids are a format requirement *and* the precondition for binary search.
  // Checking them once here is what makes every later lookup trustworthy.
  for (let i = 1; i < count; i++) {
    if (!(oidAt(i - 1) < oidAt(i))) {
      throw new Error(`readPackIndex: oids are not in ascending order at position ${i} (${oidAt(i - 1)} then ${oidAt(i)})`);
    }
  }

  /** @param {OID} oid @returns {number} index, or -1 */
  const indexOf = (oid) => {
    assertOidHex(oid);
    const first = Number.parseInt(oid.slice(0, 2), 16);
    let lo = first === 0 ? 0 : dv.getUint32(fanoutAt + (first - 1) * 4);
    let hi = dv.getUint32(fanoutAt + first * 4);
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const there = oidAt(mid);
      if (there === oid) return mid;
      if (there < oid) lo = mid + 1; else hi = mid;
    }
    return -1;
  };

  return {
    count: () => count,
    indexOf,
    oidAt,
    offsetAt,
    crc32At,
    largeOffsetCount: () => largeCount,
    lookup(oid) {
      const i = indexOf(oid);
      return i < 0 ? null : { offset: offsetAt(i), crc32: crc32At(i) };
    },
    oids() {
      const out = new Array(count);
      for (let i = 0; i < count; i++) out[i] = oidAt(i);
      return out;
    },
    packChecksum: () => hex(idxBytes.subarray(idxBytes.length - 40, idxBytes.length - 20)),
    indexChecksum: () => hex(idxBytes.subarray(idxBytes.length - 20)),
  };
}
