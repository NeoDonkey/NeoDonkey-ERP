/**
 * runtime/inbound/shopify.js — the inbound dialect for Shopify orders.
 *
 * The mirror image of `runtime/export/`: those modules translate NeoDonkey's canonical documents
 * into a foreign system's format (DATEV EXTF, XRechnung); this one translates a foreign system's
 * format into canonical domain documents. The binding contract is the decision record
 * `docs/decisions/2026-08-19-inbound-dialect-shopify-order-mapping-and-idempotency.md`
 * (GitHub issues #118 and #119); its five Answers are implemented here, each named where it lands:
 *
 *   Answer 1 — idempotency and origin. Every ingested order is stamped `source-system`,
 *     `source-id` and a human `reference` on the document itself, so the git history is the
 *     register and no parallel bookkeeping exists. `ingestShopifyOrder` looks the tuple up in the
 *     read index before committing: a previously seen `(source-system, source-id)` returns the
 *     existing document and commits NOTHING.
 *
 *   Answer 2 — zero-float parsing. Shopify expresses money as strings ("29.99") in REST and as
 *     MoneyV2 `{ amount, currencyCode }` objects in GraphQL. `parseShopifyMinor` turns those
 *     strings directly into BigInt minor units. A JSON number in a monetary field, an unparseable
 *     string, or more decimal places than the currency has are all loud `InboundError`s — never a
 *     rounded guess. A `-0.00` from the foreign system is mapped to zero at this boundary,
 *     explicitly, as `runtime/money/README.md` requires of inbound dialects.
 *
 *   Answer 3 — tax mapping. `tax_lines` rates map onto the shipped SKR03 chart
 *     (`operating-model/information/_chart-skr03.md`): domestic 19 % → revenue 8400 / VAT 1776,
 *     domestic 7 % → 8300 / 1771, zero-rated → 8120, and an EU cross-border B2C destination (an
 *     OSS distance sale, `operating-model/information/vat-treatment.md`) → revenue 8336 with the
 *     destination rate carried verbatim and the VAT owed on the OSS liability account 1791 — never
 *     on 1776, or the Umsatzsteuervoranmeldung is wrong.
 *
 *   Answer 4 — discount allocation. `discount_applications` (order-level, `across`) are allocated
 *     over the line items by `runtime/money/money.js`'s largest-remainder `allocate`, weighted by
 *     line gross, so the line nets sum to the order net exactly — 10.00 over three equal lines is
 *     3.34/3.33/3.33, not the 3.33/3.33/3.33 that naive rounding leaves a cent short.
 *
 *   Answer 5 — payment and open items. `financial_status: "paid"` additionally records a payment
 *     document clearing the receivable through the payment-provider clearing account 1370
 *     (Verrechnungskonto Zahlungsdienstleister). Any other status leaves an OPOS open item on the
 *     customer subledger account (10000–69999, derived deterministically from the Shopify customer
 *     id), recorded on the invoice document and posted as the receivable leg.
 *
 * Ingestion commits through the real kernel path — `kernel.perform` — so every order arrives as
 * signed, rule-checked commits, and with an injected clock the same foreign event produces a
 * byte-identical commit payload on any peer. This module contains no clock and no randomness.
 *
 * v1 boundaries, stated loudly rather than guessed at: orders with non-zero shipping charges,
 * line-level discount allocations already applied inside `subtotal_price`, and non-EU destinations
 * are refused with a named error. Extending the dialect is a decision-record change, not a silent
 * heuristic.
 *
 * Zero dependencies. No `node:*`. No `Date.now()`, no `Math.random()`.
 */

import { fromMinor, scaleOf, allocate as allocateMoney } from '../money/money.js';

/** Every rejection from this dialect. `code` is stable and machine-readable. */
export class InboundError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'InboundError';
    this.code = code;
  }
}

/** The `source-system` value every document this dialect writes is stamped with. */
export const SOURCE_SYSTEM = 'shopify';

/**
 * EU member states (ISO 3166-1 alpha-2) for the OSS destination check. Greece appears as both EL
 * (the code the EU itself uses for VAT) and GR (ISO), because a foreign payload may carry either.
 */
export const EU_MEMBER_STATES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'EL', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * The SKR03 account mapping, from `operating-model/information/_chart-skr03.md`. Keyed by the
 * domestic VAT rate in percent. An OSS distance sale does not key on rate — the destination
 * country's rate is carried verbatim and the accounts are the OSS pair.
 */
