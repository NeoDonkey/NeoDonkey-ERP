/**
 * test/audit-location-citations.test.js — Audit test verifying that error messages, refusals,
 * warnings, and AST source locations that cite a file, line, and expectation are accurate
 * and point to existing files and valid line numbers containing the expected text.
 *
 * Owner: agent B (Audit lane).
 * Zero dependencies. Node native runner: `node --test test/audit-location-citations.test.js`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOperatingModel, POLISM_CATEGORIES } from '../runtime/polism/parse.js';
import { evaluate } from '../runtime/polism/execute.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Helper to convert path to repo-relative unix-style path */
const relPath = (absPath) => relative(REPO, absPath).split('\\').join('/');

/** Recursively walk directory returning all .md files */
function walkMd(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkMd(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Find all operating model roots in the repository */
function getRoots() {
  const roots = [];
  const consider = (dir) => {
    if (existsSync(dir) && POLISM_CATEGORIES.some((c) => existsSync(join(dir, c)))) {
      roots.push(dir);
    }
  };
  consider(join(REPO, 'operating-model'));
  const tDir = join(REPO, 'templates');
  if (existsSync(tDir)) {
    for (const n of readdirSync(tDir).sort()) {
      const p = join(tDir, n);
      if (statSync(p).isDirectory()) consider(p);
    }
  }
  return roots;
}

/** Cache file line contents */
const fileLinesCache = new Map();

function getFileLines(relFile) {
  if (!fileLinesCache.has(relFile)) {
    const abs = join(REPO, relFile);
    if (!existsSync(abs)) {
      return null;
    }
    const content = readFileSync(abs, 'utf8');
    fileLinesCache.set(relFile, content.split('\n'));
  }
  return fileLinesCache.get(relFile);
}

/** Assert file exists and line is 1-based valid index */
function assertValidLocation(file, line, context = '') {
  assert.ok(file, `file path must be provided (${context})`);
  const lines = getFileLines(file);
  assert.ok(lines !== null, `cited file "${file}" does not exist on disk (${context})`);
  assert.ok(
    typeof line === 'number' && Number.isInteger(line) && line >= 1 && line <= lines.length,
    `cited line ${line} in "${file}" is out of range [1..${lines.length}] (${context})`
  );
  return lines[line - 1];
}

/** Extract all `file.md:line` citations from a text string */
function extractCitations(text) {
  const citations = [];
  const re = /([A-Za-z0-9_./-]+\.md):(\d+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    citations.push({ file: match[1], line: parseInt(match[2], 10) });
  }
  return citations;
}

// ---------------------------------------------------------------------------- AST Source Locations Test

test('AST node source locations in operating-model and templates point to valid lines', () => {
  const roots = getRoots();
  assert.ok(roots.length >= 2, 'expected operating-model plus at least one template');

  let entityCount = 0;
  let fieldCount = 0;
  let predicateCount = 0;
  let invariantCount = 0;
  let processCount = 0;

  for (const absRoot of roots) {
    const allMd = walkMd(absRoot).filter((p) => {
      const b = relPath(p);
      return !b.endsWith('/README.md') && !b.endsWith('/index.md') && !b.includes('/_');
    });

    const fileMap = new Map();
    for (const p of allMd) {
      fileMap.set(relPath(p), readFileSync(p, 'utf8'));
    }

    const { model } = parseOperatingModel(fileMap);

    // 1. Entities
    for (const [name, def] of model.entities) {
      entityCount++;
      const lineText = assertValidLocation(def.source.file, def.source.line, `entity "${name}"`);
      assert.ok(
        lineText.length > 0,
        `entity line ${def.source.line} in "${def.source.file}" is empty`
      );

      // Entity Authority
      if (def.authority && def.authority.source) {
        assertValidLocation(def.authority.source.file, def.authority.source.line, `entity authority "${name}"`);
        for (const [op, entry] of def.authority.byOp) {
          assertValidLocation(def.authority.source.file, entry.line, `entity authority ${op} for "${name}"`);
        }
      }

      // Fields
      for (const [fname, fdef] of def.fields) {
        fieldCount++;
        const fLineText = assertValidLocation(fdef.source.file, fdef.source.line, `field "${fname}" on "${name}"`);
        assert.ok(
          fLineText.includes(fname),
          `field line ${fdef.source.line} in "${fdef.source.file}" does not contain field name "${fname}"`
        );
      }

      // Predicates
      for (const [pname, pdef] of def.predicates) {
        predicateCount++;
        const pLineText = assertValidLocation(pdef.source.file, pdef.source.line, `predicate "${pname}" on "${name}"`);
        assert.ok(
          pLineText.includes(pname),
          `predicate line ${pdef.source.line} in "${pdef.source.file}" does not contain predicate name "${pname}"`
        );
      }

      // Invariants
      for (const [invName, invDef] of def.invariants) {
        invariantCount++;
        const invLineText = assertValidLocation(invDef.source.file, invDef.source.line, `invariant "${invDef.name}" on "${name}"`);
        assert.ok(
          invLineText.length > 0,
          `invariant line ${invDef.source.line} in "${invDef.source.file}" is empty`
        );
      }
    }

    // 2. Processes / Rules
    for (const rule of model.processes) {
      processCount++;
      const rLineText = assertValidLocation(rule.source.file, rule.source.line, `rule "${rule.trigger.op} ${rule.trigger.entity}"`);
      assert.ok(
        rLineText.trim().length > 0,
        `rule line ${rule.source.line} in "${rule.source.file}" is empty`
      );

      if (rule.authorizedBySource && rule.authorizedBySource.file) {
        assertValidLocation(rule.authorizedBySource.file, rule.authorizedBySource.line, `rule authority "${rule.trigger.op}"`);
      }

      for (const b of rule.branches || []) {
        if (b.line) {
          assertValidLocation(rule.source.file, b.line, `branch in rule "${rule.trigger.op}"`);
        }
      }
    }
  }

  assert.ok(entityCount > 20, `parsed ${entityCount} entities across roots`);
  assert.ok(fieldCount > 50, `parsed ${fieldCount} fields across roots`);
  assert.ok(processCount > 30, `parsed ${processCount} processes across roots`);
});

// ---------------------------------------------------------------------------- Parser Diagnostics Test

test('Parser diagnostics carry accurate file, line, text, and embedded citations', () => {
  const roots = getRoots();
  for (const absRoot of roots) {
    const allMd = walkMd(absRoot).filter((p) => {
      const b = relPath(p);
      return !b.endsWith('/README.md') && !b.endsWith('/index.md') && !b.includes('/_');
    });

    const fileMap = new Map();
    for (const p of allMd) {
      fileMap.set(relPath(p), readFileSync(p, 'utf8'));
    }

    const { errors } = parseOperatingModel(fileMap);

    for (const diag of errors) {
      const lineText = assertValidLocation(diag.file, diag.line, `diagnostic "${diag.message}"`);
      assert.ok(lineText !== null && lineText !== undefined, `line ${diag.line} in "${diag.file}" must exist`);

      // Check all embedded citations in the diagnostic message
      const embedded = extractCitations(diag.message);
      for (const cite of embedded) {
        assertValidLocation(cite.file, cite.line, `embedded citation in message: "${diag.message}"`);
      }
    }
  }
});

// ---------------------------------------------------------------------------- Execution Refusal Location Citations Test

test('Execution refusals and violations carry accurate file, line, and embedded location references', () => {
  const fileMap = new Map();
  const omFiles = walkMd(join(REPO, 'operating-model')).filter((p) => {
    const b = relPath(p);
    return !b.endsWith('/README.md') && !b.endsWith('/index.md') && !b.includes('/_');
  });

  for (const p of omFiles) {
    fileMap.set(relPath(p), readFileSync(p, 'utf8'));
  }

  const { model } = parseOperatingModel(fileMap);

  const mockWorld = {
    get: () => null,
    find: () => [],
  };

  // 1. Test missing required field refusal
  const missingFieldResult = evaluate(
    model,
    {
      op: 'create',
      entity: 'customer',
      id: 'customer/C-TEST-01',
      actorRoles: ['sales-manager'],
      doc: {
        id: 'customer/C-TEST-01',
        entity: 'customer',
        // missing required name
      },
    },
    mockWorld,
    { authorization: 'strict' }
  );

  assert.equal(missingFieldResult.ok, false, 'missing required field must be refused');
  assert.ok(missingFieldResult.violations.length > 0, 'must record violations');
  for (const v of missingFieldResult.violations) {
    if (v.file) {
      assertValidLocation(v.file, v.line, `violation "${v.reason}"`);
    }
  }
  const citations1 = extractCitations(missingFieldResult.detail || missingFieldResult.violations.map((v) => v.reason).join('\n'));
  for (const cite of citations1) {
    assertValidLocation(cite.file, cite.line, `citation in detail "${missingFieldResult.detail}"`);
  }

  // 2. Test enum validation refusal
  const invalidEnumResult = evaluate(
    model,
    {
      op: 'create',
      entity: 'customer',
      id: 'customer/C-TEST-02',
      actorRoles: ['sales-manager'],
      doc: {
        id: 'customer/C-TEST-02',
        entity: 'customer',
        name: 'Acme Corp',
        status: 'INVALID_ENUM_VALUE',
      },
    },
    mockWorld,
    { authorization: 'strict' }
  );

  assert.equal(invalidEnumResult.ok, false, 'invalid enum value must be refused');
  for (const v of invalidEnumResult.violations) {
    if (v.file) {
      assertValidLocation(v.file, v.line, `enum violation "${v.reason}"`);
    }
  }
  const citations2 = extractCitations(invalidEnumResult.detail || invalidEnumResult.violations.map((v) => v.reason).join('\n'));
  for (const cite of citations2) {
    assertValidLocation(cite.file, cite.line, `citation in detail "${invalidEnumResult.detail}"`);
  }

  // 3. Test ungoverned operation authority refusal
  const ungovernedResult = evaluate(
    model,
    {
      op: 'delete',
      entity: 'location',
      id: 'location/LOC-TEST',
      actorRoles: [],
      doc: { id: 'location/LOC-TEST', entity: 'location' },
    },
    mockWorld,
    { authorization: 'strict' }
  );

  assert.equal(ungovernedResult.ok, false, 'ungoverned operation must be refused under strict authorization');
  for (const v of ungovernedResult.violations) {
    if (v.file) {
      assertValidLocation(v.file, v.line, `ungoverned violation "${v.reason}"`);
    }
  }
  const citations3 = extractCitations(ungovernedResult.detail || ungovernedResult.violations.map((v) => v.reason).join('\n'));
  for (const cite of citations3) {
    assertValidLocation(cite.file, cite.line, `citation in detail "${ungovernedResult.detail}"`);
  }
});

// ---------------------------------------------------------------------------- Documentation File Citations Test

test('Documentation files cite existing codebase files', () => {
  const docsToScan = ['docs/COMPROMISES.md', 'docs/NEXT.md', 'docs/AUDIT.md'];
  const pathRe = /\b(?:runtime|operating-model|templates|test|docs|demo|release|mcp)\/[a-zA-Z0-9_./-]+\.(?:js|mjs|json|md)\b/g;

  // Explicitly documented exit-path, hypothetical, or future files
  const EXEMPT = new Set([
    'runtime/read/sqlite.js',
    'operating-model/authorities.json',
    'operating-model/information/salary.md',
    'operating-model/index.json',
  ]);

  let checkedCount = 0;
  for (const docFile of docsToScan) {
    const absDoc = join(REPO, docFile);
    if (!existsSync(absDoc)) continue;
    const content = readFileSync(absDoc, 'utf8');
    let match;
    while ((match = pathRe.exec(content)) !== null) {
      const refPath = match[0];
      if (EXEMPT.has(refPath)) continue;
      const absRef = join(REPO, refPath);
      assert.ok(
        existsSync(absRef),
        `file "${refPath}" cited in "${docFile}" must exist on disk`
      );
      checkedCount++;
    }
  }

  assert.ok(checkedCount > 20, `verified ${checkedCount} file path citations across docs`);
});
