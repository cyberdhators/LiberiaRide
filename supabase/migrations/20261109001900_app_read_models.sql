-- =====================================================================
-- LiberiaRide · 0019 · Read models for the web app
-- PostgREST returns geography columns as hex EWKB, so the UI reads
-- coordinates through these RPCs (lat/lng numbers) instead.
-- =====================================================================

-- Reverse-geocoding gap adapter (docs/QLS_INTEGRATION.md §5.2):
-- nearest verified landmark (75 m) → nearest cached QLS result (50 m) → null.
create or replace function public.nearest_place_label(p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_pt extensions.geography := public.make_point(p_lat, p_lng);
  v jsonb;
begin
  perform public.require_active_user();
  select jsonb_build_object('label', 'Near ' || a.alias, 'source', 'alias', 'qls_ref', a.qls_code,
                            'distance_m', round(extensions.st_distance(a.location, v_pt)))
    into v
    from public.address_aliases a
   where a.is_verified and extensions.st_dwithin(a.location, v_pt, 75)
   order by extensions.st_distance(a.location, v_pt) limit 1;
  if v is not null then return v; end if;

  select jsonb_build_object('label', c.label, 'source', 'qls_cache',
                            'qls_ref', coalesce(c.response #>> '{0,qlsRef}', c.response ->> 'qlsRef'),
                            'distance_m', round(extensions.st_distance(c.location, v_pt)))
    into v
    from public.qls_lookup_cache c
   where c.location is not null and c.label is not null and c.expires_at > now()
     and extensions.st_dwithin(c.location, v_pt, 50)
   order by extensions.st_distance(c.location, v_pt) limit 1;
  return v;
end;
$$;

-- Free local landmark search (no QLS credit). Used before calling QLS place search.
create or replace function public.search_address_aliases(p_query text, p_limit integer default 5)
returns table (alias text, address_text text, qls_code text, lat double precision, lng double precision)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select a.alias, a.address_text, a.qls_code,
         extensions.st_y(a.location::extensions.geometry), extensions.st_x(a.location::extensions.geometry)
    from public.address_aliases a
   where a.is_verified
     and length(btrim(p_query)) >= 2
     and a.normalized like '%' || lower(regexp_replace(btrim(p_query), '\s+', ' ', 'g')) || '%'
   order by position(lower(btrim(p_query)) in a.normalized), length(a.alias)
   limit least(greatest(p_limit, 1), 10);
$$;

-- Passenger home: how many live drivers are near (count only — never positions).
create or replace function public.nearby_driver_count(p_lat double precision, p_lng double precision, p_category_code text default null)
returns integer
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select count(*)::integer
    from public.driver_locations dl
    join public.drivers d on d.id = dl.driver_id and d.is_online and d.status = 'approved'
    left join public.vehicles v on v.id = d.current_vehicle_id
    left join public.vehicle_categories vc on vc.id = v.category_id
   where extensions.st_dwithin(dl.location, public.make_point(p_lat, p_lng), 5000)
     and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'))
     and (p_category_code is null or vc.code = p_category_code)
     and not exists (select 1 from public.booking_assignments ba where ba.driver_id = d.id and ba.released_at is null);
$$;

-- One-call snapshot for the driver console.
create or replace function public.driver_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_d   public.drivers;
  v_active uuid;
begin
  select * into v_d from public.drivers where id = v_uid;
  if not found then return null; end if;
  select id into v_active from public.bookings
   where driver_id = v_uid and status in ('DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS');

  return jsonb_build_object(
    'status', v_d.status, 'is_online', v_d.is_online, 'review_note', v_d.review_note,
    'rating', v_d.rating_avg, 'completed_trips', v_d.completed_trips,
    'acceptance_rate', case when v_d.acceptance_offers = 0 then null
                            else round(v_d.acceptance_accepts::numeric * 100 / v_d.acceptance_offers) end,
    'vehicle', (select jsonb_build_object('id', v.id, 'make', v.make, 'model', v.model, 'color', v.color,
                                          'plate', v.plate_number, 'status', v.status, 'category', vc.code, 'category_name', vc.name)
                  from public.vehicles v join public.vehicle_categories vc on vc.id = v.category_id
                 where v.id = v_d.current_vehicle_id),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', dd.id, 'doc_type', dd.doc_type, 'status', dd.status,
                                                                'review_note', dd.review_note, 'expires_at', dd.expires_at)
                                             order by dd.created_at desc), '[]'::jsonb)
                    from public.driver_documents dd where dd.driver_id = v_uid),
    'location', (select jsonb_build_object('lat', extensions.st_y(dl.location::extensions.geometry),
                                           'lng', extensions.st_x(dl.location::extensions.geometry),
                                           'accuracy_m', dl.accuracy_m, 'received_at', dl.received_at)
                   from public.driver_locations dl where dl.driver_id = v_uid),
    'fresh_seconds', public.config_int('dispatch.location_fresh_seconds'),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object(
                  'offer_id', o.id, 'booking_id', o.booking_id, 'status', o.status,
                  'pickup_address', o.pickup_address, 'dropoff_address', o.dropoff_address,
                  'pickup', jsonb_build_object('lat', extensions.st_y(o.pickup::extensions.geometry), 'lng', extensions.st_x(o.pickup::extensions.geometry)),
                  'category', o.category_code, 'currency', o.currency, 'fare_minor', o.fare_minor,
                  'trip_distance_m', o.trip_distance_m, 'trip_duration_s', o.trip_duration_s,
                  'pickup_distance_m', o.pickup_distance_m, 'bidding_enabled', o.bidding_enabled,
                  'expires_at', o.expires_at) order by o.offered_at), '[]'::jsonb)
                 from public.booking_offers o where o.driver_id = v_uid and o.status = 'pending' and o.expires_at > now()),
    'active_booking_id', v_active,
    'today', (select jsonb_build_object('trips', count(*), 'currency_totals',
                      coalesce(jsonb_object_agg(currency, net) filter (where currency is not null), '{}'::jsonb))
                from (select currency, sum(net_minor) net from public.driver_earnings
                       where driver_id = v_uid and created_at >= date_trunc('day', now() at time zone 'Africa/Monrovia') at time zone 'Africa/Monrovia'
                       group by currency) t)
  );
