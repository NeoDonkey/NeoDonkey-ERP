/**
 * German USt-VA (Umsatzsteuervoranmeldung) Tax Grid Aggregation
 *
 * Primary Sources:
 * - UStG § 18 Abs. 1 (Voranmeldungsverfahren)
 * - UStG § 12 (Steuersätze: 19% standard, 7% reduced)
 * - UStG § 15 (Vorsteuerabzug)
 * - BMF / ELSTER UStVA Schnittstellenbeschreibung 2026
 *
 * Kennziffern (Kz):
 * - Kz 81: Taxable sales at standard rate (19%) - net base and output VAT
 * - Kz 86: Taxable sales at reduced rate (7%) - net base and output VAT
 * - Kz 41: Tax-free intra-Community supplies (0%) - net base only
 * - Kz 66: Deductible input tax (Vorsteuer) - input VAT only
 * - Kz 83: Remaining VAT prepayment/refund = (Kz 81 tax + Kz 86 tax) - Kz 66 tax
 */

/**
 * Truncate BigInt minor units (cents) to integer Euro amounts as required by
 * ELSTER for net base amounts (Bemessungsgrundlage per UStG § 18 Abs. 1).
 *
 * @param {bigint} cents
 * @returns {bigint} Integer Euro amount (cents / 100n)
 */
export function truncateToEuros(cents) {
  return cents / 100n;
}

/**
 * Aggregate general ledger postings for a specified period into German USt-VA Kennziffern.
 *
 * Each posting entry should contain:
 * - date / period string or matching filter
 * - type / vat_code or tax_rate ('STANDARD_19', 'REDUCED_7', 'INTRA_EU_0', 'INPUT_TAX', etc.)
 * - net_minor: BigInt (net base amount in minor units / cents)
 * - tax_minor: BigInt (tax amount in minor units / cents)
 *
 * @param {Array<Object>} postings
 * @param {Object|string} [periodFilter] - Optional period filter (e.g. '2026-01' or { year: 2026, month: 1 })
 * @returns {Object} Aggregated USt-VA tax grid Kennziffern
 */
export function aggregateUstVa(postings, periodFilter = null) {
  let kz81_net_minor = 0n;
  let kz81_tax_minor = 0n;

  let kz86_net_minor = 0n;
  let kz86_tax_minor = 0n;

  let kz41_net_minor = 0n;

  let kz66_tax_minor = 0n;

  const filteredPostings = postings.filter((p) => {
    if (!periodFilter) return true;
    if (typeof periodFilter === 'string') {
      return p.period === periodFilter || (p.date && p.date.startsWith(periodFilter));
    }
    if (typeof periodFilter === 'object' && periodFilter !== null) {
      if (periodFilter.period) {
        return p.period === periodFilter.period;
      }
      if (periodFilter.year && periodFilter.month) {
        const monthStr = String(periodFilter.month).padStart(2, '0');
        const expectedPrefix = `${periodFilter.year}-${monthStr}`;
        return p.period === expectedPrefix || (p.date && p.date.startsWith(expectedPrefix));
      }
    }
    return true;
  });

  for (const posting of filteredPostings) {
    const code = posting.vat_code || posting.code || posting.tax_code;
    const net = BigInt(posting.net_minor ?? posting.net ?? 0n);
    const tax = BigInt(posting.tax_minor ?? posting.tax ?? 0n);

    switch (code) {
      case 'KZ81':
      case 'STANDARD_19':
      case 'TAXABLE_19':
        kz81_net_minor += net;
        kz81_tax_minor += tax;
        break;

      case 'KZ86':
      case 'REDUCED_7':
      case 'TAXABLE_7':
        kz86_net_minor += net;
        kz86_tax_minor += tax;
        break;

      case 'KZ41':
      case 'INTRA_EU_0':
      case 'INTRA_COMMUNITY_0':
        kz41_net_minor += net;
        break;

      case 'KZ66':
      case 'INPUT_TAX':
      case 'VORSTEUER':
        kz66_tax_minor += tax;
        break;

      default:
        break;
    }
  }

  const kz83_tax_minor = kz81_tax_minor + kz86_tax_minor - kz66_tax_minor;

  return {
    kz81: {
      net_minor: kz81_net_minor,
      tax_minor: kz81_tax_minor,
      net_euros: truncateToEuros(kz81_net_minor)
    },
    kz86: {
      net_minor: kz86_net_minor,
      tax_minor: kz86_tax_minor,
      net_euros: truncateToEuros(kz86_net_minor)
    },
    kz41: {
      net_minor: kz41_net_minor,
      net_euros: truncateToEuros(kz41_net_minor)
    },
    kz66: {
      tax_minor: kz66_tax_minor
    },
    kz83: {
      tax_minor: kz83_tax_minor
    }
  };
}
