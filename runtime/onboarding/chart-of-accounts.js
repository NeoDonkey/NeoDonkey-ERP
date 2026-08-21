/**
 * runtime/onboarding/chart-of-accounts.js — parse and validate chart-of-accounts template
 * definitions (SKR03, SKR04) for company onboarding.
 *
 * Implements issue #122 under the binding decision record
 * `docs/decisions/2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`
 * (GoBD Rz. 86–89; HGB § 240, § 242, § 252 Abs. 1 Nr. 1).
 *
 * The templates themselves are DATA, shipped as JSON under `operating-model/information/`
 * (`_chart-skr03.json`, `_chart-skr04.json`) — the underscore marks them as reference data the
 * model loaders skip, the same convention as the `_chart-*.md` seed tables. This file is the
 * parser and validator; no account of any chart is named here, only the record's field rules:
 * every account declares `account-number`, `name`, `account-type`, `normal-balance`,
 * `statement-section`, `vat-role`, `reconciliation-account-for` and the `manual` posting lock.
 *
 * Zero dependencies, no `node:*`, no clock, no randomness: `parseChartTemplate` is a pure
 * function of its input text.
 */

/** A malformed template is refused with this, listing every problem found. */
export class ValidationError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = 'ValidationError';
    this.problems = problems;
  }
}

// The field rules from the decision record, §Answer 1. Account NUMBERS are data and live in the
// template files; these are the shapes a row may take.
export const ACCOUNT_TYPES = Object.freeze(['asset', 'liability', 'equity', 'revenue', 'expense']);
export const NORMAL_BALANCES = Object.freeze(['debit', 'credit']);
export const STATEMENT_SECTIONS = Object.freeze(['balance-sheet', 'income-statement']);
export const VAT_ROLES = Object.freeze(['none', 'output-tax', 'input-tax', 'taxable-turnover',
  'exempt-turnover', 'non-taxable-turnover', 'acquisition-turnover']);
export const RECONCILIATION_TARGETS = Object.freeze(['none', 'bank', 'customer', 'supplier']);

/**
 * Which opening-balance account mirrors an opening posting. Exactly one account per role must be
 * declared by every template (record §Answer 2: EBK, AR subledger opening, AP subledger opening).
 */
export const OPENING_BALANCE_ROLES = Object.freeze(['general', 'receivables', 'payables']);

/** SKR03 and SKR04 account numbers are four digits, and 0800 is not 800 — text, never a number. */
const ACCOUNT_NUMBER_RE = /^[0-9]{4}$/;
const STANDARD_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * Parse and validate one chart-of-accounts template definition.
 *
 * @param {string|object} source JSON text, or an already-parsed object.
 * @returns a frozen template: `{ standard, display-name, ledger-currency, accounts,
 *   control-totals, openingBalanceAccounts }` where `openingBalanceAccounts` maps each of
 *   `general` / `receivables` / `payables` to the account row carrying that role.
 * @throws {ValidationError} naming every problem found.
 */
