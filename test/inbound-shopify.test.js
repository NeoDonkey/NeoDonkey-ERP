// test/inbound-shopify.test.js — the inbound dialect: Shopify orders in, domain documents out.
//
// Covers GitHub issues #118 and #119 against the binding decision record
// docs/decisions/2026-08-19-inbound-dialect-shopify-order-mapping-and-idempotency.md:
//
//   Answer 2 — strict string → BigInt minor-unit parsing, every float-shaped thing refused loudly;
//   Answer 3 — tax_lines → SKR03 (19 % → 8400/1776, 7 % → 8300/1771, OSS destination → 8336/1791);
//   Answer 4 — discount_applications allocated largest-remainder, line nets summing EXACTLY to the
//              order net (including the case naive rounding leaves a cent short);
//   Answer 5 — financial_status "paid" → payment through the 1370 clearing account; anything else
//              → an OPOS open item on the customer subledger account (10000–69999);
//   Answer 1 — ingestion through the REAL kernel (signed commits via kernel.perform), idempotent
//              on (source-system, source-id): a replay returns the existing document and commits
//              nothing, and the same foreign event in two fresh workspaces produces byte-identical
//              commits.
//
// Zero dependencies. `node --test test/inbound-shopify.test.js`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { memFs } from '../runtime/git/fs.js';
import {
  generateIdentity, exportPrivateJwk, importPrivateJwk,
} from '../runtime/identity/ed25519.js';
import { open } from '../runtime/kernel.js';
import { scanSources } from './_source-guard.js';

import {
  InboundError, SOURCE_SYSTEM,
  parseShopifyMinor, moneyToken, normalizeRatePercent, taxClassFor,
  normalizeOrder, allocateDiscount, orderToDocuments,
  documentIdFor, customerAccountFor, findBySource, ingestShopifyOrder,
} from '../runtime/inbound/shopify.js';

// =============================================================================================
// Fixtures — constructed field-for-field from the Shopify Admin API order schemas:
// REST (admin-rest/current/resources/order): id, name, created_at, currency, financial_status,
// total_price, subtotal_price, total_tax, total_discounts, tax_lines[rate, price],
// discount_applications[type, value, allocation_method, amount], line_items[quantity, price,
// tax_lines], shipping_address.country_code, customer, payment_gateway_names.
// GraphQL (Order object): gid id, name, createdAt, displayFinancialStatus, MoneyV2 *Set fields,
// taxLines[ratePercentage, priceSet], lineItems { edges { node } }, shippingAddress.countryCodeV2.
// Every fixture is internally consistent: subtotal − discounts + tax === total, to the cent.
// =============================================================================================

/** A paid domestic order at 19 % with one order-level "across" discount. */
const REST_PAID_19 = {
  id: 5628190318720,
  name: '#1001',
  created_at: '2026-08-20T14:35:12+02:00',
  currency: 'EUR',
  financial_status: 'paid',
  total_price: '53.54',
  subtotal_price: '49.99',
  total_tax: '8.55',
  total_discounts: '5.00',
  payment_gateway_names: ['shopify_payments'],
  tax_lines: [{ title: 'MwSt', rate: 0.19, price: '8.55' }],
  discount_applications: [{
    type: 'discount_code', code: 'SOMMER5', value_type: 'fixed_amount', value: '5.00',
    allocation_method: 'across', target_type: 'line_item', target_selection: 'all',
    amount: '5.00',
  }],
  line_items: [
    {
      id: 14245846753536, title: 'Cashewkerne natur 1kg', sku: 'CK-1KG',
      quantity: 1, price: '29.99',
      tax_lines: [{ title: 'MwSt', rate: 0.19, price: '5.13' }],
    },
    {
      id: 14245846786304, title: 'Mandeln geröstet 500g', sku: 'MA-500',
      quantity: 2, price: '10.00',
      tax_lines: [{ title: 'MwSt', rate: 0.19, price: '3.42' }],
    },
  ],
  shipping_address: { country_code: 'DE', city: 'München' },
  customer: {
    id: 7311676961024, email: 'lisa@example.de', first_name: 'Lisa', last_name: 'Berg',
  },
};