export const SKR03_DOMESTIC = Object.freeze({
  '19': Object.freeze({ treatment: 'domestic-standard', revenueAccount: '8400', vatAccount: '1776' }),
  '7': Object.freeze({ treatment: 'domestic-reduced', revenueAccount: '8300', vatAccount: '1771' }),
  '0': Object.freeze({ treatment: 'exempt', revenueAccount: '8120', vatAccount: null }),
});

/** OSS distance sale: `8336 Erlöse aus im anderen EU-Land steuerpflichtigen Lieferungen`, and the
 *  OSS VAT liability `1791` — deliberately not 1776 (see the chart file's own note). */
export const SKR03_OSS = Object.freeze({
  treatment: 'oss-distance-sale', revenueAccount: '8336', vatAccount: '1791',
});

/** `1370 Verrechnungskonto Zahlungsdienstleister` — where Shopify Payments settlements land. */
export const CLEARING_ACCOUNT = '1370';

/** Customer subledger band per the decision record: 10000–69999. */
const SUBLEDGER_BASE = 10000n;
const SUBLEDGER_SPAN = 50000n;

const POW10 = [1n, 10n, 100n, 1000n, 10000n, 100000n, 1000000n];
const pow10 = (n) => (n < POW10.length ? POW10[n] : 10n ** BigInt(n));

// ---------------------------------------------------------------------------------------------
// Answer 2 — strict string → BigInt minor-unit money parsing
// ---------------------------------------------------------------------------------------------

/**
 * Parse one monetary field exactly as Shopify sends it: a string like "29.99", or a GraphQL
 * MoneyV2 / *Set object. Returns BigInt minor units of `currency`.
 *
 * Refusals, all loud, because the alternative is a rounded guess in a ledger:
 *   - `money-as-number`      a JSON number arrived in a monetary field — the payload was already
 *                            damaged by a float before it reached us;
 *   - `money-not-a-string`   anything else that is not a string or a MoneyV2 shape;
 *   - `money-unparseable`    a string that is not `-?digits[.digits]`;
 *   - `money-overprecision`  more decimal places than ISO 4217 gives the currency (e.g. "29.999"
 *                            EUR) — parsing it would mean silently dropping a digit;
 *   - `currency-mismatch`    a MoneyV2 whose currencyCode disagrees with the order's currency.
 */
export function parseShopifyMinor(value, currency, field = 'amount') {
  if (value !== null && typeof value === 'object') {
    const inner = value.shopMoney ?? value;
    if (typeof inner.amount === 'string') {
      if (currency !== undefined && typeof inner.currencyCode === 'string'
          && inner.currencyCode !== currency) {
        throw new InboundError('currency-mismatch',
          `${field}: ${inner.amount} ${inner.currencyCode} inside an order expressed in ${currency} — mixed currencies are never combined silently (FD-1)`);
      }
      return parseShopifyMinor(inner.amount, inner.currencyCode ?? currency, field);
    }
    throw new InboundError('money-not-a-string',
      `${field}: expected a monetary string like "29.99" or a MoneyV2 { amount, currencyCode }, got ${JSON.stringify(value)}`);
  }
  if (typeof value === 'number') {
    throw new InboundError('money-as-number',
      `${field}: a monetary value arrived as a JSON number (${value}). Shopify sends money as strings; a number here means the payload passed through a float before reaching the dialect, and it is refused rather than rounded.`);
  }
  if (typeof value !== 'string') {
    throw new InboundError('money-not-a-string',
      `${field}: expected a monetary string like "29.99", got ${typeof value}`);
  }
  const scale = scaleOf(currency); // throws on an unknown or malformed currency code
  const text = value.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) {
    throw new InboundError('money-unparseable',
      `${field}: ${JSON.stringify(value)} is not an amount (expected digits with an optional decimal part, e.g. "29.99") — refusing to guess`);
  }
  const frac = m[3] ?? '';
  if (frac.length > scale) {
    throw new InboundError('money-overprecision',
      `${field}: ${JSON.stringify(value)} has ${frac.length} decimal places but ${currency} has ${scale}. Truncating or rounding it would be a silent edit to a financial fact, so the order is refused.`);
  }
  const base = pow10(scale);
  let minor = BigInt(m[2]) * base + (frac === '' ? 0n : BigInt(frac.padEnd(scale, '0')));
  // The boundary decision runtime/money/README.md §1 requires: a foreign "-0.00" maps to zero
  // here, visibly, instead of smuggling a negative zero into the canonical token form.
  if (m[1] === '-' && minor !== 0n) minor = -minor;
  return minor;
}

/** The canonical FD-1 wire token for a parsed amount, e.g. 2999n EUR → "29.99 EUR". */
export function moneyToken(minor, currency) {
  return fromMinor(minor, currency).toString();
}

