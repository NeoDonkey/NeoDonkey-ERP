// test/inbound-shopify.test.js — the inbound dialect: Shopify orders in, domain documents out.
//
// Covers GitHub issues #118 and #119 against the binding decision record
// docs/decisions/2026-08-19-inbound-dialect-shopify-order-mapping-and-idempotency.md:
//
//   Answer 2 — strict string → BigInt minor-unit parsing, every float-shaped thing refused loudly;
//   Answer 3 — the VAT treatment resolved from the operating model's vat-treatment DOCUMENTS
//              (accounts are model data, never runtime constants), OSS destination treatment, and
//              a loud refusal when the destination cannot be determined;
//   Answer 4 — discount_applications allocated largest-remainder, line nets summing EXACTLY to the
//              order net (including the case naive rounding leaves a cent short);
//   Answer 5 — financial_status "paid" → payment through the caller-supplied clearing account;
//              anything else → an OPOS open item on a collision-checked customer subledger account;
//   Answer 1 — ingestion through the REAL kernel (signed commits via kernel.perform), idempotent
//              on (source-system, source-id): a replay returns the existing documents and commits
//              nothing, a PARTIAL earlier run is completed, a contradictory stored document is a
//              named refusal, and the same foreign event in two fresh workspaces produces
//              byte-identical commits.
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
  parseShopifyMinor, moneyToken, normalizeRatePercent, selectTreatment, classifyOrder,
  normalizeOrder, allocateDiscount, orderToDocuments,
  documentIdFor, customerAccountFor, findBySource, ingestShopifyOrder,
} from '../runtime/inbound/shopify.js';

// =============================================================================================
// Company policy for these tests, passed explicitly — the dialect has no defaults for any of it.
// The account numbers here are TEST fixtures (the dialect reads them from vat-treatment
// documents); 8400/1776, 8300/1771, 8336/1791 are the values the shipped SKR03 chart assigns.
// =============================================================================================

const OPTS = {
  homeCountry: 'DE',
  clearingAccount: '1370',
  subledger: { base: '10000', size: 50000 },
};

/** vat-treatment documents as a company adopts them (shape per operating-model/information/
 *  vat-treatment.md and test/f2-ledger.test.js). */
const TREATMENT_DOCS = [
  {
    name: 'domestic-standard', 'applies-to': 'sale', 'vat-rate-percent': 19,
    'rate-determined-by': 'origin-country', 'requires-oss-return': false, status: 'active',
    'revenue-account-number': '8400', 'output-vat-account-number': '1776',
  },
  {
    name: 'domestic-reduced', 'applies-to': 'sale', 'vat-rate-percent': 7,
    'rate-determined-by': 'origin-country', 'requires-oss-return': false, status: 'active',
    'revenue-account-number': '8300', 'output-vat-account-number': '1771',
  },
  {
    name: 'oss-distance-sale', 'applies-to': 'sale', 'vat-rate-percent': 20,
    'rate-determined-by': 'destination-country', 'requires-oss-return': true, status: 'active',
    'revenue-account-number': '8336', 'output-vat-account-number': '1791',
  },
];

/** The resolved inputs orderToDocuments needs: model-resolved classes + explicit policy. */
function resolvedFor(order, over = {}) {
  return {
    classes: classifyOrder(order, TREATMENT_DOCS),
    customerAccount: customerAccountFor(order, OPTS.subledger),
    clearingAccount: OPTS.clearingAccount,
    ...over,
  };
}

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
// Answer 3 — treatment resolution against the operating model's documents
// =============================================================================================

