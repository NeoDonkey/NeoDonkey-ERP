# VAT return preparation

Telling five tax authorities what we owe them. A German webshop with fulfilment in the Netherlands,
France and Italy and retail customers across the EU has three separate filing obligations, and they
do not overlap.

**The German return** — the *Umsatzsteuervoranmeldung*, monthly, with a permanent extension pushing
the deadline out by a month. Domestic sales, domestic purchases, import VAT, and the self-accounted
VAT on EU acquisitions.

**The EC sales list** — the *Zusammenfassende Meldung*, listing every zero-rated supply to a business
in another member state, by customer VAT identification number. This is what the other member states
cross-check our customers' declarations against, and a mismatch generates a letter.

**The OSS return** — quarterly, covering cross-border B2C sales at destination rates. Only relevant
above the 10,000 EUR threshold, and it does *not* cover sales made from stock held in another member
state. Those need that country's own return, which is why holding stock abroad is a tax decision.

The tax adviser files. This process prepares, and its most valuable output is not the numbers — it is
the list of transactions whose treatment looks wrong.

## Triggered by
The end of a filing period, or a threshold being crossed.

## Rules
If Read invoice under condition
  invoice reverse charge and
  vat-treatment needs ec sales list and
  buyer-vat-identifier exists
then
  Update invoice with vat-breakdown

If Read invoice under condition
  invoice zero rated and
  vat-treatment needs proof of transport and
  delivery-note not transport proven
then
  Update invoice with vat-exemption-reason and
  Update invoice with status "issued"

If Update vat-registration under condition
  vat-registration oss registration and
  vat-registration threshold exceeded
then
  Update vat-registration with filing-frequency "quarterly" and
  Update vat-registration with oss-threshold-exceeded "yes"

If Update vat-registration under condition
  vat-registration local registration and
  vat-registration active
then
  Update vat-registration with filing-frequency and
  Update vat-registration with status "active"

## Notes

This is the single most valuable check in the whole tax process. A zero-rated supply without a
*Gelangensbestätigung* on file will be re-assessed at nineteen percent years later, when the customer
is long gone and the margin is long spent. Finding it in the month it happened means asking for the
confirmation while somebody still remembers the delivery.

## Authorized by
accountant or tax-advisor