// ---------------------------------------------------------------------------------------------
// Tax rates — ratios, not money. Arrive as 0.19 (REST `rate`) or 19.0 (GraphQL `ratePercentage`).
// ---------------------------------------------------------------------------------------------
//
// A JSON number in a *rate* field is not FD-1 damage the way a money field is, but it is still
// never multiplied into anything: it is turned into its exact decimal string form first
// (String(0.19) is "0.19"), and all arithmetic on it is BigInt.

/**
 * Normalise a tax rate to a canonical percent string: 0.19 → "19", "0.07" → "7", 20.5 → "20.5".
 *
 * @param {string|number} rate
 * @param {'fraction'|'percent'} kind REST sends a fraction (0.19); GraphQL's `ratePercentage`
 *   sends the percent (19.0). The caller says which field it read — the dialect never guesses
 *   from magnitude.
 * @param {string} [field]
 * @returns {{ percent: string, scaled: bigint }} `scaled` is percent × 10⁴, for exact sorting.
 */
export function normalizeRatePercent(rate, kind, field = 'tax rate') {
  const text = typeof rate === 'string'
    ? rate.trim()
    : typeof rate === 'number'
      ? String(rate)
      : null;
  if (text === null) {
    throw new InboundError('rate-unparseable',
      `${field}: expected a decimal rate (0.19 or "0.19"), got ${typeof rate}`);
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) {
    throw new InboundError('rate-unparseable',
      `${field}: ${JSON.stringify(text)} is not a decimal rate the dialect can read exactly (scientific notation and negatives are refused)`);
  }
  const frac = m[2] ?? '';
  const num = BigInt(m[1] + frac);
  const den = pow10(frac.length);
  // percent × 10⁴ = num × 10⁶ / den for a fraction, num × 10⁴ / den for a percent.
  const factor = kind === 'fraction' ? 1000000n : 10000n;
  const scaledNum = num * factor;
  if (scaledNum % den !== 0n) {
    throw new InboundError('rate-overprecision',
      `${field}: ${JSON.stringify(text)} is a rate with more precision than a ten-thousandth of a percent; refusing to round it into a VAT treatment`);
  }
  const scaled = scaledNum / den;
  const s = scaled.toString().padStart(5, '0');
  const intPart = s.slice(0, s.length - 4).replace(/^0+(?=\d)/, '');
  const fracPart = s.slice(s.length - 4).replace(/0+$/, '');
  return { percent: fracPart === '' ? intPart : `${intPart}.${fracPart}`, scaled };
}

// ---------------------------------------------------------------------------------------------
// Answer 3 — the tax & VAT mapping
// ---------------------------------------------------------------------------------------------

/**
 * Map one rate onto its SKR03 treatment. Cross-border EU B2C (destination country an EU member
 * other than `homeCountry`) is an OSS distance sale at the destination's own rate, whatever that
 * rate is. Domestic sales map by rate. Anything else is refused, loudly.
 *
 * @param {{ percent: string, scaled: bigint }} rate
 * @param {{ destinationCountry: string|null, homeCountry: string }} where
 */
export function taxClassFor(rate, where) {
  const { destinationCountry, homeCountry } = where;
  const dest = destinationCountry ? destinationCountry.toUpperCase() : null;
  if (dest !== null && dest !== homeCountry.toUpperCase()) {
    if (!EU_MEMBER_STATES.has(dest)) {
      throw new InboundError('unsupported-destination',
        `the order ships to ${dest}, which is neither the home country (${homeCountry}) nor an EU member state, so it is an export — and export treatment is a decision this dialect does not guess at. Record it in the decision record and extend the mapping.`);
    }
    return {
      treatment: SKR03_OSS.treatment, revenueAccount: SKR03_OSS.revenueAccount,
      vatAccount: SKR03_OSS.vatAccount, ratePercent: rate.percent,
    };
  }
  const domestic = SKR03_DOMESTIC[rate.percent];
  if (!domestic) {
    throw new InboundError('unsupported-tax-rate',
      `a domestic VAT rate of ${rate.percent} % has no SKR03 mapping in this dialect (known: 19, 7, 0). A new rate is an edit to the chart of accounts and this table, in a commit someone signs — not a fallback account.`);
  }
  return { ...domestic, ratePercent: rate.percent };
}

// ---------------------------------------------------------------------------------------------
// Order normalisation — REST Admin API and GraphQL Admin API shapes into one internal form
// ---------------------------------------------------------------------------------------------

function fail(code, message) {
  throw new InboundError(code, message);
}

/** A count, never a float: BigInt from an integer JSON number or a decimal string. */
function toCount(value, field) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number') {
    try { return BigInt(value); } catch { /* falls through to the refusal */ }
  }
  return fail('bad-quantity', `${field}: quantity must be a whole number, got ${JSON.stringify(value)}`);
}