export function parseChartTemplate(source) {
  const problems = [];
  let raw = source;
  if (typeof source === 'string') {
    try {
      raw = JSON.parse(source);
    } catch (err) {
      throw new ValidationError(`the template is not valid JSON: ${err.message}`);
    }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('a chart-of-accounts template is a JSON object with a "standard" and an "accounts" array.');
  }

  const standard = raw.standard;
  if (typeof standard !== 'string' || !STANDARD_RE.test(standard)) {
    problems.push('"standard" must be a lower-case slug such as "skr03" or "skr04"');
  }
  if (typeof raw['display-name'] !== 'string' || raw['display-name'].trim() === '') {
    problems.push('"display-name" must be a non-empty string');
  }
  if (typeof raw['ledger-currency'] !== 'string' || !CURRENCY_RE.test(raw['ledger-currency'])) {
    problems.push('"ledger-currency" must be a three-letter currency code such as "EUR"');
  }

  const rows = raw.accounts;
  if (!Array.isArray(rows) || rows.length === 0) {
    problems.push('"accounts" must be a non-empty array');
  }
  const accounts = [];
  const byNumber = new Map();
  const byOpeningRole = new Map();
  if (Array.isArray(rows)) {
    rows.forEach((row, i) => {
      const where = `accounts[${i}]`;
      const account = validateAccount(row, where, problems);
      if (!account) return;
      if (byNumber.has(account['account-number'])) {
        problems.push(`${where}: duplicate account-number "${account['account-number']}" — an account number may appear once in a chart`);
        return;
      }
      byNumber.set(account['account-number'], account);
      const role = account['opening-balance-role'];
      if (role && role !== 'none') {
        if (byOpeningRole.has(role)) {
          problems.push(`${where}: two accounts claim opening-balance-role "${role}" (${byOpeningRole.get(role)['account-number']} and ${account['account-number']})`);
        } else if (account['statement-section'] !== 'balance-sheet') {
          problems.push(`${where}: an opening-balance account is a balance-sheet account, not "${account['statement-section']}"`);
        } else {
          byOpeningRole.set(role, account);
        }
      }
      accounts.push(account);
    });
  }

  // Record §Answer 2: the three opening-balance accounts are mandatory — EBK (general ledger),
  // the AR subledger opening account and the AP subledger opening account.
  for (const role of OPENING_BALANCE_ROLES) {
    if (!byOpeningRole.has(role)) {
      problems.push(`no account carries opening-balance-role "${role}" — a chart template must declare its EBK, AR and AP opening accounts`);
    }
  }

  checkControlTotals(raw['control-totals'], accounts, problems);

  if (problems.length) {
    throw new ValidationError(
      `the chart-of-accounts template${typeof standard === 'string' ? ` "${standard}"` : ''} is not valid:\n  - ${problems.join('\n  - ')}`,
      problems,
    );
  }

  return deepFreeze({
    standard,
    'display-name': raw['display-name'],
    'ledger-currency': raw['ledger-currency'],
    accounts,
    'control-totals': raw['control-totals'],
    openingBalanceAccounts: {
      general: byOpeningRole.get('general'),
      receivables: byOpeningRole.get('receivables'),
      payables: byOpeningRole.get('payables'),
    },
  });
}

/** One account row. Returns the normalized row, or null when it is unusable. */
function validateAccount(row, where, problems) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    problems.push(`${where}: an account is a JSON object`);
    return null;
  }
  const before = problems.length;

  const number = row['account-number'];
  if (typeof number !== 'string' || !ACCOUNT_NUMBER_RE.test(number)) {
    problems.push(`${where}: "account-number" must be four digits as text (e.g. "0800"), got ${JSON.stringify(number)}`);
  }
  if (typeof row.name !== 'string' || row.name.trim() === '') {
    problems.push(`${where}: "name" must be a non-empty string`);
  }
  for (const [field, allowed] of [
    ['account-type', ACCOUNT_TYPES],
    ['normal-balance', NORMAL_BALANCES],
    ['statement-section', STATEMENT_SECTIONS],
    ['vat-role', VAT_ROLES],
    ['reconciliation-account-for', RECONCILIATION_TARGETS],
  ]) {
    if (!allowed.includes(row[field])) {
      problems.push(`${where}: "${field}" must be one of ${allowed.join(', ')}, got ${JSON.stringify(row[field])}`);
    }
  }
  if (typeof row.manual !== 'boolean') {
    problems.push(`${where}: "manual" (the blocked-for-manual-posting lock) must be true or false`);
  }
  const role = row['opening-balance-role'];
  if (role !== undefined && role !== 'none' && !OPENING_BALANCE_ROLES.includes(role)) {
    problems.push(`${where}: "opening-balance-role" must be one of ${OPENING_BALANCE_ROLES.join(', ')}, got ${JSON.stringify(role)}`);
  }
  if (row['vat-kennzahl'] !== undefined && typeof row['vat-kennzahl'] !== 'string') {
    problems.push(`${where}: "vat-kennzahl" must be text, got ${JSON.stringify(row['vat-kennzahl'])}`);
  }
  if (row['vat-rate-percent'] !== undefined
      && (!Number.isInteger(row['vat-rate-percent']) || row['vat-rate-percent'] < 0 || row['vat-rate-percent'] > 100)) {
    problems.push(`${where}: "vat-rate-percent" must be an integer between 0 and 100, got ${JSON.stringify(row['vat-rate-percent'])}`);
  }
  if (row.source !== undefined && !['published-standard', 'company-defined'].includes(row.source)) {
    problems.push(`${where}: "source" must be published-standard or company-defined, got ${JSON.stringify(row.source)}`);
  }
  if (problems.length > before) return null;

  return Object.freeze({
    'account-number': number,
    name: row.name.trim(),
    'account-type': row['account-type'],
    'normal-balance': row['normal-balance'],
    'statement-section': row['statement-section'],
    'vat-role': row['vat-role'],
    'vat-kennzahl': row['vat-kennzahl'] ?? '',
    'vat-rate-percent': row['vat-rate-percent'] ?? '',
    'reconciliation-account-for': row['reconciliation-account-for'],
    manual: row.manual,
    'opening-balance-role': role ?? 'none',
    source: row.source ?? 'published-standard',
  });
}

