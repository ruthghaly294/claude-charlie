# Fly.io deployment

Chosen host: Fly.io, one shared CPU, 1 GB RAM, one 1 GB persistent volume.
Budget approximately US$6–7/month before network usage, snapshots beyond the
free allowance, taxes and regional differences. Increase RAM if real searches
show memory pressure. This is a paid deployment, not a permanent free tier.
Pricing: https://fly.io/docs/about/pricing/

The CLI uses browser-based account authorization. GitHub credentials cannot
log into Fly.io. A billing method may be required.

From this directory after `fly auth login`:

```sh
node scripts/init-server.mjs
fly launch --no-deploy --copy-config --name YOUR-UNIQUE-APP-NAME --region lhr
fly volumes create ebay_chrome --region lhr --size 1
```

Upload service credentials without putting their values on the command line:

```sh
node --input-type=module -e 'import{readFileSync}from"node:fs";process.stdout.write(readFileSync(".env.server","utf8")+"VNC_PASSWORD="+readFileSync(".server/vnc-password","utf8")+"\n")' | fly secrets import
fly deploy --ha=false
```

Keep exactly one machine attached to this profile. The live configuration now runs continuously with restart policy `always`, automatic start enabled and one minimum running machine. The proof runtime limit was removed under the user's always-on instruction. Do not mount the profile in
another browser while this machine is using it.

## Initial sign-in

Make an initial authenticated API request to start Chrome. A completed-listing
request may return `UPSTREAM_AUTH_REQUIRED` until login is complete.

```powershell
$headers = @{ 'x-api-key' = 'YOUR_SERVICE_API_KEY' }
Invoke-RestMethod -Headers $headers -Uri 'https://YOUR-UNIQUE-APP-NAME.fly.dev/v1/ebay/completed?query=chesterfield+captain+chairs&domain=co.uk'
```

On Windows, install flyctl and sign into the same Fly.io account. Forward VNC
through Fly's authenticated private connection:

```powershell
fly proxy 5900:5900 -a YOUR-UNIQUE-APP-NAME
```

Connect a VNC viewer to `127.0.0.1:5900`, using the generated password from
`.server/vnc-password`. In the server's Chrome window, open a new tab, visit
ebay.co.uk and sign in directly. Leave the browser open; close only the viewer
and proxy when finished. Do not launch the separate Compose login service on Fly:
the running API's browser already owns the saved profile.

Repeat the API request. Confirm returned completed rows against the browser,
then restart the machine and repeat to verify real eBay authentication persists.
Your laptop can be off between uses. If eBay requests reauthentication, reconnect
the viewer and sign in again.

Only the HTTPS API is public, protected by `x-api-key`. Fly configuration does
not publish VNC or CDP as public services. VNC is reachable over the private Fly
network and also requires its own password. Keep access to the Fly organization
restricted because the Chrome volume contains an eBay session.

The scraper runs when called. It does not schedule searches or store historical
results. A running API does not prove authenticated completed-listing access;
that requires the real eBay login and a successful end-to-end check.

For the current scheduled-search deployment and Telegram operation, see [MONITORING.md](MONITORING.md). The hosted environment uses headless Google Chrome; VNC is disabled.