/** The same order as the GraphQL Admin API returns it — MoneyV2 everywhere, gid identifiers. */
const GQL_PAID_19 = {
  id: 'gid://shopify/Order/5628190318720',
  name: '#1001',
  createdAt: '2026-08-20T14:35:12+02:00',
  presentmentCurrencyCode: 'EUR',
  displayFinancialStatus: 'PAID',
  totalPriceSet: { shopMoney: { amount: '53.54', currencyCode: 'EUR' } },
  subtotalPriceSet: { shopMoney: { amount: '49.99', currencyCode: 'EUR' } },
  totalTaxSet: { shopMoney: { amount: '8.55', currencyCode: 'EUR' } },
  totalDiscountsSet: { shopMoney: { amount: '5.00', currencyCode: 'EUR' } },
  paymentGatewayNames: ['shopify_payments'],
  taxLines: [{
    title: 'MwSt', ratePercentage: 19.0,
    priceSet: { shopMoney: { amount: '8.55', currencyCode: 'EUR' } },
  }],
  discountApplications: {
    edges: [{
      node: {
        __typename: 'DiscountCodeApplication', code: 'SOMMER5',
        allocationMethod: 'ACROSS', targetType: 'LINE_ITEM', targetSelection: 'ALL',
      },
    }],
  },
  lineItems: {
    edges: [
      {
        node: {
          id: 'gid://shopify/LineItem/14245846753536',
          title: 'Cashewkerne natur 1kg', sku: 'CK-1KG', quantity: 1,
          originalUnitPriceSet: { shopMoney: { amount: '29.99', currencyCode: 'EUR' } },
          taxLines: [{
            ratePercentage: 19.0,
            priceSet: { shopMoney: { amount: '5.13', currencyCode: 'EUR' } },
          }],
        },
      },
      {
        node: {
          id: 'gid://shopify/LineItem/14245846786304',
          title: 'Mandeln geröstet 500g', sku: 'MA-500', quantity: 2,
          originalUnitPriceSet: { shopMoney: { amount: '10.00', currencyCode: 'EUR' } },
          taxLines: [{
            ratePercentage: 19.0,
            priceSet: { shopMoney: { amount: '3.42', currencyCode: 'EUR' } },
          }],
        },
      },
    ],
  },
  shippingAddress: { countryCodeV2: 'DE', city: 'München' },
  customer: {
    id: 'gid://shopify/Customer/7311676961024',
    email: 'lisa@example.de', firstName: 'Lisa', lastName: 'Berg', displayName: 'Lisa Berg',
  },
};

/**
 * An unpaid order at 7 % with a 10.00 discount over THREE equal lines — the case where naive
 * per-line rounding (3.33 × 3 = 9.99) leaves the lines a cent short of the order, and only
 * largest-remainder (3.34 / 3.33 / 3.33) closes exactly.
 */
const REST_UNPAID_7 = {
  id: 5628190384256,
  name: '#1002',
  created_at: '2026-08-20T16:02:41+02:00',
  currency: 'EUR',
  financial_status: 'pending',
  total_price: '21.40',
  subtotal_price: '30.00',
  total_tax: '1.40',
  total_discounts: '10.00',
  tax_lines: [{ title: 'MwSt ermäßigt', rate: 0.07, price: '1.40' }],
  discount_applications: [{
    type: 'manual', title: 'Stammkunden-Rabatt', value_type: 'fixed_amount', value: '10.00',
    allocation_method: 'across', target_type: 'line_item', target_selection: 'all',
    amount: '10.00',
  }],
  line_items: [
    { id: 14245853102336, title: 'Studentenfutter 1kg', quantity: 1, price: '10.00',
      tax_lines: [{ title: 'MwSt ermäßigt', rate: 0.07, price: '0.47' }] },
    { id: 14245853135104, title: 'Paranüsse 1kg', quantity: 1, price: '10.00',
      tax_lines: [{ title: 'MwSt ermäßigt', rate: 0.07, price: '0.47' }] },
    { id: 14245853167872, title: 'Macadamia 1kg', quantity: 1, price: '10.00',
      tax_lines: [{ title: 'MwSt ermäßigt', rate: 0.07, price: '0.46' }] },
  ],
  shipping_address: { country_code: 'DE' },
  customer: { id: 7311676961024, email: 'lisa@example.de', first_name: 'Lisa', last_name: 'Berg' },
};

