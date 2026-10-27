# Always-on eBay alerts

The live service runs on Fly.io independently of this workspace and your laptop.
It uses one 1 GB shared-CPU machine in London and a 1 GB encrypted persistent
volume. The machine remains on, restarts automatically, and starts on incoming
traffic if stopped. The previous three-hour proof limit has been removed under
the user's instruction to enable always-on monitoring.

## What is monitored

Four searches run at two-minute intervals, sequentially to avoid overlapping
browser work:

| Product | Active listings | Newly sold listings |
| --- | --- | --- |
| Chesterfield captain chairs, UK | Yes | Yes |
| English unlimited Base Set Charizard 4/102, PSA 9, UK | Yes | Yes |

The Pokémon comparison group is an initial conservative default, not every
Charizard variant. Other grades, first editions, Shadowless, clearly different
languages, autographs, replicas, and bundles are excluded. Chair comparisons
exclude obvious synthetic materials, bundles and accessories. Remaining chairs
can still differ in age, condition and quality.

Normal repeat scans fetch the newest result page. Initial sold backfill fetches
up to three pages. Very high-volume searches could have more new items between
scans than fit on a page. Successful scans normally take several seconds, and
can take longer or fail when eBay blocks or delays a request. Polling every two
minutes is a target, not a guarantee that eBay exposes a listing within two minutes.

The first successful scan records a baseline instead of sending old listings as
new. Potential deals can be reported from an initial scan, clearly labelled as
such. Seen items, sold observations and pending Telegram messages persist across
restarts in SQLite on the volume. Failed sends retry with capped exponential
backoff. Messages deduplicate by listing/event during normal operation; a crash
after Telegram accepts a message but before delivery is recorded can produce a
repeat. A qualifying price reduction can produce one deal alert for an already
seen item.

## Telegram

Use **@Ebaymarketbot** from the paired private chat:

- `/status` — each search's last successful scan and any current error.
- `/market chairs 3` — chair sold-price research.
- `/market pokemon 3` — PSA 9 Charizard sold-price research.
- Substitute `6` or `12` for the requested historical window.

Commands from unpaired chats are ignored. Bot credentials live in Fly secrets;
source code and logs do not contain them.

Research shows average, median, observed minimum/maximum, the middle 50% price
range, the sample size and the oldest observed sale. Only explicit sold listings
with dated, disclosed GBP sale prices are included. Hidden accepted offers and
unknown outcomes are excluded. Sold prices exclude delivery. Candidate deal
prices include disclosed delivery; unknown delivery and auction bids do not
qualify for deal alerts.

A potential deal requires at least five comparable disclosed sold prices in the
90-day sample, a candidate at least 20% below median and at or below the lower
quartile. The listing title is not proof of authenticity or condition; alerts
are candidates for review.

## Historical coverage limitation

Ordinary eBay sold search covers only the previous 90 days. Product Research
supports longer history, but the signed-in account currently redirects that tool
to an account-contact-details completion form. No personal details were invented
or submitted. Consequently, initial six- and twelve-month backfills are **not
available yet**. Those requested windows report the observations actually saved,
including their dates, rather than invented full-window data. Older observations
will accumulate while monitoring continues.

Sources:
- https://www.ebay.com/help/selling/selling-tools/research?id=4853
- https://www.ebay.co.uk/help/selling/selling-tools/product-research?id=4853

## API and operations

Base URL: `https://aaron-ebay-scraper.fly.dev`

All API calls require the service `x-api-key`, stored privately in `.env.server`.
Do not place the key in a public URL, source file, issue or chat.

- `GET /v1/watches` returns saved searches, scan state and delivery counters.
- `POST /v1/watches` adds a search; at most 20 searches are allowed.
- `DELETE /v1/watches/:id` removes it and its per-search alert history.
- `GET /v1/markets` returns both comparison groups for 90/180/365-day windows.
- The existing active and completed scraper endpoints remain available.

Example search body:

```json
{"name":"Another chair search","query":"chesterfield captain chairs","domain":"co.uk","mode":"active","intervalMinutes":2,"marketProfile":"chairs"}
```

`marketProfile` can be `chairs` or `charizard_psa9_base`; omit it for a generic
new-listing alert without valuation. `mode` is `active` or `sold`. `maxPrice` is
optional. Intervals range from 1 to 1440 minutes. Four existing searches normally
fit within the configured interval; adding many searches can delay scans.

Useful commands from this project directory:

```sh
fly status
fly logs --no-tail
fly machine list
fly secrets list
```

A valid eBay session is retained on the volume, but eBay may expire or revoke it.
The bot reports authentication and scraping failures instead of fabricating
results. Reauthentication requires signing into a dedicated server browser.
Never share the profile volume with another running Chrome, delete it with
`down -v`, or transfer unrelated browser sessions. The original transfer included
only eBay-domain cookies, imported through a one-time private file that was then
removed. VNC is disabled on the hosted service.

This deployment is intentionally one machine to keep costs low; there is no
second standby server. Fly bills compute, storage and traffic while running.
Current provider pricing: https://fly.io/docs/about/pricing/
