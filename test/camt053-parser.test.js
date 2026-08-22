// test/camt053-parser.test.js — tests for ISO 20022 CAMT.053 XML bank statement parser

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCamt053Xml } from '../runtime/bank/camt053.js';
import { readFileSync } from 'node:fs';

const SAMPLE_CAMT053_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>MSG20260822-001</MsgId>
      <CreDtTm>2026-08-22T10:00:00Z</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>STMT-2026-08</Id>
      <LglSeqNb>42</LglSeqNb>
      <CreDtTm>2026-08-22T10:00:00Z</CreDtTm>
      <Acct>
        <Id>
          <IBAN>DE89370400440532013000</IBAN>
        </Id>
        <Ccy>EUR</Ccy>
      </Acct>
      <Ntry>
        <NtryRef>REF-001</NtryRef>
        <Amt Ccy="EUR">1250.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <BookgDt>
          <Dt>2026-08-20</Dt>
        </BookgDt>
        <ValDt>
          <Dt>2026-08-20</Dt>
        </ValDt>
        <AcctSvcrRef>BANKREF123</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>END2END-999</EndToEndId>
              <UETR>c61b2e4f-2e38-4e89-8d74-0f56a5d7c3b2</UETR>
            </Refs>
            <RltdPties>
              <Dbtr>
                <Nm>ACME Supplies GmbH</Nm>
              </Dbtr>
            </RltdPties>
            <RmtInf>
              <Strd>
                <CdtrRefInf>
                  <Ref>INV-2026-0042</Ref>
                </CdtrRefInf>
              </Strd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <NtryRef>REF-002</NtryRef>
        <Amt Ccy="EUR">89.90</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <BookgDt>
          <Dt>2026-08-21</Dt>
        </BookgDt>
        <NtryDtls>
          <TxDtls>
            <RltdPties>
              <Cdtr>
                <Nm>Cloud Hosting SE</Nm>
              </Cdtr>
            </RltdPties>
            <RmtInf>
              <Ustrd>Monthly server hosting fee INV-8812</Ustrd>
            </RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

const SAMPLE_CAMT053_PREFIXED = `<?xml version="1.0" encoding="UTF-8"?>
<doc:Document xmlns:doc="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <doc:BkToCstmrStmt>
    <doc:Stmt>
      <doc:Id>STMT-PREFIX-1</doc:Id>
      <doc:Acct>
        <doc:Id>
          <doc:IBAN>DE12345678901234567890</doc:IBAN>
        </doc:Id>
        <doc:Ccy>EUR</doc:Ccy>
      </doc:Acct>
      <doc:Ntry>
        <doc:Amt Ccy="EUR">500.00</doc:Amt>
        <doc:CdtDbtInd>CRDT</doc:CdtDbtInd>
        <doc:BookgDt>
          <doc:DtTm>2026-08-22T14:30:00Z</doc:DtTm>
        </doc:BookgDt>
        <doc:NtryDtls>
          <doc:TxDtls>
            <doc:RmtInf>
              <doc:Ustrd>Payment for INV-100</doc:Ustrd>
            </doc:RmtInf>
          </doc:TxDtls>
        </doc:NtryDtls>
      </doc:Ntry>
    </doc:Stmt>
  </doc:BkToCstmrStmt>
</doc:Document>`;

test('parseCamt053Xml successfully parses valid camt.053.001.02 XML', () => {
  const result = parseCamt053Xml(SAMPLE_CAMT053_V2);

  assert.equal(result.id, 'STMT-2026-08');
  assert.equal(result.sequenceNumber, '42');
  assert.equal(result.account.iban, 'DE89370400440532013000');
  assert.equal(result.account.currency, 'EUR');
  assert.equal(result.entries.length, 2);

  // Credit entry
  const crdt = result.entries[0];
  assert.equal(crdt.type, 'CRDT');
  assert.equal(crdt.amount.currency, 'EUR');
  assert.equal(crdt.amount.minorUnits, 125050n);
  assert.equal(crdt.amount.formatted, '1250.50 EUR');
  assert.equal(crdt.bookingDate, '2026-08-20');
  assert.equal(crdt.valueDate, '2026-08-20');
  assert.equal(crdt.accountServicerRef, 'BANKREF123');
  assert.equal(crdt.endToEndId, 'END2END-999');
  assert.equal(crdt.uetr, 'c61b2e4f-2e38-4e89-8d74-0f56a5d7c3b2');
  assert.equal(crdt.debtorName, 'ACME Supplies GmbH');
  assert.equal(crdt.structuredRemittanceRef, 'INV-2026-0042');

  // Debit entry
  const dbit = result.entries[1];
  assert.equal(dbit.type, 'DBIT');
  assert.equal(dbit.amount.currency, 'EUR');
  assert.equal(dbit.amount.minorUnits, 8990n);
  assert.equal(dbit.amount.formatted, '89.90 EUR');
  assert.equal(dbit.bookingDate, '2026-08-21');
  assert.equal(dbit.creditorName, 'Cloud Hosting SE');
  assert.equal(dbit.unstructuredRemittance, 'Monthly server hosting fee INV-8812');
});

test('parseCamt053Xml parses XML with namespace prefixes and DtTm dates', () => {
  const result = parseCamt053Xml(SAMPLE_CAMT053_PREFIXED);

  assert.equal(result.id, 'STMT-PREFIX-1');
  assert.equal(result.account.iban, 'DE12345678901234567890');
  assert.equal(result.entries.length, 1);

  const entry = result.entries[0];
  assert.equal(entry.type, 'CRDT');
  assert.equal(entry.amount.minorUnits, 50000n);
  assert.equal(entry.bookingDate, '2026-08-22T14:30:00Z');
  assert.equal(entry.unstructuredRemittance, 'Payment for INV-100');
});

test('parseCamt053Xml rejects invalid XML or missing mandatory fields', () => {
  assert.throws(() => parseCamt053Xml(''), /Invalid XML/);
  assert.throws(() => parseCamt053Xml('<foo>bar</foo>'), /Invalid XML: missing BkToCstmrStmt/);
  assert.throws(() => parseCamt053Xml(`
    <Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
      <BkToCstmrStmt>
        <Stmt>
          <Acct>
            <Id></Id>
          </Acct>
        </Stmt>
      </BkToCstmrStmt>
    </Document>
  `), /Invalid XML: missing IBAN/);
});

test('source guard: parseCamt053Xml contains no parseFloat or Number conversion', () => {
  const code = readFileSync(new URL('../runtime/bank/camt053.js', import.meta.url), 'utf8');
  assert.ok(!/parseFloat\s*\(/.test(code), 'no parseFloat allowed in monetary path');
  assert.ok(!/Number\s*\([^)]*\)/.test(code), 'no Number(...) conversion allowed in monetary path');
});
