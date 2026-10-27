# Run independently of your laptop

Chrome and the API run on a Linux x86-64 server. The Docker volume retains the
server's eBay session when containers restart. Your laptop is only needed for
initial sign-in, and again if eBay asks you to authenticate. Scraping continues
while your laptop is off, provided the server remains running and the session is valid.

This implements the cloud-browser approach found in Marketplace-extractor. It
uses our existing Chrome/Playwright scraper, rather than copying Vinted selectors.

## Prepare the server

Copy this project to your server (exclude node_modules, coverage, .env files and
local browser profiles). Install Docker Engine with the Compose plugin. Inside
this project directory:

```sh
node scripts/init-server.mjs
docker compose --env-file .env.server build
```

The initialization command requires Node 24+ and creates credentials only when
missing. Alternatively run it in Docker:

```sh
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim node scripts/init-server.mjs
```

## Sign into Chrome on the server

Stop scraping before opening the same profile in login mode:

```sh
docker compose --env-file .env.server stop scraper
docker compose --env-file .env.server --profile login run --rm --service-ports login
```

From Windows PowerShell, open an SSH tunnel to the server:

```powershell
ssh -N -L 5900:127.0.0.1:5900 -L 3001:127.0.0.1:3001 USER@SERVER
```

Connect a VNC viewer to `127.0.0.1:5900`. Its password is stored on the server in
`.server/vnc-password`. Sign into eBay directly in this remote Chrome window.
This is a browser running on the server; your normal Windows Chrome is unrelated.
Do not send your eBay password or session cookies to anyone.

When sign-in is complete, press Ctrl+C in the login command's terminal. Chrome
closes gracefully and saves its profile. Then start the service:

```sh
docker compose --env-file .env.server up -d scraper
```

You can now close the VNC viewer and SSH tunnel and turn off your laptop.
The server restarts the service automatically. Never run login and scraper
containers simultaneously against the same volume. Do not delete the volume
with `docker compose down -v` unless you intend to erase the saved session.

## Retrieve completed listings

With the SSH tunnel open, use PowerShell (replace the key with the value from
`.env.server` on your server):

```powershell
$headers = @{ 'x-api-key' = 'YOUR_SERVICE_API_KEY' }
Invoke-RestMethod -Headers $headers -Uri 'http://127.0.0.1:3001/v1/ebay/completed?query=chesterfield+captain+chairs&domain=co.uk' | ConvertTo-Json -Depth 10 | Set-Content completed.json
```

Add `&sold_only=true` for sold listings only, or `&page=2` for another page.
The tunnel is needed to retrieve results from your computer, not to keep the
server working. The base API scrapes on request. With WATCH_DB configured, the deployed service also schedules searches and retains observations; see MONITORING.md. Other server jobs can call it locally with the key.

Both API and VNC are published only on the server's loopback interface. VNC is
available only in login mode. Chrome debugging stays inside the container. Use
an SSH tunnel; do not expose VNC or Chrome debugging ports publicly. The profile
volume contains account session data and should remain private to this service.

## Verification and operations

```sh
docker compose --env-file .env.server logs --tail 50 scraper
docker compose --env-file .env.server restart scraper
```

`UPSTREAM_AUTH_REQUIRED` means eBay requires sign-in: repeat the login procedure.
A blocked page or changed markup is reported as an error, rather than fabricated
listings. Successful public searches do not prove completed access. After login,
verify the requested completed query against the eBay browser results and repeat
after a server restart. Accepted Best Offers do not disclose a reliable sale price.

A Docker image or a running process in this development workspace is not an
always-on deployment. A real server/hosting account is required.
