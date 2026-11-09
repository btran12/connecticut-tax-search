const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const els = {
  form: $('#search-form'),
  lastName: $('#last-name'),
  initial: $('#first-initial'),
  dataset: $('#dataset'),
  recordType: $('#record-type'),
  deep: $('#deep-search'),
  searchButton: $('#search-button'),
  searchLabel: $('#search-button .btn-label'),
  status: $('#status'),
  statusText: $('#status-text'),
  summary: $('#summary'),
  statCount: $('#stat-count'),
  statQuery: $('#stat-query'),
  statTax: $('#stat-tax'),
  statPaid: $('#stat-paid'),
  statOutstanding: $('#stat-outstanding'),
  statDueCard: $('#stat-due-card'),
  statDue: $('#stat-due'),
  statDueNote: $('#stat-due-note'),
  townPicker: $('#town-picker'),
  townButton: $('#town-picker-button'),
  townPanel: $('#town-picker-panel'),
  townLabel: $('#town-picker-label'),
  townSearch: $('#town-search'),
  townList: $('#town-list'),
  townChips: $('#town-chips'),
  townNote: $('#town-panel-note'),
  townDefault: $('#town-select-default'),
  townNone: $('#town-select-none'),
  townBreakdown: $('#town-breakdown'),
  townHeaders: $$('.town-col'),
  resultsSection: $('#results-section'),
  resultsSubtitle: $('#results-subtitle'),
  filter: $('#result-filter'),
  loadAll: $('#load-all'),
  exportCsv: $('#export-csv'),
  progress: $('#progress'),
  progressLabel: $('#progress-label'),
  progressCount: $('#progress-count'),
  progressBar: $('#progress-bar'),
  tableWrap: $('.table-wrap'),
  table: $('#results-table'),
  tbody: $('#results-body'),
  empty: $('#empty-results'),
  toast: $('#toast'),
  dueHeaders: $$('.due-col'),
};

const state = {
  meta: null,
  results: [],
  details: new Map(),
  errors: new Map(),
  inflight: new Map(),
  loading: new Set(),
  expanded: new Set(),
  filter: '',
  searchToken: 0,
  loadingAll: false,
  cancelLoadAll: false,
  progressTotal: 0,
  progressDone: 0,
  renderQueued: false,
  townCatalog: [],
  towns: new Set(),
  defaultTown: 'hartford',
  maxTowns: 10,
  townFilter: '',
  townsLoaded: false,
};

const DATASET_LABELS = {
  tax: 'Tax bills',
  sanitation: 'Sanitation bills',
};

const escapeMap = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => escapeMap[character]);
}

function money(value) {
  const number = Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) return '—';
  return number.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function amountClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return 'amount zero';
  return 'amount';
}

function integer(value) {
  const number = Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) return '—';
  return number.toLocaleString('en-US');
}

function billKey(bill) {
  return `${bill.town}:${bill.dataset}:${bill.byear}:${bill.btype}:${bill.bnum}`;
}

function typeClass(type) {
  const text = String(type || '');
  if (/real estate/i.test(text)) return 'real-estate';
  if (/motor|vehicle/i.test(text)) return 'motor-vehicle';
  if (/personal/i.test(text)) return 'personal-property';
  if (/sanitation|sewer|sani/i.test(text)) return 'sanitation';
  return '';
}

function typeBadge(type) {
  const label = type || 'Bill';
  return `<span class="type-badge ${typeClass(label)}">${esc(label)}</span>`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 7000);
}

function setStatus(message) {
  if (!message) {
    els.status.hidden = true;
    return;
  }
  els.statusText.textContent = message;
  els.status.hidden = false;
}

function setBusy(busy) {
  els.searchButton.disabled = busy;
  els.searchLabel.textContent = busy ? 'Searching…' : 'Search records';
}

function findBill(key) {
  return state.results.find((bill) => billKey(bill) === key);
}

function bundleFor(bill) {
  return state.details.get(billKey(bill));
}

function hasDetail(bill) {
  return Boolean(state.details.get(billKey(bill))?.detail);
}

