-- =====================================================================
-- LiberiaRide · 0018 · Anonymous category listing
-- Found by supabase/tests/lifecycle_test.sql: the shared policy called
-- public.is_staff(), which anon may not execute, so anonymous reads failed.
-- Restrict the existing policy to authenticated; add an anon policy (active only).
-- =====================================================================
alter policy vehicle_categories_read on public.vehicle_categories
  to authenticated
  using (is_active or public.is_staff());
create policy vehicle_categories_read_anon on public.vehicle_categories for select to anon
  using (is_active);
