// test/_source-guard.js — one source scanner, shared by every "this construct must not appear"
// guard in the suite.
//
// Written because there were three of these and they disagreed. Agent M's money guard strips
// comments and string literals before scanning and was mutation-tested against 14 known-bad
// fixtures. The crypto guard, written later, used a naive regex over raw text — and flagged
// `runtime/crypto/keys.js` for `Math.random` because the file's own comment says
// "`Math.random()` appears nowhere, by rule". A guard that fails on its own documentation teaches
// people to delete the documentation.
//
// So: one implementation, validated by M's fixtures (test/m-money.test.js), reused everywhere.
// This is the "do not re-derive what you can ask" rule applied to test infrastructure, after the
// CTO broke it three times in one project.

/**
 * Strip comments, string literals and regex literals from JavaScript source, keeping the
 * expressions inside `${…}` (a violation hidden in a template expression is still a violation).
 * Nothing here needs to be a full parser: it needs to be conservative enough that no forbidden
 * construct can hide, and precise enough that a `[0-9]` inside a regex is not a false positive.
 */
function stripLiterals(src) {
  let out = '';
  let i = 0;
  let prev = '';
  const regexAllowed = () => prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev);

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += 'STR';
      prev = 'R';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1;
          let inner = '';
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
            inner += src[i];
            i++;
          }
          out += ' ' + stripLiterals(inner) + ' ';   // keep the code, drop its strings
          continue;
        }
        i++;
      }
      out += 'STR';
      prev = 'R';
      continue;
    }
    if (c === '/' && regexAllowed()) {
      i++;
      let inClass = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { i++; break; }
        else if (d === '\n') break;
        i++;
      }
      while (i < src.length && /[a-z]/.test(src[i])) i++;
      out += 'RE';
      prev = 'E';
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

/**
 * What may never appear in a monetary source file. Each entry names the failure it prevents.
 * This is the test the roadmap's gate condition 2 asks for ("asserted by a test that greps the
 * runtime"), and it is strict enough to have caught the bug it was written for: `money` as a
 * plain number, multiplied by `1.19`.
 */

/**
 * Scan sources for forbidden constructs, ignoring comments and string/regex literals.
 * @param {Map<string,string>|Iterable<[string,string]>} sources file -> source text
 * @param {[string, RegExp, string][]} forbidden [name, pattern, why]
 * @returns {{file:string, rule:string, line:number, text:string, why:string}[]}
 */
export function scanSources(sources, forbidden) {
  const violations = [];
  for (const [file, src] of sources) {
    const lines = stripLiterals(src).split('\n');
    for (const [rule, re, why] of forbidden) {
      const flags = re.flags.includes('i') ? 'gi' : 'g';
      for (let i = 0; i < lines.length; i++) {
        if (new RegExp(re.source, flags).test(lines[i])) {
          violations.push({ file, rule, line: i + 1, text: lines[i].trim(), why });
        }
      }
    }
  }
  return violations;
}

export { stripLiterals };
