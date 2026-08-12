#!/usr/bin/env node
// relay.mjs — the €3/month postal transit station from Appendix X, day 3.
//
//   "otherwise over a small relay (community server or Hetzner peer for €3/month). The relay sees
//    nothing, decides nothing, stores nothing — it only forwards encrypted bytes, replaceable like
//    any postal transit station."
//
// That sentence is a specification, and this file is written to be *checkable against it*:
//
//   SEES NOTHING     Every byte it forwards is an AES-GCM frame under a key derived from a secret
//                    that reached the two peers through a QR code (runtime/sync/introduce.js). This
//                    file never parses a forwarded payload — there is no `JSON.parse` of one, no
//                    decode, no inspection. It reads one thing from the request: the mailbox id,
//                    which is HKDF output over that same secret and therefore links to no public
//                    key, no company and no repo.
//   DECIDES NOTHING  It has no verbs. A client cannot ask it for anything: text frames from a
//                    client are a protocol error and get the connection closed. Its whole
//                    behaviour is "if the other occupant of this mailbox is connected, pass this
//                    frame on".
//   STORES NOTHING   No filesystem access of any kind — there is no `node:fs` import in this file.
//                    A mailbox exists only while a socket is open and is deleted the moment the
//                    last one closes. Payload bytes are never logged; the log line for a
//                    connection is a mailbox id, and `--quiet` removes even that.
//
// WHAT IT CAN STILL LEARN, so that nobody has to discover it: mailbox ids, source IP addresses
// (TCP gives it those), connection times, and byte counts. "These two endpoints exchanged N bytes"
// — which is what the CTO's brief allows, and no more. Correlating an IP with a person is outside
// what any relay can avoid; the mitigation is a VPN or Tor, and it is named in docs/COMPROMISES.md
// rather than pretended away.
//
// Zero dependencies: `node:http`, `node:crypto` for the handshake digest, and the protocol
// constants imported from runtime/sync/signalling.js so the two halves cannot drift apart. The
// WebSocket framing is RFC 6455 §5, written out, because taking a dependency for it would cost
// more than it saves (CONTRACT #1).
//
//   node relay.mjs [--port 8787] [--host 127.0.0.1] [--quiet]

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  mailboxFromPath, MAILBOX_CAPACITY, CONTROL, CLOSE,
} from './runtime/sync/signalling.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

/** A frame larger than this is refused. A sealed op batch or pack chunk is far below it. */
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------------------
// RFC 6455, the parts a relay needs
// ---------------------------------------------------------------------------------------

/** @param {string} key the client's Sec-WebSocket-Key */
function acceptKey(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

/**
 * Encode one server frame. Server frames are never masked (§5.1).
 *
 * `fin` is a parameter rather than always 1 because a fragmented message must be forwarded as the
 * same fragments it arrived in. Reassembling would mean the relay holding a partial message — and
 * a relay that accumulates is a relay that stores.
 *
 * @param {number} opcode @param {Uint8Array} payload @param {boolean} [fin]
 */
function encodeFrame(opcode, payload, fin = true) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  return Buffer.concat([header, Buffer.from(payload)]);
}

/**
 * A streaming frame parser. Returns complete frames and keeps the remainder.
 * Every malformed case is an error the caller closes on, never a guess.
 * @param {Buffer} buffer
 * @returns {{frames: {opcode:number, fin:boolean, payload:Buffer}[], rest: Buffer, error?: string}}
 */
function parseFrames(buffer) {
  const frames = [];
  let at = 0;
  for (;;) {
    if (buffer.length - at < 2) break;
    const b0 = buffer[at];
    const b1 = buffer[at + 1];
    const fin = (b0 & 0x80) !== 0;
    if ((b0 & 0x70) !== 0) return { frames, rest: buffer.subarray(at), error: 'reserved bits set' };
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    // §5.1: "a client MUST mask all frames". An unmasked client frame is a protocol error.
    if (!masked) return { frames, rest: buffer.subarray(at), error: 'client frame is not masked' };
    let len = b1 & 0x7f;
    let cursor = at + 2;
    if (len === 126) {
      if (buffer.length - cursor < 2) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (buffer.length - cursor < 8) break;
      const high = buffer.readUInt32BE(cursor);
      const low = buffer.readUInt32BE(cursor + 4);
      if (high !== 0) return { frames, rest: buffer.subarray(at), error: 'frame over 4 GiB' };
      len = low;
      cursor += 8;
    }
    if (len > MAX_FRAME_BYTES) {
      return { frames, rest: buffer.subarray(at), error: `frame of ${len} bytes exceeds the limit` };
    }
    if (buffer.length - cursor < 4) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    if (buffer.length - cursor < len) break;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = buffer[cursor + i] ^ mask[i & 3];
    cursor += len;
    frames.push({ opcode, fin, payload });
    at = cursor;
  }
  return { frames, rest: buffer.subarray(at) };
}

