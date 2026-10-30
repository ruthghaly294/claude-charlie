begin;
create table public.car_watchlist (
  id uuid primary key,
  telegram_chat_id text not null check (telegram_chat_id ~ '^-?[0-9]+$'),
  make text not null check (char_length(btrim(make)) between 1 and 40),
  model text not null check (char_length(btrim(model)) between 1 and 40),
  fuel text check (fuel in ('Petrol', 'Diesel', 'Hybrid', 'Plug-in hybrid', 'Electric')),
  max_age_years integer not null default 8 check (max_age_years between 1 and 20),
  alerts_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index car_watchlist_owner_idx on public.car_watchlist(telegram_chat_id, created_at, id);
alter table public.car_watchlist enable row level security;
revoke all on public.car_watchlist from anon, authenticated;
grant select, insert, update, delete on public.car_watchlist to service_role;
comment on table public.car_watchlist is 'Private car watches for the AutoTrader / Used Cars NI market tracker. Dealer asking prices; gone cars are likely, not verified, sales.';
commit;
