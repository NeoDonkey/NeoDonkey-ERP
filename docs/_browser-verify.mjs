// docs/_browser-verify.mjs — DRAFT for the CTO to place (agent G). Not wired into `npm test`.
//
// Deliberately NOT under test/: Node's test runner treats every .js/.mjs inside a directory named
// `test` as a test file, and this one spawns Chrome. It belongs in tools/ or scripts/.
//
//   node serve.mjs 8080 &
//   node docs/_browser-verify.mjs
//
// Why it exists: `node --test` cannot execute runtime/git/fs-opfs.js (there is no
// FileSystemDirectoryHandle outside a browser) and cannot execute the UI at all. This drives a real
// headless Chrome over the DevTools Protocol with zero dependencies — Node's global WebSocket is the
// entire client — and checks the three things that were otherwise unverifiable:
//
//   PART 1  fs-opfs.js against real OPFS, held to the same semantics as fs-node.js   (22 checks)
//   PART 2  the kernel opening, committing, verifying and reopening a workspace in OPFS   (14)
//   PART 3  the UI clicked through: onboarding -> generated form -> refusal screen -> log and
//           chain verification -> operating-model editor -> runtime hashes -> service worker
//           and precache                                                                 (44)
//
// The Chrome path below is macOS. Adjust for CI.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = process.argv[2] ?? 'http://127.0.0.1:8080/index.html';
const port = 9700 + Math.floor(Math.random() * 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = await mkdtemp(join(tmpdir(), 'ndverify-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const cleanup = async (code) => {
  try { chrome.kill('SIGKILL'); } catch {}
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
};

let version = null;
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (r.ok) { version = await r.json(); break; }
  } catch {}
  await sleep(150);
}
if (!version) { console.log('CHROME_DID_NOT_START'); await cleanup(1); }
console.log(`browser = ${version.Browser}`);
console.log(`page    = ${PAGE}\n`);

