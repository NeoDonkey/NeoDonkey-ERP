#!/usr/bin/env node
/**
 * NeoDonkey over MCP — Principle 7: "AI is one interface. MCP is one API."
 *
 *   node mcp/server.mjs /path/to/your-company
 *
 * This file is proof that the kernel is genuinely headless. It contains no business logic,
 * no validation, no persistence — it is a translation of JSON-RPC into kernel calls and back.
 * If a UI needed more than this file has, the kernel would be wrong.
 *
 * Zero dependencies, including here: the MCP wire protocol is JSON-RPC 2.0 over
 * newline-delimited stdio, which needs no SDK.
 *
 * Register with Claude Code:
 *   claude mcp add neodonkey -- node /abs/path/mcp/server.mjs /abs/path/to/your-company
 */

import { readFile, readdir } from 'node:fs/promises';
import { nodeFs } from '../runtime/git/fs-node.js';
import { generateIdentity, exportPublicSsh } from '../runtime/identity/ed25519.js';
import { keystore } from '../runtime/identity/keystore.js';
import { open } from '../runtime/kernel.js';

const workspace = process.argv[2];
if (!workspace) {
  process.stderr.write('usage: node mcp/server.mjs <workspace-dir>\n');
  process.exit(2);
}

const NAME = process.env.NEODONKEY_NAME ?? 'NeoDonkey Operator';
const EMAIL = process.env.NEODONKEY_EMAIL ?? 'operator@neodonkey.eu';

/**
 * FD-9 — the operator's founding roles, set by the HUMAN who registers this server, in the
 * environment, and applied only when this server creates the workspace (`open()` ignores `roles`
 * for a workspace that already exists — the repository decides from then on).
 *
 *   NEODONKEY_ROLES=managing-director,accountant node mcp/server.mjs /path/to/company
 *
 * This is the one place an authority decision enters through configuration rather than through the
 * repo, and it is deliberate: somebody has to be able to start a company. The important property is
 * that the model on the other end of this pipe cannot reach it. It is read once, before any tool is
 * callable, and there is no tool that grants a role — see the note at the end of the TOOLS list.
 */
const FOUNDING_ROLES = (process.env.NEODONKEY_ROLES ?? '')
  .split(',').map((r) => r.trim()).filter((r) => r !== '');

let nd = null;
async function kernel() {
  if (nd) return nd;
  const fs = nodeFs(workspace);
  const ks = keystore('node', fs);
  let keyPair = await ks.load(EMAIL).catch(() => null);
  if (!keyPair) { keyPair = await generateIdentity(); await ks.save(EMAIL, keyPair); }
  nd = await open({
    fs,
    identity: { name: NAME, email: EMAIL, keyPair },
    seed: await loadSeed(),
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
    ...(FOUNDING_ROLES.length ? { roles: FOUNDING_ROLES } : {}),
  });
  const mine = nd.myRoles();
  if (!mine.recorded || mine.roles.length === 0) {
    // Said on stderr at startup rather than discovered as a wall of refusals later. FD-9's stated
    // consequence, and the operator is the only one who can fix it.
    process.stderr.write(
      `neodonkey mcp: ${EMAIL} holds no roles in this workspace (${mine.at}), so every operation `
      + 'the operating model governs will be refused.\n'
      + '  For a NEW workspace: set NEODONKEY_ROLES=<role>,<role> before the first run.\n'
      + '  For an EXISTING one: somebody with authority grants them — kernel.grantRoles() — and it '
      + 'is a signed commit you can find with `git log -- peers/`.\n'
      + '  This is not a misconfiguration to work around: a role a caller merely claims is not a '
      + 'control (FD-9).\n');
  }
  return nd;
}

