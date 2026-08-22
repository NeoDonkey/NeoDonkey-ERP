/**
 * German USt-VA (Umsatzsteuervoranmeldung) Tax Grid Aggregation
 *
 * Primary Sources:
 * - UStG § 18 Abs. 1 (Voranmeldungsverfahren)
 * - UStG § 12 (Steuersätze: 19% standard, 7% reduced)
 * - UStG § 15 (Vorsteuerabzug)
 * - BMF / ELSTER UStVA Schnittstellenbeschreibung 2026
 * - operating-model/information/vat-return.md
 * - operating-model/information/posting.md
 *
 * Kennzahlen (Kz) aggregated via posting operating-model attributes:
 * - vat-kennzahl: '81', '86', '41', '43', '45', '89', '84', '61', '66', '67'
 * - vat-role: 'output-tax', 'input-tax', 'taxable-turnover', 'exempt-turnover',
 *             'non-taxable-turnover', 'acquisition-turnover'
 *
 * Line 83 formula per operating-model/information/vat-return.md:
 * total_output_tax = Kz 81 tax + Kz 86 tax + Kz 89 tax + Kz 84 tax
 * total_input_tax  = Kz 61 tax + Kz 66 tax + Kz 67 tax
 * kz-83-payable    = total_output_tax - total_input_tax
 */

/**
 * Truncate BigInt minor units (cents) to integer Euro amounts as required
 * during ELSTER submission (wave 3) for net base amounts (UStG § 18 Abs. 1).
 *
 * @param {bigint} cents
 * @returns {bigint} Integer Euro amount (cents / 100n)
 */
export function truncateToEuros(cents) {
  return cents / 100n;
}

/**
 * Extract BigInt minor units from monetary inputs (BigInt, number token string, or object with minor_units/amount).
 *
 * @param {bigint|string|number|Object} val
 * @returns {bigint}
 */
function toMinorUnits(val) {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return BigInt(val);
  if (typeof val === 'string') {
    let s = val.trim();
    if (s.endsWith('n')) {
      s = s.slice(0, -1);
    }
    // If formatted as "1000.50 EUR" or "1000.50"
    const cleaned = s.split(' ')[0];
    if (cleaned.includes('.')) {
      const parts = cleaned.split('.');
      const integerPart = parts[0] || '0';
      const fractionalPart = (parts[1] || '').padEnd(2, '0').slice(0, 2);
      return BigInt(integerPart) * 100n + BigInt(fractionalPart);
    }
    return BigInt(cleaned);
  }
  if (typeof val === 'object' && val !== null) {
    if (val.minor !== undefined) return BigInt(val.minor);
    if (val.minor_units !== undefined) return BigInt(val.minor_units);
    if (val.amount !== undefined) return toMinorUnits(val.amount);
  }
  return 0n;
}

/**
 * Aggregate general ledger postings for a specified period into German USt-VA Kennzahlen.
 * Operates purely on `vat-kennzahl` and `vat-role` carried by postings per operating model.
 *
 * @param {Array<Object>} postings
 * @param {Object|string} [periodFilter] - Optional accounting period string (e.g. '2026-07') or filter
 * @returns {Object} Aggregated USt-VA tax grid Kennzahlen in exact BigInt minor units
 */
export function aggregateUstVa(postings, periodFilter = null) {
  const totals = {
    '41': { base_minor: 0n },
    '43': { base_minor: 0n },
    '45': { base_minor: 0n },
    '81': { base_minor: 0n, tax_minor: 0n },
    '86': { base_minor: 0n, tax_minor: 0n },
    '89': { base_minor: 0n, tax_minor: 0n },
    '84': { tax_minor: 0n },
    '61': { tax_minor: 0n },
    '66': { tax_minor: 0n },
    '67': { tax_minor: 0n }
  };

  const filteredPostings = postings.filter((p) => {
    if (!periodFilter) return true;
    const period = p['accounting-period'] || p.period;
    if (typeof periodFilter === 'string') {
      return period === periodFilter || (p['posting-date'] && p['posting-date'].startsWith(periodFilter));
    }
    if (typeof periodFilter === 'object' && periodFilter !== null) {
      if (periodFilter['accounting-period'] || periodFilter.period) {
        const expected = periodFilter['accounting-period'] || periodFilter.period;
        return period === expected;
      }
      if (periodFilter.year && periodFilter.month) {
        const monthStr = String(periodFilter.month).padStart(2, '0');
        const expectedPrefix = `${periodFilter.year}-${monthStr}`;
        return period === expectedPrefix || (p['posting-date'] && p['posting-date'].startsWith(expectedPrefix));
      }
    }
    return true;
  });

  for (const p of filteredPostings) {
    const rawKz = p['vat-kennzahl'] || p.vat_kennzahl || p.kennzahl || p.kz;
    const role = p['vat-role'] || p.vat_role || p.role;
    if (!rawKz) continue;

    // Standardize Kz string (e.g., "81", "KZ81", 81 -> "81")
    const kz = String(rawKz).replace(/^KZ/i, '');
    const amountMinor = toMinorUnits(p.amount ?? p.amount_minor ?? p.net_minor ?? p.tax_minor ?? 0n);

    if (totals[kz]) {
      if (role === 'taxable-turnover' || role === 'exempt-turnover' || role === 'non-taxable-turnover' || role === 'acquisition-turnover') {
        if ('base_minor' in totals[kz]) {
          totals[kz].base_minor += amountMinor;
        }
      } else if (role === 'output-tax' || role === 'input-tax') {
        if ('tax_minor' in totals[kz]) {
          totals[kz].tax_minor += amountMinor;
        }
      } else if (p['tax-base-amount'] !== undefined || p.tax_base_amount !== undefined) {
        // Fallback for tax lines carrying explicit tax-base-amount or vice versa
        if ('base_minor' in totals[kz] && (p['tax-base-amount'] || p.tax_base_amount)) {
          totals[kz].base_minor += toMinorUnits(p['tax-base-amount'] || p.tax_base_amount);
        }
      }
    }
  }

  const totalOutputTax = totals['81'].tax_minor + totals['86'].tax_minor + totals['89'].tax_minor + totals['84'].tax_minor;
  const totalInputTax = totals['61'].tax_minor + totals['66'].tax_minor + totals['67'].tax_minor;
  const kz83Payable = totalOutputTax - totalInputTax;

  return {
    kz41: { base_minor: totals['41'].base_minor },
    kz43: { base_minor: totals['43'].base_minor },
    kz45: { base_minor: totals['45'].base_minor },
    kz81: { base_minor: totals['81'].base_minor, tax_minor: totals['81'].tax_minor },
    kz86: { base_minor: totals['86'].base_minor, tax_minor: totals['86'].tax_minor },
    kz89: { base_minor: totals['89'].base_minor, tax_minor: totals['89'].tax_minor },
    kz84: { tax_minor: totals['84'].tax_minor },
    kz61: { tax_minor: totals['61'].tax_minor },
    kz66: { tax_minor: totals['66'].tax_minor },
    kz67: { tax_minor: totals['67'].tax_minor },
    total_output_tax_minor: totalOutputTax,
    total_input_tax_minor: totalInputTax,
    kz83_payable_minor: kz83Payable
  };
}
