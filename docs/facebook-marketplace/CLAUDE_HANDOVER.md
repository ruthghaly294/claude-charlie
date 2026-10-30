# Claude handover: Facebook Marketplace Telegram monitor

Updated 2026-10-27. Read this before making changes.

## User's objective and latest instruction

Build a separate Facebook Marketplace Telegram bot using the successful eBay
architecture. Initial live test: Chesterfield captain's chair, East Belfast,
within **40 km**. Include listing image, asking price, location, estimated
straight-line distance and link. Reuse persistent baselines, deduplication,
quiet retries, Supabase watch-list CRUD and Telegram controls. Run continuously
on Fly.io while the user's laptop is off. The laptop is only for initial login.

The user requested uninterrupted progress, then explicitly requested this
handover because the current session was nearly out of tokens. Do not claim
Facebook monitoring is finished. They are frustrated with VNC links that failed.
Give a browser-accessible, verified VNC link, not a localhost URL or a requirement
to keep their laptop forwarding ports all day.

## Current status, honestly

- **eBay is complete and live. Do not disrupt it.** Its four jobs were healthy at
  the last checks. The user is happy with its behavior.
- Facebook has a **separate always-on Fly app and encrypted volume**, a valid
  separate Telegram bot, and a hosted Chrome/VNC login service.
- The Facebook **search parser, scheduled worker and Telegram CRUD integration
  are NOT implemented yet**. The deployed process is a login helper, not a
  working listing monitor.
- Anonymous Facebook Marketplace access redirected to `/login/`. The user needs
  to complete their own Facebook sign-in in the hosted dedicated Chrome.
- Distance filtering, result contracts and relevance filtering are implemented
  locally with tests. No real Facebook listing payload has been captured yet;
  do not pass synthetic fixtures off as live data.
- The new Facebook Supabase migration is written and passed isolated PostgreSQL
  checks, but **has NOT been applied to the live Supabase project**.
- The user said Vinted already exists. It was not found in this workspace, other
  `/workspaces` directories, local branches, the connected GitHub repositories,
  or Fly apps. They were asked for its location; no answer yet. Continue using
  the eBay architecture rather than blocking on Vinted.

## Workspace and source control

Workspace: `/workspaces/claude-charlie`, service: `ebay-scraper/`.
Branch: `feature/facebook-marketplace` (branched from the completed eBay branch).
Facebook changes are currently uncommitted. Preserve unrelated user changes to
root `.gitignore`, `skills-lock.json`, untracked skills, Agent-Reach and archives.

Useful prior commits:
- `a432e5d`: final eBay watch-list edit fix, 140 tests passing.
- `b8c2449`: eBay Telegram/Supabase watch-list integration.
- `73ab6a0`: private eBay Supabase repository/table.
- `2661b5c`: once-per-scan market snapshot CPU optimization.

## Credentials and authentication (never put values in source or the handover)

Ignored mode-0600 files under `ebay-scraper/`:
- `.env.facebook`: new bot token, copied paired chat ID, Facebook service API key,
  temporary VNC viewer token and its expiry.
- `.env.supabase`: project URL, modern server secret key, publishable key.
- `.env.server`: existing eBay service API key.
- `.server/facebook-vnc-password`: temporary VNC connection password.

The actual tokens were supplied by the user and are already saved; do not ask
for them again. Do not echo bot tokens, Supabase secret keys, Facebook cookies or
Facebook passwords. The user's actual Facebook password must only be entered by
that user in Facebook's real Chrome page. No CAPTCHA/checkpoint automation.

New Telegram bot: **@Facebookmarketplacebelfastbot**. `getMe` verified it, and
`getUpdates` confirmed that the existing paired private chat has Started it.
The Facebook Fly app already has these encrypted secrets:
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SERVICE_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `VNC_PASSWORD`, `FACEBOOK_VNC_VIEW_TOKEN`,
`FACEBOOK_VNC_VIEW_EXPIRES`.

Supabase CLI is authenticated via the user's completed browser verification.
Use `npx --yes supabase@latest ... --agent yes --output-format json` for commands.
Do not request more API keys: schema changes need the authenticated CLI, which
now works. Project ref is **sbgfeqanqznuhnsdekyt**, Marketplace Extractor, London.

## Fly services

Existing eBay:
- App `aaron-ebay-scraper`, machine `7819642a325748`, region `lhr`.
- One shared CPU / 1 GB RAM, `/data` persistent volume.
- Main profile `/data/chrome`, DB `/data/watches.sqlite`.
- Bot **@Ebaymarketbot**. Do not use its token for Facebook or poll its updates
  from another process.

