# Facebook Marketplace bot

User-authorized scope: separate Telegram bot, same Supabase/Fly architecture as
eBay, initial Chesterfield captain's chair search around East Belfast within
40 km. Continue implementation without repeated approval requests.

Working assumptions: Ballyhackamore is an approximate East Belfast centre;
distances are straight-line estimates rather than driving distances. Facebook
asking prices and marked-sold status must not be reported as verified sold
transaction prices. No seller messages, purchases or account changes.

Build order:
1. Verify live public/browser access and location/radius semantics.
2. Define and test listing contracts, geodesic distance filtering and parsing.
3. Add a separate private Supabase watch list and persistent outbox/baseline.
4. Add the Facebook Telegram menu, CRUD, location/radius editing and status.
5. Connect bounded browser searches to the existing single-worker service.
6. Verify live East Belfast/40 km search, delivery, restart and deduplication.

Acceptance:
- Photos, title, asking price, local place, estimated distance and listing link.
- Suppress known out-of-radius results; unknown location is never called local.
- New detections deduplicate across restart; transient failures stay quiet.
- Add, review, edit, pause, remove and asking-price research work from Telegram.
- First scan records a baseline instead of replaying all old listings as new.
- Existing eBay watches continue operating with their saved history.

External dependencies: user has supplied the new Facebook bot token. Telegram
requires the user to Start the new bot. Vinted source was not found locally or
in the connected repositories; the eBay implementation is available for reuse.
Any Facebook login/checkpoint must be completed by the user in a dedicated
browser session; no CAPTCHA automation or account credential collection.
