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

## Scheduled (always-on watcher — no cron)

```sh
DECODE_INTERVAL_MIN=30 npm run decode:watch
```

Runs immediately, then every `DECODE_INTERVAL_MIN` minutes (default 30) until
stopped. Good for a dev box or a `tmux`/`pm2`-managed process.

## Belfast property scrape (automatic)

One-shot (loads LPS reference if needed, scrapes every registered agent for
East/South Belfast, geocodes + values + dedupes):

```sh
npm run scrape:property          # PROPERTY_MAX=25 per agent by default
```

Daily, hands-off — two options:

```sh
# A) cron (survives reboots; best on a persistent box)
0 7 * * * cd /workspaces/Search/my-new-project && /usr/bin/npm run scrape:property >> /tmp/property.log 2>&1

# B) always-on watcher (dev box / tmux / pm2)
PROPERTY_INTERVAL_HOURS=24 npm run property:watch
```

Agents covered: Templeton Robinson, Simon Brien, John Minnis, Ulster Property
Sales (all robots-permitted, no anti-bot wall). Add more in
`src/property/agentScrape.ts` → `AGENTS`.

## Verify gate

```sh
npm run verify   # tsc --noEmit && vitest run && next build
```
