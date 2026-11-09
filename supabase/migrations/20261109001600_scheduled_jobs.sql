-- =====================================================================
-- LiberiaRide · 0016 · Scheduled jobs (pg_cron)
-- =====================================================================
create extension if not exists pg_cron;

-- Offer expiry, re-dispatch, booking expiry, stale-driver offline. Every 5 s.
select cron.schedule('liberia-ride-dispatch', '5 seconds', $$select public.run_dispatch_maintenance()$$);

-- Data retention (daily, 03:15 Monrovia = UTC).
create or replace function public.run_retention()
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  delete from public.location_history where received_at < now() - interval '90 days';
  delete from public.realtime_events where created_at < now() - interval '30 days';
  delete from public.qls_lookup_cache where expires_at < now();
  delete from public.fare_estimates fe where fe.expires_at < now() - interval '7 days'
     and not exists (select 1 from public.bookings b where b.fare_estimate_id = fe.id);
end;
$$;
select cron.schedule('liberia-ride-retention', '15 3 * * *', $$select public.run_retention()$$);