// ---------------------------------------------------------------------------------------
// The relay
// ---------------------------------------------------------------------------------------

/**
 * @param {{ port?: number, host?: string, quiet?: boolean,
 *           log?: (line: string) => void }} [opts]
 * @returns {{ listen(): Promise<{port:number, host:string}>, close(): Promise<void>,
 *             stats(): {mailboxes:number, sockets:number, framesForwarded:number, bytesForwarded:number},
 *             server: import('node:http').Server }}
 */
export function relay(opts = {}) {
  const quiet = opts.quiet === true;
  const log = opts.log ?? ((line) => { if (!quiet) process.stdout.write(`${line}\n`); });

  /** mailbox id -> the sockets in it. Memory only; gone when the last socket closes. */
  /** @type {Map<string, Set<any>>} */
  const mailboxes = new Map();
  /**
   * Every upgraded socket, so that `close()` can actually terminate.
   *
   * Not a second copy of the routing table — routing is `mailboxes` and only `mailboxes`. This is
   * the shutdown list, and it exists because `http.Server#close()` waits for connections it can no
   * longer see: once a socket has been upgraded it is detached from the server, so a relay that
   * only walked `mailboxes` left the process hanging for ever after the last peer had left. Found by
   * test/sync-relay.test.js, which could not shut a relay down.
   */
  /** @type {Set<any>} */
  const liveSockets = new Set();
  const counters = { framesForwarded: 0, bytesForwarded: 0, sockets: 0 };

  const server = createServer((req, res) => {
    // The relay is not a web server. It answers one thing, for a human checking it is alive.
    if (req.url === '/' || req.url === '/health') {
      const body = JSON.stringify({
        service: 'neodonkey-relay',
        mailboxes: mailboxes.size,
        sockets: counters.sockets,
        stores: 'nothing',
      });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  });

  server.on('upgrade', (req, socket) => {
    // Tracked from the first byte, including the paths that refuse the connection below: an upgraded
    // socket is detached from the http server, so anything not in this set is a socket `close()`
    // cannot reach and a process that will not exit.
    liveSockets.add(socket);
    socket.on('close', () => liveSockets.delete(socket));
    const mailbox = mailboxFromPath(req.url ?? '');
    const key = req.headers['sec-websocket-key'];
    const version = req.headers['sec-websocket-version'];
    if (mailbox === null) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket'
      || typeof key !== 'string' || key === '' || String(version) !== '13') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }

    let box = mailboxes.get(mailbox);
    if (box === undefined) { box = new Set(); mailboxes.set(mailbox, box); }

    socket.setNoDelay(true);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );

    /** @type {{socket: any, buffer: Buffer, mailbox: string, closed: boolean}} */
    const peer = { socket, buffer: Buffer.alloc(0), mailbox, closed: false };

    const send = (opcode, payload) => {
      if (peer.closed || socket.destroyed) return;
      socket.write(encodeFrame(opcode, payload));
    };
    const control = (verb) => send(OPCODE.text, Buffer.from(JSON.stringify({ t: verb })));
    const shut = (code, why) => {
      if (peer.closed) return;
      peer.closed = true;
      const payload = Buffer.alloc(2 + Buffer.byteLength(why ?? ''));
      payload.writeUInt16BE(code, 0);
      if (why) payload.write(why, 2);
      try { socket.write(encodeFrame(OPCODE.close, payload)); } catch { /* peer already gone */ }
      socket.end();
    };

    if (box.size >= MAILBOX_CAPACITY) {
      // Refused, by name, rather than quietly making a three-way conference out of a pair.
      control(CONTROL.full);
      shut(CLOSE.mailboxFull, 'mailbox full');
      log(`refused ${mailbox.slice(0, 8)}… — already ${box.size} peers`);
      return;
    }

    box.add(peer);
    counters.sockets += 1;
    log(`join ${mailbox.slice(0, 8)}… (${box.size}/${MAILBOX_CAPACITY})`);

    if (box.size === MAILBOX_CAPACITY) {
      // Both are here: tell each of them, once. This is the only thing the relay ever decides,
      // and it decides it by counting to two.
      for (const p of box) {
        if (p.closed) continue;
        p.socket.write(encodeFrame(OPCODE.text, Buffer.from(JSON.stringify({ t: CONTROL.ready }))));
      }
    }

    const leave = () => {
      if (!box.has(peer)) return;
      box.delete(peer);
      counters.sockets -= 1;
      peer.closed = true;
      for (const other of box) {
        if (other.closed) continue;
        other.socket.write(encodeFrame(OPCODE.text, Buffer.from(JSON.stringify({ t: CONTROL.gone }))));
      }
      if (box.size === 0) mailboxes.delete(mailbox);
      log(`leave ${mailbox.slice(0, 8)}… (${box.size}/${MAILBOX_CAPACITY})`);
    };

    socket.on('data', (chunk) => {
      peer.buffer = peer.buffer.length === 0 ? chunk : Buffer.concat([peer.buffer, chunk]);
      const { frames, rest, error } = parseFrames(peer.buffer);
      peer.buffer = rest;
      if (error) { shut(CLOSE.policyViolation, error); leave(); return; }
      for (const frame of frames) {
        if (frame.opcode === OPCODE.close) { shut(CLOSE.normal, ''); leave(); return; }
        if (frame.opcode === OPCODE.ping) { send(OPCODE.pong, frame.payload); continue; }
        if (frame.opcode === OPCODE.pong) continue;
        if (frame.opcode === OPCODE.text) {
          // The relay has no client-callable verbs. This is what "decides nothing" looks like
          // when written as code rather than as a promise.
          shut(CLOSE.unsupportedData, 'this relay accepts binary frames only');
          leave();
          return;
        }
        if (frame.opcode !== OPCODE.binary && frame.opcode !== OPCODE.continuation) {
          shut(CLOSE.policyViolation, `unknown opcode ${frame.opcode}`);
          leave();
          return;
        }
        // Forwarded verbatim, opcode and all, to whoever else is in this mailbox. The bytes are
        // not read, not copied into any structure that outlives the call, and not logged.
        counters.framesForwarded += 1;
        counters.bytesForwarded += frame.payload.length;
        const out = encodeFrame(frame.opcode, frame.payload, frame.fin);
        for (const other of box) {
          if (other === peer || other.closed || other.socket.destroyed) continue;
          other.socket.write(out);
        }
      }
    });
    socket.on('error', leave);
    socket.on('close', leave);
    socket.on('end', leave);
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1', () => {
          const addr = /** @type {any} */ (server.address());
          resolve({ port: addr.port, host: addr.address });
        });
      });
    },
    close() {
      for (const socket of liveSockets) { try { socket.destroy(); } catch { /* gone */ } }
      liveSockets.clear();
      mailboxes.clear();
      // `closeAllConnections()` covers plain HTTP requests still in flight (the health endpoint);
      // the loop above covers the upgraded ones, which the server no longer tracks.
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
    stats: () => ({
      mailboxes: mailboxes.size,
      sockets: counters.sockets,
      framesForwarded: counters.framesForwarded,
      bytesForwarded: counters.bytesForwarded,
    }),
  };
}

// ---------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------

/** @param {string[]} argv */
export function parseArgs(argv) {
  const out = { port: 8787, host: '127.0.0.1', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quiet') { out.quiet = true; continue; }
    if (arg === '--port') { out.port = Number(argv[++i]); continue; }
    if (arg === '--host') { out.host = String(argv[++i]); continue; }
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    // Principle 6: an unknown argument is refused, never ignored.
    throw new Error(`relay: unknown argument ${JSON.stringify(arg)} (try --help)`);
  }
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) {
    throw new Error(`relay: --port must be 0..65535, got ${out.port}`);
  }
  return out;
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'node relay.mjs [--port 8787] [--host 127.0.0.1] [--quiet]\n\n'
      + 'A NeoDonkey sync relay. It forwards sealed bytes between two peers that already know\n'
      + "each other's public keys, and it cannot read them. It stores nothing and has no verbs.\n",
    );
  } else {
    const r = relay(args);
    const where = await r.listen();
    process.stdout.write(`neodonkey relay on ws://${where.host}:${where.port}${''}\n`);
    process.on('SIGINT', () => { r.close().then(() => process.exit(0)); });
    process.on('SIGTERM', () => { r.close().then(() => process.exit(0)); });
  }
}