/** A paid B2C order shipped to France: an OSS distance sale at the French destination rate 20 %. */
const REST_PAID_OSS_FR = {
  id: 5628190416992,
  name: '#1003',
  created_at: '2026-08-21T09:12:05+02:00',
  currency: 'EUR',
  financial_status: 'paid',
  total_price: '12.00',
  subtotal_price: '10.00',
  total_tax: '2.00',
  total_discounts: '0.00',
  payment_gateway_names: ['paypal'],
  tax_lines: [{ title: 'TVA', rate: 0.2, price: '2.00' }],
  discount_applications: [],
  line_items: [
    { id: 14245857861888, title: 'Pekanüsse 500g', quantity: 1, price: '10.00',
      tax_lines: [{ title: 'TVA', rate: 0.2, price: '2.00' }] },
  ],
  shipping_address: { country_code: 'FR', city: 'Lyon' },
  customer: { id: 7311680375040, email: 'claire@example.fr', first_name: 'Claire', last_name: 'Dubois' },
};

// =============================================================================================
// Answer 2 — strict monetary parsing
// =============================================================================================

test('parseShopifyMinor: string → exact BigInt minor units, never a float', () => {
  assert.equal(parseShopifyMinor('29.99', 'EUR'), 2999n);
  assert.equal(parseShopifyMinor('0.05', 'EUR'), 5n);
  assert.equal(parseShopifyMinor('119.00', 'EUR'), 11900n);
  assert.equal(parseShopifyMinor('1000', 'JPY'), 1000n);        // zero-decimal currency
  assert.equal(parseShopifyMinor('1.500', 'TND'), 1500n);       // three-decimal currency
  assert.equal(parseShopifyMinor('-12.00', 'EUR'), -1200n);
  // The boundary decision runtime/money/README.md requires: foreign negative zero → zero, here.
  assert.equal(parseShopifyMinor('-0.00', 'EUR'), 0n);
  // GraphQL MoneyV2 and *Set wrappers parse identically.
  assert.equal(parseShopifyMinor({ amount: '29.99', currencyCode: 'EUR' }, 'EUR'), 2999n);
  assert.equal(
    parseShopifyMinor({ shopMoney: { amount: '53.54', currencyCode: 'EUR' } }, 'EUR'), 5354n);
});

test('parseShopifyMinor: everything float-shaped or imprecise is refused loudly', () => {
  // A JSON number in a monetary field means the payload was damaged by a float before it arrived.
  assert.throws(() => parseShopifyMinor(29.99, 'EUR'),
    (e) => e instanceof InboundError && e.code === 'money-as-number');
  // Three decimals in a two-decimal currency: refusing, not rounding.
  assert.throws(() => parseShopifyMinor('29.999', 'EUR'),
    (e) => e.code === 'money-overprecision');
  assert.throws(() => parseShopifyMinor('0.001', 'EUR'),
    (e) => e.code === 'money-overprecision');
  // Unparseable strings, missing values, other types.
  assert.throws(() => parseShopifyMinor('abc', 'EUR'), (e) => e.code === 'money-unparseable');
  assert.throws(() => parseShopifyMinor('29,99', 'EUR'), (e) => e.code === 'money-unparseable');
  assert.throws(() => parseShopifyMinor(null, 'EUR'), (e) => e.code === 'money-not-a-string');
  // A MoneyV2 disagreeing with the order's currency.
  assert.throws(
    () => parseShopifyMinor({ amount: '29.99', currencyCode: 'USD' }, 'EUR'),
    (e) => e.code === 'currency-mismatch');
  // An unknown currency is refused by the ISO 4217 table, never guessed at scale 2.
  assert.throws(() => parseShopifyMinor('29.99', 'XXX'));
  // Round trip into the canonical FD-1 token.
  assert.equal(moneyToken(parseShopifyMinor('29.99', 'EUR'), 'EUR'), '29.99 EUR');
});

