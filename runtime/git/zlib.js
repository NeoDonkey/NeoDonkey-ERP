// runtime/git/zlib.js — zlib streams, via the browser standard.
//
// Git loose objects are zlib-wrapped (RFC 1950: 2-byte header + deflate + Adler-32).
// `CompressionStream('deflate')` is exactly that framing — 'deflate-raw' is not.
// Available in Node 18+ and every current browser engine. No dependency (Principle 3).

/** @typedef {Uint8Array} Bytes */

/**
 * @param {ReadableStream<Uint8Array>} readable
 * @returns {Promise<Bytes>}
 */
async function drain(readable) {
  const reader = readable.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * @param {ReadableWritablePair<Uint8Array, Uint8Array>} transform
 * @param {Bytes} bytes
 * @returns {Promise<Bytes>}
 */
function pump(transform, bytes) {
  const writer = transform.writable.getWriter();
  // Fire-and-forget on purpose: errors surface through the readable side,
  // which `drain` awaits. Attach a no-op catch so Node does not warn.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return drain(transform.readable);
}

/** zlib-compress, the way git writes loose objects. @param {Bytes} bytes @returns {Promise<Bytes>} */
export function deflate(bytes) {
  return pump(new CompressionStream('deflate'), bytes);
}

/** zlib-decompress. @param {Bytes} bytes @returns {Promise<Bytes>} */
export function inflate(bytes) {
  return pump(new DecompressionStream('deflate'), bytes);
}
