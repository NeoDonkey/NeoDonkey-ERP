/**
 * runtime/onboarding/opening-balance.js — the initial Eröffnungsbilanz engine.
 *
 * Implements issue #121 under the binding decision record
 * `docs/decisions/2026-08-21-chart-of-accounts-template-onboarding-and-opening-balance-initialization.md`:
 *
 *  - Every opening value becomes two postings of one `journal-entry` whose
 *    `source-document-type` is `opening-balance` (record §Answer 3, `entry-type:
 *    "initial-opening-balance"`): an active (asset/expense) balance is debited against the
 *    opening-balance account in credit; a passive (equity/liability) balance is credited against
 *    it in debit.
 *  - The counter-account is the general EBK (Sachkonten). A receivables or payables CONTROL
 *    account is the sum of the open items behind it, so its opening is posted item by item
 *    against the AR/AP subledger opening account (9008/9009 — which numbers those are is DATA,
 *    the template declares them via `opening-balance-role`), and the item total is then
 *    transferred from the subledger opening account into the general EBK. Every one of the
 *    three opening-balance accounts therefore nets to exactly zero, and the general EBK carries
 *    exactly the balance sheet: assets in credit, equity and liabilities in debit.
 *  - Per-entry invariant: sum(debits) == sum(credits), exact BigInt minor units via
 *    `runtime/money/money.js` — no float ever touches an amount (FD-1).
 *  - Macro invariant: after posting, each opening-balance account nets to exactly zero. Because
 *    every opening leg is mirrored, the EBK net is exactly the balance-sheet equation: it is zero
 *    iff the opening assets equal the opening equity plus liabilities. A balance sheet that does
 *    not balance is refused, not booked.
 *  - Bilanzidentität (HGB § 252 Abs. 1 Nr. 1): where a prior closing balance is supplied, every
 *    opening must equal it; a divergence is refused. Where none is supplied (founding, HGB
 *    § 242), the opening balance sheet is the first.
 *  - Double onboarding is refused (GoBD Rz. 86–89, Unveränderbarkeit): a workspace whose
 *    existing entries already contain an initial opening balance for this chart cannot be
 *    opened again. An error in an opening balance is corrected by a new entry
 *    (`processes/journal-correction.md`), never by re-running onboarding.
 *
 * The output is the journal-entry document plus its posting documents, shaped exactly as
 * `operating-model/information/journal-entry.md` and `posting.md` declare them, so the set can
 * be committed as one signed commit — the real ledger path. Dates and actor ids are parameters;
 * no clock and no randomness is read here.
 */

import * as Money from '../money/money.js';
import { accountByNumber, ValidationError } from './chart-of-accounts.js';

/** A broken accounting invariant refuses the posting with this. */
export class InvariantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvariantError';
  }
}

const ENTRY_TYPE = 'initial-opening-balance';
const SOURCE_DOCUMENT_TYPE = 'opening-balance';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Post the initial Eröffnungsbilanz.
 *
 * @param {object} spec
 * @param {object} spec.template parsed chart template from `parseChartTemplate`
 * @param {string} spec.chartId id of the `chart-of-accounts` document (e.g. "skr03")
 * @param {string} spec.entryNumber gapless journal number for the entry
 * @param {string} spec.entryDate Buchungsdatum, ISO date
 * @param {string} spec.period accounting-period id the entry lands in
 * @param {string} spec.enteredBy employee id who captured the opening balance
 * @param {string} spec.postedBy employee id who commits it
 * @param {string} [spec.description] Buchungstext
 * @param {string} [spec.documentDate] Belegdatum; defaults to entryDate
 * @param {string} [spec.postedAt] commit date; defaults to entryDate
 * @param {Array<{account:string, amount?:string|object, side?:'debit'|'credit',
 *   items?:Array<object>, description?:string}>} spec.openings
 *   one opening value per account; the side defaults to the account's normal balance. A customer
 *   or supplier control account opens with `items` — one per open item, each
 *   `{ customer|supplier, amount, description? }` — mirrored into the AR/AP subledger opening
 *   account; every other account opens with `amount` against the general EBK.
 * @param {Object<string,string>} [spec.priorClosing] account-number -> closing balance token
 *   from the prior year's Schlussbilanz; omit at founding
 * @param {Array<object>} [spec.existingEntries] journal entries already in the repository —
 *   used to refuse a second onboarding. WARNING: this guard is only as strong as what the
 *   caller passes. The kernel/UI wiring that commits the opening entry MUST pass every
 *   `journal-entry` the workspace holds (for this chart, at minimum); omitting it turns the
 *   GoBD Rz. 86–89 unchangeability guarantee into decoration — the same failure class as a
 *   validator that runs against an empty world. Callers that cannot enumerate the journal must
 *   not call this function.
 * @returns {{ entry:object, postings:object[], totals:{ debits:string, credits:string },
 *   openingBalanceNets:Object<string,string> }}
 * @throws {ValidationError} for malformed input
 * @throws {InvariantError} when an accounting invariant would break
 */