test('normalizeRatePercent: REST fractions and GraphQL percents to canonical percent strings', () => {
  assert.deepEqual(normalizeRatePercent(0.19, 'fraction'), { percent: '19', scaled: 190000n });
  assert.deepEqual(normalizeRatePercent('0.07', 'fraction'), { percent: '7', scaled: 70000n });
  assert.deepEqual(normalizeRatePercent(0.2, 'fraction'), { percent: '20', scaled: 200000n });
  assert.deepEqual(normalizeRatePercent(19.0, 'percent'), { percent: '19', scaled: 190000n });
  assert.deepEqual(normalizeRatePercent('20.5', 'percent'), { percent: '20.5', scaled: 205000n });
  assert.throws(() => normalizeRatePercent('abc', 'fraction'), (e) => e.code === 'rate-unparseable');
});

// =============================================================================================
// Answer 3 — the SKR03 tax mapping
// =============================================================================================

test('taxClassFor: domestic 19 %/7 %/0 %, OSS destination rates, and loud refusals', () => {
  const de = { destinationCountry: 'DE', homeCountry: 'DE' };
  assert.deepEqual(taxClassFor({ percent: '19', scaled: 190000n }, de), {
    treatment: 'domestic-standard', revenueAccount: '8400', vatAccount: '1776', ratePercent: '19',
  });
  assert.deepEqual(taxClassFor({ percent: '7', scaled: 70000n }, de), {
    treatment: 'domestic-reduced', revenueAccount: '8300', vatAccount: '1771', ratePercent: '7',
  });
  const fr = { destinationCountry: 'FR', homeCountry: 'DE' };
  assert.deepEqual(taxClassFor({ percent: '20', scaled: 200000n }, fr), {
    treatment: 'oss-distance-sale', revenueAccount: '8336', vatAccount: '1791', ratePercent: '20',
  });
  // A domestic rate with no mapping is an error, not a fallback account.
  assert.throws(() => taxClassFor({ percent: '5', scaled: 50000n }, de),
    (e) => e.code === 'unsupported-tax-rate');
  // A non-EU destination is an export the dialect does not guess at.
  assert.throws(
    () => taxClassFor({ percent: '0', scaled: 0n }, { destinationCountry: 'US', homeCountry: 'DE' }),
    (e) => e.code === 'unsupported-destination');
});

// =============================================================================================
// Answer 4 — largest-remainder discount allocation
// =============================================================================================

test('allocateDiscount: the cent naive rounding loses', () => {
  const order = normalizeOrder(REST_UNPAID_7);
  assert.equal(order.totalDiscountsMinor, 1000n);
  const parts = allocateDiscount(order.totalDiscountsMinor, order.lines, 'EUR');
  // Largest remainder: 3.34 / 3.33 / 3.33, summing to 10.00 EXACTLY.
  assert.deepEqual(parts, [334n, 333n, 333n]);
  const sum = parts.reduce((a, b) => a + b, 0n);
  assert.equal(sum, 1000n);
  // The naive alternative, shown to be wrong: equal half-up shares of 3.33 leave a cent orphaned.
  const naive = 333n;
  assert.notEqual(naive * 3n, 1000n, 'naive equal-share rounding is a cent short — that is the bug');
  // The line nets therefore sum to the order net exactly.
  const docs = orderToDocuments(order);
  const lineNets = docs.invoice.lines.map((l) => l.net);
  assert.deepEqual(lineNets, ['6.66 EUR', '6.67 EUR', '6.67 EUR']);
  assert.equal(docs.invoice['net-amount'], '20.00 EUR');
});

