# Running DECODE in production (local + cron)

DECODE runs on local SQLite — no hosting required. The loop is idempotent
(stable ids), so re-runs never duplicate.

## One-shot

```sh
npm run decode
```

Runs FEEDBACK? → CURATE → OBSERVE → DECIDE → EXECUTE → PACKAGE once, prints the
digest + token/cost, and writes a `decode_runs` row. Reads `.env.local`
(`DECODE_CONFIG`, `ANTHROPIC_API_KEY`, …). Without an API key it uses the
deterministic reasoner/critic; with one, it uses Claude.

## Scheduled (cron — recommended)

Add a crontab entry (every 30 min shown):

```cron
*/30 * * * * cd /workspaces/Search/my-new-project && /usr/bin/npm run decode >> /tmp/decode.log 2>&1
```

`crontab -e` to install. Check `npm run decode` works in that exact directory
first (cron has a minimal environment; use absolute paths).

## Recurring jobs (discovery, property-scrape, decode, …)

The durable job runner (`src/jobs/runner.ts`) drains due jobs per the
schedules in `decode.config.yml`'s `jobs.schedules` (discovery every 60min,
property-scrape every 12h, decode every 4h by default — all jittered ±15%).
A cold `jobs` table is seeded with an immediately-due job for each scheduled
kind on the first tick.

```sh
npm run jobs:tick          # drain due jobs once, then exit
```

Scheduled, hands-off — two options:

```cron
# A) cron (survives reboots; best on a persistent box)
*/5 * * * * cd /workspaces/Search/my-new-project && /usr/bin/npm run jobs:tick >> /tmp/jobs.log 2>&1
```

```sh
# B) always-on watcher (dev box / tmux / pm2)
TICK_INTERVAL_MIN=1 npm run jobs:watch
```

Connector health (circuit-breaker state + latency) and recent job runs are
available at `GET /api/health`.

## Belfast property scrape (one-shot)

Loads LPS reference if needed, scrapes every registered agent for East/South
Belfast, geocodes + values + dedupes, then backfills LPS facts + revalues:

```sh
npm run scrape:property          # PROPERTY_MAX=25 per agent by default
REFRESH_REFERENCE=1 npm run scrape:property  # also reload nihousepricemap quarters
```

Agents covered: Templeton Robinson, Simon Brien, John Minnis, Ulster Property
Sales (all robots-permitted, no anti-bot wall). Add more in
`src/property/agentScrape.ts` → `AGENTS`.

The recurring `property-scrape` job (above) covers the day-to-day
scrape + change-detection; run this one-shot command after adding agents or
when LPS reference data needs a manual refresh.

## Verify gate

```sh
npm run verify   # tsc --noEmit && vitest run && next build
```
