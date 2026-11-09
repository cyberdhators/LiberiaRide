-- Admin management of ride categories and geofences (service areas, airports, restricted and pricing zones).

create or replace function public.admin_upsert_category(
  p_code text, p_name text, p_description text, p_seats smallint, p_sort smallint, p_active boolean)
returns public.vehicle_categories
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_old public.vehicle_categories;
  v_new public.vehicle_categories;
begin
  perform public.require_permission('config.manage');
  p_code := lower(btrim(p_code));
  if p_code !~ '^[a-z_]{2,30}$' then raise exception 'code must be 2–30 lowercase letters or _' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(p_name)), 0) < 2 then raise exception 'enter a name' using errcode = '22023'; end if;
  if p_seats is null or p_seats not between 1 and 20 then raise exception 'seats must be 1–20' using errcode = '22023'; end if;

  select * into v_old from public.vehicle_categories where code = p_code for update;
  -- Passengers must never see an option that cannot be priced.
  if p_active and not exists (
    select 1 from public.fare_rules fr join public.vehicle_categories c on c.id = fr.category_id
     where c.code = p_code and fr.is_active) then
    raise exception 'add an active fare rule for % before switching it on', p_code using errcode = '22023';
  end if;

  insert into public.vehicle_categories(code, name, description, seats, sort_order, is_active)
  values (p_code, btrim(p_name), nullif(btrim(p_description), ''), p_seats, coalesce(p_sort, 0), coalesce(p_active, false))
  on conflict (code) do update set name = excluded.name, description = excluded.description, seats = excluded.seats,
                                   sort_order = excluded.sort_order, is_active = excluded.is_active
  returning * into v_new;

  perform public.write_audit(case when v_old.id is null then 'category.create' else 'category.update' end,
    'vehicle_categories', p_code, to_jsonb(v_old) - 'created_at' - 'updated_at', to_jsonb(v_new) - 'created_at' - 'updated_at');
  return v_new;
end;
$$;

create or replace function public.admin_geofences()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.is_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', g.id, 'code', g.code, 'name', g.name, 'kind', g.kind, 'is_active', g.is_active,
             'area_km2', round((extensions.st_area(g.area) / 1e6)::numeric, 1),
             'geojson', extensions.st_asgeojson(g.area, 6)::jsonb,
             'updated_at', g.updated_at) order by g.kind, g.name), '[]'::jsonb)
      from public.geofences g
  );
end;
$$;

-- Accepts a GeoJSON Polygon, MultiPolygon, Feature or FeatureCollection (e.g. exported from geojson.io).
create or replace function public.admin_upsert_geofence(
  p_code text, p_name text, p_kind text, p_geojson jsonb, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_old  public.geofences;
  v_geom extensions.geometry;
  v_km2  numeric;
  v_id   uuid;
begin
  perform public.require_permission('config.manage');
  p_code := lower(btrim(p_code));
  if p_code !~ '^[a-z0-9_]{2,40}$' then raise exception 'code must be 2–40 lowercase letters, digits or _' using errcode = '22023'; end if;
  if p_kind not in ('service_area', 'airport', 'restricted', 'pricing_zone') then raise exception 'unknown kind' using errcode = '22023'; end if;
  if coalesce(char_length(btrim(p_name)), 0) < 2 then raise exception 'enter a name' using errcode = '22023'; end if;
  select * into v_old from public.geofences where code = p_code for update;

  if p_geojson is not null then
    begin
      select extensions.st_union(extensions.st_geomfromgeojson(g::text)) into v_geom
        from (
          select case p_geojson->>'type'
                   when 'FeatureCollection' then f->'geometry'
                   when 'Feature' then p_geojson->'geometry'
                   else p_geojson end as g
            from (select jsonb_array_elements(case when p_geojson->>'type' = 'FeatureCollection'
                                                   then p_geojson->'features' else jsonb_build_array(null) end) as f) x
        ) y;
    exception when others then
      raise exception 'not valid GeoJSON: %', sqlerrm using errcode = '22023';
    end;
    v_geom := extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(extensions.st_setsrid(v_geom, 4326)), 3));
    if v_geom is null or extensions.st_isempty(v_geom) then raise exception 'the shape has no area (draw a polygon)' using errcode = '22023'; end if;
    if not extensions.st_within(v_geom, extensions.st_makeenvelope(-12.0, 4.0, -7.0, 9.0, 4326)) then
      raise exception 'the shape must be inside Liberia' using errcode = '22023';
    end if;
    v_km2 := extensions.st_area(v_geom::extensions.geography) / 1e6;
    if v_km2 < 0.01 or v_km2 > 50000 then raise exception 'area of % km² is not plausible', round(v_km2, 2) using errcode = '22023'; end if;
  elsif v_old.id is null then
    raise exception 'a new area needs a shape' using errcode = '22023';
  end if;

  -- Without any active service area, pickups would be accepted anywhere.
  if not p_active and p_kind = 'service_area' and not exists (
    select 1 from public.geofences where kind = 'service_area' and is_active and code <> p_code) then
    raise exception 'keep at least one active service area' using errcode = '22023';
  end if;

  insert into public.geofences(code, name, kind, area, is_active)
  values (p_code, btrim(p_name), p_kind, coalesce(v_geom::extensions.geography, v_old.area), p_active)
  on conflict (code) do update set name = excluded.name, kind = excluded.kind, area = excluded.area, is_active = excluded.is_active
  returning id into v_id;

  perform public.write_audit(case when v_old.id is null then 'geofence.create' else 'geofence.update' end,
    'geofences', p_code,
    case when v_old.id is null then null else jsonb_build_object('name', v_old.name, 'kind', v_old.kind, 'is_active', v_old.is_active,
      'area_km2', round((extensions.st_area(v_old.area) / 1e6)::numeric, 1)) end,
    jsonb_build_object('name', btrim(p_name), 'kind', p_kind, 'is_active', p_active, 'shape_changed', p_geojson is not null,
      'area_km2', round(coalesce(v_km2, extensions.st_area(v_old.area) / 1e6)::numeric, 1)));
  return jsonb_build_object('id', v_id, 'area_km2', round(coalesce(v_km2, extensions.st_area(v_old.area) / 1e6)::numeric, 1));
end;
$$;

revoke execute on function public.admin_upsert_category(text, text, text, smallint, smallint, boolean),
  public.admin_geofences(), public.admin_upsert_geofence(text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.admin_upsert_category(text, text, text, smallint, smallint, boolean),
  public.admin_geofences(), public.admin_upsert_geofence(text, text, text, jsonb, boolean) to authenticated;