function filteredResults() {
  const needle = state.filter.trim().toLowerCase();
  if (!needle) return state.results;
  return state.results.filter((bill) => {
    const bundle = bundleFor(bill);
    const detail = bundle?.detail;
    return [
      bill.billNumber,
      bill.name,
      bill.secondaryName,
      bill.property,
      bill.uniqueId,
      bill.billType,
      bill.townName,
      bill.town,
      detail?.name,
      detail?.careOf,
      detail?.address,
      detail?.propertyLocation,
      detail?.uniqueId,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
}

/* ---------------------------------------------------------------- *
 * Town picker
 * ---------------------------------------------------------------- */

function townBySlug(slug) {
  return state.townCatalog.find((town) => town.slug === slug) || null;
}

function selectedTownList() {
  return [...state.towns].map(townBySlug).filter(Boolean);
}

function townDisplayName(town) {
  return town?.name || town?.slug || '';
}

function updateTownLabel() {
  const selected = selectedTownList();

  if (!state.townsLoaded) {
    els.townLabel.textContent = 'Loading towns…';
    els.townButton.disabled = true;
    return;
  }

  els.townButton.disabled = false;

  if (!selected.length) {
    els.townLabel.textContent = 'Select towns';
  } else if (selected.length === 1) {
    els.townLabel.textContent = selected[0].name;
  } else {
    els.townLabel.textContent = `${selected[0].name} + ${selected.length - 1} more`;
  }

  els.townButton.title = selected.length
    ? selected.map((town) => town.name).join(', ')
    : 'Choose one or more Connecticut towns';
}

function updateTownNote() {
  if (!state.townsLoaded) return;
  const total = state.townCatalog.length;
  const available = state.townCatalog.filter((town) => town.supported).length;
  const atLimit = state.towns.size >= state.maxTowns;
  els.townNote.textContent =
    `${state.towns.size} of ${state.maxTowns} selected · ${available} of ${total} towns available` +
    (atLimit ? ' · limit reached' : '');
}

function townChipMarkup(town) {
  return `
    <span class="town-chip">
      <span>${esc(town.name)}</span>
      <button
        type="button"
        class="town-chip-remove"
        data-town-remove="${esc(town.slug)}"
        aria-label="Remove ${esc(town.name)}"
        title="Remove ${esc(town.name)}"
      >×</button>
    </span>
  `;
}

function renderTownChips() {
  const selected = selectedTownList();
  if (!selected.length) {
    els.townChips.innerHTML = '<span class="town-chips-empty">Select at least one town</span>';
    return;
  }
  els.townChips.innerHTML = selected.map(townChipMarkup).join('');
}

function townOptionMarkup(town) {
  const checked = state.towns.has(town.slug);
  const disabled = !town.supported;
  return `
    <label
      class="town-option${disabled ? ' is-unavailable' : ''}${checked ? ' is-selected' : ''}"
      title="${disabled ? 'This town is not currently published on mytaxbill.org' : esc(town.name)}"
    >
      <input
        type="checkbox"
        value="${esc(town.slug)}"
        data-town-option
        ${checked ? 'checked' : ''}
        ${disabled ? 'disabled' : ''}
      />
      <span class="town-option-name">${esc(town.name)}</span>
      ${disabled ? '<span class="town-option-tag">unavailable</span>' : ''}
    </label>
  `;
}

function renderTownList() {
  if (!state.townsLoaded) {
    els.townList.innerHTML = '<p class="town-list-empty">Loading towns…</p>';
    return;
  }

  const needle = state.townFilter.trim().toLowerCase();
  const towns = state.townCatalog.filter(
    (town) => !needle || town.name.toLowerCase().includes(needle),
  );

  els.townList.innerHTML = towns.length
    ? towns.map(townOptionMarkup).join('')
    : `<p class="town-list-empty">No towns match “${esc(state.townFilter.trim())}”.</p>`;
}

function renderTownPicker() {
  updateTownLabel();
  updateTownNote();
  renderTownChips();
  renderTownList();
}

function setTownSelected(slug, selected) {
  if (!selected) {
    state.towns.delete(slug);
  } else {
    if (state.towns.has(slug)) return;
    if (state.towns.size >= state.maxTowns) {
      showToast(`Select up to ${state.maxTowns} towns per search.`);
      renderTownList();
      return;
    }
    state.towns.add(slug);
  }
  renderTownPicker();
}

function setTownPanelOpen(open) {
  const next = Boolean(open);
  els.townPanel.hidden = !next;
  els.townButton.setAttribute('aria-expanded', next ? 'true' : 'false');
  els.townPicker.classList.toggle('is-open', next);
  if (next) {
    renderTownList();
    els.townSearch.value = state.townFilter;
    els.townSearch.focus();
  } else {
    state.townFilter = '';
    els.townSearch.value = '';
  }
}

async function loadTowns() {
  try {
    const response = await fetch('/api/towns');
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load the town list.');
    state.townCatalog = Array.isArray(data.towns) ? data.towns : [];
    state.maxTowns = Number(data.maxTowns) || 10;
    state.defaultTown = data.defaultTown || 'hartford';
    state.towns = new Set(
      state.defaultTown && townBySlug(state.defaultTown)
        ? [state.defaultTown]
        : [],
    );
  } catch (error) {
    state.townCatalog = [
      {
        name: 'hartford',
        slug: 'hartford',
        supported: true,
        url: 'https://www.mytaxbill.org/inet/bill/home.do?town=hartford',
      },
    ];
    state.towns = new Set(['hartford']);
    showToast(
      error.message ||
        'Could not load the Connecticut town list; hartford is available.',
    );
  }

  state.townsLoaded = true;
  renderTownPicker();
}

function applyTownsFromUrl(params) {
  const raw = params.get('towns') || params.get('town');
  if (!raw) return;

  const slugs = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const valid = slugs
    .map((value) =>
      state.townCatalog.find(
        (town) => town.slug === value || town.name.toLowerCase() === value.toLowerCase(),
      ),
    )
    .filter((town) => town && town.supported);

  if (valid.length) {
    state.towns = new Set(valid.slice(0, state.maxTowns).map((town) => town.slug));
  }
}

/* ---------------------------------------------------------------- *
 * Search
 * ---------------------------------------------------------------- */

async function performSearch() {
  const last = els.lastName.value.trim();
  const initial = els.initial.value.trim();
  const dataset = els.dataset.value;
  const recordType = els.recordType.value;
  const includeDetails = els.deep.checked;
  const towns = selectedTownList();

  if (!last) {
    showToast('Enter a last name to search.');
    els.lastName.focus();
    return;
  }

  if (!towns.length) {
    showToast('Select at least one town to search.');
    setTownPanelOpen(true);
    return;
  }

  const params = new URLSearchParams({
    last,
    initial,
    towns: towns.map((town) => town.slug).join(','),
    dataset,
    recordType,
    details: includeDetails ? '1' : '0',
  });

  const townLabel =
    towns.length === 1 ? towns[0].name : `${towns.length} towns`;

  const token = ++state.searchToken;
  setBusy(true);
  setStatus(
    includeDetails
      ? `Searching ${townLabel} and loading full details. Large result sets can take a minute…`
      : `Searching ${townLabel} on mytaxbill.org…`,
  );

  try {
    const response = await fetch(`/api/search?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Search failed (HTTP ${response.status}).`);
    }
    if (token !== state.searchToken) return;

    state.meta = data;
    state.results = (data.results || []).map((bill) => ({ ...bill }));
    state.details.clear();
    state.errors.clear();
    state.inflight.clear();
    state.expanded.clear();
    state.filter = '';
    els.filter.value = '';
    state.progressDone = 0;
    state.progressTotal = 0;
    hideProgress();

    if (includeDetails) {
      for (const bill of state.results) {
        const key = billKey(bill);
        if (bill.detail) {
          state.details.set(key, {
            detail: bill.detail,
            payments: bill.payments || null,
            related: null,
            relatedLoaded: false,
            fetchedAt: bill.fetchedAt,
          });
        }
        if (bill.detailError) state.errors.set(key, bill.detailError);
      }
    }

    updateUrl();
    render();
    setStatus(null);

    const failedTowns = (data.towns || []).filter((town) => town.error);
    if (!state.results.length) {
      showToast('No bills matched that search. Try a shorter last name or remove the initial.');
    } else if (failedTowns.length) {
      showToast(
        `${failedTowns.length} of ${data.towns.length} towns could not be searched: ${failedTowns
          .map((town) => town.name)
          .join(', ')}.`,
      );
    }
  } catch (error) {
    if (token !== state.searchToken) return;
    setStatus(null);
    showToast(error.message || 'Search failed.');
  } finally {
    if (token === state.searchToken) setBusy(false);
  }
}

function updateUrl() {
  if (!state.meta) return;
  const params = new URLSearchParams();
  params.set('last', state.meta.lastName || '');
  if (state.meta.initial) params.set('initial', state.meta.initial);
  params.set(
    'towns',
    (state.meta.towns || []).map((town) => town.slug).join(','),
  );
  params.set('dataset', state.meta.dataset);
  params.set('recordType', state.meta.recordType);
  if (els.deep.checked) params.set('details', '1');

  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', next);
  document.title = `${state.meta.query} · Connecticut Tax Bill Search`;
}

/* ---------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------- */

function render() {
  const hasMeta = Boolean(state.meta);
  els.summary.hidden = !hasMeta;
  els.resultsSection.hidden = !hasMeta;
  if (!hasMeta) return;

  renderSummary();
  renderTownBreakdown();
  renderResults();
  renderToolbar();
}

function renderSummary() {
  const meta = state.meta;
  const summary = meta.summary || {};
  const towns = meta.towns || [];
  const townText =
    towns.length === 1 ? towns[0].name : `${towns.length.toLocaleString('en-US')} towns`;

  els.statCount.textContent = meta.count.toLocaleString('en-US');
  els.statQuery.textContent = `${townText} · ${DATASET_LABELS[meta.dataset] || 'Records'} · “${meta.query}”`;
  els.statTax.textContent = money(summary.totalTax);
  els.statPaid.textContent = money(summary.totalPaid);
  els.statOutstanding.textContent = money(summary.totalOutstanding);

  const loadedDue = state.results.reduce(
    (total, bill) => total + (Number(bundleFor(bill)?.detail?.due?.totalDueNow) || 0),
    0,
  );
  const loadedCount = state.results.filter((bill) => Boolean(bundleFor(bill)?.detail)).length;
  const allLoaded = state.results.length > 0 && loadedCount === state.results.length;
  const showDue = Boolean(summary.detailsIncluded) || allLoaded;
  els.statDueCard.hidden = !showDue;
  if (showDue) {
    els.statDue.textContent = money(summary.detailsIncluded ? summary.totalDueNow : loadedDue);
    const bits = [];
    if (summary.paymentRecords) bits.push(`${summary.paymentRecords} payment record${summary.paymentRecords === 1 ? '' : 's'}`);
    if (summary.detailErrors) bits.push(`${summary.detailErrors} detail error${summary.detailErrors === 1 ? '' : 's'}`);
    els.statDueNote.textContent = bits.length ? bits.join(' · ') : 'Includes interest and fees';
  }
}

function renderTownBreakdown() {
  const towns = state.meta?.towns || [];
  if (!towns.length) {
    els.townBreakdown.hidden = true;
    return;
  }

  els.townBreakdown.hidden = false;
  els.townBreakdown.innerHTML = towns
    .map((town) => {
      if (town.error) {
        return `
          <span class="town-result is-error" title="${esc(town.error)}">
            <strong>${esc(town.name)}</strong>
            <span>search failed</span>
          </span>
        `;
      }
      const detailNote =
        town.detailErrors > 0
          ? ` · ${town.detailErrors} detail error${town.detailErrors === 1 ? '' : 's'}`
          : '';
      return `
        <span class="town-result">
          <strong>${esc(town.name)}</strong>
          <span>${town.count.toLocaleString('en-US')} bill${town.count === 1 ? '' : 's'}${detailNote}</span>
        </span>
      `;
    })
    .join('');
}

function renderToolbar() {
  const meta = state.meta;
  const shown = filteredResults().length;
  const retrieved = formatDateTime(meta.fetchedAt);
  const towns = meta.towns || [];
  const townBit =
    towns.length === 1 ? towns[0].name : `${towns.length} towns`;
  const bits = [
    townBit,
    DATASET_LABELS[meta.dataset] || 'Records',
    `${meta.count.toLocaleString('en-US')} bill${meta.count === 1 ? '' : 's'}`,
  ];
  if (state.filter.trim() && shown !== meta.count) {
    bits.push(`${shown} shown after filter`);
  }
  if (retrieved) bits.push(`retrieved ${retrieved}`);

  els.resultsSubtitle.textContent = bits.join(' · ');

  const remaining = state.results.filter((bill) => !hasDetail(bill)).length;
  els.loadAll.hidden = state.results.length === 0 || (remaining === 0 && !state.loadingAll);
  if (state.loadingAll) {
    els.loadAll.textContent = 'Stop loading';
    els.loadAll.classList.add('btn-danger');
    els.loadAll.classList.remove('btn-secondary');
  } else {
    els.loadAll.textContent = remaining ? `Load all details (${remaining})` : 'Load all details';
    els.loadAll.classList.remove('btn-danger');
    els.loadAll.classList.add('btn-secondary');
  }

  els.exportCsv.disabled = state.results.length === 0;
}

function renderResults() {
  const filtered = filteredResults();
  const showDue =
    Boolean(state.meta?.summary?.detailsIncluded) ||
    state.results.some((bill) => Boolean(bundleFor(bill)?.detail));
  const showTown = (state.meta?.towns?.length || 0) > 1;

  for (const header of els.dueHeaders) header.hidden = !showDue;
  for (const header of els.townHeaders) header.hidden = !showTown;

  els.tableWrap.hidden = filtered.length === 0;
  els.empty.hidden = filtered.length !== 0;

  if (filtered.length === 0) {
    const heading = els.empty.querySelector('h3');
    const copy = els.empty.querySelector('p');
    if (state.results.length === 0) {
      heading.textContent = 'No matching bills';
      copy.innerHTML =
        'Try a shorter last name, remove the first initial, add another town, or check the <em>All bills</em> filter.';
    } else {
      heading.textContent = 'No rows match that filter';
      copy.textContent = 'Clear the filter box to see all results again.';
    }
  }

  els.tbody.innerHTML = filtered
    .map((bill) => renderRow(bill, showDue, showTown))
    .join('');

  renderToolbar();
}

function renderRow(bill, showDue, showTown) {
  const key = billKey(bill);
  const index = state.results.indexOf(bill);
  const bundle = bundleFor(bill);
  const detail = bundle?.detail;
  const isOpen = state.expanded.has(key);
  const name = detail?.name || bill.name || bill.secondaryName || '—';
  const secondary = detail?.careOf || bill.secondaryName;
  const property = detail?.propertyLocation || bill.property;
  const dueNow = detail?.due?.totalDueNow;
  const outstanding = bill.outstanding;
  const hasBalance = Number(outstanding) > 0;

  const mainRow = `
    <tr class="bill-row ${isOpen ? 'is-open' : ''}" data-key="${esc(key)}">
      <td class="col-expand">
        <button
          class="expand-btn"
          type="button"
          data-action="toggle"
          data-key="${esc(key)}"
          aria-expanded="${isOpen ? 'true' : 'false'}"
          aria-controls="detail-${index}"
          title="${isOpen ? 'Hide details' : 'Show all available details'}"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M5.5 3.5 10 8l-4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </td>
      <td>
        <a class="bill-number" href="${esc(bill.detailUrl || '#')}" target="_self" title="Open the official record">${esc(bill.billNumber)}</a>
        ${bill.uniqueId ? `<span class="unique-id">ID ${esc(bill.uniqueId)}</span>` : ''}
      </td>
      ${
        showTown
          ? `<td class="town-col"><span class="town-pill">${esc(bill.townName || bill.town)}</span></td>`
          : ''
      }
      <td>
        <span class="name">${esc(name)}</span>
        ${secondary && secondary !== name ? `<span class="secondary">${esc(secondary)}</span>` : ''}
      </td>
      <td>${typeBadge(bill.billType)}</td>
      <td><span class="property">${esc(property || '—')}</span></td>
      <td class="num"><span class="${amountClass(bill.totalTax)}">${money(bill.totalTax)}</span></td>
      <td class="num"><span class="${amountClass(bill.paid)}">${money(bill.paid)}</span></td>
      <td class="num"><span class="${amountClass(outstanding)}${hasBalance ? ' outstanding has-balance' : ' outstanding'}">${money(outstanding)}</span></td>
      ${
        showDue
          ? `<td class="num due-col"><span class="amount due-now">${detail ? money(dueNow) : '—'}</span></td>`
          : ''
      }
      <td class="col-links">
        <a class="record-link" href="${esc(bill.detailUrl || '#')}" target="_self">Open ↗</a>
      </td>
    </tr>
  `;

  const detailRow = isOpen
    ? `<tr class="detail-row" id="detail-${index}"><td colspan="${(showDue ? 10 : 9) + (showTown ? 1 : 0)}">${renderDetail(bill)}</td></tr>`
    : '';

  return mainRow + detailRow;
}

function detailField(label, value, mono = false) {
  const display = value == null || value === '' ? '—' : value;
  return `
    <div class="detail-field">
      <dt>${esc(label)}</dt>
      <dd class="${mono ? 'mono' : ''}">${esc(display)}</dd>
    </div>
  `;
}

function renderDetail(bill) {
  const key = billKey(bill);
  const bundle = bundleFor(bill);

  if (!bundle) {
    if (state.errors.has(key)) {
      return `
        <div class="detail-panel">
          <div class="detail-error">
            <strong>Could not load this record.</strong><br />
            ${esc(state.errors.get(key))}
            <div style="margin-top:10px">
              <button class="btn btn-ghost" type="button" data-action="retry" data-key="${esc(key)}">Try again</button>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="detail-panel">
        <div class="detail-state"><span class="spinner" aria-hidden="true"></span> Loading bill, assessment, installment, and payment details…</div>
        <div class="skeleton wide"></div>
        <div class="skeleton medium"></div>
        <div class="skeleton"></div>
      </div>
    `;
  }

  const detail = bundle.detail || {};
  const payments = bundle.payments;
  const related = bundle.related;
  const due = detail.due || {};

  const dueRows = [
    ['Tax / principal / interest due', due.tax],
    ['Interest due', due.interest],
    ['Lien due', due.lien],
    ['Fee due', due.fee],
    ['Total due now', due.totalDueNow, true],
  ];

  const dueBlock = dueRows.some(([, value]) => value != null)
    ? `
      <div class="detail-block">
        <h4>Amount due</h4>
        <div class="mini-table-wrap">
          <table class="mini-table">
            <thead><tr><th>Component</th><th class="num">Amount</th></tr></thead>
            <tbody>
              ${dueRows
                .map(
                  ([label, value, strong]) =>
                    `<tr class="${strong ? 'total-row' : ''}"><td>${esc(label)}</td><td class="num">${money(value)}</td></tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `
    : '';

  const installmentBlock = renderInstallments(detail);
  const paymentBlock = renderPayments(bill, bundle);
  const relatedBlock = renderRelated(bill, bundle);

  const links = [
    ['Official record', bill.detailUrl],
    ['PDF statement', detail.pdfUrl],
    ['Original tax bill', detail.originalBillUrl],
    ['All bills for this account', bill.allBillsUrl],
  ]
    .filter(([, href]) => Boolean(href))
    .map(
      ([label, href]) =>
        `<a class="btn btn-ghost" href="${esc(href)}" target="_self">${esc(label)} ↗</a>`,
    )
    .join('');

  const retrieved = formatDateTime(bundle.fetchedAt);

  return `
    <div class="detail-panel">
      <div class="detail-head">
        <div>
          <h3>${esc(detail.billType || bill.billType || 'Bill')} <span>${esc(detail.billNumber || bill.billNumber)}</span></h3>
          <p>${esc(bill.townName || bill.town)} · ${esc(detail.name || bill.name || 'Taxpayer not listed')}${retrieved ? ` · retrieved ${esc(retrieved)}` : ''}</p>
        </div>
        <div class="due-callout">
          <span>Total due now</span>
          <strong>${money(due.totalDueNow)}</strong>
        </div>
      </div>

      <dl class="detail-grid">
        ${detailField('Town', bill.townName || bill.town)}
        ${detailField('Taxpayer', detail.name || bill.name)}
        ${detailField('Care of', detail.careOf || bill.secondaryName)}
        ${detailField('Mailing address', detail.address)}
        ${detailField('Property / vehicle', detail.propertyLocation || bill.property)}
        ${detailField('Unique ID', detail.uniqueId || bill.uniqueId, true)}
        ${detailField('District', detail.district || bill.district, true)}
        ${detailField('MBL', detail.mbl, true)}
        ${detailField('Volume & page', detail.volumePage, true)}
        ${detailField('Gross assessment', integer(detail.grossAssessment))}
        ${detailField('Exemption', integer(detail.exemption))}
        ${detailField('Net assessment', integer(detail.netAssessment))}
        ${detailField('Town mill rate', detail.townMillRate)}
        ${detailField('District mill rate', detail.districtMillRate)}
        ${detailField('Town benefit', money(detail.townBenefit))}
        ${detailField('Elderly benefit', money(detail.elderlyBenefit))}
        ${detailField('Bill information as of', detail.billInfoAsOf)}
      </dl>

      ${dueBlock}
      ${installmentBlock}
      ${paymentBlock}
      ${relatedBlock}

      <div class="detail-links">${links}</div>
    </div>
  `;
}

function renderInstallments(detail) {
  const installments = detail.installments || [];
  if (!installments.length) return '';

  const columns = detail.installmentColumns?.length
    ? detail.installmentColumns
    : ['Installment', 'Due Date', 'Amount'];

  const head = columns.map((column) => `<th class="${column === 'Installment' || column === 'Due Date' ? '' : 'num'}">${esc(column)}</th>`).join('');

  const rowMarkup = (row, className = '') => {
    const cells = columns.map((column, index) => {
      let value = '';
      if (index === 0) value = row.installment || '';
      else if (index === 1) value = row.dueDate || '';
      else value = row.values?.[column] ?? '';
      const isNumeric = index >= 2;
      return `<td class="${isNumeric ? 'num' : ''}">${esc(value || (isNumeric ? '—' : ''))}</td>`;
    });
    return `<tr class="${className}">${cells.join('')}</tr>`;
  };

  const body = installments.map((installment) => rowMarkup(installment)).join('');
  const adjustment = detail.adjustment
    ? rowMarkup({ installment: 'Adjustment', values: detail.adjustment.values })
    : '';
  const totals = detail.totals
    ? rowMarkup({ installment: 'Total', values: detail.totals.values }, 'total-row')
    : '';
  const paymentsToDate = detail.paymentsToDate
    ? `<tr class="total-row"><td>Payments to date</td><td></td><td class="num" colspan="${Math.max(1, columns.length - 2)}">${money(detail.paymentsToDate.amount)}</td></tr>`
    : '';

  return `
    <div class="detail-block">
      <h4>Installment schedule</h4>
      <div class="mini-table-wrap">
        <table class="mini-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body}${adjustment}${totals}${paymentsToDate}</tbody>
        </table>
      </div>
      ${
        detail.paymentsThisYear
          ? `<p class="secondary" style="margin:7px 0 0">Payments made in ${esc(detail.paymentsThisYear.year)}: <strong>${money(detail.paymentsThisYear.amount)}</strong></p>`
          : ''
      }
    </div>
  `;
}

function renderPayments(bill, bundle) {
  if (bill.dataset === 'sanitation') return '';

  const payments = bundle.payments;
  if (!payments) {
    return `
      <div class="detail-block">
        <h4>Payment history</h4>
        <p class="secondary" style="margin:0">No payment history endpoint is available for this record.</p>
      </div>
    `;
  }

  const rows = payments.payments || [];
  const grandTotal = payments.grandTotal;

  if (!rows.length) {
    return `
      <div class="detail-block">
        <h4>Payment history</h4>
        <div class="mini-table-wrap">
          <table class="mini-table">
            <tbody><tr><td class="empty-cell">No payment records were returned for this account.</td></tr></tbody>
          </table>
        </div>
      </div>
    `;
  }

  const body = rows
    .map(
      (payment) => `
        <tr>
          <td class="mono">${esc(payment.billNumber)}</td>
          <td>${esc(payment.billType || '')}</td>
          <td>${esc(payment.paidDate || '')}</td>
          <td class="num">${money(payment.tax)}</td>
          <td class="num">${money(payment.interest)}</td>
          <td class="num">${money(payment.lien)}</td>
          <td class="num">${money(payment.fee)}</td>
          <td class="num">${money(payment.total)}</td>
        </tr>
      `,
    )
    .join('');

  const totalRow = grandTotal
    ? `
      <tr class="total-row">
        <td colspan="3">Grand total</td>
        <td class="num">${money(grandTotal.tax)}</td>
        <td class="num">${money(grandTotal.interest)}</td>
        <td class="num">${money(grandTotal.lien)}</td>
        <td class="num">${money(grandTotal.fee)}</td>
        <td class="num">${money(grandTotal.total)}</td>
      </tr>
    `
    : '';

  return `
    <div class="detail-block">
      <h4>Payment history${payments.name ? ` · ${esc(payments.name)}` : ''}</h4>
      <div class="mini-table-wrap">
        <table class="mini-table">
          <thead>
            <tr>
              <th>Bill #</th><th>Type</th><th>Paid date</th>
              <th class="num">Tax</th><th class="num">Interest</th>
              <th class="num">Lien</th><th class="num">Fee</th><th class="num">Total</th>
            </tr>
          </thead>
          <tbody>${body}${totalRow}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderRelated(bill, bundle) {
  if (!bundle.relatedLoaded) {
    return `
      <div class="detail-block">
        <h4>Related bills</h4>
        <div class="detail-state" style="padding:0"><span class="spinner" aria-hidden="true"></span> Loading other bills for this account…</div>
      </div>
    `;
  }

  const related = bundle.related || [];
  if (!related.length) return '';

  const body = related
    .filter((item) => item.billNumber !== bill.billNumber)
    .map(
      (item) => `
        <tr>
          <td><a class="mono" href="${esc(item.detailUrl || '#')}" target="_self">${esc(item.billNumber)}</a></td>
          <td>${esc(item.billType || '')}</td>
          <td>${esc(item.property || '—')}</td>
          <td class="num">${money(item.totalDue)}</td>
          <td class="num">${money(item.payments)}</td>
        </tr>
      `,
    )
    .join('');

  if (!body) return '';

  return `
    <div class="detail-block">
      <h4>Other bills for this account</h4>
      <div class="mini-table-wrap">
        <table class="mini-table">
          <thead>
            <tr><th>Bill #</th><th>Type</th><th>Property / vehicle</th><th class="num">Total due</th><th class="num">Payments</th></tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------- *
 * Detail loading
 * ---------------------------------------------------------------- */

function renderSoon() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    if (state.meta) {
      renderSummary();
      renderResults();
    }
  });
}

async function fetchBundle(bill, { related = false, force = false } = {}) {
  const key = billKey(bill);
  const existing = state.details.get(key);

  if (!force && existing && existing.detail && (!related || existing.relatedLoaded)) {
    return existing;
  }

  const inflightKey = `${key}|${related ? 'related' : 'basic'}`;
  if (state.inflight.has(inflightKey)) return state.inflight.get(inflightKey);

  state.loading.add(key);
  state.errors.delete(key);
  renderSoon();

  const params = new URLSearchParams({
    town: bill.town,
    year: bill.byear,
    type: bill.btype,
    num: bill.bnum,
    dataset: bill.dataset,
    payments: '1',
    related: related ? '1' : '0',
  });

  const task = fetch(`/api/bill?${params.toString()}`)
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Could not load ${bill.billNumber} (HTTP ${response.status}).`);
      }

      const previous = state.details.get(key);
      const bundle = {
        detail: data.detail,
        payments: data.payments,
        related: related ? data.related : previous?.related || null,
        relatedLoaded: related ? true : Boolean(previous?.relatedLoaded),
        fetchedAt: data.fetchedAt,
      };
      state.details.set(key, bundle);
      state.errors.delete(key);
      return bundle;
    })
    .catch((error) => {
      if (!state.details.has(key)) state.errors.set(key, error.message);
      throw error;
    })
    .finally(() => {
      state.loading.delete(key);
      state.inflight.delete(inflightKey);
      renderSoon();
    });

  state.inflight.set(inflightKey, task);
  return task;
}