test('selectTreatment: accounts come from the model documents, never from the dialect', () => {
  const de = { destinationCountry: 'DE', homeCountry: 'DE' };
  assert.deepEqual(selectTreatment(TREATMENT_DOCS, { percent: '19', scaled: 190000n }, de), {
    treatment: 'domestic-standard', revenueAccount: '8400', vatAccount: '1776', ratePercent: '19',
  });
  assert.deepEqual(selectTreatment(TREATMENT_DOCS, { percent: '7', scaled: 70000n }, de), {
    treatment: 'domestic-reduced', revenueAccount: '8300', vatAccount: '1771', ratePercent: '7',
  });
  // OSS: the destination country's rate is carried verbatim; the accounts are the model's OSS pair.
  const fr = { destinationCountry: 'FR', homeCountry: 'DE' };
  assert.deepEqual(selectTreatment(TREATMENT_DOCS, { percent: '20', scaled: 200000n }, fr), {
    treatment: 'oss-distance-sale', revenueAccount: '8336', vatAccount: '1791', ratePercent: '20',
  });
  // The accounts FOLLOW the model: re-point the treatment and the dialect follows, no code change.
  const repointed = TREATMENT_DOCS.map((t) => (t.name === 'domestic-standard'
    ? { ...t, 'revenue-account-number': '8410', 'output-vat-account-number': '1777' } : t));
  assert.deepEqual(selectTreatment(repointed, { percent: '19', scaled: 190000n }, de), {
    treatment: 'domestic-standard', revenueAccount: '8410', vatAccount: '1777', ratePercent: '19',
  });
});

test('selectTreatment: every gap is a named refusal, never a fallback account', () => {
  const de = { destinationCountry: 'DE', homeCountry: 'DE' };
  // A rate the model has no treatment for.
  assert.throws(() => selectTreatment(TREATMENT_DOCS, { percent: '5', scaled: 50000n }, de),
    (e) => e.code === 'treatment-not-in-model');
  // Two treatments covering the same situation: a model defect, loudly.
  const ambiguous = [...TREATMENT_DOCS, {
    ...TREATMENT_DOCS[0], name: 'domestic-standard-copy',
  }];
  assert.throws(() => selectTreatment(ambiguous, { percent: '19', scaled: 190000n }, de),
    (e) => e.code === 'treatment-ambiguous');
  // A treatment adopted without its account determination.
  const undetermined = TREATMENT_DOCS.map((t) => (t.name === 'domestic-standard'
    ? { ...t, 'revenue-account-number': '' } : t));
  assert.throws(() => selectTreatment(undetermined, { percent: '19', scaled: 190000n }, de),
    (e) => e.code === 'treatment-accounts-undetermined');
  // A retired treatment does not cover anything.
  const retired = TREATMENT_DOCS.map((t) => (t.name === 'domestic-standard'
    ? { ...t, status: 'retired' } : t));
  assert.throws(() => selectTreatment(retired, { percent: '19', scaled: 190000n }, de),
    (e) => e.code === 'treatment-not-in-model');
  // No destination: the jurisdiction cannot be determined — refuse, do not assume domestic.
  assert.throws(
    () => selectTreatment(TREATMENT_DOCS, { percent: '19', scaled: 190000n },
      { destinationCountry: null, homeCountry: 'DE' }),
    (e) => e.code === 'destination-unknown');
  // A non-EU destination is an export the dialect does not guess at (stated v1 boundary).
  assert.throws(
    () => selectTreatment(TREATMENT_DOCS, { percent: '0', scaled: 0n },
      { destinationCountry: 'US', homeCountry: 'DE' }),
    (e) => e.code === 'unsupported-destination');
});

// =============================================================================================
// Answer 4 — largest-remainder discount allocation
// =============================================================================================

test('allocateDiscount: the cent naive rounding loses', () => {
  const order = normalizeOrder(REST_UNPAID_7, OPTS);
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
  const docs = orderToDocuments(order, resolvedFor(order));
  const lineNets = docs.invoice.lines.map((l) => l.net);
  assert.deepEqual(lineNets, ['6.66 EUR', '6.67 EUR', '6.67 EUR']);
  assert.equal(docs.invoice['net-amount'], '20.00 EUR');
});

// =============================================================================================
// The canonical documents — REST and GraphQL payloads produce the same accounting substance
// =============================================================================================

