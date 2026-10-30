# Marketplace maintenance — 30 October 2026

## Facebook

The production machine had stopped after repeated Chrome startup failures
(`BROWSER_UNAVAILABLE`, exit 1, not OOM). Headless Chrome using the existing
profile loaded live Marketplace results successfully; desktop Chrome did not
expose its debugging endpoint. Facebook now defaults to headless Chrome, with
`FACEBOOK_CHROME_HEADLESS=false` available for an operator's interactive login.
No login/profile data was removed.

A production car-research scan occupied the shared scheduler for several minutes
(1,699 results, completed 09:43:11 UTC). Marketplace scans now have a separate
non-overlapping job lane from car research and retailer reports. A deferred-job
regression verifies that background work cannot hold up subsequent scans.

Search loading previously stopped after exactly two document scrolls. It now
scrolls the last listing into view and the active scroll container, collecting
results until three rounds show no additional unique listing IDs. Thirty rounds
is a safety bound: continued growth at that bound fails the scan explicitly.
This does not prove Facebook exposes every available listing to this account.

The freshness gate previously advanced with every successful scan. A listing
surfaced late could be silently excluded even when created after monitoring
started. A persistent baseline boundary now keeps those listings eligible within
the existing 24-hour recency limit. Old, future-dated and undated items remain
suppressed. Regression tests reproduce the late-discovery failure.

Deployed Facebook image:
`deployment-01M66342AFW13G2VBJ9ZGTX751` (final scheduler isolation).
All three scheduled active searches completed with `last_error=null`:
chair 09:37:31 UTC (0 matches), plants 09:37:45 (1), table 09:38:04 (1).
These are actual scheduler scans, not manually written successes.

## eBay timestamps

Recent delivered alerts for items 188151380608, 267605857214 and 206148375695
contained the explicit unavailable-time fallback. A live request reproduced
HTTP 403 on an item detail URL. A successfully fetched page for 188151380608
contained item-associated `startDate.value = 2026-03-12T18:34:34.000Z`; the parser
extracted that exact value. Detection time must not be presented as upload time.

Item detail retrieval now reads the navigation response HTML directly, avoiding
waiting for rendered product headings or third-party scripts. A regression test
reproduced the previous timeout when timestamp-bearing HTML had no rendered
product heading. Temporary generic error pages get one paced retry of the same
item URL; explicit security refusals and rate limits do not retry. Failures log
the item ID and error code, without credentials or page contents.

The official Browse API `itemCreationDate` would be the preferred structured
source. It is not connected; production developer credentials are not configured.
The current page-based source can still be unavailable when eBay refuses a request.
No times are inferred from search ranking or last-modified labels.

## Validation and deployment isolation

The complete suite passed all 274 tests across 40 files, including browser,
late-discovery, pagination and scheduler regressions. Type checking, build and
formatting checks passed. Deployment snapshots were reconstructed
from each app's deployed source and overlaid only with relevant fixes, preserving
other existing functionality. No synthetic Telegram messages or public listings
were created. Seen history, baselines and outbox records were preserved.

Final eBay image: `deployment-01M6630JJ0R83T39NTW7THVSGM`.

At 09:45 UTC, all four eBay watches had `last_error=null` after normal
production retries: sold chairs 09:44:57 (52), active chairs 09:43:34 (54),
sold Charizard 09:44:16 (15), active Charizard 09:44:35 (7).
An intervening sold-search HTTP 403 was visible and subsequently recovered;
this remains an intermittent upstream limitation.

After the final Facebook deployment, all three active searches again completed
with no errors: chair 09:45:35 UTC, plants 09:45:55, table 09:46:16. A background
car scan completed at 09:45:55 while the Marketplace cycle was progressing,
confirming the separate lanes in production.
