-- =====================================================================
-- LiberiaRide · 0021 · Operators can see emergency contacts (SOS handling)
-- =====================================================================
create policy emergency_contacts_staff_read on public.emergency_contacts for select to authenticated
  using (public.is_staff());
