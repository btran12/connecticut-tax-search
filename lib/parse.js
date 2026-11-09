import * as cheerio from 'cheerio';

export const BASE_URL = 'https://www.mytaxbill.org';
const URL_BASE = new URL('/inet/bill/', BASE_URL);

const BILL_TYPES = {
  1: 'Real Estate',
  2: 'Personal Property',
  3: 'Motor Vehicle',
  4: 'Motor Vehicle Supplemental',
  6: 'Sewer Use',
  7: 'MSW',
  8: 'Sewer Charge',
  11: 'Sanitation',
  20: 'Hydrant',
  21: 'Miscellaneous',
  22: 'FOG',
  23: 'Overflow Charge',
  24: 'FDM',
};

export function cleanText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cellText($, cell) {
  const clone = $(cell).clone();
  clone.find('br').replaceWith(' ');
  return cleanText(clone.text());
}

export function toMoney(value) {
  if (value == null) return null;
  const raw = String(value).replace(/,/g, '').replace(/\u00a0/g, ' ');
  const match = raw.match(/-?\$?\s*-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function canonicalBillNumber(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

function billTypeLabel(code, fallback) {
  const known = BILL_TYPES[Number(code)];
  if (known) return known;
  const cleaned = cleanText(fallback);
  if (!cleaned) return null;
  return cleaned
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function absoluteUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, URL_BASE).toString();
  } catch {
    return null;
  }
}

function headerIndex(headers, ...names) {
  for (const name of names) {
    const wanted = name.toLowerCase();
    const index = headers.findIndex((header) => header.toLowerCase() === wanted);
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * Parse the bill search result table. Supports both the tax-bill table
 * (Bill #, Name/Address, Property/Vehicle, Total Tax, Paid, Outstanding)
 * and the sanitation table (Bill #, Unique ID, Bill Type, Total Tax, Paid,
 * Outstanding, Pay All).
 */
export function parseSearchResults(html, { dataset = 'tax' } = {}) {
  const $ = cheerio.load(html);
  const tables = $('table').toArray();

  let table = tables.find((candidate) => {
    const headers = $(candidate)
      .find('thead td, thead th')
      .toArray()
      .map((cell) => cellText($, cell).toLowerCase());
    return headers.includes('bill #') && headers.includes('outstanding');
  });

  if (!table) return { results: [], headers: [] };

  const headers = $(table)
    .find('thead td, thead th')
    .toArray()
    .map((cell) => cellText($, cell));

  const index = {
    bill: headerIndex(headers, 'Bill #'),
    unique: headerIndex(headers, 'Unique ID'),
    type: headerIndex(headers, 'Bill Type'),
    name: headerIndex(headers, 'Name/Address', 'Name'),
    property: headerIndex(headers, 'Property/Vehicle', 'Property'),
    totalTax: headerIndex(headers, 'Total Tax', 'Total Due'),
    paid: headerIndex(headers, 'Paid', 'Payments'),
    outstanding: headerIndex(headers, 'Outstanding'),
    options: headerIndex(headers, 'Options'),
    pay: headerIndex(headers, 'Pay', 'Pay All'),
  };

  const results = [];

  $(table)
    .find('tr')
    .each((_, row) => {
      if ($(row).closest('thead').length) return;
      const cells = $(row).children('td');
      if (cells.length < 4) return;

      const billCellText = cellText($, cells[index.bill >= 0 ? index.bill : 0]);
      const billMatch = billCellText.match(/(\d{4})-(\d{1,2})-(\d{4,8})/);
      if (!billMatch) return;

      const billNumber = billMatch[0];
      const byear = Number(billMatch[1]);
      const btype = Number(billMatch[2]);
      const bnum = canonicalBillNumber(billMatch[3]);

      let uniqueId = null;
      if (index.unique >= 0 && cells[index.unique]) {
        uniqueId = cleanText($(cells[index.unique]).text()) || null;
      }
      if (!uniqueId) {
        const afterBill = billCellText.slice(billMatch.index + billNumber.length);
        const uniqueMatch = afterBill.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/);
        uniqueId = uniqueMatch ? uniqueMatch[1] : null;
      }

      let billType = index.type >= 0 ? cellText($, cells[index.type]) : null;
      if (!billType) {
        const typeMatch = billCellText.match(/\(([^)]+)\)/);
        billType = typeMatch ? cleanText(typeMatch[1]) : null;
      }

      const districtMatch = billCellText.match(/District:\s*([A-Za-z0-9-]+)/i);
      const district = districtMatch ? districtMatch[1] : null;

      let name = null;
      let secondaryName = null;
      let property = index.property >= 0 && cells[index.property]
        ? cellText($, cells[index.property])
        : null;

      if (index.name >= 0 && cells[index.name]) {
        const nameCell = $(cells[index.name]);
        name = cleanText(nameCell.find('b').first().text()) || null;
        const remainder = nameCell.clone();
        remainder.find('b').remove();
        remainder.find('br').replaceWith(' ');
        const leftover = cleanText(remainder.text());
        if (leftover && leftover !== name) secondaryName = leftover;
      }

      const links = {};
      const optionsCell = index.options >= 0
        ? cells[index.options]
        : cells.toArray().find((cell) => $(cell).find('a[href*="detail.do"]').length);
      if (optionsCell) {
        $(optionsCell)
          .find('a')
          .each((_, anchor) => {
            const title = cleanText($(anchor).attr('title'));
            const href = absoluteUrl($(anchor).attr('href'));
            if (title && href) links[title] = href;
          });
      }

      const detailUrl =
        links['Information on this account'] ||
        links['View Detail'] ||
        absoluteUrl(
          dataset === 'sanitation'
            ? `/inet/bill/detail.do?search=2&type=2&byear=${byear}&btype=${btype}&bnum=${bnum}`
            : `/inet/bill/detail.do?type=0&byear=${byear}&btype=${btype}&bnum=${bnum}`,
        );

      const payCell = index.pay >= 0 ? cells[index.pay] : null;
      const payable = payCell
        ? $(payCell).find('a[href*="selectStart.do"], input[type="checkbox"]').length > 0
        : Object.keys(links).some((key) => /pay/i.test(key));

      results.push({
        billNumber,
        byear,
        btype,
        bnum,
        billTypeCode: btype,
        billType: billTypeLabel(btype, billType),
        uniqueId,
        district,
        name,
        secondaryName,
        property,
        totalTax: index.totalTax >= 0 && cells[index.totalTax] ? toMoney(cellText($, cells[index.totalTax])) : null,
        paid: index.paid >= 0 && cells[index.paid] ? toMoney(cellText($, cells[index.paid])) : null,
        outstanding: index.outstanding >= 0 && cells[index.outstanding] ? toMoney(cellText($, cells[index.outstanding])) : null,
        payable,
        dataset,
        detailUrl,
        pdfUrl: links['Download PDF'] || null,
        allBillsUrl: links['View All Bills'] || null,
        paymentHistoryUrl: links['Tax Payment History'] || null,
        originalBillUrl: links['View original tax bill'] || null,
        payUrl: links['Click and pay your bill'] || null,
      });
    });

  return { results, headers };
}

function collectPairs($, table) {
  const pairs = {};

  $(table)
    .find('tr')
    .each((_, row) => {
      if ($(row).closest('thead').length) return;
      const cells = $(row).children('td').toArray();
      for (let position = 0; position + 1 < cells.length; position += 2) {
        const label = cleanText($(cells[position]).text());
        if (!label) continue;
        const value = cellText($, cells[position + 1]);
        if (!Object.prototype.hasOwnProperty.call(pairs, label)) {
          pairs[label] = value;
        }
      }
    });

  return pairs;
}

function normalizeKey(key) {
  return cleanText(key).toLowerCase().replace(/\s+/g, ' ');
}

function parseInstallments($) {
  const firstHeader = $('td.billdetail').first();
  if (!firstHeader.length) {
    return { installments: [], adjustment: null, totals: null, paymentsToDate: null, columns: [] };
  }

  const table = firstHeader.closest('table');
  const columnNames = [];
  const installments = [];
  let adjustment = null;
  let totals = null;
  let paymentsToDate = null;

  table.find('tr').each((_, row) => {
    const cells = $(row).children('td').toArray();
    if (!cells.length) return;

    const labels = cells.map((cell) => cellText($, cell));
    const firstCell = $(cells[0]);
    if (firstCell.hasClass('billdetail')) {
      labels.forEach((label) => columnNames.push(label));
      return;
    }

    const label = labels[0];
    if (!label) return;

    const valueAt = (name) => {
      const column = columnNames.findIndex((columnName) => columnName.toLowerCase() === name.toLowerCase());
      return column >= 0 && column < labels.length ? labels[column] : null;
    };

    if (/^#\d+/.test(label)) {
      installments.push({
        installment: label,
        dueDate: valueAt('Due Date'),
        town: toMoney(valueAt('Town')),
        district: toMoney(valueAt('District')),
        other: toMoney(valueAt('Other')),
        values: Object.fromEntries(
          columnNames.slice(2).map((columnName, offset) => [
            columnName,
            labels[offset + 2] ?? null,
          ]),
        ),
      });
    } else if (/^Adjustment$/i.test(label)) {
      adjustment = {
        town: toMoney(valueAt('Town')),
        district: toMoney(valueAt('District')),
        other: toMoney(valueAt('Other')),
        values: Object.fromEntries(
          columnNames.slice(2).map((columnName, offset) => [
            columnName,
            labels[offset + 2] ?? null,
          ]),
        ),
      };
    } else if (/^Total$/i.test(label)) {
      totals = {
        town: toMoney(valueAt('Town')),
        district: toMoney(valueAt('District')),
        other: toMoney(valueAt('Other')),
        values: Object.fromEntries(
          columnNames.slice(2).map((columnName, offset) => [
            columnName,
            labels[offset + 2] ?? null,
          ]),
        ),
      };
    } else if (/^Total payments/i.test(label)) {
      paymentsToDate = {
        label,
        amount: toMoney(labels[1]) ?? toMoney(labels[2]) ?? toMoney(labels[3]),
      };
    }
  });

  return { installments, adjustment, totals, paymentsToDate, columns: columnNames };
}

function parseDueBox($) {
  const due = {};
  $('table.due-info tr').each((_, row) => {
    const cells = $(row).children('td').toArray();
    if (cells.length < 2) return;
    const label = cellText($, cells[0]);
    if (!label) return;
    due[label] = cellText($, cells[1]);
  });

  return {
    tax: toMoney(due['Tax/Princ/Bint Due']),
    interest: toMoney(due['Interest Due']),
    lien: toMoney(due['Lien Due']),
    fee: toMoney(due['Fee Due']),
    totalDueNow: toMoney(due['Total Due Now']),
    raw: due,
  };
}

function findButtonTarget($, labelPattern) {
  let found = null;

  $('input[onClick], input[onclick], a[href]').each((_, element) => {
    if (found) return;
    const node = $(element);
    const value = node.attr('value') || cleanText(node.text());
    if (!labelPattern.test(value)) return;

    const href = node.attr('href');
    if (href) {
      found = absoluteUrl(href);
      return;
    }

    const onclick = node.attr('onClick') || node.attr('onclick') || '';
    const match = onclick.match(/['"]([^'"]+(?:pdf|do)[^'"]*)['"]/i);
    if (match) found = absoluteUrl(match[1]);
  });

  return found;
}

export function parseBillDetail(html, { dataset = 'tax', byear, btype, bnum } = {}) {
  const $ = cheerio.load(html);

  const taxpayerTable = $('table')
    .toArray()
    .find((table) => {
      const heading = cleanText($(table).find('thead').text());
      return /taxpayer information/i.test(heading);
    });

  const pairs = taxpayerTable ? collectPairs($, taxpayerTable) : {};
  const normalized = {};
  for (const [key, value] of Object.entries(pairs)) {
    normalized[normalizeKey(key)] = value;
  }

  const billValue = normalized['bill #'] || '';
  const billMatch = billValue.match(/(\d{4})-(\d{1,2})-(\d{4,8})/);
  const typeMatch = billValue.match(/\(([^)]+)\)/);
  const districtValue = normalized.district || '';
  const districtMatch = districtValue.match(/District:\s*([A-Za-z0-9-]+)/i);

  const infoTable = $('table')
    .toArray()
    .find((table) => {
      const heading = cleanText($(table).find('thead').text());
      return /bill information/i.test(heading);
    });
  const billInfoHeading = infoTable ? cleanText($(infoTable).find('thead').text()) : '';
  const asOfMatch = billInfoHeading.match(/as of\s+([0-9/]+)/i);

  const installmentData = parseInstallments($);
  const due = parseDueBox($);

  const successText = cleanText($('.success').text());
  const paymentsYearMatch = successText.match(/Total Payments made(?:\s+to taxes)?\s+in\s+(\d{4})\s*:?\s*\$?([\d,.]+)/i);

  return {
    dataset,
    billNumber: billMatch ? billMatch[0] : null,
    byear: billMatch ? Number(billMatch[1]) : byear ?? null,
    btype: billMatch ? Number(billMatch[2]) : btype ?? null,
    bnum: billMatch ? canonicalBillNumber(billMatch[3]) : bnum ?? null,
    billType: billTypeLabel(billMatch ? billMatch[2] : btype, typeMatch ? typeMatch[1] : null),
    billInfoAsOf: asOfMatch ? asOfMatch[1] : null,
    uniqueId: normalized['unique id'] || null,
    district: districtMatch ? districtMatch[1] : (districtValue || null),
    name: normalized.name || null,
    careOf: normalized['care of'] || null,
    address: normalized.address || null,
    propertyLocation: normalized['property location'] || normalized['vehicle info'] || null,
    vehicleInfo: normalized['vehicle info'] || null,
    mbl: normalized.mbl || null,
    volumePage: normalized['volume & page'] || null,
    grossAssessment: toMoney(normalized['gross assessment']),
    exemption: toMoney(normalized.exemption),
    netAssessment: toMoney(normalized['net assessment']),
    townMillRate: toMoney(normalized['town mill rate']),
    districtMillRate: toMoney(normalized['district mill rate']),
    townBenefit: toMoney(normalized['town benefit']),
    elderlyBenefit: toMoney(normalized['elderly benefit (c)']),
    installments: installmentData.installments,
    installmentColumns: installmentData.columns,
    adjustment: installmentData.adjustment,
    totals: installmentData.totals,
    paymentsToDate: installmentData.paymentsToDate,
    due,
    paymentsThisYear: paymentsYearMatch
      ? {
          year: Number(paymentsYearMatch[1]),
          amount: toMoney(paymentsYearMatch[2]),
        }
      : null,
    fields: pairs,
    pdfUrl:
      findButtonTarget($, /download\s+pdf/i) ||
      absoluteUrl(`/inet/download/bill/detail/pdf?byear=${byear}&btype=${btype}&bnum=${bnum}`),
    originalBillUrl: findButtonTarget($, /view original tax bill/i),
    allBillsUrl: findButtonTarget($, /view all bills/i),
  };
}

export function parsePaymentHistory(html) {
  const $ = cheerio.load(html);
  const heading = cleanText($('h3').first().text());
  const nameMatch = heading.match(/Taxpayer Name:\s*(.+)/i);

  const table = $('table')
    .toArray()
    .find((candidate) => {
      const headers = cleanText($(candidate).find('thead').text()).toLowerCase();
      return headers.includes('paid date');
    });

  if (!table) {
    return { name: nameMatch ? cleanText(nameMatch[1]) : null, payments: [], grandTotal: null };
  }

  const payments = [];
  let grandTotal = null;

  $(table)
    .find('tr')
    .each((_, row) => {
      if ($(row).closest('thead').length) return;
      const cells = $(row).children('td').toArray();
      if (cells.length < 8) return;

      const labels = cells.map((cell) => cellText($, cell));
      const first = labels[0];
      const billMatch = first.match(/(\d{4})-(\d{1,2})-(\d{4,8})/);

      if (billMatch) {
        payments.push({
          billNumber: billMatch[0],
          byear: Number(billMatch[1]),
          btype: Number(billMatch[2]),
          bnum: canonicalBillNumber(billMatch[3]),
          billType: labels[1] || null,
          paidDate: labels[2] || null,
          tax: toMoney(labels[3]),
          interest: toMoney(labels[4]),
          lien: toMoney(labels[5]),
          fee: toMoney(labels[6]),
          total: toMoney(labels[7]),
        });
      } else if (/^Grand Total/i.test(first)) {
        grandTotal = {
          tax: toMoney(labels[3]),
          interest: toMoney(labels[4]),
          lien: toMoney(labels[5]),
          fee: toMoney(labels[6]),
          total: toMoney(labels[7]),
        };
      }
    });

  return {
    name: nameMatch ? cleanText(nameMatch[1]) : null,
    payments,
    grandTotal,
  };
}

export function parseRelatedBills(html, { dataset = 'tax' } = {}) {
  const $ = cheerio.load(html);
  const table = $('table')
    .toArray()
    .find((candidate) => {
      const headers = cleanText($(candidate).find('thead').text()).toLowerCase();
      return headers.includes('bill #') && headers.includes('detail');
    });

  if (!table) return [];

  const results = [];

  $(table)
    .find('tr')
    .each((_, row) => {
      if ($(row).closest('thead').length) return;
      const cells = $(row).children('td').toArray();
      if (cells.length < 4) return;

      const billText = cellText($, cells[0]);
      const billMatch = billText.match(/(\d{4})-(\d{1,2})-(\d{4,8})/);
      if (!billMatch) return;

      const typeMatch = billText.match(/\(([^)]+)\)/);
      const districtMatch = billText.match(/District:\s*([A-Za-z0-9-]+)/i);
      const nameCell = $(cells[1]);
      const name = cleanText(nameCell.find('b').first().text()) || null;
      const remainder = nameCell.clone();
      remainder.find('b').remove();
      remainder.find('br').replaceWith(' ');
      const secondary = cleanText(remainder.text()) || null;

      const detailAnchor = $(cells[cells.length - 1]).find('a[href*="detail.do"]').first();
      const detailHref = detailAnchor.attr('href');

      const detailUrl = detailHref
        ? absoluteUrl(detailHref)
        : absoluteUrl(
            dataset === 'sanitation'
              ? `/inet/bill/detail.do?search=2&type=2&byear=${billMatch[1]}&btype=${billMatch[2]}&bnum=${billMatch[3]}`
              : `/inet/bill/detail.do?type=0&byear=${billMatch[1]}&btype=${billMatch[2]}&bnum=${billMatch[3]}`,
          );

      results.push({
        billNumber: billMatch[0],
        byear: Number(billMatch[1]),
        btype: Number(billMatch[2]),
        bnum: canonicalBillNumber(billMatch[3]),
        billType: billTypeLabel(billMatch[2], typeMatch ? typeMatch[1] : null),
        district: districtMatch ? districtMatch[1] : null,
        name,
        secondaryName: secondary && secondary !== name ? secondary : null,
        property: cells[2] ? cellText($, cells[2]) : null,
        totalDue: cells[3] ? toMoney(cellText($, cells[3])) : null,
        payments: cells[4] ? toMoney(cellText($, cells[4])) : null,
        detailUrl,
        dataset,
      });
    });

  return results;
}