/** REST wraps its payload in `{ order: … }`; GraphQL does not. Accept both, detect the dialect. */
function unwrap(payload) {
  if (!payload || typeof payload !== 'object') {
    fail('not-an-order', 'the payload is not a Shopify order object');
  }
  const raw = payload.order && typeof payload.order === 'object' ? payload.order : payload;
  const graphql = typeof raw.id === 'string' && raw.id.startsWith('gid://');
  return { raw, graphql };
}

/** The numeric external id: REST sends it as a JSON number, GraphQL inside the gid URI. */
function sourceIdOf(raw, graphql) {
  if (graphql) {
    const tail = String(raw.id).split('/').pop();
    if (!/^\d+$/.test(tail)) fail('bad-source-id', `cannot read the order id out of ${JSON.stringify(raw.id)}`);
    return tail;
  }
  if (typeof raw.id === 'number' || typeof raw.id === 'string') {
    const text = String(raw.id);
    if (/^\d+$/.test(text)) return text;
  }
  return fail('bad-source-id', `the order id must be an integer (REST) or a gid:// URI (GraphQL), got ${JSON.stringify(raw.id)}`);
}

/** Line items: REST `line_items`, GraphQL `lineItems` as either edges/node or nodes. */
function rawLineItems(raw) {
  const list = raw.line_items
    ?? (raw.lineItems && Array.isArray(raw.lineItems.edges)
      ? raw.lineItems.edges.map((e) => e && e.node)
      : raw.lineItems && raw.lineItems.nodes);
  if (!Array.isArray(list) || list.length === 0) {
    fail('no-line-items', 'an order with no line items has nothing to invoice');
  }
  return list;
}

function lineUnitPriceValue(li, graphql) {
  return graphql
    ? (li.originalUnitPriceSet ?? li.originalUnitPrice ?? li.discountedUnitPriceSet)
    : li.price;
}

function lineRatePercent(li, graphql, field) {
  const taxLines = li.tax_lines ?? li.taxLines;
  if (!Array.isArray(taxLines) || taxLines.length === 0) {
    return { percent: '0', scaled: 0n };
  }
  const first = taxLines[0];
  return graphql
    ? normalizeRatePercent(first.ratePercentage ?? first.rate,
      first.ratePercentage !== undefined && first.ratePercentage !== null ? 'percent' : 'fraction',
      `${field}.taxLines[0]`)
    : normalizeRatePercent(first.rate, 'fraction', `${field}.tax_lines[0]`);
}

/**
 * Normalise a Shopify order payload — REST Admin API order resource or GraphQL Admin API `Order`
 * — into the internal form everything downstream works on. Every monetary field is a BigInt count
 * of minor units the moment it crosses the boundary.
 *
 * @param {object} payload
 * @param {{ homeCountry?: string }} [options]
 */