test('REST order → canonical sales invoice, journal entry and payment (exact BigInt assertions)', () => {
  const order = normalizeOrder(REST_PAID_19, OPTS);
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

  const { invoice, journalEntry, payment } = orderToDocuments(order, resolvedFor(order));

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
  const account = customerAccountFor(order, OPTS.subledger);
  assert.ok(account >= '10000' && account < '60000', 'customer subledger within the band');
  assert.equal(journalEntry['source-document-type'], 'sales-invoice');
  assert.equal(journalEntry['source-document-reference'], documentIdFor(order.sourceId));
  assert.deepEqual(journalEntry.postings.map((p) => [p.side, p.account, p.amount]), [
    ['debit', account, '53.54 EUR'],
    ['credit', '8400', '44.99 EUR'],
    ['credit', '1776', '8.55 EUR'],
  ]);
  assert.equal(journalEntry['debit-amount'], journalEntry['credit-amount']);

  // Payment: debit the caller-supplied clearing account, credit the customer. Clears it.
  assert.ok(payment, 'a paid order records a payment');
  assert.equal(payment.amount, '53.54 EUR');
  assert.equal(payment.gateway, 'shopify_payments');
  assert.equal(payment['clearing-account'], '1370');
  assert.equal(payment['clears-invoice'], documentIdFor(order.sourceId));
  assert.deepEqual(payment.postings.map((p) => [p.side, p.account, p.amount]), [
    ['debit', '1370', '53.54 EUR'],
    ['credit', account, '53.54 EUR'],
  ]);
});

test('GraphQL order shape → identical accounting substance as REST', () => {
  const rest = orderToDocuments(normalizeOrder(REST_PAID_19, OPTS),
    resolvedFor(normalizeOrder(REST_PAID_19, OPTS)));
  const gqlOrder = normalizeOrder(GQL_PAID_19, OPTS);
  const gql = orderToDocuments(gqlOrder, resolvedFor(gqlOrder));
  // The gid is reduced to the same external id; the reference is identical.
  assert.equal(gqlOrder.sourceId, '5628190318720');
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
  const order = normalizeOrder(REST_UNPAID_7, OPTS);
  const { invoice, journalEntry, payment } = orderToDocuments(order, resolvedFor(order));
  assert.equal(payment, null, 'an unpaid order records no payment');
  const account = customerAccountFor(order, OPTS.subledger);
  assert.deepEqual(invoice['open-item'], {
    account, amount: '21.40 EUR', status: 'open', since: '2026-08-20',
  });
  // 7 % reduced rate: the model's domestic-reduced treatment says 8300 revenue and 1771 VAT.
  assert.deepEqual(journalEntry.postings.map((p) => [p.side, p.account, p.amount]), [
    ['debit', account, '21.40 EUR'],
    ['credit', '8300', '20.00 EUR'],
    ['credit', '1771', '1.40 EUR'],
  ]);
  assert.equal(invoice['financial-status'], 'pending');
});

test('OSS destination sale → destination rate on the model\'s OSS accounts, never domestic VAT', () => {
  const order = normalizeOrder(REST_PAID_OSS_FR, OPTS);
  const { invoice, journalEntry } = orderToDocuments(order, resolvedFor(order));
  assert.deepEqual(invoice['vat-breakdown'], [{
    rate: '20', treatment: 'oss-distance-sale',
    base: '10.00 EUR', tax: '2.00 EUR',
    'revenue-account': '8336', 'vat-account': '1791',
  }]);
  const account = customerAccountFor(order, OPTS.subledger);
  assert.deepEqual(journalEntry.postings.map((p) => p.account), [account, '8336', '1791']);
});

