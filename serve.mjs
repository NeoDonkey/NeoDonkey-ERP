#!/usr/bin/env node
/**
 * serve.mjs — self-host NeoDonkey, or develop it locally.
 *
 *   node serve.mjs            # http://127.0.0.1:8080
 *   node serve.mjs 3000       # another port
 *
 * NeoDonkey ships as a PWA, so the runtime is delivered from an origin. This file is the
 * smallest possible origin: about a hundred lines of `node:http` that reads files and has no
 * opinion about anything. It exists so that "you can host this yourself" is a thing you can do
 * in one command rather than a claim — which is the whole argument that neodonkey.eu is a
 * convenience and not an authority (Principle 9, docs/_compromise-ui.md).
 *
 * Two things it gets right that a one-line static server usually does not, and both are fatal:
 *   • `.js` must be `text/javascript` or the browser refuses every module;
 *   • `.webmanifest` must be `application/manifest+json` or the app is silently not installable.
 *
 * It also answers the question `file://` cannot: `http://127.0.0.1` is a secure context by
 * definition (W3C secure-contexts, "potentially trustworthy origin"), so OPFS, the directory
 * picker, service workers and persistent storage all work. Measured: from `file://`, Chrome and
 * Safari both refuse the module graph outright. See docs/_compromise-ui.md.
 *
 * Zero dependencies, no build step. Bound to 127.0.0.1: not a server on a network, a loopback
 * file reader.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const HOST = '127.0.0.1';

/**
 * Getting `.js` right is the whole job: a browser refuses a module served as
 * application/octet-stream, and that failure looks exactly like a bug in our code.
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // A manifest served as anything else is ignored, and the app silently stops being installable.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Resolve a URL path inside ROOT, or null if it must be refused.
 *
 * `..` is rejected outright rather than normalised away. Collapsing it would be *safe* — an
 * absolute path cannot climb above `/` — but it would answer a different request than the one
 * that was made, silently. `GET /%2e%2e/%2e%2e/package.json` would return `package.json` with a
 * 200, which is exactly the kind of "helpfully wrong" behaviour that makes a server hard to
 * reason about. Refusing is clearer, and it is one line.
 */
function resolveInRoot(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; } // malformed %-escape
  if (decoded.includes('\0')) return null;
  if (decoded.split(/[/\\]/).includes('..')) return null;
  const full = join(ROOT, normalize(decoded));
  // Defence in depth: whatever normalize() did, the result has to be inside ROOT.
  if (full !== ROOT.slice(0, -1) && !full.startsWith(ROOT)) return null;
  return full;
}

/** Recursively list `*.md` under a directory, repo-relative and sorted. */
async function listMarkdown(dir, prefix, out) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) await listMarkdown(join(dir, e.name), `${prefix}${e.name}/`, out);
    else if (e.name.endsWith('.md')) out.push(prefix + e.name);
  }
  return out;
}

const send = (res, status, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'only GET\n');

  // HTTP has no directory listing, and the browser needs to know which operating-model
  // files exist before it can seed a workspace. This is that one missing primitive.
  if (url.pathname === '/_files') {
    const under = (url.searchParams.get('under') ?? 'operating-model').replace(/^\/+|\/+$/g, '');
    // Reject '..' outright rather than relying on normalisation to swallow it. `normalize()`
    // turns '../../..' into '/', which is *safe* (it cannot leave the repo) but would quietly
    // list the whole repository instead of the folder that was asked for — and a listing that
    // silently answers a different question than the one asked is its own kind of bug.
    if (under === '' || under.split('/').includes('..')) {
      return send(res, 403, 'the "under" parameter must be a path inside the repo, with no ".."\n');
    }
    const dir = resolveInRoot('/' + under);
    if (!dir) return send(res, 403, 'outside the repo\n');
    const files = (await listMarkdown(dir, '', [])).map((f) => `${under}/${f}`);
    return send(res, 200, JSON.stringify({ root: under, files }, null, 2) + '\n', MIME['.json']);
  }

  const path = resolveInRoot(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!path) return send(res, 403, 'outside the repo\n');

  let info;
  try { info = await stat(path); } catch { return send(res, 404, `not found: ${url.pathname}\n`); }
  if (info.isDirectory()) return send(res, 404, `is a directory: ${url.pathname}\n`);

  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': info.size,
    // The repo is the deployment (Appendix II): a `git pull` must be visible on reload.
    'cache-control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `NeoDonkey UI  http://${HOST}:${PORT}\n` +
    `  serving      ${ROOT}\n` +
    `  secure context: yes (http://127.0.0.1 is trustworthy by definition)\n` +
    `  stop with Ctrl-C\n`,
  );
});