export function normalizeOrder(payload, options = {}) {
  const homeCountry = options.homeCountry ?? 'DE';
  const { raw, graphql } = unwrap(payload);

  const sourceId = sourceIdOf(raw, graphql);
  const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : `#${sourceId}`;
  const reference = `Shopify ${name}`;

  const currency = raw.currency
    ?? raw.presentmentCurrencyCode
    ?? (raw.totalPriceSet && raw.totalPriceSet.shopMoney && raw.totalPriceSet.shopMoney.currencyCode);
  if (typeof currency !== 'string') {
    fail('missing-currency', 'the order carries no currency (REST `currency`, GraphQL `presentmentCurrencyCode`)');
  }
  scaleOf(currency); // unknown currency: loud, here, before a single amount is parsed

  const totalMinor = parseShopifyMinor(raw.total_price ?? raw.totalPriceSet, currency, 'total_price');
  const subtotalMinor = parseShopifyMinor(raw.subtotal_price ?? raw.subtotalPriceSet, currency, 'subtotal_price');
  const totalTaxMinor = parseShopifyMinor(raw.total_tax ?? raw.totalTaxSet, currency, 'total_tax');
  const totalDiscountsMinor = parseShopifyMinor(
    raw.total_discounts ?? raw.totalDiscountsSet ?? '0', currency, 'total_discounts');

  const financialStatus = String(
    raw.financial_status ?? raw.displayFinancialStatus ?? '',
  ).toLowerCase();
  if (financialStatus === '') {
    fail('missing-financial-status', 'the order carries no financial_status / displayFinancialStatus');
  }

  const createdAt = String(raw.created_at ?? raw.createdAt ?? '');
  const orderDate = /^\d{4}-\d{2}-\d{2}/.test(createdAt) ? createdAt.slice(0, 10) : null;
  if (orderDate === null) {
    fail('bad-created-at', `the order's created_at must start with an ISO date, got ${JSON.stringify(createdAt)}`);
  }

  const shipping = raw.shipping_address ?? raw.shippingAddress ?? null;
  const destinationCountry = shipping
    ? (shipping.country_code ?? shipping.countryCodeV2 ?? shipping.countryCode ?? null)
    : null;

  const customer = raw.customer && typeof raw.customer === 'object' ? raw.customer : null;
  const customerId = customer
    ? String(customer.id ?? '').split('/').pop() || null
    : null;

  // ---- lines, at undiscounted gross: quantity × unit price, exact by BigInt multiplication.
  const lines = rawLineItems(raw).map((li, i) => {
    const field = `line_items[${String(i)}]`;
    const quantity = toCount(li.quantity, `${field}.quantity`);
    if (quantity === 0n) fail('bad-quantity', `${field}.quantity is zero — nothing to invoice`);
    const unitMinor = parseShopifyMinor(lineUnitPriceValue(li, graphql), currency, `${field}.price`);
    return {
      title: String(li.title ?? li.name ?? `line ${String(i + 1)}`),
      quantity,
      unitMinor,
      grossMinor: unitMinor * quantity,
      rate: lineRatePercent(li, graphql, field),
    };
  });

  // ---- discount_applications (Answer 4). REST carries them with per-application amounts that
  // must agree with total_discounts; GraphQL carries only the total, which is what we allocate.
  const discountApps = raw.discount_applications
    ?? (raw.discountApplications && (raw.discountApplications.edges
      ? raw.discountApplications.edges.map((e) => e && e.node)
      : raw.discountApplications.nodes))
    ?? [];
  if (!graphql && discountApps.length > 0) {
    let declared = 0n;
    for (const [i, app] of discountApps.entries()) {
      declared += parseShopifyMinor(app.amount, currency, `discount_applications[${String(i)}].amount`);
    }
    if (declared !== totalDiscountsMinor) {
      fail('discount-mismatch',
        `the discount_applications amounts sum to ${moneyToken(declared, currency)} but total_discounts says ${moneyToken(totalDiscountsMinor, currency)} — an order that disagrees with itself about its own discount is refused, not reconciled by guessing`);
    }
  }

  // ---- order-level tax lines; their sum must be the order's total_tax.
  const rawTaxLines = raw.tax_lines ?? raw.taxLines ?? [];
  const taxLines = rawTaxLines.map((tl, i) => ({
    title: String(tl.title ?? ''),
    rate: graphql
      ? normalizeRatePercent(tl.ratePercentage ?? tl.rate,
        tl.ratePercentage !== undefined && tl.ratePercentage !== null ? 'percent' : 'fraction',
        `taxLines[${String(i)}]`)
      : normalizeRatePercent(tl.rate, 'fraction', `tax_lines[${String(i)}]`),
    taxMinor: parseShopifyMinor(tl.price ?? tl.priceSet, currency, `tax_lines[${String(i)}].price`),
  }));
  let taxSum = 0n;
  for (const tl of taxLines) taxSum += tl.taxMinor;
  if (taxSum !== totalTaxMinor) {
    fail('tax-mismatch',
      `the tax_lines sum to ${moneyToken(taxSum, currency)} but total_tax says ${moneyToken(totalTaxMinor, currency)} — refusing to book tax the order cannot account for`);
  }

  // ---- the arithmetic identity the whole document stands on.
  let grossSum = 0n;
  for (const line of lines) grossSum += line.grossMinor;
  if (grossSum !== subtotalMinor) {
    fail('subtotal-mismatch',
      `the line items sum to ${moneyToken(grossSum, currency)} but subtotal_price says ${moneyToken(subtotalMinor, currency)}. The usual cause is line-level discount allocations already folded into the subtotal, which this dialect refuses to second-guess (order-level discount_applications are supported and re-allocated exactly).`);
  }
  const shippingLines = raw.shipping_lines ?? raw.shippingLines ?? [];
  const shippingMinor = shippingLines.reduce(
    (acc, sl, i) => acc + parseShopifyMinor(sl.price ?? sl.priceSet, currency, `shipping_lines[${String(i)}].price`),
    0n);
  if (shippingMinor !== 0n) {
    fail('shipping-unsupported',
      `the order carries ${moneyToken(shippingMinor, currency)} of shipping charges. Charged shipping is revenue with its own VAT questions and this dialect does not guess at them — extend the decision record first.`);
  }
  const netMinor = subtotalMinor - totalDiscountsMinor;
  if (netMinor + totalTaxMinor !== totalMinor) {
    fail('total-mismatch',
      `subtotal − discounts + tax is ${moneyToken(netMinor + totalTaxMinor, currency)} but total_price says ${moneyToken(totalMinor, currency)}. The order is internally inconsistent and is refused rather than repaired.`);
  }

  return {
    sourceSystem: SOURCE_SYSTEM,
    sourceId,
    reference,
    name,
    currency,
    financialStatus,
    orderDate,
    destinationCountry,
    homeCountry,
    customer: customer ? {
      id: customerId,
      email: typeof customer.email === 'string' ? customer.email : null,
      name: [customer.first_name ?? customer.firstName, customer.last_name ?? customer.lastName]
        .filter(Boolean).join(' ') || (typeof customer.displayName === 'string' ? customer.displayName : null),
    } : null,
    gateway: (Array.isArray(raw.payment_gateway_names) && raw.payment_gateway_names[0])
      ?? (Array.isArray(raw.paymentGatewayNames) && raw.paymentGatewayNames[0])
      ?? null,
    lines,
    discounts: discountApps.map((app, i) => ({
      kind: String(app.type ?? app.__typename ?? 'discount'),
      description: String(app.code ?? app.title ?? app.description ?? `discount ${String(i + 1)}`),
      ...(graphql ? {} : { amountMinor: parseShopifyMinor(app.amount, currency, `discount_applications[${String(i)}].amount`) }),
    })),
    totalDiscountsMinor,
    taxLines,
    subtotalMinor,
    netMinor,
    totalTaxMinor,
    totalMinor,
  };
}

