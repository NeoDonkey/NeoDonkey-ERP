// runtime/git/index-file.js — the .git/index (DIRC) writer and reader.
//
// This file is the whole difference between "we wrote git objects" and Appendix X's
// "It is simply a folder. With her company inside." Without a byte-correct index,
// Sarah cd's into her repo, types `git status`, and git tells her that every single
// file in her company has been deleted. With it, git says: clean.
//
// Format (version 2, the only one we write):
//
//   "DIRC" | u32 version | u32 entryCount
//   entry* :  u32 ctime.sec  u32 ctime.nsec
//             u32 mtime.sec  u32 mtime.nsec
//             u32 dev        u32 ino
//             u32 mode                       (0100644 = 33188 for a regular file)
//             u32 uid        u32 gid
//             u32 size                       (MUST be right — see note below)
//             20 bytes oid
//             u16 flags   assume-valid<<15 | extended<<14 | stage<<12 | min(namelen,0xFFF)
//             namelen bytes name (path, '/' separated, relative to the work tree)
//             1..8 NUL bytes so the entry length is a multiple of 8
//   20 bytes SHA-1 over everything above
//
// Entries are sorted byte-wise on the full path.
//
// On the stat fields: git's ie_modified() short-circuits to DATA_CHANGED when the
// cached size differs from lstat's size, *without* comparing content. Every other stat
// field (ctime/mtime/dev/ino/uid/gid) only makes the entry "stat-dirty": git then
// re-hashes the file, finds the same oid, and reports clean. So `size`, `mode` and
// `oid` must be exact; the rest may be zero. Zero is what we choose, because it is
// deterministic and because a browser writing to OPFS has no dev, no ino, no uid and
// no gid to report. Verified against real git in test/a-git.test.js, not assumed.

import { sha1, unhex, hex } from './sha1.js';
import { concatBytes, assertOid } from './objects.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID */

/**
 * @typedef {object} IndexEntry
 * @property {string} path       work-tree relative, '/' separated
 * @property {OID} oid
 * @property {number} size       bytes; must match the file on disk
 * @property {number} [mode]     default 0o100644
 * @property {number} [ctimeSec] default 0
 * @property {number} [ctimeNsec] default 0
 * @property {number} [mtimeSec] default 0
 * @property {number} [mtimeNsec] default 0
 * @property {number} [dev]      default 0
 * @property {number} [ino]      default 0
 * @property {number} [uid]      default 0
 * @property {number} [gid]      default 0
 * @property {number} [stage]    default 0 (we never write conflict stages)
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const SIGNATURE = 0x44495243; // 'DIRC'
const ENTRY_FIXED = 62;

function cmpBytes(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * @param {IndexEntry[]} entries
 * @returns {Bytes}
 */
export function encodeIndex(entries) {
  const decorated = entries.map((e) => {
    if (typeof e.path !== 'string' || e.path === '') {
      throw new Error(`encodeIndex: bad path ${JSON.stringify(e.path)}`);
    }
    assertOid(e.oid);
    if (!Number.isInteger(e.size) || e.size < 0) {
      throw new Error(`encodeIndex: size must be a non-negative integer for ${e.path}, got ${e.size}`);
    }
    return { e, name: enc.encode(e.path) };
  });
  decorated.sort((a, b) => cmpBytes(a.name, b.name));
  for (let i = 1; i < decorated.length; i++) {
    if (cmpBytes(decorated[i - 1].name, decorated[i].name) === 0) {
      throw new Error(`encodeIndex: duplicate path ${decorated[i].e.path}`);
    }
  }

  const header = new Uint8Array(12);
  const hdv = new DataView(header.buffer);
  hdv.setUint32(0, SIGNATURE);
  hdv.setUint32(4, 2);
  hdv.setUint32(8, decorated.length);

  const parts = [header];
  for (const { e, name } of decorated) {
    const unpadded = ENTRY_FIXED + name.length;
    const pad = 8 - (unpadded % 8); // 1..8 — always at least one NUL terminator
    const buf = new Uint8Array(unpadded + pad);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, e.ctimeSec ?? 0);
    dv.setUint32(4, e.ctimeNsec ?? 0);
    dv.setUint32(8, e.mtimeSec ?? 0);
    dv.setUint32(12, e.mtimeNsec ?? 0);
    dv.setUint32(16, e.dev ?? 0);
    dv.setUint32(20, e.ino ?? 0);
    dv.setUint32(24, e.mode ?? 0o100644);
    dv.setUint32(28, e.uid ?? 0);
    dv.setUint32(32, e.gid ?? 0);
    dv.setUint32(36, e.size);
    buf.set(unhex(e.oid), 40);
    dv.setUint16(60, ((e.stage ?? 0) & 0x3) << 12 | Math.min(name.length, 0xfff));
    buf.set(name, ENTRY_FIXED);
    parts.push(buf);
  }

  const body = concatBytes(...parts);
  return concatBytes(body, sha1(body));
}

/**
 * Read an index back. Needed because checkout() must know which working-tree files it
 * wrote last time in order to delete the ones the new commit no longer contains — and
 * because a peer must be able to read a repo it did not write.
 *
 * Extensions after the entries (TREE, REUC, UNTR, …) are skipped, not misread.
 * @param {Bytes} bytes
 * @returns {{version:number, entries:Required<IndexEntry>[]}}
 */
export function decodeIndex(bytes) {
  if (bytes.length < 12 + 20) throw new Error('decodeIndex: too short to be an index');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== SIGNATURE) throw new Error('decodeIndex: missing DIRC signature');
  const version = dv.getUint32(4);
  if (version !== 2) {
    // Principle 6: refuse loudly rather than guess at a format we do not know.
    throw new Error(`decodeIndex: unsupported index version ${version} (v0.1 reads DIRC v2)`);
  }
  const body = bytes.subarray(0, bytes.length - 20);
  const want = hex(bytes.subarray(bytes.length - 20));
  const got = hex(sha1(body));
  if (want !== got) throw new Error(`decodeIndex: checksum mismatch (index says ${want}, content is ${got})`);

  const count = dv.getUint32(8);
  const entries = [];
  let at = 12;
  for (let i = 0; i < count; i++) {
    if (at + ENTRY_FIXED > body.length) throw new Error(`decodeIndex: truncated at entry ${i}`);
    const flags = dv.getUint16(at + 60);
    const declared = flags & 0xfff;
    let nameEnd;
    if (declared === 0xfff) {
      nameEnd = body.indexOf(0, at + ENTRY_FIXED);
      if (nameEnd < 0) throw new Error(`decodeIndex: unterminated long name at entry ${i}`);
    } else {
      nameEnd = at + ENTRY_FIXED + declared;
    }
    entries.push({
      ctimeSec: dv.getUint32(at + 0),
      ctimeNsec: dv.getUint32(at + 4),
      mtimeSec: dv.getUint32(at + 8),
      mtimeNsec: dv.getUint32(at + 12),
      dev: dv.getUint32(at + 16),
      ino: dv.getUint32(at + 20),
      mode: dv.getUint32(at + 24),
      uid: dv.getUint32(at + 28),
      gid: dv.getUint32(at + 32),
      size: dv.getUint32(at + 36),
      oid: hex(body.subarray(at + 40, at + 60)),
      stage: (flags >> 12) & 0x3,
      path: dec.decode(body.subarray(at + ENTRY_FIXED, nameEnd)),
    });
    const unpadded = nameEnd - at;
    at += unpadded + (8 - (unpadded % 8));
  }
  return { version, entries };
}
