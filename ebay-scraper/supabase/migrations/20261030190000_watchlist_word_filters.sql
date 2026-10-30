-- Optional second-layer filters applied after the site's own search.
-- Comma-separated words or phrases; null means no filter.
alter table public.ebay_watchlist
  add column include_words text check (char_length(include_words) <= 500),
  add column exclude_words text check (char_length(exclude_words) <= 500);
alter table public.facebook_watchlist
  add column include_words text check (char_length(include_words) <= 500),
  add column exclude_words text check (char_length(exclude_words) <= 500);