end;
$$;

create or replace function public.my_saved_locations()
returns table (id uuid, kind public.saved_location_kind, label text, address_text text, qls_code text,
               lat double precision, lng double precision, last_used_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select s.id, s.kind, s.label, s.address_text, s.qls_code,
         extensions.st_y(s.location::extensions.geometry), extensions.st_x(s.location::extensions.geometry), s.last_used_at
    from public.saved_locations s
   where s.user_id = (select auth.uid())
   order by s.kind, s.last_used_at desc
   limit 40;
$$;

create or replace function public.save_location(
  p_kind public.saved_location_kind, p_label text, p_address text, p_lat double precision, p_lng double precision,
  p_qls_code text default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
  v_id  uuid;
begin
  if p_kind = 'recent' then
    -- Refresh an existing recent entry for the same spot instead of duplicating it.
    update public.saved_locations set last_used_at = now(), address_text = left(p_address, 300)
     where user_id = v_uid and kind = 'recent'
       and extensions.st_dwithin(location, public.make_point(p_lat, p_lng), 30)
    returning id into v_id;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.saved_locations(user_id, kind, label, address_text, qls_code, location)
  values (v_uid, p_kind, left(btrim(p_label), 60), left(btrim(p_address), 300), p_qls_code, public.make_point(p_lat, p_lng))
  on conflict (user_id, lower(label)) where kind = 'saved'
  do update set address_text = excluded.address_text, qls_code = excluded.qls_code,
                location = excluded.location, last_used_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Manual allocation candidates for operators (ignores "already offered" exclusion).
create or replace function public.admin_assignable_drivers(p_booking_id uuid)
returns table (driver_id uuid, name text, phone text, distance_m integer, location_age_s integer, plate text, rating numeric)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_permission('bookings.assign');
  return query
  select d.id, p.full_name, p.phone,
         round(extensions.st_distance(dl.location, b.pickup))::integer,
         extract(epoch from now() - dl.received_at)::integer,
         v.plate_number, d.rating_avg
    from public.bookings b
    join public.drivers d on d.status = 'approved' and d.is_online
    join public.profiles p on p.id = d.id and not p.is_suspended
    join public.vehicles v on v.id = d.current_vehicle_id and v.status = 'approved' and v.category_id = b.category_id
    join public.driver_locations dl on dl.driver_id = d.id
   where b.id = p_booking_id
     and dl.received_at > now() - make_interval(secs => public.config_int('dispatch.location_fresh_seconds'))
     and not exists (select 1 from public.booking_assignments ba where ba.driver_id = d.id and ba.released_at is null)
   order by extensions.st_distance(dl.location, b.pickup)
   limit 30;
end;
$$;

create or replace function public.admin_create_promotion(
  p_name text, p_discount_type text, p_discount_value bigint, p_currency public.currency_code,
  p_max_discount_minor bigint, p_min_fare_minor bigint, p_category_code text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_usage_limit integer, p_per_user_limit integer,
  p_coupon_code text)
returns public.coupons
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_p public.promotions;
  v_c public.coupons;
begin
  perform public.require_permission('fares.manage');
  insert into public.promotions(name, discount_type, discount_value, currency, max_discount_minor, min_fare_minor,
    category_id, starts_at, ends_at, usage_limit, per_user_limit, created_by)
  values (btrim(p_name), p_discount_type, p_discount_value, p_currency, p_max_discount_minor, coalesce(p_min_fare_minor, 0),
    (select id from public.vehicle_categories where code = p_category_code),
    coalesce(p_starts_at, now()), p_ends_at, p_usage_limit, coalesce(p_per_user_limit, 1), (select auth.uid()))
  returning * into v_p;
  insert into public.coupons(promotion_id, code) values (v_p.id, upper(btrim(p_coupon_code))) returning * into v_c;
  perform public.write_audit('promotion.create', 'promotions', v_p.id::text, null,
    jsonb_build_object('promotion', to_jsonb(v_p), 'coupon', v_c.code));
  return v_c;
end;
$$;

create or replace function public.admin_set_promotion_active(p_promotion_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform public.require_permission('fares.manage');
  update public.promotions set is_active = p_active where id = p_promotion_id;
  if not found then raise exception 'promotion not found' using errcode = 'P0002'; end if;
  perform public.write_audit(case when p_active then 'promotion.activate' else 'promotion.deactivate' end,
    'promotions', p_promotion_id::text, null, jsonb_build_object('is_active', p_active));
end;
$$;

-- Landmark aliases are curated by operators (local knowledge beats geocoders in Monrovia).
create or replace function public.admin_upsert_alias(p_alias text, p_address text, p_lat double precision, p_lng double precision,
  p_qls_code text default null, p_verified boolean default true)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform public.require_permission('config.manage');
  insert into public.address_aliases(alias, address_text, qls_code, location, is_verified, created_by)
  values (btrim(p_alias), p_address, p_qls_code, public.make_point(p_lat, p_lng), p_verified, (select auth.uid()))
  on conflict (normalized) do update set address_text = excluded.address_text, qls_code = excluded.qls_code,
    location = excluded.location, is_verified = excluded.is_verified
  returning id into v_id;
  perform public.write_audit('alias.upsert', 'address_aliases', v_id::text, null,
    jsonb_build_object('alias', p_alias, 'lat', p_lat, 'lng', p_lng));
  return v_id;
end;
$$;

-- Live-ish fleet locations for a fleet operator (own drivers only).
create or replace function public.fleet_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := public.require_active_user();
begin
  if not public.has_role('fleet_operator') then raise exception 'permission denied' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'driver_id', d.id, 'name', p.full_name, 'status', d.status, 'online', d.is_online,
            'completed_trips', d.completed_trips, 'rating', d.rating_avg,
            'received_at', dl.received_at)), '[]'::jsonb)
            from public.fleets f join public.drivers d on d.fleet_id = f.id
            join public.profiles p on p.id = d.id
            left join public.driver_locations dl on dl.driver_id = d.id
           where f.owner_id = v_uid);
end;
$$;

grant execute on function
  public.nearest_place_label(double precision, double precision),
  public.search_address_aliases(text, integer),
  public.nearby_driver_count(double precision, double precision, text),
  public.driver_dashboard(),
  public.my_saved_locations(),
  public.save_location(public.saved_location_kind, text, text, double precision, double precision, text),
  public.admin_assignable_drivers(uuid),
  public.admin_create_promotion(text, text, bigint, public.currency_code, bigint, bigint, text, timestamptz, timestamptz, integer, integer, text),
  public.admin_set_promotion_active(uuid, boolean),
  public.admin_upsert_alias(text, text, double precision, double precision, text, boolean),
  public.fleet_overview()
  to authenticated;
