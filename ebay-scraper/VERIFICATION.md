# Verification record — 2026-10-26

## Always-on scheduled monitoring: deployed and verified

As of 2026-10-27 08:40 UTC, Fly app `aaron-ebay-scraper` runs one 1 GB machine
in London with one encrypted 1 GB volume. Restart policy is always, auto-start
is enabled, minimum running machines is one, and the proof runtime limit is
removed. Hosted VNC is disabled. Only eBay cookies were transferred and the
one-time import file was removed after successful import.

Four saved searches monitor active and sold UK Chesterfield captain chairs and
English unlimited Base Set Charizard 4/102 PSA 9 every two minutes. All four
baselined and repeated successfully after redeployment without a new login.
Normal scans took roughly 6–24 seconds; eBay delayed one scan enough to time out,
and it recovered on retry. The interval is a target, not a freshness guarantee.

Telegram was paired to the user's private chat. The persistent outbox's hosted
verification message was delivered and acknowledged in SQLite. The activation
confirmation and research summaries were sent from the hosted server. A final
health-gated confirmation was sent at 08:40 UTC. No historical result was falsely
presented as a new listing to demonstrate delivery. The queue proof is labelled
as a test; deduplication and deal decisions are tested separately.

111 tests passed, with type checking, formatting and build. Tests cover durable
baselines, retryable delivery, saved-search authentication, isolation of Telegram
chats, time-window filtering, comparable grades/editions, hidden prices, shipping,
auction exclusions and persistence. Normal shutdown avoids false failure alerts.

The live 90-day samples contain 58 disclosed chair prices and 9 disclosed PSA 9
Charizard prices. Six/twelve-month initial backfill remains blocked by Product
Research requesting account contact details. No personal details were invented.
Requested windows show actual observations and dates; longer history accrues as
the monitor runs. These samples are not a complete market population.

Evidence: `verification/always-on-hosting.json`,
`verification/always-on-final-status.json`, `verification/live-watches.json`,
`verification/live-markets.json` and hosted sold-query results. Earlier statements
about no paid deployment or pending authentication below are historical.
Operational instructions: MONITORING.md.


## Authenticated completed listings and persistence: verified

On 2026-10-27, the signed-in UK query `chesterfield captain chairs` returned 60
completed listings, including 33 visibly sold and 27 with unknown outcome.
The browser container was stopped and replaced against the same persistent
volume. The query then returned the same 60 item IDs without signing in again.
After correcting persistent-profile navigation to open the filtered search
directly, the actual HTTP API returned 200 with 60 completed results in 9,566 ms
following another container replacement. This supersedes earlier unverified
completed-mode statuses below. It does not prove that eBay will retain the
session indefinitely, or that sold-only mode was separately verified live.

Evidence: `verification/session-persistence.json`,
`verification/completed-before-restart.json`,
`verification/completed-after-container-restart.json`,
`verification/completed-api-after-restart.json`, and
`verification/chesterfield-completed.csv`.

97 tests passed; type checking, formatting and build passed. The regression test
checks that persistent profiles open search directly. Chrome and VNC now shut
down in order, and Compose uses a stable hostname to avoid profile locks from
another container hostname. Fly test resources were deleted; this proof runs in
the existing workspace, with a three-hour process limit. No paid deployment is
left running. The temporary viewer uses an email-restricted Cloudflare tunnel.

Earlier verification history follows.


## Completed-listing extension

Added `GET /v1/ebay/completed` for all completed listings or `sold_only=true`. The active endpoint and its response fields are preserved. Completion parsing requires a displayed Sold/Ended marker, preserves raw date precision, distinguishes explicit unsold/unknown status, and leaves hidden Best Offer/struck-through sale amounts null. Current completion-label parsing is English; other completed-listing locales are unverified.

Live searches for `chesterfield captain chairs` on eBay UK, in both all-completed and sold-only modes, redirect anonymous Chrome to eBay sign-in. The actual API now returns `503 UPSTREAM_AUTH_REQUIRED` in both cases; see [the recorded checks](verification/completed-access.json). No authenticated completed-listing results have been retrieved. The user's signed-in Chrome is on their own Windows computer, which this workspace cannot access. `START-WINDOWS.cmd` and `WINDOWS.md` provide a dedicated local Chrome/CDP setup without password or cookie export. The Windows launcher cannot be executed on this Linux host and is not claimed to be Windows-runtime verified.

