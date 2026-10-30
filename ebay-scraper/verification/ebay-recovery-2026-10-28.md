# eBay recovery release — 28 October 2026

Release: `deployment-01M620CVETXC62WPT8Q2PHYBYX`.
Rollback image: `registry.fly.io/aaron-ebay-scraper:deployment-01M61V3MP6QRNQ3B44HXHE5KFT`.

The isolated release passed 217 tests across 32 files, production build, type
checking and formatting. It excludes concurrent car-monitor work.

Changes:

- Active first-page URLs omit `_pgn=1` and encode spaces as `%20`, preserving literal
  plus signs, exclusion terms, slashes and all saved filters. Live diagnostics
  observed both 200 and 403 outcomes, so URL normalization alone is not evidence
  of reliable recovery. Completed searches retain the original form-compatible
  representation: a live probe returned HTTP 200 and 25 sold-Pokémon results.
  Generic HTTP 403 templates can try the equivalent alternate representation
  once after 20 seconds. Filters, query and sort are retained; explicit security
  challenges and rate limits stop without this compatibility attempt.
- Generic HTML error pages and HTTP 5xx responses receive one bounded retry;
  the existing overall deadline and cancellation still apply. Subsequent
  temporary failures back off to at most five minutes, respecting longer saved
  intervals. CAPTCHA/security pages are not retried immediately.
- The browser transport now preserves the distinction between HTTP 403 access
  refusals, HTTP 429 rate limits, generic server failures, and sign-in redirects.
  A generic error template alone is not proof of a security ban.
- Searches are paced at 20-second intervals across scheduler cycles.
- Timestamp enrichment skips listings that fail the watch's market profile.
  Previously, excluded listings were never marked seen by the filtered store,
  so their detail pages could be repeatedly opened on each successful scan.
- The overall browser deadline now covers tab creation and navigation. A tab
  allocation that hangs triggers a bounded browser restart, preserving its
  profile. Late-created tabs are closed and cleanup itself is bounded. A
  reproduced stalled-allocation test failed before this fix and passes after it.
- Existing baselines, seen history, outbox deduplication and watch filters remain.

## Production result

At 19:44:39 UTC, all four watches had fresh successful scans and `last_error=null`:

| Watch | Last successful scan (UTC) | Matched listings |
| --- | --- | ---: |
| Chairs, active | 19:43:40 | 54 |
| Charizard, active | 19:44:16 | 7 |
| Chairs, sold | 19:44:38 | 52 |
| Charizard, sold | 19:43:56 | 14 |

The new-listing watches also completed successive live scans during verification.
The deployed scheduler performed the scans; results were not manually written or
replaced with synthetic successes. Existing seen records and alert deduplication
were retained. Failed watches were scheduled for normal retries during validation.
No synthetic Telegram test messages were sent. The final observed outbox had no
queued messages and 107 delivered messages.

These observations establish recovery at verification time. They do not guarantee
that eBay will never refuse another request. Failures remain explicit, bounded,
and distinct from successful zero-result searches.