// ---------------------------------------------------------------------------------------------
// Answer 4 — largest-remainder discount allocation, exact by construction
// ---------------------------------------------------------------------------------------------

/**
 * Allocate the order-level discount across the lines, weighted by line gross, largest remainder.
 * The parts sum to the discount exactly — `runtime/money/money.js` checks the invariant before
 * returning — so the line nets sum to the order net exactly.
 *
 * @returns {bigint[]} one allocated discount per line, in line order
 */
export function allocateDiscount(discountMinor, lines, currency) {
  if (discountMinor === 0n) return lines.map(() => 0n);
  const weights = lines.map((l) => l.grossMinor);
  const parts = allocateMoney(fromMinor(discountMinor, currency), weights, 'half-up');
  return parts.map((p) => p.minor);
}

// ---------------------------------------------------------------------------------------------
// The canonical domain documents
// ---------------------------------------------------------------------------------------------

/** The document id a given foreign order will always produce. Deterministic, never invented. */
export function documentIdFor(sourceId) {
  return `shopify-order-${sourceId}`;
}

/**
 * The customer subledger account (10000–59999 ⊂ 10000–69999) for an order: derived from the
 * Shopify customer id when there is one, else from the order id. Deterministic, so the same
 * customer always lands on the same account and a replayed order derives the same document.
 */
export function customerAccountFor(order) {
  const basis = order.customer && order.customer.id && /^\d+$/.test(order.customer.id)
    ? BigInt(order.customer.id)
    : BigInt(order.sourceId);
  return (SUBLEDGER_BASE + (basis % SUBLEDGER_SPAN)).toString();
}

/**
 * Translate a normalised order into the canonical domain documents: the sales invoice, the
 * journal entry that posts it, and — for `financial_status: "paid"` — the payment that clears it.
 * All amounts are FD-1 canonical tokens; the structure is deterministic in every field and order
 * of keys, so the same foreign event produces the same bytes on any peer.
 *
 * @returns {{ invoice: object, journalEntry: object, payment: object|null }}
 */
