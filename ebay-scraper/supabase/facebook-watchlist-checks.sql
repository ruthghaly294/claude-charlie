begin;
do $$
declare entry public.facebook_watchlist;
begin
  insert into public.facebook_watchlist(telegram_chat_id,name,query) values ('0','Chair test','chesterfield captain chair') returning * into entry;
  if entry.provider <> 'facebook' or entry.radius_km <> 40 or entry.latitude <> 54.5948 or entry.longitude <> -5.8901 then raise exception 'Incorrect initial location/radius'; end if;
  if entry.monitor_active or entry.monitor_sold then raise exception 'Research-only defaults failed'; end if;
  begin
    update public.facebook_watchlist set radius_km=0 where id=entry.id;
    raise exception 'Invalid radius accepted';
  exception when check_violation then null;
  end;
  begin
    update public.facebook_watchlist set monitor_sold=true where id=entry.id;
    raise exception 'Unverified sold feed was enabled';
  exception when check_violation then null;
  end;
  update public.facebook_watchlist set radius_km=25 where id=entry.id;
  if not exists(select 1 from public.facebook_watchlist where id=entry.id and revision=2 and radius_km=25) then raise exception 'Edit revision failed'; end if;
  if has_table_privilege('anon','public.facebook_watchlist','select') then raise exception 'Anonymous watch-list access'; end if;
end;
$$;
rollback;
