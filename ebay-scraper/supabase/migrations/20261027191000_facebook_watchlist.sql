begin;
create table public.facebook_watchlist (
  like public.ebay_watchlist including defaults including constraints,
  primary key (id),
  provider text not null default 'facebook' check (provider = 'facebook'),
  latitude double precision not null default 54.5948 check (latitude between -90 and 90),
  longitude double precision not null default -5.8901 check (longitude between -180 and 180),
  radius_km double precision not null default 40 check (radius_km between 1 and 500),
  location_name text not null default 'Ballyhackamore, East Belfast'
    check (char_length(btrim(location_name)) between 1 and 100),
  constraint facebook_no_verified_sold_feed check (monitor_sold = false),
  constraint facebook_no_ebay_comparison_preset check (market_profile is null)
);
create index facebook_watchlist_owner_updated_idx on public.facebook_watchlist(telegram_chat_id,updated_at,id);
create function public.facebook_watchlist_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.id := old.id;
  new.telegram_chat_id := old.telegram_chat_id;
  new.created_at := old.created_at;
  new.provider := old.provider;
  new.updated_at := clock_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;
create trigger facebook_watchlist_touch_before_update before update on public.facebook_watchlist
for each row execute function public.facebook_watchlist_touch();
alter table public.facebook_watchlist enable row level security;
revoke all on public.facebook_watchlist from anon,authenticated;
grant select,insert,update,delete on public.facebook_watchlist to service_role;
revoke all on function public.facebook_watchlist_touch() from public;
comment on table public.facebook_watchlist is 'Private Facebook Marketplace watches; approximate collection radius in km. Asking-price snapshots, not verified completed sales.';
commit;
