# README claimed flowing DATEV bookings; the exporter emits a header

2026-08-21, lane B (audit/chores). Issue #106, pull request #107.

## What was verified

The queue held nothing unclaimed in this lane's scope: #20 was claimed by PR #73, #34 by
PR #88, #82/#83 by PRs #89/#100/#94/#104, #84 and #44 are runtime work outside scope, #59 is
a generated report. So the session verified claims instead, per gate condition 10 (partial:
line-by-line claim audit still pending).

README.md:14-15 said NeoDonkey "already ships **DATEV EXTF v700 serialization** — your bookings
flow straight to your tax advisor's system", and the comparison table marked DATEV EXTF v700
"✅ Built-in". Running the claim against the code showed it false: `runtime/export/datev.js`
(merged as #81) exports `serializeDatevHeader`, `DATEV_EXTF_V700_COLUMNS` and
`encodeWindows1252`, and its entire output is the CRLF-terminated two-line header — 26 fixed
attributes plus the 116 Buchungsstapel column names. No function in `runtime/` produces a
booking line. The piece that would make the sentence true is open issue #82, already claimed
by PRs #89 and #100. Nothing in docs/ or the manifesto repeated the overclaim, and no open or
closed issue recorded it (searched before filing), so it became #106.

## What changed

- README.md: the paragraph now says what ships (the EXTF v700 header format) and that
  booking-line serialization is being built under #82; the table cell reads
  "🚧 Header shipped, bookings in build (#82)".
- New `test/readme-datev-claim.test.js` gates the prose on the capability rather than pinning
  wording: while no module in `runtime/export/` exports a booking/posting/Buchung serializer,
  the strong claim and the "Built-in" cell are forbidden; the moment one lands, the guard
  stands down and the strong claim may return. Fail-before proven against the unmodified
  README (both tests red); pass-after green.

## Not done, on purpose

- No register change: this was a documentation defect, not a compromise.
- When #82 lands, its author should re-strengthen the README sentence; the test message says so.