// =============================================================================================
// The canonical documents — REST and GraphQL payloads produce the same accounting substance
// =============================================================================================

test('REST order → canonical sales invoice, journal entry and payment (exact BigInt assertions)', () => {
  const order = normalizeOrder(REST_PAID_19);
  // Origin stamping, Answer 1.
  assert.equal(order.sourceSystem, SOURCE_SYSTEM);
  assert.equal(order.sourceId, '5628190318720');
  assert.equal(order.reference, 'Shopify #1001');
  // Parsed totals, exact.
  assert.equal(order.subtotalMinor, 4999n);
  assert.equal(order.totalDiscountsMinor, 500n);
  assert.equal(order.totalTaxMinor, 855n);
  assert.equal(order.netMinor, 4499n);
  assert.equal(order.totalMinor, 5354n);

  const { invoice, journalEntry, payment } = orderToDocuments(order);

  // Invoice: line-level exactness after allocation.
  assert.equal(invoice['source-system'], 'shopify');
  assert.equal(invoice['source-id'], '5628190318720');
  assert.equal(invoice.reference, 'Shopify #1001');
  assert.equal(invoice.currency, 'EUR');
  assert.deepEqual(invoice.lines.map((l) => [l.gross, l.discount, l.net]), [
    ['29.99 EUR', '3.00 EUR', '26.99 EUR'],
    ['20.00 EUR', '2.00 EUR', '18.00 EUR'],
  ]);
  assert.deepEqual(invoice.lines.map((l) => l.account), ['8400', '8400']);
  assert.equal(invoice['net-amount'], '44.99 EUR');
  assert.equal(invoice['vat-amount'], '8.55 EUR');
  assert.equal(invoice['gross-amount'], '53.54 EUR');
  assert.deepEqual(invoice['vat-breakdown'], [{
    rate: '19', treatment: 'domestic-standard',
    base: '44.99 EUR', tax: '8.55 EUR',
    'revenue-account': '8400', 'vat-account': '1776',
  }]);
  // Paid: no open item.
  assert.equal(invoice['open-item'], undefined);

  // Journal entry: debit customer subledger gross; credit 8400 net and 1776 VAT. Balanced.
  const account = customerAccountFor(order);
  assert.ok(account >= '10000' && account < '60000', 'customer subledger within 10000–69999');
  assert.equal(journalEntry['source-document-type'], 'sales-invoice');
  assert.equal(journalEntry['source-document-reference'], documentIdFor(order.sourceId));
  assert.deepEqual(journalEntry.postings.map((p) => [p.side, p.account, p.amount]), [
    ['debit', account, '53.54 EUR'],
    ['credit', '8400', '44.99 EUR'],
    ['credit', '1776', '8.55 EUR'],
  ]);
  assert.equal(journalEntry['debit-amount'], journalEntry['credit-amount']);

  // Payment: debit the payment-service clearing account 1370, credit the customer. Clears it.
  assert.ok(payment, 'a paid order records a payment');
  assert.equal(payment.amount, '53.54 EUR');
  assert.equal(payment.gateway, 'shopify_payments');
  assert.equal(payment['clears-invoice'], documentIdFor(order.sourceId));
  assert.deepEqual(payment.postings.map((p) => [p.side, p.account, p.amount]), [
    ['debit', '1370', '53.54 EUR'],
    ['credit', account, '53.54 EUR'],
  ]);
});

