# Decision Record: PDF Invoice Rendering from Versioned HTML/SVG/CSS Templates

**Date:** 2026-08-17

## Question
How should NeoDonkey render human-readable PDF invoices from versioned templates while satisfying GoBD immutability and auditing requirements?

## Answer

1. **Deterministic Template Engine:**
   - PDF invoice generation renders structured POLISM document data (e.g. `sales-invoice` entity) through a versioned template composed of pure HTML/CSS/SVG.
   - The template rendering process must be completely deterministic: no `Date.now()`, no `Math.random()`, no dynamic external asset fetching (CSS, images, or fonts must be embedded as inline data URIs).

2. **Template Versioning and SHA-256 Binding:**
   - Every invoice rendering records the SHA-256 digest of the template version used to generate it inside the document commit metadata or PDF metadata.
   - Re-rendering an invoice at a later date with the same template hash must yield byte-identical HTML/SVG DOM structure.

3. **GoBD and DIN 5008 Layout Compliance:**
   - Templates MUST comply with DIN 5008 (Form B layout for German business letters), including address fields, fold marks, page numbers, payment details, tax identification numbers (Steuernummer / USt-IdNr), and legal disclosures.
   - Per GoBD §3.2.1, rendered invoice visual layouts stored or reproduced must match the exact invoice originally issued and transmitted to the recipient.

## Source
- **Primary Source (GoBD):** Principles for the proper keeping and retrieval of books, records and documents in electronic form and for data access (GoBD), BMF Circular 2019-11-28 (IV A 4 - S 0316/19/10003 :001), § 3.2.1 (Unveränderbarkeit) and § 9 (Inhaltsgleiche Wiedergabe).
- **Primary Source (DIN Standard):** DIN 5008:2020-03 *Schreib- und Gestaltungsregeln für die Text- und Informationsverarbeitung* (Layout rules for business documents, Form A and Form B).

## Verification Method
- **Deterministic Rendering Test:** A test renders an invoice document against a versioned template, checks that the rendered HTML/SVG output SHA-256 matches a fixed fixture, and confirms no external network references exist.
