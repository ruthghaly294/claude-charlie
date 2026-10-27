-- Run against an isolated PostgreSQL database after applying the migration.
begin;
do $$
declare entry public.ebay_watchlist;
begin
  insert into public.ebay_watchlist(telegram_chat_id,name,query)
  values ('123','Radiology book','Top 3 Differences in Radiology OBrien second edition')
  returning * into entry;
  if entry.monitor_active or entry.monitor_sold or entry.revision <> 1 then
    raise exception 'New entries must be research-only at revision 1';
  end if;
  update public.ebay_watchlist set query='Radiology second edition',
    telegram_chat_id='456', created_at='2000-01-01' where id=entry.id;
  if not exists(select 1 from public.ebay_watchlist where id=entry.id
    and telegram_chat_id='123' and revision=2 and created_at=entry.created_at) then
    raise exception 'Owner, creation time or revision protection failed';
  end if;
  begin
    update public.ebay_watchlist set min_price=100,max_price=50 where id=entry.id;
    raise exception 'Invalid price range was accepted';
  exception when check_violation then null;
  end;
  update public.ebay_watchlist set deleted_at=now() where id=entry.id;
  if not exists(select 1 from public.ebay_watchlist where id=entry.id
    and deleted_at is not null and revision=3) then
    raise exception 'Soft deletion revision did not advance';
  end if;
  if has_table_privilege('anon','public.ebay_watchlist','select')
    or has_table_privilege('authenticated','public.ebay_watchlist','update') then
    raise exception 'Private watches exposed to client API roles';
  end if;
  if not has_table_privilege('service_role','public.ebay_watchlist','insert') then
    raise exception 'Server API role cannot manage watches';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.ebay_watchlist'::regclass) then
    raise exception 'Row level security is disabled';
  end if;
end;
$$;
rollback;
