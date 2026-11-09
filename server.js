import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanText, parseBillDetail, parsePaymentHistory, parseRelatedBills, parseSearchResults } from './lib/parse.js';
import {
  fetchBillDetailHtml,
  fetchPaymentHistoryHtml,
  fetchRelatedBillsHtml,
  searchBills,
  UpstreamError,
} from './lib/upstream.js';
import {
  DEFAULT_TOWN,
  resolveTown,
  SUPPORTED_TOWNS,
  TOWNS,
} from './lib/towns.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;
const BILL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const UPSTREAM_CONCURRENCY = Math.max(1, Number(process.env.UPSTREAM_CONCURRENCY) || 4);
const MAX_DEEP_RESULTS = Math.max(1, Number(process.env.MAX_DEEP_RESULTS) || 250);
const MAX_TOWNS_PER_SEARCH = Math.max(
  1,
  Math.min(TOWNS.length, Number(process.env.MAX_TOWNS_PER_SEARCH) || 10),
);
const SEARCH_TOWN_CONCURRENCY = Math.max(
  1,
  Number(process.env.SEARCH_TOWN_CONCURRENCY) || 3,
);

const app = express();
app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  next();
});
app.use(express.json({ limit: '32kb' }));

class TtlCache {
  constructor(maxEntries = 1200) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.entries.has(key)) this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

const cache = new TtlCache();
const inFlight = new Map();

function cachedLoad(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      cache.set(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= maxConcurrent || queue.length === 0) return;
    const job = queue.shift();
    active += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}

const billLimiter = createLimiter(UPSTREAM_CONCURRENCY);
const searchLimiter = createLimiter(SEARCH_TOWN_CONCURRENCY);

