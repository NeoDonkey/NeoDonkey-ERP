// runtime/git/objects.js — the Merkle-DAG layer.
//
// "Git is the database" (Appendix III), so this file is the database's page format.
// Everything here is pure except objectStore(), which is the only thing that touches
// an FsAdapter. No system clock is ever read: `time` and `tzOffsetMinutes` are
// injected parameters (non-negotiable #5), because "same foreign event -> same commit"
// (Appendix V) is only checkable if commit bytes are a function of the inputs alone.

import { sha1, hex, unhex } from './sha1.js';
import { deflate, inflate } from './zlib.js';

/** @typedef {Uint8Array} Bytes */
/** @typedef {string} OID */
/** @typedef {{ name: string, email: string }} Identity */
/** @typedef {import('./fs.js').FsAdapter} FsAdapter */

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Concatenate byte arrays. Exported because repo.js and index-file.js need it and
 * duplicating it three times would be worse. See CONTRACT amendment A-2.
 * @param {...Bytes} arrays
 * @returns {Bytes}
 */
export function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const a of arrays) { out.set(a, at); at += a.length; }
  return out;
}

/** Byte-wise comparison, the only ordering git knows. @returns {number} */
function cmpBytes(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

const OBJECT_TYPES = new Set(['blob', 'tree', 'commit', 'tag']);

/**
 * The loose-object store. `.git/objects/ab/cdef...`, zlib-wrapped,
 * `"<type> <length>\0<content>"` hashed with SHA-1. Twenty years of hardened
 * Merkle-DAG, reimplemented in forty lines.
 *
 * `opts.packs` (added for FD-2, additive — `objectStore(fs)` behaves exactly as before)
 * is a read-through to packed storage: `{ has(oid), read(oid) -> object|null }`, supplied
 * by runtime/git/store.js. Writes always stay loose; packing is a separate, verified step.
 * The dependency points this way on purpose — objects.js must not know about packfiles, so
 * store.js hands its reader *in*.
 *
 * @param {FsAdapter} fs
 * @param {{packs?: {has(oid:OID):Promise<boolean>, read(oid:OID):Promise<{type:string,content:Bytes}|null>}}} [opts]
 */
export function objectStore(fs, opts = {}) {
  const pathFor = (oid) => `.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  const packs = opts.packs ?? null;

  return {
    /**
     * @param {'blob'|'tree'|'commit'|'tag'} type
     * @param {Bytes} content
     * @returns {Promise<OID>}
     */
    async write(type, content) {
      if (!OBJECT_TYPES.has(type)) throw new Error(`objectStore.write: unknown type ${type}`);
      const full = concatBytes(enc.encode(`${type} ${content.length}\0`), content);
      const oid = hex(sha1(full));
      // Loose objects are content-addressed and therefore immutable: if it is already
      // there, the bytes are by definition identical. Skipping the write keeps
      // re-commits of unchanged documents cheap.
      const existing = await fs.read(pathFor(oid));
      // An object already in a pack must not be written loose again: that would undo a
      // repack one object at a time and, worse, leave two copies whose only guarantee of
      // agreement is the hash we just computed.
      if (!existing && !(packs && await packs.has(oid))) {
        await fs.write(pathFor(oid), await deflate(full));
      }
      return oid;
    },

    /** @param {OID} oid @returns {Promise<{type:string, content:Bytes}>} */
    async read(oid) {
      assertOid(oid);
      const z = await fs.read(pathFor(oid));
      if (!z) {
        if (packs) {
          const packed = await packs.read(oid);
          if (packed) return packed;
        }
        throw new Error(`objectStore.read: object not found: ${oid}`);
      }
      const full = await inflate(z);
      const nul = full.indexOf(0);
      if (nul < 0) throw new Error(`objectStore.read: malformed object header: ${oid}`);
      const header = dec.decode(full.subarray(0, nul));
      const sp = header.indexOf(' ');
      if (sp < 0) throw new Error(`objectStore.read: malformed object header: ${oid}`);
      const type = header.slice(0, sp);
      const size = Number(header.slice(sp + 1));
      const content = full.subarray(nul + 1);
      if (content.length !== size) {
        throw new Error(`objectStore.read: length mismatch for ${oid}: header ${size}, body ${content.length}`);
      }
      return { type, content };
    },

    /** @param {OID} oid @returns {Promise<boolean>} */
    async has(oid) {
      assertOid(oid);
      if ((await fs.read(pathFor(oid))) !== null) return true;
      return packs ? packs.has(oid) : false;
    },
  };
}

/** @param {unknown} oid */
export function assertOid(oid) {
  if (typeof oid !== 'string' || !/^[0-9a-f]{40}$/.test(oid)) {
    throw new Error(`not a git object id: ${String(oid)}`);
  }
}

// ---------------------------------------------------------------------------
// trees
// ---------------------------------------------------------------------------

/**
 * Git sorts tree entries byte-wise on the name — but compares a directory as if its
 * name ended in '/'. (That falls out of git sorting *index* paths: "foo.txt" vs
 * "foo/bar" compares '.' 0x2e against '/' 0x2f, so the file wins.) Get this wrong and
 * `git fsck` reports "contains unsorted entries".
 * @param {{mode:string, name:string}} e
 */
function sortKey(e) {
  return enc.encode(e.mode === '40000' ? `${e.name}/` : e.name);
}

/**
 * @param {{mode:'100644'|'40000', name:string, oid:OID}[]} entries
 * @returns {Bytes}
 */
export function encodeTree(entries) {
  const decorated = entries.map((e) => {
    if (e.mode !== '100644' && e.mode !== '40000') {
      // Principle 6, read strictly: an unknown construction is refused, never guessed.
      throw new Error(`encodeTree: unsupported mode ${e.mode} for ${e.name} (v0.1 knows 100644 and 40000)`);
    }
    if (e.name === '' || e.name.includes('/') || e.name === '.' || e.name === '..') {
      throw new Error(`encodeTree: illegal entry name ${JSON.stringify(e.name)}`);
    }
    assertOid(e.oid);
    return { e, key: sortKey(e) };
  });
  decorated.sort((a, b) => cmpBytes(a.key, b.key));
  for (let i = 1; i < decorated.length; i++) {
    if (cmpBytes(decorated[i - 1].key, decorated[i].key) === 0) {
      throw new Error(`encodeTree: duplicate entry ${decorated[i].e.name}`);
    }
  }
  return concatBytes(
    ...decorated.map(({ e }) => concatBytes(enc.encode(`${e.mode} ${e.name}\0`), unhex(e.oid))),
  );
}

/**
 * @param {Bytes} bytes
 * @returns {{mode:string, name:string, oid:OID}[]}
 */
export function decodeTree(bytes) {
  const out = [];
  let at = 0;
  while (at < bytes.length) {
    const sp = bytes.indexOf(0x20, at);
    if (sp < 0) throw new Error('decodeTree: truncated entry (no mode separator)');
    const nul = bytes.indexOf(0, sp);
    if (nul < 0) throw new Error('decodeTree: truncated entry (no name terminator)');
    if (nul + 21 > bytes.length) throw new Error('decodeTree: truncated entry (no oid)');
    out.push({
      mode: dec.decode(bytes.subarray(at, sp)),
      name: dec.decode(bytes.subarray(sp + 1, nul)),
      oid: hex(bytes.subarray(nul + 1, nul + 21)),
    });
    at = nul + 21;
  }
  return out;
}

// ---------------------------------------------------------------------------
// commits
// ---------------------------------------------------------------------------

/** @param {number} minutes @returns {string} e.g. 120 -> "+0200" */
export function formatTz(minutes) {
  if (!Number.isInteger(minutes)) throw new Error(`tzOffsetMinutes must be an integer, got ${minutes}`);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

/** @param {string} tz @returns {number} */
export function parseTz(tz) {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(tz);
  if (!m) throw new Error(`parseTz: not a git timezone offset: ${tz}`);
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -minutes : minutes;
}

/** @param {Identity} id */
function identityLine(id, time, tzOffsetMinutes) {
  if (!id || typeof id.name !== 'string' || typeof id.email !== 'string') {
    throw new Error('identity must be { name, email }');
  }
  if (!Number.isInteger(time)) throw new Error(`time must be integer seconds, got ${time}`);
  // git's own restriction; enforce it rather than emit an unparseable commit.
  if (/[<>\n]/.test(id.name) || /[<>\n]/.test(id.email)) {
    throw new Error(`identity may not contain '<', '>' or newline: ${id.name} <${id.email}>`);
  }
  return `${id.name} <${id.email}> ${time} ${formatTz(tzOffsetMinutes)}`;
}

/** @returns {{identity:Identity, time:number, tzOffsetMinutes:number}} */
function parseIdentityLine(line) {
  const m = /^(.*?) <([^>]*)> (\d+) ([+-]\d{4})$/.exec(line);
  if (!m) throw new Error(`decodeCommit: unparseable identity line: ${JSON.stringify(line)}`);
  return {
    identity: { name: m[1], email: m[2] },
    time: Number(m[3]),
    tzOffsetMinutes: parseTz(m[4]),
  };
}

/**
 * @param {{tree:OID, parents:OID[], author:Identity, committer?:Identity, time:number,
 *          tzOffsetMinutes:number, message:string, signature?:string|null}} c
 * @returns {Bytes}
 */
export function encodeCommit(c) {
  assertOid(c.tree);
  const parents = c.parents ?? [];
  for (const p of parents) assertOid(p);
  const who = identityLine(c.author, c.time, c.tzOffsetMinutes);
  const committer = identityLine(c.committer ?? c.author, c.time, c.tzOffsetMinutes);
  if (typeof c.message !== 'string') throw new Error('encodeCommit: message must be a string');

  let head = `tree ${c.tree}\n`;
  for (const p of parents) head += `parent ${p}\n`;
  head += `author ${who}\n`;
  head += `committer ${committer}\n`;
  if (c.signature != null) {
    if (c.signature === '') throw new Error('encodeCommit: signature must be non-empty or null');
    // Multi-line header value: continuation lines are indented by exactly one space.
    head += `gpgsig ${c.signature.split('\n').join('\n ')}\n`;
  }
  return enc.encode(`${head}\n${c.message}`);
}

/**
 * The exact bytes that were signed: the commit object content with the `gpgsig` header
 * and its continuation lines removed, and *nothing else* altered — same header order,
 * same trailing newline placement.
 *
 * This is deliberately a byte surgery on the original object rather than
 * `encodeCommit(decodeCommit(x))`. Re-encoding would be a second opinion about
 * whitespace and header order; verification must have no opinions. A peer with no git
 * and no ssh binary present has to be able to detect a forged signature
 * (Appendix XI), and it can only do that against the original bytes.
 *
 * @param {Bytes} bytes commit object content (no "commit <len>\0" header)
 * @returns {Bytes}
 */
export function commitPayload(bytes) {
  // Locate the blank line that ends the header block.
  let split = -1;
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x0a && bytes[i + 1] === 0x0a) { split = i; break; }
  }
  if (split < 0) throw new Error('commitPayload: commit has no header/message separator');

  /** @type {Bytes[]} */
  const kept = [];
  let dropping = false;
  let at = 0;
  while (at <= split) {
    let eol = at;
    while (eol < split && bytes[eol] !== 0x0a) eol++;
    const line = bytes.subarray(at, eol);
    const isContinuation = line.length > 0 && line[0] === 0x20;
    if (isContinuation) {
      if (!dropping) kept.push(bytes.subarray(at, eol + 1));
    } else {
      dropping = startsWithAscii(line, 'gpgsig ') || asciiEquals(line, 'gpgsig');
      if (!dropping) kept.push(bytes.subarray(at, eol + 1));
    }
    at = eol + 1;
  }
  // `bytes.subarray(split)` is "\n" + "\n" + message; the kept lines already carry
  // their own terminating "\n", so take from split + 1 to get the blank line + message.
  return concatBytes(...kept, bytes.subarray(split + 1));
}

function startsWithAscii(line, prefix) {
  if (line.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (line[i] !== prefix.charCodeAt(i)) return false;
  return true;
}

function asciiEquals(line, s) {
  return line.length === s.length && startsWithAscii(line, s);
}

/**
 * The inverse. A peer must be able to read a repo it did not write (Appendix X):
 * an unknown header is surfaced in `extra`, never silently dropped (Principle 6).
 * @param {Bytes} bytes
 * @returns {{tree:OID, parents:OID[], author:Identity, committer:Identity, time:number,
 *           tzOffsetMinutes:number, message:string, signature:string|null,
 *           extra:{key:string, value:string}[]}}
 */
export function decodeCommit(bytes) {
  const text = dec.decode(bytes);
  const split = text.indexOf('\n\n');
  const headerText = split < 0 ? text : text.slice(0, split);
  const message = split < 0 ? '' : text.slice(split + 2);

  /** @type {{key:string, value:string}[]} */
  const headers = [];
  for (const line of headerText.split('\n')) {
    if (line.startsWith(' ') && headers.length > 0) {
      // De-indent the continuation: strip exactly one leading space.
      headers[headers.length - 1].value += `\n${line.slice(1)}`;
      continue;
    }
    const sp = line.indexOf(' ');
    if (sp < 0) {
      if (line === '') continue;
      throw new Error(`decodeCommit: unparseable header line: ${JSON.stringify(line)}`);
    }
    headers.push({ key: line.slice(0, sp), value: line.slice(sp + 1) });
  }

  let tree = null;
  const parents = [];
  let author = null;
  let committer = null;
  let signature = null;
  const extra = [];
  for (const { key, value } of headers) {
    switch (key) {
      case 'tree': tree = value; break;
      case 'parent': parents.push(value); break;
      case 'author': author = parseIdentityLine(value); break;
      case 'committer': committer = parseIdentityLine(value); break;
      case 'gpgsig': signature = value; break;
      default: extra.push({ key, value });
    }
  }
  if (!tree) throw new Error('decodeCommit: commit has no tree header');
  if (!author) throw new Error('decodeCommit: commit has no author header');
  assertOid(tree);
  for (const p of parents) assertOid(p);

  return {
    tree,
    parents,
    author: author.identity,
    committer: (committer ?? author).identity,
    time: author.time,
    tzOffsetMinutes: author.tzOffsetMinutes,
    message,
    signature,
    extra,
  };
}
