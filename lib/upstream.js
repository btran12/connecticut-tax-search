import { BASE_URL } from './parse.js';
import { DEFAULT_TOWN, resolveTown } from './towns.js';

const USER_AGENT =
  'ConnecticutTaxSearch/1.1 (+local public-records lookup; respects site caching)';
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;

export class UpstreamError extends Error {
  constructor(message, code = 'UPSTREAM_ERROR') {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
  }
}

function normalizeTown(value) {
  const town = resolveTown(value || DEFAULT_TOWN);
  if (!town) {
    throw new UpstreamError(`Unknown Connecticut town: ${value}`, 'BAD_TOWN');
  }
  if (!town.supported) {
    throw new UpstreamError(
      `${town.name} is not available through mytaxbill.org.`,
      'UNSUPPORTED_TOWN',
    );
  }
  return town;
}

function homePath(town, dataset) {
  const base = `/inet/bill/home.do?town=${encodeURIComponent(town.slug)}`;
  return dataset === 'sanitation' ? `${base}&search=2` : base;
}

class Session {
  constructor() {
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  absorbCookies(response) {
    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [];

    for (const raw of setCookies) {
      const pair = raw.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  async request(target, { method = 'GET', form = null } = {}) {
    let url = new URL(target, BASE_URL).toString();
    let currentMethod = method;
    let body = form ? new URLSearchParams(form).toString() : undefined;

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const headers = {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      };
      if (this.cookies.size) headers.Cookie = this.cookieHeader();
      if (body != null) headers['Content-Type'] = 'application/x-www-form-urlencoded';

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response;
      try {
        response = await fetch(url, {
          method: currentMethod,
          body,
          headers,
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new UpstreamError('The mytaxbill.org request timed out.', 'TIMEOUT');
        }
        throw new UpstreamError(
          `Could not reach mytaxbill.org: ${error.message}`,
          'NETWORK',
        );
      } finally {
        clearTimeout(timer);
      }

      this.absorbCookies(response);

      if (REDIRECT_CODES.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new UpstreamError('The upstream site sent an empty redirect.', 'UPSTREAM');
        }
        url = new URL(location, url).toString();
        if (response.status === 303 || (response.status <= 302 && currentMethod === 'POST')) {
          currentMethod = 'GET';
          body = undefined;
        }
        continue;
      }

      return { response, text: await response.text(), url };
    }

    throw new UpstreamError('Too many redirects from mytaxbill.org.', 'UPSTREAM');
  }

  get(target) {
    return this.request(target);
  }

  post(target, form) {
    return this.request(target, { method: 'POST', form });
  }
}

function isUsableSearchPage(html) {
  return html.includes('billSearchForm') || html.includes('searchResult');
}

function isSessionError(html) {
  const trimmed = html.trim();
  return (
    html.length < 500 ||
    /^Please go back to your town/i.test(trimmed) ||
    /^Your session has expired/i.test(trimmed)
  );
}

function extractSearchAction(html) {
  const match = html.match(/action="([^"]*search\.do[^;"]*(?:;jsessionid=[^"]*)?)"/i);
  return match ? match[1] : '/inet/bill/search.do';
}

/**
 * Start a fresh upstream session and run one name search in one town.
 * A fresh session is used so concurrent searches cannot clobber each other's
 * server-side search state.
 */
export async function searchBills({ query, dataset = 'tax', recordType = 0, town = DEFAULT_TOWN }) {
  const resolvedTown = normalizeTown(town);
  const session = new Session();
  const home = await session.get(homePath(resolvedTown, dataset));

  if (!isUsableSearchPage(home.text)) {
    throw new UpstreamError(
      `${resolvedTown.name} did not return a usable search page. It may not publish ${
        dataset === 'sanitation' ? 'sanitation records' : 'tax bills'
      } through mytaxbill.org.`,
      'SESSION',
    );
  }

  const action = extractSearchAction(home.text);
  const result = await session.post(action, {
    actionType: 'Name',
    taxPayerName: query,
    propertyName: '',
    uniqueId: '',
    propertyNumber: '',
    recordType: String(recordType),
    billNum: '',
    billYear: '',
    billType: '',
    linkType: 'MV',
    linkNum: '',
    linkYear: '',
    accountId: '',
    linkId: '',
    dba: '',
    searchbtn: 'Search',
  });

  if (isSessionError(result.text)) {
    throw new UpstreamError(
      `mytaxbill.org rejected the ${resolvedTown.name} search session. Please try again in a moment.`,
      'SESSION',
    );
  }

  return result.text;
}

const sharedSessions = new Map();
const sharedSessionPromises = new Map();

function sessionKey(town, dataset) {
  return `${town.slug}:${dataset}`;
}

async function getSharedSession(town, dataset = 'tax', forceRefresh = false) {
  const key = sessionKey(town, dataset);
  if (forceRefresh) sharedSessions.delete(key);
  const existing = sharedSessions.get(key);
  if (existing) return existing;

  if (!sharedSessionPromises.has(key)) {
    const promise = (async () => {
      const session = new Session();
      const home = await session.get(homePath(town, dataset));
      if (!isUsableSearchPage(home.text)) {
        throw new UpstreamError(
          `Could not establish a session with ${town.name} on mytaxbill.org.`,
          'SESSION',
        );
      }
      sharedSessions.set(key, session);
      return session;
    })().finally(() => {
      sharedSessionPromises.delete(key);
    });
    sharedSessionPromises.set(key, promise);
  }

  return sharedSessionPromises.get(key);
}

async function fetchHtml(path, town, dataset = 'tax') {
  const resolvedTown = normalizeTown(town);
  const key = sessionKey(resolvedTown, dataset);
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const session = await getSharedSession(resolvedTown, dataset, attempt > 0);
      const result = await session.get(path);
      if (isSessionError(result.text)) {
        sharedSessions.delete(key);
        lastError = new UpstreamError(
          `The ${resolvedTown.name} session expired while reading this record.`,
          'SESSION',
        );
        continue;
      }
      return result.text;
    } catch (error) {
      lastError = error;
      if (error.code !== 'SESSION') throw error;
    }
  }

  throw lastError || new UpstreamError('Unable to read the bill record.');
}

function detailPath({ dataset, byear, btype, bnum }) {
  const params = new URLSearchParams({
    byear: String(byear),
    btype: String(btype),
    bnum: String(bnum),
  });
  if (dataset === 'sanitation') {
    params.set('search', '2');
    params.set('type', '2');
  } else {
    params.set('type', '0');
  }
  return `/inet/bill/detail.do?${params.toString()}`;
}

function relatedPath({ dataset, byear, btype, bnum }) {
  const params = new URLSearchParams({
    type: dataset === 'sanitation' ? '2' : '0',
    byear: String(byear),
    btype: String(btype),
    bnum: String(bnum),
  });
  return `/inet/bill/viewAllBill.do?${params.toString()}`;
}

function paymentHistoryPath({ byear, btype, bnum }) {
  const params = new URLSearchParams({
    byear: String(byear),
    btype: String(btype),
    bnum: String(bnum),
  });
  return `/inet/bill/irs.do?${params.toString()}`;
}

export function fetchBillDetailHtml(bill) {
  return fetchHtml(detailPath(bill), bill.town, bill.dataset);
}

export function fetchPaymentHistoryHtml(bill) {
  if (bill.dataset === 'sanitation') return Promise.resolve(null);
  return fetchHtml(paymentHistoryPath(bill), bill.town, 'tax');
}

export function fetchRelatedBillsHtml(bill) {
  return fetchHtml(relatedPath(bill), bill.town, bill.dataset);
}
