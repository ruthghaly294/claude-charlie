# Car watch list and fuel-type analysis (@AutotraderNIbot)

## Goal

Add cars to track from Telegram (make, model, fuel), stored in Supabase the
same way as the eBay and Facebook watch lists. Every car gets the same market
research and Belfast alerts the RAV4 has now. All analysis is split by fuel
type, including the existing RAV4 data.

## Decisions (defaults unless the user changes them)

- Fuel types: Petrol, Diesel, Hybrid, Plug-in hybrid, Electric.
- A watch can be limited to one fuel type, or set to "Any". The analysis is
  always split by fuel type either way.
- Age limit: 8 years by default, editable per car.
- Rules for every car, same as the RAV4: dealers only, no write-offs or
  damaged cars, alerts within 60 miles of Belfast, full UK rescan every morning.
- The RAV4 becomes the first entry, and its existing data is kept.

## Facts established

- AutoTrader search results carry no fuel field, but the search has a
  `fuel_type` filter: Petrol, Diesel, Petrol Hybrid, Petrol Plug-in Hybrid,
  Diesel Hybrid, Electric. Searching each fuel type separately tags every car
  exactly, for about the same number of page loads (the results are split, not
  repeated).
- Used Cars NI shows fuel on every card ("DIESEL", "Petrol Hybrid",
  "Petrol/Electric Hybrid", "Hybrid Electric" and so on), and that text maps
  onto the five types.
- Used Cars NI needs a make ID (Toyota = 30), which its homepage make list
  provides, plus a model keyword.

## Steps (each one test-first, leaving the bot working)

1. Fuel type on every car. Parse it from both sites, then split the grid,
   depreciation, time to sell and alert price comparisons by fuel. The RAV4 is
   re-tagged at the next full scan.
2. Supabase `car_watchlist` table (make, model, fuel, max age, alerts on/off),
   with RLS locked to the service key like the existing tables, and a
   repository validated with zod.
3. Store and scans per watch. Each car record gets a `watch` column; full
   scans and Belfast checks run for each watch; the RAV4 data migrates in.
4. Telegram menu:
   - **Add car**: make → model → fuel → max age. The make and model are
     checked against both sites before saving.
   - **Car list**: each car with _Market_, _Pause alerts_ and _Remove_ buttons.
   - **Market**: pick which car's grid to see.
5. Deploy and verify on Fly by adding a Toyota Yaris from Telegram. Confirm
   its first scan, its grid, and the RAV4 grid split by fuel.

## Load

Each extra model adds one full UK scan a day (a Yaris from 2018 is likely
3,000–5,000 listings, about 5–8 minutes of page loads at 6am) and one Belfast
check every 10 minutes (about 30 seconds). Up to around 5 models fits easily
on the current 1 GB Fly machine.

## Estimate

About 3–4 hours of work, including the deploy and verification.
