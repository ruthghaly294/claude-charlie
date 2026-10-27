begin;

create table public.ebay_watchlist (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id text not null check (telegram_chat_id ~ '^-?[0-9]+$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  query text not null check (char_length(btrim(query)) between 1 and 500),
  domain text not null default 'co.uk' check (domain in
    ('com','co.uk','de','fr','it','es','com.au','ca','at','ch','be','ie','nl','pl','com.hk','com.sg','com.my','ph')),
  condition text check (condition in
    ('new','open_box','refurbished','used','for_parts','graded','ungraded')),
  buying_format text check (buying_format in ('auction','buy_it_now','best_offer')),
  min_price numeric(14,2) check (min_price between 0 and 10000000000),
  max_price numeric(14,2) check (max_price between 0 and 10000000000),
  free_shipping boolean not null default false,
  location text check (location in ('domestic','worldwide')),
  language text check (language in ('english','japanese','chinese','korean')),
  interval_minutes integer not null default 2 check (interval_minutes between 1 and 1440),
  monitor_active boolean not null default false,
  monitor_sold boolean not null default false,
  market_profile text check (market_profile in ('chairs','charizard_psa9_base')),
  research_requested_at timestamptz default now(),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ebay_watchlist_price_range check
    (min_price is null or max_price is null or min_price <= max_price)
);

comment on table public.ebay_watchlist is
  'Telegram-managed eBay search definitions. Research-only by default; soft deletions stop synchronized scheduler jobs.';
comment on column public.ebay_watchlist.telegram_chat_id is
  'Private owner chat. Access is enforced by the server; this table has no anonymous or authenticated client policies.';
comment on column public.ebay_watchlist.research_requested_at is
  'Changed when the user requests a fresh completed/sold listing research sample.';

create index ebay_watchlist_owner_updated_idx
  on public.ebay_watchlist(telegram_chat_id, updated_at, id);

create function public.ebay_watchlist_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.telegram_chat_id := old.telegram_chat_id;
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;
create trigger ebay_watchlist_touch_before_update
before update on public.ebay_watchlist
for each row execute function public.ebay_watchlist_touch();

alter table public.ebay_watchlist enable row level security;
revoke all on public.ebay_watchlist from anon, authenticated;
grant select, insert, update, delete on public.ebay_watchlist to service_role;
revoke all on function public.ebay_watchlist_touch() from public;

commit;
