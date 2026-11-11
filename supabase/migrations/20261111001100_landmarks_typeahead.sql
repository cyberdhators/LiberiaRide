-- =====================================================================
-- LiberiaRide · 0039 · Landmarks for type-ahead place search
--
-- Free, instant suggestions while the passenger types. Sources, in order:
--   1. address_aliases — landmarks curated by operators (Fares & config)
--   2. landmarks       — named places and streets of Greater Monrovia from
--                        OpenStreetMap (© OpenStreetMap contributors, ODbL),
--                        loaded from supabase/seed/osm-monrovia-landmarks.csv
--                        by scripts/import-landmarks.mjs
-- QLS stays the location provider for addresses and anything not listed
-- (the app falls back to it when the passenger presses Search).
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

create table public.landmarks (
  id          bigint generated always as identity primary key,
  source      text not null default 'osm' check (source in ('osm')),
  source_id   text not null,
  name        text not null check (char_length(name) between 1 and 200),
  category    text,
  locality    text,
  alt_names   text,
  location    extensions.geography(Point, 4326) not null,
  search_text text generated always as (lower(name || coalesce(' ' || alt_names, ''))) stored,
  updated_at  timestamptz not null default now(),
  unique (source, source_id)
);
create index landmarks_search_trgm on public.landmarks using gin (search_text extensions.gin_trgm_ops);
create index landmarks_location_gix on public.landmarks using gist (location);
alter table public.landmarks enable row level security;
grant select on public.landmarks to authenticated;
create policy landmarks_read on public.landmarks for select to authenticated using (true);

-- Suggestions for what the passenger has typed so far (≥ 2 characters).
-- Ranking: curated landmarks first; then name starts with the text, a word starts with
-- it, it appears anywhere, then fuzzy (typos); nearer to the passenger breaks ties.
create or replace function public.suggest_places(
  p_query text, p_lat double precision default null, p_lng double precision default null, p_limit integer default 8)
returns table (label text, subtitle text, lat double precision, lng double precision, source text, qls_code text)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g')) as t,
           case when p_lat is not null and p_lng is not null then public.make_point(p_lat, p_lng) end as here
  ), cand as (
    select a.alias as label, a.address_text as subtitle, a.location, 'alias'::text as source, a.qls_code,
           0 as tier,
           case when a.normalized like q.t || '%' then 0 when a.normalized like '% ' || q.t || '%' then 1 else 2 end as rank
      from public.address_aliases a, q
     where a.is_verified and length(q.t) >= 2 and a.normalized like '%' || q.t || '%'
    union all
    select l.name, concat_ws(' · ', nullif(l.category, ''), nullif(l.locality, '')), l.location, 'landmark', null,
           1,
           case when l.search_text like q.t || '%' then 0
                when l.search_text like '% ' || q.t || '%' then 1
                when l.search_text like '%' || q.t || '%' then 2
                else 3 end
      from public.landmarks l, q
     where length(q.t) >= 2
       and (l.search_text like '%' || q.t || '%' or (length(q.t) >= 4 and l.search_text % q.t))
  )
  select c.label, c.subtitle, extensions.st_y(c.location::extensions.geometry), extensions.st_x(c.location::extensions.geometry),
         c.source, c.qls_code
    from cand c, q
   order by c.tier, c.rank,
            case when q.here is null then 0 else extensions.st_distance(c.location, q.here) end,
            length(c.label)
   limit least(greatest(coalesce(p_limit, 8), 1), 15);
$$;

-- Reverse lookup (pickup naming): curated alias (75 m) → OSM landmark (60 m) → cached QLS result (50 m).
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

  select jsonb_build_object('label', 'Near ' || l.name, 'source', 'landmark', 'qls_ref', null,
                            'distance_m', round(extensions.st_distance(l.location, v_pt)))
    into v
    from public.landmarks l
   where l.category is distinct from 'Street' and extensions.st_dwithin(l.location, v_pt, 60)
   order by extensions.st_distance(l.location, v_pt) limit 1;
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

revoke execute on function public.suggest_places(text, double precision, double precision, integer) from public, anon;
grant execute on function public.suggest_places(text, double precision, double precision, integer) to authenticated;