New Facebook:
- App `aaron-facebook-marketplace`, machine **d8911630b4d448**, region `lhr`.
- Encrypted 1 GB volume **vol_rnz1g759x1qjxwer**, mounted `/data`.
- Dedicated Chrome profile **/data/facebook-chrome**.
- Config **ebay-scraper/facebook.fly.toml**.
- Current command **node dist/facebook/login-server.js**.
- `ENABLE_VNC=true`: x11vnc is on port 5900 inside the private Fly network.
- Public HTTPS base **https://aaron-facebook-marketplace.fly.dev**.
- `/health` is public basic process health; `/v1/facebook/session` requires
  the Facebook service `x-api-key` and returns only browser readiness/path.

The separate Facebook app incurs ordinary Fly hosting charges at the same small
instance tier. The user authorized continuing paid hosting for functionality;
free testing is a later requirement. Do not say it is free or laptop-dependent.

## VNC: failure, fixes and next verification

The first Codespaces noVNC URL was inaccessible to the user. A native Fly proxy
was offered, but the user explicitly wants a **direct browser link**.

A temporary HTTPS noVNC viewer is implemented in `src/facebook/vnc.ts` using
`@fastify/static`, `@fastify/websocket`, `@novnc/novnc` and a localhost-only TCP
proxy to the existing VNC server. Strong temporary token, expiry and WebSocket
Origin checks protect the actual desktop; VNC also has a connection password.

Initial `/vnc/login?token=...` used a Secure/HttpOnly/SameSite=Strict cookie plus
302 redirect. The user got `VIEWER_AUTH_REQUIRED`, probably from cross-site
cookie handling. It was changed to serve the viewer directly with HTTP 200.
A real browser test connected successfully, but the user still reported failure.

**Latest local fix:** remove reliance on cookies for browser access. The client
accepts a `#key=...` fragment, carries the token in the protected WebSocket URL,
and retains the fragment in browser history. Public `/vnc/` and noVNC SDK assets
contain no desktop data; `/vnc/socket` still requires the valid temporary token
(or legacy cookie), unexpired session and matching Origin. This lets a normal
browser open the viewer even if cookies are blocked.

A deployment of that latest fix was started during handover preparation. Check
`fly status`/logs and verify it is live. Previous image was
`deployment-01M5ZCQSE41EYJJKFCZKH7453T`; a newer deployment should supersede it.

Generate the link from the ignored file (do not commit the resulting secret URL):

```sh
cd /workspaces/claude-charlie/ebay-scraper
node --env-file=.env.facebook --input-type=module -e 'console.log("https://aaron-facebook-marketplace.fly.dev/vnc/#key="+process.env.FACEBOOK_VNC_VIEW_TOKEN)'
```

Read the temporary connection password from `.server/facebook-vnc-password`
and give it to the user as needed. It is NOT their Facebook password.
`FACEBOOK_VNC_VIEW_EXPIRES` is an epoch-millisecond expiry, roughly one hour after
it was generated. If expired, update it in the ignored file and stage both viewer
secrets with `fly secrets import --app aaron-facebook-marketplace --stage`, then
deploy. Do not weaken viewer authentication to fix a broken link.

Verify with a real browser **without depending on a preexisting cookie**, check
that the actual VNC connection reaches its connected status, then send the full
fragment link to the user. Do not claim a 302 alone proves the desktop works.
Do not take screenshots or inspect the login form while the user types a password.
After they say Done, read Marketplace data, not unrelated Facebook content.

## Implementation files so far

New:
- `src/facebook/login-server.ts`: hosted persistent headed Chrome + health/session
  endpoints; mounts viewer if temporary viewer secrets are present.
- `src/facebook/vnc.ts`: protected noVNC HTML/static/WebSocket bridge.
- `src/facebook/geo.ts`: Haversine distance, coordinate validation and radius checks.
  Approximate test centre 54.59, -5.88, labelled East Belfast/Ballyhackamore.
- `src/facebook/contract.ts`: listing DTO with ID/title/URL/image/asking price,
  location/coordinates, availability and optional listed time.
- `src/facebook/results.ts`: local relevance, availability, price and raw-distance
  filtering. Unknown coordinates are excluded, never silently treated as local.
  Emits the common Listing shape with human-readable approximate distance.
- `tests/facebook/{geo,results,vnc}.test.ts`.
- `supabase/migrations/20261027191000_facebook_watchlist.sql` and
  `supabase/facebook-watchlist-checks.sql`.
- `docs/facebook-marketplace/PLAN.md`.

Modified shared code:
- `src/supabase-watchlist.ts`: optional Facebook geo/provider fields; repository
  factory fourth argument `"facebook"` selects `facebook_watchlist` and exposes
  `repository.platform`. Default remains eBay. No live eBay deployment was changed.