New tests cover completed query validation and URL filters, sold versus unsold metadata, hidden offer amounts, separate metadata rows, sign-in HTML, Chrome sign-in navigation, authentication protection and the HTTP endpoint. Mutations omitting LH_Complete and exposing an accepted Best Offer amount as known were both killed. A Chrome profile shutdown race observed during live probing was addressed with bounded filesystem cleanup retries.

The final restored-source run passed **94 tests across 8 files**, strict type checking, formatting checks and compilation. No tests were skipped and no type-check suppression was introduced. Earlier active-search results and coverage figures describe the original implementation, not authenticated completed-mode verification.

## Result

**Live search works with the default full Google Chrome/Xvfb transport.** A fresh service-owned anonymous Chrome instance returned two successful HTTP responses for the original UK query with Buy It Now and 60 items per page. No proxy, ScrapeBadger credentials, ScrapeBadger credits or paid scraping API was used.

| Page | HTTP | Returned | API duration | First item ID |
|---|---|---|---|---|
| 1 | 200 | 60 | 19,677 ms | 940042554020 |
| 2 | 200 | 60 | 14,601 ms | 407074162771 |

The pages contain **120 unique item IDs with zero overlap**. Both report approximately 1,800 matches and an advancing next-page link. The responses were generated at 22:32:44 UTC and 22:32:59 UTC, respectively.

- [Live response 1](verification/live-page1.json)
- [Live response 2](verification/live-page2.json)
- [Summary, request, timestamps and response SHA-256](verification/live-summary.json)

The production source never imports the recorded response fixtures. These files preserve actual HTTP API responses, not mocked browser results. Earlier headed Chrome API probes also returned 60/60 results, with durations 28,551/19,349 ms. A further independent fresh headed session returned 60 results.

## Working implementation

The service starts actual Google Chrome 156.0.8078.47 from a locally extracted official Google package. Chrome runs with an isolated temporary profile and a nonzero loopback debugging port. On Linux without a display, the launcher uses Xvfb. Playwright connects over CDP and opens an owned tab for each request.

The flow is public help → Home link → native search form → validated search/filter/page URL. It preserves normal browser requests and session state. The browser is reused within the service; owned profiles/processes are cleaned up at normal shutdown. Application logging omits credentials, search text and raw upstream errors.

The real DOM exposed a parser bug absent from the synthetic fixture: nested sponsored carousel cards were counted as primary listings. A failing regression test using sanitized real Chrome HTML now guards extraction of direct result-card children. All response fields continue to match the captured schema, with unavailable enrichment left null.

## GitHub research

