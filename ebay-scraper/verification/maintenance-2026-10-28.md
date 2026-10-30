# Marketplace maintenance verification — 28 October 2026

## Release

- Facebook: `deployment-01M61VGJXK0QT5JKT4AWF7SY1W`.
- eBay: `deployment-01M61V3MP6QRNQ3B44HXHE5KFT`.
- Both deployments completed Fly.io smoke/machine checks. Facebook `/health`
  returned `browser_ready` after the final rollout.
- Built from an isolated source snapshot to exclude concurrent car-monitor work.
  Existing watch databases and browser profiles were retained.

## Checks

- The isolated maintenance suite passed 202 tests across 31 files. Type checking,
  production builds and formatting checks passed; production dependency audit
  found no vulnerabilities. The final Facebook date-filter change passed its
  focused search tests and the production build. Explicitly empty Facebook feeds
  are recognised structurally, including field-order changes, anti-JSON prefixes
  and the live `MarketplaceSearchFeedNoResults` / `SERP_NO_RESULTS` story.
  A signed-in free-plants probe explicitly reported no listings in the last 24
  hours within 40 km.
- A signed-in Facebook search returned 72 timestamped listings before applying
  the date filter, including older listings. An explicit `daysSinceListed=1`
  request returned 9 timestamped results, of which 3 were within the preceding
  24 hours. The UI showed Newest first and Last 24 hours; GraphQL requests
  confirmed `CREATION_TIME_DESCEND` and the creation-day filter. The alert gate
  additionally checks exact creation times because Facebook can include older
  recommendations even when the date filter is selected.
- The deployed eBay parser read item `880059502027` as listed at
  `2026-10-28T16:30:01.000Z` from its escaped `listingId` / `startDate.value`
  model. Recommendation IDs and countdown/end dates were excluded. One probe
  returned no timestamp; the notification explicitly marks this unavailable.
  Existing intermittent eBay upstream blocking remains a reliability limitation.
- The deployed B&M parser read the live 18 × 330 ml product page as £6.99 and
  marked the offer in-store and subject to availability. Collection also includes
  the 8-can page and supports advertised multibuys.
- After deployment, the scheduled free-plants scan succeeded at 18:15:53 UTC
  with zero results and no error. The chair scan succeeded at 18:16:09 UTC with
  no error; the latest table scan had 3 results and no error.
- Verification did not send synthetic Telegram messages or alter watch baselines.
  The failed free-plants watch was rescheduled for an immediate normal retry.

## Rollback

If needed, redeploy the previous image with the existing app configuration and
`--ha=false`; retain the mounted databases and browser profiles:

- Facebook previous image:
  `registry.fly.io/aaron-facebook-marketplace:deployment-01M5ZNQZSG4D0P901PR2R2PT69`
- eBay previous image:
  `registry.fly.io/aaron-ebay-scraper:deployment-01M5ZAHXFJ0Z97NNVS1A55BNVE`
