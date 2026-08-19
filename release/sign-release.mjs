#!/usr/bin/env node
/**
 * release/sign-release.mjs — cut a signed NeoDonkey release.
 *
 *   node release/sign-release.mjs --generate release/dev-release-key.jwk
 *   node release/sign-release.mjs --key release/dev-release-key.jwk --version 0.1.0
 *   node release/sign-release.mjs --check release.json --pubkey 'ssh-ed25519 AAAA…'
 *
 * It walks the runtime, hashes every file with SHA-256, and writes `release.json`: the file list
 * plus an SSHSIG signature over a canonical serialisation of it (see runtime/release/manifest.js
 * for the canonical form and the namespace argument — this file imports that module rather than
 * re-implementing it, because two implementations of a canonical form is one too many).
 *
 * This is the ONE file in `release/` that may touch `node:*`: it is a build-time tool, run by a
 * human on a machine that holds the release private key, and it never ships to a browser. The
 * verifier it produces work for — `runtime/release/manifest.js` — has no `node:` import at all.
 *
 * Two things it refuses to do, both on purpose:
 *   • it will not sign a tree containing a file it cannot classify (see `classifyPath`), because
 *     a file that is neither shipped nor deliberately excluded is a file nobody decided about;
 *   • it will not report success without re-verifying its own output, and — when `ssh-keygen` is
 *     on the box — without a second opinion from OpenSSH. Our own code agreeing with itself is
 *     not evidence.
 */