/** A fresh workspace is seeded with the operating model that ships next to this code. */
async function loadSeed() {
  const root = new URL('../operating-model/', import.meta.url);
  const seed = new Map();
  const walk = async (rel) => {
    let entries;
    try { entries = await readdir(new URL(rel, root), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) await walk(`${rel}${e.name}/`);
      else if (e.name.endsWith('.md')) {
        seed.set(`operating-model/${rel}${e.name}`,
          await readFile(new URL(`${rel}${e.name}`, root), 'utf8'));
      }
    }
  };
  await walk('');
  return seed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools. Note what is NOT here: no "create_invoice", no "post_goods_receipt".
// The company's own operating model decides what is possible, so the API surface
// stays constant while the business changes. That is Principle 11 seen from outside.
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'whoami',
    description: 'Who you are acting as, and what authority that identity actually holds. Call ' +
      'this before perform(). You do not choose your own roles here: you act as the operator ' +
      'whose peer identity this server holds a signing key for, and the roles are the ones ' +
      'recorded for them in the company\'s repository (FD-9). If this reports no roles, every ' +
      'operation the company governs will be refused, and the fix is a human granting the role — ' +
      'not a different argument from you.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const k = await kernel();
      const mine = k.myRoles();
      return {
        actingAs: { name: NAME, email: EMAIL },
        rolesHeld: mine.roles,
        rolesAreRecordedInTheRepository: mine.recorded,
        peerRecord: mine.at,
        whatThisMeans: mine.recorded && mine.roles.length
          ? 'You may act with any subset of rolesHeld. Naming a role outside it is refused, not '
            + 'silently reduced.'
          : 'No roles are recorded for this identity, so nothing the operating model governs can '
            + 'be performed. A human with authority must record them (kernel.grantRoles or '
            + 'addPeer({roles})); it is a signed commit, visible in `git log -- peers/`.',
        rolesThisCompanyHas: [...(k.model?.roles?.keys() ?? [])],
      };
    },
  },
  {
    name: 'describe_company',
    description: 'Read the operating model: the processes, roles, entities and rules this ' +
      'company runs on. Start here — it tells you what this company can do and who may do it.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const k = await kernel();
      const rules = (k.model?.processes ?? []).map((r) => ({
        trigger: `${r.trigger?.op} ${r.trigger?.entity}`,
        conditions: (r.conditions ?? []).map((c) => c.text ?? c),
        consequents: (r.consequents ?? []).map((c) => c.text ?? c),
        authorizedBy: r.authorizedBy ?? [],
        source: r.source ? `${r.source.file}:${r.source.line}` : null,
      }));
      const mine = k.myRoles();
      return {
        entities: [...(k.model?.entities?.keys() ?? [])],
        roles: [...(k.model?.roles?.keys() ?? [])],
        rules,
        modelErrors: k.modelErrors,
        documentCounts: k.query.stats().entities,
        // FD-9: the roles listed above are the company's vocabulary, not yours. These are yours.
        youAreActingAs: { email: EMAIL, rolesHeld: mine.roles, recorded: mine.recorded },
      };
    },
  },
  {
    name: 'query',
    description: 'Query the company. Declarative and read-only, answered from the local index ' +
      'in sub-millisecond time. Example: {"from":"invoice","where":{"total":{"op":">",' +
      '"value":10000}},"orderBy":"date","limit":20}',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'entity name, e.g. "invoice"' },
        where: { type: 'object' },
        orderBy: { type: 'string' }, desc: { type: 'boolean' },
        limit: { type: 'number' }, sum: { type: 'string' },
        count: { type: 'boolean' }, groupBy: { type: 'string' },
      },
      required: ['from'],
    },
    handler: async (args) => (await kernel()).query.select(args),
  },
  {
    name: 'perform',
    description: 'Attempt a business event. It is run through the company\'s written rules: ' +
      'either it is refused with the sentence that refused it, or every resulting change is ' +
      'sealed in one signed commit. There is no way to write to this company that bypasses ' +
      'its own rules — not even for you. You act as the operator\'s peer identity, with the ' +
      'authority the repository records for it; see whoami.',
    inputSchema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['create', 'update', 'delete'] },
        entity: { type: 'string' },
        id: { type: 'string', description: 'omit on create to get a generated id' },
        doc: { type: 'object' },
        // FD-9 / COMPROMISES #21. This used to be `actorRoles`, and it used to be REQUIRED — the
        // model was asked to assert its own authority, and the kernel believed it. It is now
        // optional, it is called what it does, and it can only ever NARROW: omit it and you act
        // with everything the operator holds; name a role the operator does not hold and the whole
        // call is refused rather than quietly reduced.
        actAs: {
          type: 'array', items: { type: 'string' },
          description: 'Optional. NARROWS your authority to these roles for this one call — ' +
            'useful for checking how a rule behaves for a warehouse clerk when the operator is ' +
            'also a managing director. It cannot widen anything: naming a role the operator does ' +
            'not hold is refused. Omit it to act with every role the operator holds. Call whoami ' +
            'to see what those are.',
        },
        message: { type: 'string', description: 'commit subject, in plain business language' },
      },
      required: ['op', 'entity', 'doc'],
    },
    handler: async (args) => {
      const k = await kernel();
      const id = args.id ?? k.nextId(args.entity);
      const { actAs, actorRoles, ...rest } = args;
      // A client that still sends `actorRoles` is told plainly that the field is gone, rather than
      // having its intent guessed at — it was a claim of authority, and silently reinterpreting one
      // of those is the defect FD-9 exists to remove.
      if (actorRoles !== undefined && actAs === undefined) {
        return {
          accepted: false,
          refusedBecause: [{
            reason: 'actorRoles is no longer an input to this tool. It was a claim you made about '
              + 'your own authority, and the kernel believed it (FD-9, COMPROMISES #21). You now '
              + 'act as the operator\'s peer identity, with the roles the repository records for '
              + 'it. If you meant to narrow your authority for this one call, use actAs; if you '
              + 'meant to act normally, omit it. Call whoami to see what you hold.',
            code: 'actor-roles-is-not-an-input',
          }],
        };
      }
      const result = await k.perform({
        ...rest, id, doc: { ...args.doc, entity: args.entity, id },
        ...(actAs === undefined ? {} : { actorRoles: actAs }),
      });
      if (result.rejected) {
        const authority = result.rejected.some(
          (r) => r && ['roles-not-held', 'roles-not-recorded', 'peer-record-missing',
            'peer-record-unreadable'].includes(r.code));
        return {
          accepted: false,
          refusedBecause: result.rejected,
          hint: authority
            ? 'This is an authority refusal, and it is not something you can argue your way past: '
              + 'roles come from the operator\'s signed peer record in the repository, never from '
              + 'this call. Do not retry with different roles. Either the operator asks somebody '
              + 'with authority to grant the role — a signed commit a human makes — or the event '
              + 'genuinely is not theirs to perform. Call whoami to see what you hold.'
            : 'This is the operating model refusing, not a bug. Either the event is wrong, '
              + 'or the written rule is — and changing the rule is a legitimate answer '
              + '(see amend_operating_model).',
        };
      }
      return { accepted: true, commit: result.oid, changes: result.changes };
    },
  },
  {
    name: 'amend_operating_model',
    description: 'Change the company by changing its description. The new text must parse; if ' +
      'it does not, nothing is committed and you get the error with file and line. This is how ' +
      'a business change happens here — no ticket, no release, no developer.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'e.g. operating-model/processes/goods-receipt.md' },
        text: { type: 'string', description: 'the full new content of the file' },
        message: { type: 'string', description: 'why this change, in business language' },
      },
      required: ['path', 'text'],
    },
    handler: async (args) => {
      const r = await (await kernel()).amendOperatingModel(args.path, args.text, args.message);
      return r.rejected ? { accepted: false, refusedBecause: r.rejected }
                        : { accepted: true, commit: r.oid };
    },
  },
  {
    name: 'read_operating_model_file',
    description: 'Read one operating model file verbatim. Do this before amending it — you ' +
      'must send back the whole file, and the prose above the rules is written for humans and ' +
      'must survive your edit.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } }, required: ['path'],
    },
    handler: async (args) => {
      const k = await kernel();
      const bytes = k._internals.files.get(args.path);
      if (!bytes) {
        return { error: 'no such file', available:
          [...k._internals.files.keys()].filter((p) => p.startsWith('operating-model/')) };
      }
      return { path: args.path, text: new TextDecoder().decode(bytes) };
    },
  },
  {
    name: 'history',
    description: 'The signed transaction log: what happened, who signed it, and which written ' +
      'rule authorized it. This is the audit trail (GoBD Nachvollziehbarkeit).',
    inputSchema: {
      type: 'object', properties: { limit: { type: 'number' } },
    },
    handler: async (args) => (await kernel()).history(args?.limit ?? 30),
  },
  {
    name: 'verify_chain',
    description: 'Verify every commit signature against the public keys in the repo, using ' +
      'our own Ed25519 code — no git binary, no ssh binary, no trust in the local toolchain. ' +
      'Also answers, per commit, which roles its author acted with and whether the company had ' +
      'recorded those roles for them at that moment (FD-9).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const v = await (await kernel()).verify();
      const bad = v.filter((x) => x.signature !== 'good');
      // FD-9's historical question. `agree === false` is the serious one: a commit whose author
      // acted with a role the repository did not record for them at the time.
      const overreach = v.filter((x) => x.authority && x.authority.agree === false)
        .map((x) => ({ oid: x.oid, ...x.authority }));
      const preFD9 = v.filter((x) => x.authority && x.authority.actedWith === null).length;
      return {
        commits: v.length, good: v.length - bad.length, problems: bad,
        authority: {
          overreach,
          commitsWrittenBeforeRolesWereRecordedInTheCommit: preFD9,
          note: preFD9
            ? 'Commits with no NeoDonkey-Actor-Roles trailer predate FD-9. The roles their author '
              + 'acted with are not recoverable from those commits, and this reports that rather '
              + 'than guessing either way.'
            : 'Every commit records the roles its author acted with, inside the signed payload.',
        },
      };
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// What is deliberately NOT a tool: granting a role.
//
// `kernel.grantRoles()` exists and is a signed, auditable act — but it is not exposed here, and the
// reason is worth stating rather than leaving as an omission. This server holds the operator's
// signing key. In a workspace this server created, the operator is the founder, and the founder may
// grant any role (see runtime/kernel.js, mayGrant()). So a grant tool would let the model on the
// other end of this pipe write itself any authority it liked, and FD-9 would be decorative again
// one level up.
//
// FD-9 cannot fix that by itself: whoever holds a peer's key IS that peer, which is true of every
// signature scheme there is. What can fix it is not offering the capability, so granting stays where
// it belongs — with a human, at a shell, in a commit they can be asked about.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 over newline-delimited stdio. That is all MCP needs on the wire.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The read path returns `Map` for grouped results on purpose — object key order is not stable
 * for numeric-looking keys, and a report whose group order depends on that is a bug. JSON has
 * no Map, so preserve the order as entry pairs rather than let it stringify to `{}`.
 */
const jsonSafe = (_key, value) => {
  if (value instanceof Map) return { _ordered: true, entries: [...value.entries()] };
  if (value instanceof Set) return [...value];
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  return value;
};

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const HANDLERS = {
  initialize: () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'neodonkey', version: '0.1.0' },
  }),
  'notifications/initialized': () => null,
  'tools/list': () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }),
  'tools/call': async (params) => {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) throw new Error(`unknown tool: ${params?.name}`);
    const result = await tool.handler(params.arguments ?? {});
    return { content: [{ type: 'text', text: JSON.stringify(result, jsonSafe, 2) }] };
  },
};

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const handler = HANDLERS[msg.method];
    if (!handler) { if (msg.id !== undefined) fail(msg.id, -32601, `unknown method ${msg.method}`); continue; }
    try {
      const result = await handler(msg.params);
      if (msg.id !== undefined && result !== null) reply(msg.id, result);
    } catch (e) {
      if (msg.id !== undefined) fail(msg.id, -32000, e.message);
      else process.stderr.write(`neodonkey mcp: ${e.stack}\n`);
    }
  }
});

process.stderr.write(`neodonkey mcp: workspace ${workspace}\n`);