function normalizeLastName(value) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[.,']/g, '')
    .replace(/[^A-Z0-9 &-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInitial(value) {
  const cleaned = cleanText(value).toUpperCase().replace(/[^A-Z]/g, '');
  return cleaned ? cleaned[0] : '';
}

function normalizeDataset(value) {
  return String(value || '').toLowerCase() === 'sanitation' ? 'sanitation' : 'tax';
}

function normalizeRecordType(value) {
  const number = String(value ?? '0');
  return ['0', '1', '2'].includes(number) ? number : '0';
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function parseTownList(query) {
  const values = [];

  const collect = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    for (const part of String(value).split(',')) values.push(part);
  };

  collect(query.towns);
  collect(query.town);

  if (!values.some((value) => value.trim())) values.push(DEFAULT_TOWN);

  const towns = [];
  const seen = new Set();

  for (const value of values) {
    if (!value.trim()) continue;
    const town = resolveTown(value);
    if (!town) {
      throw new HttpError(400, `Unknown Connecticut town: ${cleanText(value)}.`);
    }
    if (!town.supported) {
      throw new HttpError(
        400,
        `${town.name} is not available through mytaxbill.org.`,
      );
    }
    if (seen.has(town.slug)) continue;
    seen.add(town.slug);
    towns.push(town);
  }

  if (!towns.length) {
    throw new HttpError(400, 'Select at least one town to search.');
  }
  if (towns.length > MAX_TOWNS_PER_SEARCH) {
    throw new HttpError(
      400,
      `Select up to ${MAX_TOWNS_PER_SEARCH} towns per search.`,
    );
  }

  return towns;
}

async function runSearch({ lastName, initial, dataset, recordType, towns }) {
  const lastNameClean = normalizeLastName(lastName);
  const initialClean = normalizeInitial(initial);

  if (!lastNameClean) {
    throw new HttpError(400, 'Enter a last name to search.');
  }
  if (lastNameClean.length < 2) {
    throw new HttpError(400, 'Enter at least two letters of the last name.');
  }

  const query = initialClean ? `${lastNameClean} ${initialClean}` : lastNameClean;

  const reports = await Promise.all(
    towns.map(async (town) => {
      const key = `search:${town.slug}:${dataset}:${recordType}:${query}`;

      try {
        const results = await cachedLoad(key, SEARCH_CACHE_TTL_MS, () =>
          searchLimiter(async () => {
            const html = await searchBills({
              query,
              dataset,
              recordType,
              town: town.slug,
            });
            return parseSearchResults(html, { dataset }).results;
          }),
        );

        return {
          slug: town.slug,
          name: town.name,
          count: results.length,
          error: null,
          results,
        };
      } catch (error) {
        return {
          slug: town.slug,
          name: town.name,
          count: 0,
          error: error.message || 'Search failed for this town.',
          results: [],
        };
      }
    }),
  );

  const results = reports.flatMap((report) =>
    report.results.map((bill) => ({
      ...bill,
      town: report.slug,
      townName: report.name,
    })),
  );

  return {
    query,
    lastName: lastNameClean,
    initial: initialClean,
    dataset,
    recordType,
    // Do not send the row arrays twice; results already carry town info.
    towns: reports.map(({ results: _rows, ...report }) => report),
    results,
  };
}

async function getBill(bill, { includePayments = true, includeRelated = true } = {}) {
  const baseKey = ['bill', bill.town, bill.dataset, bill.byear, bill.btype, bill.bnum].join(':');

  const detailPromise = cachedLoad(`${baseKey}:detail`, BILL_CACHE_TTL_MS, async () => {
    const html = await billLimiter(() => fetchBillDetailHtml(bill));
    return parseBillDetail(html, {
      dataset: bill.dataset,
      byear: bill.byear,
      btype: bill.btype,
      bnum: bill.bnum,
    });
  });

  const paymentsPromise =
    includePayments && bill.dataset !== 'sanitation'
      ? cachedLoad(`${baseKey}:payments`, BILL_CACHE_TTL_MS, async () => {
          const html = await billLimiter(() => fetchPaymentHistoryHtml(bill));
          return html ? parsePaymentHistory(html) : null;
        })
      : Promise.resolve(null);

  const relatedPromise = includeRelated
    ? cachedLoad(`${baseKey}:related`, BILL_CACHE_TTL_MS, async () => {
        const html = await billLimiter(() => fetchRelatedBillsHtml(bill));
        return parseRelatedBills(html, { dataset: bill.dataset });
      })
    : Promise.resolve(null);

  const [detail, payments, related] = await Promise.all([
    detailPromise,
    paymentsPromise,
    relatedPromise,
  ]);

  return {
    detail,
    payments,
    related,
    fetchedAt: new Date().toISOString(),
  };
}

function sumField(items, selector) {
  return items.reduce((total, item) => {
    const value = selector(item);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function summarize(results, detailsIncluded) {
  const summary = {
    count: results.length,
    totalTax: roundMoney(sumField(results, (item) => item.totalTax)),
    totalPaid: roundMoney(sumField(results, (item) => item.paid)),
    totalOutstanding: roundMoney(sumField(results, (item) => item.outstanding)),
    payableCount: results.filter((item) => item.payable).length,
    detailsIncluded,
  };

  if (detailsIncluded) {
    summary.totalDueNow = roundMoney(
      sumField(results, (item) => item.detail?.due?.totalDueNow),
    );
    summary.paymentRecords = sumField(
      results,
      (item) => item.payments?.payments?.length,
    );
    summary.relatedRecords = sumField(
      results,
      (item) => item.related?.length,
    );
    summary.detailErrors = results.filter((item) => item.detailError).length;
  }

  return summary;
}

async function enrichResults(results) {
  const limited = results.slice(0, MAX_DEEP_RESULTS);
  let completed = 0;

  await Promise.all(
    limited.map(async (bill) => {
      try {
        const bundle = await getBill(bill, {
          includePayments: true,
          includeRelated: false,
        });
        bill.detail = bundle.detail;
        bill.payments = bundle.payments;
        bill.fetchedAt = bundle.fetchedAt;
      } catch (error) {
        bill.detailError = error.message || 'Could not load details.';
      } finally {
        completed += 1;
      }
    }),
  );

  for (const bill of results.slice(MAX_DEEP_RESULTS)) {
    bill.detailSkipped = `Details were not loaded for this row (limit ${MAX_DEEP_RESULTS}). Open the row to load it.`;
  }

  return completed;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

app.get('/api/health', (request, response) => {
  response.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    source: 'https://www.mytaxbill.org/inet/bill/home.do',
    towns: TOWNS.length,
    supportedTowns: SUPPORTED_TOWNS.length,
  });
});

app.get('/api/towns', (request, response) => {
  response.setHeader('Cache-Control', 'public, max-age=3600');
  response.json({
    towns: TOWNS,
    defaultTown: DEFAULT_TOWN,
    maxTowns: MAX_TOWNS_PER_SEARCH,
    totalCount: TOWNS.length,
    supportedCount: SUPPORTED_TOWNS.length,
    source: 'https://www.mytaxbill.org',
  });
});

app.get(
  '/api/search',
  asyncRoute(async (request, response) => {
    const dataset = normalizeDataset(request.query.dataset);
    const recordType = normalizeRecordType(request.query.recordType);
    const includeDetails = isTruthy(request.query.details);
    const towns = parseTownList(request.query);
    const search = await runSearch({
      lastName: request.query.last ?? request.query.lastName,
      initial: request.query.initial ?? request.query.firstInitial,
      dataset,
      recordType,
      towns,
    });
    const results = search.results.map((bill) => ({ ...bill }));

    const failedTowns = search.towns.filter((town) => town.error);
    if (results.length === 0 && failedTowns.length === search.towns.length) {
      throw new UpstreamError(
        failedTowns.length === 1
          ? failedTowns[0].error
          : `None of the selected towns returned results: ${failedTowns
              .map((town) => `${town.name}: ${town.error}`)
              .join('; ')}`,
      );
    }

    let detailsIncluded = false;
    if (includeDetails && results.length > 0) {
      await enrichResults(results);
      detailsIncluded = true;
    }

    const responseTowns = search.towns.map((town) => {
      if (!includeDetails || town.error) return town;
      const townRows = results.filter((bill) => bill.town === town.slug);
      return {
        ...town,
        count: townRows.length,
        detailErrors: townRows.filter((bill) => bill.detailError).length,
      };
    });

    response.json({
      query: search.query,
      lastName: search.lastName,
      initial: search.initial,
      dataset,
      recordType,
      towns: responseTowns,
      townCount: responseTowns.length,
      count: results.length,
      summary: summarize(results, detailsIncluded),
      results,
      fetchedAt: new Date().toISOString(),
      source: {
        name: 'Connecticut municipal records on mytaxbill.org',
        url: 'https://www.mytaxbill.org/inet/bill/home.do',
        note: 'Public records mirrored from mytaxbill.org. Towns, amounts, and availability may change; verify with the local Tax Collector.',
      },
    });
  }),
);

app.get(
  '/api/bill',
  asyncRoute(async (request, response) => {
    const dataset = normalizeDataset(request.query.dataset);
    const town = resolveTown(request.query.town || DEFAULT_TOWN);
    const byear = Number(request.query.year ?? request.query.byear);
    const btype = Number(request.query.type ?? request.query.btype);
    const bnum = cleanText(request.query.num ?? request.query.bnum);

    if (!town) {
      throw new HttpError(400, 'A valid Connecticut town is required.');
    }
    if (!town.supported) {
      throw new HttpError(400, `${town.name} is not available through mytaxbill.org.`);
    }
    if (!Number.isInteger(byear) || byear < 1900 || byear > 2100) {
      throw new HttpError(400, 'A valid bill year is required.');
    }
    if (!Number.isInteger(btype) || btype < 1 || btype > 99) {
      throw new HttpError(400, 'A valid bill type is required.');
    }
    if (!/^[A-Za-z0-9-]{1,20}$/.test(bnum)) {
      throw new HttpError(400, 'A valid bill number is required.');
    }

    const bundle = await getBill(
      { town: town.slug, townName: town.name, dataset, byear, btype, bnum },
      {
        includePayments: !['0', 'false', 'no'].includes(
          String(request.query.payments || '1').toLowerCase(),
        ),
        includeRelated: !['0', 'false', 'no'].includes(
          String(request.query.related || '1').toLowerCase(),
        ),
      },
    );

    if (!bundle.detail.billNumber) {
      throw new HttpError(502, 'mytaxbill.org returned an unexpected detail page.');
    }

    response.json({ ...bundle, town: { slug: town.slug, name: town.name } });
  }),
);

function csvEscape(value) {
  if (value == null) return '';
  let text = String(value);
  if (/^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text))) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function installmentSummary(detail) {
  if (!detail?.installments?.length) return '';
  return detail.installments
    .map((installment) => {
      const amounts = Object.values(installment.values || {})
        .map((value) => Number(String(value ?? '').replace(/[^0-9.-]/g, '')))
        .filter((value) => Number.isFinite(value));
      const amount = amounts.reduce((total, value) => total + value, 0);
      return `${installment.installment} ${installment.dueDate || ''} ${amount.toFixed(2)}`.trim();
    })
    .join(' | ');
}

app.get(
  '/api/export.csv',
  asyncRoute(async (request, response) => {
    const dataset = normalizeDataset(request.query.dataset);
    const recordType = normalizeRecordType(request.query.recordType);
    const includeDetails = isTruthy(request.query.details);
    const towns = parseTownList(request.query);
    const search = await runSearch({
      lastName: request.query.last ?? request.query.lastName,
      initial: request.query.initial ?? request.query.firstInitial,
      dataset,
      recordType,
      towns,
    });
    const { query, results: searchResults } = search;

    const failedTowns = search.towns.filter((town) => town.error);
    if (searchResults.length === 0 && failedTowns.length === search.towns.length) {
      throw new UpstreamError(
        failedTowns.length === 1
          ? failedTowns[0].error
          : `None of the selected towns returned results: ${failedTowns
              .map((town) => `${town.name}: ${town.error}`)
              .join('; ')}`,
      );
    }

    const results = searchResults.map((bill) => ({ ...bill }));

    if (includeDetails && results.length > 0) {
      await enrichResults(results);
    }

    const header = [
      'Town',
      'Bill Number',
      'Bill Year',
      'Bill Type Code',
      'Bill Type',
      'Unique ID',
      'District',
      'Taxpayer',
      'Care Of',
      'Address',
      'Property / Vehicle',
      'Total Tax',
      'Paid',
      'Outstanding',
      'Gross Assessment',
      'Exemption',
      'Net Assessment',
      'Town Mill Rate',
      'Total Due Now',
      'Tax Due',
      'Interest Due',
      'Lien Due',
      'Fee Due',
      'Payments This Year',
      'Installments',
      'Payment History Count',
      'Payment History Total',
      'Related Bills',
      'Detail URL',
      'Original Bill URL',
    ];

    const rows = results.map((bill) => {
      const detail = bill.detail || null;
      const payments = bill.payments || null;
      const installmentTotal = (detail?.installments || []).reduce((total, installment) => {
        const amounts = Object.values(installment.values || {})
          .map((value) => Number(String(value ?? '').replace(/[^0-9.-]/g, '')))
          .filter((value) => Number.isFinite(value));
        return total + amounts.reduce((sum, value) => sum + value, 0);
      }, 0);
      const paymentTotal =
        payments?.grandTotal?.total ??
        (payments?.payments || []).reduce((total, payment) => total + (payment.total || 0), 0);

      return [
        bill.townName,
        bill.billNumber,
        bill.byear,
        bill.btype,
        bill.billType,
        bill.uniqueId,
        bill.district,
        bill.name,
        detail?.careOf || bill.secondaryName,
        detail?.address,
        detail?.propertyLocation || bill.property,
        bill.totalTax,
        bill.paid,
        bill.outstanding,
        detail?.grossAssessment,
        detail?.exemption,
        detail?.netAssessment,
        detail?.townMillRate,
        detail?.due?.totalDueNow,
        detail?.due?.tax,
        detail?.due?.interest,
        detail?.due?.lien,
        detail?.due?.fee,
        detail?.paymentsThisYear?.amount,
        installmentSummary(detail),
        installmentTotal ? installmentTotal.toFixed(2) : '',
        payments?.payments?.length ?? '',
        payments ? paymentTotal.toFixed(2) : '',
        bill.related?.length ?? '',
        bill.detailUrl,
        detail?.originalBillUrl || bill.originalBillUrl,
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\r\n');

    const safeName = query.replace(/[^A-Za-z0-9-]+/g, '_') || 'results';
    const townPart =
      towns.length === 1 ? towns[0].slug : `${towns.length}-towns`;
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="connecticut-${townPart}-${dataset}-${safeName}.csv"`,
    );
    response.send(`\uFEFF${csv}`);
  }),
);

app.use(
  express.static(publicDir, {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(response, filePath) {
      if (filePath.endsWith('index.html')) {
        response.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);

app.use((request, response, next) => {
  if (request.path.startsWith('/api/')) {
    next();
    return;
  }
  response.sendFile(path.join(publicDir, 'index.html'));
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = error instanceof HttpError ? error.status : error instanceof UpstreamError ? 502 : 500;
  const message =
    error instanceof HttpError || error instanceof UpstreamError
      ? error.message
      : 'Unexpected server error.';

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.originalUrl}:`, error);
  }

  response.status(status).json({
    error: message,
    code: error.code || (status === 400 ? 'BAD_REQUEST' : 'SERVER_ERROR'),
  });
});

app.listen(PORT, () => {
  console.log(`Connecticut Tax Bill Search running at http://localhost:${PORT}`);
  console.log(
    `Towns: ${SUPPORTED_TOWNS.length}/${TOWNS.length} available; up to ${MAX_TOWNS_PER_SEARCH} per search`,
  );
  console.log(
    `Upstream concurrency: ${UPSTREAM_CONCURRENCY}; town-search concurrency: ${SEARCH_TOWN_CONCURRENCY}; deep-result limit: ${MAX_DEEP_RESULTS}`,
  );
});
