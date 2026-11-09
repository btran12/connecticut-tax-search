import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  parseBillDetail,
  parsePaymentHistory,
  parseRelatedBills,
  parseSearchResults,
} from '../lib/parse.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(path.join(fixtures, name), 'utf8');

test('parses tax search results', () => {
  const { results, headers } = parseSearchResults(fixture('tax-search.html'), {
    dataset: 'tax',
  });

  assert.equal(results.length, 166);
  assert.ok(headers.includes('Name/Address'));
  assert.ok(headers.includes('Outstanding'));

  const bill = results.find((item) => item.billNumber === '2025-03-0081220');
  assert.ok(bill);
  assert.equal(bill.bnum, '81220');
  assert.equal(bill.uniqueId, '81220');
  assert.equal(bill.district, '1');
  assert.equal(bill.billType, 'Motor Vehicle');
  assert.equal(bill.name, 'SMITH JONATHAN M');
  assert.equal(bill.secondaryName, 'SICKEL-SMITH AMANDA E');
  assert.equal(bill.totalTax, 181.14);
  assert.equal(bill.paid, 0);
  assert.equal(bill.outstanding, 187.93);
  assert.equal(bill.payable, true);
  assert.match(bill.detailUrl, /\/inet\/bill\/detail\.do\?type=0&byear=2025&btype=3&bnum=81220$/);
});

test('parses the real estate search row', () => {
  const { results } = parseSearchResults(fixture('tax-search.html'), {
    dataset: 'tax',
  });

  const bill = results.find((item) => item.billNumber === '2024-01-0012557');
  assert.ok(bill);
  assert.equal(bill.uniqueId, 'R17081');
  assert.equal(bill.district, '2');
  assert.equal(bill.billType, 'Real Estate');
  assert.equal(bill.property, 'KELSEY ST 39 0330');
});

test('parses sanitation search results', () => {
  const { results } = parseSearchResults(fixture('sanitation-search.html'), {
    dataset: 'sanitation',
  });

  assert.ok(results.length > 0);
  const bill = results[0];
  assert.equal(bill.uniqueId, 'R10930');
  assert.equal(bill.billType, 'Sanitation');
  assert.equal(bill.name, null);
  assert.match(bill.detailUrl, /search=2/);
});

test('parses a motor vehicle detail page', () => {
  const detail = parseBillDetail(fixture('tax-detail-mv.html'), {
    dataset: 'tax',
    byear: 2025,
    btype: 3,
    bnum: '81220',
  });

  assert.equal(detail.billNumber, '2025-3-0081220');
  assert.equal(detail.billType, 'Motor Vehicle');
  assert.equal(detail.uniqueId, '81220');
  assert.equal(detail.name, 'SMITH JONATHAN M');
  assert.equal(detail.careOf, 'SICKEL-SMITH AMANDA E');
  assert.equal(detail.grossAssessment, 5580);
  assert.equal(detail.netAssessment, 5580);
  assert.equal(detail.townMillRate, 32.46);
  assert.equal(detail.installments.length, 4);
  assert.equal(detail.installments[0].installment, '#1');
  assert.equal(detail.installments[0].dueDate, '07/01/2026');
  assert.equal(detail.installments[0].town, 90.57);
  assert.equal(detail.totals.town, 181.14);
  assert.equal(detail.due.totalDueNow, 97.36);
  assert.equal(detail.due.interest, 6.79);
  assert.equal(detail.paymentsThisYear.amount, 0);
  assert.equal(detail.vehicleInfo, '2017 1 TOYOT YARIS');
});

test('parses a real estate detail page', () => {
  const detail = parseBillDetail(fixture('tax-detail-real-estate.html'), {
    dataset: 'tax',
    byear: 2024,
    btype: 1,
    bnum: '12557',
  });

  assert.equal(detail.billNumber, '2024-1-0012557');
  assert.equal(detail.billType, 'Real Estate');
  assert.equal(detail.uniqueId, 'R17081');
  assert.equal(detail.district, '2');
  assert.equal(detail.propertyLocation, 'KELSEY ST');
  assert.equal(detail.districtMillRate, 7.2);
  assert.equal(detail.mbl, '39 0330');
});

test('parses payment history', () => {
  const history = parsePaymentHistory(fixture('tax-payments.html'));

  assert.equal(history.name, 'SMITH JONATHAN M');
  assert.equal(history.payments.length, 3);
  assert.equal(history.payments[0].billNumber, '2022-03-0080829');
  assert.equal(history.payments[0].paidDate, '03/22/2024');
  assert.equal(history.payments[0].total, 365.5);
  assert.equal(history.grandTotal.total, 870.43);
});

test('parses related bills', () => {
  const related = parseRelatedBills(fixture('tax-related.html'), { dataset: 'tax' });

  assert.ok(related.length > 1);
  assert.ok(related.some((item) => item.billNumber === '2022-03-0080830'));
  const item = related.find((entry) => entry.billNumber === '2022-03-0080830');
  assert.equal(item.billType, 'Motor Vehicle');
  assert.equal(item.totalDue, 0);
  assert.equal(item.payments, 568.7);
});

test('parses sanitation detail page columns', () => {
  const detail = parseBillDetail(fixture('sanitation-detail.html'), {
    dataset: 'sanitation',
    byear: 2025,
    btype: 11,
    bnum: '1101',
  });

  assert.equal(detail.billNumber, '2025-11-0001101');
  assert.equal(detail.billType, 'Sanitation');
  assert.equal(detail.uniqueId, 'R10930');
  assert.equal(detail.propertyLocation, '55 BRIDGE ST SOUTH');
  assert.deepEqual(detail.installmentColumns, ['Installment', 'Due Date', 'Sewer']);
  assert.equal(detail.installments.length, 4);
  assert.equal(detail.installments[0].values.Sewer, '$281.62');
  assert.equal(detail.paymentsThisYear.amount, 0);
});
