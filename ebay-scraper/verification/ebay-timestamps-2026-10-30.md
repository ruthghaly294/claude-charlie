# eBay page-based timestamps — 30 October 2026

No official eBay API is configured or used.

Two affected public listing pages supplied item-associated `startDate.value`
through normal browser navigation:

| Item | Exact eBay listing start (UTC) |
| --- | --- |
| 188151380608 | 2026-03-12 18:34:34 |
| 267605857214 | 2026-03-14 11:04:38 |

These are listing start dates, not the monitor's detection dates. Their age
explains why detection must remain separately labelled. The raw document bodies
were 865,968 and 734,490 bytes respectively; JavaScript rendering is not needed
to parse the verified item-associated metadata.

Previously, one failed lookup caused an unavailable-time alert, after which the
item was marked seen and never retried. The scheduled monitor now:

- Paces search and detail requests together, with a 20-second pause after completion (including internal recovery) before the next fetch.
- Persists unresolved item lookups and first detection times across restarts.
- Retries pending rows even after they leave the current first search page.
- Saves verified timestamps for reuse, bounded to the exact item and marketplace.
- Attempts at most three detail lookups per watch scan, rotating unattempted rows
  ahead of repeated failures.
- Holds undated new alerts during a five-minute retry window. On a later scan
  after that window, it releases an explicit unavailable-time fallback rather
  than losing the listing. This is a retry window, not a delivery-time guarantee.
- Keeps resolved rows queued until WatchStore records them as seen, protecting
  against cancellation midway through a scan.
- Displays the age at alert time and preserves the original detection timestamp.

Old known listings and baseline discovery do not trigger normal new-listing alerts. An explicit
security refusal is not retried by switching origins or solving a challenge.

All 289 tests passed across 43 files. Type checking, build, formatting and diff
whitespace checks passed. Tests cover durable retries, cache reuse, search changes,
cancellation, bounded lookups, unavailable fallback and the full search-to-alert
path. Existing unrelated workspace changes were excluded from deployment.

Deployed release: `deployment-01M6642J4Q0R43EPKBANCH96TS`.

## Production verification

A temporary watch used the real saved chair search and normal production
scheduler. It had `notifyNew=false` and no market profile, so neither new-listing
nor deal alerts could be sent. Its baseline came from an actual 60-result search,
with the affected item excluded only to exercise the metadata lookup. No cache
entry existed for that item before the test.

The deployed scheduler extracted and recorded item 188151380608 with:

- `listed_at`: `2026-03-12T18:34:34.000Z`
- `detected_at`: `2026-10-30T10:03:36.237Z`
- Recorded successfully at 10:03:50 UTC, one detail lookup attempt.
- Zero outbox messages for the temporary watch.

The temporary watch was then removed; its verified timestamp cache was retained.

A repeat live scan exposed an additional persistence bug: raw search results
without optional timestamp fields overwrote the enriched `seen` payload. The
verified cache remained correct, but the stored row lost its dates. WatchStore's
refresh now preserves the prior verified listing time and original detection
time while updating price/title and other current fields. A regression reproduced
the failure before the fix. After the correction, all 285 tests passed, together
with type checking, build and formatting checks.

Final corrected release: `deployment-01M664EHPQWQ6CZG6WKY8TYBX7`.

Final release with the recovery-aware request cooldown:
`deployment-01M664MV4K8D2K436HJT9P01CR`.
A further regression verifies that a long request or its internal retry cannot
be followed immediately by another fetch; the cooldown starts at completion.
All 286 tests and required checks passed for this final code.

Pending timestamp work now also runs before scheduled searches, on its own
retry clock. It does not depend on a successful search or the search's backoff.
`recordResolvedListings` records the recovered listing/outbox data without
changing scan success times, errors, result counts or failure history. Tests
verify recovery while a search remains failed, and that metadata retries cannot
hammer on every scheduler tick. Per-item attempt times survive restarts.

Final release: `deployment-01M6650YK3JQKWVFNSZN232SG1`.
All 289 tests, type checking, build, formatting and whitespace checks passed.

## Final live result

The final release recovered item 267605857214 through the deployed scheduled
lookup, despite the private verification search returning zero results. Pending
work used the real previously recorded item and its original alert detection
(`2026-10-29T21:57:16.863Z`); its timestamp cache was initially absent. One detail
lookup recovered `2026-03-14T11:04:38.000Z`.

A refresh through the deployed store using the genuine raw search record then
preserved both timestamps and left scan health unchanged. The rendered preview
included the exact GMT listing start, elapsed minutes and original detection time.
The verification watch had zero outbox messages throughout. It and its pending
state were removed, leaving the four original eBay watches. Both verified item
start-time caches were retained. No API credentials or official API calls were
used, and no test Telegram messages were sent.