test('a taxed sale whose treatment names no VAT account is refused — the VAT leg is never dropped', () => {
  const order = normalizeOrder(REST_PAID_19, OPTS);
  // The treatment was adopted with its output-VAT account left blank, but the order carries
  // real tax at that rate: crediting only revenue would leave the booking unbalanced by
  // exactly the tax while the invoice still shows the VAT amount. The dialect refuses and
  // names the gap in the model — it never drops a VAT leg to make the booking fit.
  const noVatAccount = TREATMENT_DOCS.map((t) => (t.name === 'domestic-standard'
    ? { ...t, 'output-vat-account-number': '' } : t));
  assert.throws(
    () => orderToDocuments(order, resolvedFor(order, { classes: classifyOrder(order, noVatAccount) })),
    (e) => e.code === 'treatment-accounts-undetermined');

  // A genuinely zero-rated treatment names no VAT account legitimately: there is no tax to
  // post, so nothing is missing — the booking balances without a VAT leg.
  const zeroRatedDocs = [...TREATMENT_DOCS, {
    name: 'domestic-zero', 'applies-to': 'sale', 'vat-rate-percent': 0,
    'rate-determined-by': 'origin-country', 'requires-oss-return': false, status: 'active',
    'revenue-account-number': '8390', 'output-vat-account-number': '',
  }];
  const zeroOrder = normalizeOrder({
    ...REST_PAID_19,
    total_price: '44.99', total_tax: '0.00',
    tax_lines: [{ title: 'MwSt', rate: 0, price: '0.00' }],
    line_items: REST_PAID_19.line_items.map((li) => ({
      ...li, tax_lines: [{ title: 'MwSt', rate: 0, price: '0.00' }],
    })),
  }, OPTS);
  // resolvedFor would classify with the default TREATMENT_DOCS first and throw
  // treatment-not-in-model on the 0 % rate before the override is even read — build directly.
  const { journalEntry } = orderToDocuments(zeroOrder, {
    classes: classifyOrder(zeroOrder, zeroRatedDocs),
    customerAccount: customerAccountFor(zeroOrder, OPTS.subledger),
    clearingAccount: OPTS.clearingAccount,
  });
  assert.ok(!journalEntry.postings.some((p) => p.role === 'output-vat'),
    'a zero-rated sale posts no VAT leg — because there is no tax, not because one was dropped');
  assert.equal(journalEntry['debit-amount'], journalEntry['credit-amount'],
    'the booking balances on its own');
  assert.equal(journalEntry['debit-amount'], '44.99 EUR');
  assert.deepEqual(journalEntry.postings.map((p) => p.account),
    [customerAccountFor(zeroOrder, OPTS.subledger), '8390']);
});

test('policy is never defaulted: home country, clearing account and subledger are required', () => {
  // No home country: the origin side of every VAT decision is missing — refuse.
  assert.throws(() => normalizeOrder(REST_PAID_19, { ...OPTS, homeCountry: undefined }),
    (e) => e.code === 'home-country-required');
  // No destination on the payload: the jurisdiction cannot be determined — refuse.
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, shipping_address: null }, OPTS),
    (e) => e.code === 'destination-unknown');
  // A paid order without a clearing account: the payment leg has nowhere to debit — refuse.
  const order = normalizeOrder(REST_PAID_19, OPTS);
  assert.throws(
    () => orderToDocuments(order, resolvedFor(order, { clearingAccount: undefined })),
    (e) => e.code === 'clearing-account-required');
});

test('internally inconsistent orders are refused, never repaired', () => {
  // tax_lines that do not sum to total_tax.
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, total_tax: '8.56' }, OPTS),
    (e) => e.code === 'tax-mismatch');
  // discount_applications that disagree with total_discounts.
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, total_discounts: '4.99' }, OPTS),
    (e) => e.code === 'discount-mismatch');
  // line items that do not sum to subtotal_price (e.g. line-level discounts folded in).
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, subtotal_price: '49.98' }, OPTS),
    (e) => e.code === 'subtotal-mismatch');
  // a total that is not subtotal − discounts + tax.
  assert.throws(
    () => normalizeOrder({ ...REST_PAID_19, total_price: '53.55' }, OPTS),
    (e) => e.code === 'total-mismatch');
  // charged shipping is out of scope and loud about it.
  assert.throws(
    () => normalizeOrder({
      ...REST_PAID_19, shipping_lines: [{ title: 'DHL', price: '4.90' }],
    }, OPTS),
    (e) => e.code === 'shipping-unsupported');
  // a line item whose quantity is zero or negative: nothing to book, never a negative sale.
  assert.throws(
    () => normalizeOrder({
      ...REST_PAID_19, line_items: [{ ...REST_PAID_19.line_items[0], quantity: 0 }],
    }, OPTS),
    (e) => e.code === 'bad-quantity');
  assert.throws(
    () => normalizeOrder({
      ...REST_PAID_19, line_items: [{ ...REST_PAID_19.line_items[0], quantity: -2 }],
    }, OPTS),
    (e) => e.code === 'bad-quantity');
});

// =============================================================================================
// Answer 1 — ingestion through the real kernel, idempotent, completing, byte-identical
// =============================================================================================

/** Injected, never read — determinism is a non-negotiable (CONTRACT #5). */
function fixedClock() {
  let t = Date.parse('2026-08-21T09:00:00Z');
  return () => (t += 60_000);
}