export function orderToDocuments(order) {
  const currency = order.currency;
  const token = (minor) => moneyToken(minor, currency);
  const where = { destinationCountry: order.destinationCountry, homeCountry: order.homeCountry };

  // Classify every line, then allocate the discount across them in one exact pass.
  const classes = order.lines.map((line) => taxClassFor(line.rate, where));
  const discounts = allocateDiscount(order.totalDiscountsMinor, order.lines, currency);

  const lines = order.lines.map((line, i) => ({
    position: i + 1,
    title: line.title,
    quantity: line.quantity.toString(),
    'unit-price': token(line.unitMinor),
    gross: token(line.grossMinor),
    discount: token(discounts[i]),
    net: token(line.grossMinor - discounts[i]),
    'tax-rate': classes[i].ratePercent,
    'vat-treatment': classes[i].treatment,
    account: classes[i].revenueAccount,
  }));

  // Group by (treatment, rate): one revenue leg and one VAT leg per group, ordered by rate
  // descending — deterministic, and the order an auditor expects.
  const groups = new Map();
  order.lines.forEach((line, i) => {
    const cls = classes[i];
    const key = `${cls.treatment}|${cls.ratePercent}`;
    if (!groups.has(key)) {
      groups.set(key, { ...cls, scaled: line.rate.scaled, baseMinor: 0n, taxMinor: 0n });
    }
    groups.get(key).baseMinor += line.grossMinor - discounts[i];
  });
  for (const tl of order.taxLines) {
    // The order's tax lines are stated per rate; OSS and domestic never share a rate in one
    // order (the treatment is per destination), so rate alone identifies the group.
    const match = [...groups.values()].filter((g) => g.ratePercent === tl.rate.percent);
    if (match.length !== 1) {
      fail('tax-line-ungroupable',
        `the order states ${moneyToken(tl.taxMinor, currency)} of tax at ${tl.rate.percent} %, but ${match.length === 0 ? 'no' : 'more than one'} line group carries that rate — refusing to assign tax to revenue by guessing`);
    }
    match[0].taxMinor += tl.taxMinor;
  }
  const vatBreakdown = [...groups.values()]
    .sort((a, b) => (a.scaled > b.scaled ? -1 : a.scaled < b.scaled ? 1 : 0))
    .map((g) => ({
      rate: g.ratePercent,
      treatment: g.treatment,
      base: token(g.baseMinor),
      tax: token(g.taxMinor),
      'revenue-account': g.revenueAccount,
      'vat-account': g.vatAccount,
    }));

  const customerAccount = customerAccountFor(order);
  const invoiceId = documentIdFor(order.sourceId);
  const paid = order.financialStatus === 'paid';

  const invoice = {
    'source-system': order.sourceSystem,
    'source-id': order.sourceId,
    reference: order.reference,
    'order-date': order.orderDate,
    currency,
    customer: order.customer
      ? (order.customer.email ?? `shopify-customer-${order.customer.id ?? order.sourceId}`)
      : `shopify-customer-${order.sourceId}`,
    'customer-name': order.customer && order.customer.name ? order.customer.name : null,
    'customer-account': customerAccount,
    'destination-country': order.destinationCountry,
    'financial-status': order.financialStatus,
    lines,
    discounts: order.discounts.map((d) => ({
      kind: d.kind,
      description: d.description,
      ...(d.amountMinor !== undefined ? { amount: token(d.amountMinor) } : {}),
    })),
    'total-discounts': token(order.totalDiscountsMinor),
    'net-amount': token(order.netMinor),
    'vat-amount': token(order.totalTaxMinor),
    'gross-amount': token(order.totalMinor),
    'vat-breakdown': vatBreakdown,
    ...(paid ? {} : {
      'open-item': {
        account: customerAccount,
        amount: token(order.totalMinor),
        status: 'open',
        since: order.orderDate,
      },
    }),
  };

  // The booking, per operating-model/processes/invoice-posting.md: debit the customer with what
  // they owe including tax; credit revenue with the net; credit the tax authority with the tax.
  const postings = [{
    position: 1,
    side: 'debit',
    account: customerAccount,
    amount: token(order.totalMinor),
    role: 'receivable',
    customer: invoice.customer,
  }];
  let position = 2;
  for (const g of vatBreakdown) {
    postings.push({
      position: position++,
      side: 'credit',
      account: g['revenue-account'],
      amount: g.base,
      role: 'revenue',
      'tax-rate': g.rate,
      'vat-treatment': g.treatment,
    });
    if (g['vat-account'] !== null && g.tax !== token(0n)) {
      postings.push({
        position: position++,
        side: 'credit',
        account: g['vat-account'],
        amount: g.tax,
        role: 'output-vat',
        'tax-rate': g.rate,
        'tax-base': g.base,
      });
    }
  }
  const journalEntry = {
    'source-system': order.sourceSystem,
    'source-id': order.sourceId,
    reference: order.reference,
    'entry-date': order.orderDate,
    'document-date': order.orderDate,
    currency,
    description: `${order.reference} — sale per ${order.reference.toLowerCase()}`,
    'source-document-type': 'sales-invoice',
    'source-document-reference': invoiceId,
    postings,
    'debit-amount': token(order.totalMinor),
    'credit-amount': token(order.totalMinor),
    'posting-count': postings.length,
  };

  // Answer 5, paid half: debit the payment-service clearing account, credit the customer — the
  // receivable is gone and the money is with Shopify Payments until payout.
  const payment = paid ? {
    'source-system': order.sourceSystem,
    'source-id': order.sourceId,
    reference: order.reference,
    'payment-date': order.orderDate,
    currency,
    amount: token(order.totalMinor),
    gateway: order.gateway ?? 'unknown',
    'clears-invoice': invoiceId,
    postings: [
      {
        position: 1, side: 'debit', account: CLEARING_ACCOUNT,
        amount: token(order.totalMinor), role: 'clearing',
      },
      {
        position: 2, side: 'credit', account: customerAccount,
        amount: token(order.totalMinor), role: 'receivable-clearance',
      },
    ],
  } : null;

  return { invoice, journalEntry, payment };
}