test('GraphQL order shape → identical accounting substance as REST', () => {
  const rest = orderToDocuments(normalizeOrder(REST_PAID_19));
  const gql = orderToDocuments(normalizeOrder(GQL_PAID_19));
  // The gid is reduced to the same external id; the reference is identical.
  assert.equal(normalizeOrder(GQL_PAID_19).sourceId, '5628190318720');
  // Lines, totals, the VAT breakdown and every posting are byte-identical between the shapes.
  assert.deepEqual(gql.invoice.lines, rest.invoice.lines);
  assert.deepEqual(gql.invoice['vat-breakdown'], rest.invoice['vat-breakdown']);
  for (const f of ['net-amount', 'vat-amount', 'gross-amount', 'total-discounts', 'reference',
    'source-system', 'source-id', 'currency', 'financial-status', 'customer-account']) {
    assert.deepEqual(gql.invoice[f], rest.invoice[f], `invoice.${f}`);
  }
  assert.deepEqual(gql.journalEntry.postings, rest.journalEntry.postings);
  assert.deepEqual(gql.payment.postings, rest.payment.postings);
});

test('unpaid order → OPOS open item on the customer subledger, no payment', () => {
  const { invoice, journalEntry, payment } = orderToDocuments(normalizeOrder(REST_UNPAID_7));
  assert.equal(payment, null, 'an unpaid order records no payment');
  const account = customerAccountFor(normalizeOrder(REST_UNPAID_7));
  assert.deepEqual(invoice['open-item'], {
    account, amount: '21.40 EUR', status: 'open', since: '2026-08-20',
  });
  // 7 % reduced rate: revenue 8300, VAT 1771.
  assert.deepEqual(journalEntry.postings.map((p) => [p.side, p.account, p.amount]), [
    ['debit', account, '21.40 EUR'],
    ['credit', '8300', '20.00 EUR'],
    ['credit', '1771', '1.40 EUR'],
  ]);
  assert.equal(invoice['financial-status'], 'pending');
});

test('OSS destination sale → destination rate on OSS accounts 8336/1791, never 1776', () => {
  const { invoice, journalEntry } = orderToDocuments(normalizeOrder(REST_PAID_OSS_FR));
  assert.deepEqual(invoice['vat-breakdown'], [{
    rate: '20', treatment: 'oss-distance-sale',
    base: '10.00 EUR', tax: '2.00 EUR',
    'revenue-account': '8336', 'vat-account': '1791',
  }]);
  assert.deepEqual(journalEntry.postings.map((p) => p.account), ['23140', '8336', '1791']
    .map((a, i) => (i === 0 ? customerAccountFor(normalizeOrder(REST_PAID_OSS_FR)) : a)));
});

test('internally inconsistent orders are refused, never repaired', () => {
  // tax_lines that do not sum to total_tax.
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, total_tax: '8.56' }),
    (e) => e.code === 'tax-mismatch');
  // discount_applications that disagree with total_discounts.
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, total_discounts: '4.99' }),
    (e) => e.code === 'discount-mismatch');
  // line items that do not sum to subtotal_price (e.g. line-level discounts folded in).
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, subtotal_price: '49.98' }),
    (e) => e.code === 'subtotal-mismatch');
  // a total that is not subtotal − discounts + tax.
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, total_price: '53.55' }),
    (e) => e.code === 'total-mismatch');
  // charged shipping is out of scope and loud about it.
  assert.throws(
    () => normalizeOrder({
      ...REST_PAID_19, shipping_lines: [{ title: 'DHL', price: '4.90' }],
    }),
    (e) => e.code === 'shipping-unsupported');
});

// =============================================================================================
// Answer 1 — ingestion through the real kernel, idempotent and byte-identical
// =============================================================================================

/** Injected, never read — determinism is a non-negotiable (CONTRACT #5). */
function fixedClock() {
  let t = Date.parse('2026-08-21T09:00:00Z');
  return () => (t += 60_000);
}

