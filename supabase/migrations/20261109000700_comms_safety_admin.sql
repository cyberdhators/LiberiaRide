-- =====================================================================
-- LiberiaRide · 0007 · Communication, safety, administration, QLS cache
-- =====================================================================

-- ---------------------------------------------------------------------
-- Communication
-- ---------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (char_length(kind) between 2 and 60),
  title      text not null check (char_length(title) <= 120),
  body       text check (char_length(body) <= 1000),
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

create table public.chat_conversations (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null unique references public.bookings(id) on delete cascade,
  passenger_id uuid not null references public.profiles(id) on delete cascade,
  driver_id    uuid not null references public.drivers(id) on delete cascade,
  closed_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index chat_conversations_passenger_idx on public.chat_conversations(passenger_id);
create index chat_conversations_driver_idx on public.chat_conversations(driver_id);

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 1000),
  created_at      timestamptz not null default now()
);
create index chat_messages_conversation_idx on public.chat_messages(conversation_id, created_at);

-- Persistent log of everything broadcast over Realtime (Realtime is transport, not storage).
create table public.realtime_events (
  id         bigint generated always as identity primary key,
  topic      text not null,
  event      text not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index realtime_events_topic_idx on public.realtime_events(topic, id desc);

create table public.whatsapp_conversations (
  id               uuid primary key default gen_random_uuid(),
  wa_id            text not null unique check (wa_id ~ '^[0-9]{7,15}$'),  -- WhatsApp user id (E.164 digits)
  profile_id       uuid references public.profiles(id) on delete set null,
  state            text not null default 'idle',
  context          jsonb not null default '{}'::jsonb,
  active_booking_id uuid references public.bookings(id) on delete set null,
  last_inbound_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger whatsapp_conversations_updated_at before update on public.whatsapp_conversations
  for each row execute function public.set_updated_at();

create table public.whatsapp_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  wa_message_id   text unique,
  direction       public.message_direction not null,
  msg_type        text not null,
  body            jsonb not null default '{}'::jsonb,
  status          text,
  created_at      timestamptz not null default now()
);
create index whatsapp_messages_conversation_idx on public.whatsapp_messages(conversation_id, created_at);

-- ---------------------------------------------------------------------
-- Safety
-- ---------------------------------------------------------------------
create table public.emergency_contacts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  phone        text not null check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  relationship text check (char_length(relationship) <= 40),
  created_at   timestamptz not null default now(),
  unique (user_id, phone)
);

create table public.safety_incidents (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid references public.bookings(id) on delete set null,
  reporter_id  uuid not null references public.profiles(id) on delete restrict,
  reporter_role text not null check (reporter_role in ('passenger', 'driver', 'admin')),
  kind         public.incident_kind not null,
  severity     smallint not null default 3 check (severity between 1 and 5),
  status       public.case_status not null default 'open',
  location     extensions.geography(Point, 4326),
  description  text check (char_length(description) <= 2000),
  assigned_to  uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at  timestamptz,
  resolution   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index safety_incidents_open_idx on public.safety_incidents(status, created_at desc) where status in ('open', 'acknowledged', 'investigating');
create index safety_incidents_reporter_idx on public.safety_incidents(reporter_id);
create trigger safety_incidents_updated_at before update on public.safety_incidents
  for each row execute function public.set_updated_at();

create table public.complaints (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid references public.bookings(id) on delete set null,
  complainant_id uuid not null references public.profiles(id) on delete restrict,
  against_user_id uuid references public.profiles(id) on delete set null,
  category       text not null check (category in ('driver_behaviour', 'passenger_behaviour', 'fare', 'payment', 'vehicle', 'route', 'lost_item', 'app', 'other')),
  description    text not null check (char_length(description) between 5 and 2000),
  status         public.case_status not null default 'open',
  assigned_to    uuid references public.profiles(id) on delete set null,
  resolution     text,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index complaints_status_idx on public.complaints(status, created_at desc);
create index complaints_complainant_idx on public.complaints(complainant_id);
create trigger complaints_updated_at before update on public.complaints
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_role  text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

create table public.configuration_settings (
  key         text primary key check (key ~ '^[a-z_]+\.[a-z_]+$'),
  value       jsonb not null,
  description text,
  is_public   boolean not null default false,   -- safe to expose to all signed-in clients
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Typed config readers (fail loudly if a key is missing).
create or replace function public.config_int(p_key text)
returns integer
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select (select value from public.configuration_settings where key = p_key)::text::integer;
$$;

create or replace function public.config_numeric(p_key text)
returns numeric
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select (select value from public.configuration_settings where key = p_key)::text::numeric;
$$;

create or replace function public.config_text(p_key text)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select (select value #>> '{}' from public.configuration_settings where key = p_key);
$$;

create or replace function public.config_bool(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select (select value from public.configuration_settings where key = p_key)::text::boolean;
$$;

-- Privileged-action audit writer.
create or replace function public.write_audit(
  p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_role text;
begin
  select string_agg(role::text, ',' order by role) into v_role
    from public.user_roles where user_id = (select auth.uid());
  insert into public.audit_logs(actor_id, actor_role, action, entity_type, entity_id, before, after, reason)
  values ((select auth.uid()), coalesce(v_role, 'system'), p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason);
end;
$$;

-- ---------------------------------------------------------------------
-- QLS lookup cache (server-only; see docs/QLS_INTEGRATION.md §6)
-- ---------------------------------------------------------------------
create table public.qls_lookup_cache (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('place', 'address', 'directions')),
  query_hash  text not null,
  query_text  text not null,
  response    jsonb not null,
  label       text,
  location    extensions.geography(Point, 4326),
  hit_count   integer not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (kind, query_hash)
);
create index qls_lookup_cache_location_gix on public.qls_lookup_cache using gist(location);
create index qls_lookup_cache_expiry_idx on public.qls_lookup_cache(expires_at);

-- QLS call ledger, for credit monitoring.
create table public.qls_usage (
  id          bigint generated always as identity primary key,
  endpoint    text not null,
  http_status integer not null,
  error_code  text,
  billed      boolean not null,
  user_id     uuid references public.profiles(id) on delete set null,
  latency_ms  integer,
  created_at  timestamptz not null default now()
);
create index qls_usage_time_idx on public.qls_usage(created_at desc);
