# Connecticut Tax Bill Search

An unofficial web app for searching public property-tax and sanitation bills
published by Connecticut municipalities at
[mytaxbill.org](https://www.mytaxbill.org/inet/bill/home.do?town=hartford).

Enter a **last name** and **first initial** (for example `Smith` + `J`), pick one
or more towns, and the app returns every matching bill. Drill into a row to see
the full public record: assessments, exemptions, mill rates, installment
schedules, payment history, and other bills for the same account. Results can be
filtered and exported to CSV.

The app ships with a catalogue of all **169 Connecticut municipalities** and
lets you select up to 10 at once, so the same name can be compared across towns
in a single search.

## Quick start

```bash
npm install
npm start
```

Open <http://localhost:3000>.

For development with automatic restarts:

```bash
npm run dev
```

Node.js 20 or newer is required.

## Features

- Search by last name + first initial, the same "SMITH J" format the official
  site uses.
- Choose one or more of the 169 Connecticut towns. The picker is searchable and
  keeps the same selection for the next search.
- 160 towns currently publish records through mytaxbill.org. The remaining 9 are
  shown but disabled in the picker.
- Optional first initial; business names can be entered in the last-name field.
- Tax bills and sanitation records.
- "All bills", "Due now", and "Balance due" filters.
- Combined summary totals across every selected town, plus a per-town result
  breakdown.
- A Town column appears automatically when more than one town is selected.
- Per-row detail panel with:
  - town, taxpayer, care-of, mailing address, property/vehicle, MBL, volume/page
  - gross/net assessment, exemption, town and district mill rates
  - installment schedule and adjustments
  - payment history with grand totals
  - other bills tied to the same account
  - links to the official record, PDF, and original tax bill
- "Load all details" batch mode with progress and a stop button.
- Instant text filter across loaded rows (including town names).
- CSV export of the current (filtered) result set, with a Town column.
- Server-side caching and concurrency caps so repeat searches are fast and the
  upstream site is not hammered.

## Town coverage

The catalogue is in [`lib/towns.js`](./lib/towns.js) and is served to the browser
by `GET /api/towns`.

- **Available (160):** Andover through Woodstock, including
  Hartford, Stamford, New Haven, Bridgeport, Waterbury, and most other towns.
- **Shown but unavailable (9):** Avon, Darien, East Lyme, Ledyard, Lyme,
  Milford, Salem, Southington, Winchester. These municipalities do not
  currently return a usable mytaxbill.org search page, so the picker disables
  them instead of failing silently.

Coverage can change. If a town starts or stops using mytaxbill.org, update the
`UNAVAILABLE` set in `lib/towns.js` and the catalogue test.

## How it works

The browser only talks to this app. For each selected town, the Express server
opens a separate session with that town's mytaxbill.org search page, posts the
same name-search form the official site uses, and parses the returned HTML with
Cheerio. Detail pages, payment history, and "all bills" pages are fetched on
demand using a session for the same town and cached.

Searches for different towns run with a small concurrency limit (default 3), and
detail requests share an upstream limit (default 4). The app never stores
credentials and does not initiate payments. It only reads public pages.

## API

### `GET /api/towns`

Returns the full Connecticut catalogue:

```json
{
  "towns": [
    { "name": "Andover", "slug": "andover", "supported": true, "url": "…" },
    { "name": "Avon", "slug": "avon", "supported": false, "url": "…" }
  ],
  "defaultTown": "hartford",
  "maxTowns": 10,
  "totalCount": 169,
  "supportedCount": 160
}
```

### `GET /api/search`

| Query param  | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `last`       | Last name or business name (required)                          |
| `initial`    | First initial (optional; extra letters ignored)                |
| `towns`      | Comma-separated town slugs, e.g. `hartford,cromwell,portland` |
| `town`       | Single-town alias, e.g. `hartford`                             |
| `dataset`    | `tax` (default) or `sanitation`                                |
| `recordType` | `0` all (default), `1` due now, `2` balance due                |
| `details`    | `1` to fetch full details for every result                     |

If no town is supplied, `hartford` is used. Town names such as
`East Hampton` are also accepted and normalized.

Example:

```bash
curl "http://localhost:3000/api/search?last=Smith&initial=J&towns=hartford,cromwell,portland"
```

The response includes `query`, `towns` (with per-town counts or errors),
`count`, `summary`, and `results`. Every result has `town` and `townName`
fields. When `details=1`, each result also has `detail` and `payments` objects.

Partial failures are reported per town: if one town fails, results from the
other towns are still returned. The request only fails when every selected town
fails.

### `GET /api/bill`

Fetch one bill's full detail bundle.

| Query param | Description                          |
| ----------- | ------------------------------------ |
| `town`      | Town slug, e.g. `hartford`           |
| `year`      | Bill year, e.g. `2025`               |
| `type`      | Bill type code, e.g. `3`             |
| `num`       | Bill number, e.g. `81220`            |
| `dataset`   | `tax` (default) or `sanitation`      |
| `payments`  | `0` to skip payment history          |
| `related`   | `0` to skip related bills            |

Example:

```bash
curl "http://localhost:3000/api/bill?town=hartford&year=2025&type=3&num=81220"
```

### `GET /api/export.csv`

Same parameters as `/api/search`. Returns a UTF-8 CSV (with BOM for Excel)
including a Town column. Use `details=1` to include assessment and payment
columns; this can take a while for large result sets.

```bash
curl -o smith.csv "http://localhost:3000/api/export.csv?last=Smith&initial=J&towns=hartford,cromwell&details=1"
```

### `GET /api/health`

Simple liveness check, including the number of catalogued and available towns.

## Configuration

| Environment variable      | Default | Purpose                                          |
| ------------------------- | ------- | ------------------------------------------------ |
| `PORT`                    | `3000`  | HTTP port                                        |
| `UPSTREAM_CONCURRENCY`    | `4`     | Max simultaneous detail requests to mytaxbill.org |
| `SEARCH_TOWN_CONCURRENCY` | `3`     | Max towns searched simultaneously                 |
| `MAX_TOWNS_PER_SEARCH`    | `10`    | Max towns in one search (capped at 169)           |
| `MAX_DEEP_RESULTS`        | `250`   | Max results enriched in one `details=1` search    |

## Testing

```bash
npm test
```

The tests use saved HTML fixtures and the town catalogue; they do not contact
the live site. They cover the tax/sanitation parsers, bill details, payment
history, related bills, and the full 169-town catalogue.

## Notes and limitations

- This is an independent tool, not an official service of any municipality.
- Data comes from public pages at mytaxbill.org and can lag or contain errors.
  Always verify important figures with the local Tax Collector.
- Town coverage varies. Only towns marked available in the picker can be
  searched; the other Connecticut towns are listed for completeness.
- Direct links to mytaxbill.org detail pages may require an active session on
  that site. If a link shows a "go back to your town" message, open the town's
  mytaxbill.org home page first.
- The upstream site can change its HTML without notice. Parsers are tolerant of
  the current layouts but may need updates.
- Be considerate: keep the default concurrency and caching in place. If you run
  this publicly, add authentication/rate limiting and review the source site's
  terms of use.
- The app does not accept payments. Use the official site for that.