- `src/watch-config.ts`: optional Facebook provider and geo fields.
- `tests/supabase-watchlist.test.ts`: Facebook table isolation test.
- `package.json`/lock: noVNC/Fastify plugins and `@types/ws` added.

## Next steps, in order

1. Finish verifying and delivering the cookie-independent hosted VNC link. The
   user must sign in. Keep implementing independent pieces while waiting.
2. Capture a sanitized real Marketplace listing response/DOM after login.
   Build a real parser/transport using those fields, without copying auth tokens
   into logs or replaying private endpoints. Detect login/checkpoints distinctly;
   preserve a login tab for manual reauthentication.
3. Verify how Facebook applies origin and radius. Browser search may recommend
   items outside the radius. Independently calculate distance from listing
   coordinates and suppress unknown/out-of-range locations. Filter raw distance,
   not a rounded display value. Show approx. straight-line km, not driving km.
4. Apply the already locally tested Facebook table migration using the CLI:
   `supabase db query --linked --project-ref ... --file ...`; then record it via
   `supabase migration repair 20261027191000 --status applied --linked --project-ref ...`.
   Verify RLS, anonymous denial and CRUD with a temporary owner-0 row; clean it up.
5. Extend shared bot/sync through a Facebook provider mode (do not duplicate the
   whole eBay app). Facebook has active asking-price snapshots, **not verified
   completed-sale prices**. Do not turn a Sold label/asking price into a sale price.
   The DB rejects `monitor_sold=true` and eBay market presets for Facebook.
6. Shared `watchlist-bot.ts` currently hardcodes eBay sold research / Yes enabling
   both active+sold. Adapt it for `repository.platform === "facebook"`: only active
   mode, asking-price research, and location/radius editing. Preserve eBay behavior.
   New Facebook entries should default to East Belfast/40 km, initial interval
   preferably 5 minutes on the small CPU tier; existing eBay cadence stays unchanged.
7. Extend `watchlist-sync.ts` for Facebook one-off active snapshots vs continuous
   active watches. Preserve baseline when opting in. Use a separate SQLite file,
   e.g. `/data/facebook-watches.sqlite`, so outboxes and Telegram cursors are isolated.
8. Shared Telegram sender currently allowlists only eBay URLs/images. Add tightly
   validated canonical Facebook Marketplace item URLs and Facebook image CDNs.
   Include location/distance in Facebook alert text. Avoid revealing server details.
9. Add a full Facebook worker entrypoint; change only `facebook.fly.toml` process
   command when ready. Reuse scheduler, persistent dedupe, quiet daily error policy,
   baseline behavior and graceful shutdown. Keep bot polling separate from scraping.
10. Seed the requested chair watch, test image/link delivery and location/radius,
    configure menu for the new bot, test CRUD/restart/opt-in/remove, and disable or
    expire temporary VNC access after login. Verify eBay remains healthy throughout.

## Verification and operations

From `ebay-scraper/`:

```sh
npm test
npm run build
npm run typecheck
npm run lint
git diff --check
/home/codespace/.fly/bin/fly deploy --config facebook.fly.toml --ha=false
/home/codespace/.fly/bin/fly logs --app aaron-facebook-marketplace --no-tail
```

Ebay final prior baseline: 140 tests passing. New targeted geo/results/repository
and VNC tests passed. Latest VNC fix passed its 2 tests, build and typecheck.
Run the full expanded suite before shipping the actual Facebook worker. Never
silence strict TypeScript or skip tests. `@types/ws` was needed for the WebSocket
plugin; it is now installed. `npm audit` reported no vulnerabilities on install.

Local test resources may still exist: Docker `facebook-sql-test` (isolated PG17),
`facebook-login-browser` (old inaccessible local VNC, can be stopped), websockify
on 6081, and gstack browser server. No Facebook login was completed locally.
Stop only these owned temporary resources when no longer needed.

Browser tool: `/home/codespace/.claude/skills/gstack/browse/dist/browse` requires
`PATH=/home/codespace/.bun/bin:$PATH`. Its automatic server died with the parent
process watchdog; a foreground server was started with
`bun run /home/codespace/.claude/skills/gstack/browse/src/server.ts` and survives
as an exec session. It last inspected the noVNC viewer only. It can accept the
known temporary VNC connection password via `dialog-accept`; never automate the
user's real Facebook password, MFA or CAPTCHA.

## Relevant docs

- `ebay-scraper/SUPABASE.md`, `MONITORING.md`: completed eBay architecture.
- `docs/facebook-marketplace/PLAN.md`: Facebook acceptance criteria.
- Official Fastify websocket/static and noVNC API docs informed the viewer.
- Facebook's help pages and public Marketplace search redirected to login;
  third-party descriptions of radius URL parameters remain unverified.
