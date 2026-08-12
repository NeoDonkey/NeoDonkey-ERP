# Supplier — cashew nuts

**Nussimport Müller GmbH**, an invented placeholder for the importer who supplies our cashew range. Based
in Germany, sourcing from Vietnam, delivering full pallets to Berlin on thirty-day terms.

They matter more than their share of spend suggests. Cashews are our largest single category, the buy is
seasonal, and the shelf life is long enough that a bad batch sits in the warehouse for months before
anybody notices. So this is the supplier whose certification we check hardest and whose on-time delivery
number gets read out loud in the quarterly review.

## Context

The `supplier` document, as `information/supplier.md` describes the fields:

- name: `Nussimport Müller GmbH`
- supplier-type: `goods`
- country: `DE`
- vat-identification-number: on file, German
- vat-treatment: `domestic-standard` — a German supplier, so no reverse charge
- payment-terms-days: `30`, with a 2 % early-payment discount inside ten days
- iban-on-file: `true` — checked by the accountant, against something other than the email that asked
- food-safety-certification: `IFS`
- certification-valid: `true`
- status: `approved`

## Notes

### Why the origin matters even though the supplier is German
The cashews come from Vietnam; the *supplier* is in Germany. So the purchase is a domestic one — no import
VAT for us, no customs declaration — while the **article** carries `country-of-origin: VN` for labelling
and, if we ever bought direct, for customs. Confusing the two is a common and expensive mistake: the tax
treatment follows the supplier, the label follows the goods.

### The certificate of analysis
Ordered with `requires-certificate-of-analysis: true`. Aflatoxin is the reason. Without the certificate the
document check in `processes/quality-inspection.md` fails and the batch does not leave quarantine — which
is the correct outcome and occasionally an uncomfortable phone call.

### What the quarterly review reads
`on-time-delivery-percent` and `complaint-count-12m`, both rolling twelve months, both maintained from
actual goods receipts and complaints rather than assembled the night before the meeting. That is the whole
value of having them on the document.

### No real supplier data
Every name and number here is invented. There is no real supplier data and no personal data of any
individual in this folder.

## References

`processes/purchase-ordering.md`, `processes/goods-receipt.md`,
`management-system/quarterly-supplier-review.md`
