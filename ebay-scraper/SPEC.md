# eBay search service

Implement `GET /v1/ebay/search` as a standalone Node.js/strict TypeScript service, matching the supplied ScrapeBadger search response fields. Build an independent scraper, not a proxy to ScrapeBadger. Existing report and captured response define compatibility scope.

Accept the dashboard search filters and page sizes 60/120/240 across its 18 allowlisted marketplaces. Validate inputs before network access. Translate filters to eBay public search URLs. Parse listing identifiers, titles, prices, shipping and available attributes; keep missing data null. Report pagination and UTC scrape timestamps. Never return captured or fabricated listings as live data.

Use Fastify for HTTP, Zod for boundary contracts and Cheerio for inert HTML parsing. The default transport uses full Google Chrome under Xvfb when no Linux display is available, an isolated profile, and the public help → home → native search form flow followed by the validated filter URL. Chrome is controlled over loopback CDP. Optional native headless mode uses a version-derived Chrome user agent and disables AutomationControlled; it remains opt-in because fresh-start live probes were less reliable. Keep direct HTTP as an explicit alternative. Proxy configuration is server-side only. Do not import the supplied ScrapeBadger session or API key into this service. Default to localhost; require a local service API key for non-loopback binding. Bound deadlines, rendered HTML size and concurrency; reject top-level browser navigation outside the selected marketplace. Direct HTTP does not follow redirects. Report blocked pages and changed markup as errors, not empty successful searches.

Slice order: (1) validated query and eBay URL mapping; (2) parser and captured-contract compatibility; (3) bounded transport and HTTP endpoint; (4) Chrome browser transport, real DOM regression fixture, live HTTP page 1/page 2 checks, review and documentation. Tests must fail before each implementation slice and cover malformed input, upstream errors, cancellation and browser cleanup. Real fixtures must remove scripts and volatile tracking attributes. Synthetic fixtures remain labelled. Successful live parsing is not established by fixture tests alone.

Layout: `src/` implementation, `tests/` behavior tests and fixtures, `README.md` usage and limitations. Commands from this directory: `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:coverage`; run with `npm start` or `npm run dev`.

Completed-listing extension: add `GET /v1/ebay/completed` with required query, existing filters, and `sold_only=true|false` (default false). Map to LH_Complete and optionally LH_Sold; default to ended-recently sorting. Preserve active response fields and add optional completion/status fields only for completed results. Require visible completion markers and never infer a hidden accepted Best Offer price. Treat eBay sign-in redirects/documents as UPSTREAM_AUTH_REQUIRED, not empty results or network timeouts. A local user's Chrome login is not available to the workspace; use a dedicated local CDP Chrome session. Provide a Windows launcher without credential export. Authenticated extraction has been verified using a dedicated persistent server profile, including after container recreation.

No billing, fake credit/rate-limit accounting, database, additional UI, image/item/seller/category endpoints or deployment in scope. Search-page filters and HTML are undocumented upstream interfaces; mappings are reconstruction choices rather than recovered backend source. Do not silently claim exact equivalence for nullable enrichment fields or category-specific facets. Preserve unrelated workspace changes and leave implementation reviewable without pushing or deploying.

## Server hosting extension

- Optional absolute EBAY_CHROME_PROFILE retains a dedicated browser profile across
  restarts; temporary profiles remain the default outside server configuration.
- A persistent profile and external CDP endpoint are mutually exclusive.
- Docker provides Google Chrome, a virtual display, and optional password-protected
  VNC. The profile is stored on a persistent volume and Chrome runs as a non-root user.
- Compose publishes API and login ports only on host loopback. Fly publishes only
  the authenticated HTTPS API, retaining VNC on its private network.
- One Chrome owns the profile at a time. The service closes Chrome gracefully to
  save cookies before shutdown; persistent profile directories are never deleted.
- Hosting requires a separately authenticated provider account and billing setup.
  eBay login remains an interactive action in server Chrome. Completed access is
  not considered verified until actual authenticated results have been checked.


## Always-on monitoring and valuation

Persist watches, seen IDs, sold observations and a retryable Telegram outbox on
the hosted volume. Seed active and sold UK searches for Chesterfield captain
chairs and English unlimited Base Set Charizard 4/102 PSA 9. Default cadence is
two minutes, bounded 1–1440 minutes, with sequential browser requests. Initial
results establish a baseline; initial potential deals are explicitly labelled.

Use dated, disclosed comparable GBP sold prices for 90/180/365-day reports. Show
average, median, observed low/high, quartiles, sample count and actual dates.
Do not invent complete six/twelve-month history. Deal candidates need five
comparables, at least 20% below median and at/below the lower quartile, and known
delivery. Exclude auction bids and hidden offers; separate grades and editions.
Telegram commands are restricted to the paired private chat.