// ---------------------------------------------------------------------------------------------
// Answer 1 — ingestion through the real kernel, idempotent by (source-system, source-id)
// ---------------------------------------------------------------------------------------------

/**
 * The register lookup, in both directions: the document carries `source-system`/`source-id`, so
 * "given an external id, find the canonical document" is one predicate over the read index, and
 * "given a document, where did it come from" is a field read. There is no second register to
 * disagree with the git history.
 *
 * @param {object} query the kernel's read index (`kernel.query`)
 * @param {string} sourceSystem
 * @param {string} sourceId
 * @param {string} [entity]
 * @returns {object|null} the stored document, or null
 */
export function findBySource(query, sourceSystem, sourceId, entity = 'invoice') {
  const found = query.where(entity, (d) => d['source-system'] === sourceSystem
    && d['source-id'] === sourceId);
  return found.length ? found[0] : null;
}

/**
 * Ingest one Shopify order payload into a workspace, through the real kernel path: parse,
 * normalise, map, then `kernel.perform` — one signed, rule-checked commit per document.
 *
 * Idempotent (Answer 1): if `(source-system, source-id)` is already recorded, the existing
 * document is returned and NOTHING is committed — no duplicate document, no duplicate ledger
 * entry, no new fact.
 *
 * @param {object} kernel an open workspace (`runtime/kernel.js`)
 * @param {object} payload REST order (or `{ order }`) or GraphQL `Order`
 * @param {object} [options]
 * @param {string} [options.homeCountry='DE']
 * @param {string} [options.entity='invoice'] invoice entity name in this company's model
 * @param {string} [options.journalEntity='journal-entry']
 * @param {string} [options.paymentEntity='payment']
 * @param {string[]} [options.actorRoles] forwarded to `kernel.perform`
 * @returns {Promise<{ created: boolean, sourceSystem: string, sourceId: string, reference: string,
 *   document: object, commits: string[], journalEntry: object|null, payment: object|null }>}
 */
export async function ingestShopifyOrder(kernel, payload, options = {}) {
  const entity = options.entity ?? 'invoice';
  const journalEntity = options.journalEntity ?? 'journal-entry';
  const paymentEntity = options.paymentEntity ?? 'payment';
  const actorRoles = Array.isArray(options.actorRoles) ? { actorRoles: options.actorRoles } : {};

  const order = normalizeOrder(payload, options);

  const existing = findBySource(kernel.query, order.sourceSystem, order.sourceId, entity);
  if (existing) {
    return {
      created: false,
      sourceSystem: order.sourceSystem,
      sourceId: order.sourceId,
      reference: order.reference,
      document: existing,
      commits: [],
      journalEntry: findBySource(kernel.query, order.sourceSystem, order.sourceId, journalEntity),
      payment: findBySource(kernel.query, order.sourceSystem, order.sourceId, paymentEntity),
    };
  }

  const { invoice, journalEntry, payment } = orderToDocuments(order);
  const invoiceId = documentIdFor(order.sourceId);
  const commits = [];

  const write = async (ent, id, doc, what) => {
    const result = await kernel.perform({
      op: 'create', entity: ent, id, doc, ...actorRoles,
      message: `Ingest ${order.reference} (${order.sourceId}) — ${what}`,
    });
    if (result && result.rejected) {
      const reasons = result.rejected.map((r) => r.reason ?? String(r)).join('\n');
      throw new InboundError('kernel-rejected',
        `the operating model refused to record the ${what} for ${order.reference}:\n${reasons}`);
    }
    commits.push(result.oid);
    return result;
  };

  await write(entity, invoiceId, invoice, 'sales invoice');
  await write(journalEntity, `${invoiceId}-booking`, journalEntry, 'journal entry');
  if (payment) {
    await write(paymentEntity, `${invoiceId}-payment`, payment, 'payment');
  }

  return {
    created: true,
    sourceSystem: order.sourceSystem,
    sourceId: order.sourceId,
    reference: order.reference,
    document: kernel.query.get(entity, invoiceId),
    commits,
    journalEntry: kernel.query.get(journalEntity, `${invoiceId}-booking`),
    payment: payment ? kernel.query.get(paymentEntity, `${invoiceId}-payment`) : null,
  };
}
