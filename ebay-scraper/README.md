# eBay search service

**Always-on monitoring is deployed.** See [MONITORING.md](MONITORING.md) for the four two-minute searches, Telegram commands, valuation rules, and the historical-data limitation.

Independent `GET /v1/ebay/search` implementation matching the request and response fields recovered from the supplied ScrapeBadger dashboard and HAR. **Live search now works with real Google Chrome.** The API returned HTTP 200 with 60 UK listings on page 1 and 60 different listings on page 2 for the original query and Buy It Now filter. No ScrapeBadger credentials, paid scraping API, or proxy was needed.

`GET /v1/ebay/completed` is also implemented for all completed items or `sold_only=true`. eBay requires sign-in for the completed searches tested here. For a signed-in Chrome session on your Windows computer, follow [the Windows setup](WINDOWS.md) or run `START-WINDOWS.cmd` from an extracted copy of this project. Authenticated completed extraction is now verified live: the UK chair query returned 60 completed listings, and the login survived recreating the browser container. See [verification](VERIFICATION.md) and [server setup](SERVER.md).

The working flow opens eBay's public help page, follows Home, submits the native search form, then loads the validated filters/page URL. The default is full Google Chrome, automatically running under Xvfb when Linux has no display. It runs unattended without a desktop or manual interaction. Optional native headless mode uses an installed-version-derived Chrome user agent and disables AutomationControlled; it returned live results in one probe but was intermittently blocked on fresh starts, so it is not the default. See [evidence and research](VERIFICATION.md).

## Run

Requires Node.js 24+, npm 11.6.2 and Google Chrome. Tested on Linux x64 glibc.

```bash
cd /workspaces/claude-charlie/ebay-scraper
npm ci
npm run setup:chrome
npm run build
cp config.example.env .env
npm start
```

`setup:chrome` downloads Google's stable Linux x64 Debian package into `~/.cache/ebay-search/google-chrome`, without root or replacing a system browser. Install Chrome's shared-library prerequisites if absent. Linux without a display also needs Xvfb and xauth installed. On other platforms, install Chrome and set `EBAY_CHROME_EXECUTABLE`. Common Linux Chrome paths are detected. Optional `EBAY_CHROME_HEADLESS=true` avoids the display requirement but was less reliable in the live probes.

Chrome starts lazily on the first valid search and is reused. Each request gets its own tab within this isolated browser session. Normal shutdown closes owned Chrome processes and removes temporary profiles; configured persistent profiles are retained; SIGKILL cannot clean up. The launcher uses `--no-sandbox` for container compatibility; run it in an isolated account/container.

```bash
curl --get 'http://127.0.0.1:3001/v1/ebay/search' \
  --data-urlencode 'query=pokemon card charizard base set psa' \
  --data-urlencode 'domain=co.uk' \
  --data-urlencode 'page=1' \
  --data-urlencode 'per_page=60' \
  --data-urlencode 'buying_format=buy_it_now'
```

Default binding is localhost. External binding requires a `SERVICE_API_KEY` of at least 24 characters, sent in `x-api-key`. This is the service's own key, not a ScrapeBadger key. Apply TLS and rate limits at ingress before exposing it. Concurrency limits apply to one process.

## Configuration

Copy `config.example.env` to `.env`. Local environment files are ignored. Do not import the supplied ScrapeBadger session.

| Variable | Default | Purpose |
|---|---|---|
| HOST / PORT | 127.0.0.1 / 3001 | Listener; port 0 allocates an ephemeral port |
| SERVICE_API_KEY | unset | Required for non-loopback binding |
| EBAY_TRANSPORT | chrome | chrome or explicit direct HTTP mode |
| EBAY_CHROME_HEADLESS | false | true selects optional native headless Chrome |
| EBAY_CHROME_EXECUTABLE | auto-detected | Google Chrome executable |
| EBAY_CHROME_CDP | unset | Optional dedicated loopback Chrome endpoint, e.g. http://127.0.0.1:9333 |
| EBAY_TIMEOUT_MS | 45000 | Overall search deadline, maximum 60 seconds |
| EBAY_MAX_BYTES | 12582912 | Rendered HTML limit in Chrome; decompressed streamed HTML limit in direct mode |
| MAX_CONCURRENT | 4 | Simultaneous searches, bounded 1–32 |
| EBAY_PROXY_URL | unset | Optional HTTP/HTTPS proxy; not needed for verified results |

Use a dedicated eBay browser for CDP, with only the account needed for scraping. External Chrome is detached, not terminated, at shutdown. Configure its flags/proxy before connecting. Authenticated proxy URLs work in direct mode; for Chrome, configure authentication in an external browser. Auto-launched Chrome accepts credential-free proxies.

Query parameters cannot select a URL, proxy, executable or CDP endpoint. Direct HTTP rejects redirects. Chrome top-level navigation stays on the selected marketplace; normal subresources and telemetry still load. The rendered-HTML limit does not cap all browser network traffic. No CAPTCHA solving or repeated retries are implemented. Application logs contain request IDs, status, timing and counts rather than search text, credentials or raw upstream errors.

## Query contract

`query` is required: trimmed, 1–500 characters. Unknown/repeated parameters, invalid enumerations and inverted price bounds return HTTP 400 before browser/network access. Omit optional fields rather than sending empty strings.