async function toggleRow(key) {
  if (state.expanded.has(key)) {
    state.expanded.delete(key);
    renderResults();
    return;
  }

  state.expanded.add(key);
  renderResults();

  const bill = findBill(key);
  if (!bill) return;

  try {
    await fetchBundle(bill, { related: true });
  } catch (error) {
    showToast(error.message || 'Could not load the bill details.');
  }
}

async function loadAllDetails() {
  if (state.loadingAll) {
    state.cancelLoadAll = true;
    els.loadAll.textContent = 'Stopping…';
    return;
  }

  const pending = state.results.filter((bill) => !hasDetail(bill));
  if (!pending.length) {
    showToast('All visible result details are already loaded.');
    return;
  }

  state.loadingAll = true;
  state.cancelLoadAll = false;
  state.progressTotal = pending.length;
  state.progressDone = 0;
  updateProgress();

  const queue = [...pending];
  const worker = async () => {
    while (queue.length && !state.cancelLoadAll) {
      const bill = queue.shift();
      try {
        await fetchBundle(bill, { related: false });
      } catch {
        // The row shows its own error state.
      }
      state.progressDone += 1;
      updateProgress();
    }
  };

  await Promise.all([worker(), worker(), worker()]);

  const cancelled = state.cancelLoadAll;
  state.loadingAll = false;
  state.cancelLoadAll = false;
  renderResults();

  if (cancelled) {
    showToast('Stopped loading details.');
  } else {
    updateProgress();
    setTimeout(() => {
      if (!state.loadingAll) hideProgress();
    }, 1600);
  }
}

