-- Switch the Fly servers off 23:00-07:00 UK time to save running cost.
-- Tokens live in Supabase Vault as fly_token_<app> (Fly deploy tokens, one
-- per app, created 2026-10-30, expire 2027-10-30). Cron runs in UTC, so each
-- job fires at both possible UTC hours and acts only on the UK hour.
-- If a Fly machine is recreated, its ID below must be updated.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;

create or replace function ops.fly_machines(action text, only_app text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  if action not in ('start', 'stop') then
    raise exception 'action must be start or stop';
  end if;
  for m in
    select app, machine from (values
      ('aaron-facebook-marketplace', 'd8911630b4d448'),
      ('aaron-ebay-scraper', '7819642a325748'),
      ('aaron-car-tracker', 'd8911634ae5138')
    ) as v(app, machine)
    where only_app is null or app = only_app
  loop
    perform net.http_post(
      url := format('https://api.machines.dev/v1/apps/%s/machines/%s/%s', m.app, m.machine, action),
      headers := jsonb_build_object(
        'Authorization', (select decrypted_secret from vault.decrypted_secrets where name = 'fly_token_' || m.app),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  end loop;
end;
$$;
revoke all on function ops.fly_machines(text, text) from public, anon, authenticated;

select cron.schedule(
  'fly-night-stop',
  '0 22,23 * * *',
  $$ select ops.fly_machines('stop') where extract(hour from now() at time zone 'Europe/London') = 23 $$
);
select cron.schedule(
  'fly-morning-start',
  '0 6,7 * * *',
  $$ select ops.fly_machines('start') where extract(hour from now() at time zone 'Europe/London') = 7 $$
);
