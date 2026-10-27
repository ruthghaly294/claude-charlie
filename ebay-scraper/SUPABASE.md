# Supabase watch list

Project: Marketplace Extractor (`sbgfeqanqznuhnsdekyt`, London).

The new `public.ebay_watchlist` table was created with
`supabase/migrations/20261027180000_ebay_watchlist.sql` through the authenticated
Supabase CLI on 2026-10-27. Existing `listings`, `runs` and `notifications` tables
were not modified. Migration checks in `supabase/watchlist-checks.sql` passed in
an isolated PostgreSQL 17 container. Remote verification confirmed row-level
security is enabled, `anon` cannot select rows, and `service_role` can insert.

Each row represents one item/search definition, scoped to a paired Telegram
chat. New entries request completed/sold research without enabling continuous
monitoring. Active and sold monitoring can then be enabled independently.
Edits advance a revision used for optimistic concurrency. Deletions are soft,
so synchronization can stop scheduler jobs without missing removal events.

Server credentials are in the ignored, owner-only `.env.supabase` file. The
`NEXT_PUBLIC_SUPABASE_*` names contain only the supplied project URL and
publishable key. `SUPABASE_SECRET_KEY` must remain server-only. The bot does not
expose this table directly to browser or authenticated client API roles.

`src/supabase-watchlist.ts` uses Supabase's database-only PostgREST client, with
bounded requests, owner-scoped queries, revision checks and validated responses.
The requested `@supabase/supabase-js` and `@supabase/ssr` packages are installed;
the combined SDK's current WebAuthn declarations conflict with the project's
TypeScript 7 DOM types under strict checks, so the server uses
`@supabase/postgrest-js` without weakening compiler settings.

Build and checks:

```sh
npm run build
npm run typecheck
npm run lint
npm test
```

Read-only table check using the saved environment:

```sh
node --env-file=.env.supabase --input-type=module -e 'import {createWatchlistRepository} from "./dist/supabase-watchlist.js"; const repo=createWatchlistRepository(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY); console.log((await repo.list("YOUR_PAIRED_CHAT_ID")).length);'
```

Sources: [Supabase keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Management SQL API](https://supabase.com/docs/reference/api/v1-run-a-query),
[PostgREST client](https://github.com/supabase/supabase-js/tree/master/packages/core/postgrest-js).

## Telegram operation

Open **@Ebaymarketbot** and send `/start` or `/watchlist`.

- Type an item title (or `/add TITLE`) to save it and queue a one-off sold-price sample.
- Research reports show observed floor/ceiling, average, median, typical range,
  dated sample size and coverage. They exclude hidden accepted offers and use
  GBP prices. Search matches are not proof of matching edition or condition.
- Choose **Yes, keep watching** to enable new-listing alerts and ongoing sold-data
  collection. Choose **No, research only** to stop ongoing checks while keeping
  the item for later research.
- **Watch list** → select an item → **Edit** changes query/edition, condition,
  maximum price, free delivery/location, buying format or interval.
- **Research now** requests a fresh sample. **× Remove** soft-deletes the Supabase
  entry and removes local jobs and unsent alerts. An already in-flight Telegram
  send cannot be recalled.
- `/cancel` exits an edit. `/status` shows scan health. Existing `/market chairs 3`
  and `/market pokemon 3` commands remain available.

Telegram updates and Supabase sync run separately from scraping at five-second
intervals; network delays can extend that target. A failed sync keeps the last
valid local searches. Only the paired private chat can edit; callback sender and
chat are both checked. Updates use revision checks, and reply state survives
retries. The current server caps the watch list at 10 items/20 search jobs;
more watches or slow upstream responses can extend scan intervals.

The initial migration groups the two existing products into two Supabase rows
and links their four existing jobs without resetting seen-item baselines. It
suppresses replay of old market reports. Research-only jobs run once and retain
their sample; enabling continuous monitoring preserves that baseline. Search
query/filter changes create a fresh baseline to avoid mixing distinct samples.

Runtime configuration (server only): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`WATCH_DB`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Credentials are deployed using
Fly encrypted secrets. Migration `20261027180000` is recorded as applied in the
remote migration ledger.

A SQLite backup was taken before enabling synchronization at
`/data/watches-before-watchlist-20261027.sqlite` on the Fly volume. To disable
watch-list synchronization without changing the database or current binary,
unset both Supabase environment secrets together and restart. Existing local
searches remain compatible. An older image cannot decode the new search fields;
do not roll back to it without a deliberate state restoration plan. The Supabase
table should be retained during rollback so watch-list edits are not discarded.

Validation includes isolated PostgreSQL checks, real Supabase create/edit/
revision/soft-delete checks with cleanup, private-chat callback authorization,
filter forwarding, research-only/opt-in behavior, baseline-preserving migration,
and stopping paused/deleted jobs captured by an already-running cycle.