function updateProgress() {
  const total = state.progressTotal;
  const done = Math.min(state.progressDone, total);
  els.progress.hidden = total === 0;
  els.progressLabel.textContent =
    done >= total && total > 0 ? 'Details loaded' : 'Loading bill details…';
  els.progressCount.textContent = total ? `${done} / ${total}` : '';
  els.progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

function hideProgress() {
  els.progress.hidden = true;
  els.progressBar.style.width = '0%';
  els.progressLabel.textContent = 'Loading bill details…';
  els.progressCount.textContent = '';
}

/* ---------------------------------------------------------------- *
 * CSV export
 * ---------------------------------------------------------------- */

function csvCell(value) {
  if (value == null) return '';
  let text = String(value);
  if (/^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text))) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

function exportCsv() {
  const rows = filteredResults();
  if (!rows.length) {
    showToast('There are no rows to export.');
    return;
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
    'Total Due Now',
    'Gross Assessment',
    'Exemption',
    'Net Assessment',
    'Town Mill Rate',
    'Payments This Year',
    'Installments',
    'Payment History Count',
    'Payment History Total',
    'Related Bills',
    'Detail URL',
    'Original Bill URL',
  ];

  const body = rows.map((bill) => {
    const bundle = bundleFor(bill);
    const detail = bundle?.detail;
    const payments = bundle?.payments;
    const paymentTotal =
      payments?.grandTotal?.total ??
      (payments?.payments || []).reduce((total, payment) => total + (payment.total || 0), 0);

    return [
      bill.townName,
      bill.billNumber,
      bill.byear,
      bill.btype,
      detail?.billType || bill.billType,
      detail?.uniqueId || bill.uniqueId,
      detail?.district || bill.district,
      detail?.name || bill.name,
      detail?.careOf || bill.secondaryName,
      detail?.address,
      detail?.propertyLocation || bill.property,
      bill.totalTax,
      bill.paid,
      bill.outstanding,
      detail?.due?.totalDueNow,
      detail?.grossAssessment,
      detail?.exemption,
      detail?.netAssessment,
      detail?.townMillRate,
      detail?.paymentsThisYear?.amount,
      installmentSummary(detail),
      payments?.payments?.length,
      payments ? paymentTotal.toFixed(2) : '',
      bundle?.related?.length,
      bill.detailUrl,
      detail?.originalBillUrl || bill.originalBillUrl,
    ];
  });

  const csv = [header, ...body]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeQuery = (state.meta?.query || 'results').replace(/[^A-Za-z0-9-]+/g, '_');
  const towns = state.meta?.towns || [];
  const townPart = towns.length === 1 ? towns[0].slug : `${towns.length || 1}-towns`;
  link.href = url;
  link.download = `connecticut-${townPart}-${state.meta?.dataset || 'tax'}-${safeQuery}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------------------------------------------------------------- *
 * Events and boot
 * ---------------------------------------------------------------- */

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  performSearch();
});

els.tbody.addEventListener('click', (event) => {
  // Check if clicked on expand button first
  const toggle = event.target.closest('button[data-action="toggle"]');
  if (toggle) {
    event.preventDefault();
    toggleRow(toggle.dataset.key);
    return;
  }

  // Check if clicked on retry button
  const retry = event.target.closest('button[data-action="retry"]');
  if (retry) {
    const bill = findBill(retry.dataset.key);
    if (bill) {
      state.errors.delete(retry.dataset.key);
      state.expanded.add(retry.dataset.key);
      renderResults();
      fetchBundle(bill, { related: true, force: true }).catch((error) => {
        showToast(error.message || 'Still could not load this record.');
      });
    }
    return;
  }

  // Check if clicked on a bill row (toggle expansion)
  const row = event.target.closest('.bill-row');
  if (row) {
    event.preventDefault();
    const key = row.dataset.key;
    toggleRow(key);
    return;
  }

  // Check if clicked on detail row's retry
  const detailRetry = event.target.closest('button[data-action="retry"]');
  if (detailRetry) {
    const key = detailRetry.dataset.key;
    const bill = findBill(key);
    if (bill) {
      state.errors.delete(key);
      state.expanded.add(key);
      renderResults();
      fetchBundle(bill, { related: true, force: true }).catch((error) => {
        showToast(error.message || 'Still could not load this record.');
      });
    }
  }
});

els.filter.addEventListener('input', () => {
  state.filter = els.filter.value;
  renderResults();
});

els.loadAll.addEventListener('click', loadAllDetails);
els.exportCsv.addEventListener('click', exportCsv);

els.townButton.addEventListener('click', () => {
  setTownPanelOpen(els.townPanel.hidden);
});

els.townSearch.addEventListener('input', () => {
  state.townFilter = els.townSearch.value;
  renderTownList();
});

els.townList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[data-town-option]');
  if (!checkbox) return;
  setTownSelected(checkbox.value, checkbox.checked);
});

els.townChips.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-town-remove]');
  if (!button) return;
  setTownSelected(button.dataset.townRemove, false);
});

els.townDefault.addEventListener('click', () => {
  state.towns = new Set([state.defaultTown]);
  renderTownPicker();
});

els.townNone.addEventListener('click', () => {
  state.towns.clear();
  renderTownPicker();
});

document.addEventListener('click', (event) => {
  if (els.townPanel.hidden) return;
  if (els.townPicker.contains(event.target)) return;
  setTownPanelOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.townPanel.hidden) {
    setTownPanelOpen(false);
    els.townButton.focus();
  }
});

els.dataset.addEventListener('change', () => {
  if (state.meta) {
    updateUrl();
  }
});

async function boot() {
  await loadTowns();

  const params = new URLSearchParams(window.location.search);
  applyTownsFromUrl(params);
  renderTownPicker();

  const last = params.get('last');
  if (!last) return;

  els.lastName.value = last;
  if (params.get('initial')) els.initial.value = params.get('initial');
  if (params.get('dataset') === 'sanitation') els.dataset.value = 'sanitation';
  if (['1', '2'].includes(params.get('recordType'))) {
    els.recordType.value = params.get('recordType');
  }
  if (params.get('details') === '1') els.deep.checked = true;

  performSearch();
}

boot();