| Repository/source | Finding used in this investigation |
|---|---|
| [HWORK72/eBay-Market-Scraper, scraper.py](https://github.com/HWORK72/eBay-Market-Scraper/blob/main/scraper.py) | Uses full headed Chrome, a persistent session, native browser interactions and both result layouts. This was the useful starting point for the successful Chrome investigation. The repo also includes exported result artifacts. |
| [netscreamer/ebay-playwright-scraper, index.js](https://github.com/netscreamer/ebay-playwright-scraper/blob/main/index.js) | Despite the repository name, the inspected implementation delegates fetching to Bright Data and requires its API key. It did not provide a credential-free standalone browser solution. |
| [scraper-bank/Ebay.com-Scrapers](https://github.com/scraper-bank/Ebay.com-Scrapers) | Multiple browser/HTTP implementations; the inspected setup guide includes ScrapeOps integration. This was useful context, not proof that a plain browser configuration would work here. |
| [Playwright CDP reference](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) | Official connection API used to control the dedicated Chrome instance. |

Inspected Git blob identities: HWORK72 scraper.py `4baad5e59ebbdbb88f224d8000a9bc7256eb4ed3`; netscreamer index.js `ce0c44b496f1f7b83654ff277ac8d57690bd3be2`; scraper-bank README `0ef1fd054343b9a4d9d13ac0ca32a6397c8a12f4`. Repository claims were checked against source and our own runtime probes rather than treated as proof of current success.

## Earlier failures and headless boundary

Initial direct HTTP, browser-compatible HTTP clients and automated Chromium probes returned eBay block pages. Cookie initialization alone did not resolve those failures. External HTML readers returned error documents inside HTTP 200 envelopes; those were not accepted as listing results.

Actual Google Chrome, native form submission and the dedicated browser session produced real search HTML. REA evidence `ev_fb0904359ec0defa404dd2b67db151bc08a8b6b072da1d5c13eb3a26f56ed8cc` records a successful full Chrome search; its real DOM was subsequently checked with the parser.

Native headless Google Chrome with a normal Chrome user agent and AutomationControlled disabled returned 60 results in one direct probe. A later fresh service-owned headless instance was blocked. **Headless mode remains optional and is not the default.** Full Chrome/Xvfb passed repeated fresh-start and page-2 checks. These observations do not isolate which fingerprint/session changes caused acceptance or establish permanent immunity to blocking.

## Checks

The test suite includes real Chrome with intercepted offline eBay pages, locale-independent controls, missing browser/CDP errors, HTML size limits, deadlines, cancellation during connection initialization, tab cleanup, real localhost requests and a child-process startup/shutdown test. Google Chrome must be installed before running tests.

The entrypoint test retains its original five-second deadline. Chrome startup contention was resolved by lazy browser imports and a single Vitest worker, without weakening that deadline or skipping tests.

After a clean `npm ci --ignore-scripts`, all **84 tests across 7 files** passed. Strict type checking, formatting checks and compilation passed. The dependency audit reported **0 vulnerabilities**. V8 coverage was statements 89.83%, branches 81.73%, functions 80.59% and lines 90.67%; this is not a claim of 100% coverage. The child-process entrypoint is exercised by a real HTTP test but appears as 0% in the parent coverage report. Native startup failure and optional proxy/display branches remain partly uncovered. No coverage exclusions, suppressed errors, skipped tests or lowered thresholds were added.

Work is on `feature/ebay-search-service`; nothing was pushed or deployed. Existing unrelated workspace changes are preserved.

## Mutation checks

The earlier seven targeted mutations were killed: dropping zero-price filters, returning duplicate IDs, incorrect duplicate tracking, milliseconds instead of epoch seconds, zero-result suggestions, incorrect exact-size boundary and inverted API-key authentication.

Four additional behavior-changing mutations were killed: including sponsored carousels, inverting the rendered-size limit, leaking request tabs and exposing HeadlessChrome in the user agent.

One additional flag-removal mutation survived: removing AutomationControlled did not change the webdriver value in the installed Chrome build. It was assessed as observationally equivalent in that specific test environment. The retained flag is a defensive browser setting, not an independently proven access fix. No assertion was added solely to mirror its presence in the argument list.

All source mutations were restored before final verification. These are targeted checks, not an exhaustive mutation score.

## Remaining scope and limits

Live verification covers the original UK active-listing query, Buy It Now and page 1/page 2. The configured 18-market catalog and other filter mappings are implemented but not exhaustively live-tested. Category-dependent facets, localization, missing enrichment, location-dependent shipping and future DOM changes remain compatibility limits.

The Chrome rendered-HTML bound does not cap every image/script/browser request. The container launcher uses no-sandbox and should remain isolated. The original ScrapeBadger backend was not recovered; this is an independent working implementation. Sold-price, image, item, seller, category endpoints, billing and deployment remain out of scope.

## Server hosting extension (2026-10-27)

- 96 tests passed across 9 files, including a real Chrome cookie-persistence test
  across process restarts and preservation of an operator-owned profile file.
- Type checking, formatting, and TypeScript build passed.
- Docker image built successfully. Chrome started and closed inside the image
  against a mounted volume, using a non-root runtime user.
- Compose configuration and Fly configuration validated.
- Fly CLI installed and authenticated. App creation was refused by Fly because
  the account requires billing information. No app, volume or machine was created.
- Actual authenticated completed listings remain unverified pending server login.
- Container live search for `chesterfield captain chairs`, UK market: HTTP 200,
  60 active results, approximately 15.4 seconds. Measured container memory was
  approximately 765 MiB under a 1 GiB limit. Completed search returned HTTP 502
  `UPSTREAM_BLOCKED` in this anonymous run; this is not completed-mode success.
  Summary: `verification/server-container.json`.
- VNC protocol handshake advertises password authentication and does not offer
  unauthenticated access. Its host publication was restricted to loopback.

### Hosted completed-listings gate

The temporary Fly deployment returned HTTP 503 `UPSTREAM_AUTH_REQUIRED` for the
requested completed query. It did not pass the completed-listings gate. The test
machine was stopped immediately and the app was destroyed (including its volume).
A follow-up app listing confirmed no eBay test app remains. No paid deployment
is left running. This supersedes the earlier billing-blocked deployment status.
Summary: `verification/fly-completed.json`.

A noVNC viewer is available in this existing workspace on port 6080 for an
interactive eBay login and authenticated completed proof without another paid
hosting deployment. External anonymous access returned HTTP 401. The browser's
VNC connection additionally requires the generated local password. The proof
container has a three-hour runtime limit.
