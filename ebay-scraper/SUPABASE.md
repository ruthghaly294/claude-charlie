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
