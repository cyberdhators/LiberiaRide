-- =====================================================================
-- LiberiaRide · 0017 · Close privilege gaps found by the Supabase security advisor
--
-- Supabase grants EXECUTE/ALL to anon+authenticated through GLOBAL default
-- privileges for role postgres. The schema-scoped `alter default privileges
-- in schema public revoke …` in 0012 does not override those, so functions
-- created after 0012 were callable by anon. Most importantly public.publish()
-- would have let any caller broadcast forged Realtime messages on any topic.
-- =====================================================================

-- Internal helpers: nobody but the owner (and triggers) may call them.
revoke execute on function
  public.publish(text, text, jsonb, boolean),
  public.run_retention(),
  public.tg_publish_booking(),
  public.tg_publish_offer(),
  public.tg_publish_bid(),
  public.tg_publish_driver_location(),
  public.tg_publish_notification(),
  public.tg_publish_chat(),
  public.tg_publish_incident()
  from public, anon, authenticated;

-- Policy helpers: signed-in users only.
revoke execute on function public.realtime_can_read(text) from public, anon;
revoke execute on function public.can_read_booking(uuid) from public, anon;
grant execute on function public.realtime_can_read(text), public.can_read_booking(uuid) to authenticated;

-- Future objects created by postgres start with no API privileges anywhere.
-- Every new table/function must be granted explicitly (see docs/SECURITY.md).
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres revoke all on tables from anon, authenticated;
alter default privileges for role postgres revoke all on sequences from anon, authenticated;