export function postOpeningBalance(spec) {
  const problems = [];
  if (!spec || typeof spec !== 'object') throw new ValidationError('postOpeningBalance needs a spec object');
  const template = spec.template;
  if (!template || !Array.isArray(template.accounts) || !template.openingBalanceAccounts) {
    throw new ValidationError('spec.template must come from parseChartTemplate');
  }
  const currency = template['ledger-currency'];
  for (const f of ['chartId', 'entryNumber', 'period', 'enteredBy', 'postedBy']) {
    if (typeof spec[f] !== 'string' || spec[f] === '') problems.push(`spec.${f} is required`);
  }
  for (const f of ['entryDate', 'documentDate', 'postedAt']) {
    const v = spec[f] ?? spec.entryDate;
    if (typeof v !== 'string' || !DATE_RE.test(v)) problems.push(`spec.${f} must be an ISO date (YYYY-MM-DD)`);
  }
  if (!Array.isArray(spec.openings) || spec.openings.length === 0) {
    problems.push('spec.openings must list at least one opening value');
  }
  if (problems.length) throw new ValidationError(`cannot post the opening balance:\n  - ${problems.join('\n  - ')}`, problems);

  refuseDoubleOnboarding(spec.existingEntries, spec.chartId);

  const ebk = {
    general: spec.template.openingBalanceAccounts.general,
    receivables: spec.template.openingBalanceAccounts.receivables,
    payables: spec.template.openingBalanceAccounts.payables,
  };
  const ebkNumbers = new Set(Object.values(ebk).map((a) => a['account-number']));

  const legs = [];
  const openingByAccount = new Map();
  const zero = Money.zero(currency);
  const opposite = (side) => (side === 'debit' ? 'credit' : 'debit');
  spec.openings.forEach((opening, i) => {
    const where = `openings[${i}]`;
    const account = typeof opening.account === 'string' ? accountByNumber(template, opening.account) : undefined;
    if (!account) {
      throw new ValidationError(`${where}: account ${JSON.stringify(opening.account)} is not in chart "${template.standard}"`);
    }
    if (ebkNumbers.has(account['account-number'])) {
      throw new ValidationError(`${where}: ${account['account-number']} is an opening-balance account; nothing is ever posted to it by hand`);
    }
    if (account['statement-section'] !== 'balance-sheet') {
      throw new InvariantError(
        `${where}: account ${account['account-number']} (${account.name}) is an income-statement account; `
        + 'the Eröffnungsbilanz carries balance-sheet accounts only (HGB § 242)',
      );
    }
    if (openingByAccount.has(account['account-number'])) {
      throw new ValidationError(`${where}: account ${account['account-number']} has two opening values`);
    }

    const control = account['reconciliation-account-for'];
    if (control === 'customer' || control === 'supplier') {
      if (opening.side !== undefined) {
        throw new ValidationError(`${where}: ${account['account-number']} is a control account; its side is its normal balance, and each open item is positive`);
      }
      if (!Array.isArray(opening.items) || opening.items.length === 0) {
        throw new ValidationError(
          `${where}: ${account['account-number']} is a ${control} control account — its opening is the list of open `
          + `items behind it, not a single figure. Give "items", each naming its ${control}.`,
        );
      }
      const side = account['normal-balance'];
      const subEbk = control === 'customer' ? ebk.receivables : ebk.payables;
      let total = zero;
      opening.items.forEach((item, j) => {
        const at = `${where}.items[${j}]`;
        if (!item || typeof item !== 'object') throw new ValidationError(`${at}: an open item is an object`);
        if (typeof item[control] !== 'string' || item[control] === '') {
          throw new ValidationError(`${at}: an open item names its ${control}`);
        }
        const m = exactPositive(item.amount, currency, at);
        total = Money.add(total, m);
        // The open item itself: control account against the subledger opening account.
        legs.push({ account, side, amount: m, lineDescription: item.description ?? account.name, [control]: item[control] });
        legs.push({ account: subEbk, side: opposite(side), amount: m, lineDescription: account.name });
      });
      if (opening.amount !== undefined) {
        const declared = exactPositive(opening.amount, currency, where);
        if (!Money.equals(declared, total)) {
          throw new ValidationError(
            `${where}: the declared opening ${Money.toString(declared)} does not equal the sum of its open items ${Money.toString(total)}`,
          );
        }
      }
      // The transfer: the subledger opening account is emptied into the general EBK, which then
      // carries the control total exactly as it carries every other balance-sheet value.
      legs.push({ account: subEbk, side, amount: total, lineDescription: account.name });
      legs.push({ account: ebk.general, side: opposite(side), amount: total, lineDescription: account.name });
      openingByAccount.set(account['account-number'], { side, amount: total });
      return;
    }

    if (opening.items !== undefined) {
      throw new ValidationError(`${where}: open items belong to a customer or supplier control account; ${account['account-number']} is posted directly`);
    }
    const amount = exactPositive(opening.amount, currency, where);
    const side = opening.side ?? account['normal-balance'];
    if (side !== 'debit' && side !== 'credit') {
      throw new ValidationError(`${where}: "side" must be "debit" or "credit", got ${JSON.stringify(opening.side)}`);
    }
    openingByAccount.set(account['account-number'], { side, amount });
    legs.push({ account, side, amount, lineDescription: opening.description ?? account.name });
    legs.push({ account: ebk.general, side: opposite(side), amount, lineDescription: account.name });
  });

  assertBilanzidentitaet(spec.priorClosing, openingByAccount);

  // --- the invariants, over exact BigInt minor units ------------------------------------------
  let debits = zero;
  let credits = zero;
  const ebkNet = new Map([...ebkNumbers].map((n) => [n, zero]));
  for (const leg of legs) {
    if (leg.side === 'debit') debits = Money.add(debits, leg.amount);
    else credits = Money.add(credits, leg.amount);
    const n = leg.account['account-number'];
    if (ebkNet.has(n)) {
      ebkNet.set(n, leg.side === 'debit'
        ? Money.add(ebkNet.get(n), leg.amount)
        : Money.subtract(ebkNet.get(n), leg.amount));
    }
  }
  if (!Money.equals(debits, credits)) {
    throw new InvariantError(
      `the opening entry does not balance: debits are ${Money.toString(debits)} and credits are ${Money.toString(credits)}`,
    );
  }
  for (const [number, net] of [...ebkNet.entries()].sort()) {
    if (Money.toMinor(net) !== 0n) {
      throw new InvariantError(
        `Opening balance sheet account ${number} does not balance to zero: it nets to ${Money.toString(net)}. `
        + 'The opening assets and the opening equity plus liabilities disagree — the Eröffnungsbilanz itself does not balance.',
      );
    }
  }

  // --- the documents, exactly as the model declares them ---------------------------------------
  const entryDate = spec.entryDate;
  const entry = Object.freeze({
    'entry-number': spec.entryNumber,
    'entry-date': entryDate,
    'document-date': spec.documentDate ?? entryDate,
    'accounting-period': spec.period,
    chart: spec.chartId,
    currency,
    'debit-amount': Money.toString(debits),
    'credit-amount': Money.toString(credits),
    'posting-count': legs.length,
    description: spec.description ?? `Eröffnungsbilanz per ${entryDate}`,
    'source-document-type': SOURCE_DOCUMENT_TYPE,
    'entry-type': ENTRY_TYPE,
    'source-document-reference': spec.entryNumber,
    reversal: false,
    status: 'posted',
    'entered-by': spec.enteredBy,
    'posted-by': spec.postedBy,
    'posted-at': spec.postedAt ?? entryDate,
  });
  const postings = legs.map((leg, i) => Object.freeze({
    'journal-entry': spec.entryNumber,
    position: i + 1,
    'account-number': leg.account['account-number'],
    chart: spec.chartId,
    'ledger-account': `${spec.chartId}-${leg.account['account-number']}`,
    side: leg.side,
    amount: Money.toString(leg.amount),
    currency,
    'posting-date': entryDate,
    'accounting-period': spec.period,
    description: `${entry.description} — ${leg.lineDescription}`,
    'source-document-reference': spec.entryNumber,
    'vat-kennzahl': leg.account['vat-kennzahl'] ?? '',
    'vat-role': leg.account['vat-role'] ?? 'none',
    ...(leg.customer ? { customer: leg.customer } : {}),
    ...(leg.supplier ? { supplier: leg.supplier } : {}),
  }));

  return Object.freeze({
    entry,
    postings: Object.freeze(postings),
    totals: Object.freeze({ debits: Money.toString(debits), credits: Money.toString(credits) }),
    openingBalanceNets: Object.freeze(Object.fromEntries(
      [...ebkNet.entries()].map(([n, m]) => [n, Money.toString(m)]),
    )),
  });
}

