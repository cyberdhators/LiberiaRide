-- =====================================================================
-- LiberiaRide · 0031 · SCHEDULED booking status
-- On its own: a new enum value cannot be used in the transaction that adds it.
-- A scheduled booking is priced and waiting for its pickup time; it is NOT an
-- active ride (the passenger can book other rides meanwhile).
-- =====================================================================
alter type public.booking_status add value if not exists 'SCHEDULED';