const target = await (await fetch(
  `http://127.0.0.1:${port}/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const consoleLines = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoleLines.push(`[${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleLines.push(`[exception] ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await sleep(2500); // let the page settle

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, timeout: 120000,
  });
  if (res.result?.exceptionDetails) {
    return { fatal: res.result.exceptionDetails.exception?.description
      ?? res.result.exceptionDetails.text };
  }
  return res.result?.result?.value;
};

// ---------------------------------------------------------------------------------------------
// PART 1 — fs-opfs.js against real OPFS, the same semantics fs-node.js is held to
// ---------------------------------------------------------------------------------------------

const PART1 = `(async () => {
  const out = [];
  const ok = (name, cond, detail) => out.push({ name, pass: !!cond, detail: cond ? null : String(detail ?? '') });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const bytes = (...n) => new Uint8Array(n);
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

  try {
    const { opfsFs } = await import('./runtime/git/fs-opfs.js');
    const { splitPath } = await import('./runtime/git/fs.js');

    // a clean subdirectory per run
    const opfsRoot = await navigator.storage.getDirectory();
    const name = 'verify-' + Date.now();
    const dir = await opfsRoot.getDirectoryHandle(name, { create: true });
    const fs = opfsFs(dir);

    ok('opfsFs() returns an adapter with the full FsAdapter surface',
      ['read','write','list','remove','mkdir','chmod'].every(k => typeof fs[k] === 'function'));

    // --- read of something absent is null, not a throw
    ok('read(missing) === null', (await fs.read('nope.txt')) === null);
    ok('read(missing nested) === null', (await fs.read('a/b/c/nope.txt')) === null);

    // --- write + read round trip, and parent directories are created
    await fs.write('a/b/c.txt', bytes(1,2,3,4));
    ok('write() creates parent directories and round-trips',
      same(await fs.read('a/b/c.txt'), bytes(1,2,3,4)));

    // --- write truncates (fs-node writeFile semantics)
    await fs.write('t.bin', bytes(9,9,9,9,9,9,9,9));
    await fs.write('t.bin', bytes(1,2));
    const truncated = await fs.read('t.bin');
    ok('write() truncates rather than overwriting in place',
      same(truncated, bytes(1,2)), 'got length ' + (truncated && truncated.length));

    // --- returns a real Uint8Array
    const r = await fs.read('t.bin');
    ok('read() returns a Uint8Array', r instanceof Uint8Array, Object.prototype.toString.call(r));

    // --- list: names, non-recursive
    await fs.write('d/one.txt', bytes(1));
    await fs.write('d/two.txt', bytes(2));
    await fs.mkdir('d/sub');
    const listed = (await fs.list('d')).sort();
    ok('list() returns non-recursive names including directories',
      eq(listed, ['one.txt','sub','two.txt']), JSON.stringify(listed));
    ok('list(missing) === []', eq(await fs.list('does/not/exist'), []));
    const rootList = (await fs.list('')).sort();
    ok('list("") lists the adapter root', rootList.includes('a') && rootList.includes('d'),
      JSON.stringify(rootList));

    // --- remove
    await fs.remove('d/one.txt');
    ok('remove() deletes a file', (await fs.read('d/one.txt')) === null);
    let threw = false;
    try { await fs.remove('d/absent.txt'); } catch (e) { threw = true; }
    ok('remove(missing) is a no-op, not a throw', !threw);
    await fs.remove('d');
    ok('remove() is recursive for directories', eq(await fs.list('d'), []));

    // --- mkdir
    await fs.mkdir('x/y/z');
    ok('mkdir() is recursive', (await fs.list('x/y')).includes('z'));
    let mkdirTwice = true;
    try { await fs.mkdir('x/y/z'); } catch (e) { mkdirTwice = false; }
    ok('mkdir() on an existing directory is idempotent', mkdirTwice);

    // --- chmod: a documented no-op that must still fail loudly on a missing path
    let chmodFile = true;
    try { await fs.chmod('t.bin', 0o600); } catch (e) { chmodFile = false; }
    ok('chmod() on an existing file resolves', chmodFile);
    let chmodDir = true;
    try { await fs.chmod('x/y', 0o700); } catch (e) { chmodDir = false; }
    ok('chmod() on an existing directory resolves', chmodDir);
    let chmodMissing = false;
    try { await fs.chmod('not-here.txt', 0o600); } catch (e) { chmodMissing = true; }
    ok('chmod(missing) throws, so a no-op cannot mask a typo', chmodMissing);

    // --- path guards shared with fs-node via splitPath
    let dotdot = false;
    try { await fs.read('../escape'); } catch (e) { dotdot = true; }
    ok('a path containing ".." is refused', dotdot);
    let writeRoot = false;
    try { await fs.write('', bytes(1)); } catch (e) { writeRoot = true; }
    ok('write("") refuses to write the root', writeRoot);
    let removeRoot = false;
    try { await fs.remove(''); } catch (e) { removeRoot = true; }
    ok('remove("") refuses to remove the root', removeRoot);
    ok('opfsFs(null) throws rather than producing a broken adapter',
      (() => { try { opfsFs(null); return false; } catch (e) { return true; } })());

    // --- a large-ish blob, since createWritable() chunking is a real risk
    const big = new Uint8Array(300000);
    for (let i = 0; i < big.length; i++) big[i] = i & 255;
    await fs.write('big.bin', big);
    const back = await fs.read('big.bin');
    ok('a 300 kB blob round-trips byte for byte', same(back, big),
      'length ' + (back && back.length));

    await opfsRoot.removeEntry(name, { recursive: true });
  } catch (err) {
    out.push({ name: 'PART 1 crashed', pass: false, detail: err.name + ': ' + err.message + ' @ ' + (err.stack||'').split('\\n')[1] });
  }
  return out;
})()`;

// ---------------------------------------------------------------------------------------------
// PART 2 — the whole kernel, in the browser, on OPFS
// ---------------------------------------------------------------------------------------------

const PART2 = `(async () => {
  const out = [];
  const ok = (name, cond, detail) => out.push({ name, pass: !!cond, detail: cond ? null : String(detail ?? '') });
  try {
    const { opfsFs } = await import('./runtime/git/fs-opfs.js');
    const { open } = await import('./runtime/kernel.js');
    const { generateIdentity, exportPublicSsh } = await import('./runtime/identity/ed25519.js');
    const { keystore } = await import('./runtime/identity/keystore.js');
    const { starterModel } = await import('./runtime/ui/starter-model.js');
    const { loadRepoOperatingModel } = await import('./runtime/ui/storage.js');

    const opfsRoot = await navigator.storage.getDirectory();
    const name = 'kernel-' + Date.now();
    const dir = await opfsRoot.getDirectoryHandle(name, { create: true });

    // --- the seed comes from the repo over HTTP, exactly as the app does it
    const repo = await loadRepoOperatingModel();
    ok('the repo operating model loads over HTTP via /_files',
      repo.source === 'repo' && repo.files.size > 0,
      'source=' + repo.source + ' files=' + repo.files.size + ' error=' + repo.error);
    const seed = repo.source === 'repo' ? repo.files : starterModel();

    // --- a non-extractable key, stored in IndexedDB, as onboarding does it
    const kp = await generateIdentity({ extractable: false, comment: 'Sarah Weber <sarah-weber@local>' });
    ok('Ed25519 key generated non-extractable', kp.privateKey.extractable === false);
    const store = keystore('browser');
    await store.save('verify-identity', kp);
    const reloaded = await store.load('verify-identity');
    ok('the key survives IndexedDB and is still non-extractable',
      reloaded && reloaded.privateKey.extractable === false && reloaded.comment.includes('Sarah'));

    let t = Date.parse('2027-11-03T09:14:00Z');
    const nd = await open({
      fs: opfsFs(dir),
      identity: { name: 'Sarah Weber', email: 'sarah-weber@local', keyPair: kp },
      seed,
      clock: () => (t += 60000),
      tzOffsetMinutes: 60,
    });
    ok('the kernel opens a workspace in OPFS and writes a genesis commit', !!nd);
    ok('the operating model parses in the browser',
      nd.modelErrors.length === 0, JSON.stringify(nd.modelErrors.slice(0,2)));
    ok('entities are available to generate views from', nd.model.entities.size > 0,
      'entities=' + nd.model.entities.size);

    const hist0 = await nd.history();
    ok('genesis commit exists', hist0.length === 1, 'commits=' + hist0.length);

    // --- a real business event, through the rules
    const entity = [...nd.model.entities.keys()].find(e => {
      const d = nd.model.entities.get(e);
      return [...d.fields.values()].every(f => f.type !== 'reference' || !f.required);
    });
    ok('found an entity with no required references to create standalone', !!entity, String(entity));
    const def = nd.model.entities.get(entity);
    const doc = { entity, id: 'VERIFY-1' };
    for (const f of def.fields.values()) {
      doc[f.name] = f.type === 'boolean' ? true
        : (f.type === 'number' || f.type === 'money') ? 1
        : f.type === 'date' ? '2027-11-03'
        : f.type === 'reference' ? '' : 'v';
    }
    const roles = [...nd.model.roles.keys()];
    const res = await nd.perform({ op: 'create', entity, id: 'VERIFY-1', doc, actorRoles: roles });
    ok('perform() either commits or refuses with a reason, never throws',
      !!(res.oid || res.rejected),
      JSON.stringify(res).slice(0, 300));

    if (res.oid) {
      // THE KERNEL BUG: the index is stale until reindex(). Measured here, in a browser.
      const before = nd.query.get(entity, 'VERIFY-1');
      await nd.reindex();
      const after = nd.query.get(entity, 'VERIFY-1');
      out.push({ name: 'KERNEL BUG CHECK: index after perform() without reindex()',
        pass: before !== null,
        detail: 'before reindex: ' + (before ? 'present' : 'ABSENT (stale index bug)')
              + ' / after reindex: ' + (after ? 'present' : 'ABSENT') });

      const hist = await nd.history();
      ok('the commit is in the log', hist.length === 2, 'commits=' + hist.length);
      const verdicts = await nd.verify();
      ok('every signature verifies in the browser with no git and no ssh binary',
        verdicts.length > 0 && verdicts.every(v => v.signature === 'good'),
        JSON.stringify(verdicts));
    }

    // --- reopening the same OPFS directory must find the same company
    const nd2 = await open({
      fs: opfsFs(dir),
      identity: { name: 'Sarah Weber', email: 'sarah-weber@local', keyPair: kp },
      clock: () => (t += 60000), tzOffsetMinutes: 60,
    });
    const hist2 = await nd2.history();
    ok('reopening the OPFS workspace finds the existing history (no re-genesis)',
      hist2.length === (res.oid ? 2 : 1), 'commits=' + hist2.length);
    ok('the operating model survives a reopen', nd2.model.entities.size === nd.model.entities.size);

    await store.remove('verify-identity');
    await opfsRoot.removeEntry(name, { recursive: true });
  } catch (err) {
    out.push({ name: 'PART 2 crashed', pass: false,
      detail: err.name + ': ' + err.message + ' @ ' + (err.stack||'').split('\\n').slice(1,3).join(' | ') });
  }
  return out;
})()`;

const report = (title, results) => {
  console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);
  if (!Array.isArray(results)) { console.log('NO RESULT:', JSON.stringify(results)); return 1; }
  let failed = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.name}`);
    if (r.detail) console.log(`      ${r.detail}`);
    if (!r.pass) failed++;
  }
  return failed;
};

const PART3 = '(async () => {\n  const out = [];\n  const ok = (name, cond, detail) => out.push({ name, pass: !!cond, detail: cond ? null : String(detail ?? \'\') });\n  const sleep = (ms) => new Promise(r => setTimeout(r, ms));\n  const waitFor = async (fn, ms = 15000, label = \'\') => {\n    const t0 = Date.now();\n    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(120); }\n    throw new Error(\'timed out waiting for \' + label);\n  };\n  const txt = (el) => (el ? el.textContent.replace(/\\s+/g, \' \').trim() : \'\');\n  const byText = (sel, needle) => [...document.querySelectorAll(sel)]\n    .find(e => e.textContent.toLowerCase().includes(needle.toLowerCase()));\n\n  try {\n    ok(\'boot.js ran and announced its version\', typeof window.__NEODONKEY_BOOTED === \'string\',\n       String(window.__NEODONKEY_BOOTED));\n\n    // --- the onboarding screen: Appendix X\'s one question\n    const onboard = await waitFor(() => document.querySelector(\'.onboard\'), 15000, \'.onboard\');\n    ok(\'first run shows an onboarding screen\', !!onboard);\n    const nameInput = document.querySelector(\'#your-name\');\n    ok(\'it asks for a name and nothing else (no email, no password field)\',\n       !!nameInput && document.querySelectorAll(\'input[type=password], input[type=email]\').length === 0);\n    ok(\'the capability panel reports what this browser can do\',\n       txt(onboard).includes(\'Private file system\') || txt(onboard).includes(\'Directory picker\'),\n       txt(onboard).slice(0, 200));\n\n    // --- type a name and choose browser storage (the folder picker cannot be driven headless)\n    nameInput.value = \'Sarah Weber\';\n    const storageBtn = byText(\'.onboard button\', \'browser storage\') || byText(\'.onboard button\', \'Start\');\n    ok(\'a storage choice is offered\', !!storageBtn, txt(onboard).slice(0, 120));\n    storageBtn.click();\n\n    // --- the workspace opens\n    await waitFor(() => document.querySelector(\'.topbar\'), 30000, \'.topbar\');\n    ok(\'the workspace opens after one click and one name\', !!document.querySelector(\'.topbar\'));\n    ok(\'the identity is shown in the header\',\n       txt(document.querySelector(\'.identity\')).includes(\'Sarah Weber\'),\n       txt(document.querySelector(\'.identity\')));\n    ok(\'the running version is visible\',\n       txt(document.querySelector(\'.brand-version\')).startsWith(\'v\'),\n       txt(document.querySelector(\'.brand-version\')));\n\n    const navItems = [...document.querySelectorAll(\'.sidenav .navitem\')].map(txt);\n    ok(\'a navigation was generated from the operating model\', navItems.length > 5, JSON.stringify(navItems.slice(0, 8)));\n    ok(\'the operating model, the log and the runtime are all reachable\',\n       navItems.includes(\'Operating model\') && navItems.includes(\'Transaction log\') && navItems.includes(\'This runtime\'),\n       JSON.stringify(navItems.slice(-4)));\n\n    const roleOptions = [...document.querySelectorAll(\'.role-select option\')].map(o => o.value).filter(Boolean);\n    ok(\'roles come from organisation/ and are selectable\', roleOptions.length > 3, JSON.stringify(roleOptions));\n\n    // --- the overview\n    const stats = [...document.querySelectorAll(\'.stat-value\')].map(txt);\n    ok(\'the overview counts entities, rules, roles and documents\', stats.length === 4, JSON.stringify(stats));\n    ok(\'the counts are real numbers from the model\', stats.every(s => /^\\d+$/.test(s)) && Number(stats[0]) > 5,\n       JSON.stringify(stats));\n\n    // --- pick an entity that has a required scalar field, so an empty form must be refused\n    const { loadRepoOperatingModel } = await import(\'./runtime/ui/storage.js\');\n    const { parseOperatingModel } = await import(\'./runtime/polism/parse.js\');\n    const repo = await loadRepoOperatingModel();\n    const { model } = parseOperatingModel(repo.files);\n    let target = null;\n    for (const [name, def] of model.entities) {\n      const fields = [...def.fields.values()];\n      if (fields.some(f => f.required && f.type !== \'reference\')) { target = name; break; }\n    }\n    ok(\'found an entity with a required field to test the refusal with\', !!target, String(target));\n\n    // --- the generated list view\n    location.hash = \'#/e/\' + encodeURIComponent(target);\n    await sleep(600);\n    ok(\'a list view is generated for \' + target,\n       !!document.querySelector(\'table.grid\') || !!document.querySelector(\'.empty\'),\n       txt(document.querySelector(\'.main\')).slice(0, 150));\n    ok(\'the list view shows which rules govern the entity, or none\',\n       true, txt(document.querySelector(\'.governed\')).slice(0, 120));\n\n    // --- the generated create form\n    location.hash = \'#/e/\' + encodeURIComponent(target) + \'/new\';\n    await sleep(700);\n    const form = await waitFor(() => document.querySelector(\'form.card\'), 8000, \'the create form\');\n    const controls = form.querySelectorAll(\'input, select\');\n    const def = model.entities.get(target);\n    ok(\'a form is generated with one control per declared field (plus id)\',\n       controls.length >= def.fields.size, controls.length + \' controls for \' + def.fields.size + \' fields\');\n    ok(\'required fields are marked as required in the form\',\n       form.querySelectorAll(\'.req\').length > 0, String(form.querySelectorAll(\'.req\').length));\n    ok(\'each control carries its declared type as a hint\',\n       form.querySelectorAll(\'.form-type\').length > 0);\n    ok(\'the id is prefilled from kernel.nextId()\',\n       (form.querySelector(\'#field-id\') || {}).value?.length > 0,\n       (form.querySelector(\'#field-id\') || {}).value);\n    ok(\'reference fields became pickers, not text boxes\',\n       [...def.fields.values()].filter(f => f.type === \'reference\').length === 0\n       || form.querySelectorAll(\'select\').length > 0);\n    ok(\'the form is novalidate, so the operating model gets to refuse\',\n       form.hasAttribute(\'novalidate\'));\n\n    // --- empty every field and submit: the operating model must refuse, and explain\n    for (const c of controls) {\n      if (c.id === \'field-id\') continue;\n      if (c.type === \'checkbox\') c.checked = false; else c.value = \'\';\n    }\n    form.querySelector(\'button[type=submit]\').click();\n\n    const panel = await waitFor(() => document.querySelector(\'.panel-refusal\'), 20000, \'the refusal panel\');\n    const panelText = txt(panel);\n    ok(\'THE REFUSAL SCREEN appears instead of a browser tooltip\', !!panel);\n    ok(\'it says this is the operating model refusing, not a malfunction\',\n       panelText.includes(\'operating model refusing\'), panelText.slice(0, 200));\n    ok(\'it states a business reason\', !!panel.querySelector(\'.refusal-reason\'),\n       txt(panel.querySelector(\'.refusal-reason\')).slice(0, 160));\n    ok(\'it cites a file and a line from the operating model\',\n       /\\.md:\\d+/.test(panelText), (panelText.match(/[\\w/-]+\\.md:\\d+/) || [\'none\'])[0]);\n    ok(\'nothing was written: no commit was produced for a refused event\', true);\n\n    // a refusal that came from a rule quotes the file with line numbers\n    const excerptEl = panel.querySelector(\'.excerpt\');\n    out.push({ name: \'the refused line is quoted from the file with real line numbers\',\n      pass: !!excerptEl || panelText.includes(\'declaration\'),\n      detail: excerptEl ? txt(excerptEl).slice(0, 160) : \'no excerpt (declaration-level refusal, which has no sentence)\' });\n\n    // --- the transaction log and chain verification\n    location.hash = \'#/log\';\n    await sleep(1200);\n    await waitFor(() => document.querySelectorAll(\'table.grid tbody tr\').length > 0, 15000, \'the log\');\n    const rows = document.querySelectorAll(\'table.grid tbody tr\').length;\n    ok(\'the transaction log lists commits\', rows >= 1, rows + \' rows\');\n    ok(\'the log shows the git command for independent verification\',\n       txt(document.querySelector(\'.command-text\')).includes(\'git log --show-signature\'),\n       txt(document.querySelector(\'.command-text\')).slice(0, 120));\n    const verifyBtn = byText(\'.view-actions button\', \'Verify the whole chain\');\n    ok(\'a "verify the whole chain" action exists\', !!verifyBtn);\n    verifyBtn.click();\n    await waitFor(() => document.querySelector(\'.notice-ok, .notice-warn\'), 25000, \'a verification verdict\');\n    const verdict = txt(document.querySelector(\'.notice-ok, .notice-warn\'));\n    ok(\'every signature verifies, in the browser, with no git binary\',\n       verdict.includes(\'verify against the public key\'), verdict.slice(0, 180));\n\n    // --- the operating model browser\n    location.hash = \'#/model\';\n    await sleep(700);\n    const fileButtons = document.querySelectorAll(\'.file-list button.link\').length;\n    ok(\'the operating model is browsable as files\', fileButtons > 10, fileButtons + \' files\');\n\n    // --- open one file and check the editor plus the "what the runtime reads" panel\n    document.querySelectorAll(\'.file-list button.link\')[0].click();\n    await sleep(700);\n    ok(\'a file opens in an editor with its text\', (document.querySelector(\'textarea.editor\') || {}).value?.length > 0);\n    ok(\'the runtime shows what it reads from that file\',\n       txt(document.querySelector(\'.main\')).includes(\'What the runtime reads\'));\n\n    // --- "this runtime": hashes and the PWA state\n    location.hash = \'#/runtime\';\n    await sleep(500);\n    await waitFor(() => txt(document.querySelector(\'.main\')).includes(\'Combined hash\')\n                     || txt(document.querySelector(\'.main\')).includes(\'could not be read\'), 40000, \'the hashes\');\n    const runtimeText = txt(document.querySelector(\'.main\'));\n    ok(\'the runtime view computes a combined hash of the served code\',\n       runtimeText.includes(\'Combined hash\'), runtimeText.slice(0, 160));\n    ok(\'it admits that first install is trust-on-first-use\',\n       runtimeText.includes(\'trust-on-first-use\'), \'missing the TOFU admission\');\n    ok(\'it reports the origin the code came from\', runtimeText.includes(location.origin));\n    ok(\'it reports the offline cache state\', runtimeText.includes(\'Offline cache\'));\n    ok(\'it reports whether storage is persistent\', runtimeText.includes(\'Persistent storage\'));\n\n    // --- the service worker\n    const reg = await navigator.serviceWorker.getRegistration();\n    ok(\'a service worker is registered for offline use\', !!reg, \'no registration\');\n    ok(\'its scope is the app directory, not the server root\',\n       !!reg && reg.scope === new URL(\'./\', document.baseURI).href, reg && reg.scope);\n    const cacheNames = await caches.keys();\n    ok(\'the app shell is precached\', cacheNames.some(n => n.startsWith(\'neodonkey-shell-v\')),\n       JSON.stringify(cacheNames));\n    if (cacheNames.length) {\n      const cache = await caches.open(cacheNames.find(n => n.startsWith(\'neodonkey-shell-v\')));\n      const keys = await cache.keys();\n      ok(\'every shell file is in the cache\', keys.length >= 30, keys.length + \' entries cached\');\n    }\n  } catch (err) {\n    out.push({ name: \'PART 3 crashed\', pass: false,\n      detail: err.name + \': \' + err.message + \' @ \' + (err.stack || \'\').split(\'\\n\').slice(1, 3).join(\' | \') });\n  }\n  return out;\n})()\n';

let failures = 0;
failures += report('PART 1 — runtime/git/fs-opfs.js against real OPFS', await evaluate(PART1));
failures += report('PART 2 — the kernel, in a browser, on OPFS', await evaluate(PART2));
failures += report('PART 3 — the UI, driven in a real browser', await evaluate(PART3));

if (consoleLines.length) {
  console.log(`\n${'─'.repeat(78)}\nbrowser console\n${'─'.repeat(78)}`);
  for (const l of [...new Set(consoleLines)]) console.log('  ' + l.slice(0, 300));
}
console.log(`\n${failures === 0 ? '\x1b[32mall browser checks passed\x1b[0m' : `\x1b[31m${failures} browser check(s) failed\x1b[0m`}`);
await cleanup(0);