/** The net balance of an opening-balance account over a set of postings, in exact minor units. */
export function openingBalanceNet(postings, accountNumber) {
  let net = 0n;
  for (const p of postings) {
    if (p['account-number'] !== String(accountNumber)) continue;
    const minor = Money.toMinor(p.amount);
    net = p.side === 'debit' ? net + minor : net - minor;
  }
  return net;
}

/** Assert the zero-balance invariant over already-committed postings (the macro check). */
export function assertOpeningBalanceZero(postings, template) {
  for (const role of ['general', 'receivables', 'payables']) {
    const number = template.openingBalanceAccounts[role]['account-number'];
    if (openingBalanceNet(postings, number) !== 0n) {
      throw new InvariantError(`Opening balance sheet account ${number} does not balance to zero`);
    }
  }
}

/** GoBD Rz. 86–89: the opening values are unchangeable once posted — onboarding happens once. */
function refuseDoubleOnboarding(existingEntries, chartId) {
  for (const e of existingEntries || []) {
    if (e.chart !== chartId) continue;
    if (e['entry-type'] === ENTRY_TYPE || e['source-document-type'] === SOURCE_DOCUMENT_TYPE) {
      throw new InvariantError(
        `chart "${chartId}" already has an initial opening balance (${e['entry-number'] ?? e.id}). `
        + 'Onboarding runs once; a wrong opening value is corrected by a new entry, never by re-posting the Eröffnungsbilanz (GoBD Rz. 86–89).',
      );
    }
  }
}