| Parameter | Values/default |
|---|---|
| domain | com default; co.uk, de, fr, it, es, com.au, ca, at, ch, be, ie, nl, pl, com.hk, com.sg, com.my, ph |
| category_id | Numeric category ID |
| page | Positive integer, default 1, maximum 1000 |
| per_page | 60, 120 or 240; omitted by default |
| sort_by | best_match, ending_soonest, newly_listed, price_low_to_high, price_high_to_low |
| condition | new, open_box, refurbished, used, for_parts, graded, ungraded |
| buying_format | auction, buy_it_now, best_offer |
| min_price / max_price | Nonnegative finite marketplace-currency prices |
| free_shipping | true enables the filter; false imposes no shipping filter |
| location | domestic, worldwide |
| language | english, japanese, chinese, korean |

Mappings live in `src/query.ts`. Not every marketplace/filter combination is live-tested. eBay's URL parameters and HTML can change; category-specific conditions, language and location facets may be ignored when inapplicable. The scraper does not infer card grade/language from titles. Shipping may depend on eBay's inferred delivery location.

## Output and errors

`src/contract.ts` defines the strict response schema, with the captured top-level and listing field names. Parsed fields include public IDs, canonical URLs, titles, images, prices, conditions, buying format/auction fields, shipping and visible attributes. Unavailable enrichment remains null, not false or zero. No item-detail requests are added.

The parser extracts primary `.s-card` and legacy `.s-item` children of `.srp-results`. It excludes nested sponsored carousels, duplicate IDs and placeholders. Explicit zero results do not return suggestions; unknown markup causes an error. `tests/fixtures/chrome-search.html` is sanitized, shortened real Chrome HTML; `search.html` is synthetic.

Pagination reports the requested page/size, parsed count and advancing next-page link. `total_pages` is null without a size or for approximate totals. Missing next links yield `has_more: false`, so unfamiliar pagination markup may under-report further pages. One call fetches one page.

Errors contain `code` and `detail`:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | INVALID_QUERY | Invalid parameters |
| 401 | UNAUTHORIZED | Service key missing/incorrect |
| 429 | BUSY | Local slots occupied; Retry-After: 1 |
| 503 | BROWSER_UNAVAILABLE | Chrome/CDP unavailable |
| 502 | UPSTREAM_BROWSER_ERROR | Browser navigation/search failed |
| 502 | UPSTREAM_BLOCKED | Recognized block page; direct HTTP 403/429 |
| 502 | UPSTREAM_MARKUP_CHANGED | Unknown search markup |
| 502 | UPSTREAM_TOO_LARGE | HTML limit exceeded |
| 502 | UPSTREAM_REDIRECT / UPSTREAM_HTTP_ERROR | Unexpected direct HTTP status |
| 502 | UPSTREAM_CONTENT_TYPE / UPSTREAM_EMPTY_BODY / UPSTREAM_NETWORK_ERROR | Invalid content or direct transport failure |
| 504 | UPSTREAM_TIMEOUT | Search deadline exceeded |
| 500 | INTERNAL_ERROR | Unexpected failure; details hidden |

Disconnects cancel work and release capacity. Replies include request ID/duration, Cache-Control: no-store and X-Content-Type-Options: nosniff. No fake credit accounting or ScrapeBadger rate-limit headers are emitted.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
npm run test:coverage
npm audit
```

Tests require installed Chrome. Browser tests intercept eBay requests with fixtures, exercising real Chrome, localized controls, deadlines, tab cleanup and HTML limits without live scraping. The real-process test retains its five-second deadline; one test worker avoids Chrome startup contention. The lint script checks Prettier formatting; strict TypeScript supplies static checking. Dependency lifecycle scripts are disabled; resolved dependencies are locked.

Completed queries accept the same filters plus `sold_only=true|false` (default false). They use ended-recently sorting when no sort is specified. Responses add `completed: true`, while the top-level `sold` flag describes the requested sold-only filter. Rows with a recognized completion date add `is_sold`, `ended_date`, `sale_price`, and `best_offer_accepted`. Undetermined sale status stays null. Sold-only results require a visible sold marker. A missing completion marker is not accepted as proof of completion. `sale_price` is null for unsold/unknown rows, accepted Best Offers, or struck-through displayed prices. Public displayed prices do not prove payment or reveal a hidden accepted offer amount.

`UPSTREAM_AUTH_REQUIRED` (HTTP 503) means the upstream page requires an eBay login in the configured dedicated Chrome session. This is separate from the API's own `x-api-key`. Do not export cookies or provide passwords to the agent.

See [VERIFICATION.md](VERIFICATION.md) for live evidence and limitations. Image, item, seller and category endpoints remain out of scope. Successful active-search probes do not establish production reliability, exact backend equivalence, or future immunity to eBay changes.

References: [HWORK72 Chrome implementation](https://github.com/HWORK72/eBay-Market-Scraper/blob/main/scraper.py), [Playwright CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp), [Fastify](https://fastify.dev/docs/latest/Reference/Server/), [Cheerio](https://cheerio.js.org/docs/basics/extract), [Zod](https://zod.dev/api), [Impit](https://github.com/apify/impit).

## Server hosting

For operation while your laptop is off, use [SERVER.md](SERVER.md). Docker runs
Chrome on the server and retains its dedicated eBay profile across restarts.