/**
 * A focused operating model: the three entities the dialect writes, each governed by an entity
 * authority. Deliberately NOT the shipped model — an invoice there needs a sales order, a customer
 * and a VAT treatment to exist first, so a test written against it would fail for reasons that
 * have nothing to do with ingestion. The kernel path underneath is the real one: authorization,
 * rule evaluation, one signed commit per document, the read index.
 */
const INBOUND_MODEL = () => new Map([
  ['operating-model/information/invoice.md',
    '# Invoice\n\nA sales invoice, here from the webshop.\n\n## Fields\n'
    + '- reference: text required\n- currency: text required\n- gross-amount: money required\n'
    + '\n## Authorized by\n- create: accountant\n- read: accountant\n- update: accountant\n'],
  ['operating-model/information/journal-entry.md',
    '# Journal entry\n\nA booking: debits equal credits.\n\n## Fields\n'
    + '- description: text required\n- debit-amount: money required\n- credit-amount: money required\n'
    + '\n## Authorized by\n- create: accountant\n- read: accountant\n- update: accountant\n'],
  ['operating-model/information/payment.md',
    '# Payment\n\nA payment clearing a receivable.\n\n## Fields\n- amount: money required\n'
    + '\n## Authorized by\n- create: accountant\n- read: accountant\n- update: accountant\n'],
  ['operating-model/organisation/accountant.md', '# Accountant\n\nKeeps the books.\n'],
]);

async function workspace({ jwk = null } = {}) {
  const keyPair = jwk
    ? await importPrivateJwk(jwk)
    : await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const nd = await open({
    fs: memFs(),
    identity: { name: 'Sarah Weber', email: 'sarah@neodonkey.eu', keyPair },
    seed: INBOUND_MODEL(), clock: fixedClock(), tzOffsetMinutes: 60,
    roles: ['accountant'],
  });
  assert.deepEqual(nd.modelErrors, [], 'the ingestion model must be executable');
  return { nd, keyPair };
}

test('ingestion commits through the real kernel: signed commits, indexed documents', async () => {
  const { nd } = await workspace();
  assert.equal((await nd.history()).length, 1, 'genesis only');

  const first = await ingestShopifyOrder(nd, REST_PAID_19);
  assert.equal(first.created, true);
  assert.equal(first.commits.length, 3, 'invoice + journal entry + payment, one commit each');
  assert.equal((await nd.history()).length, 4);

  // The stored document is the canonical one, carrying its origin on its face.
  const stored = nd.query.get('invoice', 'shopify-order-5628190318720');
  assert.deepEqual(first.document, stored);
  assert.equal(stored['source-system'], 'shopify');
  assert.equal(stored['source-id'], '5628190318720');
  assert.equal(stored.reference, 'Shopify #1001');
  assert.equal(stored['gross-amount'], '53.54 EUR');

  // Every commit verifies — the ingestion path is the signed-commit path, not a side channel.
  const report = await nd.verify(10);
  assert.ok(report.every((c) => c.signature === 'good' && c.problems.length === 0),
    `all commits must verify: ${JSON.stringify(report)}`);
});