/** HGB § 252 Abs. 1 Nr. 1: opening values must equal the prior closing values. */
function assertBilanzidentitaet(priorClosing, openingByAccount) {
  if (priorClosing === undefined || priorClosing === null) return; // founding: this is the first
  if (typeof priorClosing !== 'object' || Array.isArray(priorClosing)) {
    throw new ValidationError('spec.priorClosing maps account-number -> closing balance token');
  }
  const mismatches = [];
  for (const [number, closingToken] of Object.entries(priorClosing)) {
    const opening = openingByAccount.get(number);
    if (!opening) {
      mismatches.push(`account ${number} closed at ${closingToken} but has no opening value`);
      continue;
    }
    const closing = Money.money(closingToken);
    if (!Money.equals(opening.amount, closing)) {
      mismatches.push(`account ${number} opens at ${Money.toString(opening.amount)} but closed at ${Money.toString(closing)}`);
    }
  }
  for (const [number, opening] of openingByAccount) {
    if (!(number in priorClosing)) {
      mismatches.push(`account ${number} opens at ${Money.toString(opening.amount)} but has no prior closing value`);
    }
  }
  if (mismatches.length) {
    throw new InvariantError(
      `Bilanzidentität is violated (HGB § 252 Abs. 1 Nr. 1) — the opening values must equal the prior closing values:\n  - ${mismatches.join('\n  - ')}`,
    );
  }
}

/** Exact money, positive, in the ledger currency — or a refusal. Never a float. */
function exactPositive(value, currency, where) {
  if (typeof value === 'number') {
    throw new ValidationError(`${where}: an amount is never a Number; write it as a token like "2500.00 ${currency}"`);
  }
  let m;
  try {
    m = Money.toMoney(value);
  } catch (err) {
    throw new ValidationError(`${where}: ${JSON.stringify(value)} is not an exact amount: ${err.message}`);
  }
  if (Money.currencyOf(m) !== currency) {
    throw new ValidationError(`${where}: ${Money.toString(m)} is not in the ledger currency ${currency}`);
  }
  if (!Money.isPositive(m)) {
    throw new ValidationError(`${where}: an opening amount is always positive (the side carries the direction); got ${Money.toString(m)}`);
  }
  return m;
}