/**
 * A focused operating model: the entities the dialect writes plus the vat-treatment entity the
 * dialect READS its account determination from. Deliberately NOT the shipped model — an invoice
 * there needs a sales order, a customer and a VAT treatment web to exist first, so a test written
 * against it would fail for reasons that have nothing to do with ingestion. The kernel path
 * underneath is the real one: authorization, rule evaluation, one signed commit per document,
 * the read index.
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
  ['operating-model/information/vat-treatment.md',
    '# VAT treatment\n\nA tax situation, with its account determination filled in at adoption.\n\n## Fields\n'
    + '- name: text required\n- revenue-account-number: text required\n'
    + '\n## Authorized by\n- create: accountant\n- read: accountant\n- update: accountant\n'],
  ['operating-model/organisation/accountant.md', '# Accountant\n\nKeeps the books.\n'],
]);

/** Open a workspace and adopt the treatments — exactly how a real company would: as commits. */
async function workspace({ jwk = null, treatments = TREATMENT_DOCS } = {}) {
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
  for (const doc of treatments) {
    await nd.perform({
      op: 'create', entity: 'vat-treatment', id: doc.name, doc,
      message: `Adopt VAT treatment ${doc.name}`,
    });
  }
  return { nd, keyPair };
}

test('ingestion commits through the real kernel: signed commits, indexed documents', async () => {
  const { nd } = await workspace();
  const baseline = (await nd.history()).length; // genesis + treatment adoption commits

  const first = await ingestShopifyOrder(nd, REST_PAID_19, OPTS);
  assert.equal(first.created, true);
  assert.equal(first.completed, false);
  assert.equal(first.commits.length, 3, 'invoice + journal entry + payment, one commit each');
  assert.equal((await nd.history()).length, baseline + 3);

  // The stored document is the canonical one, carrying its origin on its face.
  const stored = nd.query.get('invoice', 'shopify-order-5628190318720');
  assert.deepEqual(first.document, stored);
  assert.equal(stored['source-system'], 'shopify');
  assert.equal(stored['source-id'], '5628190318720');
  assert.equal(stored.reference, 'Shopify #1001');
  assert.equal(first.journalEntry.description, 'Shopify #1001 — webshop sale');
  assert.equal(stored['gross-amount'], '53.54 EUR');

  // Every commit verifies — the ingestion path is the signed-commit path, not a side channel.
  const report = await nd.verify(baseline + 3);
  assert.ok(report.every((c) => c.signature === 'good' && c.problems.length === 0),
    `all commits must verify: ${JSON.stringify(report)}`);
});

test('the accounts an ingestion posts are the model\'s, proven by re-pointing the treatment', async () => {
  // Adopt domestic-standard with DIFFERENT account numbers: the dialect must follow the model.
  const repointed = TREATMENT_DOCS.map((t) => (t.name === 'domestic-standard'
    ? { ...t, 'revenue-account-number': '8410', 'output-vat-account-number': '1777' } : t));
  const { nd } = await workspace({ treatments: repointed });
  const result = await ingestShopifyOrder(nd, REST_PAID_19, OPTS);
  const accounts = result.journalEntry.postings.map((p) => p.account);
  assert.ok(accounts.includes('8410') && accounts.includes('1777'),
    `postings must use the model's accounts, got ${accounts.join(', ')}`);
  assert.ok(!accounts.includes('8400') && !accounts.includes('1776'),
    'no account number may come from the dialect itself');
});

