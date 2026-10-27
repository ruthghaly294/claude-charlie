# Completed listings on Windows

Your eBay login on your computer is separate from the browser in this development workspace. Run the scraper on your computer to use a local, dedicated signed-in Chrome session. Passwords and cookies stay on your computer; do not send them to the agent.

1. Install [Node.js 24 or newer](https://nodejs.org/en/download) and Google Chrome if needed.
2. Extract the supplied ZIP into a folder, for example `C:\Tools\ebay-scraper`. Extract it first; do not run files from inside the ZIP viewer.
3. Double-click `START-WINDOWS.cmd`. It installs the locked dependencies, builds the service, and opens a separate Chrome profile just for this scraper.
4. Sign into eBay in **that new Chrome window**. A login in your normal Chrome profile will not transfer automatically.
5. Return to the command window and press a key. Leave both windows open while scraping.
6. When it says the server is listening on port 3001, open one of these addresses:

All completed listings, including unsold items:

```text
http://127.0.0.1:3001/v1/ebay/completed?query=chesterfield+captain+chairs&domain=co.uk
```

Sold items only:

```text
http://127.0.0.1:3001/v1/ebay/completed?query=chesterfield+captain+chairs&domain=co.uk&sold_only=true
```

Add `&page=2` for the next page. The browser shows JSON; save it as a `.json` file if desired. Press Ctrl+C in the server window to stop the API. Close the dedicated Chrome window when finished.

The launcher binds both the API and Chrome debugging to localhost. It uses a separate profile under `%LOCALAPPDATA%\EbayScraperChrome`, not your normal Chrome profile. Chrome 136+ requires a non-default profile for remote debugging; see [Chrome's explanation](https://developer.chrome.com/blog/remote-debugging-port). Keep this profile dedicated to eBay and do not use it for other signed-in services.

Completed responses add `completed: true`. The top-level `sold` flag says whether you requested sold-only filtering. Individual completed rows include `is_sold` (true/false/null), `ended_date`, and `sale_price`. Dates preserve the displayed precision; no exact sale time is invented. `price` is the displayed amount. If an accepted Best Offer or a struck-through price is shown, `sale_price` stays null because the actual accepted amount is not established by that display.

This Windows launcher was prepared from the tested Node/Chrome service, but cannot be executed or authenticated against your Windows session from this Linux workspace. Completed-mode parsing currently recognizes English Sold/Ended labels and uses labelled test HTML; actual authenticated eBay markup may require adjustments after your first run. If eBay asks for login or blocks a request, the service returns a clear error instead of fabricated results. No authenticated completed-listing results have been retrieved by this agent yet.
