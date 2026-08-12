# Supplier — cashew nuts

**Nussimport Müller GmbH**, an invented placeholder for the importer who supplies the cashew range.
German company, sourcing from Vietnam, full pallets to Berlin on thirty-day terms with a two percent
*Skonto* inside ten days.

They matter more than their share of spend suggests. Cashews are the largest single category, the buy is
seasonal, and the shelf life is long enough that a bad batch sits in the warehouse for months before
anybody notices. So this is the supplier whose certification gets checked hardest and whose on-time
delivery number is read out loud in the quarterly review.

## Context

The `supplier` document, in the fields `information/supplier.md` declares:

- name: `Nussimport Müller GmbH`, supplier-type: `goods`, country: `DE`
- vat-identification-number: on file; vat-treatment: `domestic-standard`
- payment-terms-days: `30`, early-payment-discount-percent: `2`
- iban-on-file: `yes` — checked by the accountant, against something other than the email that asked
- food-safety-certification: `IFS`, certification-valid: `yes`
- status: `approved`

## Notes

### The trap: supplier country is not article origin
The cashews come from Vietnam; the *supplier* is in Germany. So the purchase is domestic — no import
VAT, no customs declaration — while the **article** carries `country-of-origin: VN` for labelling.
The tax treatment follows the supplier, the label follows the goods, and confusing the two is a common
and expensive mistake.

### The certificate of analysis
Ordered with `requires-certificate-of-analysis: yes`. Aflatoxin is the reason. Without the certificate
the document check in `processes/quality-inspection.md` fails, the batch stays in quarantine, and
somebody has an uncomfortable phone call. That is the correct outcome.

### No real supplier data
Every name and number here is invented. There is no real supplier data and no personal data of any
individual anywhere in this template.

## References

`processes/purchase-ordering.md`, `processes/goods-receipt.md`,
`processes/supplier-invoice-verification.md`, `management-system/quarterly-supplier-review.md`
