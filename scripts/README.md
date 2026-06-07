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

## Verify gate

```sh
npm run verify   # tsc --noEmit && vitest run && next build
```
