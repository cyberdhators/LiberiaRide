-- =====================================================================
-- LiberiaRide · 0020 · URL-safe trip share tokens
-- base64 tokens can contain '/', '+', '=' which break path segments.
-- =====================================================================
alter table public.bookings alter column share_token set default encode(extensions.gen_random_bytes(18), 'hex');
update public.bookings set share_token = encode(extensions.gen_random_bytes(18), 'hex') where share_token ~ '[^0-9a-f]';
