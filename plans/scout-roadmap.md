# Scout roadmap: faster, better-targeted alerts, then reselling profit

Goal: see a good deal before anyone else, judge it in seconds, act in one tap.
Later: turn that into resale profit.

## Where time is lost today (measured 2026-10-30)

| Stage                                | Facebook                                | eBay                               |
| ------------------------------------ | --------------------------------------- | ---------------------------------- |
| Site shows the new listing in search | 20-60+ min after creation (seen today)  | ~2-3 min                           |
| Our check interval                   | 10 min (CPU throttled to ~9% of a core) | 15 s - 2 min                       |
| Page loads / time lookups            | 30-60 s each, some time out             | item pages sometimes refused (403) |

## Ranked improvements

### Speed

1. **Bigger Facebook server** (shared-cpu-4x, ~£5/month more). Checks every
   2-3 min instead of 10, fewer timeouts. Biggest single speed win. ~15 min.
2. **eBay official Browse API** (free tier, 5,000 calls/day). Exact
   `itemCreationDate`, newest-first, no 403 blocks, 1-minute checks.
   Needs an eBay developer account. ~2 h.
3. **Find out where Facebook's 20-60 min lag comes from.** First-seen times
   are now recorded (since 2026-10-30 18:00). After a day, compare listed vs
   seen: if the lag is Facebook's, try a second search style (category feed,
   no keyword); if it's ours, item 1 fixes it. ~30 min analysis.

### Right stuff

4. **Second-layer filter per search, from Telegram**: must-have words,
   blocked words ("PU", "faux", "kids"), max price. Checks title and
   description. ~2 h.
5. **👍 / 👎 buttons on every alert.** Tunes item 4 from real taps. ~1 h.

### Act in one tap

6. **Action buttons on the alert**: "Message seller" (Facebook) with a ready
   message ("Hi, is this still available? I can collect today"), "Buy now"
   (eBay). ~1 h.

### Reselling profit (monetise)

7. **Profit estimate on every alert.** Asking price vs eBay sold median for
   the same item (sold research already exists for chairs and Charizard):
   "Ask £120 · sells ~£260 on eBay · est. profit £95 after fees and delivery".
   Facebook-buy → eBay-sell is the core arbitrage. ~3 h.
8. **Loud vs silent alerts.** Big est. profit → normal notification;
   everything else silent. ~30 min after item 7.
9. **Flip tracker.** Mark bought / sold price in Telegram, saved to
   Supabase, weekly profit summary. ~2 h.
10. **Later: sell the alerts** as a paid Telegram bot for other resellers.
    Watch lists are already per chat. Risk: Facebook and eBay terms forbid
    scraping; selling a scraping-based service raises that risk. Do the
    official eBay API (item 2) first.

## Recommended order

7 → 1 → 4 → 6 → 2 → 3 → 5 → 8 → 9 → 10