import { readFile, writeFile, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import {
  exportPublicSsh, exportPrivateJwk, generateIdentity, importPrivateJwk,
} from '../runtime/identity/ed25519.js';
import { allowedSignersLine, signPayload } from '../runtime/identity/sshsig.js';
import {
  MANIFEST_SCHEMA, PRODUCT, RELEASE_NAMESPACE,
  canonicalManifestBytes, keyFingerprint, sha256Hex, validatePath, verifyRelease,
} from '../runtime/release/manifest.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_PRINCIPAL = 'release@neodonkey.eu';

// =============================================================================================
// what is in a release — rules, not a hardcoded list
// =============================================================================================
//
// A hardcoded array is the wrong shape for this. It drifts silently: a module added to the app
// and forgotten here would ship *unsigned*, and "unsigned" in this design means "not in the
// manifest" which means "an attacker's file can occupy that name". So the list is DERIVED by
// walking the filesystem, and every path the walk meets falls into exactly one of three buckets:
//
//   include   →  hashed into the manifest
//   exclude   →  named, with the rule that excluded it, so a human can audit the decision
//   ???       →  the tool ABORTS
//
// The third bucket is the important one. Deny-by-default is only safe if "denied" is loud; a
// silent skip is how a `.wasm` blob or a `runtime/ui/config.json` ends up outside the signature
// while still being fetched and executed. Adding a file of a new kind therefore forces someone
// to make an explicit decision here, in a diff, once.
//
// Note what *is* included and why:
//   • `service-worker.js` — the verifier itself. It cannot verify its own delivery (the browser
//     fetches it before any of our code runs; see docs/_compromise-release.md), but having its
//     hash inside the signed manifest means the currently-running trusted worker, an auditor, or
//     a second device can detect that it changed. Unverifiable-by-itself is not a reason to leave
//     it unsigned.
//   • `.css` and `.svg` — not "code", but a stylesheet can hide a button, move a total, or
//     restyle a confirmation dialog into something a user reads differently. For an ERP that is
//     an attack, not a cosmetic issue.
//   • `runtime/git/fs-node.js` — never shipped to a browser, but it is real code for Node peers.
//     The manifest describes the release; the Service Worker's precache list is a subset of it.

/** Directories that are never part of a release, with the reason each one is out. */
export const EXCLUDED_TREES = {
  '.git': 'version control metadata',
  '.claude': 'tooling',
  'node_modules': 'must not exist — zero dependencies (CONTRACT #1)',
  test: 'tests are not shipped',
  docs: 'documentation is not executed',
  demo: 'demo scripts run in Node, not in the app',
  mcp: 'MCP server runs in Node, not in the app',
  release: 'the release tooling is not part of the release',
  'operating-model': 'the company, not the runtime — data, versioned in the repo it belongs to',
  templates: 'content, not runtime',
  'demo-workspace': 'generated workspace',
  keys: 'private key material must never be hashed into a public manifest',
};

/** Root files that ARE the app shell. */
export const ROOT_SHELL = new Set(['index.html', 'manifest.webmanifest', 'service-worker.js']);

/** Root files deliberately not shipped. */
export const ROOT_EXCLUDED = {
  'package.json': 'metadata; not fetched by the app',
  'package-lock.json': 'metadata',
  'serve.mjs': 'a host-side tool, run by Node',
  // The signalling relay from Appendix X — run by whoever hosts it, never fetched by the app.
  // Appendix X is explicit that it "sees nothing, decides nothing, stores nothing", so it is not
  // part of the runtime a peer executes and does not belong in the manifest a peer verifies.
  'relay.mjs': 'a host-side tool, run by Node; the app never fetches it',
  'release.json': 'the manifest cannot contain its own hash',
  LICENSE: 'not executed',
  '.gitignore': 'version control metadata',

  // The double-click launchers. Excluded because the release manifest means "what the browser
  // fetches and executes", and these are run by the OS shell — the service worker enforces the
  // manifest by URL, so an entry for a file no browser ever requests would be noise in a table
  // whose whole value is that every entry means something.
  //
  // HONEST GAP, recorded in docs/COMPROMISES.md: that leaves them unsigned. Someone who tampers
  // with a downloaded copy of `Start NeoDonkey.command` gets arbitrary local code execution, and
  // the release signature will not catch it. It is not a *new* gap — the same is true of every
  // file in a downloaded archive, including `serve.mjs` above — and it does not touch the PWA
  // path, which is the shipping path and where no launcher exists. Closing it needs a detached
  // signature over the whole distribution, which is a packaging question, not a runtime one.
  'Start NeoDonkey.command': 'OS launcher, run by the shell and never fetched by the browser',
  'Start NeoDonkey.bat': 'OS launcher, run by the shell and never fetched by the browser',
  'start-neodonkey.sh': 'OS launcher, run by the shell and never fetched by the browser',
};

/** Extensions under `runtime/` that are part of the shipped runtime. */
export const RUNTIME_EXTENSIONS = ['.js', '.css', '.svg'];

/** Non-shipped files under `runtime/` that someone has looked at and signed off on. */
export const RUNTIME_ACKNOWLEDGED_EXCLUSIONS = {
  'runtime/polism/grammar.md': 'normative documentation, read by humans, not fetched by the app',
};

/**
 * Classify one repo-relative path. Total function, no filesystem access, hence trivially
 * testable — which is the point of writing the rules as a function instead of an array.
 * @param {string} rel repo-relative POSIX path
 * @returns {{ include: boolean, rule: string, why?: string }}
 *   `rule === 'unclassified'` means the caller must abort.
 */
export function classifyPath(rel) {
  if (typeof rel !== 'string' || rel === '') return { include: false, rule: 'unclassified' };
  const parts = rel.split('/');
  // Dotfiles never ship. `.DS_Store` is the everyday case; the rule is general.
  if (parts.some((p) => p.startsWith('.'))) return { include: false, rule: 'dotfile', why: 'hidden file' };

  const [head] = parts;
  if (parts.length > 1 && Object.prototype.hasOwnProperty.call(EXCLUDED_TREES, head)) {
    return { include: false, rule: `excluded-tree:${head}`, why: EXCLUDED_TREES[head] };
  }

  if (parts.length === 1) {
    if (ROOT_SHELL.has(rel)) return { include: true, rule: 'root-shell' };
    if (Object.prototype.hasOwnProperty.call(ROOT_EXCLUDED, rel)) {
      return { include: false, rule: 'root-excluded', why: ROOT_EXCLUDED[rel] };
    }
    if (rel.endsWith('.md')) return { include: false, rule: 'root-markdown', why: 'prose' };
    return { include: false, rule: 'unclassified' };
  }

  if (head === 'runtime') {
    if (Object.prototype.hasOwnProperty.call(RUNTIME_ACKNOWLEDGED_EXCLUSIONS, rel)) {
      return { include: false, rule: 'runtime-acknowledged-exclusion',
        why: RUNTIME_ACKNOWLEDGED_EXCLUSIONS[rel] };
    }
    const dot = rel.lastIndexOf('.');
    const ext = dot < 0 ? '' : rel.slice(dot);
    if (RUNTIME_EXTENSIONS.includes(ext)) return { include: true, rule: `runtime${ext}` };
    // A kind-level decision, made once, in a diff (which is what deny-by-default is for):
    // Markdown under runtime/ is normative documentation for humans — the rule grammar, the
    // money API — read by developers and auditors, never fetched or executed by the app. It is
    // excluded for the same reason `serve.mjs` is: the manifest means "what the browser runs".
    if (ext === '.md') {
      return { include: false, rule: 'runtime-markdown', why: 'normative prose, not fetched by the app' };
    }
    return { include: false, rule: 'unclassified' };
  }

  return { include: false, rule: 'unclassified' };
}

/** Recursively list repo-relative POSIX paths under `root`. */
async function walk(root, dir = root, out = []) {
  for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, e.name);
    const rel = relative(root, full).split(sep).join('/');
    if (e.isDirectory()) {
      const cls = classifyPath(`${rel}/x`);          // prune whole trees before descending
      if (cls.rule.startsWith('excluded-tree:') || cls.rule === 'dotfile') continue;
      await walk(root, full, out);
    } else if (e.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Hash every file that belongs in a release.
 * @param {string} root repository root
 * @returns {Promise<{files: {path:string,sha256:string,bytes:number}[],
 *                    excluded: {path:string,rule:string,why?:string}[], unclassified: string[]}>}
 */
export async function collectReleaseFiles(root) {
  const files = []; const excluded = []; const unclassified = [];
  for (const rel of await walk(root)) {
    const cls = classifyPath(rel);
    if (cls.rule === 'unclassified') { unclassified.push(rel); continue; }
    if (!cls.include) { excluded.push({ path: rel, rule: cls.rule, why: cls.why }); continue; }
    validatePath(rel);                                // a shipped path must be a legal manifest path
    const bytes = await readFile(join(root, rel));
    const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    files.push({ path: rel, sha256: await sha256Hex(data), bytes: data.length });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, excluded, unclassified };
}

// =============================================================================================
// building and signing
// =============================================================================================

/**
 * Sign a manifest. `signature` is the only field outside the signed region; everything else,
 * including the signer's own key line, is covered.
 * @param {{version: string, files: object[], key: string}} m
 * @param {object} keyPair
 */
export async function signManifest({ version, files, key }, keyPair) {
  const manifest = { schema: MANIFEST_SCHEMA, product: PRODUCT, version, key, files };
  const payload = canonicalManifestBytes(manifest);
  const signature = await signPayload(keyPair, payload, RELEASE_NAMESPACE);
  return { ...manifest, signature };
}

/**
 * Render release.json: one file per line, fields in reading order. The on-disk formatting is
 * free — the signature covers the canonical form, not this text — so it is optimised for the
 * human reading a diff, which is the only reason this file is not minified.
 */
export function renderManifestJson(m) {
  const q = (s) => JSON.stringify(s);
  const lines = m.files.map((f) => `    { "path": ${q(f.path)}, "sha256": ${q(f.sha256)}, "bytes": ${f.bytes} }`);
  return [
    '{',
    `  "schema": ${m.schema},`,
    `  "product": ${q(m.product)},`,
    `  "version": ${q(m.version)},`,
    `  "key": ${q(m.key)},`,
    '  "files": [',
    lines.join(',\n'),
    '  ],',
    `  "signature": ${q(m.signature)}`,
    '}',
    '',
  ].join('\n');
}

// =============================================================================================
// second opinion: OpenSSH verifies what we produced
// =============================================================================================

/**
 * Verify a manifest with the system `ssh-keygen -Y verify`. Foreign tooling is the judge — the
 * same standard the git layer holds itself to with `git fsck`. Returns `{available:false}` when
 * ssh-keygen is not installed rather than pretending to have checked.
 * @param {{manifestText: string, principal?: string}} o
 */
export async function verifyWithSshKeygen({ manifestText, principal = DEFAULT_PRINCIPAL }) {
  const m = JSON.parse(manifestText);
  const payload = canonicalManifestBytes(m);
  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), 'nd-release-'));
    const sigPath = join(dir, 'release.sig');
    const allowedPath = join(dir, 'allowed_signers');
    await writeFile(sigPath, `${m.signature}\n`);
    await writeFile(allowedPath, `${allowedSignersLine(principal, m.key, RELEASE_NAMESPACE)}\n`);
    const out = execFileSync('ssh-keygen', ['-Y', 'verify', '-f', allowedPath, '-I', principal,
      '-n', RELEASE_NAMESPACE, '-s', sigPath], { input: Buffer.from(payload), encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'] });
    return { available: true, ok: /Good "neodonkey-release" signature/.test(out), output: out.trim() };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { available: false };
    return { available: true, ok: false,
      output: String(err.stderr ?? err.stdout ?? err.message).trim() };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

// =============================================================================================
// CLI
// =============================================================================================

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const USAGE = `sign-release — cut a signed NeoDonkey release

  --generate <path>     create a fresh Ed25519 release key (JWK) and print its public line
  --key <path>          the release private key (JWK), as written by --generate
  --version <x.y.z>     the release version (defaults to package.json "version")
  --root <dir>          repository root (defaults to the repo this script lives in)
  --out <path>          where to write the manifest (defaults to <root>/release.json)
  --principal <email>   allowed_signers principal to print (default ${DEFAULT_PRINCIPAL})
  --comment <text>      key comment for the published public key line
  --check <path>        verify an existing manifest instead of signing (needs --pubkey)
  --pubkey <line>       the key to check against, 'ssh-ed25519 AAAA… [comment]'
  --dry-run             hash and report, write nothing

The public key line this prints is what must be published somewhere that is NOT the origin
serving the app — a printed page, a DNS TXT record, a keyserver, a press release. Trust on first
use is only as good as the user's ability to compare a fingerprint against something else.
`;

async function main(argv) {
  const args = parseArgs(argv);
  const root = String(args.root ?? REPO_ROOT).replace(/\/?$/, '/');
  const say = (s = '') => process.stdout.write(`${s}\n`);

  if (args.help || args.h) { say(USAGE); return 0; }

  // ---- generate a key -----------------------------------------------------------------------
  if (args.generate) {
    const path = String(args.generate);
    if (await exists(path)) { say(`refusing to overwrite ${path}`); return 1; }
    const kp = await generateIdentity({ comment: String(args.comment ?? DEFAULT_PRINCIPAL) });
    const jwk = await exportPrivateJwk(kp);
    await writeFile(path, `${JSON.stringify(jwk, null, 2)}\n`, { mode: 0o600 });
    const pub = await exportPublicSsh(kp);
    say(`release key written to ${path} (mode 0600)`);
    say('');
    say('PUBLISH THIS LINE — out of band, not from the origin that serves the app:');
    say(`  ${pub}`);
    say(`  ${await keyFingerprint(pub)}`);
    say('');
    say('Keep the private half off the web server. It is a primary secret (Appendix IV): it');
    say('does not belong in the repo, in CI, or anywhere the app is served from.');
    return 0;
  }

  // ---- check an existing manifest ------------------------------------------------------------
  if (args.check) {
    const text = await readFile(String(args.check), 'utf8');
    if (!args.pubkey) { say('--check needs --pubkey (the key you already trust)'); return 1; }
    const res = await verifyRelease(text, String(args.pubkey));
    say(res.ok ? `OK  version ${res.version}, ${res.files.size} files, signature verifies`
      : `FAIL  ${res.reason}`);
    const ssh = await verifyWithSshKeygen({ manifestText: text, principal: String(args.principal ?? DEFAULT_PRINCIPAL) });
    say(ssh.available ? `ssh-keygen: ${ssh.ok ? 'OK' : 'FAIL'} — ${ssh.output}` : 'ssh-keygen: not installed, skipped');
    return res.ok && (!ssh.available || ssh.ok) ? 0 : 1;
  }

  // ---- sign ---------------------------------------------------------------------------------
  const version = String(args.version ?? await packageVersion(root));
  const { files, excluded, unclassified } = await collectReleaseFiles(root);

  if (unclassified.length) {
    say('REFUSING TO SIGN — these paths match no rule in classifyPath():');
    for (const p of unclassified) say(`  ${p}`);
    say('');
    say('Every file is either part of the release or deliberately excluded. Decide, in');
    say('release/sign-release.mjs, and the decision is then in the git history where it belongs.');
    return 1;
  }

  const total = files.reduce((s, f) => s + f.bytes, 0);
  say(`neodonkey ${version} — ${files.length} files, ${total} bytes`);
  for (const f of files) say(`  ${f.sha256.slice(0, 12)}  ${String(f.bytes).padStart(7)}  ${f.path}`);
  say('');
  say(`excluded (${excluded.length}):`);
  for (const e of groupExcluded(excluded)) say(`  ${e}`);
  say('');

  if (args['dry-run']) { say('dry run — nothing written'); return 0; }
  if (!args.key) { say('need --key <path-to-jwk> (or --generate <path> first)'); return 1; }

  const kp = await importPrivateJwk(JSON.parse(await readFile(String(args.key), 'utf8')));
  const key = await exportPublicSsh(kp, args.comment !== undefined ? String(args.comment) : undefined);
  const manifest = await signManifest({ version, files, key }, kp);
  const text = renderManifestJson(manifest);

  // Never claim success on unread output: re-verify the rendered text, from scratch.
  const back = await verifyRelease(text, key);
  if (!back.ok) { say(`INTERNAL ERROR — own output does not verify: ${back.reason}`); return 1; }

  const out = String(args.out ?? join(root, 'release.json'));
  await writeFile(out, text);
  say(`wrote ${out}`);
  say(`  version      ${manifest.version}`);
  say(`  signed by    ${key}`);
  say(`  fingerprint  ${await keyFingerprint(key)}`);
  say(`  namespace    ${RELEASE_NAMESPACE}  (not 'git' — a release signature is not a commit signature)`);
  say('');
  const principal = String(args.principal ?? DEFAULT_PRINCIPAL);
  const ssh = await verifyWithSshKeygen({ manifestText: text, principal });
  say(ssh.available ? `  ssh-keygen -Y verify: ${ssh.ok ? 'OK' : 'FAIL'} — ${ssh.output}`
    : '  ssh-keygen: not installed, second opinion skipped');
  say('');
  say('Publish, out of band:');
  say(`  ${key}`);
  say(`  ${await keyFingerprint(key)}`);
  say('allowed_signers line, so anyone can check a release with OpenSSH alone:');
  say(`  ${allowedSignersLine(principal, key, RELEASE_NAMESPACE)}`);
  return ssh.available && !ssh.ok ? 1 : 0;
}

function groupExcluded(excluded) {
  const byRule = new Map();
  for (const e of excluded) {
    if (!byRule.has(e.rule)) byRule.set(e.rule, { n: 0, why: e.why });
    byRule.get(e.rule).n++;
  }
  return [...byRule.entries()].sort().map(([rule, v]) => `${String(v.n).padStart(4)}  ${rule}${v.why ? ` — ${v.why}` : ''}`);
}

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

async function packageVersion(root) {
  try { return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