test('idempotent re-ingest: existing document returned, ZERO new commits', async () => {
  const { nd } = await workspace();

  const first = await ingestShopifyOrder(nd, REST_PAID_19);
  const commitsAfterFirst = (await nd.history()).length;

  // A replayed webhook: same payload, and the GraphQL shape of the same order.
  for (const replay of [REST_PAID_19, GQL_PAID_19]) {
    const again = await ingestShopifyOrder(nd, replay);
    assert.equal(again.created, false);
    assert.equal(again.commits.length, 0, 'a replay commits nothing');
    assert.deepEqual(again.document, first.document, 'the existing document is returned');
    assert.equal((await nd.history()).length, commitsAfterFirst,
      'no duplicate document commits, no duplicate ledger entries');
  }

  // Lookup works in both directions.
  const bySource = findBySource(nd.query, 'shopify', '5628190318720');
  assert.deepEqual(bySource, first.document);
  assert.equal(first.document['source-system'], 'shopify');
  assert.equal(first.document['source-id'], '5628190318720');
  // The journal entry and the payment are findable by the same tuple.
  assert.equal(findBySource(nd.query, 'shopify', '5628190318720', 'journal-entry')['source-document-reference'],
    'shopify-order-5628190318720');
  assert.equal(findBySource(nd.query, 'shopify', '5628190318720', 'payment')['clears-invoice'],
    'shopify-order-5628190318720');

  // A different order ingests normally: the guard is the tuple, not the dialect.
  const second = await ingestShopifyOrder(nd, REST_UNPAID_7);
  assert.equal(second.created, true);
  assert.equal(second.commits.length, 2, 'invoice + journal entry; unpaid records no payment');
  assert.equal((await nd.history()).length, commitsAfterFirst + 2);
});

test('same foreign event → byte-identical commits on two independent workspaces', async () => {
  // One identity, imported twice; two workspaces; the same injected clock. Ed25519 is
  // deterministic, so identical payload bytes give an identical signature — the commit oids are
  // the whole statement.
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const jwk = await exportPrivateJwk(keyPair);

  const a = await workspace({ jwk });
  const b = await workspace({ jwk });

  const ra = await ingestShopifyOrder(a.nd, REST_PAID_19);
  const rb = await ingestShopifyOrder(b.nd, REST_PAID_19);

  const oidsA = (await a.nd.history(10)).map((c) => c.oid);
  const oidsB = (await b.nd.history(10)).map((c) => c.oid);
  assert.deepEqual(oidsA, oidsB,
    'the same foreign event must produce the same commits on any peer — that is what makes a replayed webhook a non-event');
  assert.deepEqual(ra.commits, rb.commits);

  // And the stored bytes are identical, not merely the oids.
  const path = 'documents/invoice/shopify-order-5628190318720.json';
  assert.deepEqual(a.nd._internals.files.get(path), b.nd._internals.files.get(path));
});

// =============================================================================================
// Source guard — the dialect's monetary path is greppable proof, per gate condition 2's pattern
// =============================================================================================

test('source guard: no float construct anywhere in runtime/inbound/shopify.js', () => {
  const sources = new Map([[
    'runtime/inbound/shopify.js',
    readFileSync(new URL('../runtime/inbound/shopify.js', import.meta.url), 'utf8'),
  ]]);
  const violations = scanSources(sources, [
    ['parseFloat', /\bparseFloat\b/, 'FD-1: money is never parsed through a double'],
    ['parseInt', /\bparseInt\b/, 'parseInt truncates and accepts trailing garbage'],
    ['Number', /\bNumber\b/, 'no Number conversion or predicate in a monetary path'],
    ['toFixed', /\.toFixed\b/, 'toFixed rounds a double'],
    ['Math.', /\bMath\s*\./, 'every Math function is double-valued'],
    ['Date.now', /\bDate\s*\.\s*now\b/, 'time is injected, never read'],
    ['Math.random', /\brandom\b/, 'randomness is injected, never read'],
    ['float literal', /(?:^|[^\w.$])\d+\.\d+/, 'a decimal literal is a double'],
    ['exponent literal', /\b\d+e[+-]?\d+\b/i, 'an exponent literal is a double'],
    ['Number literal as divisor/multiplier', /(\*\*?|\/|%)\s*\d+(?![\dn])/, 'must be BigInt arithmetic'],
  ]);
  assert.deepEqual(violations, [],
    violations.map((v) => `${v.file}:${v.line} ${v.rule}: ${v.text}`).join('\n'));
  // And structurally: no node:* import may ever appear in the runtime.
  const src = sources.get('runtime/inbound/shopify.js');
  assert.ok(!/from\s+'node:/.test(src), 'runtime code never imports node:*');
});