/** Control totals are declared in the template and must agree with the rows, exactly. */
function checkControlTotals(declared, accounts, problems) {
  if (declared === undefined || declared === null) {
    problems.push('"control-totals" is missing — a template declares its account-count and section totals so a truncated file cannot pass silently');
    return;
  }
  if (declared['account-count'] !== accounts.length) {
    problems.push(`control totals do not balance: "account-count" declares ${declared['account-count']} but the template lists ${accounts.length} accounts`);
  }
  for (const [group, field] of [['by-statement-section', 'statement-section'], ['by-account-type', 'account-type']]) {
    const totals = declared[group];
    if (totals === undefined) continue;
    if (totals === null || typeof totals !== 'object') {
      problems.push(`"control-totals.${group}" must be an object of counts`);
      continue;
    }
    const computed = new Map();
    for (const a of accounts) computed.set(a[field], (computed.get(a[field]) || 0) + 1);
    for (const [key, count] of Object.entries(totals)) {
      if ((computed.get(key) || 0) !== count) {
        problems.push(`control totals do not balance: "${group}.${key}" declares ${count} but the template lists ${computed.get(key) || 0}`);
      }
    }
    for (const [key, count] of computed) {
      if (totals[key] === undefined) {
        problems.push(`control totals do not balance: the template lists ${count} account(s) with ${field} "${key}" but "control-totals.${group}" does not declare it`);
      }
    }
  }
}

/**
 * Instantiate one `ledger-account` domain object per template row, the record's §Answer 2
 * adoption step. The result is shaped exactly as `operating-model/information/ledger-account.md`
 * declares the document, so the objects can be committed as-is.
 *
 * The template's `statement-section` speaks the decision record's vocabulary
 * (`income-statement`); the operating model's enumeration says `profit-and-loss`. The mapping is
 * made here, once, in both directions it can go — and likewise `customer`/`supplier` become the
 * model's `receivables`/`payables` control-account markers.
 *
 * @param {ReturnType<typeof parseChartTemplate>} template
 * @param {{ chart:string, openedOn:string }} ctx chart document id and adoption date (injected — no clock is read here)
 */
export function instantiateLedgerAccounts(template, { chart, openedOn } = {}) {
  if (!template || !Array.isArray(template.accounts) || !template.openingBalanceAccounts) {
    throw new ValidationError('instantiateLedgerAccounts needs a template from parseChartTemplate');
  }
  if (typeof chart !== 'string' || chart === '') {
    throw new ValidationError('the chart document id is required to instantiate accounts');
  }
  if (typeof openedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(openedOn)) {
    throw new ValidationError('"openedOn" must be an ISO date (YYYY-MM-DD) — it is injected, never read from a clock');
  }
  const section = { 'balance-sheet': 'balance-sheet', 'income-statement': 'profit-and-loss' };
  const reconciliation = { none: 'none', bank: 'bank', customer: 'receivables', supplier: 'payables' };
  return template.accounts.map((a) => Object.freeze({
    id: `${chart}-${a['account-number']}`,
    'account-number': a['account-number'],
    name: a.name,
    chart,
    'account-type': a['account-type'],
    'normal-balance': a['normal-balance'],
    'statement-section': section[a['statement-section']],
    'vat-role': a['vat-role'],
    'vat-kennzahl': a['vat-kennzahl'],
    'vat-rate-percent': a['vat-rate-percent'],
    'reconciliation-account-for': reconciliation[a['reconciliation-account-for']],
    'blocked-for-manual-posting': a.manual,
    'account-source': a.source,
    'opened-on': openedOn,
    status: 'active',
  }));
}

/** Find one account row by number, or undefined. */
export function accountByNumber(template, accountNumber) {
  if (!template || !Array.isArray(template.accounts)) return undefined;
  return template.accounts.find((a) => a['account-number'] === String(accountNumber));
}

function deepFreeze(x) {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) { x.forEach(deepFreeze); return Object.freeze(x); }
  for (const k of Object.keys(x)) deepFreeze(x[k]);
  return Object.freeze(x);
}