test('idempotent re-ingest: existing documents returned, ZERO new commits', async () => {
  const { nd } = await workspace();

  const first = await ingestShopifyOrder(nd, REST_PAID_19, OPTS);
  const commitsAfterFirst = (await nd.history()).length;

  // A replayed webhook: same payload, and the GraphQL shape of the same order.
  for (const replay of [REST_PAID_19, GQL_PAID_19]) {
    const again = await ingestShopifyOrder(nd, replay, OPTS);
    assert.equal(again.created, false);
    assert.equal(again.completed, false);
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
  const second = await ingestShopifyOrder(nd, REST_UNPAID_7, OPTS);
  assert.equal(second.created, true);
  assert.equal(second.commits.length, 2, 'invoice + journal entry; unpaid records no payment');
  assert.equal((await nd.history()).length, commitsAfterFirst + 2);
});

test('a PARTIAL earlier run is completed, not stuck behind the idempotency guard', async () => {
  const { nd } = await workspace();

  // Simulate the crash the reviewer named: the invoice committed, then the run died before the
  // journal entry and the payment. Only the invoice exists under the source tuple.
  const order = normalizeOrder(REST_PAID_19, OPTS);
  const docs = orderToDocuments(order, resolvedFor(order));
  await nd.perform({
    op: 'create', entity: 'invoice', id: 'shopify-order-5628190318720', doc: docs.invoice,
    message: 'Ingest Shopify #1001 (5628190318720) — sales invoice',
  });
  const beforeReplay = (await nd.history()).length;

  const replay = await ingestShopifyOrder(nd, REST_PAID_19, OPTS);
  assert.equal(replay.created, false, 'the invoice was already there');
  assert.equal(replay.completed, true, 'the missing siblings were completed');
  assert.equal(replay.commits.length, 2, 'journal entry + payment committed, nothing duplicated');
  assert.equal((await nd.history()).length, beforeReplay + 2);
  assert.ok(replay.journalEntry, 'the journal entry exists after completion');
  assert.ok(replay.payment, 'the payment exists after completion');
  // The completed documents use the account the committed invoice already chose.
  assert.equal(replay.journalEntry.postings[0].account, docs.invoice['customer-account']);

  // And from here on the order is simply recorded: the next replay commits nothing.
  const settled = await ingestShopifyOrder(nd, REST_PAID_19, OPTS);
  assert.equal(settled.created, false);
  assert.equal(settled.completed, false);
  assert.equal(settled.commits.length, 0);
  assert.equal((await nd.history()).length, beforeReplay + 2);
});

test('a stored document contradicting the payload is a named refusal, never an overwrite', async () => {
  const { nd } = await workspace();
  const order = normalizeOrder(REST_PAID_19, OPTS);
  const docs = orderToDocuments(order, resolvedFor(order));
  await nd.perform({
    op: 'create', entity: 'invoice', id: 'shopify-order-5628190318720',
    doc: { ...docs.invoice, 'gross-amount': '99.99 EUR' },
    message: 'a different story about the same foreign id',
  });
  await assert.rejects(() => ingestShopifyOrder(nd, REST_PAID_19, OPTS),
    (e) => e instanceof InboundError && e.code === 'source-conflict');
});

test('customer subledger collisions probe the next free account, deterministically', async () => {
  const { nd } = await workspace();
  // Two customers whose Shopify ids collide modulo the subledger band.
  const colliding = {
    ...REST_UNPAID_7,
    id: 5628190450000,
    name: '#1004',
    customer: { id: 7311676961024 + 50000, email: 'otto@example.de', first_name: 'Otto', last_name: 'Rahn' },
  };
  const first = await ingestShopifyOrder(nd, REST_UNPAID_7, OPTS);
  const second = await ingestShopifyOrder(nd, colliding, OPTS);
  const a = first.document['customer-account'];
  const b = second.document['customer-account'];
  const expected = customerAccountFor(normalizeOrder(REST_UNPAID_7, OPTS), OPTS.subledger);
  assert.equal(a, expected, 'the first customer takes the deterministic candidate');
  assert.equal(b, (BigInt(expected) + 1n).toString(),
    'the colliding customer probes to the next free account instead of sharing one');
  assert.notEqual(a, b, 'two customers never share a subledger account silently');
});

test('same foreign event → byte-identical commits on two independent workspaces', async () => {
  // One identity, imported twice; two workspaces; the same injected clock. Ed25519 is
  // deterministic, so identical payload bytes give an identical signature — the commit oids are
  // the whole statement.
  const keyPair = await generateIdentity({ comment: 'sarah@neodonkey.eu' });
  const jwk = await exportPrivateJwk(keyPair);

  const a = await workspace({ jwk });
  const b = await workspace({ jwk });

  const ra = await ingestShopifyOrder(a.nd, REST_PAID_19, OPTS);
  const rb = await ingestShopifyOrder(b.nd, REST_PAID_19, OPTS);

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
